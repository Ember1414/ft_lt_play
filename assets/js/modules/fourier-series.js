/* ============================================================
 * fourier-series.js — 傅立叶级数
 *   1) 画圈套画圈：任意闭合路径分解为一圈圈旋转的“圆套圆”
 *      支持滚轮缩放 / 拖拽平移 / 双击复位；形状可选预设或 ✏️ 手绘自定义
 *   2) 谐波叠加：方波逐步由正弦合成（Gibbs 现象）
 * ============================================================ */
App.register('fs', (host) => {
  let state = { shape: 'square', terms: 40, speed: 1, showCircles: true, playing: true, t: 0 };
  let phasors = [];
  let traceTail = [];
  const view = { k: 1, cx: 0, cy: 0 };   // 主画布视图：缩放系数 + 世界坐标中心
  let traceJustCleared = false;

  const shapes = ['square', 'triangle', 'heart', 'star', 'butterfly', 'gear', 'spiral', 'custom'];
  const shapeNames = { square: '方形路径', triangle: '三角', heart: '爱心', star: '五角星', butterfly: '蝴蝶', gear: '齿轮', spiral: '螺旋', custom: '✏️ 手绘' };

  // ---------- DOM ----------
  host.innerHTML = `
    <div class="module layout">
      <div class="pane">
        <h3>配置</h3>
        <div class="row" style="justify-content:flex-end;margin:-4px 0 10px">
          <button class="btn" id="fs-share" title="复制分享链接（形状与参数）" style="padding:5px 10px;font-size:12px">🔗 分享</button>
          <button class="btn" id="fs-png" title="导出当前画面为 PNG" style="padding:5px 10px;font-size:12px">📷 PNG</button>
        </div>
        <div class="ctrl"><label>笔画形状</label>
          <div class="row" id="fs-shapes"></div>
          <div id="fs-rtb"></div>
        </div>
        <div class="ctrl" id="fs-custom-wrap" style="display:none">
          <div class="canvas-wrap" style="margin-bottom:8px"><canvas class="draw-canvas" id="fs-drawcv" style="height:170px"></canvas></div>
          <div class="row" style="justify-content:space-between">
            <button class="btn" id="fs-drclear" style="padding:4px 10px;font-size:12px">🗑 清空重画</button>
            <span class="hint" style="margin:0">画一条闭合曲线，松手即生成（首尾自动相连）</span>
          </div>
        </div>
        <div class="ctrl"><label>圈数上限 <span class="val" id="fs-terms-v"></span></label>
          <input type="range" id="fs-terms" min="1" max="120" value="40">
        </div>
        <div class="ctrl"><label>动画速度 <span class="val" id="fs-speed-v"></span></label>
          <input type="range" id="fs-speed" min="0.2" max="3" step="0.1" value="1">
        </div>
        <div class="ctrl"><label class="row" style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="fs-circles-toggle" checked> 显示旋转圆与半径线
        </label></div>
        <div class="ctrl row" style="gap:8px">
          <button class="btn" id="fs-play">⏸ 暂停</button>
          <button class="btn" id="fs-frame" title="暂停并前进一步">⏯ 逐帧</button>
          <button class="btn" id="fs-reset">↺ 重置</button>
        </div>
        <div class="hint">每条路径经 <b>DFT</b> 分解为若干相量（频域），每个相量贡献一圈旋转的圆：
          <div class="formula-center" id="fs-formula">z(t)</div>
        </div>
      </div>
      <div class="pane">
        <h3>画圈套画圈 · 傅立叶绘制</h3>
        <div class="canvas-wrap" style="height:420px"><canvas class="plot" id="fs-circles"></canvas></div>
        <div class="legend">
          <span><span class="sw" style="background:#5b9bff"></span>目标路径</span>
          <span><span class="sw" style="background:#37d0a0"></span>已合成轨迹</span>
        </div>
      </div>
      <details class="pane full plot-fold">
        <summary>谐波幅度谱 · 当前形状的 DFT 分解</summary>
        <div class="canvas-wrap" style="height:130px"><canvas class="plot" id="fs-spec"></canvas></div>
        <div class="hint">各谐波相量的幅值 |c<sub>k</sub>|（按频率 k 排列）。谱线随形状变化——这就是"波形分解成谐波"的频域视图。</div>
      </details>
      <details class="pane full plot-fold">
        <summary>谐波叠加 · 方波逐步合成（Gibbs 现象）</summary>
        <div class="row" id="fs-harm-view" style="margin-bottom:8px">
          <button class="chip active" data-v="2d">2D 平面</button>
          <button class="chip" data-v="3d">3D 瀑布（可旋转/缩放）</button>
        </div>
        <div id="fs-harm-2d">
          <div class="canvas-wrap" style="height:240px"><canvas class="plot" id="fs-harmonics"></canvas></div>
          <div class="legend">
            <span><span class="sw" style="background:#ffb454"></span>方波目标</span>
            <span><span class="sw" style="background:#5b9bff"></span>部分和 S<sub>n</sub></span>
            <span><span class="sw" style="background:#4c5874"></span>叠加中的各次谐波</span>
          </div>
        </div>
        <div id="fs-harm-3d" class="hidden">
          <div class="canvas-wrap" style="height:380px"><canvas id="fs-wf3d" class="wf3d"></canvas></div>
        </div>
        <div class="hint">方波 = 奇次正弦之和 <b>S<sub>n</sub>(t) = (4/π)·Σ<sub>k=1..n</sub> sin((2k-1)·2πt)/(2k-1)</b>。
          在跳变处始终存在约 9% 的过冲，这是不可消除的 Gibbs 现象，不是动画误差。</div>
        <div class="statbar" id="fs-stats"></div>
      </details>
    </div>`;

  const $ = (s) => host.querySelector(s);
  const cv = FX.cvCol;
  const circleCanvas = $('#fs-circles');
  const harmCanvas = $('#fs-harmonics');
  const ctxC = circleCanvas.getContext('2d');
  FX.katex('z(t)=\\sum_{k=-K}^{K} c_k\\,e^{\\,j2\\pi k t},\\quad \\text{每个 } c_k \\text{ 画一个半径}|c_k|\\text{、初相}\\angle c_k\\text{ 的圆}', $('#fs-formula'), { displayMode: true });

  // 形状按钮
  const shapeRow = $('#fs-shapes');
  const customWrap = $('#fs-custom-wrap');
  shapes.forEach((k) => {
    const c = U.el('button', { class: 'chip' + (k === state.shape ? ' active' : ''), 'data-shape': k }, shapeNames[k]);
    c.addEventListener('click', () => {
      shapes.forEach((x) => { const b = shapeRow.querySelector(`[data-shape="${x}"]`); b.className = 'chip'; });
      c.className = 'chip active';
      state.shape = k;
      customWrap.style.display = k === 'custom' ? '' : 'none';
      if (k === 'custom') fitDraw();   // display:none 时无法测宽，展开后重新适配
      recompute();
      fsSyncHash();
    });
    shapeRow.append(c);
  });

  /* ---------- ✏️ 手绘自定义形状：画板 → 弧长重采样 → DFT ---------- */
  const drawCv = $('#fs-drawcv');
  const dctx = drawCv.getContext('2d');
  let customPts = [], customShape = null, drawingStroke = false, strokeDone = false;

  function fitDraw() {
    const dpr = window.devicePixelRatio || 1;
    const w = drawCv.clientWidth || drawCv.parentElement.clientWidth || 300;
    const h = drawCv.clientHeight || 170;
    drawCv.width = Math.round(w * dpr);
    drawCv.height = Math.round(h * dpr);
    dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    repaintDraw();
  }
  function repaintDraw() {
    const dpr = window.devicePixelRatio || 1;
    const w = drawCv.width / dpr, h = drawCv.height / dpr;
    dctx.fillStyle = cv('--cv-bg');
    dctx.fillRect(0, 0, w, h);
    if (!customPts.length) return;
    dctx.strokeStyle = cv('--cv-text');
    dctx.lineWidth = 2; dctx.lineJoin = 'round'; dctx.lineCap = 'round';
    dctx.beginPath();
    for (let i = 0; i < customPts.length; i++) { const p = customPts[i]; i ? dctx.lineTo(p.x, p.y) : dctx.moveTo(p.x, p.y); }
    if (strokeDone) dctx.closePath();
    dctx.stroke();
  }
  drawCv.addEventListener('pointerdown', (e) => {
    drawingStroke = true; strokeDone = false; customPts = [];
    try { drawCv.setPointerCapture(e.pointerId); } catch (err) { }
    e.preventDefault();
    repaintDraw();
  });
  drawCv.addEventListener('pointermove', (e) => {
    if (!drawingStroke) return;
    const r = drawCv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const last = customPts[customPts.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) < 2) return;   // 抽稀
    customPts.push({ x, y });
    dctx.strokeStyle = cv('--cv-text');
    dctx.lineWidth = 2; dctx.lineJoin = 'round'; dctx.lineCap = 'round';
    dctx.beginPath();
    if (last) { dctx.moveTo(last.x, last.y); dctx.lineTo(x, y); } else { dctx.moveTo(x, y); dctx.lineTo(x + 0.1, y); }
    dctx.stroke();
  });
  function endStroke() {
    if (!drawingStroke) return;
    drawingStroke = false; strokeDone = true;
    repaintDraw();
    let L = 0;
    for (let i = 1; i < customPts.length; i++) L += Math.hypot(customPts[i].x - customPts[i - 1].x, customPts[i].y - customPts[i - 1].y);
    if (L >= 40) {   // 过短的误触不生成
      customShape = FX_LIB.customShapePoints(customPts, 512);
      if (state.shape === 'custom') recompute();
    }
  }
  drawCv.addEventListener('pointerup', endStroke);
  drawCv.addEventListener('pointercancel', endStroke);
  $('#fs-drclear').addEventListener('click', () => {
    customPts = []; customShape = null; strokeDone = false;
    repaintDraw();
    if (state.shape === 'custom') recompute();
  });

  const termsEl = $('#fs-terms'), termsV = $('#fs-terms-v');
  termsEl.addEventListener('input', () => { state.terms = +termsEl.value; termsV.textContent = state.terms; drawHarmonics(); if (wf.canvas && !$('#fs-harm-3d').classList.contains('hidden')) wfDraw(); fsSyncHash(); });
  const speedEl = $('#fs-speed'), speedV = $('#fs-speed-v');
  speedEl.addEventListener('input', () => { state.speed = +speedEl.value; speedV.textContent = state.speed.toFixed(1) + '×'; fsSyncHash(); });
  $('#fs-circles-toggle').addEventListener('change', (e) => { state.showCircles = e.target.checked; fsSyncHash(); });
  // 本地播放控制（与键盘空格快捷键共用同一套 api，状态经 flt-play 事件同步）
  const fsPlayBtn = $('#fs-play');
  const onPlayEvt = (e) => { fsPlayBtn.textContent = e.detail ? '⏸ 暂停' : '▶ 播放'; };
  window.addEventListener('flt-play', onPlayEvt);
  fsPlayBtn.addEventListener('click', () => { const r = togglePlay(); fsPlayBtn.textContent = r ? '⏸ 暂停' : '▶ 播放'; });
  $('#fs-frame').addEventListener('click', () => { frame(); fsPlayBtn.textContent = '▶ 播放'; });
  $('#fs-reset').addEventListener('click', () => { reset(); });
  termsV.textContent = state.terms;
  speedV.textContent = '1.0×';

  /* ---------- 分享链接 / PNG 导出 ---------- */
  let fsHashTimer = null;
  function fsWriteHash() {
    try {
      const p = new URLSearchParams();
      p.set('fs', state.shape === 'custom' ? 'square' : state.shape);
      p.set('n', state.terms); p.set('v', state.speed); p.set('c', state.showCircles ? '1' : '0');
      if (App.hashFree()) history.replaceState(null, '', '#' + p.toString());
    } catch (e) { }
  }
  function fsSyncHash() { clearTimeout(fsHashTimer); fsHashTimer = setTimeout(fsWriteHash, 300); }
  function fsApplyStateToControls() {
    termsEl.value = state.terms; termsV.textContent = state.terms;
    speedEl.value = state.speed; speedV.textContent = state.speed.toFixed(1) + '×';
    $('#fs-circles-toggle').checked = state.showCircles;
    if (state.shape !== 'custom') {
      const b = shapeRow.querySelector('[data-shape="' + state.shape + '"]');
      if (b) { shapeRow.querySelectorAll('.chip').forEach((x) => x.classList.remove('active')); b.classList.add('active'); }
    }
  }
  // URL 分享参数还原（#fs=形状&n=圈数&v=速度&c=显示圆）
  {
    const fp = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (fp.get('fs') != null) {
      const s = fp.get('fs');
      if (shapes.includes(s) && s !== 'custom') state.shape = s;
      const n = +fp.get('n'); if (n >= 1 && n <= 120) state.terms = Math.round(n);
      const v = +fp.get('v'); if (v >= 0.2 && v <= 3) state.speed = v;
      if (fp.get('c') != null) state.showCircles = fp.get('c') === '1';
      customWrap.style.display = 'none';
      fsApplyStateToControls();
    }
  }
  $('#fs-share').addEventListener('click', () => {
    fsWriteHash();
    const url = location.origin + location.pathname + location.hash;
    const btn = $('#fs-share');
    const done = () => { btn.textContent = '✓ 已复制'; setTimeout(() => { btn.textContent = '🔗 分享'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, done);
    else done();
  });
  $('#fs-png').addEventListener('click', () => {
    const a = document.createElement('a');
    a.download = 'fourier-series-' + state.shape + '.png';
    a.href = circleCanvas.toDataURL('image/png');
    a.click();
  });

  function fit(sizeEl) {
    sizeEl.width = (sizeEl.clientWidth || sizeEl.parentElement.clientWidth || 400) * (window.devicePixelRatio || 1);
    sizeEl.height = (sizeEl.clientHeight || sizeEl.parentElement.clientHeight || 300) * (window.devicePixelRatio || 1);
  }

  let shapeCache = [];
  function recompute() {
    const pts = state.shape === 'custom'
      ? (customShape || [])
      : FX_LIB.shapePoints(state.shape, 512);
    shapeCache = pts;
    phasors = DSP.dftPhasors(pts.filter((p) => p && isFinite(p.re) && isFinite(p.im)));
    traceTail = [];
    view.k = 1; view.cx = 0; view.cy = 0;
    draw();
    drawSpec();
  }

  // 当前位置链
  function phasorChain(t, count) {
    const arr = [{ x: 0, y: 0 }];
    let x = 0, y = 0;
    for (let j = 0; j < count && j < phasors.length; j++) {
      const ph = phasors[j].phase + 2 * Math.PI * phasors[j].k * t;
      x += phasors[j].amp * Math.cos(ph);
      y += phasors[j].amp * Math.sin(ph);
      arr.push({ x, y, amp: phasors[j].amp, ph, k: phasors[j].k });
    }
    return arr;
  }

  /* ---------- 主画布交互：滚轮缩放 / 拖拽平移 / 双击复位 ---------- */
  function canvasXY(e) {
    const r = circleCanvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (circleCanvas.clientWidth / r.width), (e.clientY - r.top) * (circleCanvas.clientHeight / r.height)];
  }
  circleCanvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [px, py] = canvasXY(e);
    const s = baseScale();
    const wx = view.cx + (px - circleCanvas.clientWidth / 2) / (s * view.k);
    const wy = view.cy + (circleCanvas.clientHeight / 2 - py) / (s * view.k);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    view.k = U.clamp(view.k * factor, 0.3, 30);
    view.cx = wx - (px - circleCanvas.clientWidth / 2) / (s * view.k);
    view.cy = wy - (circleCanvas.clientHeight / 2 - py) / (s * view.k);
  }, { passive: false });
  let dragC = null;
  const touchPts = new Map();
  let pinchBase = null;
  circleCanvas.addEventListener('pointerdown', (e) => {
    touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchPts.size === 2) {
      const [a, b] = [...touchPts.values()];
      pinchBase = Math.max(20, Math.hypot(a.x - b.x, a.y - b.y));
      dragC = null;
    } else if (touchPts.size === 1) {
      dragC = { x: e.clientX, y: e.clientY };
      try { circleCanvas.setPointerCapture(e.pointerId); } catch (err) { }
    }
  });
  circleCanvas.addEventListener('pointermove', (e) => {
    if (!touchPts.has(e.pointerId)) return;
    touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // 双指捏合缩放（围绕中点）
    if (touchPts.size >= 2 && pinchBase) {
      const [a, b] = [...touchPts.values()];
      const d = Math.max(20, Math.hypot(a.x - b.x, a.y - b.y));
      const r = circleCanvas.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
      const s0 = baseScale();
      const wx = view.cx + (mx - circleCanvas.clientWidth / 2) / (s0 * view.k);
      const wy = view.cy + (circleCanvas.clientHeight / 2 - my) / (s0 * view.k);
      const factor = d / pinchBase;   // 张开 = 放大
      view.k = U.clamp(view.k * factor, 0.3, 30);
      view.cx = wx - (mx - circleCanvas.clientWidth / 2) / (s0 * view.k);
      view.cy = wy - (circleCanvas.clientHeight / 2 - my) / (s0 * view.k);
      pinchBase = d;
      e.preventDefault();
      return;
    }
    if (!dragC) return;
    const s = baseScale();
    view.cx -= (e.clientX - dragC.x) / (s * view.k);
    view.cy += (e.clientY - dragC.y) / (s * view.k);
    dragC = { x: e.clientX, y: e.clientY };
  });
  const endFinger = (e) => { touchPts.delete(e.pointerId); if (touchPts.size < 2) pinchBase = null; if (touchPts.size === 0) dragC = null; };
  window.addEventListener('pointerup', endFinger);
  window.addEventListener('pointercancel', endFinger);
  circleCanvas.addEventListener('dblclick', () => { view.k = 1; view.cx = 0; view.cy = 0; });

  function baseScale() { return Math.min(circleCanvas.clientWidth, circleCanvas.clientHeight) * 0.32; }

  function draw() {
    // --- 主画布：画圈 ---
    const dpr = window.devicePixelRatio || 1;
    const needW = Math.round(circleCanvas.clientWidth * dpr), needH = Math.round(circleCanvas.clientHeight * dpr);
    if (circleCanvas.width !== needW || circleCanvas.height !== needH) { circleCanvas.width = needW; circleCanvas.height = needH; }
    ctxC.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = circleCanvas.clientWidth, H = circleCanvas.clientHeight;
    ctxC.clearRect(0, 0, W, H);
    ctxC.fillStyle = cv('--cv-bg'); ctxC.fillRect(0, 0, W, H);

    const cx = W / 2, cy = H / 2, s = baseScale() * view.k;
    const SX = (x) => cx + (x - view.cx) * s, SY = (y) => cy - (y - view.cy) * s;

    const chain = phasorChain(state.t, state.terms);

    ctxC.save();
    ctxC.beginPath(); ctxC.rect(0, 0, W, H); ctxC.clip();

    const pts = shapeCache;
    ctxC.setLineDash([5, 4]);
    ctxC.strokeStyle = cv('--cv-circle-a'); ctxC.lineWidth = 1.2; ctxC.lineJoin = 'round';
    ctxC.beginPath();
    for (let i = 0; i < pts.length; i++) { const px = SX(pts[i].re), py = SY(pts[i].im); i ? ctxC.lineTo(px, py) : ctxC.moveTo(px, py); }
    if (state.shape !== 'spiral') ctxC.closePath();
    ctxC.stroke();
    ctxC.setLineDash([]);

    if (state.showCircles) {
      for (let j = 1; j < chain.length; j++) {
        const c = chain[j - 1], n = chain[j];
        const r = n.amp * s;
        if (r < 0.5 || n.k === 0) continue;
        ctxC.beginPath();
        ctxC.strokeStyle = j % 2 ? cv('--cv-circle-b') : cv('--cv-circle-a');
        ctxC.lineWidth = r > 60 ? 1.35 : 1;
        ctxC.arc(SX(c.x), SY(c.y), r, 0, Math.PI * 2); ctxC.stroke();
        ctxC.beginPath();
        ctxC.moveTo(SX(c.x), SY(c.y));
        ctxC.lineTo(SX(n.x), SY(n.y));
        ctxC.strokeStyle = cv('--cv-chain'); ctxC.lineWidth = 1.4; ctxC.stroke();
      }
    }

    const tip = chain[chain.length - 1];
    if (traceJustCleared) { traceTail = []; traceJustCleared = false; }
    traceTail.push(tip.x, tip.y);
    if (traceTail.length > 8000) traceTail.splice(0, 2);
    ctxC.lineWidth = 2.6; ctxC.strokeStyle = cv('--cv-line2');
    ctxC.lineJoin = 'round'; ctxC.lineCap = 'round';
    ctxC.beginPath();
    for (let i = 0; i < traceTail.length / 2; i++) {
      const px = SX(traceTail[i * 2]), py = SY(traceTail[i * 2 + 1]);
      i ? ctxC.lineTo(px, py) : ctxC.moveTo(px, py);
    }
    ctxC.stroke();

    ctxC.beginPath();
    ctxC.arc(SX(tip.x), SY(tip.y), 4.5, 0, Math.PI * 2);
    ctxC.fillStyle = cv('--cv-line1'); ctxC.fill();
    ctxC.restore();

    // 文字
    ctxC.fillStyle = cv('--cv-tick'); ctxC.font = '11px SFMono-Regular, monospace';
    ctxC.textAlign = 'left';
    const needHint = state.shape === 'custom' && !shapeCache.length ? ' · 请先在左侧 ✏️ 手绘画板画一条闭合曲线' : '';
    ctxC.fillText(`圈数 = ${Math.min(state.terms, phasors.length)} · 最大幅值 ≈ ${U.fmt(phasors[0] ? phasors[0].amp : 0, 3)} · 缩放 ${view.k.toFixed(1)}×${needHint}`, 12, 20);
  }

  /* ---------- 谐波叠加图（FX.Plot，支持缩放/读数） ---------- */
  let harmPlot = null;
  function squarePartial(t) {
    const p = t % 1;
    return p < 0.5 ? 1 : -1;
  }
  function squareSum(t, n) {
    let s = 0;
    for (let k = 1; k <= n; k++) s += Math.sin(2 * Math.PI * (2 * k - 1) * t) / (2 * k - 1);
    return (4 / Math.PI) * s;
  }

  function drawHarmonics() {
    if (!harmPlot) {
      harmPlot = new FX.Plot(harmCanvas, { margin: { l: 44, r: 14, t: 12, b: 26 } });
      harmPlot.onDraw = drawHarmonics;
    }
    const p = harmPlot;
    p.setRange(0, 2, -1.7, 1.7);
    p.clear(); p.grid(0.25, 0.5); p.axis(true);

    // 各次谐波（弱）
    const n = Math.min(state.terms, 60);
    p.clip();
    p.ctx.lineWidth = 1;
    for (let k = 1; k <= Math.min(n, 40); k++) {
      const a = 4 / (Math.PI * (2 * k - 1));
      const xs = [], ys = [];
      for (let i = 0; i <= 200; i++) { const t = (i / 200) * 2; xs.push(t); ys.push(a * Math.sin(2 * Math.PI * (2 * k - 1) * t)); }
      p.line(xs, ys, { color: cv('--cv-harm-weak'), width: 1 });
    }
    p.unclip();

    // 目标方波
    const tx = [], ty = [];
    for (let i = 0; i <= 2000; i++) { const t = (i / 2000) * 2; tx.push(t); ty.push(squarePartial(t)); }
    p.line(tx, ty, { color: cv('--cv-warn'), width: 2 });
    // 部分和
    const sx2 = [], sy2 = [];
    for (let i = 0; i <= 400; i++) { const t = (i / 400) * 2; sx2.push(t); sy2.push(squareSum(t, n)); }
    p.line(sx2, sy2, { color: cv('--cv-line1'), width: 2 });

    p.crosshair((x) => 't=' + U.fmt(x, 4), (y) => 'S(t)=' + U.fmt(y, 4));

    // 统计
    const err = rmsErr(n);
    $('#fs-stats').innerHTML = `
      <div class="stat"><span class="k">使用谐波</span><span class="v">${n}</span></div>
      <div class="stat"><span class="k">RMS 误差</span><span class="v">${U.fmt(err, 4)}</span></div>
      <div class="stat"><span class="k">Gibbs 过冲</span><span class="v">9%</span></div>`;
  }

  /* ---------- 谐波幅度谱（当前形状的 DFT，按频率排列） ---------- */
  let specPlot = null;
  function drawSpec() {
    if (!specPlot) {
      specPlot = new FX.Plot($('#fs-spec'), { margin: { l: 44, r: 14, t: 10, b: 24 }, padding: 0.02 });
      specPlot.onDraw = drawSpec;
    }
    const p = specPlot;
    const top = phasors.filter((q) => q.amp > 1e-6).slice(0, 80).sort((a, b) => a.k - b.k);
    let maxA = 1e-9, k0 = Infinity, k1 = -Infinity;
    for (const q of top) { maxA = Math.max(maxA, q.amp); k0 = Math.min(k0, q.k); k1 = Math.max(k1, q.k); }
    if (!isFinite(k0)) { k0 = 0; k1 = 1; }   // 无有效谐波时的兜底范围
    p.setRange(k0 - 0.5, k1 + 0.5, 0, maxA * 1.08);
    p.clear(); p.grid(null, null); p.axis(true);
    p.clip();
    top.forEach((q) => {
      p.line([q.k, q.k], [0, q.amp], { color: cv('--cv-line3'), width: 3 });
    });
    p.unclip();
    p.crosshair((x) => 'k=' + Math.round(x), (y, wx) => {
      let best = null, bd = Infinity;
      for (const q of top) { const d = Math.abs(q.k - wx); if (d < bd) { bd = d; best = q; } }
      return best && bd < 0.6 ? '|c_{' + best.k + '}|=' + U.fmt(best.amp, 4) : '|c|=' + U.fmt(y, 4);
    });
    p.label('|cₖ|（横轴 = 谐波次数 k）', p.margin.l + 8, p.margin.t + 14, { color: cv('--cv-label'), size: 11 });
  }
  function rmsErr(n) {
    let s = 0; const M = 2000;
    for (let i = 0; i < M; i++) { const t = (i / M) * 2; const d = squarePartial(t) - squareSum(t, n); s += d * d; }
    return Math.sqrt(s / M);
  }

  /* ---------- 3D 瀑布视图：部分和 S_k(t) 沿谐波次数 k 展开成曲面族 ----------
     自写投影引擎：yaw（绕竖直轴）+ pitch（绕水平轴）+ 透视缩放。
     手势约定：拖动只旋转，滚轮/捏合只缩放，无平移 —— 与 2D 图的坐标平移手势完全隔离。 */
  const wf = {
    yaw: -0.62, pitch: 0.42, zoom: 1, canvas: null, raf: 0, needsDraw: false,
    pointers: new Map(), pinchBase: 0
  };
  function wfReset() { wf.yaw = -0.62; wf.pitch = 0.42; wf.zoom = 1; wfDraw(); }
  function wfResize() {
    const cvEl = wf.canvas; if (!cvEl) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cvEl.clientWidth || 600, h = cvEl.clientHeight || 380;
    cvEl.width = Math.round(w * dpr); cvEl.height = Math.round(h * dpr);
    wfDraw();
  }
  function wfProject(x, y, z, W, H) {
    // 世界坐标：t∈[0,2]→x∈[-1.25,1.25]，幅值→y∈[-1.1,1.1]，k→z∈[0,1.7]
    const cy = Math.cos(wf.yaw), sy = Math.sin(wf.yaw);
    let X = x * cy - z * sy, Z = x * sy + z * cy;
    const cp = Math.cos(wf.pitch), sp = Math.sin(wf.pitch);
    let Y = y * cp - Z * sp; Z = y * sp + Z * cp;
    const persp = 4.2;
    const s = (persp / (persp - Z)) * wf.zoom * Math.min(W, H) * 0.30;
    return { X: W / 2 + X * s, Y: H / 2 - Y * s, depth: Z };
  }
  function wfDraw() {
    const cvEl = wf.canvas; if (!cvEl || !cvEl.clientWidth) return;
    const g = cvEl.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = cvEl.clientWidth, H = cvEl.clientHeight;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = cv('--cv-bg'); g.fillRect(0, 0, W, H);
    const n = Math.min(state.terms, 40);
    const NT = 160;
    const Z0 = 0, Z1 = 1.7;
    // 坐标框架：三条轴
    const axes = [
      [[-1.25, 0, Z0], [1.25, 0, Z0]],
      [[-1.25, 0, Z0], [-1.25, 1.15, Z0]],
      [[-1.25, 0, Z0], [-1.25, 0, Z1]]
    ];
    g.lineWidth = 1.2;
    for (const [a, b] of axes) {
      const pa = wfProject(a[0], a[1], a[2], W, H), pb = wfProject(b[0], b[1], b[2], W, H);
      g.strokeStyle = cv('--cv-axis-hi');
      g.beginPath(); g.moveTo(pa.X, pa.Y); g.lineTo(pb.X, pb.Y); g.stroke();
    }
    // t 轴刻度
    g.fillStyle = cv('--cv-tick'); g.font = '10px SFMono-Regular, monospace'; g.textAlign = 'center';
    for (const tv of [0, 0.5, 1, 1.5, 2]) {
      const p = wfProject(-1.25 + tv / 2 * 2.5, 0, Z0, W, H);
      g.fillText(U.fmt(tv, 1), p.X, p.Y + 12);
    }
    g.save(); g.translate(14, H / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center';
    g.fillText('幅值 Sₖ(t)', 0, 0); g.restore();
    g.textAlign = 'left';
    g.fillText('t →', wfProject(1.25, 0, Z0, W, H).X - 24, wfProject(1.25, 0, Z0, W, H).Y + 12);
    g.fillText('k →', wfProject(-1.25, 0, Z1, W, H).X, wfProject(-1.25, 0, Z1, W, H).Y - 6);
    // 底板网格（z=Z0 平面）
    g.strokeStyle = cv('--cv-grid'); g.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      const t = -1.25 + (i / 8) * 2.5;
      const a = wfProject(t, 0, Z0, W, H), b = wfProject(t, 0, Z1, W, H);
      g.beginPath(); g.moveTo(a.X, a.Y); g.lineTo(b.X, b.Y); g.stroke();
    }
    for (let j = 0; j <= 4; j++) {
      const z = Z0 + (j / 4) * (Z1 - Z0);
      const a = wfProject(-1.25, 0, z, W, H), b = wfProject(1.25, 0, z, W, H);
      g.beginPath(); g.moveTo(a.X, a.Y); g.lineTo(b.X, b.Y); g.stroke();
    }
    // 曲线：各次谐波分量（幅度 |4/π(2k−1)|），从最远（k 大）画到最近
    const K = Math.min(Math.max(n, 1), 20);
    for (let ki = K; ki >= 1; ki--) {
      const k = ki;                      // 第 k 个奇次谐波 2k−1
      const z = Z0 + ((K - ki) / Math.max(1, K - 1)) * (Z1 - Z0);
      const amp = 4 / (Math.PI * (2 * k - 1));
      const hue = 200 + (ki / Math.max(1, K)) * 130;
      g.strokeStyle = K > 1 ? `hsla(${hue}, 75%, 64%, 0.95)` : cv('--cv-line1');
      g.lineWidth = 1.5;
      g.beginPath();
      for (let i = 0; i <= NT; i++) {
        const t = (i / NT) * 2;
        const yv = amp * Math.sin(2 * Math.PI * (2 * k - 1) * t);
        const p = wfProject(-1.25 + t * 1.25, U.clamp(yv, -1.4, 1.4), z, W, H);   // t∈[0,2]→x∈[-1.25,1.25]，与刻度/网格一致
        i ? g.lineTo(p.X, p.Y) : g.moveTo(p.X, p.Y);
      }
      g.stroke();
      // 左端 k 标注
      const lp = wfProject(-1.25, 0, z, W, H);
      g.fillStyle = cv('--cv-tick'); g.font = '9px SFMono-Regular, monospace'; g.textAlign = 'right';
      g.fillText('k=' + (2 * k - 1), lp.X - 4, lp.Y + 3);
    }
    // 部分和（当前圈数）高亮置于最前
    g.strokeStyle = cv('--cv-warn'); g.lineWidth = 2.2;
    g.beginPath();
    for (let i = 0; i <= NT; i++) {
      const t = (i / NT) * 2;
      const p = wfProject(-1.25 + t * 1.25, U.clamp(squareSum(t, n), -1.5, 1.5), Z0 - 0.3, W, H);
      i ? g.lineTo(p.X, p.Y) : g.moveTo(p.X, p.Y);
    }
    g.stroke();
    g.fillStyle = cv('--cv-label'); g.font = '11px SFMono-Regular, monospace'; g.textAlign = 'left';
    g.fillText(`各次谐波分量瀑布（k=1…${2 * K - 1}）· 橙线 = 部分和 S(n=${n}) · 虚线 = 方波`, 12, 18);
    // 目标方波（最近端，醒目）
    g.strokeStyle = cv('--cv-warn'); g.lineWidth = 2; g.setLineDash([6, 4]);
    g.beginPath();
    for (let i = 0; i <= 300; i++) {
      const t = (i / 300) * 2;
      const p = wfProject(-1.25 + t * 1.25, U.clamp(squarePartial(t), -1.6, 1.6), Z0 - 0.28, W, H);
      i ? g.lineTo(p.X, p.Y) : g.moveTo(p.X, p.Y);
    }
    g.stroke(); g.setLineDash([]);
  }
  function wfBind() {
    const cvEl = wf.canvas;
    cvEl.addEventListener('pointerdown', (e) => {
      wf.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (wf.pointers.size === 2) {
        const [a, b] = [...wf.pointers.values()];
        wf.pinchBase = Math.max(20, Math.hypot(a.x - b.x, a.y - b.y));
      }
      try { cvEl.setPointerCapture(e.pointerId); } catch (err) { }
      e.preventDefault();
    });
    cvEl.addEventListener('pointermove', (e) => {
      if (!wf.pointers.has(e.pointerId)) return;
      const prev = wf.pointers.get(e.pointerId);
      wf.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (wf.pointers.size >= 2 && wf.pinchBase) {
        const [a, b] = [...wf.pointers.values()];
        const d = Math.max(20, Math.hypot(a.x - b.x, a.y - b.y));
        wf.zoom = U.clamp(wf.zoom * (d / wf.pinchBase), 0.4, 4);
        wf.pinchBase = d;
      } else if (wf.pointers.size === 1) {
        // 拖动仅旋转视角（yaw/pitch），无平移 → 不会误触坐标移动
        wf.yaw += (e.clientX - prev.x) * 0.008;
        wf.pitch = U.clamp(wf.pitch + (e.clientY - prev.y) * 0.006, -1.25, 1.25);
      }
      wfDraw();
    });
    const endP = (e) => { wf.pointers.delete(e.pointerId); if (wf.pointers.size < 2) wf.pinchBase = 0; };
    cvEl.addEventListener('pointerup', endP);
    cvEl.addEventListener('pointercancel', endP);
    cvEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      wf.zoom = U.clamp(wf.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.4, 4);
      wfDraw();
    }, { passive: false });
    cvEl.addEventListener('dblclick', wfReset);
  }
  function wfInit() {
    wf.canvas = $('#fs-wf3d');
    if (!wf.canvas || wf.canvas.dataset.bound) return;
    wf.canvas.dataset.bound = '1';
    wfBind();
    wfResize();
  }
  $('#fs-harm-view').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    $('#fs-harm-view').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === b));
    const v3d = b.dataset.v === '3d';
    if (v3d) b.closest('details').open = true;   // 自动展开，避免画布 0 高度
    $('#fs-harm-2d').classList.toggle('hidden', v3d);
    $('#fs-harm-3d').classList.toggle('hidden', !v3d);
    if (v3d) { wfInit(); wfResize(); }
    else drawHarmonics();
  });

  // 动画：默认一圈约 24 秒（0.0007/帧 @60fps）
  const loop = U.loop(() => {
    if (state.playing) {
      const prev = state.t;
      state.t = (state.t + 0.0007 * state.speed) % 1;
      if (state.t < prev) traceJustCleared = true;   // 回绕 → 下一帧重画完整闭环
    }
    draw();
  });

  recompute();
  fit(circleCanvas);
  drawHarmonics();
  drawSpec();
  loop.start();

  function togglePlay() { state.playing = !state.playing; return state.playing; }
  // 逐帧：暂停并前进一小步（回绕时下一帧重画完整闭环）
  function frame() {
    state.playing = false;
    const prev = state.t;
    state.t = (state.t + 0.002) % 1;
    if (state.t < prev) traceJustCleared = true;
    draw();
    // 键盘 F 也会走这里，按钮文字必须在此同步，否则暂停后仍显示「⏸ 暂停」
    if (fsPlayBtn) fsPlayBtn.textContent = '▶ 播放';
    return true;
  }
  function reset() {
    state.t = 0; traceTail = []; view.k = 1; view.cx = 0; view.cy = 0;
    if (fsPlayBtn) fsPlayBtn.textContent = state.playing ? '⏸ 暂停' : '▶ 播放';
  }
  const onResize = () => { fitDraw(); draw(); drawHarmonics(); drawSpec(); if (wf.canvas && !$('#fs-harm-3d').classList.contains('hidden')) wfResize(); };
  window.addEventListener('resize', onResize);

  /* ---------- 实验接入：状态捕获 / 回放 ---------- */
  function getState() { return { shape: state.shape, terms: state.terms, speed: state.speed, circles: state.showCircles }; }
  function applyState(sv) {
    if (!sv || typeof sv !== 'object') return;
    if (sv.shape && sv.shape !== state.shape) {
      const chip = shapeRow.querySelector('[data-shape="' + sv.shape + '"]');
      if (chip) chip.click(); else { state.shape = sv.shape; recompute(); }
    }
    if (sv.terms != null && +sv.terms !== state.terms) { termsEl.value = +sv.terms; termsEl.dispatchEvent(new Event('input')); }
    if (sv.speed != null && +sv.speed !== state.speed) { speedEl.value = +sv.speed; speedEl.dispatchEvent(new Event('input')); }
    const cb = $('#fs-circles-toggle');
    if (sv.circles != null && cb.checked !== (sv.circles === true)) { cb.checked = sv.circles === true; cb.dispatchEvent(new Event('change')); }
  }
  RTB.attach($('#fs-rtb'), {
    module: 'fs',
    getState, applyState,
    canvases: () => ['#fs-circles', '#fs-spec', '#fs-harmonics'].map((q) => $(q)).filter(Boolean)
  });
  return { title: '傅立叶级数', api: { togglePlay, frame, reset, dispose, onTheme: () => { repaintDraw(); draw(); drawHarmonics(); drawSpec(); }, getState, applyState } };
  function dispose() {
    loop.stop();
    clearTimeout(fsHashTimer);   // 否则 300ms 后仍会改写 hash，覆盖刚打开模块的地址
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pointerup', endFinger);
    window.removeEventListener('pointercancel', endFinger);
    window.removeEventListener('flt-play', onPlayEvt);
  }
});
