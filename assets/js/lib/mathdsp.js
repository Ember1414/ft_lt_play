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
    const d = b.re * b.re + b.im * b.im || 1e-30;
    return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
  }

  // Durand–Kerner 多项式求根
  function polyRoots(coefTopDown) {
    // 调用方常把分子补零对齐后送来（如 [0,0,1]）；必须先去掉前导零，
    // 否则 lead=0 会让整条系数变成 NaN，根全废（z 平面白屏、零点丢失）
    const src = [];
    let started = false;
    for (const c of coefTopDown) {
      if (!started && Math.abs(c) < 1e-12) continue;
      started = true; src.push(c);
    }
    if (!src.length) return [];
    const n = src.length - 1;
    if (n <= 0) return [];
    const lead = src[0];
    if (!isFinite(lead) || Math.abs(lead) < 1e-300) return [];
    const coef = src.map((c) => c / lead);
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
        if (Math.abs(dr) + Math.abs(di) < 1e-18) { dr = 1e-12; }
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
    // 结果应为实系数（共轭根配对）；内部按升幂累积，返回前转为自高到低
    const out = re.map((r, i) => r * cc).reverse();
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
      let p = Math.atan2(i, r);
      if (k) {
        const prev = ph[ph.length - 1];
        while (p - prev > Math.PI) p -= 2 * Math.PI;
        while (p - prev < -Math.PI) p += 2 * Math.PI;
      }
      ph.push(p);
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
  // 状态链 x1'=x2, …, xn' = -a_n·x1 - a_{n-1}·x2 - … - a_1·xn + u
  // 输出 y = b0·u + Σ (b_{n-j} - b0·a_{n-j})·x_j（b0 为分子最高次系数，即高频直通增益）
  function ltiResponse(num, den, u, tmin, tmax, steps) {
    const n = den.length - 1;
    const norm = den[0];
    const a = den.map((c) => c / norm);
    let b = num.slice();
    while (b.length < n + 1) b.unshift(0);
    b = b.map((x) => x / norm);
    const b0 = b[0];
    const C = [];
    for (let j = 0; j < n; j++) C.push(b[n - j] - b0 * a[n - j]);

    const dt = (tmax - tmin) / steps;
    const t = new Float64Array(steps + 1);
    const y = new Float64Array(steps + 1);
    let x = new Float64Array(n);
    for (let i = 0; i <= steps; i++) {
      const tv = tmin + i * dt;
      t[i] = tv;
      const uv = u(tv);
      let yout = b0 * uv;
      for (let j = 0; j < n; j++) yout += C[j] * x[j];
      y[i] = yout;

      const deriv = (v) => {
        const out = new Float64Array(n);
        for (let j = 0; j < n - 1; j++) out[j] = v[j + 1];
        let acc = 0;
        for (let j = 0; j < n; j++) acc -= a[n - j] * v[j];
        out[n - 1] = acc + uv;
        return out;
      };
      // RK4：状态步进 x + k·h（注意原实现参数顺序反了，导致 k1 未参与积分）
      const stepX = (v, k, h) => { const o = new Float64Array(n); for (let j = 0; j < n; j++) o[j] = v[j] + k[j] * h; return o; };
      const k1 = deriv(x);
      const k2 = deriv(stepX(x, k1, dt / 2));
      const k3 = deriv(stepX(x, k2, dt / 2));
      const k4 = deriv(stepX(x, k3, dt));
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
      let p = (180 / Math.PI) * Math.atan2(h.im, h.re);
      if (i) {
        const prev = ph[i - 1];
        while (p - prev > 180) p -= 360;
        while (p - prev < -180) p += 360;
      }
      ph.push(p);
    }
    return { w, mag, ph };
  }

  /* ---------- 稳态误差与系统型别（单位负反馈，开环 L(s)=num/den，互质前提） ---------- */
  // 型别 ν = 分母在原点的极点数；Kp/Kv/Ka 为静态位置/速度/加速度误差系数，
  // ess 为单位阶跃/斜坡/抛物线输入下的稳态误差（型别不足 → Infinity，型别富余 → 0）。
  function steadyState(num, den) {
    let nu = 0;
    for (let i = den.length - 1; i >= 0; i--) { if (Math.abs(den[i]) < 1e-9) nu++; else break; }
    const numEnd = num[num.length - 1] || 0;
    const coefAt = (k) => den[den.length - 1 - k];   // s^k 的系数（自高到低数组）
    const Kp = nu >= 1 ? Infinity : numEnd / (den[den.length - 1] || 1);
    const Kv = nu >= 2 ? Infinity : nu === 1 ? numEnd / (coefAt(1) || 1e-12) : 0;
    const Ka = nu >= 3 ? Infinity : nu === 2 ? numEnd / (coefAt(2) || 1e-12) : 0;
    return {
      type: nu, Kp, Kv, Ka,
      ess: {
        step: nu >= 1 ? 0 : 1 / (1 + Kp),
        ramp: nu >= 2 ? 0 : (nu === 1 ? 1 / Kv : Infinity),   // 型别不足 → ∞
        para: nu >= 3 ? 0 : (nu === 2 ? 1 / Ka : Infinity)
      }
    };
  }

  /* ---------- 完整奈奎斯特判据 Z = N + P ----------
   * s 域围线：jω 轴（ω: −∞→∞）在虚轴极点处向右侧作小半圆 indent（半径 ε），
   * 右侧大半圆闭合（严格真分式时映射到原点附近，不贡献包围）。
   * N = G(jω) 曲线对 (−1,0) 的顺时针包围圈数（沿映射曲线的总辐角增量 / −2π）。
   * 返回 { P, N, Z, stable, onCritical }；闭环右半平面极点数 Z>0 ⇔ 闭环不稳定。 */
  function nyquistFull(num, den) {
    const poles = polyRoots(den).filter((q) => isFinite(q.re) && isFinite(q.im));
    const P = poles.filter((q) => q.re > 1e-9).length;
    // 虚轴极点（含原点）：按虚部排序并去重（重根只绕一次即可，重根映射的无限大弧自然是 ν×半圈）
    const jwPoles = poles.filter((q) => Math.abs(q.re) <= 1e-9).map((q) => q.im)
      .sort((a, b) => a - b)
      .filter((im, i, arr) => i === 0 || im - arr[i - 1] > 1e-6);
    const scale = Math.max(1, ...poles.map((q) => Math.abs(q.re) + Math.abs(q.im)));
    const eps = 1e-5 * scale;
    const wMax = 200 * scale;

    // s 平面围线采样（按行进顺序：ω 从 −ωmax 升到 +ωmax，途中绕开虚轴极点）
    const sPts = [];
    let w = -wMax;
    for (const pim of [...jwPoles, Infinity]) {
      const wStop = pim === Infinity ? wMax : pim - eps;
      if (wStop > w + 1e-12) {
        // 直线段 s=jω：从当前 w 到 wStop（首段含起点，后续段跳过重复点）
        const SEG = 500;
        for (let i = (sPts.length ? 1 : 0); i <= SEG; i++) sPts.push({ re: 0, im: w + ((wStop - w) * i) / SEG });
      }
      if (pim !== Infinity) {
        // 右侧 indent：s = ε·e^{jθ}（绕过 pim），θ: −π/2 → +π/2（从下方经右侧到上方）
        for (let i = 1; i <= 48; i++) {
          const th = -Math.PI / 2 + (Math.PI * i) / 48;
          sPts.push({ re: eps * Math.cos(th), im: pim + eps * Math.sin(th) });
        }
        w = pim + eps;
      } else {
        w = wStop;
      }
    }
    // 大半圆闭合：s = R·e^{jθ}，θ: +π/2 → −π/2（顺时针）
    const R = 1e3 * scale;
    for (let i = 1; i <= 80; i++) {
      const th = Math.PI / 2 - (Math.PI * i) / 80;
      sPts.push({ re: R * Math.cos(th), im: R * Math.sin(th) });
    }
    // 映射 G(s)，统计对 (−1,0) 的辐角增量
    let total = 0, prev = null, minDist = Infinity;
    for (const s of sPts) {
      const g = cdiv(horner(num, s), horner(den, s));
      const dx = g.re + 1, dy = g.im;
      const dist = Math.hypot(dx, dy);
      if (dist < minDist) minDist = dist;
      const a = Math.atan2(dy, dx);
      if (prev != null) {
        let d = a - prev;
        if (d > Math.PI) d -= 2 * Math.PI;
        else if (d < -Math.PI) d += 2 * Math.PI;
        total += d;
      }
      prev = a;
    }
    const N = Math.round(-total / (2 * Math.PI));   // 顺时针为正（教材约定）
    const Z = N + P;
    return { P, N, Z, stable: Z === 0 && minDist > 1e-6 * scale, onCritical: minDist < 1e-6 * scale };
  }

  return { horner, polyRoots, polyFromRoots, cdiv, fft, ifft, spectrum, dftPhasors, integrate, conv, ltiResponse, evalH, bode, steadyState, nyquistFull };
})();

window.DSP = DSP;
