/* ============================================================
 * transforms.js — 符号变换引擎（共享）
 *   连续：parseTimeCombo → Laplace F(s) / Fourier F(jω)；invLaplace 反变换
 *   离散：parseZCombo   → Z 变换 X(z)；invZ 反变换
 *   全部输出 KaTeX 字符串 + ROC + 数值自检
 * ============================================================ */
window.TR = (() => {
  const fact = (n) => { let r = 1; for (let k = 2; k <= n; k++) r *= k; return r; };
  const num2tex = (v) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(4)));
  const fmtC2 = (v) => (Math.abs(v) < 1e-12 ? '0' : num2tex(+v.toFixed(4)));
  // 三位小数幅值（符号由调用方处理）
  const fmt3 = (v) => { const x = Math.abs(v) < 5e-4 ? 0 : +v.toFixed(3); return String(x); };

  /* ================= 连续时域组合（因果信号） ================= */
  // 语法：项用 + - 连接；项：[c*]exp(-a*t)[*u(t)] | [c*]sin(w*t)[*u(t)] | [c*]cos(w*t)[*u(t)]
  //       | [c*]t^n[*u(t)] | [c*]t^n*exp(-a*t)[*u(t)] | [c*]u(t) | 常数 c
  function parseTimeCombo(str) {
    const s = lenient(String(str || ''));
    if (!s) return null;
    const items = [];
    let i = 0;
    while (i < s.length) {
      let sign = 1;
      if (s[i] === '+') i++;
      else if (s[i] === '-') { sign = -1; i++; }
      if (i >= s.length) return null;
      let coef = 1;
      const m = s.slice(i).match(/^(\d+(?:\.\d+)?)/);
      if (m) {
        coef = parseFloat(m[1]);
        i += m[1].length;
        if (s[i] === '*') i++;
        if (i >= s.length || s[i] === '+' || s[i] === '-') { items.push({ sign, coef, kind: 'const' }); continue; }
      }
      const rest = s.slice(i);
      let mt;
      if ((mt = rest.match(/^t\^(\d+)\*?exp\(-(?:(\d+(?:\.\d+)?)\*?)?t\)/))) items.push({ sign, coef, kind: 'texp', n: +mt[1], a: mt[2] ? +mt[2] : 1 }), i += mt[0].length;
      else if ((mt = rest.match(/^exp\(-(?:(\d+(?:\.\d+)?)\*?)?t\)/))) items.push({ sign, coef, kind: 'exp', a: mt[1] ? +mt[1] : 1 }), i += mt[0].length;
      else if ((mt = rest.match(/^sin\(([0-9pi+\-*/.()]+)\*?t\)/))) { const w = evalW(mt[1]); if (!isFinite(w)) return null; items.push({ sign, coef, kind: 'sin', w }); i += mt[0].length; }
      else if ((mt = rest.match(/^cos\(([0-9pi+\-*/.()]+)\*?t\)/))) { const w = evalW(mt[1]); if (!isFinite(w)) return null; items.push({ sign, coef, kind: 'cos', w }); i += mt[0].length; }
      else if ((mt = rest.match(/^t\^(\d+)/))) items.push({ sign, coef, kind: 'tpow', n: +mt[1] }), i += mt[0].length;
      else if ((mt = rest.match(/^t(?![a-z(])/))) items.push({ sign, coef, kind: 'tpow', n: 1 }), i += 1;   // 裸 t = t¹
      else if ((mt = rest.match(/^u\(t\)/))) items.push({ sign, coef, kind: 'u' }), i += mt[0].length;
      else return null;
      if (s.slice(i).startsWith('*u(t)')) i += 5;
      else if (s.slice(i).startsWith('u(t)')) i += 4;
    }
    return items.length ? items : null;
  }
  function evalW(txt) {
    txt = txt.replace(/\*+$/, '');   // 去掉正则贪婪吞下的尾部孤儿 '*'
    try { return U.safeCalc(txt); } catch (e) { return NaN; }   // 白名单求值（曾用 Function 动态执行）
  }
  // 宽松预处理：全角符号、unicode 上标、^{...}、数字与字母/括号间隐式乘号（0.5^n 不受影响）
  function lenient(s) {
    // 入口归一化：全角字符/负号变体 → 半角（U.normChars，含 ** → ^），先于其余宽松改写
    return U.normChars(s).replace(/\s+/g, '')
      .replace(/e\^\{([^}]*)\}/g, 'exp($1)')   // e^{-2t} → exp(-2t)（须先于 ^{...} 归一化）
      .replace(/e\^\(/g, 'exp(')
      .replace(/−/g, '-').replace(/×/g, '*').replace(/·/g, '*').replace(/÷/g, '/')
      .replace(/π/g, 'pi')
      .replace(/⁰/g, '^0').replace(/¹/g, '^1').replace(/²/g, '^2').replace(/³/g, '^3')
      .replace(/⁴/g, '^4').replace(/⁵/g, '^5').replace(/⁶/g, '^6')
      .replace(/\^\{([^}]*)\}/g, '^$1')
      .replace(/(\d)([a-df-z(])/g, '$1*$2');   // 3t、2sin(、5u( 等；不动 0.5^n
  }

  const timeCoreTex = (it) => {
    const c = it.coef === 1 ? '' : num2tex(it.coef);
    switch (it.kind) {
      case 'exp': return `${c}e^{-${num2tex(it.a)}t}u(t)`;
      case 'texp': return `${c}t^{${it.n}}e^{-${num2tex(it.a)}t}u(t)`;
      case 'sin': return `${c}\\sin(${num2tex(it.w)}t)u(t)`;
      case 'cos': return `${c}\\cos(${num2tex(it.w)}t)u(t)`;
      case 'tpow': return `${c}t^{${it.n}}u(t)`;
      case 'u': return `${c}u(t)`;
      case 'const': return num2tex(it.coef);
    }
    return '';
  };
  const itemLapTex = (it) => {
    const s = it.sign < 0 ? '-' : '', c = it.coef === 1 ? '' : num2tex(it.coef) + '\\cdot';
    switch (it.kind) {
      case 'exp': return `${s}\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef)}}{s+${num2tex(it.a)}}`;
      case 'texp': return `${s}\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef)}\\cdot${fact(it.n)}}{(s+${num2tex(it.a)})^{${it.n + 1}}}`;
      case 'sin': return `${s}\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef) + '\\cdot'}${num2tex(it.w)}}{s^{2}+${num2tex(it.w * it.w)}}`;
      case 'cos': return `${s}\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef) + '\\cdot'}s}{s^{2}+${num2tex(it.w * it.w)}}`;
      case 'tpow': return `${s}\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef) + '\\cdot'}${fact(it.n)}}{s^{${it.n + 1}}}`;
      case 'u': case 'const': return `${s}\\dfrac{${num2tex(it.coef)}}{s}`;
    }
    return '';
  };
  function laplaceOfItems(items) {
    const fLine = 'f(t)=' + timeCoreTex(items[0]) + items.slice(1).map((it) => (it.sign < 0 ? '-' : '+') + timeCoreTex(it)).join('');
    const fsLine = 'F(s)=' + items.map(itemLapTex).join('').replace(/^\+/, '');
    // ROC：最右极点（sin/cos/t²/u/const 极点在 0）
    let right = -Infinity;
    for (const it of items) {
      if (it.kind === 'exp') right = Math.max(right, -it.a);
      else if (it.kind === 'texp') right = Math.max(right, -it.a);
      else right = Math.max(right, 0);
    }
    const rocTex = '\\operatorname{ROC}:\\ \\operatorname{Re}(s)>' + num2tex(right === -Infinity ? 0 : right);
    const hasOsc = items.some((it) => ['sin', 'cos', 'tpow', 'u', 'const'].includes(it.kind));
    return { fLine, fsLine, rocTex, hasOsc, right };
  }
  function fourierOfItems(items) {
    const parts = [];
    let imp = false;
    for (const it of items) {
      const c = it.coef * it.sign;
      switch (it.kind) {
        case 'exp': parts.push(`\\dfrac{${num2tex(c)}}{${num2tex(it.a)}+j\\omega}`); break;
        case 'texp': parts.push(`\\dfrac{${num2tex(c * fact(it.n))}}{(${num2tex(it.a)}+j\\omega)^{${it.n + 1}}}`); break;
        case 'sin': parts.push(`\\dfrac{\\pi${num2tex(c / 2)}}{j}\\left[\\delta(\\omega-${num2tex(it.w)})-\\delta(\\omega+${num2tex(it.w)})\\right]`); imp = true; break;
        case 'cos': parts.push(`\\dfrac{\\pi${num2tex(c / 2)}}{1}\\left[\\delta(\\omega-${num2tex(it.w)})+\\delta(\\omega+${num2tex(it.w)})\\right]`.replace('\\dfrac{\\pi' + num2tex(c / 2) + '}{1}', num2tex(c / 2) + '\\pi')); imp = true; break;
        case 'tpow': parts.push(`\\dfrac{${num2tex(c * fact(it.n))}}{(j\\omega)^{${it.n + 1}}}+\\pi j^{${it.n}}${num2tex(c)}\\delta^{(${it.n})}(\\omega)`); imp = true; break;
        case 'u': case 'const': parts.push(`${num2tex(c)}\\pi\\delta(\\omega)+\\dfrac{${num2tex(c)}}{j\\omega}`); imp = true; break;
      }
    }
    const tex = 'F(j\\omega)=' + parts.join('+').replace(/\+-/g, '-');
    return { tex, imp };
  }
  const fNumeric = (items, t) => (t < 0 ? 0 : items.reduce((acc, it) => {
    const v = it.coef * it.sign;
    switch (it.kind) {
      case 'exp': return acc + v * Math.exp(-it.a * t);
      case 'texp': return acc + v * Math.pow(t, it.n) * Math.exp(-it.a * t);
      case 'sin': return acc + v * Math.sin(it.w * t);
      case 'cos': return acc + v * Math.cos(it.w * t);
      case 'tpow': return acc + v * Math.pow(t, it.n);
      case 'u': case 'const': return acc + v;
    }
    return acc;
  }, 0));
  const FsNumeric = (items, sv) => items.reduce((acc, it) => {
    const v = it.coef * it.sign;
    switch (it.kind) {
      case 'exp': return acc + v / (sv + it.a);
      case 'texp': return acc + (v * fact(it.n)) / Math.pow(sv + it.a, it.n + 1);
      case 'sin': return acc + (v * it.w) / (sv * sv + it.w * it.w);
      case 'cos': return acc + (v * sv) / (sv * sv + it.w * it.w);
      case 'tpow': return acc + (v * fact(it.n)) / Math.pow(sv, it.n + 1);
      case 'u': case 'const': return acc + v / sv;
    }
    return acc;
  }, 0);

  /* ================= 离散序列组合（因果序列） ================= */
  // 语法：项：[c*]a^n*u[n] | [c*]n*u[n] | [c*]n*a^n[*u[n]] | [c*]cos(w*n)[*u[n]] | [c*]sin(w*n)[*u[n]]
  //       | [c*]u[n] | [c*]delta[n]（或 d[n]）| 常数 c（按 c·u[n] 处理）
  function parseZCombo(str) {
    const s = lenient(String(str || '')).replace(/\[/g, '(').replace(/\]/g, ')').replace(/δ/g, 'delta');
    if (!s) return null;
    const items = [];
    let i = 0;
    while (i < s.length) {
      let sign = 1;
      if (s[i] === '+') i++;
      else if (s[i] === '-') { sign = -1; i++; }
      if (i >= s.length) return null;
      let coef = 1;
      const m = s.slice(i).match(/^(\d+(?:\.\d+)?)/);
      if (m) {
        coef = parseFloat(m[1]);
        i += m[1].length;
        if (s[i] === '*') i++;
        if (i >= s.length || s[i] === '+' || s[i] === '-') { items.push({ sign, coef, kind: 'un' }); continue; }
        // 数字后紧跟 ^n → 该数字为几何底数（0.5^n 写法）
        if (s[i] === '^') {
          const mm = s.slice(i).match(/^\^n(\*u\(n\))?/);
          if (!mm) return null;
          items.push({ sign, coef: 1, kind: 'an', a: coef });
          i += mm[0].length;
          continue;
        }
      }
      const rest = s.slice(i);
      let mt;
      if ((mt = rest.match(/^delta\(n\)/))) items.push({ sign, coef, kind: 'delta' }), i += mt[0].length;
      else if ((mt = rest.match(/^n\^2(\*u\(n\))?/))) items.push({ sign, coef, kind: 'np2' }), i += mt[0].length;
      else if ((mt = rest.match(/^n\*(\d+(?:\.\d+)?)\^n(\*u\(n\))?/))) items.push({ sign, coef, kind: 'nan', a: +mt[1] }), i += mt[0].length;
      else if ((mt = rest.match(/^n\*a\^(\d+(?:\.\d+)?)/))) items.push({ sign, coef, kind: 'nan', a: +mt[1] }), i += mt[0].length;
      else if ((mt = rest.match(/^n(\*u\(n\))?/)) && !rest.startsWith('na')) items.push({ sign, coef, kind: 'n' }), i += mt[0].length;
      else if ((mt = rest.match(/^a\^(\d+(?:\.\d+)?)/))) items.push({ sign, coef, kind: 'an', a: +mt[1] }), i += mt[0].length;
      else if ((mt = rest.match(/^cos\(([0-9pi+\-*/.()]+)\*?n\)/))) items.push({ sign, coef, kind: 'zn', w: evalW(mt[1]) }), i += mt[0].length;
      else if ((mt = rest.match(/^sin\(([0-9pi+\-*/.()]+)\*?n\)/))) items.push({ sign, coef, kind: 'zsn', w: evalW(mt[1]) }), i += mt[0].length;
      else if ((mt = rest.match(/^u\(n\)/))) items.push({ sign, coef, kind: 'un' }), i += mt[0].length;
      else return null;
      if (s.slice(i).startsWith('*u(n)')) i += 5;
      else if (s.slice(i).startsWith('u(n)')) i += 4;
    }
    return items.length ? items : null;
  }
  const zCoreTex = (it) => {
    const c = it.coef === 1 ? '' : num2tex(it.coef);
    switch (it.kind) {
      case 'an': return `${c}${num2tex(it.a)}^{n}u(n)`;
      case 'nan': return `${c}n\\,${num2tex(it.a)}^{n}u(n)`;
      case 'np2': return `${c}n^{2}u(n)`;
      case 'n': return `${c}n\\,u(n)`;
      case 'zn': return `${c}\\cos(${num2tex(it.w)}n)u(n)`;
      case 'zsn': return `${c}\\sin(${num2tex(it.w)}n)u(n)`;
      case 'un': return `${c}u(n)`;
      case 'delta': return `${it.coef === 1 ? '' : num2tex(it.coef)}\\delta(n)`;
      case 'const': return num2tex(it.coef) + 'u(n)';
    }
    return '';
  };
  const itemZTex = (it) => {
    const s = it.sign < 0 ? '-' : '';
    switch (it.kind) {
      case 'an': return it.a === 0 ? `${s}${num2tex(it.coef)}` : `${s}\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef) + '\\cdot'}z}{z-${num2tex(it.a)}}`;
      case 'nan': return `${s}\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef) + '\\cdot'}${num2tex(it.a)}z}{(z-${num2tex(it.a)})^{2}}`;
      case 'n': return `${s}\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef) + '\\cdot'}z}{(z-1)^{2}}`;
      case 'np2': return `${s}\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef) + '\\cdot'}z(z+1)}{(z-1)^{3}}`;
      case 'zn': return `${s}\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef) + '\\cdot'}z(z-\\cos ${num2tex(it.w)})}{z^{2}-2z\\cos ${num2tex(it.w)}+1}`;
      case 'zsn': return `${s}\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef) + '\\cdot'}z\\sin ${num2tex(it.w)}}{z^{2}-2z\\cos ${num2tex(it.w)}+1}`;
      case 'un': return `${s}\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef) + '\\cdot'}z}{z-1}`;
      case 'delta': return `${s}${num2tex(it.coef)}`;
      case 'const': return `${s}\\dfrac{${num2tex(it.coef)}z}{z-1}`;
    }
    return '';
  };
  function zOfItems(items) {
    const xLine = 'x(n)=' + zCoreTex(items[0]) + items.slice(1).map((it) => (it.sign < 0 ? '-' : '+') + zCoreTex(it)).join('');
    const zLine = 'X(z)=' + items.map(itemZTex).join('').replace(/^\+/, '');
    let roc = 0;
    for (const it of items) {
      if (it.kind === 'an' || it.kind === 'nan') roc = Math.max(roc, Math.abs(it.a));
      else if (it.kind === 'np2') roc = Math.max(roc, 1);
      else if (it.kind !== 'delta') roc = Math.max(roc, 1);
    }
    return { xLine, zLine, rocTex: `\\text{ROC}: |z|>${roc === 0 ? '0' : num2tex(roc)}`, roc };
  }
  const xNumeric = (items, n) => (n < 0 ? 0 : items.reduce((acc, it) => {
    const v = it.coef * it.sign;
    switch (it.kind) {
      case 'an': return acc + (n === 0 && it.a === 0 ? v : v * Math.pow(it.a, n));
      case 'nan': return acc + v * n * Math.pow(it.a, n);
      case 'n': return acc + v * n;
      case 'np2': return acc + v * n * n;
      case 'zn': return acc + v * Math.cos(it.w * n);
      case 'zsn': return acc + v * Math.sin(it.w * n);
      case 'un': return acc + v;
      case 'delta': return acc + (n === 0 ? v : 0);
      case 'const': return acc + v;
    }
    return acc;
  }, 0));
  const XzNumeric = (items, z, roc, N = 400) => {
    // X(z) = Σ x[n] z^{-n}（因果序列截断求和）
    let sum = 0;
    for (let n = 0; n < N; n++) {
      const xn = xNumeric(items, n);
      if (Math.abs(z) > roc) sum += xn * Math.pow(z, -n);
    }
    return sum;
  };

  /* ================= 反变换 ================= */
  /* ---------- 重极点部分分式引擎 ----------
     把真分式 N/D 展开为 Σ_p Σ_{k=1..m_p} A_{p,k}/(s−p)^{k}，支持任意重极点。
     方法：对每个极点 p（重数 m）：D_rest = D/(s−p)^m（复数综合除法），
     N/D_rest 在 p 处的泰勒系数（反复综合除法）做级数除法，A_k = c_{m−k}。
     返回 groups: [{ p:{re,im}, m, A:[A1..Am](复数), pair:bool }]，direct 为直通项系数。 */
  const cAdd = (a, b) => ({ re: a.re + b.re, im: a.im + b.im });
  const cSub2 = (a, b) => ({ re: a.re - b.re, im: a.im - b.im });
  const cMul2 = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
  const cDiv2 = (a, b) => { const d = b.re * b.re + b.im * b.im || 1e-300; return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }; };
  // 综合除法：P(s) ÷ (s−p)，返回商（自高到低），余数丢弃
  function synthDiv(P, p) {
    let b = { re: P[0].re, im: P[0].im };
    const q = [];
    for (let i = 1; i < P.length; i++) {
      q.push({ re: b.re, im: b.im });
      b = { re: P[i].re + b.re * p.re - b.im * p.im, im: P[i].im + b.re * p.im + b.im * p.re };
    }
    return q;
  }
  // 多项式在 p 处泰勒系数（升幂 c0..c_{order−1}）：反复综合除法取余数
  function taylorAt(P, p, order) {
    const out = [];
    let cur = P.map((c) => ({ re: c.re, im: c.im }));
    for (let i = 0; i < order; i++) {
      let b = { re: cur[0].re, im: cur[0].im };
      const q = [];
      for (let j = 1; j < cur.length; j++) {
        q.push({ re: b.re, im: b.im });
        b = { re: cur[j].re + b.re * p.re - b.im * p.im, im: cur[j].im + b.re * p.im + b.im * p.re };
      }
      out.push({ re: b.re, im: b.im });
      cur = q;
      if (!cur.length) { while (out.length < order) out.push({ re: 0, im: 0 }); break; }
    }
    return out;
  }
  function partialFracGroups(num, den) {
    const d0 = den[0];
    if (!isFinite(d0) || Math.abs(d0) < 1e-12) return { ok: false, note: '分母首项系数为 0' };
    const D = den.map((c) => c / d0);
    let N = num.map((c) => c / d0);
    while (N.length < D.length) N.unshift(0);
    let direct = 0;
    if (N.length === D.length && Math.abs(N[0]) > 1e-12) {
      direct = N[0];
      N = N.map((c, i) => c - D[i] * direct);
    }
    while (N.length && Math.abs(N[0]) < 1e-12) N.shift();
    if (!N.length) return { ok: true, groups: [], direct };
    const poles = DSP.polyRoots(D);
    // 按位置分组（重根 → 重数）
    const tol = 1e-3;
    const raw = [];
    for (const q of poles) {
      const g = raw.find((g0) => Math.hypot(g0.p.re - q.re, g0.p.im - q.im) < tol);
      if (g) g.m++;
      else raw.push({ p: { re: q.re, im: q.im }, m: 1 });
    }
    // 共轭配对检查
    for (const g of raw) {
      if (g.p.im > tol && !raw.some((h) => h !== g && Math.abs(h.p.re - g.p.re) < tol && Math.abs(h.p.im + g.p.im) < tol))
        return { ok: false, note: '存在非共轭复根（系数非实？）' };
    }
    const groups = [];
    for (const g of raw) {
      if (g.p.im < -tol) continue;               // 共轭成员由 pair 组代表
      const rest = D.map((c) => ({ re: c, im: 0 }));
      let dr = rest;
      for (let it = 0; it < g.m; it++) dr = synthDiv(dr, g.p);
      const a = taylorAt(N.map((c) => ({ re: c, im: 0 })), g.p, g.m);
      const b = taylorAt(dr, g.p, g.m);
      const c = [];
      for (let i = 0; i < g.m; i++) {
        let acc = { re: a[i].re, im: a[i].im };
        for (let j = 0; j < i; j++) acc = cSub2(acc, cMul2(c[j], b[i - j]));
        c.push(cDiv2(acc, b[0]));
      }
      // c_i 是 (s−p)^i 的系数 → A_k（1/(s−p)^k 的系数）= c_{m−k}，反转对齐
      c.reverse();
      groups.push({ p: g.p, m: g.m, A: c, pair: g.p.im > tol });
    }
    return { ok: true, groups, direct };
  }
  // f(t) 数值：Σ_p Σ_k A_k t^{k−1} e^{pt}/(k−1)!（共轭组自动成对取实）
  function evalLaplaceGroups(groups, t) {
    let acc = 0;
    for (const g of groups) {
      const et = Math.exp(g.p.re * t);
      let sr = 0, si = 0;
      for (let k = 1; k <= g.m; k++) {
        const A = g.A[k - 1];
        const sc = Math.pow(t, k - 1) / fact(k - 1) * et;
        const wr = g.p.im * t, cr = Math.cos(wr), ci = Math.sin(wr);
        const ar = A.re * sc, ai = A.im * sc;
        sr += ar * cr - ai * ci;
        si += ar * ci + ai * cr;
      }
      acc += sr;
    }
    return acc;
  }
  // h(n) 数值（n≥1）：Σ_p Σ_k A_k·C(n−1,k−1)·p^{n−k}
  function evalZGroups(groups, n) {
    if (n < 1) return 0;
    const x = n - 1;
    let acc = 0;
    for (const g of groups) {
      let sr = 0, si = 0;
      for (let k = 1; k <= g.m; k++) {
        // C(x, k−1)：x < k−1 时为 0
        if (x < k - 1) continue;
        let c = 1;
        for (let j = 1; j <= k - 1; j++) c = c * (x - j + 1) / j;
        const pw = Math.pow(Math.hypot(g.p.re, g.p.im), n - k);
        const th = Math.atan2(g.p.im, g.p.re) * (n - k);
        const pr = pw * Math.cos(th), pi = pw * Math.sin(th);
        sr += g.A[k - 1].re * c * pr - g.A[k - 1].im * c * pi;
        si += g.A[k - 1].re * c * pi + g.A[k - 1].im * c * pr;
      }
      acc += sr;
    }
    return acc;
  }
  // 升幂实系数 → 降幂 tex（变量名 vn）
  function texPolyAsc(c, vn) {
    const parts = [];
    for (let i = c.length - 1; i >= 0; i--) {
      const a = c[i];
      if (Math.abs(a) < 1e-9) continue;
      const pw = i;
      const sgn = parts.length ? (a > 0 ? '+' : '-') : (a < 0 ? '-' : '');
      const co = (Math.abs(Math.abs(a) - 1) < 1e-9 && pw > 0) ? '' : fmt3(Math.abs(a));
      parts.push(sgn + co + (pw === 0 ? '' : pw === 1 ? vn : vn + '^{' + pw + '}'));
    }
    return parts.join('') || '0';
  }
  function texLaplaceGroups(groups, prefix = 'f(t)=') {
    const fx = (v) => { const x = Math.abs(v) < 5e-4 ? 0 : +v.toFixed(3); return (x < 0 ? '-' : '') + Math.abs(x); };
    let body = '';
    for (const g of groups) {
      if (g.p.im < -1e-6) continue;   // 共轭成员由 pair 代表
      if (!g.pair) {
        // 实极点：c_j = A_{j+1}/j!（升幂）→ 多项式(t)·e^{σt}
        const c = g.A.map((A, j) => A.re / fact(j));
        const poly = texPolyAsc(c, 't');
        const et = Math.abs(g.p.re) < 1e-9 ? '' : 'e^{' + fx(g.p.re) + 't}';
        let term;
        if (poly === '1' && et) term = et;
        else if (poly === '0') term = '';
        else term = (/[+\-]/.test(poly.slice(1)) ? '\\left(' + poly + '\\right)' : poly) + et;
        body += '+' + term;
      } else {
        // 共轭对：2e^{σt}[P(t)cos ωt + Q(t)sin ωt]，P/Q 为升幂多项式
        const P = g.A.map((A, j) => A.re / fact(j));
        const Q = g.A.map((A, j) => -A.im / fact(j));
        const pTex = texPolyAsc(P, 't'), qTex = texPolyAsc(Q, 't');
        let inner = '';
        if (pTex !== '0') inner += pTex + '\\cos(' + fx(g.p.im) + 't)';
        if (qTex !== '0') {
          const neg = qTex.startsWith('-');
          inner += (inner ? (neg ? '-' : '+') : (neg ? '-' : ''))
            + (neg ? texPolyAsc(Q.map((v) => -v), 't') : qTex) + '\\sin(' + fx(g.p.im) + 't)';
        }
        body += '+2e^{' + fx(g.p.re) + 't}\\left[' + (inner || '0') + '\\right]';
      }
    }
    body = body.replace(/^\+/, '') || '0';
    return prefix + body;
  }
  function texZGroups(groups) {
    const fx = (v) => { const x = Math.abs(v) < 5e-4 ? 0 : +v.toFixed(3); return (x < 0 ? '-' : '') + Math.abs(x); };
    // C(x,j) 的 monomial 系数表（j ≤ 3）
    const binomTable = [[1], [0, 1], [0, -0.5, 0.5], [0, 1 / 3, -0.5, 1 / 6]];
    let body = '';
    for (const g of groups) {
      if (g.p.im < -1e-6) continue;
      // B_j = A_{j+1}·p^{−j}；h 部 = p^{n−1}·Σ B_j C(n−1, j)（实极点）或共轭 2Re 形式
      const B = g.A.map((A, j) => {
        const pw = Math.pow(Math.hypot(g.p.re, g.p.im), -j);
        const th = Math.atan2(g.p.im, g.p.re) * (-j);
        return { re: A.re * pw * Math.cos(th) - A.im * pw * Math.sin(th), im: A.re * pw * Math.sin(th) + A.im * pw * Math.cos(th) };
      });
      if (!g.pair) {
        const mono = new Array(g.m).fill(0);
        for (let j = 0; j < g.m && j < 4; j++) {
          const cj = B[j].re;
          if (Math.abs(cj) < 1e-9) continue;
          for (let i = 0; i < binomTable[j].length; i++) mono[i] += cj * binomTable[j][i];
        }
        const poly = texPolyAsc(mono, '(n{-}1)');
        if (Math.abs(g.p.re) < 1e-9) {
          // 极点在原点：A₁·δ(n−1)（高阶项 A₂·δ'(n−1) 等不展示）
          body += '+' + fmt3(g.A[0].re) + '\\delta(n{-}1)';
        } else if (g.m === 1) {
          const co = fmt3(g.A[0].re);
          body += '+' + (co === '1' ? '' : co + '\\,') + fx(g.p.re) + '^{\\,n-1}';
        } else {
          body += '+\\left(' + poly + '\\right)\\,' + fx(g.p.re) + '^{\\,n-1}';
        }
      } else {
        const r = Math.hypot(g.p.re, g.p.im), th = Math.atan2(g.p.im, g.p.re);
        const P = B.map((b) => b.re), Q = B.map((b) => b.im);
        const pTex = texPolyAsc(P, '(n{-}1)'), qTex = texPolyAsc(Q, '(n{-}1)');
        let inner = '';
        if (pTex !== '0') inner += pTex + '\\cos\\!\\big(' + fx(th) + '(n{-}1)\\big)';
        if (qTex !== '0') {
          const neg = qTex.startsWith('-');
          inner += (inner ? (neg ? '-' : '+') : (neg ? '-' : ''))
            + (neg ? texPolyAsc(Q.map((v) => -v), '(n{-}1)') : qTex) + '\\sin\\!\\big(' + fx(th) + '(n{-}1)\\big)';
        }
        body += '+2\\,' + fx(r) + '^{\\,n-1}\\left[' + (inner || '0') + '\\right]';
      }
    }
    return body.replace(/^\+/, '') || '0';
  }

  // 连续：H(s)=N/D（真分式，支持重极点）→ f(t) 解析式
  function invLaplace(num, den) {
    const n = den.length - 1;
    let b = num.slice();
    while (b.length < n + 1) b.unshift(0);
    const bn = b[n] || 0;
    const pf = partialFracGroups(num, den);
    if (!pf.ok) return { tex: null, note: pf.note };
    let body = texLaplaceGroups(pf.groups, '');
    body = body === '0' ? '' : body;
    if (Math.abs(pf.direct) > 1e-12) body += (body ? '+' : '') + `${num2tex(pf.direct)}\\delta(t)`;
    let tex = 'f(t)=' + (body || '0');
    if (body) tex += '\\cdot u(t)';
    return {
      tex, note: '', direct: pf.direct, groups: pf.groups,
      evalT: (t) => evalLaplaceGroups(pf.groups, t)
    };
  }

  // 离散：H(z)=N/D（正幂，真分式，支持重极点）→ h[n] 解析式
  function invZ(num, den) {
    const pf = partialFracGroups(num, den);
    if (!pf.ok) return { tex: null, note: pf.note };
    const b0 = pf.direct;
    let tex = texZGroups(pf.groups);
    let body = tex === '0' ? '' : tex;
    if (Math.abs(b0) > 1e-12) body += (body ? '+' : '') + `${num2tex(b0)}\\delta(n)`;
    tex = 'h(n)=' + (body || '0') + '\\ (n\\ge 1)';
    const maxAbs = pf.groups.reduce((m, g) => Math.max(m, Math.hypot(g.p.re, g.p.im)), 0);
    const note = maxAbs < 1 ? '全部极点在单位圆内 → h(n) 收敛（稳定）'
      : maxAbs > 1 ? '存在单位圆外极点 → h(n) 发散（不稳定）' : '极点在单位圆上 → 临界';
    return {
      tex, note, direct: b0, groups: pf.groups,
      evalN: (n) => (n === 0 ? b0 : evalZGroups(pf.groups, n))
    };
  }

  /* ---------- 拉普拉斯性质数值验证：定义积分 vs 符号公式 ----------
   * prop: 'shift'(时移 tau) | 'freq'(频移 e^{-at}) | 'scale'(尺度 a>0) | 'diff'(微分)
   * 左侧 = 变换后时域信号的定义积分（复梯形），右侧 = 符号公式（FsNumeric 闭式）。 */
  function propVerify(items, prop, param) {
    if (!items || !items.length) return { ok: false, note: '\u4fe1\u53f7\u4e3a\u7a7a' };
    let right = 0;
    for (const it of items) right = Math.max(right, (it.kind === 'exp' || it.kind === 'texp') ? -it.a : 0);
    const sigma = right + 1.5;                       // Re(s) > ROC \u53f3\u7f18\uff0c\u5b9e\u8f74\u9a8c\u8bc1\u70b9
    const N = 120000, Tmax = 60 / sigma;
    // \u5b9a\u4e49\u79ef\u5206 \u222b_{t0}^{Tmax} f(t)e^{-\u03c3t}dt\uff1a\u590d\u5408\u68af\u5f62\uff08\u8d77\u70b9\u53ef\u5bf9\u9f50\u95f4\u65ad\uff0c\u907f\u514d\u8de8\u8df3\u53d8\u91c7\u6837\uff09
    const numLap = (f, t0) => {
      const a0 = Math.max(0, t0 || 0);
      const dt = (Tmax - a0) / N;
      let acc = 0;
      for (let i = 0; i <= N; i++) {
        const t = a0 + i * dt;
        const m = (i === 0 || i === N) ? 1 : 2;
        acc += f(t) * Math.exp(-sigma * t) * m * dt / 2;
      }
      return acc;
    };
    const rel = (a, b) => Math.abs(a - b) / Math.max(1e-12, Math.abs(b));
    const checks = [];
    let title = '', rhsTex = '';
    const Fsv = FsNumeric(items, sigma);
    const Ftex = laplaceOfItems(items).fsLine.replace('F(s)=', '');
    const sTex = 's=' + sigma.toFixed(2);
    if (prop === 'shift') {
      const tau = Math.max(0, +param || 0);
      title = '\u65f6\u79fb\uff1aL{f(t\u2212' + num2tex(tau) + ')u(t\u2212' + num2tex(tau) + ')} = e^{\u2212' + num2tex(tau) + 's}F(s)';
      rhsTex = 'e^{\u2212' + num2tex(tau) + 's}\\cdot[' + Ftex + ']';
      const lhs = numLap((t) => fNumeric(items, t - tau), tau);
      const rhs = Math.exp(-sigma * tau) * Fsv;
      checks.push({ s: sTex, lhs, rhs, rel: rel(lhs, rhs) });
    } else if (prop === 'freq') {
      const a = +param || 0;
      title = '\u9891\u79fb\uff1aL{e^{\u2212' + num2tex(a) + 't}f(t)} = F(s+' + num2tex(a) + ')';
      rhsTex = '[' + Ftex + ']_{s\\to s+' + num2tex(a) + '}';
      const lhs = numLap((t) => Math.exp(-a * t) * fNumeric(items, t), 0);
      const rhs = FsNumeric(items, sigma + a);
      checks.push({ s: sTex, lhs, rhs, rel: rel(lhs, rhs) });
    } else if (prop === 'scale') {
      const a = Math.max(0.1, +param || 2);
      title = '\u5c3a\u5ea6\uff1aL{f(' + num2tex(a) + 't)} = (1/' + num2tex(a) + ')F(s/' + num2tex(a) + ')';
      rhsTex = '\\dfrac{1}{' + num2tex(a) + '}[' + Ftex + ']_{s\\to s/' + num2tex(a) + '}';
      const lhs = numLap((t) => fNumeric(items, a * t), 0);
      const rhs = FsNumeric(items, sigma / a) / a;
      checks.push({ s: sTex, lhs, rhs, rel: rel(lhs, rhs) });
    } else if (prop === 'diff') {
      title = '\u5fae\u5206\uff1aL{f\u2032(t)} = sF(s) \u2212 f(0+)';
      rhsTex = 's\\cdot[' + Ftex + '] - f(0^{+})';
      const h = 1e-5;
      const df = (t) => (t < h ? (fNumeric(items, t + h) - fNumeric(items, t)) / h        // 0 \u9644\u8fd1\u5355\u4fa7\u5dee\u5206\uff08\u8df3\u8fc7\u95f4\u65ad\uff09
        : (fNumeric(items, t + h) - fNumeric(items, t - h)) / (2 * h));
      const lhs = numLap(df, 0);
      const f0 = fNumeric(items, 1e-6);
      const rhs = sigma * Fsv - f0;
      checks.push({ s: sTex, lhs, rhs, rel: rel(lhs, rhs) });
    } else return { ok: false, note: '\u672a\u77e5\u6027\u8d28' };
    const maxRel = Math.max(...checks.map((c) => c.rel));
    return { ok: true, title, rhsTex, sPoint: sTex, checks, maxRel, passed: isFinite(maxRel) && maxRel < 1e-5 };
  }

  /* ---------- 多 ROC 分析：按极点实部划分收敛域，逐域判定因果性/稳定性 ----------
   * 复极点不新增边界（只看实部）；jω 轴极点使任何 ROC 都不含虚轴（无稳定域）。 */
  function rocs(num, den) {
    const poles = window.DSP.polyRoots(den);
    if (!poles.length || poles.some((q) => !isFinite(q.re) || !isFinite(q.im))) return { ok: false, note: '\u6781\u70b9\u6c42\u89e3\u5931\u8d25' };
    const reals = [...new Set(poles.map((p) => +p.re.toFixed(9)))].sort((a, b) => a - b);
    const axisPole = reals.some((r) => Math.abs(r) < 1e-9);
    const regions = [];
    for (let i = 0; i <= reals.length; i++) {
      const lo = i === 0 ? -Infinity : reals[i - 1];
      const hi = i === reals.length ? Infinity : reals[i];
      const containsJw = lo < 0 && hi > 0;          // \u865a\u8f74 Re=0 \u5728\u5f00\u533a\u95f4\u5185
      const causal = i === reals.length;             // \u6700\u53f3\u533a\u57df\u2192 \u53f3\u4fa7\uff08\u56e0\u679c\uff09\u4fe1\u53f7
      const anti = i === 0;                          // \u6700\u5de6\u533a\u57df\u2192 \u5de6\u4fa7\uff08\u53cd\u56e0\u679c\uff09
      regions.push({
        lo, hi, containsJw, causal, anti, twoSided: !causal && !anti,
        stable: containsJw,
        rocTex: (lo === -Infinity ? 'Re(s) < ' : 'Re(s) > ') + (hi === Infinity ? (lo === -Infinity ? 0 : num2tex(lo)) : num2tex(hi))
      });
      // rocTex \u5bf9\u4e2d\u95f4\u533a\u57df\u9700\u8981\u53cc\u8fb9\u8868\u8ff0
      const r = regions[regions.length - 1];
      if (lo !== -Infinity && hi !== Infinity) r.rocTex = num2tex(lo) + ' < Re(s) < ' + num2tex(hi);
      else if (lo === -Infinity && hi !== Infinity) r.rocTex = 'Re(s) < ' + num2tex(hi);
      else if (lo !== -Infinity && hi === Infinity) r.rocTex = 'Re(s) > ' + num2tex(lo);
    }
    const stableRegion = regions.find((r) => r.stable) || null;
    const causalRegion = regions.find((r) => r.causal) || null;
    return { ok: true, poles, regions, stableRegion, causalRegion, axisPole };
  }

  return {
    parseTimeCombo, laplaceOfItems, fourierOfItems, fNumeric, FsNumeric, propVerify, rocs,
    parseZCombo, zOfItems, xNumeric, XzNumeric,
    invLaplace, invZ,
    partialFracGroups, evalLaplaceGroups, texLaplaceGroups, texZGroups
  };
})();
