/**
 * dsp.ts — 数值信号处理 / 控制数学内核（自 v1 mathdsp.js 迁移）
 * 纯复数实现，无 DOM/浏览器依赖；数值语义与 v1 完全一致（回归网：lib/ctrl/jury/rootlocus/
 * tuning/pidsim/pidopt/dataproc/erranalysis.test.mjs）。
 *
 * 契约（务必保持）：
 * - 多项式系数一律「自高到低」；复数 { re, im }；
 * - 返回结构大量使用 { ok, ... } / { ok:false, note }，字段名与语义不得更改；
 * - 历史修正语义必须保留（ltiResponse 的 RK4 参数顺序修正、polyRoots 前导零剥离）。
 */

import { lerp, fmt } from './math';
import {
  TOL_ZERO,
  TOL_AXIS,
  TOL_ITER,
  TOL_SNAP,
  TOL_REL,
  TOL_TIGHT,
  TOL_CHECK,
  TOL_CONV,
  DIV_FLOOR,
  MIN_FLOOR,
} from './tol';
import type { Complex } from './complex';

/** 数值序列：普通数组或类型化数组（原地算法需要可变序列） */
export type NumSeries = number[] | Float64Array;

/* ---------- 多项式值 / 求根 ---------- */

/** 多项式求值（Horner，复数）：coef 自高到低 [a_n … a_0] */
export function horner(coef: number[], z: Complex): Complex {
  let re = 0;
  let im = 0;
  for (const c of coef) {
    const nr = re * z.re - im * z.im + c;
    const ni = re * z.im + im * z.re;
    re = nr;
    im = ni;
  }
  return { re, im };
}

/** 复数除法（分母模平方有 1e-30 下限兜底，保持 v1 行为） */
export function cdiv(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im || DIV_FLOOR;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

/** Durand–Kerner 多项式求根结果（M4 #9）：除根外额外给出是否收敛与迭代次数 */
export interface PolyRootsResult {
  roots: Complex[];
  /** 是否在 500 次迭代内收敛（退化输入无法求解时为 false） */
  converged: boolean;
  /** 实际迭代次数（0 = 未进入迭代即返回） */
  iterations: number;
}

/** Durand–Kerner 多项式求根的可观测版本（M4 #9，新增字段、不改既有契约）。
 *  根序列与 polyRoots 逐字段一致；polyRoots 即本函数 roots 字段的薄封装。 */
export function polyRootsEx(coefTopDown: number[]): PolyRootsResult {
  // 调用方常把分子补零对齐后送来（如 [0,0,1]）；必须先去掉前导零，
  // 否则 lead=0 会让整条系数变成 NaN，根全废（z 平面白屏、零点丢失）
  const src: number[] = [];
  let started = false;
  for (const c of coefTopDown) {
    if (!started && Math.abs(c) < TOL_ZERO) continue;
    started = true;
    src.push(c);
  }
  if (!src.length) return { roots: [], converged: true, iterations: 0 };
  const n = src.length - 1;
  if (n <= 0) return { roots: [], converged: true, iterations: 0 };
  const lead = src[0];
  if (!Number.isFinite(lead) || Math.abs(lead) < MIN_FLOOR) return { roots: [], converged: false, iterations: 0 };
  const coef = src.map((c) => c / lead);
  let R = 1;
  for (let i = 1; i < coef.length; i++) R = Math.max(R, Math.abs(coef[i]));
  R += 1;
  const roots: Complex[] = [];
  for (let i = 0; i < n; i++) {
    const ph = (2 * Math.PI * i) / n + 0.02;
    roots.push({ re: R * 0.5 * Math.cos(ph), im: R * 0.5 * Math.sin(ph) });
  }
  let converged = false;
  let iterations = 0;
  for (let it = 0; it < 500; it++) {
    iterations = it + 1;
    let delta = 0;
    for (let i = 0; i < n; i++) {
      let dr = 1;
      let di = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const ar = roots[i].re - roots[j].re;
        const ai = roots[i].im - roots[j].im;
        const nr = dr * ar - di * ai;
        const ni = dr * ai + di * ar;
        dr = nr;
        di = ni;
      }
      if (Math.abs(dr) + Math.abs(di) < TOL_SNAP) dr = TOL_ZERO;
      const p = horner(coef, roots[i]);
      const corr = cdiv({ re: p.re, im: p.im }, { re: dr, im: di });
      roots[i].re -= corr.re;
      roots[i].im -= corr.im;
      delta += Math.abs(corr.re) + Math.abs(corr.im);
    }
    if (delta < TOL_ITER) {
      converged = true;
      break;
    }
  }
  return { roots, converged, iterations };
}

/** Durand–Kerner 多项式求根（系数自高到低；固定 500 次迭代，容差 TOL_ITER）。
 *  既有契约与返回值不变；需要收敛信息请用 polyRootsEx（M4 #9）。 */
export function polyRoots(coefTopDown: number[]): Complex[] {
  return polyRootsEx(coefTopDown).roots;
}

/** 由根构造多项式（返回自高到低，首项系数 = cc，仅取实部；支持复数根） */
export function polyFromRoots(roots: Complex[], cc = 1): number[] {
  let re = [1];
  let im = [0]; // P(z) = 复数系数
  for (const r of roots) {
    // 乘 (z - r)
    const nre = new Array<number>(re.length + 1).fill(0);
    const nim = new Array<number>(im.length + 1).fill(0);
    for (let i = 0; i < re.length; i++) {
      // 高次项：coef[i] * z
      nre[i + 1] += re[i];
      nim[i + 1] += im[i];
      // 低次项：coef[i] * (-r)
      nre[i] += -re[i] * r.re + im[i] * r.im;
      nim[i] += -re[i] * r.im - im[i] * r.re;
    }
    re = nre;
    im = nim;
  }
  // 结果应为实系数（共轭根配对）；内部按升幂累积，返回前转为自高到低
  return re.map((r) => r * cc).reverse();
}

/* ---------- FFT (Cooley–Tukey 迭代) ---------- */

/** 原地 FFT（Cooley–Tukey 迭代；**长度必须为 2 的幂**，v1 同此约定）；返回同一对数组。
 *  与 v1 一致：非 2 的幂不报错但结果无意义，故内核不校验。M4 #10：v2 全部调用点
 *  （spectrum/conv/envelope/instFreq/periodogram 及 fourier·comm 工具视图）均已零填充到 2 的幂。 */
export function fft<T extends NumSeries>(re: T, im: T): { re: T; im: T } {
  const n = re.length;
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cRe = 1;
      let cIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * cRe - im[i + k + len / 2] * cIm;
        const vIm = re[i + k + len / 2] * cIm + im[i + k + len / 2] * cRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nRe = cRe * wRe - cIm * wIm;
        cIm = cRe * wIm + cIm * wRe;
        cRe = nRe;
      }
    }
  }
  return { re, im };
}

/** 逆 FFT（副本输入，不修改原数组；长度必须为 2 的幂，见 fft 的 M4 #10 约定） */
export function ifft<T extends NumSeries>(re: T, im: T): { re: T; im: T } {
  const clone = (s: T): T => (Array.isArray(s) ? s.slice() : s.slice()) as T;
  const reC = clone(re);
  const imC = clone(im);
  for (let i = 0; i < imC.length; i++) imC[i] = -imC[i]; // 共轭输入（副本，不修改原数组）
  fft(reC, imC);
  const n = reC.length;
  for (let i = 0; i < n; i++) {
    reC[i] /= n;
    imC[i] = -imC[i] / n; // 除以 n 并共轭还原输出
  }
  return { re: reC, im: imC };
}

/** 实数采样序列 → 单边幅度/相位谱（补零到 2 的幂；幅度密度约定 ×dt，单边 ×2） */
export function spectrum(y: NumSeries, dt: number): { f: number[]; mag: number[]; ph: number[] } {
  const N = y.length;
  let n = 1;
  while (n < N) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < N; i++) re[i] = y[i];
  fft(re, im);
  const f: number[] = [];
  const mag: number[] = [];
  const ph: number[] = [];
  for (let k = 0; k <= n / 2; k++) {
    f.push(k / (n * dt));
    const r = re[k];
    const i = im[k];
    mag.push(Math.hypot(r, i) * dt);
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

export interface DftPhasor {
  k: number;
  amp: number;
  phase: number;
  re: number;
  im: number;
}

/** 离散傅里叶系数（按 amp 降序；O(N²)，仅用于画圈动画） */
export function dftPhasors(pts: Complex[]): DftPhasor[] {
  const N = pts.length;
  const out: DftPhasor[] = [];
  for (let k = 0; k < N; k++) {
    let re = 0;
    let im = 0;
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

export function integrate(f: (x: number) => number, a: number, b: number, steps = 2000): number {
  if (b <= a) return 0;
  const h = (b - a) / steps;
  let s = f(a) + f(b);
  for (let i = 1; i < steps; i++) s += (i % 2 ? 4 : 2) * f(a + i * h);
  return (s * h) / 3;
}

/* ---------- 离散卷积 ---------- */

export function conv(a: number[], b: number[]): number[] {
  const out = new Float64Array(a.length + b.length - 1);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  return Array.from(out);
}

/* ---------- 频域反卷积（ε 正则化）：x̂ = IFFT( Y·conj(H) / (|H|²+ε) ) ----------
 * y、h 补零至 ≥max(len(y),len(h)) 的 2 的幂做 FFT（y 为完整线性卷积结果时频域除法可精确恢复输入）。
 * 返回 { x（长度=len(y)）, ok, residual }；残差 = ‖y − conv(x,h)‖/‖y‖（截断到 len(y)），
 * > 0.1 → ok=false（典型原因：h 频谱有零点、y 非完整卷积结果或噪声过强；正则化抑制爆炸但有偏）。 */
export type DeconvResult = { x: number[]; ok: boolean; residual: number } | { ok: false; note: string };

export function deconv(y: number[], h: number[]): DeconvResult {
  const N = y ? y.length : 0;
  if (!N || !h || !h.length) return { ok: false, note: '输入序列为空' };
  const eps = 1e-10;
  let n = 1;
  while (n < Math.max(N, h.length)) n <<= 1;
  const reY = new Float64Array(n);
  const imY = new Float64Array(n);
  const reH = new Float64Array(n);
  const imH = new Float64Array(n);
  for (let i = 0; i < N; i++) reY[i] = y[i];
  for (let i = 0; i < Math.min(h.length, n); i++) reH[i] = h[i];
  fft(reY, imY);
  fft(reH, imH);
  for (let k = 0; k < n; k++) {
    // Y·conj(H)/(|H|²+ε)：ε→0 的正则化极限，H 零点处不除零爆炸
    const hr = reH[k];
    const hi = imH[k];
    const den = hr * hr + hi * hi + eps;
    const nr = reY[k] * hr + imY[k] * hi;
    const ni = imY[k] * hr - reY[k] * hi;
    reY[k] = nr / den;
    imY[k] = ni / den;
  }
  const xf = ifft(reY, imY);
  const x = Array.from(xf.re.slice(0, N));
  // 残差回代：线性卷积截断到 len(y) 与观测对比
  const yh = conv(x, h);
  let res = 0;
  let ny = 0;
  for (let i = 0; i < N; i++) {
    const dv = y[i] - (yh[i] || 0);
    res += dv * dv;
    ny += y[i] * y[i];
  }
  const residual = Math.sqrt(res) / Math.max(Math.sqrt(ny), DIV_FLOOR);
  return { x, ok: residual <= 0.1, residual };
}

/* ---------- 谱窗函数 ---------- */

export type WindowType = 'rect' | 'hamming' | 'hanning' | 'blackman';

/** 窗函数（长度 N；结果严格钳到 [0,1]，清除浮点尘埃） */
export function window(type: WindowType, N: number): number[] {
  const w = new Array<number>(Math.max(1, N));
  if (N <= 1) {
    w[0] = 1;
    return w;
  }
  for (let i = 0; i < N; i++) {
    const r = (2 * Math.PI * i) / (N - 1);
    if (type === 'hamming') w[i] = 0.54 - 0.46 * Math.cos(r);
    else if (type === 'hanning') w[i] = 0.5 - 0.5 * Math.cos(r);
    else if (type === 'blackman') w[i] = 0.42 - 0.5 * Math.cos(r) + 0.08 * Math.cos(2 * r);
    else w[i] = 1;
  }
  for (let i = 0; i < N; i++) w[i] = Math.min(1, Math.max(0, w[i]));
  return w;
}

/* ---------- Box–Muller 白高斯噪声（n 点，标准差 sigma，缺省 1） ---------- */

export function gaussNoise(n: number, sigma?: number): number[] {
  const sg = sigma == null ? 1 : Number(sigma);
  const out = new Array<number>(Math.max(0, n | 0));
  for (let i = 0; i < out.length; i++) {
    let u1 = Math.random();
    if (u1 < MIN_FLOOR) u1 = MIN_FLOOR; // 防 log(0)
    out[i] = sg * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random());
  }
  return out;
}

/* ---------- 一阶 IIR 低通：y[k] = (1−α)·y[k−1] + α·x[k]（y[−1]=0，直接递推，非卷积） ---------- */

export function iir1(x: number[], alpha?: number): number[] {
  const a = Math.min(Math.max(alpha == null ? 0 : Number(alpha), 0), 1);
  const y = new Array<number>(x.length);
  let prev = 0;
  for (let k = 0; k < x.length; k++) {
    prev = (1 - a) * prev + a * x[k];
    y[k] = prev;
  }
  return y;
}

/* ---------- 状态空间仿真（可控标准型 / RK4） ---------- */
// num: 自高到低, den: 自高到低(首项=1)，返回 u(t) 的零状态响应
// 状态链 x1'=x2, …, xn' = -a_n·x1 - a_{n-1}·x2 - … - a_1·xn + u
// 输出 y = b0·u + Σ (b_{n-j} - b0·a_{n-j})·x_j（b0 为分子最高次系数，即高频直通增益）
export function ltiResponse(
  num: number[],
  den: number[],
  u: (t: number) => number,
  tmin: number,
  tmax: number,
  steps: number,
): { t: number[]; y: number[] } {
  const n = den.length - 1;
  const norm = den[0];
  const a = den.map((c) => c / norm);
  let b = num.slice();
  while (b.length < n + 1) b.unshift(0);
  b = b.map((x) => x / norm);
  const b0 = b[0];
  const C: number[] = [];
  for (let j = 0; j < n; j++) C.push(b[n - j] - b0 * a[n - j]);

  const dt = (tmax - tmin) / steps;
  const t = new Float64Array(steps + 1);
  const y = new Float64Array(steps + 1);
  const x = new Float64Array(n);
  for (let i = 0; i <= steps; i++) {
    const tv = tmin + i * dt;
    t[i] = tv;
    const uv = u(tv);
    let yout = b0 * uv;
    for (let j = 0; j < n; j++) yout += C[j] * x[j];
    y[i] = yout;

    const deriv = (v: Float64Array): Float64Array => {
      const out = new Float64Array(n);
      for (let j = 0; j < n - 1; j++) out[j] = v[j + 1];
      let acc = 0;
      for (let j = 0; j < n; j++) acc -= a[n - j] * v[j];
      out[n - 1] = acc + uv;
      return out;
    };
    // RK4：状态步进 x + k·h（注意原实现参数顺序反了，导致 k1 未参与积分）
    const stepX = (v: Float64Array, k: Float64Array, h: number): Float64Array => {
      const o = new Float64Array(n);
      for (let j = 0; j < n; j++) o[j] = v[j] + k[j] * h;
      return o;
    };
    const k1 = deriv(x);
    const k2 = deriv(stepX(x, k1, dt / 2));
    const k3 = deriv(stepX(x, k2, dt / 2));
    const k4 = deriv(stepX(x, k3, dt));
    for (let j = 0; j < n; j++) x[j] += (dt / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]);
  }
  return { t: Array.from(t), y: Array.from(y) };
}

/* ---------- 传递函数频响 G(jw) ---------- */

export function evalH(num: number[], den: number[], w: number): Complex {
  const z = { re: 0, im: w };
  return cdiv(horner(num, z), horner(den, z));
}

/** 波特图数据（wmin/wmax 为 10 的指数；相位连续展开到 ±180° 内） */
export function bode(
  num: number[],
  den: number[],
  wmin = -2,
  wmax = 3,
  pts = 260,
): { w: number[]; mag: number[]; ph: number[] } {
  const w: number[] = [];
  const mag: number[] = [];
  const ph: number[] = [];
  for (let i = 0; i < pts; i++) {
    const wv = Math.pow(10, lerp(wmin, wmax, i / (pts - 1)));
    const h = evalH(num, den, wv);
    w.push(wv);
    mag.push(20 * Math.log10(Math.hypot(h.re, h.im) + TOL_ZERO));
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
export type ClosedLoopMetrics =
  | { ok: false; stable: false; Mr: null; wr: null; wb: null; T0: null; note: string }
  | { ok: true; stable: false; Mr: null; wr: null; wb: null; T0: null }
  | { ok: true; stable: true; Mr: number; wr: number; wb: number | null; T0: number };

export function closedLoopMetrics(num: number[], den: number[]): ClosedLoopMetrics {
  const np = num.slice();
  while (np.length < den.length) np.unshift(0);
  const denCl = den.map((c, i) => c + np[i]); // 闭环分母 den+num
  while (denCl.length > 1 && Math.abs(denCl[0]) < TOL_ZERO) denCl.shift();
  if (!Number.isFinite(denCl[0]) || Math.abs(denCl[0]) < TOL_ZERO) {
    return { ok: false, stable: false, Mr: null, wr: null, wb: null, T0: null, note: '闭环分母退化' };
  }
  const poles = polyRoots(denCl).filter((q) => Number.isFinite(q.re) && Number.isFinite(q.im));
  if (poles.some((q) => q.re > TOL_AXIS)) return { ok: true, stable: false, Mr: null, wr: null, wb: null, T0: null };
  const t0 = Math.abs((num[num.length - 1] || 0) / (denCl[denCl.length - 1] || 1)); // |T(j0)|
  const N = 2400;
  const ws: number[] = [];
  const mags: number[] = [];
  let Mr = 0;
  let mi = 0;
  for (let i = 0; i < N; i++) {
    const wv = Math.pow(10, lerp(-3, 3, i / (N - 1)));
    const h = evalH(num, denCl, wv);
    const mv = Math.hypot(h.re, h.im);
    ws.push(wv);
    mags.push(mv);
    if (mv > Mr) {
      Mr = mv;
      mi = i;
    }
  }
  // 峰值三点抛物线细化（对数频域等间距）
  let wr = ws[mi];
  if (mi > 0 && mi < N - 1) {
    const d2 = mags[mi - 1] - 2 * mags[mi] + mags[mi + 1];
    if (Math.abs(d2) > 1e-15) {
      const dlt = (0.5 * (mags[mi - 1] - mags[mi + 1])) / d2;
      wr = Math.pow(10, Math.log10(ws[mi]) + (dlt * (Math.log10(ws[mi + 1]) - Math.log10(ws[mi - 1]))) / 2);
      Mr = Math.max(0, mags[mi] - 0.25 * (mags[mi - 1] - mags[mi + 1]) * dlt);
    }
  }
  let wb: number | null = null;
  if (t0 > TOL_AXIS) {
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
export type ErrSeriesResult = { ok: true; ks: number[] } | { ok: false; note: string };

export function errSeries(num: number[], den: number[], terms = 6): ErrSeriesResult {
  if (num.length - 1 >= den.length - 1) return { ok: false, note: 'L(s) 需为严格真分式（相对阶 ≥ 1）' };
  const np = num.slice();
  while (np.length < den.length) np.unshift(0);
  const N = den.slice().reverse(); // Φe 分子 = 开环分母（升幂）
  const D = den.map((c, i) => c + np[i]).reverse(); // Φe 分母 = den+num（升幂）
  if (!Number.isFinite(D[0]) || Math.abs(D[0]) < TOL_ZERO) {
    return { ok: false, note: '闭环在原点存在极点（D(0)=0），级数展开发散' };
  }
  const r = new Array<number>(terms + D.length).fill(0);
  for (let i = 0; i < N.length && i < r.length; i++) r[i] = N[i];
  const ks: number[] = [];
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
export interface SteadyStateResult {
  type: number;
  Kp: number;
  Kv: number;
  Ka: number;
  ess: { step: number; ramp: number; para: number };
}

export function steadyState(num: number[], den: number[]): SteadyStateResult {
  let nu = 0;
  for (let i = den.length - 1; i >= 0; i--) {
    if (Math.abs(den[i]) < TOL_AXIS) nu++;
    else break;
  }
  const numEnd = num[num.length - 1] || 0;
  const coefAt = (k: number): number => den[den.length - 1 - k]; // s^k 的系数（自高到低数组）
  const Kp = nu >= 1 ? Infinity : numEnd / (den[den.length - 1] || 1);
  const Kv = nu >= 2 ? Infinity : nu === 1 ? numEnd / (coefAt(1) || TOL_ZERO) : 0;
  const Ka = nu >= 3 ? Infinity : nu === 2 ? numEnd / (coefAt(2) || TOL_ZERO) : 0;
  return {
    type: nu,
    Kp,
    Kv,
    Ka,
    ess: {
      step: nu >= 1 ? 0 : 1 / (1 + Kp),
      ramp: nu >= 2 ? 0 : nu === 1 ? 1 / Kv : Infinity, // 型别不足 → ∞
      para: nu >= 3 ? 0 : nu === 2 ? 1 / Ka : Infinity,
    },
  };
}

/* ---------- 完整奈奎斯特判据 Z = N + P ----------
 * s 域围线：jω 轴（ω: −∞→∞）在虚轴极点处向右侧作小半圆 indent（半径 ε），
 * 右侧大半圆闭合（严格真分式时映射到原点附近，不贡献包围）。
 * N = G(jω) 曲线对 (−1,0) 的顺时针包围圈数（沿映射曲线的总辐角增量 / −2π）。
 * 返回 { P, N, Z, stable, onCritical }；闭环右半平面极点数 Z>0 ⇔ 闭环不稳定。
 * M11：临界邻域自适应加密（见 nyquistFull 内注释）——只细化「距离」估计，
 * 圈数累加仍走原粗采样，故 N/Z/P 与 v1 逐位一致。 */
export interface NyquistResult {
  P: number;
  N: number;
  Z: number;
  stable: boolean;
  onCritical: boolean;
}

/** M11 临界邻域细化轮数（每轮搜索半径再缩 16 倍；7 轮 ≈ 分辨率 2e-9·初始半径） */
const NYQ_REFINE_ROUNDS = 7;
/** M14 单次调用最多加密的「局部近临界轴段」数（互不相邻，按距离升序挑） */
const NYQ_REFINE_MAX = 4;
/** M14 参与加密的距离门限：粗采样距离 ≤ 该倍数 × 全轴最小距离（避免把算力花在无关区段） */
const NYQ_REFINE_FACTOR = 4;
/** M11 虚轴直线段采样点数（v1 为 500；折线跟踪误差 ~ O(步长²)，提升到 5000 后误差降约 100 倍，
 *  使「刚越过临界增益」时的整圈包围不再被折线「抄近道」漏掉） */
const NYQ_AXIS_SEG = 5000;

export function nyquistFull(num: number[], den: number[]): NyquistResult {
  const poles = polyRoots(den).filter((q) => Number.isFinite(q.re) && Number.isFinite(q.im));
  const P = poles.filter((q) => q.re > TOL_AXIS).length;
  // 虚轴极点（含原点）：按虚部排序并去重（重根只绕一次即可，重根映射的无限大弧自然是 ν×半圈）
  const jwPoles = poles
    .filter((q) => Math.abs(q.re) <= TOL_AXIS)
    .map((q) => q.im)
    .sort((a, b) => a - b)
    .filter((im, i, arr) => i === 0 || im - arr[i - 1] > TOL_REL);
  const scale = Math.max(1, ...poles.map((q) => Math.abs(q.re) + Math.abs(q.im)));
  const eps = TOL_CHECK * scale;
  const wMax = 200 * scale;

  // s 平面围线采样（按行进顺序：ω 从 −ωmax 升到 +ωmax，途中绕开虚轴极点）
  const sPts: Complex[] = [];
  let w = -wMax;
  for (const pim of [...jwPoles, Infinity]) {
    const wStop = pim === Infinity ? wMax : pim - eps;
    if (wStop > w + TOL_ZERO) {
      // 直线段 s=jω：从当前 w 到 wStop（首段含起点，后续段跳过重复点）
      const SEG = NYQ_AXIS_SEG;
      for (let i = sPts.length ? 1 : 0; i <= SEG; i++) sPts.push({ re: 0, im: w + ((wStop - w) * i) / SEG });
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
  // 映射 G(s)，统计对 (−1,0) 的辐角增量（顺带留档虚轴直线段采样，供临界邻域加密）
  const distOf = (g: Complex): number => Math.hypot(g.re + 1, g.im);
  let total = 0;
  let prev: number | null = null;
  let minDist = Infinity;
  const axisW: number[] = []; // 虚轴直线段采样点的 ω（沿行进方向单调递增）
  const axisD: number[] = []; // 对应的「到 (−1,0) 的距离」
  const axisA: number[] = []; // 对应的辐角 atan2(Im, Re+1)
  for (const s of sPts) {
    const g = cdiv(horner(num, s), horner(den, s));
    const dist = distOf(g);
    if (dist < minDist) minDist = dist;
    if (s.re === 0) {
      axisW.push(s.im);
      axisD.push(dist);
      axisA.push(Math.atan2(g.im, g.re + 1));
    }
    const a = Math.atan2(g.im, g.re + 1);
    if (prev != null) {
      let d = a - prev;
      if (d > Math.PI) d -= 2 * Math.PI;
      else if (d < -Math.PI) d += 2 * Math.PI;
      total += d;
    }
    prev = a;
  }
  // —— M11/M14 · 临界点邻域自适应加密 ——
  // 粗采样（每直线段 500 点、ω 跨度 ±200·scale）在曲线**贴近** (−1,0) 时严重欠采样：
  //  ① 严格相切（G=K/(s+1)³ 的 K=8，闭环极点恰在 ±j√3）：粗采样整体错过极小值
  //    （粗采样最小 ≈ 0.22 而真极小 ≈ 0）→ 旧实现误判 N=0、Z=0、stable；
  //  ② 刚越过临界增益（真值 2 个右半平面根）：折线在多边形上「抄近道」，穿越负实轴的落点被抬高到
  //    −1 的右侧 → 整圈包围被漏掉，Z 误报 0。
  // 解法：在「局部近临界」的虚轴轴段 [ω_{k−1}, ω_{k+1}] 上逐级加密（每轮把搜索半径缩 16 倍、
  //   均匀取 33 点，共 7 轮；对多极小 / 非单峰同样稳健），用**加密子路径替换该段的粗采样辐角贡献**，
  //   并把 minDist 收敛到真实极小值；其余段累加一字不动。
  // M14 扩展：加密**全部**互不相邻的近临界段（此前只加密单个最接近段）——
  //   `G=K/(s(s+1)(s+2))` 刚越过临界增益时曲线在 ω=±√2 有**两个对称穿越**，
  //   只修一处会让 N 少算一圈（Z 报 1，真值 2）；按距离升序 + 非相邻抑制 + 距离门限挑段即可两处都修。
  //   （实测：各档采样下「同一 N 且辐角和差异 ~1e-16」**不能**证明正确——粗采样可能稳定地漏看
  //    局部几何；故不可改用「结果收敛就停」的规则，仍需按几何挑段加密。）
  if (axisD.length > 2 && minDist > 0) {
    const atW = (w: number): { d: number; a: number } => {
      const g = cdiv(horner(num, { re: 0, im: w }), horner(den, { re: 0, im: w }));
      return { d: distOf(g), a: Math.atan2(g.im, g.re + 1) };
    };
    const wrap = (d: number): number => (d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d);
    // 挑段：内部样本（保证有左右邻居）→ 距离 ≤ 门限 → 距离升序 → 非相邻（间距 ≥ 3，加密括号不重叠）
    let axisMin = Infinity;
    for (let i = 1; i < axisD.length - 1; i++) if (axisD[i] < axisMin) axisMin = axisD[i];
    const cand: number[] = [];
    for (let i = 1; i < axisD.length - 1; i++) if (axisD[i] <= NYQ_REFINE_FACTOR * axisMin) cand.push(i);
    cand.sort((a, b) => axisD[a] - axisD[b]);
    const picks: number[] = [];
    for (const i of cand) {
      let clash = false;
      for (const j of picks) if (Math.abs(j - i) < 3) clash = true;
      if (clash) continue;
      picks.push(i);
      if (picks.length >= NYQ_REFINE_MAX) break;
    }
    picks.sort((a, b) => a - b); // 按行进顺序处理，辐角累加顺序与主循环一致
    for (const k of picks) {
      const lo = axisW[k - 1];
      const hi = axisW[k + 1];
      if (!(hi > lo)) continue;
      const seg: Array<{ w: number; a: number }> = [
        { w: lo, a: axisA[k - 1] },
        { w: hi, a: axisA[k + 1] },
      ];
      let wBest = axisW[k];
      let bestD = axisD[k];
      let half = Math.min(wBest - lo, hi - wBest);
      for (let round = 0; round < NYQ_REFINE_ROUNDS && half > 0; round++) {
        const step = half / 16;
        for (let i = -16; i <= 16; i++) {
          const w = wBest + i * step;
          if (w <= lo || w >= hi) continue; // 端点取粗采样值，不重复求值
          const p = atW(w);
          seg.push({ w, a: p.a });
          if (p.d < bestD) {
            bestD = p.d;
            wBest = w;
          }
        }
        half = step;
      }
      if (bestD < minDist) minDist = bestD;
      seg.sort((p, q) => p.w - q.w);
      let refined = 0;
      for (let i = 1; i < seg.length; i++) refined += wrap(seg[i].a - seg[i - 1].a);
      const coarse = wrap(axisA[k] - axisA[k - 1]) + wrap(axisA[k + 1] - axisA[k]);
      total += refined - coarse;
    }
  }
  const N = Math.round(-total / (2 * Math.PI)); // 顺时针为正（教材约定）
  const Z = N + P;
  return { P, N, Z, stable: Z === 0 && minDist > TOL_REL * scale, onCritical: minDist < TOL_REL * scale };
}

/* ---------- Jury 稳定判据（离散特征表，实系数自高到低 a0…an，n≥1） ----------
 * 条件：a0>0、P(1)>0、(−1)ⁿP(−1)>0、|a_n|<a0（n=1 时即 |a₁|<a₀），以及每行 r₀>|r_last|（n≥2）。
 * 首项为负：自动乘 −1 归一（判据只依赖根的位置），conds 中注明，不拒绝。
 * 返回 { ok, stable, conds:[{text,ok}], rows, rhoMax, margin }；
 * rhoMax = 最大特征根模（polyRoots 交叉验证），margin = 1−rhoMax；原有字段保持不变。 */
export type JuryResult =
  | { ok: false; note: string }
  | {
      ok: true;
      stable: boolean;
      conds: Array<{ text: string; ok: boolean }>;
      rows: number[][][];
      rhoMax: number | null;
      margin: number | null;
    };

export function jury(a: number[]): JuryResult {
  const n = a.length - 1;
  if (n < 1) return { ok: false, note: '阶数需 ≥ 1' };
  if (a.some((v) => !Number.isFinite(v))) return { ok: false, note: '系数含非有限数值' };
  if (!a[0]) return { ok: false, note: '首项系数不能为 0' };
  const neg = a[0] < 0;
  const p = neg ? a.map((v) => -v) : a; // 归一化后的系数（整体变号不改变根）
  const Pv = (z: number): number => horner(p, { re: z, im: 0 }).re;
  const conds: Array<{ text: string; ok: boolean }> = [];
  const add = (text: string, okv: boolean): boolean => {
    conds.push({ text, ok: !!okv });
    return okv;
  };
  if (neg) conds.push({ text: '首项为负，已按 −a 自动归一', ok: true });
  add(`a₀ = ${fmt(p[0], 4)} > 0`, p[0] > 0);
  add(`P(1) = ${fmt(Pv(1), 4)} > 0`, Pv(1) > TOL_AXIS);
  add(`(−1)ⁿ·P(−1) = ${fmt(Pv(-1) * Math.pow(-1, n), 4)} > 0`, Pv(-1) * Math.pow(-1, n) > TOL_AXIS);
  add(`|aₙ| = ${fmt(Math.abs(p[n]), 4)} < a₀ = ${fmt(p[0], 4)}`, Math.abs(p[n]) < p[0]);
  let stable = conds.every((cd) => cd.ok);
  const rows: number[][][] = [[p.slice()], [p.slice().reverse()]];
  let cur = p.slice();
  while (cur.length >= 3) {
    const m = cur.length;
    const last = cur[m - 1];
    const nxt: number[] = [];
    for (let k = 0; k < m - 1; k++) nxt.push(cur[0] * cur[k] - last * cur[m - 1 - k]);
    rows.push([nxt.slice(), nxt.slice().reverse()]);
    const okv = add(`r₀ = ${fmt(nxt[0], 4)} > |r_last| = |${fmt(nxt[nxt.length - 1], 4)}|`, nxt[0] > Math.abs(nxt[nxt.length - 1]));
    if (!okv) stable = false;
    cur = nxt;
  }
  // 最大特征根模与稳定裕度（Durand–Kerner 求根，仅供展示/交叉验证，不影响表格判据本身）
  let rhoMax: number | null = null;
  try {
    const roots = polyRoots(p).filter((q) => Number.isFinite(q.re) && Number.isFinite(q.im));
    if (roots.length) rhoMax = roots.reduce((m, q) => Math.max(m, Math.hypot(q.re, q.im)), -Infinity);
  } catch {
    rhoMax = null;
  }
  return { ok: true, stable, conds, rows, rhoMax, margin: rhoMax == null ? null : 1 - rhoMax };
}

/* ---------- 误差积分指标（ISE/IAE/ITAE），e(t) 采样序列，梯形积分 ---------- */

export function errMetrics(t: NumSeries, e: NumSeries): { ise: number; iae: number; itae: number } {
  const n = Math.min(t.length, e.length);
  let ise = 0;
  let iae = 0;
  let itae = 0;
  for (let i = 1; i < n; i++) {
    const dt = t[i] - t[i - 1];
    const e0 = Math.abs(e[i - 1]);
    const e1 = Math.abs(e[i]);
    const p0 = Math.abs(t[i - 1] * e[i - 1]);
    const p1 = Math.abs(t[i] * e[i]);
    iae += ((e0 + e1) / 2) * dt;
    ise += ((e[i - 1] * e[i - 1] + e[i] * e[i]) / 2) * dt;
    itae += ((p0 + p1) / 2) * dt;
  }
  return { ise, iae, itae };
}

/* ---------- PID 闭环时域仿真（含执行器限幅 / 抗饱和 / 微分滤波 / 微分先行 / 采样 / 输入端扰动） ----------
 * 单位负反馈 r=1：控制器离散更新（Ts>0 为数字 PID，ZOH 保持），对象 RK4 相变量步进。
 * ctrl: {kp, ki, kd, Tf(微分滤波时间常数,0=关), dOnM(微分先行)}；
 * opts: {tmax, steps, uMax(执行器限幅,null=无限), aw('off'|'clamp'|'back'), Tt(反算时间常数), Ts(采样周期,0=连续),
 *        dSeq(对象输入端扰动：数组 d[k]（按步索引，越界补 0）或 d(k,t) 函数；对象输入 = u + d；缺省/null=无)}
 * 返回 { ok, t, y, u, e }；对象需严格真分式。 */
export interface PidCtrl {
  kp?: number;
  ki?: number;
  kd?: number;
  Tf?: number;
  dOnM?: boolean;
}

export interface PidSimOpts {
  tmax?: number;
  steps?: number;
  uMax?: number | null;
  aw?: string;
  Tt?: number;
  Ts?: number;
  dSeq?: number[] | ((k: number, t: number) => number) | null;
  r?: number | ((t: number) => number);
}

export type PidSimResult =
  | { ok: true; t: number[]; y: number[]; u: number[]; e: number[] }
  | { ok: false; note: string };

export function pidLoopSim(num: number[], den: number[], ctrl: PidCtrl, opts: PidSimOpts = {}): PidSimResult {
  const kp = Number(ctrl.kp) || 0;
  const ki = Number(ctrl.ki) || 0;
  const kd = Number(ctrl.kd) || 0;
  const Tf = Math.max(Number(ctrl.Tf) || 0, 0);
  const dOnM = !!ctrl.dOnM;
  const uMax = opts.uMax != null && Number.isFinite(opts.uMax) ? Math.abs(opts.uMax) : null;
  const aw = opts.aw === 'clamp' || opts.aw === 'back' ? opts.aw : 'off';
  const Tt = Number(opts.Tt) > 0 ? Number(opts.Tt) : 1;
  const Ts = Number(opts.Ts) > 0 ? Number(opts.Ts) : 0;
  // 扰动序列（作用在控制器输出之后的对象输入端）：数组按步索引取值（越界补 0），或 d(k,t) 函数
  let dSeq: ((k: number, t: number) => number) | null = null;
  if (typeof opts.dSeq === 'function') dSeq = opts.dSeq;
  else if (Array.isArray(opts.dSeq)) {
    const arr = opts.dSeq;
    dSeq = (k) => (arr[k] != null ? Number(arr[k]) : 0);
  }
  const tmax = Number(opts.tmax) || 10;
  const steps = Math.min(Number(opts.steps) || 3000, 20000);
  if (!den || !den[0]) return { ok: false, note: '分母非法' };
  const n = den.length - 1;
  if (num.length - 1 >= den.length - 1) return { ok: false, note: '对象需为严格真分式（分子阶次 < 分母阶次）' };
  const d0 = den[0];
  const a = den.map((c) => c / d0); // [1, a1..an] 自高到低
  const c = num.slice();
  while (c.length < den.length) c.unshift(0);
  for (let i = 0; i < c.length; i++) c[i] /= d0; // c[0]=0；y=Σ c[i]x_i
  const dt = tmax / steps;
  const rf: (t: number) => number =
    typeof opts.r === 'function'
      ? opts.r
      : (() => {
          const v = opts.r != null ? Number(opts.r) : 1;
          return () => v;
        })();
  // a = [1, a1, ..., an]（s^n…s^0）；相变量 x1=y：ẋi=x_{i+1}，ẋn = u − Σ_{k=1..n} a[k]·x[n−k]
  const dv = (x: number[], u: number): number[] => {
    const o = new Array<number>(n);
    for (let i = 0; i < n - 1; i++) o[i] = x[i + 1];
    let acc = u;
    for (let k = 1; k <= n; k++) acc -= a[k] * x[n - k];
    o[n - 1] = acc;
    return o;
  };
  // y = c[1]·x_{n−1} + … + c[n]·x_1：s^{n−i} 系数配 (n−i+1) 阶导数态 x[n−i]
  const meas = (x: number[]): number => {
    let y = 0;
    for (let i = 1; i < c.length; i++) y += c[i] * x[n - i];
    return y;
  };
  const ctrlEvery = Ts > 0 ? Math.max(1, Math.round(Ts / dt)) : 1;
  const x = new Array<number>(n).fill(0);
  let integ = 0;
  let dF = 0;
  let ePrev = 0;
  let yPrev = 0;
  let uHold = 0;
  let first = true;
  let lastCtlI = -1;
  const t: number[] = [];
  const y: number[] = [];
  const u: number[] = [];
  const e: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const tv = i * dt;
    const yv = meas(x);
    const dIn = dSeq ? Number(dSeq(i, tv)) || 0 : 0; // 当前步对象输入端扰动
    if (i % ctrlEvery === 0) {
      const rv = rf(tv);
      const ev = rv - yv;
      // 微分项：先行用 −Δy，否则 Δe；差分按控制器实际周期 dT（数字 PID = Ts），
      // 不完全微分一阶滤波（Tf=0 为理想差分微分）
      const dT = first ? dt : (i - lastCtlI) * dt;
      const dSrc = first ? 0 : dOnM ? -(yv - yPrev) : ev - ePrev;
      let D = 0;
      if (kd) D = Tf > 0 ? (Tf * dF + kd * dSrc) / (Tf + dT) : (kd * dSrc) / dT;
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
          if (aw === 'back' && uMax != null) integ += (dT * (uSat - uRaw)) / Tt;
        }
      }
      uHold = uSat;
      ePrev = ev;
      yPrev = yv;
      lastCtlI = i;
      first = false;
    }
    t.push(tv);
    y.push(yv);
    u.push(uHold);
    e.push(rf(tv) - yv);
    if (i < steps) {
      // RK4（步内 u 保持；对象输入 = uHold + dIn，扰动直接加在对象输入端）
      const k1 = dv(x, uHold + dIn);
      const x2 = x.map((v, j) => v + (k1[j] * dt) / 2);
      const k2 = dv(x2, uHold + dIn);
      const x3 = x.map((v, j) => v + (k2[j] * dt) / 2);
      const k3 = dv(x3, uHold + dIn);
      const x4 = x.map((v, j) => v + k3[j] * dt);
      const k4 = dv(x4, uHold + dIn);
      for (let j = 0; j < n; j++) x[j] += (dt / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]);
    }
  }
  return { ok: true, t, y, u, e };
}

/* ---------- ZN 临界比例度：相位 −180° 穿越点 → Ku/Tu ---------- */

export type ZnResult = { ok: true; Ku: number; Tu: number; wpc: number } | { ok: false; note: string };

export function znUltimate(num: number[], den: number[]): ZnResult {
  let prevPh: number | null = null;
  let prevW = 0;
  for (let i = 1; i <= 3000; i++) {
    const w = Math.pow(10, -2 + (4 * i) / 3000);
    const h = evalH(num, den, w);
    let ph = (180 / Math.PI) * Math.atan2(h.im, h.re);
    while (prevPh != null && ph > prevPh) ph -= 360; // 展开环绕，保持相位连续下降
    if (prevPh != null && prevPh > -180 && ph <= -180) {
      const t = (prevPh + 180) / (prevPh - ph);
      const wpc = prevW + t * (w - prevW);
      const h2 = evalH(num, den, wpc);
      const m = Math.hypot(h2.re, h2.im);
      if (m > TOL_ZERO) return { ok: true, Ku: 1 / m, Tu: (2 * Math.PI) / wpc, wpc };
    }
    prevPh = ph;
    prevW = w;
  }
  return { ok: false, note: '开环相位滞后未达到 −180°：纯 P 恒稳定，无临界增益（如一阶/二阶对象）' };
}

/* ---------- FOPDT 两点法拟合（28.3% / 63.2%）：K、T、L ---------- */

export type FopdtResult = { ok: true; K: number; T: number; L: number } | { ok: false; note: string };

export function fopdtFit(t: NumSeries, y: NumSeries): FopdtResult {
  if (!t || !y || t.length < 10) return { ok: false, note: '数据不足' };
  const y0 = y[0];
  const K = y[y.length - 1] - y0;
  if (!(Math.abs(K) > TOL_AXIS)) {
    return { ok: false, note: '响应无稳态变化（含积分环节的对象开环阶跃无界，两点法不适用）' };
  }
  // 稳态驻留检查：末段漂移需远小于总变化（未稳态/无界响应拒绝）
  const tail = Array.from(y).slice(Math.floor(y.length * 0.95));
  const drift = tail.reduce((m, v) => Math.max(m, v), -Infinity) - tail.reduce((m, v) => Math.min(m, v), Infinity);
  if (Math.abs(drift) > 0.01 * Math.abs(K)) {
    return { ok: false, note: '响应末段未进入稳态（可能含积分环节或仿真过短）' };
  }
  const crossing = (f: number): number | null => {
    const target = y0 + f * K;
    const sgn = K > 0 ? 1 : -1;
    for (let i = 1; i < y.length; i++) {
      if ((y[i] - target) * sgn >= 0) {
        const a = y[i - 1] - target;
        const b = y[i] - target;
        return t[i - 1] + ((t[i] - t[i - 1]) * a) / (a - b || TOL_ZERO);
      }
    }
    return null;
  };
  const t28 = crossing(0.283);
  const t63 = crossing(0.632);
  if (t28 == null || t63 == null || !(t63 > t28)) return { ok: false, note: '响应非典型 S 曲线，两点法不适配' };
  const T = 1.5 * (t63 - t28);
  const L = t63 - T;
  if (!(T > TOL_AXIS) || L < -0.05 * T) return { ok: false, note: '时间常数/纯迟延拟合退化' };
  return { ok: true, K, T, L: Math.max(0, L) };
}

/* ---------- PID 参数寻优：坐标下降最小化 ISE/IAE/ITAE ----------
 * 以 pidLoopSim 为目标函数，确定性坐标下降（步长减半细化），增益非负。
 * 返回 { ok, gains:{kp,ki,kd}, start, value, startValue, sims } */
export interface PidOptimizeOpts {
  tmax?: number;
  steps?: number;
  uMax?: number | null;
  aw?: string;
  Tt?: number;
  Ts?: number;
  maxSims?: number;
}

export type PidOptimizeResult =
  | {
      ok: true;
      gains: { kp: number; ki: number; kd: number };
      start: PidCtrl;
      value: number;
      startValue: number;
      sims: number;
    }
  | { ok: false; note: string };

export function pidOptimize(
  num: number[],
  den: number[],
  criterion: string,
  start: PidCtrl,
  opts: PidOptimizeOpts = {},
): PidOptimizeResult {
  if (!['ise', 'iae', 'itae'].includes(criterion)) return { ok: false, note: 'criterion 须为 ise/iae/itae' };
  const key = criterion as 'ise' | 'iae' | 'itae';
  const base: PidSimOpts = {
    tmax: Number(opts.tmax) || 12,
    steps: Math.min(Number(opts.steps) || 1500, 4000),
    uMax: opts.uMax != null ? opts.uMax : null,
    aw: opts.aw,
    Tt: opts.Tt,
    Ts: opts.Ts,
  };
  const Tf = Math.max(Number(start.Tf) || 0, 0);
  const dOnM = !!start.dOnM;
  let sims = 0;
  const crit = (g: { kp: number; ki: number; kd: number }): number => {
    sims++;
    const r = pidLoopSim(num, den, { kp: g.kp, ki: g.ki, kd: g.kd, Tf, dOnM }, base);
    if (!r.ok || !r.y.every((v) => Number.isFinite(v))) return Infinity;
    return errMetrics(r.t, r.e)[key];
  };
  const p = [Math.max(0, Number(start.kp) || 0), Math.max(0, Number(start.ki) || 0), Math.max(0, Number(start.kd) || 0)];
  const startValue = crit({ kp: p[0], ki: p[1], kd: p[2] });
  let bestV = startValue;
  let steps = [0, 1, 2].map((i) => 0.3 * (Math.abs(p[i]) || 1));
  const maxSims = Number(opts.maxSims) || 400;
  for (let iter = 0; iter < 60 && sims < maxSims; iter++) {
    let improved = false;
    for (let d = 0; d < 3 && sims < maxSims; d++) {
      for (const sgn of [1, -1]) {
        const q = p.slice();
        q[d] = Math.max(0, q[d] + sgn * steps[d]);
        if (q[d] === p[d]) continue;
        const v = crit({ kp: q[0], ki: q[1], kd: q[2] });
        if (v < bestV) {
          bestV = v;
          p[d] = q[d];
          improved = true;
          break;
        }
      }
    }
    if (!improved) steps = steps.map((x) => x / 2);
    if (steps.every((x) => x < TOL_CONV)) break;
  }
  return {
    ok: true,
    gains: { kp: p[0], ki: p[1], kd: p[2] },
    start: { kp: start.kp, ki: start.ki, kd: start.kd },
    value: bestV,
    startValue,
    sims,
  };
}

/* ---------- 根轨迹计算（纯函数）：1 + K·L(s) = 0，K: 0→∞ 对数扫描 ----------
 * 分支按「实根/共轭对」分组追踪；输出分支/极零点/渐近线/分离点/临界增益。
 * numS/denS 为开环传函自高到低系数（分母 1–8 阶）。 */

export interface RootLocusBranchPoint {
  re: number;
  im: number;
  K: number;
}

export interface RootLocusBranch {
  type: 'real' | 'pair';
  cur: Complex;
  pts: RootLocusBranchPoint[];
}

export interface RootLocusResult {
  branches: RootLocusBranch[];
  poles: Complex[];
  zeros: Complex[];
  centroid: Complex;
  angles: number[];
  excess: number;
  crossings: Array<{ im: number; K: number }>;
  brk: Array<{ s: number; K: number }>;
}

interface SymItem {
  re: number;
  im: number;
  used: boolean;
}

function symGroup(roots: Complex[]): { reals: Array<{ re: number }>; pairs: Array<{ re: number; im: number }> } {
  const items: SymItem[] = roots.map((r) => ({ re: r.re, im: r.im, used: false }));
  const reals: Array<{ re: number }> = [];
  const pairs: Array<{ re: number; im: number }> = [];
  for (const it of items) {
    if (it.used) continue;
    if (Math.abs(it.im) < TOL_TIGHT) {
      it.used = true;
      reals.push({ re: it.re });
      continue;
    }
    const cj = items.find(
      (o) => !o.used && o !== it && Math.abs(o.re - it.re) < TOL_REL && Math.abs(o.im + it.im) < TOL_REL,
    );
    if (cj) {
      it.used = true;
      cj.used = true;
      pairs.push({ re: it.re, im: Math.abs(it.im) });
    } else {
      it.used = true;
      reals.push({ re: it.re });
    }
  }
  return { reals, pairs };
}

export function rootLocus(numS: number[], denS: number[]): RootLocusResult | null {
  const n = denS.length - 1;
  const m = numS.length - 1;
  if (n < 1 || n > 8) return null;
  const poles = polyRoots(denS);
  const zeros = m >= 1 ? polyRoots(numS) : [];
  const numP = numS.slice();
  while (numP.length < denS.length) numP.unshift(0);
  const Ks: number[] = [0];
  for (let i = 0; i < 120; i++) Ks.push(Math.pow(10, lerp(-4, -0.5, i / 119)));
  for (let i = 1; i <= 260; i++) Ks.push(Math.pow(10, lerp(-0.5, 5, i / 259)));
  const g0 = symGroup(poles);
  const branches: RootLocusBranch[] = [];
  for (const r of g0.reals) branches.push({ type: 'real', cur: { re: r.re, im: 0 }, pts: [] });
  for (const p of g0.pairs) branches.push({ type: 'pair', cur: { re: p.re, im: p.im }, pts: [] });
  branches.forEach((b) => b.pts.push({ re: b.cur.re, im: b.cur.im, K: 0 }));
  for (const K of Ks) {
    if (K === 0) continue;
    const coef = denS.map((c, i) => c + K * (numP[i] || 0));
    if (!Number.isFinite(coef[0]) || Math.abs(coef[0]) < TOL_SNAP) continue;
    const roots = polyRoots(coef);
    if (roots.length !== n || roots.some((r) => !Number.isFinite(r.re) || !Number.isFinite(r.im))) continue;
    const g = symGroup(roots);
    const cands: Array<{ type: 'real' | 'pair'; v: Complex; used: boolean }> = [];
    g.reals.forEach((r) => cands.push({ type: 'real', v: { re: r.re, im: 0 }, used: false }));
    g.pairs.forEach((p) => cands.push({ type: 'pair', v: { re: p.re, im: p.im }, used: false }));
    for (const b of branches) {
      let bi = -1;
      let bd = Infinity;
      cands.forEach((c, i) => {
        if (c.used) return;
        const d = Math.hypot(c.v.re - b.cur.re, (c.v.im - b.cur.im) * (c.type === b.type ? 1 : 0.35));
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      if (bi >= 0) {
        cands[bi].used = true;
        b.cur = { ...cands[bi].v };
      }
      b.pts.push({ re: b.cur.re, im: b.cur.im, K });
    }
  }
  const excess = n - m;
  let centroid: Complex = { re: 0, im: 0 };
  const angles: number[] = [];
  if (excess > 0) {
    let sr = 0;
    let si = 0;
    for (const q of poles) {
      sr += q.re;
      si += q.im;
    }
    for (const q of zeros) {
      sr -= q.re;
      si -= q.im;
    }
    centroid = { re: sr / excess, im: si / excess };
    for (let k = 0; k < excess; k++) angles.push(((2 * k + 1) * Math.PI) / excess);
  }
  const crossings: Array<{ im: number; K: number }> = [];
  for (const b of branches) {
    for (let i = 1; i < b.pts.length; i++) {
      const p0 = b.pts[i - 1];
      const p1 = b.pts[i];
      if ((p0.re > 0) !== (p1.re > 0) && Math.abs(p0.re - p1.re) > TOL_ZERO) {
        const t = (0 - p0.re) / (p1.re - p0.re);
        const im = Math.abs(p0.im + t * (p1.im - p0.im));
        crossings.push({ im, K: p0.K + t * (p1.K - p0.K) });
      }
    }
  }
  crossings.sort((a, b) => a.K - b.K);
  const brk: Array<{ s: number; K: number }> = [];
  {
    let rEst = 1;
    for (const q of [...poles, ...zeros]) rEst = Math.max(rEst, Math.abs(q.re) + 1, Math.abs(q.im) + 1);
    const lo = -rEst * 1.2;
    const hi = rEst * 1.2;
    const grid = 3000;
    const samples: Array<{ s: number; K: number; i: number }> = [];
    for (let i = 0; i <= grid; i++) {
      const s = lo + ((hi - lo) * i) / grid;
      const nv = horner(numS, { re: s, im: 0 }).re;
      const dvv = horner(denS, { re: s, im: 0 }).re;
      if (Math.abs(nv) < TOL_AXIS) continue;
      const K = -dvv / nv;
      const cnt = poles.filter((q) => q.re > s).length + zeros.filter((q) => q.re > s).length;
      if (cnt % 2 !== 1 || K < TOL_AXIS) continue;
      samples.push({ s, K, i });
    }
    for (let i = 1; i < samples.length - 1; i++) {
      if (samples[i + 1].i - samples[i].i > 2 || samples[i].i - samples[i - 1].i > 2) continue;
      const d1 = samples[i].K - samples[i - 1].K;
      const d2 = samples[i + 1].K - samples[i].K;
      if (d1 * d2 < 0) brk.push({ s: samples[i].s, K: samples[i].K });
    }
    for (let i = brk.length - 2; i >= 0; i--) {
      if (Math.abs(brk[i].s - brk[i + 1].s) < ((hi - lo) / grid) * 4) brk.splice(i + 1, 1);
    }
  }
  return { branches, poles, zeros, centroid, angles, excess, crossings, brk };
}