/**
 * easing.ts — 缓动曲线库（规划书 §8.10：标准曲线 5 条 + 弹簧）
 * 全部为纯函数 (t∈[0,1]) → 归一化进度。
 */

export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;

export const easeInQuad: Easing = (t) => t * t;
export const easeOutQuad: Easing = (t) => t * (2 - t);

export const easeOutCubic: Easing = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic: Easing = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const easeOutQuint: Easing = (t) => 1 - Math.pow(1 - t, 5);
export const easeInOutSine: Easing = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

/** 缓入缓出（标准镜头曲线，克制，不越界） */
export const easeInOutQuad: Easing = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** 弹簧（临界阻尼近似）：用于"即时慢镜头"式联动（§4.16 极点拖动） */
export function spring(t: number): number {
  if (t >= 1) return 1;
  const w = 8.5;
  return 1 - Math.exp(-6.2 * t) * Math.cos(w * t);
}

export const EASINGS: Record<string, Easing> = {
  linear,
  easeInQuad,
  easeOutQuad,
  easeOutCubic,
  easeInOutCubic,
  easeOutQuint,
  easeInOutSine,
  easeInOutQuad,
  spring,
};