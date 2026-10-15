import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Chart } from '../../chart/Chart';
import { ExprField, FieldGroup, Metric, NumField, SegmentedChips, SliderField, StatusBadge } from '../../ui/components';
import { TeX } from '../../ui/TeX';
import { VoiceInput } from '../../ui/VoiceInput';
import {
  conv,
  fourierOfItems,
  fNumeric,
  laplaceOfItems,
  parseDiffEq,
  parseDataSeq,
  parseODE,
  parseTimeCombo,
  parseTimeExpr,
  parseZCombo,
  recurDiff,
  simulateODE,
  solveDiffEq,
  solveODE,
  spectrum,
  xNumeric,
  zOfItems,
} from '../../core';
import type { TimeItem, ZItem } from '../../core';
import { createUndoStack } from '../../state/undo';
import { getModuleState, setModuleState } from '../../state/experiments';
import { useExperimentSync } from '../useSync';
import type { ToolViewProps } from '../api';

/**
 * 交互求解（solve）— M2 存量迁移升级
 * 五视图：表达式求解（曲线 + 关键指标）/ 微分方程（解析 + 仿真互验）/ 差分方程（解析 + 递推互验）/
 *        数据与滤波（粘贴数据 + 三种滤波 + 频谱）/ 符号变换（ℒ/ℱ/𝒵 变换对）。
 * 数值路径：表达式/ODE/差分方程解析 = 符号变换 + 留数法，数值对照 = RK4 与逐拍递推。
 * 语音输入依赖浏览器在线识别服务（Web Speech API），离线环境不可用。
 */

type ViewId = 'expr' | 'ode' | 'diffeq' | 'data' | 'sym';
type FiltId = 'none' | 'ma5' | 'diff' | 'iir1';

interface SolveParams {
  view: ViewId;
  expr: string;
  t0: number;
  t1: number;
  ode: string;
  ics: number[];
  tmax: number;
  de: string;
  dics: number[];
  N: number;
  raw: string;
  filt: FiltId;
  /** FIR 滑动平均窗长（奇数，默认 5） */
  maLen: number;
  /** IIR 一阶低通系数 α（默认 0.2） */
  alpha: number;
  sig: string;
  sigKind: 'auto' | 'cont' | 'disc';
}

const DEFAULT: SolveParams = {
  view: 'expr',
  expr: 'sin(3*t)*exp(-0.5*t)',
  t0: 0,
  t1: 8,
  ode: "y'' + 3*y' + 2*y = exp(-2*t)*u(t)",
  ics: [1, 0],
  tmax: 8,
  de: 'y[n+2] - 1.5*y[n+1] + 0.5*y[n] = u(n)',
  dics: [1, 1],
  N: 30,
  raw: '1 3 2 4 1 -1 -2 0 2 3',
  filt: 'none',
  maLen: 5,
  alpha: 0.2,
  sig: 'exp(-2*t)*u(t)',
  sigKind: 'auto',
};

const VIEWS: ReadonlyArray<{ value: ViewId; label: string }> = [
  { value: 'expr', label: '表达式' },
  { value: 'ode', label: '微分方程' },
  { value: 'diffeq', label: '差分方程' },
  { value: 'data', label: '数据与滤波' },
  { value: 'sym', label: '符号变换' },
];

const VIEW_HINTS: Record<ViewId, string> = {
  expr: '任意 f(t) 表达式 → 曲线与关键指标（极值 / 积分 / 均值 / RMS / 零点）。',
  ode: '常微分方程 + 初值：解析解（零输入 / 零状态 / 全解）与 RK4 仿真叠加互验。',
  diffeq: '差分方程 + 初值：解析解（z 域通道）与逐拍递推叠加互验。',
  data: '粘贴数据（单列或两列 t y）→ 统计与频谱；FIR 滑动平均 / 差分 / IIR 一阶低通对比。',
  sym: '连续或离散信号 → ℒ / ℱ / 𝒵 变换对与 ROC。',
};

const FILTS: ReadonlyArray<{ value: FiltId; label: string }> = [
  { value: 'none', label: '不滤波' },
  { value: 'ma5', label: 'FIR 滑动平均' },
  { value: 'diff', label: 'FIR 一阶差分' },
  { value: 'iir1', label: 'IIR 一阶低通' },
];

const SIG_KINDS: ReadonlyArray<{ value: 'auto' | 'cont' | 'disc'; label: string }> = [
  { value: 'auto', label: '自动判别' },
  { value: 'cont', label: '连续 f(t)' },
  { value: 'disc', label: '离散 x[n]' },
];

const IC_LABELS = ['y(0)', 'y′(0)', 'y″(0)', 'y‴(0)', 'y⁗(0)', 'y⁵(0)', 'y⁶(0)', 'y⁷(0)'];

const nf = (v: number | null | undefined, d = 4): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  return String(+v.toFixed(d));
};

const tiny = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  return v !== 0 && Math.abs(v) < 1e-3 ? v.toExponential(1) : nf(v, 4);
};

function yRangeOf(y: ArrayLike<number>, pad = 0.12): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < y.length; i++) {
    const v = y[i];
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [-1, 1];
  if (hi - lo < 1e-9) return [lo - 1, hi + 1];
  const m = (hi - lo) * pad;
  return [lo - m, hi + m];
}

/** 卷积取「同长」中心段（FIR 滤波显示对齐） */
function convSame(x: number[], h: number[]): number[] {
  const full = conv(x, h);
  const off = Math.floor((h.length - 1) / 2);
  const out: number[] = [];
  for (let i = 0; i < x.length; i++) out.push(full[i + off] ?? 0);
  return out;
}

function sanitize(raw: unknown): SolveParams {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SolveParams>;
  const views: ViewId[] = ['expr', 'ode', 'diffeq', 'data', 'sym'];
  const filts: FiltId[] = ['none', 'ma5', 'diff', 'iir1'];
  const kinds = ['auto', 'cont', 'disc'] as const;
  const nums = (v: unknown, max = 8): number[] =>
    Array.isArray(v) ? v.filter((x) => Number.isFinite(x)).slice(0, max).map((x) => Number(x)) : [];
  return {
    view: views.includes(r.view as ViewId) ? (r.view as ViewId) : DEFAULT.view,
    expr: typeof r.expr === 'string' && r.expr.trim() ? r.expr : DEFAULT.expr,
    t0: Number.isFinite(r.t0) ? (r.t0 as number) : DEFAULT.t0,
    t1: Number.isFinite(r.t1) && (r.t1 as number) > (Number.isFinite(r.t0) ? (r.t0 as number) : DEFAULT.t0) ? (r.t1 as number) : DEFAULT.t1,
    ode: typeof r.ode === 'string' && r.ode.trim() ? r.ode : DEFAULT.ode,
    ics: nums(r.ics),
    tmax: Number.isFinite(r.tmax) ? Math.max(0.5, Math.min(60, r.tmax as number)) : DEFAULT.tmax,
    de: typeof r.de === 'string' && r.de.trim() ? r.de : DEFAULT.de,
    dics: nums(r.dics),
    N: Number.isFinite(r.N) ? Math.max(4, Math.min(200, Math.round(r.N as number))) : DEFAULT.N,
    raw: typeof r.raw === 'string' ? r.raw : DEFAULT.raw,
    filt: filts.includes(r.filt as FiltId) ? (r.filt as FiltId) : DEFAULT.filt,
    maLen: Number.isFinite(r.maLen) ? Math.max(3, Math.min(21, Math.round(r.maLen as number) | 1)) : DEFAULT.maLen,
    alpha: Number.isFinite(r.alpha) ? Math.max(0.01, Math.min(1, r.alpha as number)) : DEFAULT.alpha,
    sig: typeof r.sig === 'string' && r.sig.trim() ? r.sig : DEFAULT.sig,
    sigKind: kinds.includes(r.sigKind as 'auto') ? (r.sigKind as 'auto') : DEFAULT.sigKind,
  };
}

export function SolveTool(props: ToolViewProps) {
  const [params, setParams] = useState<SolveParams>(() => sanitize(getModuleState<SolveParams>('solve', DEFAULT)));
  const undoRef = useRef(createUndoStack<SolveParams>(40));
  const lastPush = useRef(0);

  useEffect(() => {
    setModuleState('solve', params);
  }, [params]);

  useExperimentSync('solve',
    () => sanitize(getModuleState<SolveParams>('solve', DEFAULT)),
    (v) => {
      setParams(v);
      undoRef.current.clear();
    },
  );

  const apply = (next: Partial<SolveParams>): void => {
    const now = Date.now();
    if (now - lastPush.current > 500) {
      undoRef.current.push(params);
      lastPush.current = now;
    }
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };
  const applyLive = (next: Partial<SolveParams>): void => {
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };

  const view = params.view;

  /* ================= A. 表达式求解 ================= */

  const exprFn = useMemo(() => parseTimeExpr(params.expr), [params.expr]);
  const exprData = useMemo(() => {
    if (!exprFn || view !== 'expr') return null;
    const M = 1200;
    const t: number[] = [];
    const y: number[] = [];
    let mx = -Infinity;
    let mn = Infinity;
    let mxT = 0;
    let mnT = 0;
    let sum = 0;
    let sq = 0;
    let zeros = 0;
    let prev = NaN;
    for (let i = 0; i <= M; i++) {
      const tv = params.t0 + ((params.t1 - params.t0) * i) / M;
      const v = exprFn(tv);
      const fv = Number.isFinite(v) ? v : 0;
      t.push(tv);
      y.push(fv);
      if (fv > mx) {
        mx = fv;
        mxT = tv;
      }
      if (fv < mn) {
        mn = fv;
        mnT = tv;
      }
      sum += fv;
      sq += fv * fv;
      if (Number.isFinite(prev) && prev !== 0 && fv !== 0 && prev * fv < 0) zeros++;
      prev = fv;
    }
    const dt = (params.t1 - params.t0) / M;
    let integ = 0;
    for (let i = 0; i < M; i++) integ += ((y[i] + y[i + 1]) / 2) * dt;
    return { t, y, mx, mn, mxT, mnT, zeros, integ, mean: sum / (M + 1), rms: Math.sqrt(sq / (M + 1)) };
  }, [exprFn, params.t0, params.t1, view]);

  /* ================= B. 微分方程 ================= */

  const odeParsed = useMemo(() => parseODE(params.ode), [params.ode]);
  const odeSolved = useMemo(() => {
    if (!odeParsed.ok || view !== 'ode') return null;
    return solveODE(odeParsed.a, odeParsed.rhsItems, params.ics);
  }, [odeParsed, params.ics, view]);

  const odeSim = useMemo(() => {
    if (!odeParsed.ok || !odeSolved || !odeSolved.ok || view !== 'ode') return null;
    const rhs = (t: number): number => fNumeric(odeParsed.rhsItems as TimeItem[], t);
    try {
      return simulateODE(odeParsed.a, rhs, params.ics, 0, params.tmax, 900);
    } catch {
      return null;
    }
  }, [odeParsed, odeSolved, params.tmax, params.ics, view]);

  const anaPts = useMemo(() => {
    if (!odeSolved || !odeSolved.ok || !odeSim || !odeSolved.full.evalT) return [];
    const stride = Math.max(1, Math.floor(odeSim.t.length / 80));
    const out: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < odeSim.t.length; i += stride) {
      const v = (odeSolved.full.evalT as (t: number) => number)(odeSim.t[i]);
      if (Number.isFinite(v)) out.push({ x: odeSim.t[i], y: v });
    }
    return out;
  }, [odeSolved, odeSim]);

  const anaDiff = useMemo(() => {
    if (!odeSolved || !odeSolved.ok || !odeSim || !odeSolved.full.evalT) return null;
    let m = 0;
    for (let i = 0; i < odeSim.t.length; i++) {
      const a = (odeSolved.full.evalT as (t: number) => number)(odeSim.t[i]);
      if (Number.isFinite(a)) m = Math.max(m, Math.abs(a - odeSim.y[i]));
    }
    return m;
  }, [odeSolved, odeSim]);

  /* ================= C. 差分方程 ================= */

  const deParsed = useMemo(() => parseDiffEq(params.de), [params.de]);
  const deSolved = useMemo(() => {
    if (!deParsed.ok || view !== 'diffeq') return null;
    return solveDiffEq(deParsed.a, deParsed.rhsItems, params.dics);
  }, [deParsed, params.dics, view]);

  const deRecur = useMemo(() => {
    if (!deParsed.ok || view !== 'diffeq') return null;
    const xFn = (m: number): number => xNumeric(deParsed.rhsItems as ZItem[], m);
    try {
      return recurDiff(deParsed.a, params.dics, xFn, params.N);
    } catch {
      return null;
    }
  }, [deParsed, params.dics, params.N, view]);

  const deAnaPts = useMemo(() => {
    if (!deSolved || !deSolved.ok || !deRecur || !deSolved.full.evalN) return [];
    const out: Array<{ x: number; y: number }> = [];
    for (let n = 1; n < deRecur.length; n++) {
      const v = (deSolved.full.evalN as (n: number) => number)(n);
      if (Number.isFinite(v)) out.push({ x: n, y: v });
    }
    return out;
  }, [deSolved, deRecur]);

  /* ================= D. 数据与滤波 ================= */

  const dataParsed = useMemo(() => (view === 'data' ? parseDataSeq(params.raw) : null), [params.raw, view]);
  const dataView = useMemo(() => {
    if (!dataParsed || !dataParsed.ok || !dataParsed.values.length) return null;
    const x = dataParsed.values;
    let filt: number[];
    if (params.filt === 'ma5') {
      const L = Math.max(3, Math.round(params.maLen) | 1);
      filt = convSame(
        x,
        Array.from({ length: L }, () => 1 / L),
      );
    } else if (params.filt === 'diff') filt = convSame(x, [1, -1]);
    else if (params.filt === 'iir1') filt = convSame(x, [1]); // 占位，下面用递推覆盖
    else filt = x.slice();
    if (params.filt === 'iir1') {
      const a = params.alpha;
      let prev = 0;
      filt = x.map((v) => {
        prev = (1 - a) * prev + a * v;
        return prev;
      });
    }
    const dt = dataParsed.dt ?? 1;
    const sp = spectrum(filt, dt);
    let peak = 0;
    let peakF = 0;
    for (let i = 0; i < sp.mag.length; i++) {
      if (sp.mag[i] > peak) {
        peak = sp.mag[i];
        peakF = sp.f[i];
      }
    }
    let mean = 0;
    for (const v of x) mean += v;
    mean /= x.length;
    let vr = 0;
    let mx = -Infinity;
    let mn = Infinity;
    for (const v of x) {
      vr += (v - mean) * (v - mean);
      mx = Math.max(mx, v);
      mn = Math.min(mn, v);
    }
    const idx = x.map((_, i) => i);
    const t = dataParsed.t ?? idx;
    return {
      idx,
      t,
      x,
      filt,
      twoCol: !!dataParsed.t,
      Fs: dataParsed.Fs,
      dt,
      sp,
      peak,
      peakF,
      mean,
      std: Math.sqrt(vr / x.length),
      mx,
      mn,
    };
  }, [dataParsed, params.filt, params.maLen, params.alpha]);

  /* ================= E. 符号变换 ================= */

  const sigMode = useMemo<'cont' | 'disc' | null>(() => {
    if (params.sigKind !== 'auto') return params.sigKind;
    const cont = parseTimeCombo(params.sig);
    const disc = parseZCombo(params.sig);
    if (disc && !cont) return 'disc';
    if (cont && !disc) return 'cont';
    return disc ? 'disc' : cont ? 'cont' : null;
  }, [params.sig, params.sigKind]);

  const sym = useMemo(() => {
    if (view !== 'sym') return null;
    if (sigMode === 'disc') {
      const items = parseZCombo(params.sig);
      if (!items) return null;
      return { kind: 'disc' as const, lines: zOfItems(items) };
    }
    const items = parseTimeCombo(params.sig);
    if (!items) return null;
    return { kind: 'cont' as const, lap: laplaceOfItems(items), four: fourierOfItems(items) };
  }, [params.sig, sigMode, view]);

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
        view === 'expr'
          ? exprFn
            ? 'f(t) 已解析 · [' + nf(params.t0, 1) + ', ' + nf(params.t1, 1) + ']'
            : '表达式待解析'
          : view === 'ode'
            ? odeParsed.ok
              ? odeParsed.n + ' 阶 · ' + (odeSolved && odeSolved.ok ? odeSolved.stableText : '')
              : '方程待解析'
            : view === 'diffeq'
              ? deParsed.ok
                ? deParsed.n + ' 阶 · ' + (deSolved && deSolved.ok ? deSolved.stableText : '')
                : '方程待解析'
              : view === 'data'
                ? dataParsed && dataParsed.ok
                  ? dataParsed.values.length + ' 点' + (dataView && dataView.twoCol ? ' · 两列（Δt=' + nf(dataView.dt, 4) + '）' : ' · 单列')
                  : '数据待解析'
                : sigMode
                  ? (sigMode === 'cont' ? '连续 f(t)' : '离散 x[n]')
                  : '信号待解析',
      metrics: () => {
        if (view === 'expr') {
          return exprData
            ? [
                { label: '最大值', value: exprData.mx, precision: 4, hint: 't=' + nf(exprData.mxT, 3) },
                { label: '最小值', value: exprData.mn, precision: 4, hint: 't=' + nf(exprData.mnT, 3) },
                { label: '积分 ∫f dt', value: exprData.integ, precision: 4 },
                { label: 'RMS', value: exprData.rms, precision: 4, hint: '零点数 ' + exprData.zeros },
              ]
            : [];
        }
        if (view === 'ode') {
          return odeSolved && odeSolved.ok
            ? [
                { label: '阶次', value: odeSolved.n, precision: 0 },
                { label: '稳定性', value: odeSolved.stableText, tone: /不稳定/.test(odeSolved.stableText) ? 'danger' : /临界/.test(odeSolved.stableText) ? 'warn' : 'ok' },
                { label: '解析 vs 仿真 max|Δ|', value: tiny(anaDiff), tone: anaDiff != null && anaDiff < 5e-3 ? 'ok' : 'warn', hint: 'RK4 数值 vs 拉氏解析' },
                { label: '终值 y(tmax)', value: odeSolved.full.evalT ? odeSolved.full.evalT(params.tmax) : '—', precision: 4 },
              ]
            : [];
        }
        if (view === 'diffeq') {
          return deSolved && deSolved.ok
            ? [
                { label: '阶次', value: deSolved.n, precision: 0 },
                { label: '稳定性', value: deSolved.stableText, tone: /不稳定/.test(deSolved.stableText) ? 'danger' : /临界/.test(deSolved.stableText) ? 'warn' : 'ok' },
                { label: '末拍 y[N]', value: deRecur ? deRecur[deRecur.length - 1] : '—', precision: 4, hint: `N=${params.N} 递推末值` },
                { label: '极点最大模', value: deSolved.poles.reduce((m, p) => Math.max(m, Math.hypot(p.re, p.im)), 0), precision: 4 },
              ]
            : [];
        }
        if (view === 'data') {
          return dataView
            ? [
                { label: '点数', value: dataView.x.length, precision: 0 },
                { label: '均值 / 标准差', value: nf(dataView.mean, 4) + ' / ' + nf(dataView.std, 4) },
                { label: '峰峰值', value: dataView.mx - dataView.mn, precision: 4 },
                { label: '主频', value: dataView.peakF, unit: 'Hz', precision: 4, hint: dataView.twoCol ? '由 Δt 归一化' : '单列按 fs=1' },
              ]
            : [];
        }
        if (sym && sym.kind === 'disc') {
          return [
            { label: '类型', value: '离散 x[n]' },
            { label: 'ROC', value: sym.lines.rocTex.replace('\\text{ROC}: ', '').replace('|z|>', '|z| > '), hint: '收敛域' },
          ];
        }
        if (sym && sym.kind === 'cont') {
          return [
            { label: '类型', value: '连续 f(t)' },
            { label: 'ROC', value: 'Re(s) > ' + nf(sym.lap.right, 2) },
            { label: '频谱含冲激', value: sym.four.imp ? '是（含 δ）' : '否' },
          ];
        }
        return [];
      },
      exports: () => [
        {
          id: 'csv',
          label: 'CSV',
          disabled: !((view === 'expr' && !!exprData) || (view === 'data' && !!dataView)),
          reason: '当前视图无数据表（方程视图请用 JSON）',
          run: () => {
            if (view === 'expr' && exprData) {
              const rows = ['t,f(t)'];
              for (let i = 0; i < exprData.t.length; i++) rows.push(`${exprData.t[i].toPrecision(6)},${exprData.y[i].toPrecision(6)}`);
              downloadText('solve-expression.csv', rows.join('\n'));
            } else if (view === 'data' && dataView) {
              const rows = ['index,t,x,filt'];
              for (let i = 0; i < dataView.x.length; i++) rows.push(`${i},${dataView.t[i]},${dataView.x[i]},${dataView.filt[i]}`);
              downloadText('solve-data.csv', rows.join('\n'));
            }
          },
        },
        { id: 'json', label: 'JSON', run: () => downloadText('solve-experiment.json', JSON.stringify(params, null, 2)) },
      ],
    });
    return () => props.api(null);
  }, [params, view, exprFn, exprData, odeParsed, odeSolved, anaDiff, deParsed, deSolved, deRecur, dataParsed, dataView, sym, sigMode]);

  /* ================= 渲染 ================= */

  const icCount = odeParsed.ok ? odeParsed.n : 0;
  const dicCount = deParsed.ok ? deParsed.n : 0;

  const setIc = (i: number, v: number, live = false): void => {
    const ics = params.ics.slice();
    ics[i] = v;
    if (live) applyLive({ ics });
    else apply({ ics });
  };
  const setDic = (i: number, v: number, live = false): void => {
    const dics = params.dics.slice();
    dics[i] = v;
    if (live) applyLive({ dics });
    else apply({ dics });
  };

  return (
    <>
      {props.leftOpen ? (
        <aside class="ws-left">
          <FieldGroup title="视图">
            <SegmentedChips options={VIEWS} value={view} onChange={(v) => apply({ view: v })} ariaLabel="视图" />
            <p class="muted">{VIEW_HINTS[view]}</p>
          </FieldGroup>

          {view === 'expr' ? (
            <FieldGroup title="表达式 f(t)" onReset={() => apply({ expr: DEFAULT.expr, t0: DEFAULT.t0, t1: DEFAULT.t1 })}>
              <ExprField
                label="f(t)"
                value={params.expr}
                onChange={(v) => apply({ expr: v })}
                status={exprFn ? 'ok' : 'err'}
                message={exprFn ? '已解析' : '无法解析：请检查写法'}
                hint="支持 sin/cos/exp/sqrt/abs/u/rect/tri/sinc、pi、e、隐式乘法（2t、3(t+1)）"
              />
              <div class="row">
                <VoiceInput onResult={(v) => apply({ expr: v })} label="语音输入 f(t)" />
                <span class="muted">口述示例：「sin 3 t 乘以 e 的负零点五 t」→ sin3t*e-0.5t</span>
              </div>
              <SliderField
                label="起始 t₀"
                value={params.t0}
                onChange={(v) => applyLive({ t0: Math.min(v, params.t1 - 1e-3) })}
                min={-20}
                max={20}
                step={0.1}
                precision={2}
                unit="s"
              />
              <SliderField
                label="终止 t₁"
                value={params.t1}
                onChange={(v) => applyLive({ t1: Math.max(v, params.t0 + 1e-3) })}
                min={-20}
                max={60}
                step={0.1}
                precision={2}
                unit="s"
                hint="t₁ 恒大于 t₀（互锁）"
              />
            </FieldGroup>
          ) : null}

          {view === 'ode' ? (
            <FieldGroup title="微分方程" desc="左端 y 各阶项（y、y′、y″…），右端 f(t) 线性组合。">
              <ExprField
                label="方程"
                value={params.ode}
                onChange={(v) => apply({ ode: v })}
                status={odeParsed.ok ? 'ok' : 'err'}
                message={odeParsed.ok ? '已解析（' + odeParsed.n + ' 阶）' : odeParsed.note}
                hint="示例：y'' + 3*y' + 2*y = exp(-2*t)*u(t)"
              />
              <div class="row">
                <VoiceInput onResult={(v) => apply({ ode: v })} label="语音输入方程" />
                <span class="muted">口述示例：「y 两撇 加 3 乘 y 一撇 等于 0」→ y''+3*y'=0</span>
              </div>
              {odeParsed.ok
                ? Array.from({ length: icCount }, (_, i) => (
                    <div key={i} class="row">
                      <span class="muted" style="margin:0">
                        {IC_LABELS[i] ?? 'y(' + i + ')(0)'}
                      </span>
                      <NumField value={params.ics[i] ?? 0} onChange={(v) => setIc(i, v)} precision={3} step={0.1} width={72} ariaLabel={IC_LABELS[i] ?? '初值'} />
                    </div>
                  ))
                : null}
              <SliderField label="仿真时长 tmax" value={params.tmax} onChange={(v) => applyLive({ tmax: v })} min={0.5} max={60} step={0.5} precision={1} unit="s" />
            </FieldGroup>
          ) : null}

          {view === 'diffeq' ? (
            <FieldGroup title="差分方程" desc="左端 y[n+k] 各项，右端 x[n] 序列（u(n)、a^n、n…）。">
              <ExprField
                label="方程"
                value={params.de}
                onChange={(v) => apply({ de: v })}
                status={deParsed.ok ? 'ok' : 'err'}
                message={deParsed.ok ? '已解析（' + deParsed.n + ' 阶）' : deParsed.note}
                hint="示例：y[n+2] - 1.5*y[n+1] + 0.5*y[n] = u(n)"
              />
              <div class="row">
                <VoiceInput onResult={(v) => apply({ de: v })} label="语音输入方程" />
                <span class="muted">口述示例：「y n 加 2 减 一点五 乘 y n 加 1 等于 0」</span>
              </div>
              {deParsed.ok
                ? Array.from({ length: dicCount }, (_, i) => (
                    <div key={i} class="row">
                      <span class="muted" style="margin:0">
                        y[{i}]
                      </span>
                      <NumField value={params.dics[i] ?? 0} onChange={(v) => setDic(i, v)} precision={3} step={0.1} width={72} ariaLabel={'初值 y[' + i + ']'} />
                    </div>
                  ))
                : null}
              <SliderField label="递推长度 N" value={params.N} onChange={(v) => applyLive({ N: Math.round(v) })} min={4} max={200} step={1} precision={0} />
            </FieldGroup>
          ) : null}

          {view === 'data' ? (
            <FieldGroup title="数据" desc="单列数值（任意分隔）或两列 t y（时间均匀递增）。">
              <textarea
                class="c-area"
                rows={6}
                spellcheck={false}
                aria-label="数据输入"
                value={params.raw}
                onInput={(e) => apply({ raw: (e.currentTarget as HTMLTextAreaElement).value })}
              />
              {dataParsed ? (
                <StatusBadge kind={dataParsed.ok ? 'ok' : 'err'}>
                  {dataParsed.ok ? '已解析 ' + dataParsed.values.length + ' 点' : dataParsed.note}
                </StatusBadge>
              ) : null}
              <SegmentedChips options={FILTS} value={params.filt} onChange={(v) => apply({ filt: v })} ariaLabel="滤波" />
              {params.filt === 'ma5' ? (
                <SliderField
                  label="滑动平均窗长"
                  value={params.maLen}
                  onChange={(v) => apply({ maLen: Math.max(3, Math.round(v) | 1) })}
                  min={3}
                  max={21}
                  step={2}
                  precision={0}
                  unit="点"
                />
              ) : null}
              {params.filt === 'iir1' ? (
                <SliderField label="IIR 系数 α" value={params.alpha} onChange={(v) => apply({ alpha: v })} min={0.01} max={1} step={0.01} precision={2} />
              ) : null}
              <p class="muted">
                差分 h=[1,−1]（一阶）；IIR 一阶低通 y[k]=(1−α)y[k−1]+α·x[k]。滤波结果与原始序列同图对照。
              </p>
            </FieldGroup>
          ) : null}

          {view === 'sym' ? (
            <FieldGroup title="信号" desc="连续：exp(-2*t)*u(t)、sin(3*t)*u(t)、t^2*u(t)；离散：0.5^n*u[n]、n*u[n]、delta[n]。">
              <ExprField
                label="信号"
                value={params.sig}
                onChange={(v) => apply({ sig: v })}
                status={sigMode ? 'ok' : 'err'}
                message={sigMode ? (sigMode === 'cont' ? '连续 f(t)' : '离散 x[n]') : '无法解析：请检查写法'}
              />
              <SegmentedChips options={SIG_KINDS} value={params.sigKind} onChange={(v) => apply({ sigKind: v })} ariaLabel="信号类型" />
            </FieldGroup>
          ) : null}
        </aside>
      ) : null}

      <section class="ws-main">
        {view === 'expr' ? (
          exprData ? (
            <div class="card stack">
              <h3>f(t) 曲线（{nf(params.t0, 2)} – {nf(params.t1, 2)} s · 1200 点）</h3>
              <Chart
                series={[{ xs: exprData.t, ys: exprData.y, glow: 2.5 }]}
                xRange={[params.t0, params.t1]}
                yRange={yRangeOf(exprData.y)}
                height={300}
                xLabel="t (s)"
                yLabel="f(t)"
              />
              <div class="row">
                <Metric label="最大值" value={exprData.mx} precision={4} />
                <Metric label="最小值" value={exprData.mn} precision={4} />
                <Metric label="积分" value={exprData.integ} precision={4} />
                <Metric label="均值" value={exprData.mean} precision={4} />
                <Metric label="RMS" value={exprData.rms} precision={4} />
                <Metric label="零点数" value={exprData.zeros} precision={0} />
              </div>
            </div>
          ) : (
            <div class="card stack">
              <StatusBadge kind="err">表达式无法解析</StatusBadge>
              <p class="muted">支持函数：sin/cos/tan/exp/ln/sqrt/abs/sign/pow/u/rect/tri/sinc；常量 pi/e/tau；隐式乘法 2t、3(t+1)、2pi。</p>
            </div>
          )
        ) : null}

        {view === 'ode' ? (
          <>
            {odeSolved && odeSolved.ok ? (
              <>
                <div class="card stack">
                  <h3>全解 y(t)（曲线 = RK4 仿真 · 点 = 拉氏解析）</h3>
                  {odeSim ? (
                    <Chart
                      series={[{ xs: odeSim.t, ys: odeSim.y, glow: 2.5 }]}
                      markers={anaPts.map((p) => ({ x: p.x, y: p.y, kind: 'point' as const, color: '#A15C06', size: 3 }))}
                      xRange={[0, params.tmax]}
                      yRange={yRangeOf(odeSim.y)}
                      height={260}
                      xLabel="t (s)"
                      yLabel="y(t)"
                    />
                  ) : (
                    <p class="muted">仿真不可用（含冲激等奇异右端时以解析为准）。</p>
                  )}
                  <div class="row">
                    <Metric label="解析 vs 仿真 max|Δ|" value={tiny(anaDiff)} tone={anaDiff != null && anaDiff < 5e-3 ? 'ok' : 'warn'} />
                    <Metric label="阶次" value={odeSolved.n} precision={0} />
                    <Metric label="稳定性" value={odeSolved.stableText} tone={/不稳定/.test(odeSolved.stableText) ? 'danger' : 'ok'} />
                    <Metric label="极点" value={odeSolved.poles.map((p) => nf(p.re, 3) + (Math.abs(p.im) > 1e-9 ? (p.im > 0 ? '+' : '−') + nf(Math.abs(p.im), 3) + 'j' : '')).join('，')} />
                  </div>
                  {odeSolved.note ? <p class="muted">{odeSolved.note}</p> : null}
                </div>
                <div class="card stack">
                  <h3>解析解（零输入 + 零状态 = 全解）</h3>
                  <div class="formula-block">
                    <div class="tex-line">
                      <TeX tex={odeSolved.zi.tex ?? ''} />
                    </div>
                    <div class="tex-line">
                      <TeX tex={odeSolved.zs.tex ?? ''} />
                    </div>
                    <div class="tex-line">
                      <TeX tex={odeSolved.full.tex ?? ''} />
                    </div>
                  </div>
                  <p class="muted">左式为解析解（拉氏变换 + 留数法反变换），与右侧数值仿真逐点互验。</p>
                </div>
              </>
            ) : (
              <div class="card stack">
                <StatusBadge kind="err">方程无法求解</StatusBadge>
                <p class="muted">{odeParsed.ok ? (odeSolved && !odeSolved.ok ? odeSolved.note : '等待求解') : odeParsed.note}</p>
              </div>
            )}
          </>
        ) : null}

        {view === 'diffeq' ? (
          <>
            {deSolved && deSolved.ok && deRecur ? (
              <>
                <div class="card stack">
                  <h3>序列 y[n]（点 = 逐拍递推 · 线 = z 域解析）</h3>
                  <Chart
                    series={[{ xs: deRecur.map((_, i) => i), ys: deRecur, glow: 2.5 }]}
                    markers={deAnaPts.map((p) => ({ x: p.x, y: p.y, kind: 'point' as const, color: '#A15C06', size: 3 }))}
                    xRange={[0, deRecur.length - 1]}
                    yRange={yRangeOf(deRecur)}
                    height={260}
                    xLabel="n"
                    yLabel="y[n]"
                  />
                  <div class="row">
                    <Metric label="阶次" value={deSolved.n} precision={0} />
                    <Metric label="稳定性" value={deSolved.stableText} tone={/不稳定/.test(deSolved.stableText) ? 'danger' : 'ok'} />
                    <Metric label="末拍 y[N]" value={deRecur[deRecur.length - 1]} precision={4} />
                    <Metric label="极点最大模" value={deSolved.poles.reduce((m, p) => Math.max(m, Math.hypot(p.re, p.im)), 0)} precision={4} />
                  </div>
                  {deSolved.note ? <p class="muted">{deSolved.note}</p> : null}
                </div>
                <div class="card stack">
                  <h3>解析解（零输入 + 零状态 = 全解）</h3>
                  <div class="formula-block">
                    <div class="tex-line">
                      <TeX tex={deSolved.zi.tex ?? ''} />
                    </div>
                    <div class="tex-line">
                      <TeX tex={deSolved.zs.tex ?? ''} />
                    </div>
                    <div class="tex-line">
                      <TeX tex={deSolved.full.tex ?? ''} />
                    </div>
                  </div>
                  <p class="muted">解析式 n ≥ 1 有效（δ 项与 n=0 点由递推给出）；与逐拍递推互验。</p>
                </div>
              </>
            ) : (
              <div class="card stack">
                <StatusBadge kind="err">方程无法求解</StatusBadge>
                <p class="muted">{deParsed.ok ? (deSolved && !deSolved.ok ? deSolved.note : '等待求解') : deParsed.note}</p>
              </div>
            )}
          </>
        ) : null}

        {view === 'data' ? (
          dataView ? (
            <>
              <div class="card stack">
                <h3>数据序列（{dataView.x.length} 点{dataView.twoCol ? ' · 两列 t y' : ' · 单列（下标为 n）'}）</h3>
                <Chart
                  series={[
                    { xs: dataView.idx, ys: dataView.x, width: 1.8, alpha: params.filt === 'none' ? 1 : 0.5 },
                    ...(params.filt !== 'none' ? [{ xs: dataView.idx, ys: dataView.filt, width: 2.2, glow: 2, color: 'var(--series-2)' }] : []),
                  ]}
                  xRange={[0, dataView.x.length - 1]}
                  yRange={yRangeOf([...dataView.x, ...(params.filt !== 'none' ? dataView.filt : [])])}
                  height={280}
                  xLabel={dataView.twoCol ? '样本序号（t 见 CSV）' : 'n'}
                  yLabel="x"
                />
                <div class="row">
                  <Metric label="点数" value={dataView.x.length} precision={0} />
                  <Metric label="均值" value={dataView.mean} precision={4} />
                  <Metric label="标准差" value={dataView.std} precision={4} />
                  <Metric label="最大 / 最小" value={nf(dataView.mx, 4) + ' / ' + nf(dataView.mn, 4)} />
                  {dataView.twoCol ? <Metric label="采样率 fs" value={dataView.Fs ?? 1 / dataView.dt} unit="Hz" precision={4} hint={'Δt=' + nf(dataView.dt, 4)} /> : null}
                </div>
              </div>
              <div class="card stack">
                <h3>幅度谱（{params.filt === 'none' ? '原始数据' : '滤波后'}）</h3>
                <Chart
                  series={[{ xs: dataView.sp.f, ys: dataView.sp.mag, fill: 'rgba(107,79,216,.12)', fillAlpha: 1, width: 2, color: 'var(--series-3)' }]}
                  xRange={[0, dataView.sp.f[dataView.sp.f.length - 1]]}
                  yRange={[0, Math.max(...dataView.sp.mag) * 1.15 || 1]}
                  height={200}
                  xLabel="f (Hz)"
                  yLabel="|X|"
                />
                <p class="muted">谱峰位置 {nf(dataView.peakF, 4)} Hz（单列格式按 fs = 1 归一化）。</p>
              </div>
            </>
          ) : (
            <div class="card stack">
              <StatusBadge kind="err">数据无法解析</StatusBadge>
              <p class="muted">{dataParsed && !dataParsed.ok ? dataParsed.note + (dataParsed.badToken ? '（问题片段：' + dataParsed.badToken + '）' : '') : '请粘贴数据。'}</p>
            </div>
          )
        ) : null}

        {view === 'sym' ? (
          sym ? (
            <>
              <div class="card stack">
                <h3>变换对（{sym.kind === 'cont' ? '连续时间' : '离散序列'}）</h3>
                <div class="formula-block">
                  {sym.kind === 'cont' ? (
                    <>
                      <div class="tex-line">
                        <TeX tex={sym.lap.fLine} />
                      </div>
                      <div class="tex-line">
                        <TeX tex={sym.lap.fsLine} />
                      </div>
                      <div class="tex-line">
                        <TeX tex={sym.lap.rocTex} />
                      </div>
                      <div class="tex-line">
                        <TeX tex={sym.four.tex} />
                      </div>
                    </>
                  ) : (
                    <>
                      <div class="tex-line">
                        <TeX tex={sym.lines.xLine} />
                      </div>
                      <div class="tex-line">
                        <TeX tex={sym.lines.zLine} />
                      </div>
                      <div class="tex-line">
                        <TeX tex={sym.lines.rocTex} />
                      </div>
                    </>
                  )}
                </div>
                <p class="muted">连续侧同时给出 ℒ 与 ℱ（含 δ 冲激项标注）；离散侧给 𝒵 与 ROC。</p>
              </div>
            </>
          ) : (
            <div class="card stack">
              <StatusBadge kind="err">信号无法解析</StatusBadge>
              <p class="muted">连续示例：exp(-2*t)*u(t) + sin(3*t)*u(t)；离散示例：0.8^n*u[n]、n*u[n]、delta[n]。</p>
            </div>
          )
        ) : null}
      </section>

      {props.rightOpen ? (
        <aside class="ws-right">
          <div class="card stack">
            <h4 class="card-h">速查</h4>
            {view === 'ode' ? (
              <>
                <p class="muted" style="margin-top:0">
                  解析：L⁽ⁿ⁾ 展开 → 拉氏变换 → Y(s) = (F(s) + P(s)) / (D(s)·A(s)) → 留数法反变换；数值：四阶 Runge–Kutta（900 步）。
                </p>
                <p class="muted">初值不足时按 0 补（提示见结果卡）。</p>
              </>
            ) : view === 'diffeq' ? (
              <>
                <p class="muted" style="margin-top:0">
                  解析：z 变换 → Y(z) = (X(z) + Q(z)) / (D(z)·A(z)) → 部分分式；数值：逐拍递推 y[m+n] = (x[m] − Σ a_k y[m+k])/a_n。
                </p>
                <p class="muted">极点全在单位圆内 → 收敛（稳定）。</p>
              </>
            ) : view === 'data' ? (
              <p class="muted" style="margin-top:0">
                两列格式要求时间严格递增且等间隔（偏差 ≤1%）；非均匀数据请改单列或先重采样。
              </p>
            ) : view === 'sym' ? (
              <p class="muted" style="margin-top:0">
                连续信号给 ℒ/ℱ 闭式（含冲激项标注），离散序列给 𝒵 变换与 ROC。
              </p>
            ) : (
              <p class="muted" style="margin-top:0">
                f(t) 按内置解析器求值（零外部依赖、离线可用）；关键指标按 1200 点采样计算。
              </p>
            )}
          </div>
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