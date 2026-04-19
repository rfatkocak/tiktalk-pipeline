const { chromium } = require('playwright');
const path = require('path');

const USER_DATA_DIR = path.join(__dirname, 'browser-data');
const URL = 'https://dreamina.capcut.com/ai-tool/generate';

async function main() {
  console.log('Tarayıcı açılıyor...');

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1400, height: 900 },
  });

  const page = context.pages()[0] || await context.newPage();

  console.log('Sayfa yükleniyor...');
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Screenshot current state
  await page.screenshot({ path: 'inspect-page.png', fullPage: true });
  console.log('Screenshot alındı: inspect-page.png');

  // Inspect prompt input area
  console.log('\n=== PROMPT INPUT AREA ===');
  const textareas = await page.$$('textarea');
  console.log(`Textarea count: ${textareas.length}`);
  for (const ta of textareas) {
    const attrs = await ta.evaluate(el => ({
      placeholder: el.placeholder,
      className: el.className,
      id: el.id,
    }));
    console.log('Textarea:', JSON.stringify(attrs));
  }

  const contentEditables = await page.$$('[contenteditable="true"]');
  console.log(`ContentEditable count: ${contentEditables.length}`);
  for (const ce of contentEditables) {
    const attrs = await ce.evaluate(el => ({
      className: el.className,
      id: el.id,
      tagName: el.tagName,
      text: el.innerText.substring(0, 100),
    }));
    console.log('ContentEditable:', JSON.stringify(attrs));
  }

  // Look for input fields
  const inputs = await page.$$('input[type="text"], input:not([type])');
  console.log(`Text input count: ${inputs.length}`);
  for (const inp of inputs) {
    const attrs = await inp.evaluate(el => ({
      placeholder: el.placeholder,
      className: el.className,
      id: el.id,
      type: el.type,
    }));
    console.log('Input:', JSON.stringify(attrs));
  }

  // Look for the prompt area by placeholder text
  console.log('\n=== SEARCHING BY PLACEHOLDER/TEXT ===');
  const promptArea = await page.$('[placeholder*="Metin"], [placeholder*="text"], [placeholder*="prompt"], [placeholder*="başla"], [placeholder*="Start"]');
  if (promptArea) {
    const info = await promptArea.evaluate(el => ({
      tagName: el.tagName,
      className: el.className,
      id: el.id,
      placeholder: el.placeholder || el.getAttribute('placeholder'),
    }));
    console.log('Prompt area found:', JSON.stringify(info));
  } else {
    console.log('Prompt area NOT found by placeholder');
  }

  // Look for buttons
  console.log('\n=== BUTTONS ===');
  const buttons = await page.$$('button');
  console.log(`Button count: ${buttons.length}`);
  for (const btn of buttons) {
    const info = await btn.evaluate(el => ({
      text: el.innerText.substring(0, 80),
      className: el.className.substring(0, 100),
      ariaLabel: el.getAttribute('aria-label'),
      disabled: el.disabled,
    }));
    if (info.text || info.ariaLabel) {
      console.log('Button:', JSON.stringify(info));
    }
  }

  // Look for the generate/send button specifically
  console.log('\n=== GENERATE/SEND BUTTON ===');
  const sendBtn = await page.$('button[class*="send"], button[class*="submit"], button[class*="generate"], button[aria-label*="send"], button[aria-label*="Generate"]');
  if (sendBtn) {
    const info = await sendBtn.evaluate(el => ({
      className: el.className,
      ariaLabel: el.getAttribute('aria-label'),
      innerHTML: el.innerHTML.substring(0, 200),
    }));
    console.log('Send button found:', JSON.stringify(info));
  } else {
    console.log('Send button NOT found by class/aria');
  }

  // Look for download buttons or links
  console.log('\n=== DOWNLOAD ELEMENTS ===');
  const dlElements = await page.$$('[class*="download"], [aria-label*="download"], [class*="Download"], a[download]');
  console.log(`Download elements: ${dlElements.length}`);

  // Look for video elements
  console.log('\n=== VIDEO ELEMENTS ===');
  const videos = await page.$$('video');
  console.log(`Video elements: ${videos.length}`);
  for (const v of videos) {
    const info = await v.evaluate(el => ({
      src: el.src?.substring(0, 100),
      className: el.className,
      poster: el.poster?.substring(0, 100),
    }));
    console.log('Video:', JSON.stringify(info));
  }

  // Dump the bottom input bar structure
  console.log('\n=== BOTTOM BAR STRUCTURE ===');
  const bottomBar = await page.evaluate(() => {
    // Find the input area container - usually at the bottom
    const allDivs = document.querySelectorAll('div[class]');
    const results = [];
    for (const div of allDivs) {
      const rect = div.getBoundingClientRect();
      // Elements near the bottom of the viewport
      if (rect.bottom > window.innerHeight - 150 && rect.height > 30 && rect.height < 200) {
        results.push({
          className: div.className.substring(0, 120),
          rect: { top: Math.round(rect.top), height: Math.round(rect.height) },
          childCount: div.children.length,
          text: div.innerText.substring(0, 100),
        });
      }
    }
    return results.slice(0, 15);
  });
  for (const item of bottomBar) {
    console.log('Bottom div:', JSON.stringify(item));
  }

  console.log('\nTarayıcı açık kalıyor. İncelemen bitti mi? Ctrl+C ile kapat.');
}

main().catch(err => {
  console.error('Hata:', err.message);
});
