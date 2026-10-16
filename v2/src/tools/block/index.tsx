import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Chart } from '../../chart/Chart';
import { ComplexPlane, type CPMarker } from '../../chart/ComplexPlane';
import { ExprField, FieldGroup, Metric, SegmentedChips, SliderField, StatusBadge, Switch } from '../../ui/components';
import { TeX } from '../../ui/TeX';
import {
  deriveReadout,
  ltiResponse,
  parseBlockTF,
  polyRoots,
  polyTex,
  pTrim,
  solveSampled,
  solveTransfer,
  type BlockEdge,
  type BlockNode,
  type BlockNodeKind,
  type Frac,
} from '../../core';
import { createUndoStack } from '../../state/undo';
import { getModuleState, setModuleState } from '../../state/experiments';
import { useExperimentSync } from '../useSync';
import type { ToolViewProps } from '../api';

/**
 * 系统框图（block）
 * SVG 编辑器：元件库（方框/求和点/分支点/采样开关/ZOH）、拖拽布置、端口连线（正交避障布线）、
 * 结构求解（T(s) 闭式 + 极点 + 阶跃）、采样系统（域传播 + z 域读数）。
 * 几何：方框 120×46、求和 R20、分支 R5、采样 56×46、ZOH 96×46；连线车道避障。
 */

const BW = 120;
const BH = 46;
const SR = 20;
const BR = 5;
const SW = 56;
const SH = 46;
const ZW = 96;
const ZH = 46;
const HIT_PORT = 14;
const GRID = 5;
const T_MIN = 1e-3;
const T_MAX = 1e3;
const T_DEF = 0.1;

const KIND_LABEL: Record<BlockNodeKind, string> = {
  box: '方框',
  sum: '求和点',
  branch: '分支点',
  sample: '采样开关',
  zoh: '零阶保持器',
};

/** 编辑器节点（位置 + 核心字段：传给 core 时忽略位置字段）
 *  注意：core.solveTransfer 以「有 f 且非 err」判定参与元件，求和点/分支点必须携带单位增益 f = {n:[1],d:[1]}
 *  （err 在 core 中是「传函解析失败」标志，不参与求解；采样开关与 ZOH 的 f 恒为 null） */
interface BlkNode {
  id: number;
  kind: BlockNodeKind;
  x: number;
  y: number;
  expr?: string;
  f?: Frac | null;
  src?: boolean;
  out?: boolean;
  dom?: 's' | 'z';
}

const UNIT_FRAC: Frac = { n: [1], d: [1] };

interface BlkView {
  s: number;
  tx: number;
  ty: number;
}

interface BlkParams {
  nodes: BlkNode[];
  edges: BlockEdge[];
  seq: number;
  T: number;
  view: BlkView;
  snap: boolean;
}

const DEFAULT: BlkParams = {
  nodes: [],
  edges: [],
  seq: 0,
  T: T_DEF,
  view: { s: 1, tx: 0, ty: 0 },
  snap: true,
};

type DemoId = 0 | 1 | 2;

const DEMOS: ReadonlyArray<{ name: string; build: () => { nodes: BlkNode[]; edges: BlockEdge[]; seq: number } }> = [
  {
    name: '一阶单位负反馈',
    build: () => {
      const nodes: BlkNode[] = [
        { id: 1, kind: 'sum', x: 240, y: 220, src: true, f: UNIT_FRAC },
        { id: 2, kind: 'box', x: 480, y: 220, expr: '10/(s+1)', f: fracOf('10/(s+1)'), out: true, dom: 's' },
      ];
      const edges: BlockEdge[] = [
        { from: 1, to: 2, sign: 1 },
        { from: 2, to: 1, sign: -1 },
      ];
      return { nodes, edges, seq: 2 };
    },
  },
  {
    name: '二阶系统 + 负反馈',
    build: () => {
      const nodes: BlkNode[] = [
        { id: 1, kind: 'sum', x: 210, y: 230, src: true, f: UNIT_FRAC },
        { id: 2, kind: 'box', x: 450, y: 230, expr: '1/(s^2+2*s+5)', f: fracOf('1/(s^2+2*s+5)'), dom: 's' },
        { id: 3, kind: 'box', x: 690, y: 230, expr: '2/(s+0.5)', f: fracOf('2/(s+0.5)'), out: true, dom: 's' },
      ];
      const edges: BlockEdge[] = [
        { from: 1, to: 2, sign: 1 },
        { from: 2, to: 3, sign: 1 },
        { from: 3, to: 1, sign: -1 },
      ];
      return { nodes, edges, seq: 3 };
    },
  },
  {
    name: '串并联对比',
    build: () => {
      const nodes: BlkNode[] = [
        { id: 1, kind: 'sum', x: 190, y: 270, src: true, f: UNIT_FRAC },
        { id: 2, kind: 'box', x: 410, y: 160, expr: '1/(s+1)', f: fracOf('1/(s+1)'), dom: 's' },
        { id: 3, kind: 'box', x: 410, y: 380, expr: '1/(s+2)', f: fracOf('1/(s+2)'), dom: 's' },
        { id: 4, kind: 'sum', x: 660, y: 270, out: true, f: UNIT_FRAC },
      ];
      const edges: BlockEdge[] = [
        { from: 1, to: 2, sign: 1 },
        { from: 1, to: 3, sign: 1 },
        { from: 2, to: 4, sign: 1 },
        { from: 3, to: 4, sign: 1 },
      ];
      return { nodes, edges, seq: 4 };
    },
  },
];

function fracOf(expr: string): Frac | null {
  const r = parseBlockTF(expr, 's');
  return r.ok ? { n: r.n, d: r.d } : null;
}

/** 采样系统示例（误差点采样 + ZOH 驱动连续对象 —— core.analyzeSampled 要求连续片段由采样器驱动） */
function sampledDemo(): { nodes: BlkNode[]; edges: BlockEdge[]; seq: number } {
  const nodes: BlkNode[] = [
    { id: 1, kind: 'sum', x: 180, y: 250, src: true, f: UNIT_FRAC },
    { id: 2, kind: 'sample', x: 360, y: 250, dom: 'z', f: null },
    { id: 3, kind: 'zoh', x: 480, y: 250, dom: 'z', f: null },
    { id: 4, kind: 'box', x: 640, y: 250, expr: '2/(s+1)', f: fracOf('2/(s+1)'), dom: 's', out: true },
  ];
  const edges: BlockEdge[] = [
    { from: 1, to: 2, sign: 1 },
    { from: 2, to: 3, sign: 1 },
    { from: 3, to: 4, sign: 1 },
    { from: 4, to: 1, sign: -1 },
  ];
  return { nodes, edges, seq: 4 };
}

/* ================= 几何与布线（自 v1 blockdiag.js 迁移，语义不变） ================= */

const nodeGeom = (n: BlkNode): { w: number; h: number } =>
  n.kind === 'box'
    ? { w: BW, h: BH }
    : n.kind === 'sum'
      ? { w: SR * 2, h: SR * 2 }
      : n.kind === 'sample'
        ? { w: SW, h: SH }
        : n.kind === 'zoh'
          ? { w: ZW, h: ZH }
          : { w: BR * 2, h: BR * 2 };

const outPort = (n: BlkNode): { x: number; y: number } => ({ x: n.x + nodeGeom(n).w / 2 + 5, y: n.y });

interface Slot {
  slot: 'left' | 'up' | 'down';
  x: number;
  y: number;
}

function inSlots(n: BlkNode): Slot[] {
  if (n.kind === 'sum') {
    return [
      { slot: 'left', x: n.x - SR - 5, y: n.y },
      { slot: 'up', x: n.x, y: n.y - SR - 5 },
      { slot: 'down', x: n.x, y: n.y + SR + 5 },
    ];
  }
  return [{ slot: 'left', x: n.x - nodeGeom(n).w / 2 - 5, y: n.y }];
}

/** 每条入边分配到最近的空方位（方位跟"来向"走：反馈从下/上绕回，避免压住输入端） */
function assignSlots(nodes: BlkNode[], edges: BlockEdge[]): Map<number, Slot> {
  const map = new Map<number, Slot>();
  const byId = (id: number): BlkNode | undefined => nodes.find((n) => n.id === id);
  for (const nd of nodes) {
    const ins = edges.map((e, i) => ({ e, i })).filter(({ e }) => e.to === nd.id);
    if (!ins.length) continue;
    const slots = inSlots(nd);
    const used = new Set<string>();
    for (const { e, i } of ins) {
      const from = byId(e.from);
      const dx = from ? from.x - nd.x : -1;
      const dy = from ? from.y - nd.y : 0;
      const order: Array<'left' | 'up' | 'down'> = dx > 20 ? ['down', 'up', 'left'] : dx < -20 ? ['left', 'down', 'up'] : dy < 0 ? ['up', 'left', 'down'] : ['down', 'left', 'up'];
      let pick: Slot | null = null;
      for (const s of order) {
        const hit = slots.find((x) => x.slot === s);
        if (hit && !used.has(s)) {
          pick = hit;
          break;
        }
      }
      if (!pick) pick = slots[0];
      used.add(pick.slot);
      map.set(i, pick);
    }
  }
  return map;
}

interface Rect2 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 线段是否穿过矩形 */
function segHitsRect(p1: { x: number; y: number }, p2: { x: number; y: number }, r: Rect2): boolean {
  if (Math.max(p1.x, p2.x) < r.x0 || Math.min(p1.x, p2.x) > r.x1 || Math.max(p1.y, p2.y) < r.y0 || Math.min(p1.y, p2.y) > r.y1) return false;
  const inside = (p: { x: number; y: number }): boolean => p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1;
  if (inside(p1) || inside(p2)) return true;
  const cross = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }): boolean => {
    const d1 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const d2 = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x);
    const d3 = (d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x);
    const d4 = (d.x - c.x) * (b.y - c.y) - (d.y - c.y) * (b.x - c.x);
    return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0;
  };
  const c1 = { x: r.x0, y: r.y0 };
  const c2 = { x: r.x1, y: r.y0 };
  const c3 = { x: r.x1, y: r.y1 };
  const c4 = { x: r.x0, y: r.y1 };
  return cross(p1, p2, c1, c2) || cross(p1, p2, c2, c3) || cross(p1, p2, c3, c4) || cross(p1, p2, c4, c1);
}

function polylineHits(pts: Array<{ x: number; y: number }>, obstacles: Rect2[]): number {
  let h = 0;
  for (let i = 1; i < pts.length; i++) {
    for (const r of obstacles) {
      if (segHitsRect(pts[i - 1], pts[i], r)) {
        h++;
        break;
      }
    }
  }
  return h;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

function midOf(pts: Array<{ x: number; y: number }>, fallback: { x: number; y: number }): { x: number; y: number } {
  let bi = 1;
  let bestLen = -1;
  for (let i = 1; i < pts.length; i++) {
    const L = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (L > bestLen) {
      bestLen = L;
      bi = i;
    }
  }
  if (pts.length < 2) return fallback;
  return { x: (pts[bi - 1].x + pts[bi].x) / 2, y: (pts[bi - 1].y + pts[bi].y) / 2 };
}

interface RouteResult {
  d: string;
  pts: Array<{ x: number; y: number }>;
  mid: { x: number; y: number };
  blocked: boolean;
}

/** 正交路由：正向走中轴、回绕走独立车道；同轴穿框时改走上/下绕行（三候选择优） */
function routePath(
  a: { x: number; y: number },
  b: { x: number; y: number },
  slot: string,
  lane: number,
  obstacles: Rect2[],
  targetBox?: Rect2,
): RouteResult {
  const end = slot === 'up' ? { x: b.x, y: b.y - 22 } : slot === 'down' ? { x: b.x, y: b.y + 22 } : { x: b.x - 22, y: b.y };
  const build = (mode: 'orig' | 'below' | 'above'): Array<{ x: number; y: number }> => {
    const pts: Array<{ x: number; y: number }> = [a];
    if (mode === 'below' || mode === 'above') {
      const yOff = mode === 'below' ? Math.max(a.y, b.y) + 44 + lane * 20 : Math.min(a.y, b.y) - 44 - lane * 20;
      pts.push({ x: a.x + 22, y: a.y }, { x: a.x + 22, y: yOff }, { x: end.x, y: yOff }, { x: end.x, y: end.y });
    } else if (b.x > a.x + 40 && slot === 'left') {
      const mx = (a.x + end.x) / 2;
      pts.push({ x: mx, y: a.y }, { x: mx, y: end.y });
    } else if (b.x > a.x + 40) {
      pts.push({ x: end.x, y: a.y });
    } else {
      const laneY = Math.max(a.y, b.y) + 44 + lane * 20;
      pts.push({ x: a.x + 22, y: a.y }, { x: a.x + 22, y: laneY }, { x: end.x, y: laneY }, { x: end.x, y: end.y });
    }
    pts.push(end, b);
    return pts;
  };
  /**
   * 评分：撞到「其它元件」计 1；撞到「目标元件自身包围盒」计 2 —— 后者只看末端之前的折线，
   * 允许最后两段从外侧切入端口（否则每条线都会因接近端口而误判受阻）。
   */
  const score = (pts: Array<{ x: number; y: number }>): number => {
    const outside = polylineHits(pts, obstacles);
    if (!targetBox) return outside;
    const pre = pts.slice(0, Math.max(1, pts.length - 2));
    return outside + 2 * polylineHits(pre, [targetBox]);
  };
  const cands = [build('orig'), build('below'), build('above')];
  let best = cands[0];
  let bestScore = score(cands[0]);
  for (let k = 1; k < cands.length && bestScore > 0; k++) {
    const s = score(cands[k]);
    if (s < bestScore) {
      best = cands[k];
      bestScore = s;
    }
  }
  const uniq = best.filter((p, i) => i === 0 || Math.abs(p.x - best[i - 1].x) > 0.5 || Math.abs(p.y - best[i - 1].y) > 0.5);
  return {
    d: uniq.map((p, i) => (i ? 'L' : 'M') + ' ' + round1(p.x) + ' ' + round1(p.y)).join(' '),
    pts: uniq,
    mid: midOf(uniq, b),
    blocked: bestScore > 0,
  };
}

function arrowOf(pts: Array<{ x: number; y: number }>): string {
  const n = pts.length;
  if (n < 2) return '';
  const p2 = pts[n - 1];
  const p1 = pts[n - 2];
  const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const dd = 9;
  const w = 4.5;
  return (
    round1(p2.x) +
    ',' +
    round1(p2.y) +
    ' ' +
    round1(p2.x - dd * Math.cos(ang) - w * Math.sin(ang)) +
    ',' +
    round1(p2.y - dd * Math.sin(ang) + w * Math.cos(ang)) +
    ' ' +
    round1(p2.x - dd * Math.cos(ang) + w * Math.sin(ang)) +
    ',' +
    round1(p2.y - dd * Math.sin(ang) - w * Math.cos(ang))
  );
}

function sanitize(raw: unknown): BlkParams {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<BlkParams>;
  const kinds: BlockNodeKind[] = ['box', 'sum', 'branch', 'sample', 'zoh'];
  const nodes: BlkNode[] = Array.isArray(r.nodes)
    ? r.nodes
        .filter((n): n is BlkNode => !!n && typeof n === 'object' && typeof (n as BlkNode).id === 'number')
        .slice(0, 80)
        .map((n) => {
          const kind: BlockNodeKind = kinds.includes(n.kind) ? n.kind : 'box';
          const isSym = kind === 'sample' || kind === 'zoh';
          const f: Frac | null = isSym
            ? null
            : kind === 'box'
              ? (n.f ?? (typeof n.expr === 'string' ? fracOf(n.expr) : null))
              : UNIT_FRAC;
          return {
            id: n.id,
            kind,
            x: Number.isFinite(n.x) ? n.x : 0,
            y: Number.isFinite(n.y) ? n.y : 0,
            expr: typeof n.expr === 'string' ? n.expr : undefined,
            f,
            src: n.src === true,
            out: n.out === true,
            dom: n.dom === 'z' ? 'z' : 's',
          };
        })
    : [];
  const ids = new Set(nodes.map((n) => n.id));
  const edges: BlockEdge[] = Array.isArray(r.edges)
    ? r.edges
        .filter((e): e is BlockEdge => !!e && typeof e === 'object' && ids.has((e as BlockEdge).from) && ids.has((e as BlockEdge).to))
        .slice(0, 160)
        .map((e) => ({ from: e.from, to: e.to, sign: e.sign === -1 ? -1 : 1 }))
    : [];
  const v = (r.view && typeof r.view === 'object' ? r.view : {}) as BlkView;
  return {
    nodes,
    edges,
    seq: Number.isFinite(r.seq) ? (r.seq as number) : nodes.reduce((m, n) => Math.max(m, n.id), 0),
    T: Number.isFinite(r.T) ? Math.max(T_MIN, Math.min(T_MAX, r.T as number)) : DEFAULT.T,
    view: {
      s: Number.isFinite(v.s) ? Math.max(0.35, Math.min(3, v.s)) : 1,
      tx: Number.isFinite(v.tx) ? v.tx : 0,
      ty: Number.isFinite(v.ty) ? v.ty : 0,
    },
    snap: r.snap !== false,
  };
}

const nf = (v: number | null | undefined, d = 3): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  return String(+v.toFixed(d));
};

const cx = (re: number, im = 0, d = 3): string => {
  if (Math.abs(im) < 1e-9) return nf(re, d);
  return nf(re, d) + (im > 0 ? '+' : '−') + nf(Math.abs(im), d) + 'j';
};

export function BlockTool(props: ToolViewProps) {
  const [params, setParams] = useState<BlkParams>(() => sanitize(getModuleState<BlkParams>('block', DEFAULT)));
  const [selNodes, setSelNodes] = useState<number[]>([]);
  const [selEdge, setSelEdge] = useState(-1);
  const [wire, setWire] = useState<{ from: number; cur: { x: number; y: number }; target: number | null } | null>(null);
  /** 交互反馈（落点无效 / 重复连线 / 已新增 …）——顶栏无 toast，用画布下方状态行回显 */
  const [hint, setHint] = useState('');
  /** 框选矩形（Shift+拖空白）：屏幕无关的世界坐标两端点 */
  const [band, setBand] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  /** 连线改接：拖动线中点徽标 → 把该连线的「终点」换到别的元件 */
  const [relink, setRelink] = useState<{ index: number; cur: { x: number; y: number }; target: number | null; moved: boolean } | null>(null);
  const undoRef = useRef(createUndoStack<BlkParams>(50));
  const lastPush = useRef(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ ids: number[]; start: Map<number, { x: number; y: number }>; p0: { x: number; y: number }; pushed: boolean } | null>(null);
  const panRef = useRef<{ px: number; py: number; tx: number; ty: number } | null>(null);
  const bandRef = useRef<{ a: { x: number; y: number }; sx: number; sy: number; moved: boolean } | null>(null);
  const relinkRef = useRef<{ index: number; p0: { x: number; y: number }; sx: number; sy: number; moved: boolean } | null>(null);
  /** 触摸：活动指针表 + 捏合缩放会话 */
  const touchRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ d0: number; s0: number; mid: { x: number; y: number }; view: { s: number; tx: number; ty: number } } | null>(null);

  useEffect(() => {
    setModuleState('block', params);
  }, [params]);

  useExperimentSync('block',
    () => sanitize(getModuleState<BlkParams>('block', DEFAULT)),
    (v) => {
      setParams(v);
      setSelNodes([]);
      setSelEdge(-1);
      undoRef.current.clear();
    },
  );

  const apply = (next: Partial<BlkParams>): void => {
    const now = Date.now();
    if (now - lastPush.current > 500) {
      undoRef.current.push(params);
      lastPush.current = now;
    }
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };
  const applyLive = (next: Partial<BlkParams>): void => {
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };

  /* ================= 求解（core.blocksolve） ================= */

  const coreNodes: BlockNode[] = useMemo(
    () => params.nodes.map((n) => ({ id: n.id, kind: n.kind, f: n.f ?? null, src: n.src, out: n.out, dom: n.dom ?? 's' })),
    [params.nodes],
  );
  const hasSampled = useMemo(() => params.nodes.some((n) => n.kind === 'sample' || n.kind === 'zoh' || (n.kind === 'box' && n.dom === 'z')), [params.nodes]);

  const solved = useMemo(() => {
    if (!coreNodes.length || !params.edges.length) return { ok: false as const, note: '请在画布上布置元件并连线（或载入示例）。' };
    try {
      const r = solveTransfer(coreNodes, params.edges);
      return r.ok ? r : { ok: false as const, note: r.note };
    } catch {
      return { ok: false as const, note: '求解异常：请检查连线结构（环 / 断点）。' };
    }
  }, [coreNodes, params.edges]);

  const read = useMemo(() => (solved.ok ? deriveReadout(solved.frac) : null), [solved]);

  const samp = useMemo(() => {
    if (!hasSampled || !coreNodes.length || !params.edges.length) return null;
    try {
      return solveSampled(coreNodes, params.edges, params.T);
    } catch {
      return { ok: false as const, mode: 'sampled', note: '采样分析异常。' };
    }
  }, [hasSampled, coreNodes, params.edges, params.T]);

  const markers: CPMarker[] = useMemo(() => {
    if (!read) return [];
    const out: CPMarker[] = read.poles.map((p) => ({ re: p.re, im: p.im, kind: 'pole' as const }));
    if (solved.ok) {
      const nz = pTrim(solved.frac.n);
      if (nz.length > 1) out.push(...polyRoots(nz).map((z) => ({ re: z.re, im: z.im, kind: 'zero' as const })));
    }
    return out;
  }, [read, solved]);

  const step = useMemo(() => {
    if (!solved.ok || solved.frac.d.length < 2) return null;
    const poles = read ? read.poles : [];
    const decays = poles.filter((p) => Math.abs(p.re) > 1e-9).map((p) => Math.abs(p.re));
    const nearest = decays.length ? Math.min(...decays) : NaN;
    const tmax = read?.hasRhp ? 6 : Math.max(1, Math.min(30, isFinite(nearest) ? 4 / nearest : 10));
    try {
      return ltiResponse(solved.frac.n, solved.frac.d, () => 1, 0, tmax, 640);
    } catch {
      return null;
    }
  }, [solved, read]);

  /* ================= 画布几何 ================= */

  const slotMap = useMemo(() => assignSlots(params.nodes, params.edges), [params.nodes, params.edges]);

  const edgeGeoms = useMemo(
    () =>
      params.edges.map((e, i) => {
        const a0 = params.nodes.find((n) => n.id === e.from);
        const b0 = params.nodes.find((n) => n.id === e.to);
        if (!a0 || !b0) return null;
        const A = outPort(a0);
        const B = slotMap.get(i) ?? inSlots(b0)[0];
        const obstacles: Rect2[] = params.nodes
          .filter((n) => n.id !== a0.id && n.id !== b0.id)
          .map((n) => {
            const g = nodeGeom(n);
            return { x0: n.x - g.w / 2, y0: n.y - g.h / 2, x1: n.x + g.w / 2, y1: n.y + g.h / 2 };
          });
        let lane = 0;
        for (let j = 0; j < i; j++) {
          const fa = params.nodes.find((n) => n.id === params.edges[j].from);
          const fb = params.nodes.find((n) => n.id === params.edges[j].to);
          if (fa && fb && fb.x < fa.x + 40 && Math.abs(fa.y - A.y) < 220) lane++;
        }
        const bg = nodeGeom(b0);
        const targetBox: Rect2 = {
          x0: b0.x - bg.w / 2 - 4,
          y0: b0.y - bg.h / 2 - 4,
          x1: b0.x + bg.w / 2 + 4,
          y1: b0.y + bg.h / 2 + 4,
        };
        return routePath(A, B, B.slot, lane, obstacles, targetBox);
      }),
    [params.edges, params.nodes, slotMap],
  );

  const blockedCount = useMemo(() => edgeGeoms.filter((g) => g && g.blocked).length, [edgeGeoms]);
  /** 表达式无法解析的方框（求解时会被跳过）→ 画布上标红提示 */
  const invalidCount = useMemo(() => params.nodes.filter((n) => n.kind === 'box' && !n.f).length, [params.nodes]);

  /* ================= 指针交互 ================= */

  const screenToWorld = (clientX: number, clientY: number): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    return { x: (px - params.view.tx) / params.view.s, y: (py - params.view.ty) / params.view.s };
  };

  const nodeAt = (w: { x: number; y: number }): BlkNode | null => {
    for (let i = params.nodes.length - 1; i >= 0; i--) {
      const n = params.nodes[i];
      const g = nodeGeom(n);
      const pad = 8 / params.view.s;
      if (w.x >= n.x - g.w / 2 - pad && w.x <= n.x + g.w / 2 + pad && w.y >= n.y - g.h / 2 - pad && w.y <= n.y + g.h / 2 + pad) return n;
    }
    return null;
  };

  /** 命中元件实体几何（不含 8px 外扩热区）：用于区分「点端口」与「点元件本体」 */
  const nodeBodyAt = (w: { x: number; y: number }): BlkNode | null => {
    for (let i = params.nodes.length - 1; i >= 0; i--) {
      const n = params.nodes[i];
      const g = nodeGeom(n);
      if (w.x >= n.x - g.w / 2 && w.x <= n.x + g.w / 2 && w.y >= n.y - g.h / 2 && w.y <= n.y + g.h / 2) return n;
    }
    return null;
  };

  /**
   * 输出端口命中：屏幕恒定半径 HIT_PORT。
   * 落在**该元件实体**内时不抢起线（让位给「拖动元件」——分支点/小节点否则完全拖不动）；
   * 端口本身画在实体外侧 5px，仍可正常起线。
   */
  const portAt = (w: { x: number; y: number }): BlkNode | null => {
    const hit = HIT_PORT / params.view.s;
    const inside = nodeBodyAt(w);
    let best: BlkNode | null = null;
    let bestD = Infinity;
    for (const n of params.nodes) {
      if (inside && inside.id === n.id) continue;
      const p = outPort(n);
      const d = Math.hypot(p.x - w.x, p.y - w.y);
      if (d <= hit && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button === 2) return; // 右键：不拖、不清选择（交给 onContextMenu）
    setHint('');
    // 触摸：两指按下进入捏合缩放（取消其它手势）
    if (e.pointerType === 'touch') {
      touchRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchRef.current.size === 2) {
        const [p1, p2] = [...touchRef.current.values()];
        pinchRef.current = {
          d0: Math.max(1, Math.hypot(p2.x - p1.x, p2.y - p1.y)),
          s0: params.view.s,
          mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
          view: { ...params.view },
        };
        wire && setWire(null);
        dragRef.current = null;
        panRef.current = null;
        bandRef.current = null;
        relinkRef.current = null;
        setBand(null);
        setRelink(null);
        return;
      }
    }
    const w = screenToWorld(e.clientX, e.clientY);
    if (e.button === 1) {
      // 中键：始终平移（与元件/端口无关）
      panRef.current = { px: e.clientX, py: e.clientY, tx: params.view.tx, ty: params.view.ty };
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {
        /* 指针捕获不可用 */
      }
      return;
    }
    const port = portAt(w);
    if (port) {
      setWire({ from: port.id, cur: w, target: null });
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {
        /* 指针捕获不可用 */
      }
      return;
    }
    const node = nodeAt(w);
    if (node) {
      const ids = e.shiftKey ? (selNodes.includes(node.id) ? selNodes.filter((i) => i !== node.id) : [...selNodes, node.id]) : [node.id];
      setSelNodes(ids);
      setSelEdge(-1);
      const start = new Map<number, { x: number; y: number }>();
      for (const id of ids) {
        const n = params.nodes.find((q) => q.id === id);
        if (n) start.set(id, { x: n.x, y: n.y });
      }
      if (start.size) {
        // 撤销快照推迟到首次真实移动时压入（单击选中不产生撤销点）
        dragRef.current = { ids, start, p0: w, pushed: false };
      } else {
        dragRef.current = { ids, start, p0: w, pushed: true };
      }
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {
        /* 指针捕获不可用 */
      }
      return;
    }
    // 空白：Shift = 框选（保留原选择），否则清除选择并平移
    if (e.shiftKey) {
      bandRef.current = { a: w, sx: e.clientX, sy: e.clientY, moved: false };
      setBand(null);
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {
        /* 指针捕获不可用 */
      }
      return;
    }
    setSelNodes([]);
    setSelEdge(-1);
    panRef.current = { px: e.clientX, py: e.clientY, tx: params.view.tx, ty: params.view.ty };
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* 指针捕获不可用 */
    }
  };

  const onPointerMove = (e: PointerEvent): void => {
    // 捏合缩放：保持两指中点下的世界点不动
    if (pinchRef.current && e.pointerType === 'touch') {
      touchRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchRef.current.size === 2) {
        const [p1, p2] = [...touchRef.current.values()];
        const d = Math.max(1, Math.hypot(p2.x - p1.x, p2.y - p1.y));
        const svg = svgRef.current;
        const rect = svg?.getBoundingClientRect();
        const p = pinchRef.current;
        const ns = Math.max(0.35, Math.min(3, (p.s0 * d) / p.d0));
        const mx = p.mid.x - (rect?.left ?? 0);
        const my = p.mid.y - (rect?.top ?? 0);
        const wx = (mx - p.view.tx) / p.view.s;
        const wy = (my - p.view.ty) / p.view.s;
        applyLive({ view: { s: ns, tx: mx - wx * ns, ty: my - wy * ns } });
      }
      return;
    }
    if (wire) {
      const w = screenToWorld(e.clientX, e.clientY);
      const over = nodeAt(w);
      setWire({ ...wire, cur: w, target: over && over.id !== wire.from ? over.id : null });
      return;
    }
    if (relinkRef.current) {
      const r = relinkRef.current;
      if (!r.moved && Math.hypot(e.clientX - r.sx, e.clientY - r.sy) > 4) r.moved = true;
      const w = screenToWorld(e.clientX, e.clientY);
      const over = nodeAt(w);
      setRelink({ index: r.index, cur: w, target: over ? over.id : null, moved: r.moved });
      return;
    }
    if (bandRef.current) {
      const b = bandRef.current;
      if (!b.moved && Math.hypot(e.clientX - b.sx, e.clientY - b.sy) > 4) b.moved = true;
      const w = screenToWorld(e.clientX, e.clientY);
      setBand({ a: b.a, b: w });
      return;
    }
    if (dragRef.current) {
      const w = screenToWorld(e.clientX, e.clientY);
      const d = dragRef.current;
      const dx = w.x - d.p0.x;
      const dy = w.y - d.p0.y;
      if (!d.pushed && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) {
        undoRef.current.push(params);
        lastPush.current = Date.now();
        d.pushed = true;
      }
      if (!d.pushed) return;
      const nodes = params.nodes.map((n) => {
        const s = d.start.get(n.id);
        if (!s) return n;
        let nx = s.x + dx;
        let ny = s.y + dy;
        if (params.snap) {
          nx = Math.round(nx / GRID) * GRID;
          ny = Math.round(ny / GRID) * GRID;
        }
        return { ...n, x: nx, y: ny };
      });
      applyLive({ nodes });
      return;
    }
    if (panRef.current) {
      const p = panRef.current;
      applyLive({ view: { ...params.view, tx: p.tx + (e.clientX - p.px), ty: p.ty + (e.clientY - p.py) } });
    }
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      touchRef.current.delete(e.pointerId);
      if (touchRef.current.size < 2) pinchRef.current = null;
    }
    if (wire) {
      const w = screenToWorld(e.clientX, e.clientY);
      const over = nodeAt(w);
      if (!over) {
        setHint('未落在元件上：连线已取消（拖到目标元件上松手）');
      } else if (over.id === wire.from) {
        setHint('不能连接到自身');
      } else {
        const exists = params.edges.some((ed) => ed.from === wire.from && ed.to === over.id);
        if (exists) {
          setHint('已存在该连线（点线中点徽标可切换正负号）');
        } else {
          apply({ edges: [...params.edges, { from: wire.from, to: over.id, sign: 1 }] });
          setHint('已新增连线 ' + wire.from + ' → ' + over.id);
        }
      }
      setWire(null);
    }
    // 框选松手：选中与矩形相交的全部元件（Shift 语义 = 追加）
    if (bandRef.current) {
      const b = bandRef.current;
      bandRef.current = null;
      if (band && b.moved) {
        const x0 = Math.min(band.a.x, band.b.x);
        const x1 = Math.max(band.a.x, band.b.x);
        const y0 = Math.min(band.a.y, band.b.y);
        const y1 = Math.max(band.a.y, band.b.y);
        const hit = params.nodes
          .filter((n) => {
            const g = nodeGeom(n);
            return n.x + g.w / 2 >= x0 && n.x - g.w / 2 <= x1 && n.y + g.h / 2 >= y0 && n.y - g.h / 2 <= y1;
          })
          .map((n) => n.id);
        const next = Array.from(new Set([...selNodes, ...hit]));
        setSelNodes(next);
        setHint(hit.length ? '框选中 ' + hit.length + ' 个元件（共 ' + next.length + ' 个）' : '框选范围内没有元件');
      }
      setBand(null);
    }
    // 连线改接松手：落在元件上 = 改接；未移动 = 切换正负号（原单击语义）
    if (relinkRef.current) {
      const r = relinkRef.current;
      relinkRef.current = null;
      const cur = relink;
      setRelink(null);
      if (!r.moved) {
        const edges = params.edges.map((x, k) => (k === r.index ? { ...x, sign: x.sign === 1 ? -1 : 1 } : x));
        apply({ edges });
      } else {
        const e0 = params.edges[r.index];
        const over = cur && cur.target != null ? params.nodes.find((n) => n.id === cur.target) : null;
        if (!e0) {
          /* 边已不在（并发编辑），忽略 */
        } else if (!over) {
          setHint('未落在元件上：连线保持原样');
        } else if (over.id === e0.from) {
          setHint('不能连接到自身');
        } else if (params.edges.some((x, k) => k !== r.index && x.from === e0.from && x.to === over.id)) {
          setHint('已存在该连线（原连线未改动）');
        } else {
          const edges = params.edges.map((x, k) => (k === r.index ? { ...x, to: over.id } : x));
          apply({ edges });
          setHint('已改接：' + e0.from + ' → ' + over.id);
        }
      }
    }
    if (dragRef.current) {
      dragRef.current = null;
      props.onChange();
    }
    if (panRef.current) {
      panRef.current = null;
      props.onChange();
    }
  };

  // 键盘：Delete 删除选中，Esc 取消选择
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape') {
        setSelNodes([]);
        setSelEdge(-1);
        setWire(null);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selNodes.length) {
          e.preventDefault();
          removeSelected();
        } else if (selEdge >= 0) {
          e.preventDefault();
          apply({ edges: params.edges.filter((_, i) => i !== selEdge) });
          setSelEdge(-1);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint 无
  });

  const removeSelected = (): void => {
    if (!selNodes.length) return;
    const keep = params.nodes.filter((n) => !selNodes.includes(n.id));
    const edges = params.edges.filter((e) => !selNodes.includes(e.from) && !selNodes.includes(e.to));
    setSelNodes([]);
    setSelEdge(-1);
    apply({ nodes: keep, edges });
  };

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
        params.nodes.length
          ? params.nodes.length + ' 元件 · ' + params.edges.length + ' 连线' + (read ? ' · T(s) ' + read.order + ' 阶 · ' + read.stableText : '')
          : '空画布 · 请添加元件或载入示例',
      metrics: () =>
        read
          ? [
              { label: '闭环阶次', value: read.order, precision: 0 },
              { label: '闭环稳定性', value: read.stableText, tone: read.hasRhp ? 'danger' : read.hasJw ? 'warn' : 'ok' },
              { label: 'ζ · 主导阻尼', value: read.zeta ?? '—', precision: 3 },
              { label: 'ωn · 自然频率', value: read.wn ?? '—', unit: 'rad/s', precision: 3 },
              ...(samp && samp.ok
                ? [{ label: 'z 域稳定性', value: samp.read.stableText, tone: samp.read.stable ? ('ok' as const) : ('warn' as const) }]
                : []),
            ]
          : [
              { label: '元件', value: params.nodes.length, precision: 0 },
              { label: '连线', value: params.edges.length, precision: 0 },
            ],
      exports: () => [
        {
          id: 'csv',
          label: '阶跃 CSV',
          disabled: !step,
          reason: '尚无闭环解（请先连线并求解成功）',
          run: () => {
            if (!step) return;
            const rows = ['t,y(t)'];
            for (let i = 0; i < step.t.length; i++) rows.push(`${step.t[i].toPrecision(6)},${step.y[i].toPrecision(6)}`);
            downloadText('block-step.csv', rows.join('\n'));
          },
        },
        { id: 'json', label: 'JSON', run: () => downloadText('block-diagram.json', JSON.stringify(params, null, 2)) },
      ],
    });
    return () => props.api(null);
  }, [params, read, samp, step, selNodes, selEdge]);

  /* ================= 渲染 ================= */

  const addNode = (kind: BlockNodeKind, expr?: string): void => {
    const id = params.seq + 1;
    const w = screenToWorld(
      (wrapRef.current?.getBoundingClientRect().left ?? 0) + (wrapRef.current?.clientWidth ?? 600) / 2,
      (wrapRef.current?.getBoundingClientRect().top ?? 0) + 240,
    );
    // 级联落点：连续添加时错开，避免元件完全重叠（与 v1 的抖动落点同义）
    const k = params.nodes.length;
    const cascade = { x: ((k % 3) - 1) * 68, y: ((Math.floor(k / 3) % 3) - 1) * 56 };
    const node: BlkNode = {
      id,
      kind,
      x: Math.round((w.x + cascade.x) / GRID) * GRID,
      y: Math.round((w.y + cascade.y) / GRID) * GRID,
      ...(kind === 'box' ? { expr: expr ?? '1/(s+1)', f: fracOf(expr ?? '1/(s+1)'), dom: 's' as const } : {}),
      ...(kind === 'sum' || kind === 'branch' ? { f: UNIT_FRAC } : {}),
      ...(kind === 'sample' || kind === 'zoh' ? { dom: 'z' as const, f: null } : {}),
    };
    setSelNodes([id]);
    setSelEdge(-1);
    apply({ nodes: [...params.nodes, node], seq: id });
  };

  /** 复位视图：按全部元件包围盒自适应（无元件时回单位视图） */
  const fitView = (): void => {
    const wrap = wrapRef.current;
    if (!wrap || !params.nodes.length) {
      apply({ view: { s: 1, tx: 0, ty: 0 } });
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of params.nodes) {
      const g = nodeGeom(n);
      minX = Math.min(minX, n.x - g.w / 2);
      maxX = Math.max(maxX, n.x + g.w / 2);
      minY = Math.min(minY, n.y - g.h / 2);
      maxY = Math.max(maxY, n.y + g.h / 2);
    }
    const W = wrap.clientWidth || 600;
    const H = wrap.clientHeight || 380;
    const pad = 56;
    const s = Math.max(0.35, Math.min(3, Math.min((W - pad * 2) / Math.max(1, maxX - minX), (H - pad * 2) / Math.max(1, maxY - minY))));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    apply({ view: { s, tx: W / 2 - cx * s, ty: H / 2 - cy * s } });
  };

  const loadDemo = (i: DemoId | 'sampled'): void => {
    const d = i === 'sampled' ? sampledDemo() : DEMOS[i].build();
    setSelNodes([]);
    setSelEdge(-1);
    apply({ nodes: d.nodes, edges: d.edges, seq: d.seq, view: { s: 0.9, tx: 40, ty: 20 } });
  };

  const selNode = selNodes.length === 1 ? params.nodes.find((n) => n.id === selNodes[0]) ?? null : null;
  const selEdgeObj = selEdge >= 0 ? params.edges[selEdge] : null;

  const tfTex = solved.ok ? 'T(s)=\\dfrac{' + polyTex(solved.frac.n) + '}{' + polyTex(solved.frac.d) + '}' : null;
  const zfTex = samp && samp.ok ? 'T(z)=\\dfrac{' + polyTex(samp.z.n, 'z') + '}{' + polyTex(samp.z.d, 'z') + '}' : null;

  const nodeLabel = (n: BlkNode): string => {
    if (n.kind === 'box') return n.expr ?? (n.dom === 'z' ? 'H(z)' : 'G(s)');
    if (n.kind === 'sum') return 'Σ';
    if (n.kind === 'sample') return '⌄';
    if (n.kind === 'zoh') return 'ZOH';
    return '';
  };

  return (
    <>
      {props.leftOpen ? (
        <aside class="ws-left">
          <FieldGroup title="元件库" desc="点击添加（落点在视图中心）；拖动元件布置，拖出右端口连线。">
            <div class="row">
              {(Object.keys(KIND_LABEL) as BlockNodeKind[]).map((k) => (
                <button key={k} class="btn" onClick={() => addNode(k)}>
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </FieldGroup>
          <FieldGroup title="示例" desc="载入典型结构快速体验（可继续编辑）。">
            <div class="row">
              {DEMOS.map((d, i) => (
                <button key={d.name} class="btn" onClick={() => loadDemo(i as DemoId)}>
                  {d.name}
                </button>
              ))}
              <button class="btn" onClick={() => loadDemo('sampled')}>
                采样系统
              </button>
            </div>
          </FieldGroup>
          <FieldGroup title="采样周期 T" desc="采样开关 / 零阶保持器 / z 域元件使用。">
            <SliderField label="T · 采样周期" value={params.T} onChange={(v) => applyLive({ T: v })} min={0.01} max={2} step={0.01} precision={2} unit="s" />
          </FieldGroup>
          <FieldGroup title="编辑与视图" defaultOpen={false}>
            <Switch label="网格吸附（5 单位）" checked={params.snap} onChange={(v) => apply({ snap: v })} />
            <div class="row">
              <button class="btn" onClick={fitView} title="按全部元件自适应（空画布回单位视图）">
                复位视图
              </button>
              <button
                class="btn danger"
                onClick={() => {
                  setSelNodes([]);
                  setSelEdge(-1);
                  apply({ nodes: [], edges: [], seq: 0 });
                }}
              >
                清空画布
              </button>
            </div>
            <p class="muted">
              Delete 删除选中（元件或连线）；Esc 取消选择；拖空白平移 · 滚轮缩放 · 双击空白适应取景；
              Shift+拖空白框选；拖动线中点徽标可把连线改接到别的元件（原地单击 = 切换正负号）。
            </p>
          </FieldGroup>
        </aside>
      ) : null}

      <section class="ws-main">
        <div class="card stack">
          <h3>框图编辑器（SVG · 正交避障布线）</h3>
          <div class="blk-wrap" ref={wrapRef} style={{ height: '520px' }}>
            <div class="blk-tools">
              <button class="btn" onClick={() => fitView()} title="按元件包围盒自适应取景（双击空白同效）">
                适应
              </button>
              <button
                class="btn"
                onClick={() => {
                  const v = params.view;
                  const ns = Math.max(0.35, Math.min(3, v.s / 1.2));
                  applyLive({ view: { s: ns, tx: v.tx, ty: v.ty } });
                }}
                title="缩小"
              >
                −
              </button>
              <span class="muted mono">{Math.round(params.view.s * 100)}%</span>
              <button
                class="btn"
                onClick={() => {
                  const v = params.view;
                  const ns = Math.max(0.35, Math.min(3, v.s * 1.2));
                  applyLive({ view: { s: ns, tx: v.tx, ty: v.ty } });
                }}
                title="放大"
              >
                +
              </button>
            </div>
            <svg
              ref={svgRef}
              class="blk-svg"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onDblClick={(e) => {
                const t = e.target as Element;
                if (t && t.tagName === 'svg') fitView();
              }}
              onContextMenu={(e) => e.preventDefault()}
              onWheel={(e) => {
                e.preventDefault();
                const svg = svgRef.current;
                if (!svg) return;
                const r = svg.getBoundingClientRect();
                const px = e.clientX - r.left;
                const py = e.clientY - r.top;
                const v = params.view;
                const wx = (px - v.tx) / v.s;
                const wy = (py - v.ty) / v.s;
                const ns = Math.max(0.35, Math.min(3, v.s * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
                applyLive({ view: { s: ns, tx: px - wx * ns, ty: py - wy * ns } });
              }}
            >
              <defs>
                <pattern id="blk-grid" width={50} height={50} patternUnits="userSpaceOnUse">
                  <path class="blk-grid-line" d="M 50 0 L 0 0 0 50" fill="none" />
                </pattern>
              </defs>
              <g transform={'translate(' + params.view.tx + ' ' + params.view.ty + ') scale(' + params.view.s + ')'}>
                <rect x={-5000} y={-5000} width={10000} height={10000} fill="url(#blk-grid)" pointer-events="none" />
                {edgeGeoms.map((g, i) => {
                  if (!g) return null;
                  const e = params.edges[i];
                  const sel = i === selEdge;
                  return (
                    <g key={'e' + i}>
                      <path
                        class={'blk-edge' + (sel ? ' is-sel' : '') + (g.blocked ? ' is-blocked' : '')}
                        d={g.d}
                        pointer-events="none"
                        vector-effect="non-scaling-stroke"
                      />
                      <polygon
                        class={'blk-arrow' + (sel ? ' is-sel' : '') + (g.blocked ? ' is-blocked' : '')}
                        points={arrowOf(g.pts)}
                        pointer-events="none"
                        vector-effect="non-scaling-stroke"
                      />
                      <path
                        class="blk-edge-hit"
                        d={g.d}
                        vector-effect="non-scaling-stroke"
                        onPointerDown={(ev) => {
                          ev.stopPropagation();
                          setSelEdge(i);
                          setSelNodes([]);
                        }}
                      />
                      <g
                        class="blk-badge-g"
                        transform={'translate(' + g.mid.x + ' ' + g.mid.y + ')'}
                        title="单击切换正负号 · 拖动可把该连线的终点改接到别的元件"
                        onPointerDown={(ev) => {
                          ev.stopPropagation();
                          setSelEdge(i);
                          setSelNodes([]);
                          // 拖动 = 改接终点；原地松开 = 切换正负号（在 onPointerUp 中判定）
                          relinkRef.current = { index: i, p0: screenToWorld(ev.clientX, ev.clientY), sx: ev.clientX, sy: ev.clientY, moved: false };
                          try {
                            (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
                          } catch {
                            /* 指针捕获不可用 */
                          }
                        }}
                      >
                        <circle class="blk-badge" r={9} />
                        <text class="blk-badge-txt" text-anchor="middle" dominant-baseline="central">
                          {e.sign === -1 ? '−' : '+'}
                        </text>
                      </g>
                    </g>
                  );
                })}

                {wire ? (
                  <path
                    class="blk-wire"
                    d={(() => {
                      const from = params.nodes.find((n) => n.id === wire.from);
                      if (!from) return '';
                      const a = outPort(from);
                      const b = wire.target != null ? (() => {
                        const tn = params.nodes.find((n) => n.id === wire.target);
                        return tn ? inSlots(tn)[0] : wire.cur;
                      })() : wire.cur;
                      const r = routePath(a, b, 'left', 0, []);
                      return r.d;
                    })()}
                    pointer-events="none"
                    vector-effect="non-scaling-stroke"
                  />
                ) : null}

                {band ? (
                  <rect
                    class="blk-band"
                    x={Math.min(band.a.x, band.b.x)}
                    y={Math.min(band.a.y, band.b.y)}
                    width={Math.abs(band.b.x - band.a.x)}
                    height={Math.abs(band.b.y - band.a.y)}
                    pointer-events="none"
                    vector-effect="non-scaling-stroke"
                  />
                ) : null}

                {relink && relink.moved ? (
                  <path
                    class="blk-wire is-relink"
                    d={(() => {
                      const e0 = params.edges[relink.index];
                      if (!e0) return '';
                      const from = params.nodes.find((n) => n.id === e0.from);
                      if (!from) return '';
                      const tn = relink.target != null ? params.nodes.find((n) => n.id === relink.target) : null;
                      const b = tn ? inSlots(tn)[0] : relink.cur;
                      return routePath(outPort(from), b, tn ? inSlots(tn)[0].slot : 'left', 0, []).d;
                    })()}
                    pointer-events="none"
                    vector-effect="non-scaling-stroke"
                  />
                ) : null}

                {params.nodes.map((n) => {
                  const g = nodeGeom(n);
                  const sel = selNodes.includes(n.id);
                  const isTarget = wire?.target === n.id || (relink != null && relink.moved && relink.target === n.id);
                  const invalid = n.kind === 'box' && !n.f;
                  return (
                    <g
                      key={'n' + n.id}
                      class={'blk-node' + (isTarget ? ' is-target' : '')}
                      transform={'translate(' + n.x + ' ' + n.y + ')'}
                    >
                      {n.kind === 'box' ? (
                        <>
                          <rect
                            class={'blk-box' + (sel ? ' is-sel' : '') + (invalid ? ' is-err' : '')}
                            x={-g.w / 2}
                            y={-g.h / 2}
                            width={g.w}
                            height={g.h}
                            rx={6}
                          />
                          <text class="blk-txt" text-anchor="middle" dominant-baseline="central" pointer-events="none">
                            {nodeLabel(n).length > 16 ? nodeLabel(n).slice(0, 15) + '…' : nodeLabel(n)}
                          </text>
                          {invalid ? (
                            <text class="blk-warn" x={g.w / 2 - 6} y={-g.h / 2 + 2} text-anchor="middle" pointer-events="none">
                              !
                            </text>
                          ) : null}
                        </>
                      ) : null}
                      {n.kind === 'sum' ? (
                        <>
                          <circle class={'blk-shape' + (sel ? ' is-sel' : '')} r={SR} />
                          <text class="blk-txt" text-anchor="middle" dominant-baseline="central" pointer-events="none">
                            Σ
                          </text>
                        </>
                      ) : null}
                      {n.kind === 'branch' ? <circle class={'blk-shape' + (sel ? ' is-sel' : '')} r={BR + 1} /> : null}
                      {n.kind === 'sample' ? (
                        <>
                          <rect class={'blk-box' + (sel ? ' is-sel' : '')} x={-g.w / 2} y={-g.h / 2} width={g.w} height={g.h} rx={4} />
                          <text class="blk-txt" text-anchor="middle" dominant-baseline="central" pointer-events="none">
                            ⌄ T
                          </text>
                        </>
                      ) : null}
                      {n.kind === 'zoh' ? (
                        <>
                          <rect class={'blk-box' + (sel ? ' is-sel' : '')} x={-g.w / 2} y={-g.h / 2} width={g.w} height={g.h} rx={4} />
                          <text class="blk-txt" text-anchor="middle" dominant-baseline="central" pointer-events="none">
                            ZOH ⊓
                          </text>
                        </>
                      ) : null}
                      {/* 输入槽标记 */}
                      {inSlots(n).map((s) => (
                        <circle key={s.slot} class="blk-port in" transform={'translate(' + (s.x - n.x) + ' ' + (s.y - n.y) + ')'} r={2.6} pointer-events="none" />
                      ))}
                      {/* 输出端口：可见圆 + 透明热区（位于连线上层 ⇒ 端口点击优先于「选中连线」） */}
                      <circle class="blk-port" cx={g.w / 2 + 5} cy={0} r={3.4} pointer-events="none" />
                      <circle
                        class="blk-port-hit"
                        cx={g.w / 2 + 5}
                        cy={0}
                        r={8}
                        onPointerDown={(ev) => {
                          ev.stopPropagation();
                          setHint('');
                          setWire({ from: n.id, cur: screenToWorld(ev.clientX, ev.clientY), target: null });
                        }}
                      />
                      {/* 标记：R / Y */}
                      <text class="blk-sub" text-anchor="middle" dominant-baseline="central" y={-g.h / 2 - 8} pointer-events="none">
                        {n.src ? 'R' : ''}
                        {n.out ? 'Y' : ''}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>
          <div class="row">
            <StatusBadge kind={hasSampled ? (samp?.ok ? 'ok' : 'warn') : solved.ok ? 'ok' : 'warn'}>
              {hasSampled ? (samp?.ok ? 'z 域求解成功' : '采样分析未完成') : solved.ok ? '求解成功' : '未求解'}
            </StatusBadge>
            <span class="muted" style="margin:0">
              {params.nodes.length} 元件 · {params.edges.length} 连线
              {invalidCount ? ' · ' + invalidCount + ' 个元件表达式无效（不参与求解）' : ''}
              {blockedCount ? ' · ' + blockedCount + ' 条连线布线受阻（可挪动元件改善）' : ''}
            </span>
            {hint ? <StatusBadge kind="info">{hint}</StatusBadge> : null}
          </div>
          {hasSampled && !solved.ok ? (
            <p class="muted" style="margin:0">
              连续段求解未成功：{solved.note}
            </p>
          ) : null}
        </div>

        <div class="card stack">
          <h3>求解结果</h3>
          {hasSampled ? (
            <p class="muted" style="margin-top:0">
              图中含采样元件：主结果为 z 域脉冲传函，见下方「采样系统分析」（连续段按采样器位置自动离散化；误差点采样是标准接法）。
            </p>
          ) : solved.ok ? (
            <>
              <div class="formula-block">
                <div class="tex-line">
                  <TeX tex={tfTex ?? ''} />
                </div>
              </div>
              <div class="row">
                <Metric label="阶次" value={read?.order ?? '—'} precision={0} />
                <Metric
                  label="稳定性"
                  value={read?.stableText ?? '—'}
                  tone={read?.hasRhp ? 'danger' : read?.hasJw ? 'warn' : 'ok'}
                />
                <Metric label="ζ · 主导阻尼" value={read?.zeta ?? '—'} precision={3} />
                <Metric label="ωn · 自然频率" value={read?.wn ?? '—'} unit="rad/s" precision={3} />
              </div>
            </>
          ) : (
            <p class="muted">{'未求解：' + solved.note}</p>
          )}
        </div>

        <div class="grid2">
          <div class="card stack">
            <h3>闭环极点（s 平面）</h3>
            {hasSampled ? (
              <p class="muted" style="margin-top:0">含采样元件：极点分布见下方 z 域读数（本卡仅显示连续系统极点）。</p>
            ) : null}
            <ComplexPlane markers={hasSampled ? [] : markers} mode="jw" height={260} halfW={Math.max(2, (read?.wn ?? 2) * 1.6)} fitKey={'blk-' + params.nodes.length + '-' + params.edges.length} />
            <p class="muted">× = 闭环极点（T(s) 分母根）；左半平面 = 稳定。</p>
          </div>
          <div class="card stack">
            <h3>闭环阶跃响应</h3>
            {step && !hasSampled ? (
              <Chart
                series={[{ xs: step.t, ys: step.y, glow: 2.5 }]}
                xRange={[0, step.t[step.t.length - 1]]}
                yRange={[Math.min(0, ...step.y.slice(0, 40)) * 1.1, Math.max(1.2, ...step.y.slice(0, 200)) * 1.15]}
                height={260}
                xLabel="t (s)"
                yLabel="y(t)"
              />
            ) : solved.ok ? (
              <p class="muted">
                闭环传函为纯增益（无动态）：T(s) = {(solved.frac.n[0] ?? 1) / (solved.frac.d[0] || 1)}，无阶跃动态可绘。
              </p>
            ) : (
              <p class="muted">暂无闭环解（含采样元件时请见 z 域分析）。</p>
            )}
          </div>
        </div>

        {hasSampled ? (
          <div class="card stack">
            <h3>采样系统分析（T = {nf(params.T, 3)} s）</h3>
            {samp && samp.ok ? (
              <>
                <div class="row">
                  <StatusBadge kind="info">{samp.mode === 'sampled' ? '采样系统：连续段 + z 域归约' : '纯 z 域'}</StatusBadge>
                  <StatusBadge kind={samp.read.stable ? 'ok' : 'warn'}>{samp.read.stableText}</StatusBadge>
                  <Metric label="z 域阶次" value={samp.read.order} precision={0} />
                  <Metric label="z 极点" value={samp.read.poles.map((p) => cx(p.re, p.im, 3)).join('，') || '—'} />
                </div>
                {zfTex ? (
                  <div class="tex-line">
                    <TeX tex={zfTex} />
                  </div>
                ) : null}
                {samp.segs.length ? (
                  <table class="tbl scroll">
                    <thead>
                      <tr>
                        <th>连续段</th>
                        <th>入 → 出</th>
                        <th>ZOH</th>
                      </tr>
                    </thead>
                    <tbody>
                      {samp.segs.map((s, i) => (
                        <tr key={i}>
                          <td>#{i + 1}</td>
                          <td class="mono">
                            {s.in} → {s.out}
                          </td>
                          <td>{s.hasZoh ? '含' : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
                <p class="muted">连续段先按 T 离散化为 z 域，再与纯 z 元件统一求解（采样器下沉 / 域传播）。</p>
              </>
            ) : (
              <p class="muted">
                采样分析未完成：{samp && !samp.ok ? (samp.note ?? (samp.mode === 's' ? '当前图不含采样元件。' : '结构不完整。')) : '等待连线。'}
              </p>
            )}
          </div>
        ) : null}
      </section>

      {props.rightOpen ? (
        <aside class="ws-right">
          <div class="card stack">
            <h4 class="card-h">属性</h4>
            {selNode ? (
              <>
                <div class="row">
                  <StatusBadge kind="info">{KIND_LABEL[selNode.kind]} #{selNode.id}</StatusBadge>
                  <button
                    class="btn"
                    onClick={() => {
                      setSelNodes([]);
                      apply({
                        nodes: params.nodes.filter((n) => n.id !== selNode.id),
                        edges: params.edges.filter((e) => e.from !== selNode.id && e.to !== selNode.id),
                      });
                    }}
                  >
                    删除
                  </button>
                  <button class="btn" onClick={() => setSelNodes([])}>
                    取消选择
                  </button>
                </div>
                {selNode.kind === 'box' ? (
                  <>
                    <ExprField
                      label={selNode.dom === 'z' ? 'H(z)' : 'G(s)'}
                      value={selNode.expr ?? ''}
                      onChange={(v) => {
                        const f = parseBlockTF(v, selNode.dom ?? 's');
                        const nodes = params.nodes.map((n) => (n.id === selNode.id ? { ...n, expr: v, f: f.ok ? { n: f.n, d: f.d } : null } : n));
                        applyLive({ nodes });
                      }}
                      status={selNode.f ? 'ok' : 'err'}
                      message={selNode.f ? '已解析' : '无法解析：请检查写法'}
                      hint="示例：10/(s+1)、(s+2)/((s+1)*(s+3))、0.5/(z-0.5)"
                    />
                    <SegmentedChips
                      options={[
                        { value: 's', label: 's 域' },
                        { value: 'z', label: 'z 域' },
                      ]}
                      value={selNode.dom ?? 's'}
                      onChange={(v) => {
                        const f = parseBlockTF(selNode.expr ?? '', v);
                        const nodes = params.nodes.map((n) => (n.id === selNode.id ? { ...n, dom: v, f: f.ok ? { n: f.n, d: f.d } : null } : n));
                        apply({ nodes });
                      }}
                      ariaLabel="域"
                    />
                  </>
                ) : null}
                <Switch label="R · 输入源（注入点）" checked={!!selNode.src} onChange={(v) => apply({ nodes: params.nodes.map((n) => (n.id === selNode.id ? { ...n, src: v } : n)) })} />
                <Switch label="Y · 输出测点" checked={!!selNode.out} onChange={(v) => apply({ nodes: params.nodes.map((n) => (n.id === selNode.id ? { ...n, out: v } : n)) })} />
                {selNode.kind === 'box' && !selNode.f ? (
                  <StatusBadge kind="err">传函解析失败：该元件不参与求解</StatusBadge>
                ) : null}
                <p class="muted">位置：({nf(selNode.x, 1)}, {nf(selNode.y, 1)})</p>
              </>
            ) : selEdgeObj ? (
              <>
                <div class="row">
                  <StatusBadge kind="info">
                    连线 #{selEdge + 1}：{selEdgeObj.from} → {selEdgeObj.to}
                  </StatusBadge>
                </div>
                <SegmentedChips
                  options={[
                    { value: '1', label: '＋ 正号' },
                    { value: '-1', label: '− 负号' },
                  ]}
                  value={String(selEdgeObj.sign)}
                  onChange={(v) => apply({ edges: params.edges.map((x, k) => (k === selEdge ? { ...x, sign: Number(v) } : x)) })}
                  ariaLabel="连线符号"
                />
                <button
                  class="btn danger"
                  onClick={() => {
                    apply({ edges: params.edges.filter((_, i) => i !== selEdge) });
                    setSelEdge(-1);
                  }}
                >
                  删除连线
                </button>
                <p class="muted">求和点的入边符号决定 ＋/−；反馈回路请用负号。</p>
              </>
            ) : (
              <p class="muted">点击元件或连线查看属性；Shift 点击可多选元件。</p>
            )}
          </div>

          <div class="card stack">
            <h4 class="card-h">统计</h4>
            <div class="row">
              <Metric label="元件" value={params.nodes.length} precision={0} />
              <Metric label="连线" value={params.edges.length} precision={0} />
            </div>
            <div class="row">
              <Metric label="布线受阻" value={blockedCount} precision={0} tone={blockedCount ? 'warn' : 'ok'} hint="挪动元件可改善（避障候选打分）" />
              <Metric label="视图缩放" value={params.view.s} precision={2} />
            </div>
          </div>

          <div class="card stack">
            <h4 class="card-h">操作提示</h4>
            <p class="muted" style="margin-top:0">
              从元件右侧小圆点拖出连线，落到目标元件上即连；点击连线中点的 ⊕/⊖ 徽标可直接切换符号。
              元件上方的 R/Y 标记对应「输入源 / 输出测点」；求和点与分支点内置单位增益，参与求解。
            </p>
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