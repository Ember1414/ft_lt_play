import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Chart } from '../../chart/Chart';
import { ExprField, FieldGroup, Metric, NumField, SegmentedChips, SliderField, StatePanel, StatusBadge, Switch } from '../../ui/components';
import { errMetrics, fopdtFit, ltiResponse, parseTF, pidLoopSim, znUltimate } from '../../core';
import type { PidCtrl, PidSimOpts } from '../../core';
import { createUndoStack } from '../../state/undo';
import { getModuleState, setModuleState } from '../../state/experiments';
import { useExperimentSync } from '../useSync';
import type { ToolViewProps } from '../api';

/**
 * PID 整定（pid）— M1 旗舰工具
 * 环路仿真（限幅/抗饱和/微分先行/数字 PID/输入端扰动）+ ZN 临界比例度 + FOPDT 两点法 + 分片寻优（可取消）。
 * 对象 G(s) 需为严格真分式；控制器为并联式 PID（kp/ki/kd）。
 */

type Criterion = 'ise' | 'iae' | 'itae';
type AwMode = 'off' | 'clamp' | 'back';
type DistKind = 'none' | 'step' | 'pulse';

interface PidParams {
  expr: string;
  kp: number;
  ki: number;
  kd: number;
  Tf: number;
  dOnM: boolean;
  uOn: boolean;
  uMax: number;
  aw: AwMode;
  Ts: number;
  r: number;
  dKind: DistKind;
  dAmp: number;
  criterion: Criterion;
}

const DEFAULT: PidParams = {
  expr: '1/(s*(s+1)*(s+2))',
  kp: 2,
  ki: 1,
  kd: 0.5,
  Tf: 0.05,
  dOnM: false,
  uOn: false,
  uMax: 5,
  aw: 'off',
  Ts: 0,
  r: 1,
  dKind: 'none',
  dAmp: 0.5,
  criterion: 'ise',
};

const AW_OPTIONS: ReadonlyArray<{ value: AwMode; label: string }> = [
  { value: 'off', label: '关闭' },
  { value: 'clamp', label: '条件积分' },
  { value: 'back', label: '反算（back）' },
];
const DIST_OPTIONS: ReadonlyArray<{ value: DistKind; label: string }> = [
  { value: 'none', label: '无' },
  { value: 'step', label: '阶跃（t≥2）' },
  { value: 'pulse', label: '脉冲（2–2.5s）' },
];
const CRIT_OPTIONS: ReadonlyArray<{ value: Criterion; label: string }> = [
  { value: 'ise', label: 'ISE' },
  { value: 'iae', label: 'IAE' },
  { value: 'itae', label: 'ITAE' },
];

function sanitize(raw: unknown): PidParams {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<PidParams>;
  const num = (v: unknown, fb: number, lo: number, hi: number): number =>
    Number.isFinite(v) ? Math.max(lo, Math.min(hi, v as number)) : fb;
  const aws: AwMode[] = ['off', 'clamp', 'back'];
  const ds: DistKind[] = ['none', 'step', 'pulse'];
  const cs: Criterion[] = ['ise', 'iae', 'itae'];
  return {
    expr: typeof r.expr === 'string' && r.expr.trim() ? r.expr : DEFAULT.expr,
    kp: num(r.kp, DEFAULT.kp, 0, 50),
    ki: num(r.ki, DEFAULT.ki, 0, 50),
    kd: num(r.kd, DEFAULT.kd, 0, 20),
    Tf: num(r.Tf, DEFAULT.Tf, 0, 2),
    dOnM: typeof r.dOnM === 'boolean' ? r.dOnM : DEFAULT.dOnM,
    uOn: typeof r.uOn === 'boolean' ? r.uOn : DEFAULT.uOn,
    uMax: num(r.uMax, DEFAULT.uMax, 0.1, 100),
    aw: aws.includes(r.aw as AwMode) ? (r.aw as AwMode) : DEFAULT.aw,
    Ts: num(r.Ts, DEFAULT.Ts, 0, 1),
    r: num(r.r, DEFAULT.r, -10, 10),
    dKind: ds.includes(r.dKind as DistKind) ? (r.dKind as DistKind) : DEFAULT.dKind,
    dAmp: num(r.dAmp, DEFAULT.dAmp, -10, 10),
    criterion: cs.includes(r.criterion as Criterion) ? (r.criterion as Criterion) : DEFAULT.criterion,
  };
}

function distFn(kind: DistKind, amp: number): ((k: number, t: number) => number) | null {
  if (kind === 'none') return null;
  if (kind === 'step') return (_k, t) => (t >= 2 ? amp : 0);
  return (_k, t) => (t >= 2 && t < 2.5 ? amp : 0);
}

export function PidTool(props: ToolViewProps) {
  const [params, setParams] = useState<PidParams>(() => sanitize(getModuleState<PidParams>('pid', DEFAULT)));
  const undoRef = useRef(createUndoStack<PidParams>(40));
  const lastPush = useRef(0);
  const [opt, setOpt] = useState<{ running: boolean; sims: number; value: number | null; note: string }>({
    running: false,
    sims: 0,
    value: null,
    note: '',
  });
  const optCancel = useRef<{ v: boolean } | null>(null);

  useEffect(() => {
    setModuleState('pid', params);
  }, [params]);

  useExperimentSync('pid',
    () => sanitize(getModuleState<PidParams>('pid', DEFAULT)),
    (v) => {
      setParams(v);
      undoRef.current.clear();
    },
  );

  const apply = (next: Partial<PidParams>): void => {
    const now = Date.now();
    if (now - lastPush.current > 500) {
      undoRef.current.push(params);
      lastPush.current = now;
    }
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };
  const applyLive = (next: Partial<PidParams>): void => {
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };

  const parsed = useMemo(() => {
    const t = parseTF(params.expr);
    return t && (t.den[0] || 0) ? t : null;
  }, [params.expr]);

  const sim = useMemo(() => {
    if (!parsed) return null;
    if (parsed.num.length - 1 >= parsed.den.length - 1) return { ok: false as const, note: '对象需为严格真分式（分子阶次 < 分母阶次）' };
    const opts: PidSimOpts = {
      tmax: 12,
      steps: 1500,
      uMax: params.uOn ? params.uMax : null,
      aw: params.aw,
      Tt: 1,
      Ts: params.Ts > 0 ? params.Ts : 0,
      r: params.r,
      dSeq: distFn(params.dKind, params.dAmp),
    };
    const ctrl: PidCtrl = { kp: params.kp, ki: params.ki, kd: params.kd, Tf: params.Tf, dOnM: params.dOnM };
    return pidLoopSim(parsed.num, parsed.den, ctrl, opts);
  }, [parsed, params]);

  const simOk = sim && sim.ok ? sim : null;

  // 曲线纵轴范围（reduce 求极值，避免大数组展开）
  const ranges = useMemo(() => {
    if (!simOk) return null;
    let yMin = 0;
    let yMax = Math.max(1, params.r);
    let uMin = 0;
    let uMax = 1;
    let eMin = 0;
    let eMax = Math.max(0.4, params.r);
    for (const v of simOk.y) {
      if (v < yMin) yMin = v;
      if (v > yMax) yMax = v;
    }
    for (const v of simOk.u) {
      if (v < uMin) uMin = v;
      if (v > uMax) uMax = v;
    }
    for (const v of simOk.e) {
      if (v < eMin) eMin = v;
      if (v > eMax) eMax = v;
    }
    return {
      y: [yMin - 0.08 * (yMax - yMin), yMax + 0.12 * (yMax - yMin)] as [number, number],
      u: [uMin - 0.1 * (uMax - uMin), uMax + 0.1 * (uMax - uMin)] as [number, number],
      e: [eMin - 0.1 * (eMax - eMin), eMax + 0.1 * (eMax - eMin)] as [number, number],
    };
  }, [simOk, params.r]);

  const met = useMemo(() => {
    if (!simOk) return null;
    const m = errMetrics(simOk.t, simOk.e);
    const y = simOk.y;
    const r = params.r;
    let peak = -Infinity;
    for (const v of y) if (v > peak) peak = v;
    const Mp = Math.abs(r) > 1e-12 ? Math.max(0, ((peak - r) / Math.abs(r)) * 100) : 0;
    const band = 0.02 * Math.max(Math.abs(r), 1e-6);
    let ts: number | null = null;
    for (let i = y.length - 1; i >= 0; i--) {
      if (Math.abs(y[i] - r) > band) {
        ts = i + 1 < y.length ? simOk.t[i + 1] : simOk.t[i];
        break;
      }
    }
    const ess = Math.abs(r - y[y.length - 1]);
    return { ...m, Mp, ts, ess };
  }, [simOk, params.r]);

  // ZN 临界比例度（纯 P 临界增益）
  const zn = useMemo(() => (parsed ? znUltimate(parsed.num, parsed.den) : null), [parsed]);

  // FOPDT 两点法（对象开环阶跃数据）
  const fopdt = useMemo(() => {
    if (!parsed) return null;
    const r = ltiResponse(parsed.num, parsed.den, () => 1, 0, 20, 1200);
    return fopdtFit(r.t, r.y);
  }, [parsed]);

  const applyZN = (): void => {
    if (!zn || !zn.ok) return;
    const Ku = zn.Ku;
    const Tu = zn.Tu;
    const kp = 0.6 * Ku;
    const ti = 0.5 * Tu;
    const td = 0.125 * Tu;
    apply({ kp: +kp.toFixed(3), ki: +(kp / ti).toFixed(3), kd: +(kp * td).toFixed(3) });
  };

  /** 分片寻优：与 core.pidOptimize 同算法（坐标下降），逐轮让出主线程以支持进度与取消 */
  const runOptimize = async (): Promise<void> => {
    if (!parsed || !simOk) return;
    const cancel = { v: false };
    optCancel.current = cancel;
    const key = params.criterion;
    const base: PidSimOpts = {
      tmax: 12,
      steps: 1200,
      uMax: params.uOn ? params.uMax : null,
      aw: params.aw,
      Tt: 1,
      Ts: params.Ts > 0 ? params.Ts : 0,
      r: params.r,
      dSeq: distFn(params.dKind, params.dAmp),
    };
    const crit = (g: readonly number[]): number => {
      const rr = pidLoopSim(parsed.num, parsed.den, { kp: g[0], ki: g[1], kd: g[2], Tf: params.Tf, dOnM: params.dOnM }, base);
      if (!rr.ok || !rr.y.every((v) => Number.isFinite(v))) return Infinity;
      return errMetrics(rr.t, rr.e)[key];
    };
    let p: number[] = [params.kp, params.ki, params.kd];
    let best = crit(p);
    let step = p.map((v) => 0.3 * (Math.abs(v) || 1));
    let sims = 1;
    setOpt({ running: true, sims, value: best, note: '' });
    const frame = (): Promise<void> => new Promise((res) => requestAnimationFrame(() => res()));
    for (let iter = 0; iter < 40 && !cancel.v; iter++) {
      let improved = false;
      for (let d = 0; d < 3 && !cancel.v; d++) {
        for (const sgn of [1, -1]) {
          const q = p.slice();
          q[d] = Math.max(0, q[d] + sgn * step[d]);
          if (q[d] === p[d]) continue;
          const v = crit(q);
          sims++;
          if (v < best) {
            best = v;
            p = q;
            improved = true;
            break;
          }
        }
        await frame();
        if (cancel.v) break;
        setOpt({ running: true, sims, value: best, note: '' });
      }
      if (!improved) step = step.map((x) => x / 2);
      if (step.every((x) => x < 1e-3)) break;
    }
    setOpt({
      running: false,
      sims,
      value: cancel.v ? null : best,
      note: cancel.v ? '已取消（参数未改变）' : `完成：${sims} 次仿真`,
    });
    if (!cancel.v) {
      apply({ kp: +p[0].toFixed(4), ki: +p[1].toFixed(4), kd: +p[2].toFixed(4) });
    }
    optCancel.current = null;
  };

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
      subtitle: () => `Kp=${params.kp} · Ki=${params.ki} · Kd=${params.kd}${params.Ts > 0 ? ` · Ts=${params.Ts}s` : ''}`,
      metrics: () =>
        met
          ? [
              { label: '超调 Mp', value: met.Mp, unit: '%', precision: 1, tone: met.Mp > 25 ? 'warn' : 'default', hint: '峰值相对设定的百分比' },
              { label: '调节时间 ts', value: met.ts ?? '—', unit: 's', precision: 2, hint: '进入 ±2% 带' },
              { label: '稳态误差 ess', value: met.ess, precision: 4, tone: met.ess > 0.02 ? 'warn' : 'ok' },
              { label: 'ISE', value: met.ise, precision: 3, hint: '∫e²dt' },
            ]
          : [],
      exports: () => [
        {
          id: 'csv',
          label: 'CSV',
          run: () => {
            if (!simOk) return;
            const rows = ['t,y,u,e'];
            for (let i = 0; i < simOk.t.length; i++) rows.push(`${simOk.t[i]},${simOk.y[i]},${simOk.u[i]},${simOk.e[i]}`);
            const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'pid-loop.csv';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          },
        },
        {
          id: 'json',
          label: 'JSON',
          run: () => {
            const blob = new Blob([JSON.stringify(params, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'pid-experiment.json';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          },
        },
      ],
    });
    return () => props.api(null);
  }, [params, met, simOk]);

  if (!parsed) {
    return (
      <>
        {props.leftOpen ? (
          <aside class="ws-left">
            <FieldGroup title="对象 G(s)" desc="与系统分析同一传函语法。">
              <ExprField
                label="G(s)（不含控制器）"
                value={params.expr}
                onChange={(v) => apply({ expr: v })}
                status="err"
                message="无法解析：请检查括号与运算符"
              />
            </FieldGroup>
          </aside>
        ) : null}
        <section class="ws-main">
          <StatePanel
            kind="error"
            title="传函无法解析"
            desc="示例：1/(s*(s+1)*(s+2))、10/(s^2+2s+10)。"
            action={{ label: '恢复默认 G(s)', onClick: () => apply({ expr: DEFAULT.expr }) }}
          />
        </section>
      </>
    );
  }

  return (
    <>
      {props.leftOpen ? (
        <aside class="ws-left">
          <FieldGroup title="对象 G(s)" desc="PID 控制的是 G(s)，需严格真分式。">
            <ExprField
              label="G(s)"
              value={params.expr}
              onChange={(v) => apply({ expr: v })}
              status={parsed ? 'ok' : 'err'}
              message={parsed ? '已解析' : '无法解析'}
            />
            <div class="row">
              {[
                { label: '一阶', expr: '1/(s+1)' },
                { label: '二阶', expr: '1/(s^2+2s+1)' },
                { label: '三阶', expr: '1/(s*(s+1)*(s+2))' },
              ].map((p) => (
                <button key={p.label} class="btn" onClick={() => apply({ expr: p.expr })}>
                  {p.label}
                </button>
              ))}
            </div>
          </FieldGroup>

          <FieldGroup title="PID 参数（并联式）" onReset={() => apply(DEFAULT)}>
            <SliderField label="Kp · 比例增益" value={params.kp} onChange={(v) => applyLive({ kp: v })} min={0} max={20} step={0.05} precision={2} />
            <SliderField label="Ki · 积分增益" value={params.ki} onChange={(v) => applyLive({ ki: v })} min={0} max={20} step={0.05} precision={2} />
            <SliderField label="Kd · 微分增益" value={params.kd} onChange={(v) => applyLive({ kd: v })} min={0} max={10} step={0.02} precision={2} />
            <div class="row">
              <NumField value={params.kp} onChange={(v) => apply({ kp: v })} min={0} max={50} step={0.1} precision={2} ariaLabel="Kp" />
              <NumField value={params.ki} onChange={(v) => apply({ ki: v })} min={0} max={50} step={0.1} precision={2} ariaLabel="Ki" />
              <NumField value={params.kd} onChange={(v) => apply({ kd: v })} min={0} max={20} step={0.05} precision={2} ariaLabel="Kd" />
            </div>
            <SliderField label="Tf · 微分滤波时间常数（0 = 理想差分）" value={params.Tf} onChange={(v) => applyLive({ Tf: v })} min={0} max={0.5} step={0.005} precision={3} unit="s" />
            <Switch label="微分先行（D 作用于 −Δy）" checked={params.dOnM} onChange={(v) => apply({ dOnM: v })} />
          </FieldGroup>

          <FieldGroup title="执行器与采样" defaultOpen={false}>
            <div class="row">
              <Switch label="执行器限幅" checked={params.uOn} onChange={(v) => apply({ uOn: v })} />
              <NumField value={params.uMax} onChange={(v) => apply({ uMax: v })} min={0.1} max={100} step={0.5} precision={1} disabled={!params.uOn} ariaLabel="限幅 uMax" />
            </div>
            <div class="row">
              <span class="muted">抗饱和</span>
              <SegmentedChips options={AW_OPTIONS} value={params.aw} onChange={(v) => apply({ aw: v })} ariaLabel="抗饱和模式" />
            </div>
            <SliderField label="Ts · 采样周期（0 = 连续）" value={params.Ts} onChange={(v) => applyLive({ Ts: v })} min={0} max={0.5} step={0.005} precision={3} unit="s" />
          </FieldGroup>

          <FieldGroup title="参考与扰动" defaultOpen={false}>
            <SliderField label="设定值 r（单位阶跃参考）" value={params.r} onChange={(v) => applyLive({ r: v })} min={-2} max={5} step={0.1} precision={2} />
            <div class="row">
              <span class="muted">输入端扰动</span>
              <SegmentedChips options={DIST_OPTIONS} value={params.dKind} onChange={(v) => apply({ dKind: v })} ariaLabel="扰动类型" />
              <NumField value={params.dAmp} onChange={(v) => apply({ dAmp: v })} min={-10} max={10} step={0.1} precision={2} ariaLabel="扰动幅值" />
            </div>
            <p class="muted">扰动直接加在对象输入端（u + d），用于观察抗扰能力与积分作用。</p>
          </FieldGroup>
        </aside>
      ) : null}

      <section class="ws-main">
        {simOk ? (
          <>
            <div class="card stack">
              <h3>闭环响应 y(t) 与设定 r（单位负反馈 · RK4）</h3>
              <Chart
                series={[
                  { xs: simOk.t, ys: simOk.y, glow: 3, width: 2.2 },
                  { xs: [0, 12], ys: [params.r, params.r], dash: [5, 4], width: 1.2, color: 'var(--ink-3)' },
                ]}
                xRange={[0, 12]}
                yRange={ranges ? ranges.y : [0, 2]}
                height={260}
                xLabel="t (s)"
                yLabel="y(t)"
              />
            </div>
            <div class="grid2">
              <div class="card stack">
                <h3>控制量 u(t)</h3>
                <Chart
                  series={[{ xs: simOk.t, ys: simOk.u, color: 'var(--series-3)' }]}
                  xRange={[0, 12]}
                  yRange={ranges ? ranges.u : [0, 2]}
                  height={180}
                  xLabel="t (s)"
                  yLabel="u(t)"
                />
              </div>
              <div class="card stack">
                <h3>误差 e(t) = r − y</h3>
                <Chart
                  series={[{ xs: simOk.t, ys: simOk.e, color: 'var(--series-2)' }]}
                  xRange={[0, 12]}
                  yRange={ranges ? ranges.e : [0, 1]}
                  height={180}
                  xLabel="t (s)"
                  yLabel="e(t)"
                />
              </div>
            </div>
            {params.uOn ? (
              <p class="muted">执行器限幅 ±{params.uMax}；抗饱和 = {AW_OPTIONS.find((a) => a.value === params.aw)?.label}。</p>
            ) : null}
          </>
        ) : (
          <StatePanel
            kind="error"
            title="无法仿真"
            desc={sim && !sim.ok ? sim.note : '对象非法或数值溢出。'}
            action={{ label: '恢复默认 G(s)', onClick: () => apply({ expr: DEFAULT.expr }) }}
          />
        )}
      </section>

      {props.rightOpen ? (
        <aside class="ws-right">
          <div class="card stack">
            <h4 class="card-h">时域指标</h4>
            <div class="row">
              <Metric label="超调 Mp" value={met ? met.Mp : '—'} unit="%" precision={1} tone={met && met.Mp > 25 ? 'warn' : 'default'} />
              <Metric label="调节时间 ts" value={met?.ts ?? '—'} unit="s" precision={2} />
            </div>
            <div class="row">
              <Metric label="稳态误差 ess" value={met ? met.ess : '—'} precision={4} tone={met && met.ess > 0.02 ? 'warn' : 'ok'} />
              <Metric label="ISE" value={met ? met.ise : '—'} precision={3} />
            </div>
            <div class="row">
              <Metric label="IAE" value={met ? met.iae : '—'} precision={3} />
              <Metric label="ITAE" value={met ? met.itae : '—'} precision={3} />
            </div>
          </div>

          <div class="card stack">
            <h4 class="card-h">整定器 · ZN 临界比例度</h4>
            {zn && zn.ok ? (
              <>
                <div class="row">
                  <Metric label="临界增益 Ku" value={zn.Ku} precision={3} />
                  <Metric label="临界周期 Tu" value={zn.Tu} unit="s" precision={3} />
                  <Metric label="ωpc" value={zn.wpc} unit="rad/s" precision={3} />
                </div>
                <div class="row">
                  <button class="btn primary" onClick={applyZN}>
                    应用 ZN PID（0.6Ku / 0.5Tu / 0.125Tu）
                  </button>
                </div>
              </>
            ) : (
              <p class="muted">{zn && !zn.ok ? zn.note : '对象相位滞后不足，无临界增益。'}</p>
            )}
          </div>

          <div class="card stack">
            <h4 class="card-h">整定器 · FOPDT 两点法</h4>
            {fopdt && fopdt.ok ? (
              <div class="row">
                <Metric label="K · 增益" value={fopdt.K} precision={3} />
                <Metric label="T · 时间常数" value={fopdt.T} unit="s" precision={3} />
                <Metric label="L · 纯迟延" value={fopdt.L} unit="s" precision={3} />
              </div>
            ) : (
              <p class="muted">{fopdt && !fopdt.ok ? fopdt.note : '数据不足。'}</p>
            )}
          </div>

          <div class="card stack">
            <h4 class="card-h">寻优（坐标下降 · 可取消）</h4>
            <SegmentedChips options={CRIT_OPTIONS} value={params.criterion} onChange={(v) => apply({ criterion: v })} ariaLabel="寻优指标" />
            <div class="row">
              {opt.running ? (
                <button
                  class="btn danger"
                  onClick={() => {
                    if (optCancel.current) optCancel.current.v = true;
                  }}
                >
                  取消寻优
                </button>
              ) : (
                <button class="btn primary" onClick={() => void runOptimize()}>
                  开始寻优
                </button>
              )}
              {opt.running ? <StatusBadge kind="info">运行中 · {opt.sims} 次仿真</StatusBadge> : null}
              {!opt.running && opt.note ? (
                <StatusBadge kind={opt.value == null ? 'warn' : 'ok'}>
                  {opt.note}
                  {opt.value != null ? ` · J=${opt.value.toFixed(4)}` : ''}
                </StatusBadge>
              ) : null}
            </div>
            <p class="muted">从当前 Kp/Ki/Kd 出发，最小化所选指标；每轮让出主线程（进度实时、可随时取消）。</p>
          </div>
        </aside>
      ) : null}
    </>
  );
}