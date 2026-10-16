import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ExprField, FieldGroup, Metric, SegmentedChips, SliderField, StatusBadge } from '../../ui/components';
import { TeX } from '../../ui/TeX';
import {
  combineFracs,
  fourierOfItems,
  fNumeric,
  FsNumeric,
  invZ,
  itemFracZ,
  itemLapTex,
  laplaceOfItems,
  parseTimeCombo,
  parseZCombo,
  polyTex,
  pTrim,
  polyRoots,
  xNumeric,
  zOfItems,
  type TimeItem,
} from '../../core';
import { createUndoStack } from '../../state/undo';
import { getModuleState, setModuleState } from '../../state/experiments';
import { useExperimentSync } from '../useSync';
import type { ToolViewProps } from '../api';

/**
 * 公式推导（derive）
 * 三视图：性质表（ℱ/ℒ/𝒵 性质、常用变换对、s↔z 映射对照）/ 逐步推导（分步展示）/ 
 *        自定义推导（连续：f(t) → F(s) + ROC + ℱ 对照；离散：x[n] → X(z) + 𝒵⁻¹ + 数值自检）。
 * 公式渲染走 KaTeX（缺失时自动纯文本降级）。
 */

type ViewId = 'tables' | 'steps' | 'custom';
type TableId = 'ft' | 'la' | 'lt' | 'zt' | 'ztp' | 'szmap';
type DerivId = 'square' | 'laplace' | 'rect' | 'zsum' | 'conv1';
type CustomMode = 'ct' | 'dt';

interface DeriveParams {
  view: ViewId;
  table: TableId;
  deriv: DerivId;
  shown: number;
  sig: string;
  /** 自定义推导模式：连续 f(t) / 离散 x[n] */
  mode: CustomMode;
  /** 离散序列表达式 */
  zsig: string;
}

const DEFAULT: DeriveParams = {
  view: 'tables',
  table: 'la',
  deriv: 'square',
  shown: 1,
  sig: 'exp(-2*t)*u(t)',
  mode: 'ct',
  zsig: '0.8^n*u[n]',
};

const VIEWS: ReadonlyArray<{ value: ViewId; label: string }> = [
  { value: 'tables', label: '性质表' },
  { value: 'steps', label: '逐步推导' },
  { value: 'custom', label: '自定义推导' },
];

const VIEW_HINTS: Record<ViewId, string> = {
  tables: 'ℱ / ℒ / 𝒵 性质、常用变换对与 s↔z 映射对照速查。',
  steps: '典型推导按步骤展示：每步给出依据与关键公式，可逐步展开。',
  custom: '连续：f(t) → 定义积分 → 逐项变换对 → F(s)+ROC → ℱ 对照；离散：x[n] → X(z)+ROC → 𝒵⁻¹ 闭式与逐拍核对。',
};

/* ---------- 性质表数据 ---------- */
interface TableDef {
  name: string;
  head: [string, string, string, string?];
  rows: Array<[string, string, string, string?]>;
}

const TABLES: Record<TableId, TableDef> = {
  ft: {
    name: '傅立叶变换性质',
    head: ['名称', '时域', '频域'],
    rows: [
      ['线性', 'a\\,x_1(t)+b\\,x_2(t)', 'a\\,X_1(f)+b\\,X_2(f)'],
      ['时移', 'x(t-t_0)', 'X(f)e^{-j2\\pi f t_0}'],
      ['频移（调制）', 'x(t)e^{j2\\pi f_0 t}', 'X(f-f_0)'],
      ['时间缩放', 'x(at)', '\\frac{1}{|a|}X\\!\\left(\\tfrac{f}{a}\\right)'],
      ['时域微分', "x'(t)", 'j2\\pi f\\,X(f)'],
      ['对偶性', 'X(t)', 'x(-f)'],
      ['卷积定理', 'x(t)\\ast h(t)', 'X(f)\\,H(f)'],
      ['乘积定理', 'x(t)\\,h(t)', 'X(f)\\ast H(f)'],
      ['Parseval', '\\int|x(t)|^2\\,dt', '\\int|X(f)|^2\\,df'],
    ],
  },
  la: {
    name: '拉普拉斯变换性质',
    head: ['名称', '时域', 's 域'],
    rows: [
      ['线性', 'a f(t)+b g(t)', 'aF(s)+bG(s)'],
      ['时移', 'f(t-t_0)\\,u(t-t_0)', 'e^{-s t_0}F(s)'],
      ['s 域移位', 'e^{at}f(t)', 'F(s-a)'],
      ['时域微分', "f'(t)", 'sF(s)-f(0^-)'],
      ['时域积分', '\\int_0^t f(\\tau)d\\tau', '\\frac{F(s)}{s}'],
      ['s 域微分', '-t\\,f(t)', "F'(s)"],
      ['初值定理', '\\lim_{t\\to 0^+} f(t)', '\\lim_{s\\to\\infty}sF(s)'],
      ['终值定理', '\\lim_{t\\to\\infty} f(t)', '\\lim_{s\\to 0}sF(s)'],
      ['卷积定理', 'f(t)\\ast g(t)', 'F(s)\\,G(s)'],
    ],
  },
  lt: {
    name: '常用拉普拉斯变换对',
    head: ['序号', 'f(t)', 'F(s)'],
    rows: [
      ['1', '\\delta(t)', '1'],
      ['2', 'u(t)', '\\frac{1}{s}'],
      ['3', 't^{n}\\,u(t)', '\\frac{n!}{s^{n+1}}'],
      ['4', 'e^{-at}u(t)', '\\frac{1}{s+a}'],
      ['5', '\\cos(\\omega_0 t)u(t)', '\\frac{s}{s^2+\\omega_0^2}'],
      ['6', '\\sin(\\omega_0 t)u(t)', '\\frac{\\omega_0}{s^2+\\omega_0^2}'],
      ['7', 'e^{-at}\\cos(\\omega_0 t)u(t)', '\\frac{s+a}{(s+a)^2+\\omega_0^2}'],
      ['8', 'e^{-at}\\sin(\\omega_0 t)u(t)', '\\frac{\\omega_0}{(s+a)^2+\\omega_0^2}'],
    ],
  },
  zt: {
    name: 'Z 变换性质',
    head: ['名称', '序列', 'z 域'],
    rows: [
      ['线性', 'a\\,x[n]+b\\,y[n]', 'aX(z)+bY(z)'],
      ['延迟 k 拍', 'x[n-k]\\,u[n-k]', 'z^{-k}X(z)'],
      ['超前 k 拍', 'x[n+k]', 'z^{k}\\!\\left(X(z)-\\sum_{m=0}^{k-1}x[m]z^{-m}\\right)'],
      ['指数加权', 'a^{n}x[n]', 'X(z/a)'],
      ['卷积和', 'x[n]*y[n]', 'X(z)\\,Y(z)'],
      ['初值定理', 'x[0]=\\lim_{z\\to\\infty}X(z)', '\\text{（因果序列）}'],
      ['终值定理', '\\lim_{n\\to\\infty}x[n]', '\\lim_{z\\to 1}(z-1)X(z)'],
      ['与 s 域联系', 'z=e^{sT}', '\\text{单位圆}\\leftrightarrow j\\omega\\text{ 轴}'],
    ],
  },
  szmap: {
    name: 's ↔ z 映射对照',
    head: ['方法', 's → z', 'z → s', '特性'],
    rows: [
      ['冲激响应不变', 'z=e^{sT}\\;(p\\mapsto e^{pT})', 's=\\dfrac{\\ln z}{T}', '\\text{极点映射直接；高频混叠（需小 }T\\text{）}'],
      ['零阶保持（ZOH）', 'z=e^{sT},\\;G(z)=(1-z^{-1})\\mathcal{Z}\\!\\left[\\dfrac{G(s)}{s}\\right]', 's=\\dfrac{\\ln z}{T}', '\\text{与连续回路「采样保持」等效，最常用于控制}'],
      ['双线性 / Tustin', 'z=\\dfrac{1+sT/2}{1-sT/2}', 's=\\dfrac{2}{T}\\cdot\\dfrac{z-1}{z+1}', '\\text{无混叠、左半平面 → 单位圆内；频率需预畸变 }\\omega_a=\\tfrac{2}{T}\\tan\\tfrac{\\omega T}{2}'],
      ['后向差分', 'z=\\dfrac{1}{1-sT}', 's=\\dfrac{1-z^{-1}}{T}', '\\text{最简单；右半平面也映到 }|z|<1\\text{，最保守}'],
    ],
  },
  ztp: {
    name: '常用 Z 变换对',
    head: ['序号', 'x[n]', 'X(z)', 'ROC'],
    rows: [
      ['1', '\\delta[n]', '1', '\\text{全 }z\\text{ 平面}'],
      ['2', 'u[n]', '\\frac{z}{z-1}', '|z|>1'],
      ['3', 'a^{n}u[n]', '\\frac{z}{z-a}', '|z|>|a|'],
      ['4', 'n\\,a^{n}u[n]', '\\frac{az}{(z-a)^{2}}', '|z|>|a|'],
      ['5', '\\cos(\\omega_0 n)u[n]', '\\frac{z(z-\\cos\\omega_0)}{z^2-2z\\cos\\omega_0+1}', '|z|>1'],
      ['6', '\\sin(\\omega_0 n)u[n]', '\\frac{z\\sin\\omega_0}{z^2-2z\\cos\\omega_0+1}', '|z|>1'],
      ['7', 'r^{n}\\cos(\\omega_0 n)u[n]', '\\frac{z(z-r\\cos\\omega_0)}{z^2-2rz\\cos\\omega_0+r^2}', '|z|>r'],
    ],
  },
};

/* ---------- 逐步推导数据 ---------- */
interface Step {
  t: string;
  desc?: string;
  body: string;
}
interface DerivDef {
  name: string;
  desc: string;
  steps: Step[];
}

const DERIVS: Record<DerivId, DerivDef> = {
  square: {
    name: '方波的傅立叶级数（逐步算系数）',
    desc: '奇对称、周期 T 的方波：+1 在 (0,T/2)，−1 在 (T/2,T)。求三角傅立叶级数。',
    steps: [
      {
        t: '定义与周期',
        desc: '取 T=2π 使基频 ω₀=2π/T=1。奇函数 f(−t)=−f(t)，因此只有正弦项。',
        body: 'f(t)=\\begin{cases}+1 & 0<t<\\pi \\\\ -1 & \\pi<t<2\\pi\\end{cases}, \\qquad \\omega_0=\\frac{2\\pi}{T}',
      },
      {
        t: '系数公式：只剩 aₙ 或 bₙ',
        desc: '三角级数通式 f(t)=a₀/2 + Σ aₙcos(nω₀t) + Σ bₙ sin(nω₀t)。因奇函数，a₀=0 且 aₙ=0。',
        body: 'b_n = \\frac{2}{T}\\int_{0}^{T} f(t)\\sin(n\\omega_0 t)\\,dt, \\quad a_0=a_n=0',
      },
      {
        t: '代入并分段积分（关键一步）',
        desc: '在 [0,π] 上 f=+1，在 [π,2π] 上 f=−1，两段积分。',
        body: 'b_n=\\frac{1}{\\pi}\\int_0^{\\pi}(+1)\\sin(nt)dt + \\frac{1}{\\pi}\\int_{\\pi}^{2\\pi}(-1)\\sin(nt)dt',
      },
      {
        t: '求出积分结果',
        desc: '∫sin(nt)dt = −cos(nt)/n，代入上下限。',
        body: '=\\frac{1}{\\pi}\\left[-\\frac{\\cos(nt)}{n}\\right]_0^{\\pi} - \\frac{1}{\\pi}\\left[-\\frac{\\cos(nt)}{n}\\right]_{\\pi}^{2\\pi}',
      },
      {
        t: '代入端点值',
        desc: 'cos(nπ)=(−1)ⁿ（偶数 +1，奇数 −1）；cos(2nπ)=1；cos0=1。',
        body: 'b_n=\\frac{1-\\cos(n\\pi)}{n\\pi} + \\frac{1-\\cos(n\\pi)}{n\\pi} = \\frac{2\\,(1-\\cos(n\\pi))}{n\\pi}',
      },
      {
        t: '区分奇偶得到最终系数',
        desc: 'n 为偶数：cos(nπ)=1 → bₙ=0；n 为奇数：cos(nπ)=−1 → bₙ=4/(nπ)。',
        body: 'b_n=\\begin{cases}0& n\\text{ even}\\\\ \\dfrac{4}{n\\pi}& n\\text{ odd}\\end{cases}',
      },
      {
        t: '写出级数并讨论 Gibbs',
        desc: '跳变处始终存在约 9% 过冲（Gibbs 现象），项数增加只收窄过冲宽度、不降低幅度。',
        body: 'f(t)=\\sum_{k=1}^{\\infty}\\frac{4}{(2k-1)\\pi}\\,\\sin\\big((2k-1)\\omega_0 t\\big)',
      },
    ],
  },
  laplace: {
    name: '拉普拉斯变换：ℒ{e^(−at)u(t)} 的定义积分',
    desc: '直接用单边拉普拉斯变换定义推导。',
    steps: [
      { t: '三条定义', body: 'F(s)=\\int_{0^-}^{\\infty} f(t)e^{-st}dt, \\quad s=\\sigma+j\\omega' },
      { t: '代入 f(t)=e^(−at)u(t)', body: 'F(s)=\\int_0^{\\infty} e^{-at}e^{-st}dt=\\int_0^{\\infty} e^{-(s+a)t}dt' },
      { t: '积分（注意需 Re(s+a)>0 才收敛）', body: 'F(s)=\\left[-\\frac{e^{-(s+a)t}}{s+a}\\right]_0^{\\infty}' },
      { t: '代入上下限：t→∞ 指数→0，t=0 → 1', body: 'F(s)=\\frac{0-(-1)}{s+a}=\\frac{1}{s+a}, \\qquad \\operatorname{Re}(s)>-a' },
    ],
  },
  rect: {
    name: '矩形脉冲 ↔ sinc：傅立叶变换推导',
    desc: '宽度 T、中心在原点的矩形脉冲。',
    steps: [
      { t: '定义变换对（角频率 ω）', body: 'X(\\omega)=\\int_{-\\infty}^{\\infty} x(t)e^{-j\\omega t}dt' },
      { t: '代入矩形（有限支撑，只需积 −T/2 到 T/2）', body: 'X(\\omega)=\\int_{-T/2}^{T/2} 1\\cdot e^{-j\\omega t}dt=\\left[\\frac{e^{-j\\omega t}}{-j\\omega}\\right]_{-T/2}^{T/2}' },
      { t: '端点相减', body: '=\\frac{e^{-j\\omega T/2}-e^{j\\omega T/2}}{-j\\omega}' },
      { t: '用 Euler 公式 e^{jθ}−e^{−jθ}=2j sin θ', body: '=\\frac{(-\\;2j\\sin(\\omega T/2))}{-j\\omega}=\\frac{2\\sin(\\omega T/2)}{\\omega}' },
      {
        t: '写成 sinc 形式（sinc(x)=sin(πx)/(πx)）',
        desc: '分子分母同乘 T：ωT/2 = π·(Tf)，其中 f=ω/2π。',
        body: 'X(\\omega)=T\\cdot\\frac{\\sin(\\omega T/2)}{\\omega T/2}=T\\,\\mathrm{sinc}\\!\\left(\\frac{\\omega T}{2\\pi}\\right)=T\\,\\mathrm{sinc}(T f)',
      },
    ],
  },
  zsum: {
    name: 'Z 变换：𝒵{aⁿu[n]} 的定义求和',
    desc: '单边 Z 变换定义 X(z)=Σ_{n=0}^{∞} x[n] z^{−n}，对指数序列用几何级数求和。',
    steps: [
      { t: '定义代入', body: 'X(z)=\\sum_{n=0}^{\\infty}a^{n}z^{-n}=\\sum_{n=0}^{\\infty}\\left(az^{-1}\\right)^{n}' },
      { t: '几何级数（需 |az⁻¹|<1，即 |z|>|a|）', body: '=\\frac{1}{1-az^{-1}}=\\frac{z}{z-a}, \\qquad \\text{ROC: } |z|>|a|' },
      {
        t: '极点与 ROC',
        desc: '极点 z=a 在 ROC 边界上；a 在单位圆内 ⇔ 序列有界收敛（稳定）。',
        body: 'z=a\\;\\text{（一阶极点）}, \\quad |a|<1 \\Leftrightarrow \\text{稳定}',
      },
      { t: '频响（单位圆上的 Z 变换）', desc: '令 z=e^{jω}，ROC 含单位圆时可代入。', body: 'H(e^{j\\omega})=\\frac{1}{1-ae^{-j\\omega}}' },
    ],
  },
  conv1: {
    name: '小例子：卷积求响应',
    desc: '系统 h(t)=e^{−t}u(t)，输入 x(t)=e^{−2t}u(t)，求 y(t)=x∗h。',
    steps: [
      {
        t: '卷积积分（因果：t<0 时 y=0；t≥0 积分从 0 到 t）',
        body: 'y(t)=\\int_{-\\infty}^{\\infty} x(\\tau)h(t-\\tau)d\\tau=\\int_0^{t} e^{-2\\tau}e^{-(t-\\tau)}d\\tau',
      },
      { t: '合并指数', body: '=e^{-t}\\int_0^{t} e^{-\\tau}d\\tau = e^{-t}\\left[-e^{-\\tau}\\right]_0^{t}' },
      { t: '直接积分结果', body: 'y(t)=e^{-t}(1-e^{-t})\\,u(t)' },
      {
        t: '用拉普拉斯验证（乘法更省事）',
        desc: 's 域中卷积变成乘法：Y(s)=X(s)H(s)，部分分式展开后与直接积分结果一致。',
        body: 'Y(s)=\\frac{1}{s+2}\\cdot\\frac{1}{s+1}=\\frac{1}{s+1}-\\frac{1}{s+2}\\;\\Rightarrow\\;y(t)=e^{-t}-e^{-2t}',
      },
    ],
  },
};

const TABLE_CHIPS: ReadonlyArray<{ value: TableId; label: string }> = [
  { value: 'ft', label: 'ℱ 性质' },
  { value: 'la', label: 'ℒ 性质' },
  { value: 'lt', label: 'ℒ 变换对' },
  { value: 'zt', label: '𝒵 性质' },
  { value: 'ztp', label: '𝒵 变换对' },
  { value: 'szmap', label: 's↔z 映射' },
];

const DERIV_CHIPS: ReadonlyArray<{ value: DerivId; label: string }> = [
  { value: 'square', label: '方波级数' },
  { value: 'laplace', label: 'ℒ 定义积分' },
  { value: 'rect', label: '矩形 ↔ sinc' },
  { value: 'zsum', label: '𝒵 几何级数' },
  { value: 'conv1', label: '卷积例题' },
];

function sanitize(raw: unknown): DeriveParams {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<DeriveParams>;
  const views: ViewId[] = ['tables', 'steps', 'custom'];
  const tables: TableId[] = ['ft', 'la', 'lt', 'zt', 'ztp', 'szmap'];
  const derivs: DerivId[] = ['square', 'laplace', 'rect', 'zsum', 'conv1'];
  const modes: CustomMode[] = ['ct', 'dt'];
  return {
    view: views.includes(r.view as ViewId) ? (r.view as ViewId) : DEFAULT.view,
    table: tables.includes(r.table as TableId) ? (r.table as TableId) : DEFAULT.table,
    deriv: derivs.includes(r.deriv as DerivId) ? (r.deriv as DerivId) : DEFAULT.deriv,
    shown: Number.isFinite(r.shown) ? Math.max(1, Math.min(20, Math.round(r.shown as number))) : DEFAULT.shown,
    sig: typeof r.sig === 'string' && r.sig.trim() ? r.sig : DEFAULT.sig,
    mode: modes.includes(r.mode as CustomMode) ? (r.mode as CustomMode) : DEFAULT.mode,
    zsig: typeof r.zsig === 'string' && r.zsig.trim() ? r.zsig : DEFAULT.zsig,
  };
}

const nf = (v: number | null | undefined, d = 4): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  return String(+v.toFixed(d));
};

export function DeriveTool(props: ToolViewProps) {
  const [params, setParams] = useState<DeriveParams>(() => sanitize(getModuleState<DeriveParams>('derive', DEFAULT)));
  const undoRef = useRef(createUndoStack<DeriveParams>(40));
  const lastPush = useRef(0);

  useEffect(() => {
    setModuleState('derive', params);
  }, [params]);

  useExperimentSync('derive',
    () => sanitize(getModuleState<DeriveParams>('derive', DEFAULT)),
    (v) => {
      setParams(v);
      undoRef.current.clear();
    },
  );

  const apply = (next: Partial<DeriveParams>): void => {
    const now = Date.now();
    if (now - lastPush.current > 500) {
      undoRef.current.push(params);
      lastPush.current = now;
    }
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };
  const applyLive = (next: Partial<DeriveParams>): void => {
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };

  const view = params.view;

  /* ================= 自定义推导 ================= */

  /** u(t) 项按常数项处理（与 v1 一致：u(t) ↔ 1/s） */
  const items: TimeItem[] | null = useMemo(() => {
    const its = parseTimeCombo(params.sig);
    return its ? its.map((it) => (it.kind === 'u' ? ({ ...it, kind: 'const' } as TimeItem) : it)) : null;
  }, [params.sig]);

  const lap = useMemo(() => (items ? laplaceOfItems(items) : null), [items]);
  const perTerm = useMemo(() => {
    if (!items) return [];
    return items.map((it) => ({
      fs: itemLapTex(it),
      four: fourierOfItems([it]).tex.replace('F(j\\omega)=', ''),
      imp: fourierOfItems([it]).imp,
    }));
  }, [items]);

  /** 数值自检：定义积分（复梯形） vs F(s) 闭式 */
  const check = useMemo(() => {
    if (!items || !items.length || view !== 'custom') return null;
    const right = items.reduce((m, it) => Math.max(m, it.kind === 'exp' || it.kind === 'texp' ? -it.a : 0), 0);
    const sigma = right + 1.5;
    const N = 40000;
    const dt = 60 / sigma / N;
    let acc = 0;
    for (let i = 0; i <= N; i++) {
      const t = i * dt;
      acc += fNumeric(items, t) * Math.exp(-sigma * t) * (i === 0 || i === N ? 0.5 : 1) * dt;
    }
    const closed = FsNumeric(items, sigma);
    return { sigma, lhs: acc, rhs: closed, rel: Math.abs(acc - closed) / Math.max(1e-12, Math.abs(closed)) };
  }, [items, view]);

  /* ---- 离散自定义：x[n] → X(z) → 𝒵⁻¹ ---- */

  const zItems = useMemo(() => parseZCombo(params.zsig), [params.zsig]);
  const zl = useMemo(() => (zItems ? zOfItems(zItems) : null), [zItems]);
  const zX = useMemo(() => (zItems ? combineFracs(zItems, itemFracZ) : null), [zItems]);
  const zPoles = useMemo(() => (zX ? polyRoots(zX.d) : []), [zX]);
  const zInv = useMemo(() => (zX ? invZ(zX.n, zX.d) : null), [zX]);

  /** 数值核对：𝒵⁻¹ 闭式 x[n] vs 直接求序列（前 12 拍最大偏差） */
  const zCheck = useMemo(() => {
    if (!zItems || !zInv || zInv.tex == null) return null;
    const rows: Array<{ n: number; direct: number; closed: number }> = [];
    let worst = 0;
    for (let n = 0; n < 12; n++) {
      const direct = xNumeric(zItems, n);
      const closed = zInv.evalN(n);
      rows.push({ n, direct, closed });
      worst = Math.max(worst, Math.abs(direct - closed));
    }
    return { rows, worst };
  }, [zItems, zInv]);

  /** 稳定性：单位圆内极点（ρmax < 1）；无极点 = 有限长序列 */
  const zStable = useMemo(() => {
    if (!zPoles.length) return { kind: 'finite' as const, rho: 0 };
    let rho = 0;
    for (const p of zPoles) rho = Math.max(rho, Math.hypot(p.re, p.im));
    return { kind: rho < 1 - 1e-9 ? ('stable' as const) : rho > 1 + 1e-9 ? ('unstable' as const) : ('critical' as const), rho };
  }, [zPoles]);

  /* ================= ToolApi ================= */

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
        view === 'tables'
          ? TABLES[params.table].name + ' · ' + TABLES[params.table].rows.length + ' 条'
          : view === 'steps'
            ? DERIVS[params.deriv].name + ' · 第 ' + Math.min(params.shown, DERIVS[params.deriv].steps.length) + '/' + DERIVS[params.deriv].steps.length + ' 步'
            : params.mode === 'dt'
              ? zItems
                ? 'x[n] 已解析 · ' + zItems.length + ' 项'
                : '序列待解析'
              : items
                ? 'f(t) 已解析 · ' + items.length + ' 项'
                : '信号待解析',
      metrics: () => {
        if (view === 'tables') {
          return [{ label: '条目数', value: TABLES[params.table].rows.length, precision: 0 }];
        }
        if (view === 'steps') {
          const d = DERIVS[params.deriv];
          return [
            { label: '步骤数', value: d.steps.length, precision: 0 },
            { label: '当前进度', value: Math.min(params.shown, d.steps.length) + ' / ' + d.steps.length },
          ];
        }
        if (params.mode === 'dt') {
          const stTone: 'ok' | 'warn' | 'danger' =
            zStable.kind === 'stable' || zStable.kind === 'finite' ? 'ok' : zStable.kind === 'critical' ? 'warn' : 'danger';
          const ckTone: 'ok' | 'warn' = zCheck && zCheck.worst < 1e-6 ? 'ok' : 'warn';
          return [
            { label: '项数', value: zItems ? zItems.length : 0, precision: 0 },
            { label: '极点数', value: zPoles.length, precision: 0 },
            { label: 'ρmax', value: zStable.kind === 'finite' ? '—' : zStable.rho, precision: 3, tone: stTone },
            { label: '反变换核对 ε', value: zCheck ? (zCheck.worst < 1e-9 ? '< 1e-9' : zCheck.worst.toExponential(1)) : '—', tone: ckTone },
          ];
        }
        return check
          ? [
              { label: '项数', value: items ? items.length : 0, precision: 0 },
              { label: '验证点 σ', value: check.sigma, precision: 2 },
              { label: '定义积分 vs 闭式 ε', value: check.rel < 1e-3 ? check.rel.toExponential(1) : nf(check.rel, 4), tone: check.rel < 1e-3 ? 'ok' : 'warn' },
            ]
          : [];
      },
      exports: () => [
        { id: 'json', label: 'JSON', run: () => downloadText('derive-experiment.json', JSON.stringify(params, null, 2)) },
        {
          id: 'tex',
          label: 'TeX',
          disabled: view !== 'custom' || (params.mode === 'dt' ? !(zl && zInv?.tex) : !lap),
          reason: '仅在「自定义推导」视图且表达式已解析时可导出',
          run: () => {
            if (params.mode === 'dt') {
              if (!zl || !zInv || zInv.tex == null) return;
              const X =
                zX != null ? 'X(z)=\\dfrac{' + polyTex(pTrim(zX.n), 'z') + '}{' + polyTex(pTrim(zX.d), 'z') + '}' : zl.zLine;
              downloadText('derive-latex.txt', [zl.xLine, zl.zLine, X, zl.rocTex, 'x[n]=' + zInv.tex].join('\n'));
              return;
            }
            if (!lap) return;
            downloadText('derive-latex.txt', [lap.fLine, lap.fsLine, lap.rocTex].join('\n'));
          },
        },
      ],
    });
    return () => props.api(null);
  }, [params, view, items, lap, check, perTerm, zItems, zl, zX, zInv, zPoles, zStable, zCheck]);

  /* ================= 渲染 ================= */

  const d = DERIVS[params.deriv];
  const shown = Math.min(params.shown, d.steps.length);

  return (
    <>
      {props.leftOpen ? (
        <aside class="ws-left">
          <FieldGroup title="视图">
            <SegmentedChips options={VIEWS} value={view} onChange={(v) => apply({ view: v })} ariaLabel="视图" />
            <p class="muted">{VIEW_HINTS[view]}</p>
          </FieldGroup>

          {view === 'tables' ? (
            <FieldGroup title="表格">
              <SegmentedChips options={TABLE_CHIPS} value={params.table} onChange={(v) => apply({ table: v })} ariaLabel="表格" />
              <p class="muted">{TABLES[params.table].name}</p>
            </FieldGroup>
          ) : null}

          {view === 'steps' ? (
            <FieldGroup title="推导主题">
              <SegmentedChips options={DERIV_CHIPS} value={params.deriv} onChange={(v) => apply({ deriv: v, shown: 1 })} ariaLabel="推导" />
              <p class="muted">{d.desc}</p>
              <SliderField
                label="显示到第几步"
                value={shown}
                onChange={(v) => applyLive({ shown: Math.round(v) })}
                min={1}
                max={d.steps.length}
                step={1}
                precision={0}
              />
            </FieldGroup>
          ) : null}

          {view === 'custom' ? (
            <>
              <FieldGroup title="推导类型">
                <SegmentedChips
                  options={[
                    { value: 'ct' as CustomMode, label: '连续 ℒ' },
                    { value: 'dt' as CustomMode, label: '离散 𝒵' },
                  ]}
                  value={params.mode}
                  onChange={(v) => apply({ mode: v })}
                  ariaLabel="推导类型"
                />
              </FieldGroup>
              {params.mode === 'ct' ? (
                <FieldGroup title="信号 f(t)" desc="支持 exp/sin/cos/t^n/u(t)/常数及其线性组合。">
                  <ExprField
                    label="f(t)"
                    value={params.sig}
                    onChange={(v) => apply({ sig: v })}
                    status={items ? 'ok' : 'err'}
                    message={items ? '已解析（' + items.length + ' 项）' : '无法解析：请检查写法'}
                    hint="示例：exp(-2*t)*u(t)、sin(3*t)*u(t)、t^2*u(t)"
                  />
                  <div class="row">
                    {['exp(-2*t)*u(t)', 'sin(3*t)*u(t)', 't^2*u(t)', 'exp(-2*t)*u(t)+cos(4*t)*u(t)'].map((s) => (
                      <button key={s} class="btn" onClick={() => apply({ sig: s })}>
                        {s.replace('*u(t)', '')}
                      </button>
                    ))}
                  </div>
                </FieldGroup>
              ) : (
                <FieldGroup title="序列 x[n]" desc="因果序列；支持 a^n、n、n·a^n、cos/sin(w n)、r^n·cos/sin(w n)（阻尼振荡）、u[n]、delta[n] 及其线性组合。">
                  <ExprField
                    label="x[n]"
                    value={params.zsig}
                    onChange={(v) => apply({ zsig: v })}
                    status={zItems ? 'ok' : 'err'}
                    message={zItems ? '已解析（' + zItems.length + ' 项）' : '无法解析：请检查写法'}
                    hint="示例：0.8^n*u[n]、n*u[n]、n*2^n*u[n]、cos(pi/3*n)u[n]、0.9^n*cos(pi/4*n)*u[n]"
                  />
                  <div class="row">
                    {['0.8^n*u[n]', 'n*u[n]', '0.5^n*u[n]+delta[n]', 'cos(pi/3*n)u[n]'].map((s) => (
                      <button key={s} class="btn" onClick={() => apply({ zsig: s })}>
                        {s.replace('*u[n]', '')}
                      </button>
                    ))}
                  </div>
                </FieldGroup>
              )}
            </>
          ) : null}
        </aside>
      ) : null}

      <section class="ws-main">
        {view === 'tables' ? (
          <div class="card stack">
            <h3>{TABLES[params.table].name}</h3>
            <table class="tbl">
              <thead>
                <tr>
                  {TABLES[params.table].head.map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TABLES[params.table].rows.map((row, i) => (
                  <tr key={i}>
                    <td>{row[0]}</td>
                    <td>
                      <TeX tex={row[1]} />
                    </td>
                    <td>
                      <TeX tex={row[2]} />
                    </td>
                    {TABLES[params.table].head.length > 3 ? (
                      <td>
                        <TeX tex={row[3] ?? ''} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
            <p class="muted">单位约定：ω (rad/s)、f (Hz)、s = σ + jω；z 变换收敛域以 |z| 表述。</p>
          </div>
        ) : null}

        {view === 'steps' ? (
          <div class="card stack">
            <h3>{d.name}</h3>
            <p class="muted" style="margin-top:0">
              {d.desc}
            </p>
            <div class="row">
              <button class="btn primary" disabled={shown >= d.steps.length} onClick={() => apply({ shown: shown + 1 })}>
                ▶ 下一步
              </button>
              <button class="btn" disabled={shown <= 1} onClick={() => apply({ shown: shown - 1 })}>
                ◀ 上一步
              </button>
              <StatusBadge kind="info">
                第 {shown} / {d.steps.length} 步
              </StatusBadge>
            </div>
            {d.steps.slice(0, shown).map((st, i) => (
              <div key={i} class="card stack" style="border-color: var(--accent-line)">
                <h3 style="margin:0">
                  {i + 1}. {st.t}
                </h3>
                {st.desc ? <p class="muted" style="margin-top:0">{st.desc}</p> : null}
                <div class="tex-line">
                  <TeX tex={st.body} />
                </div>
              </div>
            ))}
            <p class="muted">用「下一步 / 上一步」逐步展开，或用左栏滑杆直接跳到第 k 步。</p>
          </div>
        ) : null}

        {view === 'custom' && params.mode === 'dt' ? (
          zItems && zl && zX && zInv ? (
            <>
              <div class="card stack">
                <h3>① 定义（单边 Z 变换）</h3>
                <div class="tex-line">
                  <TeX tex={'X(z)=\\sum_{n=0}^{\\infty} x[n]\\,z^{-n}'} />
                </div>
                <p class="muted">{zl.xLine}</p>
              </div>

              <div class="card stack">
                <h3>② 逐项变换对 → 有理式合并</h3>
                <div class="formula-block">
                  <div class="tex-line">
                    <TeX tex={zl.zLine} />
                  </div>
                  <div class="tex-line">
                    <TeX tex={'X(z)=\\dfrac{' + polyTex(pTrim(zX.n), 'z') + '}{' + polyTex(pTrim(zX.d), 'z') + '}'} />
                  </div>
                </div>
                <div class="row">
                  <StatusBadge kind={zStable.kind === 'stable' ? 'ok' : zStable.kind === 'finite' ? 'info' : zStable.kind === 'critical' ? 'warn' : 'err'}>
                    {zStable.kind === 'finite'
                      ? '无极点（有限长序列 · ROC 全平面）'
                      : zStable.kind === 'stable'
                        ? '稳定（极点在单位圆内）'
                        : zStable.kind === 'critical'
                          ? '临界（含单位圆上极点）'
                          : '不稳定（存在单位圆外极点）'}
                  </StatusBadge>
                  {zStable.kind !== 'finite' ? <Metric label="ρmax（极点模）" value={zStable.rho} precision={3} /> : null}
                  <Metric label="极点数" value={zPoles.length} precision={0} />
                  <Metric label="项数" value={zItems.length} precision={0} />
                </div>
                <p class="muted">{zl.rocTex}</p>
              </div>

              <div class="card stack">
                <h3>③ 反变换（𝒵 逆变换）</h3>
                {zInv.tex ? (
                  <div class="formula-block">
                    <div class="tex-line">
                      <TeX tex={'x[n]=' + zInv.tex + ',\\quad n\\ge 0'} />
                    </div>
                  </div>
                ) : (
                  <p class="muted">{zInv.note}</p>
                )}
                <p class="muted">{zInv.note}（部分分式 + 留数，重极点展开）</p>
              </div>

              <div class="card stack">
                <h3>④ 数值核对（闭式 vs 直接求序列）</h3>
                {zCheck ? (
                  <>
                    <table class="tbl">
                      <thead>
                        <tr>
                          <th>n</th>
                          <th>x[n]（直接）</th>
                          <th>𝒵⁻¹ 闭式</th>
                        </tr>
                      </thead>
                      <tbody>
                        {zCheck.rows.map((r) => (
                          <tr key={r.n}>
                            <td>{r.n}</td>
                            <td class="mono">{nf(r.direct, 6)}</td>
                            <td class="mono">{nf(r.closed, 6)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div class="row">
                      <StatusBadge kind={zCheck.worst < 1e-9 ? 'ok' : 'warn'}>
                        前 12 拍最大偏差 {zCheck.worst < 1e-9 ? '< 1e-9' : zCheck.worst.toExponential(1)}
                      </StatusBadge>
                      <span class="muted">闭式与序列直接求值同源，偏差应为数值误差量级。</span>
                    </div>
                  </>
                ) : (
                  <p class="muted">闭式不可用（{zInv.note}），仅能给出序列直接求值。</p>
                )}
              </div>
            </>
          ) : (
            <div class="card stack">
              <StatusBadge kind="err">序列无法解析</StatusBadge>
              <p class="muted">
                支持：a^n·u[n]、n·u[n]、n·a^n·u[n]、cos/sin(w n)·u[n]、r^n·cos/sin(w n)·u[n]（阻尼振荡）、u[n]、delta[n]、常数及加减组合。
              </p>
            </div>
          )
        ) : null}

        {view === 'custom' && params.mode === 'ct' ? (
          items && lap ? (
            <>
              <div class="card stack">
                <h3>① 定义积分（单边拉普拉斯）</h3>
                <div class="tex-line">
                  <TeX tex={'F(s)=\\int_{0^-}^{\\infty} f(t)\\,e^{-st}\\,dt,\\qquad s=\\sigma+j\\omega'} />
                </div>
              </div>
              <div class="card stack">
                <h3>② 逐项分解（线性性：每项独立变换）</h3>
                <div class="formula-block">
                  <div class="tex-line">
                    <TeX tex={lap.fLine} />
                  </div>
                </div>
                <table class="tbl">
                  <thead>
                    <tr>
                      <th>项</th>
                      <th>ℒ 单项</th>
                      <th>ℱ 单项</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perTerm.map((tm, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td>
                          <TeX tex={tm.fs} />
                        </td>
                        <td>
                          <TeX tex={tm.four} />
                          {tm.imp ? ' （含 δ）' : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div class="card stack">
                <h3>③ 线性合并 + 收敛域</h3>
                <div class="formula-block">
                  <div class="tex-line">
                    <TeX tex={lap.fsLine} />
                  </div>
                  <div class="tex-line">
                    <TeX tex={lap.rocTex} />
                  </div>
                </div>
              </div>
              <div class="card stack">
                <h3>④ 数值自检（定义积分 vs 闭式）</h3>
                {check ? (
                  <>
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
                    <div class="row">
                      <Metric
                        label="ε · 定义积分 vs 闭式"
                        value={check.rel < 1e-3 ? check.rel.toExponential(1) : nf(check.rel, 4)}
                        tone={check.rel < 1e-3 ? 'ok' : 'warn'}
                      />
                      <StatusBadge kind={check.rel < 1e-3 ? 'ok' : 'warn'}>
                        {check.rel < 1e-3 ? '闭式与定义积分一致' : '偏差偏大：请检查信号写法'}
                      </StatusBadge>
                    </div>
                  </>
                ) : null}
              </div>
            </>
          ) : (
            <div class="card stack">
              <StatusBadge kind="err">信号无法解析</StatusBadge>
              <p class="muted">支持：exp(-a*t)、sin(w*t)、cos(w*t)、t^n、t^n*exp(-a*t)、u(t)、常数及加减组合。</p>
            </div>
          )
        ) : null}
      </section>

      {props.rightOpen ? (
        <aside class="ws-right">
          <div class="card stack">
            <h4 class="card-h">说明</h4>
            {view === 'custom' ? (
              <p class="muted" style="margin-top:0">
                逐项生成变换对，再线性合并（u(t) ↔ 1/s）；结果同时给出 F(s)、ROC 与 ℱ 对照。
              </p>
            ) : view === 'steps' ? (
              <p class="muted" style="margin-top:0">
                推导按步骤展开，每步给出依据与关键公式；公式缺失 KaTeX 时自动纯文本降级。
              </p>
            ) : (
              <p class="muted" style="margin-top:0">
                性质表为速查用途；推导细节见「逐步推导」，任意信号的自动推导见「自定义推导」。
              </p>
            )}
          </div>
          {view === 'steps' ? (
            <div class="card stack">
              <h4 class="card-h">进度</h4>
              <Metric label="已展示步骤" value={shown + ' / ' + d.steps.length} />
            </div>
          ) : null}
          {view === 'custom' && items ? (
            <div class="card stack">
              <h4 class="card-h">解析结构</h4>
              <p class="mono">{items.length} 项线性组合</p>
              <p class="muted">各单项变换对见主区②表格；合并结果与 ROC 见③。</p>
            </div>
          ) : null}
        </aside>
      ) : null}
    </>
  );
}

/** 下载文本文件（JSON / TeX 导出统一出口） */
function downloadText(name: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}