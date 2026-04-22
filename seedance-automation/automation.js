const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

const USER_DATA_DIR = path.join(__dirname, 'browser-data');
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
const PAGE_URL = 'https://dreamina.capcut.com/ai-tool/generate';

let browser = null;
let page = null;

async function launchBrowser() {
  if (browser) return page;

  if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
  });

  page = browser.pages()[0] || await browser.newPage();
  await page.goto(PAGE_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  // "YZ Yardımcısı" dropdown'ını aç ve "Yapay Zekâ Video" seç
  await selectVideoMode();

  return page;
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
  }
}

async function isLoggedIn() {
  if (!page) return false;
  return await page.evaluate(() => {
    const el = document.querySelector('#__GTW_LOGIN_STATUS__');
    if (el) {
      try { return JSON.parse(el.textContent).__isLogined === true; } catch {}
    }
    return false;
  });
}

// Sayfa açıldığında "Yapay Zekâ Video" moduna geç
async function selectVideoMode() {
  try {
    // "YZ Yardımcısı" dropdown'ının görünmesini bekle
    const dropdown = page.locator('xpath=//*[@id="dreamina-ui-configuration-content-wrapper"]//span[text()="YZ Yardımcısı"]');
    await dropdown.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(1000);

    // Dropdown'a tıkla
    await dropdown.click();
    await page.waitForTimeout(500);

    // Açılan popup'tan "Yapay Zekâ Video" seç
    await page.locator('xpath=//span[text()="Yapay Zekâ Video"]').click();
    await page.waitForTimeout(1500);
    console.log('Video modu seçildi.');
  } catch (err) {
    console.log('Video modu seçimi atlandı:', err.message);
  }
}

// Sayfada aktif üretim olup olmadığını kontrol et
// "Hayal ediliyor" veya herhangi bir progress badge varsa bekle
async function waitUntilIdle(onProgress) {
  const maxWait = 20 * 60 * 1000; // 20 dakika
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    const progressText = await page.evaluate(() => {
      const badges = document.querySelectorAll('[class*="progress-badge"]');
      if (badges.length === 0) return null;
      return badges[0].innerText?.trim() || 'aktif';
    });

    if (progressText === null) return; // Temiz, devam edebiliriz

    onProgress(`Önceki üretim devam ediyor: ${progressText} - bekleniyor...`);
    await page.waitForTimeout(5000);
  }

  throw new Error('Sayfa 20 dakikadır meşgul, devam edilemiyor');
}

async function generateVideo(videoData, onProgress) {
  if (!page) throw new Error('Tarayıcı açık değil');

  const { prompt } = videoData;

  // 0) Önce sayfanın boşta olduğundan emin ol
  onProgress('Sayfa kontrol ediliyor...');
  await waitUntilIdle(onProgress);

  // 1) Prompt yaz
  //
  // Dreamina replaced the <textarea> with a Tiptap/ProseMirror
  // contenteditable editor. The placeholder paragraph carries the
  // `is-editor-empty` class — click it to focus the editor, then use
  // keyboard input (contenteditable doesn't support .fill() on <p>).
  onProgress('Prompt yazılıyor...');
  const editorPlaceholder = page.locator('p.is-editor-empty').first();
  await editorPlaceholder.waitFor({ state: 'visible', timeout: 15000 });
  await editorPlaceholder.click();
  // Select-all + delete first, in case the editor is somehow non-empty.
  const selectAllKey = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
  await page.keyboard.press(selectAllKey);
  await page.keyboard.press('Delete');
  // insertText fires a single input event (faster + cleaner for Tiptap
  // than .type() which simulates each keystroke).
  await page.keyboard.insertText(prompt);
  await page.waitForTimeout(1000);

  // 2) Generate butonuna bas
  onProgress('Generate tıklanıyor...');
  await page.waitForFunction(() => {
    const btn = document.querySelector('button[class*="submit-button"]');
    return btn && !btn.classList.contains('lv-btn-disabled');
  }, { timeout: 10000 });

  const generateBtn = page.locator('button[class*="submit-button"]:not(.lv-btn-disabled)').last();
  await generateBtn.click({ force: true });

  // 3) "Hayal ediliyor" progress badge çıkmasını bekle
  onProgress('Üretim başlaması bekleniyor...');
  try {
    await page.waitForSelector('[class*="progress-badge"]', { timeout: 30000 });
    onProgress('Üretim başladı!');
  } catch {
    // Badge çıkmadıysa belki çok hızlı bitti veya hata oldu
    // Kısa bekle ve kontrol et
    await page.waitForTimeout(5000);
    const hasBadge = await page.$('[class*="progress-badge"]');
    if (!hasBadge) {
      // Belki hata mesajı var, belki zaten bitti - kontrol et
      const hasError = await page.evaluate(() => {
        const card = document.querySelector('.item-sQ2mIg');
        if (!card) return null;
        const errEl = card.querySelector('[class*="error-tips"]');
        return errEl ? errEl.innerText?.trim() : null;
      });
      if (hasError) {
        throw new Error(`Dreamina hatası: ${hasError}`);
      }
      onProgress('Progress badge görünmedi ama devam ediliyor...');
    }
  }

  // 4) Progress takip et - badge kaybolana kadar
  const maxWait = 20 * 60 * 1000;
  const startTime = Date.now();
  let noCardCount = 0;

  while (Date.now() - startTime < maxWait) {
    const progressText = await page.evaluate(() => {
      const badges = document.querySelectorAll('[class*="progress-badge"]');
      if (badges.length === 0) return null;
      return badges[0].innerText?.trim() || 'bekliyor';
    });

    if (progressText === null) {
      // Badge kayboldu — ilk video-record'u kontrol et
      const state = await page.evaluate(() => {
        const record = document.querySelector('div[class*="video-record"]');
        if (!record) return { cardFound: false, hasVideo: false, error: null };

        // Hata tespiti
        const errSelectors = [
          '[class*="error-tips"]',
          '[class*="error-text"]',
          '[class*="failed"]',
          '[class*="reject"]',
        ];
        let errText = null;
        for (const sel of errSelectors) {
          const el = record.querySelector(sel);
          if (el && el.innerText) { errText = el.innerText.trim(); break; }
        }

        const video = record.querySelector('video[src]');
        return { cardFound: true, hasVideo: !!video, error: errText };
      });

      if (state.error) {
        throw new Error(`Dreamina hatası: ${state.error}`);
      }
      if (state.hasVideo) {
        onProgress('Üretim tamamlandı!');
        break;
      }
      // video-record card bulundu ama video henüz hazır değil — kısa bekle
      if (!state.cardFound) {
        // Hiç video-record yok — belki henüz render edilmedi
        noCardCount = (noCardCount || 0) + 1;
        if (noCardCount > 20) {
          throw new Error('video-record elementi 60 saniyedir bulunamıyor — UI değişmiş olabilir');
        }
      } else {
        noCardCount = 0;
      }
      onProgress('Badge kayboldu, video hazırlanıyor...');
      await page.waitForTimeout(3000);
      continue;
    }

    onProgress(progressText);
    await page.waitForTimeout(3000);
  }

  if (Date.now() - startTime >= maxWait) {
    throw new Error('Zaman aşımı - video üretimi 20 dakikayı geçti');
  }

  // 5) Biraz bekle, sonra video src al
  await page.waitForTimeout(3000);

  // İlk video-record div'inin içindeki ilk video elementini al
  let videoSrc = null;
  try {
    const videoHandle = await page
      .locator('xpath=(//div[contains(@class, "video-record")]//video)[1]')
      .first();
    await videoHandle.waitFor({ state: 'attached', timeout: 10000 });
    videoSrc = await videoHandle.getAttribute('src');
  } catch {
    videoSrc = null;
  }

  if (!videoSrc) {
    // Dump debug info so we can see WHY
    const debugDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotPath = path.join(debugDir, `fail-${videoData.id}-${ts}.png`);
    const htmlPath = path.join(debugDir, `fail-${videoData.id}-${ts}.html`);

    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch (e) { console.error('screenshot failed:', e.message); }

    try {
      // Grab just the card area HTML to keep it small
      const cardHtml = await page.evaluate(() => {
        const cardSelectors = ['[class*="item-"]', '[class*="history-item"]', '[class*="card"]'];
        for (const sel of cardSelectors) {
          const el = document.querySelector(sel);
          if (el) return el.outerHTML.slice(0, 50000);
        }
        return document.body.innerHTML.slice(0, 50000);
      });
      fs.writeFileSync(htmlPath, cardHtml);
    } catch (e) { console.error('html dump failed:', e.message); }

    // Try to extract visible text from the card area for the error message
    const cardText = await page.evaluate(() => {
      const cardSelectors = ['[class*="item-"]', '[class*="history-item"]', '[class*="card"]'];
      for (const sel of cardSelectors) {
        const el = document.querySelector(sel);
        if (el) return (el.innerText || '').slice(0, 500);
      }
      return '';
    }).catch(() => '');

    throw new Error(
      `Video src bulunamadı. Screenshot: ${path.basename(screenshotPath)}. Card text: "${cardText.replace(/\n/g, ' | ')}"`
    );
  }

  // 6) İndir
  onProgress('Video indiriliyor...');
  const fileName = `seedance_${videoData.id}_${Date.now()}.mp4`;
  const savePath = path.join(DOWNLOAD_DIR, fileName);
  await downloadFile(videoSrc, savePath, (pct) => {
    onProgress(`İndiriliyor... ${pct}%`);
  });

  return { filePath: savePath, videoUrl: videoSrc };
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(response.headers.location, dest, onProgress).then(resolve).catch(reject);
      }
      const total = parseInt(response.headers['content-length'], 10);
      let downloaded = 0;
      response.on('data', (chunk) => {
        downloaded += chunk.length;
        if (total && onProgress) {
          onProgress(Math.round((downloaded / total) * 100));
        }
      });
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
  });
}

async function refreshPage() {
  if (!page) return;
  await page.goto(PAGE_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);
  await selectVideoMode();
  // Sayfa yüklendikten sonra progress badge olmadığından emin ol
  await waitUntilIdle(() => {});
}

module.exports = { launchBrowser, closeBrowser, isLoggedIn, generateVideo, refreshPage };
