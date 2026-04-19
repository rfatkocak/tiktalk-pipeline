const { chromium } = require('playwright');
const path = require('path');

const USER_DATA_DIR = path.join(__dirname, 'browser-data');

async function main() {
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
    viewport: { width: 1400, height: 900 },
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://dreamina.capcut.com/ai-tool/generate', { waitUntil: 'networkidle', timeout: 60000 });

  console.log('Sayfa yüklendi. Prompt alanına bir şey yaz, sonra ENTER bas.');
  await new Promise(resolve => process.stdin.once('data', resolve));

  // Textarea'ya yaz
  const textarea = page.locator('textarea.prompt-textarea-mYAOkL');
  const taExists = await textarea.count();
  console.log(`Textarea bulundu mu: ${taExists > 0}`);

  if (taExists > 0) {
    await textarea.fill('test prompt for button check');
    await page.waitForTimeout(1500);
  }

  // Tüm primary butonları bul
  console.log('\n=== TÜM PRIMARY BUTONLAR ===');
  const primaryBtns = await page.$$eval('button.lv-btn-primary', btns => btns.map(b => ({
    text: b.innerText.substring(0, 40),
    class: b.className.substring(0, 120),
    disabled: b.disabled,
    hasDisabledClass: b.classList.contains('lv-btn-disabled'),
    visible: b.offsetParent !== null,
    rect: {
      top: Math.round(b.getBoundingClientRect().top),
      left: Math.round(b.getBoundingClientRect().left),
      w: Math.round(b.getBoundingClientRect().width),
      h: Math.round(b.getBoundingClientRect().height),
    },
  })));
  for (const btn of primaryBtns) {
    console.log(JSON.stringify(btn));
  }

  // Circle butonları
  console.log('\n=== CIRCLE BUTONLAR ===');
  const circleBtns = await page.$$eval('button.lv-btn-shape-circle', btns => btns.map(b => ({
    text: b.innerText.substring(0, 40),
    class: b.className.substring(0, 120),
    hasDisabledClass: b.classList.contains('lv-btn-disabled'),
    visible: b.offsetParent !== null,
    rect: {
      top: Math.round(b.getBoundingClientRect().top),
      left: Math.round(b.getBoundingClientRect().left),
      w: Math.round(b.getBoundingClientRect().width),
      h: Math.round(b.getBoundingClientRect().height),
    },
  })));
  for (const btn of circleBtns) {
    console.log(JSON.stringify(btn));
  }

  // Screenshot al
  await page.screenshot({ path: 'debug-btn-state.png' });
  console.log('\nScreenshot: debug-btn-state.png');

  console.log('\nCtrl+C ile kapat.');
}

main().catch(err => console.error('Hata:', err.message));
