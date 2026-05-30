# ─── NanaClip Dockerfile ───────────────────────────────────────────────────────
# Installs only Chromium (not the full Firefox + WebKit suite) to keep the image
# as lean as possible while still using Playwright's tested browser binaries.
#
# Build:   docker build -t nanaclip .
# Run:     docker run --rm -v /mnt/user/appdata/nanaclip:/config nanaclip

FROM node:20-bookworm-slim

WORKDIR /app

# ── Layer 1: npm dependencies (cached until package.json changes) ──────────────
COPY package*.json ./
RUN npm ci --only=production

# ── Layer 2: Chromium binary + system libs (cached until playwright version bumps)
# playwright install --with-deps auto-resolves and installs all required apt
# packages (libatk, libnss, libxss, libgbm, fonts, etc.) for Chromium on Debian.
RUN npx playwright install chromium --with-deps \
    && rm -rf /var/lib/apt/lists/*

# ── Layer 3: Application source (invalidated on every code change) ─────────────
COPY src/ ./src/

# Persistent volume for auth.json (mapped to Unraid appdata)
VOLUME ["/config"]

# Run-once-and-exit — perfect for weekly docker start triggers
ENTRYPOINT ["node", "src/clipper.js"]
