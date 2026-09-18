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
          <div class="tf-frac" style="margin-top:6px">
            <input type="text" id="la-num" placeholder="分子  如 1 或 s+2" spellcheck="false" aria-label="分子">
            <div class="tf-bar" title="分数线"></div>
            <input type="text" id="la-den" placeholder="分母  如 s^2+0.5*s+1.25" spellcheck="false" aria-label="分母">
          </div>
          <div class="row kbd" id="la-pad" style="margin:2px 0 8px"></div>
          <div class="hint" id="la-preview" style="margin-bottom:8px"></div>
          <div class="row" id="la-struct" style="margin-bottom:10px"></div>
          <div class="ctrl"><label>或直接输入极点（逗号分隔，支持 j）</label>
            <input type="text" id="la-poles-in" placeholder="-0.25+1.09j, -0.25-1.09j" spellcheck="false"></div>
          <div class="ctrl"><label>零点（可留空）</label>
            <input type="text" id="la-zeros-in" placeholder="" spellcheck="false"></div>
          <div class="ctrl row">
            <button class="btn primary" id="la-apply">应用输入</button>
            <button class="btn" id="la-share" title="复制当前 H(s) 的分享链接">🔗 分享</button>
          </div>
          <div class="ctrl"><label>实时预览 · 阶跃响应（输入即算）</label>
            <div class="canvas-wrap" style="height:120px"><canvas class="plot" id="la-mini"></canvas></div>
          </div>
          <div class="hint">H(s) 支持因式如 <code>(s+1)*(s+3)</code>；零极点格式：逗号分隔，如 <code>-0.25+1.09j, -2, 0.5</code>。</div>
        </details>
        <div class="formula-center" id="la-tex"></div>
        <div class="hint" id="la-note"></div>
        <div id="la-status" class="statbar"></div>
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
        <div class="hint" style="margin-top:6px">点选模式：<b>左键</b>加极点(红)、<b>右键</b>加零点(蓝)、<b>拖动</b>移动、<b>双击</b>删除；带虚部的点自动生成共轭对。
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
      usePreset(id);
      syncInputs();
    });
    pRow.append(el);
  });
  $('#la-custom-mode').addEventListener('click', () => {
    mode = mode === 'custom' ? 'preset' : 'custom';
    $('#la-custom-mode').classList.toggle('active', mode === 'custom');
    if (mode === 'custom') { if (!poleSpecs.length) poleSpecs = [{ re: -0.5, im: 1.1 }, { re: -1.5, im: 0 }]; buildFromPZ(); syncInputs(); }
    else usePreset(preset);
  });
  $('#la-roc-toggle').addEventListener('click', () => { showROC = !showROC; $('#la-roc-toggle').classList.toggle('active', showROC); drawSP(); });
  $('#la-clear').addEventListener('click', () => { poleSpecs = []; zeroSpecs = []; mode = 'custom'; $('#la-custom-mode').classList.add('active'); buildFromPZ(); syncInputs(); });
  $('#la-reset-view').addEventListener('click', () => {
    if (!spPlot) return;
    spPlot.userAdjusted = false;
    const r = defaultSPRange();
    spPlot.setRange(r[0], r[1], r[2], r[3], true);
    drawSP();
  });

  const laStructs = [
    ['一阶', '1', 's+1'],
    ['二阶欠阻尼', '1', 's^2+0.5*s+1.25'],
    ['带通', 's', 's^2+0.4*s+1.21'],
    ['因式', '(s+2)', '(s+1)*(s+3)']
  ];
  const laSRow = $('#la-struct');
  if (laSRow) {
    laStructs.forEach(([name, n, d]) => {
      const c = U.el('button', { class: 'chip' }, name);
      c.addEventListener('click', () => { $('#la-num').value = n; $('#la-den').value = d; applyInputs(); });
      laSRow.append(c);
    });
  }
  $('#la-apply').addEventListener('click', applyInputs);
  ['#la-num', '#la-den', '#la-poles-in', '#la-zeros-in'].forEach((sel) => {
    $(sel).addEventListener('keydown', (e) => { if (e.key === 'Enter') applyInputs(); });
  });

  /* ---------- H(s) 输入实时预览 + 自动应用 + 迷你波形 ---------- */
  const laFrac = $('#la-num').closest('.tf-frac');
  // 符号键盘（光标处插入）
  {
    const padRow = $('#la-pad');
    ['s', '^2', '^3', '*', '/', '(', ')', '+', '-'].forEach((tok) => {
      const b = U.el('button', { class: 'chip pad-key', title: '插入 ' + tok }, tok === '^2' ? 's²' : tok === '^3' ? 's³' : tok);
      b.addEventListener('click', () => {
        const inp = document.activeElement && (document.activeElement.id === 'la-num' || document.activeElement.id === 'la-den') ? document.activeElement : $('#la-den');
        const s = inp.selectionStart == null ? inp.value.length : inp.selectionStart;
        const e2 = inp.selectionEnd == null ? s : inp.selectionEnd;
        inp.value = inp.value.slice(0, s) + tok + inp.value.slice(e2);
        inp.focus();
        try { inp.setSelectionRange(s + tok.length, s + tok.length); } catch (err) { }
        inp.dispatchEvent(new Event('input'));
      });
      padRow.append(b);
    });
  }
  let laPvTimer = null, laAutoTimer = null;
  // 返回解析结果（无效时为 null），同时刷新预览徽标
  function laPreview() {
    const nStr = $('#la-num').value.trim(), dStr = $('#la-den').value.trim();
    const box = $('#la-preview');
    if (!nStr && !dStr) { box.innerHTML = ''; laFrac.classList.remove('invalid'); drawMini(null); return null; }
    const t = FX_LIB.parseTFFields(nStr || '1', dStr || '1');
    if (!t || !t.den || !t.den[0]) {
      laFrac.classList.add('invalid');
      box.innerHTML = '<span style="color:var(--danger)">✗ 解析失败：支持 s^2、2*s、(s+1)*(s+3) 等写法</span>';
      drawMini(null);
      return null;
    }
    laFrac.classList.remove('invalid');
    const d0 = t.den[0], nn = t.num.map((c) => c / d0), dd = t.den.map((c) => c / d0);
    const bad = nn.length > dd.length;
    box.innerHTML = bad ? '<span style="color:var(--warn)">⚠ 非真分式（分子阶次 > 分母阶次）</span>' : '<span style="color:var(--accent-2)">✓ </span>';
    box.append(FX.span('H(s)=\\dfrac{' + texPoly(nn) + '}{' + texPoly(dd) + '}'));
    return bad ? null : { num: nn, den: dd };
  }
  // 迷你阶跃响应：轻量递推，输入即算
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
  ['#la-num', '#la-den'].forEach((sel) => $(sel).addEventListener('input', () => {
    clearTimeout(laPvTimer); clearTimeout(laAutoTimer);
    laPvTimer = setTimeout(() => {
      const t = laPreview();
      // 输入合法（真分式）即自动应用，无需手点「应用输入」；出错只提示不打断
      if (t) laAutoTimer = setTimeout(() => applyInputs(true), 550);
    }, 250);
  }));
  laPreview();
  function applyInputs(fromAuto) {
    const numStr = ($('#la-num').value || '').trim();
    const denStr = ($('#la-den').value || '').trim();
    const poleStr = $('#la-poles-in').value.trim();
    const zeroStr = $('#la-zeros-in').value.trim();
    if (numStr || denStr) {
      const t = FX_LIB.parseTFFields(numStr || '1', denStr || '1');
      if (!t || !t.den || !t.den[0]) { if (!fromAuto) $('#la-note').innerHTML = '<span style="color:var(--danger)">H(s) 解析失败，示例：分子 1，分母 s^2+0.5*s+1.25</span>'; return; }
      if (t.num.length > t.den.length) { if (!fromAuto) $('#la-note').innerHTML = '<span style="color:var(--danger)">分子阶次需 ≤ 分母阶次（非真分式无法仿真时域响应）。</span>'; return; }
      num = t.num; den = t.den;
      const d0 = den[0];
      num = num.map((c) => c / d0); den = den.map((c) => c / d0);
      poleSpecs = rootsToSpecs(DSP.polyRoots(den));
      zeroSpecs = rootsToSpecs(DSP.polyRoots(num));
      mode = 'custom';
      $('#la-custom-mode').classList.add('active');
      pRow.querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
      $('#la-note').textContent = '由 H(s) 求根得到零极点。';
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
    if (spPlot) spPlot.userAdjusted = false;
    syncInputs();
    renderTex();
    laWriteHash();
    redraw();
  }

  // 多项式 → 可解析字符串（自高到低，显式 * 号，保号）
  function polyToStr(c) {
    return c.map((x, i) => {
      const p = c.length - 1 - i;
      const a = +Math.abs(x).toFixed(6);
      return (x < 0 ? '-' : '+') + a + (p === 0 ? '' : p === 1 ? '*s' : '*s^' + p);
    }).join('').replace(/^\+/, '');
  }
  function laWriteHash() {
    try {
      const nStr = $('#la-num').value.trim() || polyToStr(num);
      const dStr = $('#la-den').value.trim() || polyToStr(den);
      history.replaceState(null, '', '#lan=' + encodeURIComponent(nStr) + '&lad=' + encodeURIComponent(dStr));
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
    if (spPlot) spPlot.userAdjusted = false;
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
  function polyStr(c) {
    return c.map((x, i) => (Math.abs(x) < 1e-9 ? '' : (i === 0 ? '' : (x > 0 ? ' + ' : ' - ')) + Math.abs(x) + 's^' + (c.length - 1 - i))).join('') || '0';
  }

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

  /* ---------- s 平面（FX.Plot：滚轮缩放） ---------- */
  function defaultSPRange() {
    const pts = [...specsToRoots(poleSpecs), ...specsToRoots(zeroSpecs)];
    let xr = 4, xi = 3;
    for (const q of pts) {
      if (!q || !isFinite(q.re) || !isFinite(q.im)) continue;
      xr = Math.max(xr, Math.abs(q.re) + 1.2);
      xi = Math.max(xi, Math.abs(q.im) + 1.2);
    }
    xr = Math.min(Math.max(xr, 2.5), 40);
    xi = Math.min(Math.max(xi, 2.5), 40);
    return [-xr, Math.max(1.6, xr * 0.4), -xi, xi];
  }
  let spPlot = null;
  function drawSP() {
    if (!spPlot) {
      spPlot = new FX.Plot(spCv, { margin: { l: 46, r: 16, t: 16, b: 30 }, padding: 0, pan: false, hover: false, dblclickReset: false });
      spPlot.onDraw = drawSP;
    }
    if (!spPlot.userAdjusted) {
      const r = defaultSPRange();
      spPlot.setRange(r[0], r[1], r[2], r[3], true);
    }
    const p = spPlot;
    const { ctx } = p;
    p.clear();

    const ml = p.margin.l, mt = p.margin.t, dw = p.drawableW, dh = p.drawableH;
    const x0px = U.clamp(p.sx(0), ml, ml + dw);

    // 稳定/不稳定底色
    ctx.fillStyle = cv('--cv-stable-bg'); ctx.fillRect(ml, mt, x0px - ml, dh);
    ctx.fillStyle = cv('--cv-unstable-bg'); ctx.fillRect(x0px, mt, ml + dw - x0px, dh);

    // ROC：最右极点右侧（因果）
    const poles = specsToRoots(poleSpecs);
    if (showROC && poles.length) {
      const rightmost = poles.reduce((m, q) => Math.max(m, q.re), -Infinity);
      const rx = U.clamp(p.sx(rightmost), ml, ml + dw);
      ctx.fillStyle = cv('--cv-roc-bg');
      ctx.fillRect(rx, mt, ml + dw - rx, dh);
      ctx.strokeStyle = cv('--cv-roc-line');
      ctx.setLineDash([6, 4]); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(rx, mt); ctx.lineTo(rx, mt + dh); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = cv('--cv-line3'); ctx.font = '11px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('ROC: σ>' + U.fmt(rightmost, 2), Math.min(rx + 6, ml + dw - 86), mt + 4);
    }

    p.grid(null, null);
    p.axis(true);
    ctx.fillStyle = cv('--cv-label'); ctx.font = '11px monospace';
    ctx.fillText('σ', ml + dw - 12, mt + 4);
    ctx.fillText('jω', ml + 6, mt + 14);

    // 极点 / 零点
    for (const q of poles) drawSym(p.sx(q.re), p.sy(q.im), 'pole', cv('--cv-danger'));
    for (const z of specsToRoots(zeroSpecs)) drawSym(p.sx(z.re), p.sy(z.im), 'zero', cv('--cv-line1'));
    function drawSym(x, y, kind, color) {
      ctx.save();
      ctx.lineWidth = 2; ctx.strokeStyle = color;
      if (kind === 'pole') {
        const s = 8;
        ctx.beginPath(); ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.moveTo(x - s, y + s); ctx.lineTo(x + s, y - s); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.stroke();
      }
      ctx.restore();
    }
  }

  /* ---------- s 平面交互（考虑缩放） ---------- */
  function canvasPos(e) {
    const r = spCv.getBoundingClientRect();
    const px = (e.clientX - r.left) * (spCv.clientWidth / r.width);
    const py = (e.clientY - r.top) * (spCv.clientHeight / r.height);
    const re = spPlot.xAt(px), im = spPlot.yAt(py);
    const mx = 0.2 * (spPlot.xmax - spPlot.xmin), my = 0.2 * (spPlot.ymax - spPlot.ymin);
    return { re: U.clamp(re, spPlot.xmin - mx, spPlot.xmax + mx), im: U.clamp(im, spPlot.ymin - my, spPlot.ymax + my) };
  }
  function nearSpec(p, specs) {
    const tol = 0.045 * (spPlot.xmax - spPlot.xmin);   // 容差随缩放自适应
    let best = -1, bd = tol;
    for (let i = 0; i < specs.length; i++) {
      for (const im of specs[i].im > 1e-6 ? [specs[i].im, -specs[i].im] : [0]) {
        const d = Math.hypot(specs[i].re - p.re, im - p.im);
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  }
  let dragKind = null, dragIdx = -1;
  spCv.addEventListener('contextmenu', (e) => e.preventDefault());
  spCv.addEventListener('mousedown', (e) => {
    if (mode !== 'custom') { mode = 'custom'; $('#la-custom-mode').classList.add('active'); pRow.querySelectorAll('.chip').forEach((x) => x.classList.remove('active')); }
    const p = canvasPos(e);
    const pi = nearSpec(p, poleSpecs), zi = nearSpec(p, zeroSpecs);
    if (pi >= 0) { dragKind = 'pole'; dragIdx = pi; }
    else if (zi >= 0) { dragKind = 'zero'; dragIdx = zi; }
    else if (e.button === 2) { zeroSpecs.push({ re: p.re, im: Math.abs(p.im) }); dragKind = null; }
    else { poleSpecs.push({ re: p.re, im: Math.abs(p.im) }); dragKind = null; }
    buildFromPZ();
    syncInputs();
  });
  spCv.addEventListener('mousemove', (e) => {
    if (!dragKind) return;
    const p = canvasPos(e);
    const lst = dragKind === 'pole' ? poleSpecs : zeroSpecs;
    if (lst[dragIdx]) { lst[dragIdx] = { re: p.re, im: Math.abs(p.im) }; buildFromPZ(); }
  });
  window.addEventListener('mouseup', () => { if (dragKind) syncInputs(); dragKind = null; dragIdx = -1; });
  spCv.addEventListener('dblclick', (e) => {
    if (mode !== 'custom') return;
    const p = canvasPos(e);
    const pi = nearSpec(p, poleSpecs), zi = nearSpec(p, zeroSpecs);
    if (pi >= 0) poleSpecs.splice(pi, 1);
    else if (zi >= 0) zeroSpecs.splice(zi, 1);
    else return;
    buildFromPZ();
    syncInputs();
  });

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
      $('#la-num').value = hn;
      $('#la-den').value = hd;
      $('#la-input-fold').open = true;
      applyInputs();
    } else {
      usePreset('second_under');
    }
  }
  syncInputs();

  return { title: '拉普拉斯变换', api: { dispose, onTheme: () => { drawSP(); redraw(); } } };
  function dispose() { }
});
