import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Chart } from '../../chart/Chart';
import { FieldGroup, Metric, NumField, SegmentedChips, SliderField, StatusBadge } from '../../ui/components';
import { TeX } from '../../ui/TeX';
import {
  amModulate,
  dsbSc,
  envelope,
  eyeTraces,
  fft,
  fmModulate,
  ifft,
  mulberry32,
  sampleHold,
  shapeNRZ,
  sineWave,
  sincReconstruct,
  spectrum,
} from '../../core';
import { createUndoStack } from '../../state/undo';
import { getModuleState, setModuleState } from '../../state/experiments';
import { useExperimentSync } from '../useSync';
import type { ToolViewProps } from '../api';

/**
 * 调制与通信实验室（comm）— M2 新工具
 * AM（调制度）/ DSB-SC / FM（瞬时频率 · Carson 带宽）；采样定理（欠采样混叠 · sinc 重建）；
 * 基带 NRZ + 升余弦成形 + 眼图雏形（眼高测量）。
 * 内核：core/comm.ts；正确性由 parity.mjs 闭式真值钉死（AM 边带比 / DSB 载波抑制 / FM 瞬时频率 / sinc 插值恒等）。
 */

type ViewId = 'am' | 'fm' | 'sample' | 'eye';

interface CommParams {
  view: ViewId;
  fs: number;
  fc: number;
  fm: number;
  m: number;
  kf: number;
  f0: number;
  fsamp: number;
  nsamp: number;
  bitsSeed: number;
  bitsN: number;
  sps: number;
  alpha: number;
}

const DEFAULT: CommParams = {
  view: 'am',
  fs: 4000,
  fc: 400,
  fm: 40,
  m: 0.8,
  kf: 1000,
  f0: 60,
  fsamp: 200,
  nsamp: 16,
  bitsSeed: 11,
  bitsN: 48,
  sps: 16,
  alpha: 0.35,
};

const VIEWS: ReadonlyArray<{ value: ViewId; label: string }> = [
  { value: 'am', label: 'AM / DSB' },
  { value: 'fm', label: '调频 FM' },
  { value: 'sample', label: '采样定理' },
  { value: 'eye', label: '眼图' },
];

function sanitize(raw: unknown): CommParams {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<CommParams>;
  const views: ViewId[] = ['am', 'fm', 'sample', 'eye'];
  const num = (v: unknown, d: number, lo: number, hi: number): number =>
    Number.isFinite(v) ? Math.max(lo, Math.min(hi, v as number)) : d;
  return {
    view: views.includes(r.view as ViewId) ? (r.view as ViewId) : DEFAULT.view,
    fs: num(r.fs, DEFAULT.fs, 100, 1e6),
    fc: num(r.fc, DEFAULT.fc, 1, 1e6),
    fm: num(r.fm, DEFAULT.fm, 0.1, 1e4),
    m: num(r.m, DEFAULT.m, 0, 2),
    kf: num(r.kf, DEFAULT.kf, 0, 1e5),
    f0: num(r.f0, DEFAULT.f0, 0.1, 1e4),
    fsamp: num(r.fsamp, DEFAULT.fsamp, 0.5, 1e5),
    nsamp: Math.round(num(r.nsamp, DEFAULT.nsamp, 4, 256)),
    bitsSeed: Math.round(num(r.bitsSeed, DEFAULT.bitsSeed, 0, 1e9)),
    bitsN: Math.round(num(r.bitsN, DEFAULT.bitsN, 4, 400)),
    sps: Math.round(num(r.sps, DEFAULT.sps, 2, 64)),
    alpha: num(r.alpha, DEFAULT.alpha, 0, 1),
  };
}

/** 解析信号法瞬时频率（Hz）：正频分量 ×2 → 解析信号 → 相位解卷绕 → 差分 */
function instFreq(sig: number[], fs: number): number[] {
  const N = sig.length;
  let n = 1;
  while (n < N) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < N; i++) re[i] = sig[i];
  fft(re, im);
  for (let k = 1; k < n / 2; k++) {
    re[k] *= 2;
    im[k] *= 2;
  }
  for (let k = n / 2 + 1; k < n; k++) {
    re[k] = 0;
    im[k] = 0;
  }
  const z = ifft(re, im);
  const ph: number[] = [];
  let unw = 0;
  let prev = 0;
  for (let i = 0; i < N; i++) {
    const p = Math.atan2(z.im[i], z.re[i]);
    let d = p - prev;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    unw += d;
    prev = p;
    ph.push(unw);
  }
  const f: number[] = [];
  for (let i = 0; i < N - 1; i++) f.push((ph[i + 1] - ph[i]) / (2 * Math.PI / fs));
  f.push(f[f.length - 1] ?? 0);
  return f;
}

export function CommTool(props: ToolViewProps) {
  const [params, setParams] = useState<CommParams>(() => sanitize(getModuleState<CommParams>('comm', DEFAULT)));
  const undoRef = useRef(createUndoStack<CommParams>(40));
  const lastPush = useRef(0);

  useEffect(() => {
    setModuleState('comm', params);
  }, [params]);

  useExperimentSync('comm',
    () => sanitize(getModuleState<CommParams>('comm', DEFAULT)),
    (v) => {
      setParams(v);
      undoRef.current.clear();
    },
  );

  const apply = (next: Partial<CommParams>): void => {
    const now = Date.now();
    if (now - lastPush.current > 500) {
      undoRef.current.push(params);
      lastPush.current = now;
    }
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };
  const applyLive = (next: Partial<CommParams>): void => {
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };

  const N = 2048;
  const dt = 1 / params.fs;
  const t = useMemo(() => Array.from({ length: N }, (_, i) => i * dt), [dt]);
  /** 时域显示窗口：至少覆盖 3 个消息周期与 20 个载波周期，且不超过数据长度 */
  const tWin = Math.min(t.length ? t[t.length - 1] : 0.15, 0.15, Math.max(3 / params.fm, 20 / params.fc));

  const msg = useMemo(() => sineWave(N, params.fm, params.fs, 1), [N, params.fm, params.fs]);

  // AM / DSB 视图
  const amData = useMemo(() => {
    if (params.view !== 'am') return null;
    const am = amModulate(msg, params.fc, params.fs, params.m);
    const dsb = dsbSc(msg, params.fc, params.fs);
    const env = envelope(am);
    return { am, dsb, env, specAm: spectrum(am, dt), specDsb: spectrum(dsb, dt) };
  }, [params.view, msg, params.fc, params.fs, params.m, dt]);

  // FM 视图
  const fmData = useMemo(() => {
    if (params.view !== 'fm') return null;
    const x = fmModulate(msg, params.fc, params.fs, params.kf);
    const fi = instFreq(x, params.fs);
    const expected = msg.map((v) => params.fc + params.kf * v);
    const deltaF = params.kf; // 峰值频偏（msg 幅值 1）
    const carson = 2 * (deltaF + params.fm);
    let maxDev = 0;
    for (let i = 0; i < fi.length; i++) maxDev = Math.max(maxDev, Math.abs(fi[i] - expected[i]));
    return { x, fi, expected, spec: spectrum(x, dt), deltaF, carson, maxDev };
  }, [params.view, msg, params.fc, params.fs, params.kf, params.fm, dt]);

  // 采样定理视图
  const sampleData = useMemo(() => {
    if (params.view !== 'sample') return null;
    const Ttotal = 0.25;
    const M = 2000;
    const dense = Array.from({ length: M }, (_, i) => Math.sin(2 * Math.PI * params.f0 * (i * (Ttotal / M))));
    const td = Array.from({ length: M }, (_, i) => i * (Ttotal / M));
    const ns = params.nsamp;
    const xs = Array.from({ length: ns }, (_, k) => Math.sin((2 * Math.PI * params.f0 * k) / params.fsamp));
    const ts = Array.from({ length: ns }, (_, k) => k / params.fsamp);
    // 零阶保持：每个样点保持 1/fsamp 秒 → 稠密栅格上的重复次数 = 1/(fsamp·stepDt)
    const stepDt = Ttotal / M;
    const holdFactor = Math.max(1, Math.round(1 / (params.fsamp * stepDt)));
    const held = sampleHold(xs, holdFactor).held;
    const heldT = held.map((_, i) => i * stepDt);
    const rec = sincReconstruct(xs, params.fsamp, td);
    let worst = 0;
    for (let i = 0; i < M; i++) worst = Math.max(worst, Math.abs(rec[i] - dense[i]));
    const nyq = params.fsamp / 2;
    const alias = Math.abs(((params.f0 + nyq) % params.fsamp) - nyq); // 折叠频率
    return { dense, td, xs, ts, held, heldT, rec, worst, nyq, alias, ratio: params.fsamp / params.f0 };
  }, [params.view, params.f0, params.fsamp, params.nsamp]);

  // 眼图视图
  const eyeData = useMemo(() => {
    if (params.view !== 'eye') return null;
    const rnd = mulberry32(params.bitsSeed);
    const bits = Array.from({ length: params.bitsN }, () => (rnd() > 0.5 ? 1 : 0));
    const span = 2;
    const stream = shapeNRZ(bits, params.sps, span, params.alpha, 1);
    // 轨迹数随符号数增长（上限 64，避免过度绘制）
    const traces = eyeTraces(stream, params.sps, span, Math.max(8, Math.min(64, params.bitsN)));
    // 眼高：判决时刻 x=span/2 处各轨迹插值值，眼高 = min(正) − max(负)
    const x0 = span / 2;
    const vals: number[] = [];
    for (const tr of traces) {
      for (let i = 0; i < tr.xs.length - 1; i++) {
        if (tr.xs[i] <= x0 && tr.xs[i + 1] >= x0) {
          const w = (x0 - tr.xs[i]) / (tr.xs[i + 1] - tr.xs[i] || 1);
          vals.push(tr.ys[i] + w * (tr.ys[i + 1] - tr.ys[i]));
          break;
        }
      }
    }
    const pos = vals.filter((v) => v > 0);
    const neg = vals.filter((v) => v < 0);
    const eyeH = pos.length && neg.length ? Math.min(...pos) - Math.max(...neg) : 0;
    return { bits, stream, traces, eyeH, span, x0 };
  }, [params.view, params.bitsSeed, params.bitsN, params.sps, params.alpha]);

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
        `${VIEWS.find((v) => v.value === params.view)?.label} · ${params.view === 'sample' ? `fs=${params.fsamp}Hz / f₀=${params.f0}Hz` : `fc=${params.fc}Hz · fs=${params.fs}Hz`}`,
      metrics: () =>
        params.view === 'am' && amData
          ? [
              { label: '调制度 m', value: params.m, precision: 2, tone: params.m <= 1 ? 'ok' : 'warn', hint: 'm>1 为过调幅' },
              { label: '载波频率 fc', value: params.fc, precision: 0, unit: 'Hz' },
              { label: '边带位置', value: `${params.fc - params.fm} / ${params.fc + params.fm}`, unit: 'Hz' },
              { label: 'AM 带宽', value: 2 * params.fm, precision: 0, unit: 'Hz' },
            ]
          : params.view === 'fm' && fmData
            ? [
                { label: '峰值频偏 Δf', value: fmData.deltaF, precision: 0, unit: 'Hz' },
                { label: '调制指数 β', value: fmData.deltaF / params.fm, precision: 2 },
                { label: 'Carson 带宽', value: fmData.carson, precision: 0, unit: 'Hz' },
              ]
            : params.view === 'sample' && sampleData
              ? [
                  { label: 'fs / f₀', value: sampleData.ratio, precision: 2, tone: sampleData.ratio > 2 ? 'ok' : 'danger', hint: '需 > 2 才不混叠' },
                  { label: 'Nyquist', value: sampleData.nyq, precision: 1, unit: 'Hz' },
                  { label: '混叠频率', value: sampleData.alias, precision: 2, unit: 'Hz' },
                ]
              : params.view === 'eye' && eyeData
                ? [
                    { label: '眼高', value: eyeData.eyeH, precision: 3 },
                    { label: '符号数', value: params.bitsN },
                    { label: '滚降 α', value: params.alpha, precision: 2 },
                  ]
                : [],
      exports: () => [
        {
          id: 'csv',
          label: '波形 CSV',
          disabled: !(params.view === 'am' ? amData?.am : params.view === 'fm' ? fmData?.x : null),
          reason: '当前视图无时域波形（采样 / 眼图视图请用 JSON）',
          run: () => {
            const rows = ['t,x'];
            const arr = params.view === 'am' ? amData?.am : params.view === 'fm' ? fmData?.x : null;
            if (!arr) return;
            for (let i = 0; i < arr.length; i++) rows.push(`${t[i].toPrecision(6)},${arr[i].toPrecision(10)}`);
            const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'comm-waveform.csv';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          },
        },
      ],
    });
    return () => props.api(null);
    // eslint-disable-next-line
  }, [params, amData, fmData, sampleData, eyeData, t]);

  return (
    <>
      {props.leftOpen ? (
        <aside class="ws-left">
          <FieldGroup title="视图" onReset={() => apply(DEFAULT)}>
            <SegmentedChips options={VIEWS} value={params.view} onChange={(v) => apply({ view: v })} ariaLabel="视图" />
          </FieldGroup>

          {params.view === 'am' || params.view === 'fm' ? (
            <FieldGroup title="载波与调制参数">
              <div class="row">
                <span class="muted">采样率 fs</span>
                <NumField value={params.fs} onChange={(v) => apply({ fs: v })} min={100} max={1e6} step={100} precision={0} unit="Hz" ariaLabel="仿真采样率" width={72} />
              </div>
              <div class="row">
                <span class="muted">载波 fc</span>
                <NumField value={params.fc} onChange={(v) => apply({ fc: v })} min={1} max={1e6} step={10} precision={0} unit="Hz" ariaLabel="载波频率" width={72} />
              </div>
              <SliderField label="消息频率 f_m" value={params.fm} onChange={(v) => applyLive({ fm: v })} min={1} max={Math.max(2, params.fc / 3)} step={1} precision={0} unit="Hz" />
              {params.view === 'am' ? (
                <SliderField label="调制度 m" value={params.m} onChange={(v) => applyLive({ m: v })} min={0} max={2} step={0.02} precision={2} />
              ) : (
                <SliderField label="频偏系数 k_f" value={params.kf} onChange={(v) => applyLive({ kf: v })} min={0} max={5000} step={10} precision={0} unit="Hz" />
              )}
              <p class="muted">
                {params.view === 'am'
                  ? params.m > 1 ? '过调幅：包络出现反相折叠（不可包络检波）。' : '常规调幅：包络与原消息成正比。'
                  : `调制指数 β=${(params.kf / params.fm).toFixed(2)}；Carson 带宽 ≈ 2(Δf+f_m)。`}
              </p>
            </FieldGroup>
          ) : null}

          {params.view === 'sample' ? (
            <FieldGroup title="采样定理参数" desc="对单音正弦采样：fs > 2f₀ 时不混叠；sinc 重建恢复带限信号。">
              <div class="row">
                <span class="muted">信号 f₀</span>
                <NumField value={params.f0} onChange={(v) => apply({ f0: v })} min={0.1} max={1e4} step={1} precision={1} unit="Hz" ariaLabel="信号频率" width={72} />
              </div>
              <div class="row">
                <span class="muted">采样率 fs</span>
                <NumField value={params.fsamp} onChange={(v) => apply({ fsamp: v })} min={0.5} max={1e5} step={5} precision={1} unit="Hz" ariaLabel="采样率" width={72} />
              </div>
              <div class="row">
                <span class="muted">采样点 N</span>
                <NumField value={params.nsamp} onChange={(v) => apply({ nsamp: Math.round(v) })} min={4} max={256} step={1} precision={0} unit="点" ariaLabel="采样点数" width={64} />
              </div>
            </FieldGroup>
          ) : null}

          {params.view === 'eye' ? (
            <FieldGroup title="基带与成形">
              <div class="row">
                <span class="muted">符号数</span>
                <NumField value={params.bitsN} onChange={(v) => apply({ bitsN: Math.round(v) })} min={8} max={400} step={4} precision={0} unit="符号" ariaLabel="符号数" width={70} />
              </div>
              <div class="row">
                <span class="muted">码流种子</span>
                <NumField value={params.bitsSeed} onChange={(v) => apply({ bitsSeed: Math.round(v) })} min={0} max={1e9} step={1} precision={0} ariaLabel="码流种子" width={70} />
              </div>
              <SliderField label="每符号样点 sps" value={params.sps} onChange={(v) => apply({ sps: Math.round(v) })} min={4} max={64} step={1} precision={0} />
              <SliderField label="滚降系数 α" value={params.alpha} onChange={(v) => applyLive({ alpha: v })} min={0} max={1} step={0.01} precision={2} />
              <div class="row">
                <button class="btn" onClick={() => apply({ bitsSeed: Math.floor(Math.random() * 1e9) })}>
                  换码流
                </button>
              </div>
            </FieldGroup>
          ) : null}
        </aside>
      ) : null}

      <section class="ws-main">
        {params.view === 'am' && amData ? (
          <div class="card stack">
            <h3>AM / DSB-SC 时域（fc={params.fc}Hz · f_m={params.fm}Hz · m={params.m}）</h3>
            <Chart
              series={[
                { xs: t, ys: amData.am, color: 'var(--series-1)', width: 1.1 },
                { xs: t, ys: amData.env, color: 'var(--series-4)', dash: [4, 3], width: 1.4 },
                { xs: t, ys: amData.env.map((v) => -v), color: 'var(--series-4)', dash: [4, 3], width: 1.4 },
              ]}
              xRange={[0, tWin]}
              yRange={[-1 - params.m, 1 + params.m]}
              height={220}
              xLabel="t (s)"
              yLabel="AM"
            />
            <Chart
              series={[{ xs: t, ys: amData.dsb, color: 'var(--series-2)', width: 1.1, glow: 1.6 }]}
              xRange={[0, tWin]}
              yRange={[-1.2, 1.2]}
              height={150}
              xLabel="t (s)"
              yLabel="DSB-SC"
            />
            <div class="grid2">
              <div class="card stack">
                <h3>AM 频谱（载波 + 双边带）</h3>
                <Chart
                  series={[{ xs: amData.specAm.f, ys: amData.specAm.mag, color: 'var(--series-1)', glow: 2 }]}
                  xRange={[0, params.fs / 2]}
                  yRange={[0, Math.max(...amData.specAm.mag) * 1.15]}
                  height={200}
                  xLabel="频率 (Hz)"
                  yLabel="幅度"
                />
                <p class="muted">载波 fc 与边带 fc±f_m；理论边带/载波幅度比 = m/2。</p>
              </div>
              <div class="card stack">
                <h3>DSB-SC 频谱（抑制载波）</h3>
                <Chart
                  series={[{ xs: amData.specDsb.f, ys: amData.specDsb.mag, color: 'var(--series-2)', glow: 2 }]}
                  xRange={[0, params.fs / 2]}
                  yRange={[0, Math.max(...amData.specDsb.mag) * 1.15]}
                  height={200}
                  xLabel="频率 (Hz)"
                  yLabel="幅度"
                />
                <p class="muted">仅剩 fc±f_m 双边带，载波被抑制（需相干解调）。</p>
              </div>
            </div>
            <div class="tex-line">
              <TeX tex={`s_{AM}(t)=[1+m\\,m(t)]\\cos(2\\pi f_c t),\\quad s_{DSB}(t)=m(t)\\cos(2\\pi f_c t)`} />
            </div>
          </div>
        ) : null}

        {params.view === 'fm' && fmData ? (
          <div class="card stack">
            <h3>调频 FM 时域与瞬时频率（fc={params.fc}Hz · Δf={fmData.deltaF}Hz · β={(fmData.deltaF / params.fm).toFixed(2)}）</h3>
            <Chart
              series={[{ xs: t, ys: fmData.x, color: 'var(--series-2)', width: 1.1, glow: 1.6 }]}
              xRange={[0, tWin]}
              yRange={[-1.1, 1.1]}
              height={180}
              xLabel="t (s)"
              yLabel="s_FM(t)"
            />
            <Chart
              series={[
                { xs: t, ys: fmData.fi, color: 'var(--series-1)', glow: 2 },
                { xs: t, ys: fmData.expected, color: 'var(--series-4)', dash: [4, 3], width: 1.4 },
              ]}
              xRange={[0, tWin]}
              yRange={[Math.min(params.fc - params.kf, 0), params.fc + params.kf + Math.abs(params.kf) * 0.15]}
              height={200}
              xLabel="t (s)"
              yLabel="瞬时频率 (Hz)"
            />
            <div class="row">
              <StatusBadge kind={fmData.maxDev < 0.05 * Math.max(1, params.kf) ? 'ok' : 'warn'}>
                瞬时频率与 fc+k_f·m(t) 的最大偏差 = {fmData.maxDev.toFixed(3)} Hz
              </StatusBadge>
              <Metric label="Carson 带宽" value={fmData.carson} precision={0} unit="Hz" />
              <Metric label="调制指数 β" value={fmData.deltaF / params.fm} precision={2} />
            </div>
            <div class="card stack">
              <h3>FM 频谱</h3>
              <Chart
                series={[{ xs: fmData.spec.f, ys: fmData.spec.mag, color: 'var(--series-3)', glow: 2 }]}
                xRange={[0, params.fs / 2]}
                yRange={[0, Math.max(...fmData.spec.mag) * 1.15]}
                height={200}
                xLabel="频率 (Hz)"
                yLabel="幅度"
              />
              <p class="muted">恒定包络、带宽随 β 增宽（Carson 规则）；谱为载波两侧无穷边带（Bessel 函数权重）。</p>
            </div>
          </div>
        ) : null}

        {params.view === 'sample' && sampleData ? (
          <div class="card stack">
            <h3>采样定理：f₀={params.f0}Hz，采样率 fs={params.fsamp}Hz（fs/f₀={sampleData.ratio.toFixed(2)}）</h3>
            <div class="row">
              <StatusBadge kind={sampleData.ratio > 2 ? 'ok' : 'err'}>
                {sampleData.ratio > 2 ? '满足采样定理（fs > 2f₀）' : '欠采样 → 混叠'}
              </StatusBadge>
              <Metric label="Nyquist 频率" value={sampleData.nyq} precision={1} unit="Hz" />
              <Metric label="混叠频率（折叠）" value={sampleData.alias} precision={2} unit="Hz" />
            </div>
            <Chart
              series={[
                { xs: sampleData.td, ys: sampleData.dense, color: 'var(--series-4)', width: 1.1, alpha: 0.8 },
                { xs: sampleData.ts, ys: sampleData.xs, color: 'var(--series-1)', width: 0, glow: 3 },
                { xs: sampleData.heldT, ys: sampleData.held, color: 'var(--series-3)', width: 1.3, dash: [4, 3] },
              ]}
              markers={sampleData.xs.map((v, i) => ({ x: sampleData.ts[i], y: v, kind: 'point' as const, color: 'var(--series-1)', size: 3 }))}
              xRange={[0, 0.25]}
              yRange={[-1.2, 1.2]}
              height={220}
              xLabel="t (s)"
              yLabel="原信号 / 采样点"
            />
            <p class="muted">灰 = 原信号 · 蓝点 = 采样点 · 紫虚线 = 零阶保持（ZOH）重建。</p>
            <Chart
              series={[
                { xs: sampleData.td, ys: sampleData.dense, color: 'var(--series-4)', width: 1, alpha: 0.6 },
                { xs: sampleData.td, ys: sampleData.rec, color: 'var(--series-2)', width: 1.4, glow: 2 },
              ]}
              xRange={[0, 0.25]}
              yRange={[-1.2, 1.2]}
              height={190}
              xLabel="t (s)"
              yLabel="sinc 重建 vs 原信号"
            />
            <p class="muted">
              带限 sinc 重建（蓝）与原信号（灰）差：max|Δ| = {sampleData.worst.toFixed(4)}（fs/f₀ 越大越精确；欠采样时重建失效）。
            </p>
          </div>
        ) : null}

        {params.view === 'eye' && eyeData ? (
          <div class="card stack">
            <h3>眼图雏形（NRZ + 升余弦成形 · sps={params.sps} · α={params.alpha.toFixed(2)}）</h3>
            <Chart
              series={eyeData.traces.map((tr) => ({ xs: tr.xs, ys: tr.ys, color: 'var(--series-1)', width: 1, alpha: 0.35 }))}
              xRange={[0, eyeData.span]}
              yRange={[-1.3, 1.3]}
              height={280}
              xLabel="符号 (symbol)"
              yLabel="y(t)"
            />
            <div class="card stack">
              <h3>成形后基带波形（前 12 符号）</h3>
              <Chart
                series={[
                  {
                    xs: eyeData.stream.slice(0, 12 * params.sps + 1).map((_, i) => i / params.sps),
                    ys: eyeData.stream.slice(0, 12 * params.sps + 1),
                    color: 'var(--series-1)',
                    glow: 2,
                  },
                ]}
                xRange={[0, 12]}
                yRange={[-1.3, 1.3]}
                height={170}
                xLabel="符号 (symbol)"
                yLabel="NRZ 成形"
              />
            </div>
            <div class="row">
              <StatusBadge kind={eyeData.eyeH > 1.2 ? 'ok' : eyeData.eyeH > 0.6 ? 'warn' : 'err'}>眼高 = {eyeData.eyeH.toFixed(3)}</StatusBadge>
              <span class="muted">
                眼高（判决时刻最小张开度）越大抗噪能力越强；α 小 → 频带窄但拖尾长、对定时抖动更敏感。
              </span>
            </div>
          </div>
        ) : null}
      </section>

      {props.rightOpen ? (
        <aside class="ws-right">
          <div class="card stack">
            <h3>参数摘要</h3>
            <p class="muted">{VIEWS.find((v) => v.value === params.view)?.label}</p>
            {params.view === 'am' ? (
              <>
                <Metric label="调制度 m" value={params.m} precision={2} />
                <Metric label="AM 带宽" value={2 * params.fm} precision={0} unit="Hz" />
              </>
            ) : null}
            {params.view === 'fm' && fmData ? (
              <>
                <Metric label="峰值频偏" value={fmData.deltaF} precision={0} unit="Hz" />
                <Metric label="Carson 带宽" value={fmData.carson} precision={0} unit="Hz" />
              </>
            ) : null}
            {params.view === 'sample' && sampleData ? (
              <>
                <Metric label="fs/f₀" value={sampleData.ratio} precision={2} />
                <Metric label="重建误差 max|Δ|" value={sampleData.worst} precision={4} />
              </>
            ) : null}
            {params.view === 'eye' && eyeData ? <Metric label="眼高" value={eyeData.eyeH} precision={3} /> : null}
          </div>
        </aside>
      ) : null}
    </>
  );
}
