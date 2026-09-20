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
        <details class="plot-fold" id="pid-tune-fold" style="margin:6px 0">
          <summary>整定向导（Ziegler–Nichols / Cohen–Coon / CHR）</summary>
          <div class="row" style="margin:6px 0">
            <button class="btn" id="pid-tune-zn" title="纯 P 闭环找等幅振荡：Ku 与 Tu">临界比例度法（ZN 闭环）</button>
            <button class="btn" id="pid-tune-rc" title="开环阶跃响应拟合 FOPDT 后套公式">反应曲线法（开环两点法）</button>
          </div>
          <div id="pid-tune-out"></div>
          <div class="row" style="margin:8px 0 4px;align-items:center">
            <span class="hint" style="margin:0">最优搜索（坐标下降，≤300 次仿真，含当前限幅/滤波约束）：</span>
            <span id="pid-opt-metric" class="row" style="margin:0;gap:4px"></span>
            <button class="btn" id="pid-opt-go">按指标寻优</button>
          </div>
          <div class="hint">应用整定参数会同时设置滑杆（含 Tf=Td/10 微分滤波）并重算。ZN 闭环要求开环相位能滞后到 −180°（如含积分/高阶对象）；反应曲线法要求开环阶跃响应收敛（不含积分对象）。</div>
        </details>
        <div id="pid-rtb"></div>
        <details class="plot-fold" id="pid-adv-fold" style="margin:8px 0">
          <summary>执行器与控制器细节（限幅 / 抗饱和 / 微分滤波 / 微分先行 / 数字 PID）</summary>
          <div class="ctrl row" style="flex-wrap:wrap">
            <label class="chip">执行器限幅 uMax <input type="number" id="pid-umax" step="any" placeholder="无限" style="width:70px;background:transparent;border:0;color:var(--accent);font-family:var(--mono)"></label>
            <span class="hint" style="margin:0">抗饱和</span>
            <span id="pid-aw-chips" class="row" style="margin:0;gap:4px"></span>
            <label class="chip" title="反算抗饱和时间常数">Tt <input type="number" id="pid-tt" step="any" value="1" style="width:56px;background:transparent;border:0;color:var(--accent);font-family:var(--mono)"></label>
          </div>
          <div class="ctrl row" style="flex-wrap:wrap;margin-top:6px">
            <label class="chip" title="不完全微分：D 项一阶低通">微分滤波 Tf <input type="number" id="pid-tf" step="any" value="0" style="width:60px;background:transparent;border:0;color:var(--accent);font-family:var(--mono)"></label>
            <button class="chip" id="pid-donm">微分先行：关</button>
            <label class="chip" title="控制器离散更新周期（ZOH 保持），0=连续">数字 PID 采样 Ts <input type="number" id="pid-ts" step="any" value="0" style="width:70px;background:transparent;border:0;color:var(--accent);font-family:var(--mono)"></label>
          </div>
          <div class="hint">响应曲线来自时域环路仿真（对象 RK4 + 控制器离散更新）；上方 T(s) 与闭环极点仍为理想控制器分析。注意：Kd 较大且无 Tf 时，离散理想微分高频发散——请配合微分滤波使用。</div>
        </details>
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
  // 控制器细节（执行器/抗饱和/滤波/先行/采样）
  let uMax = null, aw = 'off', Tt = 1, Tf = 0, dOnM = false, Ts = 0;
  {
    const awRow = $('#pid-aw-chips');
    [['off', '关'], ['clamp', '条件积分'], ['back', '反算']].forEach(([k, label]) => {
      const b = U.el('button', { class: 'chip' + (k === aw ? ' active' : ''), 'data-aw': k }, label);
      b.addEventListener('click', () => {
        aw = k;
        awRow.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.aw === k));
        solve();
      });
      awRow.append(b);
    });
    $('#pid-umax').addEventListener('change', (e) => { uMax = e.target.value === '' || !isFinite(+e.target.value) ? null : Math.abs(+e.target.value); solve(); });
    $('#pid-tt').addEventListener('change', (e) => { Tt = +e.target.value > 0 ? +e.target.value : 1; solve(); });
    $('#pid-tf').addEventListener('change', (e) => { Tf = Math.max(0, +e.target.value || 0); solve(); });
    $('#pid-ts').addEventListener('change', (e) => { Ts = Math.max(0, +e.target.value || 0); solve(); });
    $('#pid-donm').addEventListener('click', (e) => { dOnM = !dOnM; e.target.textContent = '微分先行：' + (dOnM ? '开（对测量值微分）' : '关'); e.target.classList.toggle('active', dOnM); solve(); });
  }
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
    const tmax = unstable ? 6 : U.clamp(5 / (nearest || 1), 1, 30) * (uMax != null ? 1.6 : 1);   // 限幅减慢上升，窗口相应加长
    const steps = 3000;
    // 时域环路仿真（含限幅/抗饱和/滤波/先行/采样），对象为严格真分式
    const res = DSP.pidLoopSim(g.num, g.den, { kp: Kp, ki: Ki, kd: Kd, Tf, dOnM }, { tmax, steps, uMax, aw, Tt, Ts });
    if (!res.ok) { $('#pid-metrics').innerHTML = `<span style="color:var(--danger)">仿真失败：${res.note}</span>`; return; }
    lastStep = res;

    const yInfIdeal = D[D.length - 1] !== 0 ? N[N.length - 1] / D[D.length - 1] : NaN;
    // 有限幅时以仿真末值评估稳态（理想稳态值可能不可达）
    const yEnd = res.y[res.y.length - 1];
    const yf = uMax != null ? (isFinite(yEnd) ? yEnd : yInfIdeal) : (isFinite(yInfIdeal) ? yInfIdeal : yEnd);
    drawStep(res, yf, unstable);

    // 性能指标
    const y = res.y, t = res.t;
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
    const yTail = y[y.length - 1];
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
    s.adv = { uMax, aw, Tt, Tf, dOnM, Ts };
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
    const a = s.adv && typeof s.adv === 'object' ? s.adv : {};
    uMax = a.uMax != null && isFinite(+a.uMax) ? Math.abs(+a.uMax) : null;
    aw = ['clamp', 'back'].includes(a.aw) ? a.aw : 'off';
    Tt = +a.Tt > 0 ? +a.Tt : 1;
    Tf = Math.max(0, +a.Tf || 0);
    dOnM = a.dOnM === true;
    Ts = Math.max(0, +a.Ts || 0);
    $('#pid-umax').value = uMax != null ? uMax : '';
    $('#pid-tt').value = Tt; $('#pid-tf').value = Tf; $('#pid-ts').value = Ts;
    $('#pid-aw-chips').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.aw === aw));
    const donm = $('#pid-donm');
    donm.textContent = '微分先行：' + (dOnM ? '开（对测量值微分）' : '关');
    donm.classList.toggle('active', dOnM);
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
        header: ['t(s)', 'y(t)', 'u(控制器输出)'],
        rows: lastStep.t.map((t, i) => [t.toPrecision(6), lastStep.y[i].toPrecision(6), lastStep.u[i].toPrecision(6)])
      };
    }
  });

  /* ---------- 整定向导（ZN 临界比例度 / 反应曲线 FOPDT：ZN·CC·CHR + 指标寻优） ---------- */
  {
    const out = () => $('#pid-tune-out');
    const applyGains = (name, kp, ki, kd) => {
      Kp = kp; Ki = ki || 0; Kd = kd || 0;
      if (Kd > 0 && Kp > 0) { Tf = +(Kd / (10 * Kp)).toFixed(4); $('#pid-tf').value = Tf; }   // 经典规则 Tf = Td/10（Td=Kd/Kp）
      syncSliders();
      solve();
      App.toast('已应用 ' + name + '：Kp=' + Kp.toFixed(2) + ' Ki=' + Ki.toFixed(2) + ' Kd=' + Kd.toFixed(2));
    };
    const fmt2 = (v) => (v == null ? '—' : U.fmt(v, 3));
    const renderRows = (title, rows, extra) => {
      let html = `<p class="hint" style="margin:6px 0 2px">${title}</p><table class="tbl" style="max-width:460px"><tr><th>控制器</th><th>Kp</th><th>Ki</th><th>Kd</th><th></th></tr>`;
      rows.forEach(([name, kp, ki, kd], i) => {
        html += `<tr><td>${name}</td><td>${fmt2(kp)}</td><td>${fmt2(ki)}</td><td>${fmt2(kd)}</td><td><button class="chip" data-tune="${i}">应用</button></td></tr>`;
      });
      html += '</table>' + (extra || '');
      out().innerHTML = html;
      out().querySelectorAll('[data-tune]').forEach((b) => b.addEventListener('click', () => {
        const [name, kp, ki, kd] = rows[+b.dataset.tune];
        applyGains(name, kp, ki, kd);
      }));
    };
    $('#pid-tune-zn').addEventListener('click', () => {
      const g = plants[plantKey];
      const r = DSP.znUltimate(g.num, g.den);
      if (!r.ok) { out().innerHTML = `<p class="hint" style="color:var(--warn)">⚠ ${r.note}</p>`; return; }
      const [Ku, Tu] = [r.Ku, r.Tu];
      const rows = [
        ['P', 0.5 * Ku, null, null],
        ['PI', 0.45 * Ku, (0.45 * Ku) / (r.Tu / 1.2), null],
        ['PID', 0.6 * Ku, (0.6 * Ku) / (0.5 * Tu), 0.6 * Ku * 0.125 * Tu]
      ];
      renderRows(`临界比例度法：Ku = ${U.fmt(Ku, 3)}，Tu = ${U.fmt(Tu, 3)}s（ω_pc = ${U.fmt(r.wpc, 3)} rad/s）。ZN 公式：P 0.5Ku · PI 0.45Ku,Ti=Tu/1.2 · PID 0.6Ku,Ti=0.5Tu,Td=0.125Tu；应用 PID 时自动设 Tf=Td/10。`, rows);
    });
    $('#pid-tune-rc').addEventListener('click', () => {
      const g = plants[plantKey];
      const poles = DSP.polyRoots(g.den);
      if (poles.some((q) => q.re > 1e-9)) { out().innerHTML = '<p class="hint" style="color:var(--danger)">开环不稳定，反应曲线法不适用</p>'; return; }
      let nearest = Infinity;
      for (const q of poles) { const ar = Math.abs(q.re); if (ar > 1e-9) nearest = Math.min(nearest, ar); }
      const tmax = U.clamp(8 / (nearest || 1), 2, 80);
      const open = DSP.ltiResponse(g.num, g.den, (t) => (t >= 0 ? 1 : 0), 0, tmax, 2000);
      const fit = DSP.fopdtFit(open.t, open.y);
      if (!fit.ok) { out().innerHTML = `<p class="hint" style="color:var(--warn)">⚠ ${fit.note}</p>`; return; }
      const { K, T, L } = fit;
      if (L < 0.01 * T) {
        out().innerHTML = `<p class="hint" style="margin:6px 0">FOPDT 拟合：K = ${U.fmt(K, 3)}，T = ${U.fmt(T, 3)}s，L ≈ 0（无可辨识纯迟延）。反应曲线类公式在 L→0 时退化（增益发散），此类对象建议用<b>临界比例度法</b>。</p>`;
        return;
      }
      const rows = [
        ['ZN 开环 PID', (1.2 * T) / (K * L), 2 * L, 0.5 * L],
        ['Cohen–Coon', (T / (K * L)) * (4 / 3 + L / (4 * T)), (L * (32 + 6 * L / T)) / (13 + 8 * L / T), (4 * L) / (11 + 2 * L / T)],
        ['CHR 0%', (0.6 * T) / (K * L), T, 0.5 * L],
        ['CHR 20%', (0.95 * T) / (K * L), 1.357 * T, 0.473 * L]
      ];
      renderRows(`反应曲线法（两点法拟合 FOPDT）：K = ${U.fmt(K, 3)}，T = ${U.fmt(T, 3)}s，L = ${U.fmt(L, 3)}s（纯迟延）。表中 Ki=Kp/Ti、Kd=Kp·Td；应用时自动设 Tf=Td/10。`, rows, '<p class="hint" style="margin-top:4px">ZN 开环：Kp=1.2T/(KL), Ti=2L, Td=0.5L · Cohen–Coon / CHR 按标准公式表。</p>');
    });

    let optMetric = 'itae';
    {
      const mRow = $('#pid-opt-metric');
      [['ise', 'ISE'], ['iae', 'IAE'], ['itae', 'ITAE']].forEach(([k, label]) => {
        const c = U.el('button', { class: 'chip' + (k === optMetric ? ' active' : ''), 'data-m': k }, label);
        c.addEventListener('click', () => {
          optMetric = k;
          mRow.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.m === k));
        });
        mRow.append(c);
      });
    }
    $('#pid-opt-go').addEventListener('click', () => {
      const g = plants[plantKey];
      const poles = DSP.polyRoots(g.den);
      let nearest = Infinity;
      for (const q of poles) { const ar = Math.abs(q.re); if (ar > 1e-9) nearest = Math.min(nearest, ar); }
      const btn = $('#pid-opt-go');
      btn.disabled = true;
      const restore = () => { btn.disabled = false; btn.textContent = '按指标寻优'; };
      btn.textContent = '计算中…';
      // Worker 池执行（不支持时自动回退主线程）；超时 60s 终止
      WP.run('DSP.pidOptimize', [g.num, g.den, optMetric, { kp: Kp, ki: Ki, kd: Kd, Tf, dOnM }, {
        tmax: U.clamp(8 / (nearest || 1), 2, 40), steps: 1500, maxSims: 300,
        uMax, aw, Tt, Ts
      }], { timeout: 60000 }).then((r) => {
        restore();
        if (!r.ok) { $('#pid-tune-out').innerHTML = `<p class="hint" style="color:var(--danger)">✗ ${r.error || '计算失败'}</p>`; return; }
      const res = r.value;   // 解开信封 {ok, value}
      const rows = [
        ['寻优前（当前）', res.start.kp, res.start.ki, res.start.kd],
        ['寻优后', res.gains.kp, res.gains.ki, res.gains.kd]
      ];
        renderRows(`${optMetric.toUpperCase()} 寻优：${U.fmt(res.startValue, 3)} → ${U.fmt(res.value, 3)}（降幅 ${(100 * (1 - res.value / res.startValue)).toFixed(1)}%，共 ${res.sims} 次仿真；约束随当前限幅/抗饱和/采样设置）`, rows, '<p class="hint" style="margin-top:4px">坐标下降为确定性局部寻优——结果依赖起点，可先套 ZN/CHR 参数再寻优。</p>');
      });
    });
  }

  return { title: 'PID 整定', api: { dispose, onTheme: () => { renderG(); solve(); }, getState, applyState } };
  function dispose() { if (pzPlane) { pzPlane.dispose(); pzPlane = null; } }
});
