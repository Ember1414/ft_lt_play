/* ============================================================
 * mathdsp.js — 数值信号处理 / 数学计算（纯复数实现，无外部依赖）
 * ============================================================ */
const DSP = (() => {
  /* ---------- 多项式值 / 求根 ---------- */
  function horner(coef, z) {
    // coef: 自高到低 [a_n ... a_0]
    let re = 0, im = 0;
    for (const c of coef) {
      const nr = re * z.re - im * z.im + c;
      const ni = re * z.im + im * z.re;
      re = nr; im = ni;
    }
    return { re, im };
  }
  function cdiv(a, b) {
    const d = b.re * b.re + b.im * b.im;
    return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
  }

  // Durand–Kerner 多项式求根
  function polyRoots(coefTopDown) {
    const n = coefTopDown.length - 1;
    if (n <= 0) return [];
    const lead = coefTopDown[0];
    const coef = coefTopDown.map((c) => c / lead);
    let R = 1;
    for (let i = 1; i < coef.length; i++) R = Math.max(R, Math.abs(coef[i]));
    R += 1;
    const roots = [];
    for (let i = 0; i < n; i++) { const ph = (2 * Math.PI * i) / n + 0.02; roots.push({ re: R * 0.5 * Math.cos(ph), im: R * 0.5 * Math.sin(ph) }); }
    for (let it = 0; it < 500; it++) {
      let delta = 0;
      for (let i = 0; i < n; i++) {
        let dr = 1, di = 0;
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const ar = roots[i].re - roots[j].re, ai = roots[i].im - roots[j].im;
          const nr = dr * ar - di * ai, ni = dr * ai + di * ar;
          dr = nr; di = ni;
        }
        const p = horner(coef, roots[i]);
        const corr = cdiv({ re: p.re, im: p.im }, { re: dr, im: di });
        roots[i].re -= corr.re; roots[i].im -= corr.im;
        delta += Math.abs(corr.re) + Math.abs(corr.im);
      }
      if (delta < 1e-11) break;
    }
    return roots;
  }

  // 由根构造多项式（返回自高到低，首项系数 = 1），支持复数根
  function polyFromRoots(roots, cc = 1) {
    let re = [1], im = [0];  // P(z) = 复数系数
    for (const r of roots) {
      // 乘 (z - r)
      const nre = new Array(re.length + 1).fill(0);
      const nim = new Array(im.length + 1).fill(0);
      for (let i = 0; i < re.length; i++) {
        // 高次项：coef[i] * z
        nre[i + 1] += re[i]; nim[i + 1] += im[i];
        // 低次项：coef[i] * (-r)
        nre[i] += -re[i] * r.re + im[i] * r.im;
        nim[i] += -re[i] * r.im - im[i] * r.re;
      }
      re = nre; im = nim;
    }
    // 结果应为实系数（共轭根配对），返回自高到低
    const out = re.map((r, i) => r * cc);
    return out;
  }

  /* ---------- FFT (Cooley–Tukey 迭代) ---------- */
  function fft(re, im) {
    const n = re.length;
    let j = 0;
    for (let i = 1; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wRe = Math.cos(ang), wIm = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cRe = 1, cIm = 0;
        for (let k = 0; k < len / 2; k++) {
          const uRe = re[i + k], uIm = im[i + k];
          const vRe = re[i + k + len / 2] * cRe - im[i + k + len / 2] * cIm;
          const vIm = re[i + k + len / 2] * cIm + im[i + k + len / 2] * cRe;
          re[i + k] = uRe + vRe; im[i + k] = uIm + vIm;
          re[i + k + len / 2] = uRe - vRe; im[i + k + len / 2] = uIm - vIm;
          const nRe = cRe * wRe - cIm * wIm;
          cIm = cRe * wIm + cIm * wRe;
          cRe = nRe;
        }
      }
    }
    return { re, im };
  }
  function ifft(re, im) {
    for (let i = 0; i < re.length; i++) im[i] = -im[i];
    fft(re, im);
    const n = re.length;
    for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    return { re, im };
  }

  // 实数采样序列 -> 单边幅度/相位谱
  function spectrum(y, dt) {
    const N = y.length;
    let n = 1; while (n < N) n <<= 1;
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < N; i++) re[i] = y[i];
    fft(re, im);
    const f = [], mag = [], ph = [];
    for (let k = 0; k <= n / 2; k++) {
      f.push(k / (n * dt));
      const r = re[k], i = im[k];
      let m = Math.hypot(r, i) * dt;
      mag.push(m);
      ph.push(Math.atan2(i, r));
    }
    for (let k = 1; k < mag.length - 1; k++) mag[k] *= 2; // 单边
    return { f, mag, ph };
  }

  /* ---------- 紧致 DFT：用于画圈动画 ---------- */
  function dftPhasors(pts) {
    const N = pts.length;
    const out = [];
    for (let k = 0; k < N; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) {
        const ph = (-2 * Math.PI * k * n) / N;
        re += pts[n].re * Math.cos(ph) - pts[n].im * Math.sin(ph);
        im += pts[n].re * Math.sin(ph) + pts[n].im * Math.cos(ph);
      }
      const freq = k > N / 2 ? k - N : k;
      out.push({ k: freq, amp: Math.hypot(re, im) / N, phase: Math.atan2(im, re), re: re / N, im: im / N });
    }
    return out.sort((a, b) => b.amp - a.amp);
  }

  /* ---------- 数值积分（辛普森） ---------- */
  function integrate(f, a, b, steps = 2000) {
    if (b <= a) return 0;
    const h = (b - a) / steps;
    let s = f(a) + f(b);
    for (let i = 1; i < steps; i++) s += (i % 2 ? 4 : 2) * f(a + i * h);
    return (s * h) / 3;
  }

  /* ---------- 离散卷积 ---------- */
  function conv(a, b) {
    const out = new Float64Array(a.length + b.length - 1);
    for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
    return Array.from(out);
  }

  /* ---------- 状态空间仿真（可控标准型 / RK4） ---------- */
  // num: 自高到低, den: 自高到低(首项=1)，返回 u(t) 的零状态响应
  function ltiResponse(num, den, u, tmin, tmax, steps) {
    const n = den.length - 1;
    const norm = den[0];
    const a = den.map((c) => c / norm);
    let b = num.slice();
    while (b.length < n + 1) b.unshift(0);
    b = b.map((x) => x / norm);
    const bn = b[n] || 0;
    const C = b.map((x, j) => (j < n ? x - a[j + 1] * bn : 0)); // j=0..n-1

    const dt = (tmax - tmin) / steps;
    const t = new Float64Array(steps + 1);
    const y = new Float64Array(steps + 1);
    let x = new Float64Array(n);
    for (let i = 0; i <= steps; i++) {
      const tv = tmin + i * dt;
      t[i] = tv;
      const uv = u(tv);
      let yout = bn * uv;
      for (let j = 0; j < n; j++) yout += C[j] * x[j];
      y[i] = yout;

      const deriv = (v) => {
        const out = new Float64Array(n);
        for (let j = 0; j < n - 1; j++) out[j] = v[j + 1];
        let acc = 0;
        for (let j = 0; j < n; j++) acc -= a[j + 1] * v[j];
        out[n - 1] = acc + uv;
        return out;
      };
      const add = (p, q, k) => { for (let j = 0; j < n; j++) p[j] += q[j] * k; return p; };
      const k1 = deriv(x);
      const k2 = deriv(add(new Float64Array(k1), x, dt / 2));
      const k3 = deriv(add(new Float64Array(k2), x, dt / 2));
      const k4 = deriv(add(new Float64Array(k3), x, dt));
      for (let j = 0; j < n; j++) x[j] += (dt / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]);
    }
    return { t: Array.from(t), y: Array.from(y) };
  }

  /* ---------- 传递函数频响 G(jw) ---------- */
  function evalH(num, den, w) {
    const z = { re: 0, im: w };
    return cdiv(horner(num, z), horner(den, z));
  }
  function bode(num, den, wmin = -2, wmax = 3, pts = 260) {
    const w = [], mag = [], ph = [];
    for (let i = 0; i < pts; i++) {
      const wv = Math.pow(10, U.lerp(wmin, wmax, i / (pts - 1)));
      const h = evalH(num, den, wv);
      w.push(wv);
      mag.push(20 * Math.log10(Math.hypot(h.re, h.im) + 1e-12));
      ph.push((180 / Math.PI) * Math.atan2(h.im, h.re));
    }
    return { w, mag, ph };
  }

  return { horner, polyRoots, polyFromRoots, cdiv, fft, ifft, spectrum, dftPhasors, integrate, conv, ltiResponse, evalH, bode };
})();

window.DSP = DSP;