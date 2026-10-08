#!/usr/bin/env node
/**
 * 一键安装（macOS）
 * ================
 * 1. patch：给 Figma.app 打调试端口补丁（等长二进制替换，自动备份）
 * 2. 常驻注入：安装 LaunchAgent，开机自动给所有 Figma 页面注入增强脚本
 *
 * 用法：node scripts/install.js
 * 卸载：node scripts/uninstall.js
 */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const LABEL = 'com.figmaratio.injector';
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', LABEL + '.plist');
const LOG = path.join(os.homedir(), 'Library', 'Logs', 'figma-ratio.log');

function run(cmd) { return execSync(cmd, { encoding: 'utf8' }).trim(); }

function main() {
  // 1. patch
  console.log('== 第 1 步：patch Figma.app ==');
  try {
    execSync(`"${NODE}" "${path.join(ROOT, 'scripts', 'patch.js')}"`, { stdio: 'inherit' });
  } catch (e) {
    console.error('\n[install] patch 失败，中止安装。Figma 功能不受影响（未做任何修改）。');
    process.exit(1);
  }

  // 2. LaunchAgent
  console.log('\n== 第 2 步：安装常驻注入 (LaunchAgent) ==');
  const injectJs = path.join(ROOT, 'scripts', 'inject.js');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>${injectJs}</string>
    <string>--watch</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG}</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
</dict>
</plist>
`;
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.writeFileSync(PLIST, plist);
  run(`launchctl bootout gui/$(id -u) "${PLIST}" 2>/dev/null || true`);
  run(`launchctl bootstrap gui/$(id -u) "${PLIST}"`);
  console.log('[install] LaunchAgent 已启动 ✓');
  console.log('[install] 日志:', LOG);

  // 3. 立即注入当前打开的 Figma
  console.log('\n== 第 3 步：注入当前已打开的 Figma 页面 ==');
  try {
    execSync(`"${NODE}" "${injectJs}"`, { stdio: 'inherit' });
  } catch (e) { /* Figma 可能未开 */ }

  console.log('\n完成 🎉  打开 Figma，点击任意图层的「宽」或「高」输入框试试。');
  console.log('（若刚 patch 过，需完全退出 Figma ⌘Q 再重开，端口才生效）');
}

main();
