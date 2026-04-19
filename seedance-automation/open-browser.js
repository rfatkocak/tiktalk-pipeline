const { chromium } = require('playwright');
const path = require('path');

const USER_DATA_DIR = path.join(__dirname, 'browser-data');

async function main() {
  console.log('Tarayıcı açılıyor (gerçek Chrome modunda)...');
  console.log('1. Giriş yap');
  console.log('2. Seedance sayfasını aç');
  console.log('3. Hazır olunca buraya gelip ENTER bas\n');

  // Use real Chrome with persistent context to keep login session
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://dreamina.capcut.com/ai-tool/generate', { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for user to press Enter
  await new Promise(resolve => {
    process.stdin.once('data', resolve);
  });

  console.log('\nSayfa inceleniyor...\n');

  // Take screenshot
  await page.screenshot({ path: 'current-state.png' });
  console.log('Screenshot: current-state.png');

  // Dump interactive elements
  const structure = await page.evaluate(() => {
    function inspect(el, depth = 0) {
      if (depth > 6) return '';
      const tag = el.tagName?.toLowerCase();
      if (!tag) return '';

      const attrs = [];
      if (el.id) attrs.push(`id="${el.id}"`);
      if (el.className && typeof el.className === 'string') {
        const cls = el.className.substring(0, 80);
        if (cls) attrs.push(`class="${cls}"`);
      }
      if (el.placeholder) attrs.push(`placeholder="${el.placeholder}"`);
      if (el.getAttribute('contenteditable')) attrs.push(`contenteditable="${el.getAttribute('contenteditable')}"`);
      if (el.getAttribute('aria-label')) attrs.push(`aria-label="${el.getAttribute('aria-label')}"`);
      if (el.getAttribute('data-testid')) attrs.push(`data-testid="${el.getAttribute('data-testid')}"`);

      const indent = '  '.repeat(depth);
      let result = '';

      const isInteresting = ['button', 'input', 'textarea', 'video', 'select'].includes(tag) ||
        el.getAttribute('contenteditable') ||
        el.getAttribute('role') === 'button' ||
        el.getAttribute('role') === 'textbox' ||
        el.getAttribute('data-testid') ||
        (attrs.length > 0 && el.children.length < 20);

      if (isInteresting) {
        const text = el.innerText?.substring(0, 60)?.replace(/\n/g, ' ') || '';
        result += `${indent}<${tag} ${attrs.join(' ')}>${text ? ` "${text}"` : ''}\n`;
      }

      for (const child of el.children) {
        result += inspect(child, depth + (isInteresting ? 1 : 0));
      }

      return result;
    }
    return inspect(document.body);
  });

  console.log('=== PAGE STRUCTURE ===');
  console.log(structure);

  // Bottom interactive elements (prompt area)
  console.log('\n=== BOTTOM INTERACTIVE ELEMENTS ===');
  const bottomElements = await page.evaluate(() => {
    const vh = window.innerHeight;
    const results = [];
    const all = document.querySelectorAll('textarea, input, [contenteditable="true"], button, [role="textbox"], [role="button"]');
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      if (rect.top > vh - 250) {
        results.push({
          tag: el.tagName,
          class: (el.className || '').substring(0, 100),
          placeholder: el.placeholder || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          role: el.getAttribute('role') || '',
          dataTestId: el.getAttribute('data-testid') || '',
          text: (el.innerText || '').substring(0, 80),
          rect: { top: Math.round(rect.top), left: Math.round(rect.left), w: Math.round(rect.width), h: Math.round(rect.height) },
        });
      }
    }
    return results;
  });
  for (const el of bottomElements) {
    console.log(JSON.stringify(el));
  }

  console.log('\nBitti! Ctrl+C ile kapat.');
}

main().catch(err => console.error('Hata:', err.message));
