const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const { launchBrowser, closeBrowser, isLoggedIn, generateVideo } = require('./automation');

// Env loading — when spawned from /api/seedance the parent Next.js process
// has DATABASE_URL in process.env already. When run standalone (`node
// seedance-runner.js …`) read tiktalk-admin/.env.local as a fallback so we
// don't need to duplicate the connection string.
if (!process.env.DATABASE_URL) {
  const envPath = path.join(__dirname, '..', 'tiktalk-admin', '.env.local');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL missing — set it in tiktalk-admin/.env.local or export it.');
  process.exit(1);
}

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
});

// Accept pool item IDs as command line arguments
const poolItemIds = process.argv.slice(2);
if (poolItemIds.length === 0) {
  console.error('Usage: node seedance-runner.js <pool_item_id> [pool_item_id2] ...');
  process.exit(1);
}

async function updateStatus(id, status, videoFile = null) {
  if (videoFile) {
    await db.query('UPDATE pool_items SET status = $1, video_file = $2 WHERE id = $3', [status, videoFile, id]);
  } else {
    await db.query('UPDATE pool_items SET status = $1 WHERE id = $2', [status, id]);
  }
}

async function logEvent(poolItemId, level, message, metadata = null) {
  const prefix = `[seedance/${level}]${poolItemId ? ' ' + poolItemId.slice(0, 8) : ''}`;
  if (level === 'error') console.error(prefix, message);
  else console.log(prefix, message);
  try {
    await db.query(
      `INSERT INTO pipeline_logs (pool_item_id, phase, level, message, metadata)
       VALUES ($1, 'seedance', $2, $3, $4)`,
      [poolItemId, level, String(message).slice(0, 5000), metadata ? JSON.stringify(metadata) : null]
    );
  } catch (e) {
    console.error('log insert failed:', e.message);
  }
}

async function markFailed(id, errorMessage) {
  const failNote = `Seedance error: ${errorMessage}`;
  try {
    await db.query(
      `UPDATE pool_items SET status = 'failed',
         notes = CASE WHEN notes IS NOT NULL THEN notes || E'\\n---\\n' || $1 ELSE $1 END
       WHERE id = $2`,
      [failNote, id]
    );
  } catch (e) {
    console.error('markFailed failed:', e.message);
  }
}

async function main() {
  // Fetch pool items from DB
  const { rows: items } = await db.query(
    'SELECT id, seedance_prompt, status FROM pool_items WHERE id = ANY($1)',
    [poolItemIds]
  );

  if (items.length === 0) {
    console.error('No pool items found for given IDs');
    process.exit(1);
  }

  const pendingItems = items.filter(i => i.seedance_prompt);
  if (pendingItems.length === 0) {
    console.error('No items with seedance_prompt found');
    process.exit(1);
  }

  console.log(`${pendingItems.length} item islenecek`);

  // Launch browser (handles video mode selection)
  try {
    await launchBrowser();
  } catch (err) {
    for (const item of pendingItems) {
      await logEvent(item.id, 'error', `launchBrowser failed: ${err.message}`);
      await markFailed(item.id, `launchBrowser failed: ${err.message}`);
    }
    throw err;
  }

  // Check login — runner is spawned non-interactively from /api/seedance,
  // so don't block on stdin. Fail fast with a clear message; user fixes it
  // by running `npm run login` once and retrying.
  const loggedIn = await isLoggedIn();
  if (!loggedIn) {
    for (const item of pendingItems) {
      await logEvent(item.id, 'error', 'Dreamina login missing — run `npm run login` first');
      await markFailed(item.id, 'Dreamina login missing — run `npm run login` first');
    }
    await closeBrowser();
    console.error('Giris yapilmamis! Once `npm run login` calistirip Dreamina profilini kaydet.');
    process.exit(2);
  }

  for (let i = 0; i < pendingItems.length; i++) {
    const item = pendingItems[i];
    console.log(`\n========== [${i + 1}/${pendingItems.length}] ID: ${item.id.slice(0, 8)}... ==========`);

    await updateStatus(item.id, 'processing');
    await logEvent(item.id, 'info', 'Seedance generation started');
    const start = Date.now();

    try {
      const result = await generateVideo(
        { id: item.id, prompt: item.seedance_prompt },
        async (msg) => {
          console.log(`  ${msg}`);
          await logEvent(item.id, 'info', msg);
        }
      );

      const fileName = path.basename(result.filePath);
      await updateStatus(item.id, 'completed', fileName);
      await logEvent(item.id, 'info', 'Seedance generation finished', {
        duration_ms: Date.now() - start,
        file: fileName,
      });
      console.log(`DB guncellendi: ${fileName}`);
    } catch (err) {
      console.error(`Hata: ${err.message}`);
      console.error(err.stack);
      await logEvent(item.id, 'error', `Seedance failed: ${err.message}`, {
        duration_ms: Date.now() - start,
        stack: err.stack ? err.stack.slice(0, 1000) : null,
      });
      await markFailed(item.id, err.message);
    }

    if (i < pendingItems.length - 1) {
      console.log('Siradaki icin 3sn bekleniyor...');
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log('\nTum islemler tamamlandi!');
  await closeBrowser();
  await db.end();
}

main().catch(err => {
  console.error('Fatal hata:', err.message);
  console.error(err.stack);
  process.exit(1);
});
