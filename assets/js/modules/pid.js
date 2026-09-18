/* ============================================================
 * pid.js — PID 闭环整定（自动控制原理）
 *   单位负反馈：r → e → C(s)=Kp+Ki/s+Kd·s → G(s) → y
 *   闭环 T(s)=C·G/(1+C·G)，实时阶跃响应 + 闭环零极点 + 性能指标
 *   指标：超调量 σ%、上升时间 tr、调节时间 ts(±2%)、稳态误差 ess
 * ============================================================ */
App.register('pid', (host) => {
  const cv = FX.cvCol;
  const polyMul = (a, b) => { const o = new Array(a.length + b.length - 1).fill(0); for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) o[i + j] += a[i] * b[j]; return o; };
  const polyAdd = (a, b) => { const n = Math.max(a.length, b.length), o = new Array(n).fill(0); for (let i = 0; i < a.length; i++) o[n - a.length + i] += a[i]; for (let i = 0; i < b.length; i++) o[n - b.length + i] += b[i]; return o; };

  const plants = {
    p1: { name: '一阶惯性', num: [1], den: [1, 1], tex: '\\dfrac{1}{s+1}' },
    p2: { name: '二阶系统', num: [1], den: [1, 0.5, 1], tex: '\\dfrac{1}{s^2+0.5s+1}' },
    integ: { name: '积分+惯性', num: [1], den: [1, 2, 0], tex: '\\dfrac{1}{s(s+2)}' },
    two: { name: '双惯性', num: [1], den: [1, 4, 3], tex: '\\dfrac{1}{(s+1)(s+3)}' },
    uns: { name: '不稳定对象', num: [1], den: [1, -0.3, 1], tex: '\\dfrac{1}{s^2-0.3s+1}' }
  };
  let plantKey = 'p2';
  let Kp = 2, Ki = 0, Kd = 0;

  host.innerHTML = `
    <div class="module layout">
      <div class="pane">
        <h3>被控对象 G(s)</h3>
        <div class="row" id="pid-plants" style="margin-bottom:10px"></div>
        <div class="formula-center" id="pid-gtex"></div>
        <h3 style="margin-top:14px">PID 控制器</h3>
        <div class="formula-center" style="margin-bottom:10px" id="pid-ctex"></div>
        <div class="ctrl"><label>比例 Kp <span class="val" id="pid-kpv"></span></label>
          <input type="range" id="pid-kp" min="0" max="20" step="0.1" value="2"></div>
        <div class="ctrl"><label>积分 Ki <span class="val" id="pid-kiv"></span></label>
          <input type="range" id="pid-ki" min="0" max="10" step="0.1" value="0"></div>
        <div class="ctrl"><label>微分 Kd <span class="val" id="pid-kdv"></span></label>
          <input type="range" id="pid-kd" min="0" max="5" step="0.1" value="0"></div>
        <div class="row" id="pid-recipes" style="margin-bottom:8px"></div>
        <div class="hint">单位负反馈闭环 <b>T(s)=C·G/(1+C·G)</b>。经验：Kp 加快响应但增大超调；Ki 消除稳态误差但易振荡；Kd 增大阻尼、抑制超调（对噪声敏感）。试试用「不稳定对象」把它拉回稳定！</div>
      </div>
      <div class="pane">
        <h3>闭环阶跃响应（设定值 r = 1）</h3>
        <div class="canvas-wrap" style="height:250px"><canvas class="plot" id="pid-step"></canvas></div>
        <div class="statbar" id="pid-metrics"></div>
        <div class="legend" id="pid-stability"></div>
        <div class="legend">
          <span><span class="sw" style="background:#5b9bff"></span>输出 y(t)</span>
          <span><span class="sw" style="background:#4c5874"></span>稳态值 y∞</span>
          <span><span class="sw" style="background:#ffb454"></span>超调峰</span>
        </div>
      </div>
      <details class="pane full plot-fold">
        <summary>闭环传函与零极点分布</summary>
        <div class="layout right-side">
          <div class="pane">
            <h3>闭环极点（s 平面）</h3>
            <div class="canvas-wrap" style="height:230px"><canvas class="plot" id="pid-pz"></canvas></div>
          </div>
          <div class="pane">
            <h3>闭环传函 T(s)</h3>
            <div class="formula-center" id="pid-ttex"></div>
            <div class="hint" id="pid-poles"></div>
            <div class="hint">闭环极点越靠左 → 响应越快；共轭复极点的幅角决定振荡程度；极点进入右半平面 → 输出发散。</div>
          </div>
        </div>
      </details>
    </div>`;

  const $ = (s) => host.querySelector(s);
  function texPoly(c) { return U.polyTex(c); }
  const fmtC = (z) => U.fmt(z.re, 2) + (Math.abs(z.im) > 1e-9 ? (z.im >= 0 ? '+' : '') + U.fmt(z.im, 2) + 'j' : '');

  /* ---------- 对象选择 ---------- */
  const prow = $('#pid-plants');
  Object.entries(plants).forEach(([k, p]) => {
    const c = U.el('button', { class: 'chip' + (k === plantKey ? ' active' : ''), 'data-k': k }, p.name);
    c.addEventListener('click', () => {
      plantKey = k;
      prow.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === c));
      renderG();
      solve();
    });
    prow.append(c);
  });
  function renderG() {
    const box = $('#pid-gtex');
    box.innerHTML = '';
    box.append(FX.span('G(s)=' + plants[plantKey].tex));
  }

  /* ---------- 整定套路一键填入 ---------- */
  const recipes = [
    ['纯 P', { Kp: 2, Ki: 0, Kd: 0 }],
    ['PI', { Kp: 2, Ki: 1, Kd: 0 }],
    ['PID（常用）', { Kp: 3, Ki: 1, Kd: 1 }],
    ['强阻尼', { Kp: 1.5, Ki: 0.3, Kd: 1.2 }]
  ];
  const rrow = $('#pid-recipes');
  recipes.forEach(([name, v]) => {
    const c = U.el('button', { class: 'chip' }, name);
    c.addEventListener('click', () => { Kp = v.Kp; Ki = v.Ki; Kd = v.Kd; syncSliders(); solve(); });
    rrow.append(c);
  });

  /* ---------- 滑块 ---------- */
  const sliderDefs = [['pid-kp', 'pid-kpv', () => Kp, (v) => { Kp = v; }], ['pid-ki', 'pid-kiv', () => Ki, (v) => { Ki = v; }], ['pid-kd', 'pid-kdv', () => Kd, (v) => { Kd = v; }]];
  function syncSliders() {
    sliderDefs.forEach(([id, vid, get]) => {
      $('#' + id).value = get();
      $('#' + vid).textContent = get().toFixed(1);
    });
    $('#pid-ctex').innerHTML = '';
    $('#pid-ctex').append(FX.span('C(s)=K_p+\\dfrac{K_i}{s}+K_d s=' + texPoly([Kd, Kp, Ki])));
  }
  sliderDefs.forEach(([id, vid, get, set]) => {
    $('#' + id).addEventListener('input', (e) => { set(+e.target.value); $('#' + vid).textContent = (+e.target.value).toFixed(1); solve(); });
  });

  /* ---------- 绘图 ---------- */
  let stepPlot = null;
  function drawStep(res, yInf, unstable) {
    if (!stepPlot) { stepPlot = new FX.Plot($('#pid-step'), { margin: { l: 48, r: 14, t: 12, b: 28 } }); stepPlot.onDraw = () => solve(); }
    const p = stepPlot;
    let lo = Infinity, hi = -Infinity;
    for (const v of res.y) if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 0.2) { hi = lo + 0.5; }
    lo = Math.min(lo, 0) - (hi - lo) * 0.08; hi += (hi - lo) * 0.1;
    p.setRange(res.t[0], res.t[res.t.length - 1], lo, hi);
    p.clear(); p.grid(); p.axis(true);
    p.clip();
    // 设定值与稳态值
    p.line([res.t[0], res.t[res.t.length - 1]], [1, 1], { color: cv('--cv-tick'), width: 1 });
    if (isFinite(yInf)) p.line([res.t[0], res.t[res.t.length - 1]], [yInf, yInf], { color: cv('--cv-chain'), width: 1 });
    p.line(res.t, res.y, { color: unstable ? cv('--cv-danger') : cv('--cv-line1'), width: 2.2 });
    p.unclip();
    p.crosshair((t) => 't=' + U.fmt(t, 3), (y) => 'y=' + U.fmt(y, 4));
  }

  // 闭环极点图（参数名 cvEl，避免遮蔽 FX.cvCol）
  let pzCanvas = null;
  function drawPoles(poles) {
    const cvEl = $('#pid-pz');
    pzCanvas = cvEl;
    const W = cvEl.clientWidth || 420, H = cvEl.clientHeight || 230;
    const dpr = window.devicePixelRatio || 1;
    cvEl.width = W * dpr; cvEl.height = H * dpr;
    const g = cvEl.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H); g.fillStyle = cv('--cv-bg'); g.fillRect(0, 0, W, H);
    const ml = 36, mr = 12, mt = 12, mb = 22, dw = W - ml - mr, dh = H - mt - mb;
    const cx = ml + dw / 2, cy = mt + dh / 2;
    let R = 1.5; for (const q of poles) R = Math.max(R, Math.abs(q.re) + 0.5, Math.abs(q.im) + 0.5);
    const SX = (r) => cx + (r * dw / 2) / R, SY = (i) => cy - (i * dh / 2) / R;
    g.fillStyle = cv('--cv-stable-bg'); g.fillRect(ml, mt, cx - ml, dh);
    g.fillStyle = cv('--cv-unstable-bg'); g.fillRect(cx, mt, ml + dw - cx, dh);
    g.strokeStyle = cv('--cv-grid');
    for (let i = 0; i <= 4; i++) { const x = ml + i * dw / 4; g.beginPath(); g.moveTo(x, mt); g.lineTo(x, mt + dh); g.stroke(); }
    for (let i = 0; i <= 4; i++) { const y = mt + i * dh / 4; g.beginPath(); g.moveTo(ml, y); g.lineTo(ml + dw, y); g.stroke(); }
    g.strokeStyle = cv('--cv-axis-hi'); g.lineWidth = 1.4; g.beginPath(); g.moveTo(cx, mt); g.lineTo(cx, mt + dh); g.stroke();
    g.strokeStyle = cv('--cv-axis'); g.beginPath(); g.moveTo(ml, cy); g.lineTo(ml + dw, cy); g.stroke();
    g.fillStyle = cv('--cv-tick'); g.font = '10px monospace'; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('jω', cx + 4, mt + 2); g.fillText('σ', ml + dw - 12, cy + 4);
    g.strokeStyle = cv('--cv-danger'); g.lineWidth = 2;
    for (const q of poles) {
      const x = SX(q.re), y = SY(q.im);
      g.beginPath(); g.moveTo(x - 6, y - 6); g.lineTo(x + 6, y + 6); g.moveTo(x - 6, y + 6); g.lineTo(x + 6, y - 6); g.stroke();
    }
  }

  /* ---------- 主计算 ---------- */
  function solve() {
    const g = plants[plantKey];
    const numC = [Kd, Kp, Ki], denC = [1, 0];   // C(s) = (Kd s² + Kp s + Ki)/s
    const N0 = polyMul(numC, g.num);
    const D0 = polyAdd(polyMul(denC, g.den), N0);
    const n0 = D0[0] || 1;
    const N = N0.map((c) => c / n0), D = D0.map((c) => c / n0);

    const texBox = $('#pid-ttex');
    texBox.innerHTML = '';
    texBox.append(FX.span('T(s)=\\dfrac{' + texPoly(N) + '}{' + texPoly(D) + '}'));

    const poles = DSP.polyRoots(D);
    const unstable = poles.some((q) => q.re > 1e-9);
    const rhp = poles.filter((q) => q.re > 1e-9).length;

    let nearest = Infinity;
    poles.forEach((q) => { const ar = Math.abs(q.re); if (ar > 1e-9) nearest = Math.min(nearest, ar); });
    const tmax = unstable ? 6 : U.clamp(5 / (nearest || 1), 1, 30);
    const steps = 3000;
    const res = DSP.ltiResponse(N, D, (t) => (t >= 0 ? 1 : 0), 0, tmax, steps);

    const yInf = D[D.length - 1] !== 0 ? N[N.length - 1] / D[D.length - 1] : NaN;
    drawStep(res, yInf, unstable);

    // 性能指标
    const y = res.y, t = res.t;
    const yf = isFinite(yInf) ? yInf : y[y.length - 1];
    let ymax = -Infinity; for (const v of y) if (isFinite(v)) ymax = Math.max(ymax, v);
    const sigma = Math.abs(yf) > 1e-9 ? Math.max(0, (ymax - yf) / Math.abs(yf) * 100) : NaN;
    let tr = NaN, t10 = null;
    for (let i = 0; i < t.length; i++) {
      if (t10 == null && y[i] >= 0.1 * yf) t10 = t[i];
      if (t10 != null && y[i] >= 0.9 * yf) { tr = t[i] - t10; break; }
    }
    let ts = NaN;
    const band = 0.02 * Math.abs(yf);
    for (let i = t.length - 1; i >= 0; i--) {
      if (!isFinite(y[i]) || Math.abs(y[i] - yf) > band) { ts = t[Math.min(i + 1, t.length - 1)]; break; }
    }
    const ess = 1 - yf;
    $('#pid-metrics').innerHTML = `
      <div class="stat"><span class="k">超调量 σ%</span><span class="v">${isFinite(sigma) && sigma > 0.5 ? U.fmt(sigma, 1) + '%' : '≈0'}</span></div>
      <div class="stat"><span class="k">上升时间 tr</span><span class="v">${isFinite(tr) && tr > 0 ? U.fmt(tr, 3) + 's' : '—'}</span></div>
      <div class="stat"><span class="k">调节时间 ts(±2%)</span><span class="v">${isFinite(ts) && !unstable ? U.fmt(ts, 3) + 's' : '—'}</span></div>
      <div class="stat"><span class="k">稳态误差 ess</span><span class="v" style="color:${Math.abs(ess) < 0.01 ? cv('--cv-line2') : cv('--cv-warn')}">${U.fmt(ess, 3)}</span></div>
      <div class="stat"><span class="k">稳态值 y∞</span><span class="v">${U.fmt(yf, 3)}</span></div>`;
    $('#pid-stability').innerHTML = unstable
      ? `<span style="color:var(--danger)">✗ 闭环不稳定：${rhp} 个极点在右半平面，输出发散</span>`
      : `<span style="color:var(--accent-2)">✓ 闭环稳定：所有极点在左半平面</span>`;

    drawPoles(poles);
    $('#pid-poles').textContent = '闭环极点：' + poles.map(fmtC).join('，');
  }

  renderG();
  syncSliders();
  solve();

  return { title: 'PID 整定', api: { dispose, onTheme: () => { renderG(); solve(); } } };
  function dispose() { }
});
