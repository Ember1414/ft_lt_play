/**
 * comm.ts — 调制与通信内核（M2 新增，无 v1 对应实现）
 *   AM（含调制度）/ DSB-SC / FM；解析信号包络（Hilbert，FFT 法）；
 *   采样与 sinc 重建（带限插值）；NRZ 码流 + 升余弦成形 + 眼图折叠。
 * 正确性由 parity.mjs「闭式真值校验」段钉死（AM 边带比、FM 瞬时频率、sinc 重建、DSB 载波抑制）。
 */

import { conv, fft, ifft } from './dsp';

const DT = (fs: number): number => 1 / fs;

/** AM 调制：(1 + m·msg(t))·cos(2π fc t)，|m|≤1 为常规调幅 */
export function amModulate(msg: number[], fc: number, fs: number, index: number): number[] {
  const dt = DT(fs);
  return msg.map((mv, i) => (1 + index * mv) * Math.cos(2 * Math.PI * fc * i * dt));
}

/** DSB-SC（抑制载波双边带）：msg(t)·cos(2π fc t) */
export function dsbSc(msg: number[], fc: number, fs: number): number[] {
  const dt = DT(fs);
  return msg.map((mv, i) => mv * Math.cos(2 * Math.PI * fc * i * dt));
}

/** FM 调制：cos(2π fc t + 2π kf ∫ msg dτ)；瞬时频率 = fc + kf·msg(t)（kf：Hz/单位） */
export function fmModulate(msg: number[], fc: number, fs: number, kf: number): number[] {
  const dt = DT(fs);
  const out: number[] = [];
  let acc = 0; // ∫_0^{i·dt} msg dτ（左矩形）
  for (let i = 0; i < msg.length; i++) {
    out.push(Math.cos(2 * Math.PI * fc * i * dt + 2 * Math.PI * kf * dt * acc));
    acc += msg[i];
  }
  return out;
}

/** 解析信号包络 |x + j·H{x}|（Hilbert 变换经 FFT：正频 −j、负频 +j，DC/Nyquist 置零） */
export function envelope(x: number[]): number[] {
  const N = x.length;
  let n = 1;
  while (n < N) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < N; i++) re[i] = x[i];
  fft(re, im);
  const hr = new Float64Array(n);
  const hi = new Float64Array(n);
  for (let k = 1; k < n / 2; k++) {
    hr[k] = im[k]; // −j·X_k = (im, −re)
    hi[k] = -re[k];
    hr[n - k] = -im[n - k]; // +j·X_{n−k}
    hi[n - k] = re[n - k];
  }
  const h = ifft(hr, hi);
  const out: number[] = [];
  for (let i = 0; i < N; i++) out.push(Math.hypot(x[i], h.re[i]));
  return out;
}

/** 降采样（零阶保持）：每 factor 个样点保留 1 个，再保持 factor 次 */
export function sampleHold(x: number[], factor: number): { samples: number[]; held: number[] } {
  const f = Math.max(1, Math.floor(factor));
  const samples: number[] = [];
  const held: number[] = [];
  for (let i = 0; i < x.length; i += f) samples.push(x[i]);
  for (const s of samples) for (let j = 0; j < f; j++) held.push(s);
  return { samples, held };
}

/** 带限 sinc 重建：x(t)=Σ_k x[k]·sinc(fs·(t−k/fs))，sinc(u)=sin(πu)/(πu) */
export function sincReconstruct(samples: number[], fs: number, t: number[]): number[] {
  const out: number[] = [];
  for (const tt of t) {
    let s = 0;
    for (let k = 0; k < samples.length; k++) {
      const u = fs * (tt - k / fs);
      s += samples[k] * (Math.abs(u) < 1e-12 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u));
    }
    out.push(s);
  }
  return out;
}

/** 双极性 NRZ 码流：bits∈{0,1} → ±amp，每符号 sps 个样点 */
export function nrzStream(bits: number[], sps: number, amp = 1): number[] {
  const out: number[] = [];
  for (const b of bits) for (let i = 0; i < sps; i++) out.push((b ? 1 : -1) * amp);
  return out;
}

/** 升余弦（RC）冲激响应核（长度 2·span·sps+1，α=rolloff） */
export function raisedCosine(span: number, sps: number, alpha: number): number[] {
  const L = span * sps;
  const h: number[] = [];
  const a = Math.max(1e-3, Math.min(1, alpha));
  for (let i = -L; i <= L; i++) {
    const t = i / sps;
    let v: number;
    if (Math.abs(t) < 1e-9) v = 1;
    else if (Math.abs(Math.abs(t) - 1 / (2 * a)) < 1e-9) v = (a / 2) * Math.sin(Math.PI / (2 * a)); // 洛必达极限
    else v = (Math.sin(Math.PI * t) / (Math.PI * t)) * (Math.cos(Math.PI * a * t) / (1 - Math.pow(2 * a * t, 2)));
    h.push(v);
  }
  const s = h.reduce((m, v) => m + v, 0) || 1;
  return h.map((v) => v / s);
}

/** 眼图折叠：成形波形的每 span 符号窗为一条轨迹（xs 单位为符号） */
export function eyeTraces(stream: number[], sps: number, span: number, maxTraces = 40): { xs: number[]; ys: number[] }[] {
  const width = span * sps;
  const traces: { xs: number[]; ys: number[] }[] = [];
  for (let start = 0; start + width <= stream.length && traces.length < maxTraces; start += sps) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i <= width; i++) {
      xs.push(i / sps);
      ys.push(stream[start + i] ?? 0);
    }
    traces.push({ xs, ys });
  }
  return traces;
}

/** 波形通过升余弦成形（卷积） */
export function shapeNRZ(bits: number[], sps: number, span: number, alpha: number, amp = 1): number[] {
  return conv(nrzStream(bits, sps, amp), raisedCosine(span, sps, alpha));
}
