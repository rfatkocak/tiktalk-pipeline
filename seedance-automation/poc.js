const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

const USER_DATA_DIR = path.join(__dirname, 'browser-data');
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
const PAGE_URL = 'https://dreamina.capcut.com/ai-tool/generate';

const PROMPTS = [
  'A cat walking gracefully through a beautiful garden, cinematic lighting, slow motion',
  'A drone shot flying over a misty mountain forest at sunrise, epic cinematic aerial view',
];

async function main() {
  if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  console.log('Tarayıcı açılıyor...');
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto(PAGE_URL, { waitUntil: 'networkidle', timeout: 60000 });

  console.log('Sayfa yüklendi. Giriş yapıldıysa ENTER bas.');
  await new Promise(resolve => process.stdin.once('data', resolve));

  for (let i = 0; i < PROMPTS.length; i++) {
    const prompt = PROMPTS[i];
    console.log(`\n========== [${i + 1}/${PROMPTS.length}] ==========`);
    console.log(`Prompt: ${prompt.substring(0, 60)}...`);

    // Prompt yaz
    console.log('Prompt yazılıyor...');
    const textarea = page.locator('textarea.prompt-textarea-mYAOkL');
    await textarea.click();
    await textarea.fill('');
    await textarea.fill(prompt);
    await page.waitForTimeout(1000);

    // Generate butonuna bas
    console.log('Generate tıklanıyor...');
    await page.waitForFunction(() => {
      const btn = document.querySelector('button[class*="submit-button"]');
      return btn && !btn.classList.contains('lv-btn-disabled');
    }, { timeout: 10000 }).catch(() => null);

    const generateBtn = page.locator('button[class*="submit-button"]:not(.lv-btn-disabled)').last();
    const btnCount = await generateBtn.count();
    if (btnCount === 0) {
      console.log('❌ Generate butonu bulunamadı! Atlaniyor...');
      continue;
    }
    await generateBtn.click({ force: true });

    // 1) "Hayal ediliyor" çıkmasını bekle (üretim başladı)
    console.log('Üretim başlaması bekleniyor...');
    try {
      await page.waitForSelector('[class*="progress-badge"]', { timeout: 30000 });
      console.log('✅ Üretim başladı!');
    } catch {
      console.log('⚠️  Progress badge görünmedi, yine de bekleniyor...');
    }

    // 2) Progress'i takip et - badge kaybolana kadar bekle (üretim bitti)
    const maxWait = 10 * 60 * 1000;
    const startTime = Date.now();
    let lastProgress = '';

    while (Date.now() - startTime < maxWait) {
      const progressText = await page.evaluate(() => {
        const badges = document.querySelectorAll('[class*="progress-badge"]');
        if (badges.length === 0) return null; // Üretim bitti
        // En üstteki (en yeni) badge'i al
        return badges[0].innerText?.trim() || 'bekliyor';
      });

      if (progressText === null) {
        // Progress badge kayboldu = üretim tamamlandı
        console.log(`\n✅ Üretim tamamlandı!`);
        break;
      }

      if (progressText !== lastProgress) {
        process.stdout.write(`\n  ${progressText}`);
        lastProgress = progressText;
      } else {
        process.stdout.write('.');
      }

      await page.waitForTimeout(3000);
    }

    if (Date.now() - startTime >= maxWait) {
      console.log('\n⏰ Zaman aşımı! Sıradakine geçiliyor...');
      continue;
    }

    // 3) Kısa bekle, sonra en üstteki kartın videosunu al
    await page.waitForTimeout(3000);

    const newVideoSrc = await page.evaluate(() => {
      // İlk karttaki video (en yeni üretim)
      const firstCard = document.querySelector('.item-sQ2mIg');
      if (!firstCard) return null;
      const video = firstCard.querySelector('video[src]');
      return video?.src || null;
    });

    if (!newVideoSrc) {
      console.log('❌ Video src bulunamadı! Sıradakine geçiliyor...');
      await page.screenshot({ path: `debug-novideo-${i}.png` });
      continue;
    }

    // 4) İndir
    console.log('Video indiriliyor...');
    const fileName = `seedance_${i + 1}_${Date.now()}.mp4`;
    const savePath = path.join(DOWNLOAD_DIR, fileName);
    await downloadFile(newVideoSrc, savePath);
    console.log(`📁 Kaydedildi: ${savePath}`);

    if (i < PROMPTS.length - 1) {
      console.log('Sıradaki prompt için 3sn bekleniyor...');
      await page.waitForTimeout(3000);
    }
  }

  console.log('\n🎉 Tüm videolar tamamlandı! Tarayıcı kapatılıyor...');
  await context.close();
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      const total = parseInt(response.headers['content-length'], 10);
      let downloaded = 0;
      response.on('data', (chunk) => {
        downloaded += chunk.length;
        if (total) {
          const pct = Math.round((downloaded / total) * 100);
          process.stdout.write(`\r  İndiriliyor... ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)}MB)`);
        }
      });
      response.pipe(file);
      file.on('finish', () => { file.close(); console.log(''); resolve(); });
    }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
  });
}

main().catch(err => {
  console.error('Hata:', err.message);
});
