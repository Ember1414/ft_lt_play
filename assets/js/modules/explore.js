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
  const rendered = { expr: false, draw: false, voice: false };

  host.innerHTML = `
    <div class="module">
      <div class="row" id="ex-tabs" style="margin-bottom:14px"></div>
      <div id="ex-expr" class="hidden"></div>
      <div id="ex-draw" class="hidden"></div>
      <div id="ex-voice" class="hidden"></div>
    </div>`;

  /* ---------- 表达式求解 ---------- */
  function renderExpr() {
    const box = host.querySelector('#ex-expr');
    box.innerHTML = `
      <div class="pane" style="margin-bottom:16px">
        <div class="row">
          <input type="text" id="ex-input" placeholder="例：exp(-2*t)*sin(10*t)*u(t)   或   5/(s^2+0.5*s+1.25)" style="flex:1">
          <button class="btn primary" id="ex-go">求解</button>
        </div>
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
      c.addEventListener('click', () => { const inp = box.querySelector('#ex-input'); inp.value = expr; go(); });
      exRow.append(c);
    });

    const go = () => {
      const str = box.querySelector('#ex-input').value.trim();
      if (!str) return;
      // 's' 必须是独立变量（而非 sin/abs 的首字母）且含 '/' → 传递函数
      const bare = str.replace(/\s+/g, '');
      const isTF = /(^|[^a-zA-Z0-9_])s([^a-zA-Z0-9_]|$)/.test(bare) && bare.includes('/');
      const res = box.querySelector('#ex-result');
      if (isTF) renderTF(res, str); else renderTime(res, str);
    };
    box.querySelector('#ex-go').addEventListener('click', go);
    box.querySelector('#ex-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    box.querySelector('#ex-input').value = 'exp(-2*t)*sin(10*t)*u(t)';
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
      <div class="pane"><h3>时域 x(t)</h3><div style="height:170px"><canvas class="plot" id="ex-time"></canvas></div></div>
      <div class="pane"><h3>幅度谱 |X(f)|</h3><div style="height:170px"><canvas class="plot" id="ex-mag"></canvas></div></div>
      <div class="pane"><h3>相位谱 ∠X(f)</h3><div style="height:160px"><canvas class="plot" id="ex-ph"></canvas></div></div>
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
      pp.setRange(0, sp.f[sp.f.length - 1], -Math.PI, Math.PI); pp.clear(); pp.grid(); pp.axis(true);
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
      <div class="pane"><h3>波特图 幅度(dB)</h3><div style="height:150px"><canvas class="plot" id="ex-bmag"></canvas></div></div>
      <div class="pane"><h3>阶跃响应</h3><div style="height:150px"><canvas class="plot" id="ex-step"></canvas></div></div>
      <div class="pane"><h3>极点零点</h3><div style="height:220px"><canvas class="plot" id="ex-pz"></canvas></div></div>
      <div class="pane"><h3>关键指标</h3><div id="ex-metrics" class="statbar"></div></div>`;
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
    function clearInput() { g.fillStyle = cv('--cv-bg'); g.fillRect(0, 0, cvs.width, cvs.height); }
    drawReset = clearInput;
    clearInput();
    let drawing = false, pts = [];
    cvs.addEventListener('pointerdown', (e) => { drawing = true; pts = []; clearInput(); try { cvs.setPointerCapture(e.pointerId); } catch (err) {} e.preventDefault(); });
    window.addEventListener('pointerup', () => { drawing = false; });
    cvs.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const r = cvs.getBoundingClientRect();
      pts.push({ x: (e.clientX - r.left) * (cvs.width / r.width), y: (e.clientY - r.top) * (cvs.height / r.height) });
      g.strokeStyle = cv('--cv-text'); g.lineWidth = 2; g.lineJoin = 'round'; g.beginPath();
      for (let i = 0; i < pts.length; i++) { const c = pts[i]; i ? g.lineTo(c.x, c.y) : g.moveTo(c.x, c.y); }
      g.stroke();
    });
    box.querySelector('#ex-drcl').addEventListener('click', () => { pts = []; clearInput(); });

    let epicy = null;
    const dloop = U.loop(() => { if (epicy) drawFrame(); });
    let loopRunning = false;
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
      if (o.width !== Math.round(W * dpr)) { o.width = W * dpr; o.height = H * dpr; }
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

  function switchTab() {
    host.querySelector('#ex-expr').classList.toggle('hidden', tab !== 'expr');
    host.querySelector('#ex-draw').classList.toggle('hidden', tab !== 'draw');
    host.querySelector('#ex-voice').classList.toggle('hidden', tab !== 'voice');
    host.querySelectorAll('#ex-tabs .chip').forEach((x) => x.classList.toggle('active', x.dataset.k === tab));
    // 惰性渲染：仅首次进入可见方创建，避免 display:none 导致画布尺寸为 0
    if (tab === 'expr' && !rendered.expr) { renderExpr(); rendered.expr = true; }
    else if (tab === 'draw' && !rendered.draw) { renderDraw(); rendered.draw = true; }
    else if (tab === 'voice' && !rendered.voice) { renderVoice(); rendered.voice = true; }
  }

  function tabBar() {
    const tb = host.querySelector('#ex-tabs');
    tb.innerHTML = '';
    const mk = (k, l) => { const c = U.el('button', { class: 'chip' + (tab === k ? ' active' : ''), 'data-k': k }, l); c.addEventListener('click', () => { tab = k; switchTab(); }); tb.append(c); return c; };
    mk('expr', '表达式求解'); mk('draw', '手绘画圈'); mk('voice', '语音输入');
  }

  // 工具：极点图
  function pzPlot(cv, poles, zeros) {
    const W = cv.clientWidth || 400, H = cv.clientHeight || 220;
    const dpr = window.devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
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
  function dispose() { }
});
