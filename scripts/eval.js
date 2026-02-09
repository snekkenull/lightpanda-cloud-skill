#!/usr/bin/env node

import { connect, envInt } from "./cdp.js";

const DEBUG = process.env.DEBUG === "1";
const log = DEBUG ? (...args) => console.error("[debug]", ...args) : () => {};

function argValue(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  return args[i + 1] ?? null;
}

function argInt(args, name, fallback) {
  const raw = argValue(args, name);
  if (raw == null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

const args = process.argv.slice(2);
const gotoUrl = argValue(args, "--goto");
const waitMs = argInt(args, "--wait-ms", 1500);

const codeParts = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--goto") {
    i += 1;
    continue;
  }
  if (a === "--wait-ms") {
    i += 1;
    continue;
  }
  codeParts.push(a);
}
const code = codeParts.join(" ");
if (!code) {
  console.log("Usage: eval.js [--goto <url>] [--wait-ms <n>] 'code'");
  console.log("\nExamples:");
  console.log('  eval.js "document.title"');
  console.log('  eval.js --goto https://example.com "document.title"');
  console.log("  eval.js \"document.querySelectorAll('a').length\"");
  process.exit(1);
}

// Global timeout
const globalTimeoutMs = envInt("CDP_GLOBAL_TIMEOUT_MS", 45000);
const globalTimeout = setTimeout(() => {
  console.error("✗ Global timeout exceeded (45s)");
  process.exit(1);
}, globalTimeoutMs);

try {
  log("connecting...");
  const cdp = await connect(envInt("CDP_TIMEOUT_MS", 5000));

  log("getting pages...");
  const pages = await cdp.getPages();
  const page = pages.at(-1);

  const targetId = page?.targetId
    ? page.targetId
    : (await cdp.send("Target.createTarget", { url: "about:blank" })).targetId;

  log("attaching to page...");
  const sessionId = await cdp.attachToPage(targetId);
  try {
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Page.enable", {}, sessionId);
  } catch {}

  if (gotoUrl) {
    await cdp.navigate(sessionId, gotoUrl, envInt("CDP_NAV_TIMEOUT_MS", 30000));
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
  }

  log("evaluating...");
  const expression = `(async () => { return (${code}); })()`;
  const result = await cdp.evaluate(sessionId, expression);

  log("formatting result...");
  if (Array.isArray(result)) {
    for (let i = 0; i < result.length; i++) {
      if (i > 0) console.log("");
      for (const [key, value] of Object.entries(result[i])) {
        console.log(`${key}: ${value}`);
      }
    }
  } else if (typeof result === "object" && result !== null) {
    for (const [key, value] of Object.entries(result)) {
      console.log(`${key}: ${value}`);
    }
  } else {
    console.log(result);
  }

  log("closing...");
  cdp.close();
  log("done");
} catch (e) {
  console.error("✗", e.message);
  process.exit(1);
} finally {
  clearTimeout(globalTimeout);
  setTimeout(() => process.exit(0), 100);
}
