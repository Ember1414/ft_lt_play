import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Chart } from '../../chart/Chart';
import { ComplexPlane } from '../../chart/ComplexPlane';
import { ExprField, FieldGroup, Metric, SegmentedChips, SliderField, StatePanel, StatusBadge } from '../../ui/components';
import { TeX } from '../../ui/TeX';
import {
  closedLoopMetrics,
  ctrlFreq,
  designLag,
  designLead,
  ltiResponse,
  loopMargins,
  parseTF,
  pTrim,
  placePoles,
  polyAdd,
  polyMul,
  polyRoots,
  polyTex,
  secondOrderPoles,
  type Complex,
} from '../../core';
import { createUndoStack } from '../../state/undo';
import { getModuleState, setModuleState } from '../../state/experiments';
import { navigate } from '../../router';
import { useExperimentSync } from '../useSync';
import type { ExportAction, ToolViewProps } from '../api';

/**
 * 控制系统设计器（control）— M2 新工具
 * 频率法超前/滞后校正（校正前后波特对比 · 裕度校核）+ 极点配置（可控标准型 + Ackermann）
 * + 灵敏度校核（|S|、|T|、Ms 鲁棒性指标）。
 * 内核：core/controldesign.ts；正确性由 parity.mjs 闭式真值钉死。
 */

type ViewId = 'plant' | 'lead' | 'lag' | 'place' | 'sens';

interface CtrlParams {
  plant: string;
  view: ViewId;
  PMdes: number;
  wm: number;
  wc: number;
  beta: number;
  zeta: number;
  wn: number;
  tmax: number;
}

const DEFAULT: CtrlParams = {
  plant: '1/(s*(s+1))',
  view: 'plant',
  PMdes: 50,
  wm: 2,
  wc: 0.5,
  beta: 20,
  zeta: 0.6,
  wn: 2,
  tmax: 15,
};

const VIEWS: ReadonlyArray<{ value: ViewId; label: string }> = [
  { value: 'plant', label: '对象分析' },
  { value: 'lead', label: '超前校正' },
  { value: 'lag', label: '滞后校正' },
  { value: 'place', label: '极点配置' },
  { value: 'sens', label: '灵敏度校核' },
];

const PRESETS: ReadonlyArray<{ label: string; plant: string }> = [
  { label: '双积分', plant: '1/(s*(s+1))' },
  { label: '三阶', plant: '10/(s*(s+1)*(s+2))' },
  { label: '二阶', plant: '4/(s^2+2s+4)' },
  { label: '不稳定', plant: '1/(s^2-0.5s+1)' },
  { label: '非最小相位', plant: '(1-0.5s)/(s*(s+1))' },
];

function sanitize(raw: unknown): CtrlParams {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<CtrlParams>;
  const views: ViewId[] = ['plant', 'lead', 'lag', 'place', 'sens'];
  const num = (v: unknown, d: number, lo: number, hi: number): number =>
    Number.isFinite(v) ? Math.max(lo, Math.min(hi, v as number)) : d;
  return {
    plant: typeof r.plant === 'string' && r.plant.trim() ? r.plant : DEFAULT.plant,
    view: views.includes(r.view as ViewId) ? (r.view as ViewId) : DEFAULT.view,
    PMdes: num(r.PMdes, DEFAULT.PMdes, 5, 85),
    wm: num(r.wm, DEFAULT.wm, 1e-3, 1e3),
    wc: num(r.wc, DEFAULT.wc, 1e-3, 1e3),
    beta: num(r.beta, DEFAULT.beta, 1, 1e3),
    zeta: num(r.zeta, DEFAULT.zeta, 0.05, 0.99),
    wn: num(r.wn, DEFAULT.wn, 1e-3, 1e3),
    tmax: num(r.tmax, DEFAULT.tmax, 0.1, 1e4),
  };
}

function coefs(s: { num: number[]; den: number[] }, vn: string): string {
  const f = (c: number[]): string => {
    const parts: string[] = [];
    for (let i = 0; i < c.length; i++) {
      const a = c[i];
      if (Math.abs(a) < 1e-12) continue;
      const pow = c.length - 1 - i;
      const mag = Math.abs(a).toPrecision(8);
      const term = pow === 0 ? mag : pow === 1 ? `${mag}*${vn}` : `${mag}*${vn}^${pow}`;
      parts.push((a < 0 ? '-' : parts.length ? '+' : '') + term);
    }
    return parts.length ? parts.join('') : '0';
  };
  return `(${f(s.num)})/(${f(s.den)})`;
}

function download(name: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 由闭环传函 T(s)=num/den 直接求直流增益 T0、谐振峰 Mr 与带宽 ωb（相对 T0/√2）；不稳定 T 返回 null */
function tMetrics(num: number[], den: number[]): { T0: number; Mr: number | null; wb: number | null; stable: boolean } {
  const poles = polyRoots(pTrim(den));
  if (poles.some((q) => q.re > 1e-9)) return { T0: NaN, Mr: null, wb: null, stable: false };
  const t0 = Math.abs((num[num.length - 1] ?? 0) / (den[den.length - 1] || 1));
  let Mr = 0;
  let wb: number | null = null;
  let prev = Infinity;
  const ref = t0 / Math.SQRT2;
  for (let i = 0; i <= 600; i++) {
    const w = Math.pow(10, -3 + 6 * (i / 600));
    const mv = ctrlFreq(num, den, w).mag;
    if (mv > Mr) Mr = mv;
    if (wb == null && t0 > 1e-9 && mv < ref && prev >= ref) wb = w;
    prev = mv;
  }
  return { T0: t0, Mr, wb, stable: true };
}

export function ControlTool(props: ToolViewProps) {
  const [params, setParams] = useState<CtrlParams>(() => sanitize(getModuleState<CtrlParams>('control', DEFAULT)));
  const undoRef = useRef(createUndoStack<CtrlParams>(40));
  const lastPush = useRef(0);

  useEffect(() => {
    setModuleState('control', params);
  }, [params]);

  useExperimentSync('control',
    () => sanitize(getModuleState<CtrlParams>('control', DEFAULT)),
    (v) => {
      setParams(v);
      undoRef.current.clear();
    },
  );

  const apply = (next: Partial<CtrlParams>): void => {
    const now = Date.now();
    if (now - lastPush.current > 500) {
      undoRef.current.push(params);
      lastPush.current = now;
    }
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };
  const applyLive = (next: Partial<CtrlParams>): void => {
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };

  const G = useMemo(() => parseTF(params.plant), [params.plant]);

  // 校正器（按视图）
  const comp = useMemo(() => {
    if (!G) return null;
    if (params.view === 'lead') return designLead(G.num, G.den, params.PMdes, params.wm);
    if (params.view === 'lag') return designLag(G.num, G.den, params.wc, params.beta);
    return null;
  }, [G, params.view, params.PMdes, params.wm, params.wc, params.beta]);

  // 开环 L(s)（含校正器时 L=C·G）
  const loop = useMemo(() => {
    if (!G) return null;
    const c = comp && comp.ok ? comp : null;
    const num = c ? polyMul(c.num, G.num) : G.num;
    const den = c ? polyMul(c.den, G.den) : G.den;
    if (!(den[0] || 0)) return null;
    return { num, den };
  }, [G, comp]);

  const m = useMemo(() => (loop ? loopMargins(loop.num, loop.den) : null), [loop]);
  const mPlant = useMemo(() => (G ? loopMargins(G.num, G.den) : null), [G]);

  // 闭环 T = L/(1+L) 与阶跃（指标由开环 L 经 core.closedLoopMetrics 求得）
  const closed = useMemo(() => {
    if (!loop || !m) return null;
    const num = loop.num;
    const den = polyAdd(loop.den, loop.num);
    const step = ltiResponse(num, den, () => 1, 0, params.tmax, 600);
    const metrics = closedLoopMetrics(loop.num, loop.den);
    return { num, den, step, metrics };
  }, [loop, m, params.tmax]);

  // 极点配置
  const place = useMemo(() => {
    if (params.view !== 'place' || !G) return null;
    const d = pTrim(G.den);
    const n = d.length - 1;
    if (n < 1) return null;
    let desired: Complex[];
    if (n === 1) desired = [{ re: -Math.abs(params.wn), im: 0 }];
    else {
      const pair = secondOrderPoles(params.zeta, params.wn);
      const base = Math.max(1, params.zeta * params.wn);
      const extra: Complex[] = [];
      for (let i = 0; i < n - 2; i++) extra.push({ re: -base * (3 + i), im: 0 });
      desired = [...pair, ...extra];
    }
    const r = placePoles(G.num, G.den, desired);
    if (!r.ok) return { err: r.note, desired };
    const step = ltiResponse(r.closedLoop.num, r.closedLoop.den, () => 1, 0, params.tmax, 600);
    const metrics = tMetrics(r.closedLoop.num, r.closedLoop.den);
    return { r, desired, step, metrics, err: null as string | null };
  }, [params.view, G, params.zeta, params.wn, params.tmax]);

  // 灵敏度 S / T（对数扫频，复用环路 bode 网格）
  const sens = useMemo(() => {
    if (!m || params.view !== 'sens') return null;
    const bd = m.bode;
    const S: number[] = [];
    const T: number[] = [];
    let Ms = 0;
    let Mr = 0;
    for (let i = 0; i < bd.w.length; i++) {
      const lin = Math.pow(10, bd.mag[i] / 20);
      const ph = (bd.ph[i] * Math.PI) / 180;
      const re = 1 + lin * Math.cos(ph);
      const im = lin * Math.sin(ph);
      const den = Math.hypot(re, im) || 1e-300;
      const s = 1 / den;
      const t = lin / den;
      S.push(20 * Math.log10(s + 1e-300));
      T.push(20 * Math.log10(t + 1e-300));
      Ms = Math.max(Ms, s);
      Mr = Math.max(Mr, t);
    }
    return { w: bd.w, S, T, Ms, Mr };
  }, [m, params.view]);

  const okLine = !G
    ? '对象无法解析'
    : comp && !comp.ok
      ? comp.note
      : place && place.err
        ? place.err
        : (comp && comp.ok ? comp.note : '');

  const loopOk = !!G && !!m;

  // 传递函数零极点（G 的分母/分子各自求根）
  const gpz = useMemo(() => {
    if (!G) return { poles: [] as Complex[], zeros: [] as Complex[] };
    const poles = polyRoots(pTrim(G.den));
    const nz = pTrim(G.num);
    return { poles, zeros: nz.length > 1 ? polyRoots(nz) : [] };
  }, [G]);

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
        `${VIEWS.find((v) => v.value === params.view)?.label} · ${
          m ? `PM=${m.PM != null ? m.PM.toFixed(1) + '°' : '—'} GM=${m.GM != null ? m.GM.toFixed(1) + 'dB' : '∞'}` : '—'
        }`,
      metrics: () => {
        if (!m) return [];
        if (params.view === 'place' && place && place.r) {
          const cl = place.metrics;
          return [
            { label: '状态反馈增益 ‖K‖₂', value: Math.hypot(...place.r.K), precision: 3 },
            { label: '闭环极点', value: place.r.poles.length },
            { label: '谐振峰 Mr', value: cl.stable && cl.Mr != null ? cl.Mr : '—', precision: 3, unit: '×' },
            { label: '闭环稳态', value: place.r.poles.every((p) => p.re < -1e-9) ? '稳定' : '不稳定' },
          ];
        }
        return [
          { label: '相位裕度 PM', value: m.PM != null ? m.PM : '—', precision: 2, unit: '°', tone: m.PM != null && m.PM >= 45 ? 'ok' : m.PM != null && m.PM >= 30 ? 'warn' : 'danger' },
          { label: '增益裕度 GM', value: m.GM != null ? m.GM : '∞', precision: 2, unit: 'dB', tone: m.GM != null && m.GM >= 8 ? 'ok' : 'warn' },
          { label: '幅值穿越 ωc', value: m.wc != null ? m.wc : '—', precision: 3, unit: 'rad/s' },
          { label: '对象极点', value: mPlant ? (mPlant.poleClass === 'stable' ? '稳定' : mPlant.poleClass === 'marginal' ? '临界' : '不稳定') : '—' },
        ];
      },
      exports: () => {
        const ex: ExportAction[] = [];
        if (comp && comp.ok) {
          ex.push({
            id: 'csv',
            label: '校正器 CSV',
            run: () => {
              download(
                'controller.csv',
                ['b/a,' + Array.from({ length: Math.max(comp.num.length, comp.den.length) }, (_, i) => i).join(','), 'b,' + comp.num.map((v) => v.toPrecision(10)).join(','), 'a,' + comp.den.map((v) => v.toPrecision(10)).join(',')].join('\n'),
                'text/csv',
              );
            },
          });
        }
        if (loop) {
          ex.push({
            id: 'handoff',
            label: '交接系统分析',
            run: () => {
              setModuleState('sys', { expr: coefs(loop, 's'), K: 1, view: 'bode' });
              navigate({ page: 'tool', toolId: 'sys' });
            },
          });
          ex.push({
            id: 'json',
            label: '设计 JSON',
            run: () => download('control-design.json', JSON.stringify({ plant: params.plant, comp, margins: { PM: m?.PM, GM: m?.GM, wc: m?.wc } }, null, 2), 'application/json'),
          });
        }
        return ex;
      },
    });
    return () => props.api(null);
    // eslint-disable-next-line
  }, [params, m, mPlant, comp, loop, place, closed]);

  return (
    <>
      {props.leftOpen ? (
        <aside class="ws-left">
          <FieldGroup title="被控对象 G(s)" desc="严格真分式（分子阶次 ≤ 分母阶次）；支持 * / ^ 与括号。">
            <ExprField
              label="G(s)"
              value={params.plant}
              onChange={(v) => apply({ plant: v })}
              status={G ? 'ok' : 'err'}
              message={G ? '已解析' : '无法解析：请检查写法'}
              hint="示例：1/(s*(s+1))、10/(s*(s+1)*(s+2))、(1-0.5s)/(s*(s+1))"
            />
            <div class="row">
              {PRESETS.map((p) => (
                <button key={p.label} class="btn" onClick={() => apply({ plant: p.plant })}>
                  {p.label}
                </button>
              ))}
            </div>
          </FieldGroup>

          {params.view === 'lead' ? (
            <FieldGroup title="超前校正参数" desc="C(s)=Kc(s+z)/(s+p)：在 ωm 处提供所需最大相位并精确令 |C·G|=1。">
              <SliderField label="期望相位裕度 PM" value={params.PMdes} onChange={(v) => applyLive({ PMdes: v })} min={5} max={85} step={1} precision={0} unit="°" />
              <SliderField label="设计频率 ωm" value={params.wm} onChange={(v) => applyLive({ wm: v })} min={0.01} max={50} step={0.01} precision={2} unit="rad/s" />
              <p class="muted">{okLine}</p>
            </FieldGroup>
          ) : null}

          {params.view === 'lag' ? (
            <FieldGroup title="滞后校正参数" desc="C(s)=Kc(s+z)/(s+p)：z=ωc′/10、β=z/p，降低穿越频率附近增益以换取裕度。">
              <SliderField label="新穿越频率 ωc′" value={params.wc} onChange={(v) => applyLive({ wc: v })} min={0.01} max={20} step={0.01} precision={2} unit="rad/s" />
              <SliderField label="低频增益比 β" value={params.beta} onChange={(v) => applyLive({ beta: v })} min={1} max={100} step={1} precision={0} unit="×" />
              <p class="muted">{okLine}</p>
            </FieldGroup>
          ) : null}

          {params.view === 'place' ? (
            <FieldGroup title="期望闭环极点" desc="二阶主导极点对（ζ、ωn）+ 其余实极点自动配置；经可控标准型 + Ackermann 求 K。">
              <SliderField label="阻尼比 ζ" value={params.zeta} onChange={(v) => applyLive({ zeta: v })} min={0.05} max={0.99} step={0.01} precision={2} />
              <SliderField label="自然频率 ωn" value={params.wn} onChange={(v) => applyLive({ wn: v })} min={0.1} max={20} step={0.1} precision={2} unit="rad/s" />
              <p class="muted">{okLine || '对象阶次决定期望极点数；多余极点按 3ζωn 起的实极点配置。'}</p>
            </FieldGroup>
          ) : null}

          <FieldGroup title="视图与仿真" onReset={() => apply({ view: DEFAULT.view, tmax: DEFAULT.tmax })} defaultOpen={false}>
            <SegmentedChips options={VIEWS} value={params.view} onChange={(v) => apply({ view: v })} ariaLabel="视图" />
            <SliderField label="仿真时长" value={params.tmax} onChange={(v) => applyLive({ tmax: v })} min={1} max={200} step={1} precision={0} unit="s" />
          </FieldGroup>
        </aside>
      ) : null}

      <section class="ws-main">
        {!G ? (
          <StatePanel kind="error" title="被控对象无法解析" desc="示例：1/(s*(s+1))、10/(s*(s+1)*(s+2))、(1-0.5s)/(s*(s+1))。" action={{ label: '恢复默认对象', onClick: () => apply({ plant: DEFAULT.plant }) }} />
        ) : null}
        {G && comp && !comp.ok ? (
          <StatePanel kind="error" title="校正器设计失败" desc={comp.note} action={{ label: '恢复默认参数', onClick: () => apply(DEFAULT) }} />
        ) : null}

        {/* 波特对比（对象 / 校正后） */}
        {G && loopOk && (params.view === 'plant' || params.view === 'lead' || params.view === 'lag') && m ? (
          <div class="card stack">
            <h3>波特图（{params.view === 'plant' ? '开环 L=G' : '校正后 L=C·G（虚线 = 校正前）'}）</h3>
            <Chart
              series={[
                { xs: m.bode.w, ys: m.bode.mag, glow: 2 },
                ...(params.view !== 'plant' && mPlant ? [{ xs: mPlant.bode.w, ys: mPlant.bode.mag, color: 'var(--series-4)', dash: [5, 4], width: 1.4 }] : []),
              ]}
              xRange={[m.bode.w[0], m.bode.w[m.bode.w.length - 1]]}
              yRange={[Math.min(-80, ...m.bode.mag) - 4, Math.max(20, ...m.bode.mag) + 6]}
              xLog
              xTickFmt={(v) => (v >= 1 ? v.toFixed(0) : v.toFixed(2))}
              xLabel="ω (rad/s)"
              yLabel="幅值 (dB)"
              height={240}
            />
            <Chart
              series={[
                { xs: m.bode.w, ys: m.bode.ph, color: 'var(--series-3)' },
                ...(params.view !== 'plant' && mPlant ? [{ xs: mPlant.bode.w, ys: mPlant.bode.ph, color: 'var(--series-4)', dash: [5, 4], width: 1.4 }] : []),
              ]}
              xRange={[m.bode.w[0], m.bode.w[m.bode.w.length - 1]]}
              yRange={[-270, 90]}
              xLog
              xTickFmt={(v) => (v >= 1 ? v.toFixed(0) : v.toFixed(2))}
              xLabel="ω (rad/s)"
              yLabel="相位 (°)"
              height={200}
            />
            <div class="row">
              <StatusBadge kind={m.PM != null && m.PM >= 45 ? 'ok' : m.PM != null && m.PM >= 30 ? 'warn' : 'err'}>
                PM = {m.PM != null ? m.PM.toFixed(1) + '°' : '—'}
              </StatusBadge>
              <StatusBadge kind={m.GM != null && m.GM >= 8 ? 'ok' : 'warn'}>GM = {m.GM != null ? m.GM.toFixed(1) + ' dB' : '∞'}</StatusBadge>
              {params.view !== 'plant' && mPlant ? (
                <span class="muted">
                  （校正前 PM = {mPlant.PM != null ? mPlant.PM.toFixed(1) + '°' : '—'}）
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* 阶跃响应 + 零极点（对象/校正视图） */}
        {G && (params.view === 'plant' || params.view === 'lead' || params.view === 'lag') && closed && m ? (
          <div class="grid2">
            <div class="card stack">
              <h3>闭环单位阶跃响应 T=L/(1+L)</h3>
              <Chart
                series={[{ xs: closed.step.t, ys: closed.step.y, color: 'var(--series-2)', glow: 2 }]}
                xRange={[0, params.tmax]}
                yRange={[Math.min(0, ...closed.step.y) * 1.1, Math.max(1, ...closed.step.y) * 1.15]}
                height={230}
                xLabel="t (s)"
                yLabel="y(t)"
              />
              <div class="row">
                <Metric label="谐振峰 Mr" value={closed.metrics.ok && closed.metrics.stable ? closed.metrics.Mr : '—'} precision={3} unit="×" />
                <Metric label="带宽 ωb" value={closed.metrics.ok && closed.metrics.stable && closed.metrics.wb != null ? closed.metrics.wb : '—'} precision={3} unit="rad/s" />
                <StatusBadge kind={m.poleClass === 'stable' ? 'ok' : m.poleClass === 'marginal' ? 'warn' : 'err'}>
                  {m.poleClass === 'stable' ? '闭环稳定' : m.poleClass === 'marginal' ? '临界' : '不稳定'}
                </StatusBadge>
              </div>
              <p class="muted">ωn={m.wn != null ? m.wn.toFixed(3) : '—'} rad/s · ζ={m.zeta != null ? m.zeta.toFixed(3) : '—'}（主导极点估计）</p>
            </div>
            <div class="card stack">
              <h3>零极点（s 平面）</h3>
              <ComplexPlane
                markers={[
                  ...gpz.poles.map((p) => ({ re: p.re, im: p.im, kind: 'pole' as const })),
                  ...gpz.zeros.map((z) => ({ re: z.re, im: z.im, kind: 'zero' as const })),
                  ...(comp && comp.ok
                    ? [{ re: -comp.z, im: 0, kind: 'zero' as const }, { re: -comp.p, im: 0, kind: 'pole' as const }]
                    : []),
                ]}
                mode="jw"
                height={280}
                halfW={2 * Math.max(1, ...gpz.poles.map((p) => Math.abs(p.re)), ...gpz.poles.map((p) => Math.abs(p.im)))}
                fitKey={`${params.plant}-${params.view}`}
              />
              <p class="muted">
                × 极点 / ○ 零点（对象与校正器同图）；当前校正器零点 −z={comp && comp.ok ? -comp.z.toFixed(4) : '—'}、极点 −p=
                {comp && comp.ok ? -comp.p.toFixed(4) : '—'}。
              </p>
            </div>
          </div>
        ) : null}

        {/* 极点配置 */}
        {params.view === 'place' && G && place ? (
          place.err ? (
            <StatePanel kind="error" title="极点配置不可行" desc={place.err} action={{ label: '恢复默认参数', onClick: () => apply(DEFAULT) }} />
          ) : place.r ? (
            <div class="grid2">
              <div class="card stack">
                <h3>状态反馈增益 K（可控标准型 + Ackermann）</h3>
                <div class="tex-line">
                  <TeX tex={`u=-Kx,\\quad K=[${place.r.K.map((v) => v.toFixed(4)).join(', ')}]`} />
                </div>
                <table class="tbl">
                  <thead>
                    <tr>
                      <th>期望极点</th>
                      <th>实际闭环极点</th>
                    </tr>
                  </thead>
                  <tbody>
                    {place.desired.map((p, i) => (
                      <tr key={i}>
                        <td class="mono">
                          {p.re.toFixed(4)}
                          {Math.abs(p.im) > 1e-9 ? ` ± j${Math.abs(p.im).toFixed(4)}` : ''}
                        </td>
                        <td class="mono">
                          {place.r && place.r.poles[i]
                            ? `${place.r.poles[i].re.toFixed(4)}${Math.abs(place.r.poles[i].im) > 1e-9 ? ` ± j${Math.abs(place.r.poles[i].im).toFixed(4)}` : ''}`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div class="tex-line">
                  <TeX tex={`\\phi_d(s)=${polyTex(place.r.closedLoop.den, 's')}`} />
                </div>
              </div>
              <div class="card stack">
                <h3>闭环阶跃响应与零极点</h3>
                <Chart
                  series={[{ xs: place.step.t, ys: place.step.y, color: 'var(--series-2)', glow: 2 }]}
                  xRange={[0, params.tmax]}
                  yRange={[Math.min(0, ...place.step.y) * 1.1, Math.max(1, ...place.step.y) * 1.15]}
                  height={200}
                  xLabel="t (s)"
                  yLabel="y(t)"
                />
                <ComplexPlane
                  markers={place.r.poles.map((p) => ({ re: p.re, im: p.im, kind: 'pole' as const }))}
                  mode="jw"
                  height={200}
                  halfW={2.2 * Math.max(1, ...place.r.poles.map((p) => Math.hypot(p.re, p.im)))}
                  fitKey={`p-${params.plant}-${params.wn}-${params.zeta}`}
                />
                <div class="row">
                  <Metric label="直流增益 T(0)" value={place.metrics.T0} precision={3} />
                  <Metric label="谐振峰 Mr" value={place.metrics.stable && place.metrics.Mr != null ? place.metrics.Mr : '—'} precision={3} unit="×" />
                  <Metric label="带宽 ωb" value={place.metrics.wb != null ? place.metrics.wb : '—'} precision={3} unit="rad/s" />
                </div>
                <p class="muted">
                  纯状态反馈 u=−Kx 的直流增益为 T(0)={place.metrics.T0.toFixed(3)}；若要无静差跟踪，需前置参考增益 N̄ = 1/T(0) ={' '}
                  {place.metrics.T0 > 1e-9 ? (1 / place.metrics.T0).toFixed(3) : '—'}。
                </p>
              </div>
            </div>
          ) : null
        ) : null}

        {/* 灵敏度校核 */}
        {params.view === 'sens' && G && sens && m ? (
          <div class="card stack">
            <h3>灵敏度 |S(jω)| 与补灵敏度 |T(jω)|（L=G，单位反馈）</h3>
            <Chart
              series={[
                { xs: sens.w, ys: sens.S, color: 'var(--series-4)', glow: 2 },
                { xs: sens.w, ys: sens.T, color: 'var(--series-2)' },
              ]}
              xRange={[sens.w[0], sens.w[sens.w.length - 1]]}
              yRange={[Math.min(-60, ...sens.S, ...sens.T), Math.max(6, ...sens.S, ...sens.T) + 4]}
              xLog
              xTickFmt={(v) => (v >= 1 ? v.toFixed(0) : v.toFixed(2))}
              xLabel="ω (rad/s)"
              yLabel="幅值 (dB)"
              height={280}
            />
            <div class="row">
              <StatusBadge kind={sens.Ms <= 1.6 ? 'ok' : sens.Ms <= 2 ? 'warn' : 'err'}>Ms = {sens.Ms.toFixed(3)}</StatusBadge>
              <Metric label="|T| 峰值 Mr" value={sens.Mr} precision={3} unit="×" />
              <span class="muted">黄线 |S|（鲁棒性：Ms 越小越好，通常 ≤ 2 可接受）；蓝线 |T|。</span>
            </div>
            <p class="muted">
              S+T=1（Bode 灵敏度积分约束）；|S| 峰值 Ms 表征对对象摄动的灵敏度，Ms≤1.6 一般视为良好。此视图使用未校正开环 L=G。
            </p>
          </div>
        ) : null}
      </section>

      {props.rightOpen ? (
        <aside class="ws-right">
          <div class="card stack">
            <h3>设计摘要</h3>
            <p class="muted">{okLine || '未启用校正器（对象分析 / 极点配置 / 灵敏度视图）。'}</p>
            {m ? (
              <>
                <Metric label="相位裕度 PM" value={m.PM != null ? m.PM : '—'} precision={2} unit="°" />
                <Metric label="增益裕度 GM" value={m.GM != null ? m.GM : '∞'} precision={2} unit="dB" />
                <Metric label="穿越频率 ωc" value={m.wc != null ? m.wc : '—'} precision={3} unit="rad/s" />
              </>
            ) : null}
          </div>

          {G ? (
            <div class="card stack">
              <h3>对象 G(s)</h3>
              <div class="tex-line">
                <TeX tex={`G(s)=\\dfrac{${polyTex(G.num, 's')}}{${polyTex(G.den, 's')}}`} />
              </div>
            </div>
          ) : null}

          {comp && comp.ok ? (
            <div class="card stack">
              <h3>校正器 C(s)</h3>
              <div class="tex-line">
                <TeX tex={`C(s)=\\dfrac{${polyTex(comp.num, 's')}}{${polyTex(comp.den, 's')}}`} />
              </div>
              <Metric label="零 z" value={-comp.z} precision={4} />
              <Metric label="极 p" value={-comp.p} precision={4} />
              <Metric label="增益 Kc" value={comp.Kc} precision={4} />
            </div>
          ) : null}
        </aside>
      ) : null}
    </>
  );
}
