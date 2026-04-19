const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');
const XLSX = require('xlsx');

let mainWindow;
let db;

// --- DATABASE ---
function initDB() {
  const dbPath = path.join(app.getPath('userData'), 'seedance.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      model TEXT DEFAULT 'Seedance 2.0',
      aspect_ratio TEXT DEFAULT '9:16',
      resolution TEXT DEFAULT '720p',
      file_path TEXT,
      video_url TEXT,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      extra TEXT DEFAULT '{}'
    )
  `);

  return dbPath;
}

// --- WINDOW ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Seedance Automation',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  const dbPath = initDB();
  console.log('DB:', dbPath);
  createWindow();
});

app.on('window-all-closed', () => {
  if (db) db.close();
  app.quit();
});

// --- IPC HANDLERS ---

// Get all videos
ipcMain.handle('get-videos', () => {
  return db.prepare('SELECT * FROM videos ORDER BY id DESC').all();
});

// Add single video
ipcMain.handle('add-video', (_, data) => {
  const stmt = db.prepare(`
    INSERT INTO videos (prompt, model, aspect_ratio, resolution, extra)
    VALUES (@prompt, @model, @aspect_ratio, @resolution, @extra)
  `);
  const result = stmt.run({
    prompt: data.prompt,
    model: data.model || 'Seedance 2.0',
    aspect_ratio: data.aspect_ratio || '9:16',
    resolution: data.resolution || '720p',
    extra: JSON.stringify(data.extra || {}),
  });
  return result.lastInsertRowid;
});

// Add multiple videos (bulk)
ipcMain.handle('add-videos-bulk', (_, items) => {
  const stmt = db.prepare(`
    INSERT INTO videos (prompt, model, aspect_ratio, resolution, extra)
    VALUES (@prompt, @model, @aspect_ratio, @resolution, @extra)
  `);
  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      stmt.run({
        prompt: row.prompt,
        model: row.model || 'Seedance 2.0',
        aspect_ratio: row.aspect_ratio || '9:16',
        resolution: row.resolution || '720p',
        extra: JSON.stringify(row.extra || {}),
      });
    }
  });
  insertMany(items);
  return items.length;
});

// Update video status
ipcMain.handle('update-video', (_, id, data) => {
  const fields = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
  const stmt = db.prepare(`UPDATE videos SET ${fields} WHERE id = @id`);
  stmt.run({ id, ...data });
});

// Delete video
ipcMain.handle('delete-video', (_, id) => {
  db.prepare('DELETE FROM videos WHERE id = ?').run(id);
});

// Delete all pending
ipcMain.handle('delete-all-pending', () => {
  db.prepare("DELETE FROM videos WHERE status = 'pending'").run();
});

// Import Excel file
ipcMain.handle('import-excel', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [
      { name: 'Excel/CSV', extensions: ['xlsx', 'xls', 'csv'] },
    ],
    properties: ['openFile'],
  });

  if (result.canceled) return null;

  const filePath = result.filePaths[0];
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);

  // Map columns - expect at least "prompt" column
  const items = rows.map(row => ({
    prompt: row.prompt || row.Prompt || row.PROMPT || '',
    model: row.model || row.Model || 'Seedance 2.0',
    aspect_ratio: row.aspect_ratio || row.ratio || '9:16',
    resolution: row.resolution || '720p',
    extra: {},
  })).filter(item => item.prompt.trim());

  return items;
});

// Import JSON file
ipcMain.handle('import-json', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [
      { name: 'JSON', extensions: ['json'] },
    ],
    properties: ['openFile'],
  });

  if (result.canceled) return null;

  const content = fs.readFileSync(result.filePaths[0], 'utf-8');
  const data = JSON.parse(content);
  const items = (Array.isArray(data) ? data : [data]).map(row => ({
    prompt: row.prompt || '',
    model: row.model || 'Seedance 2.0',
    aspect_ratio: row.aspect_ratio || '9:16',
    resolution: row.resolution || '720p',
    extra: row.extra || {},
  })).filter(item => item.prompt.trim());

  return items;
});

// Get download directory
ipcMain.handle('get-download-dir', () => {
  const dir = path.join(__dirname, 'downloads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
});

// --- AUTOMATION ---
const automation = require('./automation');

ipcMain.handle('launch-browser', async () => {
  await automation.launchBrowser();
  const loggedIn = await automation.isLoggedIn();
  return { loggedIn };
});

ipcMain.handle('close-browser', async () => {
  await automation.closeBrowser();
});

ipcMain.handle('generate-video', async (event, videoData) => {
  try {
    const result = await automation.generateVideo(videoData, (progressText) => {
      mainWindow.webContents.send('generation-progress', {
        videoId: videoData.id,
        progress: progressText,
      });
    });
    return result;
  } catch (err) {
    // Hata olursa sayfayı yenile ki sıradaki temiz başlasın
    mainWindow.webContents.send('generation-progress', {
      videoId: videoData.id,
      progress: `Hata: ${err.message} - sayfa yenileniyor...`,
    });
    try { await automation.refreshPage(); } catch {}
    throw err;
  }
});

ipcMain.handle('refresh-page', async () => {
  await automation.refreshPage();
});
