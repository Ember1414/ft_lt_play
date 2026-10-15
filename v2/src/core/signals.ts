/**
 * signals.ts — 信号/函数目录、形状生成、预设系统（自 v1 fx.js 迁移）
 * 数据（ftSignals/laplacePresets）+ 纯几何函数（shapePoints/customShapePoints）。
 * 数值与字符串语义与 v1 完全一致（回归网：lib.test.mjs + parity.mjs）。
 */

import { lerp } from './math';
import { TOL_AXIS } from './tol';
import type { Complex } from './complex';

/* ============ 傅立叶级数：笔画形状（返回复数点） ============ */

/** 弧长均匀重采样（closed 时自动闭合首尾） */
export function resamplePath(P: Complex[], N: number, closed: boolean): Complex[] {
  if (!P.length) return P;
  const Q = P.slice();
  if (closed) {
    const d = Math.hypot(Q[0].re - Q[Q.length - 1].re, Q[0].im - Q[Q.length - 1].im);
    if (d > TOL_AXIS) Q.push({ re: Q[0].re, im: Q[0].im });
  }
  const cum = [0];
  for (let i = 1; i < Q.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(Q[i].re - Q[i - 1].re, Q[i].im - Q[i - 1].im));
  }
  const L = cum[cum.length - 1] || 1;
  const out: Complex[] = [];
  let seg = 1;
  for (let k = 0; k < N; k++) {
    const target = (k / N) * L;
    while (seg < cum.length - 1 && cum[seg] < target) seg++;
    const t = (target - cum[seg - 1]) / (cum[seg] - cum[seg - 1] || 1);
    out.push({ re: lerp(Q[seg - 1].re, Q[seg].re, t), im: lerp(Q[seg - 1].im, Q[seg].im, t) });
  }
  return out;
}

/** 手绘点列（任意像素坐标 {x,y}）→ 闭合、弧长均匀重采样、居中归一化的复数点列
 *  与 shapePoints 同一规范（外接尺寸归一到 [-1,1]），可直接喂给 DFT */
export function customShapePoints(pts: Array<{ x: number; y: number }>, N = 512): Complex[] {
  if (!pts || pts.length < 3) return [];
  const P = resamplePath(pts.map((p) => ({ re: p.x, im: -p.y })), N, true);
  if (!P.length) return P;
  let x0 = P[0].re;
  let x1 = P[0].re;
  let y0 = P[0].im;
  let y1 = P[0].im;
  for (const p of P) {
    x0 = Math.min(x0, p.re);
    x1 = Math.max(x1, p.re);
    y0 = Math.min(y0, p.im);
    y1 = Math.max(y1, p.im);
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const s = Math.max(x1 - x0, y1 - y0) || 1;
  return P.map((p) => ({ re: ((p.re - cx) / s) * 2, im: ((p.im - cy) / s) * 2 }));
}

function verts(list: Array<[number, number]>): Complex[] {
  return list.map(([x, y]) => ({ re: x, im: y }));
}

export type ShapeKind = 'square' | 'triangle' | 'heart' | 'star' | 'butterfly' | 'gear' | 'spiral';

/** 笔画形状 → 归一化复数点列（N 点） */
export function shapePoints(kind: ShapeKind | string, N = 512): Complex[] {
  let P: Complex[] = [];
  let closed = true;
  switch (kind) {
    case 'square':
      P = verts([[-1, -1], [1, -1], [1, 1], [-1, 1]]);
      break;
    case 'triangle':
      P = verts([[0, 1], [-1, -0.75], [1, -0.75]]);
      break;
    case 'heart': {
      for (let i = 0; i < N; i++) {
        const t = (i / N) * 2 * Math.PI;
        const x = 16 * Math.pow(Math.sin(t), 3);
        const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        P.push({ re: x / 18, im: y / 18 });
      }
      break;
    }
    case 'star': {
      const spikes = 5;
      for (let i = 0; i < spikes * 2; i++) {
        const a = (i / (spikes * 2)) * 2 * Math.PI - Math.PI / 2;
        const r = i % 2 === 0 ? 1 : 0.38;
        P.push({ re: r * Math.cos(a), im: r * Math.sin(a) });
      }
      break;
    }
    case 'butterfly': {
      for (let i = 0; i < N; i++) {
        const t = (i / N) * 12 * Math.PI;
        const e = Math.exp(Math.cos(t));
        const k = e - 2 * Math.cos(4 * t) - Math.pow(Math.sin(t / 12), 5);
        P.push({ re: (Math.sin(t) * k) / 2.5, im: (-Math.cos(t) * k) / 2.5 });
      }
      break;
    }
    case 'gear': {
      const teeth = 8;
      for (let k = 0; k < teeth; k++) {
        const a0 = (k / teeth) * 2 * Math.PI;
        const a1 = ((k + 1) / teeth) * 2 * Math.PI;
        const mid = (a0 + a1) / 2;
        const rIn = 0.72;
        const rOut = 1;
        P.push({ re: rIn * Math.cos(a0), im: rIn * Math.sin(a0) });
        P.push({ re: rOut * Math.cos(a0 + (mid - a0) * 0.25), im: rOut * Math.sin(a0 + (mid - a0) * 0.25) });
        P.push({ re: rOut * Math.cos(mid), im: rOut * Math.sin(mid) });
        P.push({ re: rOut * Math.cos(a1 - (a1 - mid) * 0.25), im: rOut * Math.sin(a1 - (a1 - mid) * 0.25) });
        P.push({ re: rIn * Math.cos(a1), im: rIn * Math.sin(a1) });
      }
      break;
    }
    case 'spiral': {
      closed = false;
      for (let i = 0; i < N; i++) {
        const t = (i / (N - 1)) * 6 * Math.PI;
        const r = 0.12 + 0.88 * (i / (N - 1));
        P.push({ re: r * Math.cos(t), im: r * Math.sin(t) });
      }
      break;
    }
  }
  P = resamplePath(P, N, closed);
  if (P.length) {
    let x0 = P[0].re;
    let x1 = P[0].re;
    let y0 = P[0].im;
    let y1 = P[0].im;
    for (const p of P) {
      x0 = Math.min(x0, p.re);
      x1 = Math.max(x1, p.re);
      y0 = Math.min(y0, p.im);
      y1 = Math.max(y1, p.im);
    }
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const s = Math.max(x1 - x0, y1 - y0) || 1;
    return P.map((p) => ({ re: ((p.re - cx) / s) * 2, im: ((p.im - cy) / s) * 2 }));
  }
  return P;
}

/* ============ 傅立叶变换：常见信号（时域 + 解析频谱公式） ============ */

export interface SignalParamDef {
  k: string;
  label: string;
  min: number;
  max: number;
  v: number;
  step?: number;
  implicit?: boolean;
  fmt: (v: number) => string;
}

export interface FtSignal {
  id: string;
  name: string;
  t0: number;
  t1: number;
  tex: string;
  ft: string;
  note: string;
  f: (p: Record<string, number>, t: number) => number;
  params: () => SignalParamDef[];
  symmetric?: boolean;
}

export const ftSignals: FtSignal[] = [
  { id: 'rect', name: '矩形脉冲', t0: -2, t1: 2, tex: 'x(t)=\\operatorname{rect}_{\\,T}(t)=\\begin{cases}1 & |t|<T/2 \\\\ 0 & \\text{otherwise}\\end{cases}', ft: 'X(f)=T\\,\\mathrm{sinc}(T f)', note: '时域矩形 ↔ 频域 sinc。主瓣宽度: Δf = 1/T，脉冲越窄频谱越宽。', f: (p, t) => (Math.abs(t) < p.W / 2 ? 1 : 0), params: () => [{ k: 'W', label: '脉宽 T', min: 0.3, max: 3, v: 1, fmt: (v) => v.toFixed(2) }] },
  { id: 'gauss', name: '高斯脉冲', t0: -2, t1: 2, tex: 'x(t)=e^{-t^2/2\\sigma^2}', ft: 'X(f)=\\sqrt{2\\pi}\\sigma\\,e^{-2\\pi^2\\sigma^2 f^2}', note: '高斯 ↔ 高斯，是唯一的傅立叶变换“固定点”。σ 增大（更宽）→ 频谱更窄。', f: (p, t) => Math.exp(-(t * t) / (2 * p.sig * p.sig)), params: () => [{ k: 'sig', label: 'σ', min: 0.2, max: 1.6, v: 0.6, fmt: (v) => v.toFixed(2) }] },
  { id: 'decay', name: '单边指数衰减', t0: 0, t1: 4, tex: 'x(t)=e^{-at}\\;u(t)', ft: 'X(f)=\\frac{1}{a+j2\\pi f}', note: '幅度谱 |X|=1/\\sqrt{a^2+\\omega^2}，相位 ∠X=-\\arctan(\\omega/a)。衰减越快（a 大）→ 频谱越宽。', f: (p, t) => (t >= 0 ? Math.exp(-p.a * t) : 0), params: () => [{ k: 'a', label: '衰减 a', min: 0.2, max: 6, v: 2, fmt: (v) => v.toFixed(2) }] },
  { id: 'bilateral', name: '双边指数', t0: -2, t1: 2, tex: 'x(t)=e^{-a|t|}', ft: '|X(f)|=\\frac{2a}{a^2+\\omega^2}', note: '双边指数 ↔ 洛伦兹(Lorentzian)形状。', f: (p, t) => Math.exp(-p.a * Math.abs(t)), symmetric: true, params: () => [{ k: 'a', label: '衰减 a', min: 0.3, max: 4, v: 1.5, fmt: (v) => v.toFixed(2) }] },
  { id: 'sinc', name: 'sinc 脉冲', t0: -3, t1: 3, tex: 'x(t)=\\mathrm{sinc}\\left(B t\\right)=\\dfrac{\\sin(\\pi B t)}{\\pi B t}', ft: 'X(f)=\\dfrac{1}{B}\\,\\operatorname{rect}\\left(\\frac{f}{B}\\right)', note: 'sinc ↔ 矩形谱，是脉冲→频谱的一种理想“带限”对偶（与矩形互相对偶）。', f: (p, t) => { const x = Math.PI * p.B * t; return Math.abs(x) < TOL_AXIS ? 1 : Math.sin(x) / x; }, params: () => [{ k: 'B', label: 'B', min: 0.5, max: 3, v: 1.2, fmt: (v) => v.toFixed(2) }] },
  { id: 'cos', name: '余弦波', t0: -1, t1: 1, tex: 'x(t)=\\cos(2\\pi f_0 t)', ft: 'X(f)=\\tfrac12[\\delta(f{-}f_0)+\\delta(f{+}f_0)]', note: '理想余弦频谱是两条冲激线；若截断一段则会展宽为两个 sinc 峰。', f: (p, t) => Math.cos(2 * Math.PI * p.f0 * t), params: () => [{ k: 'f0', label: '频率 f₀', min: 1, max: 8, v: 3, step: 0.5, fmt: (v) => v.toFixed(1) }] },
  { id: 'delta', name: '单位冲激', t0: -1, t1: 1, tex: 'x(t)=\\delta(t)', ft: 'X(f)=1 \\quad (\\forall f)', note: '冲激 ↔ 常数（全频段平坦）。缩放：δ 越窄，频谱越平坦。', f: (p, t) => (Math.abs(t) < p.W / 2 ? 1 / p.W : 0), params: () => [{ k: 'W', label: '宽度(近似δ)', min: 0.02, max: 0.2, v: 0.08, implicit: true, fmt: (v) => v.toFixed(3) }] },
  { id: 'tri', name: '三角脉冲', t0: -2, t1: 2, tex: 'x(t)=\\left(1-\\dfrac{2|t|}{T}\\right)^{+}', ft: 'X(f)=\\tfrac{T}{2}\\,\\mathrm{sinc}^2\\!\\left(\\tfrac{T f}{2}\\right)', note: '三角脉冲 ↔ sinc 平方。比矩形脉冲旁瓣衰减更快。', f: (p, t) => Math.max(0, 1 - (2 * Math.abs(t)) / p.T), params: () => [{ k: 'T', label: '宽度 T', min: 0.5, max: 3, v: 1.6, fmt: (v) => v.toFixed(2) }] },
];

/* ============ 拉普拉斯变换：传递函数预设 ============ */

export interface LaplacePreset {
  name: string;
  num: number[];
  den: number[];
  note: string;
  tex: string;
}

export const laplacePresets: Record<string, LaplacePreset> = {
  first: { name: '一阶低通', num: [1], den: [1, 1], note: '极点 s=-1，稳定，带宽 ω₀=1。', tex: 'H(s)=\\dfrac{1}{s+1}' },
  second_under: { name: '二阶欠阻尼', num: [1], den: [1, 0.5, 1.25], note: '极点 -0.25±j·1.089，稳定，有衰减振荡。', tex: 'H(s)=\\dfrac{1}{s^2+0.5s+1.25}' },
  second_crit: { name: '二阶临界阻尼', num: [1], den: [1, 2, 1], note: '重根极点 s=-1，临界阻尼。', tex: 'H(s)=\\dfrac{1}{(s+1)^2}' },
  second_over: { name: '二阶过阻尼', num: [1], den: [1, 3, 2], note: '两个实极点 s=-1, -2，过阻尼无振荡。', tex: 'H(s)=\\dfrac{1}{s^2+3s+2}' },
  bandpass: { name: '带通', num: [0.9, 0], den: [1, 0.4, 1.21], note: '零点在原点，jω 轴附近共轭极点 → 带通。', tex: 'H(s)=\\dfrac{0.9s}{s^2+0.4s+1.21}' },
  delay: { name: '不稳定', num: [1], den: [1, -0.3, 1], note: '极点在右半平面 (实部>0) → 不稳定的发散振荡。', tex: 'H(s)=\\dfrac{1}{s^2-0.3s+1}' },
  marginal: { name: '临界稳定(纯虚极点)', num: [1], den: [1, 0, 1], note: '极点在 jω 轴 ±j1 → 等幅振荡，临界稳定。', tex: 'H(s)=\\dfrac{1}{s^2+1}' },
};