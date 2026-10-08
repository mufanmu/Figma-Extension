# Figma Ratio Grid

> 🎬 **演示视频**：[点击观看](https://github.com/mufanmu/Figma-Extension/releases/download/v1.0/export-1791464829148.mp4)

给 Figma 桌面端加上「宽高比例快速调整」：点击右侧属性面板的 **宽 / 高** 输入框，弹出 3×3 比例网格（1:1、4:3、16:9 …），点一下即按该比例调整选中图层尺寸——替代「手动输入宽高 → 锁比例 → 拖拽」的工作流。

```
┌─────────┬─────────┬─────────┐
│  □ 1:1  │ ▭ 4:3   │ ▮ 3:4   │
│  ▭ 3:2  │ ▯ 2:3   │ ▬ 16:9  │
│  ▮ 9:16 │ ▭ 16:10 │ ▁ 21:9  │
└─────────┴─────────┴─────────┘
```

**完全独立于任何 Figma 插件/社区工具**——直接注入桌面端，无需在 Figma 里安装任何东西。

## 交互逻辑

| 操作 | 行为 |
|---|---|
| 点击「宽」输入框 | 弹出网格；选比例 → **保持宽度，调整高度** |
| 点击「高」输入框 | 弹出网格；选比例 → **保持高度，调整宽度** |
| 选中图层 | 不弹出（避免打扰正常工作流） |
| 选比例 / Esc / Enter / 点空白 / 切换选中 | 网格消失 |

支持多选批量；文本、矢量、矩形等一切可 resize 的图层均可。

## 安装（macOS）

要求：Node.js ≥ 18（`node -v` 检查）。

```bash
git clone https://github.com/mufanmu/Figma-Extension.git
cd figma-ratio-grid
node scripts/install.js
```

安装脚本会做三件事：

1. **Patch**：给 `/Applications/Figma.app` 打一个 81 字节的补丁，开启本地调试端口（9222）。等长二进制替换、自动备份为 `app.asar.bak`、幂等可重跑。
2. **LaunchAgent**：安装常驻注入服务，开机自动运行，新打开的 Figma 页面自动注入。
3. **立即注入**当前已打开的 Figma 页面。

装完后：**完全退出 Figma（⌘Q）→ 重新打开** → 选中一个图层 → 点击「宽」或「高」输入框。

> 已在用 FigmaEX？EX 依赖同一个调试端口补丁，直接跳过 patch 也能用本工具（install 脚本会自动识别已打过补丁并跳过）。

## 卸载

```bash
node scripts/uninstall.js        # 停掉常驻注入
# （可选）还原 Figma 原始文件：
cp /Applications/Figma.app/Contents/Resources/app.asar.bak \
   /Applications/Figma.app/Contents/Resources/app.asar
```

> 同时使用 FigmaEX 的用户请勿还原 app.asar——EX 依赖同一个补丁。

## Figma 更新后失效？

Figma 更新会覆盖 `app.asar`（补丁丢失），跑一次即可恢复：

```bash
node scripts/patch.js && node scripts/inject.js
```

（常驻服务会自动给之后打开的页面注入，无需其他操作。）

## 自定义比例

编辑 `src/ratio-inject.js` 顶部的 `RATIOS` 数组：

```js
var RATIOS = [
  { id: '1:1',  w: 1,  h: 1 },
  { id: '4:3',  w: 4,  h: 3 },
  // ...增删改任意比例
];
```

改完执行 `node scripts/inject.js` 立即生效。

## 工作原理

```
Figma.app (Electron)
  └─ app.asar ──[patch.js: 81字节等长替换]──> --remote-debugging-port=9222
                                                    │
inject.js --watch (LaunchAgent) ── CDP WebSocket ───┘
  └─ 注入 src/ratio-inject.js 到每个 figma.com/design 页面
       └─ 定位 input[aria-label="Width"/"Height"]（Figma 稳定 aria 属性）
       └─ click 弹出比例网格 → figma API resizeWithoutConstraints()
```

三个组件彼此独立、零 npm 依赖：

- **patch.js** — 对 `app.asar` 做等长二进制替换（原串 81 字节 → 64 字节 + 17 空格填充，文件大小和 asar 头部偏移完全不变，无需解包/重打包）。正则匹配压缩后的变量名，适配不同构建。
- **inject.js** — 通过 CDP (Chrome DevTools Protocol) WebSocket 把功能脚本注入每个 Figma 设计页；自带极简 ws 客户端 fallback（`mini-ws.js`），系统装了 `ws` 模块则优先用。
- **ratio-inject.js** — 页面内运行的功能本体：MutationObserver 防丢重挂、mousedown 阻断防失焦、fixed 定位跟随输入框。

## ⚠️ 注意事项

- **修改 Figma 应用本体**属于非官方用法，与 FigmaEX 等社区工具风险等级相同；仅在本机调试端口（127.0.0.1:9222）开启远程调试，不会暴露到网络。
- 调试端口开启期间，本机其他程序也能通过该端口控制 Figma——介意的话可随时 `uninstall.js` + 还原 app.asar。
- 目前支持 macOS（Figma Desktop 126.x / UI3）；Windows 理论可移植（Electron 路径和 LaunchAgent 换成启动项），欢迎 PR。

## License

MIT
