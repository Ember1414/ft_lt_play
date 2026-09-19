/* ============================================================
 * blocksolve.js — 系统框图求解内核（纯函数，无 DOM 依赖，可在 Node 中测试）
 *   输入：节点表 + 连线表；输出：合成传函 T(s)
 *   模型 = 信号流图：节点输入 u_i = Σ(±y_j)（接 R 的节点另加单位输入），
 *   每个节点做能控规范型实现，代数回路经 (I − W·diag(dq))⁻¹ 一次求解，
 *   复合 A/B/C 经 Faddeev–LeVerrier 展开为 T(s)，最后按根匹配对消公共零极点。
 *
 *   节点：{ id, kind:'box'|'sum'|'branch', f:{n,d}, src?, out?, err? }
 *         sum / branch 传函恒为 1（d 为 [1]）；src = 接输入 R(s)；out = 引出输出 Y(s)
 *   连线：{ from, to, sign: 1|-1 }（sign 为入边符号，−1 = 负反馈）
 *
 *   输出端子为必需：纯反馈拓扑（如 Σ⇄G）没有"无出边的汇点"，
 *   若既不标记 out 也不存在汇点，直接报错而不是静默算成 T=0。
 * ============================================================ */
window.BLKSOLVE = (() => {
  /* ================= 多项式与有理函数 ================= */
  const pTrim = (p) => { const a = p.slice(); while (a.length > 1 && Math.abs(a[0]) < 1e-9) a.shift(); return a; };
  const polyMul = (a, b) => {
    const o = new Array(a.length + b.length - 1).fill(0);
    for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) o[i + j] += a[i] * b[j];
    return o;
  };
  const polyAdd = (a, b) => {
    const n = Math.max(a.length, b.length), o = new Array(n).fill(0);
    for (let i = 0; i < a.length; i++) o[n - a.length + i] += a[i];
    for (let i = 0; i < b.length; i++) o[n - b.length + i] += b[i];
    return o;
  };
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

  /* ================= 矩阵 ================= */
  const matI = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  const matMul = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((s, v, i) => s + v * B[i][j], 0)));
  const matVec = (A, v) => A.map((row) => row.reduce((s, x, i) => s + x * v[i], 0));
  function matInv(M) {
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
  }

  /* ================= 表达式 → 传函 ================= */
  // 解析块表达式；判定（可解析 / 分母首项非 0 / 真分式）全部收敛在此
  // dom === 'z' 时按变量 z 解析（块标注「已在 z 域」）
  function parseBlockTF(str, dom) {
    const s = String(str == null ? '' : str).trim();
    if (!s) return { ok: false, reason: '无法解析' };
    const v = dom === 'z' ? 'z' : 's';
    const t = (typeof FX_LIB !== 'undefined' && FX_LIB.parseTF) ? FX_LIB.parseTF(s, v) : null;
    if (!t || !Array.isArray(t.num) || !Array.isArray(t.den)) return { ok: false, reason: '无法解析' };
    const den = pTrim(t.den);
    if (!den.length || Math.abs(den[0]) < 1e-12) return { ok: false, reason: '分母首项为 0' };
    const num = pTrim(t.num);
    if (num.length > den.length) return { ok: false, reason: '非真分式（分子阶次 > 分母阶次）' };
    const red = freduce({ n: num, d: den });
    // 规范形约定：分母首项归一（与能控规范型实现一致）
    const d0 = red.d[0] || 1;
    return { ok: true, n: red.n.map((c) => c / d0), d: red.d.map((c) => c / d0) };
  }

  /* ================= 拓扑 → T(s) ================= */
  function solveTransfer(nodes, edges) {
    const act = (nodes || []).filter((n) => !n.err && n.f);
    if (!act.length) return { ok: false, note: '没有可用元件：请添加元件并填写有效传函' };
    const idset = new Set(act.map((n) => n.id));
    const E = (edges || []).filter((e) => idset.has(e.from) && idset.has(e.to));
    const k = act.length;
    const idx = new Map(act.map((n, i) => [n.id, i]));

    // 各元件做能控规范型实现（分母首一）
    const reals = act.map((n) => {
      const f0 = n.f;
      const m = f0.d.length - 1;
      if (m === 0) return { m: 0, A: [], B: [], C: [], d: f0.n[0] / (f0.d[0] || 1) };
      const k0 = f0.d[0];
      const f = { n: f0.n.map((c) => c / k0), d: f0.d.map((c) => c / k0) };
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

    // u = W·y + hR；y = Cq·x + dq∘u
    const W = Array.from({ length: k }, () => new Array(k).fill(0));
    for (const e of E) W[idx.get(e.to)][idx.get(e.from)] += e.sign;

    // 输入注入点：优先 src 标记；否则无入边的元件；仍无则首个
    let hR = act.map((n) => (n.src ? 1 : 0));
    if (!hR.some((v) => v)) {
      hR = act.map((n, i) => (E.some((e) => idx.get(e.to) === i) ? 0 : 1));
      if (!hR.some((v) => v) && act.length) hR[0] = 1;
    }

    // 输出点：优先 out 端子（可多个，求和）；否则无出边的汇点
    const markOut = act.map((n, i) => (n.out ? i : -1)).filter((i) => i >= 0);
    const sinkOf = (i) => (markOut.length ? markOut.indexOf(i) >= 0 : !E.some((e) => idx.get(e.from) === i));
    if (!act.some((n, i) => sinkOf(i))) {
      return { ok: false, note: '未指定输出：请把某个元件设为输出 Y(s)（右键或检查器），或让链条末端没有出边' };
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

    const Min = matI(k).map((r, i) => r.map((v, j) => v - W[i][j] * dq[j]));
    const Minv = matInv(Min);
    if (!Minv) return { ok: false, note: '存在无延迟代数环（回路总增益为 1），无法求解' };
    const CCx = matMul(Minv, matMul(W, Cq));
    const CR = matVec(Minv, hR);
    const A = Ablk.map((row, i) => row.map((v, j) => {
      let s = 0;
      for (let t = 0; t < k; t++) s += Bq[i][t] * CCx[t][j];
      return v + s;
    }));
    const Bc = Bq.map((row, i) => row.reduce((s, v, t) => s + v * CR[t], 0));
    // 输出行 = 各输出端子自身的 C 行 + 直馈 d_i·u_i 通道
    const Cc = new Array(M).fill(0);
    let d0out = 0;
    act.forEach((n, i) => {
      if (!sinkOf(i)) return;
      const r = reals[i];
      for (let c = 0; c < r.m; c++) Cc[offs[i] + c] += r.C[c];
      for (let c = 0; c < M; c++) Cc[c] += dq[i] * CCx[i][c];
      d0out += dq[i] * CR[i];
    });

    if (M === 0) return { ok: true, frac: freduce({ n: [d0out], d: [1] }) };

    // Faddeev–LeVerrier：D(s) = s^M + c1 s^{M-1} + … + c_M
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
    const dRoots = DSP.polyRoots(pTrim([1, ...cs.slice(1)]));
    const nTrim = pTrim(N);
    if (nTrim.length === 1 && Math.abs(nTrim[0]) < 1e-12) return { ok: true, frac: { n: [0], d: [1] } };
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
      if (mi >= 0 && md < 1e-4) used[mi] = true; else keepP.push(p);
    }
    nRoots.forEach((z, i) => { if (!used[i]) keepZ.push(z); });
    const den2 = keepP.length ? DSP.polyFromRoots(keepP) : [1];
    // keepZ 为空说明分子是非零常数（如只剩直馈项），占位 [1] 后由增益比校正
    let n2 = keepZ.length ? DSP.polyFromRoots(keepZ) : [1];
    // 增益守恒：按高频渐近比值校正（对消后根重构不带原首系数信息）
    const evalp = (p, s) => p.reduce((acc, c) => acc * s + c, 0);
    const sw = 1e3;
    const ratio = (evalp(N, sw) / evalp([1, ...cs.slice(1)], sw)) / (evalp(n2, sw) / evalp(den2, sw) || 1);
    if (isFinite(ratio) && Math.abs(ratio) > 1e-12) n2 = n2.map((c) => c * ratio);
    return { ok: true, frac: freduce({ n: n2, d: den2 }) };
  }

  /* ================= 结果派生 ================= */
  function deriveReadout(frac) {
    const order = frac && frac.d ? frac.d.length - 1 : 0;
    const poles = frac && frac.d ? DSP.polyRoots(frac.d) : [];
    const hasRhp = poles.some((p) => p.re > 1e-9);
    const hasJw = poles.some((p) => Math.abs(p.re) <= 1e-9);
    const stable = !hasRhp && !hasJw;
    let dom = null;
    for (const p of poles) { if (p.re >= -1e-9) continue; if (!dom || p.re > dom.re) dom = p; }
    const wn = dom ? Math.hypot(dom.re, dom.im) : null;
    return {
      order, poles, hasRhp, hasJw, stable,
      wn, zeta: dom && wn > 0 ? -dom.re / wn : null,
      stableText: stable ? '稳定' : hasRhp ? '不稳定' : '临界稳定'
    };
  }

  /* ================= z 域：离散化 Z[G(s)] ================= */
  /* 复数小工具（只在本段内部使用） */
  const C = {
    add: (a, b) => ({ re: a.re + b.re, im: a.im + b.im }),
    mul: (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }),
    scale: (a, k) => ({ re: a.re * k, im: a.im * k }),
    neg: (a) => ({ re: -a.re, im: -a.im }),
    conj: (a) => ({ re: a.re, im: -a.im }),
    abs: (a) => Math.hypot(a.re, a.im),
    exp: (a) => ({ re: Math.exp(a.re) * Math.cos(a.im), im: Math.exp(a.re) * Math.sin(a.im) }),
    upow: (u, s) => {
      const m = Math.pow(C.abs(u), s), th = Math.atan2(u.im, u.re) * s;
      return { re: m * Math.cos(th), im: m * Math.sin(th) };
    }
  };
  // 复系数多项式（自高到低）
  const cpolyMul = (a, b) => {
    const o = new Array(a.length + b.length - 1).fill(0).map(() => ({ re: 0, im: 0 }));
    for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) o[i + j] = C.add(o[i + j], C.mul(a[i], b[j]));
    return o;
  };
  const cpolyAdd = (a, b) => {
    const n = Math.max(a.length, b.length), o = new Array(n).fill(0).map(() => ({ re: 0, im: 0 }));
    for (let i = 0; i < a.length; i++) o[n - a.length + i] = C.add(o[n - a.length + i], a[i]);
    for (let i = 0; i < b.length; i++) o[n - b.length + i] = C.add(o[n - b.length + i], b[i]);
    return o;
  };
  const cpolyScale = (a, k) => a.map((v) => (typeof k === 'number' ? C.scale(v, k) : C.mul(v, k)));

  /* 重极点核：∂_p^{j}[z/(z−u)] = P_j(z,u)/(z−u)^{j+1}，递推
       P_0 = z；P_{j+1} = (z−u)·∂_p P_j + (j+1)·T·u·P_j
     系数按「z 幂 × u 幂」跟踪（∂_p u^s = s·T·u^s），最后代入 u 取值。 */
  function pSeqZ(m, u, T) {
    let P = [{ zi: 1, us: 0, c: { re: 1, im: 0 } }];
    const out = [];
    for (let j = 0; j < m; j++) {
      if (!P.length) { out.push([{ re: 0, im: 0 }]); }
      else {
        const deg = P.reduce((a, t) => Math.max(a, t.zi), 0);
        const arr = new Array(deg + 1).fill(0).map(() => ({ re: 0, im: 0 }));
        for (const t of P) {
          const c = C.mul(t.c, C.upow(u, t.us));
          arr[deg - t.zi] = C.add(arr[deg - t.zi], c);
        }
        out.push(arr);
      }
      if (j + 1 < m) {
        const dP = P.map((t) => ({ zi: t.zi, us: t.us, c: C.scale(t.c, t.us * T) }));
        const A = [];
        for (const t of dP) { A.push({ zi: t.zi + 1, us: t.us, c: t.c }); A.push({ zi: t.zi, us: t.us + 1, c: C.neg(t.c) }); }
        for (const t of P) A.push({ zi: t.zi, us: t.us + 1, c: C.scale(t.c, (j + 1) * T) });
        P = A;
      }
    }
    return out;
  }
  /* 实系数整理：分母首一 + 按「相对分母尺度」去掉数值噪声导致的高阶首项。
     重极点经部分分式引擎重建后，首项可能出现 ~1e-8 的残差（引擎对重根求根的精度所限），
     这类系数在 |z|≲1 处对传函值的贡献 < 1e-6，属纯噪声，直接归零。 */
  function finishZ(n, d) {
    const dMag = Math.max(...d.map(Math.abs), 1e-30);
    const trimLeadRel = (arr, tol) => { let s = 0; while (s < arr.length - 1 && Math.abs(arr[s]) < tol) s++; return arr.slice(s); };
    let N = trimLeadRel(n, 1e-6 * dMag);
    let D = trimLeadRel(d, 1e-9 * dMag);
    if (!D.length || Math.abs(D[0]) < 1e-12) return { ok: false, note: 'z 域分母首项为 0，离散化失败' };
    const k0 = D[0];
    N = N.map((c) => c / k0); D = D.map((c) => c / k0);
    const snap = (arr) => arr.map((v) => (Math.abs(v) < 1e-11 ? 0 : v));
    N = snap(N); D = snap(D);
    D[0] = 1;
    return { ok: true, n: N, d: D };
  }

  /* Z[G(s)]：部分分式（复用 TR 引擎）→ Σ A_k·P_{k−1}(z,u)/(z−u)^k
     直通项 b0（分子阶次 = 分母阶次）采样后对应 δ[n] 的增益，并入分子。 */
  function sToZ(num, den, T) {
    if (!isFinite(T) || !(T > 0)) return { ok: false, note: '采样周期 T 必须为正数' };
    if (typeof TR === 'undefined' || !TR.partialFracGroups) return { ok: false, note: '缺少 transforms 引擎' };
    const pf = TR.partialFracGroups(num, den);
    if (!pf.ok) return { ok: false, note: pf.note || '部分分式失败' };
    const b0 = pf.direct || 0;
    // 展开为「单个极点 + 系数向量」（共轭对拆成两个共轭成员）
    const poles = [];
    for (const g of pf.groups) {
      poles.push({ p: g.p, A: g.A, m: g.m });
      if (g.pair) poles.push({ p: { re: g.p.re, im: -g.p.im }, A: g.A.map(C.conj), m: g.m });
    }
    if (!poles.length) return { ok: true, n: [b0], d: [1] };
    // 按 u=e^{pT} 聚类：不同 s 极点可能因混叠落到同一 z 极点（重数合并）
    const clusters = [];
    for (const pl of poles) {
      const u = C.exp({ re: pl.p.re * T, im: pl.p.im * T });
      if (!isFinite(u.re) || !isFinite(u.im)) return { ok: false, note: 'e^{pT} 溢出：请减小采样周期 T' };
      let cl = clusters.find((c) => C.abs(C.add(c.u, C.neg(u))) < 1e-9 * (1 + C.abs(u)));
      if (!cl) { cl = { u, m: 0, items: [] }; clusters.push(cl); }
      cl.m += pl.m; cl.items.push(pl);
    }
    let Nc = [{ re: 0, im: 0 }], Dc = [{ re: 1, im: 0 }];
    for (const cl of clusters) {
      const u = cl.u, mt = cl.m;
      const fz = [{ re: 1, im: 0 }, C.neg(u)];
      let num = [{ re: 0, im: 0 }];
      for (const it of cl.items) {
        const Ps = pSeqZ(it.m, u, T);
        for (let k = 1; k <= it.m; k++) {
          let term = Ps[k - 1];
          for (let t = 0; t < mt - k; t++) term = cpolyMul(term, fz);
          num = cpolyAdd(num, cpolyScale(term, it.A[k - 1]));
        }
      }
      let den = [{ re: 1, im: 0 }];
      for (let t = 0; t < mt; t++) den = cpolyMul(den, fz);
      Nc = cpolyAdd(cpolyMul(Nc, den), cpolyMul(num, Dc));
      Dc = cpolyMul(Dc, den);
    }
    if (Math.abs(b0) > 1e-12) Nc = cpolyAdd(Nc, cpolyScale(Dc, b0));
    // 共轭结构保证虚部相消；虚部过大说明分母系数非实或极点未成对
    const mag = Math.max(...Dc.map(C.abs), 1e-30);
    const imErr = Math.max(...Nc.map((v) => Math.abs(v.im)), ...Dc.map((v) => Math.abs(v.im)));
    if (!(imErr < 1e-6 * mag)) return { ok: false, note: '共轭极点未成对（分母系数非实？），无法得到实系数 Z 变换' };
    return finishZ(Nc.map((v) => v.re), Dc.map((v) => v.re));
  }

  /* 零阶保持器：(1−z⁻¹)·Z[G(s)/s]
     Q = Z[G(s)/s] 的分母必含 (z−1)（s=0 是 G/s 的极点）、分子必含 z（每个极点项都带 z），
     两者都与 (1−z⁻¹)=(z−1)/z 精确约去，因此这里用合成除法**符号地**约分，不做数值 GCD。 */
  function zohDiscretize(num, den, T) {
    if (!isFinite(T) || !(T > 0)) return { ok: false, note: '采样周期 T 必须为正数' };
    const q = sToZ(num, den.concat([0]), T);        // G(s)/s
    if (!q.ok) return q;
    const div = polyDivMod(q.d, [1, -1]);
    const dScale = Math.max(...q.d.map(Math.abs));
    if (Math.max(...div.r.map(Math.abs)) > 1e-6 * dScale) {
      return { ok: false, note: '零阶保持器离散化失败（分母未含 z=1 因子）' };
    }
    const D2 = div.q;                                // Dq/(z−1)
    const nScale = Math.max(...q.n.map(Math.abs));
    if (Math.abs(q.n[q.n.length - 1]) > 1e-9 * nScale) {
      return { ok: false, note: '零阶保持器离散化失败（分子未含 z 因子）' };
    }
    return finishZ(q.n.slice(0, -1), D2);            // Nq/z ÷ Dq/(z−1)
  }

  /* 由 T(z) 派生：阶次 / 极点 / 零点 / 稳定性（单位圆判据） */
  function deriveZReadout(frac) {
    const order = frac && frac.d ? frac.d.length - 1 : 0;
    const poles = frac && frac.d ? DSP.polyRoots(pTrim(frac.d)) : [];
    const nz = frac && frac.n ? pTrim(frac.n) : [];
    const zeros = nz.length > 1 ? DSP.polyRoots(nz) : [];
    const mods = poles.map((p) => Math.hypot(p.re, p.im));
    const hasOut = mods.some((m) => m > 1 + 1e-9);
    const hasOnCircle = mods.some((m) => Math.abs(m - 1) <= 1e-9);
    const stable = !hasOut && !hasOnCircle;
    return {
      order, poles, zeros, hasOut, hasOnCircle, stable,
      stableText: stable ? '稳定（单位圆内）'
        : hasOut ? '不稳定（存在单位圆外极点）' : '临界（存在单位圆上极点）'
    };
  }

  /* ================= 采样系统：域传播 + 归约 + 求解 ================= */
  const isMemN = (n) => n.kind === 'sum' || n.kind === 'branch';
  const isZBox = (n) => n.kind === 'box' && n.dom === 'z';
  const ONE = () => ({ n: [1], d: [1] });

  // 域传播 + 采样器下沉 + 连续片段划分；返回归约后的纯 z 图（不改动入参）
  function analyzeSampled(nodes, edges, T) {
    const all = nodes || [];
    const hasS = all.some((n) => n.kind === 'sample' || n.kind === 'zoh');
    const hasZ = all.some(isZBox);
    if (!hasS && !hasZ) return { ok: false, mode: 's' };
    if (!isFinite(T) || !(T > 0)) return { ok: false, note: '采样周期 T 必须为正数' };

    let ns = all.map((n) => ({ ...n }));
    let es = (edges || []).map((e) => ({ ...e }));
    let seqId = ns.reduce((m, n) => Math.max(m, n.id || 0), 0);
    const build = () => {
      const byId = new Map(ns.map((n) => [n.id, n]));
      const ins = new Map(ns.map((n) => [n.id, []]));
      const outs = new Map(ns.map((n) => [n.id, []]));
      es = es.filter((e) => byId.has(e.from) && byId.has(e.to));
      for (const e of es) { ins.get(e.to).push(e.from); outs.get(e.from).push(e.to); }
      return { byId, ins, outs };
    };
    let { byId, ins, outs } = build();

    // 悬空（无入边且未标记为输入源）的采样元件不参与：避免被当成输入源注入
    for (let guard = 0; guard < 20; guard++) {
      const drop = ns.filter((n) => (n.kind === 'sample' || n.kind === 'zoh') && !n.src && !(ins.get(n.id) || []).length);
      if (!drop.length) break;
      const ids = new Set(drop.map((n) => n.id));
      ns = ns.filter((n) => !ids.has(n.id));
      es = es.filter((e) => !ids.has(e.from) && !ids.has(e.to));
      ({ byId, ins, outs } = build());
    }
    if (!ns.length) return { ok: false, note: '没有可用元件：请添加元件并填写有效传函' };

    // 域：sample 输出 z；zoh 输出连续；z 域块 z；s 域块连续；sum/branch 由入边决定
    const dom = new Map();
    const propagate = () => {
      for (const n of ns) if (!isMemN(n)) dom.set(n.id, (n.kind === 'zoh' ? 's' : (isZBox(n) ? 'z' : (n.kind === 'box' ? 's' : 'z'))));
      for (const n of ns) if (isMemN(n)) dom.set(n.id, 'z');
      for (let it = 0; it <= ns.length + 2; it++) {
        let ch = false;
        for (const n of ns) {
          if (!isMemN(n)) continue;
          const want = (ins.get(n.id) || []).some((id) => dom.get(id) === 's') ? 's' : 'z';
          if (dom.get(n.id) !== want) { dom.set(n.id, want); ch = true; }
        }
        if (!ch) break;
      }
    };
    propagate();

    // 采样器下沉：读取「连续无记忆节点」的采样器，改挂到该节点的各条连续入边上
    for (let guard = 0; guard <= ns.length + 2; guard++) {
      const S = ns.find((n) => n.kind === 'sample'
        && (ins.get(n.id) || []).some((id) => { const m = byId.get(id); return m && isMemN(m) && dom.get(m.id) === 's'; }));
      if (!S) break;
      const mId = (ins.get(S.id) || []).find((id) => { const m = byId.get(id); return m && isMemN(m) && dom.get(m.id) === 's'; });
      for (const ee of es.filter((e) => e.to === mId && dom.get(e.from) === 's')) {
        const nid = ++seqId;
        ns.push({ id: nid, kind: 'sample', f: null, name: 'S' + nid });
        es.push({ from: nid, to: mId, sign: 1 });
        ee.to = nid;                                   // 原边改为 (源 → 新采样器)
      }
      dom.set(mId, 'z');
      for (const oe of es.filter((e) => e.from === S.id)) es.push({ from: mId, to: oe.to, sign: oe.sign });
      es = es.filter((e) => e.from !== S.id && e.to !== S.id);
      ns = ns.filter((n) => n.id !== S.id);
      ({ byId, ins, outs } = build());
      propagate();
    }

    // 校验：ZOH 输入必须是采样信号
    for (const n of ns) {
      if (n.kind !== 'zoh') continue;
      const src = ins.get(n.id) || [];
      if (!src.length) continue;
      if (src.some((id) => dom.get(id) !== 'z')) {
        return { ok: false, note: '零阶保持器的输入必须是采样信号，请在其前面加采样开关' };
      }
    }
    // 校验：z 域元件与连续元件不得直接相连（任一方向）
    const isContEl = (n) => (n.kind === 'box' && n.dom !== 'z') || (isMemN(n) && dom.get(n.id) === 's');
    for (const e of es) {
      const u = byId.get(e.from), v = byId.get(e.to);
      if (!u || !v) continue;
      if ((isZBox(u) && isContEl(v)) || (isZBox(v) && isContEl(u))) {
        return { ok: false, note: 'z 域元件与连续元件之间必须插入采样开关或零阶保持器' };
      }
    }
    // 校验：求和点 / 分支点的输入必须同域
    for (const n of ns) {
      if (!isMemN(n)) continue;
      if (new Set((ins.get(n.id) || []).map((id) => dom.get(id))).size > 1) {
        return { ok: false, note: '求和点 / 分支点混合了连续与离散信号：请用采样开关统一信号类型' };
      }
    }

    // 连续片段：连续节点的连通分量
    const contIds = new Set(ns.filter((n) => isContEl(n)).map((n) => n.id));
    const compOf = new Map();
    let comps = [];
    for (const id of contIds) {
      if (compOf.has(id)) continue;
      const comp = [], q = [id];
      compOf.set(id, comps.length);
      while (q.length) {
        const cur = q.pop(); comp.push(cur);
        for (const nb of [...(ins.get(cur) || []), ...(outs.get(cur) || [])]) {
          if (contIds.has(nb) && !compOf.has(nb)) { compOf.set(nb, comps.length); q.push(nb); }
        }
      }
      comps.push(comp);
    }

    const reduced = ns.filter((n) => !contIds.has(n.id)).map((n) => {
      // 符号元件与无记忆节点补单位传函；box 保持原样（无效块仍是 f=null + err，由 solveTransfer 过滤并告警）
      if (n.kind === 'box') return { ...n, err: !!n.err };
      return { ...n, f: n.f || ONE(), err: !!n.err };
    });
    const redEdges = [];
    const segs = [];
    const absorbedZoh = new Set();

    for (const comp of comps) {
      const inComp = new Set(comp);
      // 入口：被 sample / zoh 直接喂入的节点
      const entries = comp.filter((id) => (ins.get(id) || []).some((f) => { const d = byId.get(f); return d && (d.kind === 'sample' || d.kind === 'zoh'); }));
      if (!entries.length) {
        if (comp.some((id) => byId.get(id).src)) {
          return { ok: false, note: '参考输入 R 未经采样就进入了连续回路：请把采样开关接在求和点之后（误差点采样），或让 R 经采样后接入' };
        }
        return { ok: false, note: '存在未被采样的连续元件：信号未经过采样就参与回路，此类混合系统的闭环脉冲传函不是 z 的有理函数' };
      }
      if (entries.length > 1) {
        return { ok: false, note: '同一连续片段被多个采样点驱动（多速率 / 多输入），本版本不支持' };
      }
      const a = entries[0];
      const drivers = (ins.get(a) || []).filter((f) => { const d = byId.get(f); return d && (d.kind === 'sample' || d.kind === 'zoh'); });
      if (drivers.length > 1) return { ok: false, note: '同一连续片段被多个采样点驱动（多速率 / 多输入），本版本不支持' };
      const dNode = byId.get(drivers[0]);
      const hasZoh = dNode.kind === 'zoh';
      const drvSrc = hasZoh ? (ins.get(dNode.id) || [])[0] : dNode.id;   // zoh 被吸收：驱动源上移一格
      if (hasZoh && drvSrc === undefined) return { ok: false, note: '零阶保持器的输入必须是采样信号，请在其前面加采样开关' };
      if (hasZoh) absorbedZoh.add(dNode.id);
      // 出口：值被采样、或标记为输出端子
      const exits = comp.filter((id) => (outs.get(id) || []).some((t) => byId.get(t).kind === 'sample') || byId.get(id).out);
      if (!exits.length) {
        return { ok: false, note: '存在未被采样的连续元件：信号未经过采样就参与输出，无法给出脉冲传递函数' };
      }
      // 片段内部的 T_{a→b}(s)：复用 s 域求解（局部连续反馈自动解掉）
      for (const b of exits) {
        const sub = comp.map((id) => {
          const n = byId.get(id);
          return { ...n, src: id === a, out: id === b, dom: 's' };
        });
        const subE = es.filter((e) => inComp.has(e.from) && inComp.has(e.to));
        const rt = solveTransfer(sub, subE);
        if (!rt.ok) return { ok: false, note: '连续片段求解失败：' + rt.note };
        const Tz = hasZoh ? zohDiscretize(rt.frac.n, rt.frac.d, T) : sToZ(rt.frac.n, rt.frac.d, T);
        if (!Tz.ok) return { ok: false, note: '离散化失败：' + Tz.note };
        const vid = ++seqId;
        reduced.push({ id: vid, kind: 'box', dom: 'z', f: { n: Tz.n, d: Tz.d }, err: false, name: 'Z' + vid, out: !!byId.get(b).out });
        redEdges.push({ from: drvSrc, to: vid, sign: 1 });
        for (const oe of es.filter((e) => e.from === b && !inComp.has(e.to))) redEdges.push({ from: vid, to: oe.to, sign: oe.sign });
        segs.push({ in: a, out: b, hasZoh, Ts: rt.frac, Tz: { n: Tz.n, d: Tz.d }, vid });
      }
    }
    // 其余边原样保留（连续节点与被吸收的 zoh 不再出现）
    for (const e of es) {
      if (contIds.has(e.from) || contIds.has(e.to)) continue;
      if (absorbedZoh.has(e.from) || absorbedZoh.has(e.to)) continue;
      redEdges.push({ from: e.from, to: e.to, sign: e.sign });
    }
    // 去重同一对节点的重复边（片段出口可能同时是 out 端子与采样源）
    const seen = new Set();
    const gEdges = redEdges.filter((e) => {
      const k = e.from + '>' + e.to;
      if (e.from === e.to) return false;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    const mode = segs.length ? 'sampled' : 'z';
    return { ok: true, mode, segs, g: { nodes: reduced, edges: gEdges } };
  }

  // 顶层入口：mode 's' 表示无采样元件（调用方走原 s 域路径）
  function solveSampled(nodes, edges, T) {
    const an = analyzeSampled(nodes, edges, T);
    if (!an.ok) return an;
    const rt = solveTransfer(an.g.nodes, an.g.edges);
    if (!rt.ok) return { ok: false, mode: an.mode, note: rt.note, segs: an.segs };
    return { ok: true, mode: an.mode, z: rt.frac, segs: an.segs, read: deriveZReadout(rt.frac) };
  }

  /* ---------- 双线性变换（Tustin）：s = (2/T)(z−1)/(z+1) ----------
   * p(S)·(z+1)^n = Σ p_k (2/T)^{n−k} (z−1)^{n−k} (z+1)^k，分子分母同乘消去分式。
   * 返回 { ok, n, d }（按分母首项归一化）；频率轴弯曲 ω_s = (2/T)tan(ωT/2) 由调用方提示。 */
  function tustin(num, den, T) {
    if (!isFinite(T) || !(T > 0)) return { ok: false, note: '采样周期 T 必须为正数' };
    if (!den.length || Math.abs(den[0]) < 1e-12) return { ok: false, note: '分母首项为 0' };
    const n = Math.max(num.length, den.length) - 1;
    const pow = (base, k) => { let r = [1]; for (let i = 0; i < k; i++) r = polyMul(r, base); return r; };
    const scale = (p, c) => p.map((v) => v * c);
    const map = (p) => {
      const pp = p.slice();
      while (pp.length < n + 1) pp.unshift(0);
      let acc = [0];
      for (let k = 0; k <= n; k++) {
        if (Math.abs(pp[k]) < 1e-15) continue;
        acc = polyAdd(acc, scale(polyMul(pow([1, -1], n - k), pow([1, 1], k)), Math.pow(2 / T, n - k) * pp[k]));
      }
      return acc;
    };
    const nz = map(num), dz = map(den);
    if (!dz.length || Math.abs(dz[0]) < 1e-12) return { ok: false, note: '双线性变换分母退化（分子分母阶次异常）' };
    const d0 = dz[0];
    return { ok: true, n: nz.map((v) => v / d0), d: dz.map((v) => v / d0) };
  }

  return {
    pTrim, polyMul, polyAdd, polyDivMod, polyGCD, freduce,
    parseBlockTF, solveTransfer, deriveReadout,
    sToZ, zohDiscretize, deriveZReadout, analyzeSampled, solveSampled, tustin
  };
})();
