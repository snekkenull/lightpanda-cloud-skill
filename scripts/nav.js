#!/usr/bin/env node

import { connect, envInt } from "./cdp.js";

const DEBUG = process.env.DEBUG === "1";
const log = DEBUG ? (...args) => console.error("[debug]", ...args) : () => {};

const url = process.argv[2];
const newTab = process.argv[3] === "--new";

if (!url) {
  console.log("Usage: nav.js <url> [--new]");
  console.log("\nExamples:");
  console.log("  nav.js https://example.com       # Navigate current tab");
  console.log("  nav.js https://example.com --new # Open in new tab");
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
  let targetId;

  if (newTab) {
    log("creating new tab...");
    const { targetId: newTargetId } = await cdp.send("Target.createTarget", {
      url: "about:blank",
    });
    targetId = newTargetId;
  } else {
    const pages = await cdp.getPages();
    const page = pages.at(-1);
    if (page) {
      targetId = page.targetId;
    } else {
      log("no page targets found, creating one...");
      const { targetId: newTargetId } = await cdp.send("Target.createTarget", {
        url: "about:blank",
      });
      targetId = newTargetId;
    }
  }

  log("attaching to page...");
  const sessionId = await cdp.attachToPage(targetId);
  try {
    await cdp.send("Page.enable", {}, sessionId);
  } catch {}

  log("navigating...");
  await cdp.navigate(sessionId, url);

  console.log(newTab ? "✓ Opened:" : "✓ Navigated to:", url);

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
