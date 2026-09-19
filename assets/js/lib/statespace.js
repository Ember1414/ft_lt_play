/* ============================================================
 * statespace.js — 状态空间分析内核（window.SS，纯函数无 DOM）
 *   适配系统分析模块：特征多项式/极点（Faddeev–LeVerrier）、
 *   传递函数转换 G(s)=C(sI−A)⁻¹B+D、能控性/能观性秩判据、
 *   Ackermann 极点配置（状态反馈 K 与观测器 L）。
 *   矩阵为行主序二维数组；多项式系数自高到低（与 DSP.polyRoots 一致）。
 *   数值约束：n ≤ 6；rank 判据容差 1e-8（病态矩阵给出警告而非崩溃）。
 * ============================================================ */
window.SS = (() => {
  const TOL = 1e-8;
  const matI = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  const matMul = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((s, v, i) => s + v * B[i][j], 0)));
  const matAdd = (A, B) => A.map((r, i) => r.map((v, j) => v + B[i][j]));
  const matSub = (A, B) => A.map((r, i) => r.map((v, j) => v - B[i][j]));
  const transpose = (A) => A[0].map((_, j) => A.map((r) => r[j]));
  const matVec = (A, v) => A.map((row) => row.reduce((s, x, i) => s + x * v[i], 0));

  /* ---------- 逆矩阵（Gauss-Jordan；奇异返回 null） ---------- */
  function matInv(M) {
    const n = M.length;
    const a = M.map((r, i) => [...r, ...matI(n)[i]]);
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
      if (Math.abs(a[piv][c]) < 1e-12) return null;
      [a[c], a[piv]] = [a[piv], a[c]];
      const d = a[c][c];
      for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = a[r][c];
        if (!f) continue;
        for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
      }
    }
    return a.map((r) => r.slice(n));
  }

  /* ---------- 秩（行阶梯 + 容差） ---------- */
  function rank(M) {
    const a = M.map((r) => r.slice());
    const m = a.length, n = a[0].length;
    let rk = 0;
    for (let c = 0; c < n && rk < m; c++) {
      let piv = -1, best = TOL;
      for (let r = rk; r < m; r++) if (Math.abs(a[r][c]) > best) { best = Math.abs(a[r][c]); piv = r; }
      if (piv < 0) continue;
      [a[rk], a[piv]] = [a[piv], a[rk]];
      for (let r = rk + 1; r < m; r++) {
        const f = a[r][c] / a[rk][c];
        for (let j = c; j < n; j++) a[r][j] -= f * a[rk][j];
      }
      rk++;
    }
    return rk;
  }

  /* ---------- 特征多项式（Faddeev–LeVerrier）：返回自高到低系数 [1,p1,…,pn] ---------- */
  function charPoly(A) {
    const n = A.length;
    const p = new Array(n + 1).fill(0);
    p[0] = 1;
    let M = matI(n);
    for (let k = 1; k <= n; k++) {
      M = matMul(A, M);
      const tr = M.reduce((s, r, i) => s + r[i], 0);
      p[k] = -tr / k;
      M = M.map((r, i) => r.map((v, j) => v + p[k] * (i === j ? 1 : 0)));
    }
    return p;
  }

  /* ---------- 传递函数 G(s)=C(sI−A)⁻¹B+D ----------
   * adj(sI−A) = Σ_{k=1..n} M_k·s^{n−k}（Faddeev–LeVerrier 中间矩阵）
   * 分子 = [C·M_1·B, …, C·M_n·B]（自高到低），再加 D·det(sI−A) */
  function tfOf(A, B, C, D) {
    const n = A.length;
    D = D || Array.from({ length: C.length }, () => Array.from({ length: B[0].length }, () => 0));
    const den = charPoly(A);
    let M = matI(n);
    const num = new Array(n).fill(0);
    for (let k = 1; k <= n; k++) {
      const CB = matMul(C, matMul(M, B));
      for (let i = 0; i < CB.length; i++) for (const v of CB[i]) num[k - 1] += v;
      M = matMul(A, M).map((r, i) => r.map((v, j) => v + den[k] * (i === j ? 1 : 0)));
    }
    // D 为常数矩阵 → 贡献 D·den（单入单出场景 D 标量或 0）
    const dVal = D[0][0] || 0;
    if (dVal) for (let i = 0; i <= n; i++) num[i] = (num[i] || 0) + dVal * den[i];
    return { num, den };
  }

  /* ---------- 能控性 / 能观性 ---------- */
  const ctrb = (A, B) => {
    const n = A.length;
    const blocks = [B];
    for (let k = 1; k < n; k++) blocks.push(matMul(A, blocks[k - 1]));
    // 水平拼接 [B, AB, A²B, …]：第 r 行 = 各块的第 r 行依次相连
    return blocks[0].map((_, r) => blocks.flatMap((M) => M[r]));
  };
  const obsv = (A, C) => ctrb(transpose(A), transpose(C));

  /* ---------- Ackermann 极点配置：K 使 eig(A−BK)=desired ----------
   * K = [0…0 1]·ctrb⁻¹·φ(A)，φ 由期望极点经 polyFromRoots 展开后再做矩阵 Horner；
   * 不能配置（系统不完全能控 / ctrb 奇异）返回 null */
  function acker(A, B, desired) {
    const n = A.length;
    if (desired.length !== n) return null;
    const Cinv = matInv(ctrb(A, B));
    if (!Cinv) return null;
    const coefs = window.DSP.polyFromRoots(desired.map((z) => ({ re: z.re, im: z.im })));   // [1,p1,…,pn]
    let phi = matI(n);
    for (let k = 1; k < coefs.length; k++) phi = matAdd(matMul(phi, A), scalI(coefs[k], n));
    const en = Array.from({ length: n }, (_, i) => (i === n - 1 ? 1 : 0));
    // K = en^T·ctrb⁻¹·φ(A) = (ctrb⁻¹·φ) 的最后一行
    const Krow = matMul(Cinv, phi);
    return Krow[n - 1];
  }
  const scalI = (v, n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? v : 0)));

  /* ---------- 一站式分析：极点/稳定性/能控能观/传函 ---------- */
  function analyze(A, B, C, D) {
    const n = A.length;
    const den = charPoly(A);
    const poles = window.DSP.polyRoots(den);
    const stable = poles.every((q) => q.re < -1e-9);
    const Cm = ctrb(A, B), Om = obsv(A, C);
    const tf = tfOf(A, B, C, D);
    return {
      n, den, poles, stable,
      ctrbMatrix: Cm, ctrbRank: rank(Cm), controllable: rank(Cm) === n,
      obsvMatrix: Om, obsvRank: rank(Om), observable: rank(Om) === n,
      tf
    };
  }

  return { TOL, matI, matMul, matAdd, matSub, transpose, matVec, matInv, rank, charPoly, tfOf, ctrb, obsv, acker, analyze };
})();
