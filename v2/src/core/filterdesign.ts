/**
 * filterdesign.ts — 滤波器设计内核（M2 新增，无 v1 对应实现）
 *   模拟原型：Butterworth / Chebyshev I / Chebyshev II（LP 原型，归一化截止）
 *   数字映射：频率预畸变 Ω=(2/T)tan(ωT/2) + 双线性变换（Tustin）
 *   变换：LP → HP（s → Ωc/s 的多项式替换）
 *   分析：freqz（幅频/相频/群时延）、系数量化对比
 *   FIR：窗函数法（理想 LP/hp 冲激响应 × 窗）
 * 正确性由 parity.mjs「闭式真值校验」段钉死（−3dB 点、通带纹波、阻带衰减、对称性等）。
 */

import { polyFromRoots, polyRoots, window, type WindowType } from './dsp';
import { polyMul } from './poly';
import { pTrim, tustin } from './blocksolve';
import type { Complex } from './complex';

export type IirFamily = 'butter' | 'cheby1' | 'cheby2';
export type BandKind = 'lp' | 'hp';

export interface Spec {
  family: IirFamily;
  band: BandKind;
  /** 通带边界频率（Hz） */
  fp: number;
  /** 阻带边界频率（Hz） */
  fstop: number;
  /** 通带波纹（dB，Chebyshev I 用；Butterworth 忽略，仅参与阶数估计） */
  Rp: number;
  /** 阻带衰减（dB） */
  Rs: number;
  /** 采样率（Hz） */
  fsamp: number;
}

export interface DesignResult {
  ok: true;
  n: number;
  /** z 域系数（正幂次，分母首一），可直接与 core.dsp.horner 配合求频响 */
  num: number[];
  den: number[];
  /** 模拟原型 H(s)（预畸变域 Ω=tan(ω/2)，分母首一）；供「交接系统分析」与原型零极点展示 */
  analog: { num: number[]; den: number[] };
  /** 归一化前数字截止频率（rad/sample，通带边缘） */
  wc: number;
  note: string;
}

export type DesignOutcome = DesignResult | { ok: false; note: string };

const dBToLin = (db: number): number => Math.pow(10, db / 10);

/* ================= 原型极点 ================= */

/** Butterworth 原型极点（ωc=1，左半平面单位圆上） */
function butterPoles(n: number): Complex[] {
  const out: Complex[] = [];
  for (let k = 1; k <= n; k++) {
    const th = (Math.PI * (2 * k + n - 1)) / (2 * n);
    out.push({ re: Math.cos(th), im: Math.sin(th) });
  }
  return out;
}

/** Chebyshev I 原型极点（ε 由通带波纹确定，ωc=1） */
function cheby1Poles(n: number, Rp: number): Complex[] {
  const eps = Math.sqrt(dBToLin(Rp) - 1);
  const g = Math.asinh(1 / eps) / n;
  const sh = Math.sinh(g);
  const ch = Math.cosh(g);
  const out: Complex[] = [];
  for (let k = 1; k <= n; k++) {
    const th = (Math.PI * (2 * k - 1)) / (2 * n);
    out.push({ re: -sh * Math.sin(th), im: ch * Math.cos(th) });
  }
  return out;
}

/** Chebyshev II（逆切比雪夫）原型：极点 = 1/p_I（I 型极点取同一 ε），零点 = ±j·sec θ
 *  ε 由阻带衰减定：ε = 1/√(10^{Rs/10}−1)；|H(jω)|² = ε²T_n²(1/ω)/(1+ε²T_n²(1/ω)) → ω=1 处恰为 −Rs，直流 0 dB */
function cheby2Proto(n: number, Rs: number): { num: number[]; den: number[] } {
  const eps = 1 / Math.sqrt(dBToLin(Rs) - 1);
  const pI = cheby1Poles(n, 10 * Math.log10(1 + eps * eps)); // 传 Rp 使 I 型极点恰用 ε
  const polesII: Complex[] = pI.map((p) => {
    const d = p.re * p.re + p.im * p.im || 1e-300;
    return { re: p.re / d, im: -p.im / d }; // 1/p = conj(p)/|p|²
  });
  const zeros: Complex[] = [];
  for (let k = 1; k <= Math.floor(n / 2); k++) {
    const th = (Math.PI * (2 * k - 1)) / (2 * n);
    const sec = 1 / Math.cos(th);
    zeros.push({ re: 0, im: sec }, { re: 0, im: -sec });
  }
  const den = pTrim(polyFromRoots(polesII));
  const numRaw = zeros.length ? pTrim(polyFromRoots(zeros)) : [1];
  // 直流增益归一：H(0)=1 → 缩放分子
  const num = numRaw.slice();
  const dcN = num[num.length - 1];
  const dcD = den[den.length - 1];
  if (Math.abs(dcN) > 1e-300) {
    const k = dcD / dcN;
    for (let i = 0; i < num.length; i++) num[i] *= k;
  }
  return { num: pTrim(num), den };
}

/** 原型（模拟、归一化截止 ωc=1）→ N/D */
function prototype(family: IirFamily, n: number, Rp: number, Rs: number): { num: number[]; den: number[] } {
  if (family === 'cheby2') return cheby2Proto(n, Rs);
  const poles = family === 'butter' ? butterPoles(n) : cheby1Poles(n, Rp);
  const den = pTrim(polyFromRoots(poles));
  // 增益归一：num = D(0)·H(0)；Butterworth/Chebyshev I 奇数阶 H(0)=1，Chebyshev I 偶数阶 H(0)=10^{−Rp/20}
  //   （注意用 D(s) 的常数项 den[末尾]，而非首项；Goodman 归一才能让通带边缘恰好落在 −Rp）
  const d0 = den[den.length - 1];
  if (family === 'butter') return { num: [d0], den };
  const gain = n % 2 === 0 ? Math.pow(10, -Rp / 20) : 1;
  return { num: [d0 * gain], den };
}

/* ================= 多项式变换 ================= */

/** LP → HP：H_hp(s) = H_p(Ωc/s)，直接对原型做 s→Ωc/s 替换（分子予以补零至与分母同阶）
 *  N(Ωc/s)·s^n / D(Ωc/s)·s^n：den[j]=d_{n−j}·Ωc^j，num[j]=a_{m−j}·Ωc^j（j>m 补 0） */
function lpToHp(num: number[], den: number[], wc: number): { num: number[]; den: number[] } {
  const n = den.length - 1;
  const m = num.length - 1;
  const denHp = den.map((_, j) => den[den.length - 1 - j] * Math.pow(wc, j));
  const numHp: number[] = [];
  for (let j = 0; j <= n; j++) numHp.push(j <= m ? num[m - j] * Math.pow(wc, j) : 0);
  return { num: pTrim(numHp), den: pTrim(denHp) };
}

/* ================= 阶数估计 ================= */

export function estimateOrder(spec: Spec): { n: number; note: string } | { ok: false; note: string } {
  const wp = (2 * Math.PI * spec.fp) / spec.fsamp;
  const ws = (2 * Math.PI * spec.fstop) / spec.fsamp;
  if (!(wp > 0) || !(wp < Math.PI)) return { ok: false, note: '通带边界须在 (0, fs/2) 内' };
  if (!(ws > 0) || !(ws < Math.PI)) return { ok: false, note: '阻带边界须在 (0, fs/2) 内' };
  if (spec.band === 'lp' && !(ws > wp)) return { ok: false, note: '低通要求 阻带边界 > 通带边界' };
  if (spec.band === 'hp' && !(wp > ws)) return { ok: false, note: '高通要求 通带边界 > 阻带边界' };
  const op = Math.tan(wp / 2);
  const os = Math.tan(ws / 2);
  const ratio = spec.band === 'lp' ? os / op : op / os;
  const a = (dBToLin(spec.Rs) - 1) / (dBToLin(spec.Rp) - 1);
  if (!(a > 0) || !(ratio > 1)) return { ok: false, note: '规格不可达：请检查 Rp/Rs 与边界' };
  let n: number;
  if (spec.family === 'butter') {
    n = Math.ceil(Math.log10(a) / (2 * Math.log10(ratio)));
  } else if (spec.family === 'cheby1') {
    n = Math.ceil(Math.acosh(Math.sqrt(a)) / Math.acosh(ratio));
  } else {
    // 逆切比雪夫（Chebyshev II）：与 I 型同阶 —— T_n(ratio) ≥ √a 的同一条件
    n = Math.ceil(Math.acosh(Math.sqrt(a)) / Math.acosh(ratio));
  }
  n = Math.max(1, Math.min(20, n));
  return { n, note: '估计阶数 n = ' + n + (n >= 20 ? '（已达上限，规格偏紧）' : '') };
}

/* ================= 设计（数字域） ================= */

export function designIIR(spec: Spec): DesignOutcome {
  const est = estimateOrder(spec);
  if ('ok' in est) return est;
  const n = est.n;
  const wp = (2 * Math.PI * spec.fp) / spec.fsamp;
  const ws = (2 * Math.PI * spec.fstop) / spec.fsamp;
  // 在 T 归一化模拟域设计：取 T=2 ⇒ 双线性 s=(1−z⁻¹)/(1+z⁻¹)，预畸变 Ω=tan(ω/2)
  // （等价于真实 T=1/fs 并 Ω=(2/T)tan(ωT/2)，但系数尺度良态、不出现 2/T 巨大因子）
  const T = 2;
  const Opass = Math.tan(wp / 2);
  const Ostop = Math.tan(ws / 2);
  // Butterworth −Rp 点校正：Ωc 使 Ωp 处衰减恰为 Rp（LP 用 1/k，HP 用 k，因 s→Ωc/s 方向相反）
  const kRp = Math.pow(dBToLin(spec.Rp) - 1, 1 / (2 * n));
  const edge =
    spec.family === 'butter'
      ? spec.band === 'lp'
        ? Opass / kRp
        : Opass * kRp
      : spec.family === 'cheby2'
        ? Ostop
        : Opass;
  const proto = prototype(spec.family, n, spec.Rp, spec.Rs);
  // LP：s→s/Ωc（系数乘 Ωc^{i−阶}，保持分子分母相对阶次不变）；HP：s→Ωc/s
  const resample = (p: number[]): number[] => p.map((c, i) => c * Math.pow(edge, i - (p.length - 1)));
  const shaped =
    spec.band === 'lp'
      ? { num: resample(proto.num), den: resample(proto.den) }
      : lpToHp(proto.num, proto.den, edge);
  const z = tustin(shaped.num, shaped.den, T);
  if (!z.ok) return { ok: false, note: z.note };
  // 模拟原型归一（分母首一）——不改变 H(s)，便于展示与交接
  const a0 = shaped.den[0] || 1;
  return {
    ok: true,
    n,
    num: pTrim(z.n),
    den: pTrim(z.d),
    analog: { num: pTrim(shaped.num.map((c) => c / a0)), den: pTrim(shaped.den.map((c) => c / a0)) },
    wc: wp,
    note: est.note + '；' + (spec.band === 'lp' ? '低通' : '高通') + '；双线性变换（已预畸变）',
  };
}

/* ================= 频响分析（数字域） ================= */

export interface FreqzResult {
  w: number[];
  magDb: number[];
  phase: number[];
  /** 群时延（样本） */
  group: number[];
}

/** 数字频响：z = e^{jω}（ω ∈ [0, π]），群时延用相位差分 */
export function freqz(num: number[], den: number[], points = 512): FreqzResult {
  const w: number[] = [];
  const magDb: number[] = [];
  const phase: number[] = [];
  const group: number[] = [];
  const evalAt = (wv: number): { re: number; im: number } => {
    const evalPoly = (p: number[]): { re: number; im: number } => {
      let re = 0;
      let im = 0;
      for (let i = 0; i < p.length; i++) {
        const pow = p.length - 1 - i;
        const th = wv * pow;
        const c = p[i];
        re += c * Math.cos(th);
        im -= c * Math.sin(th);
      }
      return { re, im };
    };
    const N = evalPoly(num);
    const D = evalPoly(den);
    const dd = D.re * D.re + D.im * D.im || 1e-300;
    return { re: (N.re * D.re + N.im * D.im) / dd, im: (N.im * D.re - N.re * D.im) / dd };
  };
  let prevPhase = 0;
  let unwrapped = 0;
  for (let i = 0; i <= points; i++) {
    const wv = (Math.PI * i) / points;
    const h = evalAt(wv);
    const m = Math.hypot(h.re, h.im);
    const ph = Math.atan2(h.im, h.re);
    if (i > 0) {
      let d = ph - prevPhase;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      unwrapped += d;
    }
    prevPhase = ph;
    w.push(wv);
    magDb.push(20 * Math.log10(m + 1e-300));
    phase.push(unwrapped);
    group.push(0);
  }
  const dw = Math.PI / points;
  for (let i = 1; i < w.length - 1; i++) {
    group[i] = -(phase[i + 1] - phase[i - 1]) / (2 * dw);
  }
  group[0] = group[1] ?? 0;
  group[group.length - 1] = group[group.length - 2] ?? 0;
  return { w, magDb, phase, group };
}

/* ================= 系数量化对比 ================= */

/** 归一化定点量化：按最大系数定标到 Q 位小数（B 位字长） */
export function quantizeCoef(coef: number[], bits: number): number[] {
  const mx = coef.reduce((m, c) => Math.max(m, Math.abs(c)), 0) || 1;
  const scale = Math.pow(2, 2 - Math.ceil(Math.log2(mx))); // 让最大系数落在 [1, 2)
  const q = Math.max(1, bits - 2);
  const step = Math.pow(2, -q);
  return coef.map((c) => Math.round(c * scale / step) * step / scale);
}

/* ================= FIR 窗函数法 ================= */

export type FirWindow = WindowType;

export interface FirDesign {
  ok: true;
  n: number;
  h: number[];
  fc: number;
  note: string;
}

/** 理想低通冲激响应（线性相位，M=(N−1)/2 中心）＋窗 */
export function designFIR(band: BandKind, N: number, fc: number, win: FirWindow, fsamp: number): FirDesign | { ok: false; note: string } {
  if (!(N >= 3)) return { ok: false, note: '抽头数 N ≥ 3' };
  if (!(fc > 0) || !(fc < fsamp / 2)) return { ok: false, note: '截止频率须在 (0, fs/2) 内' };
  const wc = (2 * Math.PI * fc) / fsamp;
  const M = (N - 1) / 2;
  const w = window(win, N);
  const h: number[] = [];
  const hp = band === 'hp';
  for (let k = 0; k < N; k++) {
    const m = k - M;
    let ideal: number;
    if (Math.abs(m) < 1e-12) ideal = wc / Math.PI;
    else ideal = Math.sin(wc * m) / (Math.PI * m);
    if (hp) ideal = (Math.abs(m) < 1e-12 ? 1 : 0) - ideal;
    h.push(ideal * w[k]);
  }
  return { ok: true, n: N, h, fc, note: (band === 'lp' ? '低通' : '高通') + ' · ' + N + ' 抽头 · ' + win + ' 窗' };
}

/** FIR 频率响应（实系数，线性相位 → 幅度直接由频响给出） */
export function firFreqz(h: number[], points = 512): { w: number[]; magDb: number[] } {
  const w: number[] = [];
  const magDb: number[] = [];
  for (let i = 0; i <= points; i++) {
    const wv = (Math.PI * i) / points;
    let re = 0;
    let im = 0;
    for (let k = 0; k < h.length; k++) {
      re += h[k] * Math.cos(wv * k);
      im -= h[k] * Math.sin(wv * k);
    }
    w.push(wv);
    magDb.push(20 * Math.log10(Math.hypot(re, im) + 1e-300));
  }
  return { w, magDb };
}

/** 极点（z 域，正幂次系数） */
export function filterPoles(den: number[]): Complex[] {
  return polyRoots(pTrim(den));
}

/** 系数 → 平均群时延（样本，线性相位 FIR 的 (N−1)/2） */
export function coefPolyMul(a: number[], b: number[]): number[] {
  return polyMul(a, b);
}