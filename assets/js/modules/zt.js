/* ============================================================
 * zt.js — Z 变换与离散系统分析（信号与系统 / 数字信号处理）
 *   · z 域传递函数 H(z)（分数输入 + 实时预览 + 示例）
 *   · z 平面零极点图：支持**点击添加 / 拖动移动 / 双击删除**，全视图联动
 *   · 单位圆稳定性判据 + ROC + 频率响应 + h(n) 符号解析 + 差分递推
 * ============================================================ */
App.register('zt', (host) => {
  const cv = FX.cvCol;
  let num = [1], den = [1, -0.5];
  let pzPoles = [], pzZeros = [];   // 零极点编辑数据源（完整复数根）
  let editMode = 'pole';            // 点击空白时添加的类型
  let freqPlots = {}, respPlots = {};
  let plane = null;                 // 共享复平面组件（惰性创建）

  host.innerHTML = `
    <div class="module layout">
      <div class="pane">
        <h3>离散传函 H(z)</h3>
        <div id="zt-mi" style="margin-top:8px"></div>
        <div class="row" style="margin-top:8px;align-items:center">
          <button class="btn primary" id="zt-apply">求解并绘图</button>
          <button class="btn" id="zt-save" title="保存当前 H(z) 到模型库">💾 保存</button>
        </div>
        <div id="zt-rtb"></div>
        <div class="row" id="zt-models" style="flex-wrap:wrap;gap:6px;margin:8px 0"></div>
        <div class="formula-center" id="zt-tex" style="margin-top:10px"></div>
        <div class="statbar" id="zt-stats"></div>
        <div class="hint">多项式用<b>正幂 z</b> 书写（如 <code>z^2-0.25</code>），支持因式 <code>(z-0.5)*(z+0.5)</code>。
          稳定性：全部极点位于<b>单位圆内</b> ⇔ 因果系统稳定；因果 ROC：|z| &gt; 最大极点模。
          与连续域联系：<b>z = e<sup>sT</sup></b>，左半 s 平面 ↔ 单位圆内。</div>
        <details class="plot-fold" id="zt-sz-fold">
          <summary>s↔z 映射对比（冲激不变 / ZOH / Tustin 双线性）</summary>
          <div class="ctrl row" style="margin-top:6px">
            <input type="text" id="zt-sz-in" placeholder="连续对象 G(s)，如 2/((s+1)*(s+2))" spellcheck="false" style="flex:1">
            <label class="chip">采样 T <input type="number" id="zt-sz-t" value="0.3" step="any" style="width:64px;background:transparent;border:0;color:var(--accent);font-family:var(--mono)"></label>
            <button class="btn primary" id="zt-sz-go">对比三种映射</button>
          </div>
          <div id="zt-sz-out"></div>
          <div class="hint">冲激不变：脉冲响应采样相等，高频段有混叠；ZOH：阶跃响应相等，含半拍保持滞后；Tustin 双线性：DC 增益与稳定域边界（虚轴↔单位圆）严格一致，频率轴弯曲 ω_s=(2/T)tan(ωT/2)。三种映射都把 s 左半平面极点映到单位圆内。</div>
        </details>
        <details class="plot-fold" id="zt-jury-fold">
          <summary>Jury 稳定判据（特征表，不依赖求根）</summary>
          <div class="ctrl row" style="margin-top:6px">
            <input type="text" id="zt-jury-in" placeholder="特征多项式 D(z)，如 z^3-0.5*z^2+0.25*z-0.125" spellcheck="false" style="flex:1">
            <button class="btn" id="zt-jury-cur" title="填入当前分母 D(z)">用当前 D(z)</button>
            <button class="btn primary" id="zt-jury-go">生成 Jury 表</button>
          </div>
          <div id="zt-jury-out"></div>
          <div class="hint">D(z) 的根全部在单位圆内 ⇔ 满足：a₀&gt;0、D(1)&gt;0、(−1)ⁿD(−1)&gt;0、|aₙ|&lt;a₀，且逐行 r₀&gt;|r_last|。与劳斯表（连续域）对应，可交叉验证上方的「最大极点模」。</div>
        </details>
      </div>
      <div class="pane">
        <h3>z 平面 · 零极点（可编辑）</h3>
        <div class="canvas-wrap" style="height:300px"><canvas id="zt-pz" class="plot" style="width:100%;height:100%"></canvas></div>
        <div class="row" id="zt-modes" style="margin-top:8px">
          <button class="chip active" data-m="pole">✕ 点击空白加极点</button>
          <button class="chip" data-m="zero">○ 点击空白加零点</button>
          <button class="chip" id="zt-pzreset" title="清空全部零极点">🗑 清空</button>
        </div>
        <div class="legend" style="margin-top:6px">
          <span><span class="sw" style="background:var(--danger)"></span>极点 ×</span>
          <span><span class="sw" style="background:var(--accent)"></span>零点 ○</span>
          <span><span class="sw" style="background:var(--accent-2)"></span>单位圆</span>
          <span><b>拖动</b>移动 · <b>双击</b>删除（共轭自动成对）· <b>滚轮/双指</b>缩放 · <b>拖空白</b>平移 · <b>长按</b>菜单</span>
        </div>
      </div>
      <details class="pane full plot-fold">
        <summary>频率响应 H(e^{jω})（ω: 0 → π）</summary>
        <div class="layout right-side">
          <div class="pane"><h3>幅度 |H(e^{jω})|</h3><div class="canvas-wrap" style="height:170px"><canvas class="plot" id="zt-mag"></canvas></div></div>
          <div class="pane"><h3>相位 ∠H(e^{jω})</h3><div class="canvas-wrap" style="height:170px"><canvas class="plot" id="zt-ph"></canvas></div></div>
        </div>
        <div class="hint">ω=π 对应奈奎斯特频率（fs/2）；z=e^{jω} 即沿单位圆一周。</div>
      </details>
      <details class="pane full plot-fold">
        <summary>时域响应 h(n) / 阶跃响应（差分方程递推）</summary>
        <div class="formula-center" id="zt-htex" style="margin-bottom:6px"></div>
        <div class="hint" id="zt-hnote" style="margin-bottom:10px"></div>
        <div class="layout right-side">
          <div class="pane"><h3>冲激响应 h(n)</h3><div class="canvas-wrap" style="height:170px"><canvas class="plot" id="zt-imp"></canvas></div></div>
          <div class="pane"><h3>阶跃响应 s(n)</h3><div class="canvas-wrap" style="height:170px"><canvas class="plot" id="zt-step"></canvas></div></div>
        </div>
        <div class="hint">由 a₀y(n) = Σb_k·x(n−k) − Σa_j·y(n−j) 递推；响应收敛 ⇔ 极点在单位圆内。</div>
      </details>
    </div>`;

  const $ = (s) => host.querySelector(s);
  const texPolyZ = (c) => {
    let out = '';
    for (let i = 0; i < c.length; i++) {
      const pow = c.length - 1 - i, a = c[i];
      if (Math.abs(a) < 1e-9) continue;
      const sgn = i === 0 ? '' : (a > 0 ? '+' : '-');
      const co = (Math.abs(Math.abs(a) - 1) < 1e-9 && pow > 0) ? '' : U.fmt(Math.abs(a), 3);
      out += sgn + co + (pow === 0 ? '' : pow === 1 ? 'z' : 'z^{' + pow + '}');
    }
    return out || '0';
  };
  const plainZ = (c) => c.map((x, i) => {
    const p = c.length - 1 - i;
    const a = +Math.abs(x).toFixed(6);
    return (x < 0 ? '-' : '+') + a + (p === 0 ? '' : p === 1 ? '*z' : '*z^' + p);
  }).join('').replace(/^\+/, '');
  const fmtC = (z) => U.fmt(z.re, 3) + (Math.abs(z.im) > 1e-9 ? (z.im >= 0 ? '+' : '') + U.fmt(z.im, 3) + 'j' : '');

  /* ---------- 输入路径（统一输入组件 MI：键盘/徽标/示例/历史/防抖应用） ---------- */
  const tfIn = MI.tfInput($('#zt-mi'), {
    variable: 'z',
    properness: true,
    ids: { num: 'zt-num', den: 'zt-den' },
    placeholder: { num: '分子  如 1 或 z+0.5', den: '分母  如 z-0.5 或 z^2-0.25' },
    pad: ['z', '^2', '^3', '*', '(', ')', '+', '-'],
    examples: [
      ['1', 'z-0.5', '一阶低通'], ['1', 'z^2-0.25', '双极点'],
      ['z', 'z^2-1.6*z+0.9425', '谐振器'], ['z-0.5', 'z^2-0.25', '带零点'],
      ['1', 'z-1', '积分器(边界)'], ['0.2', 'z-0.8', '漏积分']
    ],
    debounce: 350,
    onApply: (r) => { if (r && r.tf) fromTF(r.tf); }
  });
  function fromTF(t) {
    if (!t || !t.den || !t.den[0]) return;
    const d0 = t.den[0];
    num = t.num.map((c) => c / d0); den = t.den.map((c) => c / d0);
    pzPoles = DSP.polyRoots(den);
    pzZeros = t.num.length > 1 ? DSP.polyRoots(num) : [];
    renderAll();
    if (plane) plane.resetView();   // 新 H(z)：视图复位适配新零极点
  }
  $('#zt-apply').addEventListener('click', () => tfIn.apply());
  $('#zt-save').addEventListener('click', () => {
    const c = tfIn.get();
    if (!c.numStr && !c.denStr) return;
    MI.nameAsk('H(z) 模型', (name) => {
      App.models.save({ name, kind: 'tf', data: { variable: 'z', num: c.numStr || '1', den: c.denStr || '1' } });
      renderModels();
    });
  });
  const renderModels = App.models.renderChips($('#zt-models'), {
    kinds: ['tf'],
    emptyText: '暂无保存的模型',
    onLoad: (m) => {
      if (!m.data || m.data.variable !== 'z') return;
      tfIn.set(m.data.num, m.data.den);
      fromTF(FX_LIB.parseTFFields(m.data.num || '1', m.data.den || '1', 'z'));
    }
  });
  $('#zt-pzreset').addEventListener('click', () => {
    pzPoles = []; pzZeros = []; num = [1]; den = [1];
    tfIn.set('1', '1');
    renderAll();
    if (plane) plane.resetView();
  });
  $('#zt-modes').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b || !b.dataset.m) return;
    editMode = b.dataset.m;
    if (plane) plane.setDefaultAdd(editMode);
    $('#zt-modes').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === b));
  });
  // 零极点编辑路径：由 specs 重建多项式 → 输入框同步 → 全量渲染
  function applySpecs() {
    if (pzPoles.length) {
      den = DSP.polyFromRoots(pzPoles);
      const d0 = den[0] || 1; den = den.map((c) => c / d0);
    } else den = [1];
    if (pzZeros.length) {
      num = DSP.polyFromRoots(pzZeros);
      const n0 = num[0] || 1; num = num.map((c) => c / n0);
    } else num = [1];
    while (num.length < den.length) num.unshift(0);
    tfIn.set(plainZ(num), plainZ(den));
    renderAll();
  }

  /* ---------- 主渲染 ---------- */
  function renderAll() {
    const poles = pzPoles, zeros = pzZeros;
    const maxAbs = poles.reduce((m, q) => Math.max(m, Math.hypot(q.re, q.im)), 0);
    const onCircle = poles.some((q) => Math.abs(Math.hypot(q.re, q.im) - 1) < 1e-6);
    const unstable = poles.some((q) => Math.hypot(q.re, q.im) > 1 + 1e-9);
    // 圆外极点优先于圆上极点：两者并存时系统是不稳定，而非“临界”
    const stable = !unstable && !onCircle;
    $('#zt-tex').innerHTML = '';
    FX.katex('H(z)=\\dfrac{' + texPolyZ(num) + '}{' + texPolyZ(den) + '}', $('#zt-tex'), { displayMode: true });
    $('#zt-stats').innerHTML = `
      <div class="stat"><span class="k">极点</span><span class="v">${poles.map(fmtC).join(', ') || '—'}</span></div>
      <div class="stat"><span class="k">零点</span><span class="v">${zeros.map(fmtC).join(', ') || '—'}</span></div>
      <div class="stat"><span class="k">最大极点模</span><span class="v">${U.fmt(maxAbs, 3)}</span></div>
      <div class="stat"><span class="k">ROC(因果)</span><span class="v">${maxAbs > 0 ? '|z|>' + U.fmt(maxAbs, 3) : '全平面'}</span></div>
      <div class="stat"><span class="k">稳定性</span><span class="v" style="color:${stable ? cv('--cv-line2') : unstable ? cv('--cv-danger') : cv('--cv-warn')}">${stable ? '稳定' : unstable ? '不稳定' : '临界(极点在圆上)'}</span></div>`;
    drawPZ();
    drawFreq();
    drawResp(stable);
    const hTex = $('#zt-htex'), hNote = $('#zt-hnote');
    if (num.length > den.length) {
      hTex.innerHTML = ''; hNote.innerHTML = '<span style="color:var(--warn)">⚠ 当前为非真分式（分子阶次更高），h(n) 解析式需先做多项式除法，暂不生成；数值曲线仍正确。</span>';
    } else if (window.TR) {
      const r = TR.invZ(num, den);
      hTex.innerHTML = '';
      if (r.tex) { FX.katex(r.tex, hTex, { displayMode: true }); hNote.innerHTML = r.note || ''; }
      else hNote.innerHTML = '<span style="color:var(--warn)">⚠ ' + r.note + '</span>';
    }
  }

  /* ---------- z 平面（共享复平面组件：点击加 / 拖动移 / 双击删 / 滚轮·双指缩放 / 长按菜单） ---------- */
  function ensurePlane() {
    if (plane) return plane;
    const cvEl = $('#zt-pz');
    if (!cvEl) return null;
    plane = new FX.ComplexPlane(cvEl, {
      mode: 'unit',
      editable: true,
      defaultAdd: editMode,
      blankContextAction: 'zero',
      getSpecs: () => ({ poles: pzPoles, zeros: pzZeros }),
      // 拖动：先按「旧位置」锁定共轭伙伴再同步移动（此前在重赋值后反查，实际拖动中共轭并不跟随）
      onMove: (kind, i, z) => {
        const arr = kind === 'pole' ? pzPoles : pzZeros;
        const cur = arr[i];
        const wasConj = Math.abs(cur.im) > 1e-9;
        const j = wasConj ? arr.findIndex((q, k) => k !== i && Math.abs(q.re - cur.re) < 1e-6 && Math.abs(q.im + cur.im) < 1e-6) : -1;
        arr[i] = { re: z.re, im: z.im };
        if (j >= 0) arr[j] = Math.abs(z.im) > 1e-9 ? { re: z.re, im: -z.im } : { re: z.re, im: 0 };
        applySpecs();
      },
      onAdd: (kind, z) => {
        const arr = kind === 'pole' ? pzPoles : pzZeros;
        arr.push({ re: z.re, im: z.im });
        if (Math.abs(z.im) > 1e-9) arr.push({ re: z.re, im: -z.im });
        applySpecs();
      },
      onDelete: (kind, i) => {
        const arr = kind === 'pole' ? pzPoles : pzZeros;
        const q = arr[i];
        for (let k = arr.length - 1; k >= 0; k--) {
          if (k === i) continue;
          if (Math.abs(arr[k].re - q.re) < 1e-6 && Math.abs(arr[k].im + q.im) < 1e-6) arr.splice(k, 1);
        }
        arr.splice(i, 1);
        applySpecs();
      }
    });
    return plane;
  }
  function drawPZ() { if (ensurePlane()) plane.redraw(); }

  /* ---------- 频率响应 ---------- */
  function freqData() {
    const NW = 600, w = [], mag = [], ph = [];
    for (let i = 0; i < NW; i++) {
      const wv = (i / (NW - 1)) * Math.PI;
      const z = { re: Math.cos(wv), im: Math.sin(wv) };
      const h = DSP.cdiv(DSP.horner(num, z), DSP.horner(den, z));
      w.push(wv); mag.push(U.toDb(Math.hypot(h.re, h.im))); ph.push((180 / Math.PI) * Math.atan2(h.im, h.re));
    }
    return { w, mag, ph };
  }
  function drawFreq() {
    const { w, mag, ph } = freqData();
    const drawOne = (id, ys, color, unit) => {
      let p = freqPlots[id];
      if (!p) { p = new FX.Plot($(id), { padding: 0.03 }); p.onDraw = drawFreq; freqPlots[id] = p; }
      let lo = Infinity, hi = -Infinity;
      for (const v of ys) if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      if (!isFinite(lo)) { lo = -1; hi = 1; }
      if (hi - lo < 1) { hi += 1; lo -= 1; }
      const pad = (hi - lo) * 0.1;
      p.setRange(0, Math.PI, lo - pad, hi + pad);
      p.clear(); p.grid(); p.axis(true);
      p.clip(); p.line(w, ys, { color, width: 2 }); p.unclip();
      p.crosshair((wv) => 'ω=' + U.fmt(wv, 3), (v) => unit + U.fmt(v, 2));
    };
    drawOne('#zt-mag', mag, cv('--cv-line1'), '');
    drawOne('#zt-ph', ph, cv('--cv-line3'), '');
  }

  /* ---------- 时域响应 ---------- */
  function simulate(xArr) {
    const a = den.map((c) => c / den[0]);
    let b = num.map((c) => c / den[0]);
    // num/den 为正幂 z 多项式（自高到低）：补零必须补在【高位】前端，
    // 使 b[k] 对应 z^{degree−k} → 差分方程 b[k]·x(n−k)。此前 push 在低位导致 h(n) 整体错位
    while (b.length < a.length) b.unshift(0);
    const n = a.length - 1;
    const y = new Array(xArr.length).fill(0);
    for (let i = 0; i < xArr.length; i++) {
      let acc = 0;
      // 遍历 b 的全部长度：非真分式（分子阶次更高）时高次项也参与，不可截断到 n
      for (let k = 0; k < b.length; k++) if (i - k >= 0) acc += b[k] * xArr[i - k];
      for (let j = 1; j <= n; j++) if (i - j >= 0) acc -= a[j] * y[i - j];
      y[i] = acc;
    }
    return y;
  }
  function drawResp(stable) {
    const N = Math.min(stable ? 60 : 90, 120);
    const nIdx = [], impX = [], stepX = [];
    for (let i = 0; i < N; i++) { nIdx.push(i); impX.push(i === 0 ? 1 : 0); stepX.push(1); }
    const h = simulate(impX), s = simulate(stepX);
    const drawStem = (id, ys, color) => {
      let p = respPlots[id];
      if (!p) { p = new FX.Plot($(id), { padding: 0.04 }); p.onDraw = drawRespAll; respPlots[id] = p; }
      let lo = Infinity, hi = -Infinity;
      for (const v of ys) if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      if (!isFinite(lo)) { lo = -1; hi = 1; }
      if (hi - lo < 0.2) { hi += 0.2; lo -= 0.2; }
      const pad = (hi - lo) * 0.12;
      p.setRange(0, N - 1, lo - pad, hi + pad);
      p.clear(); p.grid(); p.axis(true);
      p.clip(); p.line(nIdx, ys, { color, width: 1.4 }); p.dots(nIdx, ys, { color, r: 2.4 }); p.unclip();
      p.crosshair((n) => 'n=' + Math.round(n), (v) => 'y=' + U.fmt(v, 4));
    };
    // h/s 每次都是新数组：onDraw 必须刷新，否则悬停/缩放会用上一次的响应重绘
    function drawRespAll() { drawStem('#zt-imp', h, cv('--cv-line1')); drawStem('#zt-step', s, cv('--cv-line2')); }
    Object.values(respPlots).forEach((p) => { p.onDraw = drawRespAll; });
    drawRespAll();
  }

  tfIn.set('1', 'z-0.5');
  fromTF(FX_LIB.parseTFFields('1', 'z-0.5', 'z'));

  /* ---------- Jury 稳定判据面板 ---------- */
  function renderJury(str) {
    const out = $('#zt-jury-out');
    const c = FX_LIB.parsePoly(str, 'z');
    if (!c || !c.length || c.length < 3 || !(c[0] > 0)) {
      out.innerHTML = '<p style="color:var(--danger)">无法解析（需阶数 ≥ 2 且首项系数为正），示例：z^3-0.5*z^2+0.25*z-0.125</p>';
      return;
    }
    const j = DSP.jury(c);
    if (!j.ok) { out.innerHTML = '<p style="color:var(--danger)">' + j.note + '</p>'; return; }
    const deg = c.length - 1;
    let html = '<table class="tbl" style="margin-top:8px;max-width:480px"><tr>';
    for (let k = 0; k <= deg; k++) html += `<th>c${k + 1}</th>`;
    html += '</tr>';
    j.rows.forEach((pair, i) => {
      html += '<tr>' + pair.map((v) => `<td style="font-family:var(--mono)">${U.fmt(v, 4)}</td>`).join('') +
        (pair.length < deg + 1 ? '<td></td>'.repeat(deg + 1 - pair.length) : '') + '</tr>';
    });
    html += '</table>';
    html += j.conds.map((cd) => `<p class="hint" style="margin:2px 0;color:${cd.ok ? 'var(--accent-2)' : 'var(--danger)'}">${cd.ok ? '✓' : '✗'} ${cd.text}</p>`).join('');
    html += `<p style="font-weight:600;color:${j.stable ? 'var(--accent-2)' : 'var(--danger)'}">${j.stable ? '✓ 全部满足 → 特征根都在单位圆内 → 系统稳定' : '✗ 存在不满足项 → 存在单位圆上或圆外特征根 → 系统不稳定'}</p>`;
    html += `<p class="hint">求根交叉验证：最大极点模 = ${U.fmt(Math.max(...DSP.polyRoots(c).map((q) => Math.hypot(q.re, q.im))), 4)}${j.stable ? '（&lt; 1，一致）' : '（≥ 1，一致）'}</p>`;
    out.innerHTML = html;
  }
  $('#zt-jury-go').addEventListener('click', () => renderJury($('#zt-jury-in').value));
  $('#zt-jury-cur').addEventListener('click', () => { $('#zt-jury-in').value = plainZ(den); renderJury($('#zt-jury-in').value); });
  $('#zt-jury-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') renderJury($('#zt-jury-in').value); });
  $('#zt-jury-fold').addEventListener('toggle', () => {
    if ($('#zt-jury-fold').open && !$('#zt-jury-in').value.trim()) { $('#zt-jury-in').value = plainZ(den); renderJury($('#zt-jury-in').value); }
  });

  /* ---------- s↔z 映射对比面板 ---------- */
  function renderSZ() {
    const out = $('#zt-sz-out');
    const tf = FX_LIB.parseTF($('#zt-sz-in').value, 's');
    const T = +$('#zt-sz-t').value;
    if (!tf || !tf.den || !tf.den[0]) { out.innerHTML = '<p style="color:var(--danger)">无法解析 G(s)，示例：2/((s+1)*(s+2))</p>'; return; }
    if (!isFinite(T) || !(T > 0)) { out.innerHTML = '<p style="color:var(--danger)">采样周期 T 必须为正数</p>'; return; }
    const sPoles = DSP.polyRoots(tf.den).map(fmtC).join(', ');
    const rows = [
      ['冲激不变', BLKSOLVE.sToZ(tf.num, tf.den, T), '脉冲响应采样相等；高频混叠'],
      ['ZOH 零阶保持', BLKSOLVE.zohDiscretize(tf.num, tf.den, T), '阶跃响应相等；含半拍保持滞后'],
      ['Tustin 双线性', BLKSOLVE.tustin(tf.num, tf.den, T), 'DC 增益与虚轴↔单位圆严格一致；频率轴弯曲']
    ];
    let html = `<p class="hint" style="margin:4px 0">G(s) = <b>${texPolyZ(tf.num)} / ${texPolyZ(tf.den)}</b>，s 极点：${sPoles || '—'}；采样 T = ${U.fmt(T, 3)}s</p>`;
    for (const [name, r, note] of rows) {
      if (!r || r.ok === false) {
        html += `<p class="hint" style="color:var(--danger)">✗ ${name}：${(r && r.note) || '变换失败'}</p>`;
        continue;
      }
      const zp = DSP.polyRoots(r.d).map(fmtC).join(', ');
      html += `<p style="margin:6px 0 2px"><b>${name}</b>　<span style="font-family:var(--mono)">H(z)=(${texPolyZ(r.n)})/(${texPolyZ(r.d)})</span></p>
        <p class="hint" style="margin:0 0 4px">z 极点：${zp || '—'}　·　${note}</p>`;
    }
    out.innerHTML = html;
  }
  $('#zt-sz-go').addEventListener('click', renderSZ);
  $('#zt-sz-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') renderSZ(); });
  $('#zt-sz-fold').addEventListener('toggle', () => {
    if ($('#zt-sz-fold').open && !$('#zt-sz-in').value.trim()) { $('#zt-sz-in').value = '2/((s+1)*(s+2))'; renderSZ(); }
  });

  /* ---------- 实验接入：状态捕获 / 回放 / 统一结果工具栏 ---------- */
  function getState() {
    const c = tfIn.get();
    return { num: c.numStr || '1', den: c.denStr || '1', editMode };
  }
  function applyState(s) {
    if (!s || typeof s !== 'object') return;
    tfIn.set(String(s.num || '1'), String(s.den || '1'));
    const t = FX_LIB.parseTFFields(String(s.num || '1'), String(s.den || '1'), 'z');
    if (t) fromTF(t);
  }
  RTB.attach($('#zt-rtb'), {
    module: 'zt',
    getState, applyState,
    canvases: () => ['#zt-pz', '#zt-mag', '#zt-ph', '#zt-imp', '#zt-step'].map((s) => $(s)).filter(Boolean),
    csv: () => {
      const d = freqData();
      return {
        name: 'freq',
        header: ['omega(rad)', 'gain(dB)', 'phase(deg)'],
        rows: d.w.map((w, i) => [w.toPrecision(6), d.mag[i].toPrecision(6), d.ph[i].toPrecision(6)])
      };
    }
  });

  return { title: 'Z 变换', api: { dispose, onTheme: () => { renderAll(); }, getState, applyState } };
  function dispose() { if (plane) plane.dispose(); }
});
