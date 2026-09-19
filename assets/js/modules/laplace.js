/* ============================================================
 * laplace.js — 拉普拉斯变换（反变换视角）
 *   · s 平面：极点/零点 + ROC 收敛域 ↔ 时域响应，稳定性
 *     支持滚轮缩放、点击添加、拖动移动、双击删除、手动输入
 *   · 部分分式（留数法）自动求反变换，解析式与数值仿真叠加验证
 * ============================================================ */
App.register('la', (host) => {
  const cv = FX.cvCol;
  let mode = 'preset', preset = 'second_under';
  let poleSpecs = [], zeroSpecs = []; // {re, im≥0}：im>0 表示共轭对
  let num, den;
  let showROC = true;
  let lastSrc = 'tf';   // 最近编辑的输入来源（'tf' 或 'pz'），决定「应用输入」走哪条分支
  let plots = {};   // 全部画图实例（含实时预览迷你图）

  host.innerHTML = `
    <div class="module layout">
      <div class="pane">
        <h3>系统预设</h3>
        <div class="row" id="la-presets" style="margin-bottom:12px"></div>
        <div class="row" style="margin-bottom:6px">
          <button class="chip" id="la-custom-mode">✎ 在图上点选</button>
          <button class="chip active" id="la-roc-toggle">显示 ROC</button>
          <button class="btn" id="la-clear">清空</button>
          <button class="btn" id="la-reset-view">复位视图</button>
        </div>
        <details class="plot-fold" id="la-input-fold">
          <summary>手动输入 H(s) / 零极点</summary>
          <div id="la-mi" style="margin-top:6px"></div>
          <div class="ctrl"><label>或直接输入极点（逗号分隔，支持 j）</label>
            <input type="text" id="la-poles-in" placeholder="-0.25+1.09j, -0.25-1.09j" spellcheck="false"></div>
          <div class="ctrl"><label>零点（可留空）</label>
            <input type="text" id="la-zeros-in" placeholder="" spellcheck="false"></div>
          <div class="ctrl row">
            <button class="btn primary" id="la-apply">应用输入</button>
            <button class="btn" id="la-share" title="复制当前 H(s) 的分享链接">🔗 分享</button>
            <button class="btn" id="la-toex" title="转到交互求解分析此 H(s)">↗ 求解</button>
          </div>
          <div id="la-lib" style="margin:8px 0"></div>
          <div class="ctrl"><label>实时预览 · 阶跃响应（输入即算）</label>
            <div class="canvas-wrap" style="height:120px"><canvas class="plot" id="la-mini"></canvas></div>
          </div>
          <div class="hint">H(s) 支持因式如 <code>(s+1)*(s+3)</code>；零极点格式：逗号分隔，如 <code>-0.25+1.09j, -2, 0.5</code>。</div>
        </details>
        <div class="formula-center" id="la-tex"></div>
        <div class="hint" id="la-note"></div>
        <div id="la-status" class="statbar"></div>
        <div id="la-rtb"></div>
        <details class="plot-fold" id="la-rocs-fold">
          <summary>ROC 分析（多重收敛域 · 双边 / 因果 / 反因果）</summary>
          <div id="la-rocs-out"><p class="hint" style="margin:4px 0">按上方当前 F(s) 的极点实部划分全部可能收敛域。</p></div>
          <div class="hint">同一 F(s) 可对应多个时域信号（ROC 不同）。仅当 ROC 含虚轴（Re=0）时对应双边稳定信号；最右 ROC 对应因果信号；jω 轴上有极点时不存在含虚轴的 ROC。</div>
        </details>
        <details class="plot-fold" id="la-props-fold">
          <summary>性质数值验证器（定义积分 vs 符号公式）</summary>
          <div id="la-props-mi" style="margin-top:6px"></div>
          <div class="row" id="la-props-chips" style="margin:6px 0;flex-wrap:wrap"></div>
          <div class="ctrl row" style="flex-wrap:wrap">
            <label class="chip"><span id="la-props-plabel">tau =</span> <input type="number" id="la-props-param" value="1" step="any" style="width:76px;background:transparent;border:0;color:var(--accent);font-family:var(--mono)"></label>
            <button class="btn primary" id="la-props-go">数值验证</button>
          </div>
          <div id="la-props-out"></div>
          <div class="hint">在 Re(s) &gt; ROC 的实轴验证点上，比较「变换后时域信号的定义积分」与「符号公式」的值。时移/频移/尺度/微分四条性质的恒等式误差应 &lt; 1e-5。</div>
        </details>
      </div>
      <div class="pane">
        <h3>s 平面（稳定性区域）</h3>
        <div class="canvas-wrap" style="height:320px"><canvas class="plot" id="la-sp"></canvas></div>
        <div class="legend">
          <span style="color:var(--accent-2)">左侧 = 稳定</span>
          <span style="color:var(--warn)">jω 轴 = 临界</span>
          <span style="color:var(--danger)">右侧 = 不稳定</span>
          <span style="color:var(--purple)">■ ROC</span>
        </div>
        <div class="hint" style="margin-top:6px">点选模式：<b>单击</b>加极点(红)、<b>右键</b>加零点(蓝)、<b>拖动</b>移动、<b>双击</b>删除（触屏：<b>长按</b>菜单、<b>双指</b>缩放、<b>拖空白</b>平移）；带虚部的点自动生成共轭对。
          反变换 h(t)=L⁻¹{H(s)} 由极点<b>位置</b>和 <b>ROC</b> 共同唯一确定：ROC 在最右极点右侧（因果系统）→ 各极点项为 e^(p·t) 形式。</div>
      </div>
      <details class="pane full plot-fold">
        <summary>时域响应联动</summary>
        <div class="layout right-side">
          <div class="pane">
            <h3>脉冲响应 h(t)（点 = 留数法解析解）</h3>
            <div class="canvas-wrap" style="height:180px"><canvas class="plot" id="la-imp"></canvas></div>
          </div>
          <div class="pane">
            <h3>阶跃响应（点 = 解析解）</h3>
            <div class="canvas-wrap" style="height:180px"><canvas class="plot" id="la-step"></canvas></div>
          </div>
        </div>
        <div class="formula-center" id="la-inverse"></div>
      </details>
    </div>`;

  const $ = (s) => host.querySelector(s);
  const spCv = $('#la-sp');

  /* ---------- 输入解析 ---------- */
  function parseComplexToken(tok) {
    tok = tok.replace(/−/g, '-').replace(/\s|\*/g, '').replace(/i(?![a-z])/g, 'j');
    if (!tok) return null;
    let m = tok.match(/^([+-]?\d*\.?\d+)$/);                    // 纯实数
    if (m) return { re: parseFloat(m[1]), im: 0 };
    m = tok.match(/^([+-]?\d*\.?\d*)j$/);                       // 纯虚数 / j
    if (m) return { re: 0, im: m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : parseFloat(m[1]) };
    m = tok.match(/^([+-]?\d*\.?\d+)([+-]\d*\.?\d*)j$/);        // 复数
    if (m) return { re: parseFloat(m[1]), im: m[2] === '+' ? 1 : m[2] === '-' ? -1 : parseFloat(m[2]) };
    return null;
  }
  function parseComplexList(str) {
    if (!str || !str.trim()) return null; // 空 = 未提供
    const out = [];
    for (const tok of str.split(/[,，;、]+/)) {
      if (!tok.trim()) continue;
      const c = parseComplexToken(tok);
      if (!c || !isFinite(c.re) || !isFinite(c.im)) return null;
      const spec = { re: c.re, im: Math.abs(c.im) };
      // 共轭对（im>0）只需输入一次：±j 两种写法合并为同一个 spec
      if (spec.im > 1e-9 && out.some((q) => Math.abs(q.re - spec.re) < 1e-9 && Math.abs(q.im - spec.im) < 1e-9)) continue;
      out.push(spec);
    }
    return out;
  }
  function specsToStr(specs) {
    return specs.map((s) => U.fmt(s.re, 3) + (s.im > 1e-9 ? (s.im > 0 ? '+' : '') + U.fmt(s.im, 3) + 'j' : '')).join(', ');
  }
  function syncInputs() {
    $('#la-poles-in').value = poleSpecs.length ? specsToStr(poleSpecs) : '';
    $('#la-zeros-in').value = zeroSpecs.length ? specsToStr(zeroSpecs) : '';
  }

  /* ---------- 预设 ---------- */
  const presets = FX_LIB.laplacePresets;
  const pRow = $('#la-presets');
  Object.keys(presets).forEach((id) => {
    const el = U.el('button', { class: 'chip' + (id === preset ? ' active' : ''), 'data-id': id }, presets[id].name);
    el.addEventListener('click', () => {
      preset = id; mode = 'preset';
      pRow.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === el));
      $('#la-custom-mode').classList.remove('active');
      if (spPlane) spPlane.setEditable(false);
      usePreset(id);
      syncInputs();
    });
    pRow.append(el);
  });
  $('#la-custom-mode').addEventListener('click', () => {
    mode = mode === 'custom' ? 'preset' : 'custom';
    $('#la-custom-mode').classList.toggle('active', mode === 'custom');
    if (spPlane) spPlane.setEditable(mode === 'custom');
    if (mode === 'custom') { if (!poleSpecs.length) poleSpecs = [{ re: -0.5, im: 1.1 }, { re: -1.5, im: 0 }]; buildFromPZ(); syncInputs(); }
    else usePreset(preset);
  });
  $('#la-roc-toggle').addEventListener('click', () => { showROC = !showROC; $('#la-roc-toggle').classList.toggle('active', showROC); drawSP(); });
  $('#la-clear').addEventListener('click', () => { poleSpecs = []; zeroSpecs = []; mode = 'custom'; $('#la-custom-mode').classList.add('active'); if (spPlane) spPlane.setEditable(true); buildFromPZ(); syncInputs(); });
  $('#la-reset-view').addEventListener('click', () => { if (spPlane) spPlane.resetView(); });

  const laStructs = [
    ['一阶', '1', 's+1'],
    ['二阶欠阻尼', '1', 's^2+0.5*s+1.25'],
    ['带通', 's', 's^2+0.4*s+1.21'],
    ['因式', '(s+2)', '(s+1)*(s+3)']
  ];
  /* ---------- H(s) 输入（统一输入组件 MI：键盘/徽标/预览/示例/历史） ---------- */
  const tfIn = MI.tfInput($('#la-mi'), {
    variable: 's',
    properness: true,
    ids: { num: 'la-num', den: 'la-den' },
    placeholder: { num: '分子  如 1 或 s+2', den: '分母  如 s^2+0.5*s+1.25' },
    pad: ['s', '^2', '^3', '*', '/', '(', ')', '+', '-'],
    examples: laStructs,
    debounce: 350,
    onApply: (r, src) => {
      if (!r || !r.tf) return;
      lastSrc = 'tf';
      applyTF(r.tf);
      drawMini({ num, den });
    }
  });
  $('#la-apply').addEventListener('click', () => applyInputs());
  MI.library($('#la-lib'), {
    kinds: ['tf'],
    onSave: () => {
      const c = tfIn.get();
      if (!c.numStr && !c.denStr) return null;
      return { kind: 'tf', data: { variable: 's', num: c.numStr || '1', den: c.denStr || '1' } };
    },
    onLoad: (m) => {
      if (!m.data || m.data.variable !== 's') return;
      tfIn.set(m.data.num, m.data.den);
      lastSrc = 'tf';
      applyInputs();
    }
  });
  $('#la-toex').addEventListener('click', () => {
    const c = tfIn.get();
    const expr = (c.numStr || '1') + '/(' + (c.denStr || '1') + ')';
    try { history.replaceState(null, '', '#ex=' + encodeURIComponent(expr)); } catch (e) { }
    App.open('explore');
  });
  $('#la-poles-in').addEventListener('input', () => { lastSrc = 'pz'; });
  $('#la-zeros-in').addEventListener('input', () => { lastSrc = 'pz'; });
  $('#la-poles-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyInputs(); });
  $('#la-zeros-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyInputs(); });

  /* ---------- 迷你阶跃响应：轻量递推 ---------- */
  let miniTF = null;
  function drawMini(tf) {
    const cvEl = $('#la-mini');
    if (!cvEl) return;
    if (tf) miniTF = tf;
    let p = plots['la-mini'];
    if (!p) {
      p = new FX.Plot(cvEl, { margin: { l: 44, r: 12, t: 10, b: 24 } });
      p.onDraw = () => drawMini(miniTF);   // 折叠面板展开/容器尺寸变化时自动重绘
      plots['la-mini'] = p;
    }
    if (!tf) { p.clear(); p.label('输入有效的 H(s) 后自动显示', p.margin.l + 16, p.margin.t + 40, { color: cv('--cv-label'), size: 12 }); return; }
    const poles = DSP.polyRoots(tf.den);
    const unstable = poles.some((q) => q.re > 1e-9);
    let nearest = Infinity;
    for (const q of poles) if (Math.abs(q.re) > 1e-9) nearest = Math.min(nearest, Math.abs(q.re));
    const tmax = unstable ? 4 : U.clamp(4 / (nearest || 1), 0.8, 16);
    const res = DSP.ltiResponse(tf.num, tf.den, (t) => (t >= 0 ? 1 : 0), 0, tmax, 800);
    let lo = Infinity, hi = -Infinity;
    for (const v of res.y) if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.12;
    p.setRange(res.t[0], res.t[res.t.length - 1], lo - pad, hi + pad);
    p.clear(); p.grid(); p.axis(true);
    p.clip(); p.line(res.t, res.y, { color: cv('--cv-line2'), width: 2 }); p.unclip();
    p.crosshair((t) => 't=' + U.fmt(t, 3), (y) => 'y=' + U.fmt(y, 4));
  }
  // 由 H(s) 应用（MI 校验通过后走这里）
  function applyTF(t) {
    num = t.num; den = t.den;
    const d0 = den[0];
    num = num.map((c) => c / d0); den = den.map((c) => c / d0);
    poleSpecs = rootsToSpecs(DSP.polyRoots(den));
    zeroSpecs = rootsToSpecs(DSP.polyRoots(num));
    mode = 'custom';
    $('#la-custom-mode').classList.add('active');
    pRow.querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
    if (spPlane) spPlane.setEditable(true);
    $('#la-note').textContent = '由 H(s) 求根得到零极点。';
    if (spPlane) spPlane.resetView();
    syncInputs();
    renderTex();
    laWriteHash();
    redraw();
  }
  function applyInputs(fromAuto) {
    const poleStr = $('#la-poles-in').value.trim();
    const zeroStr = $('#la-zeros-in').value.trim();
    const { numStr, denStr } = tfIn.get();
    // 用户最后编辑的是零极点输入时，应走零极点分支；否则 H(s) 分支会把用户输入静默覆盖回去
    const preferPZ = lastSrc === 'pz' && (poleStr || zeroStr);
    if ((numStr || denStr) && !preferPZ) {
      tfIn.apply();   // MI 校验并触发 applyTF；解析失败时徽标已提示
      return;
    } else if (poleStr || zeroStr) {
      const ps = parseComplexList(poleStr), zs = parseComplexList(zeroStr);
      if (ps === null || zs === null) { $('#la-note').innerHTML = '<span style="color:var(--danger)">零极点格式：逗号分隔，如 -0.25+1.09j, -2, 0.5</span>'; return; }
      poleSpecs = ps; zeroSpecs = zs;
      mode = 'custom'; $('#la-custom-mode').classList.add('active');
      pRow.querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
      buildFromPZ();
      $('#la-note').textContent = '由零极点构造 H(s)。';
    } else {
      $('#la-note').textContent = '请输入 H(s) 或至少一组极点。';
      return;
    }
    if (spPlane) spPlane.resetView();   // 新输入：视图复位适配新零极点
    syncInputs();
    renderTex();
    laWriteHash();
    redraw();
  }

  // 多项式 → 可解析字符串（自高到低，显式 * 号，保号）
  function polyToStr(c) {
    // 跳过零系数，避免把 0*s^2 这类冗余项写进 URL（也让还原后的分子不含前导零）
    let out = '';
    for (let i = 0; i < c.length; i++) {
      const x = c[i];
      if (Math.abs(x) < 1e-9) continue;
      const p = c.length - 1 - i;
      const a = +Math.abs(x).toFixed(6);
      out += (out === '' ? (x < 0 ? '-' : '') : (x < 0 ? '-' : '+')) + a + (p === 0 ? '' : p === 1 ? '*s' : '*s^' + p);
    }
    return out || '0';
  }
  function laWriteHash() {
    try {
      const nStr = tfIn.get().numStr || polyToStr(num);
      const dStr = tfIn.get().denStr || polyToStr(den);
      if (App.hashFree()) history.replaceState(null, '', '#lan=' + encodeURIComponent(nStr) + '&lad=' + encodeURIComponent(dStr));
    } catch (e) { }
  }

  function rootsToSpecs(roots) {
    const specs = [];
    for (const r of roots) {
      if (r.im > 1e-6) specs.push({ re: r.re, im: r.im });
      else if (r.im < -1e-6) continue;
      else specs.push({ re: r.re, im: 0 });
    }
    return specs;
  }
  function specsToRoots(specs) {
    const out = [];
    for (const s of specs) {
      out.push({ re: s.re, im: s.im });
      if (s.im > 1e-6) out.push({ re: s.re, im: -s.im });
    }
    return out;
  }

  function usePreset(id) {
    const p = presets[id];
    num = p.num.slice(); den = p.den.slice();
    poleSpecs = rootsToSpecs(DSP.polyRoots(den));
    zeroSpecs = rootsToSpecs(DSP.polyRoots(num));
    if (spPlane) spPlane.resetView();
    renderTex();
    $('#la-note').textContent = p.note;
    redraw();
  }
  function buildFromPZ() {
    if (poleSpecs.length === 0) den = [1];
    else den = DSP.polyFromRoots(specsToRoots(poleSpecs));
    if (zeroSpecs.length === 0) num = [1];
    else {
      num = DSP.polyFromRoots(specsToRoots(zeroSpecs));
      while (num.length < den.length) num.unshift(0);
    }
    renderTex();
    redraw();
  }

  function renderTex() {
    const hostEl = $('#la-tex');
    hostEl.innerHTML = '';
    FX.katex('H(s)=\\dfrac{' + texPoly(num) + '}{' + texPoly(den) + '}', hostEl, { displayMode: true });
  }
  function texPoly(c) { return U.polyTex(c); }

  /* ---------- 留数法部分分式（含重极点）：引擎在 TR 中共享 ---------- */

  /* ---------- 稳定性 ---------- */
  function stability() {
    const poles = specsToRoots(poleSpecs);
    let unstable = false, marginal = false;
    for (const p of poles) {
      if (Math.abs(p.re) < 1e-9) marginal = true;
      if (p.re > 1e-9) unstable = true;
    }
    if (unstable) return { name: '不稳定', color: 'var(--danger)' };
    if (marginal) return { name: '临界稳定', color: 'var(--warn)' };
    return { name: '稳定', color: 'var(--accent-2)' };
  }

  /* ---------- 时域仿真 + 解析叠加 ---------- */
  function simulate() {
    const poles = specsToRoots(poleSpecs);
    let nearest = Infinity;
    for (const p of poles) if (Math.abs(p.re) > 1e-9) nearest = Math.min(nearest, Math.abs(p.re));
    let tau = isFinite(nearest) ? 1 / nearest : 2;
    const st = stability();
    let tmax;
    if (st.name === '不稳定') tmax = 4;
    else if (st.name === '临界稳定') tmax = 8;
    else tmax = U.clamp(4 * tau, 0.8, 18);
    const steps = 2400;
    const step = DSP.ltiResponse(num, den, (t) => (t >= 0 ? 1 : 0), 0, tmax, steps);
    const dt = tmax / steps;
    const imp = { t: step.t.slice(0, -1), y: [] };
    for (let i = 0; i < steps; i++) imp.y.push((step.y[i + 1] - step.y[i]) / dt);
    const pfImp = TR.partialFracGroups(num, den);
    const pfStep = TR.partialFracGroups(num, den.concat(0));   // Y(s)=H(s)/s：分母乘 s
    let ana = null;
    if (pfImp && pfImp.ok && pfStep && pfStep.ok) {
      ana = {
        imp: { t: imp.t, y: imp.t.map((t) => TR.evalLaplaceGroups(pfImp.groups, t)) },
        step: { t: step.t, y: step.t.map((t) => TR.evalLaplaceGroups(pfStep.groups, t)) },
        texImp: TR.texLaplaceGroups(pfImp.groups, 'h(t)=L^{-1}\\{H(s)\\}=') + (Math.abs(pfImp.direct) > 1e-12 ? '+\\text{（另有 }' + U.fmt(pfImp.direct, 2) + '\\delta(t)\\text{ 冲激项）}' : ''),
        texStep: TR.texLaplaceGroups(pfStep.groups, 'y_{step}(t)=')
      };
    }
    return { step, imp, tmax, ana };
  }

  /* ---------- 绘图 ---------- */
  function redraw() {
    drawSP();
    const { step, imp, ana } = simulate();

    const st = stability();
    const poles = specsToRoots(poleSpecs), zeros = specsToRoots(zeroSpecs);
    const pc = poles.map((p, i) => 'p' + (i + 1) + '=' + U.fmt(p.re, 2) + (Math.abs(p.im) > 1e-9 ? (p.im > 0 ? '+' : '') + U.fmt(p.im, 2) + 'j' : ''));
    const zc = zeros.map((z, i) => 'z' + (i + 1) + '=' + U.fmt(z.re, 2) + (Math.abs(z.im) > 1e-9 ? (z.im > 0 ? '+' : '') + U.fmt(z.im, 2) + 'j' : ''));
    const rightmost = poles.reduce((m, p) => Math.max(m, p.re), -Infinity);
    $('#la-status').innerHTML = `
      <div class="stat"><span class="k">稳定性</span><span class="v" style="color:${st.color}">${st.name}</span></div>
      <div class="stat"><span class="k">极点</span><span class="v">${pc.join(', ') || '—'}</span></div>
      <div class="stat"><span class="k">零点</span><span class="v">${zc.join(', ') || '—'}</span></div>
      <div class="stat"><span class="k">ROC</span><span class="v">${isFinite(rightmost) ? 'σ>' + U.fmt(rightmost, 2) : '全平面'}</span></div>`;

    drawTime($('#la-imp'), imp, ana ? ana.imp : null, cv('--cv-purple2'));
    drawTime($('#la-step'), step, ana ? ana.step : null, cv('--cv-line1'));
    const invEl = $('#la-inverse');
    invEl.innerHTML = '';
    if (ana && ana.texImp) {
      invEl.append(FX.span(ana.texImp));
      if (ana.texStep) invEl.append(FX.span(' \\qquad ' + ana.texStep));
    } else {
      invEl.append(FX.span('\\text{（重根/特殊结构：解析式暂不展示，曲线为数值仿真）}'));
    }
  }

  function drawTime(cvEl, data, ana, color) {
    let p = plots[cvEl.id];
    if (!p) { p = new FX.Plot(cvEl, { margin: { l: 50, r: 12, t: 10, b: 26 } }); plots[cvEl.id] = p; }
    p.onDraw = () => drawTime(cvEl, data, ana, color);
    let lo = Infinity, hi = -Infinity;
    for (const y of data.y) if (isFinite(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
    if (ana) for (const y of ana.y) if (isFinite(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
    if (!isFinite(lo)) { lo = -1; hi = 1; }
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    if (!isFinite(lo) || !isFinite(hi) || hi - lo > 1e6) { lo = -10; hi = 10; }
    const pad = (hi - lo) * 0.12;
    p.setRange(data.t[0], data.t[data.t.length - 1], lo - pad, hi + pad);
    p.clear(); p.grid(null, null); p.axis(true);
    p.clip();
    p.line(data.t, data.y, { color, width: 2 });
    if (ana) {
      const stride = Math.max(1, Math.floor(ana.t.length / 60));
      const xs = [], ys = [];
      for (let i = 0; i < ana.t.length; i += stride) { xs.push(ana.t[i]); ys.push(ana.y[i]); }
      p.dots(xs, ys, { color: cv('--cv-warn'), r: 2.2 });
    }
    p.unclip();
    p.crosshair((t) => 't=' + U.fmt(t, 4), (y) => 'y=' + U.fmt(y, 4));
    p.label('t (s)', p.margin.l + p.drawableW - 24, p.margin.t + p.drawableH - 6, { color: cv('--cv-tick'), size: 10 });
  }

  /* ---------- s 平面（共享复平面组件：等比例坐标、触屏可用、ROC 画在 underlay 层） ---------- */
  let spPlane = null;
  // 展开后的根下标 → spec 下标（spec 为 {re, im≥0}，im>0 表示共轭对占两个根）
  function specIdxOf(specs, ri) {
    let k = ri;
    for (let s = 0; s < specs.length; s++) {
      const w = specs[s].im > 1e-6 ? 2 : 1;
      if (k < w) return s;
      k -= w;
    }
    return -1;
  }
  function buildSPPlane() {
    return new FX.ComplexPlane(spCv, {
      mode: 'jw',
      editable: mode === 'custom',
      blankContextAction: 'zero',
      margin: { l: 46, r: 16, t: 16, b: 30 },
      getSpecs: () => ({ poles: specsToRoots(poleSpecs), zeros: specsToRoots(zeroSpecs) }),
      // ROC：最右极点右侧（因果），画在稳定域着色之后、网格之前
      onUnderlay: (ctx, pl) => {
        if (!showROC) return;
        const roots = specsToRoots(poleSpecs);
        if (!roots.length) return;
        const rightmost = roots.reduce((m, q) => Math.max(m, q.re), -Infinity);
        const ml = pl.margin.l, mt = pl.margin.t, dw = pl.drawableW, dh = pl.drawableH;
        const rx = U.clamp(pl.sx(rightmost), ml, ml + dw);
        ctx.fillStyle = cv('--cv-roc-bg');
        ctx.fillRect(rx, mt, ml + dw - rx, dh);
        ctx.strokeStyle = cv('--cv-roc-line');
        ctx.setLineDash([6, 4]); ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(rx, mt); ctx.lineTo(rx, mt + dh); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = cv('--cv-line3'); ctx.font = '11px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText('ROC: σ>' + U.fmt(rightmost, 2), Math.min(rx + 6, ml + dw - 86), mt + 4);
      },
      onMove: (kind, ri, z) => {
        const lst = kind === 'pole' ? poleSpecs : zeroSpecs;
        const si = specIdxOf(lst, ri);
        if (si < 0) return;
        lst[si] = { re: z.re, im: Math.abs(z.im) };
        buildFromPZ();
        syncInputs();
      },
      onAdd: (kind, z) => {
        (kind === 'pole' ? poleSpecs : zeroSpecs).push({ re: z.re, im: Math.abs(z.im) });
        buildFromPZ();
        syncInputs();
      },
      onDelete: (kind, ri) => {
        const lst = kind === 'pole' ? poleSpecs : zeroSpecs;
        const si = specIdxOf(lst, ri);
        if (si >= 0) lst.splice(si, 1);
        buildFromPZ();
        syncInputs();
      },
      // 预设模式下点击画布 → 进入自定义模式（这一次点击不添加，下一次单击才添加）
      onBlankTap: () => {
        if (mode === 'custom') return;
        mode = 'custom';
        $('#la-custom-mode').classList.add('active');
        pRow.querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
        if (!poleSpecs.length) poleSpecs = [{ re: -0.5, im: 1.1 }, { re: -1.5, im: 0 }];
        if (spPlane) spPlane.setEditable(true);
        buildFromPZ();
        syncInputs();
      }
    });
  }
  function drawSP() {
    if (!spPlane) spPlane = buildSPPlane();
    spPlane.redraw();
  }

  // 初始化：URL 带分享的 H(s)（#lan=..&lad=..）时还原，否则用默认预设
  $('#la-share').addEventListener('click', () => {
    laWriteHash();
    const url = location.origin + location.pathname + location.hash;
    const btn = $('#la-share');
    const done = () => { btn.textContent = '✓ 已复制'; setTimeout(() => { btn.textContent = '🔗 分享'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, done);
    else done();
  });
  {
    const lp = new URLSearchParams(location.hash.replace(/^#/, ''));
    const hn = lp.get('lan'), hd = lp.get('lad');
    if (hn != null && hd != null) {
      tfIn.set(hn, hd);
      $('#la-input-fold').open = true;
      lastSrc = 'tf';
      applyInputs();
    } else {
      usePreset('second_under');
      drawMini(null);
    }
  }
  syncInputs();

  /* ---------- 实验接入：状态捕获 / 回放 / 统一结果工具栏 ---------- */
  function getState() {
    const c = tfIn.get();
    return { num: c.numStr || '1', den: c.denStr || '1' };
  }
  function applyState(s) {
    if (!s || typeof s !== 'object') return;
    tfIn.set(String(s.num || '1'), String(s.den || '1'));
    lastSrc = 'tf';
    applyInputs();   // 与模型库回载同一路径：MI 校验 + applyTF + 全量渲染
  }
  RTB.attach($('#la-rtb'), {
    module: 'la',
    getState, applyState,
    canvases: () => ['#la-sp', '#la-imp', '#la-step', '#la-mini'].map((q) => $(q)).filter(Boolean),
    csv: () => {
      if (!num || !den) return null;
      const r = DSP.ltiResponse(num, den, (t) => (t >= 0 ? 1 : 0), 0, 12, 400);
      return { name: 'step', header: ['t(s)', 'y(t)'], rows: r.t.map((t, i) => [t.toPrecision(6), r.y[i].toPrecision(6)]) };
    }
  });

  /* ---------- 性质数值验证器 ---------- */
  {
    const props = [['shift', '时移 tau'], ['freq', '频移 a'], ['scale', '尺度 a'], ['diff', '微分']];
    let cur = 'shift';
    const chips = $('#la-props-chips'), plabel = $('#la-props-plabel');
    props.forEach(([k, label]) => {
      const c = U.el('button', { class: 'chip' + (k === cur ? ' active' : ''), 'data-p': k }, label);
      c.addEventListener('click', () => {
        cur = k;
        chips.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.p === k));
        plabel.textContent = (k === 'shift' ? 'tau =' : k === 'diff' ? '（无需参数）' : 'a =');
      });
      chips.append(c);
    });
    const pin = MI.exprInput($('#la-props-mi'), {
      id: 'la-props-in',
      placeholder: 'f(t)，如 exp(-2*t)*u(t) + sin(3*t)*u(t)',
      parse: (str) => (TR.parseTimeCombo(str) ? { verdict: 'ok', message: '已识别信号' } : { verdict: 'err', message: '无法解析：支持 exp(-a*t)u(t)、sin/cos(w*t)u(t)、t^n、u(t)、常数及加减组合' }),
      examples: [['exp(-2*t)*u(t)', '指数'], ['sin(3*t)*u(t)', '正弦'], ['t^2*u(t)', '斜坡^2']],
      debounce: 300,
      autoApply: false
    });
    pin.set('exp(-2*t)*u(t)');
    $('#la-props-go').addEventListener('click', () => {
      const out = $('#la-props-out');
      const items = TR.parseTimeCombo(pin.get());
      if (!items) { out.innerHTML = '<p style="color:var(--danger)">信号无法解析，示例：exp(-2*t)*u(t)</p>'; return; }
      const r = TR.propVerify(items, cur, +$('#la-props-param').value);
      if (!r.ok) { out.innerHTML = '<p style="color:var(--danger)">' + r.note + '</p>'; return; }
      let html = '<p style="margin:6px 0 2px;font-weight:600">' + r.title + '</p>';
      html += '<div class="formula-center" style="margin:4px 0"></div>';
      html += '<table class="tbl" style="max-width:480px"><tr><th>验证点</th><th>定义积分</th><th>公式值</th><th>相对误差</th></tr>';
      r.checks.forEach((c) => {
        html += `<tr><td>${c.s}</td><td style="font-family:var(--mono)">${U.fmt(c.lhs, 6)}</td><td style="font-family:var(--mono)">${U.fmt(c.rhs, 6)}</td><td style="color:${c.rel < 1e-5 ? 'var(--accent-2)' : 'var(--danger)'}">${c.rel.toExponential(1)}</td></tr>`;
      });
      html += '</table><p style="font-weight:600;color:' + (r.passed ? 'var(--accent-2)' : 'var(--danger)') + '">' + (r.passed ? '✓ 恒等式成立' : '✗ 验证未通过') + '</p>';
      out.innerHTML = html;
      try { if (window.katex) window.katex.render(r.rhsTex, out.querySelector('.formula-center'), { throwOnError: false }); } catch (e) { }
    });
  }

  /* ---------- 多 ROC 分析面板 ---------- */
  function renderRocs() {
    const outEl = $('#la-rocs-out');
    if (!num || !den) { outEl.innerHTML = '<p class="hint">先在上方输入 F(s)</p>'; return; }
    const r = TR.rocs(num, den);
    if (!r.ok) { outEl.innerHTML = '<p class="hint" style="color:var(--danger)">' + r.note + '</p>'; return; }
    let html = '<p class="hint" style="margin:4px 0">极点：' + r.poles.map((q) => U.fmt(q.re, 3) + (Math.abs(q.im) > 1e-9 ? (q.im > 0 ? '+' : '') + U.fmt(Math.abs(q.im), 3) + 'j' : '')).join('，') + (r.axisPole ? '（含 jω 轴极点）' : '') + '</p>';
    html += '<table class="tbl" style="max-width:460px"><tr><th>收敛域 ROC</th><th>时域属性</th><th>稳定性</th></tr>';
    r.regions.forEach((rg) => {
      const attr = rg.causal ? '因果（右边）' : rg.anti ? '反因果（左边）' : '双边';
      html += `<tr><td style="font-family:var(--mono)">${rg.rocTex}</td><td>${attr}</td><td style="color:${rg.stable ? 'var(--accent-2)' : 'var(--danger)'}">${rg.stable ? '稳定' : '不稳定'}</td></tr>`;
    });
    html += '</table>';
    if (r.stableRegion) html += '<p class="hint" style="color:var(--accent-2);margin-top:4px">✓ ROC ' + r.stableRegion.rocTex + ' 含虚轴 → 存在稳定的双边信号对应此 F(s)。</p>';
    else html += '<p class="hint" style="color:var(--warn);margin-top:4px">⚠ 不存在含虚轴的 ROC → 此 F(s) 不对应任何双边稳定信号。</p>';
    outEl.innerHTML = html;
  }
  $('#la-rocs-fold').addEventListener('toggle', () => { if ($('#la-rocs-fold').open) renderRocs(); });

  return { title: '拉普拉斯变换', api: { dispose, onTheme: () => { drawSP(); redraw(); }, getState, applyState } };
  function dispose() {
    if (spPlane) spPlane.dispose();
    tfIn.destroy();
  }
});
