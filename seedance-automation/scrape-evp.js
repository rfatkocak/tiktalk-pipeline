// Scrape the English Profile EVP word list (~15.6K entries) by driving
// the live page in a real Chrome session and intercepting the
// /elasticsearch/search responses. Bubble.io encrypts REQUESTS but the
// RESPONSE is plain JSON — we just need to dedupe and trim the fields
// we care about.
//
// Usage:
//   1) cd seedance-automation
//   2) node scrape-evp.js
//   3) Browser opens. Set Display=All + Levels=All in the page filters.
//   4) Press Enter in the terminal — auto-scroll begins.
//   5) Output appended live to data/evp-vocab.json. Stops when no new
//      items appear after ~5 stalled scroll attempts.
//
// A separate browser profile (browser-data-evp) keeps the EVP cookies
// isolated from the Dreamina profile.

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

// CLI: --dict uk|us  (default uk).  EVP UK and US are separate
// dictionaries (~9.5K + ~6K = ~15.6K total). Each ID carries the suffix
// (_UK / _US), so running both into the same output file dedupes
// naturally without colliding.
const DICT = (() => {
  const i = process.argv.indexOf("--dict");
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1].toLowerCase();
  return "uk";
})();
if (!["uk", "us"].includes(DICT)) {
  console.error(`unknown --dict "${DICT}" (use uk or us)`);
  process.exit(1);
}

const USER_DATA_DIR = path.join(__dirname, "browser-data-evp");
const OUTPUT_DIR = path.join(__dirname, "data");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "evp-vocab.json");

const PAGE_URL = `https://englishprofile.org/?menu=evp-online&dict=${DICT}`;
const SEARCH_ENDPOINT = "/elasticsearch/search";

// Stop after this many consecutive scroll attempts that don't bring any
// new items. Bumped so a slow network burst can't end the run early.
const STALL_THRESHOLD = 10;
const SCROLL_PAUSE_MS = 2000;
const SAVE_EVERY_N = 250;

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Resume support: load whatever's already saved so re-runs pick up
  // where we left off (the EVP server returns the same items, dedup
  // by id_text discards them).
  const collected = new Map();
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      const prev = JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf8"));
      for (const item of prev) {
        if (item?.id) collected.set(item.id, item);
      }
      console.log(`[resume] loaded ${collected.size} existing entries`);
    } catch (e) {
      console.warn("[resume] could not parse existing file, starting fresh:", e.message);
    }
  }

  const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"],
    viewport: { width: 1400, height: 950 },
  });

  const page = ctx.pages()[0] || (await ctx.newPage());

  let netHits = 0;
  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes(SEARCH_ENDPOINT)) return;
    let body;
    try {
      body = await response.text();
    } catch {
      return;
    }
    let json;
    try {
      json = JSON.parse(body);
    } catch {
      // Possibly gzipped — playwright should decompress; this branch
      // means the response wasn't JSON. Skip.
      return;
    }
    // Hits live in either `response.results` (elasticsearch passthrough)
    // or `hits.hits` (real ES). Walk both paths defensively.
    const hits =
      (Array.isArray(json?.response?.results) && json.response.results) ||
      (Array.isArray(json?.results) && json.results) ||
      (Array.isArray(json?.hits?.hits) && json.hits.hits) ||
      [];
    netHits++;
    let added = 0;
    for (const h of hits) {
      const src = h?._source || h;
      if (!src?.id_text) continue;
      if (collected.has(src.id_text)) continue;
      collected.set(src.id_text, {
        id: src.id_text,
        ref_id: src.refid_text || null,
        word: src.hw_text || null,
        base: src.base_text || null,
        pos: src.pos_text || null,
        cefr: src.cefr_text_text || null,
        definition: src.definition_text || null,
        examples: splitSemicolon(src.learnerexamples_text),
        search_terms: splitSemicolon(src.searchterms_text),
      });
      added++;
    }
    if (added > 0) {
      console.log(`[net #${netHits}] +${added} new (total: ${collected.size})`);
    }
  });

  console.log("Opening EVP...");
  await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });

  console.log("");
  console.log("→ In the page: set Display = All, then set Levels = All.");
  console.log("→ Wait until the list shows entries.");
  console.log("→ Then press Enter here to start auto-scrolling.");
  console.log("");
  await new Promise((resolve) => process.stdin.once("data", resolve));

  let lastSavedCount = collected.size;
  const saveAll = () => {
    const arr = [...collected.values()].sort((a, b) =>
      (a.cefr || "").localeCompare(b.cefr || "") ||
      (a.word || "").localeCompare(b.word || ""),
    );
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(arr, null, 2));
    lastSavedCount = arr.length;
    console.log(`  💾 saved ${arr.length} entries`);
  };

  let stalled = 0;
  let lastCount = collected.size;

  while (stalled < STALL_THRESHOLD) {
    // Triple-trigger scroll. Bubble's repeating-group sometimes only
    // loads more on actual wheel events, sometimes on scrollTop, and
    // Page Down keypress is a third independent trigger.
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      const all = document.querySelectorAll("*");
      for (const el of all) {
        if (el.scrollHeight > el.clientHeight && el.scrollHeight > 1000) {
          el.scrollTop = el.scrollHeight;
        }
      }
    });
    // Mouse wheel on the page body — synthesises a real wheel event
    // that virtualised lists usually subscribe to.
    try {
      await page.mouse.wheel(0, 6000);
    } catch { /* viewport not focused — ignore */ }
    // Keyboard fallback.
    try {
      await page.keyboard.press("End");
    } catch { /* not focused */ }
    await page.waitForTimeout(SCROLL_PAUSE_MS);

    if (collected.size === lastCount) {
      stalled++;
      console.log(`  ⏳ stalled ${stalled}/${STALL_THRESHOLD} (no new items)`);
    } else {
      stalled = 0;
      lastCount = collected.size;
    }

    if (collected.size - lastSavedCount >= SAVE_EVERY_N) {
      saveAll();
    }
  }

  saveAll();
  console.log(`\n✅ Done. ${collected.size} entries → ${OUTPUT_FILE}`);
  console.log("Close the browser window when ready (Ctrl+C exits).");

  // Keep process alive so the browser stays open.
  await new Promise(() => {});
}

function splitSemicolon(s) {
  if (typeof s !== "string") return [];
  return s
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
