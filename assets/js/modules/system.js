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
        <div class="hint" id="sys-preview" style="margin-top:-6px"></div>
        <div class="row" id="sys-struct" style="margin-bottom:10px"></div>
        <div class="row" style="margin-bottom:12px">
          <button class="btn primary" id="sys-apply">求解并绘图</button>
          <button class="btn" id="sys-share" title="复制当前 H(s) 的分享链接">🔗 分享</button>
        </div>
        <h3>预设</h3>
        <div class="row" id="sys-presets" style="margin-bottom:12px"></div>
        <div class="formula-center" id="sys-tex"></div>
        <div class="statbar" id="sys-metrics"></div>
        <details class="plot-fold" id="sys-routh-fold">
          <summary>劳斯稳定性判据（特征多项式）</summary>
          <div class="ctrl row" style="margin-top:6px">
            <input type="text" id="sys-routh-in" placeholder="如 s^3+2*s^2+2*s+1" spellcheck="false" style="flex:1">
            <button class="btn" id="sys-routh-cur" title="填入当前分母 D(s)">用当前 D(s)</button>
            <button class="btn primary" id="sys-routh-go">生成劳斯表</button>
          </div>
          <div id="sys-routh-out"></div>
          <div class="hint">劳斯判据：第一列符号变号次数 = 右半平面根数。第一列全同号 → 系统稳定。</div>
        </details>
        <details class="plot-fold" id="sys-char-fold">
          <summary>特征方程分析 D(s) = 0</summary>
          <div class="ctrl row" style="margin-top:6px">
            <input type="text" id="sys-char-in" placeholder="特征多项式，如 s^3+3*s^2+3*s+2" spellcheck="false" style="flex:1">
            <button class="btn" id="sys-char-cur" title="填入当前分母 D(s)">用当前 D(s)</button>
            <button class="btn primary" id="sys-char-go">分析</button>
          </div>
          <div id="sys-char-out"></div>
          <div class="hint">输入特征方程后自动求根：给出特征根、稳定性、主导极点的 ζ/ωₙ，并绘制自由响应（1/D(s) 的冲激响应）。</div>
        </details>
        <div class="hint">按分数线填写分子 / 分母，支持因式 <code>(s+2)*(s+3)</code>。结构按钮可一键套模板。</div>
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
          <h3>根轨迹 · 开环增益 K: 0 → ∞</h3>
          <div class="row" style="margin-bottom:8px">
            <input type="text" id="sys-root-l" placeholder="开环传函 L(s)（留空 = 与上方 H(s) 同步）" spellcheck="false" style="flex:1">
            <button class="btn" id="sys-root-apply">绘制</button>
            <button class="btn" id="sys-root-sync" title="恢复与 H(s) 同步">同步 H(s)</button>
          </div>
          <div class="canvas-wrap" style="height:330px"><canvas class="plot" id="sys-root"></canvas></div>
          <div class="ctrl" style="margin-top:8px"><label>闭环增益 K（拖动查看该增益下的闭环极点） <span class="val" id="sys-root-kv">未选择</span></label>
            <input type="range" id="sys-root-k" min="0" max="400" value="0">
          </div>
          <div class="statbar" id="sys-root-stats"></div>
          <div class="hint" id="sys-root-note"></div>
          <details class="plot-fold">
            <summary>读图规则（根轨迹法则速查）</summary>
            <div class="hint">
              • 根轨迹画的是<b>闭环特征方程 1 + K·L(s) = 0</b> 的根随增益 K: 0→∞ 的轨迹。L(s) 是<b>开环传递函数</b>——单位反馈时 L=G(s)；非单位反馈时 L=G(s)·H(s)；任何能整理成 1+K·L(s)=0 的系统（机械、电气、热工等）都适用，不限于 H(s) 形式。<br>
              • <b>×</b> = 开环极点（每条分支的 K=0 起点），<b>○</b> = 开环零点（m 条分支的 K→∞ 终点）；<br>
              • 分支数 = 极点数 n；其中 n−m 条沿渐近线趋向无穷远，渐近线交点（重心）由极点/零点之和决定；<br>
              • <b>实轴区段</b>：右侧开环零极点总数为奇数的实轴段属于根轨迹；<br>
              • 轨迹<b>穿越 jω 轴</b>处的增益为临界增益 K*：K &gt; K* 后闭环极点进入右半平面（红区），系统不稳定。图中已用金色点标出穿越位置与 K* 值。
            </div>
          </details>
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
  $('#sys-share').addEventListener('click', () => {
    const url = location.origin + location.pathname + location.hash;
    const done = () => { $('#sys-tex').innerHTML = '<span style="color:var(--accent-2)">🔗 分享链接已复制</span>'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => {});
    else done();
  });
  ['#sys-num', '#sys-den'].forEach((sel) => $(sel).addEventListener('keydown', (e) => { if (e.key === 'Enter') solve(); }));

  /* ---------- H(s) 输入实时预览（边输入边解析，错误即刻高亮） ---------- */
  const fracBox = $('#sys-preview').closest('.pane').querySelector('.tf-frac');
  let pvTimer = null;
  function previewTF() {
    const nStr = $('#sys-num').value.trim(), dStr = $('#sys-den').value.trim();
    const box = $('#sys-preview');
    if (!nStr && !dStr) { box.innerHTML = ''; fracBox.classList.remove('invalid'); return; }
    const t = FX_LIB.parseTFFields(nStr || '1', dStr || '1');
    if (!t || !t.den || !t.den[0]) {
      fracBox.classList.add('invalid');
      box.innerHTML = '<span style="color:var(--danger)">✗ 解析失败：支持 s^2、2*s、(s+1)*(s+3) 等写法</span>';
      return;
    }
    if (t.num.length > t.den.length) {
      fracBox.classList.add('invalid');
      box.innerHTML = '<span style="color:var(--warn)">⚠ 非真分式（分子阶次 > 分母阶次），时域响应无法仿真</span>';
      return;
    }
    fracBox.classList.remove('invalid');
    const d0 = t.den[0], nn = t.num.map((c) => c / d0), dd = t.den.map((c) => c / d0);
    box.innerHTML = '<span style="color:var(--accent-2)">✓ </span>';
    box.append(FX.span('H(s)=\\dfrac{' + polyTex(nn) + '}{' + polyTex(dd) + '}'));
  }
  ['#sys-num', '#sys-den'].forEach((sel) => $(sel).addEventListener('input', () => {
    clearTimeout(pvTimer);
    pvTimer = setTimeout(previewTF, 250);
  }));
  previewTF();

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
    if (res.num.length > res.den.length) {
      $('#sys-tex').innerHTML = '<span style="color:var(--danger)">分子阶次需 ≤ 分母阶次（当前为非真分式，无法正确仿真时域响应）。请检查 H(s)，例如 PID 开环传函请配合反馈结构使用。</span>';
      return;
    }
    num = res.num; den = res.den;
    const d0 = den[0];
    num = num.map((c) => c / d0); den = den.map((c) => c / d0);
    // H(s) 写入 URL（分享/刷新后还原），replaceState 避免污染浏览记录
    try { history.replaceState(null, '', '#hn=' + encodeURIComponent($('#sys-num').value.trim()) + '&hd=' + encodeURIComponent($('#sys-den').value.trim())); } catch (e) {}
    Object.keys(cache).forEach((k) => delete cache[k]);
    Object.values(plots).forEach((p) => p.resetView());
    render();
  }

  function renderTex() {
    const el = $('#sys-tex'); el.innerHTML = '';
    try { if (window.katex) window.katex.render('H(s)=\\dfrac{' + polyTex(num) + '}{' + polyTex(den) + '}', el, { throwOnError: false, displayMode: true }); else el.textContent = ''; }
    catch (e) { }
  }
  function polyTex(c) { return U.polyTex(c); }

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
  /* 根轨迹可独立指定开环传函 L(s)（默认与 H(s) 同步） */
  let rootOverride = null;   // {num, den} 或 null
  let rootK = 0;             // K 滑杆当前值（0 = 不显示闭环极点）
  function rootLocusTF() {
    if (rootOverride) return { num: stripLead(rootOverride.num), den: stripLead(rootOverride.den) };
    return { num: stripLead(num), den: stripLead(den) };
  }
  // 根分组：实根 / 共轭对（强制共轭对称，杜绝分支左右横跳）
  function symGroup(roots) {
    const items = roots.map((r) => ({ re: r.re, im: r.im, used: false }));
    const reals = [], pairs = [];
    for (const it of items) {
      if (it.used) continue;
      if (Math.abs(it.im) < 1e-7) { it.used = true; reals.push({ re: it.re }); continue; }
      const cj = items.find((o) => !o.used && o !== it && Math.abs(o.re - it.re) < 1e-6 && Math.abs(o.im + it.im) < 1e-6);
      if (cj) { it.used = cj.used = true; pairs.push({ re: it.re, im: Math.abs(it.im) }); }
      else { it.used = true; reals.push({ re: it.re }); }
    }
    return { reals, pairs };
  }
  function getRootLocus() {
    const key = JSON.stringify(rootLocusTF());
    if (cache.root && cache.rootKey !== key) { delete cache.root; }
    if (!cache.root) {
      cache.rootKey = key;
      const { num: numS, den: denS } = rootLocusTF();
      const n = denS.length - 1, m = numS.length - 1;
      if (n < 1 || n > 8) { cache.root = null; return null; }
      const poles = DSP.polyRoots(denS);
      const zeros = m >= 1 ? DSP.polyRoots(numS) : [];
      const numP = numS.slice();
      while (numP.length < denS.length) numP.unshift(0);
      const Ks = [0];
      for (let i = 0; i < 120; i++) Ks.push(Math.pow(10, U.lerp(-4, -0.5, i / 119)));
      for (let i = 1; i <= 260; i++) Ks.push(Math.pow(10, U.lerp(-0.5, 5, i / 259)));
      // 分支按「实根/共轭对」分组追踪，分支只在同类候选间连续匹配
      const g0 = symGroup(poles);
      const branches = [];
      for (const r of g0.reals) branches.push({ type: 'real', cur: { re: r.re, im: 0 }, pts: [] });
      for (const p of g0.pairs) branches.push({ type: 'pair', cur: { re: p.re, im: p.im }, pts: [] });
      branches.forEach((b) => b.pts.push({ re: b.cur.re, im: b.cur.im, K: 0 }));
      for (const K of Ks) {
        if (K === 0) continue;
        const coef = denS.map((c, i) => c + K * (numP[i] || 0));
        if (!isFinite(coef[0]) || Math.abs(coef[0]) < 1e-18) continue;
        const roots = DSP.polyRoots(coef);
        if (roots.length !== n || roots.some((r) => !isFinite(r.re) || !isFinite(r.im))) continue;
        const g = symGroup(roots);
        const cands = [];
        g.reals.forEach((r) => cands.push({ type: 'real', v: { re: r.re, im: 0 }, used: false }));
        g.pairs.forEach((p) => cands.push({ type: 'pair', v: { re: p.re, im: p.im }, used: false }));
        for (const b of branches) {
          let bi = -1, bd = Infinity;
          cands.forEach((c, i) => {
            if (c.used) return;
            // 分离点附近：实根与共轭对合并/分裂，虚部差降权使过渡平滑
            const d = Math.hypot(c.v.re - b.cur.re, (c.v.im - b.cur.im) * (c.type === b.type ? 1 : 0.35));
            if (d < bd) { bd = d; bi = i; }
          });
          if (bi >= 0) { cands[bi].used = true; b.cur = { ...cands[bi].v }; }
          b.pts.push({ re: b.cur.re, im: b.cur.im, K });
        }
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
      // 临界增益：分支穿越 jω 轴（re 变号）处线性插值 K
      const crossings = [];
      for (const b of branches) {
        for (let i = 1; i < b.pts.length; i++) {
          const p0 = b.pts[i - 1], p1 = b.pts[i];
          if ((p0.re > 0) !== (p1.re > 0) && Math.abs(p0.re - p1.re) > 1e-12) {
            const t = (0 - p0.re) / (p1.re - p0.re);
            const im = Math.abs(p0.im + t * (p1.im - p0.im));
            crossings.push({ im, K: p0.K + t * (p1.K - p0.K) });
          }
        }
      }
      crossings.sort((a, b) => a.K - b.K);
      // 实轴分离点/汇合点：K(s)=−D(s)/N(s) 在实轴根轨迹区段上的极值
      const brk = [];
      {
        let rEst = 1;
        for (const q of [...poles, ...zeros]) rEst = Math.max(rEst, Math.abs(q.re) + 1, Math.abs(q.im) + 1);
        const lo = -rEst * 1.2, hi = rEst * 1.2, grid = 3000;
        const samples = [];
        for (let i = 0; i <= grid; i++) {
          const s = lo + ((hi - lo) * i) / grid;
          const nv = DSP.horner(numS, { re: s, im: 0 }).re;
          const dvv = DSP.horner(denS, { re: s, im: 0 }).re;
          if (Math.abs(nv) < 1e-9) { if (samples.length && i - samples[samples.length - 1].i > 1) { /* 断开 */ } continue; }
          const K = -dvv / nv;
          const cnt = poles.filter((q) => q.re > s).length + zeros.filter((q) => q.re > s).length;
          if (cnt % 2 !== 1 || K < 1e-9) continue;
          samples.push({ s, K, i });
        }
        for (let i = 1; i < samples.length - 1; i++) {
          if (samples[i + 1].i - samples[i].i > 2 || samples[i].i - samples[i - 1].i > 2) continue;
          const d1 = samples[i].K - samples[i - 1].K, d2 = samples[i + 1].K - samples[i].K;
          if (d1 * d2 < 0) brk.push({ s: samples[i].s, K: samples[i].K });
        }
        // 去重（数值网格内相邻重复）
        for (let i = brk.length - 2; i >= 0; i--) if (Math.abs(brk[i].s - brk[i + 1].s) < (hi - lo) / grid * 4) brk.splice(i + 1, 1);
      }
      cache.root = { branches, poles, zeros, centroid, angles, excess, crossings, brk };
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

  function drawBode() {
    const bode = getBode();
    const bodeColors = { mag: cv('--cv-line1'), ph: cv('--cv-line3') };   // 每次绘制时取色，保证主题切换后颜色正确
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
    for (const b of locus.branches) {
      for (const pt of b.pts) {
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
    const bcolors = [cv('--cv-line1'), cv('--cv-line3'), cv('--cv-line2'), cv('--cv-pink'), cv('--cv-warn'), cv('--cv-line4')];
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
    // 分支（共轭对画镜像双线）
    locus.branches.forEach((b, i) => {
      const color = bcolors[i % bcolors.length];
      const xs = b.pts.map((q) => q.re), ys = b.pts.map((q) => q.im);
      p.line(xs, ys, { color, width: 2.2 });
      if (b.type === 'pair') p.line(xs, ys.map((v) => -v), { color, width: 2.2 });
    });
    p.unclip();
    // 起点（开环极点）× / 终点（有限零点）○
    for (const q of locus.poles) {
      const x = p.sx(q.re), y = p.sy(q.im);
      p.ctx.strokeStyle = cv('--cv-danger'); p.ctx.lineWidth = 2;
      p.ctx.beginPath();
      p.ctx.moveTo(x - 7, y - 7); p.ctx.lineTo(x + 7, y + 7);
      p.ctx.moveTo(x - 7, y + 7); p.ctx.lineTo(x + 7, y - 7);
      p.ctx.stroke();
    }
    for (const q of locus.zeros) {
      const x = p.sx(q.re), y = p.sy(q.im);
      p.ctx.strokeStyle = cv('--cv-line1'); p.ctx.lineWidth = 2;
      p.ctx.beginPath(); p.ctx.arc(x, y, 7, 0, 7); p.ctx.stroke();
    }
    // 分离点/汇合点 ◇
    if (locus.brk && locus.brk.length) {
      p.clip();
      for (const bk of locus.brk) {
        const x = p.sx(bk.s), y = p.sy(0);
        p.ctx.strokeStyle = cv('--cv-warn'); p.ctx.lineWidth = 2;
        p.ctx.beginPath();
        p.ctx.moveTo(x, y - 5.5); p.ctx.lineTo(x + 5.5, y); p.ctx.lineTo(x, y + 5.5); p.ctx.lineTo(x - 5.5, y);
        p.ctx.closePath(); p.ctx.stroke();
        p.label('s=' + U.fmt(bk.s, 2), x + 9, y - 9, { color: cv('--cv-warn'), size: 10 });
      }
      p.unclip();
    }
    // K 滑杆：当前闭环极点标记
    let closedInfo = null;
    if (rootK > 0) {
      const { num: numS, den: denS } = rootLocusTF();
      const numP = numS.slice();
      while (numP.length < denS.length) numP.unshift(0);
      const coef = denS.map((c, i) => c + rootK * (numP[i] || 0));
      const cl = DSP.polyRoots(coef).filter((q) => isFinite(q.re) && isFinite(q.im));
      closedInfo = cl;
      p.clip();
      for (const q of cl) {
        const x = p.sx(q.re), y = p.sy(q.im);
        p.ctx.fillStyle = cv('--cv-warn');
        p.ctx.beginPath(); p.ctx.arc(x, y, 5.5, 0, 7); p.ctx.fill();
        p.ctx.strokeStyle = cv('--cv-bg'); p.ctx.lineWidth = 1.5; p.ctx.stroke();
      }
      p.unclip();
    }
    // 悬停：σ/jω + 最近轨迹点 K 值
    p.crosshair(
      (x) => 'σ=' + U.fmt(x, 4),
      (y, wx) => {
        let best = null, bd = Infinity;
        const sxx = (p.xmax - p.xmin), syy = (p.ymax - p.ymin);
        for (const b of locus.branches) for (const q of b.pts) {
          const d = ((q.re - wx) / sxx) ** 2 + ((q.im - y) / syy) ** 2;
          if (d < bd) { bd = d; best = q; }
        }
        return bd < 4e-4 && best ? 'jω=' + U.fmt(y, 3) + ' · K≈' + U.fmt(best.K, 3) : 'jω=' + U.fmt(y, 3);
      });
    // 临界增益：穿越 jω 轴处金色标记 + 文本
    if (locus.crossings && locus.crossings.length) {
      p.clip();
      for (const c of locus.crossings) {
        p.dots([0], [c.im], { color: cv('--cv-warn'), r: 4 });
        p.label('K*=' + U.fmt(c.K, 2), p.sx(0) + 8, p.sy(c.im) - 6, { color: cv('--cv-warn'), size: 10 });
      }
      p.unclip();
    }
    // 统计
    const statsEl = $('#sys-root-stats');
    let html = '';
    if (locus.brk && locus.brk.length) {
      html += `<div class="stat"><span class="k">分离/汇合点</span><span class="v" style="color:var(--warn)">${locus.brk.map((b) => 's=' + U.fmt(b.s, 2)).join(' / ')}</span></div>`;
    }
    if (locus.crossings && locus.crossings.length) {
      html += `<div class="stat"><span class="k">临界增益 K*</span><span class="v" style="color:var(--warn)">${locus.crossings.map((c) => U.fmt(c.K, 2)).join(' / ')}</span></div>`;
    } else {
      html += '<div class="stat"><span class="k">临界增益</span><span class="v" style="color:var(--accent-2)">K*=∞</span></div>';
    }
    if (closedInfo) {
      const stable = closedInfo.every((q) => q.re < -1e-9);
      const marginal = !stable && closedInfo.some((q) => Math.abs(q.re) < 1e-9);
      html += `<div class="stat"><span class="k">K=${U.fmt(rootK, 3)} 闭环极点</span><span class="v" style="font-size:12px;max-width:260px;word-break:break-all">${closedInfo.map((q) => U.fmt(q.re, 2) + (Math.abs(q.im) > 1e-9 ? (q.im > 0 ? '+' : '') + U.fmt(q.im, 2) + 'j' : '')).join(', ')}</span></div>`;
      html += `<div class="stat"><span class="k">闭环稳定性</span><span class="v" style="color:${stable ? 'var(--accent-2)' : marginal ? 'var(--warn)' : 'var(--danger)'}">${stable ? '稳定' : marginal ? '临界' : '不稳定'}</span></div>`;
    }
    statsEl.innerHTML = html;
    const noteEl = $('#sys-root-note');
    if (noteEl) {
      const L = rootLocusTF();
      noteEl.innerHTML = '开环传函 L(s) = ' + polyTex(L.num) + ' / ' + polyTex(L.den)
        + (rootOverride ? '（独立指定）' : '（与上方 H(s) 同步）')
        + '；闭环特征式 1 + K·L(s) = 0。图中：× 极点（起点）· ○ 零点（终点）· 虚线 = 渐近线 · ◇ = 实轴分离/汇合点 · 金点 = 虚轴穿越（K*）。拖动下方 K 滑杆可查看该增益下的闭环极点与稳定性。';
    }
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
    if (pm != null) stats.push({ k: '相位裕度 PM', v: U.fmt(pm, 1) + '°' });
    // 增益裕度 GM：-180° 相位处的增益余量（>0 dB 稳定方向）；相位不穿越 -180° 时为无穷
    const gm = (() => {
      for (let i = 0; i < bode.ph.length; i++) {
        if (bode.ph[i] <= -180) {
          const magAt = bode.mag[i];
          return magAt != null && isFinite(magAt) ? -magAt : null;
        }
      }
      return Infinity;
    })();
    stats.push({ k: '增益裕度 GM', v: gm === Infinity ? '∞ dB' : U.fmt(gm, 1) + ' dB' });
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

  /* ---------- 根轨迹独立输入 ---------- */
  $('#sys-root-apply').addEventListener('click', () => {
    const raw = $('#sys-root-l').value.trim();
    if (!raw) { rootOverride = null; delete cache.root; renderChart(); return; }
    const tf = FX_LIB.parseTF(raw);
    if (!tf || !tf.den || !tf.den[0]) { $('#sys-root-note').innerHTML = '<span style="color:var(--danger)">L(s) 解析失败，示例：(s+2)/(s^2+2*s+5)</span>'; return; }
    rootOverride = tf;
    delete cache.root;
    renderChart();
  });
  $('#sys-root-l').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#sys-root-apply').click(); });
  $('#sys-root-sync').addEventListener('click', () => {
    rootOverride = null;
    $('#sys-root-l').value = '';
    delete cache.root;
    renderChart();
  });
  // K 滑杆：对数刻度（v=100 → K=1，v=400 → K=1000）
  $('#sys-root-k').addEventListener('input', (e) => {
    const v = +e.target.value;
    rootK = v === 0 ? 0 : Math.pow(10, (v - 100) / 100);
    $('#sys-root-kv').textContent = rootK === 0 ? '未选择' : 'K = ' + U.fmt(rootK, 3);
    renderChart();
  });

  /* ---------- 劳斯稳定性判据 ---------- */
  function polyToPlain(c) {
    return c.map((x, i) => {
      const p = c.length - 1 - i;
      const a = +Math.abs(x).toFixed(6);
      return (x < 0 ? '-' : '+') + a + (p === 0 ? '' : p === 1 ? '*s' : '*s^' + p);
    }).join('').replace(/^\+/, '');
  }
  function routhCompute(coef) {
    // coef：自高到低特征多项式系数
    const rows = [];
    const notes = [];
    rows.push(coef.filter((_, i) => i % 2 === 0));
    rows.push(coef.filter((_, i) => i % 2 === 1));
    let guard = 0;
    while (guard++ < 24) {
      const prev = rows[rows.length - 2], last = rows[rows.length - 1];
      if (!last.some((v) => Math.abs(v) > 1e-12)) {
        notes.push('出现全零行：存在关于原点对称的根（纯虚根/正负实根对），系统临界，需进一步分析');
        break;
      }
      if (Math.abs(last[0]) < 1e-10) {
        notes.push('首列出现 0：用小正数 ε 代替继续计算');
        last[0] = 1e-10;
      }
      const nr = [];
      for (let i = 0; i < last.length - 1; i++) nr.push((last[0] * prev[i + 1] - prev[0] * last[i + 1]) / last[0]);
      while (nr.length && Math.abs(nr[nr.length - 1]) < 1e-12) nr.pop();
      if (!nr.length) break;
      rows.push(nr);
    }
    // 第一列符号（|v|<1e-8 视作 ε，按正号处理）
    const signOf = (v) => (Math.abs(v) < 1e-8 ? 1 : Math.sign(v));
    const firstCol = rows.map((r) => r[0]);
    let changes = 0;
    for (let i = 1; i < firstCol.length; i++) {
      if (signOf(firstCol[i]) !== signOf(firstCol[i - 1])) changes++;
    }
    return { rows, notes, changes };
  }
  function renderRouth(coefStr) {
    const out = $('#sys-routh-out');
    const c = FX_LIB.parsePoly(coefStr);
    if (!c || !c.length || Math.abs(c[0]) < 1e-12 || c.length < 2) {
      out.innerHTML = '<p style="color:var(--danger)">无法解析特征多项式（首项系数需不为 0），示例：s^3+2*s^2+2*s+1</p>';
      return;
    }
    const { rows, notes, changes } = routhCompute(c);
    const n = c.length - 1;
    let html = '<table class="tbl" style="margin-top:8px;max-width:520px"><tr><th>行</th>';
    const maxLen = Math.max(...rows.map((r) => r.length));
    for (let j = 0; j < maxLen; j++) html += `<th>c${j + 1}</th>`;
    html += '</tr>';
    rows.forEach((r, i) => {
      html += `<tr><td>s^${n - i}</td>`;
      for (let j = 0; j < maxLen; j++) {
        const v = r[j];
        html += `<td${j === 0 && Math.abs(v) < 1e-8 && Math.abs(v) > 0 ? ' style="color:var(--warn)"' : ''}>${v == null ? '' : U.fmt(v, 4)}${j === 0 && Math.abs(v) < 1e-8 && Math.abs(v) > 0 ? ' (ε)' : ''}</td>`;
      }
      html += '</tr>';
    });
    html += '</table>';
    if (notes.length) html += notes.map((x) => `<p class="hint" style="color:var(--warn)">⚠ ${x}</p>`).join('');
    // 数值求根交叉验证
    const roots = DSP.polyRoots(c);
    const rhp = roots.filter((q) => q.re > 1e-9).length;
    const concl = changes === 0
      ? `<p style="color:var(--accent-2);font-weight:600">✓ 第一列无变号 → 右半平面根 0 个 → 系统稳定</p>`
      : `<p style="color:var(--danger);font-weight:600">✗ 第一列变号 ${changes} 次 → 右半平面根 ${changes} 个 → 系统不稳定</p>`;
    html += concl + `<p class="hint">数值求根验证：右半平面根实际 ${rhp} 个${rhp === changes ? '（与劳斯表一致）' : '（与劳斯表不一致，通常因 ε 近似/临界情形）'}。特征多项式：${polyToPlain(c)}</p>`;
    out.innerHTML = html;
  }
  $('#sys-routh-go').addEventListener('click', () => renderRouth($('#sys-routh-in').value));
  $('#sys-routh-cur').addEventListener('click', () => { $('#sys-routh-in').value = polyToPlain(den); renderRouth($('#sys-routh-in').value); });
  $('#sys-routh-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') renderRouth($('#sys-routh-in').value); });
  $('#sys-routh-fold').addEventListener('toggle', () => {
    if ($('#sys-routh-fold').open && !$('#sys-routh-in').value.trim()) $('#sys-routh-in').value = polyToPlain(den);
  });

  /* ---------- 特征方程分析 D(s)=0：求根 + 稳定性 + 自由响应 ---------- */
  function renderChar(str) {
    const out = $('#sys-char-out');
    const c = FX_LIB.parsePoly(str);
    if (!c || !c.length || Math.abs(c[0]) < 1e-12 || c.length < 2) {
      out.innerHTML = '<p style="color:var(--danger)">无法解析特征多项式（首项系数需不为 0），示例：s^3+3*s^2+3*s+2</p>';
      return;
    }
    const roots = DSP.polyRoots(c);
    const n = c.length - 1;
    const rhp = roots.filter((q) => q.re > 1e-9).length;
    const jw = roots.filter((q) => Math.abs(q.re) <= 1e-9).length;
    const stable = rhp === 0 && jw === 0;
    const stableColor = stable ? 'var(--accent-2)' : (rhp ? 'var(--danger)' : 'var(--warn)');
    const stableText = stable ? '全部特征根在左半平面 → 稳定' : rhp ? `右半平面特征根 ${rhp} 个 → 不稳定` : '存在虚轴特征根 → 临界稳定';
    // 主导极点（实部最大且 < 0 的复数对或实根）→ ζ / ωn
    let dom = null;
    for (const q of roots) {
      if (q.re >= -1e-9) continue;
      if (!dom || q.re > dom.re) dom = q;
    }
    let domTex = '';
    if (dom) {
      const wn = Math.hypot(dom.re, dom.im);
      const zeta = -dom.re / wn;
      domTex = `<div class="stat"><span class="k">主导极点 ζ / ωₙ</span><span class="v">ζ=${U.fmt(zeta, 3)} · ωₙ=${U.fmt(wn, 3)} rad/s</span></div>`;
    }
    // 特征根表
    const fmtR = (q) => U.fmt(q.re, 3) + (Math.abs(q.im) > 1e-9 ? (q.im > 0 ? ' + ' : ' − ') + U.fmt(Math.abs(q.im), 3) + 'j' : '');
    let html = `<div class="statbar" style="padding:8px 0">
      <div class="stat"><span class="k">阶数</span><span class="v">${n}</span></div>
      ${domTex}
      <div class="stat"><span class="k">稳定性</span><span class="v" style="color:${stableColor}">${stableText}</span></div>
    </div>
    <table class="tbl" style="max-width:480px"><tr><th>#</th><th>特征根</th><th>位置</th></tr>` +
      roots.map((q, i) => `<tr><td>λ${i + 1}</td><td style="font-family:var(--mono)">${fmtR(q)}</td><td>${q.re > 1e-9 ? '<span style="color:var(--danger)">右半平面</span>' : Math.abs(q.re) <= 1e-9 ? '<span style="color:var(--warn)">虚轴</span>' : '<span style="color:var(--accent-2)">左半平面</span>'}</td></tr>`).join('') +
      `</table>
      <div class="hint" style="margin-top:6px">自由响应（自然模态）曲线如下——由 D(s) 的根决定形态：左半平面根衰减、虚轴根等幅、右半平面根发散。</div>
      <div class="canvas-wrap" style="height:160px;margin-top:6px"><canvas class="plot" id="sys-char-cv"></canvas></div>`;
    out.innerHTML = html;
    if (FX.enablePlotChrome) FX.enablePlotChrome(out);
    // 自由响应：1/D(s) 的冲激响应 h(t)=Σ Residue·e^{λt}（单根；重根提示）
    const uniq = [];
    for (const q of roots) {
      const dup = uniq.find((u) => Math.abs(u.re - q.re) < 1e-6 && Math.abs(u.im - q.im) < 1e-6);
      if (!dup) uniq.push(q);
    }
    const repeated = uniq.length !== roots.length;
    // D'(λ)：导数多项式系数（自高到低）后用 horner 求值
    const dcoef = c.slice(0, -1).map((v, i) => v * (c.length - 1 - i));
    const dder = (x) => DSP.horner(dcoef, x);
    const t = [], y = [];
    const unstable = roots.some((q) => q.re > 1e-9);
    let nearest = Infinity;
    for (const q of roots) if (q.re < -1e-9) nearest = Math.min(nearest, Math.abs(q.re));
    const tmax = unstable ? 6 : U.clamp(6 / (nearest || 1), 0.5, 24);
    const STEPS = 1200;
    let hasComplex = false;
    for (let i = 0; i <= STEPS; i++) {
      const tv = (i / STEPS) * tmax;
      let acc = 0;
      for (const q of roots) {
        if (q.im < -1e-9) continue;                 // 共轭对取虚部 > 0 的那个
        const dp = dder(q);
        if (Math.hypot(dp.re, dp.im) < 1e-12) continue;
        const r = DSP.cdiv({ re: 1, im: 0 }, dp);   // 留数 1/D'(λ)
        if (Math.abs(q.im) > 1e-9) {
          hasComplex = true;
          acc += 2 * Math.exp(q.re * tv) * (r.re * Math.cos(q.im * tv) - r.im * Math.sin(q.im * tv));
        } else {
          acc += r.re * Math.exp(q.re * tv);
        }
      }
      t.push(tv); y.push(acc);
    }
    const p = new FX.Plot($('#sys-char-cv'), { margin: { l: 48, r: 12, t: 10, b: 26 } });
    let lo = Infinity, hi = -Infinity;
    for (const v of y) if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!isFinite(lo)) { lo = -1; hi = 1; }
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.12;
    p.setRange(0, tmax, lo - pad, hi + pad);
    p.clear(); p.grid(); p.axis(true);
    p.clip(); p.line(t, y, { color: unstable ? cv('--cv-danger') : cv('--cv-line1'), width: 2 }); p.unclip();
    p.crosshair((x) => 't=' + U.fmt(x, 3), (yy) => 'y=' + U.fmt(yy, 4));
    if (repeated) out.append(U.el('p', { class: 'hint', html: '<span style="color:var(--warn)">⚠ 检测到重根：自由响应含 t·e^{λt} 模态，上图仅绘制单根近似。</span>' }));
  }
  $('#sys-char-go').addEventListener('click', () => renderChar($('#sys-char-in').value));
  $('#sys-char-cur').addEventListener('click', () => { $('#sys-char-in').value = polyToPlain(den); renderChar($('#sys-char-in').value); });
  $('#sys-char-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') renderChar($('#sys-char-in').value); });
  $('#sys-char-fold').addEventListener('toggle', () => {
    if ($('#sys-char-fold').open && !$('#sys-char-in').value.trim()) $('#sys-char-in').value = polyToPlain(den);
  });

  // 首屏：URL 中带有分享的 H(s)（#hn=..&hd=..）时优先还原
  {
    const hp = new URLSearchParams(location.hash.replace(/^#/, ''));
    const hn = hp.get('hn'), hd = hp.get('hd');
    if (hn != null && hd != null) { $('#sys-num').value = hn; $('#sys-den').value = hd; }
  }
  solve();

  return { title: '系统分析', api: { dispose, onTheme: () => { renderChart(); drawTimeStep(); } } };
  function dispose() { }
});
