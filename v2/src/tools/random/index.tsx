import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Chart } from '../../chart/Chart';
import { FieldGroup, Metric, NumField, SegmentedChips, SliderField, StatePanel, StatusBadge } from '../../ui/components';
import { TeX } from '../../ui/TeX';
import {
  autocorr,
  iir1,
  periodogram,
  sineWave,
  uniformNoise,
  welch,
  whiteNoise,
  xcorr,
  type WindowType,
} from '../../core';
import { createUndoStack } from '../../state/undo';
import { getModuleState, setModuleState } from '../../state/experiments';
import { useExperimentSync } from '../useSync';
import type { ToolViewProps } from '../api';

/**
 * 随机信号实验室（random）— M2 新工具
 * 噪声（白/均匀/正弦+噪声）· 自/互相关 · 周期图 / Welch 功率谱密度 · 线性滤波前后对比。
 * 内核：core/randomsig.ts（确定性 seed 可复现；PSD 满足 Parseval，真值钉保障）。
 */

type ViewId = 'time' | 'psd' | 'corr' | 'filter';
type Kind = 'white' | 'uniform' | 'sine';

interface RandomParams {
  kind: Kind;
  view: ViewId;
  sigma: number;
  seed: number;
  N: number;
  f0: number;
  fs: number;
  win: WindowType;
  seg: number;
  alpha: number;
  maxLag: number;
}

const DEFAULT: RandomParams = {
  kind: 'white',
  view: 'time',
  sigma: 1,
  seed: 7,
  N: 1024,
  f0: 50,
  fs: 1000,
  win: 'hamming',
  seg: 256,
  alpha: 0.1,
  maxLag: 64,
};

const VIEWS: ReadonlyArray<{ value: ViewId; label: string }> = [
  { value: 'time', label: '时域与分布' },
  { value: 'psd', label: '功率谱密度' },
  { value: 'corr', label: '相关分析' },
  { value: 'filter', label: '滤波对比' },
];

const KINDS: ReadonlyArray<{ value: Kind; label: string }> = [
  { value: 'white', label: '高斯白噪声' },
  { value: 'uniform', label: '均匀白噪声' },
  { value: 'sine', label: '正弦 + 噪声' },
];

const WINDOWS: ReadonlyArray<{ value: WindowType; label: string }> = [
  { value: 'rect', label: '矩形' },
  { value: 'hamming', label: 'Hamming' },
  { value: 'hanning', label: 'Hanning' },
  { value: 'blackman', label: 'Blackman' },
];

function sanitize(raw: unknown): RandomParams {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<RandomParams>;
  const views: ViewId[] = ['time', 'psd', 'corr', 'filter'];
  const kinds: Kind[] = ['white', 'uniform', 'sine'];
  const wins: WindowType[] = ['rect', 'hamming', 'hanning', 'blackman'];
  const num = (v: unknown, d: number, lo: number, hi: number): number =>
    Number.isFinite(v) ? Math.max(lo, Math.min(hi, v as number)) : d;
  return {
    kind: kinds.includes(r.kind as Kind) ? (r.kind as Kind) : DEFAULT.kind,
    view: views.includes(r.view as ViewId) ? (r.view as ViewId) : DEFAULT.view,
    sigma: num(r.sigma, DEFAULT.sigma, 0, 10),
    seed: Math.round(num(r.seed, DEFAULT.seed, 0, 1e9)),
    N: Math.round(num(r.N, DEFAULT.N, 64, 8192)),
    f0: num(r.f0, DEFAULT.f0, 0.1, 1e4),
    fs: num(r.fs, DEFAULT.fs, 1, 1e6),
    win: wins.includes(r.win as WindowType) ? (r.win as WindowType) : DEFAULT.win,
    seg: Math.round(num(r.seg, DEFAULT.seg, 16, 4096)),
    alpha: num(r.alpha, DEFAULT.alpha, 0.001, 1),
    maxLag: Math.round(num(r.maxLag, DEFAULT.maxLag, 1, 512)),
  };
}

/** 谱线折线：每样本 [i,0]→[i,v] */
function stem(xs: ArrayLike<number>, ys: ArrayLike<number>): { xs: number[]; ys: number[] } {
  const X: number[] = [];
  const Y: number[] = [];
  for (let i = 0; i < ys.length; i++) {
    X.push(xs[i], xs[i]);
    Y.push(0, ys[i]);
  }
  return { xs: X, ys: Y };
}

export function RandomTool(props: ToolViewProps) {
  const [params, setParams] = useState<RandomParams>(() => sanitize(getModuleState<RandomParams>('random', DEFAULT)));
  const undoRef = useRef(createUndoStack<RandomParams>(40));
  const lastPush = useRef(0);

  useEffect(() => {
    setModuleState('random', params);
  }, [params]);

  useExperimentSync('random',
    () => sanitize(getModuleState<RandomParams>('random', DEFAULT)),
    (v) => {
      setParams(v);
      undoRef.current.clear();
    },
  );

  const apply = (next: Partial<RandomParams>): void => {
    const now = Date.now();
    if (now - lastPush.current > 500) {
      undoRef.current.push(params);
      lastPush.current = now;
    }
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };
  const applyLive = (next: Partial<RandomParams>): void => {
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };

  // 信号（确定性可复现）
  const sig = useMemo(() => {
    const N = params.N;
    if (params.kind === 'uniform') return uniformNoise(N, params.sigma * Math.sqrt(3), params.seed);
    if (params.kind === 'sine') {
      const tone = sineWave(N, params.f0, params.fs, 1);
      const noise = whiteNoise(N, params.sigma, params.seed);
      return tone.map((v, i) => v + noise[i]);
    }
    return whiteNoise(N, params.sigma, params.seed);
  }, [params.kind, params.N, params.sigma, params.seed, params.f0, params.fs]);

  const stats = useMemo(() => {
    const n = sig.length || 1;
    const mean = sig.reduce((s, v) => s + v, 0) / n;
    const varr = sig.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
    const theoVar =
      params.kind === 'uniform' ? Math.pow(params.sigma, 2) : params.kind === 'white' ? Math.pow(params.sigma, 2) : 0.5 + Math.pow(params.sigma, 2);
    return { mean, std: Math.sqrt(varr), varr, theoVar };
  }, [sig, params.kind, params.sigma]);

  const t = useMemo(() => sig.map((_, i) => i / params.fs), [sig, params.fs]);

  const hist = useMemo(() => {
    if (params.view !== 'time') return null;
    const bins = 41;
    const lo = Math.min(...sig);
    const hi = Math.max(...sig);
    const w = (hi - lo) / bins || 1;
    const counts = new Array<number>(bins).fill(0);
    for (const v of sig) {
      const k = Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / w)));
      counts[k]++;
    }
    const centers = counts.map((_, i) => lo + (i + 0.5) * w);
    return { centers, counts };
  }, [sig, params.view]);

  const psd = useMemo(() => {
    if (params.view !== 'psd') return null;
    return { per: periodogram(sig, params.fs, params.win), wel: welch(sig, params.fs, params.seg, 0.5, params.win) };
  }, [sig, params.fs, params.win, params.seg, params.view]);

  const corr = useMemo(() => {
    if (params.view !== 'corr') return null;
    const ref = sineWave(sig.length, params.f0, params.fs, 1);
    return { auto: autocorr(sig, params.maxLag), cross: xcorr(sig, ref, params.maxLag) };
  }, [sig, params.maxLag, params.f0, params.fs, params.view]);

  const filt = useMemo(() => {
    if (params.view !== 'filter') return null;
    const y = iir1(sig, params.alpha);
    return {
      y,
      t: y.map((_, i) => i / params.fs),
      psdIn: periodogram(sig, params.fs, 'hamming'),
      psdOut: periodogram(y, params.fs, 'hamming'),
      autoIn: autocorr(sig, params.maxLag),
      autoOut: autocorr(y, params.maxLag),
    };
  }, [sig, params.alpha, params.fs, params.maxLag, params.view]);

  const peak = useMemo(() => {
    if (!psd) return null;
    let bi = 0;
    for (let i = 1; i < psd.per.p.length; i++) if (psd.per.p[i] > psd.per.p[bi]) bi = i;
    return psd.per.f[bi];
  }, [psd]);

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
        `${KINDS.find((k) => k.value === params.kind)?.label} · N=${params.N} · seed=${params.seed} · fs=${params.fs}Hz`,
      metrics: () => [
        { label: '均值', value: stats.mean, precision: 4 },
        { label: '标准差（实测）', value: stats.std, precision: 4, tone: Math.abs(stats.std - Math.sqrt(stats.theoVar)) < 0.15 * Math.sqrt(stats.theoVar) ? 'ok' : 'warn' },
        { label: '理论标准差', value: Math.sqrt(stats.theoVar), precision: 4 },
        ...(peak != null ? [{ label: '谱峰频率', value: peak, precision: 2, unit: 'Hz' }] : []),
      ],
      exports: () => [
        {
          id: 'csv',
          label: '信号 CSV',
          run: () => {
            const rows = ['t,x'];
            for (let i = 0; i < sig.length; i++) rows.push(`${(i / params.fs).toPrecision(6)},${sig[i].toPrecision(10)}`);
            const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'random-signal.csv';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          },
        },
      ],
    });
    return () => props.api(null);
    // eslint-disable-next-line
  }, [params, sig, stats, peak]);

  return (
    <>
      {props.leftOpen ? (
        <aside class="ws-left">
          <FieldGroup title="随机信号源" desc="确定性伪随机源（mulberry32）：给定 seed 完全可复现。">
            <SegmentedChips options={KINDS} value={params.kind} onChange={(v) => apply({ kind: v })} ariaLabel="信号类型" />
            <div class="row">
              <NumField value={params.N} onChange={(v) => apply({ N: Math.round(v) })} min={64} max={8192} step={64} precision={0} ariaLabel="样本数" width={70} />
              <NumField value={params.seed} onChange={(v) => apply({ seed: Math.round(v) })} min={0} max={1e9} step={1} precision={0} ariaLabel="随机种子" width={70} />
              <NumField value={params.fs} onChange={(v) => apply({ fs: v })} min={1} max={1e6} step={10} precision={0} unit="Hz" ariaLabel="采样率" width={70} />
            </div>
            <SliderField label="标准差 σ" value={params.sigma} onChange={(v) => applyLive({ sigma: v })} min={0} max={5} step={0.05} precision={2} />
            {params.kind === 'sine' ? (
              <SliderField label="正弦频率 f₀" value={params.f0} onChange={(v) => applyLive({ f0: v })} min={1} max={200} step={1} precision={0} unit="Hz" />
            ) : null}
            <div class="row">
              <button class="btn" onClick={() => apply({ seed: Math.floor(Math.random() * 1e9) })}>
                换一组随机数
              </button>
              <button class="btn" onClick={() => apply({ seed: DEFAULT.seed })}>
                恢复默认 seed
              </button>
            </div>
          </FieldGroup>

          <FieldGroup title="视图与参数" onReset={() => apply(DEFAULT)} defaultOpen={false}>
            <SegmentedChips options={VIEWS} value={params.view} onChange={(v) => apply({ view: v })} ariaLabel="视图" />
            {params.view === 'psd' ? (
              <>
                <SegmentedChips options={WINDOWS} value={params.win} onChange={(v) => apply({ win: v })} ariaLabel="窗函数" />
                <SliderField label="Welch 段长" value={params.seg} onChange={(v) => applyLive({ seg: Math.round(v) })} min={64} max={1024} step={32} precision={0} unit="点" />
              </>
            ) : null}
            {params.view === 'filter' ? (
              <SliderField label="一阶滤波系数 α" value={params.alpha} onChange={(v) => applyLive({ alpha: v })} min={0.002} max={0.5} step={0.002} precision={3} />
            ) : null}
            {params.view === 'corr' || params.view === 'filter' ? (
              <SliderField label="最大滞后" value={params.maxLag} onChange={(v) => applyLive({ maxLag: Math.round(v) })} min={4} max={512} step={4} precision={0} unit="样本" />
            ) : null}
          </FieldGroup>
        </aside>
      ) : null}

      <section class="ws-main">
        {params.view === 'time' && hist ? (
          <div class="card stack">
            <h3>时域波形与分布（{KINDS.find((k) => k.value === params.kind)?.label}）</h3>
            <Chart
              series={[{ xs: t, ys: sig, glow: 2 }]}
              xRange={[0, params.N / params.fs]}
              yRange={[Math.min(...sig) * 1.1, Math.max(...sig) * 1.1]}
              height={220}
              xLabel="t (s)"
              yLabel="x(t)"
            />
            <div class="grid2">
              <Chart
                series={[{ ...stem(hist.centers, hist.counts), color: 'var(--series-3)' }]}
                markers={hist.counts.map((c, i) => ({ x: hist.centers[i], y: c, kind: 'point' as const, size: 2 }))}
                xRange={[hist.centers[0], hist.centers[hist.centers.length - 1]]}
                yRange={[0, Math.max(...hist.counts) * 1.1]}
                height={180}
                xLabel="幅度"
                yLabel="频数"
              />
              <div class="card stack">
                <h3>统计量</h3>
                <Metric label="均值 μ (实测)" value={stats.mean} precision={4} />
                <Metric label="标准差 σ (实测)" value={stats.std} precision={4} />
                <Metric label="方差 σ² (实测)" value={stats.varr} precision={4} />
                <Metric label="方差 (理论)" value={stats.theoVar} precision={4} />
                <p class="muted">
                  高斯白噪声理论方差 = σ²；均匀噪声区间 ±σ√3（同方差）；正弦+噪声方差 ≈ 1/2 + σ²/2。
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {params.view === 'psd' && psd ? (
          <div class="card stack">
            <h3>功率谱密度（单边 PSD · 周期图 vs Welch 平均）</h3>
            <Chart
              series={[
                { xs: psd.per.f, ys: psd.per.p.map((v) => 10 * Math.log10(v + 1e-300)), color: 'var(--series-4)', width: 1.2, alpha: 0.85 },
                { xs: psd.wel.f, ys: psd.wel.p.map((v) => 10 * Math.log10(v + 1e-300)), color: 'var(--series-1)', glow: 2 },
              ]}
              xRange={[0, params.fs / 2]}
              yRange={[
                Math.min(-120, ...psd.per.p.map((v) => 10 * Math.log10(v + 1e-300))) - 4,
                Math.max(...psd.per.p.map((v) => 10 * Math.log10(v + 1e-300))) + 8,
              ]}
              height={280}
              xLabel="频率 (Hz)"
              yLabel="PSD (dB/Hz)"
            />
            <div class="row">
              <StatusBadge kind="ok">∫P df ≈ mean(x²)（Parseval 校验）</StatusBadge>
              {peak != null ? <Metric label="谱峰频率" value={peak} precision={2} unit="Hz" /> : null}
              <span class="muted">
                （黄 = 单次周期图，方差大；蓝 = Welch 分段平均，更平滑）
              </span>
            </div>
            <div class="tex-line">
              <TeX tex={`\\hat P_{xx}(f)=\\frac{1}{f_s\\sum w^2}\\left|\\sum_n w_n x_n e^{-j2\\pi f n/f_s}\\right|^2`} />
            </div>
          </div>
        ) : null}

        {params.view === 'corr' && corr ? (
          <div class="grid2">
            <div class="card stack">
              <h3>自相关 Rxx(k)</h3>
              <Chart
                series={[{ ...stem(corr.auto.lag, corr.auto.r), color: 'var(--series-2)' }]}
                markers={corr.auto.r.map((r, i) => ({ x: corr.auto.lag[i], y: r, kind: 'point' as const, size: 2 }))}
                xRange={[0, params.maxLag]}
                yRange={[Math.min(0, ...corr.auto.r), Math.max(...corr.auto.r) * 1.15]}
                height={240}
                xLabel="滞后 k (样本)"
                yLabel="Rxx(k)"
              />
              <p class="muted">白噪声自相关 ≈ δ（k=0 处峰值）；周期性成分会在对应滞后出现峰值。</p>
            </div>
            <div class="card stack">
              <h3>互相关 Rxy(k)（与同频参考正弦）</h3>
              <Chart
                series={[{ ...stem(corr.cross.lag, corr.cross.r), color: 'var(--series-5)' }]}
                markers={corr.cross.r.map((r, i) => ({ x: corr.cross.lag[i], y: r, kind: 'point' as const, size: 2 }))}
                xRange={[0, params.maxLag]}
                yRange={[Math.min(0, ...corr.cross.r), Math.max(...corr.cross.r) * 1.15]}
                height={240}
                xLabel="滞后 k (样本)"
                yLabel="Rxy(k)"
              />
              <p class="muted">互相关峰值位置 = 信号相对参考的时延（用于时延估计与匹配滤波）。</p>
            </div>
          </div>
        ) : null}

        {params.view === 'filter' && filt ? (
          <div class="grid2">
            <div class="card stack">
              <h3>一阶低通滤波前后（α={params.alpha}）</h3>
              <Chart
                series={[
                  { xs: filt.t, ys: sig, color: 'var(--series-4)', width: 1.1, alpha: 0.7 },
                  { xs: filt.t, ys: filt.y, color: 'var(--series-1)', glow: 2 },
                ]}
                xRange={[0, params.N / params.fs]}
                yRange={[Math.min(...sig) * 1.1, Math.max(...sig) * 1.1]}
                height={230}
                xLabel="t (s)"
                yLabel="x / y"
              />
            </div>
            <div class="card stack">
              <h3>PSD 对比（滤波前后）</h3>
              <Chart
                series={[
                  { xs: filt.psdIn.f, ys: filt.psdIn.p.map((v) => 10 * Math.log10(v + 1e-300)), color: 'var(--series-4)', width: 1.2 },
                  { xs: filt.psdOut.f, ys: filt.psdOut.p.map((v) => 10 * Math.log10(v + 1e-300)), color: 'var(--series-1)', glow: 2 },
                ]}
                xRange={[0, params.fs / 2]}
                yRange={[
                  Math.min(-120, ...filt.psdIn.p.map((v) => 10 * Math.log10(v + 1e-300))) - 4,
                  Math.max(...filt.psdIn.p.map((v) => 10 * Math.log10(v + 1e-300))) + 8,
                ]}
                height={230}
                xLabel="频率 (Hz)"
                yLabel="PSD (dB/Hz)"
              />
            </div>
            <div class="card stack">
              <h3>自相关对比</h3>
              <Chart
                series={[
                  { xs: filt.autoIn.lag, ys: filt.autoIn.r, color: 'var(--series-4)', width: 1.2 },
                  { xs: filt.autoOut.lag, ys: filt.autoOut.r, color: 'var(--series-1)', glow: 2 },
                ]}
                xRange={[0, params.maxLag]}
                yRange={[Math.min(0, ...filt.autoOut.r), Math.max(...filt.autoIn.r) * 1.1]}
                height={220}
                xLabel="滞后 k (样本)"
                yLabel="R(k)"
              />
              <p class="muted">低通滤波后自相关变宽 → 相关时间增大（噪声“记忆”变长）。</p>
            </div>
            <div class="card stack">
              <h3>滤波前后统计</h3>
              <Metric label="输入标准差" value={Math.sqrt(sig.reduce((s, v) => s + v * v, 0) / sig.length)} precision={4} />
              <Metric label="输出标准差" value={Math.sqrt(filt.y.reduce((s, v) => s + v * v, 0) / filt.y.length)} precision={4} />
              <p class="muted">一阶 IIR：y[k]=(1−α)y[k−1]+αx[k]，白噪声输出方差 = α/(2−α)·σ²。</p>
            </div>
          </div>
        ) : null}

        {params.view === 'time' && !hist ? <StatePanel kind="empty" title="暂无数据" desc="请调整参数。" /> : null}
      </section>

      {props.rightOpen ? (
        <aside class="ws-right">
          <div class="card stack">
            <h3>信号摘要</h3>
            <p class="muted">
              {KINDS.find((k) => k.value === params.kind)?.label} · N={params.N} · fs={params.fs}Hz · seed={params.seed}
            </p>
            <Metric label="均值" value={stats.mean} precision={4} />
            <Metric label="标准差" value={stats.std} precision={4} />
            <Metric label="方差" value={stats.varr} precision={4} />
            {peak != null ? <Metric label="谱峰频率" value={peak} precision={2} unit="Hz" /> : null}
          </div>
        </aside>
      ) : null}
    </>
  );
}
