/**
 * complex.ts — 复数基础运算（自 v1 util.js 迁移）
 * 契约：复数一律为普通对象 { re, im }；数值语义与 v1 完全一致（回归网：lib.test.mjs）。
 * 全站唯一实现——禁止在其它模块重复定义（v1 曾在 transforms/blocksolve 各写一份，v2 收敛于此）。
 */

export interface Complex {
  re: number;
  im: number;
}

export function cadd(a: Complex, b: Complex): Complex {
  return { re: a.re + b.re, im: a.im + b.im };
}

export function cscale(a: Complex, k: number): Complex {
  return { re: a.re * k, im: a.im * k };
}

export function cmul(a: Complex, b: Complex): Complex {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

/** 单位复指数 e^{jφ} */
export function cexp(ph: number): Complex {
  return { re: Math.cos(ph), im: Math.sin(ph) };
}

/** 极坐标 → 直角坐标：m·e^{jφ} */
export function polar(m: number, ph: number): Complex {
  return { re: m * Math.cos(ph), im: m * Math.sin(ph) };
}

/** 辐角 atan2(im, re)（rad） */
export function angle(c: Complex): number {
  return Math.atan2(c.im, c.re);
}

/** 模 |c| */
export function mag(c: Complex): number {
  return Math.hypot(c.re, c.im);
}