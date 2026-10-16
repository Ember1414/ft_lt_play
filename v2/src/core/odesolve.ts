/**
 * odesolve.ts — 方程求解内核（自 v1 odesolve.js 迁移，原 window.ODE）
 *   纯函数，无 DOM 依赖。
 *
 *   连续（s 域）：y^{(n)} + a_{n-1} y^{(n-1)} + … + a_0 y = f(t)
 *     L{y^{(k)}} = s^k Y − Σ_{m=0}^{k−1} s^{k−1−m} y^{(m)}(0)
 *     → Y(s) = (F(s) + P(s)) / A(s)，A(s)=Σa_k s^k，P(s)=初值多项式
 *     零输入 = P/A，零状态 = F/A（均为有理分式，数值通道互为独立验证）
 *
 *   离散（z 域）：Σ a_k y[n+k] = x[n]
 *     Z{y[n+k]} = z^k Y − Σ_{m=0}^{k−1} z^{k−m} y[m]
 *     → Y(z) = (X(z) + Q(z)) / D(z)，D(z)=Σa_k z^k，Q(z)=初值多项式
 *
 *   反变换复用 transforms 引擎；数值通道：RK4（连续）、差分方程直接递推（离散）。
 *   多项式一律自高到低（与 blocksolve/dsp 约定一致）。
 * 数值语义与 v1 完全一致（回归网：odesolve.test.mjs + parity.mjs）。
 */

import { normChars } from './expr';
import { pTrim } from './blocksolve';
import { polyMul, polyAdd } from './poly';
import { polyRoots } from './dsp';
import { TOL_AXIS, TOL_ZERO } from './tol';
import {
  parseTimeCombo,
  parseZCombo,
  partialFracGroups,
  texLaplaceGroups,
  evalLaplaceGroups,
  invZ,
} from './transforms';
import type { TimeItem, ZItem } from './transforms';
import type { Frac } from './blocksolve';
import type { Complex } from './complex';

const fact = (n: number): number => {
  let r = 1;
  for (let k = 2; k <= n; k++) r *= k;
  return r;
};
const MAX_ORDER = 4;

/* ================= LHS 解析（连续 / 离散共用骨架） ================= */

// 拆项：[]/() 内的 +/- 不切分（y[n+2] − 1.5y[n+1] 等）；stripStar 时吞掉乘号
function splitTerms(lhs: string, stripStar: boolean): Array<{ sign: number; t: string }> {
  const terms: Array<{ sign: number; t: string }> = [];
  let cur = '';
  let sign = 1;
  let started = false;
  let depth = 0;
  for (const ch of lhs) {
    if (ch === '[' || ch === '(') {
      depth++;
      cur += ch;
      continue;
    }
    if (ch === ']' || ch === ')') {
      depth--;
      cur += ch;
      continue;
    }
    if (depth === 0 && (ch === '+' || ch === '-')) {
      if (!started || cur === '') {
        if (ch === '-') sign = -sign;
        started = true;
        continue;
      }
      terms.push({ sign, t: cur });
      cur = '';
      sign = ch === '-' ? -1 : 1;
      continue;
    }
    if (stripStar && depth > 0 && ch === '*') {
      cur += ch;
      continue;
    }
    if (stripStar && ch === '*') continue;
    cur += ch;
    started = true;
  }
  if (cur) terms.push({ sign, t: cur });
  return terms;
}

// 「y」项导数/移位阶：y''' / y[[k]] / y[k] / y(k) / y^(k) / yk / y[n+k] / y(n+k) → k
function yOrder(rest: string): number | null {
  if (!rest) return 0;
  if (/^['\u2019]+$/.test(rest)) return rest.length;
  const mk = rest.match(/^[\[(]n\+(\d)[\])]$/);
  if (mk) return +mk[1];
  if (/^[\[(]?n[\])]?$/.test(rest)) return 0; // y[n] / y(n) / yn：零阶
  const bare = rest.replace(/[\[\]()\^\s]/g, '');
  if (/^\d$/.test(bare)) return +bare;
  return null;
}

export type ParseYTermsResult = { ok: true; n: number; a: number[] } | { ok: false; note: string };

function parseYTerms(lhs: string, variable: string): ParseYTermsResult {
  const a: number[] = [];
  for (const { sign, t } of splitTerms(lhs, true)) {
    const m = t.match(/^(\d+(?:\.\d+)?)?(y)(.*)$/i);
    if (!m || m[2].toLowerCase() !== variable) {
      return { ok: false, note: `左端含无法识别的项「${t}」（每项须为 c·${variable} 的各阶导数/移位）` };
    }
    const k = yOrder(m[3].replace(/^\*/, ''));
    if (k == null) return { ok: false, note: `左端含无法识别的项「${t}」` };
    if (k > MAX_ORDER) return { ok: false, note: `最高支持 ${MAX_ORDER} 阶` };
    a[k] = (a[k] || 0) + sign * (m[1] ? parseFloat(m[1]) : 1);
  }
  // 保留最高非零阶
  let n = a.length - 1;
  while (n >= 0 && !a[n]) n--;
  if (n < 0) return { ok: false, note: '未找到 ' + variable + ' 项' };
  return { ok: true, n, a: a.slice(0, n + 1).map((v) => v || 0) };
}

function parseRhs<T>(
  rhsStr: string,
  comboFn: (s: string) => T[] | null,
  what: string,
): { ok: true; items: T[] } | { ok: false; note: string } {
  const s = rhsStr.trim();
  if (!s || s === '0') return { ok: true, items: [] };
  const items = comboFn(s);
  if (!items) {
    return {
      ok: false,
      note: `右端 ${what} 无法解析：支持 c*exp(-a*t)*u(t)、c*sin(w*t)、c*t^n、u(t) 等线性组合（离散侧为 0.5^n*u(n)、n、cos(w*n)、u(n)、delta(n) 等）`,
    };
  }
  return { ok: true, items };
}

/* ================= 有理分式小工具（items → N/D，自高到低） ================= */

const polyPow = (p: number[], k: number): number[] => {
  let o = [1];
  for (let i = 0; i < k; i++) o = polyMul(o, p);
  return o;
};

export function itemFracS(it: TimeItem): Frac {
  const c = it.coef * it.sign;
  switch (it.kind) {
    case 'exp':
      return { n: [c], d: [1, it.a] };
    case 'texp':
      return { n: [c * fact(it.n)], d: polyPow([1, it.a], it.n + 1) };
    case 'sin':
      return { n: [c * it.w], d: [1, 0, it.w * it.w] };
    case 'cos':
      return { n: [c, 0], d: [1, 0, it.w * it.w] };
    case 'tpow':
      return { n: [c * fact(it.n)], d: polyPow([1, 0], it.n + 1) };
    case 'u':
    case 'const':
      return { n: [c], d: [1, 0] };
    default:
      return { n: [0], d: [1] };
  }
}

export function itemFracZ(it: ZItem): Frac {
  const c = it.coef * it.sign;
  switch (it.kind) {
    case 'an':
      return { n: [c, 0], d: [1, -it.a] };
    case 'nan':
      return { n: [c * it.a, 0], d: [1, -2 * it.a, it.a * it.a] };
    case 'n':
      return { n: [c, 0], d: [1, -2, 1] };
    case 'np2':
      return { n: [c, c, 0], d: [1, -3, 3, -1] };
    case 'zn':
      return { n: [c, -c * Math.cos(it.w), 0], d: [1, -2 * Math.cos(it.w), 1] };
    case 'zsn':
      return { n: [c * Math.sin(it.w), 0], d: [1, -2 * Math.cos(it.w), 1] };
    // 阻尼振荡（复极点对 r·e^{±jw}）：X(z)=c·z(z−r cos w)/(z²−2r cos w z+r²)
    case 'rncos':
      return it.r === 0
        ? { n: [c], d: [1] }
        : { n: [c, -c * it.r * Math.cos(it.w), 0], d: [1, -2 * it.r * Math.cos(it.w), it.r * it.r] };
    case 'rnsin':
      return it.r === 0
        ? { n: [0], d: [1] }
        : { n: [c * it.r * Math.sin(it.w), 0], d: [1, -2 * it.r * Math.cos(it.w), it.r * it.r] };
    case 'un':
    case 'const':
      return { n: [c, 0], d: [1, -1] };
    case 'delta':
      return { n: [c], d: [1] };
    default:
      return { n: [0], d: [1] };
  }
}

// Σ ni/di → 单个 N/D（逐项通分折叠）
export function combineFracs<T>(items: T[], fracOf: (it: T) => Frac): Frac {
  let N = [0];
  let D = [1];
  for (const it of items) {
    const f = fracOf(it);
    N = pTrim(polyAdd(polyMul(N, f.d), polyMul(f.n, D)));
    D = pTrim(polyMul(D, f.d));
  }
  return { n: pTrim(N), d: pTrim(D) };
}

const isZeroPoly = (p: number[]): boolean => !p.length || (p.length === 1 && Math.abs(p[0]) < TOL_ZERO);

/* ================= 连续：parseODE / solveODE / RK4 ================= */

export interface OdeChannelS {
  tex: string | null;
  note?: string;
  evalT?: ((t: number) => number) | null;
}

export interface OdeChannelZ {
  tex: string | null;
  note?: string;
  evalN?: ((n: number) => number) | null;
}

export type ParseODEResult =
  | { ok: true; n: number; a: number[]; rhsItems: TimeItem[] }
  | { ok: false; note: string };

export function parseODE(str: string): ParseODEResult {
  const s = normChars(str);
  const eq = s.indexOf('=');
  if (eq < 0) return { ok: false, note: '缺少等号「=」（左端 y 各阶项，右端 f(t)）' };
  const lhs = s.slice(0, eq).replace(/\s+/g, '');
  if (!lhs) return { ok: false, note: '等号左端为空' };
  const py = parseYTerms(lhs, 'y');
  if (!py.ok) return py;
  if (py.n < 1) return { ok: false, note: '至少需要一阶（含 y\' 或更高阶项）' };
  const pr = parseRhs(s.slice(eq + 1), parseTimeCombo, 'f(t)');
  if (!pr.ok) return pr;
  return { ok: true, n: py.n, a: py.a, rhsItems: pr.items };
}

export type SolveODEResult =
  | { ok: false; note: string }
  | {
      ok: true;
      n: number;
      A: number[];
      P: number[];
      F: Frac;
      zi: OdeChannelS;
      zs: OdeChannelS;
      full: OdeChannelS;
      poles: Complex[];
      stableText: string;
      note: string | null;
    };

export function solveODE(
  a: number[],
  rhsItems: TimeItem[] | null | undefined,
  ics?: Array<number | null | undefined> | null,
): SolveODEResult {
  const n = a.length - 1;
  if (n < 1) return { ok: false, note: '至少需要一阶' };
  if (Math.abs(a[n]) < TOL_ZERO) return { ok: false, note: '最高阶系数不能为 0' };
  const given = (ics || []).filter((v) => v != null && isFinite(Number(v))).length;
  const ic: number[] = [];
  for (let m = 0; m < n; m++) ic.push(ics && isFinite(Number(ics[m])) ? Number(ics[m]) : 0);
  const note = given < n ? `初值不足 ${n} 个，缺省按 0 补零` : null;

  const A = pTrim(a.slice().reverse());
  // 初值多项式 P(s)：L{y^(k)} = s^k Y − Σ s^{k−1−m} y^(m)(0)
  const Pasc = new Array<number>(n).fill(0);
  for (let k = 1; k <= n; k++) for (let m = 0; m < k; m++) Pasc[k - 1 - m] += a[k] * ic[m];
  const P = pTrim(Pasc.slice().reverse());

  const F = combineFracs(rhsItems || [], itemFracS);
  // Y_full = (N_F + P·D_F) / (D_F·A)；Y_zs = N_F/(D_F·A)；Y_zi = P/A
  const denFA = pTrim(polyMul(F.d, A));
  const Nfull = pTrim(polyAdd(F.n, polyMul(P, F.d)));

  const poles = polyRoots(A);
  const hasOut = poles.some((p) => p.re > TOL_AXIS);
  const hasJw = poles.some((p) => Math.abs(p.re) <= TOL_AXIS);
  const stableText = hasOut
    ? '不稳定（存在右半平面极点）'
    : hasJw
      ? '临界稳定（存在虚轴极点）'
      : '稳定（全部极点在左半平面）';

  const mk = (num: number[], den: number[], prefix: string): OdeChannelS => {
    if (isZeroPoly(num)) return { tex: prefix + '0', evalT: () => 0 };
    const pf = partialFracGroups(num, den);
    if (!pf.ok) return { tex: null, note: pf.note, evalT: null };
    return { tex: texLaplaceGroups(pf.groups, prefix), evalT: (t) => evalLaplaceGroups(pf.groups, t) };
  };
  return {
    ok: true,
    n,
    A,
    P,
    F,
    zi: mk(P, A, 'y_{zi}(t)='),
    zs: mk(F.n, denFA, 'y_{zs}(t)='),
    full: mk(Nfull, denFA, 'y(t)='),
    poles,
    stableText,
    note,
  };
}

/** RK4 数值仿真：x = [y, y', …, y^{(n-1)}] */
export function simulateODE(
  a: number[],
  rhsFn: ((t: number) => number) | null | undefined,
  ics: Array<number | null | undefined> | null | undefined,
  t0: number,
  t1: number,
  N: number,
): { t: number[]; y: number[] } | null {
  const n = a.length - 1;
  if (n < 1 || Math.abs(a[n]) < TOL_ZERO) return null;
  const x: number[] = [];
  for (let m = 0; m < n; m++) x.push(ics && isFinite(Number(ics[m])) ? Number(ics[m]) : 0);
  const deriv = (t: number, xv: number[]): number[] => {
    const out: number[] = [];
    for (let i = 0; i < n - 1; i++) out.push(xv[i + 1]);
    let acc = rhsFn ? rhsFn(t) : 0;
    for (let k = 0; k < n; k++) acc -= a[k] * xv[k];
    out.push(acc / a[n]);
    return out;
  };
  const h = (t1 - t0) / N;
  const tArr: number[] = [];
  const yArr: number[] = [];
  let t = t0;
  for (let i = 0; i <= N; i++) {
    tArr.push(t);
    yArr.push(x[0]);
    const k1 = deriv(t, x);
    const k2 = deriv(t + h / 2, x.map((v, j) => v + (h / 2) * k1[j]));
    const k3 = deriv(t + h / 2, x.map((v, j) => v + (h / 2) * k2[j]));
    const k4 = deriv(t + h, x.map((v, j) => v + h * k3[j]));
    for (let j = 0; j < n; j++) x[j] += (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]);
    t = t0 + (i + 1) * h;
  }
  return { t: tArr, y: yArr };
}

/* ================= 离散：parseDiffEq / solveDiffEq / 递推 ================= */

export type ParseDiffEqResult =
  | { ok: true; n: number; a: number[]; rhsItems: ZItem[] }
  | { ok: false; note: string };

export function parseDiffEq(str: string): ParseDiffEqResult {
  const s = normChars(str);
  const eq = s.indexOf('=');
  if (eq < 0) return { ok: false, note: '缺少等号「=」（左端 y[n+k] 各项，右端 x[n]）' };
  const lhs = s.slice(0, eq).replace(/\s+/g, '');
  if (!lhs) return { ok: false, note: '等号左端为空' };
  const py = parseYTerms(lhs, 'y');
  if (!py.ok) return py;
  if (py.n < 1) return { ok: false, note: '至少需要一阶（含 y[n+1] 或更高阶项）' };
  const pr = parseRhs(s.slice(eq + 1), parseZCombo, 'x[n]');
  if (!pr.ok) return pr;
  return { ok: true, n: py.n, a: py.a, rhsItems: pr.items };
}

export type SolveDiffEqResult =
  | { ok: false; note: string }
  | {
      ok: true;
      n: number;
      D: number[];
      Q: number[];
      X: Frac;
      zi: OdeChannelZ;
      zs: OdeChannelZ;
      full: OdeChannelZ;
      poles: Complex[];
      stableText: string;
      note: string | null;
    };

export function solveDiffEq(
  a: number[],
  rhsItems: ZItem[] | null | undefined,
  ics?: Array<number | null | undefined> | null,
): SolveDiffEqResult {
  const n = a.length - 1;
  if (n < 1) return { ok: false, note: '至少需要一阶' };
  if (Math.abs(a[n]) < TOL_ZERO) return { ok: false, note: '最高阶系数不能为 0' };
  const given = (ics || []).filter((v) => v != null && isFinite(Number(v))).length;
  const ic: number[] = [];
  for (let m = 0; m < n; m++) ic.push(ics && isFinite(Number(ics[m])) ? Number(ics[m]) : 0);
  const note = given < n ? `初值不足 ${n} 个，缺省按 0 补零` : null;

  const D = pTrim(a.slice().reverse());
  // 初值多项式 Q(z)：Z{y[n+k]} = z^k Y − Σ z^{k−m} y[m]
  const Qasc = new Array<number>(n + 1).fill(0);
  for (let k = 1; k <= n; k++) for (let m = 0; m < k; m++) Qasc[k - m] += a[k] * ic[m];
  const Q = pTrim(Qasc.slice().reverse());

  const X = combineFracs(rhsItems || [], itemFracZ);
  const denXD = pTrim(polyMul(X.d, D));
  const Nfull = pTrim(polyAdd(X.n, polyMul(Q, X.d)));

  const poles = polyRoots(D);
  const maxMod = poles.reduce((mx, p) => Math.max(mx, Math.hypot(p.re, p.im)), 0);
  const stableText =
    maxMod > 1 + TOL_AXIS
      ? '不稳定（存在单位圆外极点）'
      : maxMod > 1 - TOL_AXIS
        ? '临界（存在单位圆上极点）'
        : '稳定（全部极点在单位圆内）';

  const mk = (num: number[], den: number[], prefix: string): OdeChannelZ => {
    if (isZeroPoly(num)) return { tex: prefix + '0', evalN: () => 0 };
    const r = invZ(num, den);
    if (!r.tex) return { tex: null, note: r.note, evalN: null };
    // invZ 固定输出 h(n)=…：替换为对应响应名（保持同一求值器）
    return { tex: r.tex.replace('h(n)=', prefix), evalN: r.evalN };
  };
  return {
    ok: true,
    n,
    D,
    Q,
    X,
    zi: mk(Q, D, 'y_{zi}(n)='),
    zs: mk(X.n, denXD, 'y_{zs}(n)='),
    full: mk(Nfull, denXD, 'y(n)='),
    poles,
    stableText,
    note,
  };
}

/** 差分方程直接递推：y[0..n-1] 取初值，其余由 Σ a_k y[m+k] = x[m] 逐拍推出 */
export function recurDiff(
  a: number[],
  ics: Array<number | null | undefined> | null | undefined,
  xFn: ((m: number) => number) | null | undefined,
  N: number,
): number[] {
  const n = a.length - 1;
  const y: number[] = [];
  for (let m = 0; m < n; m++) y.push(ics && isFinite(Number(ics[m])) ? Number(ics[m]) : 0);
  for (let m = 0; m + n <= N; m++) {
    let acc = xFn ? xFn(m) : 0;
    for (let k = 0; k < n; k++) acc -= a[k] * y[m + k];
    y.push(acc / a[n]);
  }
  return y;
}

/* ================= 数据序列粘贴解析 ================= */

export type ParseDataSeqResult =
  | { ok: true; values: number[]; t?: number[]; dt?: number; Fs?: number }
  | { ok: false; note: string; badToken?: string };

// 单列：任意分隔的数值序列 → { ok, values }（n = 0..N−1，频谱归一化 ×fs）。
// 两列（≥2 行且每行恰 2 列 t y）→ { ok, values, t, dt, Fs }：校验时间严格递增且 Δt 均匀（偏差 ≤1%），
// 非均匀报错提示改用均匀采样或单列格式。向后兼容：字段只增不改，单列行为不变。
export function parseDataSeq(str: string): ParseDataSeqResult {
  const s = normChars(str).trim();
  if (!s) return { ok: false, note: '没有数据' };
  const lines = s
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l);
  if (lines.length >= 2) {
    const rows = lines.map((l) => l.split(/[,;\s]+/).filter((t) => t));
    if (rows.every((r) => r.length === 2)) {
      const ts: number[] = [];
      const ys: number[] = [];
      for (const r of rows) {
        const tv = Number(r[0]);
        const yv = Number(r[1]);
        if (!isFinite(tv)) {
          return { ok: false, badToken: r[0], note: `无法识别的时间「${r[0]}」（两列格式：第 1 列时间、第 2 列幅值）` };
        }
        if (!isFinite(yv)) return { ok: false, badToken: r[1], note: `无法识别的数据「${r[1]}」` };
        ts.push(tv);
        ys.push(yv);
      }
      if (!(ts[ts.length - 1] > ts[0])) {
        return { ok: false, note: '时间轴需严格递增（两列格式：第 1 列时间、第 2 列幅值）' };
      }
      const dtAvg = (ts[ts.length - 1] - ts[0]) / (ts.length - 1);
      for (let i = 1; i < ts.length; i++) {
        if (Math.abs(ts[i] - ts[i - 1] - dtAvg) > 0.01 * dtAvg) {
          return { ok: false, note: `时间轴非均匀采样（第 ${i + 1} 行 Δt 偏差 >1%）：请粘贴均匀采样数据，或改用单列（仅幅值）格式` };
        }
      }
      return { ok: true, values: ys, t: ts, dt: dtAvg, Fs: 1 / dtAvg };
    }
  }
  const toks = s.split(/[,;、\s]+/).filter((t) => t);
  const values: number[] = [];
  for (const t of toks) {
    const v = Number(t);
    if (!isFinite(v)) return { ok: false, badToken: t, note: `无法识别的数据「${t}」` };
    values.push(v);
  }
  if (!values.length) return { ok: false, note: '没有数据' };
  return { ok: true, values };
}