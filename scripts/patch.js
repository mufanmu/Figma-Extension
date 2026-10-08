#!/usr/bin/env node
/**
 * Figma 桌面端 app.asar 补丁脚本（零依赖）
 * =========================================
 * 作用：让 Figma 桌面端在启动时保留 --remote-debugging-port=9222，
 *       打开 CDP 调试端口，供 injector 注入增强脚本。
 *
 * 原理：Figma 官方 app.asar 中的 main.js 含一行
 *   process.env.FIGMA_TEST||<X>.app.commandLine.removeSwitch("remote-debugging-port");
 * （每次构建变量名 <X> 不同，如 It）。本脚本把它等长替换为
 *   <X>.app.commandLine.appendSwitch("remote-debugging-port","9222");
 *   + 空格填充（保持文件大小与 asar 头部偏移不变，无需重打包）。
 *
 * 特性：
 *   - 零依赖（纯 Node 内置模块）
 *   - 幂等：已打补丁/已备份则跳过；Figma 更新后重跑即可
 *   - 自动备份为 app.asar.bak（若不存在）
 *
 * 用法：node patch.js [Figma.app 路径]   （默认 /Applications/Figma.app）
 */

'use strict';
const fs = require('fs');
const path = require('path');

const PORT = '9222';

// 匹配任意压缩变量名的原串（It / xX / aB 等）
const NEEDLE_RE = /process\.env\.FIGMA_TEST\|\|([A-Za-z_$][\w$]*)\.app\.commandLine\.removeSwitch\("remote-debugging-port"\);/;

function findAppDir(explicit) {
  const candidates = explicit ? [explicit] : [
    '/Applications/Figma.app',
    '/Applications/Figma + EX.app',
    process.env.HOME + '/Applications/Figma.app',
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'Contents', 'Resources', 'app.asar'))) return c;
  }
  return null;
}

function main() {
  const appDir = findAppDir(process.argv[2]);
  if (!appDir) {
    console.error('[patch] 未找到 Figma.app（可手动指定：node patch.js /path/to/Figma.app）');
    process.exit(1);
  }
  const resDir = path.join(appDir, 'Contents', 'Resources');
  const asarPath = path.join(resDir, 'app.asar');
  const bakPath = asarPath + '.bak';

  const buf = fs.readFileSync(asarPath);
  const text = buf.toString('latin1'); // asar 内容是字节流，latin1 保证 1:1 映射

  const m = text.match(NEEDLE_RE);
  if (!m) {
    // 已打过补丁？
    if (text.includes(`appendSwitch("remote-debugging-port","${PORT}")`)) {
      console.log('[patch] 已经打过补丁，无需操作 ✓');
      return;
    }
    console.error('[patch] 未找到目标语句——Figma 构建可能已更新，请提 issue 报告 Figma 版本号');
    process.exit(2);
  }

  const origStr = m[0];
  const varName = m[1];
  const repl = `${varName}.app.commandLine.appendSwitch("remote-debugging-port","${PORT}");`;
  if (repl.length > origStr.length) {
    // 理论上不会发生（替换串必短），保险起见报错退出
    console.error('[patch] 内部错误：替换串长于原串');
    process.exit(3);
  }
  const padded = repl + ' '.repeat(origStr.length - repl.length);

  // 备份
  if (!fs.existsSync(bakPath)) {
    fs.copyFileSync(asarPath, bakPath);
    console.log('[patch] 已备份 →', bakPath);
  } else {
    console.log('[patch] 备份已存在，保留原备份');
  }

  // 等长原地替换
  const offset = text.indexOf(origStr);
  const out = Buffer.from(text.replace(origStr, padded), 'latin1');
  if (out.length !== buf.length) {
    console.error('[patch] 内部错误：大小变化（不应发生）');
    process.exit(4);
  }
  fs.writeFileSync(asarPath, out);
  console.log(`[patch] 完成 ✓ 偏移 ${offset}，等长替换 ${origStr.length} 字节`);
  console.log('[patch] 请完全退出 Figma（⌘Q）后重新打开生效');
}

main();
