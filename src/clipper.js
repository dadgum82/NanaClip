'use strict';

const fs   = require('fs');
const path = require('path');
const { chromium }   = require('playwright-extra');
const StealthPlugin  = require('puppeteer-extra-plugin-stealth');

// ─── Configuration ────────────────────────────────────────────────────────────
const HT_URL     = process.env.HT_URL     || 'https://www.harristeeter.com/savings/cl/coupons/';
const CONFIG_DIR = process.env.CONFIG_DIR || '/config';
const AUTH_FILE  = path.join(CONFIG_DIR, 'auth.json');

// Selector for unclipped coupon buttons.  Kroger's KDS design system uses
// data-testid="CouponCard-clip-button" and disables the element after clipping.
// The fallback covers aria-label and plain text variants.
const PRIMARY_SEL  = process.env.CLIP_SELECTOR ||
  'button[data-testid="CouponCard-clip-button"]:not([disabled])';
const FALLBACK_SEL =
  'button[aria-label^="Clip"]:not([aria-label*="Clipped"]):not([disabled])';

const MAX_SCROLL = parseInt(process.env.MAX_SCROLL_ITERATIONS || '60', 10);
const JITTER_MIN = parseInt(process.env.JITTER_MIN || '250', 10);
const JITTER_MAX = parseInt(process.env.JITTER_MAX || '600', 10);
const DRY_RUN    = process.env.DRY_RUN    === 'true';
const MAX_CLIPS  = process.env.MAX_CLIPS  ? parseInt(process.env.MAX_CLIPS, 10) : Infinity;

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ─── Logging ──────────────────────────────────────────────────────────────────
function ts() {
  return new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}
function nana(msg) { console.log(`[${ts()}] ${msg}`); }

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function jitter(min = JITTER_MIN, max = JITTER_MAX) {
  await new Promise(r => setTimeout(r, min + Math.floor(Math.random() * (max - min))));
}

// Pull a short readable label from the coupon card surrounding the button.
async function extractLabel(btn) {
  try {
    return await btn.evaluate(el => {
      const card = el.closest(
        '[data-testid*="CouponCard"], [data-testid*="coupon"], article, ' +
        '[class*="CouponCard"], [class*="coupon-card"]'
      );
      if (!card) return null;
      const title = card.querySelector(
        '[data-testid*="title"], [data-testid*="Title"], ' +
        '[class*="Title"], [class*="title"], h3, h4, p'
      );
      const raw = title
        ? title.textContent
        : card.textContent.replace(/clip(?:\s*it)?/gi, '');
      return raw.replace(/\s+/g, ' ').trim().slice(0, 70) || null;
    });
  } catch {
    return null;
  }
}

// ─── Infinite scroll until coupon list is fully loaded ────────────────────────
async function scrollUntilStable(page) {
  nana("Scrolling through the circular — Nana doesn't miss a thing...");

  // Broad selector to count any coupon card presence (clipped or not)
  const anyCard =
    '[data-testid*="CouponCard"], [data-testid*="coupon-card"], ' +
    '[class*="CouponCard"], article:has(button)';

  let stable = 0;
  for (let i = 0; i < MAX_SCROLL; i++) {
    const before = await page.locator(anyCard).count();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await jitter(1200, 1600);
    const after = await page.locator(anyCard).count();
    if (after === before) {
      if (++stable >= 2) break;
    } else {
      stable = 0;
    }
  }

  const total = await page.locator(anyCard).count();
  nana(`Finished scrolling. Found ${total} coupons on the shelf today!`);
  return total;
}

// ─── Resolve which selector actually has buttons on this page ─────────────────
async function resolveSelector(page) {
  if (await page.locator(PRIMARY_SEL).count() > 0) return PRIMARY_SEL;
  if (await page.locator(FALLBACK_SEL).count() > 0) return FALLBACK_SEL;
  // Last-resort: any visible, enabled button whose accessible name is exactly "Clip"
  const byRole = page.getByRole('button', { name: /^clip$/i });
  if (await byRole.locator(':not([disabled])').count() > 0) return null; // signal: use byRole
  return null;
}

// ─── Clip every available coupon ──────────────────────────────────────────────
async function clipAllCoupons(page) {
  if (DRY_RUN) nana('(Dry-run mode — window shopping only, no actual clipping!)');

  const sel = await resolveSelector(page);

  function getButtons() {
    return sel
      ? page.locator(sel)
      : page.getByRole('button', { name: /^clip$/i }).locator(':not([disabled])');
  }

  let clipped = 0, skipped = 0;
  // Safety cap: stop after 2× MAX_CLIPS attempts to avoid infinite loops
  const maxAttempts = MAX_CLIPS === Infinity ? 500 : MAX_CLIPS * 2;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const buttons = getButtons();
    if (await buttons.count() === 0) break;
    if (clipped >= MAX_CLIPS) break;

    const btn = buttons.first();

    try {
      await btn.scrollIntoViewIfNeeded({ timeout: 5000 });
      await jitter(JITTER_MIN, JITTER_MAX);

      // ~1-in-8 coupons: pause as if reading the fine print
      if (Math.random() < 0.125) {
        nana('Hmm, let me read the fine print on this one...');
        await jitter(1000, 3000);
      }

      const label = (await extractLabel(btn)) ?? 'something good';

      if (!DRY_RUN) {
        await btn.hover({ timeout: 5000 });
        await jitter(50, 150);
        await btn.click({ timeout: 5000 });
        // Give the clip API call time to land before re-querying
        await jitter(300, 600);
      }

      nana(`Well look at that, ${label}! Into the purse it goes.`);
      clipped++;

    } catch {
      nana("Hmm, that one's being stubborn. Leaving it for next week.");
      // Disable in-DOM so the selector skips it next iteration
      try { await btn.evaluate(el => { el.disabled = true; }); } catch { /* detached */ }
      skipped++;
    }
  }

  return { clipped, skipped };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  nana("Good morning, deary! Nana's putting on her reading glasses...");

  // Auth state
  if (!fs.existsSync(AUTH_FILE)) {
    nana(`Oh dear, I can't find my shopping passes! Expected: ${AUTH_FILE}`);
    nana('Run the login helper first:  node src/login.js');
    process.exit(1);
  }

  let storageState;
  try {
    storageState = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  } catch {
    nana('My shopping passes got all crumpled — auth.json appears to be corrupt.');
    process.exit(1);
  }
  nana('Loading your shopping passes... found them right in the purse!');

  // Register stealth plugin (all 14 evasion modules active by default)
  chromium.use(StealthPlugin());

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process',      // safer in low-memory containers
    ],
  });

  const context = await browser.newContext({
    storageState,
    viewport:    { width: 1280, height: 800 },
    locale:      'en-US',
    timezoneId:  'America/New_York',
    userAgent:   CHROME_UA,
    extraHTTPHeaders: {
      'Accept':                  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language':         'en-US,en;q=0.9',
      'Sec-Fetch-Dest':          'document',
      'Sec-Fetch-Mode':          'navigate',
      'Sec-Fetch-Site':          'none',
      'Sec-Fetch-User':          '?1',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  const page = await context.newPage();

  try {
    nana("Heading over to Harris Teeter... hope the parking lot isn't too busy.");
    await page.goto(HT_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Detect redirect to login (session expired)
    const url = page.url();
    if (
      url.includes('/signin')  ||
      url.includes('/login')   ||
      url.includes('/auth/')   ||
      url.includes('account/login')
    ) {
      nana('Oh my stars... my reading glasses must need updating, deary!');
      nana("Looks like Harris Teeter sent me to the login page — my passes must have expired.");
      nana('Run the login helper again to refresh them:  node src/login.js');
      await browser.close();
      process.exit(1);
    }

    // Brief settle time for React hydration
    await page.waitForTimeout(2000);

    // Secondary check: confirm coupon content actually rendered
    const hasCoupons = await page
      .locator('[data-testid*="coupon"], [class*="CouponCard"], [class*="coupon"]')
      .count();
    if (hasCoupons === 0) {
      nana("Hmm, I can't seem to find the coupon shelf — the page layout may have changed.");
      nana('Try adjusting the CLIP_SELECTOR env var, or wait for a script update.');
      await browser.close();
      process.exit(1);
    }

    nana("My, my! Let's see what savings are hiding in here...");
    await scrollUntilStable(page);

    nana('Starting to clip! This might take a little while, sweetheart...');
    const { clipped, skipped } = await clipAllCoupons(page);

    const stubborn = skipped > 0 ? ` Left ${skipped} stubborn ones for next week.` : ' Got every last one!';
    nana(`All done, deary! Clipped ${clipped} coupons.${stubborn}`);
    nana("Nana's putting the scissors away. See you next Sunday!");

  } finally {
    await browser.close();
  }

  process.exit(0);
}

main().catch(err => {
  nana(`Oh goodness, something went wrong: ${err.message}`);
  process.exit(1);
});
