import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Chart } from '../../chart/Chart';
import { ComplexPlane, type CPMarker } from '../../chart/ComplexPlane';
import { ExprField, FieldGroup, Metric, SegmentedChips, SliderField, StatePanel, StatusBadge } from '../../ui/components';
import {
  closedLoopMetrics,
  evalH,
  ltiResponse,
  loopMargins,
  nyquistFull,
  parseTF,
  polyAdd,
  pTrim,
  polyRoots,
  rootLocus,
  steadyState,
} from '../../core';
import { createUndoStack } from '../../state/undo';
import { getModuleState, setModuleState } from '../../state/experiments';
import { useExperimentSync } from '../useSync';
import type { ToolViewProps } from '../api';

/**
 * 系统分析（sys）
 * 开环 L(s) = K·N(s)/D(s)：波特 / 奈奎斯特 / 根轨迹 / 阶跃 四视图 + 稳定裕度与闭环指标。
 * K 为单一增益滑杆（数值框随滑杆）；坐标轴范围随数据自适应。
 */

type ViewId = 'bode' | 'nyquist' | 'locus' | 'step';

interface SysParams {
  expr: string;
  K: number;
  view: ViewId;
}

const DEFAULT: SysParams = { expr: '1/(s*(s+1)*(s+2))', K: 1, view: 'bode' };

const VIEWS: ReadonlyArray<{ value: ViewId; label: string }> = [
  { value: 'bode', label: '波特图' },
  { value: 'nyquist', label: '奈奎斯特' },
  { value: 'locus', label: '根轨迹' },
  { value: 'step', label: '阶跃响应' },
];

const PRESETS: ReadonlyArray<{ label: string; expr: string }> = [
  { label: '一阶', expr: '1/(s+1)' },
  { label: '二阶', expr: '10/(s^2+2s+10)' },
  { label: '三阶', expr: '1/(s*(s+1)*(s+2))' },
  { label: '双积分', expr: '1/s^2' },
  { label: '不稳定', expr: '1/(s^2-0.3s+1)' },
];

function sanitize(raw: unknown): SysParams {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SysParams>;
  const views: ViewId[] = ['bode', 'nyquist', 'locus', 'step'];
  const v = views.includes(r.view as ViewId) ? (r.view as ViewId) : DEFAULT.view;
  return {
    expr: typeof r.expr === 'string' && r.expr.trim() ? r.expr : DEFAULT.expr,
    K: Number.isFinite(r.K) ? Math.max(0.01, Math.min(100, r.K as number)) : DEFAULT.K,
    view: v,
  };
}

const num2 = (v: number | null): string => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(3));

export function SysTool(props: ToolViewProps) {
  const [params, setParams] = useState<SysParams>(() => sanitize(getModuleState<SysParams>('sys', DEFAULT)));
  const undoRef = useRef(createUndoStack<SysParams>(40));
  const lastPush = useRef(0);

  // 自动保存（debounce 在 state 层）
  useEffect(() => {
    setModuleState('sys', params);
  }, [params]);

  // 实验切换（首页继续 / 实验管理打开 / 新建模板）→ 重新载入本工具参数
  useExperimentSync('sys',
    () => sanitize(getModuleState<SysParams>('sys', DEFAULT)),
    (v) => {
      setParams(v);
      undoRef.current.clear();
    },
  );

  /** 参数变更（连续拖动 500ms 内合并为一次撤销点） */
  const apply = (next: Partial<SysParams>): void => {
    const now = Date.now();
    if (now - lastPush.current > 500) {
      undoRef.current.push(params);
      lastPush.current = now;
    }
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };

  /** 不带撤销点的连续变更（滑杆拖动中） */
  const applyLive = (next: Partial<SysParams>): void => {
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };

  const parsed = useMemo(() => {
    const t = parseTF(params.expr);
    if (!t || !(t.den[0] || 0)) return null;
    return t;
  }, [params.expr]);

  const L = useMemo(() => (parsed ? { num: parsed.num.map((c) => c * params.K), den: parsed.den } : null), [parsed, params.K]);
  const mg = useMemo(() => (L ? loopMargins(L.num, L.den) : null), [L]);
  const clm = useMemo(() => (L ? closedLoopMetrics(L.num, L.den) : null), [L]);
  const sse = useMemo(() => (L ? steadyState(L.num, L.den) : null), [L]);
  const nyqInfo = useMemo(() => (L ? nyquistFull(L.num, L.den) : null), [L]);

  // 开环极点分布速读：区分「右半平面」「虚轴共轭对」「原点（积分环节）」三类
  const openLoop = useMemo((): { text: string; tone: 'ok' | 'warn' | 'err' } => {
    if (!mg) return { text: '—', tone: 'ok' };
    const TOL = 1e-7;
    if (mg.poles.some((p) => p.re > TOL)) return { text: '开环不稳定（存在右半平面极点）', tone: 'err' };
    const imag = mg.poles.filter((p) => Math.abs(p.re) <= TOL && Math.abs(p.im) > TOL);
    if (imag.length) return { text: `开环临界（虚轴极点 ${imag.length} 个）`, tone: 'warn' };
    if (mg.poles.some((p) => Math.abs(p.re) <= TOL)) return { text: '开环含原点极点（积分环节）', tone: 'ok' };
    return { text: '开环稳定（全部极点左半平面）', tone: 'ok' };
  }, [mg]);

  // 复平面零极点（开环）：零点直接求根，避免重复调用 rootLocus
  const cpMarkers: CPMarker[] = useMemo(() => {
    if (!mg || !parsed) return [];
    const nTrim = pTrim(parsed.num);
    const zeros = nTrim.length > 1 ? polyRoots(nTrim) : [];
    return [
      ...mg.poles.map((p) => ({ re: p.re, im: p.im, kind: 'pole' as const })),
      ...zeros.map((z) => ({ re: z.re, im: z.im, kind: 'zero' as const })),
    ];
  }, [mg, parsed]);

  // 奈奎斯特曲线（ω: 1e-2 → 1e2，正频段）
  const nyq = useMemo(() => {
    if (!L || params.view !== 'nyquist') return null;
    const re: number[] = [];
    const im: number[] = [];
    const N = 220;
    for (let i = 0; i <= N; i++) {
      const w = Math.pow(10, -2 + (4 * i) / N);
      const h = evalH(L.num, L.den, w);
      re.push(h.re);
      im.push(h.im);
    }
    return { re, im };
  }, [L, params.view]);

  // 根轨迹（对未乘 K 的开环扫描）+ 当前 K 的闭环极点（随滑杆联动）
  const locus = useMemo(() => {
    if (!parsed || params.view !== 'locus') return null;
    return rootLocus(parsed.num, parsed.den);
  }, [parsed, params.view]);

  const clPoles = useMemo(() => {
    if (!parsed || params.view !== 'locus') return [];
    const den = pTrim(polyAdd(parsed.den, parsed.num.map((c) => c * params.K)));
    return den.length > 1 ? polyRoots(den) : [];
  }, [parsed, params.K, params.view]);

  // 波特图纵轴按数据自适应（K 变化不再出界被裁）
  const bodeRange = useMemo((): { mag: [number, number]; ph: [number, number] } => {
    if (!mg) return { mag: [-80, 40], ph: [-270, 0] };
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of mg.bode.mag) {
      if (Number.isFinite(v) && v > hi) hi = v;
      if (Number.isFinite(v) && v < lo) lo = v;
    }
    let plo = Infinity;
    let phi = -Infinity;
    for (const v of mg.bode.ph) {
      if (Number.isFinite(v) && v > phi) phi = v;
      if (Number.isFinite(v) && v < plo) plo = v;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { mag: [-80, 40], ph: [-270, 0] };
    const padv = Math.max(6, (hi - lo) * 0.08);
    const ppadv = Math.max(10, (phi - plo) * 0.08);
    return {
      mag: [Math.floor((lo - padv) / 5) * 5, Math.ceil((hi + padv) / 5) * 5],
      ph: [Math.floor((plo - ppadv) / 10) * 10, Math.ceil((phi + ppadv) / 10) * 10],
    };
  }, [mg]);

  // 奈奎斯特视野：取分位数聚焦临界点邻域（低频 |L|→∞ 不再把图拉爆）
  const nyqRange = useMemo((): { x: [number, number]; y: [number, number] } => {
    if (!nyq) return { x: [-2.5, 1.5], y: [-2, 2] };
    const q = (arr: number[], p: number): number => {
      const s = [...arr].sort((a, b) => a - b);
      const i = Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))));
      return Number.isFinite(s[i]) ? s[i] : 0;
    };
    const xlo = Math.min(q(nyq.re, 0.08), -1.15);
    const xhi = Math.max(q(nyq.re, 0.92), 0.15);
    const ylo = Math.min(q(nyq.im, 0.08), -0.15);
    const yhi = Math.max(q(nyq.im, 0.92), 0.15);
    const px = Math.max(0.15, (xhi - xlo) * 0.08);
    const py = Math.max(0.15, (yhi - ylo) * 0.08);
    return { x: [xlo - px, xhi + px], y: [ylo - py, yhi + py] };
  }, [nyq]);

  // 闭环阶跃响应
  const step = useMemo(() => {
    if (!L || params.view !== 'step') return null;
    const denCl = pTrim(polyAdd(L.den, L.num));
    if (!denCl.length || !denCl[0]) return null;
    return ltiResponse(L.num, denCl, () => 1, 0, 12, 700);
  }, [L, params.view]);

  const stepRange = useMemo((): [number, number] => {
    if (!step) return [0, 1.5];
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of step.y) {
      if (!Number.isFinite(v)) continue;
      if (v > hi) hi = v;
      if (v < lo) lo = v;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1.5];
    const span = hi - lo || 1;
    return [Math.min(0, lo - 0.05 * span), hi + 0.12 * span];
  }, [step]);

  // 结果条与撤销（注册 ToolApi）
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
      subtitle: () => (params.view === 'bode' && mg?.wc ? `K=${params.K} · ωc=${mg.wc.toFixed(2)} rad/s` : `K=${params.K}`),
      metrics: () =>
        mg
          ? [
              {
                label: '相位裕度 PM',
                value: mg.PM ?? '—',
                unit: '°',
                precision: 1,
                tone: mg.PM == null ? 'default' : mg.PM < 0 ? 'danger' : mg.PM < 30 ? 'warn' : 'ok',
                hint: '0 dB 穿越处 180°+∠L',
              },
              { label: '增益裕度 GM', value: mg.GM ?? '∞', unit: 'dB', precision: 1, hint: '−180° 穿越处 −|L|(dB)' },
              { label: '增益穿越 ωc', value: mg.wc ?? '—', unit: 'rad/s', precision: 3 },
              { label: '闭环带宽 ωb', value: clm && clm.wb != null ? clm.wb : '—', unit: 'rad/s', precision: 3 },
            ]
          : [],
      exports: () => [
        {
          id: 'csv',
          label: 'CSV',
          run: () => {
            if (!mg) return;
            const rows = ['w,mag_db,ph_deg'];
            for (let i = 0; i < mg.bode.w.length; i++) {
              rows.push(`${mg.bode.w[i]},${mg.bode.mag[i]},${mg.bode.ph[i]}`);
            }
            downloadText('sys-bode.csv', rows.join('\n'));
          },
        },
        {
          id: 'json',
          label: 'JSON',
          run: () => downloadText('sys-experiment.json', JSON.stringify(params, null, 2)),
        },
      ],
    });
    return () => props.api(null);
    // eslint 无；api 随参数刷新
  }, [params, mg, clm]);

  if (!parsed) {
    return (
      <>
        {props.leftOpen ? (
          <aside class="ws-left">
            <FieldGroup title="开环传函 L(s)" desc="输入 N(s)/D(s)，分子分母为 s 的多项式。">
              <ExprField
                label="L(s)（不含增益 K）"
                value={params.expr}
                onChange={(v) => apply({ expr: v })}
                status="err"
                message="无法解析：请检查括号与运算符"
                hint="示例：1/(s*(s+1)*(s+2))、10/(s^2+2s+10)"
              />
            </FieldGroup>
          </aside>
        ) : null}
        <section class="ws-main">
          <StatePanel
            kind="error"
            title="传函无法解析"
            desc="请检查括号与运算符；支持 (s+1)*(s+2)、s^2+2s+10、0.9s/(s^2+0.4s+1.21) 等写法。"
            action={{ label: '恢复默认 L(s)', onClick: () => apply({ expr: DEFAULT.expr }) }}
          />
        </section>
      </>
    );
  }

  return (
    <>
      {props.leftOpen ? (
        <aside class="ws-left">
          <FieldGroup title="开环传函 L(s)" desc="系数自高到低；增益 K 单独滑杆调节。">
            <ExprField
              label="L(s)（不含增益 K）"
              value={params.expr}
              onChange={(v) => apply({ expr: v })}
              status="ok"
              message="已解析"
              hint="示例：1/(s*(s+1)*(s+2))"
            />
            <div class="row">
              {PRESETS.map((p) => (
                <button key={p.label} class="btn" onClick={() => apply({ expr: p.expr })}>
                  {p.label}
                </button>
              ))}
            </div>
          </FieldGroup>

          <FieldGroup title="增益与视图" onReset={() => apply({ K: DEFAULT.K, view: DEFAULT.view })}>
            <SliderField
              label="增益 K · 开环（L = K·N/D）"
              value={params.K}
              onChange={(v) => applyLive({ K: v })}
              min={0.01}
              max={100}
              step={0.01}
              precision={2}
              hint="拖动实时重算裕度与全部视图"
            />
            <SegmentedChips options={VIEWS} value={params.view} onChange={(v) => apply({ view: v })} ariaLabel="视图" />
          </FieldGroup>

          <FieldGroup title="稳定性速读" defaultOpen>
            <div class="row">
              <StatusBadge kind={openLoop.tone}>{openLoop.text}</StatusBadge>
              {nyqInfo ? (
                <StatusBadge kind={nyqInfo.stable ? 'ok' : nyqInfo.onCritical ? 'warn' : 'err'}>
                  闭环 {nyqInfo.stable ? '稳定' : nyqInfo.onCritical ? '临界' : '不稳定'}（Z={nyqInfo.Z}）
                </StatusBadge>
              ) : null}
            </div>
            <p class="muted">Z = N + P 完整奈奎斯特判据（Z=0 且不穿过 (−1,0) 判稳定）；原点极点由围线绕开处理。</p>
          </FieldGroup>
        </aside>
      ) : null}

      <section class="ws-main">
        {params.view === 'bode' ? (
          <div class="card stack">
            <h3>波特图 · 幅值与相位（对数轴 · 滚轮缩放 · 悬停读数）</h3>
            <Chart
              series={[{ xs: mg!.bode.w, ys: mg!.bode.mag }]}
              xRange={[1e-2, 1e3]}
              yRange={bodeRange.mag}
              xLog
              height={250}
              markers={
                mg!.wc != null ? [{ x: mg!.wc, y: 0, kind: 'point' as const, color: '#A15C06', focus: true }] : []
              }
              xLabel="ω (rad/s，对数轴)"
              yLabel="幅值 (dB)"
            />
            <Chart
              series={[{ xs: mg!.bode.w, ys: mg!.bode.ph, color: 'var(--series-3)' }]}
              xRange={[1e-2, 1e3]}
              yRange={bodeRange.ph}
              xLog
              height={220}
              markers={mg!.wg != null ? [{ x: mg!.wg, y: -180, kind: 'point' as const, color: '#C7403C', focus: true }] : []}
              xLabel="ω (rad/s，对数轴)"
              yLabel="相位 (°)"
            />
            <p class="muted">
              PM = 180° + ∠L(ωc)，GM = −|L|(dB)@ωg；0 dB 穿越点（金色）与 −180° 穿越点（红色）已在图上标出。
            </p>
          </div>
        ) : null}

        {params.view === 'nyquist' && nyq ? (
          <div class="card stack">
            <h3>奈奎斯特图 · G(jω) 轨迹与临界点 (−1, 0)</h3>
            <Chart
              series={[{ xs: nyq.re, ys: nyq.im }]}
              xRange={nyqRange.x}
              yRange={nyqRange.y}
              height={340}
              markers={[{ x: -1, y: 0, kind: 'point' as const, color: '#C7403C', size: 8, focus: true }]}
              xLabel="Re"
              yLabel="Im"
            />
            <p class="muted">
              P = {nyqInfo?.P ?? '—'} · N = {nyqInfo?.N ?? '—'} · Z = N + P = {nyqInfo?.Z ?? '—'}（正频段 ω: 10⁻²…10² rad/s）；
              {nyqInfo?.onCritical ? '曲线接近临界点，裕度极小。' : '轨迹对 (−1,0) 的顺时针包围 = 闭环右半平面极点数。'}
            </p>
          </div>
        ) : null}

        {params.view === 'locus' && locus ? (
          <div class="card stack">
            <h3>根轨迹 · K: 0 → ∞（分支按实根/共轭对追踪）</h3>
            <Chart
              series={locus.branches.map((b) => ({ xs: b.pts.map((p) => p.re), ys: b.pts.map((p) => p.im), width: 1.8 }))}
              xRange={[-6, 2]}
              yRange={[-3.5, 3.5]}
              height={340}
              markers={[
                ...locus.poles.map((p) => ({ x: p.re, y: p.im, kind: 'pole' as const })),
                ...locus.zeros.map((z) => ({ x: z.re, y: z.im, kind: 'zero' as const })),
                ...locus.crossings.map((c) => ({ x: 0, y: c.im, kind: 'point' as const, color: '#A15C06', focus: true })),
                ...clPoles.map((p) => ({ x: p.re, y: p.im, kind: 'point' as const, color: 'var(--series-2)', size: 7, focus: true })),
              ]}
              xLabel="σ"
              yLabel="jω"
            />
            <p class="muted">
              渐近线 {locus.excess} 条 · 质心 {num2(locus.centroid.re)}；实心点 = 当前 K={params.K} 的闭环极点
              {locus.crossings.length ? ` · 虚轴穿越 ${locus.crossings.map((c) => `K*=${c.K.toFixed(2)}@±j${c.im.toFixed(2)}`).join('、')}` : ' · 无虚轴穿越'}
            </p>
          </div>
        ) : null}

        {params.view === 'step' && step ? (
          <div class="card stack">
            <h3>闭环阶跃响应（单位负反馈 T = L/(1+L)）</h3>
            <Chart
              series={[{ xs: step.t, ys: step.y, glow: 4 }]}
              xRange={[0, 12]}
              yRange={stepRange}
              height={320}
              xLabel="t (s)"
              yLabel="y(t)"
            />
            <p class="muted">同一开环 L(s) 的单位负反馈闭环；调 K 观察超调与振荡（状态空间数值仿真）。</p>
          </div>
        ) : null}

        {params.view === 'step' && !step ? (
          <StatePanel kind="error" title="闭环退化" desc="当前 L(s) 使闭环分母退化（如非严格真分式且无延迟），无法给出阶跃响应。" />
        ) : null}
      </section>

      {props.rightOpen ? (
        <aside class="ws-right">
          <div class="card stack">
            <h4 class="card-h">频域指标</h4>
            <div class="row">
              <Metric label="相位裕度 PM" value={mg!.PM ?? '—'} unit="°" precision={1} tone={mg!.PM != null && mg!.PM < 30 ? 'warn' : 'default'} hint="0 dB 穿越处" />
              <Metric label="增益裕度 GM" value={mg!.GM ?? '∞'} unit="dB" precision={1} hint="−180° 穿越处" />
            </div>
            <div class="row">
              <Metric label="ωc · 增益穿越" value={mg!.wc ?? '—'} unit="rad/s" precision={3} />
              <Metric label="ωg · 相位穿越" value={mg!.wg ?? '—'} unit="rad/s" precision={3} />
            </div>
            <div class="row">
              <Metric label="Mr · 谐振峰" value={clm && clm.Mr != null ? clm.Mr : '—'} precision={2} />
              <Metric label="ωb · 闭环带宽" value={clm && clm.wb != null ? clm.wb : '—'} unit="rad/s" precision={3} />
            </div>
            <div class="row">
              <Metric label="ωn · 自然频率" value={mg!.wn ?? '—'} unit="rad/s" precision={3} hint="主导极点模" />
              <Metric label="ζ · 阻尼比" value={mg!.zeta ?? '—'} precision={3} hint="ζ = −σ/ωn" />
            </div>
            <div class="row">
              <Metric label="系统型别 ν" value={sse?.type ?? '—'} precision={0} />
              <Metric label="ess · 单位阶跃" value={sse ? sse.ess.step : '—'} precision={3} hint="1/(1+Kp)" />
            </div>
          </div>

          <div class="card stack">
            <h4 class="card-h">极点 / 零点（开环）</h4>
            <ComplexPlane markers={cpMarkers} mode="jw" height={190} halfW={Math.max(2, (mg!.wn ?? 2) * 1.6)} />
            <p class="muted">
              × 极点 {mg!.poles.length} 个 · ○ 零点 {cpMarkers.filter((m) => m.kind === 'zero').length} 个
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