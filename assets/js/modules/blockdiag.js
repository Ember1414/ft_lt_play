/* ============================================================
 * blk.js — 系统框图自由编辑器（自动控制原理）
 *   · 画布上的块可自由拖动，块尺寸固定（不会被视口拉伸放大）
 *   · 从块的输出端口拖到另一块的输入端口即可连线；形成回路时自动判为负反馈（可点击徽标切换 +/−）
 *   · 语义 = 信号流图：每块输入 = Σ(±来源)（无输入连线的链首自动接单位输入 R）；
 *     输出 = 各汇点之和。回路用「断边参数化 + 线性方程组」精确求解 T(s)
 *   · 输出：合成传函 T(s)、闭环极点/稳定性、阶跃响应
 * ============================================================ */
App.register('blk', (host) => {
  const cv = FX.cvCol;
  const polyMul = (a, b) => { const o = new Array(a.length + b.length - 1).fill(0); for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) o[i + j] += a[i] * b[j]; return o; };
  const polyAdd = (a, b) => { const n = Math.max(a.length, b.length), o = new Array(n).fill(0); for (let i = 0; i < a.length; i++) o[n - a.length + i] += a[i]; for (let i = 0; i < b.length; i++) o[n - b.length + i] += b[i]; return o; };
  // 有理函数（多项式对 N/D）
  const pTrim = (p) => { const a = p.slice(); while (a.length > 1 && Math.abs(a[0]) < 1e-9) a.shift(); return a; };
  function polyDivMod(A, B) {
    const a = pTrim(A), b = pTrim(B);
    if (a.length < b.length) return { q: [0], r: a };
    const q = new Array(a.length - b.length + 1).fill(0);
    const w = a.slice();
    for (let i = 0; i <= q.length - 1; i++) {
      const c = w[i] / b[0];
      q[i] = c;
      for (let j = 0; j < b.length; j++) w[i + j] -= c * b[j];
    }
    // 余数 = w[q.length .. end]（此前误用 b.length−1 切片，吞掉一个余数系数）
    return { q: pTrim(q), r: pTrim(w.slice(q.length)) };
  }
  // 多项式欧几里得 GCD（浮点，归一化后辗转相除）
  function polyGCD(A, B) {
    let a = pTrim(A), b = pTrim(B);
    if (a.length === 1 && Math.abs(a[0]) < 1e-9) return b;
    if (b.length === 1 && Math.abs(b[0]) < 1e-9) return a;
    for (let guard = 0; guard < 60; guard++) {
      if (Math.abs(a[0]) > 1e-12) a = a.map((c) => c / a[0]);
      const { r } = polyDivMod(a, b);
      a = b; b = pTrim(r);
      if (b.length === 1 && Math.abs(b[0]) < 1e-7) break;
      if (b.length === 0) break;
    }
    a = pTrim(a);
    if (Math.abs(a[0]) > 1e-12) a = a.map((c) => c / a[0]);
    return a;
  }
  // 分数约分：N/D 除以 GCD（并保持 D 首项为正）
  function freduce(f) {
    const n = pTrim(f.n), d = pTrim(f.d);
    if (Math.abs(d[0]) < 1e-12) return f;
    if (n.length === 1 && Math.abs(n[0]) < 1e-12) return { n: [0], d: [1] };
    const g = polyGCD(n, d);
    if (g.length === 0 || (g.length === 1 && Math.abs(g[0]) < 1e-9)) return { n, d };
    const nn = polyDivMod(n, g).q, dd = polyDivMod(d, g).q;
    if (dd[0] < 0) { nn.forEach((c, i) => nn[i] = -c); dd.forEach((c, i) => dd[i] = -c); }
    return { n: nn, d: dd };
  }
  const fracNorm = (f) => freduce({ n: f.n, d: f.d });
  const fMul = (a, b) => freduce({ n: polyMul(a.n, b.n), d: polyMul(a.d, b.d) });
  const fAdd = (a, b) => freduce({ n: polyAdd(polyMul(a.n, b.d), polyMul(b.n, a.d)), d: polyMul(a.d, b.d) });
  const fNeg = (a) => ({ n: a.n.map((c) => -c), d: a.d });
  const rConst = (c) => ({ n: [c], d: [1] });
  const R0 = rConst(0), R1 = rConst(1);

  const BW = 128, BH = 44;                  // 块固定尺寸（画布坐标）
  const VW = 960, VH = 460;                 // 画布固定设计尺寸（viewBox 不随内容缩放）
  let nodes = [];                           // {id, name, str, f, err, x, y}
  let edges = [];                           // {from, to, sign: 1|-1}
  let seq = 0;
  let drag = null;                          // {type:'block'|'wire', ...}
  const stepPlot = { plot: null };

  host.innerHTML = `
    <div class="module layout">
      <div class="pane">
        <h3>搭建系统结构</h3>
        <div class="row" style="margin-bottom:10px">
          <button class="btn primary" id="blk-add">＋ 新建块</button>
          <button class="btn" id="blk-demo">载入示例</button>
          <button class="btn" id="blk-clear">🗑 清空</button>
        </div>
        <div id="blk-list"></div>
        <div class="hint" style="margin-top:8px">
          <b>拖动块体</b>调整位置；从块的<b>右侧圆点</b>按住拖到另一块的<b>左侧圆点</b>松手即连线。
          连成回路时自动按<b>负反馈</b>（−）处理，点击线上的 <b>−/+ 徽标</b>可切换符号，点 <b>✕</b> 删除连线。
          点击块上的 <b>R 徽标</b>把该块设为输入求和点（可多个），<b>Y 徽标</b>设为输出点。
          没有输入连线的块自动接单位输入 R；整体输出 = 各汇点之和。
        </div>
      </div>
      <div class="pane">
        <h3>框图（自由编辑）</h3>
        <div class="canvas-wrap" id="blk-svgwrap" style="padding:6px"><svg id="blk-svg" style="width:100%;display:block" viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="xMidYMid meet"></svg></div>
        <h3 style="margin-top:12px">合成传函 T(s)</h3>
        <div class="formula-center" id="blk-tex"></div>
        <div class="statbar" id="blk-stats"></div>
      </div>
      <details class="pane full plot-fold">
        <summary>阶跃响应</summary>
        <div class="canvas-wrap" style="height:230px"><canvas class="plot" id="blk-step"></canvas></div>
      </details>
    </div>`;

  const $ = (s) => host.querySelector(s);
  const svg = () => $('#blk-svg');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /* ---------- 块管理 ---------- */
  function addBlock(str) {
    seq++;
    const t = FX_LIB.parseTF(str || '1/(s+1)');
    const node = {
      id: seq, name: 'G' + seq, str: str || '1/(s+1)', mark: null,
      f: t && t.den && t.den[0] ? fracNorm({ n: t.num, d: t.den }) : null,
      err: !(t && t.den && t.den[0] && t.num.length <= t.den.length),
      x: 46 + ((seq - 1) % 3) * 200, y: 40 + Math.floor((seq - 1) / 3) * 96
    };
    nodes.push(node);
    renderList();
    update();
    return node;
  }
  const nodeById = (id) => nodes.find((n) => n.id === id);
  const ports = (n) => ({ in: { x: n.x, y: n.y + BH / 2 }, out: { x: n.x + BW, y: n.y + BH / 2 } });

  function renderList() {
    const list = $('#blk-list');
    list.innerHTML = '';
    if (!nodes.length) {
      list.append(U.el('div', { class: 'hint', style: 'word-break:break-word' },
        '点击 <b>＋ 新建块</b> 添加传函块，然后在右侧画布上拖动排布、从端口拖线连接。'));
    }
    nodes.forEach((nd) => {
      const row = U.el('div', { class: 'row', style: 'align-items:center;margin-bottom:8px;gap:6px' });
      const name = U.el('span', { style: 'font-family:var(--mono);color:var(--accent);min-width:36px;flex:0 0 auto' }, nd.name);
      const inp = U.el('input', { type: 'text', value: nd.str, placeholder: '1/(s+1)', spellcheck: 'false', style: 'flex:1;min-width:80px' + (nd.err ? ';border-color:var(--danger)' : '') });
      inp.addEventListener('input', () => {
        nd.str = inp.value;
        clearTimeout(nd.timer);
        nd.timer = setTimeout(() => {
          const t = FX_LIB.parseTF(inp.value || '1');
          if (t && t.den && t.den[0] && t.num.length <= t.den.length) {
            nd.f = fracNorm({ n: t.num, d: t.den });
            nd.err = false;
            inp.style.borderColor = '';
          } else { nd.f = null; nd.err = true; inp.style.borderColor = 'var(--danger)'; }
          update();
        }, 300);
      });
      const del = U.el('button', { class: 'chip', title: '删除该块（连带其连线）', style: 'flex:0 0 auto' }, '✕');
      del.addEventListener('click', () => {
        nodes = nodes.filter((x) => x !== nd);
        edges = edges.filter((e) => e.from !== nd.id && e.to !== nd.id);
        renderList(); update();
      });
      row.append(name, inp, del);
      list.append(row);
    });
  }

  /* ---------- 信号流图求解 T(s)：数值状态空间法 ----------
     每个块做能控规范型实现；节点输入 u_i = Σ(±y_j)（链首加单位输入 R），
     代数回路经 (I−W)⁻¹ 一次求解；复合 A/B/C 经 LeVerrier 展开为 T(s)，
     最后按根匹配对消公共零极点。全程数值计算，稳定可靠。 */
  function createsCycle(from, to) {
    const stack = [to], seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (cur === from) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const e of edges) if (e.from === cur) stack.push(e.to);
    }
    return false;
  }
  const matI = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  const matMul = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((s, v, i) => s + v * B[i][j], 0)));
  const matVec = (A, v) => A.map((row) => row.reduce((s, x, i) => s + x * v[i], 0));
  const matInv = (M) => {
    const n = M.length;
    const a = M.map((r, i) => [...r, ...matI(n)[i]]);
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
      if (Math.abs(a[piv][col]) < 1e-12) return null;
      [a[col], a[piv]] = [a[piv], a[col]];
      const c = a[col][col];
      for (let j = 0; j < 2 * n; j++) a[col][j] /= c;
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = a[r][col];
        for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[col][j];
      }
    }
    return a.map((r) => r.slice(n));
  };
  function computeTransfer() {
    const act = nodes.filter((n) => !n.err && n.f);
    if (!act.length) return { ok: false, note: '没有有效块' };
    const idset = new Set(act.map((n) => n.id));
    const E = edges.filter((e) => idset.has(e.from) && idset.has(e.to) && idset.has(e.from));
    const k = act.length;
    const idx = new Map(act.map((n, i) => [n.id, i]));
    // 各块能控规范型
    const reals = act.map((n) => {
      const f = n.f;
      const m = f.d.length - 1;
      if (m === 0) return { m: 0, A: [], B: [], C: [], d: f.n[0] };
      const A = [];
      for (let i = 1; i < m; i++) { const row = new Array(m).fill(0); row[i] = 1; A.push(row); }
      A.push(f.d.slice(1).map((c) => -c).reverse());
      const B = new Array(m).fill(0); B[m - 1] = 1;
      const b = f.n.slice(); while (b.length < m + 1) b.unshift(0);
      const b0 = b[0];
      const C = [];
      for (let j = 0; j < m; j++) C.push(b[m - j] - b0 * f.d[m - j]);
      return { m, A, B, C, d: b0 };
    });
    const M = reals.reduce((s, r) => s + r.m, 0);
    // 混合：u = W·y + hR；y = Cq·x + dq∘u（dq = 各块直馈增益）
    // 代数环求解：u = (I − W·diag(dq))⁻¹·(W·Cq·x + hR)
    const W = Array.from({ length: k }, () => new Array(k).fill(0));
    for (const e of E) W[idx.get(e.to)][idx.get(e.from)] += e.sign;
    const backSet = new Set();
    const state = new Map();
    const dfsCl = (id) => {
      state.set(id, 1);
      for (const e of E) {
        if (e.from !== id) continue;
        if (state.get(e.to) === 1) backSet.add(e);
        else if (!state.get(e.to)) dfsCl(e.to);
      }
      state.set(id, 2);
    };
    for (const n of act) if (!state.get(n.id)) dfsCl(n.id);
    // R 注入点：优先用「R」徽标显式标记；未标记时回退到无输入边的块（仍无则首块）
    let hR = act.map((n) => (n.mark === 'in' ? 1 : 0));
    if (!hR.some((v) => v)) {
      hR = act.map((n, i) => (E.some((e) => idx.get(e.to) === i) ? 0 : 1));
      if (!hR.some((v) => v)) hR[0] = 1;
    }
    // 组装复合 A/B/C/D
    const offs = [];
    let off = 0;
    const Ablk = Array.from({ length: M }, () => new Array(M).fill(0));
    const Bq = Array.from({ length: M }, () => new Array(k).fill(0));
    const Cq = Array.from({ length: k }, () => new Array(M).fill(0));
    const dq = new Array(k).fill(0);
    act.forEach((n, i) => {
      const r = reals[i];
      offs.push(off);
      if (r.m) {
        for (let a = 0; a < r.m; a++) for (let b = 0; b < r.m; b++) Ablk[off + a][off + b] = r.A[a][b];
        for (let a = 0; a < r.m; a++) Bq[off + a][i] = r.B[a];
        for (let c = 0; c < r.m; c++) Cq[i][off + c] = r.C[c];
      }
      dq[i] = r.d;
      off += r.m;
    });
    // 输出点：优先用「Y」徽标显式标记（单选）；未标记时回退到无出边的汇点
    const outMarked = act.find((n) => n.mark === 'out');
    const isSink = (i) => (outMarked ? idx.get(outMarked.id) === i : !E.some((e) => idx.get(e.from) === i));
    // y = Minv·(W·Cq·x + hR)
    const Min = matI(k).map((r, i) => r.map((v, j) => v - W[i][j] * dq[j]));
    const Minv = matInv(Min);
    if (!Minv) return { ok: false, note: '结构含无法求解的代数环（如纯增益闭环）' };
    const CCx = matMul(Minv, matMul(W, Cq));
    const CR = matVec(Minv, hR);
    const A = Ablk.map((row, i) => row.map((v, j) => {
      let s = 0;
      for (let t = 0; t < k; t++) s += Bq[i][t] * CCx[t][j];
      return v + s;
    }));
    const Bc = Bq.map((row, i) => row.reduce((s, v, t) => s + v * CR[t], 0));
    // 输出行 = 汇点自身的 C 行 + 直馈 d_i·u_i 通道
    const Cc = new Array(M).fill(0);
    let d0out = 0;
    act.forEach((n, i) => {
      if (!isSink(i)) return;
      const r = reals[i];
      for (let c = 0; c < r.m; c++) Cc[offs[i] + c] += r.C[c];
      for (let c = 0; c < M; c++) Cc[c] += dq[i] * CCx[i][c];
      d0out += dq[i] * CR[i];
    });
    if (M === 0) {
      return { ok: true, frac: fracNorm({ n: [d0out], d: [1] }) };
    }
    // Faddeev–LeVerrier：D(s) = s^M + c1 s^{M-1} + ... + c_M
    // adj(sI−A) = M_1 s^{M-1} + M_2 s^{M-2} + ... + M_M，M_1 = I，M_{k+1} = A·M_k + c_k·I
    const cs = [1];
    const Ms = [matI(M)];
    let Mk = matI(M);
    for (let kk = 1; kk <= M; kk++) {
      const AM = matMul(A, Mk);
      const ck = -AM.reduce((s, row, i) => s + row[i], 0) / kk;
      cs[kk] = ck;
      if (kk < M) {
        Mk = AM.map((row, i) => row.map((v, j) => v + ck * (i === j ? 1 : 0)));
        Ms.push(Mk);
      }
    }
    // N(s) = d0·D(s) + Σ_k (Cc·M_k·Bc)·s^{M−k}
    const N = new Array(M + 1).fill(0);
    N[0] = d0out;
    for (let kk = 1; kk <= M; kk++) {
      const Mb = matVec(Ms[kk - 1], Bc);
      N[kk] = Cc.reduce((s, v, i) => s + v * Mb[i], 0) + d0out * cs[kk];
    }
    // 根匹配对消公共零极点
    const dcoef = [1, ...cs.slice(1)];
    const dRoots = DSP.polyRoots(pTrim(dcoef));
    const nTrim = pTrim(N);
    // N 全为 0 → T=0，直接返回
    if (nTrim.length === 1 && Math.abs(nTrim[0]) < 1e-12) {
      return { ok: true, frac: { n: [0], d: [1] } };
    }
    const nRoots = DSP.polyRoots(nTrim);
    const used = new Array(nRoots.length).fill(false);
    const keepP = [], keepZ = [];
    for (const p of dRoots) {
      let mi = -1, md = Infinity;
      nRoots.forEach((z, i) => {
        if (used[i]) return;
        const dd = Math.hypot(z.re - p.re, z.im - p.im) / (1 + Math.hypot(p.re, p.im));
        if (dd < md) { md = dd; mi = i; }
      });
      if (mi >= 0 && md < 1e-4) { used[mi] = true; } else keepP.push(p);
    }
    nRoots.forEach((z, i) => { if (!used[i]) keepZ.push(z); });
    const den2 = keepP.length ? DSP.polyFromRoots(keepP) : [1];
    // keepZ 为空说明分子是非零常数（如只剩直馈项），占位 [1] 后由增益比校正
    let n2 = keepZ.length ? DSP.polyFromRoots(keepZ) : [1];
    // 增益守恒：按高频渐近比值校正（对消后根重构不带原首系数信息）
    const evalp = (p, s) => p.reduce((acc, c) => acc * s + c, 0);
    const sw = 1e3;
    const ratio = (evalp(N, sw) / evalp(dcoef, sw)) / (evalp(n2, sw) / evalp(den2, sw) || 1);
    if (isFinite(ratio) && ratio > 0) n2 = n2.map((c) => c * ratio);
    return { ok: true, frac: fracNorm({ n: n2, d: den2 }) };
  }

  /* ---------- 结果输出 ---------- */
  function update() {
    const r = computeTransfer();
    const tex = $('#blk-tex'), stats = $('#blk-stats');
    if (!r.ok) {
      tex.innerHTML = `<span class="hint">${r.note || '添加块并连线后，这里显示合成传函。'}</span>`;
      stats.innerHTML = '';
      renderCanvas(null);
      drawStep(null);
      return;
    }
    tex.innerHTML = '';
    const texN = U.polyTex(r.frac.n).replace(/^\+/, '');
    const texD = U.polyTex(r.frac.d).replace(/^\+/, '');
    FX.katex('T(s)=\\dfrac{' + texN + '}{' + texD + '}', tex, { displayMode: true });
    const poles = DSP.polyRoots(r.frac.d);
    const stable = poles.every((q) => q.re < 1e-9);
    stats.innerHTML = `
      <div class="stat"><span class="k">阶次</span><span class="v">${r.frac.d.length - 1}</span></div>
      <div class="stat"><span class="k">闭环极点</span><span class="v" style="font-size:12px;max-width:300px;word-break:break-all">${poles.map((q) => U.fmt(q.re, 2) + (Math.abs(q.im) > 1e-9 ? (q.im > 0 ? '+' : '') + U.fmt(q.im, 2) + 'j' : '')).join(', ') || '—'}</span></div>
      <div class="stat"><span class="k">稳定性</span><span class="v" style="color:${stable ? cv('--cv-line2') : cv('--cv-danger')}">${stable ? '稳定' : '不稳定'}</span></div>`;
    renderCanvas(r.frac);
    drawStep(r.frac);
  }

  /* ---------- 画布渲染 ---------- */
  const WIRE = 'var(--cv-line4)';
  function edgeGeom(e) {
    const a = nodeById(e.from), b = nodeById(e.to);
    if (!a || !b) return null;
    const pa = ports(a), pb = ports(b);
    const sx = pa.out.x, sy = pa.out.y, tx = pb.in.x, ty = pb.in.y;
    if (tx > sx + 30) {
      const mx = (sx + tx) / 2;
      return { d: `M ${sx} ${sy} L ${mx} ${sy} L ${mx} ${ty} L ${tx} ${ty}`, mid: { x: mx, y: sy } };
    }
    const ly = Math.max(sy, ty) + 42;
    const l2 = sx + 24, l3 = tx - 28;
    return { d: `M ${sx} ${sy} L ${l2} ${sy} L ${l2} ${ly} L ${l3} ${ly} L ${l3} ${ty} L ${tx} ${ty}`, mid: { x: (l2 + l3) / 2, y: ly }, back: true };
  }
  // 从路径末段方向生成箭头三角形
  function pathArrow(d) {
    const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
    const n = nums.length / 2;
    const x2 = nums[2 * n - 2], y2 = nums[2 * n - 1];
    const x1 = nums[2 * n - 4], y1 = nums[2 * n - 3];
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const dd = 9, w = 4.5;
    const p2 = `${(x2 - dd * Math.cos(ang) - w * Math.sin(ang)).toFixed(1)},${(y2 - dd * Math.sin(ang) + w * Math.cos(ang)).toFixed(1)}`;
    const p3 = `${(x2 - dd * Math.cos(ang) + w * Math.sin(ang)).toFixed(1)},${(y2 - dd * Math.sin(ang) - w * Math.cos(ang)).toFixed(1)}`;
    return `${x2},${y2} ${p2} ${p3}`;
  }
  function renderCanvas(frac) {
    const s = svg();
    const parts = [];
    // 点阵背景（编辑器质感）
    parts.push(`<defs><pattern id="blk-dots" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="1.2" cy="1.2" r="1.2" fill="var(--cv-grid)"/></pattern></defs>`);
    parts.push(`<rect x="0" y="0" width="${VW}" height="${VH}" fill="url(#blk-dots)"/>`);
    // 连线（先画线，块后画覆盖端点内侧）
    parts.push(`<g id="blk-edges">`);
    edges.forEach((e, i) => {
      const g = edgeGeom(e);
      if (!g) return;
      const col = e.sign < 0 ? 'var(--danger)' : WIRE;
      parts.push(`<path d="${g.d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" data-edge-line="${i}"/>`);
      parts.push(`<polygon points="${pathArrow(g.d)}" fill="${col}"/>`);
      // 徽标：符号 + 删除
      parts.push(`<g data-badge="${i}" style="cursor:pointer">
        <circle cx="${g.mid.x}" cy="${g.mid.y}" r="9" fill="var(--panel-2)" stroke="${col}" stroke-width="1.5"/>
        <text x="${g.mid.x}" y="${g.mid.y + 3.5}" text-anchor="middle" fill="${e.sign < 0 ? 'var(--danger)' : 'var(--text-dim)'}" font-size="11" font-family="monospace">${e.sign < 0 ? '−' : '+'}</text>
      </g>`);
      parts.push(`<g data-edge-del="${i}" style="cursor:pointer">
        <circle cx="${g.mid.x + 14}" cy="${g.mid.y}" r="7.5" fill="var(--panel-2)" stroke="var(--line-2)" stroke-width="1"/>
        <text x="${g.mid.x + 14}" y="${g.mid.y + 3}" text-anchor="middle" fill="var(--text-faint)" font-size="9">✕</text>
      </g>`);
    });
    if (drag && drag.type === 'wire' && drag.cur) {
      parts.push(`<path d="M ${drag.fromPt.x} ${drag.fromPt.y} L ${drag.cur.x} ${drag.cur.y}" fill="none" stroke="${WIRE}" stroke-width="2" stroke-dasharray="5 4" opacity="0.85"/>`);
    }
    parts.push(`</g>`);
    // 块
    nodes.forEach((nd) => {
      const hov = drag && drag.type === 'block' && drag.id === nd.id;
      parts.push(`<g data-node="${nd.id}" style="cursor:move">
        <rect x="${nd.x}" y="${nd.y}" width="${BW}" height="${BH}" rx="9" fill="var(--panel-2)" stroke="${nd.err ? 'var(--danger)' : hov ? 'var(--accent-2)' : 'var(--accent)'}" stroke-width="${hov ? 2.4 : 1.6}"/>
        <text x="${nd.x + BW / 2}" y="${nd.y - 6}" text-anchor="middle" fill="var(--accent)" font-size="10" font-family="monospace">${esc(nd.name)}</text>
        <text x="${nd.x + BW / 2}" y="${nd.y + 20}" text-anchor="middle" fill="${nd.err ? 'var(--danger)' : 'var(--text)'}" font-size="10.5" font-family="monospace">${esc(nd.str.length > 15 ? nd.str.slice(0, 14) + '…' : nd.str)}</text>
        <circle cx="${nd.x}" cy="${nd.y + BH / 2}" r="5" fill="var(--panel-2)" stroke="${WIRE}" stroke-width="2" data-inport="${nd.id}" style="cursor:crosshair"/>
        <circle cx="${nd.x + BW}" cy="${nd.y + BH / 2}" r="5" fill="${WIRE}" data-outport="${nd.id}" style="cursor:crosshair"/>
        <g data-mk="in" data-mk-node="${nd.id}" style="cursor:pointer">
          <rect x="${nd.x + BW - 21}" y="${nd.y + 3}" width="17" height="13" rx="3.5" fill="${nd.mark === 'in' ? 'var(--accent-2)' : 'var(--panel-2)'}" stroke="${nd.mark === 'in' ? 'var(--accent-2)' : 'var(--line-2)'}" stroke-width="1"/>
          <text x="${nd.x + BW - 12.5}" y="${nd.y + 12.5}" text-anchor="middle" fill="${nd.mark === 'in' ? '#fff' : 'var(--text-faint)'}" font-size="9" font-family="monospace">R</text>
        </g>
        <g data-mk="out" data-mk-node="${nd.id}" style="cursor:pointer">
          <rect x="${nd.x + 4}" y="${nd.y + 3}" width="17" height="13" rx="3.5" fill="${nd.mark === 'out' ? 'var(--accent)' : 'var(--panel-2)'}" stroke="${nd.mark === 'out' ? 'var(--accent)' : 'var(--line-2)'}" stroke-width="1"/>
          <text x="${nd.x + 12.5}" y="${nd.y + 12.5}" text-anchor="middle" fill="${nd.mark === 'out' ? '#fff' : 'var(--text-faint)'}" font-size="9" font-family="monospace">Y</text>
        </g>
      </g>`);
    });
    // 单位输入提示
    parts.push(`<text x="8" y="${VH - 8}" fill="var(--text-faint)" font-size="10">点 R 徽标=输入求和点（可多个）· 点 Y 徽标=输出点（未标记时自动推断）</text>`);
    s.innerHTML = parts.join('');
    void frac;
  }

  /* ---------- 画布交互 ---------- */
  function svgPoint(e) {
    const pt = new DOMPoint(e.clientX, e.clientY);
    const p = pt.matrixTransform(svg().getScreenCTM().inverse());
    return { x: p.x, y: p.y };
  }
  const hitInport = (p) => {
    for (const nd of nodes) {
      const q = ports(nd).in;
      if (Math.hypot(p.x - q.x, p.y - q.y) < 12) return nd.id;
    }
    return null;
  };
  svg().addEventListener('pointerdown', (e) => {
    const t = e.target;
    const p = svgPoint(e);
    const mkG = t.closest && t.closest('[data-mk]');
    if (mkG) {
      const nd = nodeById(+mkG.dataset.mkNode);
      if (nd) {
        if (mkG.dataset.mk === 'in') nd.mark = nd.mark === 'in' ? null : 'in';
        else if (nd.mark === 'out') nd.mark = null;
        else { nodes.forEach((x) => { if (x.mark === 'out') x.mark = null; }); nd.mark = 'out'; }
        renderList();
        update();
      }
      return;
    }
    const badgeG = t.closest && t.closest('[data-badge]');
    if (badgeG) {
      const ei = +badgeG.dataset.badge;
      edges[ei].sign *= -1;
      update();
      return;
    }
    const delG = t.closest && t.closest('[data-edge-del]');
    if (delG) {
      const ei = +delG.dataset.edgeDel;
      edges.splice(ei, 1);
      update();
      return;
    }
    const outN = t.dataset && t.dataset.outport ? +t.dataset.outport : null;
    if (outN) {
      const nd = nodeById(outN);
      const q = ports(nd).out;
      drag = { type: 'wire', from: outN, fromPt: q, cur: q };
      svg().setPointerCapture(e.pointerId);
      renderCanvas(null);
      return;
    }
    const nodeG = t.closest && t.closest('[data-node]');
    if (nodeG) {
      const id = +nodeG.dataset.node;
      const nd = nodeById(id);
      drag = { type: 'block', id, dx: p.x - nd.x, dy: p.y - nd.y, moved: false };
      svg().setPointerCapture(e.pointerId);
      return;
    }
  });
  svg().addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = svgPoint(e);
    if (drag.type === 'wire') {
      drag.cur = { x: U.clamp(p.x, 4, VW - 4), y: U.clamp(p.y, 4, VH - 4) };
      drag.target = hitInport(p);
      renderCanvas(null);
      return;
    }
    if (drag.type === 'block') {
      const nd = nodeById(drag.id);
      if (!nd) return;
      nd.x = U.clamp(Math.round(p.x - drag.dx), 0, VW - BW);
      nd.y = U.clamp(Math.round(p.y - drag.dy), 20, VH - BH);
      drag.moved = true;
      renderCanvas(null);   // 拖动中只重绘画布，抬起后再统一重算
    }
  });
  svg().addEventListener('pointerup', (e) => {
    if (drag && drag.type === 'wire') {
      const p = svgPoint(e);
      const to = hitInport(p);
      if (to && to !== drag.from && !edges.some((x) => x.from === drag.from && x.to === to)) {
        const sign = createsCycle(drag.from, to) ? -1 : 1;
        edges.push({ from: drag.from, to, sign });
      }
    }
    drag = null;
    update();
  });
  svg().addEventListener('contextmenu', (e) => e.preventDefault());
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      const s = svg();
      if (!s || !s.isConnected) { ro.disconnect(); return; }
      update();
    });
    ro.observe($('#blk-svgwrap'));
  }

  /* ---------- 阶跃响应 ---------- */
  function drawStep(frac) {
    const p = stepPlot.plot;
    if (!p) { stepPlot.plot = new FX.Plot($('#blk-step'), { margin: { l: 48, r: 14, t: 12, b: 28 } }); stepPlot.plot.onDraw = () => update(); return; }
    if (!frac) { p.clear(); return; }
    const poles = DSP.polyRoots(frac.d);
    const unstable = poles.some((q) => q.re > 1e-9);
    let nearest = Infinity;
    poles.forEach((q) => { const ar = Math.abs(q.re); if (ar > 1e-9) nearest = Math.min(nearest, ar); });
    const tmax = unstable ? 6 : U.clamp(5 / (nearest || 1), 1, 30);
    const res = DSP.ltiResponse(frac.n, frac.d, (t) => (t >= 0 ? 1 : 0), 0, tmax, 2400);
    let lo = Infinity, hi = -Infinity;
    for (const v of res.y) if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    lo = Math.min(lo, 0) - (hi - lo) * 0.08; hi += (hi - lo) * 0.1;
    p.setRange(res.t[0], res.t[res.t.length - 1], lo, hi);
    p.clear(); p.grid(); p.axis(true);
    p.line([0, tmax], [1, 1], { color: cv('--cv-tick'), width: 1 });
    p.clip();
    p.line(res.t, res.y, { color: unstable ? cv('--cv-danger') : cv('--cv-line1'), width: 2.2 });
    p.unclip();
    p.crosshair((t) => 't=' + U.fmt(t, 3), (y) => 'y=' + U.fmt(y, 4));
  }

  /* ---------- 顶部按钮 ---------- */
  $('#blk-add').addEventListener('click', () => addBlock('1/(s+1)'));
  $('#blk-clear').addEventListener('click', () => { nodes = []; edges = []; seq = 0; renderList(); update(); });
  $('#blk-demo').addEventListener('click', () => {
    nodes = []; edges = []; seq = 0;
    const a = addBlock('1/(s+1)');
    const b = addBlock('2/(s+2)');
    const c = addBlock('1/(s^2+2*s+4)');
    // 摆位：(G1、G2 上下并联) → G3 → 单位负反馈回 G1
    a.x = 300; a.y = 60;
    b.x = 300; b.y = 190;
    c.x = 560; c.y = 125;
    a.mark = 'in'; b.mark = 'in'; c.mark = 'out';   // 经典例：R 在 G1/G2 求和，输出取 G3
    edges.push({ from: a.id, to: c.id, sign: 1 });
    edges.push({ from: b.id, to: c.id, sign: 1 });
    // 经典例：(G1+G2)·G3 的单位负反馈 —— 反馈回注到 G1 与 G2 两个求和点
    edges.push({ from: c.id, to: a.id, sign: -1 });
    edges.push({ from: c.id, to: b.id, sign: -1 });
    renderList();
    update();
  });

  // 首屏：载入示例
  $('#blk-demo').click();

  return { title: '系统框图', api: { dispose, onTheme: () => { update(); } } };
  function dispose() { }
});
