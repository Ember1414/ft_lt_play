/**
 * controldesign.ts — 控制器设计内核（M2 新增，无 v1 对应实现）
 *   频率法：超前（lead）/ 滞后（lag）校正器设计；极点配置（经可控标准型 + Ackermann）；
 *   灵敏度 S=1/(1+L)、补灵敏度 T=L/(1+L) 的频域形状（鲁棒性校核）。
 * 约定：num/den 自高到低（s 域）；校正器 C(s)=Kc·(s+z)/(s+p)——超前 p>z（相位超前），滞后 z>p（低频增益提升）。
 * 正确性由 parity.mjs「闭式真值校验」段钉死（最大相位角、低频增益比、标准型往返、极点配置特征多项式）。
 */

import { polyFromRoots, polyRoots } from './dsp';
import { acker, tfOf, type Matrix } from './statespace';
import { pTrim } from './blocksolve';
import type { Complex } from './complex';

const D2R = Math.PI / 180;

/** s 域频响：s=jw，返回幅值与相位（°） */
export function ctrlFreq(num: number[], den: number[], w: number): { mag: number; ph: number } {
  const ev = (p: number[]): { re: number; im: number } => {
    let re = 0;
    let im = 0;
    for (let i = 0; i < p.length; i++) {
      const pow = p.length - 1 - i;
      const magp = Math.pow(w, pow);
      const t = (pow * Math.PI) / 2;
      re += p[i] * magp * Math.cos(t);
      im += p[i] * magp * Math.sin(t);
    }
    return { re, im };
  };
  const N = ev(num);
  const D = ev(den);
  const dd = D.re * D.re + D.im * D.im || 1e-300;
  const re = (N.re * D.re + N.im * D.im) / dd;
  const im = (N.im * D.re - N.re * D.im) / dd;
  return { mag: Math.hypot(re, im), ph: (Math.atan2(im, re) * 180) / Math.PI };
}

/** 可控标准型：G(s)=num/den → {A,B,C,D}（den 首一后 a1..an、分子补零到 n+1 阶） */
export function controllableCanonical(
  num: number[],
  den: number[],
): { A: Matrix; B: Matrix; C: Matrix; D: Matrix; n: number } | null {
  const d = pTrim(den);
  if (d.length < 2 || Math.abs(d[0]) < 1e-12) return null;
  const a = d.map((c) => c / d[0]);
  const n = a.length - 1;
  const b = num.slice();
  while (b.length < n + 1) b.unshift(0);
  if (b.length > n + 1) return null; // 非真分式
  const dVal = b[0];
  const A: Matrix = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === 0 ? -(a[j + 1] || 0) : j === i - 1 ? 1 : 0)),
  );
  const B: Matrix = Array.from({ length: n }, (_, i) => [i === 0 ? 1 : 0]);
  const C: Matrix = [Array.from({ length: n }, (_, j) => b[j + 1] - dVal * (a[j + 1] || 0))];
  const D: Matrix = [[dVal]];
  return { A, B, C, D, n };
}

export type Compensation =
  | { ok: true; type: 'lead' | 'lag'; Kc: number; z: number; p: number; num: number[]; den: number[]; note: string }
  | { ok: false; note: string };

/** 超前校正：C(s)=Kc·(s+z)/(s+p)，在 ωm 处给出所需最大相位 φm 并令 |C·G|=1
 *  α=(1+sinφm)/(1−sinφm)，z=ωm/√α，p=ωm√α，∠C(jωm)=asin((α−1)/(α+1))=φm（闭式） */
export function designLead(plantNum: number[], plantDen: number[], PMdes: number, wm: number): Compensation {
  if (!(wm > 0)) return { ok: false, note: '设计频率须 > 0' };
  const g = ctrlFreq(plantNum, plantDen, wm);
  const need = PMdes - (180 + g.ph);
  if (!(need > 0)) return { ok: false, note: '该频率处无需超前（所需相位 ≤ 0°）' };
  if (need >= 80) return { ok: false, note: '所需相位 >80°，单级超前不可行（请提高 ωm 或改用双级）' };
  const phim = need * D2R;
  const alpha = (1 + Math.sin(phim)) / (1 - Math.sin(phim));
  const z = wm / Math.sqrt(alpha);
  const p = wm * Math.sqrt(alpha);
  const Kc = Math.sqrt(alpha) / Math.max(g.mag, 1e-300);
  return {
    ok: true,
    type: 'lead',
    Kc,
    z,
    p,
    num: [Kc, Kc * z],
    den: [1, p],
    note: `超前 · 需要相位 ${need.toFixed(1)}° · α=${alpha.toFixed(3)} · 零 z=${z.toFixed(4)} 极 p=${p.toFixed(4)}`,
  };
}

/** 滞后校正：C(s)=Kc·(s+z)/(s+p)，降低 ωc′ 附近增益以换取相位裕度；z=ωc′/10，β=z/p（低频增益比）
 *  Kc 由 |C(jωc′)·G(jωc′)|=1 精确定标 → 新穿越频率恰为 ωc′ */
export function designLag(plantNum: number[], plantDen: number[], wcNew: number, beta = 0): Compensation {
  if (!(wcNew > 0)) return { ok: false, note: '新穿越频率须 > 0' };
  const g = ctrlFreq(plantNum, plantDen, wcNew);
  if (!(g.mag > 1e-12)) return { ok: false, note: '该频率处对象增益过小' };
  const b = beta > 1 ? beta : g.mag; // 未指定则取对象增益作为所需衰减
  const z = wcNew / 10;
  const p = z / b;
  const cMag = Math.hypot(wcNew, z) / Math.hypot(wcNew, p);
  const Kc = 1 / (g.mag * cMag);
  return {
    ok: true,
    type: 'lag',
    Kc,
    z,
    p,
    num: [Kc, Kc * z],
    den: [1, p],
    note: `滞后 · 低频增益比 β=${b.toFixed(3)} · 零 z=${z.toFixed(4)} 极 p=${p.toFixed(4)}`,
  };
}

export interface PlacementResult {
  ok: true;
  K: number[];
  Acl: Matrix;
  poles: Complex[];
  /** 闭环传函（单位参考 → 输出，含 C(s)=1 的直接状态反馈） */
  closedLoop: { num: number[]; den: number[] };
  note: string;
}

/** 极点配置：可控标准型 + Ackermann → K，闭环 A−BK 的特征多项式应与期望一致 */
export function placePoles(plantNum: number[], plantDen: number[], desired: Complex[]): PlacementResult | { ok: false; note: string } {
  const ss = controllableCanonical(plantNum, plantDen);
  if (!ss) return { ok: false, note: '对象须为真分式（分子阶次 ≤ 分母阶次）' };
  if (desired.length !== ss.n) return { ok: false, note: `期望极点须恰好 ${ss.n} 个（对象阶次）` };
  const K = acker(ss.A, ss.B, desired);
  if (!K) return { ok: false, note: '不可配置：能控性矩阵奇异（对象不完全能控）' };
  const Acl = ss.A.map((row, i) => row.map((v, j) => v - K[j] * ss.B[i][0]));
  const cl = tfOf(Acl, ss.B, ss.C, [[0]]);
  return { ok: true, K, Acl, poles: polyRoots(cl.den), closedLoop: cl, note: `K = [${K.map((v) => v.toFixed(4)).join(', ')}]（u = −Kx 状态反馈）` };
}

/** 二阶主导极点 → 复极点对：ζ、ωn → −ζωn ± jωn√(1−ζ²) */
export function secondOrderPoles(zeta: number, wn: number): Complex[] {
  const z = Math.max(-0.999, Math.min(0.999, zeta));
  const wd = wn * Math.sqrt(1 - z * z);
  return [
    { re: -z * wn, im: wd },
    { re: -z * wn, im: -wd },
  ];
}

/** 期望极点集合 → 多项式（供灵敏度/闭环特征展示与校验） */
export function desiredPoly(desired: Complex[]): number[] {
  return pTrim(polyFromRoots(desired));
}
