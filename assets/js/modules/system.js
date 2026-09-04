/* ============================================================
 * system.js — 系统分析
 *   传递函数 → 波特图 / 奈奎斯特图 / 根轨迹（可切换查看）
 *   + 阶跃 & 脉冲响应 + 稳定性与指标
 *   所有图支持滚轮缩放、拖拽平移、双击复位、悬停精度读数
 * ============================================================ */
App.register('sys', (host) => {
  const cv = FX.cvCol;
  let num, den;
  let chart = 'bode';                 // bode | nyquist | root
  const plots = {};                   // canvas id -> Plot
  const cache = {};                   // 计算缓存（solve 后清空）

  const presets = {
    lp1: { name: '一阶低通', v: '1/(s+1)' },
    lp2: { name: '二阶低通', v: '1/(s^2+0.5*s+1)' },
    hp: { name: '高通', v: '(s)/(s+1)' },
    bp: { name: '带通', v: '(0.9*s)/(s^2+0.4*s+1.21)' },
    notch: { name: '陷波', v: '(s^2+1)/(s^2+0.4*s+4)' },
    lead: { name: '超前(引入零点)', v: '(s+2)/(s+0.5)' },
    int: { name: '积分器', v: '1/s' },
    ins: { name: '不稳定(参考)', v: '1/(s^2-0.3*s+1)' }
  };

  host.innerHTML = `
    <div class="module layout">
      <div class="pane">
        <h3>传递函数 H(s)</h3>
        <div class="tf-frac">
          <input type="text" id="sys-num" value="1" placeholder="分子  如 1 或 (s+2)" spellcheck="false" aria-label="分子">
          <div class="tf-bar" title="分数线"></div>
          <input type="text" id="sys-den" value="s^2+2*s+5" placeholder="分母  如 s^2+2*s+5 或 (s+1)*(s+2)" spellcheck="false" aria-label="分母">
        </div>
        <div class="row" id="sys-struct" style="margin-bottom:10px"></div>
        <button class="btn primary" id="sys-apply" style="margin-bottom:12px">求解并绘图</button>
        <h3>预设</h3>
        <div class="row" id="sys-presets" style="margin-bottom:12px"></div>
        <div class="formula-center" id="sys-tex"></div>
        <div class="statbar" id="sys-metrics"></div>
        <div class="hint">按分数线填写分子 / 分母，支持因式 <code>(s+2)*(s+3)</code>。结构按钮可一键套模板。
          图表：<b>滚轮缩放 · 拖底边/右边/右下角改图框 · 双击复位</b>。</div>
      </div>
      <div class="pane">
        <div class="row" id="sys-charts" style="margin-bottom:10px"></div>
        <div id="sys-chart-bode">
          <h3>波特图 Bode（对数频率）</h3>
          <div class="canvas-wrap" style="height:170px"><canvas class="plot" id="sys-bmag"></canvas></div>
          <div class="canvas-wrap" style="height:140px;margin-top:8px"><canvas class="plot" id="sys-bph"></canvas></div>
          <div class="legend">
            <span><span class="sw" style="background:var(--accent)"></span>幅频 20log|H(jω)| dB</span>
            <span><span class="sw" style="background:var(--purple)"></span>相频 ∠H(jω) °</span>
          </div>
        </div>
        <div id="sys-chart-nyq" class="hidden">
          <h3>奈奎斯特图 G(jω)（ω: 0⁺ → ∞）</h3>
          <div class="canvas-wrap" style="height:330px"><canvas class="plot" id="sys-nyq"></canvas></div>
          <div class="hint" id="sys-nyq-note"></div>
        </div>
        <div id="sys-chart-root" class="hidden">
          <h3>根轨迹（K: 0 → ∞，闭环特征根 1+K·G(s)=0）</h3>
          <div class="canvas-wrap" style="height:330px"><canvas class="plot" id="sys-root"></canvas></div>
          <div class="hint">× = 开环极点（K=0 起点），○ = 开环零点。轨迹进入右半平面（红色区）即该 K 下闭环不稳定；悬停轨迹可读出对应 K 值。</div>
        </div>
      </div>
      <details class="pane full plot-fold">
        <summary>时域响应（阶跃 / 脉冲）</summary>
        <div class="layout right-side">
          <div class="pane"><h3>阶跃响应</h3><div class="canvas-wrap" style="height:170px"><canvas class="plot" id="sys-step"></canvas></div></div>
          <div class="pane"><h3>脉冲响应</h3><div class="canvas-wrap" style="height:170px"><canvas class="plot" id="sys-imp"></canvas></div></div>
        </div>
      </details>
    </div>`;

  const $ = (s) => host.querySelector(s);
  function setTF(str) {
    const f = FX_LIB.tfToFields(str);
    $('#sys-num').value = f.num;
    $('#sys-den').value = f.den;
  }
  const pRow = $('#sys-presets');
  Object.keys(presets).forEach((id) => {
    const c = U.el('button', { class: 'chip', 'data-v': presets[id].v }, presets[id].name);
    c.addEventListener('click', () => { setTF(presets[id].v); solve(); });
    pRow.append(c);
  });
  const structs = [
    ['一阶', '1', 's+a', { a: 1 }],
    ['二阶', 'wn*wn', 's^2+2*z*wn*s+wn*wn', { z: 0.25, wn: 1 }],
    ['超前', 's+z', 's+p', { z: 2, p: 0.5 }],
    ['滞后', 's+z', 's+p', { z: 0.5, p: 2 }],
    ['积分', '1', 's', {}],
    ['PID', 'kd*s^2+kp*s+ki', 's', { kp: 1, ki: 0.5, kd: 0.1 }]
  ];
  const sRow = $('#sys-struct');
  structs.forEach(([name, numT, denT, vals]) => {
    const c = U.el('button', { class: 'chip' }, name);
    c.addEventListener('click', () => {
      let n = numT, d = denT;
      for (const [k, v] of Object.entries(vals)) {
        const re = new RegExp('\\b' + k + '\\b', 'g');
        n = n.replace(re, String(v)); d = d.replace(re, String(v));
      }
      $('#sys-num').value = n; $('#sys-den').value = d; solve();
    });
    sRow.append(c);
  });
  $('#sys-apply').addEventListener('click', solve);
  ['#sys-num', '#sys-den'].forEach((sel) => $(sel).addEventListener('keydown', (e) => { if (e.key === 'Enter') solve(); }));

  // 图表切换
  const chartRow = $('#sys-charts');
  const chartDefs = [['bode', '波特图'], ['nyquist', '奈奎斯特图'], ['root', '根轨迹']];
  chartDefs.forEach(([id, label]) => {
    const c = U.el('button', { class: 'chip' + (chart === id ? ' active' : ''), 'data-chart': id }, label);
    c.addEventListener('click', () => {
      chart = id;
      chartRow.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.chart === id));
      $('#sys-chart-bode').classList.toggle('hidden', chart !== 'bode');
      $('#sys-chart-nyq').classList.toggle('hidden', chart !== 'nyquist');
      $('#sys-chart-root').classList.toggle('hidden', chart !== 'root');
      renderChart();
    });
    chartRow.append(c);
  });

  function getPlot(id, opts, redrawFn) {
    if (!plots[id]) {
      plots[id] = new FX.Plot($(id), opts);
      plots[id].onDraw = redrawFn;
    }
    return plots[id];
  }

  function solve() {
    const res = FX_LIB.parseTFFields($('#sys-num').value, $('#sys-den').value);
    if (!res) { $('#sys-tex').innerHTML = '<span style="color:#ff6b6b">无法解析分子/分母，检查括号与 * 号。</span>'; return; }
    num = res.num; den = res.den;
    const d0 = den[0];
    num = num.map((c) => c / d0); den = den.map((c) => c / d0);
    Object.keys(cache).forEach((k) => delete cache[k]);
    Object.values(plots).forEach((p) => p.resetView());
    render();
  }

  function renderTex() {
    const el = $('#sys-tex'); el.innerHTML = '';
    try { if (window.katex) window.katex.render('H(s)=\\dfrac{' + polyTex(num) + '}{' + polyTex(den) + '}', el, { throwOnError: false, displayMode: true }); else el.textContent = ''; }
    catch (e) { }
  }
  function polyTex(c) {
    let out = '';
    for (let i = 0; i < c.length; i++) {
      const pow = c.length - 1 - i, a = c[i];
      if (Math.abs(a) < 1e-9) continue;
      const sgn = i === 0 ? '' : (a >= 0 ? '+' : '-');
      const coef = (Math.abs(Math.abs(a) - 1) < 1e-9 && pow > 0) ? '' : U.fmt(Math.abs(a), 3);
      out += sgn + coef + (pow === 0 ? '' : pow === 1 ? 's' : 's^{' + pow + '}');
    }
    return out || '0';
  }

  /* ---------- 计算缓存 ---------- */
  function getBode() {
    if (!cache.bode) cache.bode = DSP.bode(num, den, -2, 3, 400);
    return cache.bode;
  }
  function getNyq() {
    if (!cache.nyq) {
      const re = [], im = [], w = [];
      for (let i = 0; i < 900; i++) {
        const wv = Math.pow(10, U.lerp(-2, 2.5, i / 899));
        const h = DSP.evalH(num, den, wv);
        w.push(wv); re.push(h.re); im.push(h.im);
      }
      cache.nyq = { w, re, im };
    }
    return cache.nyq;
  }
  function stripLead(c) {
    const a = c.slice();
    while (a.length > 1 && Math.abs(a[0]) < 1e-12) a.shift();
    return a;
  }
  function warmRoots(coef, init) {
    const n = coef.length - 1;
    const lead = coef[0];
    if (!isFinite(lead) || Math.abs(lead) < 1e-18 || n < 1) return init.map((r) => ({ re: r.re, im: r.im }));
    const c = coef.map((x) => x / lead);
    const roots = init.slice(0, n).map((r) => ({ re: r.re, im: r.im }));
    while (roots.length < n) roots.push({ re: 0.1 * roots.length, im: 0.2 * roots.length });
    for (let it = 0; it < 80; it++) {
      let delta = 0;
      for (let i = 0; i < n; i++) {
        let dr = 1, di = 0;
        for (let j = 0; j < n; j++) if (j !== i) {
          const ar = roots[i].re - roots[j].re, ai = roots[i].im - roots[j].im;
          const nr = dr * ar - di * ai, ni = dr * ai + di * ar; dr = nr; di = ni;
        }
        if (Math.abs(dr) + Math.abs(di) < 1e-18) { dr = 1e-12; }
        const pv = DSP.horner(c, roots[i]);
        const corr = DSP.cdiv({ re: pv.re, im: pv.im }, { re: dr, im: di });
        roots[i].re -= corr.re; roots[i].im -= corr.im;
        delta += Math.abs(corr.re) + Math.abs(corr.im);
      }
      if (delta < 1e-10) break;
    }
    return roots;
  }
  function matchRoots(prev, next) {
    const n = prev.length, m = next.length;
    const pairs = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        const d = (next[j].re - prev[i].re) ** 2 + (next[j].im - prev[i].im) ** 2;
        pairs.push({ i, j, d });
      }
    }
    pairs.sort((a, b) => a.d - b.d);
    const out = new Array(n), takenI = new Set(), takenJ = new Set();
    for (const p of pairs) {
      if (takenI.has(p.i) || takenJ.has(p.j)) continue;
      takenI.add(p.i); takenJ.add(p.j);
      out[p.i] = { re: next[p.j].re, im: next[p.j].im };
      if (takenI.size === n) break;
    }
    for (let i = 0; i < n; i++) if (!out[i]) out[i] = { re: prev[i].re, im: prev[i].im };
    return out;
  }
  function getRootLocus() {
    if (!cache.root) {
      const denS = stripLead(den), numS = stripLead(num);
      const n = denS.length - 1, m = numS.length - 1;
      if (n < 1 || n > 8) { cache.root = null; return null; }
      const poles = DSP.polyRoots(denS);
      const zeros = m >= 1 ? DSP.polyRoots(numS) : [];
      const numP = numS.slice();
      while (numP.length < denS.length) numP.unshift(0);
      const Ks = [0];
      for (let i = 0; i < 70; i++) Ks.push(Math.pow(10, U.lerp(-4, -1, i / 69)));
      for (let i = 1; i <= 180; i++) Ks.push(Math.pow(10, U.lerp(-1, 3.5, i / 180)));
      let cur = poles.map((r) => ({ re: r.re, im: r.im }));
      const branches = cur.map((r) => [{ re: r.re, im: r.im, K: 0 }]);
      for (const K of Ks) {
        if (K === 0) continue;
        const coef = denS.map((c, i) => c + K * (numP[i] || 0));
        if (!isFinite(coef[0]) || Math.abs(coef[0]) < 1e-18) continue;
        let roots = warmRoots(coef, cur);
        let bad = 0;
        for (const r of roots) {
          const pv = DSP.horner(coef.map((x) => x / coef[0]), r);
          bad += Math.hypot(pv.re, pv.im);
        }
        if (bad > 1e-3 || roots.some((r) => !isFinite(r.re) || !isFinite(r.im))) {
          roots = DSP.polyRoots(coef);
        }
        cur = matchRoots(cur, roots);
        cur.forEach((r, bi) => {
          if (isFinite(r.re) && isFinite(r.im)) branches[bi].push({ re: r.re, im: r.im, K });
        });
      }
      const excess = n - m;
      let centroid = { re: 0, im: 0 }, angles = [];
      if (excess > 0) {
        let sr = 0, si = 0;
        for (const q of poles) { sr += q.re; si += q.im; }
        for (const q of zeros) { sr -= q.re; si -= q.im; }
        centroid = { re: sr / excess, im: si / excess };
        for (let k = 0; k < excess; k++) angles.push(((2 * k + 1) * Math.PI) / excess);
      }
      cache.root = { branches, poles, zeros, centroid, angles, excess };
    }
    return cache.root;
  }

  /* ---------- 绘制 ---------- */
  function render() {
    renderTex();
    renderChart();
    drawTimeStep();
    renderMetrics();
  }

  function renderChart() {
    if (chart === 'bode') drawBode();
    else if (chart === 'nyquist') drawNyq();
    else drawRoot();
  }

  const bodeColors = { mag: cv('--cv-line1'), ph: cv('--cv-line3') };
  function drawBode() {
    const bode = getBode();
    const bm = getPlot('#sys-bmag', { logX: true, padding: 0.02 }, drawBode);
    let lo = 1e10, hi = -1e10; for (const m of bode.mag) { lo = Math.min(lo, m); hi = Math.max(hi, m); }
    if (hi - lo < 1) { hi += 30; lo -= 30; }
    bm.setRange(bode.w[0], bode.w[bode.w.length - 1], lo - 8, hi + 8);
    bm.clear(); bm.grid(null, null); bm.axis();
    bm.line(bode.w, bode.mag, { color: bodeColors.mag, width: 2, fill: cv('--cv-fill-blue') });
    bm.crosshair((w) => 'ω=' + U.fmt(w, 3) + ' rad/s', (m) => m.toFixed(1) + ' dB');

    const bp = getPlot('#sys-bph', { logX: true, padding: 0.04 }, drawBode);
    let plo = Infinity, phi = -Infinity;
    for (const v of bode.ph) if (isFinite(v)) { plo = Math.min(plo, v); phi = Math.max(phi, v); }
    if (!isFinite(plo)) { plo = -180; phi = 180; }
    if (phi - plo < 40) { const mid = (plo + phi) / 2; plo = mid - 20; phi = mid + 20; }
    bp.setRange(bode.w[0], bode.w[bode.w.length - 1], plo - 15, phi + 15);
    bp.clear(); bp.grid(null, null); bp.axis();
    bp.line(bode.w, bode.ph, { color: bodeColors.ph, width: 2 });
    bp.crosshair((w) => 'ω=' + U.fmt(w, 3) + ' rad/s', (p) => p.toFixed(1) + '°');
  }

  function drawNyq() {
    const d = getNyq();
    const p = getPlot('#sys-nyq', { padding: 0.08 }, drawNyq);
    const start = Math.floor(d.re.length * 0.08);
    let m = 1.2;
    for (let i = start; i < d.re.length; i++) {
      if (isFinite(d.re[i]) && isFinite(d.im[i])) m = Math.max(m, Math.abs(d.re[i]), Math.abs(d.im[i]));
    }
    m = Math.min(Math.max(m * 1.15, 1.2), 40);
    p.setRange(-m, m, -m, m);
    p.clear(); p.grid(null, null); p.axis(true);
    // 单位圆（判稳参考）
    p.clip();
    const ux = [], uy = [];
    for (let i = 0; i <= 120; i++) { const a = (i / 120) * 2 * Math.PI; ux.push(Math.cos(a)); uy.push(Math.sin(a)); }
    p.line(ux, uy, { color: cv('--cv-unit'), width: 1 });
    p.unclip();
    // G(jω) 轨迹
    p.line(d.re, d.im, { color: cv('--cv-line2'), width: 2 });
    // 镜像（ω<0，共轭）弱显示
    p.line(d.re, d.im.map((v) => -v), { color: cv('--cv-line2-soft'), width: 1.5 });
    // 起点终点标注
    const iw = [0.1, 1, 10];
    for (const wv of iw) {
      const idx = d.w.findIndex((x) => x >= wv);
      if (idx > 0) {
        p.dots([d.re[idx]], [d.im[idx]], { color: cv('--cv-warn'), r: 3 });
        p.label('ω=' + wv, p.sx(d.re[idx]) + 6, p.sy(d.im[idx]) - 4, { color: cv('--cv-warn'), size: 10 });
      }
    }
    // (-1, 0) 临界点
    const cx = p.sx(-1), cy = p.sy(0);
    p.ctx.strokeStyle = cv('--cv-danger'); p.ctx.lineWidth = 2;
    p.ctx.beginPath();
    p.ctx.moveTo(cx - 7, cy - 7); p.ctx.lineTo(cx + 7, cy + 7);
    p.ctx.moveTo(cx - 7, cy + 7); p.ctx.lineTo(cx + 7, cy - 7);
    p.ctx.stroke();
    p.label('(−1, 0)', cx, cy + 20, { color: cv('--cv-danger'), size: 11, align: 'center' });
    p.crosshair((x) => 'Re=' + U.fmt(x, 4), (y) => 'Im=' + U.fmt(y, 4));
    // 判稳提示（开环无右半平面极点时适用）
    const openPoles = DSP.polyRoots(den);
    const openStable = openPoles.every((q) => q.re < 1e-9);
    $('#sys-nyq-note').innerHTML = openStable
      ? '开环稳定：G(jω) 轨迹<b>不包围</b> (−1,0) 点 → 闭环稳定；包围 → 闭环不稳定。'
      : '<span style="color:var(--warn)">开环含右半平面极点，需按逆时针包围圈数判断（完整奈奎斯特判据）。</span>';
  }

  function drawRoot() {
    const locus = getRootLocus();
    const p = getPlot('#sys-root', { padding: 0.08 }, drawRoot);
    if (!locus) {
      p.clear();
      p.label('仅支持分母阶次 1–8 的传递函数', p.margin.l + 20, p.margin.t + 40, { color: cv('--cv-danger'), size: 13 });
      return;
    }
    let xr = 1.2, xi = 1.2;
    const collect = (q) => {
      if (!q || !isFinite(q.re) || !isFinite(q.im)) return;
      xr = Math.max(xr, Math.abs(q.re));
      xi = Math.max(xi, Math.abs(q.im));
    };
    for (const q of locus.poles) collect(q);
    for (const q of locus.zeros) collect(q);
    collect(locus.centroid);
    const rMax = Math.max(xr, xi, 1.2) * 3.2;
    for (const br of locus.branches) {
      for (const pt of br) {
        if (!isFinite(pt.re) || !isFinite(pt.im)) continue;
        if (Math.hypot(pt.re, pt.im) > rMax) continue;
        collect(pt);
      }
    }
    xr = Math.max(xr * 1.25, 1.5);
    xi = Math.max(xi * 1.25, 1.5);
    p.setRange(-xr, xr, -xi, xi);
    p.clear();
    // 稳定区底色
    const x0px = U.clamp(p.sx(0), p.margin.l, p.margin.l + p.drawableW);
    p.ctx.fillStyle = cv('--cv-stable-bg');
    p.ctx.fillRect(p.margin.l, p.margin.t, x0px - p.margin.l, p.drawableH);
    p.grid(null, null); p.axis(true);
    p.label('jω', p.margin.l + p.drawableW - 20, p.margin.t + 12, { color: cv('--cv-tick'), size: 11 });
    p.label('σ', p.margin.l + p.drawableW - 14, p.sy(0) - 6, { color: cv('--cv-tick'), size: 11 });
    // 分支
    const bcolors = [cv('--cv-line1'), cv('--cv-line3'), cv('--cv-line2'), cv('--cv-warn'), cv('--cv-pink'), cv('--cv-line4')];
    p.clip();
    if (locus.excess > 0 && locus.angles) {
      const L = Math.hypot(p.xmax - p.xmin, p.ymax - p.ymin);
      for (const ang of locus.angles) {
        p.line(
          [locus.centroid.re, locus.centroid.re + L * Math.cos(ang)],
          [locus.centroid.im, locus.centroid.im + L * Math.sin(ang)],
          { color: cv('--cv-tick'), width: 1 }
        );
      }
    }
    locus.branches.forEach((br, i) => {
      p.line(br.map((q) => q.re), br.map((q) => q.im), { color: bcolors[i % bcolors.length], width: 2 });
    });
    p.unclip();
    // 起点（开环极点）
    for (const q of locus.poles) {
      const x = p.sx(q.re), y = p.sy(q.im);
      p.ctx.strokeStyle = cv('--cv-danger'); p.ctx.lineWidth = 2;
      p.ctx.beginPath();
      p.ctx.moveTo(x - 7, y - 7); p.ctx.lineTo(x + 7, y + 7);
      p.ctx.moveTo(x - 7, y + 7); p.ctx.lineTo(x + 7, y - 7);
      p.ctx.stroke();
    }
    // 有限零点终点
    for (const q of locus.zeros) {
      const x = p.sx(q.re), y = p.sy(q.im);
      p.ctx.strokeStyle = cv('--cv-line1'); p.ctx.lineWidth = 2;
      p.ctx.beginPath(); p.ctx.arc(x, y, 7, 0, 7); p.ctx.stroke();
    }
    // 悬停：σ/jω + 最近轨迹点 K 值
    p.crosshair(
      (x) => 'σ=' + U.fmt(x, 4),
      (y, wx) => {
        let best = null, bd = Infinity;
        const sxx = (p.xmax - p.xmin), syy = (p.ymax - p.ymin);
        for (const br of locus.branches) for (const q of br) {
          const d = ((q.re - wx) / sxx) ** 2 + ((q.im - y) / syy) ** 2;
          if (d < bd) { bd = d; best = q; }
        }
        return bd < 4e-4 && best ? 'jω=' + U.fmt(y, 3) + ' · K≈' + U.fmt(best.K, 3) : 'jω=' + U.fmt(y, 3);
      });
  }

  function renderMetrics() {
    const bode = getBode();
    const poles = DSP.polyRoots(den);
    const zeros = DSP.polyRoots(num);
    const dc = num[num.length - 1] / den[den.length - 1];
    const stable = poles.every((p) => p.re < 1e-9);
    let bw = null;
    const dcmag = Math.abs(dc);
    if (dcmag > 1e-6) {
      const ref = dcmag * 0.707;
      for (let i = 0; i < bode.mag.length; i++) if (bode.mag[i] < 20 * Math.log10(ref + 1e-12)) { bw = bode.w[i]; break; }
    }
    const stats = [];
    stats.push({ k: 'DC 增益', v: U.fmt(dc) });
    stats.push({ k: '带宽(-3dB)', v: bw ? U.fmt(bw) + ' rad/s' : '—' });
    stats.push({ k: '稳定性', v: stable ? '稳定' : '不稳定', color: stable ? 'var(--accent-2)' : 'var(--danger)' });
    for (const p of poles) {
      if (Math.abs(p.im) > 1e-6 && p.re < 0) {
        const wn = Math.hypot(p.re, p.im), zeta = -p.re / wn;
        stats.push({ k: 'ωₙ / ζ', v: U.fmt(wn) + ' / ' + U.fmt(zeta) });
        break;
      }
    }
    // 增益裕度（相位穿越 -180° 处的增益）与相位裕度
    const pm = (() => {
      let idx = -1;
      for (let i = 0; i < bode.ph.length; i++) if (bode.ph[i] > -180 && (i === bode.ph.length - 1 || bode.ph[i + 1] <= -180)) { idx = i; break; }
      if (idx < 0) return null;
      const t = (-180 - bode.ph[idx]) / (bode.ph[idx + 1] - bode.ph[idx] || 1);
      const magAt = bode.mag[idx] + t * (bode.mag[idx + 1] - bode.mag[idx]);
      return -magAt;
    })();
    if (pm != null) stats.push({ k: '相位裕度', v: U.fmt(pm, 1) + '°' });
    $('#sys-metrics').innerHTML = stats.map((s) => `<div class="stat"><span class="k">${s.k}</span><span class="v"${s.color ? ' style="color:' + s.color + '"' : ''}>${s.v}</span></div>`).join('');
  }

  let lastSim = null;
  function computeTime() {
    let tmax = 12, nearest = Infinity;
    const poles = DSP.polyRoots(den);
    for (const p of poles) if (p.re < -1e-9) nearest = Math.min(nearest, Math.abs(p.re));
    const tau = isFinite(nearest) ? 1 / nearest : 2;
    const unstable = poles.some((p) => p.re > 1e-9);
    tmax = unstable ? 4 : U.clamp(4 * tau, 1, 20);
    const steps = 3000, dt = tmax / steps;
    const step = DSP.ltiResponse(num, den, (t) => (t >= 0 ? 1 : 0), 0, tmax, steps);
    const imp = { t: step.t.slice(0, -1), y: [] };
    for (let i = 0; i < steps; i++) imp.y.push((step.y[i + 1] - step.y[i]) / dt);
    lastSim = { step, imp, tmax };
  }
  function drawTimeStep() {
    computeTime();
    timeCanvas('#sys-step', lastSim.step, cv('--cv-line1'));
    timeCanvas('#sys-imp', lastSim.imp, cv('--cv-purple2'));
  }
  function timeCanvas(id, data, color) {
    const p = getPlot(id, { margin: { l: 50, r: 12, t: 10, b: 26 } }, () => timeCanvas(id, data, color));
    let lo = Infinity, hi = -Infinity; for (const v of data.y) if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!isFinite(lo)) { lo = -1; hi = 1; } if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    p.setRange(data.t[0], data.t[data.t.length - 1], lo, hi);
    p.clear(); p.grid(); p.axis(true);
    p.clip(); p.line(data.t, data.y, { color, width: 2 }); p.unclip();
    p.crosshair((t) => 't=' + U.fmt(t, 4), (y) => 'y=' + U.fmt(y, 4));
  }

  // 首屏
  solve();

  return { title: '系统分析', api: { dispose, onTheme: () => { renderChart(); drawTimeStep(); } } };
  function dispose() { }
});
