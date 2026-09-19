/* ============================================================
 * odesolve.js — 方程求解内核（纯函数，无 DOM 依赖，Node 可测）
 *
 *   连续（s 域）：y^{(n)} + a_{n-1} y^{(n-1)} + … + a_0 y = f(t)
 *     L{y^{(k)}} = s^k Y − Σ_{m=0}^{k−1} s^{k−1−m} y^{(m)}(0)
 *     → Y(s) = (F(s) + P(s)) / A(s)，A(s)=Σa_k s^k，P(s)=初值多项式
 *     零输入 = P/A，零状态 = F/A（均为有理分式，数值通道互为独立验证）
 *
 *   离散（z 域）：Σ a_k y[n+k] = x[n]
 *     Z{y[n+k]} = z^k Y − Σ_{m=0}^{k−1} z^{k−m} y[m]
 *     → Y(z) = (X(z) + Q(z)) / D(z)，D(z)=Σa_k z^k，Q(z)=初值多项式
 *
 *   反变换复用 TR.partialFracGroups / texLaplaceGroups / invZ；
 *   数值通道：RK4（连续）、差分方程直接递推（离散）。
 *   多项式一律自高到低（与 BLKSOLVE/DSP 约定一致）。
 * ============================================================ */
window.ODE = (() => {
  const { pTrim, polyMul, polyAdd } = window.BLKSOLVE;
  const fact = (n) => { let r = 1; for (let k = 2; k <= n; k++) r *= k; return r; };
  const MAX_ORDER = 4;

  /* ================= LHS 解析（连续 / 离散共用骨架） ================= */
  // 拆项：[]/() 内的 +/- 不切分（y[n+2] − 1.5y[n+1] 等）；stripStar 时吞掉乘号
  function splitTerms(lhs, stripStar) {
    const terms = [];
    let cur = '', sign = 1, started = false, depth = 0;
    for (const ch of lhs) {
      if (ch === '[' || ch === '(') { depth++; cur += ch; continue; }
      if (ch === ']' || ch === ')') { depth--; cur += ch; continue; }
      if (depth === 0 && (ch === '+' || ch === '-')) {
        if (!started || cur === '') { if (ch === '-') sign = -sign; started = true; continue; }
        terms.push({ sign, t: cur });
        cur = ''; sign = ch === '-' ? -1 : 1;
        continue;
      }
      if (stripStar && depth > 0 && ch === '*') { cur += ch; continue; }
      if (stripStar && ch === '*') continue;
      cur += ch; started = true;
    }
    if (cur) terms.push({ sign, t: cur });
    return terms;
  }
  // 「y」项导数/移位阶：y''' / y[[k]] / y[k] / y(k) / y^(k) / yk / y[n+k] / y(n+k) → k
  function yOrder(rest) {
    if (!rest) return 0;
    if (/^['\u2019]+$/.test(rest)) return rest.length;
    const mk = rest.match(/^[\[(]n\+(\d)[\])]$/);
    if (mk) return +mk[1];
    if (/^[\[(]?n[\])]?$/.test(rest)) return 0;   // y[n] / y(n) / yn：零阶
    const bare = rest.replace(/[\[\]()\^\s]/g, '');
    if (/^\d$/.test(bare)) return +bare;
    return null;
  }
  function parseYTerms(lhs, variable) {
    const a = [];
    for (const { sign, t } of splitTerms(lhs, true)) {
      const m = t.match(/^(\d+(?:\.\d+)?)?(y)(.*)$/i);
      if (!m || m[2].toLowerCase() !== variable) return { ok: false, note: `左端含无法识别的项「${t}」（每项须为 c·${variable} 的各阶导数/移位）` };
      const k = yOrder(m[3].replace(/^\*/, ''));
      if (k == null) return { ok: false, note: `左端含无法识别的项「${t}」` };
      if (k > MAX_ORDER) return { ok: false, note: `最高支持 ${MAX_ORDER} 阶` };
      a[k] = (a[k] || 0) + sign * (m[1] ? parseFloat(m[1]) : 1);
    }
    // 保留最高非零阶
    let n = a.length - 1;
    while (n >= 0 && !a[n]) n--;
    if (n < 0) return { ok: false, note: '未找到 ' + variable + ' 项' };
    return { ok: true, n, a: a.slice(0, n + 1).map((v) => v || 0) };
  }
  function parseRhs(rhsStr, comboFn, what) {
    const s = rhsStr.trim();
    if (!s || s === '0') return { ok: true, items: [] };
    const items = comboFn(s);
    if (!items) return { ok: false, note: `右端 ${what} 无法解析：支持 c*exp(-a*t)*u(t)、c*sin(w*t)、c*t^n、u(t) 等线性组合（离散侧为 0.5^n*u(n)、n、cos(w*n)、u(n)、delta(n) 等）` };
    return { ok: true, items };
  }

  /* ================= 有理分式小工具（items → N/D，自高到低） ================= */
  const polyPow = (p, k) => { let o = [1]; for (let i = 0; i < k; i++) o = polyMul(o, p); return o; };
  function itemFracS(it) {
    const c = it.coef * it.sign;
    switch (it.kind) {
      case 'exp': return { n: [c], d: [1, it.a] };
      case 'texp': return { n: [c * fact(it.n)], d: polyPow([1, it.a], it.n + 1) };
      case 'sin': return { n: [c * it.w], d: [1, 0, it.w * it.w] };
      case 'cos': return { n: [c, 0], d: [1, 0, it.w * it.w] };
      case 'tpow': return { n: [c * fact(it.n)], d: polyPow([1, 0], it.n + 1) };
      case 'u': case 'const': return { n: [c], d: [1, 0] };
    }
    return { n: [0], d: [1] };
  }
  function itemFracZ(it) {
    const c = it.coef * it.sign;
    switch (it.kind) {
      case 'an': return { n: [c, 0], d: [1, -it.a] };
      case 'nan': return { n: [c * it.a, 0], d: [1, -2 * it.a, it.a * it.a] };
      case 'n': return { n: [c, 0], d: [1, -2, 1] };
      case 'np2': return { n: [c, c, 0], d: [1, -3, 3, -1] };
      case 'zn': return { n: [c, -c * Math.cos(it.w), 0], d: [1, -2 * Math.cos(it.w), 1] };
      case 'zsn': return { n: [c * Math.sin(it.w), 0], d: [1, -2 * Math.cos(it.w), 1] };
      case 'un': case 'const': return { n: [c, 0], d: [1, -1] };
      case 'delta': return { n: [c], d: [1] };
    }
    return { n: [0], d: [1] };
  }
  // Σ ni/di → 单个 N/D（逐项通分折叠）
  function combineFracs(items, fracOf) {
    let N = [0], D = [1];
    for (const it of items) {
      const f = fracOf(it);
      N = pTrim(polyAdd(polyMul(N, f.d), polyMul(f.n, D)));
      D = pTrim(polyMul(D, f.d));
    }
    return { n: pTrim(N), d: pTrim(D) };
  }
  const isZeroPoly = (p) => !p.length || (p.length === 1 && Math.abs(p[0]) < 1e-12);

  /* ================= 连续：parseODE / solveODE / RK4 ================= */
  function parseODE(str) {
    const s = U.normChars(str);
    const eq = s.indexOf('=');
    if (eq < 0) return { ok: false, note: '缺少等号「=」（左端 y 各阶项，右端 f(t)）' };
    const lhs = s.slice(0, eq).replace(/\s+/g, '');
    if (!lhs) return { ok: false, note: '等号左端为空' };
    const py = parseYTerms(lhs, 'y');
    if (!py.ok) return py;
    if (py.n < 1) return { ok: false, note: '至少需要一阶（含 y\' 或更高阶项）' };
    const pr = parseRhs(s.slice(eq + 1), TR.parseTimeCombo.bind(TR), 'f(t)');
    if (!pr.ok) return pr;
    return { ok: true, n: py.n, a: py.a, rhsItems: pr.items };
  }

  function solveODE(a, rhsItems, ics) {
    const n = a.length - 1;
    if (n < 1) return { ok: false, note: '至少需要一阶' };
    if (Math.abs(a[n]) < 1e-12) return { ok: false, note: '最高阶系数不能为 0' };
    const given = (ics || []).filter((v) => v != null && isFinite(+v)).length;
    const ic = [];
    for (let m = 0; m < n; m++) ic.push(ics && isFinite(+ics[m]) ? +ics[m] : 0);
    const note = given < n ? `初值不足 ${n} 个，缺省按 0 补零` : null;

    const A = pTrim(a.slice().reverse());
    // 初值多项式 P(s)：L{y^(k)} = s^k Y − Σ s^{k−1−m} y^(m)(0)
    const Pasc = new Array(n).fill(0);
    for (let k = 1; k <= n; k++)
      for (let m = 0; m < k; m++) Pasc[k - 1 - m] += a[k] * ic[m];
    const P = pTrim(Pasc.slice().reverse());

    const F = combineFracs(rhsItems || [], itemFracS);
    // Y_full = (N_F + P·D_F) / (D_F·A)；Y_zs = N_F/(D_F·A)；Y_zi = P/A
    const denFA = pTrim(polyMul(F.d, A));
    const Nfull = pTrim(polyAdd(F.n, polyMul(P, F.d)));

    const poles = DSP.polyRoots(A);
    const hasOut = poles.some((p) => p.re > 1e-9);
    const hasJw = poles.some((p) => Math.abs(p.re) <= 1e-9);
    const stableText = hasOut ? '不稳定（存在右半平面极点）' : hasJw ? '临界稳定（存在虚轴极点）' : '稳定（全部极点在左半平面）';

    const mk = (num, den, prefix) => {
      if (isZeroPoly(num)) return { tex: prefix + '0', evalT: () => 0 };
      const pf = TR.partialFracGroups(num, den);
      if (!pf.ok) return { tex: null, note: pf.note, evalT: null };
      return { tex: TR.texLaplaceGroups(pf.groups, prefix), evalT: (t) => TR.evalLaplaceGroups(pf.groups, t) };
    };
    return {
      ok: true, n, A, P, F,
      zi: mk(P, A, 'y_{zi}(t)='),
      zs: mk(F.n, denFA, 'y_{zs}(t)='),
      full: mk(Nfull, denFA, 'y(t)='),
      poles, stableText, note
    };
  }

  // RK4 数值仿真：x = [y, y', …, y^{(n-1)}]
  function simulateODE(a, rhsFn, ics, t0, t1, N) {
    const n = a.length - 1;
    if (n < 1 || Math.abs(a[n]) < 1e-12) return null;
    const x = [];
    for (let m = 0; m < n; m++) x.push(ics && isFinite(+ics[m]) ? +ics[m] : 0);
    const deriv = (t, xv) => {
      const out = [];
      for (let i = 0; i < n - 1; i++) out.push(xv[i + 1]);
      let acc = rhsFn ? rhsFn(t) : 0;
      for (let k = 0; k < n; k++) acc -= a[k] * xv[k];
      out.push(acc / a[n]);
      return out;
    };
    const h = (t1 - t0) / N;
    const tArr = [], yArr = [];
    let t = t0;
    for (let i = 0; i <= N; i++) {
      tArr.push(t); yArr.push(x[0]);
      const k1 = deriv(t, x);
      const k2 = deriv(t + h / 2, x.map((v, j) => v + h / 2 * k1[j]));
      const k3 = deriv(t + h / 2, x.map((v, j) => v + h / 2 * k2[j]));
      const k4 = deriv(t + h, x.map((v, j) => v + h * k3[j]));
      for (let j = 0; j < n; j++) x[j] += h / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]);
      t = t0 + (i + 1) * h;
    }
    return { t: tArr, y: yArr };
  }

  /* ================= 离散：parseDiffEq / solveDiffEq / 递推 ================= */
  function parseDiffEq(str) {
    const s = U.normChars(str);
    const eq = s.indexOf('=');
    if (eq < 0) return { ok: false, note: '缺少等号「=」（左端 y[n+k] 各项，右端 x[n]）' };
    const lhs = s.slice(0, eq).replace(/\s+/g, '');
    if (!lhs) return { ok: false, note: '等号左端为空' };
    const py = parseYTerms(lhs, 'y');
    if (!py.ok) return py;
    if (py.n < 1) return { ok: false, note: '至少需要一阶（含 y[n+1] 或更高阶项）' };
    const pr = parseRhs(s.slice(eq + 1), TR.parseZCombo.bind(TR), 'x[n]');
    if (!pr.ok) return pr;
    return { ok: true, n: py.n, a: py.a, rhsItems: pr.items };
  }

  function solveDiffEq(a, rhsItems, ics) {
    const n = a.length - 1;
    if (n < 1) return { ok: false, note: '至少需要一阶' };
    if (Math.abs(a[n]) < 1e-12) return { ok: false, note: '最高阶系数不能为 0' };
    const given = (ics || []).filter((v) => v != null && isFinite(+v)).length;
    const ic = [];
    for (let m = 0; m < n; m++) ic.push(ics && isFinite(+ics[m]) ? +ics[m] : 0);
    const note = given < n ? `初值不足 ${n} 个，缺省按 0 补零` : null;

    const D = pTrim(a.slice().reverse());
    // 初值多项式 Q(z)：Z{y[n+k]} = z^k Y − Σ z^{k−m} y[m]
    const Qasc = new Array(n + 1).fill(0);
    for (let k = 1; k <= n; k++)
      for (let m = 0; m < k; m++) Qasc[k - m] += a[k] * ic[m];
    const Q = pTrim(Qasc.slice().reverse());

    const X = combineFracs(rhsItems || [], itemFracZ);
    const denXD = pTrim(polyMul(X.d, D));
    const Nfull = pTrim(polyAdd(X.n, polyMul(Q, X.d)));

    const poles = DSP.polyRoots(D);
    const maxMod = poles.reduce((mx, p) => Math.max(mx, Math.hypot(p.re, p.im)), 0);
    const stableText = maxMod > 1 + 1e-9 ? '不稳定（存在单位圆外极点）'
      : maxMod > 1 - 1e-9 ? '临界（存在单位圆上极点）' : '稳定（全部极点在单位圆内）';

    const mk = (num, den, prefix) => {
      if (isZeroPoly(num)) return { tex: prefix + '0', evalN: () => 0 };
      const r = TR.invZ(num, den);
      if (!r.tex) return { tex: null, note: r.note, evalN: null };
      // invZ 固定输出 h(n)=…：替换为对应响应名（保持同一求值器）
      return { tex: r.tex.replace('h(n)=', prefix), evalN: r.evalN };
    };
    return {
      ok: true, n, D, Q, X,
      zi: mk(Q, D, 'y_{zi}(n)='),
      zs: mk(X.n, denXD, 'y_{zs}(n)='),
      full: mk(Nfull, denXD, 'y(n)='),
      poles, stableText, note
    };
  }

  // 差分方程直接递推：y[0..n-1] 取初值，其余由 Σ a_k y[m+k] = x[m] 逐拍推出
  function recurDiff(a, ics, xFn, N) {
    const n = a.length - 1;
    const y = [];
    for (let m = 0; m < n; m++) y.push(ics && isFinite(+ics[m]) ? +ics[m] : 0);
    for (let m = 0; m + n <= N; m++) {
      let acc = xFn ? xFn(m) : 0;
      for (let k = 0; k < n; k++) acc -= a[k] * y[m + k];
      y.push(acc / a[n]);
    }
    return y;
  }

  /* ================= 数据序列粘贴解析 ================= */
  function parseDataSeq(str) {
    const s = U.normChars(str).trim();
    if (!s) return { ok: false, note: '没有数据' };
    const toks = s.split(/[,;、\s]+/).filter((t) => t);
    const values = [];
    for (const t of toks) {
      const v = Number(t);
      if (!isFinite(v)) return { ok: false, badToken: t, note: `无法识别的数据「${t}」` };
      values.push(v);
    }
    if (!values.length) return { ok: false, note: '没有数据' };
    return { ok: true, values };
  }

  return { parseODE, solveODE, simulateODE, parseDiffEq, solveDiffEq, recurDiff, parseDataSeq };
})();
