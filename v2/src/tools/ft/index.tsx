import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { linear } from '../../anim/easing';
import { createTimeline, type Timeline } from '../../anim/timeline';
import { chartColors, invalidateChartColors, setupHiDPI } from '../../chart/canvas';
import { Chart, type ChartSeries } from '../../chart/Chart';
import { FieldGroup, Metric, SegmentedChips, SliderField, StatusBadge, Switch } from '../../ui/components';
import { TeX } from '../../ui/TeX';
import { onThemeChange } from '../../ui/theme';
import { customShapePoints, dftPhasors, shapePoints, type Complex } from '../../core';
import { createUndoStack } from '../../state/undo';
import { getModuleState, setModuleState } from '../../state/experiments';
import { useExperimentSync } from '../useSync';
import type { ToolViewProps } from '../api';

/**
 * 傅立叶级数（ft）
 * 三视图：画圈套画圈（DFT 相量链 + 轨迹拖尾 + 对比模式 + 手绘自定义 + 谐波幅度谱）/
 *        谐波叠加（方波逐步合成 + Gibbs 现象 + RMS 误差）/ 3D 瀑布（谐波分量族 + 部分和）。
 * 动画：自研时间轴引擎（确定性帧驱动，可逐帧、可变速 0.25×–2×；1× = 基波 5 s/圈，见 CYCLE_SEC）。
 */

/** 画圈动画：1× 时基波走完一圈的秒数（手感基准；0.25× = 20 s、2× = 2.5 s） */
const CYCLE_SEC = 5;

type ViewId = 'circles' | 'harmonics' | 'waterfall';

interface Pt {
  x: number;
  y: number;
}

interface FtParams {
  view: ViewId;
  shape: string;
  /** 手绘笔迹（抽稀像素坐标，≤256 点；用于实验恢复） */
  custom: Pt[];
  terms: number;
  speed: number;
  showCircles: boolean;
  compare: boolean;
  cmpTerms: number;
  playing: boolean;
}

const DEFAULT: FtParams = {
  view: 'circles',
  shape: 'square',
  custom: [],
  terms: 40,
  speed: 1,
  showCircles: true,
  compare: false,
  cmpTerms: 4,
  playing: true,
};

const VIEWS: ReadonlyArray<{ value: ViewId; label: string }> = [
  { value: 'circles', label: '画圈套画圈' },
  { value: 'harmonics', label: '谐波叠加' },
  { value: 'waterfall', label: '3D 瀑布' },
];

const VIEW_HINTS: Record<ViewId, string> = {
  circles: '任意闭合路径经 DFT 分解为相量链：每圈半径 = |cₖ|，初相 = ∠cₖ；轨迹随 t 生长（拖尾）。',
  harmonics: '方波 = 奇次正弦叠加 Sₙ(t) = (4/π)·Σ sin((2k−1)·2πt)/(2k−1)；跳变处 9% 过冲为 Gibbs 现象。',
  waterfall: '各次谐波分量沿 k 轴排成瀑布族；拖动旋转、滚轮缩放，观察部分和如何逐项逼近方波。',
};

const SHAPES: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'square', name: '方形路径' },
  { id: 'triangle', name: '三角' },
  { id: 'heart', name: '爱心' },
  { id: 'star', name: '五角星' },
  { id: 'butterfly', name: '蝴蝶' },
  { id: 'gear', name: '齿轮' },
  { id: 'spiral', name: '螺旋' },
  { id: 'custom', name: '✎ 手绘' },
];

const H_CIRC = 400;
const TRACE_CAP = 4000;

const nf = (v: number | null | undefined, d = 3): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  return String(+v.toFixed(d));
};

/* —— 方波级数（v1 同式） —— */
const squarePartial = (t: number): number => {
  const p = t % 1;
  return p < 0.5 ? 1 : -1;
};
const squareSum = (t: number, n: number): number => {
  let s = 0;
  for (let k = 1; k <= n; k++) s += Math.sin(2 * Math.PI * (2 * k - 1) * t) / (2 * k - 1);
  return (4 / Math.PI) * s;
};

function sanitize(raw: unknown): FtParams {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<FtParams>;
  const views: ViewId[] = ['circles', 'harmonics', 'waterfall'];
  const shapeOk = SHAPES.some((s) => s.id === r.shape);
  const custom: Pt[] = Array.isArray(r.custom)
    ? r.custom
        .filter((p): p is Pt => !!p && typeof p === 'object' && Number.isFinite((p as Pt).x) && Number.isFinite((p as Pt).y))
        .slice(0, 256)
        .map((p) => ({ x: p.x, y: p.y }))
    : [];
  return {
    view: views.includes(r.view as ViewId) ? (r.view as ViewId) : DEFAULT.view,
    shape: shapeOk ? (r.shape as string) : DEFAULT.shape,
    custom,
    terms: Number.isFinite(r.terms) ? Math.max(1, Math.min(60, Math.round(r.terms as number))) : DEFAULT.terms,
    speed: Number.isFinite(r.speed) ? Math.max(0.25, Math.min(2, r.speed as number)) : DEFAULT.speed,
    showCircles: r.showCircles !== false,
    compare: r.compare === true,
    cmpTerms: Number.isFinite(r.cmpTerms) ? Math.max(1, Math.min(60, Math.round(r.cmpTerms as number))) : DEFAULT.cmpTerms,
    playing: r.playing !== false,
  };
}

/** 复数点列 → SVG 多段线点串（世界坐标，y 取反） */
function svgPolyline(P: Complex[], stride = 1): string {
  const out: string[] = [];
  for (let i = 0; i < P.length; i += stride) out.push(P[i].re.toFixed(4) + ',' + (-P[i].im).toFixed(4));
  return out.join(' ');
}

/** 画圈视图导出：目标路径（虚线）+ 当前合成轨迹 */
function svgOfCircles(pts: Complex[], trace: number[]): string {
  const tail: Complex[] = [];
  for (let i = 0; i + 1 < trace.length; i += 2) tail.push({ re: trace[i], im: trace[i + 1] });
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1.5 -1.5 3 3" width="900" height="900">' +
    '<rect x="-1.5" y="-1.5" width="3" height="3" fill="#ffffff"/>' +
    '<polyline points="' + svgPolyline(pts) + '" fill="none" stroke="#7B8492" stroke-width="0.008" stroke-dasharray="0.03 0.02"/>' +
    '<polyline points="' + svgPolyline(tail) + '" fill="none" stroke="#0C7C6B" stroke-width="0.012" stroke-linejoin="round"/>' +
    '</svg>'
  );
}

function svgOfHarmonics(n: number): string {
  const pts: string[] = [];
  for (let i = 0; i <= 1200; i++) {
    const t = (i / 1200) * 2;
    pts.push((t - 1).toFixed(4) + ',' + (-squareSum(t, n) / 1.6).toFixed(4));
  }
  const tgt: string[] = [];
  for (let i = 0; i <= 1200; i++) {
    const t = (i / 1200) * 2;
    tgt.push((t - 1).toFixed(4) + ',' + (-squarePartial(t) / 1.6).toFixed(4));
  }
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1.05 -0.8 2.1 1.6" width="960" height="640">' +
    '<rect x="-1.05" y="-0.8" width="2.1" height="1.6" fill="#ffffff"/>' +
    '<polyline points="' + tgt.join(' ') + '" fill="none" stroke="#A15C06" stroke-width="0.008"/>' +
    '<polyline points="' + pts.join(' ') + '" fill="none" stroke="#2456CC" stroke-width="0.01"/>' +
    '</svg>'
  );
}

function downloadText(name: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ================= 手绘画板（左栏小画布） ================= */

function DrawPad(props: { initial: Pt[]; onDone: (pts: Pt[]) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ptsRef = useRef<Pt[]>(props.initial.slice());
  const drawingRef = useRef(false);
  const [note, setNote] = useState('');
  const H = 170;

  const repaint = (): void => {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const W = Math.max(120, wrap.clientWidth);
    const ctx = setupHiDPI(cv, W, H);
    if (!ctx) return;
    const colors = chartColors();
    ctx.clearRect(0, 0, W, H);
    const P = ptsRef.current;
    if (!P.length) {
      ctx.fillStyle = colors.ink3;
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('在此画一条闭合曲线（松手生成）', W / 2, H / 2);
      return;
    }
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < P.length; i++) {
      if (i) ctx.lineTo(P[i].x, P[i].y);
      else ctx.moveTo(P[i].x, P[i].y);
    }
    if (!drawingRef.current) ctx.closePath();
    ctx.stroke();
  };

  useEffect(() => {
    repaint();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => repaint());
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint 无
  }, []);

  useEffect(() => onThemeChange(() => {
    invalidateChartColors();
    repaint();
  }), []);

  const localPos = (e: PointerEvent): Pt => {
    const r = (canvasRef.current as HTMLCanvasElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div class="chart" ref={wrapRef} style={{ height: H + 'px' }}>
      {note ? (
        <p class="muted" style="margin:0 0 4px">
          {note}
        </p>
      ) : null}
      <canvas
        ref={canvasRef}
        title="按住拖动绘制闭合曲线；松手后自动重采样并分解为相量"
        onPointerDown={(e) => {
          drawingRef.current = true;
          ptsRef.current = [];
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } catch {
            /* 指针捕获不可用时退化为普通拖动 */
          }
          const p = localPos(e as unknown as PointerEvent);
          ptsRef.current.push(p);
          repaint();
        }}
        onPointerMove={(e) => {
          if (!drawingRef.current) return;
          const p = localPos(e as unknown as PointerEvent);
          const last = ptsRef.current[ptsRef.current.length - 1];
          if (last && Math.hypot(p.x - last.x, p.y - last.y) < 2) return;
          ptsRef.current.push(p);
          repaint();
        }}
        onPointerUp={() => {
          if (!drawingRef.current) return;
          drawingRef.current = false;
          repaint();
          const P = ptsRef.current;
          let L = 0;
          for (let i = 1; i < P.length; i++) L += Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y);
          if (L >= 40) {
            setNote('');
            const stride = Math.max(1, Math.ceil(P.length / 256));
            props.onDone(P.filter((_, i) => i % stride === 0));
          } else {
            setNote('笔迹太短（< 40 px），请画一条更长的闭合曲线');
          }
        }}
        onPointerCancel={() => {
          drawingRef.current = false;
        }}
      />
    </div>
  );
}

/* ================= 画圈套画圈（Canvas 命令式，时间轴引擎驱动） ================= */

function CirclesCanvas(props: {
  pts: Complex[];
  phasors: ReturnType<typeof dftPhasors>;
  params: FtParams;
  onViewChange: () => void;
  canvasRef: { current: HTMLCanvasElement | null };
  /** 时间轴实例（供主工具播放/逐帧/重置按钮调用） */
  tlRef: { current: Timeline | null };
  /** 当前轨迹拖尾（世界坐标，供 SVG 导出） */
  traceRef: { current: number[] };
}) {
  const { pts, phasors, params } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const stRef = useRef({ t: 0, tail: [] as number[], tailC: [] as number[], k: 1, cx: 0, cy: 0 });
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const ptsRef = useRef(pts);
  ptsRef.current = pts;
  const phRef = useRef(phasors);
  phRef.current = phasors;
  const dragRef = useRef<Pt | null>(null);
  const pinchRef = useRef<{ base: number; ids: number[] } | null>(null);
  const pointers = useRef(new Map<number, Pt>());

  const size = (): { W: number; H: number } => ({ W: Math.max(200, wrapRef.current?.clientWidth ?? 400), H: H_CIRC });
  const baseScale = (): number => Math.min(size().W, H_CIRC) * 0.32;

  const chainAt = (t: number, count: number): Array<{ x: number; y: number; amp: number; k: number }> => {
    const arr: Array<{ x: number; y: number; amp: number; k: number }> = [{ x: 0, y: 0, amp: 0, k: 0 }];
    let x = 0;
    let y = 0;
    const ph = phRef.current;
    for (let j = 0; j < count && j < ph.length; j++) {
      const p = ph[j];
      const ang = p.phase + 2 * Math.PI * p.k * t;
      x += p.amp * Math.cos(ang);
      y += p.amp * Math.sin(ang);
      arr.push({ x, y, amp: p.amp, k: p.k });
    }
    return arr;
  };

  const draw = (): void => {
    const cv = props.canvasRef.current;
    if (!cv) return;
    const { W, H } = size();
    const ctx = setupHiDPI(cv, W, H);
    if (!ctx) return;
    const colors = chartColors();
    const st = stRef.current;
    const pr = paramsRef.current;
    ctx.clearRect(0, 0, W, H);

    const cx = W / 2;
    const cy = H / 2;
    const s = baseScale() * st.k;
    const SX = (x: number): number => cx + (x - st.cx) * s;
    const SY = (y: number): number => cy - (y - st.cy) * s;
    const rect = { x: 0, y: 0, w: W, h: H };

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();

    // 目标路径（虚线）
    const P = ptsRef.current;
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = colors.ink3;
    ctx.lineWidth = 1.2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < P.length; i++) {
      const px = SX(P[i].re);
      const py = SY(P[i].im);
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    if (paramsRef.current.shape !== 'spiral' && paramsRef.current.shape !== 'custom') ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    const main = chainAt(st.t, Math.min(pr.terms, phRef.current.length));
    if (pr.showCircles) {
      for (let j = 1; j < main.length; j++) {
        const c = main[j - 1];
        const n = main[j];
        const r = n.amp * s;
        if (r < 0.5 || n.k === 0) continue;
        ctx.beginPath();
        ctx.strokeStyle = j % 2 ? colors.accent : colors.accent2;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = r > 60 ? 1.35 : 1;
        ctx.arc(SX(c.x), SY(c.y), r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(SX(c.x), SY(c.y));
        ctx.lineTo(SX(n.x), SY(n.y));
        ctx.strokeStyle = colors.ink3;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // 对比圈数轨迹（不同项数叠加，§4.11）
    if (pr.compare) {
      const cmp = chainAt(st.t, Math.min(pr.cmpTerms, phRef.current.length));
      const ct = cmp[cmp.length - 1];
      st.tailC.push(ct.x, ct.y);
      if (st.tailC.length > TRACE_CAP) st.tailC.splice(0, 2);
      ctx.strokeStyle = colors.violet;
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      for (let i = 0; i < st.tailC.length / 2; i++) {
        const px = SX(st.tailC[i * 2]);
        const py = SY(st.tailC[i * 2 + 1]);
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(SX(ct.x), SY(ct.y), 3.2, 0, Math.PI * 2);
      ctx.fillStyle = colors.violet;
      ctx.fill();
    }

    // 主轨迹拖尾
    const tip = main[main.length - 1];
    st.tail.push(tip.x, tip.y);
    if (st.tail.length > TRACE_CAP) st.tail.splice(0, 2);
    props.traceRef.current = st.tail;
    ctx.strokeStyle = colors.ok;
    ctx.lineWidth = 2.6;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = colors.ok;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    for (let i = 0; i < st.tail.length / 2; i++) {
      const px = SX(st.tail[i * 2]);
      const py = SY(st.tail[i * 2 + 1]);
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.arc(SX(tip.x), SY(tip.y), 4.5, 0, Math.PI * 2);
    ctx.fillStyle = colors.accent;
    ctx.fill();
    ctx.restore();

    // 顶部状态文字
    ctx.fillStyle = colors.ink3;
    ctx.font = '11px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const hint = paramsRef.current.shape === 'custom' && !P.length ? ' · 请先在左栏 ✎ 手绘板画一条闭合曲线' : '';
    ctx.fillText(
      '圈数 = ' + Math.min(pr.terms, phRef.current.length) + ' · 最大幅值 ≈ ' + nf(phRef.current[0]?.amp ?? 0, 3) + ' · 缩放 ' + st.k.toFixed(1) + '×' + hint,
      12,
      12,
    );
  };

  const drawRef = useRef(draw);
  drawRef.current = draw;

  // 时间轴（一次创建；确定性帧驱动，linear 缓动保证匀速旋转）
  const tlRef = useRef<Timeline | null>(null);
  useEffect(() => {
    const tl = createTimeline({
      // duration = 一圈的秒数：1× 时基波 5 s/圈（原为 1 s/圈，实测过快）
      duration: CYCLE_SEC,
      loop: true,
      easing: linear,
      onFrame: (_raw, t) => {
        const st = stRef.current;
        if (t < st.t) {
          st.tail = [];
          st.tailC = [];
        }
        st.t = t;
        drawRef.current();
      },
    });
    tlRef.current = tl;
    props.tlRef.current = tl;
    return () => {
      tl.destroy();
      tlRef.current = null;
      props.tlRef.current = null;
    };
  }, []);

  // 播放状态 / 速度 / 视图 与时间轴同步（离开画圈视图时暂停，避免空转）
  useEffect(() => {
    const tl = tlRef.current;
    if (!tl) return;
    if (params.playing && params.view === 'circles') tl.play();
    else tl.pause();
    tl.setSpeed(params.speed);
  }, [params.playing, params.speed, params.view]);

  // 形状 / 圈数 / 显示变化 → 清拖尾重画
  useEffect(() => {
    stRef.current.tail = [];
    stRef.current.tailC = [];
    drawRef.current();
  }, [pts, phasors, params.terms, params.cmpTerms, params.compare, params.showCircles, params.shape]);

  // 尺寸 / 主题
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => drawRef.current());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);
  useEffect(() => onThemeChange(() => {
    invalidateChartColors();
    drawRef.current();
  }), []);

  useEffect(() => {
    const cv = props.canvasRef.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const st = stRef.current;
      const { W } = size();
      const r = cv.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const s0 = baseScale() * st.k;
      const wx = st.cx + (px - W / 2) / s0;
      const wy = st.cy - (py - H_CIRC / 2) / s0;
      st.k = Math.max(0.3, Math.min(30, st.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      const s1 = baseScale() * st.k;
      st.cx = wx - (px - W / 2) / s1;
      st.cy = wy + (py - H_CIRC / 2) / s1;
      drawRef.current();
      props.onViewChange();
    };
    cv.addEventListener('wheel', onWheel, { passive: false });
    return () => cv.removeEventListener('wheel', onWheel);
    // eslint 无
  }, [props.canvasRef, props.onViewChange]);

  const onPointerDown = (e: PointerEvent): void => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchRef.current = { base: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), ids: [...pointers.current.keys()] };
      dragRef.current = null;
    } else if (pointers.current.size === 1) {
      dragRef.current = { x: e.clientX, y: e.clientY };
    }
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* 指针捕获不可用 */
    }
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!pointers.current.has(e.pointerId)) return;
    const prev = pointers.current.get(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const st = stRef.current;
    if (pointers.current.size >= 2 && pinchRef.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.max(20, Math.hypot(a.x - b.x, a.y - b.y));
      const s0 = baseScale() * st.k;
      const { W } = size();
      const r = (props.canvasRef.current as HTMLCanvasElement).getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - r.left;
      const my = (a.y + b.y) / 2 - r.top;
      const wx = st.cx + (mx - W / 2) / s0;
      const wy = st.cy - (my - H_CIRC / 2) / s0;
      st.k = Math.max(0.3, Math.min(30, st.k * (d / pinchRef.current.base)));
      const s1 = baseScale() * st.k;
      st.cx = wx - (mx - W / 2) / s1;
      st.cy = wy + (my - H_CIRC / 2) / s1;
      pinchRef.current.base = d;
      drawRef.current();
      return;
    }
    if (!dragRef.current || !prev) return;
    const s = baseScale() * st.k;
    st.cx -= (e.clientX - prev.x) / s;
    st.cy += (e.clientY - prev.y) / s;
    drawRef.current();
  };

  const onPointerUp = (e: PointerEvent): void => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    if (pointers.current.size === 0) {
      dragRef.current = null;
      props.onViewChange();
    }
  };

  return (
    <div class="chart" ref={wrapRef} style={{ height: H_CIRC + 'px' }}>
      <canvas
        ref={props.canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDblClick={() => {
          stRef.current.k = 1;
          stRef.current.cx = 0;
          stRef.current.cy = 0;
          drawRef.current();
          props.onViewChange();
        }}
        title="拖动平移 · 滚轮缩放 · 双击复位；虚线 = 目标路径，绿线 = 合成轨迹拖尾"
      />
    </div>
  );
}

/* ================= 3D 瀑布（自写投影：拖动旋转 / 滚轮缩放 / 双击复位） ================= */

function Waterfall(props: { terms: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stRef = useRef({ yaw: -0.62, pitch: 0.42, zoom: 1 });
  const termsRef = useRef(props.terms);
  termsRef.current = props.terms;
  const pointers = useRef(new Map<number, Pt>());
  const pinchRef = useRef(0);
  const H = 400;

  const project = (x: number, y: number, z: number, W: number, HH: number): { X: number; Y: number } => {
    const st = stRef.current;
    const cy = Math.cos(st.yaw);
    const sy = Math.sin(st.yaw);
    const X = x * cy - z * sy;
    const Z0 = x * sy + z * cy;
    const cp = Math.cos(st.pitch);
    const sp = Math.sin(st.pitch);
    const Y = y * cp - Z0 * sp;
    const Z = y * sp + Z0 * cp;
    const persp = 4.2;
    const s = (persp / (persp - Z)) * st.zoom * Math.min(W, HH) * 0.3;
    return { X: W / 2 + X * s, Y: HH / 2 - Y * s };
  };

  const draw = (): void => {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const W = Math.max(280, wrap.clientWidth);
    const ctx = setupHiDPI(cv, W, H);
    if (!ctx) return;
    const colors = chartColors();
    ctx.clearRect(0, 0, W, H);
    const n = Math.min(termsRef.current, 60);
    const NT = 160;
    const Z0 = 0;
    const Z1 = 1.7;
    const axes: Array<[[number, number, number], [number, number, number]]> = [
      [[-1.25, 0, Z0], [1.25, 0, Z0]],
      [[-1.25, 0, Z0], [-1.25, 1.15, Z0]],
      [[-1.25, 0, Z0], [-1.25, 0, Z1]],
    ];
    ctx.lineWidth = 1.2;
    for (const [a, b] of axes) {
      const pa = project(a[0], a[1], a[2], W, H);
      const pb = project(b[0], b[1], b[2], W, H);
      ctx.strokeStyle = colors.accentLine;
      ctx.beginPath();
      ctx.moveTo(pa.X, pa.Y);
      ctx.lineTo(pb.X, pb.Y);
      ctx.stroke();
    }
    ctx.fillStyle = colors.ink3;
    ctx.font = '10px Consolas, monospace';
    ctx.textAlign = 'center';
    for (const tv of [0, 0.5, 1, 1.5, 2]) {
      const p = project(-1.25 + (tv / 2) * 2.5, 0, Z0, W, H);
      ctx.fillText(String(tv), p.X, p.Y + 12);
    }
    ctx.textAlign = 'left';
    const pEnd = project(1.25, 0, Z0, W, H);
    ctx.fillText('t →', pEnd.X - 24, pEnd.Y + 12);
    const pK = project(-1.25, 0, Z1, W, H);
    ctx.fillText('k →', pK.X, pK.Y - 6);

    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      const t = -1.25 + (i / 8) * 2.5;
      const a = project(t, 0, Z0, W, H);
      const b = project(t, 0, Z1, W, H);
      ctx.beginPath();
      ctx.moveTo(a.X, a.Y);
      ctx.lineTo(b.X, b.Y);
      ctx.stroke();
    }
    for (let j = 0; j <= 4; j++) {
      const z = Z0 + (j / 4) * (Z1 - Z0);
      const a = project(-1.25, 0, z, W, H);
      const b = project(1.25, 0, z, W, H);
      ctx.beginPath();
      ctx.moveTo(a.X, a.Y);
      ctx.lineTo(b.X, b.Y);
      ctx.stroke();
    }

    const K = Math.min(Math.max(n, 1), 20);
    for (let ki = K; ki >= 1; ki--) {
      const z = Z0 + ((K - ki) / Math.max(1, K - 1)) * (Z1 - Z0);
      const amp = 4 / (Math.PI * (2 * ki - 1));
      const hue = 200 + (ki / Math.max(1, K)) * 130;
      ctx.strokeStyle = K > 1 ? 'hsla(' + hue + ', 75%, 64%, 0.95)' : colors.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i <= NT; i++) {
        const t = (i / NT) * 2;
        const yv = amp * Math.sin(2 * Math.PI * (2 * ki - 1) * t);
        const p = project(-1.25 + t * 1.25, Math.max(-1.4, Math.min(1.4, yv)), z, W, H);
        if (i) ctx.lineTo(p.X, p.Y);
        else ctx.moveTo(p.X, p.Y);
      }
      ctx.stroke();
      const lp = project(-1.25, 0, z, W, H);
      ctx.fillStyle = colors.ink3;
      ctx.font = '9px Consolas, monospace';
      ctx.textAlign = 'right';
      ctx.fillText('k=' + (2 * ki - 1), lp.X - 4, lp.Y + 3);
    }

    // 目标方波（虚）+ 部分和（实）
    ctx.strokeStyle = colors.warn;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    for (let i = 0; i <= 300; i++) {
      const t = (i / 300) * 2;
      const p = project(-1.25 + t * 1.25, Math.max(-1.6, Math.min(1.6, squarePartial(t))), Z0 - 0.28, W, H);
      if (i) ctx.lineTo(p.X, p.Y);
      else ctx.moveTo(p.X, p.Y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let i = 0; i <= NT; i++) {
      const t = (i / NT) * 2;
      const p = project(-1.25 + t * 1.25, Math.max(-1.5, Math.min(1.5, squareSum(t, n))), Z0 - 0.3, W, H);
      if (i) ctx.lineTo(p.X, p.Y);
      else ctx.moveTo(p.X, p.Y);
    }
    ctx.stroke();

    ctx.fillStyle = colors.ink2;
    ctx.font = '11px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('谐波分量瀑布（k=1…' + (2 * K - 1) + '）· 橙实线 = 部分和 S(n=' + n + ') · 橙虚线 = 方波', 12, 18);
  };

  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    drawRef.current();
  }, [props.terms]);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => drawRef.current());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);
  useEffect(() => onThemeChange(() => {
    invalidateChartColors();
    drawRef.current();
  }), []);

  return (
    <div class="chart" ref={wrapRef} style={{ height: H + 'px' }}>
      <canvas
        ref={canvasRef}
        title="拖动旋转 · 滚轮缩放 · 双击复位"
        onPointerDown={(e) => {
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            pinchRef.current = Math.max(20, Math.hypot(a.x - b.x, a.y - b.y));
          }
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } catch {
            /* 指针捕获不可用 */
          }
        }}
        onPointerMove={(e) => {
          const prev = pointers.current.get(e.pointerId);
          if (!prev) return;
          const st = stRef.current;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size >= 2 && pinchRef.current) {
            const [a, b] = [...pointers.current.values()];
            const d = Math.max(20, Math.hypot(a.x - b.x, a.y - b.y));
            st.zoom = Math.max(0.4, Math.min(4, st.zoom * (d / pinchRef.current)));
            pinchRef.current = d;
          } else if (pointers.current.size === 1) {
            st.yaw += (e.clientX - prev.x) * 0.008;
            st.pitch = Math.max(-1.25, Math.min(1.25, st.pitch + (e.clientY - prev.y) * 0.006));
          }
          drawRef.current();
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          if (pointers.current.size < 2) pinchRef.current = 0;
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          if (pointers.current.size < 2) pinchRef.current = 0;
        }}
        onDblClick={() => {
          stRef.current = { yaw: -0.62, pitch: 0.42, zoom: 1 };
          drawRef.current();
        }}
        onWheel={(e) => {
          e.preventDefault();
          stRef.current.zoom = Math.max(0.4, Math.min(4, stRef.current.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
          drawRef.current();
        }}
      />
    </div>
  );
}

/* ================= 主工具 ================= */

export function FtTool(props: ToolViewProps) {
  const [params, setParams] = useState<FtParams>(() => sanitize(getModuleState<FtParams>('ft', DEFAULT)));
  const undoRef = useRef(createUndoStack<FtParams>(40));
  const lastPush = useRef(0);
  const circRef = useRef<HTMLCanvasElement | null>(null);
  /** 画圈视图的时间轴与轨迹拖尾（子组件写入，按钮与 SVG 导出读取） */
  const tlRef = useRef<Timeline | null>(null);
  const traceRef = useRef<number[]>([]);

  useEffect(() => {
    setModuleState('ft', params);
  }, [params]);

  useExperimentSync('ft',
    () => sanitize(getModuleState<FtParams>('ft', DEFAULT)),
    (v) => {
      setParams(v);
      undoRef.current.clear();
    },
  );

  const apply = (next: Partial<FtParams>): void => {
    const now = Date.now();
    if (now - lastPush.current > 500) {
      undoRef.current.push(params);
      lastPush.current = now;
    }
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };
  const applyLive = (next: Partial<FtParams>): void => {
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };

  const pts = useMemo(
    () => (params.shape === 'custom' ? customShapePoints(params.custom, 512) : shapePoints(params.shape, 512)),
    [params.shape, params.custom],
  );
  const phasors = useMemo(() => dftPhasors(pts.filter((p) => p && Number.isFinite(p.re) && Number.isFinite(p.im))), [pts]);

  /** 谐波幅度谱（按 k 排列的谱线） */
  const spec = useMemo(() => {
    const top = phasors
      .filter((q) => q.amp > 1e-6)
      .slice(0, 80)
      .sort((a, b) => a.k - b.k);
    let maxA = 1e-9;
    let k0 = Infinity;
    let k1 = -Infinity;
    for (const q of top) {
      maxA = Math.max(maxA, q.amp);
      k0 = Math.min(k0, q.k);
      k1 = Math.max(k1, q.k);
    }
    if (!Number.isFinite(k0)) {
      k0 = 0;
      k1 = 1;
    }
    const series: ChartSeries[] = top.map((q) => ({ xs: [q.k, q.k], ys: [0, q.amp], width: 2.5, color: 'var(--series-3)' }));
    return { series, maxA, k0, k1, count: top.length };
  }, [phasors]);

  /** 谐波叠加数据（方波目标 + 各次谐波 + 部分和） */
  const harm = useMemo(() => {
    const n = Math.min(params.terms, 60);
    const faint: ChartSeries[] = [];
    for (let k = 1; k <= Math.min(n, 40); k++) {
      const a = 4 / (Math.PI * (2 * k - 1));
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i <= 200; i++) {
        const t = (i / 200) * 2;
        xs.push(t);
        ys.push(a * Math.sin(2 * Math.PI * (2 * k - 1) * t));
      }
      faint.push({ xs, ys, width: 1, color: 'var(--ink-3)', alpha: 0.4 });
    }
    const tx: number[] = [];
    const ty: number[] = [];
    for (let i = 0; i <= 2000; i++) {
      const t = (i / 2000) * 2;
      tx.push(t);
      ty.push(squarePartial(t));
    }
    const sx: number[] = [];
    const sy: number[] = [];
    for (let i = 0; i <= 600; i++) {
      const t = (i / 600) * 2;
      sx.push(t);
      sy.push(squareSum(t, n));
    }
    // RMS 误差与 Gibbs 过冲（实测）
    let se = 0;
    const M = 2000;
    for (let i = 0; i < M; i++) {
      const t = (i / M) * 2;
      const d = squarePartial(t) - squareSum(t, n);
      se += d * d;
    }
    let peak = 0;
    for (let i = 0; i <= M; i++) peak = Math.max(peak, squareSum((i / M) * 2, n));
    return { n, faint, target: { xs: tx, ys: ty }, sum: { xs: sx, ys: sy }, rms: Math.sqrt(se / M), overshoot: (peak - 1) * 100 };
  }, [params.terms]);

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
        params.view === 'circles'
          ? (SHAPES.find((s) => s.id === params.shape)?.name ?? '') + ' · ' + params.terms + ' 圈'
          : params.view === 'harmonics'
            ? '方波合成 · n=' + harm.n
            : '谐波瀑布 · n=' + Math.min(params.terms, 60),
      metrics: () => {
        if (params.view === 'circles') {
          return [
            { label: '圈数（相量）', value: Math.min(params.terms, phasors.length), precision: 0 },
            { label: '最大幅值 max|cₖ|', value: phasors[0]?.amp ?? '—', precision: 4 },
            { label: '有效谱线', value: spec.count, precision: 0 },
            ...(params.compare ? [{ label: '对比项数', value: Math.min(params.cmpTerms, phasors.length), precision: 0 }] : []),
          ];
        }
        if (params.view === 'harmonics') {
          return [
            { label: '谐波项数 n', value: harm.n, precision: 0 },
            { label: 'RMS 误差', value: harm.rms, precision: 4, tone: harm.rms < 0.1 ? 'ok' : 'default' },
            { label: 'Gibbs 过冲', value: harm.overshoot, unit: '%', precision: 2, hint: '实测部分和峰值超出 1 的比例（理论 ≈8.95%）' },
          ];
        }
        return [
          { label: '层数 K', value: Math.min(Math.max(harm.n, 1), 20), precision: 0 },
          { label: '部分和项数 n', value: harm.n, precision: 0 },
          { label: 'RMS 误差', value: harm.rms, precision: 4, tone: harm.rms < 0.1 ? 'ok' : 'default' },
        ];
      },
      exports: () => [
        {
          id: 'svg',
          label: 'SVG',
          run: () => {
            if (params.view === 'circles') {
              downloadText('fourier-series-circles.svg', svgOfCircles(pts, traceRef.current), 'image/svg+xml');
            } else {
              downloadText('fourier-series-harmonics.svg', svgOfHarmonics(harm.n), 'image/svg+xml');
            }
          },
        },
        {
          id: 'csv',
          label: 'CSV',
          run: () => {
            const rows = ['t,square(t),S_n(t)'];
            for (let i = 0; i <= 600; i++) {
              const t = (i / 600) * 2;
              rows.push(`${t.toPrecision(6)},${squarePartial(t)},${squareSum(t, harm.n).toPrecision(6)}`);
            }
            downloadText('fourier-series.csv', rows.join('\n'));
          },
        },
        {
          id: 'json',
          label: 'JSON',
          run: () => downloadText('ft-experiment.json', JSON.stringify({ ...params, custom: params.custom.length }, null, 2)),
        },
      ],
    });
    return () => props.api(null);
  }, [params, pts, phasors, spec, harm]);

  /* ================= 渲染 ================= */

  const emptyCustom = params.shape === 'custom' && !pts.length;

  return (
    <>
      {props.leftOpen ? (
        <aside class="ws-left">
          <FieldGroup title="视图">
            <SegmentedChips options={VIEWS} value={params.view} onChange={(v) => apply({ view: v })} ariaLabel="视图" />
            <p class="muted">{VIEW_HINTS[params.view]}</p>
          </FieldGroup>

          <FieldGroup title="笔画形状" desc="任意闭合路径 → DFT 相量分解；螺旋为开放路径。">
            <div class="row">
              {SHAPES.map((s) => (
                <button key={s.id} class={'btn' + (s.id === params.shape ? ' is-on' : '')} onClick={() => apply({ shape: s.id })}>
                  {s.name}
                </button>
              ))}
            </div>
            {params.shape === 'custom' ? (
              <>
                <DrawPad initial={params.custom} onDone={(cp) => apply({ custom: cp })} />
                <div class="row">
                  <button class="btn" onClick={() => apply({ custom: [] })}>
                    🗑 清空重画
                  </button>
                  <span class="muted" style="margin:0">
                    {pts.length ? '已生成 ' + pts.length + ' 个采样点' : '画一条闭合曲线，松手即生成'}
                  </span>
                </div>
              </>
            ) : null}
          </FieldGroup>

          <FieldGroup title="分解与动画" onReset={() => apply({ terms: DEFAULT.terms, speed: DEFAULT.speed, showCircles: true })}>
            <SliderField
              label="圈数上限 K（谐波项数）"
              value={params.terms}
              onChange={(v) => applyLive({ terms: Math.round(v) })}
              min={1}
              max={60}
              step={1}
              precision={0}
              hint="相量链长度（1…60）：越多越贴合目标路径；瀑布视图绘制前 20 层"
            />
            {params.view === 'circles' ? (
              <SliderField
                label="动画速度"
                value={params.speed}
                onChange={(v) => applyLive({ speed: v })}
                min={0.25}
                max={2}
                step={0.25}
                precision={2}
                unit="×"
                hint={`1× = 基波 ${CYCLE_SEC} s/圈；0.25× = ${CYCLE_SEC * 4} s/圈`}
              />
            ) : null}
            <Switch label="显示旋转圆与半径线" checked={params.showCircles} onChange={(v) => apply({ showCircles: v })} />
          </FieldGroup>

          {params.view === 'circles' ? (
            <FieldGroup title="对比模式（不同项数叠加）" defaultOpen={false}>
              <Switch label="叠加对比轨迹" checked={params.compare} onChange={(v) => apply({ compare: v })} hint="同时绘制两组圈数的轨迹，观察项数对贴合度的影响" />
              {params.compare ? (
                <SliderField
                  label="对比项数"
                  value={params.cmpTerms}
                  onChange={(v) => applyLive({ cmpTerms: Math.round(v) })}
                  min={1}
                  max={60}
                  step={1}
                  precision={0}
                  hint="紫色轨迹 = 该项数的合成路径"
                />
              ) : null}
            </FieldGroup>
          ) : null}

          {params.view === 'harmonics' ? (
            <FieldGroup title="谐波叠加" defaultOpen={false}>
              <p class="muted" style="margin-top:0">
                使用项数 n = {harm.n}（奇次谐波 1…{2 * harm.n - 1}）；调大「圈数上限」观察部分和如何逼近方波并稳定在 9% 过冲。
              </p>
            </FieldGroup>
          ) : null}
        </aside>
      ) : null}

      <section class="ws-main">
        {params.view === 'circles' ? (
          <>
            <div class="card stack">
              <div class="row">
                <button class="btn primary" onClick={() => applyLive({ playing: !params.playing })}>
                  {params.playing ? '⏸ 暂停' : '▶ 播放'}
                </button>
                <button
                  class="btn"
                  title="暂停并前进一帧"
                  onClick={() => {
                    applyLive({ playing: false });
                    tlRef.current?.pause();
                    // 每步前进 0.4% 圈（时间轴秒 = CYCLE_SEC × 0.004）
                    tlRef.current?.tick(CYCLE_SEC * 0.004);
                  }}
                >
                  ⏯ 逐帧
                </button>
                <button
                  class="btn"
                  title="回到 t = 0 并清空拖尾"
                  onClick={() => {
                    tlRef.current?.seek(0);
                  }}
                >
                  ↺ 重置
                </button>
                <StatusBadge kind={emptyCustom ? 'warn' : 'ok'}>
                  {emptyCustom ? '等待手绘路径' : 'DFT 分解就绪 · ' + Math.min(params.terms, phasors.length) + ' 圈'}
                </StatusBadge>
                <span class="spacer" />
                <span class="muted" style="margin:0">
                  每圈 {nf(CYCLE_SEC / params.speed, 1)} s（速度 {nf(params.speed, 2)}×）
                </span>
              </div>
              <CirclesCanvas
                pts={pts}
                phasors={phasors}
                params={params}
                canvasRef={circRef}
                tlRef={tlRef}
                traceRef={traceRef}
                onViewChange={() => props.onChange()}
              />
              <p class="muted">
                虚线 = 目标路径；圆 = 各次谐波相量（半径 |cₖ|）；绿线 = 相量链末端轨迹拖尾。
                {params.compare ? ' 紫线 = 对比项数轨迹。' : ''}
                拖动平移 · 滚轮缩放 · 双击复位。
              </p>
            </div>
            <div class="card stack">
              <h3>谐波幅度谱 · |cₖ|（横轴 = 谐波次数 k）</h3>
              <Chart
                series={spec.series}
                xRange={[spec.k0 - 0.5, spec.k1 + 0.5]}
                yRange={[0, spec.maxA * 1.08]}
                height={150}
                xLabel="k"
                yLabel="|cₖ|"
              />
              <p class="muted">谱线随笔画形状变化——频域视角：目标路径 = 各次谐波之和。</p>
            </div>
            <div class="card stack">
              <h3>级数分解式</h3>
              <div class="tex-line">
                <TeX
                  tex={
                    'z(t)=\\sum_{k=-K}^{K} c_k\\,e^{\\,j2\\pi k t},\\quad \\text{每个 } c_k \\text{ 画一个半径 }|c_k|\\text{、初相 }\\angle c_k\\text{ 的圆}'
                  }
                />
              </div>
            </div>
          </>
        ) : null}

        {params.view === 'harmonics' ? (
          <>
            <div class="card stack">
              <h3>方波逐步合成（Gibbs 现象）· n = {harm.n}</h3>
              <Chart
                series={[...harm.faint, { ...harm.target, color: '#A15C06', width: 2 }, { ...harm.sum, width: 2, glow: 2.5, color: 'var(--series-1)' }]}
                xRange={[0, 2]}
                yRange={[-1.7, 1.7]}
                height={300}
                xLabel="t（T = 1 s，0–2 为两个周期）"
                yLabel="Sₙ(t)"
              />
              <div class="row">
                <Metric label="谐波项数 n" value={harm.n} precision={0} />
                <Metric label="RMS 误差" value={harm.rms} precision={4} />
                <Metric label="Gibbs 过冲（实测）" value={harm.overshoot} unit="%" precision={2} tone="warn" hint="理论极限 ≈ 8.95%" />
              </div>
              <p class="muted">
                方波 = 奇次正弦之和 Sₙ(t) = (4/π)·Σₖ sin((2k−1)·2πt)/(2k−1)；跳变处约 9% 过冲不可消除（Gibbs 现象，非动画误差）。
                灰色细线为叠加中的各次谐波。
              </p>
            </div>
          </>
        ) : null}

        {params.view === 'waterfall' ? (
          <div class="card stack">
            <h3>谐波分量瀑布 · 部分和 S(n = {harm.n})</h3>
            <Waterfall terms={params.terms} />
            <p class="muted">
              拖动旋转视角 · 滚轮缩放 · 双击复位（与 2D 图的平移手势隔离）；层数 K = {Math.min(Math.max(harm.n, 1), 20)}，
              每层为一次奇次谐波分量，前端橙实线为当前部分和。
            </p>
          </div>
        ) : null}
      </section>

      {props.rightOpen ? (
        <aside class="ws-right">
          <div class="card stack">
            <h4 class="card-h">分解指标</h4>
            <div class="row">
              <Metric label="相量总数" value={phasors.length} precision={0} />
              <Metric label="当前圈数" value={Math.min(params.terms, phasors.length)} precision={0} />
            </div>
            <div class="row">
              <Metric label="max|cₖ| · 最大幅值" value={phasors[0]?.amp ?? '—'} precision={4} />
              <Metric label="有效谱线" value={spec.count} precision={0} hint="幅值 > 1e-6 的谐波数" />
            </div>
          </div>
          {params.view === 'circles' ? (
            <div class="card stack">
              <h4 class="card-h">对比模式</h4>
              {params.compare ? (
                <p class="muted" style="margin-top:0">
                  紫色轨迹使用 {Math.min(params.cmpTerms, phasors.length)} 圈，绿色轨迹使用 {Math.min(params.terms, phasors.length)} 圈：
                  圈数越多，轨迹越贴近虚线目标路径（收敛速度取决于谱衰减）。
                </p>
              ) : (
                <p class="muted" style="margin-top:0">开启「叠加对比轨迹」可同时绘制两组圈数的合成路径，直观比较项数对贴合度的影响。</p>
              )}
            </div>
          ) : null}

        </aside>
      ) : null}
    </>
  );
}