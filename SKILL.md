---
name: Lightpanda Cloud (CDP)
version: 3.0.0
description: Lightweight Node.js CDP scripts for Lightpanda Cloud (CDP over WebSocket) web automation and extraction without running a local browser binary.
---

# Lightpanda Cloud (CDP)

**Use Lightpanda Cloud instead of running a local Chrome/Chromium when you want hosted, on-demand browser sessions controlled via CDP (Chrome DevTools Protocol).**

This skill’s primary interface is a small set of Node.js scripts that talk to CDP directly (no Playwright/Puppeteer required for common tasks).

## Quickstart

1) Set the Cloud CDP WebSocket URL from your Lightpanda Cloud dashboard/docs:

```bash
export LIGHTPANDA_CDP_URL="wss://...your-cloud-cdp-url..."
```

See `.env.example` for a template (do not commit real tokens).

2) Optional sanity check (redacted by default):

```bash
bash install.sh
node scripts/health.js
```

## Commands

- Navigate:
  - `node scripts/nav.js https://example.com`
  - `node scripts/nav.js https://example.com --new`
- Evaluate JavaScript in the active page (print result):
  - `node scripts/eval.js 'document.title'`
  - `node scripts/eval.js --goto https://example.com 'document.title'`
- Dismiss common cookie banners:
  - `node scripts/dismiss-cookies.js`
  - `node scripts/dismiss-cookies.js --reject`
  - `node scripts/dismiss-cookies.js --url https://example.com`
- Extract common data as JSON (recommended for agents):
  - `node scripts/extract.js`
  - `node scripts/extract.js --goto https://example.com --pretty`
  - `node scripts/extract.js --links`
  - `node scripts/extract.js --text --max-chars 12000`
  - `node scripts/extract.js --a11y --max-a11y-nodes 800 --pretty`
- Background logging (console + errors + network) to `~/.cache/agent-web/logs/...`:
  - `node scripts/watch.js`
  - `node scripts/logs-tail.js --follow`
  - `node scripts/net-summary.js`

## Data extraction patterns

Prefer returning JSON as a single line, so agents can reliably parse it. `scripts/extract.js` is the simplest default:

```bash
node scripts/extract.js
```

## Environment variables

- `LIGHTPANDA_CDP_URL` (required): full `wss://...` Cloud CDP endpoint.
- `CDP_WS_URL` (optional): compatibility alias for `LIGHTPANDA_CDP_URL`.
- `CDP_TIMEOUT_MS` (optional): connect timeout (default `5000`).
- `CDP_GLOBAL_TIMEOUT_MS` (optional): per-command global timeout (defaults vary by script).
- `DEBUG=1` (optional): emit debug logs to stderr.

## Security notes

- Do not hardcode tokens/URLs in source code; use env vars or a secret manager.
- Avoid printing full `LIGHTPANDA_CDP_URL` in logs. `install.sh` redacts by default; use `--print` only when needed.

## Optional: Use with Playwright/Puppeteer

If you already have Playwright/Puppeteer automation, connect via CDP using the same `LIGHTPANDA_CDP_URL`.

Playwright:

```js
import { chromium } from "playwright-core";

const endpointURL = process.env.LIGHTPANDA_CDP_URL;
const browser = await chromium.connectOverCDP({ endpointURL });
```

Puppeteer:

```js
import puppeteer from "puppeteer-core";

const browserWSEndpoint = process.env.LIGHTPANDA_CDP_URL;
const browser = await puppeteer.connect({ browserWSEndpoint });
```
