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

  console.log('Sayfa yüklendi. ENTER bas.');
  await new Promise(resolve => process.stdin.once('data', resolve));

  // Toolbar dropdown'larını bul
  console.log('\n=== TOOLBAR SELECTLERİ ===');
  const selects = await page.$$eval('.lv-select', els => els.map(el => ({
    text: (el.innerText || '').substring(0, 60),
    class: el.className.substring(0, 120),
    rect: {
      top: Math.round(el.getBoundingClientRect().top),
      left: Math.round(el.getBoundingClientRect().left),
      w: Math.round(el.getBoundingClientRect().width),
      h: Math.round(el.getBoundingClientRect().height),
    },
    visible: el.offsetParent !== null,
  })));
  for (const s of selects) console.log(JSON.stringify(s));

  // "YZ Yardımcısı" veya "Yapay" içeren elementler
  console.log('\n=== "YZ" veya "Yapay" İÇEREN ELEMENTLER ===');
  const yzElements = await page.evaluate(() => {
    const results = [];
    const all = document.querySelectorAll('*');
    for (const el of all) {
      const text = el.childNodes.length <= 3 ? (el.innerText || '').trim() : '';
      if (text && (text.includes('YZ') || text.includes('Yapay') || text.includes('Video') || text.includes('Yardımcı'))) {
        if (text.length < 80) {
          results.push({
            tag: el.tagName,
            text,
            class: (typeof el.className === 'string' ? el.className : '').substring(0, 100),
            rect: {
              top: Math.round(el.getBoundingClientRect().top),
              left: Math.round(el.getBoundingClientRect().left),
            },
          });
        }
      }
    }
    return results.slice(0, 20);
  });
  for (const el of yzElements) console.log(JSON.stringify(el));

  // Şimdi dropdown'a tıklayıp açılan menüyü görelim
  console.log('\n=== DROPDOWN TIKLAMA TESTİ ===');
  const toolbar = page.locator('[class*="toolbar-select"]').first();
  const toolbarCount = await toolbar.count();
  console.log('toolbar-select bulundu mu:', toolbarCount > 0);

  if (toolbarCount > 0) {
    const text = await toolbar.innerText();
    console.log('Dropdown text:', text);

    await toolbar.click();
    await page.waitForTimeout(1000);

    // Açılan popup/menüdeki seçenekleri listele
    const popupOptions = await page.evaluate(() => {
      const results = [];
      // Popup elementlerini ara
      const popups = document.querySelectorAll('[class*="popup"], [class*="Popup"], [class*="dropdown"], [class*="Dropdown"], [role="listbox"], [class*="lv-select-popup"]');
      for (const popup of popups) {
        const items = popup.querySelectorAll('[class*="option"], [role="option"], li');
        for (const item of items) {
          results.push({
            text: (item.innerText || '').substring(0, 80),
            class: (typeof item.className === 'string' ? item.className : '').substring(0, 100),
          });
        }
      }
      // Fallback: tüm visible popup-like elementler
      if (results.length === 0) {
        const allDivs = document.querySelectorAll('div[class]');
        for (const div of allDivs) {
          const rect = div.getBoundingClientRect();
          const zIndex = window.getComputedStyle(div).zIndex;
          if (zIndex > 100 && rect.width > 50 && rect.height > 50) {
            results.push({
              text: (div.innerText || '').substring(0, 200),
              class: (div.className || '').substring(0, 100),
              zIndex,
            });
          }
        }
      }
      return results.slice(0, 15);
    });
    console.log('Popup seçenekleri:');
    for (const opt of popupOptions) console.log(JSON.stringify(opt));
  }

  console.log('\nCtrl+C ile kapat.');
}

main().catch(err => console.error('Hata:', err.message));
