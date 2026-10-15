import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { spring } from '../../anim/easing';
import { Chart } from '../../chart/Chart';
import { ComplexPlane, type CPMarker } from '../../chart/ComplexPlane';
import { ExprField, FieldGroup, Metric, NumField, SegmentedChips, SliderField, StatePanel, StatusBadge, Switch } from '../../ui/components';
import { TeX } from '../../ui/TeX';
import {
  combineFracs,
  fNumeric,
  FsNumeric,
  invLaplace,
  itemFracS,
  laplaceOfItems,
  ltiResponse,
  parseTF,
  parseTimeCombo,
  polyFromRoots,
  polyRoots,
  polyTex,
  propVerify,
  pTrim,
  rocs,
} from '../../core';
import type { Complex, TimeItem } from '../../core';
import { createUndoStack } from '../../state/undo';
import { getModuleState, setModuleState } from '../../state/experiments';
import { useExperimentSync } from '../useSync';
import type { ToolViewProps } from '../api';

/**
 * 拉普拉斯变换（laplace）— M2 存量迁移升级
 * 五视图：s 平面（极零点拖拽 + ROC 遮罩 + 弹簧联动响应）/ 反变换（留数解析 vs 数值叠加）/
 *        多 ROC 分析（收敛域条带可视化）/ 时域 → 复频域（闭式 + 数值自检）/ 性质验证。
 * 数值与 v1 一致（core.transforms 回归网保障）；符号遵循《符号登记表》（σ、jω、ζ、ωn、ROC）。
 */

type ViewId = 'plane' | 'inverse' | 'rocs' | 'transform' | 'props';
type PropId = 'shift' | 'freq' | 'scale' | 'diff';
type MetricTone = 'default' | 'ok' | 'warn' | 'danger';

/** 极/零 spec：im ≥ 0；im > 1e-6 表示共轭对（与 v1 约定一致） */
interface PZ {
  re: number;
  im: number;
}

interface LapParams {
  view: ViewId;
  /** H(s) 原文（多项式或因式写法）；解析成功后折解为 gain/poles/zeros */
  expr: string;
  gain: number;
  poles: PZ[];
  zeros: PZ[];
  showROC: boolean;
  /** 信号 f(t)（变换 / 性质视图） */
  signal: string;
  prop: PropId;
  propParam: number;
}

const DEFAULT: LapParams = {
  view: 'plane',
  expr: '1/(s^2+0.5*s+1.25)',
  gain: 1,
  poles: [],
  zeros: [],
  showROC: true,
  signal: 'exp(-2*t)*u(t)',
  prop: 'shift',
  propParam: 1,
};

const VIEWS: ReadonlyArray<{ value: ViewId; label: string }> = [
  { value: 'plane', label: 's 平面' },
  { value: 'inverse', label: '反变换' },
  { value: 'rocs', label: 'ROC 分析' },
  { value: 'transform', label: '变换' },
  { value: 'props', label: '性质验证' },
];

const VIEW_HINTS: Record<ViewId, string> = {
  plane: '拖动极点 ✕ / 零点 ○ 实时观察稳定性、ζ·ωn 与阶跃/冲激响应的联动（弹簧缓动）。',
  inverse: '留数法反变换：h(t) 与 y_step(t) 的闭式解与数值仿真叠加互验。',
  rocs: '同一 F(s) 在全部可能收敛域下的时域属性与稳定性（因果 / 反因果 / 双边）。',
  transform: '时域因果组合信号 → F(s)：闭式、ROC、极点分布与定义积分自检。',
  props: '时移 / 频移 / 尺度 / 微分四条性质的数值恒等式验证（定义积分 vs 符号公式）。',
};

const PROP_CFG: Record<PropId, { label: string; min: number; max: number; step: number; def: number }> = {
  shift: { label: 'τ · 时移量 (s)', min: 0, max: 5, step: 0.05, def: 1 },
  freq: { label: 'a · 频移量 (rad/s)', min: -5, max: 5, step: 0.05, def: 1 },
  scale: { label: 'a · 尺度因子', min: 0.1, max: 5, step: 0.05, def: 2 },
  diff: { label: '（微分性质无参数）', min: 0, max: 1, step: 1, def: 0 },
};

const PROP_CHIPS: ReadonlyArray<{ value: PropId; label: string }> = [
  { value: 'shift', label: '时移' },
  { value: 'freq', label: '频移' },
  { value: 'scale', label: '尺度' },
  { value: 'diff', label: '微分' },
];

const TF_PRESETS: ReadonlyArray<{ label: string; expr: string }> = [
  { label: '一阶', expr: '1/(s+1)' },
  { label: '欠阻尼二阶', expr: '1/(s^2+0.5*s+1.25)' },
  { label: '带通', expr: 's/(s^2+0.4*s+1.21)' },
  { label: '因式', expr: '(s+2)/((s+1)*(s+3))' },
  { label: '重极点', expr: '1/(s+1)^2' },
  { label: '不稳定', expr: '1/(s^2-0.5*s+1.25)' },
];

const SIG_PRESETS: ReadonlyArray<{ label: string; expr: string }> = [
  { label: '指数', expr: 'exp(-2*t)*u(t)' },
  { label: '正弦', expr: 'sin(3*t)*u(t)' },
  { label: '斜坡²', expr: 't^2*u(t)' },
  { label: '临界', expr: 't*exp(-1*t)*u(t)' },
  { label: '组合', expr: 'exp(-2*t)*u(t)+cos(4*t)*u(t)' },
  { label: '阶跃', expr: 'u(t)' },
];

const TOL = 1e-9;
const NSTEP = 640;
/** 仿真窗口候选（确定性量化：拖动极点时不跳变） */
const SNAPS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16, 20, 30];

const r4 = (v: number): number => +v.toFixed(4);

const nf = (v: number | null | undefined, d = 3): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  return String(+v.toFixed(d));
};

/** 小量格式：|v| < 1e-3 用科学计数（避免结果条显示成 0.00 误导） */
const tiny = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  return v !== 0 && Math.abs(v) < 1e-3 ? v.toExponential(1) : nf(v, 4);
};

const cx = (re: number, im = 0, d = 3): string => {
  if (Math.abs(im) < 1e-9) return nf(re, d);
  return nf(re, d) + (im > 0 ? '+' : '−') + nf(Math.abs(im), d) + 'j';
};

const polyAt0 = (c: number[]): number => (c.length ? c[c.length - 1] : 0);

/** spec（im≥0，im>0 为共轭对）→ 展开根列表（v1 specsToRoots 同源） */
function specsToRoots(specs: PZ[]): Complex[] {
  const out: Complex[] = [];
  for (const s of specs) {
    out.push({ re: s.re, im: s.im });
    if (s.im > 1e-6) out.push({ re: s.re, im: -s.im });
  }
  return out;
}

/** 根列表 → spec（v1 rootsToSpecs 同源：正虚部为共轭对代表） */
function rootsToSpecs(roots: Complex[]): PZ[] {
  const out: PZ[] = [];
  for (const r of roots) {
    if (r.im > 1e-6) out.push({ re: r4(r.re), im: r4(r.im) });
    else if (r.im < -1e-6) continue;
    else out.push({ re: r4(r.re), im: 0 });
  }
  return out;
}

/** markers 展开下标 → spec 下标（v1 specIdxOf 同源） */
function specIdxOf(specs: PZ[], rootIdx: number): number {
  let k = rootIdx;
  for (let s = 0; s < specs.length; s++) {
    if (k < (specs[s].im > 1e-6 ? 2 : 1)) return s;
    k -= specs[s].im > 1e-6 ? 2 : 1;
  }
  return -1;
}

/** H(s)=N/D（自高到低）→ 归一化 { gain, poles, zeros }：D 首一，gain 并入分子 */
function decompose(tf: { num: number[]; den: number[] }): { gain: number; poles: PZ[]; zeros: PZ[] } | null {
  const d0 = tf.den[0];
  if (!isFinite(d0) || Math.abs(d0) < 1e-12) return null;
  const nz = pTrim(tf.num.map((c) => c / d0));
  const gain = nz.length ? nz[0] : 0;
  const zeros = nz.length > 1 && Math.abs(gain) > 1e-12 ? polyRoots(nz.map((c) => c / gain)) : [];
  return { gain: r4(gain), poles: rootsToSpecs(polyRoots(tf.den.map((c) => c / d0))), zeros: rootsToSpecs(zeros) };
}

/** 系数（自高到低）→ 表达式字符串（显式 * 与 ^；跳过零系数；同 v1 polyToStr 语义） */
function polyToStr(c: number[]): string {
  let out = '';
  for (let i = 0; i < c.length; i++) {
    const x = c[i];
    if (Math.abs(x) < 1e-9) continue;
    const p = c.length - 1 - i;
    const a = +Math.abs(x).toFixed(6);
    out += (out === '' ? (x < 0 ? '-' : '') : x < 0 ? '-' : '+') + a + (p === 0 ? '' : p === 1 ? '*s' : '*s^' + p);
  }
  return out || '0';
}

/** 由 K/极/零 反写 H(s)（拖拽 / 增删后同步输入框） */
function specsToExpr(gain: number, poles: PZ[], zeros: PZ[]): string {
  const den = poles.length ? polyFromRoots(specsToRoots(poles)) : [1];
  const num = zeros.length ? polyFromRoots(specsToRoots(zeros), gain) : [gain];
  const ns = polyToStr(num);
  const ds = polyToStr(den);
  return ds === '1' ? ns : ns + '/(' + ds + ')';
}

/** 因式形式（教科书标准形）：实根 (s+a)；共轭对 ((s−σ)²+ω²) */
function factorTexOf(specs: PZ[], varName: string): string {
  const parts: string[] = [];
  for (const s of specs) {
    if (s.im > 1e-6) {
      const lin = s.re >= 0 ? varName + '-' + nf(s.re, 2) : varName + '+' + nf(-s.re, 2);
      parts.push('\\left(\\left(' + lin + '\\right)^{2}+' + nf(s.im * s.im, 3) + '\\right)');
    } else {
      parts.push('\\left(' + (s.re >= 0 ? varName + '-' + nf(s.re, 2) : varName + '+' + nf(-s.re, 2)) + '\\right)');
    }
  }
  return parts.length ? parts.join('') : '1';
}

function yRangeOf(y: number[], pad = 0.12): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of y) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [-1, 1];
  if (hi - lo < 1e-9) return [lo - 1, hi + 1];
  const m = (hi - lo) * pad;
  return [lo - m, hi + m];
}

/** 解析解抽样点（留数闭式 → 图上散点，与数值曲线叠加互验） */
function anaPts(data: { t: number[] } | null, evalT: ((t: number) => number) | null): Array<{ x: number; y: number }> {
  if (!data || !evalT) return [];
  const stride = Math.max(1, Math.floor(data.t.length / 72));
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < data.t.length; i += stride) {
    const v = evalT(data.t[i]);
    if (Number.isFinite(v)) out.push({ x: data.t[i], y: v });
  }
  return out;
}

/**
 * 弹簧形变（§4.16「极点拖动 → 响应曲线联动慢镜头」）：
 * 网格长度不变时旧曲线以 spring 缓动让位于新曲线；reduced-motion 用户直接切换。
 */
function useMorphCurve(
  next: { t: number[]; y: number[] } | null,
  ms = 460,
): { t: number[]; y: number[] } | null {
  const [disp, setDisp] = useState(next);
  const prevRef = useRef(next);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = next;
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!next || !prev || prev.y.length !== next.y.length || reduce) {
      setDisp(next);
      return;
    }
    const from = prev.y.slice();
    const to = next.y;
    const t0 = performance.now();
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    const tick = (now: number): void => {
      const k = Math.min(1, (now - t0) / ms);
      const s = spring(k);
      const y = new Array<number>(to.length);
      for (let i = 0; i < to.length; i++) y[i] = from[i] + (to[i] - from[i]) * s;
      setDisp({ t: next.t, y });
      if (k < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [next, ms]);
  return disp;
}

/** 响应小图（数值曲线 + 留数解析散点；y 轴范围取目标数据，形变中不抖动） */
function RespChart(props: {
  data: { t: number[]; y: number[] } | null;
  rangeY: number[] | null;
  ana: Array<{ x: number; y: number }>;
  xMax: number;
  height: number;
}) {
  const { data, rangeY, ana, xMax, height } = props;
  if (!data || !data.y.length) return <p class="muted">暂无数值响应（非真分式或系数退化）。</p>;
  return (
    <Chart
      series={[{ xs: data.t, ys: data.y, glow: 2.5 }]}
      markers={ana.map((p) => ({ x: p.x, y: p.y, kind: 'point' as const, color: '#A15C06', size: 3 }))}
      xRange={[0, xMax]}
      yRange={yRangeOf(rangeY ?? data.y)}
      height={height}
      xLabel="t (s)"
      yLabel="y(t)"
    />
  );
}

function sanitize(raw: unknown): LapParams {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<LapParams>;
  const views: ViewId[] = ['plane', 'inverse', 'rocs', 'transform', 'props'];
  const propIds: PropId[] = ['shift', 'freq', 'scale', 'diff'];
  const pzs = (v: unknown): PZ[] =>
    Array.isArray(v)
      ? v
          .filter((q): q is PZ => !!q && typeof q === 'object' && Number.isFinite((q as PZ).re) && Number.isFinite((q as PZ).im))
          .slice(0, 10)
          .map((q) => ({ re: r4(q.re), im: Math.abs(r4(q.im)) }))
      : [];
  const out: LapParams = {
    view: views.includes(r.view as ViewId) ? (r.view as ViewId) : DEFAULT.view,
    expr: typeof r.expr === 'string' && r.expr.trim() ? r.expr : DEFAULT.expr,
    gain: Number.isFinite(r.gain) ? Math.max(-100, Math.min(100, r.gain as number)) : DEFAULT.gain,
    poles: pzs(r.poles),
    zeros: pzs(r.zeros),
    showROC: r.showROC !== false,
    signal: typeof r.signal === 'string' && r.signal.trim() ? r.signal : DEFAULT.signal,
    prop: propIds.includes(r.prop as PropId) ? (r.prop as PropId) : DEFAULT.prop,
    propParam: Number.isFinite(r.propParam) ? Math.max(-5, Math.min(5, r.propParam as number)) : DEFAULT.propParam,
  };
  // 旧实验 / 首次进入：几何缺失时由 H(s) 表达式折解（保证 expr 与规格一致）
  if (!out.poles.length && !out.zeros.length) {
    const t = parseTF(out.expr);
    const d = t ? decompose(t) : null;
    if (d) {
      out.gain = d.gain;
      out.poles = d.poles;
      out.zeros = d.zeros;
    }
  }
  return out;
}

export function LaplaceTool(props: ToolViewProps) {
  const [params, setParams] = useState<LapParams>(() => sanitize(getModuleState<LapParams>('laplace', DEFAULT)));
  const [fitGen, setFitGen] = useState(0);
  const undoRef = useRef(createUndoStack<LapParams>(40));
  const lastPush = useRef(0);

  useEffect(() => {
    setModuleState('laplace', params);
  }, [params]);

  useExperimentSync('laplace',
    () => sanitize(getModuleState<LapParams>('laplace', DEFAULT)),
    (v) => {
      setParams(v);
      setFitGen((x) => x + 1);
      undoRef.current.clear();
    },
  );

  /** 参数变更（连续拖动 500ms 内合并为一次撤销点） */
  const apply = (next: Partial<LapParams>): void => {
    const now = Date.now();
    if (now - lastPush.current > 500) {
      undoRef.current.push(params);
      lastPush.current = now;
    }
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };
  const applyLive = (next: Partial<LapParams>): void => {
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };

  const view = params.view;
  const sysInput = view === 'plane' || view === 'inverse' || view === 'rocs';
  const sigInput = view === 'transform' || view === 'props';

  /* ================= H(s) 几何（主状态：gain + 极/零 spec） ================= */

  const tfOk = useMemo(() => !!parseTF(params.expr), [params.expr]);
  const polesAll = useMemo(() => specsToRoots(params.poles), [params.poles]);
  const zerosAll = useMemo(() => specsToRoots(params.zeros), [params.zeros]);
  const den = useMemo(() => (params.poles.length ? polyFromRoots(polesAll) : [1]), [params.poles.length, polesAll]);
  const num = useMemo(
    () => (params.zeros.length ? polyFromRoots(zerosAll, params.gain) : [params.gain]),
    [params.zeros.length, zerosAll, params.gain],
  );
  /** 真分式：分子次数 ≤ 分母次数（含双真分式，直通项由留数引擎处理） */
  const proper = num.length <= den.length;

  const sigmaMax = useMemo(() => polesAll.reduce((m, p) => Math.max(m, p.re), -Infinity), [polesAll]);
  const hasRHP = polesAll.some((p) => p.re > TOL);
  const onAxis = polesAll.some((p) => Math.abs(p.re) <= TOL);
  const stabTone: MetricTone = !polesAll.length ? 'warn' : hasRHP ? 'danger' : onAxis ? 'warn' : 'ok';
  const stabText = !polesAll.length ? '无极点（全平面 ROC）' : hasRHP ? '不稳定（右半平面极点）' : onAxis ? '临界稳定（jω 轴极点）' : '稳定（极点全在左半平面）';

  const dom = useMemo(() => {
    if (!polesAll.length) return null;
    let best = polesAll[0];
    for (const p of polesAll) if (p.re > best.re) best = p;
    const wn = Math.hypot(best.re, best.im);
    const complex = Math.abs(best.im) > 1e-6;
    return { p: best, wn, complex, zeta: complex && wn > TOL ? -best.re / wn : null, wd: complex ? Math.abs(best.im) : null };
  }, [polesAll]);

  const dcGain = useMemo(() => {
    const dv = den[den.length - 1];
    if (!den.length || Math.abs(dv) < 1e-12) return null;
    return polyAt0(num) / dv;
  }, [num, den]);

  const tmax = useMemo(() => {
    const decays = polesAll.filter((p) => Math.abs(p.re) > 1e-9).map((p) => Math.abs(p.re));
    const nearest = decays.length ? Math.min(...decays) : NaN;
    const base = isFinite(nearest) ? 4 / nearest : 8;
    let best = SNAPS[0];
    for (const s of SNAPS) if (Math.abs(s - base) < Math.abs(best - base)) best = s;
    if (hasRHP) return Math.min(best, 6);
    if (onAxis) return Math.max(best, 10);
    return best;
  }, [polesAll, hasRHP, onAxis]);

  /* ================= 时域响应（数值 + 留数解析） ================= */

  const stepRes = useMemo(() => {
    if (!proper || !den.length || !isFinite(den[0]) || Math.abs(den[0]) < 1e-12) return null;
    try {
      const r = ltiResponse(num, den, () => 1, 0, tmax, NSTEP);
      return { t: r.t, y: r.y.map((v) => (Number.isFinite(v) ? Math.max(-1e4, Math.min(1e4, v)) : 0)) };
    } catch {
      return null;
    }
  }, [num, den, tmax, proper]);

  const impRes = useMemo(() => {
    if (!stepRes) return null;
    const dt = tmax / NSTEP;
    const t: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < stepRes.y.length - 1; i++) {
      t.push(stepRes.t[i]);
      y.push((stepRes.y[i + 1] - stepRes.y[i]) / dt);
    }
    return { t, y };
  }, [stepRes, tmax]);

  const invImp = useMemo(() => (proper && den.length > 1 ? invLaplace(num, den) : null), [num, den, proper]);
  const invStep = useMemo(() => (proper && den.length > 1 ? invLaplace(num, den.concat(0)) : null), [num, den, proper]);

  const impTex = invImp && invImp.tex != null ? invImp.tex.replace(/^f\(t\)=/, 'h(t)=') : null;
  const stepTex = invStep && invStep.tex != null ? invStep.tex.replace(/^f\(t\)=/, 'y_{step}(t)=') : null;

  const anaStepPts = useMemo(
    () => (invStep && invStep.tex != null ? anaPts(stepRes, invStep.evalT) : []),
    [invStep, stepRes],
  );
  const anaImpPts = useMemo(
    () => (invImp && invImp.tex != null ? anaPts(stepRes, invImp.evalT) : []),
    [invImp, stepRes],
  );

  /** 反变换自检：数值阶跃响应 vs 留数闭式（最大绝对偏差） */
  const anaDiff = useMemo(() => {
    if (!invStep || invStep.tex == null || !stepRes) return null;
    let m = 0;
    for (let i = 0; i < stepRes.t.length; i++) {
      const a = invStep.evalT(stepRes.t[i]);
      if (!Number.isFinite(a)) continue;
      m = Math.max(m, Math.abs(a - stepRes.y[i]));
    }
    return m;
  }, [invStep, stepRes]);

  /** 留数表（部分分式展开：每对极点一行，重数逐项展开） */
  const pfRows = useMemo(() => {
    if (!invImp || invImp.tex == null) return null;
    const rows: Array<{ p: string; m: number; k: number; A: string; pair: boolean }> = [];
    for (const g of invImp.groups) {
      if (g.p.im < -1e-6) continue;
      for (let k = 1; k <= g.m; k++) {
        const A = g.A[k - 1];
        rows.push({ p: cx(g.p.re, g.p.im), m: g.m, k, A: cx(A.re, A.im), pair: g.pair });
      }
    }
    return { rows, direct: invImp.direct };
  }, [invImp]);

  const dispStep = useMorphCurve(stepRes);
  const dispImp = useMorphCurve(impRes);

  /* ================= 复平面与 ROC ================= */

  const markers: CPMarker[] = useMemo(
    () => [
      ...polesAll.map((p) => ({ re: p.re, im: p.im, kind: 'pole' as const })),
      ...zerosAll.map((z) => ({ re: z.re, im: z.im, kind: 'zero' as const })),
    ],
    [polesAll, zerosAll],
  );

  const halfW = useMemo(() => {
    let m = 1;
    for (const q of [...polesAll, ...zerosAll]) m = Math.max(m, Math.abs(q.re), Math.abs(q.im));
    return Math.max(1.6, m * 1.5);
  }, [polesAll, zerosAll]);

  const rocShade = useMemo(
    () => (params.showROC && polesAll.length ? { from: sigmaMax, label: 'ROC: Re(s) > ' + nf(sigmaMax, 2) } : null),
    [params.showROC, polesAll.length, sigmaMax],
  );

  /* ================= 信号 f(t)（变换 / 性质视图） ================= */

  const items: TimeItem[] | null = useMemo(() => parseTimeCombo(params.signal), [params.signal]);
  const lap = useMemo(() => (items ? laplaceOfItems(items) : null), [items]);
  const F = useMemo(() => (items ? combineFracs(items, itemFracS) : null), [items]);
  const fPoles = useMemo(() => (F ? polyRoots(F.d) : []), [F]);
  const fZeros = useMemo(() => (F && pTrim(F.n).length > 1 ? polyRoots(pTrim(F.n)) : []), [F]);
  const fMarkers: CPMarker[] = useMemo(
    () => [
      ...fPoles.map((p) => ({ re: p.re, im: p.im, kind: 'pole' as const })),
      ...fZeros.map((z) => ({ re: z.re, im: z.im, kind: 'zero' as const })),
    ],
    [fPoles, fZeros],
  );
  const fRocShade = useMemo(
    () => (params.showROC && fPoles.length ? { from: fPoles.reduce((m, p) => Math.max(m, p.re), -Infinity), label: 'ROC' } : null),
    [params.showROC, fPoles],
  );
  const fHalfW = useMemo(() => {
    let m = 1;
    for (const q of [...fPoles, ...fZeros]) m = Math.max(m, Math.abs(q.re), Math.abs(q.im));
    return Math.max(1.6, m * 1.5);
  }, [fPoles, fZeros]);

  /** 定义积分 vs F(s) 闭式（ROC 右缘 + 1.5 的实轴验证点；复梯形） */
  const check = useMemo(() => {
    if (!items || !items.length || view !== 'transform') return null;
    const right = items.reduce((m, it) => Math.max(m, it.kind === 'exp' || it.kind === 'texp' ? -it.a : 0), 0);
    const sigma = right + 1.5;
    const NCHK = 40000;
    const dt = 60 / sigma / NCHK;
    let acc = 0;
    for (let i = 0; i <= NCHK; i++) {
      const t = i * dt;
      acc += fNumeric(items, t) * Math.exp(-sigma * t) * (i === 0 || i === NCHK ? 0.5 : 1) * dt;
    }
    const closed = FsNumeric(items, sigma);
    const rel = Math.abs(acc - closed) / Math.max(1e-12, Math.abs(closed));
    return { sigma, lhs: acc, rhs: closed, rel };
  }, [items, view]);

  /* ================= 性质验证 / 多 ROC ================= */

  const propRun = useMemo(() => {
    if (!items || !items.length || view !== 'props') return null;
    return propVerify(items, params.prop, params.propParam);
  }, [items, view, params.prop, params.propParam]);

  const rocInfo = useMemo(() => (view === 'rocs' && den.length > 1 ? rocs(num, den) : null), [view, num, den]);

  const rocStrip = useMemo(() => {
    if (!rocInfo || !rocInfo.ok) return null;
    const reals = [...new Set(rocInfo.poles.map((p) => +p.re.toFixed(9)))].sort((a, b) => a - b);
    const lo = Math.min(0, ...reals) - 1;
    const hi = Math.max(0, ...reals) + 1;
    return { reals, pos: (v: number): number => ((v - lo) / (hi - lo)) * 100 };
  }, [rocInfo]);

  /* ================= 输入动作 ================= */

  const applyExpr = (v: string): void => {
    const t = parseTF(v);
    const d = t ? decompose(t) : null;
    if (d) {
      apply({ expr: v, gain: d.gain, poles: d.poles, zeros: d.zeros });
      setFitGen((x) => x + 1);
    } else apply({ expr: v });
  };

  /** s 平面拖拽：共轭对随正虚部代表整体移动（v1 语义） */
  const onPlaneMove = (i: number, re: number, im: number, phase: 'move' | 'end'): void => {
    const isPole = i < polesAll.length;
    const specs = isPole ? params.poles : params.zeros;
    const si = specIdxOf(specs, isPole ? i : i - polesAll.length);
    if (si < 0) return;
    const next = specs.map((sp, k) => (k === si ? { re: r4(re), im: Math.abs(r4(im)) } : sp));
    const poles = isPole ? next : params.poles;
    const zeros = isPole ? params.zeros : next;
    const expr = specsToExpr(params.gain, poles, zeros);
    if (phase === 'move') applyLive({ poles, zeros, expr });
    else apply({ poles, zeros, expr });
  };

  const onPlaneAdd = (re: number, im: number): void => {
    if (params.poles.length >= 10) return;
    const poles = [...params.poles, { re: r4(re), im: Math.abs(r4(im)) }];
    apply({ poles, expr: specsToExpr(params.gain, poles, params.zeros) });
  };

  const onPlaneInsert = (re: number, im: number): void => {
    if (params.zeros.length >= 10) return;
    const zeros = [...params.zeros, { re: r4(re), im: Math.abs(r4(im)) }];
    apply({ zeros, expr: specsToExpr(params.gain, params.poles, zeros) });
  };

  const onPlaneDelete = (i: number): void => {
    const isPole = i < polesAll.length;
    const specs = isPole ? params.poles : params.zeros;
    const si = specIdxOf(specs, isPole ? i : i - polesAll.length);
    if (si < 0) return;
    const next = specs.filter((_, k) => k !== si);
    const poles = isPole ? next : params.poles;
    const zeros = isPole ? params.zeros : next;
    apply({ poles, zeros, expr: specsToExpr(params.gain, poles, zeros) });
  };

  /* ================= 结果条与撤销（ToolApi） ================= */

  useEffect(() => {
    props.api({
      undo: () => {
        const p = undoRef.current.undo(params);
        if (p) setParams(p);
        props.onChange();
      },
      redo: () => {
        const p = undoRef.current.redo(params);
        if (p) setParams(p);
        props.onChange();
      },
      canUndo: () => undoRef.current.canUndo(),
      canRedo: () => undoRef.current.canRedo(),
      subtitle: () =>
        sysInput
          ? stabText + ' · ' + polesAll.length + ' 极点 / ' + zerosAll.length + ' 零点 · K=' + nf(params.gain, 2)
          : items
            ? 'f(t) = ' + params.signal
            : '信号待解析',
      metrics: () => {
        if (view === 'plane') {
          return [
            { label: '稳定性', value: stabText, tone: stabTone },
            { label: 'σmax · 最右极点实部', value: polesAll.length ? sigmaMax : '—', precision: 3 },
            { label: 'ζ · 阻尼比', value: dom?.zeta ?? '—', precision: 3 },
            { label: 'ωn · 自然频率', value: dom?.wn ?? '—', unit: 'rad/s', precision: 3 },
          ];
        }
        if (view === 'inverse') {
          return [
            {
              label: '反变换自检 max|Δ|',
              value: tiny(anaDiff),
              tone: anaDiff == null ? 'default' : anaDiff < 5e-3 ? 'ok' : 'warn',
              hint: '数值阶跃响应 vs 留数闭式',
            },
            { label: '留数项', value: pfRows ? pfRows.rows.length : '—' },
            { label: '直通项 K∞', value: pfRows ? pfRows.direct : '—', precision: 3, hint: '对应 δ(t) 分量' },
          ];
        }
        if (view === 'rocs') {
          return rocInfo && rocInfo.ok
            ? [
                { label: '候选 ROC 数', value: rocInfo.regions.length },
                { label: '含虚轴 ROC', value: rocInfo.stableRegion ? rocInfo.stableRegion.rocTex : '不存在', tone: rocInfo.stableRegion ? 'ok' : 'warn' },
                { label: 'jω 轴极点', value: rocInfo.axisPole ? '有' : '无', tone: rocInfo.axisPole ? 'warn' : 'ok' },
              ]
            : [];
        }
        if (view === 'transform') {
          return [
            { label: 'ROC', value: fPoles.length ? 'Re(s) > ' + nf(fPoles.reduce((m, p) => Math.max(m, p.re), -Infinity), 2) : '全平面' },
            { label: 'F(s) 极点', value: fPoles.length },
            { label: 'F(s) 零点', value: fZeros.length },
            { label: '定义积分自检 ε', value: check ? tiny(check.rel) : '—', tone: check && check.rel < 1e-3 ? 'ok' : 'warn' },
          ];
        }
        return propRun && propRun.ok
          ? [
              { label: '性质', value: PROP_CHIPS.find((p) => p.value === params.prop)?.label ?? params.prop },
              { label: '最大相对误差', value: tiny(propRun.maxRel), tone: propRun.passed ? 'ok' : 'danger' },
              { label: '结论', value: propRun.passed ? '恒等式成立' : '未通过', tone: propRun.passed ? 'ok' : 'danger' },
            ]
          : [];
      },
      exports: () => [
        {
          id: 'csv',
          label: '响应 CSV',
          disabled: !stepRes || !impRes,
          reason: '非真分式 / 系数退化时无响应数据',
          run: () => {
            if (!stepRes || !impRes) return;
            const rows = ['t(s),y_step(t),h(t)'];
            for (let i = 0; i < stepRes.t.length; i++) {
              rows.push(`${stepRes.t[i].toPrecision(6)},${stepRes.y[i].toPrecision(6)},${(impRes.y[i] ?? 0).toPrecision(6)}`);
            }
            downloadText('laplace-response.csv', rows.join('\n'));
          },
        },
        {
          id: 'json',
          label: 'JSON',
          run: () => downloadText('laplace-experiment.json', JSON.stringify(params, null, 2)),
        },
        { id: 'png', label: 'PNG', disabled: true, reason: 'PNG 导出随报告系统交付' },
      ],
    });
    return () => props.api(null);
    // api 随参数与派生结果刷新
  }, [params, view, sysInput, stabText, stabTone, sigmaMax, polesAll.length, zerosAll.length, dom, items, lap, fPoles.length, fZeros.length, check, propRun, stepRes, impRes, anaDiff, pfRows, rocInfo]);

  /* ================= 渲染 ================= */

  const hTex = 'H(s)=\\dfrac{' + polyTex(num) + '}{' + polyTex(den) + '}';
  const factTex =
    'H(s)=' + nf(params.gain, 2) + '\\dfrac{' + factorTexOf(params.zeros, 's') + '}{' + factorTexOf(params.poles, 's') + '}';

  return (
    <>
      {props.leftOpen ? (
        <aside class="ws-left">
          {sysInput ? (
            <FieldGroup title="传函 H(s)" desc="多项式或因式写法均可；解析后得到 K / 极点 / 零点，可在 s 平面直接拖动修改。">
              <ExprField
                label="H(s)"
                value={params.expr}
                onChange={applyExpr}
                status={tfOk ? 'ok' : 'err'}
                message={tfOk ? '已解析' : '无法解析：请检查括号与运算符'}
                hint="示例：1/(s^2+0.5*s+1.25)、(s+2)/((s+1)*(s+3))"
              />
              <div class="row">
                {TF_PRESETS.map((p) => (
                  <button key={p.label} class="btn" onClick={() => applyExpr(p.expr)}>
                    {p.label}
                  </button>
                ))}
              </div>
            </FieldGroup>
          ) : null}

          {sigInput ? (
            <FieldGroup title="信号 f(t)" desc="因果组合信号（与 v1 语法一致）：指数 / 正弦 / 余弦 / 幂 / 阶跃及线性组合。">
              <ExprField
                label="f(t)"
                value={params.signal}
                onChange={(v) => apply({ signal: v })}
                status={items ? 'ok' : 'err'}
                message={items ? '已解析' : '无法解析：请检查写法'}
                hint="示例：exp(-2*t)*u(t)、sin(3*t)*u(t)、t^2*u(t)"
              />
              <div class="row">
                {SIG_PRESETS.map((p) => (
                  <button key={p.label} class="btn" onClick={() => apply({ signal: p.expr })}>
                    {p.label}
                  </button>
                ))}
              </div>
            </FieldGroup>
          ) : null}

          {view === 'props' ? (
            <FieldGroup title="性质与参数" desc="在 Re(s) > ROC 的实轴验证点上比较定义积分与符号公式。">
              <SegmentedChips options={PROP_CHIPS} value={params.prop} onChange={(v) => apply({ prop: v, propParam: PROP_CFG[v].def })} ariaLabel="性质" />
              {params.prop === 'diff' ? (
                <p class="muted">微分性质：ℒ{"{f′(t)}"} = sF(s) − f(0⁺)，无需参数。</p>
              ) : (
                <>
                  <SliderField
                    label={PROP_CFG[params.prop].label}
                    value={params.propParam}
                    onChange={(v) => applyLive({ propParam: v })}
                    min={PROP_CFG[params.prop].min}
                    max={PROP_CFG[params.prop].max}
                    step={PROP_CFG[params.prop].step}
                    precision={2}
                  />
                  <div class="row">
                    <NumField
                      value={params.propParam}
                      onChange={(v) => apply({ propParam: v })}
                      min={PROP_CFG[params.prop].min}
                      max={PROP_CFG[params.prop].max}
                      step={PROP_CFG[params.prop].step}
                      precision={2}
                      ariaLabel={PROP_CFG[params.prop].label}
                    />
                  </div>
                </>
              )}
            </FieldGroup>
          ) : null}

          {sysInput ? (
            <FieldGroup title="增益与显示" onReset={() => apply(DEFAULT)}>
              <SliderField
                label="增益 K · H(s) 幅值"
                value={params.gain}
                onChange={(v) => applyLive({ gain: v })}
                min={0.01}
                max={20}
                step={0.01}
                precision={2}
                hint="K 改变响应幅值与直流增益；不改变极零点与 ROC"
              />
              <div class="row">
                <NumField value={params.gain} onChange={(v) => apply({ gain: v })} min={-100} max={100} step={0.1} precision={2} ariaLabel="增益 K（扩展范围）" />
              </div>
              <Switch label="显示收敛域 ROC" checked={params.showROC} onChange={(v) => apply({ showROC: v })} hint="在 s 平面高亮 Re(s) > 最右极点实部" />
            </FieldGroup>
          ) : null}

          <FieldGroup title="视图">
            <SegmentedChips options={VIEWS} value={params.view} onChange={(v) => apply({ view: v })} ariaLabel="视图" />
            <p class="muted">{VIEW_HINTS[params.view]}</p>
          </FieldGroup>
        </aside>
      ) : null}

      <section class="ws-main">
        {view === 'plane' ? (
          <>
            <div class="card stack">
              <h3>s 平面 · 极点 ✕ / 零点 ○ · 收敛域 ROC（紫色阴影）</h3>
              <ComplexPlane
                markers={markers}
                mode="jw"
                height={330}
                halfW={halfW}
                rocShade={rocShade}
                fitKey={'lap-' + fitGen + '-' + params.poles.length + '-' + params.zeros.length}
                onMove={onPlaneMove}
                onAdd={onPlaneAdd}
                onInsert={onPlaneInsert}
                onDelete={onPlaneDelete}
              />
              <p class="muted">
                拖动极零点 → 响应曲线弹簧联动；滚轮缩放 · 拖动空白平移 · 双击空白加极点 · 右键空白加零点 / 右键标记删除。
                左半平面为稳定域；复极点成对出现、拖动正虚部即整对移动。
              </p>
              <div class="row">
                <StatusBadge kind={stabTone === 'danger' ? 'err' : stabTone === 'warn' ? 'warn' : 'ok'}>{stabText}</StatusBadge>
                {!proper ? <StatusBadge kind="warn">非真分式：反变换含冲激导数项，仅展示分布与指标</StatusBadge> : null}
              </div>
            </div>
            <div class="grid2">
              <div class="card stack">
                <h3>阶跃响应（留数散点互验）</h3>
                <RespChart data={dispStep} rangeY={stepRes?.y ?? null} ana={anaStepPts} xMax={tmax} height={180} />
              </div>
              <div class="card stack">
                <h3>冲激响应 h(t)</h3>
                <RespChart data={dispImp} rangeY={impRes?.y ?? null} ana={anaImpPts} xMax={tmax} height={180} />
              </div>
            </div>
          </>
        ) : null}

        {view === 'inverse' ? (
          <>
            <div class="card stack">
              <h3>冲激响应 h(t) = ℒ⁻¹{"{H(s)}"}（曲线 = 数值仿真 · 点 = 留数解析）</h3>
              <RespChart data={dispImp} rangeY={impRes?.y ?? null} ana={anaImpPts} xMax={tmax} height={200} />
              {impTex ? (
                <div class="tex-line">
                  <TeX tex={impTex} />
                </div>
              ) : (
                <p class="muted">{invImp && invImp.tex == null ? invImp.note : '非真分式 / 系数退化：解析式不可用。'}</p>
              )}
            </div>
            <div class="card stack">
              <h3>阶跃响应 y_step(t)（曲线 = 数值仿真 · 点 = 留数解析）</h3>
              <RespChart data={dispStep} rangeY={stepRes?.y ?? null} ana={anaStepPts} xMax={tmax} height={200} />
              {stepTex ? (
                <div class="tex-line">
                  <TeX tex={stepTex} />
                </div>
              ) : (
                <p class="muted">{invStep && invStep.tex == null ? invStep.note : '非真分式 / 系数退化：解析式不可用。'}</p>
              )}
            </div>
            <div class="card stack">
              <h3>互验</h3>
              <div class="row">
                <Metric
                  label="max|Δ| · 数值 vs 解析"
                  value={tiny(anaDiff)}
                  tone={anaDiff == null ? 'default' : anaDiff < 5e-3 ? 'ok' : 'warn'}
                  hint="阶跃响应逐点比较（RK4 数值 vs 留数闭式）"
                />
                <Metric label="y_step 终值" value={dcGain ?? '∞'} precision={4} hint="终值定理：H(0)" />
                <Metric label="仿真窗口" value={tmax} unit="s" precision={3} />
              </div>
              <p class="muted">
                数值 = core.ltiResponse（RK4 状态空间）；解析 = core.invLaplace（重极点部分分式 + 留数）。两者一致即反变换正确（与 v1 数值一致，回归网保障）。
              </p>
            </div>
          </>
        ) : null}

        {view === 'rocs' ? (
          rocInfo && rocInfo.ok && rocStrip ? (
            <div class="card stack">
              <h3>多 ROC 分析 · 同一 F(s) 的全部可能收敛域</h3>
              <div class="roc-rows">
                <div class="roc-row">
                  <span class="muted" style="margin:0">极点 σ 位置</span>
                  <div class="roc-track is-axis">
                    {rocStrip.reals.map((r0) => (
                      <span key={r0} class="roc-tick" style={{ left: rocStrip.pos(r0) + '%' }} title={'σ = ' + r0}>
                        ✕
                      </span>
                    ))}
                  </div>
                  <span />
                </div>
                {rocInfo.regions.map((rg, i) => {
                  const l = rg.lo === -Infinity ? 0 : rocStrip.pos(rg.lo);
                  const r = rg.hi === Infinity ? 100 : rocStrip.pos(rg.hi);
                  const attr = rg.causal ? '因果（右边）' : rg.anti ? '反因果（左边）' : '双边';
                  return (
                    <div key={i} class="roc-row">
                      <span class="mono">{rg.rocTex}</span>
                      <div class="roc-track">
                        <div
                          class={'roc-band' + (rg.stable ? ' is-stable' : '')}
                          style={{ left: l + '%', width: Math.max(0.6, r - l) + '%' }}
                        />
                      </div>
                      <span class="muted" style="margin:0">
                        {attr} · {rg.stable ? '稳定' : '不稳定'}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div class="row">
                {rocInfo.stableRegion ? (
                  <StatusBadge kind="ok">存在含虚轴的 ROC：{rocInfo.stableRegion.rocTex}（双边稳定信号）</StatusBadge>
                ) : (
                  <StatusBadge kind="warn">不存在含虚轴的 ROC：此 F(s) 无双边稳定对应</StatusBadge>
                )}
                {rocInfo.axisPole ? <StatusBadge kind="warn">含 jω 轴极点 → 无稳定域</StatusBadge> : null}
              </div>
              <p class="muted">
                同一 F(s) 在不同 ROC 下对应不同时域信号：最右区域 = 因果（右边）信号；最左 = 反因果；中间 = 双边。仅当 ROC 含虚轴（Re=0）时信号双边稳定。
              </p>
            </div>
          ) : (
            <StatePanel
              kind="error"
              title="ROC 分析不可用"
              desc={rocInfo && !rocInfo.ok ? rocInfo.note : '当前 H(s) 无极点（全平面收敛）或分母退化。'}
              action={{ label: '恢复默认 H(s)', onClick: () => applyExpr(DEFAULT.expr) }}
            />
          )
        ) : null}

        {view === 'transform' ? (
          items && lap && F ? (
            <>
              <div class="card stack">
                <h3>时域 → 复频域（闭式由 core.transforms 给出，与 v1 数值一致）</h3>
                <div class="formula-block">
                  <div class="tex-line">
                    <TeX tex={lap.fLine} />
                  </div>
                  <div class="tex-line">
                    <TeX tex={lap.fsLine} />
                  </div>
                  <div class="tex-line">
                    <TeX tex={lap.rocTex} />
                  </div>
                </div>
              </div>
              <div class="grid2">
                <div class="card stack">
                  <h3>F(s) 极点 ✕ / 零点 ○ 与 ROC</h3>
                  <ComplexPlane markers={fMarkers} mode="jw" height={250} halfW={fHalfW} rocShade={fRocShade} fitKey={'sig-' + fitGen + '-' + params.signal} />
                  <p class="muted">F(s) 的极点对应 f(t) 各分量的衰减 / 振荡模态；ROC 在最右极点右侧。</p>
                </div>
                <div class="card stack">
                  <h3>数值自检 · 定义积分 vs 闭式</h3>
                  {check ? (
                    <table class="tbl">
                      <tbody>
                        <tr>
                          <td>验证点 s = σ（实轴）</td>
                          <td class="mono">{nf(check.sigma, 4)}</td>
                        </tr>
                        <tr>
                          <td class="mono">∫₀^∞ f(t)e^(−σt) dt（复梯形）</td>
                          <td class="mono">{check.lhs.toPrecision(6)}</td>
                        </tr>
                        <tr>
                          <td>F(s) 闭式取值</td>
                          <td class="mono">{check.rhs.toPrecision(6)}</td>
                        </tr>
                        <tr>
                          <td>相对误差 ε</td>
                          <td class="mono" style={{ color: check.rel < 1e-3 ? 'var(--ok)' : 'var(--warn)' }}>
                            {check.rel.toExponential(1)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  ) : (
                    <p class="muted">等待信号解析。</p>
                  )}
                  <p class="muted">验证点取 ROC 右缘 + 1.5；ε &lt; 1e-3 视为一致（积分区间 60/σ，40000 步）。</p>
                </div>
              </div>
            </>
          ) : (
            <StatePanel
              kind="error"
              title="信号无法解析"
              desc="支持：exp(-a*t)、sin(w*t)、cos(w*t)、t^n、t^n*exp(-a*t)、u(t)、常数及加减组合。"
              action={{ label: '恢复默认信号', onClick: () => apply({ signal: DEFAULT.signal }) }}
            />
          )
        ) : null}

        {view === 'props' ? (
          items ? (
            <div class="card stack">
              <h3>性质数值验证 · 定义积分 vs 符号公式</h3>
              {propRun && propRun.ok ? (
                <>
                  <p>
                    <strong>{propRun.title}</strong>
                  </p>
                  <div class="tex-line">
                    <TeX tex={propRun.rhsTex} />
                  </div>
                  <table class="tbl scroll">
                    <thead>
                      <tr>
                        <th>验证点</th>
                        <th>定义积分</th>
                        <th>公式值</th>
                        <th>相对误差</th>
                      </tr>
                    </thead>
                    <tbody>
                      {propRun.checks.map((c, i) => (
                        <tr key={i}>
                          <td class="mono">{c.s}</td>
                          <td class="mono">{c.lhs.toPrecision(6)}</td>
                          <td class="mono">{c.rhs.toPrecision(6)}</td>
                          <td class="mono" style={{ color: c.rel < 1e-5 ? 'var(--ok)' : 'var(--danger)' }}>
                            {c.rel.toExponential(1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div class="row">
                    <StatusBadge kind={propRun.passed ? 'ok' : 'err'}>
                      {propRun.passed ? '恒等式成立（全部验证点相对误差 < 1e-5）' : '验证未通过：请检查参数或信号'}
                    </StatusBadge>
                    <Metric label="最大相对误差" value={tiny(propRun.maxRel)} tone={propRun.passed ? 'ok' : 'danger'} />
                  </div>
                  <p class="muted">
                    定义积分由复合梯形法给出（120000 步）；公式值由 F(s) 闭式代入同一验证点。两侧独立计算，一致即性质成立。
                  </p>
                </>
              ) : (
                <StatePanel kind="error" title="性质验证不可用" desc={propRun && !propRun.ok ? propRun.note : '信号非法。'} />
              )}
            </div>
          ) : (
            <StatePanel
              kind="error"
              title="信号无法解析"
              desc="支持：exp(-a*t)、sin(w*t)、cos(w*t)、t^n、u(t)、常数及加减组合。"
              action={{ label: '恢复默认信号', onClick: () => apply({ signal: DEFAULT.signal }) }}
            />
          )
        ) : null}
      </section>

      {props.rightOpen ? (
        <aside class="ws-right">
          {sysInput ? (
            <div class="card stack">
              <h4 class="card-h">稳定性与 ROC</h4>
              <div class="row">
                <StatusBadge kind={stabTone === 'danger' ? 'err' : stabTone === 'warn' ? 'warn' : 'ok'}>{stabText}</StatusBadge>
              </div>
              <div class="row">
                <Metric label="σmax · 最右极点实部" value={polesAll.length ? sigmaMax : '—'} precision={3} />
                <Metric label="ROC" value={polesAll.length ? 'Re(s) > ' + nf(sigmaMax, 2) : '全平面'} />
              </div>
            </div>
          ) : null}

          {view === 'plane' ? (
            <>
              <div class="card stack">
                <h4 class="card-h">主导极点指标</h4>
                <div class="row">
                  <Metric label="ζ · 阻尼比" value={dom?.zeta ?? '—'} precision={3} hint="复极点对：ζ = −σ/ωn" />
                  <Metric label="ωn · 自然频率" value={dom?.wn ?? '—'} unit="rad/s" precision={3} />
                </div>
                <div class="row">
                  <Metric label="ωd · 阻尼振荡" value={dom?.wd ?? '—'} unit="rad/s" precision={3} />
                  <Metric label="τ · 时间常数" value={dom && dom.p.re < 0 ? 1 / -dom.p.re : '—'} unit="s" precision={3} />
                </div>
                <div class="row">
                  <Metric label="ts(2%) 估计" value={dom && dom.p.re < 0 ? 4 / -dom.p.re : '—'} unit="s" precision={3} hint="4/|σ| · 二阶近似" />
                  <Metric label="H(0) · 直流增益" value={dcGain ?? '∞'} precision={3} hint="原点极点时为 ∞" />
                </div>
              </div>
              <div class="card stack">
                <h4 class="card-h">H(s) 两种形式</h4>
                <div class="tex-line">
                  <TeX tex={hTex} />
                </div>
                <div class="tex-line">
                  <TeX tex={factTex} />
                </div>
                <p class="muted">上：多项式展开；下：因式形式（K·Π(s−z)/Π(s−p)）。</p>
              </div>
            </>
          ) : null}

          {view === 'inverse' ? (
            <div class="card stack">
              <h4 class="card-h">部分分式（留数）</h4>
              {pfRows && pfRows.rows.length ? (
                <table class="tbl scroll mono">
                  <thead>
                    <tr>
                      <th>极点 p</th>
                      <th>k</th>
                      <th>Aₖ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pfRows.rows.map((r0, i) => (
                      <tr key={i}>
                        <td>
                          {r0.p}
                          {r0.pair ? ' ×2' : ''}
                        </td>
                        <td>{r0.k}</td>
                        <td>{r0.A}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p class="muted">{invImp && invImp.tex == null ? invImp.note : '真分式完备：无留数项（或仅有直通项）。'}</p>
              )}
              {pfRows && Math.abs(pfRows.direct) > 1e-12 ? (
                <p class="muted">直通项 K∞ = {nf(pfRows.direct, 3)} → 时域含 δ(t) 分量（分子分母同阶）。</p>
              ) : null}
              <p class="muted">Aₖ 为重极点 (s−p)^k 的留数；×2 表示共轭对（正虚部为代表）。</p>
            </div>
          ) : null}

          {view === 'rocs' ? (
            <div class="card stack">
              <h4 class="card-h">收敛域速读</h4>
              {rocInfo && rocInfo.ok ? (
                <>
                  <p class="mono">极点：{rocInfo.poles.map((p) => cx(p.re, p.im)).join('，') || '无'}</p>
                  <div class="row">
                    <Metric label="候选 ROC" value={rocInfo.regions.length} precision={0} />
                    <Metric label="含虚轴" value={rocInfo.stableRegion ? rocInfo.stableRegion.rocTex : '无'} tone={rocInfo.stableRegion ? 'ok' : 'warn'} />
                  </div>
                  <p class="muted">ROC 必为以极点实部为界的竖直带状区域；含虚轴 ↔ 存在稳定（双边）信号。</p>
                </>
              ) : (
                <p class="muted">先给定含极点的 H(s)。</p>
              )}
            </div>
          ) : null}

          {view === 'transform' ? (
            <div class="card stack">
              <h4 class="card-h">F(s) 零极点</h4>
              <p class="mono">极点：{fPoles.map((p) => cx(p.re, p.im)).join('，') || '无'}</p>
              <p class="mono">零点：{fZeros.map((z) => cx(z.re, z.im)).join('，') || '无'}</p>
              <p class="muted">极点由时域各分量的复指数模态给出（含 u(t) 分量在原点加极点）。</p>
            </div>
          ) : null}

          {view === 'props' ? (
            <div class="card stack">
              <h4 class="card-h">验证方法</h4>
              <p class="muted" style="margin-top:0">
                左侧 = 变换后时域信号的定义积分（复梯形，起点对齐间断）；右侧 = 符号公式在 F(s) 上的取值。两侧完全独立，误差 &lt; 1e-5 判定成立。
              </p>
              <p class="muted">{'时移：ℒ{f(t−τ)u(t−τ)} = e^(−τs)·F(s) · 频移：ℒ{e^(−at)·f(t)} = F(s+a)'}</p>
              <p class="muted">{'尺度：ℒ{f(at)} = (1/a)·F(s/a) · 微分：ℒ{f′(t)} = s·F(s) − f(0⁺)'}</p>
            </div>
          ) : null}
        </aside>
      ) : null}
    </>
  );
}

/** 下载文本文件（CSV / JSON 导出统一出口） */
function downloadText(name: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}