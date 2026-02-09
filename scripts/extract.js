#!/usr/bin/env node

import { connect, envInt } from "./cdp.js";

function usage() {
  console.log(`Usage:
  node scripts/extract.js [options]

Options:
  --title            Include title only
  --url              Include url only
  --text             Include text content
  --links            Include links
  --a11y             Include accessibility tree (compact)
  --goto <url>       Navigate before extracting
  --wait-ms <n>      Wait after navigation (default: 1500)
  --selector <css>   Extract text from a specific element
  --max-links <n>    Limit links (default: 50)
  --max-chars <n>    Limit text length (default: 5000)
  --max-a11y-nodes <n> Limit a11y nodes (default: 500)
  --pretty           Pretty-print JSON
  -h, --help         Show help

Behavior:
  - If any of --title/--url/--text/--links/--a11y are provided, only those fields are returned.
  - Otherwise returns: title, url, text, links.
`);
}

function argValue(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  return args[i + 1] ?? null;
}

function argInt(args, name, fallback) {
  const raw = argValue(args, name);
  if (raw == null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  usage();
  process.exit(0);
}

const requested = new Set();
for (const key of ["title", "url", "text", "links", "a11y"]) {
  if (args.includes(`--${key}`)) requested.add(key);
}
if (requested.size === 0) {
  requested.add("title");
  requested.add("url");
  requested.add("text");
  requested.add("links");
}

const selector = argValue(args, "--selector");
const gotoUrl = argValue(args, "--goto");
const waitMs = argInt(args, "--wait-ms", 1500);
const maxLinks = argInt(args, "--max-links", 50);
const maxChars = argInt(args, "--max-chars", 5000);
const maxA11yNodes = argInt(args, "--max-a11y-nodes", 500);
const pretty = args.includes("--pretty");

const globalTimeoutMs = envInt("CDP_GLOBAL_TIMEOUT_MS", 60000);
const globalTimeout = setTimeout(() => {
  console.error("✗ Global timeout exceeded");
  process.exit(1);
}, globalTimeoutMs);

const EXTRACT_SCRIPT = `(opts) => {
  const result = {};

  if (opts.includeTitle) result.title = document.title || "";
  if (opts.includeUrl) result.url = location.href || "";

  if (opts.includeLinks) {
    const seen = new Set();
    const links = [];
    const nodes = Array.from(document.querySelectorAll("a[href]"));
    for (const a of nodes) {
      if (links.length >= opts.maxLinks) break;
      const href = a.href || "";
      if (!href) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      const text = (a.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 200);
      links.push({ text: text || null, href });
    }
    result.links = links;
    if (nodes.length > links.length) result.linksTruncated = nodes.length > opts.maxLinks;
  }

  if (opts.includeText) {
    const el = opts.selector ? document.querySelector(opts.selector) : document.body;
    let text = (el && (el.innerText || el.textContent)) ? (el.innerText || el.textContent) : "";
    text = String(text || "");
    text = text.replace(/\\r\\n/g, "\\n");
    text = text
      .split("\\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\\n");
    const truncated = text.length > opts.maxChars;
    if (truncated) text = text.slice(0, opts.maxChars) + "…";
    result.text = text;
    if (opts.selector) result.selector = opts.selector;
    if (truncated) result.textTruncated = true;
  }

  return result;
}`;

try {
  const cdp = await connect(envInt("CDP_TIMEOUT_MS", 5000));
  try {
    const pages = await cdp.getPages();
    const page = pages.at(-1);
    const targetId = page?.targetId
      ? page.targetId
      : (await cdp.send("Target.createTarget", { url: "about:blank" })).targetId;

    const sessionId = await cdp.attachToPage(targetId);
    try {
      await cdp.send("Runtime.enable", {}, sessionId);
      await cdp.send("Page.enable", {}, sessionId);
    } catch {}

    if (gotoUrl) {
      await cdp.navigate(sessionId, gotoUrl, envInt("CDP_NAV_TIMEOUT_MS", 30000));
      if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    }

    const evalOpts = {
      includeTitle: requested.has("title"),
      includeUrl: requested.has("url"),
      includeText: requested.has("text"),
      includeLinks: requested.has("links"),
      selector,
      maxLinks,
      maxChars,
    };

    const expression = `(${EXTRACT_SCRIPT})(${JSON.stringify(evalOpts)})`;
    const result = await cdp.evaluate(sessionId, expression, envInt("CDP_EVAL_TIMEOUT_MS", 30000));

    if (requested.has("a11y")) {
      try {
        const timeout = envInt("CDP_A11Y_TIMEOUT_MS", 30000);
        const { nodes } = await cdp.send("Accessibility.getFullAXTree", {}, sessionId, timeout);
        const simplified = (nodes || []).slice(0, maxA11yNodes).map((n) => ({
          nodeId: n.nodeId,
          parentId: n.parentId ?? null,
          childIds: n.childIds || [],
          ignored: !!n.ignored,
          role: n.role?.value ?? null,
          name: n.name?.value ?? null,
          value: n.value?.value ?? null,
          description: n.description?.value ?? null,
        }));
        result.a11y = simplified;
        result.a11yTotalNodes = (nodes || []).length;
        if ((nodes || []).length > maxA11yNodes) result.a11yTruncated = true;
      } catch (e) {
        throw new Error(
          `Accessibility.getFullAXTree failed. Lightpanda Cloud may not support this CDP domain or it may be restricted. (${e.message})`
        );
      }
    }

    const output = pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result);
    console.log(output);
  } finally {
    // Best-effort close
    try {
      cdp.close();
    } catch {}
  }
} catch (e) {
  console.error("✗", e.message);
  process.exit(1);
} finally {
  clearTimeout(globalTimeout);
}
