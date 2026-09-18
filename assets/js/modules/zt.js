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
  let pzView = { cx: 0, cy: 0, sx: 1, sy: 1 };  // 绘制参数（命中检测用）

  host.innerHTML = `
    <div class="module layout">
      <div class="pane">
        <h3>离散传函 H(z)</h3>
        <div class="tf-frac">
          <input type="text" id="zt-num" value="1" placeholder="分子  如 1 或 z+0.5" spellcheck="false" aria-label="分子">
          <div class="tf-bar" title="分数线"></div>
          <input type="text" id="zt-den" value="z-0.5" placeholder="分母  如 z-0.5 或 z^2-0.25" spellcheck="false" aria-label="分母">
        </div>
        <div class="row kbd" id="zt-pad" style="margin-top:8px"></div>
        <div class="hint" id="zt-preview" style="margin:8px 0"></div>
        <div class="row" id="zt-examples" style="margin-bottom:10px"></div>
        <button class="btn primary" id="zt-apply">求解并绘图</button>
        <div class="formula-center" id="zt-tex" style="margin-top:10px"></div>
        <div class="statbar" id="zt-stats"></div>
        <div class="hint">多项式用<b>正幂 z</b> 书写（如 <code>z^2-0.25</code>），支持因式 <code>(z-0.5)*(z+0.5)</code>。
          稳定性：全部极点位于<b>单位圆内</b> ⇔ 因果系统稳定；因果 ROC：|z| &gt; 最大极点模。
          与连续域联系：<b>z = e<sup>sT</sup></b>，左半 s 平面 ↔ 单位圆内。</div>
      </div>
      <div class="pane">
        <h3>z 平面 · 零极点（可编辑）</h3>
        <div class="canvas-wrap" style="height:300px"><canvas id="zt-pz" style="width:100%;height:100%;touch-action:none"></canvas></div>
        <div class="row" id="zt-modes" style="margin-top:8px">
          <button class="chip active" data-m="pole">✕ 点击空白加极点</button>
          <button class="chip" data-m="zero">○ 点击空白加零点</button>
          <button class="chip" id="zt-pzreset" title="清空全部零极点">🗑 清空</button>
        </div>
        <div class="legend" style="margin-top:6px">
          <span><span class="sw" style="background:var(--danger)"></span>极点 ×</span>
          <span><span class="sw" style="background:var(--accent)"></span>零点 ○</span>
          <span><span class="sw" style="background:var(--accent-2)"></span>单位圆</span>
          <span><b>拖动</b>移动 · <b>双击</b>删除（共轭自动成对）· <b>滚轮</b>缩放 · <b>拖空白</b>平移</span>
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

  const examples = [
    ['1', 'z-0.5', '一阶低通'], ['1', 'z^2-0.25', '双极点'],
    ['z', 'z^2-1.6*z+0.9425', '谐振器'], ['z-0.5', 'z^2-0.25', '带零点'],
    ['1', 'z-1', '积分器(边界)'], ['0.2', 'z-0.8', '漏积分']
  ];
  const exRow = $('#zt-examples');
  examples.forEach(([n, d, name]) => {
    const c = U.el('button', { class: 'chip', title: 'H(z)=' + n + '/(' + d + ')' }, name);
    c.addEventListener('click', () => { $('#zt-num').value = n; $('#zt-den').value = d; fromInputs(); });
    exRow.append(c);
  });
  // 插入符号键盘
  const pad = $('#zt-pad');
  ['z', '^2', '^3', '*', '(', ')', '+', '-'].forEach((tok) => {
    const b = U.el('button', { class: 'chip pad-key', title: '插入 ' + tok }, tok === '^2' ? 'z²' : tok === '^3' ? 'z³' : tok);
    b.addEventListener('click', () => {
      const inp = document.activeElement && document.activeElement.id && document.activeElement.id.startsWith('zt-') ? document.activeElement : $('#zt-den');
      const s = inp.selectionStart == null ? inp.value.length : inp.selectionStart;
      const e2 = inp.selectionEnd == null ? s : inp.selectionEnd;
      inp.value = inp.value.slice(0, s) + tok + inp.value.slice(e2);
      inp.focus();
      try { inp.setSelectionRange(s + tok.length, s + tok.length); } catch (err) { }
      inp.dispatchEvent(new Event('input'));
    });
    pad.append(b);
  });

  /* ---------- 输入路径 ---------- */
  let pvTimer = null;
  function preview() {
    const nStr = $('#zt-num').value.trim(), dStr = $('#zt-den').value.trim();
    const box = $('#zt-preview'), frac = $('#zt-num').closest('.tf-frac');
    if (!nStr && !dStr) { box.innerHTML = ''; frac.classList.remove('invalid'); return; }
    const t = FX_LIB.parseTFFields(nStr || '1', dStr || '1', 'z');
    if (!t || !t.den || !t.den[0]) {
      frac.classList.add('invalid');
      box.innerHTML = '<span style="color:var(--danger)">✗ 解析失败：支持 z^2、0.5*z、(z-0.5)*(z+0.5) 等写法</span>';
      return;
    }
    frac.classList.remove('invalid');
    box.innerHTML = '<span style="color:var(--accent-2)">✓ </span>';
    box.append(FX.span('H(z)=\\dfrac{' + texPolyZ(t.num) + '}{' + texPolyZ(t.den) + '}'));
  }
  ['#zt-num', '#zt-den'].forEach((sel) => $(sel).addEventListener('input', () => { clearTimeout(pvTimer); pvTimer = setTimeout(fromInputs, 350); }));
  ['#zt-num', '#zt-den'].forEach((sel) => $(sel).addEventListener('keydown', (e) => { if (e.key === 'Enter') fromInputs(); }));
  $('#zt-apply').addEventListener('click', fromInputs);
  $('#zt-pzreset').addEventListener('click', () => { pzPoles = []; pzZeros = []; den = [1]; num = [1]; $('#zt-num').value = '1'; $('#zt-den').value = '1'; fromInputs(); });
  $('#zt-modes').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b || !b.dataset.m) return;
    editMode = b.dataset.m;
    $('#zt-modes').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === b));
  });

  function fromInputs() {
    const t = FX_LIB.parseTFFields($('#zt-num').value || '1', $('#zt-den').value || '1', 'z');
    if (!t || !t.den || !t.den[0] || t.num.length > t.den.length) { preview(); return; }
    const d0 = t.den[0];
    num = t.num.map((c) => c / d0); den = t.den.map((c) => c / d0);
    pzPoles = DSP.polyRoots(den);
    pzZeros = t.num.length > 1 ? DSP.polyRoots(num) : [];
    pzZoom = { cxw: 0, cyw: 0, k: 1 };   // 新 H(z)：视图复位适配新零极点
    renderAll();
  }
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
    $('#zt-num').value = plainZ(num);
    $('#zt-den').value = plainZ(den);
    preview();
    renderAll();
  }

  /* ---------- 主渲染 ---------- */
  function renderAll() {
    const poles = pzPoles, zeros = pzZeros;
    const maxAbs = poles.reduce((m, q) => Math.max(m, Math.hypot(q.re, q.im)), 0);
    const stable = poles.every((q) => Math.hypot(q.re, q.im) < 1 - 1e-9);
    const onCircle = poles.some((q) => Math.abs(Math.hypot(q.re, q.im) - 1) < 1e-6);
    $('#zt-tex').innerHTML = '';
    FX.katex('H(z)=\\dfrac{' + texPolyZ(num) + '}{' + texPolyZ(den) + '}', $('#zt-tex'), { displayMode: true });
    $('#zt-stats').innerHTML = `
      <div class="stat"><span class="k">极点</span><span class="v">${poles.map(fmtC).join(', ') || '—'}</span></div>
      <div class="stat"><span class="k">零点</span><span class="v">${zeros.map(fmtC).join(', ') || '—'}</span></div>
      <div class="stat"><span class="k">最大极点模</span><span class="v">${U.fmt(maxAbs, 3)}</span></div>
      <div class="stat"><span class="k">ROC(因果)</span><span class="v">${maxAbs > 0 ? '|z|>' + U.fmt(maxAbs, 3) : '全平面'}</span></div>
      <div class="stat"><span class="k">稳定性</span><span class="v" style="color:${stable ? cv('--cv-line2') : onCircle ? cv('--cv-warn') : cv('--cv-danger')}">${stable ? '稳定' : onCircle ? '临界(极点在圆上)' : '不稳定'}</span></div>`;
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

  /* ---------- z 平面（可交互：点击加 / 拖动移 / 双击删 / 滚轮缩放 / 拖空白平移） ---------- */
  let pzZoom = { cxw: 0, cyw: 0, k: 1 };   // 视图中心（z 域坐标）+ 缩放倍数
  function drawPZ() {
    const cvEl = $('#zt-pz');
    if (!cvEl || !cvEl.isConnected) return;
    const W = cvEl.clientWidth || 420, H = cvEl.clientHeight || 300;
    const dpr = window.devicePixelRatio || 1;
    const nw = Math.round(W * dpr), nh = Math.round(H * dpr);
    if (cvEl.width !== nw || cvEl.height !== nh) { cvEl.width = nw; cvEl.height = nh; }
    const g = cvEl.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = cv('--cv-bg'); g.fillRect(0, 0, W, H);
    const ml = 30, mr = 14, mt = 14, mb = 22, dw = W - ml - mr, dh = H - mt - mb;
    const cx = ml + dw / 2, cy = mt + dh / 2;
    let baseR = 1.3;
    for (const q of [...pzPoles, ...pzZeros]) baseR = Math.max(baseR, Math.hypot(q.re, q.im) + 0.35);
    const R = baseR / pzZoom.k;
    const sx = dw / (2 * R), sy = dh / (2 * R);
    pzView = { cx, cy, sx, sy };
    const PX = (r) => cx + (r - pzZoom.cxw) * sx, PY = (i) => cy - (i - pzZoom.cyw) * sy;
    const ox = PX(0), oy = PY(0);   // 世界原点像素位置（平移后不再等于画布中心）
    const rad = Math.min(sx, sy);
    g.fillStyle = pzPoles.every((q) => Math.hypot(q.re, q.im) < 1 - 1e-9) ? cv('--cv-stable-bg') : cv('--cv-bg');
    g.beginPath(); g.arc(ox, oy, rad, 0, Math.PI * 2); g.fill();
    g.strokeStyle = cv('--cv-grid'); g.lineWidth = 1;
    for (let i = 0; i <= 6; i++) { const x = ml + i * dw / 6; g.beginPath(); g.moveTo(x, mt); g.lineTo(x, mt + dh); g.stroke(); }
    for (let i = 0; i <= 4; i++) { const y = mt + i * dh / 4; g.beginPath(); g.moveTo(ml, y); g.lineTo(ml + dw, y); g.stroke(); }
    g.strokeStyle = cv('--cv-line2'); g.lineWidth = 1.6;
    g.beginPath(); g.arc(ox, oy, rad, 0, Math.PI * 2); g.stroke();
    // 坐标轴（随视图平移，裁剪在绘图区内）
    g.save();
    g.beginPath(); g.rect(ml, mt, dw, dh); g.clip();
    g.strokeStyle = cv('--cv-axis-hi'); g.beginPath(); g.moveTo(ox, mt); g.lineTo(ox, mt + dh); g.stroke();
    g.strokeStyle = cv('--cv-axis'); g.beginPath(); g.moveTo(ml, oy); g.lineTo(ml + dw, oy); g.stroke();
    g.restore();
    g.fillStyle = cv('--cv-tick'); g.font = '10px monospace'; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('Re(z)', ml + dw - 34, U.clamp(oy + 4, mt + 2, mt + dh - 14));
    g.fillText('Im', U.clamp(ox + 4, ml + 2, ml + dw - 16), mt + 2);
    if (pzZoom.k > 0.9) g.fillText('|z|=1', ox + rad - 34, oy - rad - 2);
    g.strokeStyle = cv('--cv-danger'); g.lineWidth = 2;
    for (const q of pzPoles) {
      const x = PX(q.re), y = PY(q.im);
      g.beginPath(); g.moveTo(x - 6, y - 6); g.lineTo(x + 6, y + 6); g.moveTo(x - 6, y + 6); g.lineTo(x + 6, y - 6); g.stroke();
    }
    g.strokeStyle = cv('--cv-line1'); g.lineWidth = 2;
    for (const q of pzZeros) { g.beginPath(); g.arc(PX(q.re), PY(q.im), 6, 0, Math.PI * 2); g.stroke(); }
  }

  /* ---------- z 平面交互：点击加 / 拖动移 / 双击删 ---------- */
  let drag = null;
  function hitTest(px, py) {
    const tol = 12;
    const test = (specs) => {
      for (let i = 0; i < specs.length; i++) {
        const x = pzView.cx + specs[i].re * pzView.sx, y = pzView.cy - specs[i].im * pzView.sy;
        if (Math.hypot(px - x, py - y) < tol) return i;
      }
      return -1;
    };
    let i = test(pzPoles); if (i >= 0) return { kind: 'pole', i };
    i = test(pzZeros); if (i >= 0) return { kind: 'zero', i };
    return null;
  }
  const toZ = (px, py) => ({ re: (px - pzView.cx) / pzView.sx + pzZoom.cxw, im: (pzView.cy - py) / pzView.sy + pzZoom.cyw });
  function moveSpec(kind, i, z) {
    const arr = kind === 'pole' ? pzPoles : pzZeros;
    const wasConj = Math.abs(arr[i].im) > 1e-9;
    arr[i] = { re: z.re, im: z.im };
    if (wasConj && Math.abs(z.im) > 1e-9) {
      // 同步共轭成员
      const j = arr.findIndex((q, k) => k !== i && Math.abs(q.re - z.re) < 1e-6 && Math.abs(q.im + arr[i].im) < 1e-6);
      if (j >= 0) arr[j] = { re: z.re, im: -z.im };
    }
    applySpecs();
  }
  const pzCv = $('#zt-pz');
  const pzPos = (e) => {
    const r = pzCv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (pzCv.clientWidth / r.width), y: (e.clientY - r.top) * (pzCv.clientHeight / r.height) };
  };
  let pzDrag = null;   // 空白处拖动 = 平移视图；未移动的抬起 = 点击添加
  pzCv.addEventListener('pointerdown', (e) => {
    const pos = pzPos(e);
    const hit = hitTest(pos.x, pos.y);
    if (hit) { drag = { ...hit }; try { pzCv.setPointerCapture(e.pointerId); } catch (err) { } return; }
    pzDrag = { x: e.clientX, y: e.clientY, moved: false, button: e.button };
    try { pzCv.setPointerCapture(e.pointerId); } catch (err) { }
  });
  pzCv.addEventListener('pointermove', (e) => {
    if (drag) {
      const pos = pzPos(e);
      moveSpec(drag.kind, drag.i, toZ(pos.x, pos.y));
      return;
    }
    if (!pzDrag) return;
    const dx = e.clientX - pzDrag.x, dy = e.clientY - pzDrag.y;
    if (!pzDrag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    pzDrag.moved = true;
    // 像素位移 → 世界位移（注意 im 轴向下为负）
    pzZoom.cxw -= dx / pzView.sx;
    pzZoom.cyw += dy / pzView.sy;
    pzDrag.x = e.clientX; pzDrag.y = e.clientY;
    drawPZ();
  });
  pzCv.addEventListener('pointerup', (e) => {
    if (pzDrag && !pzDrag.moved) {
      // 视为点击：按模式添加（贴近实轴自动吸附为实数根）
      const pos = pzPos(e);
      const z = toZ(pos.x, pos.y);
      if (Math.abs(z.im) < 0.04) z.im = 0;
      if (pzDrag.button === 2) {
        pzZeros.push({ ...z });
        if (Math.abs(z.im) > 1e-9) pzZeros.push({ re: z.re, im: -z.im });
        drag = { kind: 'zero', i: pzZeros.length - 1 };
      } else {
        if (editMode === 'pole') pzPoles.push({ ...z });
        else pzZeros.push({ ...z });
        if (Math.abs(z.im) > 1e-9) (editMode === 'pole' ? pzPoles : pzZeros).push({ re: z.re, im: -z.im });
        drag = { kind: editMode, i: (editMode === 'pole' ? pzPoles : pzZeros).length - 1 };
      }
      applySpecs();
    }
    pzDrag = null;
  });
  pzCv.addEventListener('contextmenu', (e) => e.preventDefault());
  // 滚轮缩放（以光标为中心）
  pzCv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const pos = pzPos(e);
    const w = toZ(pos.x, pos.y);
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const k2 = U.clamp(pzZoom.k * f, 0.5, 80);
    // 调整视图中心，使光标下的 z 点保持不动
    pzZoom.cxw = w.re - (pos.x - pzView.cx) / (pzView.sx * (k2 / pzZoom.k));
    pzZoom.cyw = w.im + (pos.y - pzView.cy) / (pzView.sy * (k2 / pzZoom.k));
    pzZoom.k = k2;
    drawPZ();
  }, { passive: false });
  pzCv.addEventListener('dblclick', (e) => {
    const pos = pzPos(e);
    const hit = hitTest(pos.x, pos.y);
    if (!hit) { pzZoom = { cxw: 0, cyw: 0, k: 1 }; drawPZ(); return; }   // 双击空白：复位视图
    const arr = hit.kind === 'pole' ? pzPoles : pzZeros;
    const q = arr[hit.i];
    // 删除时连同共轭成员
    for (let k = arr.length - 1; k >= 0; k--) {
      if (k === hit.i) continue;
      if (Math.abs(arr[k].re - q.re) < 1e-6 && Math.abs(arr[k].im + q.im) < 1e-6) arr.splice(k, 1);
    }
    arr.splice(hit.i, 1);
    applySpecs();
  });
  // 画布随容器尺寸变化自动重绘（桌面适配，避免拉伸变形）
  if (typeof ResizeObserver !== 'undefined' && pzCv.parentElement) {
    const pzRO = new ResizeObserver(() => { if (!pzCv.isConnected) { pzRO.disconnect(); return; } drawPZ(); });
    pzRO.observe(pzCv.parentElement);
  }

  /* ---------- 频率响应 ---------- */
  function drawFreq() {
    const NW = 600, w = [], mag = [], ph = [];
    for (let i = 0; i < NW; i++) {
      const wv = (i / (NW - 1)) * Math.PI;
      const z = { re: Math.cos(wv), im: Math.sin(wv) };
      const h = DSP.cdiv(DSP.horner(num, z), DSP.horner(den, z));
      w.push(wv); mag.push(U.toDb(Math.hypot(h.re, h.im))); ph.push((180 / Math.PI) * Math.atan2(h.im, h.re));
    }
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
      for (let k = 0; k <= n; k++) if (i - k >= 0) acc += b[k] * xArr[i - k];
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
    function drawRespAll() { drawStem('#zt-imp', h, cv('--cv-line1')); drawStem('#zt-step', s, cv('--cv-line2')); }
    drawRespAll();
  }

  fromInputs();

  return { title: 'Z 变换', api: { dispose, onTheme: () => { renderAll(); } } };
  function dispose() { }
});
