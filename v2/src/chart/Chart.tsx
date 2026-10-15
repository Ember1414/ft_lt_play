import { useCallback, useContext, useEffect, useRef, useState } from 'preact/hooks';
import {
  chartColors,
  clampSpan,
  drawCrosshair,
  drawFrame,
  drawLine,
  drawMarkers,
  fmtTick,
  fmtTickAt,
  invalidateChartColors,
  makeScales,
  measureText,
  setupHiDPI,
  type Marker,
  type Rect,
} from './canvas';
import { onThemeChange } from '../ui/theme';
import { ToolGroupContext } from '../tools/group';

/**
 * Chart — 交互式坐标图（图表层统一组件）
 * 能力：线性/对数轴、多序列、零极点标记（可拖拽）、滚轮缩放、拖动平移、双击复位、悬停读数。
 * 契约：数据决定论（同数据同图，无随机美化）；主题切换自动重绘。
 */

export interface ChartSeries {
  xs: ArrayLike<number>;
  ys: ArrayLike<number>;
  color?: string;
  width?: number;
  dash?: number[];
  glow?: number;
  alpha?: number;
  /** 面积填充色（折线与 y=0 基线之间）与透明度 */
  fill?: string;
  fillAlpha?: number;
}

export interface ChartProps {
  series: ChartSeries[];
  xRange: [number, number];
  yRange: [number, number];
  xLog?: boolean;
  xLabel?: string;
  yLabel?: string;
  height?: number;
  markers?: Marker[];
  zoom?: boolean;
  pan?: boolean;
  hover?: boolean;
  onViewChange?: (x: [number, number], y: [number, number]) => void;
  onMarkerDrag?: (index: number, x: number, y: number, phase: 'move' | 'end') => void;
  /** 自定义 x 刻度格式；第二参数 = 当前刻度步长（按缩放自适应精度，避免标签重复） */
  xTickFmt?: (v: number, step?: number) => string;
  class?: string;
}

const MARGIN = { l: 46, r: 14, t: 16, b: 36 };

/* ---------- 主序列注册表（M5：对比实验 A/B 真实曲线同屏叠加） ----------
   每个 <Chart> 挂载后把「数据序列 + 数据范围 + 像素面积」登记到模块级表；
   getPrimarySeries() 取当前面积最大的一张（即工作区主图），供 A/B 槽冻结真实曲线数据
   （相对「缩略图像素合成」，真实数据叠加能直接看出两条曲线在哪一段分叉）。 */
export interface PrimarySeries {
  /** 实例分组（'' = 工作区实例；对比页实例用 'ab-a'/'ab-b'） */
  group: string;
  series: ChartSeries[];
  xRange: [number, number];
  yRange: [number, number];
  xLog: boolean;
  area: number;
}
const PRIMARY = new Map<number, PrimarySeries>();
let PRIMARY_ID = 1;
/** 工作区（默认组）主图：面积最大者 */
export function getPrimarySeries(): PrimarySeries | null {
  return getSeriesByGroup('');
}
/** 指定分组的主图：面积最大者（M7 对比页按 'ab-a' / 'ab-b' 取回两条真实曲线） */
export function getSeriesByGroup(group: string): PrimarySeries | null {
  let best: PrimarySeries | null = null;
  for (const v of PRIMARY.values()) if (v.group === group && (!best || v.area > best.area)) best = v;
  return best;
}

export function Chart(props: ChartProps) {
  const {
    series,
    xRange,
    yRange,
    xLog = false,
    xLabel,
    yLabel,
    height = 320,
    markers,
    zoom = true,
    pan = true,
    hover = true,
    onViewChange,
    onMarkerDrag,
    xTickFmt,
    class: cls,
  } = props;

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 640, h: height });
  const [view, setView] = useState<{ x: [number, number]; y: [number, number] }>({ x: xRange, y: yRange });
  const [, setThemeRev] = useState(0);
  const [hoverPt, setHoverPt] = useState<{ px: number; py: number; label: string } | null>(null);
  const drag = useRef<
    | { mode: 'pan'; px: number; py: number; vx: [number, number]; vy: [number, number] }
    | { mode: 'marker'; index: number }
    | null
  >(null);

  // 外部范围变化 → 同步视图
  useEffect(() => setView({ x: xRange, y: yRange }), [xRange[0], xRange[1], yRange[0], yRange[1]]);

  // 主题切换 → 刷新颜色并重绘
  useEffect(
    () =>
      onThemeChange(() => {
        invalidateChartColors();
        setThemeRev((x) => x + 1);
      }),
    [],
  );

  // 尺寸自适应
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = Math.max(220, el.clientWidth);
      setSize({ w, h: height });
    });
    ro.observe(el);
    setSize({ w: Math.max(220, el.clientWidth), h: height });
    return () => ro.disconnect();
  }, [height]);

  // 主序列注册（M5/M7）：把本图数据登记到模块级表（同组内面积最大者即该实例主图）
  const group = useContext(ToolGroupContext);
  const regIdRef = useRef<number | null>(null);
  if (regIdRef.current == null) regIdRef.current = PRIMARY_ID++;
  useEffect(() => {
    const id = regIdRef.current as number;
    if (!series.length) {
      PRIMARY.delete(id);
      return;
    }
    PRIMARY.set(id, { group, series, xRange, yRange, xLog, area: size.w * size.h });
  }, [group, series, xRange, yRange, xLog, size]);
  useEffect(
    () => () => {
      if (regIdRef.current != null) PRIMARY.delete(regIdRef.current);
    },
    [],
  );

  // 左边距按 y 刻度数值的实测宽度动态放宽：避免数值与 y 轴标题重叠、或被画布左缘裁剪（M18）
  const leftPad = ((): number => {
    const probe: Rect = {
      x: MARGIN.l,
      y: MARGIN.t,
      w: Math.max(60, size.w - MARGIN.l - MARGIN.r),
      h: Math.max(60, size.h - MARGIN.t - MARGIN.b),
    };
    const ps = makeScales({ xRange: view.x, yRange: view.y, xLog, rect: probe });
    const yt = ps.yTicks();
    const step = yt.length > 1 ? Math.abs(yt[1] - yt[0]) : undefined;
    let m = 0;
    for (const v of yt) m = Math.max(m, measureText(fmtTickAt(v, step)));
    return Math.max(MARGIN.l, Math.ceil(m) + 8 + 12 + 16);
  })();
  const rect: Rect = {
    x: leftPad,
    y: MARGIN.t,
    w: Math.max(60, size.w - leftPad - MARGIN.r),
    h: Math.max(60, size.h - MARGIN.t - MARGIN.b),
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = setupHiDPI(canvas, size.w, size.h);
    if (!ctx) return;
    const colors = chartColors();
    ctx.clearRect(0, 0, size.w, size.h);
    const s = makeScales({ xRange: view.x, yRange: view.y, xLog, rect });
    drawFrame(ctx, s, rect, colors, { xLabel, yLabel, xTickFmt, xLog });
    series.forEach((se, i) => {
      drawLine(ctx, se.xs, se.ys, s, rect, {
        color: se.color ?? colors.series[i % colors.series.length],
        width: se.width ?? 2,
        dash: se.dash,
        glow: se.glow,
        alpha: se.alpha,
        fill: se.fill,
        fillAlpha: se.fillAlpha,
      });
    });
    if (markers && markers.length) drawMarkers(ctx, s, markers, colors);
    if (hoverPt) drawCrosshair(ctx, rect, colors, hoverPt.px, hoverPt.py, hoverPt.label);
  }, [size, view, xLog, xLabel, yLabel, xTickFmt, series, markers, hoverPt, rect.x, rect.y, rect.w, rect.h]);

  useEffect(() => {
    draw();
  }, [draw]);

  const scales = (): ReturnType<typeof makeScales> => makeScales({ xRange: view.x, yRange: view.y, xLog, rect });

  const toData = (px: number, py: number): { x: number; y: number } => {
    const s = scales();
    return { x: s.ix(px), y: s.iy(py) };
  };

  const hitMarker = (px: number, py: number): number => {
    if (!markers) return -1;
    const s = scales();
    let best = -1;
    let bd = 12;
    markers.forEach((m, i) => {
      const d = Math.hypot(s.sx(m.x) - px, s.sy(m.y) - py);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };

  const localPos = (e: PointerEvent | MouseEvent | WheelEvent): { px: number; py: number } => {
    const r = (canvasRef.current as HTMLCanvasElement).getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };

  // 滚轮缩放（X 轴；Shift → Y 轴）。手动绑定以取得 passive:false
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !zoom) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const { px, py } = localPos(e);
      const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      const d = toData(px, py);
      setView((v) => {
        const nx = e.shiftKey ? v.x : ([d.x + (v.x[0] - d.x) * k, d.x + (v.x[1] - d.x) * k] as [number, number]);
        const ny = e.shiftKey ? ([d.y + (v.y[0] - d.y) * k, d.y + (v.y[1] - d.y) * k] as [number, number]) : (v.y as [number, number]);
        const next = {
          x: xLog ? ([Math.max(nx[0], 1e-9), Math.max(nx[1], 1e-8)] as [number, number]) : clampSpan(nx, xRange),
          y: clampSpan(ny, yRange),
        };
        onViewChange?.(next.x, next.y);
        return next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint 无；依赖有意收窄
  }, [zoom, xLog, rect.x, rect.y, rect.w, rect.h, view]);

  const onPointerDown = (e: PointerEvent): void => {
    const { px, py } = localPos(e);
    const mi = e.button === 0 ? hitMarker(px, py) : -1;
    if (mi >= 0 && onMarkerDrag) {
      drag.current = { mode: 'marker', index: mi };
    } else if (pan && e.button === 0) {
      drag.current = { mode: 'pan', px, py, vx: view.x, vy: view.y };
    } else return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent): void => {
    const { px, py } = localPos(e);
    const d = drag.current;
    if (d?.mode === 'marker') {
      const md = toData(px, py);
      onMarkerDrag?.(d.index, md.x, md.y, 'move');
      return;
    }
    if (d?.mode === 'pan') {
      const s = makeScales({ xRange: d.vx, yRange: d.vy, xLog, rect });
      // 视图随指针反向移动：数据位移 = 起点数据值 − 当前数据值
      const dxData = s.ix(d.px) - s.ix(px);
      const dyData = s.iy(d.py) - s.iy(py);
      const nx = [d.vx[0] + dxData, d.vx[1] + dxData] as [number, number];
      const ny = [d.vy[0] + dyData, d.vy[1] + dyData] as [number, number];
      const next = {
        x: xLog ? ([Math.max(nx[0], 1e-9), Math.max(nx[1], 1e-8)] as [number, number]) : nx,
        y: ny,
      };
      setView(next);
      onViewChange?.(next.x, next.y);
      return;
    }
    if (!hover || px < rect.x || px > rect.x + rect.w || py < rect.y || py > rect.y + rect.h) {
      setHoverPt(null);
      return;
    }
    // 悬停：找最近数据点
    let bestLabel: string | null = null;
    let bestPy = py;
    let bestDx = 14;
    const s2 = scales();
    series.forEach((se) => {
      for (let i = 0; i < Math.min(se.xs.length, se.ys.length); i++) {
        const sxv = s2.sx(se.xs[i]);
        const ddx = Math.abs(sxv - px);
        if (ddx < bestDx) {
          bestDx = ddx;
          bestPy = s2.sy(se.ys[i]);
          bestLabel = `x=${fmtTick(se.xs[i])}  y=${fmtTick(se.ys[i])}`;
        }
      }
    });
    if (bestLabel) setHoverPt({ px, py: bestPy, label: bestLabel });
    else setHoverPt(null);
  };

  const onPointerUp = (e: PointerEvent): void => {
    const d = drag.current;
    if (d?.mode === 'marker') {
      const { px, py } = localPos(e);
      const md = toData(px, py);
      onMarkerDrag?.(d.index, md.x, md.y, 'end');
    }
    drag.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* 已释放 */
    }
  };

  return (
    <div ref={wrapRef} class={'chart' + (cls ? ' ' + cls : '')} style={{ height: height + 'px' }}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHoverPt(null)}
        onDblClick={() => {
          setView({ x: xRange, y: yRange });
          onViewChange?.(xRange, yRange);
        }}
        title="滚轮缩放（Shift 缩放 Y）· 拖动平移 · 双击复位"
      />
    </div>
  );
}