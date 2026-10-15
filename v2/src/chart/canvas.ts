/**
 * canvas.ts — Canvas 绘图原语（图表层基础设施）
 * 契约：
 * - 主题色一律经 chartColors()（CSS 令牌 → 运行时快照，主题切换由外壳 invalidate）；
 * - 刻度：线性轴 niceStep 步进；对数轴仅 1/2/5 档位（规划书 §8.11 轴标注规范）；
 * - HiDPI：devicePixelRatio ≤2.5 上限，避免 4K 上过度绘制。
 */

import { niceStep } from '../ui/textext';

export interface ChartColors {
  paper: string;
  panel: string;
  well: string;
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  grid: string;
  accent: string;
  accentSoft: string;
  accentLine: string;
  accent2: string;
  violet: string;
  ok: string;
  warn: string;
  danger: string;
  series: [string, string, string, string];
}

let cached: ChartColors | null = null;

export function invalidateChartColors(): void {
  cached = null;
}

export function chartColors(): ChartColors {
  if (cached) return cached;
  const fallback: ChartColors = {
    paper: '#F6F5F1',
    panel: '#FFFFFF',
    well: '#FBFAF7',
    ink: '#1B1F27',
    ink2: '#48525F',
    ink3: '#7B8492',
    line: '#E4E2DA',
    grid: '#E4E2DA',
    accent: '#2456CC',
    accentSoft: 'rgba(36,86,204,.09)',
    accentLine: 'rgba(36,86,204,.28)',
    accent2: '#0C7C6B',
    violet: '#6B4FD8',
    ok: '#0C7C6B',
    warn: '#A15C06',
    danger: '#C7403C',
    series: ['#2456CC', '#0C7C6B', '#7550D2', '#0E7490'],
  };
  if (typeof document === 'undefined') return fallback;
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string): string => cs.getPropertyValue(name).trim() || fb;
  cached = {
    paper: v('--paper', fallback.paper),
    panel: v('--panel', fallback.panel),
    well: v('--well', fallback.well),
    ink: v('--ink', fallback.ink),
    ink2: v('--ink-2', fallback.ink2),
    ink3: v('--ink-3', fallback.ink3),
    line: v('--line', fallback.line),
    grid: v('--line', fallback.grid),
    accent: v('--accent', fallback.accent),
    accentSoft: v('--accent-soft', fallback.accentSoft),
    accentLine: v('--accent-line', fallback.accentLine),
    accent2: v('--accent-2', fallback.accent2),
    violet: v('--violet', fallback.violet),
    ok: v('--ok', fallback.ok),
    warn: v('--warn', fallback.warn),
    danger: v('--danger', fallback.danger),
    series: [
      v('--series-1', fallback.series[0]),
      v('--series-2', fallback.series[1]),
      v('--series-3', fallback.series[2]),
      v('--series-4', fallback.series[3]),
    ],
  };
  return cached;
}

export const CHART_FONT = '11px Consolas, "SFMono-Regular", "Cascadia Code", monospace';

export function setupHiDPI(canvas: HTMLCanvasElement, cssW: number, cssH: number): CanvasRenderingContext2D | null {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Scales {
  sx(v: number): number;
  sy(v: number): number;
  ix(px: number): number;
  iy(py: number): number;
  xTicks(): number[];
  yTicks(): number[];
}

export interface ScalesOpts {
  xRange: [number, number];
  yRange: [number, number];
  xLog?: boolean;
  rect: Rect;
}

function lin(d0: number, d1: number, p0: number, p1: number): (v: number) => number {
  const k = (p1 - p0) / (d1 - d0 || 1);
  return (v: number) => p0 + (v - d0) * k;
}

export function makeScales(o: ScalesOpts): Scales {
  const r = o.rect;
  const [x0, x1] = o.xRange;
  const [y0, y1] = o.yRange;
  const sx = o.xLog
    ? (() => {
        const a = Math.log10(Math.max(x0, 1e-12));
        const b = Math.log10(Math.max(x1, 1e-11));
        const k = (b - a) || 1;
        return (v: number) => r.x + ((Math.log10(Math.max(v, 1e-12)) - a) / k) * r.w;
      })()
    : lin(x0, x1, r.x, r.x + r.w);
  const sy = lin(y0, y1, r.y + r.h, r.y); // y 轴向上
  return {
    sx,
    sy,
    ix: o.xLog
      ? (() => {
          const a = Math.log10(Math.max(x0, 1e-12));
          const b = Math.log10(Math.max(x1, 1e-11));
          const k = (b - a) || 1;
          return (px: number) => Math.pow(10, a + ((px - r.x) / r.w) * k);
        })()
      : lin(r.x, r.x + r.w, x0, x1),
    iy: lin(r.y + r.h, r.y, y0, y1),
    xTicks(): number[] {
      if (o.xLog) return logTicks(x0, x1);
      return linTicks(x0, x1, Math.max(3, Math.round(r.w / 90)));
    },
    yTicks(): number[] {
      return linTicks(y0, y1, Math.max(3, Math.round(r.h / 48)));
    },
  };
}

function linTicks(a: number, b: number, target: number): number[] {
  if (!(b > a)) return [a];
  const step = niceStep((b - a) / target);
  const out: number[] = [];
  const start = Math.ceil(a / step) * step;
  for (let v = start; v <= b + step * 1e-9; v += step) out.push(Number(v.toFixed(12)));
  return out;
}

/** 对数轴：仅 1/2/5 档位 */
function logTicks(a: number, b: number): number[] {
  if (!(b > a) || a <= 0) return [];
  const out: number[] = [];
  const k0 = Math.floor(Math.log10(a));
  const k1 = Math.ceil(Math.log10(b));
  for (let k = k0; k <= k1; k++) {
    for (const m of [1, 2, 5]) {
      const v = m * Math.pow(10, k);
      if (v >= a * 0.9999 && v <= b * 1.0001) out.push(v);
    }
  }
  return out;
}

/** 刻度数值格式化：大/小量走指数，其余 ≤4 位有效（用于对数轴与悬停读数） */
export function fmtTick(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e4 || a < 1e-3) return v.toExponential(0).replace('e+', 'e');
  const s = Number(v.toPrecision(4)).toString();
  return s;
}

/**
 * 步长自适应刻度格式（M18）：小数位由**刻度步长**决定，保证相邻刻度字符串互不相同。
 * 背景：固定 4 位有效（fmtTick）在深度缩放后会把相邻刻度都四舍五入成同一个数（如 0.3000002 → "0.3"），
 * 轴上出现重复标签；工具自定义的固定小数位（如 toFixed(2)）在中等缩放即会重复。
 */
export function fmtTickAt(v: number, step?: number): string {
  if (v === 0) return '0';
  const st = step == null ? 0 : Math.abs(step);
  if (!(st > 0) || !Number.isFinite(st)) return fmtTick(v);
  const av = Math.abs(v);
  if (av >= 1e5 || av < 1e-4) {
    // 指数表示：小数位由「步长 / 数值」的相对量级决定，确保相邻刻度可区分
    const ed = Math.max(0, Math.min(9, Math.ceil(-Math.log10(st / av))));
    return v.toExponential(ed).replace('e+', 'e');
  }
  const dec = Math.max(0, Math.min(12, -Math.floor(Math.log10(st))));
  return Number(v.toFixed(dec)).toString();
}

/** 文本像素宽度测量（离屏 ctx，字体同 CHART_FONT；无 DOM 时退化估算） */
let measCtx: CanvasRenderingContext2D | null = null;
export function measureText(s: string): number {
  if (typeof document !== 'undefined') {
    if (!measCtx) measCtx = document.createElement('canvas').getContext('2d');
    if (measCtx) {
      measCtx.font = CHART_FONT;
      return measCtx.measureText(s).width;
    }
  }
  return s.length * 6.6;
}

/**
 * 可视跨度保护（M18）：把缩放后的区间限制在「基准跨度的 [minRel, maxRel] 倍」内。
 * 目的不是限制缩放，而是防止退化为无意义尺度或浮点不可分辨（跨度→0）。
 */
export function clampSpan(
  range: [number, number],
  base: [number, number],
  minRel = 1e-6,
  maxRel = 1e6,
): [number, number] {
  const baseSpan = Math.abs(base[1] - base[0]) || 1;
  if (!Number.isFinite(range[0]) || !Number.isFinite(range[1])) return [base[0], base[1]];
  const c = (range[0] + range[1]) / 2;
  const sp = Math.abs(range[1] - range[0]);
  const k = Math.min(Math.max(sp, baseSpan * minRel), baseSpan * maxRel);
  return [c - k / 2, c + k / 2];
}

/* ——— 绘制原语 ——— */

export interface FrameOpts {
  xLabel?: string;
  yLabel?: string;
  /** 自定义 x 刻度格式；第二个参数为当前刻度步长（便于按缩放自适应精度，避免标签重复） */
  xTickFmt?: (v: number, step?: number) => string;
  /** x 轴为对数轴（刻度按 1/2/5 档位，标签不做步长自适应） */
  xLog?: boolean;
}

/** 网格 + 零线 + 刻度 + 轴标签（不画曲线） */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  s: Scales,
  rect: Rect,
  colors: ChartColors,
  o: FrameOpts = {},
): void {
  const yTop = rect.y;
  const yBot = rect.y + rect.h;
  const xR = rect.x + rect.w;
  ctx.save();
  ctx.font = CHART_FONT;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;

  const xt = s.xTicks();
  const yt = s.yTicks();
  const xStep = xt.length > 1 ? Math.abs(xt[1] - xt[0]) : undefined;
  const yStep = yt.length > 1 ? Math.abs(yt[1] - yt[0]) : undefined;
  const fmtY = (v: number): string => fmtTickAt(v, yStep);
  const fmtX = o.xTickFmt
    ? (v: number): string => (o.xTickFmt as (v: number, step?: number) => string)(v, xStep)
    : o.xLog
      ? fmtTick
      : (v: number): string => fmtTickAt(v, xStep);
  // y 刻度标签文本与其最大宽度（用于把 y 轴标题摆到数值左侧，避免重叠/裁剪）
  const yLabels = yt.map((v) => fmtY(v));
  let maxYW = 0;
  for (const l of yLabels) maxYW = Math.max(maxYW, measureText(l));

  // 网格
  ctx.strokeStyle = colors.grid;
  ctx.globalAlpha = 0.85;
  for (const tx of xt) {
    const px = Math.round(s.sx(tx)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, yTop);
    ctx.lineTo(px, yBot);
    ctx.stroke();
  }
  for (const ty of yt) {
    const py = Math.round(s.sy(ty)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(rect.x, py);
    ctx.lineTo(xR, py);
    ctx.stroke();
  }

  // 零线（实线，比网格略深）
  ctx.globalAlpha = 1;
  ctx.strokeStyle = colors.line;
  const zx = s.sx(0);
  if (zx >= rect.x && zx <= xR) {
    const px = Math.round(zx) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, yTop);
    ctx.lineTo(px, yBot);
    ctx.stroke();
  }
  const zy = s.sy(0);
  if (zy >= yTop && zy <= yBot) {
    const py = Math.round(zy) + 0.5;
    ctx.beginPath();
    ctx.moveTo(rect.x, py);
    ctx.lineTo(xR, py);
    ctx.stroke();
  }

  // 刻度文字（x：跳过会与上一个标签重叠的刻度，避免窄图数值相撞）
  ctx.fillStyle = colors.ink3;
  ctx.textAlign = 'center';
  let lastRight = -Infinity;
  for (const tx of xt) {
    const px = s.sx(tx);
    if (px < rect.x - 2 || px > xR + 2) continue;
    const label = fmtX(tx);
    const w = measureText(label);
    if (px - w / 2 < lastRight + 6) continue;
    ctx.fillText(label, px, yBot + 11);
    lastRight = px + w / 2;
  }
  // y：数值右对齐于轴左侧
  ctx.textAlign = 'right';
  for (let i = 0; i < yt.length; i++) {
    const py = s.sy(yt[i]);
    if (py < yTop - 2 || py > yBot + 2) continue;
    ctx.fillText(yLabels[i], rect.x - 8, py);
  }

  // 轴标签（y 轴标题置于刻度数值左侧，避免与数值重叠或被画布左缘裁剪）
  ctx.fillStyle = colors.ink2;
  ctx.textAlign = 'center';
  if (o.xLabel) ctx.fillText(o.xLabel, rect.x + rect.w / 2, yBot + 26);
  if (o.yLabel) {
    ctx.save();
    ctx.translate(Math.max(10, rect.x - 8 - maxYW - 12), rect.y + rect.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(o.yLabel, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/** 颜色解析：工具层习惯写 'var(--series-3)'，Canvas 不认 CSS 变量 → 从文档根解析为字面值 */
export function resolveColor(c: string | undefined, fallback = '#2456CC'): string {
  if (!c) return fallback;
  if (!c.includes('var(')) return c;
  if (typeof document === 'undefined') return fallback;
  const cs = getComputedStyle(document.documentElement);
  return c.replace(/var\(\s*(--[A-Za-z0-9-]+)\s*\)/g, (_m0: string, name: string) => cs.getPropertyValue(name).trim() || fallback);
}

export interface SeriesStyle {
  color: string;
  width?: number;
  dash?: number[];
  /** 辉光（受控 shadowBlur；剧场/高亮场景使用，静态图关闭） */
  glow?: number;
  alpha?: number;
  /** 面积填充色（折线与 y=0 基线之间；用于重叠面积、谱填充等） */
  fill?: string;
  /** 填充透明度（默认 0.3） */
  fillAlpha?: number;
}

/** 折线（超出可视范围的点自动跳过；点数多时逐段描边；fill 时先填面积再描线） */
export function drawLine(
  ctx: CanvasRenderingContext2D,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  s: Scales,
  rect: Rect,
  st: SeriesStyle,
): void {
  const n = Math.min(xs.length, ys.length);
  if (!n) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  if (st.fill) {
    const y0 = Math.max(rect.y, Math.min(rect.y + rect.h, s.sy(0)));
    ctx.save();
    ctx.globalAlpha = st.fillAlpha ?? 0.3;
    ctx.fillStyle = resolveColor(st.fill);
    ctx.beginPath();
    let started = false;
    let firstX = 0;
    let lastX = 0;
    for (let i = 0; i < n; i++) {
      const x = s.sx(xs[i]);
      const y = s.sy(ys[i]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (!started) {
        ctx.moveTo(x, y);
        firstX = x;
        started = true;
      } else ctx.lineTo(x, y);
      lastX = x;
    }
    if (started) {
      ctx.lineTo(lastX, y0);
      ctx.lineTo(firstX, y0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.strokeStyle = resolveColor(st.color);
  ctx.lineWidth = st.width ?? 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (st.dash) ctx.setLineDash(st.dash);
  if (st.glow) {
    ctx.shadowColor = st.color;
    ctx.shadowBlur = st.glow;
  }
  if (st.alpha != null) ctx.globalAlpha = st.alpha;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = s.sx(xs[i]);
    const y = s.sy(ys[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

export type MarkerKind = 'pole' | 'zero' | 'point';

export interface Marker {
  x: number;
  y: number;
  kind: MarkerKind;
  color?: string;
  size?: number;
  /** 高亮（聚光：其余元素降透明度由调用方负责） */
  focus?: boolean;
}

/** 极点 ✕ / 零点 ○ / 点 ●（教材符号：零极点符号与框图一致） */
export function drawMarkers(ctx: CanvasRenderingContext2D, s: Scales, markers: Marker[], colors: ChartColors): void {
  ctx.save();
  ctx.font = CHART_FONT;
  for (const m of markers) {
    const px = s.sx(m.x);
    const py = s.sy(m.y);
    const size = m.size ?? 6;
    const color = resolveColor(m.color, m.kind === 'zero' ? colors.accent2 : m.kind === 'pole' ? colors.accent : colors.ink2);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = m.focus ? 2.4 : 1.8;
    if (m.focus) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
    }
    ctx.beginPath();
    if (m.kind === 'pole') {
      ctx.moveTo(px - size, py - size);
      ctx.lineTo(px + size, py + size);
      ctx.moveTo(px + size, py - size);
      ctx.lineTo(px - size, py + size);
      ctx.stroke();
    } else if (m.kind === 'zero') {
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.arc(px, py, Math.max(2.5, size - 3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

/** 十字线与读数（悬停） */
export function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  colors: ChartColors,
  px: number,
  py: number,
  label?: string,
): void {
  ctx.save();
  ctx.strokeStyle = colors.accentLine;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(px, rect.y);
  ctx.lineTo(px, rect.y + rect.h);
  ctx.moveTo(rect.x, py);
  ctx.lineTo(rect.x + rect.w, py);
  ctx.stroke();
  ctx.setLineDash([]);
  if (label) {
    ctx.font = CHART_FONT;
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(label).width + 10;
    const bx = Math.min(px + 8, rect.x + rect.w - w - 2);
    const by = Math.max(rect.y + 2, py - 22);
    ctx.fillStyle = colors.panel;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.rect(bx, by, w, 18);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colors.line;
    ctx.stroke();
    ctx.fillStyle = colors.ink2;
    ctx.textAlign = 'left';
    ctx.fillText(label, bx + 5, by + 9);
  }
  ctx.restore();
}