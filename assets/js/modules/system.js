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
        <div id="sys-mi"></div>
        <div class="row" id="sys-struct" style="margin-bottom:10px"></div>
        <div class="row" style="margin-bottom:8px">
          <button class="btn primary" id="sys-apply">求解并绘图</button>
          <button class="btn" id="sys-share" title="复制当前 H(s) 的分享链接（旧版单输入格式）">🔗 分享</button>
          <button class="btn" id="sys-toblk" title="把当前 H(s) 作为开环传函在系统框图中打开">↗ 框图</button>
          <button class="btn" id="sys-toex" title="转到交互求解分析此 H(s)">↗ 求解</button>
        </div>
        <div id="sys-rtb"></div>
        <div id="sys-lib"></div>
        <div id="sys-params" style="display:none"></div>
        <h3>预设</h3>
        <div class="row" id="sys-presets" style="margin-bottom:12px"></div>
        <div class="formula-center" id="sys-tex"></div>
        <div class="statbar" id="sys-metrics"></div>
        <div class="hint" id="sys-ess-hint" style="margin-top:4px"></div>
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
        <details class="plot-fold" id="sys-ss-fold">
          <summary>状态空间分析（能控性 / 能观性 / 极点配置 / 观测器）</summary>
          <div class="row" id="sys-ss-presets" style="margin:6px 0;flex-wrap:wrap"></div>
          <div class="layout right-side" style="gap:10px">
            <div class="pane" style="padding:0">
              <div class="ctrl"><label>A（n×n，行用换行或「;」分隔）<span class="val" id="sys-ss-an"></span></label>
                <textarea id="sys-ss-a" rows="3" spellcheck="false" style="width:100%;font-family:var(--mono);font-size:13px;background:var(--panel-2);color:var(--text);border:1px solid var(--line-2);border-radius:7px;padding:7px"></textarea></div>
              <div class="ctrl"><label>B（n×1 列）</label><input type="text" id="sys-ss-b" spellcheck="false"></div>
              <div class="ctrl"><label>C（1×n 行）</label><input type="text" id="sys-ss-c" spellcheck="false"></div>
              <div class="ctrl"><label>D（前馈，常为 0）</label><input type="text" id="sys-ss-d" value="0" spellcheck="false"></div>
            </div>
            <div class="pane" style="padding:0">
              <div class="ctrl"><label>状态反馈期望极点（逗号分隔，共轭成对）</label><input type="text" id="sys-ss-des" placeholder="-2, -1+2j, -1-2j" spellcheck="false"></div>
              <div class="ctrl"><label>观测器期望极点</label><input type="text" id="sys-ss-obs" placeholder="-5, -6" spellcheck="false"></div>
              <button class="btn primary" id="sys-ss-go" style="margin-top:6px">分析状态空间</button>
            </div>
          </div>
          <div id="sys-ss-out" style="margin-top:8px"></div>
          <div class="hint">ẋ=Ax+Bu，y=Cx+Du。能控性 ⇔ rank[B AB … Aⁿ⁻¹B]=n（Ackermann 配置要求完全能控）；能观性 ⇔ rank[C; CA; …; CAⁿ⁻¹]=n（观测器极点任意配置的前提）。G(s)=C(sI−A)⁻¹B+D 为未约分形式。</div>
        </details>
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
    tfIn.set(f.num, f.den);
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
  structs.forEach(([name, numT, denT, defaults]) => {
    const c = U.el('button', { class: 'chip' }, name);
    c.addEventListener('click', () => {
      // 插入符号串 + 参数种子值：参数行自动出现，改值即重解
      paramSeeds = Object.assign({}, defaults);
      paramScope = {}; sweeps = {};
      tfIn.set(numT, denT);
      solve();
    });
    sRow.append(c);
  });
  $('#sys-apply').addEventListener('click', solve);
  /* ---------- 模型库与跨模块交接 ---------- */
  MI.library($('#sys-lib'), {
    kinds: ['tf'],
    onSave: () => {
      const c = tfIn.get();
      if (!c.numStr && !c.denStr) return null;
      return { kind: 'tf', data: { variable: 's', num: c.numStr || '1', den: c.denStr || '1' } };
    },
    onLoad: (m) => {
      if (!m.data || m.data.variable !== 's') return;
      tfIn.set(m.data.num, m.data.den);
      solve();
    }
  });
  $('#sys-toblk').addEventListener('click', () => {
    const c = tfIn.get();
    const H = (c.numStr || '1') + '/(' + (c.denStr || '1') + ')';
    const slim = { v: 1, n: [
      { i: 1, k: 'sum', m: 'Σ1', s: '1', x: 200, y: 230, r: 1, o: 0, z: 0 },
      { i: 2, k: 'box', m: 'G1', s: H, x: 470, y: 230, r: 0, o: 1, z: 0 }
    ], e: [[1, 2, 1], [2, 1, 0]] };
    try { history.replaceState(null, '', '#blk=blk1.' + btoa(unescape(encodeURIComponent(JSON.stringify(slim))))); } catch (e) { }
    App.open('blk');
  });
  $('#sys-toex').addEventListener('click', () => {
    const c = tfIn.get();
    const expr = (c.numStr || '1') + '/(' + (c.denStr || '1') + ')';
    try { history.replaceState(null, '', '#ex=' + encodeURIComponent(expr)); } catch (e) { }
    App.open('explore');
  });
  $('#sys-share').addEventListener('click', () => {
    const url = location.origin + location.pathname + location.hash;
    const done = () => { $('#sys-tex').innerHTML = '<span style="color:var(--accent-2)">🔗 分享链接已复制</span>'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => {});
    else done();
  });
  // （MI.tfInput 已在输入框上原生处理 Enter → onApply → solve，无需重复绑定）

  /* ---------- H(s) 输入（统一输入组件 MI：键盘/徽标/校验；显式求解节奏） ---------- */
  const tfIn = MI.tfInput($('#sys-mi'), {
    variable: 's',
    properness: true,
    autoApply: false,
    ids: { num: 'sys-num', den: 'sys-den' },
    placeholder: { num: '分子  如 1 或 (s+2)', den: '分母  如 s^2+2*s+5 或 (s+1)*(s+2)' },
    pad: ['s', '^2', '^3', '*', '/', '(', ')', '+', '-'],
    debounce: 250,
    onApply: () => solve()
  });
  tfIn.set('1', 's^2+2*s+5');

  /* ---------- 实验接入：状态捕获 / 回放 / 统一结果工具栏 ---------- */
  function getState() {
    const c = tfIn.get();
    return {
      num: c.numStr || '1', den: c.denStr || '1', chart, params: { ...paramScope },
      ss: { A: $('#sys-ss-a').value, B: $('#sys-ss-b').value, C: $('#sys-ss-c').value, D: $('#sys-ss-d').value, des: $('#sys-ss-des').value, obs: $('#sys-ss-obs').value }
    };
  }
  function applyState(s) {
    if (!s || typeof s !== 'object') return;
    paramScope = (s.params && typeof s.params === 'object') ? { ...s.params } : {};
    sweeps = {}; paramSeeds = {};
    tfIn.set(String(s.num || '1'), String(s.den || '1'));
    if (s.chart === 'bode' || s.chart === 'nyquist' || s.chart === 'root') setChart(s.chart);
    if (s.ss && typeof s.ss === 'object') {
      $('#sys-ss-a').value = String(s.ss.A || ''); $('#sys-ss-b').value = String(s.ss.B || '');
      $('#sys-ss-c').value = String(s.ss.C || ''); $('#sys-ss-d').value = String(s.ss.D || '0');
      $('#sys-ss-des').value = String(s.ss.des || ''); $('#sys-ss-obs').value = String(s.ss.obs || '');
      renderSS();
    }
    solve();
  }
  RTB.attach($('#sys-rtb'), {
    module: 'sys',
    getState, applyState,
    canvases: () => ['#sys-bmag', '#sys-bph', '#sys-nyq', '#sys-root', '#sys-step', '#sys-imp'].map((s) => $(s)).filter(Boolean),
    csv: () => {
      const b = getBode();
      return {
        name: 'bode',
        header: ['omega(rad/s)', 'gain(dB)', 'phase(deg)'],
        rows: b.w.map((w, i) => [w.toPrecision(6), b.mag[i].toPrecision(6), b.ph[i].toPrecision(6)])
      };
    }
  });

  // 图表切换
  const chartRow = $('#sys-charts');
  const chartDefs = [['bode', '波特图'], ['nyquist', '奈奎斯特图'], ['root', '根轨迹']];
  function setChart(id) {
    chart = id;
    chartRow.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.chart === id));
    $('#sys-chart-bode').classList.toggle('hidden', chart !== 'bode');
    $('#sys-chart-nyq').classList.toggle('hidden', chart !== 'nyquist');
    $('#sys-chart-root').classList.toggle('hidden', chart !== 'root');
    renderChart();
  }
  chartDefs.forEach(([id, label]) => {
    const c = U.el('button', { class: 'chip' + (chart === id ? ' active' : ''), 'data-chart': id }, label);
    c.addEventListener('click', () => setChart(id));
    chartRow.append(c);
  });

  function getPlot(id, opts, redrawFn) {
    if (!plots[id]) {
      plots[id] = new FX.Plot($(id), opts);
      plots[id].onDraw = redrawFn;
    }
    return plots[id];
  }

  /* ---------- 符号参数与家族 ---------- */
  let paramScope = {};   // 参数名 → 当前值
  let sweeps = {};       // 参数名 → 扫掠数组（可选）
  let paramSeeds = {};   // 结构模板种子值（hash 还原时兜底）
  function renderParamRow(params) {
    const box = $('#sys-params');
    box.innerHTML = '';
    if (!params.length) { box.style.display = 'none'; return; }
    box.style.display = '';
    const row = U.el('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px;align-items:center' });
    for (const p of params) {
      if (!(p in paramScope)) paramScope[p] = paramSeeds[p] != null ? paramSeeds[p] : 1;
      const val = U.el('input', { type: 'number', step: 'any', value: paramScope[p], style: 'width:80px', 'aria-label': '参数 ' + p });
      val.addEventListener('change', () => { paramScope[p] = +val.value; delete sweeps[p]; solve(); });
      const sw = U.el('input', { type: 'text', value: (sweeps[p] || []).join(','), placeholder: '扫掠: 0.5,1,2', style: 'width:130px', 'aria-label': p + ' 扫掠列表' });
      sw.addEventListener('change', () => {
        const list = sw.value.trim() ? sw.value.split(/[,，]/).map(Number).filter(isFinite) : null;
        if (list && list.length) sweeps[p] = list.slice(0, 5); else delete sweeps[p];
        solve();
      });
      row.append(U.el('label', { class: 'chip' }, p), val, sw);
    }
    box.append(U.el('div', { class: 'hint', style: 'margin:0 0 6px' }, '检测到符号参数：填值后重解；填「扫掠」可画一族曲线对比。'), row);
  }
  function buildFamily(rawNum, rawDen, params) {
    // 主成员（当前值）+ 各参数扫掠成员（逐参数，上限 5）
    const mkMember = (scope) => {
      const full = { pi: Math.PI, e: Math.E, ...scope };
      const tn = FX_LIB.parseTF(FX_LIB.substituteParams(rawNum || '1', full) + '/(' + FX_LIB.substituteParams(rawDen || '1', full) + ')');
      if (!tn || !tn.den || !tn.den[0] || tn.num.length > tn.den.length) return null;
      return { scope, num: tn.num, den: tn.den };
    };
    const main = mkMember(paramScope);
    if (!main) return null;
    const family = [main];
    for (const p of params) {
      const list = sweeps[p] || [];
      for (const v of list) {
        if (family.length >= 5) break;
        const scope = { ...paramScope, [p]: v };
        if (family.some((m) => JSON.stringify(m.scope) === JSON.stringify(scope))) continue;
        const m = mkMember(scope);
        if (m) family.push(m);
      }
    }
    return family;
  }

  function solve() {
    const cur = tfIn.get();
    const rawNum = cur.numStr || '1', rawDen = cur.denStr || '1';
    const params = [...new Set([...FX_LIB.extractParams(rawNum, ['s']), ...FX_LIB.extractParams(rawDen, ['s'])])];
    renderParamRow(params);
    const family = buildFamily(rawNum, rawDen, params);
    if (!family) {
      $('#sys-tex').innerHTML = '<span style="color:#ff6b6b">无法解析分子/分母，检查括号与 * 号。</span>';
      return;
    }
    num = family[0].num; den = family[0].den;
    const d0 = den[0];
    num = num.map((c) => c / d0); den = den.map((c) => c / d0);
    family[0].num = num; family[0].den = den;   // 主成员归一化后回写，绘制直接用
    cache.family = family;
    // H(s) 写入 URL（分享/刷新后还原，含参数符号），replaceState 避免污染浏览记录
    // 实验激活期间不写旧版 hash，避免覆盖 #exp= 路由（实验状态走实验存储）
    try { if (App.hashFree()) history.replaceState(null, '', '#hn=' + encodeURIComponent(rawNum) + '&hd=' + encodeURIComponent(rawDen)); } catch (e) {}
    Object.keys(cache).forEach((k) => { if (k !== 'family') delete cache[k]; });
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
  /* ---------- 根轨迹：计算移至 Worker（WP 池），主线程仅缓存与绘制 ---------- */
  let rootPending = false;
  function getRootLocus() {
    const key = JSON.stringify(rootLocusTF());
    if (cache.root && cache.rootKey !== key) { delete cache.root; delete cache.rootUnsupported; }
    if (cache.root || cache.rootPending) return cache.root || null;
    if (cache.rootUnsupported) return null;
    cache.rootKey = key;
    cache.rootPending = true;
    const { num: numS, den: denS } = rootLocusTF();
    WP.run('DSP.rootLocus', [numS, denS], { timeout: 20000 }).then((res) => {
      const wasPending = cache.rootPending;
      cache.rootPending = false;
      const v = res && res.ok ? res.value : null;
      if (v && v.branches) { cache.root = v; drawRoot(); }
      else { cache.rootUnsupported = true; if (wasPending) drawRoot(); }
    }).catch(() => { cache.rootPending = false; });
    return null;
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
    drawFamily(bm, (m) => DSP.bode(m.num, m.den, -2, 3, 400), (b) => [b.w, b.mag]);
    bm.crosshair((w) => 'ω=' + U.fmt(w, 3) + ' rad/s', (m) => m.toFixed(1) + ' dB');

    const bp = getPlot('#sys-bph', { logX: true, padding: 0.04 }, drawBode);
    let plo = Infinity, phi = -Infinity;
    for (const v of bode.ph) if (isFinite(v)) { plo = Math.min(plo, v); phi = Math.max(phi, v); }
    if (!isFinite(plo)) { plo = -180; phi = 180; }
    if (phi - plo < 40) { const mid = (plo + phi) / 2; plo = mid - 20; phi = mid + 20; }
    bp.setRange(bode.w[0], bode.w[bode.w.length - 1], plo - 15, phi + 15);
    bp.clear(); bp.grid(null, null); bp.axis();
    bp.line(bode.w, bode.ph, { color: bodeColors.ph, width: 2 });
    drawFamily(bp, (m) => DSP.bode(m.num, m.den, -2, 3, 400), (b) => [b.w, b.ph]);
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
    drawFamily(p, (m) => {
      const re = [], im = [];
      for (let i = 0; i < 300; i++) { const h = DSP.evalH(m.num, m.den, Math.pow(10, U.lerp(-2, 2.5, i / 299))); re.push(h.re); im.push(h.im); }
      return [re, im];
    });
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
    // 判稳提示：完整奈奎斯特判据 Z = N + P（适用于开环不稳定 / 含积分器的情形）
    const nf = DSP.nyquistFull(num, den);
    const kk = (v) => (v > 0 && !isFinite(v)) || v === Infinity ? '∞' : U.fmt(v, 2);
    const nfColor = nf.onCritical ? 'var(--warn)' : nf.stable ? 'var(--accent-2)' : 'var(--danger)';
    const nfText = nf.onCritical
      ? 'G(jω) 曲线经过 (−1,0) 临界点 → 闭环临界稳定（等幅振荡）'
      : nf.stable ? 'Z = N + P = ' + nf.N + ' + ' + nf.P + ' = 0 → 闭环稳定'
        : 'Z = N + P = ' + nf.N + ' + ' + nf.P + ' = ' + nf.Z + ' → 闭环不稳定（' + nf.Z + ' 个右半平面闭环极点）';
    $('#sys-nyq-note').innerHTML =
      '<span style="color:' + nfColor + ';font-weight:600">完整奈奎斯特判据：P=' + nf.P + '（开环右半平面极点）· N=' + nf.N + '（顺时针包围 −1 圈数）· ' + nfText + '</span>'
      + '<span class="hint" style="display:block;margin-top:4px">开环稳定（P=0）时可用简化判据：曲线不包围 (−1,0) → 闭环稳定。含积分器（型别 ≥1）或开环不稳定时必须用上式。</span>';
  }

  function drawRoot() {
    const locus = getRootLocus();
    const p = getPlot('#sys-root', { padding: 0.08 }, drawRoot);
    if (cache.rootPending) {
      p.clear();
      p.label('根轨迹计算中…', p.margin.l + 20, p.margin.t + 40, { color: cv('--cv-tick'), size: 13 });
      return;
    }
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

  // 家族成员叠加（成员 0 = 主成员，由调用方画粗线）：从成员 1 起画细渐变线
  function drawFamily(p, compute, pick) {
    const fam = cache.family;
    if (!fam || fam.length < 2) return;
    p.clip();
    for (let i = 1; i < fam.length; i++) {
      const [xs, ys] = pick(compute(fam[i]));
      p.line(xs, ys, { color: famColor(i), width: 1.4 });
    }
    p.unclip();
  }
  const famColor = (i) => `hsla(${210 + i * 45}, 75%, 60%, 0.95)`;

  function renderMetrics() {
    const bode = getBode();
    const poles = DSP.polyRoots(den);
    const zeros = DSP.polyRoots(num);
    const dc = num[num.length - 1] / den[den.length - 1];
    const hasRhp = poles.some((p) => p.re > 1e-9);
    const hasJw = poles.some((p) => Math.abs(p.re) <= 1e-9);
    const stable = !hasRhp && !hasJw;
    const stableText = stable ? '稳定' : (hasRhp ? '不稳定' : '临界稳定');
    let bw = null;
    const dcmag = Math.abs(dc);
    if (isFinite(dcmag) && dcmag > 1e-6) {
      // 参考电平取 dB，避免 dc 非有限（如 1/s）时把首点误当带宽
      const ref = 20 * Math.log10(dcmag) - 3;
      for (let i = 0; i < bode.mag.length; i++) if (bode.mag[i] < ref) { bw = bode.w[i]; break; }
    }
    const stats = [];
    stats.push({ k: 'DC 增益', v: U.fmt(dc) });
    stats.push({ k: '带宽(-3dB)', v: bw ? U.fmt(bw) + ' rad/s' : '—' });
    stats.push({ k: '稳定性', v: stableText, color: stable ? 'var(--accent-2)' : (hasRhp ? 'var(--danger)' : 'var(--warn)') });
    // 主导极点（实部最大且 < 0）决定 ωₙ / ζ，而非取第一个共轭根
    let dom = null;
    for (const p of poles) { if (p.re >= -1e-9) continue; if (!dom || p.re > dom.re) dom = p; }
    if (dom) {
      const wn = Math.hypot(dom.re, dom.im), zeta = -dom.re / wn;
      stats.push({ k: 'ωₙ / ζ', v: U.fmt(wn) + ' / ' + U.fmt(zeta) });
    }
    // 相位裕度 PM：幅值穿越频率（|H| = 0 dB）处的 180° + ∠H
    const pm = (() => {
      // 取 0 dB 的首次穿越（升/降穿越都算，兼容高通型回路），而非相位穿越 -180°
      let idx = -1;
      for (let i = 0; i < bode.mag.length - 1; i++) if (bode.mag[i] * bode.mag[i + 1] < 0) { idx = i; break; }
      if (idx < 0) return null;
      const dm = bode.mag[idx + 1] - bode.mag[idx];
      const t = Math.abs(dm) < 1e-12 ? 0 : -bode.mag[idx] / dm;
      const phAt = bode.ph[idx] + t * (bode.ph[idx + 1] - bode.ph[idx]);
      return 180 + phAt;
    })();
    stats.push({ k: '相位裕度 PM', v: pm == null ? '—' : U.fmt(pm, 1) + '°' });
    // 增益裕度 GM：相位穿越 -180° 处的增益余量（>0 dB 稳定方向）；不穿越则为无穷
    const gm = (() => {
      let idx = -1;
      for (let i = 0; i < bode.ph.length; i++) if (bode.ph[i] > -180 && (i === bode.ph.length - 1 || bode.ph[i + 1] <= -180)) { idx = i; break; }
      if (idx < 0) return Infinity;
      // 扫到上界相位仍未跌破 -180°（如二阶系统相位渐近 -180°）→ 无相位穿越，GM 为无穷
      if (idx + 1 >= bode.ph.length) return Infinity;
      const dp = bode.ph[idx + 1] - bode.ph[idx];
      const t = Math.abs(dp) < 1e-12 ? 0 : (-180 - bode.ph[idx]) / dp;
      const magAt = bode.mag[idx] + t * (bode.mag[idx + 1] - bode.mag[idx]);
      return isFinite(magAt) ? -magAt : null;
    })();
    stats.push({ k: '增益裕度 GM', v: gm === Infinity ? '∞ dB' : gm == null ? '—' : U.fmt(gm, 1) + ' dB' });
    // 稳态误差与系统型别（单位负反馈）
    const sse = DSP.steadyState(num, den);
    const fmtInf = (v) => !isFinite(v) ? '∞' : U.fmt(v, 3);
    stats.push({ k: '系统型别 ν', v: String(sse.type), color: sse.type > 0 ? 'var(--accent-2)' : undefined });
    stats.push({ k: '误差系数 Kp/Kv/Ka', v: fmtInf(sse.Kp) + ' / ' + fmtInf(sse.Kv) + ' / ' + fmtInf(sse.Ka) });
    $('#sys-metrics').innerHTML = stats.map((s) => `<div class="stat"><span class="k">${s.k}</span><span class="v"${s.color ? ' style="color:' + s.color + '"' : ''}>${s.v}</span></div>`).join('');
    // 稳态误差说明（单位反馈；型别不足 → ∞，型别富余 → 0）
    const essT = (v) => !isFinite(v) ? '∞' : (Math.abs(v) < 1e-12 ? '0' : U.fmt(v, 4));
    $('#sys-ess-hint').textContent =
      '单位反馈稳态误差（幅值 R 的输入）：阶跃 R/s → ' + essT(sse.ess.step)
      + '；斜坡 R/s² → ' + essT(sse.ess.ramp)
      + '；抛物线 R/s³ → ' + essT(sse.ess.para)
      + '。型别 ν = 开环积分环节个数；型别不足时误差为 ∞，型别富余时为 0。';
    // 家族成员指标表（扫掠时出现）
    const fam = cache.family || [];
    if (fam.length > 1) {
      const rows = fam.map((m, i) => {
        const poles = DSP.polyRoots(m.den);
        const hasRhp = poles.some((q) => q.re > 1e-9);
        const hasJw = poles.some((q) => Math.abs(q.re) <= 1e-9);
        const st = !hasRhp && !hasJw ? '稳定' : hasRhp ? '不稳定' : '临界';
        const stColor = !hasRhp && !hasJw ? 'var(--accent-2)' : hasRhp ? 'var(--danger)' : 'var(--warn)';
        let dom = null;
        for (const q of poles) { if (q.re >= -1e-9) continue; if (!dom || q.re > dom.re) dom = q; }
        const zwn = dom ? 'ζ=' + U.fmt(-dom.re / Math.hypot(dom.re, dom.im), 2) + ' ωₙ=' + U.fmt(Math.hypot(dom.re, dom.im), 2) : '—';
        const lbl = Object.entries(m.scope).filter(([k]) => k !== 'pi' && k !== 'e').map(([k, v]) => k + '=' + U.fmt(v, 3)).join(' ');
        const swatch = i === 0 ? '<span class="sw" style="background:var(--accent)"></span>' : `<span class="sw" style="background:${famColor(i)}"></span>`;
        return `<tr><td>${swatch}${lbl || '主成员'}</td><td style="color:${stColor}">${st}</td><td>${zwn}</td></tr>`;
      }).join('');
      const box = document.createElement('div');
      box.innerHTML = '<table class="tbl" style="max-width:520px;margin-top:8px"><tr><th>成员</th><th>稳定性</th><th>主导极点</th></tr>' + rows + '</table>';
      ($('#sys-metrics').parentElement || $('#sys-metrics')).appendChild(box);
    }
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
    // 家族成员阶跃细线（主成员由 timeCanvas 画粗线）
    let famSteps = null;
    const fam = cache.family || [];
    if (fam.length > 1) {
      famSteps = fam.slice(1).map((m, i) => ({
        color: famColor(i + 1),
        res: DSP.ltiResponse(m.num, m.den, (t) => (t >= 0 ? 1 : 0), 0, lastSim.tmax, 1200)
      }));
    }
    timeCanvas('#sys-step', lastSim.step, cv('--cv-line1'), famSteps);
    timeCanvas('#sys-imp', lastSim.imp, cv('--cv-purple2'));
  }
  function timeCanvas(id, data, color, extraLines) {
    const p = getPlot(id, { margin: { l: 50, r: 12, t: 10, b: 26 } });
    // 每次都刷新 onDraw 闭包：data 每次求解都是新对象，沿用旧闭包会让悬停/缩放用旧响应覆盖
    p.onDraw = () => timeCanvas(id, data, color, extraLines);
    let lo = Infinity, hi = -Infinity; for (const v of data.y) if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (extraLines) for (const e of extraLines) for (const v of e.res.y) if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!isFinite(lo)) { lo = -1; hi = 1; } if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    p.setRange(data.t[0], data.t[data.t.length - 1], lo, hi);
    p.clear(); p.grid(); p.axis(true);
    p.clip();
    if (extraLines) for (const e of extraLines) p.line(e.res.t, e.res.y, { color: e.color, width: 1.3 });
    p.line(data.t, data.y, { color, width: 2 });
    p.unclip();
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
    let critical = false;
    const noteZeroRow = () => { critical = true; notes.push('出现全零行：存在关于原点对称的根（纯虚根 / 正负实根对），系统临界，需用辅助方程进一步分析'); };
    let guard = 0;
    while (guard++ < 24) {
      const prev = rows[rows.length - 2], last = rows[rows.length - 1];
      if (!last.some((v) => Math.abs(v) > 1e-12)) { noteZeroRow(); break; }
      if (Math.abs(last[0]) < 1e-10) {
        notes.push('首列出现 0：用小正数 ε 代替继续计算');
        last[0] = 1e-10;
      }
      const nr = [];
      for (let i = 0; i < last.length - 1; i++) nr.push((last[0] * prev[i + 1] - prev[0] * last[i + 1]) / last[0]);
      // 计算出的整行全零同样代表对称根，必须在此判定——否则被 trim 成空数组直接 break 而漏报
      if (!nr.some((v) => Math.abs(v) > 1e-12)) { noteZeroRow(); break; }
      while (nr.length && Math.abs(nr[nr.length - 1]) < 1e-12) nr.pop();
      rows.push(nr);
    }
    // 第一列符号（|v|<1e-8 视作 ε，按正号处理）
    const signOf = (v) => (Math.abs(v) < 1e-8 ? 1 : Math.sign(v));
    const firstCol = rows.map((r) => r[0]);
    let changes = 0;
    for (let i = 1; i < firstCol.length; i++) {
      if (signOf(firstCol[i]) !== signOf(firstCol[i - 1])) changes++;
    }
    return { rows, notes, changes, critical };
  }
  function renderRouth(coefStr) {
    const out = $('#sys-routh-out');
    const c = FX_LIB.parsePoly(coefStr);
    if (!c || !c.length || Math.abs(c[0]) < 1e-12 || c.length < 2) {
      out.innerHTML = '<p style="color:var(--danger)">无法解析特征多项式（首项系数需不为 0），示例：s^3+2*s^2+2*s+1</p>';
      return;
    }
    const { rows, notes, changes, critical } = routhCompute(c);
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
    const concl = changes > 0
      ? `<p style="color:var(--danger);font-weight:600">✗ 第一列变号 ${changes} 次 → 右半平面根 ${changes} 个 → 系统不稳定</p>`
      : critical
        ? `<p style="color:var(--warn);font-weight:600">△ 第一列无变号，但存在全零行 → 临界稳定（虚轴/对称根），不能判定为稳定</p>`
        : `<p style="color:var(--accent-2);font-weight:600">✓ 第一列无变号 → 右半平面根 0 个 → 系统稳定</p>`;
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
    // 注册 onDraw，否则缩放/平移/主题切换后画面不更新
    const drawChar = () => {
      let lo = Infinity, hi = -Infinity;
      for (const v of y) if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      if (!isFinite(lo)) { lo = -1; hi = 1; }
      if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
      const pad = (hi - lo) * 0.12;
      p.setRange(0, tmax, lo - pad, hi + pad);
      p.clear(); p.grid(); p.axis(true);
      p.clip(); p.line(t, y, { color: unstable ? cv('--cv-danger') : cv('--cv-line1'), width: 2 }); p.unclip();
      p.crosshair((x) => 't=' + U.fmt(x, 3), (yy) => 'y=' + U.fmt(yy, 4));
    };
    p.onDraw = drawChar;
    drawChar();
    if (repeated) out.append(U.el('p', { class: 'hint', html: '<span style="color:var(--warn)">⚠ 检测到重根：自由响应含 t·e^{λt} 模态，上图仅绘制单根近似。</span>' }));
  }
  $('#sys-char-go').addEventListener('click', () => renderChar($('#sys-char-in').value));
  $('#sys-char-cur').addEventListener('click', () => { $('#sys-char-in').value = polyToPlain(den); renderChar($('#sys-char-in').value); });
  $('#sys-char-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') renderChar($('#sys-char-in').value); });
  $('#sys-char-fold').addEventListener('toggle', () => {
    if ($('#sys-char-fold').open && !$('#sys-char-in').value.trim()) $('#sys-char-in').value = polyToPlain(den);
  });

  /* ---------- 状态空间分析（SS 内核：能控能观 / Ackermann / 观测器） ---------- */
  const ssPresets = {
    二阶系统: { A: '0 1; -2 -1', B: '0; 1', C: '1 0', D: '0', des: '-1+2j, -1-2j', obs: '-5, -6' },
    双积分器: { A: '0 1; 0 0', B: '0; 1', C: '1 0', D: '0', des: '-2, -2', obs: '-8, -8' },
    不稳定系统: { A: '0 1; 1 0.3', B: '0; 1', C: '1 0', D: '0', des: '-1+2j, -1-2j', obs: '-6, -6' },
    三阶耦合: { A: '0 1 0; 0 0 1; -1 -2 -3', B: '0; 0; 1', C: '1 0 0', D: '0', des: '-1, -1+2j, -1-2j', obs: '-5, -6, -7' }
  };
  function ssParseMat(text, rows) {
    // rows=null → 方阵；返回 {ok, M}；支持换行或「;」分行，空白/逗号分列
    const lines = String(text || '').split(/[\n;]/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return { ok: false, note: '矩阵为空' };
    const M = lines.map((l) => l.split(/[\s,，]+/).filter(Boolean).map(Number));
    if (M.some((r) => r.some((v) => !isFinite(v)))) return { ok: false, note: '存在非数值元素' };
    const w = M[0].length;
    if (M.some((r) => r.length !== w)) return { ok: false, note: '各行列数不一致' };
    if (rows != null && (M.length !== rows || w !== rows)) return { ok: false, note: `应为 ${rows}×${rows}` };
    return { ok: true, M };
  }
  function ssParseVec(text, n) {
    const parts = String(text || '').split(/[\s,，;]+/).filter(Boolean).map(Number);
    if (!parts.length || parts.some((v) => !isFinite(v))) return null;
    if (parts.length !== n) return null;
    return parts;
  }
  function ssParsePoles(text) {
    const out = [];
    for (const tk of String(text || '').split(/[,，;\s]+/).filter(Boolean)) {
      const s = tk.toLowerCase();
      let re = 0, im = 0;
      if (s === 'j' || s === '+j' || s === '-j') { re = 0; im = s[0] === '-' ? -1 : 1; }
      else if (/^[+-]?\d*\.?\d+j$/.test(s)) { re = 0; im = parseFloat(s.slice(0, -1)) || 0; }
      else if (/^([+-]?\d*\.?\d+)([+-]\d*\.?\d*)j$/.test(s)) {
        const m = s.match(/^([+-]?\d*\.?\d+)([+-]\d*\.?\d*)j$/);
        re = parseFloat(m[1]); im = m[2] === '+' ? 1 : m[2] === '-' ? -1 : parseFloat(m[2]);
      } else if (/^[+-]?\d*\.?\d+$/.test(s)) re = parseFloat(s);
      else return null;
      out.push({ re, im });
    }
    // 共轭配对检查：复数极点必须成对（否则特征多项式出现复系数）
    for (const p of out) {
      if (Math.abs(p.im) < 1e-12) continue;
      const has = out.some((q) => q !== p && Math.abs(q.re - p.re) < 1e-9 && Math.abs(q.im + p.im) < 1e-9);
      if (!has) return null;
    }
    return out;
  }
  function renderSS() {
    const out = $('#sys-ss-out');
    const A = ssParseMat($('#sys-ss-a').value, null);
    if (!A.ok) { out.innerHTML = '<p style="color:var(--danger)">A：' + A.note + '，示例：0 1; -2 -1</p>'; return; }
    const n = A.M.length;
    $('#sys-ss-an').textContent = '(' + n + '×' + n + ')';
    const B = ssParseMat($('#sys-ss-b').value, null), Cv = ssParseMat($('#sys-ss-c').value, null), Dv = ssParseMat($('#sys-ss-d').value || '0', null);
    if (!B.ok || B.M.length !== n || B.M[0].length !== 1) { out.innerHTML = '<p style="color:var(--danger)">B 应为 ' + n + '×1 列，如：0; 1</p>'; return; }
    if (!Cv.ok || Cv.M.length !== 1 || Cv.M[0].length !== n) { out.innerHTML = '<p style="color:var(--danger)">C 应为 1×' + n + ' 行，如：1 0</p>'; return; }
    if (!Dv.ok || Dv.M.length !== 1 || Dv.M[0].length !== 1) { out.innerHTML = '<p style="color:var(--danger)">D 应为标量（通常 0）</p>'; return; }
    let r;
    try { r = SS.analyze(A.M, B.M, Cv.M, Dv.M); } catch (e) { out.innerHTML = '<p style="color:var(--danger)">分析失败：' + e.message + '</p>'; return; }
    const fmtR = (q) => U.fmt(q.re, 3) + (Math.abs(q.im) > 1e-9 ? (q.im > 0 ? ' + ' : ' − ') + U.fmt(Math.abs(q.im), 3) + 'j' : '');
    const poleColor = (q) => (q.re > 1e-9 ? 'var(--danger)' : Math.abs(q.re) <= 1e-9 ? 'var(--warn)' : 'var(--accent-2)');
    let html = `<div class="statbar" style="padding:8px 0">
      <div class="stat"><span class="k">阶数 n</span><span class="v">${n}</span></div>
      <div class="stat"><span class="k">稳定性</span><span class="v" style="color:${r.stable ? 'var(--accent-2)' : 'var(--danger)'}">${r.stable ? '渐近稳定（特征值全在左半平面）' : '不稳定'}</span></div>
      <div class="stat"><span class="k">能控性</span><span class="v" style="color:${r.controllable ? 'var(--accent-2)' : 'var(--danger)'}">${r.controllable ? '完全能控' : '不完全能控'}（rank ${r.ctrbRank}/${n}）</span></div>
      <div class="stat"><span class="k">能观性</span><span class="v" style="color:${r.observable ? 'var(--accent-2)' : 'var(--danger)'}">${r.observable ? '完全能观' : '不完全能观'}（rank ${r.obsvRank}/${n}）</span></div>
    </div>
    <table class="tbl" style="max-width:420px"><tr><th>特征值</th><th>位置</th></tr>` +
      r.poles.map((q) => `<tr><td style="font-family:var(--mono)">${fmtR(q)}</td><td style="color:${poleColor(q)}">${q.re > 1e-9 ? '右半平面' : Math.abs(q.re) <= 1e-9 ? '虚轴' : '左半平面'}</td></tr>`).join('') +
      `</table>
      <div class="formula-center" style="margin-top:8px"></div>`;
    out.innerHTML = html;
    try { if (window.katex) window.katex.render('G(s)=C(sI-A)^{-1}B+D=\\dfrac{' + U.polyTex(r.tf.num) + '}{' + U.polyTex(r.tf.den) + '}', out.querySelector('.formula-center'), { throwOnError: false, displayMode: true }); } catch (e) { }
    // 极点配置（Ackermann）与观测器（对偶系统）
    const cfg = [];
    const desTxt = $('#sys-ss-des').value.trim(), obsTxt = $('#sys-ss-obs').value.trim();
    if (desTxt) {
      const des = ssParsePoles(desTxt);
      if (!des || des.length !== n) cfg.push('<p class="hint" style="color:var(--warn)">期望极点应为 ' + n + ' 个且复数成对，示例：-2, -1±2j</p>');
      else if (!r.controllable) cfg.push('<p class="hint" style="color:var(--danger)">系统不完全能控，无法任意配置极点</p>');
      else {
        const K = SS.acker(A.M, B.M, des);
        const clA = A.M.map((row, i) => row.map((v, j) => v - K[j] * B.M[i][0]));
        const clPoles = DSP.polyRoots(SS.charPoly(clA));
        cfg.push('<p><b>状态反馈 K</b> = <span style="font-family:var(--mono);color:var(--accent)">[' + K.map((v) => U.fmt(v, 3)).join(', ') + ']</span>'
          + '　闭环特征值：' + clPoles.map(fmtR).join(', ') + ' <span style="color:var(--accent-2)">✓ 已配置到期望位置</span></p>');
      }
    }
    if (obsTxt) {
      const obs = ssParsePoles(obsTxt);
      if (!obs || obs.length !== n) cfg.push('<p class="hint" style="color:var(--warn)">观测器极点应为 ' + n + ' 个且复数成对</p>');
      else if (!r.observable) cfg.push('<p class="hint" style="color:var(--danger)">系统不完全能观，观测器极点无法任意配置</p>');
      else {
        const L = SS.acker(SS.transpose(A.M), SS.transpose(Cv.M), obs);
        cfg.push('<p><b>观测器增益 L</b> = <span style="font-family:var(--mono);color:var(--purple)">[' + L.map((v) => U.fmt(v, 3)).join(', ') + ']<sup>T</sup></span>（Lᶜ = acker(Aᵀ, Cᵀ, 期望极点)）</p>');
      }
    }
    out.insertAdjacentHTML('beforeend', cfg.join(''));
  }
  {
    const fold = $('#sys-ss-fold'), pRow = $('#sys-ss-presets');
    Object.entries(ssPresets).forEach(([name, p]) => {
      const c = U.el('button', { class: 'chip' }, name);
      c.addEventListener('click', () => {
        $('#sys-ss-a').value = p.A; $('#sys-ss-b').value = p.B; $('#sys-ss-c').value = p.C; $('#sys-ss-d').value = p.D;
        $('#sys-ss-des').value = p.des; $('#sys-ss-obs').value = p.obs;
        renderSS();
      });
      pRow.append(c);
    });
    ['a', 'b', 'c', 'd'].forEach((k) => $('#sys-ss-' + k).addEventListener('input', U.throttle(() => { if (fold.open) renderSS(); }, 400)));
    ['des', 'obs'].forEach((k) => $('#sys-ss-' + k).addEventListener('input', U.throttle(() => { if (fold.open) renderSS(); }, 400)));
    $('#sys-ss-go').addEventListener('click', renderSS);
    fold.addEventListener('toggle', () => { if (fold.open && !$('#sys-ss-a').value.trim()) { const p = ssPresets['二阶系统']; $('#sys-ss-a').value = p.A; $('#sys-ss-b').value = p.B; $('#sys-ss-c').value = p.C; renderSS(); } });
  }

  // 首屏：URL 中带有分享的 H(s)（#hn=..&hd=..）时优先还原
  {
    const hp = new URLSearchParams(location.hash.replace(/^#/, ''));
    const hn = hp.get('hn'), hd = hp.get('hd');
    if (hn != null && hd != null) { tfIn.set(hn, hd); }
  }
  solve();

  return { title: '系统分析', api: { dispose, onTheme: () => { renderChart(); drawTimeStep(); }, getState, applyState } };
  function dispose() { tfIn.destroy(); }
});
