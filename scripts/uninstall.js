#!/usr/bin/env node
/** 卸载：停掉常驻注入。补丁还原用：node scripts/patch.js --restore（见 README） */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const LABEL = 'com.figmaratio.injector';
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', LABEL + '.plist');

try {
  execSync(`launchctl bootout gui/$(id -u) "${PLIST}" 2>&1`, { stdio: 'ignore' });
  console.log('[uninstall] LaunchAgent 已停止 ✓');
} catch (e) {
  console.log('[uninstall] LaunchAgent 未在运行');
}
try { fs.unlinkSync(PLIST); console.log('[uninstall] 已删除', PLIST); } catch (e) {}

console.log('[uninstall] 还原 Figma 原始 app.asar（可选）：');
console.log('  cp "/Applications/Figma.app/Contents/Resources/app.asar.bak" \\');
console.log('     "/Applications/Figma.app/Contents/Resources/app.asar"');
console.log('[uninstall] 注意：若你同时使用 FigmaEX，请不要还原（EX 依赖同一补丁）');
