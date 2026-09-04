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

  host.innerHTML = `
    <div class="module layout">
      <div class="pane">
        <h3>系统预设</h3>
        <div class="row" id="la-presets" style="margin-bottom:12px"></div>
        <div class="row" style="margin-bottom:6px">
          <button class="chip" id="la-custom-mode">✎ 在图上点选</button>
          <button class="chip active" id="la-roc-toggle">显示 ROC</button>
          <button class="btn" id="la-clear">清空</button>
        </div>
        <div class="ctrl"><label>手动输入 H(s)</label></div>
        <div class="tf-frac">
          <input type="text" id="la-num" placeholder="分子  如 1 或 s+2" spellcheck="false" aria-label="分子">
          <div class="tf-bar" title="分数线"></div>
          <input type="text" id="la-den" placeholder="分母  如 s^2+0.5*s+1.25" spellcheck="false" aria-label="分母">
        </div>
        <div class="row" id="la-struct" style="margin-bottom:10px"></div>
        <div class="ctrl"><label>或直接输入极点（逗号分隔，支持 j）</label>
          <input type="text" id="la-poles-in" placeholder="-0.25+1.09j, -0.25-1.09j" spellcheck="false"></div>
        <div class="ctrl"><label>零点（可留空）</label>
          <input type="text" id="la-zeros-in" placeholder="" spellcheck="false"></div>
        <div class="ctrl row">
          <button class="btn primary" id="la-apply">应用输入</button>
          <button class="btn" id="la-reset-view">复位视图</button>
        </div>
        <div class="hint">点选模式：<b>左键</b>加极点(红)、<b>右键</b>加零点(蓝)、<b>拖动</b>移动、<b>双击</b>删除；带虚部的点自动生成共轭对。
          s 平面支持<b>滚轮缩放</b>，缩放后点击更精准。</div>
        <div class="formula-center" id="la-tex"></div>
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
        <div class="hint" style="margin-top:6px">反变换 h(t)=L⁻¹{H(s)} 由极点<b>位置</b>和 <b>ROC</b> 共同唯一确定：
          ROC 在最右极点右侧（因果系统）→ 各极点项为 e^(p·t) 形式。</div>
      </div>
      <details class="pane full plot-fold" open>
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
        <div class="hint" id="la-note"></div>
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
  $('#la-reset-view').addEventListener('click', () => { if (spPlot) spPlot.resetView(); });

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
  function applyInputs() {
    const numStr = ($('#la-num').value || '').trim();
    const denStr = ($('#la-den').value || '').trim();
    const poleStr = $('#la-poles-in').value.trim();
    const zeroStr = $('#la-zeros-in').value.trim();
    if (numStr || denStr) {
      const t = FX_LIB.parseTFFields(numStr || '1', denStr || '1');
      if (!t || !t.den || !t.den[0]) { $('#la-note').innerHTML = '<span style="color:var(--danger)">H(s) 解析失败，示例：分子 1，分母 s^2+0.5*s+1.25</span>'; return; }
      num = t.num; den = t.den;
      const d0 = den[0];
      num = num.map((c) => c / d0); den = den.map((c) => c / d0);
      poleSpecs = rootsToSpecs(DSP.polyRoots(den));
      zeroSpecs = rootsToSpecs(DSP.polyRoots(num));
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
    syncInputs();
    renderTex();
    redraw();
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
    const tex = 'H(s)=\\dfrac{' + texPoly(num) + '}{' + texPoly(den) + '}';
    if (window.katex) window.katex.render(tex, hostEl, { throwOnError: false, displayMode: true });
    else hostEl.textContent = polyStr(num) + ' / ' + polyStr(den);
  }
  function texPoly(c) {
    let out = '';
    for (let i = 0; i < c.length; i++) {
      const pow = c.length - 1 - i, a = c[i];
      if (Math.abs(a) < 1e-9) continue;
      const sgn = i === 0 ? '' : (a > 0 ? '+' : '-');
      const coeff = (Math.abs(Math.abs(a) - 1) < 1e-9 && pow > 0) ? '' : U.fmt(Math.abs(a), 3);
      const sPart = pow === 0 ? '' : (pow === 1 ? 's' : 's^{' + pow + '}');
      out += sgn + coeff + sPart;
    }
    return out || '0';
  }
  function polyStr(c) {
    return c.map((x, i) => (Math.abs(x) < 1e-9 ? '' : (i === 0 ? '' : (x > 0 ? ' + ' : ' - ')) + Math.abs(x) + 's^' + (c.length - 1 - i))).join('') || '0';
  }

  /* ---------- 留数法部分分式（数值） ---------- */
  function partialFractions(num, den, poles) {
    const n = den.length - 1;
    const dd = [];
    for (let i = 0; i < n; i++) dd.push(den[i] * (n - i));
    const terms = [];
    const used = new Array(poles.length).fill(false);
    for (let i = 0; i < poles.length; i++) {
      if (used[i]) continue;
      const p = poles[i];
      const dp = DSP.horner(dd, p);
      if (Math.hypot(dp.re, dp.im) < 1e-6) return null;
      const r = DSP.cdiv(DSP.horner(num, p), dp);
      if (Math.abs(p.im) > 1e-6) {
        let j = -1;
        for (let k = 0; k < poles.length; k++) {
          if (k !== i && !used[k] && Math.abs(poles[k].re - p.re) < 1e-4 && Math.abs(poles[k].im + p.im) < 1e-4) { j = k; break; }
        }
        if (j < 0) return null;
        used[j] = true;
        terms.push({ p: { re: p.re, im: Math.abs(p.im) }, r, pair: true });
      } else {
        terms.push({ p: { re: p.re, im: 0 }, r: { re: r.re, im: 0 }, pair: false });
      }
      used[i] = true;
    }
    return terms;
  }
  function evalTerms(terms, t, denom) {
    let y = 0;
    for (const { p, r, pair } of terms) {
      const rr = denom === 's' ? DSP.cdiv(r, p) : r;
      if (pair) y += 2 * Math.exp(p.re * t) * (rr.re * Math.cos(p.im * t) - rr.im * Math.sin(p.im * t));
      else y += rr.re * Math.exp(p.re * t);
    }
    return y;
  }
  function texInverse(terms, kind) {
    if (!terms) return '';
    const fx = (v) => { const n = Math.abs(v) < 1e-12 ? 0 : +v.toFixed(2); return (n < 0 ? '-' : '') + Math.abs(n); };
    let s = kind === 'imp' ? 'h(t)=L^{-1}\\{H(s)\\}=' : 'y_{step}(t)=';
    let first = true;
    const part = (txt) => { s += (first ? '' : '+') + txt; first = false; };
    for (const { p, r, pair } of terms) {
      const rr = kind === 'step' ? DSP.cdiv(r, p) : r;
      const et = 'e^{' + fx(p.re) + 't}';
      if (pair) {
        const A = fx(rr.re), B = fx(-rr.im);
        const cosPart = Math.abs(+rr.re.toFixed(2)) < 0.005 ? '' : A + '\\cos(' + fx(p.im) + 't)';
        const sinPart = Math.abs(+rr.im.toFixed(2)) < 0.005 ? '' : (B.startsWith('-') ? B : '+') + B + '\\sin(' + fx(p.im) + 't)';
        part('2' + et + '\\left(' + (cosPart || sinPart || '0') + (cosPart ? sinPart : '') + '\\right)');
      } else {
        part(fx(rr.re) + (Math.abs(p.re) < 1e-9 ? '' : et));
      }
    }
    return s;
  }

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
    const roots = poles;
    const pf = partialFractions(num, den, roots);
    let ana = null;
    if (pf) {
      const impAna = { t: imp.t, y: imp.t.map((t) => evalTerms(pf, t, 'none')) };
      const hasPoleAt0 = Math.abs(den[den.length - 1]) < 1e-9;
      const constTerm = hasPoleAt0 ? null : num[num.length - 1] / den[den.length - 1];
      const stepAna = hasPoleAt0 ? null : { t: step.t, y: step.t.map((t) => constTerm + evalTerms(pf, t, 's')) };
      ana = { pf, imp: impAna, step: stepAna, texImp: texInverse(pf, 'imp'), texStep: hasPoleAt0 ? '' : texInverse(pf, 'step') };
    }
    return { step, imp, tmax, ana };
  }

  /* ---------- 绘图 ---------- */
  let plots = {};
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
  const XR = [-4.5, 1.8], YR = [-3, 3];
  let spPlot = null;
  function drawSP() {
    if (!spPlot) {
      spPlot = new FX.Plot(spCv, { margin: { l: 46, r: 16, t: 16, b: 30 }, padding: 0, pan: false, hover: false, dblclickReset: false });
      spPlot.onDraw = drawSP;
      spPlot.setRange(XR[0], XR[1], YR[0], YR[1], true);
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
  });
  spCv.addEventListener('mousemove', (e) => {
    if (!dragKind) return;
    const p = canvasPos(e);
    const lst = dragKind === 'pole' ? poleSpecs : zeroSpecs;
    if (lst[dragIdx]) { lst[dragIdx] = { re: p.re, im: Math.abs(p.im) }; buildFromPZ(); }
  });
  window.addEventListener('mouseup', () => { dragKind = null; dragIdx = -1; });
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

  // 初始化
  usePreset('second_under');
  syncInputs();

  return { title: '拉普拉斯变换', api: { dispose, onTheme: () => { drawSP(); redraw(); } } };
  function dispose() { }
});
