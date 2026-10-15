import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { chartColors, drawFrame, fmtTickAt, invalidateChartColors, makeScales, measureText, setupHiDPI, type Rect, type Scales } from './canvas';
import { onThemeChange } from '../ui/theme';

/**
 * ComplexPlane — 复平面组件（s 平面 / z 平面共用）
 * 等比例坐标、稳定域着色（s：左半平面 / z：单位圆内）、零极点符号（✕ / ○）、拖拽移动、滚轮缩放。
 * 数据由调用方持有：onMove / onAdd / onDelete 写回。
 */

export interface CPMarker {
  re: number;
  im: number;
  kind: 'pole' | 'zero';
}

export interface ComplexPlaneProps {
  markers: CPMarker[];
  /** jw：s 平面（σ–jω）；unit：z 平面（Re–Im + 单位圆） */
  mode: 'jw' | 'unit';
  height?: number;
  /** 初始视野半径（实轴显示 [−halfW, halfW]） */
  halfW?: number;
  /** 收敛域遮罩（s 平面）：高亮 Re(s) > from 并标注（ROC 可视化，§4.11） */
  rocShade?: { from: number; label?: string } | null;
  /**
   * 自动取景键：键（+模式）变化时按 markers 包围盒与画布纵横比适配视野半径。
   * 拖动过程中键不变 → 不重取景，避免坐标系反馈抖动（缩放仍由滚轮控制）。
   */
  fitKey?: string;
  onMove?: (index: number, re: number, im: number, phase: 'move' | 'end') => void;
  onAdd?: (re: number, im: number) => void;
  onDelete?: (index: number) => void;
  onInsert?: (re: number, im: number) => void;
  class?: string;
}

export function ComplexPlane(props: ComplexPlaneProps) {
  const { markers, mode, height = 320, halfW = 4, rocShade, fitKey, onMove, onAdd, onDelete, onInsert, class: cls } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 480, h: height });
  const [zoom, setZoom] = useState(1);
  const [, setThemeRev] = useState(0);
  const dragRef = useRef<{ mode: 'marker'; index: number } | { mode: 'pan'; px: number; py: number; cx: number; cy: number } | null>(null);
  const viewRef = useRef({ cx: 0, cy: 0 });
  const fitRef = useRef<{ key: string; halfX: number }>({ key: '', halfX: halfW });

  useEffect(() => setZoom(1), [mode]);

  useEffect(
    () =>
      onThemeChange(() => {
        invalidateChartColors();
        setThemeRev((x) => x + 1);
      }),
    [],
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: Math.max(200, el.clientWidth), h: height }));
    ro.observe(el);
    setSize({ w: Math.max(200, el.clientWidth), h: height });
    return () => ro.disconnect();
  }, [height]);

  /** 等比例几何：单位长度像素相同，原点居中（可平移）；fitKey 变化时按包围盒取景 */
  const geom = (): { rect: Rect; s: Scales; unit: number; ox: number; oy: number } => {
    const h = Math.max(60, size.h - 24);
    // 左边距按 y 刻度数值实测宽度动态放宽（M18）：避免数值与 y 轴标题重叠、或被画布左缘裁剪
    let pad = 30;
    let rect: Rect = { x: pad, y: 12, w: Math.max(60, size.w - pad - 12), h };
    let s: Scales = makeScales({ xRange: [0, 1], yRange: [0, 1], rect });
    let halfX = halfW / zoom;
    const fitHalfX = (aspect: number): number => {
      if (fitKey == null) return halfW;
      const key = fitKey + '|' + mode;
      if (fitRef.current.key !== key) {
        let rx = 0.5;
        let ry = 0.5;
        for (const m of markers) {
          rx = Math.max(rx, Math.abs(m.re));
          ry = Math.max(ry, Math.abs(m.im));
        }
        fitRef.current = { key, halfX: Math.min(8, Math.max(halfW * 0.6, rx * 1.35, ry * aspect * 1.35)) };
      }
      return fitRef.current.halfX;
    };
    for (let it = 0; it < 3; it++) {
      const aspect = rect.w / rect.h;
      halfX = fitHalfX(aspect) / zoom;
      const halfY = halfX / Math.max(aspect, 0.05);
      const xRange: [number, number] = [viewRef.current.cx - halfX, viewRef.current.cx + halfX];
      const yRange: [number, number] = [viewRef.current.cy - halfY, viewRef.current.cy + halfY];
      s = makeScales({ xRange, yRange, rect });
      const yt = s.yTicks();
      const step = yt.length > 1 ? Math.abs(yt[1] - yt[0]) : undefined;
      let m = 0;
      for (const v of yt) m = Math.max(m, measureText(fmtTickAt(v, step)));
      const need = Math.max(30, Math.ceil(m) + 8 + 12 + 16);
      if (need <= pad + 0.5) break;
      pad = need;
      rect = { x: pad, y: 12, w: Math.max(60, size.w - pad - 12), h };
    }
    return { rect, s, unit: rect.w / (2 * halfX), ox: s.sx(0), oy: s.sy(0) };
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = setupHiDPI(canvas, size.w, size.h);
    if (!ctx) return;
    const colors = chartColors();
    ctx.clearRect(0, 0, size.w, size.h);
    const { rect, s, unit, ox, oy } = geom();

    // 稳定域着色
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    ctx.fillStyle = colors.ok;
    ctx.globalAlpha = 0.06;
    ctx.beginPath();
    if (mode === 'jw') {
      // 左半平面
      ctx.rect(rect.x, rect.y, Math.max(0, ox - rect.x), rect.h);
    } else {
      // 单位圆内
      ctx.arc(ox, oy, unit, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();

    // ROC 遮罩（s 平面）：填充先于网格，边界线与标注后于网格（保持清晰）
    const rocX = mode === 'jw' && rocShade ? Math.max(rect.x, Math.min(rect.x + rect.w, s.sx(rocShade.from))) : 0;
    if (mode === 'jw' && rocShade) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();
      ctx.fillStyle = colors.violet;
      ctx.globalAlpha = 0.08;
      ctx.fillRect(rocX, rect.y, rect.x + rect.w - rocX, rect.h);
      ctx.restore();
    }

    // 网格/轴
    drawFrame(ctx, s, rect, colors, {
      xLabel: mode === 'jw' ? 'σ' : 'Re',
      yLabel: mode === 'jw' ? 'jω' : 'Im',
    });

    // ROC 边界线 + 标注
    if (mode === 'jw' && rocShade) {
      ctx.save();
      ctx.strokeStyle = colors.violet;
      ctx.lineWidth = 1.3;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(rocX, rect.y);
      ctx.lineTo(rocX, rect.y + rect.h);
      ctx.stroke();
      ctx.setLineDash([]);
      if (rocShade.label) {
        ctx.fillStyle = colors.violet;
        ctx.font = '11px Consolas, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(rocShade.label, Math.min(rocX + 6, rect.x + rect.w - 108), rect.y + 4);
      }
      ctx.restore();
    }

    // 单位圆（z 平面）
    if (mode === 'unit') {
      ctx.save();
      ctx.strokeStyle = colors.accentLine;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(ox, oy, unit, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 零极点
    ctx.save();
    ctx.font = '11px Consolas, monospace';
    for (const m of markers) {
      const px = s.sx(m.re);
      const py = s.sy(m.im);
      const color = m.kind === 'zero' ? colors.accent2 : colors.accent;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2;
      const sz = 6;
      ctx.beginPath();
      if (m.kind === 'pole') {
        ctx.moveTo(px - sz, py - sz);
        ctx.lineTo(px + sz, py + sz);
        ctx.moveTo(px + sz, py - sz);
        ctx.lineTo(px - sz, py + sz);
        ctx.stroke();
      } else {
        ctx.arc(px, py, sz, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.9;
      ctx.fillText(m.kind === 'pole' ? '×' : '○', px + 9, py - 8);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }, [size, markers, mode, zoom, halfW, rocShade, fitKey, viewRef.current.cx, viewRef.current.cy]);

  useEffect(() => {
    draw();
  }, [draw]);

  const localPos = (e: PointerEvent | MouseEvent | WheelEvent): { px: number; py: number } => {
    const r = (canvasRef.current as HTMLCanvasElement).getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      setZoom((z) => Math.max(0.25, Math.min(8, z * (e.deltaY > 0 ? 1 / 1.15 : 1.15))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const hit = (px: number, py: number): number => {
    const { s } = geom();
    let best = -1;
    let bd = 13;
    markers.forEach((m, i) => {
      const d = Math.hypot(s.sx(m.re) - px, s.sy(m.im) - py);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };

  const onPointerDown = (e: PointerEvent): void => {
    const { px, py } = localPos(e);
    const mi = e.button === 0 ? hit(px, py) : -1;
    if (mi >= 0 && onMove) dragRef.current = { mode: 'marker', index: mi };
    else if (e.button === 0) dragRef.current = { mode: 'pan', px, py, cx: viewRef.current.cx, cy: viewRef.current.cy };
    else return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent): void => {
    const { px, py } = localPos(e);
    const d = dragRef.current;
    const { s } = geom();
    if (d?.mode === 'marker') {
      onMove?.(d.index, s.ix(px), s.iy(py), 'move');
      return;
    }
    if (d?.mode === 'pan') {
      const dx = s.ix(d.px) - s.ix(px);
      const dy = s.iy(d.py) - s.iy(py);
      viewRef.current = { cx: d.cx + dx, cy: d.cy + dy };
      draw();
    }
  };

  const onPointerUp = (e: PointerEvent): void => {
    const d = dragRef.current;
    if (d?.mode === 'marker') {
      const { px, py } = localPos(e);
      const { s } = geom();
      onMove?.(d.index, s.ix(px), s.iy(py), 'end');
    }
    dragRef.current = null;
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
        onDblClick={(e) => {
          const { px, py } = localPos(e as unknown as PointerEvent);
          const { s } = geom();
          onAdd?.(s.ix(px), s.iy(py));
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const { px, py } = localPos(e as unknown as PointerEvent);
          const mi = hit(px, py);
          if (mi >= 0) onDelete?.(mi);
          else {
            const { s } = geom();
            onInsert?.(s.ix(px), s.iy(py));
          }
        }}
        title="拖拽极零点 · 滚轮缩放 · 拖动空白平移 · 双击空白新增 · 右键删除/新增共轭"
      />
    </div>
  );
}