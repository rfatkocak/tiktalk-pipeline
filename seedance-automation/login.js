// One-shot login script.
//
// Run `npm run login` once, sign into Dreamina in the browser window that
// opens, then press ENTER in the terminal. The session is saved to
// ./browser-data/ and subsequent seedance-runner.js runs pick it up
// automatically — no more manual login during batch generation.

const { chromium } = require('playwright');
const path = require('path');

const USER_DATA_DIR = path.join(__dirname, 'browser-data');
const LOGIN_URL = 'https://dreamina.capcut.com/ai-tool/generate';

async function main() {
  console.log('Dreamina login — tarayıcı açılıyor...');
  console.log('1) Açılan Chrome penceresinde Dreamina hesabınla giriş yap.');
  console.log('2) Giriş tamamlanınca bu terminale dön ve ENTER\'a bas.\n');

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
    viewport: { width: 1400, height: 900 },
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  await new Promise((resolve) => process.stdin.once('data', resolve));

  // Verify login landed — Dreamina exposes a hidden __GTW_LOGIN_STATUS__
  // element with a JSON blob containing __isLogined.
  const loggedIn = await page.evaluate(() => {
    const el = document.querySelector('#__GTW_LOGIN_STATUS__');
    if (!el) return false;
    try {
      return JSON.parse(el.textContent).__isLogined === true;
    } catch {
      return false;
    }
  });

  if (!loggedIn) {
    console.error('\n❌ Login doğrulanamadı — oturum kaydedilemedi.');
    console.error('   Chrome penceresinde giriş yapıldığından emin ol ve tekrar dene.');
    await context.close();
    process.exit(1);
  }

  console.log(`\n✅ Oturum kaydedildi → ${USER_DATA_DIR}`);
  console.log('   Artık seedance-runner.js otomatik bu profili kullanacak.');
  await context.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Login hatası:', err.message);
  process.exit(1);
});
