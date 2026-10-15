/**
 * math.ts — 通用数学工具（自 v1 util.js 迁移，纯函数无 DOM）
 * 数值语义与 v1 完全一致（回归网：lib.test.mjs）。
 */

import { TOL_ZERO, DB_FLOOR } from './tol';

export function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function mapRange(v: number, a0: number, a1: number, b0: number, b1: number): number {
  return b0 + ((v - a0) * (b1 - b0)) / (a1 - a0);
}

/**
 * 数值格式化（界面统一口径）：
 * 非有限 → '—'；|n| < 1e-12 归零；|n| ≥ 1000 或 0 < |n| < 0.001 走科学计数（2 位）。
 */
export function fmt(n: number, d = 3): string {
  if (!Number.isFinite(n)) return '—';
  let v = n;
  if (Math.abs(v) < TOL_ZERO) v = 0;
  return Math.abs(v) >= 1000 || (Math.abs(v) > 0 && Math.abs(v) < 0.001)
    ? v.toExponential(2)
    : Number(v.toFixed(d)).toString();
}

/** 线性值 → dB（下限 1e-12 防 −∞） */
export function toDb(n: number): number {
  return 20 * Math.log10(Math.max(Math.abs(n), DB_FLOOR));
}

/** 把 [min,max] 向外扩展 pad 比例；退化区间（min=max）先扩为 ±1 */
export function fitRange(min: number, max: number, pad = 0.05): [number, number] {
  let lo = min;
  let hi = max;
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const r = (hi - lo) * pad;
  return [lo - r, hi + r];
}

/** Knuth 洗牌（返回新数组，不改原数组） */
export function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}