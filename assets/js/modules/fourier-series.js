/* ============================================================
 * fourier-series.js — 傅立叶级数
 *   1) 画圈套画圈：任意闭合路径分解为一圈圈旋转的“圆套圆”
 *      支持滚轮缩放 / 拖拽平移 / 双击复位
 *   2) 谐波叠加：方波逐步由正弦合成（Gibbs 现象）
 * ============================================================ */
App.register('fs', (host) => {
  let state = { shape: 'square', terms: 40, speed: 1, showCircles: true, playing: true, t: 0 };
  let phasors = [];
  let traceTail = [];
  const view = { k: 1, cx: 0, cy: 0 };   // 主画布视图：缩放系数 + 世界坐标中心
  let traceJustCleared = false;

  const shapes = ['square', 'triangle', 'heart', 'star', 'butterfly', 'gear', 'spiral'];
  const shapeNames = { square: '方形路径', triangle: '三角', heart: '爱心', star: '五角星', butterfly: '蝴蝶', gear: '齿轮', spiral: '螺旋' };

  // ---------- DOM ----------
  host.innerHTML = `
    <div class="module layout">
      <div class="pane">
        <h3>配置</h3>
        <div class="ctrl"><label>笔画形状</label>
          <div class="row" id="fs-shapes"></div>
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
        <div class="hint">每条路径经 <b>DFT</b> 分解为若干相量（频域），每个相量贡献一圈旋转的圆：
          <div class="formula-center" id="fs-formula">z(t)</div>
        </div>
        <div class="hint">🖱️ 滚轮缩放 · 拖拽平移 · 双击复位。轨迹画满一个完整周期（绿色闭环）后会自动重新绘制。</div>
        <div class="statbar" id="fs-stats"></div>
      </div>
      <div class="pane">
        <h3>画圈套画圈 · 傅立叶绘制</h3>
        <div class="canvas-wrap" style="height:420px"><canvas class="plot" id="fs-circles"></canvas></div>
        <div class="legend">
          <span><span class="sw" style="background:#5b9bff"></span>目标路径</span>
          <span><span class="sw" style="background:#37d0a0"></span>已合成轨迹</span>
        </div>
      </div>
      <div class="pane full">
        <h3>谐波幅度谱 · 当前形状的 DFT 分解</h3>
        <div class="canvas-wrap" style="height:130px"><canvas class="plot" id="fs-spec"></canvas></div>
        <div class="hint">各谐波相量的幅值 |c<sub>k</sub>|（按频率排列）。谱线随形状变化——这就是"波形分解成谐波"的频域视图。</div>
      </div>
      <div class="pane full">
        <h3>谐波叠加 · 方波逐步合成（Gibbs 现象）</h3>
        <div class="canvas-wrap" style="height:240px"><canvas class="plot" id="fs-harmonics"></canvas></div>
        <div class="legend">
          <span><span class="sw" style="background:#ffb454"></span>方波目标</span>
          <span><span class="sw" style="background:#5b9bff"></span>部分和 S<sub>n</sub></span>
          <span><span class="sw" style="background:#4c5874"></span>叠加中的各次谐波</span>
        </div>
        <div class="hint">方波 = 奇次正弦之和 <b>S<sub>n</sub>(t) = (4/π)·Σ<sub>k=1..n</sub> sin((2k-1)·2πt)/(2k-1)</b>。
          在跳变处始终存在约 9% 的过冲，这是不可消除的 Gibbs 现象，不是动画误差。此图同样支持滚轮缩放与悬停读数。</div>
      </div>
    </div>`;

  const $ = (s) => host.querySelector(s);
  const cv = FX.cvCol;
  const circleCanvas = $('#fs-circles');
  const harmCanvas = $('#fs-harmonics');
  const ctxC = circleCanvas.getContext('2d');
  FX.katex('z(t)=\\sum_{k=-K}^{K} c_k\\,e^{\\,j2\\pi k t},\\quad \\text{每个 } c_k \\text{ 画一个半径}|c_k|\\text{、初相}\\angle c_k\\text{ 的圆}', $('#fs-formula'), { displayMode: true });

  // 形状按钮
  const shapeRow = $('#fs-shapes');
  shapes.forEach((k) => {
    const c = U.el('button', { class: 'chip' + (k === state.shape ? ' active' : ''), 'data-shape': k }, shapeNames[k]);
    c.addEventListener('click', () => {
      shapes.forEach((x) => { const b = shapeRow.querySelector(`[data-shape="${x}"]`); b.className = 'chip'; });
      c.className = 'chip active';
      state.shape = k;
      recompute();
    });
    shapeRow.append(c);
  });

  const termsEl = $('#fs-terms'), termsV = $('#fs-terms-v');
  termsEl.addEventListener('input', () => { state.terms = +termsEl.value; termsV.textContent = state.terms; drawHarmonics(); });
  const speedEl = $('#fs-speed'), speedV = $('#fs-speed-v');
  speedEl.addEventListener('input', () => { state.speed = +speedEl.value; speedV.textContent = state.speed.toFixed(1) + '×'; });
  $('#fs-circles-toggle').addEventListener('change', (e) => state.showCircles = e.target.checked);
  termsV.textContent = state.terms;
  speedV.textContent = '1.0×';

  function fit(sizeEl) {
    sizeEl.width = (sizeEl.clientWidth || sizeEl.parentElement.clientWidth || 400) * (window.devicePixelRatio || 1);
    sizeEl.height = (sizeEl.clientHeight || sizeEl.parentElement.clientHeight || 300) * (window.devicePixelRatio || 1);
  }

  function recompute() {
    const pts = FX_LIB.shapePoints(state.shape, 480);
    phasors = DSP.dftPhasors(pts.filter((p) => !(isNaN(p.re))));
    traceTail = [];
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

  function baseScale() { return Math.min(circleCanvas.clientWidth, circleCanvas.clientHeight) * 0.40; }

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

    // 目标形状（弱显示）
    const pts = FX_LIB.shapePoints(state.shape, 480);
    ctxC.strokeStyle = cv('--cv-circle-a'); ctxC.lineWidth = 1.5;
    ctxC.beginPath();
    for (let i = 0; i < pts.length; i++) { const px = SX(pts[i].re), py = SY(pts[i].im); i ? ctxC.lineTo(px, py) : ctxC.moveTo(px, py); }
    ctxC.closePath(); ctxC.stroke();

    // 圆 & 半径线（裁剪到画布，避免放大后画出面板观感杂乱）
    ctxC.save();
    ctxC.beginPath(); ctxC.rect(0, 0, W, H); ctxC.clip();
    if (state.showCircles) {
      for (let j = 1; j < chain.length; j++) {
        const c = chain[j - 1], n = chain[j];
        const r = n.amp * s;
        ctxC.beginPath();
        ctxC.strokeStyle = j % 2 ? cv('--cv-circle-b') : cv('--cv-circle-a');
        ctxC.lineWidth = 1;
        ctxC.arc(SX(c.x), SY(c.y), Math.max(r, 0.5), 0, 7); ctxC.stroke();
        ctxC.beginPath();
        ctxC.moveTo(SX(c.x), SY(c.y));
        ctxC.lineTo(SX(n.x), SY(n.y));
        ctxC.strokeStyle = cv('--cv-chain'); ctxC.stroke();
      }
    }

    // 链上主相量（亮点）
    const tip = chain[chain.length - 1];
    ctxC.beginPath();
    ctxC.arc(SX(tip.x), SY(tip.y), 5, 0, 7); ctxC.fillStyle = cv('--cv-line1'); ctxC.fill();

    // 轨迹（整周期：t 回绕时清空，完整闭合后再重画）
    if (traceJustCleared) { traceTail = []; traceJustCleared = false; }
    traceTail.push(tip.x, tip.y);
    if (traceTail.length > 3600 * 2) traceTail.splice(0, 2);
    ctxC.lineWidth = 2.5; ctxC.strokeStyle = cv('--cv-line2'); ctxC.lineJoin = 'round';
    ctxC.beginPath();
    for (let i = 0; i < traceTail.length / 2; i++) {
      const px = SX(traceTail[i * 2]), py = SY(traceTail[i * 2 + 1]);
      i ? ctxC.lineTo(px, py) : ctxC.moveTo(px, py);
    }
    ctxC.stroke();
    ctxC.restore();

    // 文字
    ctxC.fillStyle = cv('--cv-tick'); ctxC.font = '11px SFMono-Regular, monospace';
    ctxC.textAlign = 'left';
    ctxC.fillText(`圈数 = ${Math.min(state.terms, phasors.length)} · 最大幅值 ≈ ${U.fmt(phasors[0] ? phasors[0].amp : 0, 3)} · 缩放 ${view.k.toFixed(1)}×`, 12, 20);
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
    // phasors 按幅值排序存储，这里取前 60 个再按频率 |k| 排列
    const top = phasors.slice(0, Math.min(60, phasors.length)).slice().sort((a, b) => Math.abs(a.k) - Math.abs(b.k));
    let maxA = 1e-9;
    for (const q of top) maxA = Math.max(maxA, q.amp);
    p.setRange(0, Math.max(8, top.length), 0, maxA * 1.08);
    p.clear(); p.grid(null, null); p.axis(true);
    p.clip();
    top.forEach((q, i) => {
      p.line([i, i], [0, q.amp], { color: cv('--cv-line3'), width: 4 });
    });
    p.unclip();
    p.crosshair((x) => '序号 ' + Math.round(x), (y, wx) => '|c' + (top[Math.round(wx)] ? '{' + top[Math.round(wx)].k + '}' : '') + '|=' + U.fmt(y, 4));
    p.label('|cₖ| 随频率的分布（前 60 个最强谐波）', p.margin.l + 8, p.margin.t + 14, { color: cv('--cv-label'), size: 11 });
  }
  function rmsErr(n) {
    let s = 0; const M = 2000;
    for (let i = 0; i < M; i++) { const t = (i / M) * 2; const d = squarePartial(t) - squareSum(t, n); s += d * d; }
    return Math.sqrt(s / M);
  }

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
  function reset() { state.t = 0; traceTail = []; view.k = 1; view.cx = 0; view.cy = 0; }
  const onResize = () => { draw(); drawHarmonics(); drawSpec(); };
  window.addEventListener('resize', onResize);

  return { title: '傅立叶级数', api: { togglePlay, reset, dispose, onTheme: () => { draw(); drawHarmonics(); drawSpec(); } } };
  function dispose() { loop.stop(); window.removeEventListener('resize', onResize); }
});
