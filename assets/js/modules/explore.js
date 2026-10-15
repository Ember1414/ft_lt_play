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
  const rendered = { expr: false, sym: false, eq: false, draw: false, voice: false };
  let dloop = null, epicy = null, loopRunning = false;   // 手绘动画循环（模块级，便于清理）
  let exprInputRef = null;                                // 表达式输入组件引用（语音路由用）
  let speechRec = null;                                   // 语音识别实例（dispose 时停止）
  let winUpHandler = null, drawRO = null;                 // 全局监听 / ResizeObserver（dispose 时解绑）
  let eqIcsTimer = null, symTTimer = null;                // 初值/采样周期输入防抖定时器（render 内 / dispose 共享）
  let drawPts = [];                                       // 手绘轨迹（模块级，快照用）
  let voiceFinal = '';                                    // 语音最终识别文字（快照用）
  let symSnap = null, symRestore = null;                  // 符号变换页快照捕获 / 恢复（renderSym 注入）
  let eqSnap = null, eqRestore = null;                    // 方程页快照捕获 / 恢复（renderEq 注入）
  let pendingState = null;                                // 待恢复状态（惰性渲染页签在首次渲染时消费）

  host.innerHTML = `
    <div class="module">
      <div class="row" id="ex-tabs" style="margin-bottom:14px"></div>
      <div id="ex-rtb"></div>
      <div id="ex-expr" class="hidden"></div>
      <div id="ex-sym" class="hidden"></div>
      <div id="ex-eq" class="hidden"></div>
      <div id="ex-draw" class="hidden"></div>
      <div id="ex-voice" class="hidden"></div>
    </div>`;

  /* ---------- 表达式求解 ---------- */
  function renderExpr() {
    const box = host.querySelector('#ex-expr');
    box.innerHTML = `
      <div class="pane" style="margin-bottom:16px">
        <h3>输入表达式 · 自动识别时域信号 / 传递函数</h3>
        <div id="ex-mi"></div>
        <div class="dirty-hint" id="ex-dirty" hidden>已修改，按「求解」更新结果</div>
        <div class="hint">自动识别：含 <code>s</code> 的分式（<code>/</code>）或 s 多项式（含因式积如 <code>(s+1)(s+2)</code>、<code>2(s+1)</code>）→ 按<b>传递函数</b>求解（波特图+阶跃+极点零点）；否则按 <code>t</code> 的<b>时域信号</b>求解（波形+频谱）。
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

    /* ---------- TF/时域路由判定 ----------
     * 旧规则始终保留：含独立 s 且含 '/' → 传函（保证畸形分式仍走传函专属报错）。
     * 新增：含独立 s/z 且不含独立 t/n（时域/离散变量在场必然不是传函语境）时
     * 先试 parseTF——隐式乘法传函如 (s+1)(s+2)、2(s+1)、s^2(s+1) 也路由到传函通道。 */
    function isTFRoute(str, bare) {
      const std = (ch) => new RegExp('(^|[^a-zA-Z0-9_])' + ch + '([^a-zA-Z0-9_]|$)').test(bare);
      const hasS = std('s'), hasZ = std('z');
      if (hasS && bare.includes('/')) return true;
      if ((!hasS && !hasZ) || std('t') || std('n')) return false;
      return !!FX_LIB.parseTF(str);
    }

    /* ---------- 统一输入组件 MI：键盘/徽标/历史/示例 + 实时识别 ---------- */
    const ex = MI.exprInput(box.querySelector('#ex-mi'), {
      id: 'ex-input',
      placeholder: '例：exp(-2*t)*sin(10*t)*u(t)   或   5/(s^2+0.5*s+1.25)',
      parse: (str) => {
        const bare = U.normChars(str).replace(/\s+/g, '');
        if (isTFRoute(str, bare)) {
          const t = FX_LIB.parseTF(str);
          return tfProperOk(t)
            ? { verdict: 'ok', message: '识别为传递函数 H(s)：将绘制波特图 · 阶跃响应 · 零极点' }
            : { verdict: 'err', message: '传递函数格式有误（需为 s 的多项式之比，分母可为多项式或非零常数）' };
        }
        return FX_LIB.parseTimeExpr(str)
          ? { verdict: 'ok', message: '识别为时域信号 x(t)：将绘制波形 · 幅度谱 · 相位谱' }
          : { verdict: 'err', message: '暂无法解析，请检查括号与函数名（支持 u(t)、sinc、rect、tri、exp…）' };
      },
      pad: ['t', 'u(t)', 'sin(', 'cos(', 'tan(', 'exp(', 'ln(', 'sqrt(', 'abs(',
        'sinc(', 'rect(', 'tri(', '^2', 'pi', '(', ')', '*', '/', '+', '-'],
      examples,
      historyKey: 'flt-expr-history',
      debounce: 220,
      autoApply: false,
      onApply: (str) => go(str)
    });
    exprInputRef = ex;
    // 求解/分享/语音按钮注入输入条
    const goBtn = U.el('button', { class: 'btn primary', id: 'ex-go' }, '求解');
    goBtn.addEventListener('click', () => ex.apply());
    const shareBtn = U.el('button', { class: 'btn', id: 'ex-share', title: '复制当前表达式的分享链接' }, '🔗');
    shareBtn.addEventListener('click', () => shareLink(ex.get()));
    const micBtn = U.el('button', { class: 'btn', id: 'ex-mic', title: '语音输入：说出表达式后插入输入框（Chrome/Edge）', 'aria-label': '语音输入表达式' });
    micBtn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;padding:8px 10px';
    micBtn.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-mic"/></svg>';
    micBtn.addEventListener('click', () => oneShotVoice(micBtn));
    ex.bar.append(goBtn, shareBtn, micBtn);

    // 内联单次语音识别：识别完成 → mapSpeech → 光标处插入输入框（不自动求解，用户确认后按「求解」）
    function oneShotVoice(btn) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { App.toast('当前浏览器不支持 Web Speech API，请使用 Chrome/Edge'); return; }
      if (btn.classList.contains('listening')) return;
      const rec = new SR(); rec.lang = 'zh-CN'; rec.interimResults = false; rec.continuous = false; rec.maxAlternatives = 1;
      speechRec = rec;
      btn.classList.add('listening');
      const stop = () => { btn.classList.remove('listening'); try { rec.onresult = rec.onerror = rec.onend = null; } catch (e) { } };
      rec.onresult = (e) => {
        const txt = e.results && e.results[0] && e.results[0][0] ? e.results[0][0].transcript : '';
        const expr = mapSpeech(txt);
        if (expr && exprInputRef) {
          const inp = exprInputRef.input;
          const s = inp.selectionStart == null ? inp.value.length : inp.selectionStart;
          const ePos = inp.selectionEnd == null ? s : inp.selectionEnd;
          inp.value = inp.value.slice(0, s) + expr + inp.value.slice(ePos);
          try { inp.setSelectionRange(s + expr.length, s + expr.length); } catch (err) { }
          inp.dispatchEvent(new Event('input'));
          App.toast('语音已插入：' + (expr.length > 40 ? expr.slice(0, 40) + '…' : expr) + '，确认后点击求解');
        } else if (!expr) App.toast('未识别到可映射的内容');
      };
      rec.onerror = (e) => { stop(); App.toast('语音识别出错：' + (e.error || 'unknown')); };
      rec.onend = () => stop();
      try { rec.start(); } catch (err) { stop(); App.toast('无法启动语音识别'); }
    }
    // 已修改提示：输入与上次求解不一致时提示手动更新（与 sym 页同一交互语言）
    let exprLastSolved = '';
    ex.input.addEventListener('input', () => {
      const cur = ex.get().trim();
      const dEl = box.querySelector('#ex-dirty');
      if (dEl) dEl.hidden = !(cur && cur !== exprLastSolved);
    });

    const go = (str0) => {
      const str = (str0 != null ? String(str0) : ex.get()).trim();
      if (!str) return;
      exprLastSolved = str;
      const dEl = box.querySelector('#ex-dirty');
      if (dEl) dEl.hidden = true;
      // TF/时域路由（先归一化，全角 ｓ／ 同样可判；判定规则见 isTFRoute）
      const bare = U.normChars(str).replace(/\s+/g, '');
      const isTF = isTFRoute(str, bare);
      const res = box.querySelector('#ex-result');
      let okFlag = false;
      if (isTF) {
        const t = FX_LIB.parseTF(str);
        okFlag = tfProperOk(t);
      } else {
        okFlag = !!FX_LIB.parseTimeExpr(str);
      }
      if (!okFlag) { if (isTF) renderTF(res, str); else renderTime(res, str); return; }
      try { if (App.hashFree()) history.replaceState(null, '', '#ex=' + encodeURIComponent(str)); } catch (e) {}
      if (isTF) renderTF(res, str); else renderTime(res, str);
    };

    /* ---------- 分享链接：表达式写入 URL hash ---------- */
    function shareLink(str) {
      const url = location.origin + location.pathname + '#ex=' + encodeURIComponent(str);
      const done = () => { shareBtn.textContent = '✓'; setTimeout(() => { shareBtn.textContent = '🔗'; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, () => { location.hash = 'ex=' + encodeURIComponent(str); });
      } else { location.hash = 'ex=' + encodeURIComponent(str); done(); }
    }

    // 初始值：优先 URL 分享参数，其次历史最近一条，最后默认示例
    const urlExpr = new URLSearchParams(location.hash.replace(/^#/, '')).get('ex');
    const hist0 = (JSON.parse(localStorage.getItem('flt-expr-history') || '[]') || [])[0];
    const init0 = urlExpr || hist0 || 'exp(-2*t)*sin(10*t)*u(t)';
    ex.set(init0);
    go(init0);
  }

  function renderTime(res, str) {
    const f = FX_LIB.parseTimeExpr(str);
    res.innerHTML = `
      <div class="pane" style="grid-column:1/-1">
        <div class="formula-center">x(t) = <code>${str.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</code></div>
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
      const t0El = res.querySelector('#ex-t0'), t1El = res.querySelector('#ex-t1');
      if (!t0El || !t1El) return;   // 画布已被其它结果覆盖（旧闭包被 onTheme 调用时）
      let T0 = parseFloat(t0El.value), T1 = parseFloat(t1El.value);
      let badRange = false;
      if (!isFinite(T0) || !isFinite(T1) || T1 <= T0) { T0 = -4; T1 = 8; badRange = true; }
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
      // 无效时间范围：明确提示而非静默回退
      const infoEl = res.querySelector('#ex-time-info');
      const warnEl = infoEl.querySelector('.range-warn');
      if (badRange && !warnEl) infoEl.insertAdjacentHTML('beforeend', '<p class="hint range-warn" style="color:var(--warn);margin-top:4px">⚠ 时间范围无效（需为 t₁ &lt; t₂ 的数值），已回退到 [-4, 8]。</p>');
      else if (!badRange && warnEl) warnEl.remove();
    };
    exprRedraw = draw; tfRedraw = null; drawReset = null;   // 只保留当前结果的重绘入口
    // 时间范围：change 与 Enter 均可应用
    const applyRange = () => { Object.values(draw._cache || {}).forEach((p) => p.resetView()); draw(); };
    const onRangeKey = (e) => { if (e.key === 'Enter') applyRange(); };
    for (const rid of ['#ex-t0', '#ex-t1']) {
      res.querySelector(rid).addEventListener('change', applyRange);
      res.querySelector(rid).addEventListener('keydown', onRangeKey);
    }
    draw();
    if (FX.enablePlotChrome) FX.enablePlotChrome(res);
  }

  /* 真分式门控（三处共用：MI 实时徽标 / 求解按钮 okFlag / renderTF 入口）。
   * 纯多项式输入（如 (s+1)(s+2)、2(s+1)）经 parseTF 得 den=[1]（非零常数）→ 合法；
   * 分母为多项式时仍要求分子阶次 ≤ 分母阶次；分母常数 0/NaN 一律拒绝。 */
  function tfProperOk(t) {
    if (!t || !t.num || !t.den || !t.den.length) return false;
    if (t.den.length === 1) return isFinite(t.den[0]) && t.den[0] !== 0;
    return t.num.length <= t.den.length;
  }

  function renderTF(res, str) {
    const t = FX_LIB.parseTF(str);
    if (!tfProperOk(t)) {
      res.innerHTML = '<div class="pane" style="grid-column:1/-1;color:var(--danger)">无法解析传递函数。要求：分子/分母为 s 的多项式，分母可为多项式或非零常数（如 <code>5/(s^2+2*s+5)</code>、<code>(s+1)(s+2)</code>），且分母为多项式时分子阶次 ≤ 分母阶次。</div>';
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
    // FX.katex：缺库/渲染失败时降级为纯文本（旧实现静默留空，用户误以为解析失败）
    FX.katex('H(s)=\\dfrac{' + polyTex(num) + '}{' + polyTex(den) + '}', res.querySelector('#ex-h'), { displayMode: true });

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
    tfRedraw = drawAll; exprRedraw = null; drawReset = null;   // 只保留当前结果的重绘入口
    drawAll();

    const dc = den[den.length - 1] !== 0 ? num[num.length - 1] / den[den.length - 1] : Infinity;
    const hasRhp = poles.some((p) => p.re > 1e-9);
    const hasJw = poles.some((p) => Math.abs(p.re) <= 1e-9);
    const stable = !hasRhp && !hasJw;
    const stableText = stable ? '稳定' : (hasRhp ? '不稳定' : '临界稳定');
    const stableColor = stable ? cv('--cv-line2') : (hasRhp ? cv('--cv-danger') : cv('--cv-warn'));
    const fmtC = (z) => U.fmt(z.re, 2) + (Math.abs(z.im) > 1e-9 ? (z.im >= 0 ? '+' : '') + U.fmt(z.im, 2) + 'j' : '');
    res.querySelector('#ex-metrics').innerHTML = `
      <div class="stat"><span class="k">极点</span><span class="v">${poles.map(fmtC).join(', ') || '—'}</span></div>
      <div class="stat"><span class="k">零点</span><span class="v">${zeros.map(fmtC).join(', ') || '—'}</span></div>
      <div class="stat"><span class="k">DC 增益</span><span class="v">${U.fmt(dc)}</span></div>
      <div class="stat"><span class="k">稳定性</span><span class="v" style="color:${stableColor}">${stableText}</span></div>`;
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
      for (let i = 0; i < drawPts.length; i++) { const c = drawPts[i]; i ? g.lineTo(c.x, c.y) : g.moveTo(c.x, c.y); }
      g.stroke();
    }
    function repaintStroke() { clearInput(); if (drawPts.length) strokePath(); }
    drawReset = repaintStroke;   // 主题切换时重绘底色与已画轨迹
    exprRedraw = null; tfRedraw = null;   // 只保留当前结果的重绘入口
    clearInput();
    let drawing = false;   // 轨迹存模块级 drawPts（快照用）
    cvs.addEventListener('pointerdown', (e) => { drawing = true; drawPts = []; clearInput(); try { cvs.setPointerCapture(e.pointerId); } catch (err) {} e.preventDefault(); });
    const onWinUp = () => { drawing = false; };
    winUpHandler = onWinUp;
    window.addEventListener('pointerup', onWinUp);
    cvs.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const r = cvs.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const last = drawPts[drawPts.length - 1];
      if (last && Math.hypot(x - last.x, y - last.y) < 1.5) return;   // 抽稀，笔迹更顺滑
      drawPts.push({ x, y });
      g.strokeStyle = cv('--cv-text'); g.lineWidth = 2; g.lineJoin = 'round'; g.lineCap = 'round';
      g.beginPath();
      if (last) { g.moveTo(last.x, last.y); g.lineTo(x, y); } else { g.moveTo(x, y); g.lineTo(x + 0.1, y); }
      g.stroke();
    });
    // 容器尺寸变化时保持清晰（桌面适配）
    if (typeof ResizeObserver !== 'undefined' && cvs.parentElement) {
      drawRO = new ResizeObserver(() => { if (!cvs.isConnected) { drawRO.disconnect(); return; } repaintStroke(); });
      drawRO.observe(cvs.parentElement);
    }
    box.querySelector('#ex-drcl').addEventListener('click', () => { drawPts = []; clearInput(); });

    dloop = U.loop(() => { if (epicy) drawFrame(); });
    box.querySelector('#ex-dran').addEventListener('click', () => {
      if (drawPts.length < 30) { box.querySelector('#ex-drstat').innerHTML = '<span class="hint">请先在上图画一条曲线。</span>'; return; }
      const sm = resample(drawPts, 480);
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

  /* ---------- 方程求解：微分方程 / 差分方程 / 数据序列 ---------- */
  function renderEq() {
    const box = host.querySelector('#ex-eq');
    box.innerHTML = `
      <div class="pane" style="margin-bottom:16px">
        <h3>方程求解 · 零输入 / 零状态分解</h3>
        <div class="row" id="eq-modes" style="margin-bottom:12px"></div>
        <div id="eq-in"></div>
        <div id="eq-ics" style="margin-top:8px"></div>
        <div class="hint" id="eq-hint" style="margin-top:8px"></div>
        <div class="row" id="eq-ex" style="margin-top:10px"></div>
        <div class="confirm-bar" id="eq-confirm" hidden></div>
      </div>
      <div id="eq-out"><p class="hint">输入方程后自动求解（全解 = 零输入 + 零状态，解析式与数值仿真互证）。</p></div>`;
    let mode = 'ode';   // ode | dde | data
    let plot = null, plotData = null;

    const conf = {
      ode: {
        label: '微分方程',
        def: "y'' + 3*y' + 2*y = u(t)",
        hint: "写法：<code>y''</code> 二阶导（也支持 <code>y2</code>、<code>y[[2]]</code>），右端 f(t) 支持 <code>exp/sin/cos/t^n/u(t)</code> 线性组合；初值在下方填写（默认 0）。",
        ex: [["y'' + 3*y' + 2*y = u(t)", '二阶受迫'], ["y'' + 2*y' + y = 0", '临界阻尼'], ["y'' + y = cos(t)", '无阻尼受迫'], ["y' - y = exp(-2*t)*u(t)", '一阶+指数输入'], ["y''' + y = 0", '三阶齐次']]
      },
      dde: {
        label: '差分方程',
        def: 'y[n+2] - 1.5*y[n+1] + 0.5*y[n] = u[n]',
        hint: '写法：<code>y[n+2]</code>（也支持 <code>y2</code>、<code>y(n+2)</code>），右端 x[n] 支持 <code>0.5^n</code>、<code>n</code>、<code>cos(w*n)</code>、<code>u(n)</code>、<code>delta(n)</code> 组合。',
        ex: [['y[n+2] - 1.5*y[n+1] + 0.5*y[n] = u[n]', '二阶受迫'], ['y[n+1] - 0.5*y[n] = 0', '一阶齐次'], ['y[n+1] - y[n] = n*u[n]', '斜坡输入'], ['y[n+2] + y[n] = delta[n]', '脉冲响应']]
      },
      data: {
        label: '数据序列',
        def: '',
        hint: '粘贴一列数（逗号 / 空格 / 换行分隔），绘制序列杆状图与频谱（DFT）；也支持两列粘贴「t, y」（每行两列、时间均匀）自动识别采样率。操作：序列分析（谱窗 / dB / 相位）、卷积、互相关（归一化 + 峰值滞后）、反卷积、滤波（预设 + 加噪对比）。',
        ex: [['1, -1, 1, -1, 1, -1, 1, -1', '交替序列'], ['1 2 3 4 5 4 3 2', '三角波'], ['0, 0\n0.125, 1\n0.25, 0\n0.375, -1\n0.5, 0\n0.625, 1\n0.75, 0\n0.875, -1\n1, 0', '两列 t,y']]
      }
    };

    const modesRow = box.querySelector('#eq-modes');
    const inBox = box.querySelector('#eq-in');
    const icsBox = box.querySelector('#eq-ics');
    const hintEl = box.querySelector('#eq-hint');
    const out = box.querySelector('#eq-out');
    const eqIn = MI.exprInput(inBox, {
      id: 'eq-in-str',
      placeholder: "例：y'' + 3*y' + 2*y = u(t)",
      pad: ['y', "'", '^2', '[n+2]', '*', '+', '-', '='],
      debounce: 400,
      autoApply: false,
      parse: (str) => {
        if (mode === 'data') return { verdict: 'ok' };
        const p = mode === 'ode' ? ODE.parseODE(str) : ODE.parseDiffEq(str);
        if (!p.ok) return { verdict: 'err', message: p.note };
        return { verdict: 'ok', message: '阶数 ' + p.n + ' · 右端 ' + p.rhsItems.length + ' 项' };
      },
      onApply: () => solveEq()
    });
    const goBtn = U.el('button', { class: 'btn primary', id: 'eq-go' }, '求解');
    goBtn.addEventListener('click', () => eqIn.apply());
    eqIn.bar.append(goBtn);

    const icsState = {};   // 初值输入缓存（模式切换后重建）
    function buildIcs(n, names) {
      icsBox.innerHTML = '';
      if (mode === 'data' || !n) return;
      const row = U.el('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px;align-items:center' });
      for (let m = 0; m < n; m++) {
        if (!(m in icsState)) icsState[m] = '0';
        const inp = U.el('input', { type: 'number', step: 'any', value: icsState[m], 'aria-label': names(m), style: 'width:86px' });
        // 初值输入 300ms 防抖：避免每个按键都全量重解
        inp.addEventListener('input', () => { icsState[m] = inp.value; clearTimeout(eqIcsTimer); eqIcsTimer = setTimeout(solveEq, 300); });
        row.append(U.el('label', { class: 'chip' }, names(m)), inp);
      }
      icsBox.appendChild(row);
    }

    function renderMode(keepStr) {
      hintEl.innerHTML = conf[mode].hint;
      renderExamples(conf[mode].ex);
      icsBox.innerHTML = '';
      if (mode === 'data') {
        eqIn.input.style.display = 'none';
        goBtn.style.display = 'none';
        buildDataArea();
      } else {
        eqIn.input.style.display = '';
        goBtn.style.display = '';
        out.innerHTML = '<p class="hint">输入方程后自动求解。</p>';
        eqIn.set(keepStr != null ? keepStr : conf[mode].def);
        eqIn.apply();
      }
    }
    function renderExamples(exs) {
      const row = box.querySelector('#eq-ex');
      row.innerHTML = '';
      exs.forEach(([expr, name]) => {
        const c = U.el('button', { class: 'chip', title: expr }, name);
        c.addEventListener('click', () => {
          if (mode === 'data') { const ta = box.querySelector('#eq-data'); if (ta) { noisyX = null; ta.value = expr; solveEq(); } }
          else { eqIn.set(expr); eqIn.apply(); }
        });
        row.append(c);
      });
    }
    let dataOp = 'seq';       // seq 序列分析 | conv 卷积 | corr 互相关 | deconv 反卷积 | filter 滤波
    let dataWin = 'rect';     // 序列分析谱窗：rect | hamming | hanning | blackman
    let dataPh = false;       // 相位谱折叠显示
    let dataDb = false;       // 幅度谱 dB 刻度
    let filtPreset = 'ma5';   // 滤波预设：ma5 滑动平均 | diff 一阶差分 | lp 单极点低通
    let snrDb = 20;           // 加噪信噪比（dB）
    let noisyX = null;        // 加噪后的序列（filter 模式数据源；修改输入后失效）
    const WIN_NAMES = { rect: '矩形', hamming: '汉明', hanning: '汉宁', blackman: '布莱克曼' };
    const FILT_PRESETS = [
      ['ma5', '滑动平均 N=5', 'FIR：h = ones(5)/5，平滑高频抖动'],
      ['diff', '一阶差分', 'FIR：h = [1, −1]，粗提取变化率/边缘'],
      ['lp', '单极点低通 α=0.2', 'IIR：y[k] = (1−α)y[k−1] + α·x[k]，直接递推（非卷积）']
    ];
    function buildDataArea() {
      const ta = U.el('textarea', { id: 'eq-data', rows: '4', spellcheck: 'false', 'aria-label': '数据序列', style: 'width:100%;font-family:var(--mono);font-size:13px' });
      ta.value = '1, 0.5, 0.25, 0.125, 0.0625';
      ta.addEventListener('input', () => { noisyX = null; solveEq(); });
      const opRow = U.el('div', { class: 'row', style: 'margin:6px 0;flex-wrap:wrap;align-items:center' });
      const xLabel = U.el('span', { class: 'hint', style: 'margin:0' }, 'x(n)：');
      [['seq', '序列分析'], ['conv', '卷积 x*h'], ['corr', '互相关 x⋆h'], ['deconv', '反卷积'], ['filter', '滤波']].forEach(([k, label]) => {
        const c = U.el('button', { class: 'chip' + (k === dataOp ? ' active' : ''), 'data-op': k }, label);
        c.addEventListener('click', () => { if (dataOp === k) return; dataOp = k; syncDataUI(); solveEq(); });
        opRow.append(c);
      });
      opRow.append(xLabel);
      icsBox.append(opRow);
      icsBox.appendChild(ta);
      const paramBox = U.el('div', { id: 'eq-data-params', style: 'margin-top:6px' });
      icsBox.appendChild(paramBox);
      const hLabel = U.el('div', { class: 'hint', style: 'margin:6px 0 2px' }, 'h(n)（卷积/互相关的第二序列）：');
      const ta2 = U.el('textarea', { id: 'eq-data2', rows: '3', spellcheck: 'false', 'aria-label': '第二序列 h(n)', style: 'width:100%;font-family:var(--mono);font-size:13px' });
      ta2.value = '1, 1, 1';
      ta2.addEventListener('input', () => solveEq());
      icsBox.append(hLabel, ta2);

      // 参数行 / 标签联动：仅当前操作相关的输入可见（反卷积把 x(n) 观测标签切换为 y(n)）
      function syncDataUI() {
        opRow.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.op === dataOp));
        xLabel.textContent = dataOp === 'deconv' ? 'y(n)（观测）：' : 'x(n)：';
        const needH = dataOp === 'conv' || dataOp === 'corr' || dataOp === 'deconv';
        hLabel.style.display = needH ? '' : 'none';
        ta2.style.display = needH ? '' : 'none';
        if (needH) hLabel.textContent = dataOp === 'deconv' ? 'h(n)（系统脉冲响应）：' : 'h(n)（卷积/互相关的第二序列）：';
        paramBox.innerHTML = '';
        if (dataOp === 'seq') {
          const row = U.el('div', { class: 'row', style: 'margin:0;flex-wrap:wrap;align-items:center;gap:6px' });
          const winSel = U.el('select', { id: 'eq-data-win', 'aria-label': '谱窗函数', style: 'background:transparent;border:0;color:var(--accent);font-family:var(--mono)' });
          [['rect', '矩形窗'], ['hamming', '汉明窗'], ['hanning', '汉宁窗'], ['blackman', '布莱克曼窗']].forEach(([k, l]) => {
            const o = U.el('option', { value: k }, l);
            if (k === dataWin) o.selected = true;
            winSel.append(o);
          });
          winSel.addEventListener('change', () => { dataWin = winSel.value; solveEq(); });
          row.append(U.el('label', { class: 'chip' }, ['谱窗 ', winSel]));
          const mkChk = (key, label) => {
            const cb = U.el('input', { type: 'checkbox', style: 'vertical-align:middle' });
            cb.checked = key === 'ph' ? dataPh : dataDb;
            cb.addEventListener('change', () => { if (key === 'ph') dataPh = cb.checked; else dataDb = cb.checked; solveEq(); });
            return U.el('label', { class: 'chip', style: 'cursor:pointer' }, [cb, ' ' + label]);
          };
          row.append(mkChk('ph', '相位谱'), mkChk('db', 'dB 刻度'));
          paramBox.append(row);
        } else if (dataOp === 'filter') {
          const row = U.el('div', { class: 'row', style: 'margin:0;flex-wrap:wrap;align-items:center;gap:6px' });
          FILT_PRESETS.forEach(([k, label, tip]) => {
            const c = U.el('button', { class: 'chip' + (k === filtPreset ? ' active' : ''), 'data-fp': k, title: tip }, label);
            c.addEventListener('click', () => { if (filtPreset === k) return; filtPreset = k; syncDataUI(); solveEq(); });
            row.append(c);
          });
          paramBox.append(row);
          // 噪声：SNR 滑杆 + 加噪按钮（按当前 SNR 生成高斯白噪声并重跑当前操作）
          const nRow = U.el('div', { class: 'row', style: 'margin:6px 0 0;flex-wrap:wrap;align-items:center;gap:6px' });
          const sl = U.el('input', { type: 'range', min: '0', max: '40', value: String(snrDb), 'aria-label': '加噪信噪比 dB', style: 'width:110px;vertical-align:middle' });
          const sv = U.el('b', { style: 'font-family:var(--mono)' }, snrDb + ' dB');
          sl.addEventListener('input', () => { snrDb = +sl.value || 0; sv.textContent = snrDb + ' dB'; });
          const nb = U.el('button', { class: 'chip', title: '按当前 SNR 对 x(n) 加高斯白噪声并重跑当前操作（再按可重新抽样）' }, '加噪');
          nb.addEventListener('click', addNoise);
          nRow.append(U.el('label', { class: 'chip' }, ['SNR ', sl, sv]), nb, U.el('span', { class: 'hint', style: 'margin:0' }, '加噪后显示 原始 / 加噪 / 滤波 对比'));
          paramBox.append(nRow);
        }
      }

      // 加噪：sigma = rms(x)/10^(SNR/20)，一次生成缓存后重跑（换操作/改输入后自动失效）
      function addNoise() {
        const dd = ODE.parseDataSeq(ta.value);
        if (!dd.ok) { solveEq(); return; }
        let p = 0;
        for (const v of dd.values) p += v * v;
        const rms = Math.sqrt(p / Math.max(1, dd.values.length));
        const nz = DSP.gaussNoise(dd.values.length, rms / Math.pow(10, snrDb / 20));
        noisyX = dd.values.map((v, i) => v + nz[i]);
        solveEq();
      }

      syncDataUI();
      solveEq();
    }

    // 滤波：FIR 预设走卷积；单极点低通为 IIR 直接递推（DSP.iir1，非卷积实现）。
    // 加噪后三线同图对比：滤波输出（杆）+ 原始（灰线）+ 加噪（粉点）。
    function runFilter(d) {
      const x0 = d.values;
      const hasNoise = Array.isArray(noisyX) && noisyX.length === x0.length;
      const xIn = hasNoise ? noisyX : x0;
      let yv, kind, hDesc;
      if (filtPreset === 'ma5') { yv = DSP.conv(xIn, [0.2, 0.2, 0.2, 0.2, 0.2]); kind = 'FIR'; hDesc = 'h=ones(5)/5'; }
      else if (filtPreset === 'diff') { yv = DSP.conv(xIn, [1, -1]); kind = 'FIR'; hDesc = 'h=[1,−1]'; }
      else { yv = DSP.iir1(xIn, 0.2); kind = 'IIR'; hDesc = 'y[k]=(1−α)y[k−1]+α·x[k], α=0.2'; }
      const series = [{ arr: yv, stem: true, color: '--cv-line1', width: 2, dots: true, dotColor: '--cv-warn', dotR: 2.6 }];
      series.push({ arr: x0, line: true, color: '--cv-tick', width: 1.2 });
      if (hasNoise) series.push({ arr: xIn, line: true, color: '--cv-pink', width: 1, dots: true, dotColor: '--cv-pink', dotR: 1.6 });
      drawData({
        series,
        t: d.t || null, dt: d.Fs ? 1 / d.Fs : 1, Fs: d.Fs || null,
        title: '滤波对比：滤波输出（杆）· 原始（灰线）' + (hasNoise ? ' · 加噪（粉点）' : ''),
        stats: [['运算', '滤波（' + kind + '）'], ['滤波器', hDesc]].concat(hasNoise ? [['噪声', 'SNR ' + snrDb + ' dB（高斯白）']] : [])
      });
    }

    function solveEq() {
      if (mode === 'data') {
        const ta = box.querySelector('#eq-data');
        const d = ODE.parseDataSeq(ta ? ta.value : '');
        if (!d.ok) { out.innerHTML = '<p class="hint" style="color:var(--danger)">✗ ' + (d.note || '解析失败') + '</p>'; return; }
        const dtv = d.Fs ? 1 / d.Fs : 1;   // 两列时间轴 → 真实采样周期；单列 → 归一化（×fs）
        if (dataOp === 'seq') { drawData({ arr: d.values, t: d.t || null, dt: dtv, Fs: d.Fs || null }); return; }
        if (dataOp === 'filter') { runFilter(d); return; }
        const ta2 = box.querySelector('#eq-data2');
        const d2 = ta2 ? ODE.parseDataSeq(ta2.value) : null;
        if (!d2 || !d2.ok) { out.innerHTML = '<p class="hint" style="color:var(--danger)">✗ 第二序列 h(n)：' + ((d2 && d2.note) || '缺失') + '</p>'; return; }
        if (dataOp === 'deconv') {
          const r = DSP.deconv(d.values, d2.values);
          drawData({
            arr: r.x, t: d.t || null, dt: dtv, Fs: d.Fs || null,
            title: '反卷积估计 x̂[n] 与幅度谱 |X̂(f)|',
            stats: [['运算', '反卷积 x̂ = IFFT(Y·H*/|H|²)'], ['长度', d.values.length + ' / ' + d2.values.length + ' → ' + r.x.length], ['残差', U.fmt(r.residual * 100, 2) + '%']],
            notes: r.ok ? [] : ['<span style="color:var(--warn)">⚠ 残差较大，h 可能有零点或长度不足（或 y 非完整卷积结果 / 含噪过强）。</span>']
          });
          return;
        }
        const hv = dataOp === 'corr' ? d2.values.slice().reverse() : d2.values;
        const yv = DSP.conv(d.values, hv);
        if (dataOp === 'corr') {
          // 归一化互相关：除以两序列能量的几何平均；峰值滞后 k（h 已反转，lag = 峰索引 − (len(h)−1)）
          let ex = 0, eh = 0;
          for (const v of d.values) ex += v * v;
          for (const v of d2.values) eh += v * v;
          const gn = Math.sqrt(ex * eh);
          const nv = gn > 1e-30 ? yv.map((v) => v / gn) : yv;
          let kPeak = 0;
          for (let i = 1; i < nv.length; i++) if (Math.abs(nv[i]) > Math.abs(nv[kPeak])) kPeak = i;
          const lag = kPeak - (d2.values.length - 1);
          drawData({
            arr: nv,
            title: '归一化互相关 r[n] 与幅度谱 |R(f)|',
            stats: [['运算', '互相关（归一化）'], ['长度', d.values.length + ' ⋆ ' + d2.values.length + ' → ' + nv.length], ['峰值滞后', 'k=' + lag], ['峰值 r', U.fmt(nv[kPeak], 4)]],
            marker: { i: kPeak }
          });
          return;
        }
        drawData({
          arr: yv,
          title: '卷积 y=x*h 与幅度谱 |Y(f)|',
          stats: [['运算', '卷积 y=x*h'], ['长度', d.values.length + ' * ' + d2.values.length + ' → ' + yv.length]]
        });
        return;
      }
      const str = eqIn.get();
      if (!str) return;
      const p = mode === 'ode' ? ODE.parseODE(str) : ODE.parseDiffEq(str);
      if (!p.ok) { out.innerHTML = '<p class="hint" style="color:var(--danger)">✗ ' + p.note + '</p>'; return; }
      const names = (m) => mode === 'ode' ? (m === 0 ? 'y(0)' : 'y' + "'".repeat(m) + '(0)') : 'y[' + m + ']';
      buildIcs(p.n, names);
      const ics = [];
      for (let m = 0; m < p.n; m++) ics.push(isFinite(+icsState[m]) ? +icsState[m] : 0);
      const r = mode === 'ode' ? ODE.solveODE(p.a, p.rhsItems, ics) : ODE.solveDiffEq(p.a, p.rhsItems, ics);
      if (!r.ok) { out.innerHTML = '<p class="hint" style="color:var(--danger)">✗ ' + r.note + '</p>'; return; }
      drawSolution(p, r, ics);
    }

    function fmtTex(el, tex) {
      el.innerHTML = '';
      if (tex) FX.katex(tex, el, { displayMode: true });
      else el.innerHTML = '<span style="color:var(--warn)">解析式暂不可用（见提示）</span>';
    }
    function drawSolution(p, r, ics) {
      out.innerHTML = '';
      const isOde = mode === 'ode';
      const poleStr = r.poles.map((q) => U.fmt(q.re, 3) + (Math.abs(q.im) > 1e-9 ? (q.im > 0 ? '+' : '') + U.fmt(q.im, 3) + 'j' : '')).join(', ');
      const stats = U.el('div', { class: 'statbar' });
      stats.innerHTML = `
        <div class="stat"><span class="k">阶数</span><span class="v">${p.n}</span></div>
        <div class="stat"><span class="k">${isOde ? '特征根' : '极点'}</span><span class="v" style="max-width:280px;word-break:break-all">${poleStr || '—'}</span></div>
        <div class="stat"><span class="k">稳定性</span><span class="v" style="color:${/不稳定/.test(r.stableText) ? 'var(--danger)' : /临界/.test(r.stableText) ? 'var(--warn)' : 'var(--accent-2)'}">${r.stableText}</span></div>`;
      out.append(stats);
      if (r.note) out.append(U.el('p', { class: 'hint', html: '<span style="color:var(--warn)">⚠ ' + r.note + '</span>' }));
      const fullBox = U.el('div', { class: 'formula-center', style: 'margin:10px 0' });
      fmtTex(fullBox, r.full.tex);
      out.append(fullBox);
      const split = U.el('div', { class: 'layout', style: 'margin:6px 0' });
      const ziBox = U.el('div', { class: 'pane' });
      const zsBox = U.el('div', { class: 'pane' });
      ziBox.innerHTML = '<h3 style="margin-top:0">零输入响应</h3>';
      zsBox.innerHTML = '<h3 style="margin-top:0">零状态响应</h3>';
      const ziTex = U.el('div', { class: 'formula-center' });
      const zsTex = U.el('div', { class: 'formula-center' });
      fmtTex(ziTex, r.zi.tex);
      fmtTex(zsTex, r.zs.tex);
      ziBox.append(ziTex); zsBox.append(zsTex);
      split.append(ziBox, zsBox);
      out.append(split);
      const wrap = U.el('div', { class: 'pane' });
      wrap.innerHTML = '<h3 style="margin-top:0">响应曲线（解析 = 线 · 数值 = 点）</h3><div class="canvas-wrap" style="height:240px"><canvas class="plot" id="eq-cv"></canvas></div>';
      out.append(wrap);
      const tblWrap = U.el('div');
      out.append(tblWrap);

      let tmax, N, tArr, fullY, ziY, zsY, numT, numY, verify;
      if (isOde) {
        const unstable = r.poles.some((q) => q.re > 1e-9);
        const marginal = r.poles.some((q) => Math.abs(q.re) <= 1e-9);
        tmax = unstable ? 4 : marginal ? 8 : U.clamp(4 / Math.max(1e-9, Math.max(...r.poles.map((q) => -q.re))), 1, 20);
        N = 600;
        tArr = []; fullY = []; ziY = []; zsY = [];
        for (let i = 0; i <= N; i++) {
          const t = (i / N) * tmax;
          tArr.push(t);
          fullY.push(r.full.evalT ? r.full.evalT(t) : NaN);
          ziY.push(r.zi.evalT ? r.zi.evalT(t) : NaN);
          zsY.push(r.zs.evalT ? r.zs.evalT(t) : NaN);
        }
        const sim = ODE.simulateODE(p.a, (t) => TR.fNumeric(p.rhsItems, t), ics, 0, tmax, 1200);
        numT = sim.t; numY = sim.y;
        verify = [0.25, 0.5, 1, 2, 4].map((f) => f * tmax / 4).filter((t) => t <= tmax);
      } else {
        const maxMod = r.poles.reduce((m, q) => Math.max(m, Math.hypot(q.re, q.im)), 0);
        N = Math.min(Math.max(Math.round(maxMod > 1 ? 16 : 6 / (1 - Math.min(maxMod, 0.999))), 20), 40);
        tArr = []; fullY = []; ziY = []; zsY = [];
        for (let n = 0; n <= N; n++) { tArr.push(n); fullY.push(r.full.evalN(n)); ziY.push(r.zi.evalN(n)); zsY.push(r.zs.evalN(n)); }
        numT = tArr.slice();
        numY = ODE.recurDiff(p.a, ics, (m) => TR.xNumeric(p.rhsItems, m), N);
        verify = [1, 2, 3, 5, 8, 13].filter((n) => n <= N);
      }
      const rows = verify.map((t) => {
        const i = isOde ? Math.round(t / tmax * 600) : t;
        const ana = isOde ? r.full.evalT(t) : r.full.evalN(t);
        const num = numY[Math.min(i, numY.length - 1)];
        const err = Math.abs(num - ana) / Math.max(1, Math.abs(ana));
        return { t, ana, num, err };
      });
      tblWrap.innerHTML = '<table class="tbl" style="max-width:560px"><tr><th>' + (isOde ? 't' : 'n') + '</th><th>解析</th><th>数值</th><th>相对误差</th></tr>' +
        rows.map((x) => `<tr><td>${U.fmt(x.t, 3)}</td><td>${U.fmt(x.ana, 6)}</td><td>${U.fmt(x.num, 6)}</td><td style="color:${x.err < 1e-6 ? 'var(--accent-2)' : 'var(--warn)'}">${x.err < 1e-12 ? '&lt;1e-12' : U.fmt(x.err, 3)}</td></tr>`).join('') + '</table>' +
        '<p class="hint">数值通道与解析式相互独立（' + (isOde ? 'RK4 状态空间仿真' : '差分方程直接递推') + '），误差应接近机器精度——解算无误的硬证据。</p>';

      const cvEl = wrap.querySelector('#eq-cv');
      if (!plot) { plot = new FX.Plot(cvEl); plot.onDraw = drawResp; }
      plotData = { tArr, fullY, ziY, zsY, numT, numY, isOde };
      drawResp();

      function drawResp() {
        const d = plotData; if (!d) return;
        let lo = Infinity, hi = -Infinity;
        for (const arr of [d.fullY, d.ziY, d.zsY, d.numY]) for (const v of arr) if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        if (!isFinite(lo)) { lo = -1; hi = 1; }
        if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
        const pad = (hi - lo) * 0.12;
        plot.setRange(d.tArr[0], d.tArr[d.tArr.length - 1], lo - pad, hi + pad);
        plot.clear(); plot.grid(); plot.axis(true);
        plot.clip();
        plot.line(d.tArr, d.numY, { color: cv('--cv-tick'), width: 1.2 });
        plot.line(d.tArr, d.ziY, { color: cv('--cv-line3'), width: 1.6 });
        plot.line(d.tArr, d.zsY, { color: cv('--cv-pink'), width: 1.6 });
        plot.line(d.tArr, d.fullY, { color: cv('--cv-line1'), width: 2.2 });
        if (d.isOde) {
          const stride = Math.max(1, Math.floor(d.numT.length / 60));
          const xs = [], ys = [];
          for (let i = 0; i < d.numT.length; i += stride) { xs.push(d.numT[i]); ys.push(d.numY[i]); }
          plot.dots(xs, ys, { color: cv('--cv-warn'), r: 2.2 });
        } else {
          plot.dots(d.numT, d.numY, { color: cv('--cv-warn'), r: 2.6 });
        }
        plot.unclip();
        plot.label('全解 · 零输入(绿) · 零状态(粉) · 数值(点)', plot.margin.l + 8, plot.margin.t + 14, { color: cv('--cv-label'), size: 11 });
        plot.crosshair((x) => (d.isOde ? 't=' : 'n=') + U.fmt(x, 3), (y) => 'y=' + U.fmt(y, 4));
      }
    }

    /* ---------- 数据序列统一绘图 ----------
     * spec = { arr | series, t(两列时间轴), dt(频谱采样周期), Fs, title, stats:[[k,v]], notes:[html], marker:{i} }
     * 主图：多序列杆/线/点叠加；副图：幅度谱（seq 支持谱窗与 dB 刻度）；
     * seq 且非矩形窗 → 折叠「截断 vs 加窗」对比；勾选相位谱 → 折叠相位图。 */
    function drawData(spec) {
      out.innerHTML = '';
      const series = spec.series || [{ arr: spec.arr, stem: true, color: '--cv-line1', width: 2, dots: true, dotColor: '--cv-warn', dotR: 2.6 }];
      const main = series[0];
      const values = main.arr;
      const n = values.length;
      const xs = spec.t || values.map((_, i) => i);
      const isSeq = dataOp === 'seq';
      const winArr = isSeq && dataWin !== 'rect' ? DSP.window(dataWin, n) : null;
      const seqY = winArr ? values.map((v, i) => v * winArr[i]) : values;
      const dtv = spec.dt || 1;
      const sp = DSP.spectrum(seqY, dtv);
      const toDb = (m) => 20 * Math.log10(Math.max(m, 1e-12));
      const fUnit = (spec.t || spec.Fs) ? ' Hz' : '×fs';

      let energy = 0, mean = 0;
      for (const v of values) { energy += v * v; mean += v; }
      mean /= Math.max(1, n);
      const stats = U.el('div', { class: 'statbar' });
      stats.innerHTML = `<div class="stat"><span class="k">点数</span><span class="v">${n}</span></div>` +
        `<div class="stat"><span class="k">均值</span><span class="v">${U.fmt(mean, 4)}</span></div>` +
        `<div class="stat"><span class="k">能量 Σx²</span><span class="v">${U.fmt(energy, 4)}</span></div>` +
        (spec.Fs ? `<div class="stat"><span class="k">采样率 Fs</span><span class="v">${U.fmt(spec.Fs, 4)} Hz</span></div>` : '') +
        (spec.stats || []).map((s) => `<div class="stat"><span class="k">${s[0]}</span><span class="v">${s[1]}</span></div>`).join('');
      out.append(stats);
      for (const nt of spec.notes || []) out.append(U.el('p', { class: 'hint', html: nt }));

      const wrap = U.el('div', { class: 'pane' });
      const winTag = winArr ? '（' + WIN_NAMES[dataWin] + '窗）' : '';
      wrap.innerHTML = `<h3 style="margin-top:0">${spec.title || (spec.t ? '序列 x(t) 与幅度谱 |X(f)|' : '序列 x[n] 与幅度谱 |X(f)|')}${winTag}${dataDb ? ' · dB' : ''}</h3>` +
        '<div class="canvas-wrap" style="height:230px"><canvas class="plot" id="eq-cv"></canvas></div>' +
        '<div class="canvas-wrap" style="height:170px;margin-top:8px"><canvas class="plot" id="eq-spec"></canvas></div>';
      out.append(wrap);
      let cmpFold = null, phFold = null;
      if (isSeq && winArr) {
        cmpFold = U.el('details', { class: 'pane plot-fold', html: '<summary>截断 vs 加窗 频谱对比</summary><div class="canvas-wrap" style="height:160px"><canvas class="plot" id="eq-speccmp"></canvas></div>' });
        out.append(cmpFold);
      }
      if (isSeq && dataPh) {
        phFold = U.el('details', { class: 'pane plot-fold', html: '<summary>相位谱 ∠X(f)</summary><div class="canvas-wrap" style="height:160px"><canvas class="plot" id="eq-ph"></canvas></div>' });
        out.append(phFold);
      }

      let p1 = null, p2 = null, p3 = null, p4 = null;
      const drawAll = () => {
        // 主图：杆 / 线 / 点多序列叠加
        let lo = Infinity, hi = -Infinity;
        for (const s of series) for (const v of s.arr) if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        if (!isFinite(lo)) { lo = -1; hi = 1; }
        if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
        p1.setRange(xs[0], xs[xs.length - 1], lo - (hi - lo) * 0.12, hi + (hi - lo) * 0.12);
        p1.clear(); p1.grid(); p1.axis(true);
        p1.clip();
        for (const s of series) {
          if (s.stem) for (let i = 0; i < s.arr.length; i++) p1.line([xs[i], xs[i]], [Math.min(0, lo), s.arr[i]], { color: cv(s.color), width: s.width || 2 });
          if (s.line) p1.line(xs, s.arr, { color: cv(s.color), width: s.width || 1.2 });
        }
        p1.unclip();
        for (const s of series) {
          if (!s.dots) continue;
          const stride = Math.max(1, Math.floor(s.arr.length / 240));
          const dxs = [], dys = [];
          for (let i = 0; i < s.arr.length; i += stride) { dxs.push(xs[i]); dys.push(s.arr[i]); }
          p1.dots(dxs, dys, { color: cv(s.dotColor || s.color), r: s.dotR || 2.2 });
        }
        if (spec.marker && spec.marker.i >= 0 && spec.marker.i < n) p1.dots([xs[spec.marker.i]], [values[spec.marker.i]], { color: cv('--cv-warn'), r: 4.5 });
        p1.crosshair((x) => (spec.t ? 't=' + U.fmt(x, 3) : 'n=' + Math.round(x)), (y) => 'y=' + U.fmt(y, 4));

        // 幅度谱：dB 刻度可选
        let mmax = 1e-12;
        for (const v of sp.mag) if (v > mmax) mmax = v;
        p2.clear(); p2.grid(); p2.axis(true);
        if (dataDb) {
          let dlo = Infinity, dhi = -Infinity;
          for (const v of sp.mag) { const db = toDb(v); dlo = Math.min(dlo, db); dhi = Math.max(dhi, db); }
          dlo = Math.max(dlo, dhi - 60);
          p2.setRange(0, sp.f[sp.f.length - 1], dlo - 2, dhi + 2);
          p2.clip(); p2.line(sp.f, sp.mag.map(toDb), { color: cv('--cv-line3'), width: 2 }); p2.unclip();
          p2.crosshair((f) => 'f=' + U.fmt(f, 3) + fUnit, (y) => '|X|=' + U.fmt(y, 1) + ' dB');
        } else {
          p2.setRange(0, sp.f[sp.f.length - 1], 0, mmax * 1.08);
          p2.clip(); p2.line(sp.f, sp.mag, { color: cv('--cv-line3'), width: 2, fill: cv('--cv-fill-purple') }); p2.unclip();
          p2.crosshair((f) => 'f=' + U.fmt(f, 3) + fUnit, (y) => '|X|=' + U.fmt(y, 4));
        }
        if (p3) drawCmp();
        if (p4) drawPh();
      };

      // 截断 vs 加窗对比（各自归一化到峰值，看主瓣展宽与旁瓣抑制）
      function drawCmp() {
        const sp0 = DSP.spectrum(values, dtv);
        const norm = (s) => { let m = 1e-12; for (const v of s.mag) if (v > m) m = v; return s.mag.map((v) => v / m); };
        p3.setRange(0, sp.f[sp.f.length - 1], 0, 1.12);
        p3.clear(); p3.grid(); p3.axis(true);
        p3.clip();
        p3.line(sp0.f, norm(sp0), { color: cv('--cv-tick'), width: 1.2 });
        p3.line(sp.f, norm(sp), { color: cv('--cv-line1'), width: 2 });
        p3.unclip();
        p3.label('截断（矩形）', p3.margin.l + 8, p3.margin.t + 13, { color: cv('--cv-tick'), size: 11 });
        p3.label(WIN_NAMES[dataWin] + '窗', p3.margin.l + 110, p3.margin.t + 13, { color: cv('--cv-line1'), size: 11 });
        p3.crosshair((f) => 'f=' + U.fmt(f, 3) + fUnit, (y) => '|X|/max=' + U.fmt(y, 3));
      }

      // 相位谱（当前窗）
      function drawPh() {
        let plo = Infinity, phi = -Infinity;
        for (const v of sp.ph) if (isFinite(v)) { plo = Math.min(plo, v); phi = Math.max(phi, v); }
        if (!isFinite(plo)) { plo = -Math.PI; phi = Math.PI; }
        if (phi - plo < 0.4) { const mid = (plo + phi) / 2; plo = mid - 0.5; phi = mid + 0.5; }
        p4.setRange(0, sp.f[sp.f.length - 1], plo - 0.2, phi + 0.2);
        p4.clear(); p4.grid(); p4.axis(true);
        p4.line(sp.f, sp.ph, { color: cv('--cv-line2'), width: 2 });
        p4.crosshair((f) => 'f=' + U.fmt(f, 3) + fUnit, (y) => '∠X=' + U.fmt(y, 3) + ' rad');
      }

      p1 = new FX.Plot(wrap.querySelector('#eq-cv')); p1.onDraw = drawAll;
      p2 = new FX.Plot(wrap.querySelector('#eq-spec')); p2.onDraw = drawAll;
      if (cmpFold) { p3 = new FX.Plot(cmpFold.querySelector('#eq-speccmp')); p3.onDraw = drawAll; }
      if (phFold) { p4 = new FX.Plot(phFold.querySelector('#eq-ph')); p4.onDraw = drawAll; }
      drawAll();
    }

    // 模式切换：非阻塞确认条保护输入（当前输入 ≠ 该模式默认示例时），相等则静默切换
    function doSwitchEq(k, keepStr) {
      mode = k;
      Object.keys(icsState).forEach((key) => delete icsState[key]);
      modesRow.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.m === k));
      plot = null; plotData = null;
      clearTimeout(eqIcsTimer);
      box.querySelector('#eq-confirm').hidden = true;
      renderMode(keepStr);
    }
    function showEqConfirm(target, cur) {
      const bar = box.querySelector('#eq-confirm');
      bar.innerHTML = '';
      bar.append(U.el('span', {}, '切到「' + conf[target].label + '」：当前输入不是该模式示例，要保留吗？'));
      const keep = U.el('button', { class: 'chip' }, '保留并尝试解析');
      keep.addEventListener('click', () => doSwitchEq(target, cur));
      const reset = U.el('button', { class: 'chip' }, '重置为示例');
      reset.addEventListener('click', () => doSwitchEq(target, null));
      bar.append(keep, reset);
      bar.hidden = false;
    }
    Object.entries(conf).forEach(([k, c]) => {
      const chip = U.el('button', { class: 'chip' + (k === mode ? ' active' : ''), 'data-m': k }, c.label);
      chip.addEventListener('click', () => {
        if (k === mode) return;
        const cur = mode === 'data' ? '' : eqIn.get().trim();
        if (mode !== 'data' && cur && cur !== conf[mode].def) { showEqConfirm(k, cur); return; }
        doSwitchEq(k, null);
      });
      modesRow.append(chip);
    });
    renderMode();

    // 快照捕获 / 恢复（getState / applyState 回调；仅非默认状态才捕获）
    const icsList = () => Object.keys(icsState).sort((a, b) => a - b).map((i) => { const v = parseFloat(icsState[i]); return isFinite(v) ? v : 0; });
    eqSnap = () => {
      const eq = eqIn.get().slice(0, 2000);
      const ics = icsList();
      const isDefault = mode === 'ode' && (!eq || eq === conf[mode].def) && ics.every((v) => v === 0);
      return isDefault ? null : { mode, eq, ics };
    };
    eqRestore = (st) => {
      if (!st || typeof st !== 'object') return;
      const m = ['ode', 'dde', 'data'].includes(st.mode) ? st.mode : null;
      if (m && m !== mode) {
        const cur = mode === 'data' ? '' : eqIn.get().trim();
        if (cur && cur !== conf[mode].def) { showEqConfirm(m, cur); return; }   // 输入非默认：交由用户确认，不静默覆盖
        doSwitchEq(m, typeof st.eq === 'string' ? st.eq : null);
      } else if (m && typeof st.eq === 'string' && st.eq && st.eq !== eqIn.get()) {
        eqIn.set(st.eq); eqIn.apply();
      }
      if (m && m !== 'data' && Array.isArray(st.ics) && st.ics.length) {
        st.ics.forEach((v, i) => { if (i < 8 && isFinite(+v)) icsState[i] = String(+v); });
        const p = m === 'ode' ? ODE.parseODE(eqIn.get()) : ODE.parseDiffEq(eqIn.get());
        if (p && p.ok) {
          buildIcs(p.n, (mm) => m === 'ode' ? (mm === 0 ? 'y(0)' : 'y' + "'".repeat(mm) + '(0)') : 'y[' + mm + ']');
          solveEq();
        }
      }
    };
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
    rec.onresult = (e) => {
      let cur = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) voiceFinal += r[0].transcript; else cur += r[0].transcript; }
      const shown = (voiceFinal + cur).toString();
      outBox.innerHTML = `
        <div class="stat"><span class="k">识别文字</span><span class="v" style="color:var(--text);font-size:13px">${shown || '…'}</span></div>
        <div class="stat"><span class="k">映射表达式</span><span class="v" style="color:var(--accent-2)">${mapSpeech(shown) || '…'}</span></div>`;
    };
    rec.onend = () => { btn.dataset.on = '0'; btn.textContent = '🎤 开始录音'; };
    rec.onerror = (e) => { outBox.innerHTML = `<span class="hint" style="color:var(--danger)">识别出错：${e.error}</span>`; };
    btn.addEventListener('click', () => {
      if (btn.dataset.on === '0') { btn.dataset.on = '1'; btn.textContent = '⏹ 停止'; voiceFinal = ''; try { rec.start(); } catch (err) { } }
      else { rec.stop(); }
    });
    box.querySelector('#ex-voiceroute').addEventListener('click', () => {
      const expr = mapSpeech(voiceFinal);
      tab = 'expr'; switchTab();
      if (expr && exprInputRef) { exprInputRef.set(expr); exprInputRef.apply(); }
    });
  }
  // 中文数字串 → 阿拉伯数字（位权解析，支持十/百，≤999）：二十五→25、一百零五→105
  function cnNumToArabic(run) {
    const D = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
    let total = 0, cur = 0;
    for (const ch of run) {
      if (ch in D) cur = cur * 10 + D[ch];
      else if (ch === '十') { total += (cur || 1) * 10; cur = 0; }
      else if (ch === '百') { total += (cur || 1) * 100; cur = 0; }
    }
    return String(total + cur);
  }
  function mapSpeech(txt) {
    if (!txt) return '';
    let s = txt.replace(/[\s，。、;；]/g, '');
    // 中文数字先按位权整体转换（二十五→25；旧的逐词替换会把「二十五」拆成 20…5 复合数错误），再做词映射
    s = s.replace(/[零一二三四五六七八九十百]+/g, (m) => cnNumToArabic(m));
    // 长词优先，避免“左括号”被“括号”提前破坏
    const mp = [['左括号', '('], ['右括号', ')'], ['括号', ')'], ['乘以', '*'], ['除以', '/'], ['减去', '-'], ['加上', '+'], ['的平方', '^2'], ['乘', '*'], ['除', '/'], ['减', '-'], ['加', '+'], ['平方', '^2'], ['立方', '^3'], ['次方', '^'], ['派', 'pi'], ['负', '-'], ['的', '*']];
    for (const [a, b] of mp) { s = s.split(a).join(b); }
    return s;
  }

  /* ---------- 符号变换求解器：输入正确形式，直接查看变换结果 ---------- */
  const SYM_MODES = [
    ['lt', 'f(t) → F(s)'], ['il', 'F(s) → f(t)'], ['ft', 'f(t) → F(jω)'],
    ['s2z', 'F(s) → X(z)'], ['lz', 'x(n) → X(z)'], ['iz', 'X(z) → x(n)']
  ];
  const SYM_METHODS = [['imp', '冲激不变'], ['zoh', '零阶保持 ZOH'], ['tustin', '双线性 Tustin']];
  function renderSym() {
    const box = host.querySelector('#ex-sym');
    box.innerHTML = `
      <div class="pane" style="margin-bottom:16px">
        <h3>符号变换求解器</h3>
        <div class="row" id="sym-modes" style="margin-bottom:12px"></div>
        <div id="sym-mi"></div>
        <div class="row" id="sym-trow" style="margin-top:8px;display:none;align-items:center">
          <label class="chip">采样周期 T <input type="number" id="sym-t" value="1" min="0.05" step="0.1" style="width:76px;background:transparent;border:0;color:var(--accent);font-family:var(--mono)"></label>
        </div>
        <div id="sym-pad" style="margin-top:8px"></div>
        <div class="hint" id="sym-hint" style="margin-top:8px"></div>
        <div class="row" id="sym-method" style="margin-top:8px;display:none"></div>
        <div class="row" id="sym-ex" style="margin-top:10px"></div>
        <div class="confirm-bar" id="sym-confirm" hidden></div>
        <div class="dirty-hint" id="sym-dirty" hidden>已修改，按「求解」更新结果</div>
      </div>
      <div id="sym-out"><p class="hint">输入表达式后点击「求解」给出符号结果与数值验证；输入时徽标实时提示语法是否正确。</p></div>`;
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
        hint: '输入 s 域<b>真分式</b> F(s)，选择离散化方法（冲激不变 / 零阶保持 ZOH / 双线性 Tustin）给出离散域 X(z)、极点与稳定性。下方为<b>采样周期 T</b>，可改后重算。',
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
    let symMethod = 'imp';
    let lastSolved = '';
    const modeRow = box.querySelector('#sym-modes');
    const methodRow = box.querySelector('#sym-method');
    const tIn = box.querySelector('#sym-t');

    // 统一输入组件 MI：三态徽标（实时防抖校验）/ 符号键盘 / 历史 / 示例；
    // 求解仍走手动（性能：避免每键都跑 12000 点 Simpson 积分），徽标实时、结果按需
    const symIn = MI.exprInput(box.querySelector('#sym-mi'), {
      id: 'sym-in',
      placeholder: conf.lt.ph,
      parse: (str) => symParseCheck(str),
      debounce: 220,
      autoApply: false,
      historyKey: 'flt-sym-history',
      onApply: () => solve()
    });
    const goBtn = U.el('button', { class: 'btn primary', id: 'sym-go' }, '求解');
    goBtn.addEventListener('click', () => symIn.apply());
    symIn.bar.append(goBtn);
    // 已修改提示：输入与上次求解不一致时显示「按求解更新」；确认条随输入消失
    symIn.input.addEventListener('input', () => {
      box.querySelector('#sym-confirm').hidden = true;
      const cur = symIn.get().trim();
      setDirty(!!cur && cur !== lastSolved);
    });
    // s2z 离散化方法选择（仅 s2z 模式显示）
    SYM_METHODS.forEach(([k, label]) => {
      const c = U.el('button', { class: 'chip' + (k === symMethod ? ' active' : ''), 'data-mth': k }, label);
      c.addEventListener('click', () => {
        if (symMethod === k) return;
        symMethod = k;
        methodRow.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.mth === k));
        if (mode === 's2z' && lastSolved) solve();
      });
      methodRow.append(c);
    });

    function setDirty(v) { box.querySelector('#sym-dirty').hidden = !v; }

    // 统一校验源：MI 徽标与 solve 的 fail-fast 预检共用，错误消息同源
    function symParseCheck(str) {
      const s = String(str || '').trim();
      if (!s) return { verdict: 'ok', message: '' };
      if (mode === 'lt' || mode === 'ft') {
        const items = TR.parseTimeCombo(s);
        if (!items) return { verdict: 'err', message: '无法解析：请按项语法输入，如 3*exp(-2*t)*u(t) + sin(5*t)*u(t)' };
        return { verdict: 'ok', message: '识别 ' + items.length + ' 个时域项' };
      }
      if (mode === 'il' || mode === 's2z') {
        const t = FX_LIB.parseTF(s);
        if (!t || !t.den || !t.den[0]) return { verdict: 'err', message: '无法解析 F(s)。示例：1/(s^2+2*s+5)' };
        if (t.num.length > t.den.length) return { verdict: 'warn', message: '非真分式（分子阶次 > 分母阶次），无法求解' };
        return { verdict: 'ok', message: 'F(s) 真分式 · 分母 ' + (t.den.length - 1) + ' 阶' };
      }
      if (mode === 'lz') {
        const items = TR.parseZCombo(s);
        if (!items) return { verdict: 'err', message: '无法解析序列。示例：0.5^n*u(n) + n*u(n)，支持 cos(w*n)、sin(w*n)、delta(n)' };
        return { verdict: 'ok', message: '识别 ' + items.length + ' 个序列项' };
      }
      const t = FX_LIB.parseTF(s, 'z');
      if (!t || !t.den || !t.den[0]) return { verdict: 'err', message: '无法解析 X(z)。示例：z/(z^2-0.25)' };
      if (t.num.length > t.den.length) return { verdict: 'warn', message: '非真分式（分子阶次 > 分母阶次），无法求解' };
      return { verdict: 'ok', message: 'X(z) 真分式 · 分母 ' + (t.den.length - 1) + ' 阶' };
    }

    // 模式切换：非阻塞确认条保护输入（当前输入 ≠ 该模式默认示例时），相等则静默切换
    function switchMode(k, keepStr) {
      mode = k;
      modeRow.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.k === k));
      applyMode(keepStr);
    }
    function showSymConfirm(target, cur) {
      const bar = box.querySelector('#sym-confirm');
      bar.innerHTML = '';
      bar.append(U.el('span', {}, '切到「' + ((SYM_MODES.find((m) => m[0] === target) || [])[1] || target) + '」：当前输入不是该模式示例，要保留吗？'));
      const keep = U.el('button', { class: 'chip' }, '保留并尝试解析');
      keep.addEventListener('click', () => { bar.hidden = true; switchMode(target, cur); });
      const reset = U.el('button', { class: 'chip' }, '重置为示例');
      reset.addEventListener('click', () => { bar.hidden = true; switchMode(target, null); });
      bar.append(keep, reset);
      bar.hidden = false;
    }
    SYM_MODES.forEach(([k, label]) => {
      const c = U.el('button', { class: 'chip' + (k === mode ? ' active' : ''), 'data-k': k }, label);
      c.addEventListener('click', () => {
        if (k === mode) return;
        const cur = symIn.get().trim();
        if (cur && cur !== conf[mode].ph) { showSymConfirm(k, cur); return; }
        switchMode(k, null);
      });
      modeRow.append(c);
    });

    function applyMode(keepStr) {
      const cf = conf[mode];
      symIn.input.placeholder = cf.ph;
      symIn.set(keepStr != null ? keepStr : cf.ph);   // 切换模式时载入该模式示例（或保留的输入），避免跨模式语法残留
      box.querySelector('#sym-hint').innerHTML = cf.hint;
      box.querySelector('#sym-trow').style.display = mode === 's2z' ? '' : 'none';   // 仅 F(s)→X(z) 显示采样周期
      methodRow.style.display = mode === 's2z' ? '' : 'none';
      // 插入键盘随模式切换（MI.padRow 重建）
      const padHost = box.querySelector('#sym-pad');
      padHost.innerHTML = '';
      const varTok = (mode === 'lz' || mode === 'iz') ? 'n' : 't';
      const tokList = (mode === 'il' || mode === 's2z') ? ['s', '^2', '*', '/', '(', ')', '+', '-']
        : mode === 'iz' ? ['z', '^2', '*', '/', '(', ')', '+', '-']
        : [varTok, 'u(' + varTok + ')', 'sin(', 'cos(', 'exp(-0.5*' + varTok + ')*', '^2', 'pi', '*', '(', ')', '+', '-'];
      MI.padRow(padHost, tokList, () => symIn.input);
      const exRow = box.querySelector('#sym-ex');
      exRow.innerHTML = '';
      cf.ex.forEach(([expr, name]) => {
        const c = U.el('button', { class: 'chip', title: expr }, name);
        c.addEventListener('click', () => { symIn.set(expr); solve(); });
        exRow.append(c);
      });
      lastSolved = ''; setDirty(false);
      box.querySelector('#sym-confirm').hidden = true;
      solve();   // 载入示例即自动求解一次（与旧行为一致）
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
      symIn.badge('err', msg);   // 徽标与结果区同源：错误只派生一次，两处渲染
    }
    function verifyTable(rows) {
      const tbl = U.el('table', { class: 'tbl', style: 'margin-top:12px;max-width:560px' });
      tbl.innerHTML = '<tr><th>验证</th><th>数值</th><th>符号</th><th>误差</th></tr>' +
        rows.map((r) => `<tr><td>${r[0]}</td><td>${U.fmt(r[1], 6)}</td><td>${U.fmt(r[2], 6)}</td><td style="color:${r[3] < 1e-6 ? 'var(--accent-2)' : 'var(--warn)'}">${U.fmt(r[3], 2)}</td></tr>`).join('');
      return tbl;
    }

    // s2z / 多分支共用的格式化工具（原 s2z 分支局部定义，提升便于离散化方法内核输出复用）
    const fmt3 = (v) => { const x = Math.abs(v) < 5e-4 ? 0 : v; return x.toFixed(3); };
    const cpxTex = (z) => U.fmt(z.re, 3) + (Math.abs(z.im) > 1e-9 ? (z.im > 0 ? '+' : '-') + U.fmt(Math.abs(z.im), 3) + 'j' : '');
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

    function solve() {
      const str = symIn.get().trim();
      if (!str) return;
      const chk = symParseCheck(str);
      if (chk.verdict !== 'ok') { showErr(chk.message); return; }
      lastSolved = str; setDirty(false);
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
          // F(s) → X(z)：三种离散化方法（冲激不变 / 零阶保持 ZOH / 双线性 Tustin）。
          // 冲激不变：部分分式（TR 引擎）→ x(n)=f(nT) → D(z)=Π(z−λ)^m，N(z) 由 M 个圆周点的级数值解线性方程组
          const t = FX_LIB.parseTF(str);
          if (!t || !t.den || !t.den[0]) return showErr('无法解析 F(s)。示例：1/(s^2+2*s+5)');
          if (t.num.length > t.den.length) return showErr('需为真分式（分子阶次 ≤ 分母阶次）');
          const T = Math.max(0.05, +tIn.value || 1);
          const d0 = t.den[0];
          const nn = t.num.map((c) => c / d0), dd = t.den.map((c) => c / d0);
          if (symMethod !== 'imp') { solveS2ZMethod(symMethod, nn, dd, T); return; }
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
          // texPZ / fmt3 已提升到 renderSym 作用域（供离散化方法内核输出复用）
          const maxRe = pf.groups.reduce((m, g) => Math.max(m, g.p.re), -Infinity);
          const zRoc = Math.exp(maxRe * T);
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
    // s2z 的 ZOH / Tustin 方法路径（冲激不变主路径在 solve 内；内核 BLKSOLVE.zohDiscretize / tustin）
    function solveS2ZMethod(mth, num, den, T) {
      const r = mth === 'zoh' ? BLKSOLVE.zohDiscretize(num, den, T) : BLKSOLVE.tustin(num, den, T);
      const mLabel = mth === 'zoh' ? '零阶保持 ZOH' : '双线性变换 Tustin';
      if (!r || !r.ok || !r.d || !r.d[0]) { showErr(mLabel + ' 离散化失败：' + ((r && r.note) || '内核未返回有效结果')); return; }
      const d0 = r.d[0];
      const nn2 = r.n.map((c) => c / d0), dd2 = r.d.map((c) => c / d0);
      const poles = DSP.polyRoots(dd2);
      const maxMod = poles.reduce((m, p) => Math.max(m, Math.hypot(p.re, p.im)), 0);
      const stable = maxMod < 1 - 1e-9;
      const lines = [];
      lines.push(['X(z)=\\dfrac{' + texPZ(nn2) + '}{' + texPZ(dd2) + '}',
        '<b>' + mLabel + '</b>（T = ' + U.fmt(T, 2) + '）：' + (mth === 'zoh'
          ? 'X(z)=(1−z⁻¹)·Z[G(s)/s]，阶跃不变；保持器引入的 s=0 零点已消去。'
          : 's=(2/T)·(z−1)/(z+1) 代入化简，频率轴经预畸变映射（高频压缩）。')]);
      lines.push(['\\text{极点: } ' + (poles.map((p) => cpxTex(p)).join(',\\; ') || '—'),
        '离散稳定性看 |z|<1：' + (stable ? '<span style="color:var(--accent-2)">|z|max = ' + U.fmt(maxMod, 3) + ' → 稳定。</span>' : '<span style="color:var(--danger)">|z|max = ' + U.fmt(maxMod, 3) + ' → 不稳定 / 临界。</span>')]);
      showTex(lines);
      // 增益互证：H(z=1)（离散直流增益）vs F(s=0)（连续直流增益）
      try {
        const dcS = den[den.length - 1] !== 0 ? num[num.length - 1] / den[den.length - 1] : Infinity;
        const dcZ = DSP.cdiv(DSP.horner(nn2, { re: 1, im: 0 }), DSP.horner(dd2, { re: 1, im: 0 }));
        if (isFinite(dcS) && Math.abs(dcS) > 1e-9) {
          const card = out.firstChild;
          if (card) card.append(verifyTable([['直流增益 H(1) vs F(0)', dcS, dcZ.re, Math.abs(dcZ.re - dcS) / Math.abs(dcS)]]));
        }
      } catch (err) { /* 增益验证失败不影响主结果 */ }
    }

    // 快照捕获 / 恢复（getState / applyState 回调；完全默认状态不捕获，保持快照小巧）
    symSnap = () => {
      const input = symIn.get().slice(0, 2000);
      const isDefault = mode === 'lt' && symMethod === 'imp' && (!input || input === conf[mode].ph);
      return isDefault ? null : { mode, method: symMethod, input };
    };
    symRestore = (st) => {
      if (!st || typeof st !== 'object') return;
      const m = SYM_MODES.some((x) => x[0] === st.mode) ? st.mode : null;
      if (m && m !== mode) {
        const cur = symIn.get().trim();
        if (cur && cur !== conf[mode].ph) { showSymConfirm(m, cur); return; }   // 输入非默认：交由用户确认，不静默覆盖
        switchMode(m, null);
      }
      if (st.method && SYM_METHODS.some((x) => x[0] === st.method) && st.method !== symMethod) {
        symMethod = st.method;
        methodRow.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.mth === st.method));
      }
      if (typeof st.input === 'string' && st.input && st.input !== symIn.get()) symIn.set(st.input);
      solve();
    };
    // 采样周期 T：仅在已有求解结果时防抖重算，避免初始渲染干扰
    tIn.addEventListener('input', () => { clearTimeout(symTTimer); symTTimer = setTimeout(() => { if (mode === 's2z' && lastSolved) solve(); }, 300); });
    applyMode(null);
  }

  function switchTab() {
    host.querySelector('#ex-expr').classList.toggle('hidden', tab !== 'expr');
    host.querySelector('#ex-sym').classList.toggle('hidden', tab !== 'sym');
    host.querySelector('#ex-eq').classList.toggle('hidden', tab !== 'eq');
    host.querySelector('#ex-draw').classList.toggle('hidden', tab !== 'draw');
    host.querySelector('#ex-voice').classList.toggle('hidden', tab !== 'voice');
    host.querySelectorAll('#ex-tabs .chip').forEach((x) => x.classList.toggle('active', x.dataset.k === tab));
    // 惰性渲染：仅首次进入可见方创建，避免 display:none 导致画布尺寸为 0
    if (tab === 'expr' && !rendered.expr) { renderExpr(); rendered.expr = true; }
    else if (tab === 'sym' && !rendered.sym) { renderSym(); rendered.sym = true; }
    else if (tab === 'eq' && !rendered.eq) { renderEq(); rendered.eq = true; }
    else if (tab === 'draw' && !rendered.draw) { renderDraw(); rendered.draw = true; }
    else if (tab === 'voice' && !rendered.voice) { renderVoice(); rendered.voice = true; }
    // 手绘动画：仅在当前页可见时运行，切走即停，避免后台空转
    if (dloop) {
      if (tab === 'draw' && epicy) { if (!loopRunning) { loopRunning = true; dloop.start(); } }
      else if (loopRunning) { loopRunning = false; dloop.stop(); }
    }
    // 惰性恢复：pendingState 中当前页的片段在页签首次渲染后消费
    restoreTab(tab);
  }

  function tabBar() {
    const tb = host.querySelector('#ex-tabs');
    tb.innerHTML = '';
    const mk = (k, l) => { const c = U.el('button', { class: 'chip' + (tab === k ? ' active' : ''), 'data-k': k }, l); c.addEventListener('click', () => { tab = k; switchTab(); }); tb.append(c); return c; };
    mk('expr', '表达式求解'); mk('sym', '符号变换'); mk('eq', '方程求解'); mk('draw', '手绘画圈'); mk('voice', '语音输入');
  }

  // 工具：极点图（共享复平面组件，s 平面模式，静态展示：平移/缩放可用）
  let pzPlane = null, pzPolesNow = [], pzZerosNow = [];
  function pzPlot(cvEl, poles, zeros) {
    pzPolesNow = poles; pzZerosNow = zeros;
    if (!pzPlane || pzPlane.cv !== cvEl) {
      if (pzPlane) pzPlane.dispose();   // 旧画布已替换：先释放旧实例的全局监听
      // 新结果容器 → 新画布 → 新实例（构造即按新零极点适配视野）
      pzPlane = new FX.ComplexPlane(cvEl, {
        mode: 'jw',
        editable: false,
        getSpecs: () => ({ poles: pzPolesNow, zeros: pzZerosNow })
      });
    } else {
      pzPlane.redraw();
    }
  }

  tabBar();
  switchTab();

  /* ---------- 实验接入：状态捕获 / 回放 / 统一结果工具栏 ---------- */
  const capStr = (s) => { s = String(s == null ? '' : s); return s.length > 2000 ? s.slice(0, 2000) : s; };
  // 手绘轨迹压缩：抽稀至 ≤800 点并取 2 位小数（≤1600 数值，满足 PX 数组上限且体积可控）
  function compressPts(pp) {
    const step = Math.max(1, Math.ceil(pp.length / 800));
    const out = [];
    for (let i = 0; i < pp.length && out.length < 1600; i += step) {
      const x = Math.round(pp[i].x * 100) / 100, y = Math.round(pp[i].y * 100) / 100;
      if (isFinite(x) && isFinite(y)) out.push(x, y);
    }
    return out;
  }
  function getState() {
    const st = { tab, expr: exprInputRef ? capStr(exprInputRef.get()) : '' };
    if (rendered.sym && symSnap) { const ss = symSnap(); if (ss) st.sym = ss; }
    if (rendered.eq && eqSnap) { const es = eqSnap(); if (es) st.eq = es; }
    if (rendered.draw && drawPts.length > 2) st.draw = { pts: compressPts(drawPts) };
    if (rendered.voice && voiceFinal) st.voice = { text: capStr(voiceFinal) };
    return st;
  }
  function restoreDrawPts(d) {
    if (!d || !Array.isArray(d.pts) || d.pts.length < 4) return;
    const pp = [];
    for (let i = 0; i + 1 < d.pts.length; i += 2) {
      const x = +d.pts[i], y = +d.pts[i + 1];
      if (isFinite(x) && isFinite(y)) pp.push({ x, y });
    }
    if (pp.length > 2) { drawPts = pp; if (rendered.draw && drawReset) drawReset(); }
  }
  function restoreVoiceText(v) {
    if (!v || typeof v.text !== 'string' || !v.text) return;
    voiceFinal = v.text.slice(0, 2000);
    if (rendered.voice) {
      const outBox = host.querySelector('#ex-voice-text');
      if (!outBox) return;
      outBox.innerHTML = '';
      const mkStat = (k, val, color) => { const d = U.el('div', { class: 'stat' }); const kk = U.el('span', { class: 'k' }, k); const vv = U.el('span', { class: 'v', style: color }); vv.textContent = val; d.append(kk, vv); return d; };
      outBox.append(mkStat('识别文字', voiceFinal, 'color:var(--text);font-size:13px'), mkStat('映射表达式', mapSpeech(voiceFinal), 'color:var(--accent-2)'));
    }
  }
  // 按页签消费 pendingState 片段（惰性渲染页签在首次渲染时被 switchTab 钩子调用）
  function restoreTab(t) {
    if (!pendingState) return;
    if (t === 'expr') {
      if (typeof pendingState.expr === 'string' && pendingState.expr && exprInputRef) {
        exprInputRef.set(pendingState.expr); exprInputRef.apply();
      }
      delete pendingState.expr;
    } else if (t === 'sym' && pendingState.sym && symRestore) {
      symRestore(pendingState.sym); delete pendingState.sym;
    } else if (t === 'eq' && pendingState.eq && eqRestore) {
      eqRestore(pendingState.eq); delete pendingState.eq;
    } else if (t === 'draw' && pendingState.draw) {
      restoreDrawPts(pendingState.draw); delete pendingState.draw;
    } else if (t === 'voice' && pendingState.voice) {
      restoreVoiceText(pendingState.voice); delete pendingState.voice;
    }
    const rest = Object.keys(pendingState).filter((k) => ['expr', 'sym', 'eq', 'draw', 'voice'].includes(k));
    if (!rest.length) pendingState = null;
  }
  function applyState(s) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return;
    pendingState = Object.assign({}, s);   // 浅拷贝；旧快照缺新字段时各片 undefined 被自然跳过
    if (s.tab && ['expr', 'sym', 'eq', 'draw', 'voice'].includes(s.tab)) tab = s.tab;
    switchTab();   // 含惰性渲染与 restoreTab 消费钩子
  }
  RTB.attach(host.querySelector('#ex-rtb'), {
    module: 'explore',
    getState, applyState,
    canvases: () => U.$$('canvas', host)
  });

  return { title: '交互求解', api: { dispose, onTheme: () => {
    // 只重绘当前可见页签；时域与传函结果互斥，调用仍然有效的那一个，避免旧闭包访问已移除的 DOM
    if (tab === 'expr') { if (exprRedraw) exprRedraw(); else if (tfRedraw) tfRedraw(); }
    else if (tab === 'draw' && drawReset) drawReset();
  }, getState, applyState } };
  function dispose() {
    clearTimeout(eqIcsTimer); clearTimeout(symTTimer);
    if (dloop && loopRunning) { loopRunning = false; dloop.stop(); }
    if (speechRec) { try { speechRec.onend = null; speechRec.stop(); } catch (e) {} speechRec = null; }
    if (winUpHandler) { window.removeEventListener('pointerup', winUpHandler); winUpHandler = null; }
    if (drawRO) { drawRO.disconnect(); drawRO = null; }
    if (pzPlane) { pzPlane.dispose(); pzPlane = null; }
    exprRedraw = tfRedraw = drawReset = null;
  }
});
