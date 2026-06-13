# NanaClip 🧵

> *"A wise, sharp-eyed grandmother who doesn't let a single deal slip by."*

NanaClip is a self-hosted, Docker-containerized coupon clipper for **Harris Teeter**. It runs headlessly on an Unraid server once a week, loads every available coupon automatically, and exits — no babysitting required. All terminal output is written in Nana's voice.

---

## How it works

1. **You log in once** — a headed browser opens on your machine, you sign in normally (including any 2FA), and Nana saves your session cookies to `auth.json`.
2. **Every Sunday, Nana wakes up** — Docker starts the container, she loads `auth.json`, scrolls through all 200+ coupons, and clips every unclipped one with human-like pauses so the Akamai firewall doesn't raise an eyebrow.
3. **She exits cleanly** — the container stops, ready to be started again next week.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 20 | Matches repo toolchain; excellent async |
| Browser automation | [playwright-extra](https://github.com/berstend/puppeteer-extra/tree/master/packages/playwright-extra) | Wraps Playwright with plugin support |
| Anti-bot evasion | [puppeteer-extra-plugin-stealth](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth) | 14 Akamai evasion modules — more complete than Python alternatives |
| Container base | `node:20-bookworm-slim` + Chromium | ~650 MB image vs ~1.8 GB for the full Playwright suite |

Harris Teeter runs on Kroger's infrastructure and is protected by **Akamai Bot Manager v2**. The stealth plugin patches `navigator.webdriver`, `chrome.runtime`, WebGL vendor strings, plugin lists, permissions API behavior, and 9 other fingerprint vectors that headless Chrome exposes by default.

---

## File layout

```
NanaClip/
├── .github/
│   └── workflows/
│       └── docker-publish.yml  # CI: builds + pushes to Docker Hub on every push to main
├── src/
│   ├── clipper.js              # Weekly headless runner — lives inside Docker
│   └── login.js                # One-time interactive login — run on your PC
├── .dockerignore
├── Dockerfile
├── docker-compose.yml
├── package.json
└── .env.example
```

---

## Prerequisites

| Where | What |
|---|---|
| Unraid server | Docker installed (comes standard) |
| Your Windows/Mac PC | [Node.js 20+](https://nodejs.org/) |
| Your PC | SSH access to your Unraid server (for copying `auth.json`) |

---

## Setup — Step 1: One-time login (on your PC)

This captures your Harris Teeter session so the Docker container never needs your password.

```bash
# In the NanaClip repo folder on your PC:
npm install
npx playwright install chromium      # downloads a local headed Chrome (~150 MB)
node src/login.js
```

A Chrome window opens and navigates to the Harris Teeter coupons page. **Sign in normally** — enter your email, password, and any 2FA code. Once you land back on the coupons page, Nana saves your session automatically and closes the browser.

You'll see:
```
[08:12:01] Saved your shopping passes to:  /path/to/auth.json
[08:12:01] Copy auth.json to your Unraid appdata folder:
[08:12:01]   scp auth.json root@YOUR_UNRAID_IP:/mnt/user/appdata/nanaclip/auth.json
```

Copy `auth.json` to your Unraid server as instructed. That file is Nana's "purse" — it stays on Unraid and is never committed to git.

> **Session lifespan:** Harris Teeter / Kroger sessions typically last 30–90 days. When `auth.json` expires, Nana will tell you in the logs and exit with code 1. Just re-run `node src/login.js` to refresh it.

---

## Setup — Step 2: Build and deploy on Unraid

The image is published to **Docker Hub** at `dadgum82/nanaclip:latest`. Unraid pulls it directly — no build step needed on the server.

**Automatic builds via GitHub Actions (recommended)**

Every push to `main` triggers `.github/workflows/docker-publish.yml`, which builds a `linux/amd64` image and pushes it to Docker Hub automatically.

Before the first push, add two **Repository secrets** to your GitHub repo (Settings → Secrets and variables → Actions → Secrets tab → New repository secret):

| Secret name | Value |
|---|---|
| `DOCKERHUB_USERNAME` | `dadgum82` |
| `DOCKERHUB_TOKEN` | Docker Hub access token — [hub.docker.com](https://hub.docker.com) → Account Settings → Personal access tokens → Generate new token (Read, Write, Delete) |

> The token is shown only once — copy it immediately before closing the dialog.

**Manual push from Windows (Docker Desktop required)**

```powershell
docker build --platform linux/amd64 -t dadgum82/nanaclip:latest .
docker push dadgum82/nanaclip:latest
```

Run these from PowerShell (not WSL/bash) with [Docker Desktop](https://www.docker.com/products/docker-desktop/) running.

**Deploy on Unraid**

On Unraid, create the appdata folder and pull the image:

```bash
mkdir -p /mnt/user/appdata/nanaclip
docker pull dadgum82/nanaclip:latest
```

Then add the container via the Unraid Docker UI:
- **Repository:** `dadgum82/nanaclip:latest`
- **Extra Parameters:** `--shm-size=256m`
- **Volume:** `/mnt/user/appdata/nanaclip` → `/config`
- **Restart Policy:** `Never` (this is critical — see below)

Or use the included `docker-compose.yml` if you have the Compose Manager plugin installed.

---

## Setup — Step 3: Weekly automation on Unraid

Install the **User Scripts** plugin from Unraid Community Apps, then add a new script:

**Schedule:** `0 8 * * 0` *(Sundays at 8:00 AM)*

**Script:**
```bash
#!/bin/bash
docker pull dadgum82/nanaclip:latest
docker start nanaclip
```

The `docker pull` picks up any image updates automatically each week. Because `restart: "no"` is set in `docker-compose.yml`, the container exits cleanly after each run — `docker start` on a stopped container is safe to call week after week.

---

## Environment variables

All variables have sensible defaults. Override them in `docker-compose.yml` or a `.env` file — no image rebuild needed.

| Variable | Default | Description |
|---|---|---|
| `HT_URL` | `https://www.harristeeter.com/savings/cl/coupons/` | Target page |
| `CLIP_SELECTOR` | `button[data-testid="CouponCard-clip-button"]:not([disabled])` | CSS selector for unclipped coupon buttons |
| `MAX_SCROLL_ITERATIONS` | `60` | Max scroll attempts before assuming all coupons are loaded |
| `JITTER_MIN` | `250` | Minimum ms delay between clips |
| `JITTER_MAX` | `600` | Maximum ms delay between clips |
| `DRY_RUN` | `false` | Set to `true` to discover coupons without clicking |
| `MAX_CLIPS` | *(unlimited)* | Set to `1` for a quick smoke test |
| `CONFIG_DIR` | `/config` | Directory where `auth.json` is read from |

Copy `.env.example` to `.env` to get started.

---

## What Nana says

A typical Sunday morning run looks like this:

```
[08:00:01] Good morning, deary! Nana's putting on her reading glasses...
[08:00:02] Loading your shopping passes... found them right in the purse!
[08:00:07] Heading over to Harris Teeter... hope the parking lot isn't too busy.
[08:00:09] My, my! Let's see what savings are hiding in here...
[08:00:09] Scrolling through the circular — Nana doesn't miss a thing...
[08:01:02] Finished scrolling. Found 247 coupons on the shelf today!
[08:01:02] Starting to clip! This might take a little while, sweetheart...
[08:01:03] Well look at that, $3.00 off Tide Pods! Into the purse it goes.
[08:01:04] Well look at that, Buy 2 Get 1 Free Cheerios! Into the purse it goes.
[08:01:05] Hmm, let me read the fine print on this one...
[08:01:07] Well look at that, $1.50 off Simple Truth Chicken! Into the purse it goes.
            ... (continues ~8 minutes at safe jitter speeds) ...
[08:09:14] All done, deary! Clipped 231 coupons. Left 16 stubborn ones for next week.
[08:09:14] Nana's putting the scissors away. See you next Sunday!
```

Total runtime for a full week's coupons is typically **6–10 minutes**.

---

## Troubleshooting

### "Oh my stars... my reading glasses must need updating"
Nana was redirected to the login page — `auth.json` has expired. Re-run the login helper on your PC:
```bash
node src/login.js
```
Then copy the new `auth.json` to Unraid as before.

### "I can't seem to find the coupon shelf"
Harris Teeter may have updated their page layout. Try setting `DRY_RUN=true` and watching the logs to see if any coupons are detected. If `CLIP_SELECTOR` no longer matches their buttons, inspect the page in your browser's DevTools and update the env var:
```yaml
- CLIP_SELECTOR=button[data-testid="NEW-SELECTOR"]:not([disabled])
```
No Docker rebuild required — just restart the container.

### "Harris Teeter's coupon counter waved me off" / "Found 0 coupons" every week
This means Akamai (Harris Teeter's bot-detection layer) is blocking the coupons
API call itself, even though the page loads normally.

Some background: `clipper.js` uses only 4 of `puppeteer-extra-plugin-stealth`'s
16 evasions (`user-agent-override`, `sourceurl`, `defaultArgs`,
`navigator.webdriver`). This is deliberate — enabling any additional evasion
(e.g. `navigator.plugins`, `navigator.languages`, `chrome.runtime`, etc.)
causes Harris Teeter's page bundle and Akamai's sensor script to throw
`RangeError: Maximum call stack size exceeded`, which leaves the coupon grid
stuck on "Loading" forever (reporting "Found 0 coupons" every time).

With only 4 evasions active, the page itself renders fine, but Akamai may
still reject the `/atlas/v1/savings-coupons/...` request with a `403`. When
that happens, Nana now exits with an error (exit code 1) instead of falsely
reporting "Clipped 0 coupons. Got every last one!"

If you see this:
- It's usually transient — try again later (a fresh `auth.json` from
  `node src/login.js` can also help, since it re-establishes a "real browser"
  session that Akamai trusts more).
- If it persists across multiple days, Akamai/Kroger likely changed their bot
  detection again and the evasion set in `clipper.js` needs re-tuning. This is
  a manual trial-and-error process: try adding back one evasion at a time from
  `StealthPlugin().availableEvasions` and check whether (a) the page still
  renders without the RangeError above, and (b) the coupons API returns `200`.

### Chromium crashes immediately with no output
The container probably ran out of shared memory. Verify `shm_size: "256m"` is set in `docker-compose.yml` (Docker's default is only 64 MB, which Chromium cannot tolerate).

### Testing without clipping
Set `DRY_RUN=true` to scroll and count coupons without clicking anything. Set `MAX_CLIPS=1` to clip exactly one coupon as a smoke test.

### Verifying stealth against bot detection
Run the container pointing at a bot-detection test page to confirm the fingerprint looks human before letting Nana loose on Harris Teeter:

```bash
docker run --rm --shm-size=256m \
  -e HT_URL=https://bot.sannysoft.com \
  -v /mnt/user/appdata/nanaclip:/config \
  dadgum82/nanaclip:latest
```

All checks on `bot.sannysoft.com` should return green.

---

## Important notes

- **`auth.json` contains live session cookies** — treat it like a password. It is listed in `.gitignore` and should never be committed.
- NanaClip clips coupons on your behalf exactly as you would by hand. It does not interact with any private API, bypass paywalls, or affect other users' accounts.
- Session cookies expire naturally. NanaClip does not store your Harris Teeter password anywhere.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
