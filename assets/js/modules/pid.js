/* ============================================================
 * pid.js — PID 闭环整定（自动控制原理）
 *   单位负反馈：r → e → C(s)=Kp+Ki/s+Kd·s → G(s) → y
 *   闭环 T(s)=C·G/(1+C·G)，实时阶跃响应 + 闭环零极点 + 性能指标
 *   指标：超调量 σ%、上升时间 tr、调节时间 ts(±2%)、稳态误差 ess
 * ============================================================ */
App.register('pid', (host) => {
  const cv = FX.cvCol;
  // 多项式工具复用框图内核（与 blocksolve.js 同一实现，避免三处重复）
  const polyMul = BLKSOLVE.polyMul, polyAdd = BLKSOLVE.polyAdd;

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
        <div class="row" style="margin-bottom:10px">
          <input type="text" id="pid-g-in" placeholder="自定义 G(s)，如 (s+3)/(s^2+2*s+5)" spellcheck="false" style="flex:1">
          <button class="btn" id="pid-g-apply" title="把表达式设为被控对象">应用</button>
        </div>
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
        <div id="pid-rtb"></div>
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
  let customG = null;   // { numStr, denStr } — 任意 G(s) 对象（解析成功后挂入 plants.custom）
  const prow = $('#pid-plants');
  function rebuildPlants() {
    prow.innerHTML = '';
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
  }
  rebuildPlants();
  $('#pid-g-apply').addEventListener('click', () => {
    const str = $('#pid-g-in').value.trim();
    if (!str) return;
    const tf = FX_LIB.parseTF(str, 's');
    if (!tf || !tf.den || !tf.den[0]) { App.toast('G(s) 解析失败，示例：(s+3)/(s^2+2*s+5)', 'danger'); return; }
    customG = { numStr: str, denStr: str, num: tf.num, den: tf.den };
    plants.custom = { name: '自定义', num: tf.num, den: tf.den, tex: '\\dfrac{' + texPoly(tf.num) + '}{' + texPoly(tf.den) + '}' };
    plantKey = 'custom';
    rebuildPlants();
    renderG();
    solve();
  });
  $('#pid-g-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#pid-g-apply').click(); });
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
    $('#pid-ctex').append(FX.span('C(s)=K_p+\\dfrac{K_i}{s}+K_d s=\\dfrac{' + texPoly([Kd, Kp, Ki]) + '}{s}'));
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

  // 闭环极点图（共享复平面组件，s 平面模式，静态展示：平移/缩放可用）
  let pzPlane = null, pzPolesNow = [];
  function drawPoles(poles) {
    pzPolesNow = poles;
    if (!pzPlane) {
      pzPlane = new FX.ComplexPlane($('#pid-pz'), {
        mode: 'jw',
        editable: false,
        getSpecs: () => ({ poles: pzPolesNow, zeros: [] })
      });
    }
    pzPlane.resetView();   // 每次求解重新适配新极点（与旧版 R 重算语义一致）
  }

  /* ---------- 主计算 ---------- */
  let lastStep = null;   // 最近一次阶跃仿真（CSV 导出用）
  function solve() {
    const g = plants[plantKey];
    // Ki≈0 时 Nc 与分母 s 有公因子，先约成真分式（C=Kd·s+Kp），否则闭环会多出虚假极点 s=0
    const noKi = Math.abs(Ki) < 1e-12;
    const numC = noKi ? [Kd, Kp] : [Kd, Kp, Ki], denC = noKi ? [1] : [1, 0];   // C(s) = (Kd s² + Kp s + Ki)/s
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
    lastStep = res;

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
    // 仅当仿真结束时已在 ±2% 带内，ts 才有意义；整段未进入带内视为未达标（NaN → 显示「—」）
    let ts = NaN;
    const band = 0.02 * Math.abs(yf);
    const yEnd = y[y.length - 1];
    if (isFinite(yEnd) && Math.abs(yEnd - yf) <= band) {
      for (let i = t.length - 1; i >= 0; i--) {
        if (!isFinite(y[i]) || Math.abs(y[i] - yf) > band) { ts = t[Math.min(i + 1, t.length - 1)]; break; }
      }
    }
    const ess = 1 - yf;
    // 误差积分指标：e(t) = r − y（r=1），梯形积分
    const em = DSP.errMetrics(t, t.map((tv, i) => 1 - y[i]));
    $('#pid-metrics').innerHTML = `
      <div class="stat"><span class="k">超调量 σ%</span><span class="v">${isFinite(sigma) && sigma > 0.5 ? U.fmt(sigma, 1) + '%' : '≈0'}</span></div>
      <div class="stat"><span class="k">上升时间 tr</span><span class="v">${isFinite(tr) && tr > 0 ? U.fmt(tr, 3) + 's' : '—'}</span></div>
      <div class="stat"><span class="k">调节时间 ts(±2%)</span><span class="v">${isFinite(ts) && !unstable ? U.fmt(ts, 3) + 's' : '—'}</span></div>
      <div class="stat"><span class="k">稳态误差 ess</span><span class="v" style="color:${Math.abs(ess) < 0.01 ? cv('--cv-line2') : cv('--cv-warn')}">${U.fmt(ess, 3)}</span></div>
      <div class="stat"><span class="k">稳态值 y∞</span><span class="v">${U.fmt(yf, 3)}</span></div>
      <div class="stat"><span class="k">ISE / IAE</span><span class="v">${U.fmt(em.ise, 3)} / ${U.fmt(em.iae, 3)}</span></div>
      <div class="stat"><span class="k">ITAE</span><span class="v">${U.fmt(em.itae, 3)}</span></div>`;
    $('#pid-stability').innerHTML = unstable
      ? `<span style="color:var(--danger)">✗ 闭环不稳定：${rhp} 个极点在右半平面，输出发散</span>`
      : `<span style="color:var(--accent-2)">✓ 闭环稳定：所有极点在左半平面</span>`;

    drawPoles(poles);
    $('#pid-poles').textContent = '闭环极点：' + poles.map(fmtC).join('，');
  }

  renderG();
  syncSliders();
  solve();

  /* ---------- 实验接入：状态捕获 / 回放 / 统一结果工具栏 ---------- */
  function setPlant(k) {
    if (!plants[k]) return;
    plantKey = k;
    prow.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.k === k));
    renderG();
  }
  function getState() {
    const s = { plant: plantKey, kp: Kp, ki: Ki, kd: Kd };
    if (customG) s.g = { expr: customG.numStr };
    return s;
  }
  function applyState(s) {
    if (!s || typeof s !== 'object') return;
    if (s.plant === 'custom' && s.g && s.g.expr) {
      $('#pid-g-in').value = String(s.g.expr);
      $('#pid-g-apply').click();   // 解析 + 挂 custom + rebuildPlants + renderG + solve
    } else if (s.plant) {
      setPlant(s.plant);
    }
    Kp = +s.kp || 0; Ki = +s.ki || 0; Kd = +s.kd || 0;
    syncSliders();
    solve();
  }
  RTB.attach($('#pid-rtb'), {
    module: 'pid',
    getState, applyState,
    canvases: () => ['#pid-step', '#pid-pz'].map((s) => $(s)).filter(Boolean),
    csv: () => {
      if (!lastStep) return null;
      return {
        name: 'step',
        header: ['t(s)', 'y(t)'],
        rows: lastStep.t.map((t, i) => [t.toPrecision(6), lastStep.y[i].toPrecision(6)])
      };
    }
  });

  return { title: 'PID 整定', api: { dispose, onTheme: () => { renderG(); solve(); }, getState, applyState } };
  function dispose() { }
});
