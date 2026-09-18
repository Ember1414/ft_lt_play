/* ============================================================
 * explore.js — 交互求解
 *   · 表达式自动求解（时域信号 / 传递函数自动识别）
 *   · 手绘闭合路径 → 傅立叶圈套圈
 *   · 语音输入表达式
 * ============================================================ */
App.register('explore', (host) => {
  const cv = FX.cvCol;
  let tab = 'expr';
  let exprRedraw = null, tfRedraw = null, drawReset = null;
  const rendered = { expr: false, sym: false, draw: false, voice: false };
  let dloop = null, epicy = null, loopRunning = false;   // 手绘动画循环（模块级，便于清理）
  let speechRec = null;                                   // 语音识别实例（dispose 时停止）

  host.innerHTML = `
    <div class="module">
      <div class="row" id="ex-tabs" style="margin-bottom:14px"></div>
      <div id="ex-expr" class="hidden"></div>
      <div id="ex-sym" class="hidden"></div>
      <div id="ex-draw" class="hidden"></div>
      <div id="ex-voice" class="hidden"></div>
    </div>`;

  /* ---------- 表达式求解 ---------- */
  function renderExpr() {
    const box = host.querySelector('#ex-expr');
    box.innerHTML = `
      <div class="pane" style="margin-bottom:16px">
        <h3>输入表达式 · 自动识别时域信号 / 传递函数</h3>
        <div class="input-bar">
          <input type="text" id="ex-input" placeholder="例：exp(-2*t)*sin(10*t)*u(t)   或   5/(s^2+0.5*s+1.25)" spellcheck="false" autocomplete="off">
          <button class="btn primary" id="ex-go">求解</button>
          <button class="btn" id="ex-share" title="复制当前表达式的分享链接">🔗</button>
        </div>
        <div class="row" style="margin-top:10px;align-items:center">
          <span id="ex-type" class="hint" style="margin:0"></span>
        </div>
        <div class="row kbd" id="ex-pad" style="margin-top:10px"></div>
        <div class="row" id="ex-history" style="margin-top:10px"></div>
        <div class="row" id="ex-examples" style="margin-top:10px"></div>
        <div class="hint">自动识别：含 <code>s</code> 变量且含 <code>/</code> → 按<b>传递函数</b>求解（波特图+阶跃+极点零点）；否则按 <code>t</code> 的<b>时域信号</b>求解（波形+频谱）。
          可用函数：<code>u(t)</code> 阶跃、<code>sinc(x)</code>、<code>rect(x)</code>、<code>tri(x)</code>、<code>exp/ln/sin/cos/tan/abs/sign/sqrt</code>，<code>pi</code>。</div>
      </div>
      <div id="ex-result" class="layout"><div class="pane" style="grid-column:1/-1;color:var(--text-dim)">输入表达式后点击“求解”。</div></div>`;

    const examples = [
      ['exp(-2*t)*sin(10*t)*u(t)', '衰减振荡'],
      ['sin(2*pi*3*t)', '3Hz 正弦'],
      ['3*sinc(t)', 'sinc 脉冲'],
      ['rect(t)-rect(t-2)', '双矩形'],
      ['exp(-abs(t))', '双边指数'],
      ['1/(s^2+0.5*s+1.25)', '二阶系统'],
      ['(s+2)/(s^2+4)', '超前网络'],
      ['10/(s*(s+5))', '含积分器']
    ];
    const exRow = box.querySelector('#ex-examples');
    examples.forEach(([expr, name]) => {
      const c = U.el('button', { class: 'chip', title: expr }, name);
      c.addEventListener('click', () => { const inp = box.querySelector('#ex-input'); inp.value = expr; inp.dispatchEvent(new Event('input')); go(); });
      exRow.append(c);
    });

    /* ---------- 符号键盘：在光标处插入 token（手机端友好） ---------- */
    const pad = box.querySelector('#ex-pad');
    const tokens = ['t', 'u(t)', 'sin(', 'cos(', 'tan(', 'exp(', 'ln(', 'sqrt(', 'abs(',
      'sinc(', 'rect(', 'tri(', '^2', 'pi', '(', ')', '*', '/', '+', '-'];
    tokens.forEach((tok) => {
      const b = U.el('button', { class: 'chip pad-key', title: '插入 ' + tok }, tok === '^2' ? 'x²' : tok === 'pi' ? 'π' : tok);
      b.addEventListener('click', () => {
        const inp = box.querySelector('#ex-input');
        const s = inp.selectionStart == null ? inp.value.length : inp.selectionStart;
        const e = inp.selectionEnd == null ? s : inp.selectionEnd;
        inp.value = inp.value.slice(0, s) + tok + inp.value.slice(e);
        const pos = s + tok.length;
        inp.focus();
        try { inp.setSelectionRange(pos, pos); } catch (err) {}
        inp.dispatchEvent(new Event('input'));
      });
      pad.append(b);
    });

    /* ---------- 实时识别徽标（输入即校验，无需先点求解） ---------- */
    const typeEl = box.querySelector('#ex-type');
    let typeTimer = null;
    const detectType = (str) => {
      if (!str) { typeEl.innerHTML = ''; return; }
      const bare = str.replace(/\s+/g, '');
      const isTF = /(^|[^a-zA-Z0-9_])s([^a-zA-Z0-9_]|$)/.test(bare) && bare.includes('/');
      if (isTF) {
        const t = FX_LIB.parseTF(str);
        const ok = t && t.den && t.den[0] && t.num.length <= t.den.length;
        typeEl.innerHTML = ok
          ? '<span style="color:var(--accent-2)">✓ 识别为传递函数 H(s)：将绘制波特图 · 阶跃响应 · 零极点</span>'
          : '<span style="color:var(--danger)">✗ 传递函数格式有误（需为 s 的多项式之比，且分子阶次 ≤ 分母阶次）</span>';
      } else {
        const f = FX_LIB.parseTimeExpr(str);
        typeEl.innerHTML = f
          ? '<span style="color:var(--accent-2)">✓ 识别为时域信号 x(t)：将绘制波形 · 幅度谱 · 相位谱</span>'
          : '<span style="color:var(--danger)">✗ 暂无法解析，请检查括号与函数名（支持 u(t)、sinc、rect、tri、exp…）</span>';
      }
    };
    const inpEl = box.querySelector('#ex-input');
    inpEl.addEventListener('input', () => {
      clearTimeout(typeTimer);
      typeTimer = setTimeout(() => detectType(inpEl.value.trim()), 220);
    });

    /* ---------- 历史记录（localStorage，最近 10 条，点击回填） ---------- */
    const HKEY = 'flt-expr-history';
    let exprHistory = [];   // 注意：不可命名 history，会遮蔽全局 history 对象
    try { exprHistory = JSON.parse(localStorage.getItem(HKEY) || '[]'); if (!Array.isArray(exprHistory)) exprHistory = []; } catch (e) { exprHistory = []; }
    const histRow = box.querySelector('#ex-history');
    function renderHistory() {
      histRow.innerHTML = '';
      if (!exprHistory.length) return;
      histRow.append(U.el('span', { class: 'hint', style: 'margin:0' }, '历史：'));
      exprHistory.slice(0, 8).forEach((expr) => {
        const short = expr.length > 22 ? expr.slice(0, 22) + '…' : expr;
        const c = U.el('button', { class: 'chip', title: expr }, short);
        c.addEventListener('click', () => {
          const inp = box.querySelector('#ex-input');
          inp.value = expr;
          inp.dispatchEvent(new Event('input'));
          go();
        });
        histRow.append(c);
      });
      const clr = U.el('button', { class: 'chip', title: '清空历史' }, '🗑');
      clr.addEventListener('click', () => { exprHistory = []; localStorage.removeItem(HKEY); renderHistory(); });
      histRow.append(clr);
    }
    function addHistory(str) {
      exprHistory = [str, ...exprHistory.filter((x) => x !== str)].slice(0, 10);
      try { localStorage.setItem(HKEY, JSON.stringify(exprHistory)); } catch (e) {}
      renderHistory();
    }
    renderHistory();

    /* ---------- 分享链接：表达式写入 URL hash ---------- */
    function shareLink(str) {
      const url = location.origin + location.pathname + '#ex=' + encodeURIComponent(str);
      const done = () => { typeEl.innerHTML = '<span style="color:var(--accent-2)">🔗 分享链接已复制</span>'; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, () => { location.hash = 'ex=' + encodeURIComponent(str); });
      } else { location.hash = 'ex=' + encodeURIComponent(str); done(); }
    }

    const go = () => {
      const str = box.querySelector('#ex-input').value.trim();
      if (!str) return;
      // 's' 必须是独立变量（而非 sin/abs 的首字母）且含 '/' → 传递函数
      const bare = str.replace(/\s+/g, '');
      const isTF = /(^|[^a-zA-Z0-9_])s([^a-zA-Z0-9_]|$)/.test(bare) && bare.includes('/');
      const res = box.querySelector('#ex-result');
      // 仅在解析成功时写入历史与 URL
      let ok = false;
      if (isTF) {
        const t = FX_LIB.parseTF(str);
        ok = !!(t && t.den && t.den[0] && t.num.length <= t.den.length);
      } else {
        ok = !!FX_LIB.parseTimeExpr(str);
      }
      if (!ok) { if (isTF) renderTF(res, str); else renderTime(res, str); return; }
      addHistory(str);
      try { history.replaceState(null, '', '#ex=' + encodeURIComponent(str)); } catch (e) {}
      if (isTF) renderTF(res, str); else renderTime(res, str);
    };
    box.querySelector('#ex-go').addEventListener('click', go);
    box.querySelector('#ex-share').addEventListener('click', () => shareLink(box.querySelector('#ex-input').value.trim() || inpEl2.value));
    box.querySelector('#ex-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });

    // 初始值：优先 URL 分享参数，其次历史最近一条，最后默认示例
    const urlExpr = new URLSearchParams(location.hash.replace(/^#/, '')).get('ex');
    const inpEl2 = box.querySelector('#ex-input');
    if (urlExpr) {
      inpEl2.value = urlExpr;
    } else if (exprHistory.length) {
      inpEl2.value = exprHistory[0];
    } else {
      inpEl2.value = 'exp(-2*t)*sin(10*t)*u(t)';
    }
    inpEl2.dispatchEvent(new Event('input'));
    go();
  }

  function renderTime(res, str) {
    const f = FX_LIB.parseTimeExpr(str);
    res.innerHTML = `
      <div class="pane" style="grid-column:1/-1">
        <div class="formula-center">x(t) = <code>${str.replace(/</g, '&lt;')}</code></div>
        <div class="row" style="justify-content:center">
          <label class="chip">t ∈ [<input type="number" id="ex-t0" value="-4" step="1" style="width:64px;background:transparent;border:0;color:var(--accent);font-family:var(--mono)"> , <input type="number" id="ex-t1" value="8" step="1" style="width:64px;background:transparent;border:0;color:var(--accent);font-family:var(--mono)">]</label>
        </div>
      </div>
      <div class="pane"><h3>时域 x(t)</h3><div class="canvas-wrap" style="height:170px"><canvas class="plot" id="ex-time"></canvas></div></div>
      <div class="pane"><h3>幅度谱 |X(f)|</h3><div class="canvas-wrap" style="height:170px"><canvas class="plot" id="ex-mag"></canvas></div></div>
      <details class="pane plot-fold"><summary>相位谱 ∠X(f)</summary><div class="canvas-wrap" style="height:160px"><canvas class="plot" id="ex-ph"></canvas></div></details>
      <div class="pane full" id="ex-time-info"><div class="statbar"></div></div>`;
    if (!f) { res.querySelector('#ex-time-info').innerHTML = '<p style="color:var(--danger)">无法解析表达式，请检查语法。</p>'; return; }

    const draw = () => {
      let T0 = parseFloat(res.querySelector('#ex-t0').value), T1 = parseFloat(res.querySelector('#ex-t1').value);
      if (!isFinite(T0) || !isFinite(T1) || T1 <= T0) { T0 = -4; T1 = 8; }
      const N = 8192, dt = (T1 - T0) / (N - 1);
      const tArr = [], xArr = [];
      for (let i = 0; i < N; i++) { const t = T0 + i * dt; tArr.push(t); xArr.push(f(t)); }
      const cache = (draw._cache = draw._cache || {});
      const getPlot = (id, opts) => { if (!cache[id]) { cache[id] = new FX.Plot(res.querySelector(id), opts); cache[id].onDraw = draw; } return cache[id]; };

      const tp = getPlot('#ex-time');
      let ylo = Infinity, yhi = -Infinity;
      for (const v of xArr) if (isFinite(v)) { ylo = Math.min(ylo, v); yhi = Math.max(yhi, v); }
      if (!isFinite(ylo)) { ylo = -1; yhi = 1; }
      const pad = (yhi - ylo) * 0.12 || 1;
      tp.setRange(T0, T1, ylo - pad, yhi + pad);
      tp.clear(); tp.grid(); tp.axis(true);
      tp.clip(); tp.line(tArr, xArr.map((v) => (isFinite(v) ? v : NaN)), { color: cv('--cv-line1'), width: 2 }); tp.unclip();

      const sp = DSP.spectrum(xArr, dt);
      const mp = getPlot('#ex-mag');
      let mm = 1e-9; for (const v of sp.mag) if (v > mm) mm = v;
      mp.setRange(0, sp.f[sp.f.length - 1], 0, mm * 1.05); mp.clear(); mp.grid(); mp.axis(true);
      mp.line(sp.f, sp.mag, { color: cv('--cv-line2'), width: 2, fill: cv('--cv-fill-green') });

      const pp = getPlot('#ex-ph');
      let plo = Infinity, phi = -Infinity;
      for (const v of sp.ph) if (isFinite(v)) { plo = Math.min(plo, v); phi = Math.max(phi, v); }
      if (!isFinite(plo)) { plo = -Math.PI; phi = Math.PI; }
      if (phi - plo < 0.4) { const mid = (plo + phi) / 2; plo = mid - 0.5; phi = mid + 0.5; }
      pp.setRange(0, sp.f[sp.f.length - 1], plo - 0.2, phi + 0.2); pp.clear(); pp.grid(); pp.axis(true);
      pp.line(sp.f, sp.ph, { color: cv('--cv-line3'), width: 2 });

      // 采样与混叠提示
      const fs = 1 / dt;
      let energy = 0; for (const v of xArr) if (isFinite(v)) energy += v * v; energy *= dt;
      res.querySelector('#ex-time-info .statbar').innerHTML = `
        <div class="stat"><span class="k">采样率</span><span class="v">${U.fmt(fs, 1)} Hz</span></div>
        <div class="stat"><span class="k">可分析最高频</span><span class="v">${U.fmt(fs / 2, 1)} Hz</span></div>
        <div class="stat"><span class="k">信号能量 ∫x²dt</span><span class="v">${U.fmt(energy, 3)}</span></div>
        <div class="stat"><span class="k">峰值</span><span class="v">${U.fmt(yhi, 3)}</span></div>`;
    };
    exprRedraw = draw;
    res.querySelector('#ex-t0').addEventListener('change', () => { Object.values(draw._cache || {}).forEach((p) => p.resetView()); draw(); });
    res.querySelector('#ex-t1').addEventListener('change', () => { Object.values(draw._cache || {}).forEach((p) => p.resetView()); draw(); });
    draw();
    if (FX.enablePlotChrome) FX.enablePlotChrome(res);
  }

  function renderTF(res, str) {
    const t = FX_LIB.parseTF(str);
    if (!t || !t.den || !t.den[0] || t.num.length > t.den.length) {
      res.innerHTML = '<div class="pane" style="grid-column:1/-1;color:var(--danger)">无法解析传递函数。要求：分子/分母为 s 的多项式（如 <code>5/(s^2+2*s+5)</code>），且分子阶次 ≤ 分母阶次。</div>';
      return;
    }
    res.innerHTML = `
      <div class="pane" style="grid-column:1/-1">
        <div class="formula-center" id="ex-h"></div>
      </div>
      <div class="pane"><h3>波特图 幅度(dB)</h3><div class="canvas-wrap" style="height:150px"><canvas class="plot" id="ex-bmag"></canvas></div></div>
      <details class="pane plot-fold"><summary>阶跃响应</summary><div class="canvas-wrap" style="height:150px"><canvas class="plot" id="ex-step"></canvas></div></details>
      <div class="pane"><h3>极点零点</h3><div class="canvas-wrap" style="height:220px"><canvas class="plot" id="ex-pz"></canvas></div></div>
      <div class="pane"><h3>关键指标</h3><div id="ex-metrics" class="statbar"></div></div>`;
    if (FX.enablePlotChrome) FX.enablePlotChrome(res);
    let num = t.num.map((c) => c / t.den[0]), den = t.den.map((c) => c / t.den[0]);
    while (num.length < den.length) num.unshift(0);
    if (window.katex) window.katex.render('H(s)=\\dfrac{' + polyTex(num) + '}{' + polyTex(den) + '}', res.querySelector('#ex-h'), { throwOnError: false, displayMode: true });

    const cache = {};
    const poles = DSP.polyRoots(den);
    const zeros = DSP.polyRoots(num);
    const bode = DSP.bode(num, den);
    let nearest = Infinity; for (const p of poles) if (p.re < -1e-9) nearest = Math.min(nearest, Math.abs(p.re));
    const tau = isFinite(nearest) ? 1 / nearest : 1, unstable = poles.some((p) => p.re > 1e-9);
    const tmax = unstable ? 3 : U.clamp(4 * tau, 1, 16), steps = 3000;
    const step = DSP.ltiResponse(num, den, (t2) => (t2 >= 0 ? 1 : 0), 0, tmax, steps);

    const drawAll = () => {
      const bm = cache.bm || (cache.bm = (() => { const p = new FX.Plot(res.querySelector('#ex-bmag'), { logX: true, padding: 0.02 }); p.onDraw = drawAll; return p; })());
      let lo = 1e9, hi = -1e9; for (const m of bode.mag) { lo = Math.min(lo, m); hi = Math.max(hi, m); }
      if (hi - lo < 1) { hi += 20; lo -= 20; }
      bm.setRange(bode.w[0], bode.w[bode.w.length - 1], lo - 8, hi + 8);
      bm.clear(); bm.grid(); bm.axis(); bm.line(bode.w, bode.mag, { color: cv('--cv-line1'), width: 2 });

      const sp = cache.sp || (cache.sp = (() => { const p = new FX.Plot(res.querySelector('#ex-step'), { margin: { l: 50, r: 12, t: 10, b: 26 } }); p.onDraw = drawAll; return p; })());
      let slo = Infinity, shi = -Infinity; for (const v of step.y) if (isFinite(v)) { slo = Math.min(slo, v); shi = Math.max(shi, v); }
      if (!isFinite(slo)) { slo = -1; shi = 1; }
      if (shi - slo < 1e-6) { slo -= 1; shi += 1; }
      const spad = (shi - slo) * 0.12;
      sp.setRange(step.t[0], step.t[step.t.length - 1], slo - spad, shi + spad);
      sp.clear(); sp.grid(); sp.axis(true);
      sp.clip(); sp.line(step.t, step.y, { color: cv('--cv-line1'), width: 2 }); sp.unclip();

      const pz = cache.pz;
      pzPlot(pz || (cache.pz = res.querySelector('#ex-pz')), poles, zeros);
    };
    tfRedraw = drawAll;
    drawAll();

    const dc = den[den.length - 1] !== 0 ? num[num.length - 1] / den[den.length - 1] : Infinity;
    const stable = poles.every((p) => p.re < 1e-9);
    const fmtC = (z) => U.fmt(z.re, 2) + (Math.abs(z.im) > 1e-9 ? (z.im >= 0 ? '+' : '') + U.fmt(z.im, 2) + 'j' : '');
    res.querySelector('#ex-metrics').innerHTML = `
      <div class="stat"><span class="k">极点</span><span class="v">${poles.map(fmtC).join(', ') || '—'}</span></div>
      <div class="stat"><span class="k">零点</span><span class="v">${zeros.map(fmtC).join(', ') || '—'}</span></div>
      <div class="stat"><span class="k">DC 增益</span><span class="v">${U.fmt(dc)}</span></div>
      <div class="stat"><span class="k">稳定性</span><span class="v" style="color:${stable ? cv('--cv-line2') : cv('--cv-danger')}">${stable ? '稳定' : '不稳定'}</span></div>`;
  }
  function polyTex(c) { return U.polyTex(c); }

  /* ---------- 手绘 ---------- */
  function renderDraw() {
    const box = host.querySelector('#ex-draw');
    box.innerHTML = `
      <div class="pane" style="margin-bottom:16px">
        <h3>1 · 手绘一条闭合路径</h3>
        <div class="canvas-wrap"><canvas class="draw-canvas" id="ex-drawcv"></canvas></div>
        <div class="row" style="margin-top:12px">
          <button class="btn primary" id="ex-dran">▶ 绘制圈套圈</button>
          <button class="btn" id="ex-drcl">清空</button>
          <label class="chip" style="cursor:pointer"><input type="checkbox" id="ex-drshow" checked style="vertical-align:middle"> 显示圆</label>
          <label class="chip">圈数 <input type="range" id="ex-drterms" min="5" max="120" value="60" style="width:110px;vertical-align:middle"> <b id="ex-drterms-v" style="font-family:var(--mono)">60</b></label>
        </div>
        <div class="hint">鼠标/手指画任意闭合曲线（起点终点会自动闭合），点击“绘制”，程序用 <b>DFT</b> 把它分解成一圈圈旋转的圆。弧长均匀重采样，绘制速度不均匀也不影响结果。</div>
      </div>
      <div class="pane"><h3>2 · 傅立叶圈套圈动画</h3>
        <div class="canvas-wrap" style="height:420px"><canvas class="plot" id="ex-drout"></canvas></div>
        <div class="statbar" id="ex-drstat"></div>
      </div>`;
    const cvs = box.querySelector('#ex-drawcv');
    const g = cvs.getContext('2d');
    // 关键修复：画布按 DPR 设定物理分辨率并缩放上下文——
    // 旧代码从未设置 canvas 尺寸（默认 300×150 被拉伸到满宽），导致笔迹呈马赛克
    function fitCv() {
      const dpr = window.devicePixelRatio || 1;
      const w = cvs.clientWidth || 600, h = cvs.clientHeight || 220;
      const nw = Math.round(w * dpr), nh = Math.round(h * dpr);
      if (cvs.width !== nw || cvs.height !== nh) { cvs.width = nw; cvs.height = nh; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function clearInput() { fitCv(); g.fillStyle = cv('--cv-bg'); g.fillRect(0, 0, cvs.clientWidth, cvs.clientHeight); }
    function strokePath() {
      g.strokeStyle = cv('--cv-text'); g.lineWidth = 2; g.lineJoin = 'round'; g.lineCap = 'round';
      g.beginPath();
      for (let i = 0; i < pts.length; i++) { const c = pts[i]; i ? g.lineTo(c.x, c.y) : g.moveTo(c.x, c.y); }
      g.stroke();
    }
    function repaintStroke() { clearInput(); if (pts.length) strokePath(); }
    drawReset = repaintStroke;   // 主题切换时重绘底色与已画轨迹
    clearInput();
    let drawing = false, pts = [];
    cvs.addEventListener('pointerdown', (e) => { drawing = true; pts = []; clearInput(); try { cvs.setPointerCapture(e.pointerId); } catch (err) {} e.preventDefault(); });
    const onWinUp = () => { drawing = false; };
    window.addEventListener('pointerup', onWinUp);
    cvs.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const r = cvs.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const last = pts[pts.length - 1];
      if (last && Math.hypot(x - last.x, y - last.y) < 1.5) return;   // 抽稀，笔迹更顺滑
      pts.push({ x, y });
      g.strokeStyle = cv('--cv-text'); g.lineWidth = 2; g.lineJoin = 'round'; g.lineCap = 'round';
      g.beginPath();
      if (last) { g.moveTo(last.x, last.y); g.lineTo(x, y); } else { g.moveTo(x, y); g.lineTo(x + 0.1, y); }
      g.stroke();
    });
    // 容器尺寸变化时保持清晰（桌面适配）
    if (typeof ResizeObserver !== 'undefined' && cvs.parentElement) {
      const drawRO = new ResizeObserver(() => { if (!cvs.isConnected) { drawRO.disconnect(); return; } repaintStroke(); });
      drawRO.observe(cvs.parentElement);
    }
    box.querySelector('#ex-drcl').addEventListener('click', () => { pts = []; clearInput(); });

    dloop = U.loop(() => { if (epicy) drawFrame(); });
    box.querySelector('#ex-dran').addEventListener('click', () => {
      if (pts.length < 30) { box.querySelector('#ex-drstat').innerHTML = '<span class="hint">请先在上图画一条曲线。</span>'; return; }
      const sm = resample(pts, 480);
      const phasors = DSP.dftPhasors(sm.map((p) => ({ re: (p.x - cvs.clientWidth / 2) / cvs.clientWidth, im: (cvs.clientHeight / 2 - p.y) / cvs.clientHeight })));
      epicy = { phasors, t: 0, traceT: [] };
      if (!loopRunning) { loopRunning = true; dloop.start(); }
      box.querySelector('#ex-drstat').innerHTML = `
        <div class="stat"><span class="k">相量数</span><span class="v">${phasors.length}</span></div>
        <div class="stat"><span class="k">重采样点</span><span class="v">${sm.length}</span></div>
        <div class="stat"><span class="k">最大相量幅值</span><span class="v">${U.fmt(phasors[0] ? phasors[0].amp : 0, 3)}</span></div>`;
    });
    box.querySelector('#ex-drterms').addEventListener('input', (e) => { box.querySelector('#ex-drterms-v').textContent = e.target.value; });

    // 弧长均匀重采样 + 自动闭合
    function resample(pp, n) {
      const P = pp.concat([pp[0]]); // 闭合
      const cum = [0];
      for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y));
      const L = cum[cum.length - 1];
      const out = [];
      let seg = 1;
      for (let k = 0; k < n; k++) {
        const target = (k / n) * L;
        while (seg < cum.length - 1 && cum[seg] < target) seg++;
        const t = (target - cum[seg - 1]) / (cum[seg] - cum[seg - 1] || 1);
        out.push({ x: U.lerp(P[seg - 1].x, P[seg].x, t), y: U.lerp(P[seg - 1].y, P[seg].y, t) });
      }
      return out;
    }

    function drawFrame() {
      const o = box.querySelector('#ex-drout');
      if (!o || !o.clientWidth) return;
      const dpr = window.devicePixelRatio || 1;
      const W = o.clientWidth, H = o.clientHeight;
      const nw = Math.round(W * dpr), nh = Math.round(H * dpr);
      if (o.width !== nw || o.height !== nh) { o.width = nw; o.height = nh; }
      const g2 = o.getContext('2d');
      g2.setTransform(dpr, 0, 0, dpr, 0, 0);
      g2.fillStyle = cv('--cv-bg'); g2.fillRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2, s = Math.min(W, H) * 0.42;
      const SX = (x) => cx + x * s, SY = (y) => cy - y * s;
      const ph = epicy.phasors;
      const terms = Math.min(+box.querySelector('#ex-drterms').value || 60, ph.length);

      let x = 0, y = 0;
      const chain = [{ x: 0, y: 0 }];
      for (let j = 0; j < terms; j++) {
        const a = ph[j].phase + 2 * Math.PI * ph[j].k * epicy.t;
        x += ph[j].amp * Math.cos(a); y += ph[j].amp * Math.sin(a);
        chain.push({ x, y, amp: ph[j].amp });
      }
      const show = box.querySelector('#ex-drshow');
      if (show && show.checked) {
        g2.lineWidth = 1;
        for (let j = 1; j < chain.length; j++) {
          g2.strokeStyle = j % 2 ? cv('--cv-circle-b') : cv('--cv-circle-a');
          g2.beginPath(); g2.arc(SX(chain[j - 1].x), SY(chain[j - 1].y), Math.max(chain[j].amp * s, 0.5), 0, 7); g2.stroke();
        }
      }
      epicy.traceT.push(x, y);
      if (epicy.traceT.length > 480) epicy.traceT.splice(0, 2);
      g2.strokeStyle = cv('--cv-line2'); g2.lineWidth = 2; g2.lineJoin = 'round'; g2.beginPath();
      for (let i = 0; i < epicy.traceT.length / 2; i++) {
        const px = SX(epicy.traceT[i * 2]), py = SY(epicy.traceT[i * 2 + 1]);
        i ? g2.lineTo(px, py) : g2.moveTo(px, py);
      }
      g2.stroke();
      g2.fillStyle = cv('--cv-line1');
      g2.beginPath(); g2.arc(SX(x), SY(y), 4, 0, 7); g2.fill();

      epicy.t = (epicy.t + 0.0012) % 1;
    }
    if (FX.enablePlotChrome) FX.enablePlotChrome(box);
  }

  /* ---------- 语音 ---------- */
  function renderVoice() {
    const box = host.querySelector('#ex-voice');
    box.innerHTML = `
      <div class="pane">
        <h3>语音输入表达式（尽力识别）</h3>
        <p class="hint">点击按钮开始说话，例如“exp 左括号 负 2 t 右括号 乘以 sin 十 t”。识别文字会实时映射为表达式，确认后跳转到表达式求解页。</p>
        <div class="row">
          <button class="btn primary" id="ex-voicestart" data-on="0">🎤 开始录音</button>
          <button class="btn" id="ex-voiceroute">填入表达式求解 →</button>
        </div>
        <div class="statbar" id="ex-voice-text"></div>
        <div class="hint">映射规则：加=+ 减=− 乘/乘以=* 除以=/ 平方=^2 次方=^ 派=pi 左括号/右括号。语音识别依赖浏览器 Web Speech API（Chrome/Edge 支持最好，需联网）。</div>
      </div>`;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const btn = box.querySelector('#ex-voicestart');
    const outBox = box.querySelector('#ex-voice-text');
    if (!SR) { outBox.innerHTML = '<span class="hint" style="color:var(--danger)">当前浏览器不支持 Web Speech API，请使用 Chrome/Edge。</span>'; return; }
    const rec = new SR(); rec.lang = 'zh-CN'; rec.interimResults = true; rec.continuous = true;
    speechRec = rec;
    let finalTxt = '';
    rec.onresult = (e) => {
      let cur = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) finalTxt += r[0].transcript; else cur += r[0].transcript; }
      const shown = (finalTxt + cur).toString();
      outBox.innerHTML = `
        <div class="stat"><span class="k">识别文字</span><span class="v" style="color:var(--text);font-size:13px">${shown || '…'}</span></div>
        <div class="stat"><span class="k">映射表达式</span><span class="v" style="color:var(--accent-2)">${mapSpeech(shown) || '…'}</span></div>`;
    };
    rec.onend = () => { btn.dataset.on = '0'; btn.textContent = '🎤 开始录音'; };
    rec.onerror = (e) => { outBox.innerHTML = `<span class="hint" style="color:var(--danger)">识别出错：${e.error}</span>`; };
    btn.addEventListener('click', () => {
      if (btn.dataset.on === '0') { btn.dataset.on = '1'; btn.textContent = '⏹ 停止'; finalTxt = ''; try { rec.start(); } catch (err) {} }
      else { rec.stop(); }
    });
    box.querySelector('#ex-voiceroute').addEventListener('click', () => {
      const expr = mapSpeech(finalTxt);
      tab = 'expr'; switchTab();
      if (expr) {
        const inp = host.querySelector('#ex-input');
        if (inp) { inp.value = expr; host.querySelector('#ex-go').click(); }
      }
    });
  }
  function mapSpeech(txt) {
    if (!txt) return '';
    let s = txt.replace(/[\s，。、;；]/g, '');
    // 长词优先，避免“左括号”被“括号”提前破坏、“二十”被“十”拆坏
    const mp = [['左括号', '('], ['右括号', ')'], ['括号', ')'], ['乘以', '*'], ['除以', '/'], ['减去', '-'], ['加上', '+'], ['的平方', '^2'], ['乘', '*'], ['除', '/'], ['减', '-'], ['加', '+'], ['平方', '^2'], ['立方', '^3'], ['次方', '^'], ['派', 'pi'], ['负', '-'], ['的', '*']];
    for (const [a, b] of mp) { s = s.split(a).join(b); }
    // 数字中文→阿拉伯（复合数词在前）
    const numMap = [['二十', '20'], ['三十', '30'], ['四十', '40'], ['五十', '50'], ['十', '10'], ['零', '0'], ['一', '1'], ['二', '2'], ['三', '3'], ['四', '4'], ['五', '5'], ['六', '6'], ['七', '7'], ['八', '8'], ['九', '9']];
    for (const [a, b] of numMap) { s = s.split(a).join(b); }
    return s;
  }

  /* ---------- 符号变换求解器：输入正确形式，直接查看变换结果 ---------- */
  function renderSym() {
    const box = host.querySelector('#ex-sym');
    box.innerHTML = `
      <div class="pane" style="margin-bottom:16px">
        <h3>符号变换求解器</h3>
        <div class="row" id="sym-modes" style="margin-bottom:12px"></div>
        <div class="input-bar">
          <input type="text" id="sym-in" spellcheck="false" autocomplete="off">
          <input type="number" id="sym-t" value="1" min="0.05" step="0.1" title="采样周期 T（仅 F(s)→X(z) 用）" style="flex:0 0 76px">
          <button class="btn primary" id="sym-go">求解</button>
        </div>
        <div class="row kbd" id="sym-pad" style="margin-top:8px"></div>
        <div class="hint" id="sym-hint" style="margin-top:8px"></div>
        <div class="row" id="sym-ex" style="margin-top:10px"></div>
      </div>
      <div id="sym-out"><p class="hint">输入表达式后自动给出符号结果与数值验证。</p></div>`;

    const modes = [
      ['lt', 'f(t) → F(s)'], ['il', 'F(s) → f(t)'], ['ft', 'f(t) → F(jω)'],
      ['s2z', 'F(s) → X(z)'], ['lz', 'x(n) → X(z)'], ['iz', 'X(z) → x(n)']
    ];
    const conf = {
      lt: {
        ph: '3*exp(-2*t)*u(t) + sin(5*t)*u(t)',
        hint: '项（+ - 连接，u(t) 可省略）：<code>c*exp(-a*t)</code> · <code>c*sin(w*t)</code> · <code>c*cos(w*t)</code> · <code>c*t^n</code> · <code>c*t^n*exp(-a*t)</code> · <code>c</code> · <code>u(t)</code>；w 支持 <code>2*pi*3</code> 写法',
        ex: [['3*exp(-2*t)*u(t)', '指数衰减'], ['sin(2*pi*3*t)', '3Hz正弦'], ['5-2*cos(2*t)*u(t)', '常数+余弦'], ['t^2*exp(-3*t)*u(t)', '幂×指数'], ['exp(-t)*u(t)-exp(-2*t)*u(t)', '两指数之差']]
      },
      ft: {
        ph: 'exp(-2*t)*u(t)',
        hint: '语法同 f(t)→F(s)；结果为 F(jω)。含 sin/cos/t^n/u 等不衰减项时含<b>冲激谱线 δ(ω)</b>。',
        ex: [['exp(-2*t)*u(t)', '单边指数'], ['cos(2*pi*4*t)', '4Hz余弦'], ['3*exp(-t)*u(t)', '3倍指数'], ['t*u(t)', '斜坡']]
      },
      il: {
        ph: '1/((s+1)^2)',
        hint: '输入 s 的<b>真分式</b>，<b>支持重极点</b>：<code>1/((s+1)^2)</code> · <code>1/(s^2+3*s+2)</code> · <code>(s+2)/(s^2+4)</code> · <code>5/(s*(s+5))</code>；自动部分分式（留数/重根阶）给出解析式',
        ex: [['1/((s+1)^2)', '二重极点'], ['1/((s+1)^2*(s+2))', '二重+单'], ['(s+2)/(s^2+4)', '共轭极点'], ['5/(s*(s+5))', '含积分器']]
      },
      s2z: {
        ph: '1/(s^2+2*s+5)',
        hint: '输入 s 域<b>真分式</b> F(s)，按极点映射 <b>z = e^{sT}</b>（冲激不变法）给出离散域 X(z)、ROC 与数值验证。右侧数字框为<b>采样周期 T</b>，可改后重算。',
        ex: [['1/(s+1)', '一阶'], ['1/(s^2+2*s+5)', '欠阻尼二阶'], ['1/(s*(s+1))', '含积分器'], ['(s+3)/(s^2+3*s+2)', '带零点']]
      },
      lz: {
        ph: '0.5^n*u(n) + n*u(n)',
        hint: '项（+ - 连接，u(n) 可省略；<b>a 需为具体数值</b>）：<code>0.5^n</code> · <code>n*0.5^n</code> · <code>n</code> · <code>n^2*u(n)</code> · <code>cos(w*n)</code> · <code>sin(w*n)</code> · <code>u(n)</code> · <code>delta(n)</code> · 常数；<code>2sin(3n)</code> 等省略乘号也可以',
        ex: [['0.5^n*u(n)', '几何序列'], ['cos(pi/4*n)*u(n)', '余弦序列'], ['2*n*u(n)', '斜坡序列'], ['n^2*u(n)', '抛物线序列'], ['delta(n)', '单位脉冲'], ['0.5^n*u(n)+n*u(n)', '组合']]
      },
      iz: {
        ph: 'z/(z^2-0.25)',
        hint: '输入 z 的<b>真分式</b>（正幂）：<code>z/(z^2-0.25)</code> · <code>1/(z-0.5)</code> · <code>z/(z-1)</code>；自动极点展开给出 h(n) 解析式与稳定性结论',
        ex: [['z/(z^2-0.25)', '共轭实极点'], ['1/(z-0.5)', '一阶'], ['z/(z-1)', '边界'], ['1/(z^2-1.6*z+0.9425)', '谐振器']]
      }
    };
    let mode = 'lt';
    const modeRow = box.querySelector('#sym-modes');
    const inp = box.querySelector('#sym-in');
    modes.forEach(([k, label]) => {
      const c = U.el('button', { class: 'chip' + (k === mode ? ' active' : ''), 'data-k': k }, label);
      c.addEventListener('click', () => {
        mode = k;
        modeRow.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === c));
        applyMode();
      });
      modeRow.append(c);
    });
    function applyMode() {
      const cf = conf[mode];
      inp.placeholder = cf.ph;
      inp.value = cf.ph;   // 切换模式时载入该模式示例，避免跨模式语法残留
      box.querySelector('#sym-hint').innerHTML = cf.hint;
      box.querySelector('#sym-t').style.display = mode === 's2z' ? '' : 'none';   // 仅 F(s)→X(z) 显示采样周期
      // 插入键盘随模式切换
      const padRow = box.querySelector('#sym-pad');
      padRow.innerHTML = '';
      const varTok = (mode === 'lz' || mode === 'iz') ? 'n' : 't';
      const tokList = (mode === 'il' || mode === 's2z') ? ['s', '^2', '*', '/', '(', ')', '+', '-']
        : mode === 'iz' ? ['z', '^2', '*', '/', '(', ')', '+', '-']
        : [varTok, 'u(' + varTok + ')', 'sin(', 'cos(', 'exp(-0.5*' + varTok + ')*', '^2', 'pi', '*', '(', ')', '+', '-'];
      tokList.forEach((tok) => {
        const b = U.el('button', { class: 'chip pad-key', title: '插入 ' + tok }, tok === 'pi' ? 'π' : tok);
        b.addEventListener('click', () => {
          const s = inp.selectionStart == null ? inp.value.length : inp.selectionStart;
          const e2 = inp.selectionEnd == null ? s : inp.selectionEnd;
          inp.value = inp.value.slice(0, s) + tok + inp.value.slice(e2);
          inp.focus();
          try { inp.setSelectionRange(s + tok.length, s + tok.length); } catch (err) { }
          inp.dispatchEvent(new Event('input'));
        });
        padRow.append(b);
      });
      const exRow = box.querySelector('#sym-ex');
      exRow.innerHTML = '';
      cf.ex.forEach(([expr, name]) => {
        const c = U.el('button', { class: 'chip', title: expr }, name);
        c.addEventListener('click', () => { inp.value = expr; solve(); });
        exRow.append(c);
      });
      solve();
    }

    const out = box.querySelector('#sym-out');
    function showTex(lines) {
      out.innerHTML = '';
      const card = U.el('div', { class: 'pane' });
      lines.forEach(([tex, note]) => {
        const d = U.el('div', { class: 'formula-center' });
        FX.katex(tex, d, { displayMode: true });
        card.append(d);
        if (note) card.append(U.el('p', { class: 'hint', html: note }));
      });
      out.innerHTML = '';
      out.append(card);
    }
    function showErr(msg) {
      out.innerHTML = `<div class="pane"><p style="color:var(--danger)">✗ ${msg}</p></div>`;
    }
    function verifyTable(rows) {
      const tbl = U.el('table', { class: 'tbl', style: 'margin-top:12px;max-width:560px' });
      tbl.innerHTML = '<tr><th>验证</th><th>数值</th><th>符号</th><th>误差</th></tr>' +
        rows.map((r) => `<tr><td>${r[0]}</td><td>${U.fmt(r[1], 6)}</td><td>${U.fmt(r[2], 6)}</td><td style="color:${r[3] < 1e-6 ? 'var(--accent-2)' : 'var(--warn)'}">${U.fmt(r[3], 2)}</td></tr>`).join('');
      return tbl;
    }

    function solve() {
      const str = inp.value.trim();
      if (!str) return;
      try {
        if (mode === 'lt' || mode === 'ft') {
          const items = TR.parseTimeCombo(str);
          if (!items) return showErr('无法解析。请按提示的项语法输入，如 3*exp(-2*t)*u(t) + sin(5*t)*u(t)');
          if (mode === 'lt') {
            const L = TR.laplaceOfItems(items);
            // 数值验证：定义积分 vs 符号 F(s)
            const sTest = Math.max(0.6, L.right + 0.6);
            const rows = [sTest, sTest + 1].map((sv) => {
              const NN = 12000, T = 60, h = T / NN;
              let sum = TR.fNumeric(items, 0) + TR.fNumeric(items, T) * Math.exp(-sv * T);
              for (let i = 1; i < NN; i++) sum += (i % 2 ? 4 : 2) * TR.fNumeric(items, i * h) * Math.exp(-sv * i * h);
              const num = sum * h / 3;
              const sym = TR.FsNumeric(items, sv);
              return ['s=' + sv, num, sym, Math.abs(num - sym) / (Math.abs(sym) || 1)];
            });
            showTex([[L.fLine], [L.fsLine, '因果信号单边拉普拉斯变换。'], [L.rocTex, ''], ['F(j\\omega)', '令 s=jω（ROC 含 jω 轴时）即得傅里叶变换。']]);
            const card = out.firstChild;
            card.append(verifyTable(rows));
            if (L.hasOsc) card.append(U.el('p', { class: 'hint', html: '注：含不衰减项（sin/cos/tⁿ/常数），ROC 右边界为 0，傅里叶变换含冲激谱线。' }));
          } else {
            const F = TR.fourierOfItems(items);
            showTex([[F.tex, F.imp ? '含冲激谱线：不衰减（周期/常值/幂）成分的频谱在频域以 δ(ω) 呈现。' : 'ROC 含 jω 轴，傅里叶变换 = 令 s = jω。']]);
          }
        } else if (mode === 's2z') {
          // F(s) → X(z)：冲激不变法（支持重极点）。
          // 部分分式（TR 引擎）→ x(n)=f(nT) → D(z)=Π(z−λ)^m，N(z) 由 M 个圆周点的级数值解线性方程组
          const t = FX_LIB.parseTF(str);
          if (!t || !t.den || !t.den[0]) return showErr('无法解析 F(s)。示例：1/(s^2+2*s+5)');
          if (t.num.length > t.den.length) return showErr('需为真分式（分子阶次 ≤ 分母阶次）');
          const T = Math.max(0.05, +(box.querySelector('#sym-t').value) || 1);
          const d0 = t.den[0];
          const nn = t.num.map((c) => c / d0), dd = t.den.map((c) => c / d0);
          const pf = TR.partialFracGroups(nn, dd);
          if (!pf.ok) return showErr(pf.note || '部分分式失败');
          const xOf = (n) => TR.evalLaplaceGroups(pf.groups, n * T);
          const cmul = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
          const cdiv = (a, b) => { const d = b.re * b.re + b.im * b.im || 1e-300; return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }; };
          // z 极点（含重数、共轭成对）
          const zGroups = [];
          for (const g of pf.groups) {
            const lam = { re: Math.exp(g.p.re * T) * Math.cos(g.p.im * T), im: Math.exp(g.p.re * T) * Math.sin(g.p.im * T) };
            zGroups.push({ z: lam, m: g.m, sPole: g.p });
            if (g.pair) zGroups.push({ z: { re: lam.re, im: -lam.im }, m: g.m, sPole: { re: g.p.re, im: -g.p.im } });
          }
          const M = zGroups.reduce((s, g) => s + g.m, 0);
          if (M === 0) return showErr('F(s) 没有有限极点（如纯多项式/纯微分结构），无法表示为有理 X(z)');
          // D(z) = Π (z−λ)^m（自高到低复系数；实系数取实部）
          const mulZ = (P, lam) => {
            const o = new Array(P.length + 1).fill(0).map(() => ({ re: 0, im: 0 }));
            for (let i = 0; i < P.length; i++) {
              o[i] = { re: o[i].re + P[i].re, im: o[i].im + P[i].im };
              o[i + 1] = { re: o[i + 1].re - (P[i].re * lam.re - P[i].im * lam.im), im: o[i + 1].im - (P[i].re * lam.im + P[i].im * lam.re) };
            }
            return o;
          };
          let Dc = [{ re: 1, im: 0 }];
          for (const g of zGroups) for (let i = 0; i < g.m; i++) Dc = mulZ(Dc, g.z);
          const zDen = Dc.map((c) => +c.re.toFixed(9));
          const maxLam = zGroups.reduce((m, g) => Math.max(m, Math.hypot(g.z.re, g.z.im)), 0);
          // 在 M 个圆周点上求 X(z_i)（级数），解 Σ c_j z_i^{M−1−j} = X_i·D(z_i) 得 N(z) 系数
          const Rr = 2.2 * maxLam + 0.5;
          const NMAX = 1500;
          const rowOf = (zi) => {
            const row = [];
            for (let j = 0; j < M; j++) {
              const pw = M - 1 - j;
              const pr = Math.pow(Math.hypot(zi.re, zi.im), pw), pa = Math.atan2(zi.im, zi.re) * pw;
              row.push({ re: pr * Math.cos(pa), im: pr * Math.sin(pa) });
            }
            return row;
          };
          const evalD = (zi) => {
            let dv = { re: 0, im: 0 };
            for (let j = 0; j < Dc.length; j++) {
              const pw = Dc.length - 1 - j;
              const pr = Math.pow(Math.hypot(zi.re, zi.im), pw), pa = Math.atan2(zi.im, zi.re) * pw;
              dv = { re: dv.re + Dc[j].re * pr * Math.cos(pa) - Dc[j].im * pr * Math.sin(pa), im: dv.im + Dc[j].re * pr * Math.sin(pa) + Dc[j].im * pr * Math.cos(pa) };
            }
            return dv;
          };
          const seriesAt = (zi) => {
            let sv = { re: 0, im: 0 };
            for (let n = 0; n <= NMAX; n++) {
              const xn = xOf(n);
              if (xn === 0) continue;
              const pw = Math.pow(Math.hypot(zi.re, zi.im), -n);
              const an = Math.atan2(zi.im, zi.re) * (-n);
              sv = { re: sv.re + xn * pw * Math.cos(an), im: sv.im + xn * pw * Math.sin(an) };
            }
            return sv;
          };
          const Amat = [];
          for (let i = 0; i < M; i++) {
            const th = (2 * Math.PI * i) / M + 0.37;
            const zi = { re: Rr * Math.cos(th), im: Rr * Math.sin(th) };
            const row = rowOf(zi);
            const dv = evalD(zi), sv = seriesAt(zi);
            row.push(cmul(sv, dv));
            Amat.push(row);
          }
          // 复数高斯消元（列主元）
          for (let col = 0; col < M; col++) {
            let piv = col;
            for (let r2 = col + 1; r2 < M; r2++) if (Math.hypot(Amat[r2][col].re, Amat[r2][col].im) > Math.hypot(Amat[piv][col].re, Amat[piv][col].im)) piv = r2;
            [Amat[col], Amat[piv]] = [Amat[piv], Amat[col]];
            const pv = Amat[col][col];
            for (let r2 = col + 1; r2 < M; r2++) {
              const fct = cdiv(Amat[r2][col], pv);
              for (let j = col; j <= M; j++) Amat[r2][j] = { re: Amat[r2][j].re - fct.re * Amat[col][j].re + fct.im * Amat[col][j].im, im: Amat[r2][j].im - fct.re * Amat[col][j].im - fct.im * Amat[col][j].re };
            }
          }
          const cSol = new Array(M).fill({ re: 0, im: 0 });
          for (let i = M - 1; i >= 0; i--) {
            let acc = { ...Amat[i][M] };
            for (let j = i + 1; j < M; j++) acc = { re: acc.re - Amat[i][j].re * cSol[j].re + Amat[i][j].im * cSol[j].im, im: acc.im - Amat[i][j].re * cSol[j].im - Amat[i][j].im * cSol[j].re };
            cSol[i] = cdiv(acc, Amat[i][i]);
          }
          const zNum = cSol.map((c) => +c.re.toFixed(9));
          const texPZ = (c) => {
            let o = '';
            for (let i = 0; i < c.length; i++) {
              const pw = c.length - 1 - i, a = c[i];
              if (Math.abs(a) < 1e-9) continue;
              const sgn = o ? (a > 0 ? '+' : '-') : (a < 0 ? '-' : '');
              const co = (Math.abs(Math.abs(a) - 1) < 1e-9 && pw > 0) ? '' : U.fmt(Math.abs(a), 3);
              o += sgn + co + (pw === 0 ? '' : pw === 1 ? 'z' : 'z^{' + pw + '}');
            }
            return o || '0';
          };
          const maxRe = pf.groups.reduce((m, g) => Math.max(m, g.p.re), -Infinity);
          const zRoc = Math.exp(maxRe * T);
          const fmt3 = (v) => { const x = Math.abs(v) < 5e-4 ? 0 : v; return x.toFixed(3); };
          const allSimple = pf.groups.every((g) => g.m === 1);
          const lines = [];
          if (allSimple) {
            // 逐项 e-闭式（共轭对合并）
            const termTexs = [], mapTexs = [];
            for (const g of pf.groups) {
              const p = g.p, R = g.A[0], lam = { re: Math.exp(p.re * T) * Math.cos(p.im * T), im: Math.exp(p.re * T) * Math.sin(p.im * T) };
              mapTexs.push('p=' + fmt3(p.re) + (Math.abs(p.im) > 1e-9 ? (p.im > 0 ? '+' : '-') + fmt3(Math.abs(p.im)) + 'j' : '')
                + '\\;\\mapsto\\;z=e^{pT}=' + fmt3(lam.re) + (Math.abs(lam.im) > 1e-9 ? (lam.im > 0 ? '+' : '-') + fmt3(Math.abs(lam.im)) + 'j' : ''));
              if (Math.abs(p.im) > 1e-9) {
                const a = (Math.abs(R.re) < 5e-4 ? 0 : R.re), b = R.im, sg = p.re, w = p.im;
                const denTex = 'z^{2}-2\\,e^{' + fmt3(sg) + 'T}\\cos(' + fmt3(w) + 'T)\\,z+e^{' + fmt3(2 * sg) + 'T}';
                let numTex;
                if (a === 0) {
                  const c1 = -2 * b;
                  numTex = (c1 < 0 ? '-' : '') + '2\\,' + fmt3(Math.abs(b)) + '\\,e^{' + fmt3(sg) + 'T}\\sin(' + fmt3(w) + 'T)\\,z';
                } else {
                  numTex = '2\\,' + fmt3(a) + '\\,z^{2}-2\\,e^{' + fmt3(sg) + 'T}\\left(' + fmt3(a) + '\\cos(' + fmt3(w) + 'T)' + (b < 0 ? '-' : '+') + fmt3(Math.abs(b)) + '\\sin(' + fmt3(w) + 'T)\\right)z';
                }
                termTexs.push('\\dfrac{' + numTex + '}{' + denTex + '}');
              } else {
                termTexs.push('\\dfrac{' + fmt3(R.re) + '\\,z}{z-e^{' + fmt3(p.re) + 'T}}');
              }
            }
            lines.push(['X(z)=' + termTexs.join('+'), '冲激不变法逐项闭式：X(z)=Σ Rₖz/(z−e^{pₖT})，共轭对已合并为实系数二阶节。采样周期 T = ' + U.fmt(T, 2) + '（右侧数字框可改）。']);
          } else {
            const lap = TR.invLaplace(nn, dd);
            if (lap.tex) lines.push([lap.tex.replace('f(t)=', 'x(n)=f(nT),\\quad f(t)='), '时域闭式（含重极点模态 t^{k−1}e^{pT}），按 nT 采样即得序列。采样周期 T = ' + U.fmt(T, 2) + '（右侧数字框可改）。']);
          }
          {
            let first = true;
            for (const g of pf.groups) {
              const lam = { re: Math.exp(g.p.re * T) * Math.cos(g.p.im * T), im: Math.exp(g.p.re * T) * Math.sin(g.p.im * T) };
              const mTxt = g.m > 1 ? '\\text{（}' + g.m + '\\text{ 重）}' : '';
              lines.push(['p=' + fmt3(g.p.re) + (Math.abs(g.p.im) > 1e-9 ? (g.p.im > 0 ? '+' : '-') + fmt3(Math.abs(g.p.im)) + 'j' : '') + mTxt
                + '\\;\\mapsto\\;z=e^{pT}=' + fmt3(lam.re) + (Math.abs(lam.im) > 1e-9 ? (lam.im > 0 ? '+' : '-') + fmt3(Math.abs(lam.im)) + 'j' : ''),
                first ? '极点映射 z = e^{sT}：s 左半平面（σ<0）↔ 单位圆内（|z|<1）。' : '']);
              first = false;
            }
          }
          lines.push(['X(z)=\\dfrac{' + texPZ(zNum) + '}{' + texPZ(zDen) + '}', '数值合并形式（冲激不变法：X(z)=Σ x(n)z^{−n} 的有理式，分母 = Π(z−e^{pₖT})^{mₖ}）。']);
          lines.push(['\\text{ROC: } |z|>' + U.fmt(zRoc, 3) + '=e^{' + fmt3(maxRe) + 'T}', '最右极点 σ=' + U.fmt(maxRe, 3) + ' 映射为 |z| = e^{σT}。']);
          showTex(lines);
          // 数值验证：另取一个非插值点的真实点，对比级数和与闭式
          const zv = 1.9 * maxLam + 0.3;
          let series = 0;
          for (let n = 0; n <= NMAX; n++) series += xOf(n) * Math.pow(zv, -n);
          const closed = DSP.cdiv(DSP.horner(zNum, { re: zv, im: 0 }), DSP.horner(zDen, { re: zv, im: 0 }));
          const card = out.firstChild;
          card.append(verifyTable([['z=' + U.fmt(zv, 2) + ' 级数和', series, closed.re, Math.abs(series - closed.re) / (Math.abs(closed.re) || 1)]]));
          card.append(U.el('p', { class: 'hint', html: '数值验证：x(n)=f(nT) 的 Z 级数截断和与符号闭式 X(z) 在 ROC 外一点对比（该点不参与分子拟合，可检验重极点处理是否正确）。' }));
        } else if (mode === 'il') {
          const t = FX_LIB.parseTF(str);
          if (!t || !t.den || !t.den[0]) return showErr('无法解析 F(s)。示例：1/(s^2+3*s+2)');
          if (t.num.length > t.den.length) return showErr('需为真分式（分子阶次 ≤ 分母阶次）');
          const d0 = t.den[0];
          const r = TR.invLaplace(t.num.map((c) => c / d0), t.den.map((c) => c / d0));
          if (!r.tex) return showErr(r.note);
          const poles = DSP.polyRoots(t.den.map((c) => c / d0));
          const stable = poles.every((q) => q.re < -1e-9);
          showTex([[r.tex, (r.note || '') + (r.note ? '<br>' : '') + (stable ? '全部极点在左半平面 → f(t) 收敛（稳定）。' : '<span style="color:var(--warn)">存在右半平面极点 → f(t) 发散。</span>')]]);
        } else if (mode === 'lz') {
          const items = TR.parseZCombo(str);
          if (!items) return showErr('无法解析序列。示例：a^n*u(n) + n*u(n)，支持 cos(w*n)、sin(w*n)、delta(n)');
          const Z = TR.zOfItems(items);
          // 数值验证：z = 2·roc 处 级数和 vs 符号闭式
          const zv = 2 * (Z.roc || 0.5) + 0.5;
          const series = TR.XzNumeric(items, zv, Z.roc, 600);
          const closed = items.reduce((acc, it) => {
            const v = it.coef * it.sign, z = zv;
            switch (it.kind) {
              case 'an': return acc + (it.a === 0 ? v : v * z / (z - it.a));
              case 'nan': return acc + v * it.a * z / Math.pow(z - it.a, 2);
              case 'n': return acc + v * z / Math.pow(z - 1, 2);
              case 'np2': return acc + v * z * (z + 1) / Math.pow(z - 1, 3);
              case 'zn': { const cw = Math.cos(it.w); return acc + v * z * (z - cw) / (z * z - 2 * z * cw + 1); }
              case 'zsn': { const cw = Math.cos(it.w); return acc + v * z * Math.sin(it.w) / (z * z - 2 * z * cw + 1); }
              case 'un': return acc + v * z / (z - 1);
              case 'delta': return acc + v;
              case 'const': return acc + v * z / (z - 1);
            }
            return acc;
          }, 0);
          showTex([[Z.xLine], [Z.zLine, '因果序列单边 Z 变换（z 正幂有理式）。'], [Z.rocTex, '']]);
          const card = out.firstChild;
          card.append(verifyTable([['z=' + U.fmt(zv, 2) + ' 级数和', series, closed, Math.abs(series - closed) / (Math.abs(closed) || 1)]]));
          card.append(U.el('p', { class: 'hint', html: '数值验证：X(z)=Σ x(n)z<sup>−n</sup> 截断求和与符号闭式对比（z 取 ROC 外）。' }));
        } else if (mode === 'iz') {
          const t = FX_LIB.parseTF(str, 'z');
          if (!t || !t.den || !t.den[0]) return showErr('无法解析 X(z)。示例：z/(z^2-0.25)');
          if (t.num.length > t.den.length) return showErr('需为真分式（分子阶次 ≤ 分母阶次）');
          const d0 = t.den[0];
          const r = TR.invZ(t.num.map((c) => c / d0), t.den.map((c) => c / d0));
          if (!r.tex) return showErr(r.note);
          // 数值对照：差分方程递推 vs 解析式（正幂 num 需在高位补零对齐 den 次数）
          const den = t.den.map((c) => c / d0), num = t.num.map((c) => c / d0);
          const N = 8, x = new Array(N).fill(0); x[0] = 1;
          const rec = (function () { const a = den, bb = num.slice(); while (bb.length < a.length) bb.unshift(0); const y = new Array(N).fill(0); for (let i = 0; i < N; i++) { let acc = 0; for (let k = 0; k < bb.length; k++) if (i - k >= 0) acc += bb[k] * x[i - k]; for (let j = 1; j < a.length; j++) if (i - j >= 0) acc -= a[j] * y[i - j]; y[i] = acc; } return y; })();
          const rows = [1, 2, 3, 5].map((n) => [ 'n=' + n, rec[n], r.evalN(n), Math.abs(rec[n] - r.evalN(n)) ]);
          showTex([[r.tex, (r.note || '')]]);
          const card = out.firstChild;
          card.append(verifyTable(rows));
        }
      } catch (e) {
        showErr('求解出错：' + e.message);
      }
    }
    box.querySelector('#sym-go').addEventListener('click', solve);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') solve(); });
    let symTimer = null;
    inp.addEventListener('input', () => { clearTimeout(symTimer); symTimer = setTimeout(solve, 450); });
    box.querySelector('#sym-t').addEventListener('input', () => { clearTimeout(symTimer); symTimer = setTimeout(solve, 300); });
    applyMode();
  }

  function switchTab() {
    host.querySelector('#ex-expr').classList.toggle('hidden', tab !== 'expr');
    host.querySelector('#ex-sym').classList.toggle('hidden', tab !== 'sym');
    host.querySelector('#ex-draw').classList.toggle('hidden', tab !== 'draw');
    host.querySelector('#ex-voice').classList.toggle('hidden', tab !== 'voice');
    host.querySelectorAll('#ex-tabs .chip').forEach((x) => x.classList.toggle('active', x.dataset.k === tab));
    // 惰性渲染：仅首次进入可见方创建，避免 display:none 导致画布尺寸为 0
    if (tab === 'expr' && !rendered.expr) { renderExpr(); rendered.expr = true; }
    else if (tab === 'sym' && !rendered.sym) { renderSym(); rendered.sym = true; }
    else if (tab === 'draw' && !rendered.draw) { renderDraw(); rendered.draw = true; }
    else if (tab === 'voice' && !rendered.voice) { renderVoice(); rendered.voice = true; }
    // 手绘动画：仅在当前页可见时运行，切走即停，避免后台空转
    if (dloop) {
      if (tab === 'draw' && epicy) { if (!loopRunning) { loopRunning = true; dloop.start(); } }
      else if (loopRunning) { loopRunning = false; dloop.stop(); }
    }
  }

  function tabBar() {
    const tb = host.querySelector('#ex-tabs');
    tb.innerHTML = '';
    const mk = (k, l) => { const c = U.el('button', { class: 'chip' + (tab === k ? ' active' : ''), 'data-k': k }, l); c.addEventListener('click', () => { tab = k; switchTab(); }); tb.append(c); return c; };
    mk('expr', '表达式求解'); mk('sym', '符号变换'); mk('draw', '手绘画圈'); mk('voice', '语音输入');
  }

  // 工具：极点图（参数名用 cvEl，避免遮蔽外层 FX.cvCol 调色函数）
  function pzPlot(cvEl, poles, zeros) {
    const W = cvEl.clientWidth || 400, H = cvEl.clientHeight || 220;
    const dpr = window.devicePixelRatio || 1; cvEl.width = W * dpr; cvEl.height = H * dpr;
    const g = cvEl.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H); g.fillStyle = cv('--cv-bg'); g.fillRect(0, 0, W, H);
    const ml = 40, mr = 14, mt = 14, mb = 24, dw = W - ml - mr, dh = H - mt - mb;
    const cx = ml + dw / 2, cy = mt + dh / 2;
    let R = 3; for (const p of [...poles, ...zeros]) R = Math.max(R, Math.abs(p.re) + 0.3, Math.abs(p.im) + 0.3);
    const SX = (r) => cx + (r * dw / 2) / R, SY = (i) => cy - (i * dh / 2) / R;
    g.fillStyle = cv('--cv-stable-bg'); g.fillRect(ml, mt, cx - ml, dh);
    g.strokeStyle = cv('--cv-grid');
    for (let i = 0; i <= 4; i++) { const x = ml + (i / 4) * dw; g.beginPath(); g.moveTo(x, mt); g.lineTo(x, mt + dh); g.stroke(); }
    for (let i = 0; i <= 4; i++) { const y = mt + (i / 4) * dh; g.beginPath(); g.moveTo(ml, y); g.lineTo(ml + dw, y); g.stroke(); }
    g.strokeStyle = cv('--cv-axis-hi'); g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx, mt); g.lineTo(cx, mt + dh); g.stroke();
    g.strokeStyle = cv('--cv-axis'); g.beginPath(); g.moveTo(ml, cy); g.lineTo(ml + dw, cy); g.stroke();
    g.fillStyle = cv('--cv-tick'); g.font = '10px monospace'; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('jω', cx + 4, mt + 2); g.fillText('σ', ml + dw - 12, cy + 4);
    g.strokeStyle = cv('--cv-danger'); g.lineWidth = 2;
    for (const p of poles) { const x = SX(p.re), y = SY(p.im); g.beginPath(); g.moveTo(x - 7, y - 7); g.lineTo(x + 7, y + 7); g.moveTo(x - 7, y + 7); g.lineTo(x + 7, y - 7); g.stroke(); }
    g.strokeStyle = cv('--cv-line1');
    for (const z of zeros) { const x = SX(z.re), y = SY(z.im); g.beginPath(); g.arc(x, y, 7, 0, 7); g.stroke(); }
  }

  tabBar();
  switchTab();

  return { title: '交互求解', api: { dispose, onTheme: () => { if (tab === 'expr' && exprRedraw) exprRedraw(); if (tab === 'expr' && tfRedraw) tfRedraw(); if (drawReset) drawReset(); } } };
  function dispose() {
    if (dloop && loopRunning) { loopRunning = false; dloop.stop(); }
    if (speechRec) { try { speechRec.onend = null; speechRec.stop(); } catch (e) {} speechRec = null; }
  }
});
