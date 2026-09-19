/* ============================================================
 * blockdiag.js — 系统框图编辑器（自动控制原理）
 *   · 教材符号体系：方框（传函）/ 求和点 Σ（圈上标 ±，点击切换）/ 分支点
 *   · 无限画布：滚轮或双指缩放、拖空白或空格平移、触屏单指平移
 *   · 连线：从端口拖出，目标端口吸附高亮；拖到空白处松手可新建元件
 *   · 就地编辑：双击块改传函、双击标签改名；右键（触屏长按）上下文菜单
 *   · 撤销 / 重做、框选与对齐辅助线、输入/输出端子 R(s) / Y(s)
 *   求解内核在 lib/blocksolve.js（纯函数，可单测）
 *
 *   渲染分层：defs + 网格（只改属性）→ #blk-g-static（元件与连线，世界坐标）
 *             → #blk-g-overlay（屏幕坐标：连线预览/吸附环/框选/辅助线）
 *   缩放平移只更新 transform 与 pattern 尺寸，不重建 DOM。
 * ============================================================ */
App.register('blk', (host) => {
  const cv = FX.cvCol;
  const BS = window.BLKSOLVE;

  /* ================= 常量 ================= */
  const BW = 120, BH = 46;                 // 方框尺寸（世界坐标）
  const SR = 20, BR = 5;                   // 求和圈 / 分支点半径
  const SW = 56, SH = 46;                  // 采样开关尺寸
  const ZW = 96, ZH = 46;                  // 零阶保持器尺寸
  const KIND_LABEL = { box: '方框', sum: '求和点', branch: '分支点', sample: '采样开关', zoh: '零阶保持器' };
  const T_MIN = 1e-3, T_MAX = 1e3, T_DEF = 0.1;   // 采样周期约束（秒）
  const HIT_NODE = 8;                      // 节点命中外扩（屏幕像素）
  const HIT_MOUSE = 14, HIT_TOUCH = 22;    // 端口命中半径（屏幕像素）
  const LONG_PRESS = 450;                  // 触屏长按阈值（ms）
  const S_MIN = 0.35, S_MAX = 3;

  /* ================= 状态 ================= */
  let nodes = [], edges = [], seq = 0;
  let view = { s: 1, tx: 0, ty: 0 };
  let selNodes = new Set(), selEdge = -1;
  let tool = 'select';
  let drag = null;                        // {type:'node'|'wire'|'pan'|'box'}
  let wire = null;                        // 连线预览 {from, fromPt, cur, target}
  let guides = [];
  let lastPointerType = 'mouse';
  let liveHint = '';
  const undoStack = [], redoStack = [];
  const MAX_UNDO = 50;
  const stepPlot = { plot: null };
  const pzPlot = { cv: null };
  const pointers = new Map();
  let pinch = null, spaceDown = false, hoverId = 0;
  let ro = null, lpTimer = 0, ctxEl = null, editEl = null;
  let resultTab = 'tf';
  let statusMsg = '', statusUntil = 0, hashTimer = 0;
  let T = T_DEF;                           // 采样周期（秒）：采样开关 / 零阶保持器 / z 域块使用
  // 渲染签名：结构版本 + 当前选择。签名不变就跳过重建，避免
  // ① 框选时每移动一次都重建检查器（会打断输入框焦点）② 无谓的 DOM/KaTeX 开销
  let structVer = 0, inspSig = '', listSig = '', resSig = '';
  const selKey = () => (selEdge >= 0 ? 'e' + selEdge : 'n' + [...selNodes].sort((a, b) => a - b).join(','));

  /* ================= 骨架 ================= */
  host.innerHTML = `
    <div class="module blk-layout">
      <div class="pane blk-side">
        <h3>元件</h3>
        <div id="blk-rtb"></div>
        <div class="blk-btnrow">
          <button class="btn primary" id="blk-add-box">＋ 方框</button>
          <button class="btn" id="blk-add-sum">＋ 求和点</button>
          <button class="btn" id="blk-add-branch">＋ 分支点</button>
        </div>
        <div class="blk-btnrow">
          <button class="btn" id="blk-add-sample">＋ 采样开关</button>
          <button class="btn" id="blk-add-zoh">＋ 零阶保持器</button>
        </div>
        <div class="blk-btnrow">
          <button class="btn" id="blk-demo">载入示例</button>
          <button class="btn" id="blk-clear">清空</button>
          <button class="btn" id="blk-share">分享</button>
          <button class="btn" id="blk-save" title="保存当前框图到模型库">💾 保存</button>
          <button class="btn" id="blk-tosys" title="把合成传函 T(s) 交给系统分析">↗ 系统分析</button>
        </div>
        <div class="row" id="blk-lib" style="flex-wrap:wrap;gap:6px;margin:8px 0"></div>
        <div class="blk-list" id="blk-list"></div>
      </div>

      <div class="pane blk-mainpane">
        <h3>框图</h3>
        <div class="blk-cvwrap" id="blk-cvwrap">
          <svg id="blk-svg" aria-label="系统框图编辑区">
            <defs>
              <pattern id="blk-dots" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="1.4" cy="1.4" r="1.2" fill="var(--cv-grid)"/>
              </pattern>
              <pattern id="blk-dots-fine" width="12" height="12" patternUnits="userSpaceOnUse">
                <circle cx="0.7" cy="0.7" r="0.7" fill="var(--cv-grid)"/>
              </pattern>
            </defs>
            <g id="blk-g-grid">
              <rect id="blk-grid" x="0" y="0" width="600" height="360" fill="url(#blk-dots)"/>
              <rect id="blk-grid-fine" x="0" y="0" width="600" height="360" fill="url(#blk-dots-fine)" style="display:none"/>
            </g>
            <g id="blk-g-static"></g>
            <g id="blk-g-overlay">
              <path id="blk-ov-wire" fill="none" stroke="var(--accent-2)" stroke-width="1.8" stroke-dasharray="5 4" style="display:none"/>
              <circle id="blk-ov-snap" r="9" fill="none" stroke="var(--accent-2)" stroke-width="2" style="display:none"/>
              <circle id="blk-ov-dot" r="2.6" fill="var(--accent-2)" style="display:none"/>
              <rect id="blk-ov-box" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1" rx="2" style="display:none"/>
              <path id="blk-ov-gx" stroke="var(--accent-2)" stroke-width="1" stroke-dasharray="4 4" style="display:none"/>
              <path id="blk-ov-gy" stroke="var(--accent-2)" stroke-width="1" stroke-dasharray="4 4" style="display:none"/>
            </g>
          </svg>
          <div class="blk-cvbar">
            <button class="blk-cvbtn on" data-tool="select" title="选择 / 框选（触屏拖空白为平移）">▣ 选择</button>
            <button class="blk-cvbtn" data-tool="pan" title="平移画布（也可按住空格）">✋ 平移</button>
            <span class="blk-cvsep"></span>
            <button class="blk-cvbtn" id="blk-undo" title="撤销 Ctrl/⌘+Z">↶</button>
            <button class="blk-cvbtn" id="blk-redo" title="重做 Ctrl/⌘+Shift+Z">↷</button>
            <button class="blk-cvbtn" id="blk-fit" title="缩放到适合内容">适应窗口</button>
          </div>
          <div class="blk-zoombar">
            <button class="blk-cvbtn" id="blk-zoom-out" title="缩小">−</button>
            <button class="blk-cvbtn" id="blk-zoom-val" title="重置为 100%">100%</button>
            <button class="blk-cvbtn" id="blk-zoom-in" title="放大">＋</button>
          </div>
          <div class="blk-hintbar" id="blk-hint"></div>
        </div>
        <div class="blk-delrow">
          <button class="btn" id="blk-del">🗑 删除选中</button>
          <span class="blk-tip on" id="blk-status"></span>
          <span class="blk-tip" id="blk-counts"></span>
        </div>
      </div>

      <div class="pane blk-inspector">
        <h3>检查器</h3>
        <div id="blk-insp"></div>
        <h3 style="margin-top:16px">分析结果</h3>
        <div class="blk-tparam" id="blk-tparam" style="display:none">
          <label for="blk-t">采样周期 T</label>
          <input type="number" id="blk-t" step="0.01" min="0.001" max="1000" value="0.1" inputmode="decimal">
          <span>s</span>
          <span class="blk-tparam-warn" id="blk-t-warn"></span>
        </div>
        <div class="blk-tabs" id="blk-tabs"></div>
        <div class="blk-tabbody" id="blk-tabbody"></div>
      </div>
    </div>`;

  const $ = (s) => host.querySelector(s);
  const byId = (s) => document.getElementById('blk' + s);
  const svg = () => $('#blk-svg');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const isTouch = () => lastPointerType !== 'mouse';

  /* ================= 撤销 / 重做 ================= */
  const snapshot = () => JSON.stringify({ nodes, edges, seq });
  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
    syncHistUI();
  }
  function applySnapshot(str) {
    const d = JSON.parse(str);
    nodes = d.nodes; edges = d.edges; seq = d.seq;
    const ids = new Set(nodes.map((n) => n.id));
    selNodes = new Set([...selNodes].filter((id) => ids.has(id)));
    selEdge = -1;
    closeCtx(); endEdit();
    afterChange(true);
  }
  function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); applySnapshot(undoStack.pop()); syncHistUI(); }
  function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); applySnapshot(redoStack.pop()); syncHistUI(); }
  function syncHistUI() {
    const u = $('#blk-undo'), r = $('#blk-redo');
    if (u) u.classList.toggle('blk-off', !undoStack.length);
    if (r) r.classList.toggle('blk-off', !redoStack.length);
  }

  /* ================= 几何与端口 ================= */
  const nodeGeom = (n) => n.kind === 'box' ? { w: BW, h: BH }
    : n.kind === 'sum' ? { w: SR * 2, h: SR * 2 }
    : n.kind === 'sample' ? { w: SW, h: SH }
    : n.kind === 'zoh' ? { w: ZW, h: ZH }
    : { w: BR * 2, h: BR * 2 };
  const nodeById = (id) => nodes.find((n) => n.id === id);
  const outPort = (n) => ({ x: n.x + nodeGeom(n).w / 2 + 5, y: n.y });
  function inSlots(n) {
    if (n.kind === 'sum') {
      return [{ slot: 'left', x: n.x - SR - 5, y: n.y }, { slot: 'up', x: n.x, y: n.y - SR - 5 }, { slot: 'down', x: n.x, y: n.y + SR + 5 }];
    }
    return [{ slot: 'left', x: n.x - nodeGeom(n).w / 2 - 5, y: n.y }];
  }
  // 每条入边分配到最近的空方位；三槽占满则复用左槽
  function assignSlots() {
    const map = new Map();
    for (const nd of nodes) {
      const ins = edges.map((e, i) => ({ e, i })).filter(({ e }) => e.to === nd.id);
      if (!ins.length) continue;
      const slots = inSlots(nd);
      const used = new Set();
      for (const { e, i } of ins) {
        const from = nodeById(e.from);
        const dx = from ? from.x - nd.x : -1;
        const dy = from ? from.y - nd.y : 0;
        // 方位跟着"来向"走：来自左侧 = 正向馈入（用左端口）；来自右侧 = 反馈（从下/上绕回，
        // 否则反馈线会从左边进入、压住 R(s) 端子）
        let order;
        if (dx > 20) order = ['down', 'up', 'left'];
        else if (dx < -20) order = ['left', 'down', 'up'];
        else order = dy < 0 ? ['up', 'left', 'down'] : ['down', 'left', 'up'];
        let pick = null;
        for (const s of order) { const hit = slots.find((x) => x.slot === s); if (hit && !used.has(s)) { pick = hit; break; } }
        if (!pick) pick = slots[0];
        used.add(pick.slot);
        map.set(i, pick);
      }
    }
    return map;
  }
  function edgeLane(i, a) {
    let lane = 0;
    for (let j = 0; j < i; j++) {
      const fa = nodeById(edges[j].from), fb = nodeById(edges[j].to);
      if (fa && fb && fb.x < fa.x + 40 && Math.abs(fa.y - a.y) < 220) lane++;
    }
    return lane;
  }
  // 正交路由：正向走中轴，回绕走下方独立车道
  function routePath(a, b, slot, lane) {
    const end = slot === 'up' ? { x: b.x, y: b.y - 22 } : slot === 'down' ? { x: b.x, y: b.y + 22 } : { x: b.x - 22, y: b.y };
    const pts = [a];
    if (b.x > a.x + 40 && slot === 'left') {
      const mx = (a.x + end.x) / 2;
      pts.push({ x: mx, y: a.y }, { x: mx, y: end.y });
    } else if (b.x > a.x + 40) {
      pts.push({ x: end.x, y: a.y });
    } else {
      const laneY = Math.max(a.y, b.y) + 44 + lane * 20;
      pts.push({ x: a.x + 22, y: a.y }, { x: a.x + 22, y: laneY }, { x: end.x, y: laneY }, { x: end.x, y: end.y });
    }
    pts.push(end, b);
    const uniq = pts.filter((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) > 0.5 || Math.abs(p.y - pts[i - 1].y) > 0.5);
    return { d: uniq.map((p, i) => (i ? 'L' : 'M') + ' ' + round1(p.x) + ' ' + round1(p.y)).join(' '), pts: uniq, mid: midOf(uniq, b) };
  }
  // 徽标放在最长线段的中点：既好点，也不会挤在元件旁
  function midOf(pts, fallback) {
    let bi = 1, bestLen = -1;
    for (let i = 1; i < pts.length; i++) {
      const L = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (L > bestLen) { bestLen = L; bi = i; }
    }
    if (pts.length < 2) return fallback;
    return { x: (pts[bi - 1].x + pts[bi].x) / 2, y: (pts[bi - 1].y + pts[bi].y) / 2 };
  }
  const round1 = (v) => Math.round(v * 10) / 10;
  function arrowOf(pts) {
    const n = pts.length;
    if (n < 2) return '';
    const p2 = pts[n - 1], p1 = pts[n - 2];
    const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const dd = 9, w = 4.5;
    return `${round1(p2.x)},${round1(p2.y)} `
      + `${round1(p2.x - dd * Math.cos(ang) - w * Math.sin(ang))},${round1(p2.y - dd * Math.sin(ang) + w * Math.cos(ang))} `
      + `${round1(p2.x - dd * Math.cos(ang) + w * Math.sin(ang))},${round1(p2.y - dd * Math.sin(ang) - w * Math.cos(ang))}`;
  }
  function edgeGeom(i, slotMap) {
    const e = edges[i];
    const a0 = nodeById(e.from), b0 = nodeById(e.to);
    if (!a0 || !b0) return null;
    const A = outPort(a0), B = slotMap.get(i) || inSlots(b0)[0];
    return routePath(A, B, B.slot, edgeLane(i, A));
  }

  /* ================= 视图变换 ================= */
  const worldToScreen = (p) => ({ x: p.x * view.s + view.tx, y: p.y * view.s + view.ty });
  const screenToWorld = (p) => ({ x: (p.x - view.tx) / view.s, y: (p.y - view.ty) / view.s });
  function svgPoint(e) { const r = svg().getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function zoomAt(px, py, factor) {
    const s2 = Math.min(S_MAX, Math.max(S_MIN, view.s * factor));
    const k = s2 / view.s;
    view.tx = px - (px - view.tx) * k;
    view.ty = py - (py - view.ty) * k;
    view.s = s2;
    syncView();
  }
  function setView(v) { view = { s: Math.min(S_MAX, Math.max(S_MIN, v.s)), tx: v.tx, ty: v.ty }; syncView(); }
  function contentBounds() {
    if (!nodes.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) {
      const g = nodeGeom(n);
      x0 = Math.min(x0, n.x - g.w / 2); x1 = Math.max(x1, n.x + g.w / 2);
      y0 = Math.min(y0, n.y - g.h / 2); y1 = Math.max(y1, n.y + g.h / 2);
    }
    return { x0: x0 - 40, y0: y0 - 40, x1: x1 + 40, y1: y1 + 40 };
  }
  function fitView() {
    const r = svg().getBoundingClientRect();
    const W = r.width || 600, H = r.height || 360;
    const b = contentBounds();
    if (!b) { setView({ s: 1, tx: W / 2, ty: H / 2 }); return; }
    const s = Math.min(Math.max(Math.min(W / (b.x1 - b.x0), H / (b.y1 - b.y0)), S_MIN), 1.3);
    setView({ s, tx: W / 2 - (b.x0 + b.x1) / 2 * s, ty: H / 2 - (b.y0 + b.y1) / 2 * s });
  }
  // 只改属性：不重建 DOM，拖拽/缩放时才能保持顺滑
  function syncView() {
    const zv = $('#blk-zoom-val');
    if (zv) zv.textContent = Math.round(view.s * 100) + '%';
    const r = svg().getBoundingClientRect();
    const W = r.width || 600, H = r.height || 360;
    const tr = `translate(${view.tx} ${view.ty}) scale(${view.s})`;
    const gg = byId('-g-grid'), gc = byId('-g-static');
    if (gg) gg.setAttribute('transform', tr);
    if (gc) gc.setAttribute('transform', tr);
    const base = isTouch() ? 34 : 24;
    const step = base / view.s;
    const p1 = byId('-dots'), p2 = byId('-dots-fine');
    if (p1) setPattern(p1, step, 1.1 / view.s);
    if (p2) setPattern(p2, step / 2, 0.7 / view.s);
    const x0 = -view.tx / view.s, y0 = -view.ty / view.s, w = W / view.s, h = H / view.s;
    const r1 = byId('-grid'), r2 = byId('-grid-fine');
    if (r1) { r1.setAttribute('x', x0); r1.setAttribute('y', y0); r1.setAttribute('width', w); r1.setAttribute('height', h); }
    if (r2) {
      r2.setAttribute('x', x0); r2.setAttribute('y', y0); r2.setAttribute('width', w); r2.setAttribute('height', h);
      r2.style.display = view.s > 1.5 ? '' : 'none';
    }
    updateStatus();
  }
  function setPattern(pat, step, rad) {
    pat.setAttribute('width', step);
    pat.setAttribute('height', step);
    const c = pat.firstElementChild;
    if (!c) return;
    c.setAttribute('cx', step * 0.06);
    c.setAttribute('cy', step * 0.06);
    c.setAttribute('r', Math.max(0.5, Math.min(2.2, rad)));
  }

  /* ================= 渲染：静态层（世界坐标） ================= */
  function renderStatic() {
    const g = byId('-g-static');
    if (!g) return;
    const slotMap = assignSlots();
    const touch = isTouch();
    const lw = touch ? 2.2 : 2;
    const termVar = hasSampled() ? 'z' : 's';    // 端子按域标注 R(z)/Y(z) 或 R(s)/Y(s)
    const parts = [];

    edges.forEach((e, i) => {
      const gm = edgeGeom(i, slotMap);
      if (!gm) return;
      const col = e.sign < 0 ? 'var(--danger)' : 'var(--cv-line4)';
      const on = selEdge === i;
      parts.push(`<path d="${gm.d}" fill="none" stroke="${col}" stroke-width="${on ? lw + 1.2 : lw}" opacity="${on ? 1 : 0.92}" stroke-linejoin="round"${e.sign < 0 ? ' stroke-dasharray="6 4"' : ''}/>`);
      parts.push(`<polygon points="${arrowOf(gm.pts)}" fill="${col}"/>`);
      parts.push(`<g data-badge="${i}" style="cursor:pointer">
        <circle cx="${gm.mid.x}" cy="${gm.mid.y}" r="${touch ? 15 : 12}" fill="transparent"/>
        <circle cx="${gm.mid.x}" cy="${gm.mid.y}" r="9" fill="var(--panel)" stroke="${col}" stroke-width="1.5"/>
        <text x="${gm.mid.x}" y="${gm.mid.y + 3.6}" text-anchor="middle" fill="${col}" font-size="11" font-family="var(--mono)" style="pointer-events:none">${e.sign < 0 ? '−' : '+'}</text>
      </g>`);
    });

    for (const nd of nodes) {
      const on = selNodes.has(nd.id);
      const gm = nodeGeom(nd);
      const x = nd.x - gm.w / 2, y = nd.y - gm.h / 2;
      const stroke = nd.err ? 'var(--danger)' : on ? 'var(--accent-2)' : nd.kind === 'sum' ? 'var(--warn)' : 'var(--accent)';
      const sw = on ? 2.2 : 1.6;
      let body = '';
      if (nd.kind === 'box') {
        body = `<rect x="${x}" y="${y}" width="${gm.w}" height="${gm.h}" rx="8" fill="var(--panel)" stroke="${stroke}" stroke-width="${sw}"/>
          <rect x="${x + 12}" y="${y - 3.5}" width="${gm.w - 24}" height="4" rx="2" fill="${stroke}" opacity="${on ? 1 : 0.75}"/>
          <text x="${nd.x}" y="${nd.y - 1}" text-anchor="middle" fill="var(--text)" font-size="11" font-family="var(--mono)">${esc(clip(nd.name, 12))}</text>
          <text x="${nd.x}" y="${nd.y + 15}" text-anchor="middle" fill="var(--text-dim)" font-size="10" font-family="var(--mono)">${esc(clip(nd.str, 16))}</text>`;
        if (nd.err) body += `<text x="${x + gm.w - 9}" y="${y + 14}" text-anchor="middle" fill="var(--danger)" font-size="12">⚠</text>`;
        // 「已在 z 域」徽标（与 ⚠ 同一行但置于左侧，互不遮挡）
        if (nd.dom === 'z' && !nd.err) {
          body += `<rect x="${x + 3}" y="${y + 4}" width="17" height="13" rx="4" fill="var(--accent-2)" opacity="0.18"/>
            <text x="${x + 11.5}" y="${y + 14}" text-anchor="middle" fill="var(--accent-2)" font-size="10" font-family="var(--mono)">z</text>`;
        }
      } else if (nd.kind === 'sample') {
        // 采样开关：两条短竖线 + 45° 斜线 + 左端小圆点（教材开关符号）
        body = `<path d="M ${nd.x - 13} ${nd.y - 9} V ${nd.y + 9} M ${nd.x + 13} ${nd.y - 9} V ${nd.y + 9}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/>
          <path d="M ${nd.x - 16} ${nd.y + 11} L ${nd.x + 16} ${nd.y - 11}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/>
          <circle cx="${nd.x - 16}" cy="${nd.y + 11}" r="2.6" fill="${stroke}"/>
          <text x="${nd.x}" y="${nd.y + 28}" text-anchor="middle" fill="var(--text-dim)" font-size="10" font-family="var(--mono)">T</text>`;
      } else if (nd.kind === 'zoh') {
        // 零阶保持器：方框内三级阶梯波 + 框下标注
        const step = `M ${nd.x - 26} ${nd.y + 10} H ${nd.x - 11} V ${nd.y - 9} H ${nd.x + 3} V ${nd.y + 10} H ${nd.x + 15} V ${nd.y - 2} H ${nd.x + 26}`;
        body = `<rect x="${x}" y="${y}" width="${gm.w}" height="${gm.h}" rx="8" fill="var(--panel)" stroke="${stroke}" stroke-width="${sw}"/>
          <path d="${step}" fill="none" stroke="var(--warn)" stroke-width="1.8" stroke-linejoin="round"/>
          <text x="${nd.x}" y="${nd.y + 28}" text-anchor="middle" fill="var(--text-dim)" font-size="10" font-family="var(--mono)">ZOH</text>`;
      } else if (nd.kind === 'sum') {
        body = `<circle cx="${nd.x}" cy="${nd.y}" r="${SR}" fill="var(--panel)" stroke="${stroke}" stroke-width="${sw}"/>
          <text x="${nd.x}" y="${nd.y + 6}" text-anchor="middle" fill="var(--warn)" font-size="17" font-family="Georgia,serif">Σ</text>`;
      } else {
        body = `<circle cx="${nd.x}" cy="${nd.y}" r="${BR}" fill="var(--accent)"/>
          <circle cx="${nd.x}" cy="${nd.y}" r="${BR + 4}" fill="none" stroke="var(--accent)" stroke-width="1" opacity="0.35"/>`;
      }
      // 求和圈的入边符号 ±
      if (nd.kind === 'sum') {
        edges.forEach((e, i) => {
          if (e.to !== nd.id) return;
          const sl = slotMap.get(i);
          if (!sl) return;
          const off = sl.slot === 'up' ? { x: 11, y: -13 } : sl.slot === 'down' ? { x: 11, y: 17 } : { x: -7, y: -9 };
          body += `<text x="${sl.x + off.x}" y="${sl.y + off.y}" text-anchor="middle" fill="${e.sign < 0 ? 'var(--danger)' : 'var(--accent-2)'}" font-size="12" font-family="var(--mono)" style="pointer-events:none">${e.sign < 0 ? '−' : '+'}</text>`;
        });
      }
      // 端口
      for (const sl of inSlots(nd)) {
        body += `<circle cx="${sl.x}" cy="${sl.y}" r="${nd.kind === 'sum' ? 4.5 : 5}" fill="var(--panel)" stroke="var(--cv-line4)" stroke-width="2" style="cursor:crosshair"/>`;
      }
      const op = outPort(nd);
      body += `<circle cx="${op.x}" cy="${op.y}" r="5" fill="var(--cv-line4)" style="cursor:crosshair"/>`;
      // R(s) / Y(s) 端子（含采样元件时按 z 域标注）
      if (nd.src) {
        const ix = (nd.kind === 'sum' ? nd.x - SR : x) - 20;
        body += `<g data-term="src" data-term-node="${nd.id}" style="cursor:pointer">
          <path d="M ${ix} ${nd.y} H ${ix + 14}" stroke="var(--accent-2)" stroke-width="1.8"/>
          <polygon points="${ix + 14},${nd.y} ${ix + 7},${nd.y - 4} ${ix + 7},${nd.y + 4}" fill="var(--accent-2)"/>
          <text x="${ix - 3}" y="${nd.y + 4}" text-anchor="end" fill="var(--accent-2)" font-size="10" font-family="var(--mono)">R(${termVar})</text></g>`;
      }
      if (nd.out) {
        body += `<g data-term="out" data-term-node="${nd.id}" style="cursor:pointer">
          <path d="M ${op.x} ${op.y} H ${op.x + 17}" stroke="var(--accent)" stroke-width="1.8"/>
          <polygon points="${op.x + 17},${op.y} ${op.x + 10},${op.y - 4} ${op.x + 10},${op.y + 4}" fill="var(--accent)"/>
          <text x="${op.x + 21}" y="${op.y + 4}" fill="var(--accent)" font-size="10" font-family="var(--mono)">Y(${termVar})</text></g>`;
      }
      parts.push(`<g>${body}</g>`);
    }
    g.innerHTML = parts.join('');
  }

  /* ================= 渲染：覆盖层（屏幕坐标，只改属性） ================= */
  function setOv(id, attrs, visible) {
    const el = byId(id);
    if (!el) return;
    if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
    el.style.display = visible ? '' : 'none';
  }
  function renderOverlay() {
    const r = svg().getBoundingClientRect();
    const W = r.width || 600, H = r.height || 360;
    if (wire) {
      const a = worldToScreen(wire.fromPt);
      setOv('-ov-wire', { d: `M ${round1(a.x)} ${round1(a.y)} L ${round1(wire.cur.x)} ${round1(wire.cur.y)}` }, true);
      setOv('-ov-dot', { cx: round1(wire.cur.x), cy: round1(wire.cur.y) }, true);
      if (wire.target) {
        const t = worldToScreen(wire.target.pt);
        setOv('-ov-snap', { cx: round1(t.x), cy: round1(t.y), stroke: 'var(--accent-2)' }, true);
      } else setOv('-ov-snap', null, false);
    } else {
      setOv('-ov-wire', null, false);
      setOv('-ov-dot', null, false);
      setOv('-ov-snap', null, false);
    }
    if (drag && drag.type === 'box' && drag.cur) {
      const a = worldToScreen(drag.start), b = worldToScreen(drag.cur);
      setOv('-ov-box', { x: round1(Math.min(a.x, b.x)), y: round1(Math.min(a.y, b.y)), width: round1(Math.abs(b.x - a.x)), height: round1(Math.abs(b.y - a.y)) }, true);
    } else setOv('-ov-box', null, false);
    const gx = guides.find((g) => g.x != null), gy = guides.find((g) => g.y != null);
    if (gx) setOv('-ov-gx', { d: `M ${round1(worldToScreen({ x: gx.x, y: 0 }).x)} 0 V ${H}` }, true);
    else setOv('-ov-gx', null, false);
    if (gy) setOv('-ov-gy', { d: `M 0 ${round1(worldToScreen({ x: 0, y: gy.y }).y)} H ${W}` }, true);
    else setOv('-ov-gy', null, false);
  }

  /* ================= 命中检测 ================= */
  function hitPort(p) {
    const tol = isTouch() ? HIT_TOUCH : HIT_MOUSE;
    for (const nd of nodes) {
      const op = worldToScreen(outPort(nd));
      if (Math.hypot(p.x - op.x, p.y - op.y) <= tol + 5) return { id: nd.id, kind: 'out', pt: outPort(nd) };
      for (const sl of inSlots(nd)) {
        const sp = worldToScreen(sl);
        if (Math.hypot(p.x - sp.x, p.y - sp.y) <= tol) return { id: nd.id, kind: 'in', slot: sl.slot, pt: sl };
      }
    }
    return null;
  }
  function hitNode(p) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const nd = nodes[i];
      const c = worldToScreen(nd);
      const gm = nodeGeom(nd);
      const hw = (gm.w / 2) * view.s + HIT_NODE, hh = (gm.h / 2) * view.s + HIT_NODE;
      if (nd.kind === 'box') { if (Math.abs(p.x - c.x) <= hw && Math.abs(p.y - c.y) <= hh) return nd; }
      else if (Math.hypot(p.x - c.x, p.y - c.y) <= hw) return nd;
    }
    return null;
  }
  function hitEdge(p) {
    const slotMap = assignSlots();
    for (let i = edges.length - 1; i >= 0; i--) {
      const gm = edgeGeom(i, slotMap);
      if (!gm) continue;
      for (let j = 1; j < gm.pts.length; j++) {
        if (distToSeg(p, worldToScreen(gm.pts[j - 1]), worldToScreen(gm.pts[j])) <= 8) return i;
      }
    }
    return -1;
  }
  function distToSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    const t = L2 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }
  function alignSnap(anchor, dp) {
    const tol = 6 / view.s;
    let dx = dp.x, dy = dp.y, gx = null, gy = null, bx = tol, by = tol;
    for (const o of nodes) {
      if (selNodes.has(o.id)) continue;
      const ax = anchor.x + dx - o.x;
      if (Math.abs(ax) < bx) { bx = Math.abs(ax); dx = o.x - anchor.x; gx = o.x; }
      const ay = anchor.y + dy - o.y;
      if (Math.abs(ay) < by) { by = Math.abs(ay); dy = o.y - anchor.y; gy = o.y; }
    }
    guides = [];
    if (gx != null) guides.push({ x: gx });
    if (gy != null) guides.push({ y: gy });
    return { dx, dy };
  }

  /* ================= 指针交互 ================= */
  function onPointerDown(e) {
    if (e.button === 2) return;
    lastPointerType = e.pointerType || 'mouse';
    svg().setPointerCapture && svg().setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    closeCtx();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)) };
      drag = null; wire = null; liveHint = ''; renderOverlay(); renderHint();
      return;
    }
    const sp = svgPoint(e);
    const wp = screenToWorld(sp);

    const term = e.target.closest && e.target.closest('[data-term]');
    if (term) {
      const nd = nodeById(+term.dataset.termNode);
      if (nd) {
        pushUndo();
        if (term.dataset.term === 'src') nd.src = !nd.src; else nd.out = !nd.out;
        afterChange();
      }
      return;
    }
    const badge = e.target.closest && e.target.closest('[data-badge]');
    if (badge) {
      pushUndo();
      edges[+badge.dataset.badge].sign *= -1;
      afterChange();
      return;
    }
    const port = hitPort(sp);
    if (port && port.kind === 'out') {
      wire = { from: port.id, fromPt: port.pt, cur: sp, target: null };
      renderOverlay();
      return;
    }
    if (port && port.kind === 'in') return;   // 入端口不参与拖动，避免误移元件
    const node = hitNode(sp);
    if (node) {
      if (e.shiftKey) { if (selNodes.has(node.id)) selNodes.delete(node.id); else selNodes.add(node.id); }
      else if (!selNodes.has(node.id)) { selNodes = new Set([node.id]); selEdge = -1; }
      if (tool !== 'pan' && !spaceDown) drag = { type: 'node', start: wp, moved: false, pre: snapshot(), pushed: false };
      startLongPress(e, { kind: 'node', id: node.id });
      renderList(); renderInspector(); renderStatic(); renderOverlay();
      return;
    }
    const ei = hitEdge(sp);
    if (ei >= 0) {
      selEdge = ei; selNodes = new Set();
      startLongPress(e, { kind: 'edge', id: ei });
      renderList(); renderInspector(); renderStatic();
      return;
    }
    selNodes = new Set(); selEdge = -1;
    renderList(); renderInspector(); renderStatic();
    if (tool === 'pan' || spaceDown || e.pointerType !== 'mouse' || e.button === 1) {
      drag = { type: 'pan', last: { x: e.clientX, y: e.clientY } };
    } else {
      drag = { type: 'box', start: wp, cur: wp };
      renderOverlay();
    }
  }
  function onPointerMove(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.max(20, Math.hypot(a.x - b.x, a.y - b.y));
      const r = svg().getBoundingClientRect();
      zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, d / pinch.d);
      pinch.d = d;
      cancelLongPress();
      e.preventDefault();
      return;
    }
    const sp = svgPoint(e);
    if (wire) {
      wire.cur = sp;
      const port = hitPort(sp), node = hitNode(sp);
      if (port && port.kind === 'in' && port.id !== wire.from) wire.target = { id: port.id, slot: port.slot, pt: port.pt };
      else if (node && node.id !== wire.from) wire.target = { id: node.id, slot: null, pt: inSlots(node)[0] };
      else wire.target = null;
      const next = wire.target ? '' : '松手后在此新建元件（求和点 / 分支点 / 方框）';
      if (next !== liveHint) { liveHint = next; renderHint(); }
      renderOverlay();
      return;
    }
    if (drag && drag.type === 'pan') {
      view.tx += e.clientX - drag.last.x;
      view.ty += e.clientY - drag.last.y;
      drag.last = { x: e.clientX, y: e.clientY };
      cancelLongPress();
      syncView();
      renderOverlay();
      return;
    }
    if (drag && drag.type === 'node') {
      const wp = screenToWorld(sp);
      const anchor = nodeById([...selNodes][0]);
      if (!anchor) return;
      if (!drag.base) {
        drag.base = [...selNodes].map(nodeById).filter(Boolean).map((n) => ({ n, x: n.x, y: n.y }));
        drag.anchor0 = { x: anchor.x, y: anchor.y };
      }
      const raw = { x: wp.x - drag.start.x, y: wp.y - drag.start.y };
      const sn = alignSnap({ x: drag.anchor0.x, y: drag.anchor0.y }, raw);
      for (const it of drag.base) { it.n.x = it.x + sn.dx; it.n.y = it.y + sn.dy; }
      if (Math.abs(raw.x) + Math.abs(raw.y) > 0.5) {
        // 撤销快照延迟到"真的移动了"才入栈：单纯点击选中不该产生一条空撤销
        if (!drag.pushed) {
          undoStack.push(drag.pre);
          if (undoStack.length > MAX_UNDO) undoStack.shift();
          redoStack.length = 0;
          syncHistUI();
          drag.pushed = true;
        }
        drag.moved = true;
        cancelLongPress();
      }
      renderStatic(); renderOverlay(); updateStatus();
      return;
    }
    if (drag && drag.type === 'box') {
      drag.cur = screenToWorld(sp);
      const x0 = Math.min(drag.start.x, drag.cur.x), x1 = Math.max(drag.start.x, drag.cur.x);
      const y0 = Math.min(drag.start.y, drag.cur.y), y1 = Math.max(drag.start.y, drag.cur.y);
      selNodes = new Set(nodes.filter((n) => n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1).map((n) => n.id));
      renderList(); renderInspector(); renderStatic(); renderOverlay();
      return;
    }
    if (e.pointerType === 'mouse') {
      const node = hitNode(sp);
      const next = node ? node.id : 0;
      if (next !== hoverId) {
        hoverId = next;
        svg().title = node && node.kind === 'box' ? node.str + (node.err ? '（' + node.errNote + '）' : '') : '';
        svg().style.cursor = node ? (tool === 'pan' ? 'grab' : 'move') : '';
      }
    }
  }
  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    cancelLongPress();
    if (wire) {
      const t = wire.target, drop = wire.cur, fromId = wire.from;
      wire = null; liveHint = '';
      renderOverlay(); renderHint();
      if (t) {
        if (fromId === t.id) { flash('不能连接到自身'); return; }
        pushUndo();
        const existing = edges.findIndex((ed) => ed.from === fromId && ed.to === t.id);
        if (existing >= 0) { edges[existing].sign *= -1; flash('该连线已存在，已切换符号'); }
        else edges.push({ from: fromId, to: t.id, sign: 1 });
        afterChange();
        return;
      }
      // 松手在空白处：新建元件，并把刚拖出的这条线接上（fromId 必须传下去，
      // 此时 wire 已被清空，靠 wire.from 取不到来源）
      openCtx({ x: e.clientX, y: e.clientY, items: [
        { label: '新建求和点 Σ', fn: () => createAt('sum', drop, fromId) },
        { label: '新建分支点', fn: () => createAt('branch', drop, fromId) },
        { label: '新建方框', fn: () => createAt('box', drop, fromId) },
        { label: '新建采样开关', fn: () => createAt('sample', drop, fromId) },
        { label: '新建零阶保持器', fn: () => createAt('zoh', drop, fromId) }
      ] });
      return;
    }
    if (drag && drag.type === 'box') { drag = null; guides = []; renderOverlay(); return; }
    if (drag && drag.type === 'node' && drag.moved) writeHash();
    drag = null; guides = [];
    renderOverlay(); renderList();
  }
  function createAt(kind, screenPt, fromId) {
    const wp = screenToWorld(screenPt);
    pushUndo();
    const nd = addNode(kind, null, wp.x, wp.y);
    if (fromId != null && fromId !== nd.id) edges.push({ from: fromId, to: nd.id, sign: 1 });
    afterChange();
    flash(KIND_LABEL[kind] + '已创建');
    return nd;
  }

  /* ================= 长按 / 上下文菜单 ================= */
  function startLongPress(e, target) {
    if (e.pointerType === 'mouse') return;
    cancelLongPress();
    const x = e.clientX, y = e.clientY;
    lpTimer = setTimeout(() => { lpTimer = 0; openCtx(nodeMenu(target, x, y)); }, LONG_PRESS);
  }
  function cancelLongPress() { if (lpTimer) { clearTimeout(lpTimer); lpTimer = 0; } }
  function nodeMenu(target, x, y) {
    if (target.kind === 'edge') {
      const i = target.id;
      return { x, y, items: [
        { label: edges[i].sign < 0 ? '改为正反馈（+）' : '改为负反馈（−）', fn: () => { pushUndo(); edges[i].sign *= -1; afterChange(); } },
        { label: '删除连线', danger: true, fn: () => { pushUndo(); edges.splice(i, 1); selEdge = -1; afterChange(); } }
      ] };
    }
    const nd = nodeById(target.id);
    if (!nd) return { x, y, items: [] };
    const items = [];
    if (nd.kind === 'box') {
      items.push({ label: '编辑传函…', fn: () => beginEdit(nd, 'str') });
      items.push({ label: nd.dom === 'z' ? '取消「已在 z 域」' : '标记为「已在 z 域」', fn: () => { pushUndo(); nd.dom = nd.dom === 'z' ? 's' : 'z'; applyTF(nd); afterChange(); } });
    }
    items.push({ label: '重命名…', fn: () => beginEdit(nd, 'name') });
    const rs = hasSampled() ? 'z' : 's';
    if (nd.kind === 'sum') items.push({ label: nd.src ? `取消输入 R(${rs})` : `设为输入 R(${rs})`, fn: () => { pushUndo(); nd.src = !nd.src; afterChange(); } });
    items.push({ label: nd.out ? `取消输出 Y(${rs})` : `设为输出 Y(${rs})`, fn: () => { pushUndo(); nd.out = !nd.out; afterChange(); } });
    items.push({ label: '复制', fn: () => {
      pushUndo();
      seq++;
      const c = JSON.parse(JSON.stringify(nd));
      c.id = seq; c.name = nd.name + '′'; c.x += 34; c.y += 34;
      nodes.push(c);
      selNodes = new Set([c.id]);
      afterChange();
    } });
    items.push({ label: '断开全部连线', fn: () => { pushUndo(); edges = edges.filter((ed) => ed.from !== nd.id && ed.to !== nd.id); afterChange(); } });
    items.push({ label: '删除', danger: true, fn: () => { pushUndo(); nodes = nodes.filter((x2) => x2 !== nd); edges = edges.filter((ed) => ed.from !== nd.id && ed.to !== nd.id); selNodes.delete(nd.id); afterChange(); } });
    return { x, y, items };
  }
  function openCtx(menu) {
    closeCtx();
    if (!menu || !menu.items.length) return;
    const el = document.createElement('div');
    el.className = 'blk-ctx';
    menu.items.forEach((it) => {
      const b = document.createElement('button');
      b.className = 'blk-ctx-item' + (it.danger ? ' danger' : '');
      b.textContent = it.label;
      b.addEventListener('click', () => { closeCtx(); it.fn(); });
      el.appendChild(b);
    });
    document.body.appendChild(el);
    const w = el.offsetWidth || 170, h = el.offsetHeight || 40;
    el.style.left = Math.max(8, Math.min(menu.x, window.innerWidth - w - 8)) + 'px';
    el.style.top = Math.max(8, Math.min(menu.y, window.innerHeight - h - 8)) + 'px';
    ctxEl = el;
  }
  function closeCtx() { if (ctxEl) { ctxEl.remove(); ctxEl = null; } }

  /* ================= 就地编辑 ================= */
  function beginEdit(nd, field) {
    endEdit();
    const r = svg().getBoundingClientRect();
    const c = worldToScreen(nd);
    const el = document.createElement('div');
    el.className = 'blk-edit';
    el.style.left = (r.left + c.x) + 'px';
    el.style.top = (r.top + c.y + (field === 'name' ? -46 : 26)) + 'px';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = field === 'name' ? nd.name : nd.str;
    inp.spellcheck = false;
    el.appendChild(inp);
    // 就地编辑的符号键盘（仅传函编辑；名称无需）
    if (field === 'str') {
      MI.padRow(el, nd.dom === 'z'
        ? ['z', '^2', '^3', '*', '/', '(', ')', '+', '-']
        : ['s', '^2', '^3', '*', '/', '(', ')', '+', '-'], () => inp);
    }
    document.body.appendChild(el);
    inp.focus(); inp.select();
    let done = false;
    const commit = () => {
      if (done) return;   // 移除输入框会再触发一次 blur，必须只提交一次
      done = true;
      const v = inp.value.trim();
      const old = field === 'name' ? nd.name : nd.str;
      if (v && v !== old) {
        pushUndo();
        if (field === 'name') nd.name = v;
        else { nd.str = v; applyTF(nd); }
        flash('已应用');
      }
      endEdit();
      afterChange();
    };
    inp.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); ev.stopPropagation(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); endEdit(); }
    });
    inp.addEventListener('blur', commit);
    editEl = el;
  }
  function endEdit() { if (editEl) { const el = editEl; editEl = null; el.remove(); } }

  /* ================= 节点工厂与命令 ================= */
  function addNode(kind, str, x, y) {
    seq++;
    const text = kind === 'box' ? (str || '1/(s+1)') : '1';
    const isSym = kind === 'sample' || kind === 'zoh';     // 无有理传函（f 恒为 null）
    let f = isSym ? null : { n: [1], d: [1] }, err = false, errNote = '';
    if (kind === 'box') {
      const p = BS.parseBlockTF(text);
      err = !p.ok; errNote = p.ok ? '' : p.reason;
      f = p.ok ? { n: p.n, d: p.d } : null;
    }
    const node = { id: seq, kind, name: (kind === 'box' ? 'G' : kind === 'sum' ? 'Σ' : kind === 'sample' ? 'S' : kind === 'zoh' ? 'H' : 'n') + seq, str: text, f, err, errNote, x, y, src: false, out: false, dom: 's' };
    nodes.push(node);
    return node;
  }
  // 解析块表达式（按块的域）：判定全部收敛在 BLKSOLVE.parseBlockTF
  function applyTF(nd) {
    if (nd.kind !== 'box') {
      nd.str = '1'; nd.err = false; nd.errNote = ''; nd.f = { n: [1], d: [1] };
      return;
    }
    const p = BS.parseBlockTF(nd.str, nd.dom);
    nd.err = !p.ok; nd.errNote = p.ok ? '' : p.reason;
    nd.f = p.ok ? { n: p.n, d: p.d } : null;
  }
  // 是否存在采样元件 / z 域块（决定走 s 域还是 z 域分析）
  const hasSampled = () => nodes.some((n) => n.kind === 'sample' || n.kind === 'zoh' || (n.kind === 'box' && n.dom === 'z'));
  function deleteSelection() {
    if (!selNodes.size && selEdge < 0) { flash('先选中元件或连线'); return; }
    pushUndo();
    if (selEdge >= 0) { edges.splice(selEdge, 1); selEdge = -1; }
    if (selNodes.size) {
      const ids = selNodes;
      nodes = nodes.filter((n) => !ids.has(n.id));
      edges = edges.filter((e) => !ids.has(e.from) && !ids.has(e.to));
      selNodes = new Set();
    }
    afterChange();
    flash('已删除');
  }
  function clearAll() {
    if (nodes.length && !window.confirm('清空全部元件与连线？此操作可撤销。')) return;
    pushUndo();
    nodes = []; edges = []; seq = 0; selNodes = new Set(); selEdge = -1;
    afterChange(); fitView(); flash('已清空');
  }
  function centerWorld() {
    const r = svg().getBoundingClientRect();
    const jitter = 46;
    return screenToWorld({ x: (r.width || 600) / 2 + (Math.random() - 0.5) * jitter, y: (r.height || 360) / 2 + (Math.random() - 0.5) * jitter });
  }

  /* ================= 示例 ================= */
  const DEMOS = [
    { name: '一阶单位负反馈', build: () => {
      const s = addNode('sum', null, 240, 220); s.src = true;
      const g = addNode('box', '10/(s+1)', 480, 220); g.out = true;
      edges.push({ from: s.id, to: g.id, sign: 1 }, { from: g.id, to: s.id, sign: -1 });
    } },
    { name: '二阶系统 + 负反馈', build: () => {
      const s = addNode('sum', null, 210, 230); s.src = true;
      const g1 = addNode('box', '1/(s^2+2*s+5)', 450, 230);
      const g2 = addNode('box', '2/(s+0.5)', 690, 230); g2.out = true;
      edges.push({ from: s.id, to: g1.id, sign: 1 }, { from: g1.id, to: g2.id, sign: 1 }, { from: g2.id, to: s.id, sign: -1 });
    } },
    { name: '串并联对比', build: () => {
      const s = addNode('sum', null, 190, 270); s.src = true;
      const a = addNode('box', '1/(s+1)', 410, 160);
      const b = addNode('box', '1/(s+2)', 410, 380);
      const sum = addNode('sum', null, 660, 270); sum.out = true;
      edges.push({ from: s.id, to: a.id, sign: 1 }, { from: s.id, to: b.id, sign: 1 });
      edges.push({ from: a.id, to: sum.id, sign: 1 }, { from: b.id, to: sum.id, sign: 1 });
    } }
  ];
  function loadDemo(i) {
    pushUndo();
    nodes = []; edges = []; seq = 0; selNodes = new Set(); selEdge = -1;
    DEMOS[i].build();
    afterChange(true); fitView(); flash('已载入：' + DEMOS[i].name);
  }

  /* ================= 求解与结果 ================= */
  // 有采样元件 / z 域块 → 走 z 域路径（归约 + 求解）；否则完全走原 s 域路径
  function solve() {
    const bad = nodes.filter((n) => n.err).length;
    if (hasSampled()) {
      const zr = BS.solveSampled(nodes, edges, T);
      if (!zr.ok) return { ok: false, bad, mode: zr.mode || 'sampled', note: zr.note || '无法求解' };
      return { ok: true, bad, mode: zr.mode, z: zr.z, zread: zr.read, segs: zr.segs || [] };
    }
    const r = BS.solveTransfer(nodes, edges);
    if (!r.ok) return { ok: false, bad, mode: 's', note: r.note };
    return { ok: true, bad, mode: 's', frac: r.frac, read: BS.deriveReadout(r.frac) };
  }
  function fmtPole(q) {
    const im = Math.abs(q.im) > 1e-9 ? (q.im > 0 ? '+' : '−') + U.fmt(Math.abs(q.im), 2) + 'j' : '';
    return U.fmt(q.re, 2) + im;
  }
  // 连续片段中间结果（教学对照：先把每段离散化，再在 z 域求闭环）
  function segRows(segs) {
    if (!segs.length) return '<div class="blk-note">本图没有连续片段：全部元件都在 z 域，直接按离散回路求解。</div>';
    return segs.map((sg, i) => {
      const a = nodeById(sg.in), b = nodeById(sg.out);
      return `<div class="blk-kvlist">
        <div class="blk-kv"><span>片段 ${i + 1}</span><b>${a ? esc(a.name) : '?'} → ${b ? esc(b.name) : '?'}${sg.hasZoh ? ' · 前置 ZOH (1−z⁻¹)' : ''}</b></div>
        <div class="blk-kv"><span>T(s)</span><b>${U.polyTex(sg.Ts.n, 's')} / ${U.polyTex(sg.Ts.d, 's')}</b></div>
        <div class="blk-kv"><span>T(z)</span><b>${U.polyTex(sg.Tz.n, 'z')} / ${U.polyTex(sg.Tz.d, 'z')}</b></div>
      </div>`;
    }).join('');
  }
  function renderResult() {
    const sampled = hasSampled();
    const defs = sampled
      ? [['z', '脉冲传函 T(z)'], ['seg', '连续片段 T(s)']]
      : [['tf', '合成传函'], ['pz', '闭环极点'], ['step', '阶跃响应']];
    if (!defs.some(([k]) => k === resultTab)) resultTab = defs[0][0];
    const tabs = $('#blk-tabs');
    if (tabs) {
      tabs.innerHTML = '';
      defs.forEach(([k, label]) => {
        const b = document.createElement('button');
        b.className = 'blk-tab' + (resultTab === k ? ' on' : '');
        b.textContent = label;
        b.addEventListener('click', () => { resultTab = k; renderResult(); });
        tabs.appendChild(b);
      });
    }
    // 采样周期输入：仅在有采样元件 / z 域块时出现
    const tp = $('#blk-tparam');
    if (tp) tp.style.display = sampled ? '' : 'none';
    const ti = $('#blk-t');
    if (ti && document.activeElement !== ti) ti.value = String(T);
    const body = $('#blk-tabbody');
    if (!body) return;
    const sig = structVer + '|' + resultTab + '|' + T;
    if (sig === resSig) return;
    resSig = sig;
    const r = solve();
    if (!r.ok) {
      body.innerHTML = `<div class="blk-note">${esc(r.note)}</div>`
        + (r.bad ? `<div class="blk-warn">有 ${r.bad} 个元件的表达式无效</div>` : '');
      pzPlot.cv = null;
      stepPlot.plot = null;
      return;
    }
    const badNote = r.bad ? `<div class="blk-warn">${r.bad} 个元件表达式无效，已排除在求解之外</div>` : '';
    pzPlot.cv = null;
    if (resultTab === 'z') {
      const rr = r.zread;
      body.innerHTML = `${badNote}<div class="blk-tex" id="blk-ztex"></div>
        <div class="blk-kvlist">
          <div class="blk-kv"><span>阶次</span><b>${rr.order}</b></div>
          <div class="blk-kv"><span>闭环极点</span><b class="blk-poles">${rr.poles.map(fmtPole).join(', ') || '—'}</b></div>
          <div class="blk-kv"><span>稳定性</span><b style="color:${rr.stable ? 'var(--accent-2)' : rr.hasOut ? 'var(--danger)' : 'var(--warn)'}">${rr.stableText}</b></div>
          ${rr.zeros.length ? `<div class="blk-kv"><span>零点</span><b>${rr.zeros.map(fmtPole).join(', ')}</b></div>` : ''}
        </div>
        <div class="blk-note">z 平面零极点（× = 极点，○ = 零点）。圆内为稳定域，圆外为不稳定。</div>
        <div class="blk-pz"><canvas id="blk-zpz"></canvas></div>
        <div class="blk-note">单位阶跃下的采样点响应 y[n]（n = 0, 1, 2, …，仅采样时刻有效）：</div>
        <div class="blk-stepwrap"><canvas id="blk-zstem" class="plot"></canvas></div>
        ${r.segs.length ? `<div class="blk-note" style="margin-top:10px">中间结果（各连续片段的离散化）：</div>${segRows(r.segs)}` : ''}`;
      FX.katex('T(z)=\\dfrac{' + U.polyTex(r.z.n, 'z') + '}{' + U.polyTex(r.z.d, 'z') + '}', $('#blk-ztex'), { displayMode: true });
      drawZPlane(rr, $('#blk-zpz'));
      drawZStem(r.z, rr);
    } else if (resultTab === 'seg') {
      body.innerHTML = `${badNote}<div class="blk-note">连续片段：采样器 / 保持器把回路切成若干连续段，每段先离散化，再在 z 域按离散回路求解。</div>${segRows(r.segs)}`;
    } else if (resultTab === 'tf') {
      body.innerHTML = `${badNote}<div class="blk-tex" id="blk-tex"></div>
        <div class="blk-kvlist">
          <div class="blk-kv"><span>阶次</span><b>${r.read.order}</b></div>
          <div class="blk-kv"><span>闭环极点</span><b class="blk-poles">${r.read.poles.map(fmtPole).join(', ') || '—'}</b></div>
          <div class="blk-kv"><span>稳定性</span><b style="color:${r.read.stable ? 'var(--accent-2)' : r.read.hasRhp ? 'var(--danger)' : 'var(--warn)'}">${r.read.stableText}</b></div>
          ${r.read.wn ? `<div class="blk-kv"><span>ωₙ / ζ</span><b>${U.fmt(r.read.wn)} / ${U.fmt(r.read.zeta)}</b></div>` : ''}
        </div>`;
      FX.katex('T(s)=\\dfrac{' + U.polyTex(r.frac.n) + '}{' + U.polyTex(r.frac.d) + '}', $('#blk-tex'), { displayMode: true });
    } else if (resultTab === 'pz') {
      body.innerHTML = `${badNote}<div class="blk-note">闭环极点（× = 极点）。竖线为虚轴，右侧为不稳定半平面。</div>
        <div class="blk-pz"><canvas id="blk-pz"></canvas></div>`;
      drawPoles(r.read, $('#blk-pz'));
    } else {
      body.innerHTML = `${badNote}<div class="blk-note">单位阶跃响应（零状态）：</div>
        <div class="blk-stepwrap"><canvas id="blk-step" class="plot"></canvas></div>`;
      drawStep(r.frac, r.read);
    }
  }
  function drawPoles(read, cvEl) {
    if (!cvEl) return;
    pzPlot.cv = cvEl;
    const draw = () => {
      const W = cvEl.clientWidth || 300, H = cvEl.clientHeight || 190;
      const dpr = window.devicePixelRatio || 1;
      cvEl.width = Math.round(W * dpr); cvEl.height = Math.round(H * dpr);
      const g = cvEl.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = cv('--cv-bg'); g.fillRect(0, 0, W, H);
      const ml = 26, mr = 12, mt = 12, mb = 18;
      const dw = W - ml - mr, dh = H - mt - mb;
      const cx = ml + dw / 2, cy = mt + dh / 2;
      let R = 1;
      for (const q of read.poles) R = Math.max(R, Math.abs(q.re) + 0.4, Math.abs(q.im) + 0.4);
      const SX = (r) => cx + (r * dw / 2) / R, SY = (i) => cy - (i * dh / 2) / R;
      g.fillStyle = cv('--cv-stable-bg'); g.fillRect(ml, mt, cx - ml, dh);
      g.fillStyle = cv('--cv-unstable-bg'); g.fillRect(cx, mt, ml + dw - cx, dh);
      g.strokeStyle = cv('--cv-grid'); g.lineWidth = 1;
      for (let i = 0; i <= 4; i++) { const x = ml + i * dw / 4; g.beginPath(); g.moveTo(x, mt); g.lineTo(x, mt + dh); g.stroke(); }
      for (let i = 0; i <= 3; i++) { const y = mt + i * dh / 3; g.beginPath(); g.moveTo(ml, y); g.lineTo(ml + dw, y); g.stroke(); }
      g.strokeStyle = cv('--cv-axis-hi'); g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(cx, mt); g.lineTo(cx, mt + dh); g.stroke();
      g.strokeStyle = cv('--cv-axis');
      g.beginPath(); g.moveTo(ml, cy); g.lineTo(ml + dw, cy); g.stroke();
      g.strokeStyle = cv('--cv-danger'); g.lineWidth = 2;
      for (const q of read.poles) {
        const x = SX(q.re), y = SY(q.im);
        g.beginPath(); g.moveTo(x - 6, y - 6); g.lineTo(x + 6, y + 6); g.moveTo(x - 6, y + 6); g.lineTo(x + 6, y - 6); g.stroke();
      }
      g.fillStyle = cv('--cv-tick'); g.font = '10px ' + getComputedStyle(document.body).fontFamily;
      g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText('jω', cx + 4, mt + 2);
      g.fillText('σ', ml + dw - 12, cy + 4);
    };
    draw();
    cvEl._redraw = draw;
  }
  // z 平面零极点（单位圆判稳）：与 drawPoles 的区别是必须等比例 + 画单位圆
  function drawZPlane(read, cvEl) {
    if (!cvEl) return;
    pzPlot.cv = cvEl;
    const draw = () => {
      const W = cvEl.clientWidth || 300, H = cvEl.clientHeight || 190;
      const dpr = window.devicePixelRatio || 1;
      cvEl.width = Math.round(W * dpr); cvEl.height = Math.round(H * dpr);
      const g = cvEl.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = cv('--cv-bg'); g.fillRect(0, 0, W, H);
      const ml = 12, mr = 12, mt = 8, mb = 16;
      const dw = W - ml - mr, dh = H - mt - mb;
      const cx = ml + dw / 2, cy = mt + dh / 2;
      let R = 1.3;
      for (const q of read.poles.concat(read.zeros)) R = Math.max(R, Math.abs(q.re) + 0.2, Math.abs(q.im) + 0.2);
      const S = Math.min(dw, dh) / 2 / R;              // 等比例：z 平面不能拉伸
      const SX = (r) => cx + r * S, SY = (i) => cy - i * S;
      g.fillStyle = cv('--cv-stable-bg');
      g.beginPath(); g.arc(cx, cy, S, 0, Math.PI * 2); g.fill();   // 圆内 = 稳定域
      g.strokeStyle = cv('--cv-grid'); g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx, mt); g.lineTo(cx, mt + dh); g.moveTo(ml, cy); g.lineTo(ml + dw, cy); g.stroke();
      g.strokeStyle = cv('--cv-axis-hi'); g.lineWidth = 1.6;
      g.beginPath(); g.arc(cx, cy, S, 0, Math.PI * 2); g.stroke();  // 单位圆
      g.strokeStyle = cv('--cv-danger'); g.lineWidth = 2;
      for (const q of read.poles) {
        const x = SX(q.re), y = SY(q.im);
        g.beginPath(); g.moveTo(x - 5, y - 5); g.lineTo(x + 5, y + 5); g.moveTo(x - 5, y + 5); g.lineTo(x + 5, y - 5); g.stroke();
      }
      g.strokeStyle = cv('--accent-2'); g.lineWidth = 1.6;
      for (const q of read.zeros) {
        g.beginPath(); g.arc(SX(q.re), SY(q.im), 4.2, 0, Math.PI * 2); g.stroke();
      }
      g.fillStyle = cv('--cv-tick'); g.font = '10px ' + getComputedStyle(document.body).fontFamily;
      g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText('Im', cx + 4, mt + 2);
      g.fillText('Re', ml + dw - 16, cy + 4);
      g.fillText('|z|=1', cx + S * 0.72, cy - S * 0.72);
    };
    draw();
    cvEl._redraw = draw;
  }
  // 采样点响应 y[n]：Y(z) = T(z)·z/(z−1)，逐点用 TR.invZ 求值后画杆状图
  function drawZStem(frac, read) {
    const cvEl = $('#blk-zstem');
    if (!cvEl) return;
    if (stepPlot.plot && stepPlot.plot.cv !== cvEl) stepPlot.plot = null;
    const p = stepPlot.plot || (stepPlot.plot = new FX.Plot(cvEl, { margin: { l: 46, r: 12, t: 10, b: 24 } }));
    const iz = TR.invZ(BS.polyMul(frac.n, [1, 0]), BS.polyMul(frac.d, [1, -1]));
    const N = 40;
    if (!iz || typeof iz.evalN !== 'function') {      // 部分分式失败时优雅降级
      p.setRange(0, N, 0, 1); p.clear(); p.grid(); p.axis(true);
      p.label('无法给出采样点响应：' + esc((iz && iz.note) || '未知原因'), 1, 0.5, { color: cv('--danger'), align: 'left', baseline: 'top' });
      p.onDraw = () => {};
      return;
    }
    const nx = [], ny = [];
    let lo = 0, hi = 1;
    for (let k = 0; k <= N; k++) {
      const v = iz.evalN(k);
      nx.push(k); ny.push(v);
      if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
    if (!isFinite(lo) || !isFinite(hi) || hi - lo < 1e-9) { lo = -0.5; hi = 1.5; }
    const pad = (hi - lo) * 0.12;
    const lo2 = lo - Math.max(pad, 0.05), hi2 = hi + Math.max(pad, 0.05);
    const col = read.hasOut ? cv('--cv-danger') : cv('--cv-line1');
    const redraw = () => {
      p.setRange(0, N, lo2, hi2);
      p.clear(); p.grid(); p.axis(true);
      p.line([0, N], [1, 1], { color: cv('--cv-tick'), width: 1 });
      p.line([0, N], [0, 0], { color: cv('--cv-tick'), width: 1 });
      p.clip();
      for (let k = 0; k <= N; k++) p.line([nx[k], nx[k]], [0, ny[k]], { color: col, width: 1.6 });
      p.dots(nx, ny, { color: col, r: 2.6 });
      p.unclip();
      p.label('n', N * 0.97, 0, { color: cv('--cv-tick'), align: 'left', baseline: 'top' });
      const parts = [];
      if (read.hasOut) parts.push('存在单位圆外极点 → 响应发散');
      else if (read.hasOnCircle) parts.push('极点在单位圆上 → 不收敛（等幅 / 线性增长）');
      else parts.push('全部极点在单位圆内 → 收敛到稳态值');
      p.label(parts.join(''), 0, hi2, { color: read.hasOut ? cv('--cv-danger') : cv('--cv-tick'), align: 'left', baseline: 'top' });
      p.crosshair((x) => 'n=' + Math.round(x), (y) => 'y=' + U.fmt(y, 4));
    };
    p.onDraw = redraw;
    redraw();
  }
  function drawStep(frac, read) {
    const cvEl = $('#blk-step');
    if (!cvEl) return;
    // 选项卡重绘会重建画布元素；只有元素被替换时才丢弃旧 Plot（避免无谓地新建 ResizeObserver）
    if (stepPlot.plot && stepPlot.plot.cv !== cvEl) stepPlot.plot = null;
    const p = stepPlot.plot || (stepPlot.plot = new FX.Plot(cvEl, { margin: { l: 46, r: 12, t: 10, b: 24 } }));
    let nearest = Infinity;
    for (const q of read.poles) if (Math.abs(q.re) > 1e-9) nearest = Math.min(nearest, Math.abs(q.re));
    const tmax = read.hasRhp ? 6 : Math.min(30, Math.max(1, 5 / (nearest || 1)));
    const res = DSP.ltiResponse(frac.n, frac.d, (t) => (t >= 0 ? 1 : 0), 0, tmax, 1600);
    let lo = Infinity, hi = -Infinity;
    for (const v of res.y) if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    lo = Math.min(lo, 0) - (hi - lo) * 0.08; hi += (hi - lo) * 0.1;
    const redraw = () => {
      p.setRange(res.t[0], res.t[res.t.length - 1], lo, hi);
      p.clear(); p.grid(); p.axis(true);
      p.line([0, tmax], [1, 1], { color: cv('--cv-tick'), width: 1 });
      p.clip(); p.line(res.t, res.y, { color: read.hasRhp ? cv('--cv-danger') : cv('--cv-line1'), width: 2.2 }); p.unclip();
      p.crosshair((t) => 't=' + U.fmt(t, 3), (y) => 'y=' + U.fmt(y, 4));
    };
    p.onDraw = redraw;
    redraw();
  }

  /* ================= 检查器 ================= */
  function renderInspector() {
    const box = $('#blk-insp');
    if (!box) return;
    const sig = structVer + '|' + selKey();
    if (sig === inspSig) return;
    inspSig = sig;
    box.innerHTML = '';
    const nd = selNodes.size === 1 ? nodeById([...selNodes][0]) : null;
    if (!nd) {
      if (selNodes.size > 1) { box.appendChild(U.el('div', { class: 'blk-note' }, `已选中 ${selNodes.size} 个元件 · 可整组拖动，或点「删除选中」`)); return; }
      if (selEdge >= 0) {
        const e = edges[selEdge];
        const f = nodeById(e.from), t = nodeById(e.to);
        box.appendChild(U.el('div', { class: 'blk-note' }, `${f ? f.name : '?'} → ${t ? t.name : '?'} · ${e.sign < 0 ? '负反馈（−）' : '正（+）'}`));
        const row = U.el('div', { class: 'blk-btnrow' });
        const mk = (label, fn) => { const b = U.el('button', { class: 'btn' }, label); b.addEventListener('click', fn); return b; };
        row.append(
          mk(e.sign < 0 ? '改为正（+）' : '改为负（−）', () => { pushUndo(); edges[selEdge].sign *= -1; afterChange(); }),
          mk('删除连线', () => { pushUndo(); edges.splice(selEdge, 1); selEdge = -1; afterChange(); })
        );
        box.appendChild(row);
        return;
      }
      box.appendChild(U.el('div', { class: 'blk-note' },
        '点选元件或连线查看详情。拖空白框选、滚轮缩放、从端口拖出连线；双击块可就地编辑，右键（触屏长按）打开菜单。'));
      return;
    }
    // 类型
    const seg = U.el('div', { class: 'blk-seg' });
    [['box', '方框'], ['sum', '求和点'], ['branch', '分支点'], ['sample', '采样开关'], ['zoh', 'ZOH']].forEach(([k, label]) => {
      const b = U.el('button', { class: 'blk-segbtn' + (nd.kind === k ? ' on' : '') }, label);
      b.addEventListener('click', () => {
        if (nd.kind === k) return;
        pushUndo();
        nd.kind = k;
        if (k === 'box') nd.str = nd.str && /[a-z]/i.test(nd.str) ? nd.str : '1/(s+1)';
        applyTF(nd);
        afterChange();
      });
      seg.appendChild(b);
    });
    box.appendChild(seg);
    // 名称
    const nameInp = U.el('input', { type: 'text', value: nd.name, spellcheck: 'false', class: 'blk-inp' });
    nameInp.addEventListener('change', () => { pushUndo(); nd.name = nameInp.value.trim() || nd.name; afterChange(); });
    box.appendChild(U.el('label', { class: 'blk-lbl' }, '名称'));
    box.appendChild(nameInp);
    // 传函
    if (nd.kind === 'box') {
      // 域开关：勾选后表达式按变量 z 解析（不做 s→z 变换）
      const zrow = U.el('label', { class: 'blk-zdom' });
      const zcb = U.el('input', { type: 'checkbox' });
      zcb.checked = nd.dom === 'z';
      zcb.addEventListener('change', () => { pushUndo(); nd.dom = zcb.checked ? 'z' : 's'; applyTF(nd); afterChange(); });
      zrow.append(zcb, U.el('span', {}, '表达式已在 z 域（不做 s→z 变换）'));
      box.appendChild(zrow);

      const inp = U.el('input', { type: 'text', value: nd.str, spellcheck: 'false', class: 'blk-inp' + (nd.err ? ' bad' : '') });
      const apply = () => {
        const v = inp.value.trim() || '1';
        if (v === nd.str) return;
        pushUndo();
        nd.str = v;
        applyTF(nd);
        afterChange();
      };
      inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); } });
      inp.addEventListener('blur', apply);
      box.appendChild(U.el('label', { class: 'blk-lbl' }, nd.dom === 'z'
        ? '传函（z 域，如 (z-0.5)/(z-1)）'
        : '传函（如 10/(s+1)、(s+2)/(s^2+2*s+5)）'));
      box.appendChild(inp);
      // 符号键盘：移动端不必裸敲表达式（tokens 随域切换）
      MI.padRow(box, nd.dom === 'z'
        ? ['z', '^2', '^3', '*', '/', '(', ')', '+', '-']
        : ['s', '^2', '^3', '*', '/', '(', ')', '+', '-'], () => inp);
      if (nd.err) box.appendChild(U.el('div', { class: 'blk-warn' }, '⚠ ' + nd.errNote));
      else {
        const p = nd.f;
        const vn = nd.dom === 'z' ? 'z' : 's';
        const dc = p.d[p.d.length - 1] !== 0 ? p.n[p.n.length - 1] / p.d[p.d.length - 1] : Infinity;
        const kv = U.el('div', { class: 'blk-kvlist' });
        kv.innerHTML = `<div class="blk-kv"><span>规范形</span><b>${U.polyTex(p.n, vn)}/${U.polyTex(p.d, vn)}</b></div>
          <div class="blk-kv"><span>阶次</span><b>${p.d.length - 1}</b></div>
          <div class="blk-kv"><span>${nd.dom === 'z' ? 'DC 增益（z=1）' : 'DC 增益'}</span><b>${U.fmt(dc)}</b></div>`;
        box.appendChild(kv);
      }
    } else if (nd.kind === 'sample') {
      box.appendChild(U.el('div', { class: 'blk-note' }, '采样开关：把连续信号取成采样序列（周期 T 见下方「分析结果」）。采样器之后的元件按 z 域处理。'));
    } else if (nd.kind === 'zoh') {
      box.appendChild(U.el('div', { class: 'blk-note' }, '零阶保持器：把采样序列保持为连续阶梯信号，z 等效为 (1−z⁻¹)·Z[G(s)/s]。其输入必须是采样信号。'));
    } else {
      box.appendChild(U.el('div', { class: 'blk-note' }, nd.kind === 'sum'
        ? '求和点：把多条入边按各自 ± 号相加后向后传递（传函恒为 1）。点击连线上的 ± 徽标可切换符号。'
        : '分支点：把同一路信号引出到多条支路（传函恒为 1）。'));
    }
    // R / Y 端子
    const term = U.el('div', { class: 'blk-btnrow' });
    const mkT = (label, on, fn) => { const b = U.el('button', { class: 'btn' + (on ? ' primary' : '') }, label); b.addEventListener('click', fn); return b; };
    term.append(
      mkT(nd.src ? (hasSampled() ? 'R(z) ✓' : 'R(s) ✓') : (hasSampled() ? '设为输入 R(z)' : '设为输入 R(s)'), nd.src, () => { pushUndo(); nd.src = !nd.src; afterChange(); }),
      mkT(nd.out ? (hasSampled() ? 'Y(z) ✓' : 'Y(s) ✓') : (hasSampled() ? '设为输出 Y(z)' : '设为输出 Y(s)'), nd.out, () => { pushUndo(); nd.out = !nd.out; afterChange(); })
    );
    box.appendChild(term);
  }

  /* ================= 元件列表 ================= */
  function renderList() {
    const list = $('#blk-list');
    if (!list) return;
    const sig = structVer + '|' + selKey();
    if (sig === listSig) return;
    listSig = sig;
    list.innerHTML = '';
    if (!nodes.length) {
      list.appendChild(U.el('div', { class: 'blk-note' }, '还没有元件。点上方按钮添加，或「载入示例」快速体验。'));
      return;
    }
    for (const nd of nodes) {
      const row = U.el('div', { class: 'blk-item' + (selNodes.has(nd.id) ? ' sel' : '') });
      const icon = nd.kind === 'box' ? '▭' : nd.kind === 'sum' ? 'Σ' : nd.kind === 'branch' ? '●' : nd.kind === 'sample' ? 'S' : 'Z';
      const strTxt = nd.kind === 'box' ? (nd.err ? '⚠ ' + nd.str : nd.str + (nd.dom === 'z' ? '  ·z' : ''))
        : nd.kind === 'sample' ? '采样开关（周期 T）'
        : nd.kind === 'zoh' ? '零阶保持器 (1−z⁻¹)' : nd.str;
      const body = U.el('div', { class: 'blk-itembody' },
        U.el('div', { class: 'blk-itemname' }, nd.name + (nd.src ? ' · R' : '') + (nd.out ? ' · Y' : '')),
        U.el('div', { class: 'blk-itemstr' + (nd.err ? ' bad' : '') }, strTxt));
      row.append(U.el('span', { class: 'blk-itemicon' }, icon), body);
      if (nd.err) row.title = nd.errNote;
      row.addEventListener('click', () => {
        selNodes = new Set([nd.id]); selEdge = -1;
        renderList(); renderInspector(); renderStatic();
      });
      list.appendChild(row);
    }
  }

  /* ================= 状态栏 / 提示 ================= */
  function flash(msg) {
    statusMsg = msg; statusUntil = Date.now() + 1800; updateStatus();
    setTimeout(updateStatus, 1900);   // 到点自行还原，不必等下一次刷新
  }
  function updateStatus() {
    // 提示与计数分开放：提示是瞬时的，计数不该被它顶掉
    const st = $('#blk-status');
    if (st) st.textContent = (statusMsg && Date.now() < statusUntil) ? statusMsg : '';
    const ct = $('#blk-counts');
    if (ct) ct.textContent = `${nodes.length} 元件 · ${edges.length} 连线 · ${Math.round(view.s * 100)}%`;
  }
  function renderHint() {
    const h = $('#blk-hint');
    if (!h) return;
    if (liveHint) { h.textContent = liveHint; h.classList.add('on'); return; }
    h.classList.remove('on');
    const small = window.matchMedia('(max-width: 900px)').matches;
    h.textContent = small || isTouch()
      ? '单指拖元件 · 拖空白平移 · 双指缩放 · 从端口拖出连线 · 长按打开菜单'
      : '拖元件移动 · 拖空白框选 · 滚轮缩放 · 空格拖动平移 · 端口拖出连线 · 双击编辑 · 右键菜单';
  }

  /* ================= 统一刷新 ================= */
  function afterChange(keepView) {
    structVer++;
    if (selEdge >= edges.length) selEdge = -1;   // 连线被外部删除/重排后索引会失效
    renderList(); renderStatic(); renderOverlay(); renderInspector(); renderResult();
    renderHint(); updateStatus(); syncHistUI(); syncView();
    if (!keepView) writeHash();
  }
  function renderAll() { renderStatic(); renderOverlay(); renderInspector(); renderResult(); renderList(); renderHint(); syncView(); }

  /* ================= 分享链接 ================= */
  function encodeState() {
    const slim = {
      v: 1,
      T,
      n: nodes.map((n) => ({ i: n.id, k: n.kind, m: n.name, s: n.str, x: Math.round(n.x), y: Math.round(n.y), r: n.src ? 1 : 0, o: n.out ? 1 : 0, z: n.dom === 'z' ? 1 : 0 })),
      e: edges.map((e) => [e.from, e.to, e.sign < 0 ? 0 : 1]),
      vw: { s: +view.s.toFixed(3), tx: Math.round(view.tx), ty: Math.round(view.ty) }
    };
    return 'blk1.' + btoa(unescape(encodeURIComponent(JSON.stringify(slim))));
  }
  function writeHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => {
      try { if (App.hashFree()) history.replaceState(null, '', '#blk=' + encodeState()); } catch (e) { }
    }, 300);
  }
  function readHash() {
    try {
      const raw = new URLSearchParams(location.hash.replace(/^#/, '')).get('blk');
      if (!raw || !raw.startsWith('blk1.')) return false;
      const slim = JSON.parse(decodeURIComponent(escape(atob(raw.slice(5)))));
      if (!slim || !Array.isArray(slim.n) || !slim.n.length) return false;
      nodes = []; edges = []; seq = 0;
      if (typeof slim.T === 'number' && isFinite(slim.T) && slim.T > 0) T = Math.min(T_MAX, Math.max(T_MIN, slim.T));
      for (const it of slim.n) {
        seq = Math.max(seq, it.i);
        const kind = it.k || 'box';
        const dom = it.z ? 'z' : 's';
        const p = kind === 'box' ? BS.parseBlockTF(it.s, dom) : { ok: true, n: [1], d: [1] };
        const sym = kind === 'sample' || kind === 'zoh';     // 采样元件无有理传函
        nodes.push({
          id: it.i, kind, dom, name: it.m, str: it.s,
          f: sym ? null : p.ok ? { n: p.n, d: p.d } : null, err: sym ? false : !p.ok,
          errNote: p.ok || sym ? '' : p.reason,
          x: it.x, y: it.y, src: !!it.r, out: !!it.o
        });
      }
      edges = (slim.e || []).map((t) => ({ from: t[0], to: t[1], sign: t[2] ? 1 : -1 }))
        .filter((e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to));
      if (slim.vw) view = { s: Math.min(S_MAX, Math.max(S_MIN, slim.vw.s || 1)), tx: slim.vw.tx || 0, ty: slim.vw.ty || 0 };
      return true;
    } catch (e) { return false; }
  }
  function shareLink() {
    const url = location.origin + location.pathname + '#blk=' + encodeState();
    const btn = $('#blk-share');
    const done = () => { btn.textContent = '✓ 已复制'; setTimeout(() => { btn.textContent = '分享'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, done);
    else { try { history.replaceState(null, '', '#blk=' + encodeState()); } catch (e) { } done(); }
  }

  /* ================= 事件绑定 ================= */
  const sEl = svg();
  sEl.addEventListener('pointerdown', onPointerDown);
  sEl.addEventListener('pointermove', onPointerMove);
  sEl.addEventListener('pointerup', onPointerUp);
  sEl.addEventListener('pointercancel', (e) => {
    pointers.delete(e.pointerId); pinch = null; wire = null; drag = null; guides = []; liveHint = '';
    cancelLongPress(); renderOverlay(); renderHint();
  });
  sEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const sp = svgPoint(e);
    zoomAt(sp.x, sp.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    renderOverlay();
  }, { passive: false });
  sEl.addEventListener('dblclick', (e) => {
    const sp = svgPoint(e);
    const nd = hitNode(sp);
    if (nd) { selNodes = new Set([nd.id]); renderStatic(); renderInspector(); beginEdit(nd, nd.kind === 'box' ? 'str' : 'name'); }
  });
  sEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const sp = svgPoint(e);
    const nd = hitNode(sp);
    if (nd) { selNodes = new Set([nd.id]); selEdge = -1; renderList(); renderInspector(); renderStatic(); openCtx(nodeMenu({ kind: 'node', id: nd.id }, e.clientX, e.clientY)); return; }
    const ei = hitEdge(sp);
    if (ei >= 0) { selEdge = ei; selNodes = new Set(); renderList(); renderInspector(); renderStatic(); openCtx(nodeMenu({ kind: 'edge', id: ei }, e.clientX, e.clientY)); }
  });
  sEl.addEventListener('mouseleave', () => { hoverId = 0; sEl.title = ''; });

  $('#blk-add-box').addEventListener('click', () => { const c = centerWorld(); pushUndo(); addNode('box', null, c.x, c.y); afterChange(); flash('已添加方框'); });
  $('#blk-add-sum').addEventListener('click', () => { const c = centerWorld(); pushUndo(); addNode('sum', null, c.x, c.y); afterChange(); flash('已添加求和点'); });
  $('#blk-add-branch').addEventListener('click', () => { const c = centerWorld(); pushUndo(); addNode('branch', null, c.x, c.y); afterChange(); flash('已添加分支点'); });
  $('#blk-add-sample').addEventListener('click', () => { const c = centerWorld(); pushUndo(); addNode('sample', null, c.x, c.y); afterChange(); flash('已添加采样开关（周期 T 见右下「分析结果」）'); });
  $('#blk-add-zoh').addEventListener('click', () => { const c = centerWorld(); pushUndo(); addNode('zoh', null, c.x, c.y); afterChange(); flash('已添加零阶保持器'); });
  // 采样周期：非法值不采纳（保留上次有效值）并内联提示
  $('#blk-t').addEventListener('change', (e) => {
    const v = Number(e.target.value);
    const warn = $('#blk-t-warn');
    if (!isFinite(v) || v <= 0) {
      e.target.value = String(T);
      if (warn) warn.textContent = 'T 必须为正数';
      return;
    }
    if (warn) warn.textContent = '';
    T = Math.min(T_MAX, Math.max(T_MIN, v));
    e.target.value = String(T);
    afterChange(true);
  });
  $('#blk-demo').addEventListener('click', () => { demoIdx = (demoIdx + 1) % DEMOS.length; loadDemo(demoIdx); });
  $('#blk-clear').addEventListener('click', clearAll);
  $('#blk-share').addEventListener('click', shareLink);
  // 💾 保存 / ↗ 系统分析 / 我的模型
  $('#blk-save').addEventListener('click', () => {
    MI.nameAsk('框图 ' + (App.models.list().filter((m) => m.kind === 'blk').length + 1), (name) => {
      App.models.save({ name, kind: 'blk', data: { hash: encodeState() } });
      renderLib();
    });
  });
  $('#blk-tosys').addEventListener('click', () => {
    const r = solve();
    if (!r.ok || !r.frac) { flash('当前框图没有可交接的合成传函：' + (r.note || '')); return; }
    const polyStr = (c, v) => c.map((x, i) => {
      const pw = c.length - 1 - i, a = +Math.abs(x).toFixed(6);
      return (x < 0 ? '-' : '+') + a + (pw === 0 ? '' : pw === 1 ? '*' + v : '*' + v + '^' + pw);
    }).join('').replace(/^\+/, '');
    const numStr = polyStr(r.frac.n, 's') || '0';
    const denStr = polyStr(r.frac.d, 's') || '1';
    try { history.replaceState(null, '', '#hn=' + encodeURIComponent(numStr) + '&hd=' + encodeURIComponent(denStr)); } catch (e) { }
    App.open('sys');
  });
  const renderLib = App.models.renderChips($('#blk-lib'), {
    kinds: ['blk'],
    emptyText: '暂无保存的框图',
    onLoad: (m) => {
      if (!m.data || !m.data.hash) return;
      try { history.replaceState(null, '', '#' + m.data.hash); } catch (e) { }
      readHash();
      afterChange(true);
      flash('已载入模型「' + m.name + '」');
    }
  });
  $('#blk-del').addEventListener('click', deleteSelection);
  $('#blk-undo').addEventListener('click', undo);
  $('#blk-redo').addEventListener('click', redo);
  $('#blk-fit').addEventListener('click', () => { fitView(); flash('已适应窗口'); });
  $('#blk-zoom-in').addEventListener('click', () => { const r = sEl.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.2); renderOverlay(); });
  $('#blk-zoom-out').addEventListener('click', () => { const r = sEl.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1 / 1.2); renderOverlay(); });
  $('#blk-zoom-val').addEventListener('click', () => { setView({ s: 1, tx: view.tx, ty: view.ty }); flash('缩放已重置为 100%'); });
  host.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
    tool = b.dataset.tool;
    host.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x.dataset.tool === tool));
  }));
  let demoIdx = 0;

  // 键盘（桌面）
  const onKey = (e) => {
    const t = e.target;
    const tag = (t && t.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || (t && t.isContentEditable)) return;
    if (e.key === ' ') { if (!spaceDown) { spaceDown = true; sEl.style.cursor = 'grab'; } e.preventDefault(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
    if (e.key === 'Escape') {
      wire = null; drag = null; guides = []; liveHint = ''; closeCtx(); endEdit();
      selNodes = new Set(); selEdge = -1;
      renderOverlay(); renderStatic(); renderList(); renderInspector(); renderHint();
    }
  };
  const onKeyUp = (e) => { if (e.key === ' ') { spaceDown = false; sEl.style.cursor = ''; } };
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKeyUp);
  const onDocDown = (e) => { if (ctxEl && !ctxEl.contains(e.target)) closeCtx(); };
  document.addEventListener('pointerdown', onDocDown, true);
  const onWinResize = () => { syncView(); renderOverlay(); };
  window.addEventListener('resize', onWinResize);

  /* ================= 初始化 ================= */
  if (readHash() && nodes.length) { afterChange(true); }
  else { loadDemo(0); }
  renderAll();
  syncHistUI();
  // 首帧布局尚未稳定时尺寸可能为 0，下一帧再适应一次（移动端尤其重要）
  requestAnimationFrame(() => { fitView(); renderOverlay(); });
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      const s = svg();
      if (!s || !s.isConnected) { ro.disconnect(); return; }
      syncView(); renderOverlay();
      if (pzPlot.cv && pzPlot.cv._redraw) pzPlot.cv._redraw();
      if (stepPlot.plot && stepPlot.plot.onDraw) stepPlot.plot.onDraw();
    });
    ro.observe($('#blk-cvwrap'));
  }

  /* ---------- 实验接入：状态捕获 / 回放（复用 blk1 编码与 readHash 重建） ---------- */
  function blkGetState() { return { state: encodeState() }; }
  function blkApplyState(sv) {
    if (!sv || typeof sv !== 'object' || typeof sv.state !== 'string' || !sv.state.startsWith('blk1.')) return;
    try {
      history.replaceState(null, '', '#' + sv.state);
      if (!readHash()) App.toast('框图状态还原失败', 'danger');
    } catch (e) { App.toast('框图状态还原失败', 'danger'); }
  }
  /* 统一结果工具栏（框图整体编码即状态，PNG 导出不适用于 SVG 编辑器） */
  RTB.attach(host.querySelector('#blk-rtb'), {
    module: 'blk',
    getState: blkGetState, applyState: blkApplyState
  });

  return {
    title: '系统框图',
    subtitle: '方框 · 求和点 Σ · 分支点 · 采样开关 · 零阶保持器',
    api: {
      getState: blkGetState,
      applyState: blkApplyState,
      dispose,
      onTheme: () => {
        renderAll();
        if (stepPlot.plot && stepPlot.plot.onDraw) stepPlot.plot.onDraw();
        if (pzPlot.cv && pzPlot.cv._redraw) pzPlot.cv._redraw();
      }
    }
  };
  function dispose() {
    if (ro) { ro.disconnect(); ro = null; }
    clearTimeout(hashTimer);
    cancelLongPress();
    closeCtx();
    endEdit();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('keyup', onKeyUp);
    document.removeEventListener('pointerdown', onDocDown, true);
    window.removeEventListener('resize', onWinResize);
    pointers.clear(); pinch = null; wire = null; drag = null;
    stepPlot.plot = null; pzPlot.cv = null;
  }
});
