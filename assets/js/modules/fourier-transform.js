/* ============================================================
 * fourier-transform.js — 傅立叶变换
 *   · 时域 ↔ 频域联动（悬停读数），常见函数自动求解
 *   · 卷积定理：翻转-平移-重叠面积 动画 + 频域相乘验证
 * ============================================================ */
App.register('ft', (host) => {
  const cv = FX.cvCol;
  let tab = 'map';
  const rendered = { map: false, conv: false };
  let convRaf = null;

  host.innerHTML = `
    <div class="module">
      <div class="tabs row" style="margin-bottom:14px"></div>
      <div id="ft-tab-map"></div>
      <div id="ft-tab-conv" class="hidden"></div>
    </div>`;

  function tabBar() {
    const tabs = host.querySelector('.tabs');
    tabs.innerHTML = '';
    const mk = (id, label) => U.el('button', { class: 'chip' + (tab === id ? ' active' : ''), 'data-tab': id }, label);
    tabs.append(mk('map', '时域 ↔ 频域 (常见函数)'), mk('conv', '卷积定理'));
    tabs.addEventListener('click', (e) => {
      const t = e.target.closest('.chip'); if (!t) return;
      tab = t.dataset.tab;
      host.querySelector('#ft-tab-map').classList.toggle('hidden', tab !== 'map');
      host.querySelector('#ft-tab-conv').classList.toggle('hidden', tab !== 'conv');
      tabs.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.tab === tab));
      // 惰性渲染：画布必须可见才有尺寸
      if (tab === 'conv' && !rendered.conv) { renderConv(); rendered.conv = true; }
      else if (tab === 'map' && !rendered.map) { renderMap(); rendered.map = true; }
      else if (tab === 'conv') redrawConv();
      else if (tab === 'map') redrawMap();
    });
  }

  /* ================= 子模块 A：时域 ↔ 频域 ================= */
  let mapCtx = null; // { plots, data, hover }
  function renderMap() {
    const box = host.querySelector('#ft-tab-map');
    box.innerHTML = `
      <div class="layout">
        <div class="pane">
          <h3>常见函数库</h3>
          <div class="row" id="ft-signals" style="margin-bottom:12px"></div>
          <div class="ctrl"><label>信号参数</label><div id="ft-params"></div></div>
          <div class="formula-center" id="ft-tex"></div>
          <div class="hint" id="ft-note"></div>
        </div>
        <div class="pane">
          <h3>时域 <code>x(t)</code> <small style="color:var(--text-faint);text-transform:none">悬停读数</small></h3>
          <div class="canvas-wrap" style="height:150px"><canvas class="plot" id="ft-time"></canvas></div>
          <h3 style="margin-top:14px">频域 <code>|X(f)|</code>（幅度）</h3>
          <div class="canvas-wrap" style="height:150px"><canvas class="plot" id="ft-mag"></canvas></div>
          <details class="plot-fold">
            <summary>相位 ∠X(f)</summary>
            <div class="canvas-wrap" style="height:120px"><canvas class="plot" id="ft-phase"></canvas></div>
          </details>
          <div class="statbar" id="ft-stats"></div>
        </div>
      </div>`;
    const sigRow = host.querySelector('#ft-signals');
    let active = 'rect';
    FX_LIB.ftSignals.forEach((s) => {
      const c = U.el('button', { class: 'chip' + (s.id === active ? ' active' : ''), 'data-id': s.id }, s.name);
      c.addEventListener('click', () => { active = s.id; sigRow.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.id === s.id)); buildParams(); recompute(); });
      sigRow.append(c);
    });
    const paramsBox = host.querySelector('#ft-params');
    let params = [];
    function buildParams() {
      const sig = FX_LIB.ftSignals.find((s) => s.id === active);
      params = sig.params();
      paramsBox.innerHTML = '';
      params.forEach((p) => {
        const wrap = U.el('div', { class: 'ctrl' });
        const lab = U.el('label', { html: p.label + ' <span class="val"></span>' });
        const inp = U.el('input', { type: 'range', min: p.min, max: p.max, step: p.step || 0.01, value: p.v, 'data-k': p.k });
        inp.addEventListener('input', () => { p.v = +inp.value; lab.querySelector('.val').textContent = p.fmt ? p.fmt(+inp.value) : U.fmt(+inp.value); recompute(); });
        lab.querySelector('.val').textContent = p.fmt ? p.fmt(p.v) : U.fmt(p.v);
        wrap.append(lab, inp);
        paramsBox.append(wrap);
      });
      host.querySelector('#ft-tex').innerHTML = '';
      FX.span(sig.tex, host.querySelector('#ft-tex'));
      host.querySelector('#ft-note').innerHTML = '';
      host.querySelector('#ft-note').append(FX.span(sig.ft), document.createElement('br'), FX.span(sig.note));
    }
    function paramVal(k) { const p = params.find((x) => x.k === k); return p ? p.v : 0; }

    mapCtx = { plots: {}, data: null };
    const N = 4096;
    function recompute() {
      const sig = FX_LIB.ftSignals.find((s) => s.id === active);
      const total = sig.t1 - sig.t0, dt = total / (N - 1);
      const tArr = [], xArr = [];
      const pset = { W: paramVal('W'), sig: paramVal('sig'), a: paramVal('a'), f0: paramVal('f0'), B: paramVal('B'), T: paramVal('T') };
      for (let i = 0; i < N; i++) { const t = sig.t0 + i * dt; tArr.push(t); xArr.push(sig.f(pset, t)); }
      mapCtx.data = { sig, tArr, xArr, sp: DSP.spectrum(xArr, dt) };
      // 数据变了：恢复自动范围
      Object.values(mapCtx.plots).forEach((p) => p.resetView());
      draw();
    }

    function draw() {
      const d = mapCtx.data; if (!d) return;
      const { tArr, xArr, sp } = d;
      // 时域
      let tp = mapCtx.plots.time;
      if (!tp) { tp = new FX.Plot(host.querySelector('#ft-time')); tp.onDraw = draw; mapCtx.plots.time = tp; }
      let ylo = -1.4, yhi = 1.4;
      for (const v of xArr) if (isFinite(v)) { ylo = Math.min(ylo, v); yhi = Math.max(yhi, v); }
      const pad = (yhi - ylo) * 0.15 || 1;
      tp.setRange(d.sig.t0, d.sig.t1, ylo - pad, yhi + pad);
      tp.clear(); tp.grid(null, null); tp.axis(true);
      tp.line(tArr, xArr, { color: cv('--cv-line1'), width: 2 });
      tp.crosshair((x) => 't=' + U.fmt(x, 4), (y, wx) => 'x(t)=' + U.fmt(interpAt(tArr, xArr, wx), 4));

      // 幅度
      let mp = mapCtx.plots.mag;
      if (!mp) { mp = new FX.Plot(host.querySelector('#ft-mag')); mp.onDraw = draw; mapCtx.plots.mag = mp; }
      const fmax = sp.f[sp.f.length - 1];
      let ymax = 1e-9; for (const m of sp.mag) if (m > ymax) ymax = m;
      mp.setRange(0, fmax, 0, ymax * 1.1);
      mp.clear(); mp.grid(null, null); mp.axis(true);
      mp.line(sp.f, sp.mag, { color: cv('--cv-line2'), width: 2, fill: cv('--cv-fill-green') });
      mp.crosshair((f) => 'f=' + U.fmt(f, 3) + ' Hz', (m, f) => '|X|=' + U.fmt(interpAt(sp.f, sp.mag, f), 4));

      // 相位
      let pp = mapCtx.plots.ph;
      if (!pp) { pp = new FX.Plot(host.querySelector('#ft-phase')); pp.onDraw = draw; mapCtx.plots.ph = pp; }
      let plo = Infinity, phi = -Infinity;
      for (const v of sp.ph) if (isFinite(v)) { plo = Math.min(plo, v); phi = Math.max(phi, v); }
      if (!isFinite(plo)) { plo = -Math.PI; phi = Math.PI; }
      if (phi - plo < 0.4) { const mid = (plo + phi) / 2; plo = mid - 0.5; phi = mid + 0.5; }
      pp.setRange(0, fmax, plo - 0.2, phi + 0.2);
      pp.clear(); pp.grid(null, null); pp.axis(true);
      pp.line(sp.f, sp.ph, { color: cv('--cv-line3'), width: 2 });
      if (pp.ymin <= Math.PI && pp.ymax >= Math.PI) pp.label('+π', pp.margin.l + 6, pp.sy(Math.PI), { color: cv('--cv-label'), size: 10 });
      if (pp.ymin <= -Math.PI && pp.ymax >= -Math.PI) pp.label('−π', pp.margin.l + 6, pp.sy(-Math.PI), { color: cv('--cv-label'), size: 10 });
      pp.crosshair((f) => 'f=' + U.fmt(f, 3) + ' Hz', (p2, f) => '∠X=' + U.fmt(interpAt(sp.f, sp.ph, f), 3));

      // 能量 / 峰值统计
      let peak = 0, peakF = 0;
      for (let i = 0; i < sp.f.length; i++) if (sp.mag[i] > peak) { peak = sp.mag[i]; peakF = sp.f[i]; }
      host.querySelector('#ft-stats').innerHTML = `
        <div class="stat"><span class="k">谱峰幅度</span><span class="v">${U.fmt(peak, 3)}</span></div>
        <div class="stat"><span class="k">谱峰位置</span><span class="v">${U.fmt(peakF, 3)} Hz</span></div>
        <div class="stat"><span class="k">频率分辨率</span><span class="v">${U.fmt(sp.f[1] - sp.f[0], 4)} Hz</span></div>`;
    }
    mapCtx.draw = draw;
    const interpAt = (arrX, arrY, x) => {
      if (!arrX.length) return 0;
      const i = U.clamp(Math.round((x - arrX[0]) / (arrX[1] - arrX[0])), 0, arrX.length - 1);
      return arrY[i];
    };

    buildParams();
    recompute();
    if (FX.enablePlotChrome) FX.enablePlotChrome(box);
  }
  function redrawMap() { if (mapCtx && mapCtx.draw) mapCtx.draw(); }

  /* ================= 子模块 B：卷积定理 ================= */
  let convCtx = null; // { data, animT, plots }
  function renderConv() {
    const box = host.querySelector('#ft-tab-conv');
    box.innerHTML = `
      <div class="layout">
        <div class="pane">
          <h3>卷积定理 · (f ∗ g)(t) ⟷ F(f)·G(f)</h3>
          <div class="ctrl"><label>f(t)：</label><div class="row" id="cv-f"></div></div>
          <div class="ctrl"><label>g(t)：</label><div class="row" id="cv-g"></div></div>
          <div class="ctrl"><label>卷积时刻 <b id="cv-t-label" style="font-family:var(--mono);color:var(--accent)"></b></label>
            <input type="range" id="cv-t" min="0" max="100" step="0.1" value="0"></div>
          <div class="ctrl row">
            <button class="btn primary" id="cv-play">▶ 播放卷积</button>
            <button class="btn" id="cv-reset">↺ 重置</button>
          </div>
          <div class="statbar" id="cv-check"></div>
          <div class="hint"><b>怎么读这张图：</b>下图第 1 幅中蓝线为 f(τ)；粉线是<b>翻转并平移</b>后的 g(t−τ)；
            阴影是乘积 f(τ)·g(t−τ)，它的面积就是当前时刻的卷积值 h(t)（第 2 幅上的亮点）。
            第 3 幅验证定理：数值卷积的频谱与 |F·G| 应完全重合。</div>
        </div>
        <div class="pane">
          <h3>滑动重叠 · f(τ) × g(t−τ)</h3>
          <div class="canvas-wrap" style="height:170px"><canvas class="plot" id="cv-fg"></canvas></div>
          <h3 style="margin-top:10px">卷积结果 h(t)（点 = 当前时刻）</h3>
          <div class="canvas-wrap" style="height:150px"><canvas class="plot" id="cv-h"></canvas></div>
          <details class="plot-fold">
            <summary>频域验证 · |FFT{f∗g}| vs |F·G|</summary>
            <div class="canvas-wrap" style="height:150px"><canvas class="plot" id="cv-freq"></canvas></div>
          </details>
        </div>
      </div>`;

    const kernels = {
      rect: { name: '矩形(宽1)', f: (t) => (Math.abs(t) < 0.5 ? 1 : 0), t0: -1.2, t1: 1.2 },
      gauss: { name: '高斯 e^(−t²)', f: (t) => Math.exp(-t * t), t0: -1.2, t1: 1.2 },
      decay: { name: '指数 e^(−2t)u(t)', f: (t) => (t >= 0 ? Math.exp(-2 * t) : 0), t0: -1, t1: 2 },
      sinc: { name: 'sinc(2t)', f: (t) => { const x = 2 * Math.PI * t; return Math.abs(x) < 1e-9 ? 1 : Math.sin(x) / x; }, t0: -1.2, t1: 1.2 },
      tri: { name: '三角', f: (t) => Math.max(0, 1 - Math.abs(t)), t0: -1.2, t1: 1.2 },
      rect2: { name: '矩形(宽0.4)', f: (t) => (Math.abs(t) < 0.2 ? 1 : 0), t0: -1.2, t1: 1.2 }
    };
    convCtx = { fid: 'rect', gid: 'gauss', animT: 0, playing: false, data: null, plots: {} };

    function chipRow(el, cur, cb) {
      el.innerHTML = '';
      Object.keys(kernels).forEach((k) => {
        const c = U.el('button', { class: 'chip' + (k === cur ? ' active' : ''), 'data-k': k }, kernels[k].name);
        c.addEventListener('click', () => {
          if (el.id === 'cv-f') convCtx.fid = k; else convCtx.gid = k;
          chipRow(el, k, cb); cb();
        });
        el.append(c);
      });
    }
    chipRow(host.querySelector('#cv-f'), convCtx.fid, recompute);
    chipRow(host.querySelector('#cv-g'), convCtx.gid, recompute);

    const N = 1024;
    function recompute() {
      const fs = kernels[convCtx.fid], gs = kernels[convCtx.gid];
      const sample = (s) => { const dt = (s.t1 - s.t0) / (N - 1); const a = new Float64Array(N); for (let i = 0; i < N; i++) a[i] = s.f(s.t0 + i * dt); return { a, dt, t0: s.t0, t1: s.t1 }; };
      const F = sample(fs), G = sample(gs);
      const dt = F.dt;
      const h = DSP.conv(Array.from(F.a), Array.from(G.a)); // 长度 2N-1
      const hT0 = F.t0 + G.t0;
      const hArr = h.map((v) => v * dt); // 数值积分值
      const hT = h.map((_, i) => hT0 + i * dt);

      // 频域验证：|FFT(f∗g)| 与 |F·G|（离散卷积定理要求用未缩放的卷积数组）
      let L = 1; while (L < h.length) L <<= 1;
      const Hre = new Float64Array(L), Him = new Float64Array(L);
      for (let i = 0; i < h.length; i++) Hre[i] = h[i];
      DSP.fft(Hre, Him);
      const Fre = new Float64Array(L), Fim = new Float64Array(L), Gre = new Float64Array(L), Gim = new Float64Array(L);
      for (let i = 0; i < N; i++) { Fre[i] = F.a[i]; Gre[i] = G.a[i]; }
      DSP.fft(Fre, Fim); DSP.fft(Gre, Gim);
      const df = 1 / (L * dt);
      const fv = [], hSp = [], fgSp = [];
      for (let k = 0; k <= L / 2; k++) {
        fv.push(k * df);
        hSp.push(Math.hypot(Hre[k], Him[k]));
        fgSp.push(Math.hypot(Fre[k] * Gre[k] - Fim[k] * Gim[k], Fre[k] * Gim[k] + Fim[k] * Gre[k]));
      }
      // 定理误差（谱域相对误差）
      let err = 0, ref = 0;
      for (let k = 0; k < fv.length; k++) { err = Math.max(err, Math.abs(hSp[k] - fgSp[k])); ref = Math.max(ref, fgSp[k]); }

      convCtx.drawAll = drawConv;
      convCtx.data = { F, G, dt, hT, hArr, hT0, hT1: hT0 + (h.length - 1) * dt, fv, hSp, fgSp, specErr: err / (ref || 1) };
      Object.values(convCtx.plots).forEach((p) => p.resetView());
      drawConv();
    }

    // 当前 t 下 g(t−τ) 与乘积
    function interpConv(f) {
      const d = convCtx.data; if (!d) return 0;
      const i = U.clamp(Math.round(f / d.fv[1]), 0, d.fgSp.length - 1);
      return d.fgSp[i];
    }
    function sliceAt(t) {
      const { F, G } = convCtx.data;
      const M = 400;
      const tau = [], fv = [], gv = [], pv = [];
      const a = F.t0, b = F.t1;
      for (let i = 0; i <= M; i++) {
        const x = a + (i / M) * (b - a);
        const arg = t - x;                       // g 的自变量
        const gval = (arg >= G.t0 && arg <= G.t1) ? kernels[convCtx.gid].f(arg) : 0;
        tau.push(x);
        const fval = kernels[convCtx.fid].f(x);
        fv.push(fval); gv.push(gval); pv.push(fval * gval);
      }
      // 面积 ≈ Σ pv·dτ
      let area = 0;
      for (let i = 0; i < M; i++) area += (pv[i] + pv[i + 1]) / 2 * (tau[i + 1] - tau[i]);
      return { tau, fv, gv, pv, area };
    }

    function drawConv() {
      const c = convCtx.data; if (!c) return;
      const t = c.hT0 + (convCtx.animT / 100) * (c.hT1 - c.hT0);
      const sl = sliceAt(t);

      // --- 1. 滑动重叠图 ---
      let pfg = convCtx.plots.fg;
      if (!pfg) { pfg = new FX.Plot(host.querySelector('#cv-fg')); pfg.onDraw = drawConv; convCtx.plots.fg = pfg; }
      pfg.setRange(c.F.t0, c.F.t1, -1.5, 1.5);
      pfg.clear(); pfg.grid(0.5, 0.5); pfg.axis(true);
      // 乘积填充
      pfg.clip();
      const ctxg = pfg.ctx;
      ctxg.beginPath();
      for (let i = 0; i < sl.tau.length; i++) { const px = pfg.sx(sl.tau[i]), py = pfg.sy(sl.pv[i]); i ? ctxg.lineTo(px, py) : ctxg.moveTo(px, py); }
      for (let i = sl.tau.length - 1; i >= 0; i--) ctxg.lineTo(pfg.sx(sl.tau[i]), pfg.sy(0));
      ctxg.closePath();
      ctxg.fillStyle = cv('--cv-fill-warn'); ctxg.fill();
      pfg.unclip();
      pfg.line(sl.tau, sl.fv, { color: cv('--cv-line1'), width: 2 });
      pfg.line(sl.tau, sl.gv, { color: cv('--cv-pink'), width: 2 });
      pfg.label('f(τ)', pfg.sx(0) + 8, pfg.sy(0) - 8, { color: cv('--cv-line1'), size: 11 });
      pfg.label('g(t−τ)', pfg.margin.l + 8, pfg.margin.t + 12, { color: cv('--cv-pink'), size: 11 });
      pfg.label('重叠面积 = h(t) = ' + U.fmt(sl.area, 3), pfg.margin.l + 8, pfg.margin.t + 26, { color: cv('--cv-warn'), size: 11 });

      // --- 2. h(t) + 当前点 ---
      let ph = convCtx.plots.h;
      if (!ph) { ph = new FX.Plot(host.querySelector('#cv-h')); ph.onDraw = drawConv; convCtx.plots.h = ph; }
      let hmax = 1e-9; for (const v of c.hArr) if (Math.abs(v) > hmax) hmax = Math.abs(v);
      ph.setRange(c.hT0, c.hT1, -hmax * 1.15, hmax * 1.15);
      ph.clear(); ph.grid(); ph.axis(true);
      ph.line(c.hT, c.hArr, { color: cv('--cv-line2'), width: 2, fill: cv('--cv-fill-green') });
      ph.line([t, t], [ph.ymin, ph.ymax], { color: cv('--cv-tick'), width: 1 });
      const hNow = c.hArr[U.clamp(Math.round((t - c.hT0) / c.dt), 0, c.hArr.length - 1)];
      ph.ctx.fillStyle = cv('--cv-warn');
      ph.ctx.beginPath(); ph.ctx.arc(ph.sx(t), ph.sy(hNow), 5, 0, 7); ph.ctx.fill();
      ph.label('h(' + U.fmt(t, 2) + ')=' + U.fmt(hNow, 3), ph.sx(t) + 8, ph.sy(hNow) - 8, { color: cv('--cv-warn'), size: 11 });

      // --- 3. 频域验证 ---
      let pf = convCtx.plots.freq;
      if (!pf) { pf = new FX.Plot(host.querySelector('#cv-freq')); pf.onDraw = drawConv; convCtx.plots.freq = pf; }
      let fymax = 1e-9; for (let i = 0; i < c.fv.length; i++) fymax = Math.max(fymax, c.fgSp[i], c.hSp[i]);
      // 只显示有意义的频段
      let fShow = c.fv[c.fv.length - 1];
      for (let i = 0; i < c.fv.length; i++) if (c.fgSp[i] > fymax * 1e-3) fShow = c.fv[i];
      pf.setRange(0, fShow, 0, fymax * 1.1);
      pf.clear(); pf.grid(); pf.axis(true);
      pf.line(c.fv, c.fgSp, { color: cv('--cv-line3'), width: 2.5 });
      pf.line(c.fv, c.hSp, { color: cv('--cv-line2'), width: 1.5 });
      pf.crosshair((f) => 'f=' + U.fmt(f, 3) + ' Hz', (m, f) => '|F·G|=' + U.fmt(interpConv(f), 4));
      pf.label('|F·G| (紫) 与 |FFT{f∗g}| (绿) — 两条线应重合', pf.margin.l + 8, pf.margin.t + 12, { color: cv('--cv-label'), size: 11 });

      host.querySelector('#cv-t-label').textContent = 't = ' + U.fmt(t, 2);
      host.querySelector('#cv-check').innerHTML = `
        <div class="stat"><span class="k">当前 h(t)</span><span class="v">${U.fmt(hNow, 3)}</span></div>
        <div class="stat"><span class="k">面积法读数</span><span class="v">${U.fmt(sl.area, 3)}</span></div>
        <div class="stat"><span class="k">定理验证(谱)</span><span class="v" style="color:${convCtx.data.specErr < 1e-6 ? cv('--cv-line2') : cv('--cv-warn')}">相对误差 ${convCtx.data.specErr.toExponential(1)}</span></div>`;
    }

    const ct = host.querySelector('#cv-t');
    ct.addEventListener('input', () => { convCtx.animT = +ct.value; convCtx.playing = false; host.querySelector('#cv-play').textContent = '▶ 播放卷积'; if (convRaf) cancelAnimationFrame(convRaf); drawConv(); });
    host.querySelector('#cv-play').addEventListener('click', () => {
      const p = convCtx;
      p.playing = !p.playing;
      host.querySelector('#cv-play').textContent = p.playing ? '⏸ 暂停' : '▶ 播放卷积';
      if (p.playing) {
        let last = performance.now();
        const tick = (now) => {
          if (!p.playing || !document.body.contains(host)) return;
          p.animT = (p.animT + (now - last) * 0.022) % 100;   // ~4.5s 单程
          last = now;
          ct.value = p.animT;
          drawConv();
          convRaf = requestAnimationFrame(tick);
        };
        convRaf = requestAnimationFrame(tick);
      } else if (convRaf) { cancelAnimationFrame(convRaf); convRaf = null; }
    });
    host.querySelector('#cv-reset').addEventListener('click', () => { convCtx.animT = 0; ct.value = 0; drawConv(); });

    recompute();
    if (FX.enablePlotChrome) FX.enablePlotChrome(box);
  }
  function redrawConv() { if (convCtx) { convCtx.plots = {}; renderConv(); } }

  // 初始渲染
  tabBar();
  renderMap(); rendered.map = true;

  return { title: '傅立叶变换', api: { dispose, onTheme: () => { if (mapCtx && mapCtx.draw) mapCtx.draw(); if (convCtx && convCtx.data && convCtx.drawAll) convCtx.drawAll(); } } };
  function dispose() { if (convRaf) cancelAnimationFrame(convRaf); }
});
