#!/usr/bin/env node
/**
 * CDP 注入器 —— 把增强脚本注入所有已打开的 Figma 设计页
 * =====================================================
 * 连接 Figma 桌面端的调试端口 (127.0.0.1:9222，由 patch.js 或 FigmaEX 开启)，
 * 把 ratio-inject.js 注入到所有 figma.com/design|file|board|slides 页面。
 *
 * 用法：
 *   node inject.js              # 注入所有已打开的 Figma 页面（一次性）
 *   node inject.js --watch      # 常驻模式：轮询发现新页面自动注入（LaunchAgent 用）
 *
 * 零依赖：自带极简 WebSocket 客户端（内置 ws 模块路径探测 + 原生 fallback）。
 */

'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { EventEmitter } = require('events');

const DEBUG_PORT = process.env.FIGMA_DEBUG_PORT || 9222;
const INJECT_FILE = path.join(__dirname, '..', 'src', 'ratio-inject.js');

/* ---------------- 极简 WebSocket 客户端（零依赖） ---------------- */
// Node 22+ 无原生 ws；探测常见安装位置，失败则用内置实现
let WebSocket = null;
const WS_PATHS = [
  'ws',
  path.join(process.env.HOME || '', '.nvm/versions/node', process.version.match(/\d+\.\d+\.\d+/)[0], 'lib/node_modules/ws'),
  '/usr/local/lib/node_modules/ws',
  '/opt/homebrew/lib/node_modules/ws',
];
for (const p of WS_PATHS) {
  try { WebSocket = require(p); break; } catch (e) { /* next */ }
}
if (!WebSocket) WebSocket = require('./mini-ws.js');

/* ---------------- CDP 工具 ---------------- */
function httpGet(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: DEBUG_PORT, path: p, timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function listTargets() {
  return JSON.parse(await httpGet('/json/list'));
}

function evaluateOnPage(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
    let id = 0;
    let done = false;
    const finish = (err, val) => {
      if (done) return;
      done = true;
      try { ws.close(); } catch (e) {}
      err ? reject(err) : resolve(val);
    };
    ws.on('error', (e) => finish(e));
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: ++id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.id) {
        msg.error ? finish(new Error(JSON.stringify(msg.error))) : finish(null, msg.result);
      }
    });
    setTimeout(() => finish(new Error('ws timeout')), 10000);
  });
}

const isFigmaDesignPage = (t) =>
  t.type === 'page' &&
  /figma\.com\/(design|file|proto|board|slides)/.test(t.url || '');

/* ---------------- 注入 ---------------- */
function readCode() {
  return fs.readFileSync(INJECT_FILE, 'utf8');
}

async function injectAll() {
  const code = readCode();
  let targets;
  try {
    targets = await listTargets();
  } catch (e) {
    console.error(`[FigmaRatio] Figma 未运行或调试端口不可达 (${e.message})`);
    console.error('[FigmaRatio] 请确认：1) Figma 桌面端已打开  2) 已运行 scripts/patch.js（或已安装 FigmaEX）');
    return { injected: 0 };
  }
  let injected = 0;
  for (const t of targets) {
    if (!isFigmaDesignPage(t) || !t.webSocketDebuggerUrl) continue;
    try {
      await evaluateOnPage(t.webSocketDebuggerUrl, code);
      console.log('[FigmaRatio] injected ✓', (t.title || t.url || '').slice(0, 50));
      injected++;
    } catch (e) {
      console.error('[FigmaRatio] inject failed:', String(e.message).slice(0, 100));
    }
  }
  return { injected };
}

async function main() {
  const watch = process.argv.includes('--watch');
  if (!watch) {
    const { injected } = await injectAll();
    console.log(`[FigmaRatio] done. injected=${injected}`);
    return;
  }
  // 常驻模式：轮询新页面（LaunchAgent 调用）
  console.log('[FigmaRatio] watch mode started');
  const injectedUrls = new Set();
  while (true) {
    try {
      const targets = await listTargets();
      for (const t of targets) {
        if (isFigmaDesignPage(t) && t.webSocketDebuggerUrl && !injectedUrls.has(t.webSocketDebuggerUrl)) {
          injectedUrls.add(t.webSocketDebuggerUrl);
          try {
            await evaluateOnPage(t.webSocketDebuggerUrl, readCode());
            console.log('[FigmaRatio] injected ✓', (t.title || t.url || '').slice(0, 50));
          } catch (e) {
            console.error('[FigmaRatio] inject failed:', String(e.message).slice(0, 80));
          }
        }
      }
      const live = new Set(targets.filter(isFigmaDesignPage).map((t) => t.webSocketDebuggerUrl));
      for (const u of injectedUrls) if (!live.has(u)) injectedUrls.delete(u);
    } catch (e) {
      // Figma 未运行，静默等待
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

main().catch((e) => { console.error('[FigmaRatio] fatal:', e); process.exit(1); });
