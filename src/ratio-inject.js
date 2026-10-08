/**
 * Figma 比例网格 v5
 * ==================
 * 交互：点击「宽」或「高」输入框时，弹出 3×3 比例网格（focus 不触发——
 *       Figma 选中图层会自动聚焦 W 框，focus 触发会导致选中即弹出）；
 *       选比例 / 回车 / Esc / blur / 点击空白 → 网格消失。
 *       W 框 = 保宽调高；H 框 = 保高调宽。
 * 图标：线性描边直角矩形（无圆角，避免扁比例变胶囊/椭圆）。
 * 静默：不加任何图标/提示/toast，应用后无感。
 *
 * 兼容：中和 v3/v4 僵尸注入（旧 observer 无法注销）——
 *   - v3 的按钮：CSS 强制隐藏 + 在输入框 cell 内放假按钮占位（阻止其重插）+ 持续复位 padding
 *   - v4 的 focus 弹出：本版 focus 监听先关闭其菜单（监听器注册在其后，必然后执行）
 *
 * 完全独立于 FigmaEX，通过 CDP (9222) 注入。
 * 锚点：input[aria-label="Width"] / input[aria-label="Height"]（Figma 稳定属性）
 */

(function () {
  'use strict';
  var VERSION = 5;
  if (window.__figmaRatioInjected === VERSION) return; // 幂等

  // ---- 清理历史版本遗留 ----
  document.querySelectorAll('.fexr-menu').forEach(function (el) { el.remove(); });
  document.querySelectorAll('input[aria-label="Width"], input[aria-label="Height"]').forEach(function (inp) {
    inp.style.paddingRight = '';
  });
  window.__figmaRatioInjected = VERSION;

  var PREFIX = 'fexr';
  var LOG = '[FigmaRatio]';

  /* ---------------- 比例预设 ---------------- */
  var RATIOS = [
    { id: '1:1',   w: 1,  h: 1 },
    { id: '4:3',   w: 4,  h: 3 },
    { id: '3:4',   w: 3,  h: 4 },
    { id: '3:2',   w: 3,  h: 2 },
    { id: '2:3',   w: 2,  h: 3 },
    { id: '16:9',  w: 16, h: 9 },
    { id: '9:16',  w: 9,  h: 16 },
    { id: '16:10', w: 16, h: 10 },
    { id: '21:9',  w: 21, h: 9 },
  ];

  /* ---------------- 图标：线性描边直角矩形，统一 22×22 画布 ---------------- */
  function iconSVG(r) {
    var MAX = 18;
    var s = Math.min(MAX / r.w, MAX / r.h);
    var w = Math.max(3, Math.round(r.w * s * 10) / 10);
    var h = Math.max(3, Math.round(r.h * s * 10) / 10);
    var x = ((22 - w) / 2).toFixed(2), y = ((22 - h) / 2).toFixed(2);
    // 直角：不用 rx（圆角在扁比例上会被 clamp 成胶囊/椭圆形态）
    return '<svg width="22" height="22" viewBox="0 0 22 22" style="flex:0 0 auto">'
      + '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="none" stroke="currentColor" stroke-width="1.5"/>'
      + '</svg>';
  }

  /* ---------------- 样式 ---------------- */
  var CSS = ''
    // 僵尸 v3 按钮强制隐藏（其样式表已被 v4 清除，按钮失去定位会挤乱布局）
    + '.fexr-btn, .fexr-btn-w, .fexr-btn-h, .fexr-group{display:none !important;pointer-events:none !important}\n'
    + '.' + PREFIX + '-menu{position:fixed;z-index:100000;display:grid;grid-template-columns:repeat(3,1fr);gap:2px;background:#222;border:1px solid rgba(0,0,0,.1);box-shadow:0 2px 7px rgba(0,0,0,.15),0 5px 17px rgba(0,0,0,.2);border-radius:6px;padding:6px;color:rgba(255,255,255,.8);font-family:Inter,-apple-system,sans-serif}\n'
    + '.' + PREFIX + '-cell{width:52px;padding:7px 0 5px;display:flex;flex-direction:column;align-items:center;gap:3px;border-radius:4px;cursor:default;user-select:none}\n'
    + '.' + PREFIX + '-cell:hover{background:#18a0fb;color:#fff}\n'
    + '.' + PREFIX + '-cell svg{color:rgba(255,255,255,.65);display:block}\n'
    + '.' + PREFIX + '-cell:hover svg{color:#fff}\n'
    + '.' + PREFIX + '-name{font-size:10px;line-height:1;color:rgba(255,255,255,.75)}\n'
    + '.' + PREFIX + '-cell:hover .' + PREFIX + '-name{color:#fff}\n';

  var styleEl = document.createElement('style');
  styleEl.id = PREFIX + '-style-v5';
  styleEl.textContent = CSS;
  (document.head || document.documentElement).appendChild(styleEl);

  /* ---------------- 菜单 ---------------- */
  var menuEl = null;

  function closeMenu() {
    // 移除所有 fexr-menu（含僵尸 v4 弹出的）
    document.querySelectorAll('.' + PREFIX + '-menu').forEach(function (el) { el.remove(); });
    menuEl = null;
    document.removeEventListener('mousedown', onDocMouseDown, true);
    window.removeEventListener('blur', closeMenu);
  }
  function onDocMouseDown(e) {
    if (menuEl && !menuEl.contains(e.target)) closeMenu();
  }

  /** 打开比例网格。anchorInput: 触发的输入框；byHeight: true=以高为基准 */
  function openMenu(anchorInput, byHeight) {
    closeMenu();
    menuEl = document.createElement('div');
    menuEl.className = PREFIX + '-menu';

    RATIOS.forEach(function (r) {
      var cell = document.createElement('div');
      cell.className = PREFIX + '-cell';
      cell.innerHTML = iconSVG(r);
      var name = document.createElement('span');
      name.className = PREFIX + '-name';
      name.textContent = r.id;
      cell.appendChild(name);
      // mousedown 阻断：防止输入框失焦
      cell.addEventListener('mousedown', function (e) {
        e.stopPropagation(); e.preventDefault();
      });
      cell.addEventListener('click', function (e) {
        e.stopPropagation();
        applyRatio(r, byHeight);
        closeMenu();
      });
      menuEl.appendChild(cell);
    });

    document.body.appendChild(menuEl);
    // 定位：输入框正下方、左对齐
    var rect = anchorInput.getBoundingClientRect();
    var mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
    var x = Math.min(rect.left, window.innerWidth - mw - 8);
    var y = rect.bottom + 4;
    if (y + mh > window.innerHeight - 8) y = rect.top - mh - 4;
    menuEl.style.left = x + 'px';
    menuEl.style.top = y + 'px';

    document.addEventListener('mousedown', onDocMouseDown, true);
    window.addEventListener('blur', closeMenu);
  }

  /* ---------------- 应用比例（静默，无提示） ---------------- */
  function getSelectableSelection() {
    try {
      var sel = (window.figma && figma.currentPage && figma.currentPage.selection) || [];
      return sel.filter(function (n) { return typeof n.resizeWithoutConstraints === 'function'; });
    } catch (e) { return []; }
  }

  function applyRatio(r, byHeight) {
    var nodes = getSelectableSelection();
    nodes.forEach(function (n) {
      try {
        if (byHeight) {
          var w = Math.max(1, Math.round(n.height * r.w / r.h));
          n.resizeWithoutConstraints(w, n.height);
        } else {
          var h = Math.max(1, Math.round(n.width * r.h / r.w));
          n.resizeWithoutConstraints(n.width, h);
        }
      } catch (e) { console.warn(LOG, 'resize skipped', e.message); }
    });
  }

  /* ---------------- 输入框挂钩 ---------------- */
  function attachHooks(input, byHeight) {
    if (input.__fexr5Hooked) return;
    input.__fexr5Hooked = true;

    // focus 不弹（Figma 选中图层会自动聚焦 W 框）；
    // 且用于中和僵尸 v4 的 focus 弹出：本监听注册在其后，必然后执行，直接关掉它弹的菜单
    input.addEventListener('focus', function () { closeMenu(); });
    // 点击输入框（含文字）时弹出
    input.addEventListener('click', function () { openMenu(input, byHeight); });
    input.addEventListener('blur', function () { closeMenu(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === 'Escape') closeMenu();
      // 不 stopPropagation：让 Figma 正常处理按键
    });
  }

  /** 在输入框 cell 内植入隐藏假按钮，让僵尸 v3 的幂等检查通过、不再重插真按钮 */
  function plantDummy(input, cls) {
    var cell = input.parentElement;
    if (!cell) return;
    if (cell.querySelector('.' + cls)) return;
    var d = document.createElement('button');
    d.className = 'fexr-btn ' + cls;
    d.setAttribute('aria-hidden', 'true');
    d.tabIndex = -1;
    d.style.cssText = 'display:none !important;pointer-events:none !important;';
    cell.appendChild(d);
  }

  function syncHooks() {
    var w = document.querySelector('input[aria-label="Width"]');
    var h = document.querySelector('input[aria-label="Height"]');
    if (w) {
      attachHooks(w, false);
      plantDummy(w, 'fexr-btn-w');
      w.style.paddingRight = ''; // 持续复位僵尸 v3 设置的 padding
    }
    if (h) {
      attachHooks(h, true);
      plantDummy(h, 'fexr-btn-h');
      h.style.paddingRight = '';
    }
  }

  /* ---------------- 防丢重挂（学 FigmaEX：MutationObserver + 防抖） ---------------- */
  var debounceTimer = null;
  function scheduleSync() {
    if (debounceTimer) return;
    debounceTimer = setTimeout(function () {
      debounceTimer = null;
      try { syncHooks(); } catch (e) { console.warn(LOG, 'sync error', e); }
    }, 300);
  }

  function startObserver() {
    var obs = new MutationObserver(function () { scheduleSync(); });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    console.log(LOG, 'observer started (v5)');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { startObserver(); syncHooks(); });
  } else {
    startObserver();
    syncHooks();
  }
  console.log(LOG, 'Figma Ratio Grid v5 loaded');
})();
