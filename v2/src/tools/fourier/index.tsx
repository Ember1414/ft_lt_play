import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Chart, type ChartSeries } from '../../chart/Chart';
import { FieldGroup, Metric, SegmentedChips, SliderField, StatusBadge, Switch } from '../../ui/components';
import { TeX } from '../../ui/TeX';
import { conv, fft, ftSignals, spectrum, type FtSignal } from '../../core';
import { createUndoStack } from '../../state/undo';
import { getModuleState, setModuleState } from '../../state/experiments';
import { useExperimentSync } from '../useSync';
import type { ToolViewProps } from '../api';

/**
 * 傅立叶变换（fourier）— M2 存量迁移升级
 * 三视图：时频联动（信号库 + 参数 + Parseval 指标入结果条 + 参考曲线对比）/
 *        卷积定理（翻转-平移动画：面积填充 + 时间光标 + 顶点慢镜头 + 频域验证）/
 *        采样与重建（ZOH / 线性 / 理想 sinc + 混叠折叠动画 + 重建误差）。
 * 数值与 v1 一致（core.dsp 回归网保障）；符号遵循《符号登记表》（ω、f、fs、fN、sinc、rect）。
 */

type ViewId = 'map' | 'conv' | 'samp';
type SampMethod = 'zoh' | 'lin' | 'sinc';

interface CmpPin {
  sid: string;
  pvals: Record<string, number>;
}

interface FParams {
  view: ViewId;
  /** 信号库（ftSignals id）与各信号参数值（按信号存，切换不丢） */
  sig: string;
  pvals: Record<string, Record<string, number>>;
  /** 双信号对比：钉住的参考曲线（含其参数） */
  pin: CmpPin | null;
  /** 幅度轴对数（dB） */
  logMag: boolean;
  /** 卷积：f、g 核与动画状态 */
  fid: string;
  gid: string;
  ct: number;
  speed: number;
  /** 采样：信号、采样率、重建方式 */
  sSig: string;
  fs: number;
  method: SampMethod;
}

const DEFAULT: FParams = {
  view: 'map',
  sig: 'rect',
  pvals: {},
  pin: null,
  logMag: false,
  fid: 'rect',
  gid: 'gauss',
  ct: 0,
  speed: 1,
  sSig: 'sine2',
  fs: 20,
  method: 'lin',
};

const VIEWS: ReadonlyArray<{ value: ViewId; label: string }> = [
  { value: 'map', label: '时频联动' },
  { value: 'conv', label: '卷积定理' },
  { value: 'samp', label: '采样重建' },
];

const VIEW_HINTS: Record<ViewId, string> = {
  map: '信号库 + 参数滑杆：时域波形与幅度/相位谱联动；结果条给出谱峰与 Parseval 能量守恒比值。',
  conv: '翻转-平移-重叠面积：面积即 h(t)；频域验证 |F·G| 与 |FFT{f∗g}| 应重合（卷积定理）。',
  samp: '采样定理：fs > 2B 才可无失真重建；fs < 2B 时频谱折叠（混叠）并给出重建误差。',
};

const SPEEDS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0.5, label: '慢' },
  { value: 1, label: '正常' },
  { value: 2, label: '快' },
];

/* —— 卷积核目录（自 v1 fourier-transform.js 迁移，定义与语义不变） —— */
const KERNELS: Record<string, { name: string; f: (t: number) => number; t0: number; t1: number }> = {
  rect: { name: '矩形(宽1)', f: (t) => (Math.abs(t) < 0.5 ? 1 : 0), t0: -1.2, t1: 1.2 },
  gauss: { name: '高斯 e^(−t²)', f: (t) => Math.exp(-t * t), t0: -1.2, t1: 1.2 },
  decay: { name: '指数 e^(−2t)u(t)', f: (t) => (t >= 0 ? Math.exp(-2 * t) : 0), t0: -1, t1: 2 },
  sinc: {
    name: 'sinc(2t)',
    f: (t) => {
      const x = 2 * Math.PI * t;
      return Math.abs(x) < 1e-9 ? 1 : Math.sin(x) / x;
    },
    t0: -1.2,
    t1: 1.2,
  },
  tri: { name: '三角', f: (t) => Math.max(0, 1 - Math.abs(t)), t0: -1.2, t1: 1.2 },
  rect2: { name: '矩形(宽0.4)', f: (t) => (Math.abs(t) < 0.2 ? 1 : 0), t0: -1.2, t1: 1.2 },
};

const KERNEL_IDS = Object.keys(KERNELS);

/* —— 采样定理信号目录（自 v1 fourier-transform.js 迁移） —— */
const SAMP_SIGS: Record<string, { name: string; f: (t: number) => number; B: number }> = {
  sine2: { name: '双正弦 3+7 Hz', f: (t) => Math.sin(2 * Math.PI * 3 * t) + 0.6 * Math.sin(2 * Math.PI * 7 * t), B: 7 },
  sine5: { name: '正弦 5 Hz', f: (t) => Math.sin(2 * Math.PI * 5 * t), B: 5 },
  sinc: {
    // sinc(4t) = sin(4πt)/(4πt) ↔ (1/4)·rect(f/4)：单边带宽 2 Hz
    name: 'sinc (B=2 Hz)',
    f: (t) => {
      const x = Math.PI * 4 * t;
      return Math.abs(x) < 1e-9 ? 1 : Math.sin(x) / x;
    },
    B: 2,
  },
  gauss: { name: '高斯脉冲 (B≈3 Hz)', f: (t) => Math.exp(-2 * t * t), B: 3 },
};

const SAMP_IDS = Object.keys(SAMP_SIGS);
const METHODS: ReadonlyArray<{ value: SampMethod; label: string }> = [
  { value: 'zoh', label: '零阶保持' },
  { value: 'lin', label: '线性插值' },
  { value: 'sinc', label: '理想 sinc' },
];

const NSPEC = 4096;
const NCONV = 1024;
const NSAMP = 1400;

const nf = (v: number | null | undefined, d = 3): string => {
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

function interpAt(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number): number {
  const n = Math.min(xs.length, ys.length);
  if (!n) return 0;
  const step = (xs[n - 1] - xs[0]) / (n - 1) || 1;
  let i = Math.round((x - xs[0]) / step);
  i = Math.max(0, Math.min(n - 1, i));
  return ys[i];
}

/** 该信号的参数默认值（合并已保存值） */
function psetOf(sig: FtSignal, saved: Record<string, number> | undefined): Record<string, number> {
  const p: Record<string, number> = {};
  for (const d of sig.params()) p[d.k] = Number.isFinite(saved?.[d.k]) ? (saved as Record<string, number>)[d.k] : d.v;
  return p;
}

function sampleSignal(sig: FtSignal, p: Record<string, number>, n = NSPEC): { t: number[]; x: number[]; dt: number } {
  const dt = (sig.t1 - sig.t0) / (n - 1);
  const t: number[] = [];
  const x: number[] = [];
  for (let i = 0; i < n; i++) {
    const tv = sig.t0 + i * dt;
    t.push(tv);
    x.push(sig.f(p, tv));
  }
  return { t, x, dt };
}

function sanitize(raw: unknown): FParams {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<FParams>;
  const views: ViewId[] = ['map', 'conv', 'samp'];
  const methods: SampMethod[] = ['zoh', 'lin', 'sinc'];
  const pvals: Record<string, Record<string, number>> = {};
  if (r.pvals && typeof r.pvals === 'object') {
    for (const [k, v] of Object.entries(r.pvals as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const inner: Record<string, number> = {};
      for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) {
        if (Number.isFinite(vv)) inner[kk] = vv as number;
      }
      pvals[k] = inner;
    }
  }
  let pin: CmpPin | null = null;
  const rp = r.pin;
  if (rp && typeof rp === 'object' && typeof (rp as CmpPin).sid === 'string' && ftSignals.some((s) => s.id === (rp as CmpPin).sid)) {
    const inner: Record<string, number> = {};
    const src = (rp as CmpPin).pvals;
    if (src && typeof src === 'object') for (const [kk, vv] of Object.entries(src)) if (Number.isFinite(vv)) inner[kk] = vv;
    pin = { sid: (rp as CmpPin).sid, pvals: inner };
  }
  return {
    view: views.includes(r.view as ViewId) ? (r.view as ViewId) : DEFAULT.view,
    sig: ftSignals.some((s) => s.id === r.sig) ? (r.sig as string) : DEFAULT.sig,
    pvals,
    pin,
    logMag: r.logMag === true,
    fid: r.fid && KERNELS[r.fid] ? r.fid : DEFAULT.fid,
    gid: r.gid && KERNELS[r.gid] ? r.gid : DEFAULT.gid,
    ct: Number.isFinite(r.ct) ? Math.max(0, Math.min(1, r.ct as number)) : DEFAULT.ct,
    speed: [0.5, 1, 2].includes(r.speed as number) ? (r.speed as number) : DEFAULT.speed,
    sSig: r.sSig && SAMP_SIGS[r.sSig] ? r.sSig : DEFAULT.sSig,
    fs: Number.isFinite(r.fs) ? Math.max(1, Math.min(60, r.fs as number)) : DEFAULT.fs,
    method: methods.includes(r.method as SampMethod) ? (r.method as SampMethod) : DEFAULT.method,
  };
}

export function FourierTool(props: ToolViewProps) {
  const [params, setParams] = useState<FParams>(() => sanitize(getModuleState<FParams>('fourier', DEFAULT)));
  const [playing, setPlaying] = useState(false);
  const [foldT, setFoldT] = useState(1);
  const undoRef = useRef(createUndoStack<FParams>(40));
  const lastPush = useRef(0);

  useEffect(() => {
    setModuleState('fourier', params);
  }, [params]);

  useExperimentSync('fourier',
    () => sanitize(getModuleState<FParams>('fourier', DEFAULT)),
    (v) => {
      setParams(v);
      undoRef.current.clear();
    },
  );

  const apply = (next: Partial<FParams>): void => {
    const now = Date.now();
    if (now - lastPush.current > 500) {
      undoRef.current.push(params);
      lastPush.current = now;
    }
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };
  const applyLive = (next: Partial<FParams>): void => {
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };

  const view = params.view;

  /* ================= A. 时频联动 ================= */

  const sig = useMemo(() => ftSignals.find((s) => s.id === params.sig) ?? ftSignals[0], [params.sig]);
  const pset = useMemo(() => psetOf(sig, params.pvals[params.sig]), [sig, params.pvals]);
  const sample = useMemo(() => sampleSignal(sig, pset), [sig, pset]);
  const sp = useMemo(() => spectrum(sample.x, sample.dt), [sample]);

  /** 时域能量 / 频域能量（DFT 域严格 Parseval）与比值 */
  const parseval = useMemo(() => {
    let te = 0;
    for (const v of sample.x) te += v * v;
    te *= sample.dt;
    let n = 1;
    while (n < sample.x.length) n <<= 1;
    if (n !== sample.x.length) return null;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < sample.x.length; i++) re[i] = sample.x[i];
    fft(re, im);
    let fe = 0;
    for (let k = 0; k < n; k++) fe += re[k] * re[k] + im[k] * im[k];
    fe *= sample.dt / n;
    const ratio = te / fe;
    return { te, fe, ratio };
  }, [sample]);

  const peak = useMemo(() => {
    let pm = 0;
    let pf = 0;
    for (let i = 0; i < sp.mag.length; i++) {
      if (sp.mag[i] > pm) {
        pm = sp.mag[i];
        pf = sp.f[i];
      }
    }
    return { mag: pm, f: pf };
  }, [sp]);

  /** 钉住的参考曲线（双信号对比） */
  const pinData = useMemo(() => {
    if (!params.pin) return null;
    const s = ftSignals.find((x) => x.id === params.pin?.sid);
    if (!s) return null;
    return { sig: s, s: sampleSignal(s, psetOf(s, params.pin.pvals)) };
  }, [params.pin]);

  const magSeries = useMemo((): ChartSeries[] => {
    const toY = (m: number): number => (params.logMag ? 20 * Math.log10(m + 1e-12) : m);
    // 线性谱填充到基线，意义明确；dB 谱不填充（基线在 0 dB 之外，会涂满整片）
    const cur: ChartSeries = params.logMag
      ? { xs: sp.f, ys: sp.mag.map(toY), width: 2 }
      : { xs: sp.f, ys: sp.mag.map(toY), fill: 'rgba(36,86,204,.13)', fillAlpha: 1, width: 2 };
    const out: ChartSeries[] = [cur];
    if (pinData) {
      const sp2 = spectrum(pinData.s.x, pinData.s.dt);
      out.push({ xs: sp2.f, ys: sp2.mag.map(toY), dash: [5, 4], width: 1.6, color: 'rgba(123,132,146,.85)' });
    }
    return out;
  }, [sp, params.logMag, pinData]);

  /** 幅度/相位谱可视频率上界：按累计能量 95% 分位取（脉冲类信号不再只剩左边缘一根竖线） */
  const specRange = useMemo((): [number, number] => {
    const fmax = sp.f[sp.f.length - 1] ?? 1;
    let total = 0;
    for (const m of sp.mag) total += m * m;
    if (!(total > 0)) return [0, fmax];
    let acc = 0;
    let f95 = fmax;
    for (let i = 0; i < sp.mag.length; i++) {
      acc += sp.mag[i] * sp.mag[i];
      if (acc >= 0.95 * total) {
        f95 = sp.f[i];
        break;
      }
    }
    return [0, Math.min(fmax, Math.max(f95 * 1.6, 2))];
  }, [sp]);

  /* ================= B. 卷积定理 ================= */

  const convData = useMemo(() => {
    const fs = KERNELS[params.fid] ?? KERNELS[KERNEL_IDS[0]];
    const gs = KERNELS[params.gid] ?? KERNELS[KERNEL_IDS[0]];
    // 公共采样栅格：两核必须同 dt，卷积的幅值与时间轴才成立（核跨度不同 → 各自取整到栅格）
    const DT = 2.4 / (NCONV - 1);
    const samp = (k: (t: number) => number, t0: number, t1: number): { a: number[]; dt: number; t0: number; t1: number } => {
      const n = Math.max(1, Math.round((t1 - t0) / DT));
      const a: number[] = [];
      for (let i = 0; i <= n; i++) a.push(k(t0 + i * DT));
      return { a, dt: DT, t0, t1: t0 + n * DT };
    };
    const F = samp(fs.f, fs.t0, fs.t1);
    const G = samp(gs.f, gs.t0, gs.t1);
    const dt = DT;
    const h = conv(F.a, G.a); // 长度 2N−1（离散求和）
    const hT0 = fs.t0 + gs.t0;
    const hArr = h.map((v) => v * dt); // 数值积分值
    const hT = h.map((_, i) => hT0 + i * dt);
    // 频域验证：|FFT{f∗g}| vs |F·G|（离散卷积定理用未缩放卷积数组）
    let L = 1;
    while (L < h.length) L <<= 1;
    const Hre = new Float64Array(L);
    const Him = new Float64Array(L);
    for (let i = 0; i < h.length; i++) Hre[i] = h[i];
    fft(Hre, Him);
    const Fre = new Float64Array(L);
    const Fim = new Float64Array(L);
    const Gre = new Float64Array(L);
    const Gim = new Float64Array(L);
    for (let i = 0; i < F.a.length; i++) Fre[i] = F.a[i];
    for (let i = 0; i < G.a.length; i++) Gre[i] = G.a[i];
    fft(Fre, Fim);
    fft(Gre, Gim);
    const df = 1 / (L * dt);
    const fv: number[] = [];
    const hSp: number[] = [];
    const fgSp: number[] = [];
    for (let k = 0; k <= L / 2; k++) {
      fv.push(k * df);
      hSp.push(Math.hypot(Hre[k], Him[k]));
      fgSp.push(Math.hypot(Fre[k] * Gre[k] - Fim[k] * Gim[k], Fre[k] * Gim[k] + Fim[k] * Gre[k]));
    }
    let err = 0;
    let ref = 0;
    for (let k = 0; k < fv.length; k++) {
      err = Math.max(err, Math.abs(hSp[k] - fgSp[k]));
      ref = Math.max(ref, fgSp[k]);
    }
    let hMax = 1e-9;
    for (const v of hArr) hMax = Math.max(hMax, Math.abs(v));
    return { F, G, dt, hT, hArr, hT0, hT1: hT0 + (h.length - 1) * dt, fv, hSp, fgSp, specErr: err / (ref || 1), hMax };
  }, [params.fid, params.gid]);

  const ctRef = useRef(params.ct);
  useEffect(() => {
    ctRef.current = params.ct;
  }, [params.ct]);
  const convRef = useRef(convData);
  convRef.current = convData;

  /** 当前时刻 t 与滑动重叠切片（面积 = h(t)） */
  const convT = convData.hT0 + params.ct * (convData.hT1 - convData.hT0);
  const slice = useMemo(() => {
    const { F, G } = convData;
    const M = 400;
    const tau: number[] = [];
    const fv: number[] = [];
    const gv: number[] = [];
    const pv: number[] = [];
    for (let i = 0; i <= M; i++) {
      const x = F.t0 + (i / M) * (F.t1 - F.t0);
      const arg = convT - x;
      const gval = arg >= G.t0 && arg <= G.t1 ? (KERNELS[params.gid] ?? KERNELS[KERNEL_IDS[0]]).f(arg) : 0;
      const fval = (KERNELS[params.fid] ?? KERNELS[KERNEL_IDS[0]]).f(x);
      tau.push(x);
      fv.push(fval);
      gv.push(gval);
      pv.push(fval * gval);
    }
    let area = 0;
    for (let i = 0; i < M; i++) area += ((pv[i] + pv[i + 1]) / 2) * (tau[i + 1] - tau[i]);
    return { tau, fv, gv, pv, area };
  }, [convData, convT, params.fid, params.gid]);

  const hNow = interpAt(convData.hT, convData.hArr, convT);

  /** 卷积播放：时间匀速前进，接近 h(t) 极值时自动减速（顶点慢镜头，§4.16） */
  useEffect(() => {
    if (view !== 'conv' || !playing) return;
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const dn = Math.min(0.05, (now - last) / 1000);
      last = now;
      const c = convRef.current;
      const eps = Math.max(1e-4, (c.hT1 - c.hT0) * 1e-3);
      const slope = Math.abs(interpAt(c.hT, c.hArr, Math.min(c.hT1, convTRefCurrent() + eps)) - interpAt(c.hT, c.hArr, Math.max(c.hT0, convTRefCurrent() - eps))) / (2 * eps);
      const slopeNorm = Math.min(1, slope / (c.hMax / ((c.hT1 - c.hT0) * 0.5)));
      const factor = 1 - 0.7 * (1 - slopeNorm);
      const next = (ctRef.current + dn * 0.16 * speedRef.current * factor) % 1;
      ctRef.current = next;
      applyLive({ ct: next });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint 无；applyLive/speed 走 ref，避免循环重启
  }, [view, playing]);

  const speedRef = useRef(params.speed);
  speedRef.current = params.speed;
  const convTRefCurrent = (): number => convRef.current.hT0 + ctRef.current * (convRef.current.hT1 - convRef.current.hT0);

  /* ================= C. 采样与重建 ================= */

  const sSig = SAMP_SIGS[params.sSig] ?? SAMP_SIGS[SAMP_IDS[0]];
  const alias = params.fs < 2 * sSig.B;

  const sampData = useMemo(() => {
    const T0 = -1;
    const T1 = 1;
    const t: number[] = [];
    const x: number[] = [];
    for (let i = 0; i <= NSAMP; i++) {
      const tv = T0 + (i / NSAMP) * (T1 - T0);
      t.push(tv);
      x.push(sSig.f(tv));
    }
    const n0 = Math.ceil(T0 * params.fs);
    const n1 = Math.floor(T1 * params.fs);
    const sT: number[] = [];
    const sV: number[] = [];
    for (let n = n0; n <= n1; n++) {
      sT.push(n / params.fs);
      sV.push(sSig.f(n / params.fs));
    }
    const recon = (tv: number): number => {
      if (params.method === 'zoh') {
        const idx = Math.floor(tv * params.fs) - n0;
        return idx >= 0 && idx < sV.length ? sV[idx] : 0;
      }
      if (params.method === 'lin') {
        const xx = tv * params.fs - n0;
        const i0 = Math.floor(xx);
        const fr = Math.max(0, Math.min(1, xx - i0));
        const a = Math.max(0, Math.min(sV.length - 1, i0));
        const b = Math.max(0, Math.min(sV.length - 1, i0 + 1));
        return sV[a] + (sV[b] - sV[a]) * fr;
      }
      let s = 0;
      for (let n = 0; n < sV.length; n++) {
        const arg = Math.PI * (tv * params.fs - (n0 + n));
        s += sV[n] * (Math.abs(arg) < 1e-9 ? 1 : Math.sin(arg) / arg);
      }
      return s;
    };
    const r: number[] = [];
    let maxErr = 0;
    for (let i = 0; i < t.length; i++) {
      const rv = recon(t[i]);
      r.push(rv);
      if (Number.isFinite(rv)) maxErr = Math.max(maxErr, Math.abs(rv - x[i]));
    }
    const spS = spectrum(sV, 1 / params.fs);
    return { t, x, sT, sV, r, maxErr, spS };
  }, [sSig, params.fs, params.method]);

  /** 折叠示意：B（最高有效频率）→ 混叠频率 |B − fs|（仅混叠时循环滑动，慢镜头） */
  const aliasF = useMemo(() => {
    if (!alias) return null;
    const k = Math.round(sSig.B / params.fs);
    const af = Math.abs(k * params.fs - sSig.B);
    return { from: sSig.B, to: af };
  }, [alias, sSig, params.fs]);

  useEffect(() => {
    if (view !== 'samp' || !aliasF) return;
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setFoldT(1);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number): void => {
      const k = ((now - t0) / 2200) % 1;
      setFoldT(0.5 - 0.5 * Math.cos(Math.PI * 2 * k));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [view, aliasF]);

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
        view === 'map'
          ? sig.name + ' · 谱峰 ' + nf(peak.f, 3) + ' Hz'
          : view === 'conv'
            ? (KERNELS[params.fid]?.name ?? '') + ' ∗ ' + (KERNELS[params.gid]?.name ?? '') + ' · t=' + nf(convT, 2)
            : sSig.name + ' · fs=' + nf(params.fs, 1) + ' Hz',
      metrics: () => {
        if (view === 'map') {
          return [
            { label: '谱峰幅度', value: peak.mag, precision: 3 },
            { label: '谱峰位置', value: peak.f, unit: 'Hz', precision: 3 },
            { label: '频率分辨率 Δf', value: sp.f[1] != null ? sp.f[1] - sp.f[0] : '—', unit: 'Hz', precision: 4 },
            {
              label: 'Parseval 比值',
              value: parseval ? parseval.ratio : '—',
              precision: 6,
              tone: parseval && Math.abs(parseval.ratio - 1) < 1e-6 ? 'ok' : 'warn',
              hint: '∫|x|²dt / ∫|X|²df 应 = 1（能量守恒）',
            },
          ];
        }
        if (view === 'conv') {
          return [
            { label: '当前 h(t)', value: hNow, precision: 3 },
            { label: '面积法读数', value: slice.area, precision: 3, hint: '重叠面积（梯形积分）应与 h(t) 一致' },
            {
              label: '谱一致性',
              value: tiny(convData.specErr),
              tone: convData.specErr < 1e-6 ? 'ok' : 'warn',
              hint: '离散卷积定理自检：|FFT{f∗g}| vs |F·G| 的最大相对偏差（结构性恒等，非独立验证）',
            },
            { label: '卷积时长', value: convData.hT1 - convData.hT0, unit: 's', precision: 2 },
          ];
        }
        return [
          { label: '采样率 fs', value: params.fs, unit: 'Hz', precision: 1 },
          { label: '奈奎斯特率 2B', value: 2 * sSig.B, unit: 'Hz', precision: 1 },
          {
            label: '混叠状态',
            value: alias ? '混叠发生' : '可无失真重建',
            tone: alias ? 'danger' : 'ok',
            hint: alias ? '高频折叠成低频假象' : 'fs > 2B 满足采样定理',
          },
          { label: '重建最大误差', value: tiny(sampData.maxErr), tone: alias ? 'danger' : sampData.maxErr < 0.05 ? 'ok' : 'warn', hint: '重建波形 vs 原信号' },
        ];
      },
      exports: () => [
        {
          id: 'csv',
          label: view === 'map' ? '谱 CSV' : view === 'conv' ? '卷积 CSV' : '采样 CSV',
          run: () => {
            if (view === 'map') {
              const rows = ['f(Hz),|X(f)|,phase(rad)'];
              for (let i = 0; i < sp.f.length; i++) rows.push(`${sp.f[i].toPrecision(6)},${sp.mag[i].toPrecision(6)},${sp.ph[i].toPrecision(6)}`);
              downloadText('fourier-spectrum.csv', rows.join('\n'));
            } else if (view === 'conv') {
              const rows = ['t,h(t),|F*G|(f),|FFT{f*g}|(f)'];
              for (let i = 0; i < convData.hT.length; i++) rows.push(`${convData.hT[i].toPrecision(6)},${convData.hArr[i].toPrecision(6)},,`);
              for (let i = 0; i < convData.fv.length; i++) rows.push(`,,${convData.fgSp[i].toPrecision(6)},${convData.hSp[i].toPrecision(6)}`);
              downloadText('fourier-convolution.csv', rows.join('\n'));
            } else {
              const rows = ['t,x(t),x_recon(t),n,x[n]'];
              for (let i = 0; i < sampData.t.length; i++) rows.push(`${sampData.t[i].toPrecision(6)},${sampData.x[i].toPrecision(6)},${sampData.r[i].toPrecision(6)},,`);
              for (let i = 0; i < sampData.sT.length; i++) rows.push(`,,,${sampData.sT[i].toPrecision(6)},${sampData.sV[i].toPrecision(6)}`);
              downloadText('fourier-sampling.csv', rows.join('\n'));
            }
          },
        },
        {
          id: 'json',
          label: 'JSON',
          run: () => downloadText('fourier-experiment.json', JSON.stringify(params, null, 2)),
        },
      ],
    });
    return () => props.api(null);
  }, [params, view, sig, sp, peak, parseval, convData, convT, hNow, slice.area, sSig, alias, sampData]);

  /* ================= 渲染 ================= */

  const setSig = (id: string): void => {
    apply({ sig: id });
  };
  const setParamVal = (k: string, v: number, live = false): void => {
    const cur = params.pvals[params.sig] ?? {};
    const next = { ...params.pvals, [params.sig]: { ...cur, [k]: v } };
    if (live) applyLive({ pvals: next });
    else apply({ pvals: next });
  };

  const sigDefs = sig.params();

  return (
    <>
      {props.leftOpen ? (
        <aside class="ws-left">
          <FieldGroup title="视图">
            <SegmentedChips options={VIEWS} value={view} onChange={(v) => apply({ view: v })} ariaLabel="视图" />
            <p class="muted">{VIEW_HINTS[view]}</p>
          </FieldGroup>

          {view === 'map' ? (
            <>
              <FieldGroup title="信号库" desc="常见函数（含解析变换对）：选择后可在下方调参。">
                <div class="row">
                  {ftSignals.map((s) => (
                    <button key={s.id} class={'btn' + (s.id === params.sig ? ' is-on' : '')} onClick={() => setSig(s.id)}>
                      {s.name}
                    </button>
                  ))}
                </div>
              </FieldGroup>
              <FieldGroup title="信号参数" onReset={() => apply({ pvals: { ...params.pvals, [params.sig]: {} } })}>
                {sigDefs.map((d) => (
                  <SliderField
                    key={d.k}
                    label={d.label}
                    value={pset[d.k]}
                    onChange={(v) => setParamVal(d.k, v, true)}
                    min={d.min}
                    max={d.max}
                    step={d.step ?? 0.01}
                    precision={3}
                    hint={d.implicit ? 'δ 近似宽度：越窄频谱越平坦' : undefined}
                  />
                ))}
                {sig.note ? <p class="muted">{sig.note}</p> : null}
              </FieldGroup>
              <FieldGroup title="对比与显示" defaultOpen={false}>
                <div class="row">
                  {params.pin ? (
                    <>
                      <StatusBadge kind="info">
                        参考已钉：{ftSignals.find((s) => s.id === params.pin?.sid)?.name ?? ''}
                      </StatusBadge>
                      <button class="btn" onClick={() => apply({ pin: null })}>
                        清除参考
                      </button>
                    </>
                  ) : (
                    <button class="btn" onClick={() => apply({ pin: { sid: params.sig, pvals: { ...pset } } })}>
                      钉住当前为参考（双信号对比）
                    </button>
                  )}
                </div>
                <Switch label="幅度谱用对数轴 (dB)" checked={params.logMag} onChange={(v) => apply({ logMag: v })} hint="20·log₁₀|X(f)|" />
                <p class="muted">钉住参考后修改参数：灰虚线为参考曲线，可与当前曲线直接对比（如矩形脉宽 ↔ 带宽权衡）。</p>
              </FieldGroup>
            </>
          ) : null}

          {view === 'conv' ? (
            <>
              <FieldGroup title="卷积核 f(t) 与 g(t)" desc="两两组合；h = f ∗ g。">
                <p class="muted" style="margin:0 0 4px">
                  f(t)
                </p>
                <div class="row">
                  {KERNEL_IDS.map((k) => (
                    <button key={k} class={'btn' + (k === params.fid ? ' is-on' : '')} onClick={() => apply({ fid: k })}>
                      {KERNELS[k].name}
                    </button>
                  ))}
                </div>
                <p class="muted" style="margin:8px 0 4px">
                  g(t)
                </p>
                <div class="row">
                  {KERNEL_IDS.map((k) => (
                    <button key={k} class={'btn' + (k === params.gid ? ' is-on' : '')} onClick={() => apply({ gid: k })}>
                      {KERNELS[k].name}
                    </button>
                  ))}
                </div>
              </FieldGroup>
              <FieldGroup title="动画速度" defaultOpen={false}>
                <SegmentedChips
                  options={SPEEDS.map((s) => ({ value: String(s.value), label: s.label }))}
                  value={String(params.speed)}
                  onChange={(v) => apply({ speed: Number(v) })}
                  ariaLabel="动画速度"
                />
                <p class="muted">播放时接近 h(t) 的极值会自动减速（顶点慢镜头）；可按暂停逐点查看。</p>
              </FieldGroup>
            </>
          ) : null}

          {view === 'samp' ? (
            <>
              <FieldGroup title="信号" desc="含最高频率 B；采样率需 fs > 2B 才能无失真重建。">
                <div class="row">
                  {SAMP_IDS.map((k) => (
                    <button key={k} class={'btn' + (k === params.sSig ? ' is-on' : '')} onClick={() => apply({ sSig: k })}>
                      {SAMP_SIGS[k].name}
                    </button>
                  ))}
                </div>
              </FieldGroup>
              <FieldGroup title="采样与重建" onReset={() => apply({ fs: DEFAULT.fs, method: DEFAULT.method })}>
                <SliderField
                  label="采样率 fs"
                  value={params.fs}
                  onChange={(v) => applyLive({ fs: v })}
                  min={1}
                  max={60}
                  step={0.5}
                  precision={1}
                  unit="Hz"
                  hint="拖到 2B 附近观察重建波形先恶化、再恢复"
                />
                <SegmentedChips options={METHODS} value={params.method} onChange={(v) => apply({ method: v })} ariaLabel="重建方式" />
              </FieldGroup>
            </>
          ) : null}
        </aside>
      ) : null}

      <section class="ws-main">
        {view === 'map' ? (
          <>
            <div class="card stack">
              <h3>时域 x(t)（参数滑杆实时联动 · 参考为灰虚线）</h3>
              <Chart
                series={[
                  { xs: sample.t, ys: sample.x, glow: 2.5 },
                  ...(pinData ? [{ xs: pinData.s.t, ys: pinData.s.x, dash: [5, 4], width: 1.6, color: 'rgba(123,132,146,.85)' }] : []),
                ]}
                xRange={[sig.t0, sig.t1]}
                yRange={yRangeOf(sample.x)}
                height={180}
                xLabel="t (s)"
                yLabel="x(t)"
              />
            </div>
            <div class="card stack">
              <h3>幅度谱 |X(f)|{params.logMag ? '（dB）' : ''}</h3>
              <Chart
                series={magSeries}
                xRange={specRange}
                yRange={params.logMag ? [-80, 20] : [0, peak.mag * 1.12 || 1]}
                height={190}
                xLabel="f (Hz)"
                yLabel={params.logMag ? '|X| (dB)' : '|X(f)|'}
              />
            </div>
            <div class="card stack">
              <h3>相位谱 ∠X(f)</h3>
              <Chart
                series={[{ xs: sp.f, ys: sp.ph, color: 'var(--series-3)', width: 1.6 }]}
                xRange={specRange}
                yRange={[-Math.PI - 0.3, Math.PI + 0.3]}
                height={150}
                xLabel="f (Hz)"
                yLabel="相位 (rad)"
              />
            </div>
            <div class="card stack">
              <h3>解析变换对</h3>
              <div class="formula-block">
                <div class="tex-line">
                  <TeX tex={sig.tex} />
                </div>
                <div class="tex-line">
                  <TeX tex={sig.ft} />
                </div>
              </div>
              {sig.note ? <p class="muted">{sig.note}</p> : null}
            </div>
          </>
        ) : null}

        {view === 'conv' ? (
          <>
            <div class="card stack">
              <h3>卷积定理 · (f ∗ g)(t) ⟷ F(f)·G(f)</h3>
              <div class="row">
                <button class="btn primary" onClick={() => setPlaying((v) => !v)}>
                  {playing ? '⏸ 暂停' : '▶ 播放卷积'}
                </button>
                <button
                  class="btn"
                  onClick={() => {
                    setPlaying(false);
                    apply({ ct: 0 });
                  }}
                >
                  ↺ 重置
                </button>
                <span class="muted" style="margin:0">
                  t = {nf(convT, 2)} s
                </span>
                <span class="spacer" />
                <span class="muted" style="margin:0">
                  卷积时刻
                </span>
                <input
                  class="c-slider-track"
                  style="flex:1 1 240px;min-width:160px"
                  type="range"
                  min={0}
                  max={1}
                  step={0.001}
                  value={params.ct}
                  aria-label="卷积时刻"
                  onInput={(e) => {
                    setPlaying(false);
                    applyLive({ ct: Number((e.currentTarget as HTMLInputElement).value) });
                  }}
                />
              </div>
              <Chart
                series={[
                  { xs: slice.tau, ys: slice.pv, fill: 'rgba(161,92,6,.22)', fillAlpha: 1, width: 0, color: 'rgba(0,0,0,0)' },
                  { xs: slice.tau, ys: slice.fv, width: 2 },
                  { xs: slice.tau, ys: slice.gv, width: 2, color: 'var(--series-3)' },
                  { xs: [convT, convT], ys: [-1.6, 1.6], width: 1, color: 'rgba(123,132,146,.9)', dash: [4, 3] },
                ]}
                xRange={[convData.F.t0, convData.F.t1]}
                yRange={[-1.6, 1.6]}
                height={190}
                xLabel="τ (s)"
                yLabel="f(τ) · g(t−τ)"
              />
              <p class="muted">
                蓝 = f(τ)；紫 = 翻转平移后的 g(t−τ)；橙色阴影 = 乘积 f(τ)·g(t−τ)，其面积即 h(t) = {nf(slice.area, 3)}（当前时刻）。
              </p>
            </div>
            <div class="card stack">
              <h3>卷积结果 h(t)（亮点 = 当前时刻）</h3>
              <Chart
                series={[{ xs: convData.hT, ys: convData.hArr, fill: 'rgba(12,124,107,.10)', fillAlpha: 1, glow: 2.5 }]}
                markers={[{ x: convT, y: hNow, kind: 'point' as const, color: '#A15C06', size: 5, focus: true }]}
                xRange={[convData.hT0, convData.hT1]}
                yRange={[-convData.hMax * 1.18, convData.hMax * 1.18]}
                height={180}
                xLabel="t (s)"
                yLabel="h(t)"
              />
            </div>
            <div class="card stack">
              <h3>频域验证 · |FFT&#123;f∗g&#125;| 与 |F·G| 应重合</h3>
              <Chart
                series={[
                  { xs: convData.fv, ys: convData.fgSp, width: 2.4, color: 'var(--series-3)' },
                  { xs: convData.fv, ys: convData.hSp, width: 1.4 },
                ]}
                xRange={[0, convData.fv[convData.fv.length - 1]]}
                yRange={[0, Math.max(...convData.fgSp) * 1.1 || 1]}
                height={170}
                xLabel="f (Hz)"
                yLabel="幅度"
              />
              <p class="muted">
                紫 = |F·G|（频域相乘），绿 = |FFT{"{f∗g}"}|（时域卷积后变换）——两条曲线重合即卷积定理成立（相对偏差 {tiny(convData.specErr)}）。
              </p>
            </div>
          </>
        ) : null}

        {view === 'samp' ? (
          <>
            <div class="card stack">
              <h3>时域：原信号（蓝 · 实线）· 采样点（橙）· 重建（绿 · 虚线）</h3>
              <Chart
                series={[
                  { xs: sampData.t, ys: sampData.x, width: 2 },
                  { xs: sampData.t, ys: sampData.r, width: 1.6, dash: [5, 4], glow: 2, color: 'var(--series-2)' },
                ]}
                markers={sampData.sT.map((tv, i) => ({ x: tv, y: sampData.sV[i], kind: 'point' as const, color: '#A15C06', size: 3 }))}
                xRange={[-1, 1]}
                yRange={yRangeOf(sampData.x.length ? sampData.x : [0])}
                height={210}
                xLabel="t (s)"
                yLabel="x(t)"
              />
              <div class="row">
                <StatusBadge kind={alias ? 'err' : 'ok'}>{alias ? '⚠ 混叠发生（fs < 2B）' : '✓ 满足采样定理（fs > 2B）'}</StatusBadge>
                <Metric label="重建最大误差" value={tiny(sampData.maxErr)} tone={alias ? 'danger' : sampData.maxErr < 0.05 ? 'ok' : 'warn'} />
              </div>
            </div>
            <div class="card stack">
              <h3>采样序列频谱（红线 = 奈奎斯特频率 fN = fs/2）</h3>
              <Chart
                series={[
                  { xs: sampData.spS.f, ys: sampData.spS.mag, fill: 'rgba(107,79,216,.12)', fillAlpha: 1, width: 2, color: 'var(--series-3)' },
                  {
                    xs: [params.fs / 2, params.fs / 2],
                    ys: [0, Math.max(...sampData.spS.mag) * 1.15 || 1],
                    color: '#C7403C',
                    width: 1,
                    dash: [4, 3],
                  },
                ]}
                markers={
                  aliasF
                    ? [{ x: aliasF.from - (aliasF.from - aliasF.to) * foldT, y: 0, kind: 'point' as const, color: '#C7403C', size: 6, focus: true }]
                    : []
                }
                xRange={[0, Math.max(params.fs / 2, aliasF ? aliasF.from : sSig.B) * 1.12]}
                yRange={[0, Math.max(...sampData.spS.mag) * 1.15 || 1]}
                height={180}
                xLabel="f (Hz)"
                yLabel="|X|"
              />
              <p class="muted">
                {aliasF
                  ? `折叠示意：${nf(aliasF.from, 1)} Hz 超过 fN，混叠到 ${nf(aliasF.to, 1)} Hz（红点滑动为折叠过程）。`
                  : `信号带宽 B ≈ ${sSig.B} Hz，fN = ${nf(params.fs / 2, 1)} Hz，全部频率均在奈奎斯特带内。`}
              </p>
            </div>
          </>
        ) : null}
      </section>

      {props.rightOpen ? (
        <aside class="ws-right">
          {view === 'map' ? (
            <>
              <div class="card stack">
                <h4 class="card-h">谱统计</h4>
                <div class="row">
                  <Metric label="谱峰幅度" value={peak.mag} precision={4} />
                  <Metric label="谱峰位置" value={peak.f} unit="Hz" precision={3} />
                </div>
                <div class="row">
                  <Metric label="Δf · 分辨率" value={sp.f[1] != null ? sp.f[1] - sp.f[0] : '—'} unit="Hz" precision={4} />
                  <Metric label="时域长度" value={sig.t1 - sig.t0} unit="s" precision={2} />
                </div>
              </div>
              <div class="card stack">
                <h4 class="card-h">Parseval 能量守恒</h4>
                <div class="row">
                  <Metric label="∫|x|²dt" value={parseval ? parseval.te : '—'} precision={4} />
                  <Metric label="∫|X|²df" value={parseval ? parseval.fe : '—'} precision={4} />
                </div>
                <div class="row">
                  <Metric
                    label="比值（应 = 1）"
                    value={parseval ? parseval.ratio : '—'}
                    precision={6}
                    tone={parseval && Math.abs(parseval.ratio - 1) < 1e-6 ? 'ok' : 'warn'}
                  />
                </div>
                <p class="muted">DFT 域严格成立：时域能量与频域能量一致（离散 Parseval 定理）。</p>
              </div>
              {params.pin ? (
                <div class="card stack">
                  <h4 class="card-h">双信号对比</h4>
                  <p class="mono">参考：{ftSignals.find((s) => s.id === params.pin?.sid)?.name}</p>
                  <p class="muted">参考曲线以灰虚线出现在时域与幅度谱；对比脉宽 ↔ 带宽、σ ↔ 频谱宽度等权衡。</p>
                </div>
              ) : null}
            </>
          ) : null}

          {view === 'conv' ? (
            <div class="card stack">
              <h4 class="card-h">卷积定理速读</h4>
              <div class="row">
                <Metric label="当前 h(t)" value={hNow} precision={3} />
                <Metric label="面积法读数" value={slice.area} precision={3} />
              </div>
              <div class="row">
                <Metric label="谱域偏差" value={tiny(convData.specErr)} tone={convData.specErr < 1e-6 ? 'ok' : 'warn'} />
                <Metric label="h 峰值" value={convData.hMax} precision={3} />
              </div>
              <p class="muted">
                面积法（时域积分）与 h(t) 应逐点一致；谱域 |F·G| 与 |FFT{"{f∗g}"}| 也应重合——两条独立路径互相验证卷积定理。
              </p>
            </div>
          ) : null}

          {view === 'samp' ? (
            <div class="card stack">
              <h4 class="card-h">采样定理速读</h4>
              <div class="row">
                <Metric label="B · 信号带宽" value={sSig.B} unit="Hz" precision={1} />
                <Metric label="fN · 奈奎斯特" value={params.fs / 2} unit="Hz" precision={1} />
              </div>
              <div class="row">
                <Metric label="采样点数" value={sampData.sV.length} precision={0} />
                <Metric label="重建最大误差" value={tiny(sampData.maxErr)} tone={alias ? 'danger' : 'ok'} />
              </div>
              <p class="muted">
                重建方式：零阶保持（阶梯）/ 线性插值 / 理想内插 sinc（Σ x[n]·sinc(fs·t−n)）。fs 略高于 2B 时 sinc 重建最接近原信号；fs &lt; 2B 时任何方式都无法恢复（信息已丢失）。
              </p>
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