const { chromium } = require('playwright');
const path = require('path');

const USER_DATA_DIR = path.join(__dirname, 'browser-data');

async function main() {
  console.log('Tarayıcı açılıyor...');

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://dreamina.capcut.com/ai-tool/generate', { waitUntil: 'networkidle', timeout: 60000 });

  console.log('Sayfa yüklendi. Giriş yapılmışsa ENTER bas.');
  await new Promise(resolve => process.stdin.once('data', resolve));

  console.log('\n=== VIDEO CARD STRUCTURE (first card) ===');
  const cardStructure = await page.evaluate(() => {
    // Find video cards / result items in the feed
    function getStructure(el, depth = 0) {
      if (depth > 8) return '';
      const tag = el.tagName?.toLowerCase();
      if (!tag || ['script', 'style', 'svg', 'path'].includes(tag)) return '';

      const indent = '  '.repeat(depth);
      const attrs = [];
      if (el.className && typeof el.className === 'string') {
        const cls = el.className.substring(0, 100);
        if (cls) attrs.push(`class="${cls}"`);
      }
      if (el.getAttribute('role')) attrs.push(`role="${el.getAttribute('role')}"`);
      if (el.getAttribute('data-testid')) attrs.push(`data-testid="${el.getAttribute('data-testid')}"`);
      if (el.getAttribute('aria-label')) attrs.push(`aria-label="${el.getAttribute('aria-label')}"`);
      if (tag === 'video') attrs.push(`src="${(el.src || '').substring(0, 80)}"`);
      if (tag === 'img') attrs.push(`src="${(el.src || '').substring(0, 80)}"`);
      if (tag === 'a') attrs.push(`href="${(el.href || '').substring(0, 80)}"`);

      const text = el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
        ? el.childNodes[0].textContent.substring(0, 60)
        : '';

      let result = `${indent}<${tag} ${attrs.join(' ')}>${text ? ` "${text}"` : ''}\n`;

      for (const child of el.children) {
        result += getStructure(child, depth + 1);
      }
      return result;
    }

    // Find the content area with generated results
    const contentArea = document.querySelector('.content-Yv4RsO') ||
                        document.querySelector('#dreamina-ui-configuration-content-wrapper');
    if (!contentArea) return 'Content area not found';

    // Get first few card-like elements
    const cards = contentArea.querySelectorAll('[class*="card"], [class*="Card"], [class*="item"], [class*="Item"], [class*="result"], [class*="Result"]');
    let result = `Found ${cards.length} card-like elements\n\n`;

    // Just dump the first level children of content area
    result += 'Content area children:\n';
    for (let i = 0; i < Math.min(contentArea.children.length, 5); i++) {
      result += getStructure(contentArea.children[i], 0);
      result += '---\n';
    }

    return result;
  });
  console.log(cardStructure);

  // Find download-related elements
  console.log('\n=== DOWNLOAD / ACTION BUTTONS ON CARDS ===');
  const actionBtns = await page.evaluate(() => {
    const results = [];
    // Look for buttons with download-like text or icons
    const btns = document.querySelectorAll('button, [role="button"]');
    for (const btn of btns) {
      const text = (btn.innerText || '').trim();
      const cls = (btn.className || '').toLowerCase();
      const ariaLabel = btn.getAttribute('aria-label') || '';
      if (text.includes('İndir') || text.includes('Download') || text.includes('download') ||
          text.includes('İnce') || text.includes('Yeniden') || text.includes('düzenle') ||
          cls.includes('download') || ariaLabel.includes('download')) {
        results.push({
          text: text.substring(0, 60),
          class: btn.className.substring(0, 100),
          ariaLabel,
        });
      }
    }
    return results;
  });
  console.log('Action buttons:', JSON.stringify(actionBtns, null, 2));

  // Find "İnce düzenle" and "Yeniden oluştur" buttons
  console.log('\n=== CARD ACTION BUTTONS (text search) ===');
  const cardActions = await page.evaluate(() => {
    const results = [];
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      const text = el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
        ? el.childNodes[0].textContent.trim() : '';
      if (['İnce düzenle', 'Yeniden oluştur', 'Daha fazla bilgi', 'Geri bildirimde bulun'].includes(text)) {
        results.push({
          tag: el.tagName,
          text,
          class: (el.className || '').substring(0, 100),
          parentClass: (el.parentElement?.className || '').substring(0, 100),
        });
      }
    }
    return results.slice(0, 10);
  });
  console.log(JSON.stringify(cardActions, null, 2));

  // Check for "..." menu or three-dot menu
  console.log('\n=== THREE-DOT / MORE MENU ===');
  const moreMenus = await page.evaluate(() => {
    const results = [];
    const btns = document.querySelectorAll('button, [role="button"]');
    for (const btn of btns) {
      const text = (btn.innerText || '').trim();
      if (text === '···' || text === '...' || text === '⋯' ||
          btn.getAttribute('aria-label')?.includes('more') ||
          btn.className.includes('more')) {
        results.push({
          text: text.substring(0, 20),
          class: btn.className.substring(0, 100),
          ariaLabel: btn.getAttribute('aria-label'),
          rect: btn.getBoundingClientRect(),
        });
      }
    }
    return results.slice(0, 5);
  });
  console.log(JSON.stringify(moreMenus, null, 2));

  console.log('\nBitti! Ctrl+C ile kapat.');
}

main().catch(err => console.error('Hata:', err.message));
