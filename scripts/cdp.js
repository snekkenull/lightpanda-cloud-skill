/**
 * Minimal CDP client - no puppeteer, no hangs
 */

import { promises as dns } from "node:dns";

async function getWebSocketImpl() {
  if (typeof globalThis.WebSocket === "function") return globalThis.WebSocket;
  try {
    const mod = await import("ws");
    return mod.default || mod.WebSocket || mod;
  } catch {
    throw new Error(
      "WebSocket is not available in this Node.js runtime. Use Node >= 20 (recommended) or install the 'ws' package."
    );
  }
}

export function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function getCdpWsUrlFromEnv() {
  const raw = (process.env.LIGHTPANDA_CDP_URL || process.env.CDP_WS_URL || "").trim();
  if (!raw) return null;
  return raw;
}

function describeWsEndpoint(raw) {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return "(invalid url)";
  }
}

async function assertDnsResolves(hostname) {
  try {
    await dns.lookup(hostname);
  } catch (e) {
    const code = e?.code || null;
    if (code === "ENOTFOUND") {
      throw new Error(`DNS lookup failed for host '${hostname}' (ENOTFOUND).`);
    }
  }
}

function wsAddListener(ws, event, handler) {
  if (typeof ws.addEventListener === "function") {
    ws.addEventListener(event, handler);
    return () => ws.removeEventListener(event, handler);
  }
  if (typeof ws.on === "function") {
    ws.on(event, handler);
    return () => {};
  }
  return () => {};
}

function toTextPayload(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  return String(data);
}

async function connectWebSocket(wsUrl, timeout) {
  const WebSocketImpl = await getWebSocketImpl();
  return new Promise((resolve, reject) => {
    const ws = new WebSocketImpl(wsUrl);
    const connectTimeout = setTimeout(() => {
      ws.close();
      reject(new Error("WebSocket connect timeout"));
    }, timeout);

    wsAddListener(ws, "open", () => {
      clearTimeout(connectTimeout);
      resolve(new CDP(ws));
    });
    wsAddListener(ws, "error", () => {
      clearTimeout(connectTimeout);
      reject(new Error("WebSocket error"));
    });
  });
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function joinUrl(base, path) {
  const u = new URL(base);
  const normalized = path.startsWith("/") ? path : `/${path}`;
  u.pathname = u.pathname.replace(/\/$/, "") + normalized;
  return u.toString();
}

async function resolveWsFromHttp(httpUrl, timeoutMs) {
  // Try the provided URL first (might already be /json/version)
  try {
    const json = await fetchJsonWithTimeout(httpUrl, timeoutMs);
    if (json?.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
  } catch {
    // fall through
  }

  // Try appending /json/version (common CDP discovery endpoint)
  const versionUrl = joinUrl(httpUrl, "/json/version");
  const json = await fetchJsonWithTimeout(versionUrl, timeoutMs);
  if (json?.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
  throw new Error("Could not resolve webSocketDebuggerUrl from HTTP endpoint.");
}

function guessWsFromHttp(httpUrl) {
  const u = new URL(httpUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  if (u.pathname === "" || u.pathname === "/") u.pathname = "/ws";
  return u.toString();
}

function redactSecrets(text) {
  if (!text) return "";
  return String(text)
    .replace(/(token=)[^&\s]+/gi, "$1***")
    .replace(/(access[_-]?token=)[^&\s]+/gi, "$1***")
    .replace(/(authorization:)\s*\S+/gi, "$1 ***");
}

export async function connect(timeout = 5000) {
  const envWsUrl = getCdpWsUrlFromEnv();
  if (envWsUrl) {
    try {
      let parsed;
      try {
        parsed = new URL(envWsUrl);
      } catch {
        parsed = null;
      }
      if (parsed?.hostname) await assertDnsResolves(parsed.hostname);

      if (envWsUrl.startsWith("ws://") || envWsUrl.startsWith("wss://")) {
        return await connectWebSocket(envWsUrl, timeout);
      }
      if (envWsUrl.startsWith("http://") || envWsUrl.startsWith("https://")) {
        // Common case: user copied an https URL (or base host). Try to convert to ws/wss first.
        try {
          return await connectWebSocket(guessWsFromHttp(envWsUrl), timeout);
        } catch {
          // fall through
        }
        const wsUrl = await resolveWsFromHttp(envWsUrl, timeout);
        return await connectWebSocket(wsUrl, timeout);
      }
      throw new Error(
        "Invalid LIGHTPANDA_CDP_URL/CDP_WS_URL (must start with ws://, wss://, http://, or https://)."
      );
    } catch (e) {
      const endpoint = describeWsEndpoint(envWsUrl);
      const detail = redactSecrets(e?.message || "");
      const suffix = detail ? ` ${detail}` : "";
      throw new Error(
        `Failed to connect to CDP websocket at ${endpoint}. Verify LIGHTPANDA_CDP_URL and your network access.${suffix}`
      );
    }
  }

  // Dev fallback: connect to a locally running Chrome on :9222.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const resp = await fetch("http://localhost:9222/json/version", {
      signal: controller.signal,
    });
    const { webSocketDebuggerUrl } = await resp.json();
    clearTimeout(timeoutId);

    return await connectWebSocket(webSocketDebuggerUrl, timeout);
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === "AbortError") {
      throw new Error(
        "Connection timeout - set LIGHTPANDA_CDP_URL (recommended) or run Chrome with --remote-debugging-port=9222."
      );
    }
    throw e;
  }
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.callbacks = new Map();
    this.sessions = new Map();
    this.eventHandlers = new Map();

    wsAddListener(ws, "message", (eventOrData) => {
      const raw = eventOrData?.data !== undefined ? eventOrData.data : eventOrData;
      const msg = JSON.parse(toTextPayload(raw));
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) {
          reject(new Error(msg.error.message));
        } else {
          resolve(msg.result);
        }
        return;
      }

      if (msg.method) {
        this.emit(msg.method, msg.params || {}, msg.sessionId || null);
      }
    });
  }

  on(method, handler) {
    if (!this.eventHandlers.has(method)) {
      this.eventHandlers.set(method, new Set());
    }
    this.eventHandlers.get(method).add(handler);
    return () => this.off(method, handler);
  }

  off(method, handler) {
    const handlers = this.eventHandlers.get(method);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) {
      this.eventHandlers.delete(method);
    }
  }

  emit(method, params, sessionId) {
    const handlers = this.eventHandlers.get(method);
    if (!handlers || handlers.size === 0) return;
    for (const handler of handlers) {
      try {
        handler(params, sessionId);
      } catch {
        // Ignore handler errors to keep CDP session alive.
      }
    }
  }

  send(method, params = {}, sessionId = null, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const msgId = ++this.id;
      const msg = { id: msgId, method, params };
      if (sessionId) msg.sessionId = sessionId;

      const timeoutId = setTimeout(() => {
        this.callbacks.delete(msgId);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeout);

      this.callbacks.set(msgId, {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timeoutId);
          reject(err);
        },
      });

      this.ws.send(JSON.stringify(msg));
    });
  }

  async getPages() {
    const { targetInfos } = await this.send("Target.getTargets");
    return targetInfos.filter((t) => t.type === "page");
  }

  async attachToPage(targetId) {
    const { sessionId } = await this.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    return sessionId;
  }

  async evaluate(sessionId, expression, timeout = 30000) {
    const result = await this.send(
      "Runtime.evaluate",
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
      },
      sessionId,
      timeout
    );

    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text
      );
    }
    return result.result?.value;
  }

  async navigate(sessionId, url, timeout = 30000) {
    await this.send("Page.navigate", { url }, sessionId, timeout);
  }

  async getFrameTree(sessionId) {
    const { frameTree } = await this.send("Page.getFrameTree", {}, sessionId);
    return frameTree;
  }

  async evaluateInFrame(sessionId, frameId, expression, timeout = 30000) {
    // Create isolated world for the frame
    const { executionContextId } = await this.send(
      "Page.createIsolatedWorld",
      { frameId, worldName: "cdp-eval" },
      sessionId
    );

    const result = await this.send(
      "Runtime.evaluate",
      {
        expression,
        contextId: executionContextId,
        returnByValue: true,
        awaitPromise: true,
      },
      sessionId,
      timeout
    );

    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text
      );
    }
    return result.result?.value;
  }

  close() {
    this.ws.close();
  }
}
