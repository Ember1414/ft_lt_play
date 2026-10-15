/**
 * poly.ts — 多项式基础运算（自 v1 util.js 迁移）
 * 契约：系数一律「自高到低」；全站唯一实现（v1 曾多处重复定义）。
 */

import { fmt } from './math';
import { TOL_AXIS } from './tol';

/** 多项式乘法：C[i+j] += a[i]·b[j]（长度 = a.len + b.len − 1） */
export function polyMul(a: number[], b: number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  return out;
}

/** 多项式加法（按低次对齐，等价于右对齐补零） */
export function polyAdd(a: number[], b: number[]): number[] {
  const n = Math.max(a.length, b.length);
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < a.length; i++) out[n - a.length + i] += a[i];
  for (let i = 0; i < b.length; i++) out[n - b.length + i] += b[i];
  return out;
}

/**
 * 多项式 → KaTeX 片段（自高到低系数；vn 为变量名，默认 s；全零返回 '0'）。
 * 注意：首项也带负号（前导零被跳过后，i===0 未必是首个输出项）。
 */
export function polyTex(c: number[], vn = 's'): string {
  let out = '';
  for (let i = 0; i < c.length; i++) {
    const pow = c.length - 1 - i;
    const a = c[i];
    if (Math.abs(a) < TOL_AXIS) continue;
    const sgn = out === '' ? (a < 0 ? '-' : '') : a > 0 ? '+' : '-';
    const coef = Math.abs(Math.abs(a) - 1) < TOL_AXIS && pow > 0 ? '' : fmt(Math.abs(a), 3);
    out += sgn + coef + (pow === 0 ? '' : pow === 1 ? vn : vn + '^{' + pow + '}');
  }
  return out || '0';
}