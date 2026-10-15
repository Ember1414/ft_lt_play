/**
 * randomsig.ts — 随机信号内核（M2 新增，无 v1 对应实现）
 *   确定性伪随机源（mulberry32，可复现）+ 白/均匀噪声、正弦；
 *   自相关/互相关（有偏估计，/N）；周期图与 Welch 平均周期图（单边 PSD）。
 * 契约：给定 seed 完全可复现（数据决定论）；PSD 满足 Parseval ∫P df = mean(x²)（真值钉）。
 */

import { fft, window, type WindowType } from './dsp';

/** mulberry32 伪随机数发生器（[0,1)，确定性、可复现） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 高斯白噪声（Box–Muller；给定 seed 可复现） */
export function whiteNoise(n: number, sigma = 1, seed = 1): number[] {
  const rnd = mulberry32(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let u1 = rnd();
    if (u1 < 1e-300) u1 = 1e-300;
    out.push(sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rnd()));
  }
  return out;
}

/** 均匀白噪声（±amp） */
export function uniformNoise(n: number, amp = 1, seed = 1): number[] {
  const rnd = mulberry32(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((rnd() * 2 - 1) * amp);
  return out;
}

/** 正弦：amp·sin(2π f n/fs + φ) */
export function sineWave(n: number, f: number, fs: number, amp = 1, phase = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(amp * Math.sin((2 * Math.PI * f * i) / fs + phase));
  return out;
}

export interface CorrResult {
  lag: number[];
  r: number[];
}

/** 自相关（有偏估计：r[k]=Σ_{i=0}^{N−1−k} x[i]x[i+k]/N；r[0]=mean(x²)） */
export function autocorr(x: number[], maxLag: number): CorrResult {
  const N = x.length;
  const lag: number[] = [];
  const r: number[] = [];
  for (let k = 0; k <= maxLag && k < N; k++) {
    let s = 0;
    for (let i = 0; i + k < N; i++) s += x[i] * x[i + k];
    lag.push(k);
    r.push(s / (N || 1));
  }
  return { lag, r };
}

/** 互相关（x 与 y 滞后 k：r[k]=Σ x[i]·y[i+k]/N） */
export function xcorr(x: number[], y: number[], maxLag: number): CorrResult {
  const N = Math.min(x.length, y.length);
  const lag: number[] = [];
  const r: number[] = [];
  for (let k = 0; k <= maxLag && k < N; k++) {
    let s = 0;
    for (let i = 0; i + k < N; i++) s += x[i] * y[i + k];
    lag.push(k);
    r.push(s / (N || 1));
  }
  return { lag, r };
}

export interface PsdResult {
  f: number[];
  /** 单边功率谱密度（单位²/Hz） */
  p: number[];
}

/** 周期图：单边 PSD，∫P df = mean(x²)；支持窗（默认矩形） */
export function periodogram(x: number[], fs: number, win: WindowType = 'rect'): PsdResult {
  const N = x.length;
  let n = 1;
  while (n < N) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const w = window(win, N);
  let wsum = 0;
  for (let i = 0; i < N; i++) {
    wsum += w[i] * w[i];
    re[i] = x[i] * w[i];
  }
  fft(re, im);
  const dt = 1 / fs;
  const norm = dt / (wsum || 1);
  const f: number[] = [];
  const p: number[] = [];
  for (let k = 0; k <= n / 2; k++) {
    let v = (re[k] * re[k] + im[k] * im[k]) * norm;
    if (k > 0 && k < n / 2) v *= 2;
    f.push((k * fs) / n);
    p.push(v);
  }
  return { f, p };
}

/** Welch 平均周期图：分段（overlap 比例）平均以降低方差；数据不足一段时退回周期图 */
export function welch(x: number[], fs: number, seg = 256, overlap = 0.5, win: WindowType = 'hamming'): PsdResult {
  const N = x.length;
  if (N < seg || seg < 4) return periodogram(x, fs, win);
  const step = Math.max(1, Math.floor(seg * (1 - Math.max(0, Math.min(0.95, overlap)))));
  let acc: number[] | null = null;
  let f: number[] = [];
  let count = 0;
  for (let start = 0; start + seg <= N; start += step) {
    const seg1 = x.slice(start, start + seg);
    const r = periodogram(seg1, fs, win);
    if (!acc) {
      acc = r.p.slice();
      f = r.f;
    } else {
      for (let i = 0; i < r.p.length && i < acc.length; i++) acc[i] += r.p[i];
    }
    count++;
  }
  if (!acc || count === 0) return periodogram(x, fs, win);
  return { f, p: acc.map((v) => v / count) };
}
