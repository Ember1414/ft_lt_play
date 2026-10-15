/**
 * margins.ts — 环路稳定裕度（M1 新增内核；算法与 v1 modules/system.js 完全一致）
 * PM：幅值 0 dB 首次穿越（升/降穿越都算，兼容高通型回路）处的 180° + ∠L；
 * GM：相位首次跌破 −180° 处的 −|L|(dB)；扫到上界仍未跌破（如二阶渐近 −180°）→ 无穷（null）。
 * 数据来源与 v1 相同：bode(num, den) 默认参数（10^-2 … 10^3，260 点）。
 */

import { bode, polyRoots } from './dsp';
import { TOL_AXIS, TOL_ZERO } from './tol';
import type { Complex } from './complex';

export interface LoopMargins {
  /** 幅值穿越频率 ωc（rad/s） */
  wc: number | null;
  /** 相位裕度 PM（°） */
  PM: number | null;
  /** 相位穿越频率 ωg（rad/s） */
  wg: number | null;
  /** 增益裕度 GM（dB）；null = 无相位穿越（∞） */
  GM: number | null;
  bode: { w: number[]; mag: number[]; ph: number[] };
  poles: Complex[];
  /** 极点分类：stable（全部左半平面）/ marginal（含虚轴极点）/ unstable（含右半平面极点） */
  poleClass: 'stable' | 'marginal' | 'unstable';
  stable: boolean;
  wn: number | null;
  zeta: number | null;
}

export function loopMargins(num: number[], den: number[]): LoopMargins {
  const bd = bode(num, den);

  let wc: number | null = null;
  let PM: number | null = null;
  for (let i = 0; i < bd.mag.length - 1; i++) {
    if (bd.mag[i] * bd.mag[i + 1] < 0) {
      const dm = bd.mag[i + 1] - bd.mag[i];
      const t = Math.abs(dm) < TOL_ZERO ? 0 : -bd.mag[i] / dm;
      const phAt = bd.ph[i] + t * (bd.ph[i + 1] - bd.ph[i]);
      wc = bd.w[i] * Math.pow(bd.w[i + 1] / bd.w[i], t);
      PM = 180 + phAt;
      break;
    }
  }

  let wg: number | null = null;
  let GM: number | null = null;
  for (let i = 0; i < bd.ph.length; i++) {
    if (bd.ph[i] > -180 && (i === bd.ph.length - 1 || bd.ph[i + 1] <= -180)) {
      if (i + 1 >= bd.ph.length) break; // 扫到上界未跌破 → 无穿越（GM = ∞）
      const dp = bd.ph[i + 1] - bd.ph[i];
      const t = Math.abs(dp) < TOL_ZERO ? 0 : (-180 - bd.ph[i]) / dp;
      const magAt = bd.mag[i] + t * (bd.mag[i + 1] - bd.mag[i]);
      wg = bd.w[i] * Math.pow(bd.w[i + 1] / bd.w[i], t);
      GM = Number.isFinite(magAt) ? -magAt : null;
      break;
    }
  }

  const poles = polyRoots(den);
  const hasRhp = poles.some((p) => p.re > TOL_AXIS);
  const hasJw = poles.some((p) => Math.abs(p.re) <= TOL_AXIS);
  const poleClass: LoopMargins['poleClass'] = hasRhp ? 'unstable' : hasJw ? 'marginal' : 'stable';
  const stable = poleClass === 'stable';
  let dom: Complex | null = null;
  for (const p of poles) {
    if (p.re >= -TOL_AXIS) continue;
    if (!dom || p.re > dom.re) dom = p;
  }
  const wn = dom ? Math.hypot(dom.re, dom.im) : null;
  return {
    wc,
    PM,
    wg,
    GM,
    bode: bd,
    poles,
    poleClass,
    stable,
    wn,
    zeta: dom && wn != null && wn > 0 ? -dom.re / wn : null,
  };
}