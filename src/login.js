'use strict';

/**
 * NanaClip — One-time interactive login helper.
 *
 * Run this on your Windows/Mac machine (NOT inside Docker):
 *   node src/login.js
 *
 * A headed Chrome window opens. Log in to Harris Teeter normally,
 * complete any 2FA, and wait until you're back on the coupons page.
 * Nana saves your session to auth.json automatically.
 *
 * Then copy auth.json to your Unraid appdata folder:
 *   scp auth.json root@YOUR_UNRAID_IP:/mnt/user/appdata/nanaclip/auth.json
 */

const fs   = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const HT_URL    = process.env.HT_URL    || 'https://www.harristeeter.com/savings/cl/coupons/';
const AUTH_OUT  = process.env.AUTH_OUT  || path.join(process.cwd(), 'auth.json');
const WAIT_MS   = 5 * 60 * 1000; // 5 minutes for the user to log in

function ts() {
  return new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}
function nana(msg) { console.log(`[${ts()}] ${msg}`); }

async function main() {
  nana("Hello, deary! Let's get you signed into Harris Teeter.");
  nana("I'll open the browser — go ahead and log in normally.");
  nana("(Don't forget your 2-step verification code if they ask!)");
  nana('');

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized'],
    slowMo: 0,
  });

  const context = await browser.newContext({ viewport: null });
  const page    = await context.newPage();

  try {
    // Navigate to coupons page — Kroger will redirect to login automatically
    await page.goto(HT_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });

    nana("The store's open! Please sign in — Nana will wait patiently...");
    nana(`(You have up to 5 minutes. Take your time, sweetheart.)`);
    nana('');

    // Wait until we land back on the coupons page after login
    await page.waitForURL(
      url => url.href.includes('/savings/cl/coupons') && !url.href.includes('/signin'),
      { timeout: WAIT_MS }
    );

    // Extra settle time so all session cookies are fully written
    await page.waitForTimeout(2500);

    nana("Wonderful! You're in. Now let me tuck your passes safely away...");

    const state = await context.storageState();
    fs.writeFileSync(AUTH_OUT, JSON.stringify(state, null, 2), 'utf8');

    nana('');
    nana(`Saved your shopping passes to:  ${AUTH_OUT}`);
    nana('');
    nana('Next step — copy auth.json to your Unraid appdata folder:');
    nana('  scp auth.json root@YOUR_UNRAID_IP:/mnt/user/appdata/nanaclip/auth.json');
    nana('');
    nana("Then you're all set, sweetheart! Nana will handle the rest from here.");

  } catch (err) {
    if (err.message?.toLowerCase().includes('timeout')) {
      nana('');
      nana('Oh my, I waited and waited but never heard back from you!');
      nana('Did you get lost in the checkout lane? Run the script again when ready.');
    } else {
      nana(`Something went sideways:  ${err.message}`);
    }
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  nana(`Oh goodness:  ${err.message}`);
  process.exit(1);
});
