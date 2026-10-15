import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Chart } from '../../chart/Chart';
import { ComplexPlane, type CPMarker } from '../../chart/ComplexPlane';
import { FieldGroup, Metric, NumField, SegmentedChips, SliderField, StatePanel, StatusBadge } from '../../ui/components';
import { TeX } from '../../ui/TeX';
import {
  designFIR,
  designIIR,
  estimateOrder,
  filterPoles,
  firFreqz,
  freqz,
  polyRoots,
  polyTex,
  quantizeCoef,
  type BandKind,
  type IirFamily,
  type Spec,
  type WindowType,
} from '../../core';
import { createUndoStack } from '../../state/undo';
import { getModuleState, setModuleState } from '../../state/experiments';
import { navigate } from '../../router';
import { useExperimentSync } from '../useSync';
import type { ToolViewProps } from '../api';

/**
 * 滤波器设计器（filter）— M2 新工具
 * 规格 → 设计：IIR（Butterworth / Chebyshev I / Chebyshev II + 双线性变换，已预畸变）
 *                FIR（窗函数法，线性相位）。
 * 视图：幅频·相频·群时延 / 零极点·稳定性 / 系数量化对比 / 脉冲·阶跃响应 / FIR 窗函数。
 * 内核：core/filterdesign.ts；正确性由 parity.mjs 闭式真值钉死（−Rp 边缘 / −Rs 边缘 / 直流 0 dB 等）。
 */

type ViewId = 'mag' | 'zp' | 'quant' | 'time' | 'fir';
type Kind = 'iir' | 'fir';

interface FilterParams {
  kind: Kind;
  family: IirFamily;
  band: BandKind;
  fp: number;
  fstop: number;
  Rp: number;
  Rs: number;
  fsamp: number;
  bits: number;
  firN: number;
  firFc: number;
  firWin: WindowType;
  view: ViewId;
}

const DEFAULT: FilterParams = {
  kind: 'iir',
  family: 'butter',
  band: 'lp',
  fp: 1000,
  fstop: 2000,
  Rp: 1,
  Rs: 40,
  fsamp: 8000,
  bits: 12,
  firN: 41,
  firFc: 1000,
  firWin: 'hamming',
  view: 'mag',
};

const VIEWS: ReadonlyArray<{ value: ViewId; label: string }> = [
  { value: 'mag', label: '幅频·相频' },
  { value: 'zp', label: '零极点' },
  { value: 'quant', label: '量化对比' },
  { value: 'time', label: '时域响应' },
  { value: 'fir', label: 'FIR 窗函数' },
];

const KINDS: ReadonlyArray<{ value: Kind; label: string }> = [
  { value: 'iir', label: 'IIR' },
  { value: 'fir', label: 'FIR' },
];

const FAMILIES: ReadonlyArray<{ value: IirFamily; label: string }> = [
  { value: 'butter', label: 'Butterworth' },
  { value: 'cheby1', label: 'Chebyshev I' },
  { value: 'cheby2', label: 'Chebyshev II' },
];

const BANDS: ReadonlyArray<{ value: BandKind; label: string }> = [
  { value: 'lp', label: '低通' },
  { value: 'hp', label: '高通' },
];

const WINDOWS: ReadonlyArray<{ value: WindowType; label: string }> = [
  { value: 'rect', label: '矩形' },
  { value: 'hamming', label: 'Hamming' },
  { value: 'hanning', label: 'Hanning' },
  { value: 'blackman', label: 'Blackman' },
];

function sanitize(raw: unknown): FilterParams {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<FilterParams>;
  const views: ViewId[] = ['mag', 'zp', 'quant', 'time', 'fir'];
  const fams: IirFamily[] = ['butter', 'cheby1', 'cheby2'];
  const bands: BandKind[] = ['lp', 'hp'];
  const wins: WindowType[] = ['rect', 'hamming', 'hanning', 'blackman'];
  const num = (v: unknown, d: number, lo: number, hi: number): number =>
    Number.isFinite(v) ? Math.max(lo, Math.min(hi, v as number)) : d;
  return {
    kind: r.kind === 'fir' ? 'fir' : 'iir',
    family: fams.includes(r.family as IirFamily) ? (r.family as IirFamily) : DEFAULT.family,
    band: bands.includes(r.band as BandKind) ? (r.band as BandKind) : DEFAULT.band,
    fp: num(r.fp, DEFAULT.fp, 1, 1e6),
    fstop: num(r.fstop, DEFAULT.fstop, 1, 1e6),
    Rp: num(r.Rp, DEFAULT.Rp, 0.01, 12),
    Rs: num(r.Rs, DEFAULT.Rs, 1, 160),
    fsamp: num(r.fsamp, DEFAULT.fsamp, 10, 1e7),
    bits: Math.round(num(r.bits, DEFAULT.bits, 4, 32)),
    firN: Math.round(num(r.firN, DEFAULT.firN, 3, 401)),
    firFc: num(r.firFc, DEFAULT.firFc, 1, 1e6),
    firWin: wins.includes(r.firWin as WindowType) ? (r.firWin as WindowType) : DEFAULT.firWin,
    view: views.includes(r.view as ViewId) ? (r.view as ViewId) : DEFAULT.view,
  };
}

/** 数字滤波器时域响应（差分方程；num/den 为 z 正幂次降序 → 分子补零到同阶后按 b/a 递推） */
function filterResponse(num: number[], den: number[], kind: 'impulse' | 'step', N: number): number[] {
  const n = den.length - 1;
  const b = num.slice();
  while (b.length < n + 1) b.unshift(0);
  const a0 = den[0] || 1;
  const x = new Array<number>(N).fill(kind === 'impulse' ? 0 : 1);
  if (kind === 'impulse') x[0] = 1;
  const y = new Array<number>(N).fill(0);
  for (let k = 0; k < N; k++) {
    let acc = 0;
    for (let j = 0; j <= n; j++) if (k - j >= 0) acc += b[j] * x[k - j];
    for (let j = 1; j <= n; j++) if (k - j >= 0) acc -= den[j] * y[k - j];
    y[k] = acc / a0;
  }
  return y;
}

/** 样本序列 → 谱线（stem）折线：每样本 [i,0]→[i,h] 竖线 + 点标记 */
function stem(h: number[]): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  h.forEach((v, i) => {
    xs.push(i, i);
    ys.push(0, v);
  });
  return { xs, ys };
}

/** 系数 → 纯文本表达式片段（供「交接系统分析」，parseTF 可解析，显式 * 与 ^） */
function coefsToExpr(c: number[], vn: string): string {
  const parts: string[] = [];
  for (let i = 0; i < c.length; i++) {
    const a = c[i];
    if (Math.abs(a) < 1e-12) continue;
    const pow = c.length - 1 - i;
    const mag = Math.abs(a).toPrecision(8);
    const term = pow === 0 ? mag : pow === 1 ? `${mag}*${vn}` : `${mag}*${vn}^${pow}`;
    parts.push((a < 0 ? '-' : parts.length ? '+' : '') + term);
  }
  return parts.length ? parts.join('') : '0';
}

function download(name: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FilterTool(props: ToolViewProps) {
  const [params, setParams] = useState<FilterParams>(() => sanitize(getModuleState<FilterParams>('filter', DEFAULT)));
  const undoRef = useRef(createUndoStack<FilterParams>(40));
  const lastPush = useRef(0);

  useEffect(() => {
    setModuleState('filter', params);
  }, [params]);

  useExperimentSync('filter',
    () => sanitize(getModuleState<FilterParams>('filter', DEFAULT)),
    (v) => {
      setParams(v);
      undoRef.current.clear();
    },
  );

  const apply = (next: Partial<FilterParams>): void => {
    const now = Date.now();
    if (now - lastPush.current > 500) {
      undoRef.current.push(params);
      lastPush.current = now;
    }
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };
  const applyLive = (next: Partial<FilterParams>): void => {
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };

  const spec: Spec = useMemo(
    () => ({
      family: params.family,
      band: params.band,
      fp: params.fp,
      fstop: params.fstop,
      Rp: params.Rp,
      Rs: params.Rs,
      fsamp: params.fsamp,
    }),
    [params.family, params.band, params.fp, params.fstop, params.Rp, params.Rs, params.fsamp],
  );

  const est = useMemo(() => estimateOrder(spec), [spec]);
  const design = useMemo(() => designIIR(spec), [spec]);
  const fr = useMemo(() => (design.ok ? freqz(design.num, design.den, 512) : null), [design]);
  const poles = useMemo(() => (design.ok ? filterPoles(design.den) : []), [design]);
  const aPoles = useMemo(() => (design.ok ? polyRoots(design.analog.den) : []), [design]);
  const aZeros = useMemo(() => (design.ok ? polyRoots(design.analog.num) : []), [design]);

  // 系数量化对比
  const q = useMemo(() => {
    if (!design.ok) return null;
    const qn = quantizeCoef(design.num, params.bits);
    const qd = quantizeCoef(design.den, params.bits);
    return { num: qn, den: qd, fr: freqz(qn, qd, 512) };
  }, [design, params.bits]);

  // FIR
  const fir = useMemo(() => designFIR(params.band, params.firN, params.firFc, params.firWin, params.fsamp), [
    params.band,
    params.firN,
    params.firFc,
    params.firWin,
    params.fsamp,
  ]);
  const firFr = useMemo(() => (fir.ok ? firFreqz(fir.h, 512) : null), [fir]);
  const firWinCompare = useMemo(() => {
    if (params.view !== 'fir' || params.kind !== 'fir') return null;
    return WINDOWS.map((w) => {
      const r = designFIR(params.band, params.firN, params.firFc, w.value, params.fsamp);
      return r.ok ? { label: w.label, fr: firFreqz(r.h, 512) } : null;
    }).filter((x): x is { label: string; fr: { w: number[]; magDb: number[] } } => x != null);
  }, [params.view, params.kind, params.band, params.firN, params.firFc, params.fsamp]);

  const fs = params.fsamp;
  const toHz = (w: number): number => (w * fs) / (2 * Math.PI);

  const iir = params.kind === 'iir';
  const okLine = iir
    ? design.ok
      ? design.note
      : '规格无效：' + design.note
    : fir.ok
      ? fir.note
      : '规格无效：' + fir.note;
  const viewOpts = iir
    ? VIEWS.filter((v) => v.value !== 'fir')
    : VIEWS.filter((v) => v.value === 'mag' || v.value === 'time' || v.value === 'fir');
  const applyKind = (k: Kind): void => {
    const allowed = k === 'iir' ? ['mag', 'zp', 'quant', 'time'] : ['mag', 'time', 'fir'];
    apply({ kind: k, view: allowed.includes(params.view) ? params.view : 'mag' });
  };

  const rhoMax = poles.reduce((m, p) => Math.max(m, Math.hypot(p.re, p.im)), 0);
  const stable = poles.length > 0 && rhoMax < 1 - 1e-9;

  const magAt = (f: number): number | null => {
    if (!fr) return null;
    const w = (2 * Math.PI * f) / fs;
    if (!(w >= 0) || !(w <= Math.PI)) return null;
    const idx = Math.round((w / Math.PI) * 512);
    return fr.magDb[Math.max(0, Math.min(512, idx))];
  };

  const markers: CPMarker[] = useMemo(
    () => [
      ...poles.map((p) => ({ re: p.re, im: p.im, kind: 'pole' as const })),
      ...(design.ok && design.num.length > 1
        ? polyRoots(design.num).map((z) => ({ re: z.re, im: z.im, kind: 'zero' as const }))
        : []),
    ],
    [poles, design],
  );

  const timeResp = useMemo(() => {
    if (!design.ok || params.view !== 'time') return null;
    const N = 60;
    const imp = filterResponse(design.num, design.den, 'impulse', N);
    const stp = filterResponse(design.num, design.den, 'step', N);
    const n: number[] = [];
    for (let k = 0; k < N; k++) n.push(k);
    return { n, imp, stp };
  }, [design, params.view]);

  useEffect(() => {
    const liveMeg = iir && fr ? magAt(params.fp) : null;
    const stopMag = iir && fr ? magAt(params.fstop) : null;
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
        iir
          ? `${FAMILIES.find((f) => f.value === params.family)?.label} ${params.band === 'lp' ? '低通' : '高通'} · n=${
              design.ok ? design.n : '—'
            } · fs=${fs}Hz`
          : `FIR ${params.band === 'lp' ? '低通' : '高通'} · N=${params.firN} · ${params.firWin} 窗`,
      metrics: () =>
        iir && design.ok
          ? [
              { label: '阶数 n', value: design.n, tone: 'default' as const },
              {
                label: '通带边缘 @fp',
                value: liveMeg != null ? liveMeg : '—',
                unit: 'dB',
                precision: 2,
                tone: liveMeg != null && liveMeg >= -params.Rp - 0.3 ? ('ok' as const) : ('warn' as const),
              },
              {
                label: '阻带边缘 @fs',
                value: stopMag != null ? stopMag : '—',
                unit: 'dB',
                precision: 2,
                tone: stopMag != null && stopMag <= -params.Rs + 0.3 ? ('ok' as const) : ('warn' as const),
              },
              {
                label: '极点最大模 ρmax',
                value: rhoMax,
                precision: 4,
                tone: stable ? ('ok' as const) : ('danger' as const),
              },
            ]
          : fir.ok
            ? [
                { label: '抽头数 N', value: fir.n },
                { label: '线性相位群时延', value: (fir.n - 1) / 2, unit: '样本', precision: 1 },
                { label: '直流增益 Σh', value: fir.h.reduce((s, v) => s + v, 0), precision: 3 },
              ]
            : [],
      exports: () =>
        iir
          ? [
              {
                id: 'handoff',
                label: '交接系统分析',
                disabled: !design.ok,
                reason: design.ok ? undefined : '当前规格无法设计',
                run: () => {
                  if (!design.ok) return;
                  const num = coefsToExpr(design.analog.num, 's');
                  const den = coefsToExpr(design.analog.den, 's');
                  setModuleState('sys', { expr: `(${num})/(${den})`, K: 1, view: 'bode' });
                  navigate({ page: 'tool', toolId: 'sys' });
                },
              },
              {
                id: 'csv',
                label: '系数 CSV',
                disabled: !design.ok,
                reason: design.ok ? undefined : '当前规格无法设计',
                run: () => {
                  if (!design.ok) return;
                  const rows = ['b/a,' + Array.from({ length: Math.max(design.num.length, design.den.length) }, (_, i) => i).join(',')];
                  const pad = (c: number[]) => {
                    const a = c.slice();
                    while (a.length < Math.max(design.num.length, design.den.length)) a.unshift(0);
                    return a;
                  };
                  rows.push('b,' + pad(design.num).map((v) => v.toPrecision(10)).join(','));
                  rows.push('a,' + pad(design.den).map((v) => v.toPrecision(10)).join(','));
                  download('filter-coefficients.csv', rows.join('\n'), 'text/csv');
                },
              },
              {
                id: 'json',
                label: '设计 JSON',
                disabled: !design.ok,
                reason: design.ok ? undefined : '当前规格无法设计',
                run: () => {
                  if (!design.ok) return;
                  download(
                    'filter-design.json',
                    JSON.stringify({ spec, ...design }, null, 2),
                    'application/json',
                  );
                },
              },
            ]
          : fir.ok
            ? [
                {
                  id: 'csv',
                  label: '冲激响应 CSV',
                  run: () => {
                    download(
                      'fir-impulse.csv',
                      ['n,h[n]', ...fir.h.map((v, i) => `${i},${v.toPrecision(10)}`)].join('\n'),
                      'text/csv',
                    );
                  },
                },
              ]
            : [],
    });
    return () => props.api(null);
    // eslint-disable-next-line
  }, [params, design, fir, fr, rhoMax, stable, iir]);

  return (
    <>
      {props.leftOpen ? (
        <aside class="ws-left">
          <FieldGroup title="设计类型">
            <SegmentedChips options={KINDS} value={params.kind} onChange={(v) => applyKind(v)} ariaLabel="设计类型" />
            <SegmentedChips options={BANDS} value={params.band} onChange={(v) => apply({ band: v })} ariaLabel="通带类型" />
          </FieldGroup>

          {iir ? (
            <FieldGroup title="原型与规格" desc="经典 IIR 原型 + 双线性变换（已频率预畸变）；阶数由规格自动估计。">
              <SegmentedChips options={FAMILIES} value={params.family} onChange={(v) => apply({ family: v })} ariaLabel="原型" />
              <div class="row">
                <NumField value={params.fp} onChange={(v) => apply({ fp: v })} min={1} max={1e6} step={10} precision={1} unit="Hz" ariaLabel="通带边界频率" width={72} />
                <NumField value={params.fstop} onChange={(v) => apply({ fstop: v })} min={1} max={1e6} step={10} precision={1} unit="Hz" ariaLabel="阻带边界频率" width={72} />
                <NumField value={params.fsamp} onChange={(v) => apply({ fsamp: v })} min={10} max={1e7} step={100} precision={0} unit="Hz" ariaLabel="采样率" width={72} />
              </div>
              <p class="muted">
                通带边界 {params.fp}Hz · 阻带边界 {params.fstop}Hz · 采样率 {params.fsamp}Hz
              </p>
              {params.family !== 'butter' ? (
                <div class="row">
                  {params.family === 'cheby1' ? (
                    <NumField value={params.Rp} onChange={(v) => apply({ Rp: v })} min={0.01} max={12} step={0.1} precision={2} unit="dB" ariaLabel="通带波纹" />
                  ) : null}
                  <NumField value={params.Rs} onChange={(v) => apply({ Rs: v })} min={1} max={160} step={1} precision={1} unit="dB" ariaLabel="阻带衰减" />
                </div>
              ) : null}
              <p class="muted">{"ok" in est ? est.note : `规格无效：${est.note}`}</p>
            </FieldGroup>
          ) : (
            <FieldGroup title="FIR 规格" desc="窗函数法设计线性相位 FIR；截止频率 fc 为 −6dB 附近过渡带中心。">
              <div class="row">
                <NumField value={params.firN} onChange={(v) => apply({ firN: Math.round(v) })} min={3} max={401} step={2} precision={0} unit="抽头" ariaLabel="抽头数" width={72} />
                <NumField value={params.firFc} onChange={(v) => apply({ firFc: v })} min={1} max={1e6} step={10} precision={1} unit="Hz" ariaLabel="截止频率" width={72} />
              </div>
              <SegmentedChips options={WINDOWS} value={params.firWin} onChange={(v) => apply({ firWin: v })} ariaLabel="窗函数" />
              <p class="muted">
                {WINDOWS.find((w) => w.value === params.firWin)?.label} 窗 · 群时延 (N−1)/2 = {(params.firN - 1) / 2} 样本
              </p>
            </FieldGroup>
          )}

          <FieldGroup title="视图" onReset={() => apply(DEFAULT)} defaultOpen={false}>
            <SegmentedChips options={viewOpts} value={params.view} onChange={(v) => apply({ view: v })} ariaLabel="视图" />
            {params.view === 'quant' ? (
              <SliderField label="系数字长" value={params.bits} onChange={(v) => applyLive({ bits: Math.round(v) })} min={4} max={24} step={1} precision={0} unit="bit" />
            ) : null}
          </FieldGroup>
        </aside>
      ) : null}

      <section class="ws-main">
        {iir && !design.ok ? (
          <StatePanel
            kind="error"
            title="无法按当前规格设计"
            desc={design.note + '（请检查通带/阻带边界顺序与采样率，低通要求 fstop > fp，高通要求 fstop < fp）'}
            action={{ label: '恢复默认规格', onClick: () => apply(DEFAULT) }}
          />
        ) : null}
        {!iir && !fir.ok ? (
          <StatePanel kind="error" title="FIR 规格无效" desc={fir.note} action={{ label: '恢复默认规格', onClick: () => apply(DEFAULT) }} />
        ) : null}

        {/* 幅频 · 相频 · 群时延 */}
        {iir && design.ok && fr && params.view === 'mag' ? (
          <div class="card stack">
            <h3>幅频响应 |H(e^jω)|（dB）· 规格掩膜 @ fp={params.fp}Hz / fstop={params.fstop}Hz</h3>
            <Chart
              series={[
                { xs: fr.w.map(toHz), ys: fr.magDb, glow: 2 },
                { xs: [0, params.band === 'lp' ? params.fp : fs / 2], ys: [-params.Rp, -params.Rp], color: 'var(--series-4)', dash: [5, 4], width: 1.4 },
                {
                  xs: params.band === 'lp' ? [params.fstop, fs / 2] : [0, params.fstop],
                  ys: [-params.Rs, -params.Rs],
                  color: 'var(--series-4)',
                  dash: [5, 4],
                  width: 1.4,
                },
              ]}
              markers={[
                { x: params.fp, y: magAt(params.fp) ?? 0, kind: 'point', color: 'var(--series-2)', focus: true },
                { x: params.fstop, y: magAt(params.fstop) ?? 0, kind: 'point', color: 'var(--series-2)', focus: true },
              ]}
              xRange={[0, fs / 2]}
              yRange={[Math.min(-80, ...fr.magDb) - 4, Math.max(6, ...fr.magDb.slice(0, 8)) + 4]}
              height={260}
              xLabel="频率 (Hz)"
              yLabel="幅值 (dB)"
            />
            <div class="grid2">
              <Chart
                series={[{ xs: fr.w.map(toHz), ys: fr.phase.map((p) => (180 / Math.PI) * p), color: 'var(--series-3)' }]}
                xRange={[0, fs / 2]}
                yRange={[Math.min(-361, ...fr.phase.map((p) => (180 / Math.PI) * p)), Math.max(10, ...fr.phase.map((p) => (180 / Math.PI) * p))]}
                height={190}
                xLabel="频率 (Hz)"
                yLabel="相位 (°)"
              />
              <Chart
                series={[{ xs: fr.w.map(toHz), ys: fr.group, color: 'var(--series-5)' }]}
                xRange={[0, fs / 2]}
                yRange={[0, Math.max(2, ...fr.group.slice(0, 300)) * 1.15]}
                height={190}
                xLabel="频率 (Hz)"
                yLabel="群时延 (样本)"
              />
            </div>
          </div>
        ) : null}

        {/* FIR 频响（fir 视图） */}
        {!iir && fir.ok && firFr && params.view === 'fir' ? (
          <div class="card stack">
            <h3>FIR 冲激响应 h[n]（{fir.n} 抽头 · {WINDOWS.find((w) => w.value === params.firWin)?.label} 窗，线性相位）</h3>
            <Chart
              series={[{ ...stem(fir.h), glow: 2 }]}
              markers={fir.h.map((v, i) => ({ x: i, y: v, kind: 'point' as const }))}
              xRange={[0, fir.n - 1]}
              yRange={[Math.min(0, ...fir.h) * 1.2, Math.max(0.01, ...fir.h) * 1.2]}
              height={220}
              xLabel="n"
              yLabel="h[n]"
            />
            <p class="muted">对称中心 n=(N−1)/2={(fir.n - 1) / 2}；h[n] 关于中心偶对称 ⇒ 严格线性相位。</p>
          </div>
        ) : null}

        {!iir && fir.ok && firFr && params.view === 'mag' ? (
          <div class="card stack">
            <h3>FIR 幅频响应（{fir.n} 抽头 · fc={params.firFc}Hz）</h3>
            <Chart
              series={[{ xs: firFr.w.map(toHz), ys: firFr.magDb, glow: 2 }]}
              xRange={[0, fs / 2]}
              yRange={[Math.min(-80, ...firFr.magDb) - 4, Math.max(6, ...firFr.magDb.slice(0, 8)) + 4]}
              height={250}
              xLabel="频率 (Hz)"
              yLabel="幅值 (dB)"
            />
          </div>
        ) : null}

        {/* 零极点 · 稳定性 */}
        {iir && design.ok && params.view === 'zp' ? (
          <div class="grid2">
            <div class="card stack">
              <h3>数字滤波器零极点（z 平面）</h3>
              <ComplexPlane markers={markers} mode="unit" height={300} halfW={1.6} fitKey={`${params.family}-${params.band}-${design.n}`} />
              <div class="row">
                <StatusBadge kind={stable ? 'ok' : 'err'}>{stable ? '稳定（极点均在单位圆内）' : '不稳定（含圆外极点）'}</StatusBadge>
                <Metric label="ρmax" value={rhoMax} precision={4} />
                <Metric label="1−ρmax" value={1 - rhoMax} precision={4} />
              </div>
              <p class="muted">极点由分母系数求根（core.filterPoles）；零点 {markers.filter((m) => m.kind === 'zero').length} 个。</p>
            </div>
            <div class="card stack">
              <h3>模拟原型零极点（s 平面 · 预畸变域）</h3>
              <ComplexPlane
                markers={[
                  ...aPoles.map((p) => ({ re: p.re, im: p.im, kind: 'pole' as const })),
                  ...aZeros.map((z) => ({ re: z.re, im: z.im, kind: 'zero' as const })),
                ]}
                mode="jw"
                height={300}
                halfW={Math.max(1.5, ...aPoles.map((p) => Math.abs(p.re)), ...aZeros.map((z) => Math.abs(z.im))) * 1.3}
                fitKey={`a-${params.family}-${design.n}`}
              />
              <p class="muted">Butterworth 极点均匀分布在左半平面圆上；Chebyshev I 分布在椭圆上；Chebyshev II 另有虚轴零点。</p>
            </div>
          </div>
        ) : null}

        {/* 量化对比 */}
        {iir && design.ok && fr && q && params.view === 'quant' ? (
          <div class="card stack">
            <h3>系数量化对比（{params.bits} bit 定点）</h3>
            <Chart
              series={[
                { xs: fr.w.map(toHz), ys: fr.magDb, color: 'var(--series-1)', width: 2 },
                { xs: q.fr.w.map(toHz), ys: q.fr.magDb, color: 'var(--series-4)', dash: [4, 3], width: 1.6 },
              ]}
              xRange={[0, fs / 2]}
              yRange={[Math.min(-80, ...fr.magDb, ...q.fr.magDb) - 4, 6]}
              height={250}
              xLabel="频率 (Hz)"
              yLabel="幅值 (dB)"
            />
            <p class="muted">
              实线 = 无限精度；虚线 = {params.bits} bit 量化。误差 ={' '}
              {Math.max(...fr.magDb.map((v, i) => Math.abs(v - q.fr.magDb[i]))).toFixed(4)} dB（最大）。
            </p>
            <div class="grid2">
              <div class="card stack">
                <h3>量化后 b</h3>
                <textarea class="c-area" readOnly value={`[${q.num.map((v) => v.toPrecision(6)).join(', ')}]`} />
              </div>
              <div class="card stack">
                <h3>量化后 a</h3>
                <textarea class="c-area" readOnly value={`[${q.den.map((v) => v.toPrecision(6)).join(', ')}]`} />
              </div>
            </div>
          </div>
        ) : null}

        {/* 时域响应 */}
        {iir && design.ok && timeResp && params.view === 'time' ? (
          <div class="grid2">
            <div class="card stack">
              <h3>脉冲响应 h[n]</h3>
              <Chart
                series={[{ xs: timeResp.n, ys: timeResp.imp, glow: 2 }]}
                xRange={[0, timeResp.n.length - 1]}
                yRange={[Math.min(0, ...timeResp.imp) * 1.15, Math.max(0.01, ...timeResp.imp) * 1.15]}
                height={240}
                xLabel="n"
                yLabel="h[n]"
              />
            </div>
            <div class="card stack">
              <h3>阶跃响应 y[n]</h3>
              <Chart
                series={[{ xs: timeResp.n, ys: timeResp.stp, color: 'var(--series-2)', glow: 2 }]}
                xRange={[0, timeResp.n.length - 1]}
                yRange={[Math.min(0, ...timeResp.stp) * 1.15, Math.max(0.01, ...timeResp.stp) * 1.15]}
                height={240}
                xLabel="n"
                yLabel="y[n]"
              />
            </div>
          </div>
        ) : null}

        {/* FIR 窗函数（fir 视图） */}
        {!iir && fir.ok && firFr && params.view === 'fir' && firWinCompare ? (
          <div class="card stack">
            <h3>窗函数对比（同一 N={params.firN}、fc={params.firFc}Hz）</h3>
            <Chart
              series={firWinCompare.map((c, i) => ({
                xs: c.fr.w.map(toHz),
                ys: c.fr.magDb,
                color: `var(--series-${i + 1})`,
                width: i === WINDOWS.findIndex((w) => w.value === params.firWin) ? 2.2 : 1.3,
              }))}
              xRange={[0, fs / 2]}
              yRange={[Math.min(-100, ...firWinCompare.flatMap((c) => c.fr.magDb)) - 4, 6]}
              height={260}
              xLabel="频率 (Hz)"
              yLabel="幅值 (dB)"
            />
            <p class="muted">
              图例顺序：{firWinCompare.map((c) => c.label).join(' / ')}。窗函数以主瓣宽度换取旁瓣抑制（矩形窗主瓣最窄、旁瓣最高）。
            </p>
          </div>
        ) : null}

        {/* FIR 时域 */}
        {!iir && fir.ok && params.view === 'time' ? (
          <div class="card stack">
            <h3>FIR 冲激响应 h[n]（{fir.n} 抽头）</h3>
            <Chart
              series={[{ ...stem(fir.h), color: 'var(--series-2)', glow: 2 }]}
              markers={fir.h.map((v, i) => ({ x: i, y: v, kind: 'point' as const, size: 2 }))}
              xRange={[0, fir.n - 1]}
              yRange={[Math.min(0, ...fir.h) * 1.2, Math.max(0.01, ...fir.h) * 1.2]}
              height={260}
              xLabel="n"
              yLabel="h[n]"
            />
          </div>
        ) : null}
      </section>

      {props.rightOpen ? (
        <aside class="ws-right">
          <div class="card stack">
            <h3>设计摘要</h3>
            <p class="muted">{okLine}</p>
            {iir && design.ok ? (
              <>
                <Metric label="阶数 n" value={design.n} />
                <Metric label="数字截止 ωc" value={design.wc} precision={4} unit="rad" />
                <Metric label="通带边缘实测" value={magAt(params.fp) ?? '—'} precision={2} unit="dB" />
                <Metric label="阻带边缘实测" value={magAt(params.fstop) ?? '—'} precision={2} unit="dB" />
              </>
            ) : null}
            {!iir && fir.ok ? (
              <>
                <Metric label="抽头数 N" value={fir.n} />
                <Metric label="直流增益" value={fir.h.reduce((s, v) => s + v, 0)} precision={4} />
                <Metric label="群时延" value={(fir.n - 1) / 2} precision={1} unit="样本" />
              </>
            ) : null}
          </div>

          {iir && design.ok ? (
            <div class="card stack">
              <h3>数字传函 H(z)</h3>
              <div class="formula-block">
                <TeX tex={`H(z)=\\dfrac{${polyTex(design.num, 'z')}}{${polyTex(design.den, 'z')}}`} />
              </div>
              <p class="muted">系数（b / a，z 正幂次降序）：</p>
              <textarea class="c-area" readOnly value={`b = [${design.num.map((v) => v.toPrecision(8)).join(', ')}]\na = [${design.den.map((v) => v.toPrecision(8)).join(', ')}]`} />
            </div>
          ) : null}

          {iir && design.ok ? (
            <div class="card stack">
              <h3>模拟原型 H(s)</h3>
              <div class="formula-block">
                <TeX tex={`H(s)=\\dfrac{${polyTex(design.analog.num, 's')}}{${polyTex(design.analog.den, 's')}}`} />
              </div>
              <p class="muted">预畸变域 Ω=tan(ω/2)；可经「交接系统分析」进入系统分析工具查看波特图 / 根轨迹。</p>
            </div>
          ) : null}

          {!iir && fir.ok ? (
            <div class="card stack">
              <h3>冲激响应 h[n]</h3>
              <textarea class="c-area" readOnly value={fir.h.map((v) => v.toPrecision(8)).join(', ')} />
            </div>
          ) : null}
        </aside>
      ) : null}
    </>
  );
}
