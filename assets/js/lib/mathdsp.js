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
    const reC = re.slice();
    const imC = im.slice();
    for (let i = 0; i < imC.length; i++) imC[i] = -imC[i];   // 共轭输入（副本，不修改原数组）
    fft(reC, imC);
    const n = reC.length;
    for (let i = 0; i < n; i++) { reC[i] /= n; imC[i] = -imC[i] / n; }   // 除以 n 并共轭还原输出
    return { re: reC, im: imC };
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

  /* ---------- 频域反卷积（ε 正则化）：x̂ = IFFT( Y·conj(H) / (|H|²+ε) ) ----------
   * y、h 补零至 ≥max(len(y),len(h)) 的 2 的幂做 FFT（y 为完整线性卷积结果时频域除法可精确恢复输入）。
   * 返回 { x（长度=len(y)）, ok, residual }；残差 = ‖y − conv(x,h)‖/‖y‖（截断到 len(y)），
   * > 0.1 → ok=false（典型原因：h 频谱有零点、y 非完整卷积结果或噪声过强；正则化抑制爆炸但有偏）。 */
  function deconv(y, h) {
    const N = y ? y.length : 0;
    if (!N || !h || !h.length) return { ok: false, note: '输入序列为空' };
    const eps = 1e-10;
    let n = 1; while (n < Math.max(N, h.length)) n <<= 1;
    const reY = new Float64Array(n), imY = new Float64Array(n);
    const reH = new Float64Array(n), imH = new Float64Array(n);
    for (let i = 0; i < N; i++) reY[i] = y[i];
    for (let i = 0; i < Math.min(h.length, n); i++) reH[i] = h[i];
    fft(reY, imY); fft(reH, imH);
    for (let k = 0; k < n; k++) {
      // Y·conj(H)/(|H|²+ε)：ε→0 的正则化极限，H 零点处不除零爆炸
      const hr = reH[k], hi = imH[k];
      const den = hr * hr + hi * hi + eps;
      const nr = reY[k] * hr + imY[k] * hi;
      const ni = imY[k] * hr - reY[k] * hi;
      reY[k] = nr / den; imY[k] = ni / den;
    }
    const xf = ifft(reY, imY);
    const x = Array.from(xf.re.slice(0, N));
    // 残差回代：线性卷积截断到 len(y) 与观测对比
    const yh = conv(x, h);
    let res = 0, ny = 0;
    for (let i = 0; i < N; i++) { const dv = y[i] - (yh[i] || 0); res += dv * dv; ny += y[i] * y[i]; }
    const residual = Math.sqrt(res) / Math.max(Math.sqrt(ny), 1e-30);
    return { x, ok: residual <= 0.1, residual };
  }

  /* ---------- 谱窗函数：rect | hamming | hanning | blackman（长度 N） ---------- */
  function window(type, N) {
    const w = new Array(Math.max(1, N));
    if (N <= 1) { w[0] = 1; return w; }
    for (let i = 0; i < N; i++) {
      const r = (2 * Math.PI * i) / (N - 1);
      if (type === 'hamming') w[i] = 0.54 - 0.46 * Math.cos(r);
      else if (type === 'hanning') w[i] = 0.5 - 0.5 * Math.cos(r);
      else if (type === 'blackman') w[i] = 0.42 - 0.5 * Math.cos(r) + 0.08 * Math.cos(2 * r);
      else w[i] = 1;
    }
    for (let i = 0; i < N; i++) w[i] = Math.min(1, Math.max(0, w[i]));  // 清除浮点尘埃，保证严格 [0,1]
    return w;
  }

  /* ---------- Box–Muller 白高斯噪声（n 点，标准差 sigma，缺省 1） ---------- */
  function gaussNoise(n, sigma) {
    const sg = sigma == null ? 1 : +sigma;
    const out = new Array(Math.max(0, n | 0));
    for (let i = 0; i < out.length; i++) {
      let u1 = Math.random();
      if (u1 < 1e-300) u1 = 1e-300;   // 防 log(0)
      out[i] = sg * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random());
    }
    return out;
  }

  /* ---------- 一阶 IIR 低通：y[k] = (1−α)·y[k−1] + α·x[k]（y[−1]=0，直接递推，非卷积） ---------- */
  function iir1(x, alpha) {
    const a = Math.min(Math.max(alpha == null ? 0 : +alpha, 0), 1);
    const y = new Array(x.length);
    let prev = 0;
    for (let k = 0; k < x.length; k++) { prev = (1 - a) * prev + a * x[k]; y[k] = prev; }
    return y;
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

  /* ---------- 闭环频域指标（单位反馈 T(s)=num/(num+den)）：谐振峰 Mr/ωr 与闭环带宽 ωb ----------
   * Mr = max|T(jω)|，ωr 为峰值频率；ωb 定义为 |T(jωb)| = |T(j0)|/√2 的频率（|T(j0)|=0 时无定义 → null）。
   * 闭环不稳定（右半平面极点）→ stable:false，指标均为 null（峰值无意义）。
   * 返回 { ok, stable, Mr, wr, wb, T0 }；对数扫频 2400 点 + 峰值抛物线细化。 */
  function closedLoopMetrics(num, den) {
    const np = num.slice();
    while (np.length < den.length) np.unshift(0);
    const denCl = den.map((c, i) => c + np[i]);          // 闭环分母 den+num
    while (denCl.length > 1 && Math.abs(denCl[0]) < 1e-12) denCl.shift();
    if (!isFinite(denCl[0]) || Math.abs(denCl[0]) < 1e-12) return { ok: false, stable: false, Mr: null, wr: null, wb: null, T0: null, note: '闭环分母退化' };
    const poles = polyRoots(denCl).filter((q) => isFinite(q.re) && isFinite(q.im));
    if (poles.some((q) => q.re > 1e-9)) return { ok: true, stable: false, Mr: null, wr: null, wb: null, T0: null };
    const t0 = Math.abs((num[num.length - 1] || 0) / (denCl[denCl.length - 1] || 1));   // |T(j0)|
    const N = 2400, ws = [], mags = [];
    let Mr = 0, mi = 0;
    for (let i = 0; i < N; i++) {
      const wv = Math.pow(10, U.lerp(-3, 3, i / (N - 1)));
      const h = evalH(num, denCl, wv);
      const mv = Math.hypot(h.re, h.im);
      ws.push(wv); mags.push(mv);
      if (mv > Mr) { Mr = mv; mi = i; }
    }
    // 峰值三点抛物线细化（对数频域等间距）
    let wr = ws[mi];
    if (mi > 0 && mi < N - 1) {
      const d2 = mags[mi - 1] - 2 * mags[mi] + mags[mi + 1];
      if (Math.abs(d2) > 1e-15) {
        const dlt = 0.5 * (mags[mi - 1] - mags[mi + 1]) / d2;
        wr = Math.pow(10, Math.log10(ws[mi]) + dlt * (Math.log10(ws[mi + 1]) - Math.log10(ws[mi - 1])) / 2);
        Mr = Math.max(0, mags[mi] - 0.25 * (mags[mi - 1] - mags[mi + 1]) * dlt);
      }
    }
    let wb = null;
    if (t0 > 1e-9) {
      const ref = t0 / Math.SQRT2;
      for (let i = 1; i < N; i++) {
        if (mags[i] < ref && mags[i - 1] >= ref) {
          wb = ws[i - 1] + ((mags[i - 1] - ref) / (mags[i - 1] - mags[i])) * (ws[i] - ws[i - 1]);
          break;
        }
      }
    }
    return { ok: true, stable: true, Mr, wr, wb, T0: t0 };
  }

  /* ---------- 动态误差系数：Φe(s)=1/(1+L)=den/(den+num) 在 s=0 的幂级数（长除法展开） ----------
   * e_ss(t) = k0·r(t) + k1·r′(t) + k2·r″(t) + …；k0 即静态位置误差 1/(1+Kp)，型别 1 系统 k0=0、k1=1/Kv。
   * 要求 L 严格真分式（相对阶 ≥1）且闭环分母常项 D(0)≠0（原点极点会使展开发散）。
   * 返回 { ok, ks:[k0…k_{terms-1}] }；Φe 严格真分式 → 级数无限延续。 */
  function errSeries(num, den, terms = 6) {
    if (num.length - 1 >= den.length - 1) return { ok: false, note: 'L(s) 需为严格真分式（相对阶 ≥ 1）' };
    const np = num.slice();
    while (np.length < den.length) np.unshift(0);
    const N = den.slice().reverse();                     // Φe 分子 = 开环分母（升幂）
    const D = den.map((c, i) => c + np[i]).reverse();    // Φe 分母 = den+num（升幂）
    if (!isFinite(D[0]) || Math.abs(D[0]) < 1e-12) return { ok: false, note: '闭环在原点存在极点（D(0)=0），级数展开发散' };
    const r = new Array(terms + D.length).fill(0);
    for (let i = 0; i < N.length && i < r.length; i++) r[i] = N[i];
    const ks = [];
    for (let i = 0; i < terms; i++) {
      const qi = r[i] / D[0];
      ks.push(qi);
      if (qi !== 0) for (let j = 0; j < D.length; j++) r[i + j] -= qi * D[j];
    }
    return { ok: true, ks };
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

  /* ---------- Jury 稳定判据（离散特征表，实系数自高到低 a0…an，n≥1） ----------
   * 条件：a0>0、P(1)>0、(−1)ⁿP(−1)>0、|a_n|<a0（n=1 时即 |a₁|<a₀），以及每行 r₀>|r_last|（n≥2）。
   * 首项为负：自动乘 −1 归一（判据只依赖根的位置），conds 中注明，不拒绝。
   * 返回 { ok, stable, conds:[{text,ok}], rows, rhoMax, margin }；
   * rhoMax = 最大特征根模（polyRoots 交叉验证），margin = 1−rhoMax；原有字段保持不变。 */
  function jury(a) {
    const n = a.length - 1;
    if (n < 1) return { ok: false, note: '阶数需 ≥ 1' };
    if (a.some((v) => !isFinite(v))) return { ok: false, note: '系数含非有限数值' };
    if (!a[0]) return { ok: false, note: '首项系数不能为 0' };
    const neg = a[0] < 0;
    const p = neg ? a.map((v) => -v) : a;   // 归一化后的系数（整体变号不改变根）
    const fmt = (v) => U.fmt(v, 4);
    const Pv = (z) => horner(p, { re: z, im: 0 }).re;
    const conds = [];
    const add = (text, okv) => { conds.push({ text, ok: !!okv }); return okv; };
    if (neg) conds.push({ text: '首项为负，已按 −a 自动归一', ok: true });
    add(`a₀ = ${fmt(p[0])} > 0`, p[0] > 0);
    add(`P(1) = ${fmt(Pv(1))} > 0`, Pv(1) > 1e-9);
    add(`(−1)ⁿ·P(−1) = ${fmt(Pv(-1) * Math.pow(-1, n))} > 0`, Pv(-1) * Math.pow(-1, n) > 1e-9);
    add(`|aₙ| = ${fmt(Math.abs(p[n]))} < a₀ = ${fmt(p[0])}`, Math.abs(p[n]) < p[0]);
    let stable = conds.every((cd) => cd.ok);
    const rows = [[p.slice()], [p.slice().reverse()]];
    let cur = p.slice();
    while (cur.length >= 3) {
      const m = cur.length, last = cur[m - 1];
      const nxt = [];
      for (let k = 0; k < m - 1; k++) nxt.push(cur[0] * cur[k] - last * cur[m - 1 - k]);
      rows.push([nxt.slice(), nxt.slice().reverse()]);
      const okv = add(`r₀ = ${fmt(nxt[0])} > |r_last| = |${fmt(nxt[nxt.length - 1])}|`, nxt[0] > Math.abs(nxt[nxt.length - 1]));
      if (!okv) stable = false;
      cur = nxt;
    }
    // 最大特征根模与稳定裕度（Durand–Kerner 求根，仅供展示/交叉验证，不影响表格判据本身）
    let rhoMax = null;
    try {
      const roots = polyRoots(p).filter((q) => isFinite(q.re) && isFinite(q.im));
      if (roots.length) rhoMax = Math.max(...roots.map((q) => Math.hypot(q.re, q.im)));
    } catch (e) { rhoMax = null; }
    return { ok: true, stable, conds, rows, rhoMax, margin: rhoMax == null ? null : 1 - rhoMax };
  }

  /* ---------- 误差积分指标（ISE/IAE/ITAE），e(t) 采样序列，梯形积分 ---------- */
  function errMetrics(t, e) {
    const n = Math.min(t.length, e.length);
    let ise = 0, iae = 0, itae = 0;
    for (let i = 1; i < n; i++) {
      const dt = t[i] - t[i - 1];
      const e0 = Math.abs(e[i - 1]), e1 = Math.abs(e[i]);
      const p0 = Math.abs(t[i - 1] * e[i - 1]), p1 = Math.abs(t[i] * e[i]);
      iae += (e0 + e1) / 2 * dt;
      ise += (e[i - 1] * e[i - 1] + e[i] * e[i]) / 2 * dt;
      itae += (p0 + p1) / 2 * dt;
    }
    return { ise, iae, itae };
  }

  /* ---------- PID 闭环时域仿真（含执行器限幅 / 抗饱和 / 微分滤波 / 微分先行 / 采样 / 输入端扰动） ----------
   * 单位负反馈 r=1：控制器离散更新（Ts>0 为数字 PID，ZOH 保持），对象 RK4 相变量步进。
   * ctrl: {kp, ki, kd, Tf(微分滤波时间常数,0=关), dOnM(微分先行)}；
   * opts: {tmax, steps, uMax(执行器限幅,null=无限), aw('off'|'clamp'|'back'), Tt(反算时间常数), Ts(采样周期,0=连续),
   *        dSeq(对象输入端扰动：数组 d[k]（按步索引，越界补 0）或 d(k,t) 函数；对象输入 = u + d；缺省/null=无)}
   * 返回 { ok, t, y, u, e }；对象需严格真分式。 */
  function pidLoopSim(num, den, ctrl, opts) {
    opts = opts || {};
    const kp = +ctrl.kp || 0, ki = +ctrl.ki || 0, kd = +ctrl.kd || 0;
    const Tf = Math.max(+ctrl.Tf || 0, 0);
    const dOnM = !!ctrl.dOnM;
    const uMax = opts.uMax != null && isFinite(opts.uMax) ? Math.abs(opts.uMax) : null;
    const aw = ['clamp', 'back'].includes(opts.aw) ? opts.aw : 'off';
    const Tt = +opts.Tt > 0 ? +opts.Tt : 1;
    const Ts = +opts.Ts > 0 ? +opts.Ts : 0;
    // 扰动序列（作用在控制器输出之后的对象输入端）：数组按步索引取值（越界补 0），或 d(k,t) 函数
    const dSeq = opts.dSeq == null ? null
      : typeof opts.dSeq === 'function' ? opts.dSeq
        : Array.isArray(opts.dSeq) ? (k) => (opts.dSeq[k] != null ? +opts.dSeq[k] : 0) : null;
    const tmax = +opts.tmax || 10, steps = Math.min(+opts.steps || 3000, 20000);
    if (!den || !den[0]) return { ok: false, note: '分母非法' };
    const n = den.length - 1;
    if (num.length - 1 >= den.length - 1) return { ok: false, note: '对象需为严格真分式（分子阶次 < 分母阶次）' };
    const d0 = den[0];
    const a = den.map((c) => c / d0);                       // [1, a1..an] 自高到低
    const c = num.slice();
    while (c.length < den.length) c.unshift(0);
    for (let i = 0; i < c.length; i++) c[i] /= d0;          // c[0]=0；y=Σ c[i]x_i
    const dt = tmax / steps;
    const rf = typeof opts.r === 'function' ? opts.r : (() => { const v = opts.r != null ? +opts.r : 1; return () => v; })();
    // a = [1, a1, ..., an]（s^n…s^0）；相变量 x1=y：ẋi=x_{i+1}，ẋn = u − Σ_{k=1..n} a[k]·x[n−k]
    const dv = (x, u) => {
      const o = new Array(n);
      for (let i = 0; i < n - 1; i++) o[i] = x[i + 1];
      let acc = u;
      for (let k = 1; k <= n; k++) acc -= a[k] * x[n - k];
      o[n - 1] = acc;
      return o;
    };
    // y = c[1]·x_{n−1} + … + c[n]·x_1：s^{n−i} 系数配 (n−i+1) 阶导数态 x[n−i]
    const meas = (x) => { let y = 0; for (let i = 1; i < c.length; i++) y += c[i] * x[n - i]; return y; };
    const ctrlEvery = Ts > 0 ? Math.max(1, Math.round(Ts / dt)) : 1;
    let x = new Array(n).fill(0);
    let integ = 0, dF = 0, ePrev = 0, yPrev = 0, uHold = 0, first = true, lastCtlI = -1;
    const t = [], y = [], u = [], e = [];
    for (let i = 0; i <= steps; i++) {
      const tv = i * dt;
      const yv = meas(x);
      const dIn = dSeq ? (+dSeq(i, tv) || 0) : 0;   // 当前步对象输入端扰动
      if (i % ctrlEvery === 0) {
        const rv = rf(tv);
        const ev = rv - yv;
        // 微分项：先行用 −Δy，否则 Δe；差分按控制器实际周期 dT（数字 PID = Ts），
        // 不完全微分一阶滤波（Tf=0 为理想差分微分）
        const dT = first ? dt : (i - lastCtlI) * dt;
        const dSrc = first ? 0 : (dOnM ? -(yv - yPrev) : (ev - ePrev));
        let D = 0;
        if (kd) D = Tf > 0 ? (Tf * dF + kd * dSrc) / (Tf + dT) : kd * dSrc / dT;
        dF = D;
        const uRaw = kp * ev + integ + D;
        let uSat = uRaw;
        if (uMax != null) uSat = Math.max(-uMax, Math.min(uMax, uRaw));
        // 积分（含抗饱和）
        if (ki) {
          if (aw === 'clamp' && uMax != null && ((uRaw > uMax && ev > 0) || (uRaw < -uMax && ev < 0))) {
            /* 条件积分：饱和且误差继续同向 → 本拍不积分 */
          } else {
            integ += dT * ki * ev;
            if (aw === 'back' && uMax != null) integ += dT * (uSat - uRaw) / Tt;
          }
        }
        uHold = uSat;
        ePrev = ev; yPrev = yv; lastCtlI = i; first = false;
      }
      t.push(tv); y.push(yv); u.push(uHold); e.push(rf(tv) - yv);
      if (i < steps) {
        // RK4（步内 u 保持；对象输入 = uHold + dIn，扰动直接加在对象输入端）
        const k1 = dv(x, uHold + dIn);
        const x2 = x.map((v, j) => v + k1[j] * dt / 2);
        const k2 = dv(x2, uHold + dIn);
        const x3 = x.map((v, j) => v + k2[j] * dt / 2);
        const k3 = dv(x3, uHold + dIn);
        const x4 = x.map((v, j) => v + k3[j] * dt);
        const k4 = dv(x4, uHold + dIn);
        for (let j = 0; j < n; j++) x[j] += (dt / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]);
      }
    }
    return { ok: true, t, y, u, e };
  }

  /* ---------- ZN 临界比例度：相位 −180° 穿越点 → Ku/Tu ---------- */
  function znUltimate(num, den) {
    let prevPh = null, prevW = null;
    for (let i = 1; i <= 3000; i++) {
      const w = Math.pow(10, -2 + (4 * i) / 3000);
      const h = evalH(num, den, w);
      let ph = (180 / Math.PI) * Math.atan2(h.im, h.re);
      while (prevPh != null && ph > prevPh) ph -= 360;   // 展开环绕，保持相位连续下降
      if (prevPh != null && prevPh > -180 && ph <= -180) {
        const t = (prevPh + 180) / (prevPh - ph);
        const wpc = prevW + t * (w - prevW);
        const h2 = evalH(num, den, wpc);
        const mag = Math.hypot(h2.re, h2.im);
        if (mag > 1e-12) return { ok: true, Ku: 1 / mag, Tu: (2 * Math.PI) / wpc, wpc };
      }
      prevPh = ph; prevW = w;
    }
    return { ok: false, note: '开环相位滞后未达到 −180°：纯 P 恒稳定，无临界增益（如一阶/二阶对象）' };
  }

  /* ---------- FOPDT 两点法拟合（28.3% / 63.2%）：K、T、L ---------- */
  function fopdtFit(t, y) {
    if (!t || !y || t.length < 10) return { ok: false, note: '数据不足' };
    const y0 = y[0], K = y[y.length - 1] - y0;
    if (!(Math.abs(K) > 1e-9)) return { ok: false, note: '响应无稳态变化（含积分环节的对象开环阶跃无界，两点法不适用）' };
    // 稳态驻留检查：末段漂移需远小于总变化（未稳态/无界响应拒绝）
    const tail = y.slice(Math.floor(y.length * 0.95));
    const drift = Math.max(...tail) - Math.min(...tail);
    if (Math.abs(drift) > 0.01 * Math.abs(K)) return { ok: false, note: '响应末段未进入稳态（可能含积分环节或仿真过短）' };
    const crossing = (f) => {
      const target = y0 + f * K;
      const sgn = K > 0 ? 1 : -1;
      for (let i = 1; i < y.length; i++) {
        if ((y[i] - target) * sgn >= 0) {
          const a = y[i - 1] - target, b = y[i] - target;
          return t[i - 1] + ((t[i] - t[i - 1]) * a) / ((a - b) || 1e-12);
        }
      }
      return null;
    };
    const t28 = crossing(0.283), t63 = crossing(0.632);
    if (t28 == null || t63 == null || !(t63 > t28)) return { ok: false, note: '响应非典型 S 曲线，两点法不适配' };
    const T = 1.5 * (t63 - t28), L = t63 - T;
    if (!(T > 1e-9) || L < -0.05 * T) return { ok: false, note: '时间常数/纯迟延拟合退化' };
    return { ok: true, K, T, L: Math.max(0, L) };
  }

  /* ---------- PID 参数寻优：坐标下降最小化 ISE/IAE/ITAE ----------
   * 以 pidLoopSim 为目标函数，确定性坐标下降（步长减半细化），增益非负。
   * 返回 { ok, gains:{kp,ki,kd}, start, value, startValue, sims } */
  function pidOptimize(num, den, criterion, start, opts) {
    opts = opts || {};
    if (!['ise', 'iae', 'itae'].includes(criterion)) return { ok: false, note: 'criterion 须为 ise/iae/itae' };
    const base = {
      tmax: +opts.tmax || 12, steps: Math.min(+opts.steps || 1500, 4000),
      uMax: opts.uMax != null ? opts.uMax : null, aw: opts.aw, Tt: opts.Tt, Ts: opts.Ts
    };
    const Tf = Math.max(+start.Tf || 0, 0);
    const dOnM = !!start.dOnM;
    let sims = 0;
    const crit = (g) => {
      sims++;
      const r = pidLoopSim(num, den, { kp: g.kp, ki: g.ki, kd: g.kd, Tf, dOnM }, base);
      if (!r.ok || !r.y.every((v) => isFinite(v))) return Infinity;
      return errMetrics(r.t, r.e)[criterion];
    };
    const p = [Math.max(0, +start.kp || 0), Math.max(0, +start.ki || 0), Math.max(0, +start.kd || 0)];
    const startValue = crit({ kp: p[0], ki: p[1], kd: p[2] });
    let bestV = startValue;
    let steps = [0, 1, 2].map((i) => 0.3 * (Math.abs(p[i]) || 1));
    const maxSims = +opts.maxSims || 400;
    for (let iter = 0; iter < 60 && sims < maxSims; iter++) {
      let improved = false;
      for (let d = 0; d < 3 && sims < maxSims; d++) {
        for (const sgn of [1, -1]) {
          const q = p.slice();
          q[d] = Math.max(0, q[d] + sgn * steps[d]);
          if (q[d] === p[d]) continue;
          const v = crit({ kp: q[0], ki: q[1], kd: q[2] });
          if (v < bestV) { bestV = v; p[d] = q[d]; improved = true; break; }
        }
      }
      if (!improved) steps = steps.map((x) => x / 2);
      if (steps.every((x) => x < 1e-3)) break;
    }
    return { ok: true, gains: { kp: p[0], ki: p[1], kd: p[2] }, start: { kp: start.kp, ki: start.ki, kd: start.kd }, value: bestV, startValue, sims };
  }

  /* ---------- 根轨迹计算（纯函数）：1 + K·L(s) = 0，K: 0→∞ 对数扫描 ----------
   * 分支按「实根/共轭对」分组追踪；输出分支/极零点/渐近线/分离点/临界增益。
   * numS/denS 为开环传函自高到低系数（分母 1–8 阶）。 */
  const symGroup = (roots) => {
    const items = roots.map((r) => ({ re: r.re, im: r.im, used: false }));
    const reals = [], pairs = [];
    for (const it of items) {
      if (it.used) continue;
      if (Math.abs(it.im) < 1e-7) { it.used = true; reals.push({ re: it.re }); continue; }
      const cj = items.find((o) => !o.used && o !== it && Math.abs(o.re - it.re) < 1e-6 && Math.abs(o.im + it.im) < 1e-6);
      if (cj) { it.used = cj.used = true; pairs.push({ re: it.re, im: Math.abs(it.im) }); }
      else { it.used = true; reals.push({ re: it.re }); }
    }
    return { reals, pairs };
  };
  function rootLocus(numS, denS) {
    const n = denS.length - 1, m = numS.length - 1;
    if (n < 1 || n > 8) return null;
    const poles = polyRoots(denS);
    const zeros = m >= 1 ? polyRoots(numS) : [];
    const numP = numS.slice();
    while (numP.length < denS.length) numP.unshift(0);
    const Ks = [0];
    for (let i = 0; i < 120; i++) Ks.push(Math.pow(10, U.lerp(-4, -0.5, i / 119)));
    for (let i = 1; i <= 260; i++) Ks.push(Math.pow(10, U.lerp(-0.5, 5, i / 259)));
    const g0 = symGroup(poles);
    const branches = [];
    for (const r of g0.reals) branches.push({ type: 'real', cur: { re: r.re, im: 0 }, pts: [] });
    for (const p of g0.pairs) branches.push({ type: 'pair', cur: { re: p.re, im: p.im }, pts: [] });
    branches.forEach((b) => b.pts.push({ re: b.cur.re, im: b.cur.im, K: 0 }));
    for (const K of Ks) {
      if (K === 0) continue;
      const coef = denS.map((c, i) => c + K * (numP[i] || 0));
      if (!isFinite(coef[0]) || Math.abs(coef[0]) < 1e-18) continue;
      const roots = polyRoots(coef);
      if (roots.length !== n || roots.some((r) => !isFinite(r.re) || !isFinite(r.im))) continue;
      const g = symGroup(roots);
      const cands = [];
      g.reals.forEach((r) => cands.push({ type: 'real', v: { re: r.re, im: 0 }, used: false }));
      g.pairs.forEach((p) => cands.push({ type: 'pair', v: { re: p.re, im: p.im }, used: false }));
      for (const b of branches) {
        let bi = -1, bd = Infinity;
        cands.forEach((c, i) => {
          if (c.used) return;
          const d = Math.hypot(c.v.re - b.cur.re, (c.v.im - b.cur.im) * (c.type === b.type ? 1 : 0.35));
          if (d < bd) { bd = d; bi = i; }
        });
        if (bi >= 0) { cands[bi].used = true; b.cur = { ...cands[bi].v }; }
        b.pts.push({ re: b.cur.re, im: b.cur.im, K });
      }
    }
    const excess = n - m;
    let centroid = { re: 0, im: 0 }, angles = [];
    if (excess > 0) {
      let sr = 0, si = 0;
      for (const q of poles) { sr += q.re; si += q.im; }
      for (const q of zeros) { sr -= q.re; si -= q.im; }
      centroid = { re: sr / excess, im: si / excess };
      for (let k = 0; k < excess; k++) angles.push(((2 * k + 1) * Math.PI) / excess);
    }
    const crossings = [];
    for (const b of branches) {
      for (let i = 1; i < b.pts.length; i++) {
        const p0 = b.pts[i - 1], p1 = b.pts[i];
        if ((p0.re > 0) !== (p1.re > 0) && Math.abs(p0.re - p1.re) > 1e-12) {
          const t = (0 - p0.re) / (p1.re - p0.re);
          const im = Math.abs(p0.im + t * (p1.im - p0.im));
          crossings.push({ im, K: p0.K + t * (p1.K - p0.K) });
        }
      }
    }
    crossings.sort((a, b) => a.K - b.K);
    const brk = [];
    {
      let rEst = 1;
      for (const q of [...poles, ...zeros]) rEst = Math.max(rEst, Math.abs(q.re) + 1, Math.abs(q.im) + 1);
      const lo = -rEst * 1.2, hi = rEst * 1.2, grid = 3000;
      const samples = [];
      for (let i = 0; i <= grid; i++) {
        const s = lo + ((hi - lo) * i) / grid;
        const nv = horner(numS, { re: s, im: 0 }).re;
        const dvv = horner(denS, { re: s, im: 0 }).re;
        if (Math.abs(nv) < 1e-9) continue;
        const K = -dvv / nv;
        const cnt = poles.filter((q) => q.re > s).length + zeros.filter((q) => q.re > s).length;
        if (cnt % 2 !== 1 || K < 1e-9) continue;
        samples.push({ s, K, i });
      }
      for (let i = 1; i < samples.length - 1; i++) {
        if (samples[i + 1].i - samples[i].i > 2 || samples[i].i - samples[i - 1].i > 2) continue;
        const d1 = samples[i].K - samples[i - 1].K, d2 = samples[i + 1].K - samples[i].K;
        if (d1 * d2 < 0) brk.push({ s: samples[i].s, K: samples[i].K });
      }
      for (let i = brk.length - 2; i >= 0; i--) if (Math.abs(brk[i].s - brk[i + 1].s) < (hi - lo) / grid * 4) brk.splice(i + 1, 1);
    }
    return { branches, poles, zeros, centroid, angles, excess, crossings, brk };
  }

  return { horner, polyRoots, polyFromRoots, cdiv, fft, ifft, spectrum, dftPhasors, integrate, conv, deconv, window, gaussNoise, iir1, ltiResponse, evalH, bode, closedLoopMetrics, errSeries, steadyState, nyquistFull, jury, errMetrics, pidLoopSim, znUltimate, fopdtFit, pidOptimize, rootLocus };
})();

window.DSP = DSP;
