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

  console.log('Sayfa yüklendi.');
  console.log('1. Bir video üret (elle)');
  console.log('2. "Hayal ediliyor" göründüğünde ENTER bas\n');
  await new Promise(resolve => process.stdin.once('data', resolve));

  // Hayal ediliyor yazısını ve progress elementlerini bul
  console.log('=== "Hayal" İÇEREN ELEMENTLER ===');
  const hayalElements = await page.evaluate(() => {
    const results = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent.trim();
      if (text.includes('Hayal') || text.includes('hayal') || text.includes('%')) {
        const parent = walker.currentNode.parentElement;
        results.push({
          text: text.substring(0, 100),
          tag: parent?.tagName,
          class: (parent?.className || '').substring(0, 120),
          parentClass: (parent?.parentElement?.className || '').substring(0, 120),
          grandParentClass: (parent?.parentElement?.parentElement?.className || '').substring(0, 120),
        });
      }
    }
    return results;
  });
  for (const el of hayalElements) {
    console.log(JSON.stringify(el));
  }

  // Progress bar / indicator elementleri
  console.log('\n=== PROGRESS / LOADING ELEMENTLER ===');
  const progressElements = await page.evaluate(() => {
    const selectors = [
      '[class*="progress"]', '[class*="Progress"]',
      '[class*="loading"]', '[class*="Loading"]',
      '[class*="generating"]', '[class*="Generating"]',
      '[class*="status"]', '[class*="Status"]',
      '[class*="task-indicator"]',
      '[class*="percent"]', '[class*="Percent"]',
    ];
    const results = [];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const text = (el.innerText || '').substring(0, 100);
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          results.push({
            selector: sel,
            text,
            class: (el.className || '').substring(0, 120),
            rect: { top: Math.round(rect.top), left: Math.round(rect.left), w: Math.round(rect.width), h: Math.round(rect.height) },
          });
        }
      }
    }
    return results;
  });
  for (const el of progressElements) {
    console.log(JSON.stringify(el));
  }

  // Task indicator detaylı
  console.log('\n=== TASK INDICATOR DETAY ===');
  const taskDetail = await page.evaluate(() => {
    const container = document.querySelector('[class*="task-indicator"]');
    if (!container) return 'task-indicator yok';
    return {
      text: container.innerText.substring(0, 200),
      class: container.className.substring(0, 150),
      html: container.innerHTML.substring(0, 500),
    };
  });
  console.log(JSON.stringify(taskDetail, null, 2));

  // İlk kartın durumu
  console.log('\n=== İLK KART DURUMU ===');
  const firstCard = await page.evaluate(() => {
    const card = document.querySelector('.item-sQ2mIg');
    if (!card) return 'kart yok';
    return {
      text: card.innerText.substring(0, 300),
      classes: card.className,
      hasVideo: !!card.querySelector('video[src]'),
      videoSrc: card.querySelector('video[src]')?.src?.substring(0, 80) || 'yok',
    };
  });
  console.log(JSON.stringify(firstCard, null, 2));

  console.log('\nCtrl+C ile kapat.');
}

main().catch(err => console.error('Hata:', err.message));
