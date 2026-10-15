/**
 * ab.ts — 对比实验 A/B 槽（FR-06）
 * 设计取舍：本平台同一时刻只有一个「当前实验」，各工具都从 moduleStates[toolId] 读取参数，
 * 无法在同一渲染中并行运行同一工具的两套参数。因此 A/B 以**槽**的形式实现：
 * 保存时冻结「工具 id + 参数 + 指标快照 + 副标题 + 缩略图 + 主图真实曲线（降采样）」，对比页并排展示并提供一键载入。
 * 存储：aux 模块状态 'aba' / 'abb'（随实验保存；缩略图降采样为 JPEG、曲线降采样到 ≤260 点 / ≤4 条，控制在 32KB/模块内）。
 */

import { getModuleState, setAuxState } from './experiments';
import { largestCanvas } from '../report/report';
import { getPrimarySeries } from '../chart/Chart';
import type { MetricItem } from '../tools/api';

export type SlotKey = 'A' | 'B';
export const SLOT_MODULE: Record<SlotKey, string> = { A: 'aba', B: 'abb' };
/** 单个槽状态上限（与 core MAX_STATE_BYTES 一致；超限则省略缩略图/曲线） */
const SLOT_BUDGET = 32 * 1024;

/* ---------- 真实曲线（M5）：冻结工作区主图的序列数据 ---------- */
export interface AbSeriesTrack {
  xs: number[];
  ys: number[];
}
export interface AbSeriesData {
  tracks: AbSeriesTrack[];
  xRange: [number, number];
  yRange: [number, number];
  xLog: boolean;
}
const SERIES_MAX_POINTS = 260;
const SERIES_MAX_TRACKS = 4;

/** 按步长降采样到 ≤cap 点（保留末点） */
function downsample(xs: ArrayLike<number>, ys: ArrayLike<number>, cap = SERIES_MAX_POINTS): AbSeriesTrack {
  const n = Math.min(xs.length, ys.length);
  const stride = Math.max(1, Math.ceil(n / cap));
  const ox: number[] = [];
  const oy: number[] = [];
  for (let i = 0; i < n; i += stride) {
    ox.push(Number(xs[i]));
    oy.push(Number(ys[i]));
  }
  if (n > 0 && (n - 1) % stride !== 0) {
    ox.push(Number(xs[n - 1]));
    oy.push(Number(ys[n - 1]));
  }
  return { xs: ox, ys: oy };
}

/** 冻结当前工作区主图（面积最大的 Chart）的序列数据 */
function captureSeries(): AbSeriesData | null {
  const p = getPrimarySeries();
  if (!p || !p.series.length) return null;
  const tracks = p.series.slice(0, SERIES_MAX_TRACKS).map((se) => downsample(se.xs, se.ys));
  if (!tracks.some((t) => t.xs.length >= 2)) return null;
  return { tracks, xRange: p.xRange, yRange: p.yRange, xLog: p.xLog };
}

export interface AbSlot {
  /** 工具 id（槽所属工具；与当前实验可能不同） */
  toolId: string;
  toolName: string;
  /** 参数快照（该工具的参数对象） */
  params: unknown;
  metrics: MetricItem[];
  subtitle: string | null;
  savedAt: number;
  /** 工作区最大画布的降采样缩略图（JPEG dataURL）；超大或采集失败时为 null */
  thumb: string | null;
  thumbNote?: string;
  /** 主图真实曲线（降采样）→ 对比页真实数据同屏叠加；无可用主图时为 undefined */
  series?: AbSeriesData;
}

export function readSlot(key: SlotKey): AbSlot | null {
  const v = getModuleState<AbSlot | null>(SLOT_MODULE[key], null);
  if (v && typeof v === 'object' && typeof (v as AbSlot).toolId === 'string') return v as AbSlot;
  return null;
}

export function clearSlot(key: SlotKey): void {
  setAuxState(SLOT_MODULE[key], null);
}

/** 降采样缩略图：把画布按比例缩到 maxW 宽后导出 JPEG（quality 越低体积越小） */
export function makeThumb(canvas: HTMLCanvasElement, maxW = 360, quality = 0.62): { dataUrl: string | null; note?: string } {
  if (!canvas.width || !canvas.height) return { dataUrl: null, note: '画布尺寸为 0' };
  const scale = Math.min(1, maxW / canvas.width);
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  try {
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const ctx = off.getContext('2d');
    if (!ctx) return { dataUrl: null, note: '无法创建离屏画布' };
    ctx.drawImage(canvas, 0, 0, w, h);
    return { dataUrl: off.toDataURL('image/jpeg', quality) };
  } catch (e) {
    return { dataUrl: null, note: (e as Error).message || '缩略图导出被阻止' };
  }
}

export interface SaveSlotInput {
  key: SlotKey;
  toolId: string;
  toolName: string;
  params: unknown;
  metrics: MetricItem[];
  subtitle: string | null;
  /** 工作区根节点（用于取最大画布做缩略图） */
  root: HTMLElement | null;
}

export interface SaveSlotResult {
  ok: boolean;
  /** 是否带上了缩略图 */
  hasThumb: boolean;
  /** 是否带上了真实曲线数据（可同屏叠加） */
  hasSeries: boolean;
  note?: string;
}

/** 保存槽：采集指标、真实曲线与缩略图，超预算时逐级省略而不是写入失败 */
export function saveSlot(input: SaveSlotInput): SaveSlotResult {
  let thumb: string | null = null;
  let thumbNote: string | undefined;
  const canvas = input.root ? largestCanvas(input.root) : null;
  if (canvas) {
    const t = makeThumb(canvas);
    thumb = t.dataUrl;
    thumbNote = t.note;
  } else {
    thumbNote = '当前视图无 Canvas 图表';
  }
  const series = captureSeries();

  const build = (withThumb: boolean, withSeries: boolean): AbSlot => ({
    toolId: input.toolId,
    toolName: input.toolName,
    params: input.params,
    metrics: input.metrics,
    subtitle: input.subtitle,
    savedAt: Date.now(),
    thumb: withThumb ? thumb : null,
    thumbNote: withThumb ? undefined : ['缩略图体积超限，已省略（' + (thumbNote || '') + '）'].join(''),
    series: withSeries ? (series ?? undefined) : undefined,
  });

  // 预算内优先保留真实曲线（可同屏叠加），其次缩略图；超限时逐级省略并在 note 说明
  let slot = build(true, true);
  let note: string | undefined;
  if (JSON.stringify(slot).length > SLOT_BUDGET) {
    slot = build(false, true);
    note = '缩略图体积超限，已省略（真实曲线已保留）';
  }
  if (!slot.series && !slot.thumb) {
    note = note ?? thumbNote;
  }
  if (JSON.stringify(slot).length > SLOT_BUDGET) {
    slot = build(false, false);
    note = '曲线与缩略图体积超限，均已省略（仅保留参数与指标）';
  }
  setAuxState(SLOT_MODULE[input.key], slot);
  return { ok: true, hasThumb: !!slot.thumb, hasSeries: !!slot.series, note };
}

/** 参数逐键 diff：返回两套参数的并集键与是否不同 */
export interface ParamDiffRow {
  key: string;
  a: unknown;
  b: unknown;
  differ: boolean;
}

export function paramDiff(a: unknown, b: unknown): ParamDiffRow[] {
  const oa = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
  const ob = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(oa), ...Object.keys(ob)])).sort();
  return keys.map((key) => ({ key, a: oa[key], b: ob[key], differ: !sameVal(oa[key], ob[key]) }));
}

function sameVal(x: unknown, y: unknown): boolean {
  if (x === y) return true;
  try {
    return JSON.stringify(x) === JSON.stringify(y);
  } catch {
    return false;
  }
}

/** 指标并集：按 label 对齐两侧数值与差异 */
export interface MetricDiffRow {
  label: string;
  a: MetricItem | null;
  b: MetricItem | null;
  unit?: string;
  /** 数值差（两侧均为 number 时给出） */
  delta: number | null;
}

export function metricDiff(a: MetricItem[], b: MetricItem[]): MetricDiffRow[] {
  const labels: string[] = [];
  for (const m of [...a, ...b]) if (!labels.includes(m.label)) labels.push(m.label);
  return labels.map((label) => {
    const ma = a.find((m) => m.label === label) ?? null;
    const mb = b.find((m) => m.label === label) ?? null;
    const va = ma && typeof ma.value === 'number' ? ma.value : null;
    const vb = mb && typeof mb.value === 'number' ? mb.value : null;
    return {
      label,
      a: ma,
      b: mb,
      unit: ma?.unit ?? mb?.unit,
      delta: va != null && vb != null ? vb - va : null,
    };
  });
}

export function fmtMetricVal(m: MetricItem | null): string {
  if (!m) return '—';
  if (typeof m.value === 'number') {
    const p = m.precision;
    return p == null ? String(m.value) : m.value.toFixed(p);
  }
  return String(m.value ?? '—');
}

/**
 * 同屏叠加：A 以洋红（去掉绿通道）、B 以青（去掉红通道）着色后相加 → 重合处呈白、差异处呈彩色。
 * 说明：这是**快照层面**的叠加（两槽为不同时刻冻结的图，非实时曲线），同一工具下最有意义。
 */
export function composeOverlay(a: string, b: string): Promise<string | null> {
  const load = (src: string): Promise<HTMLImageElement | null> =>
    new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = src;
    });

  return Promise.all([load(a), load(b)]).then(([ia, ib]) => {
    if (!ia || !ib) return null;
    const w = Math.max(ia.naturalWidth, ib.naturalWidth);
    const h = Math.max(ia.naturalHeight, ib.naturalHeight);
    if (!w || !h) return null;
    try {
      const tint = (im: HTMLImageElement, color: string): HTMLCanvasElement | null => {
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        const c = cv.getContext('2d');
        if (!c) return null;
        c.drawImage(im, 0, 0, w, h);
        c.globalCompositeOperation = 'multiply';
        c.fillStyle = color;
        c.fillRect(0, 0, w, h);
        return cv;
      };
      const ca = tint(ia, '#FF00FF'); // 洋红：保留 R/B，去掉 G
      const cb = tint(ib, '#00FFFF'); // 青：保留 G/B，去掉 R
      if (!ca || !cb) return null;
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const ctx = out.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(ca, 0, 0);
      ctx.drawImage(cb, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      return out.toDataURL('image/png');
    } catch {
      return null;
    }
  });
}
