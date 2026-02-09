# Lightpanda Cloud Skill for LLM Agents

A skill that teaches agents how to use Lightpanda Cloud (CDP over WebSocket) for data extraction and web automation.

## What is this?

This is a generalist skill for LLM agents (Claude Code, Openclaw, and others) that teaches agents how to use Lightpanda Cloud as a drop-in replacement for running local Chrome/Chromium during web scraping and automation tasks.

## Features

- Hosted browser sessions (no local browser binary)
- Lightweight Node.js CDP scripts (no Playwright/Puppeteer required)
- JavaScript execution support for dynamic sites
- Network/console logging utilities
- `scripts/extract.js` helper for common structured outputs (JSON)

## Installation

Copy this skill to your Claude Code skills directory or reference it in your project.

Set your Lightpanda Cloud CDP URL as an environment variable (from your Cloud dashboard/docs):

```bash
export LIGHTPANDA_CDP_URL="wss://...your-cloud-cdp-url..."
```

See `.env.example` for a template (do not commit real tokens).

Optional sanity check (redacted by default):

```bash
bash install.sh
node scripts/health.js
```

## Usage

See [SKILL.md](SKILL.md) for detailed usage instructions, including:

- Configuring `LIGHTPANDA_CDP_URL`
- Using the lightweight `scripts/*` commands (nav/eval/extract/logging)
- Optional: connecting via Playwright/Puppeteer if you already use them

## License

Apache 2.0

## Credits

[agent-skill](https://github.com/lightpanda-io/agent-skill)
[agent-stuff](https://github.com/mitsuhiko/agent-stuff)