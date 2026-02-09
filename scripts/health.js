#!/usr/bin/env node

import { connect, envInt } from "./cdp.js";

const globalTimeoutMs = envInt("CDP_GLOBAL_TIMEOUT_MS", 10000);
const globalTimeout = setTimeout(() => {
  console.error("✗ Global timeout exceeded");
  process.exit(1);
}, globalTimeoutMs);

try {
  const cdp = await connect(envInt("CDP_TIMEOUT_MS", 5000));
  try {
    const version = await cdp.send("Browser.getVersion");
    console.log(JSON.stringify(version));
  } finally {
    cdp.close();
  }
} catch (e) {
  console.error("✗", e.message);
  process.exit(1);
} finally {
  clearTimeout(globalTimeout);
}

