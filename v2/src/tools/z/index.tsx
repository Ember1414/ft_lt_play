import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Chart } from '../../chart/Chart';
import { ComplexPlane, type CPMarker } from '../../chart/ComplexPlane';
import { fmtTickAt } from '../../chart/canvas';
import { ExprField, FieldGroup, Metric, NumField, SegmentedChips, SliderField, StatePanel, StatusBadge } from '../../ui/components';
import { TeX } from '../../ui/TeX';
import {
  combineFracs,
  cdiv,
  horner,
  itemFracZ,
  jury,
  parseTF,
  parseZCombo,
  pTrim,
  polyRoots,
  sToZ,
  tustin,
  xNumeric,
  zOfItems,
  zohDiscretize,
} from '../../core';
import type { ZItem } from '../../core';
import { createUndoStack } from '../../state/undo';
import { getModuleState, setModuleState } from '../../state/experiments';
import { useExperimentSync } from '../useSync';
import type { ToolViewProps } from '../api';

/**
 * Z 变换（z）— M1 旗舰工具
 * 序列 → X(z)：单位圆（零极点拖拽）/ 频响 |X(e^jω)| / 序列 x[n] / Jury 稳定性 / s→z 三映射。
 * 序列语法（与 v1 一致）：0.5^n*u[n]、n*u[n]、n*2^n*u[n]、cos(w n)u[n]、u[n]、delta[n]、常数。
 */

type ViewId = 'plane' | 'freq' | 'seq' | 'jury' | 'map';

interface ZParams {
  expr: string;
  view: ViewId;
  T: number;
  gExpr: string;
}

const DEFAULT: ZParams = { expr: '0.8^n*u[n]', view: 'plane', T: 0.1, gExpr: '1/(s+1)' };

const VIEWS: ReadonlyArray<{ value: ViewId; label: string }> = [
  { value: 'plane', label: '单位圆' },
  { value: 'freq', label: '频响' },
  { value: 'seq', label: '序列' },
  { value: 'jury', label: 'Jury' },
  { value: 'map', label: 's→z 映射' },
];

const PRESETS: ReadonlyArray<{ label: string; expr: string }> = [
  { label: '0.8^n', expr: '0.8^n*u[n]' },
  { label: '谐振器', expr: 'cos(pi/3*n)u[n]' },
  { label: '斜坡', expr: 'n*u[n]' },
  { label: 'n·2^n', expr: 'n*2^n*u[n]' },
  { label: '常数', expr: 'u[n]' },
  { label: '冲激', expr: 'delta[n]' },
];

function sanitize(raw: unknown): ZParams {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ZParams>;
  const views: ViewId[] = ['plane', 'freq', 'seq', 'jury', 'map'];
  return {
    expr: typeof r.expr === 'string' && r.expr.trim() ? r.expr : DEFAULT.expr,
    view: views.includes(r.view as ViewId) ? (r.view as ViewId) : DEFAULT.view,
    T: Number.isFinite(r.T) ? Math.max(0.001, Math.min(2, r.T as number)) : DEFAULT.T,
    gExpr: typeof r.gExpr === 'string' && r.gExpr.trim() ? r.gExpr : DEFAULT.gExpr,
  };
}

export function ZTool(props: ToolViewProps) {
  const [params, setParams] = useState<ZParams>(() => sanitize(getModuleState<ZParams>('z', DEFAULT)));
  const undoRef = useRef(createUndoStack<ZParams>(40));
  const lastPush = useRef(0);

  useEffect(() => {
    setModuleState('z', params);
  }, [params]);

  useExperimentSync('z',
    () => sanitize(getModuleState<ZParams>('z', DEFAULT)),
    (v) => {
      setParams(v);
      undoRef.current.clear();
    },
  );

  const apply = (next: Partial<ZParams>): void => {
    const now = Date.now();
    if (now - lastPush.current > 500) {
      undoRef.current.push(params);
      lastPush.current = now;
    }
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };
  const applyLive = (next: Partial<ZParams>): void => {
    setParams((p) => ({ ...p, ...next }));
    props.onChange();
  };

  const items: ZItem[] | null = useMemo(() => parseZCombo(params.expr), [params.expr]);
  const lines = useMemo(() => (items ? zOfItems(items) : null), [items]);
  const X = useMemo(() => (items ? combineFracs(items, itemFracZ) : null), [items]);

  // 零极点（分母/分子各自求根）
  const poles = useMemo(() => (X ? polyRoots(X.d) : []), [X]);
  const zeros = useMemo(() => (X ? (pTrim(X.n).length > 1 ? polyRoots(pTrim(X.n)) : []) : []), [X]);
  const rhoMax = useMemo(() => poles.reduce((m, p) => Math.max(m, Math.hypot(p.re, p.im)), 0), [poles]);
  const stable = poles.length > 0 && rhoMax < 1 - 1e-9;
  const critical = poles.some((p) => Math.abs(Math.hypot(p.re, p.im) - 1) <= 1e-9);

  const markers: CPMarker[] = useMemo(
    () => [
      ...poles.map((p) => ({ re: p.re, im: p.im, kind: 'pole' as const })),
      ...zeros.map((z) => ({ re: z.re, im: z.im, kind: 'zero' as const })),
    ],
    [poles, zeros],
  );

  // 频响 |X(e^jω)| 与相位（ω ∈ [1e-3, π]）
  const freq = useMemo(() => {
    if (!X || params.view !== 'freq') return null;
    const w: number[] = [];
    const mag: number[] = [];
    const ph: number[] = [];
    const N = 320;
    for (let i = 0; i <= N; i++) {
      const wv = 1e-3 + (Math.PI - 1e-3) * (i / N);
      const z = { re: Math.cos(wv), im: Math.sin(wv) };
      const h = cdiv(horner(X.n, z), horner(X.d, z));
      w.push(wv);
      mag.push(20 * Math.log10(Math.hypot(h.re, h.im) + 1e-12));
      ph.push((180 / Math.PI) * Math.atan2(h.im, h.re));
    }
    return { w, mag, ph };
  }, [X, params.view]);

  // 序列 x[n]（n = 0..40）
  const seq = useMemo(() => {
    if (!items || params.view !== 'seq') return null;
    const n: number[] = [];
    const v: number[] = [];
    for (let k = 0; k <= 40; k++) {
      n.push(k);
      v.push(xNumeric(items, k));
    }
    return { n, v };
  }, [items, params.view]);

  // Jury 判据
  const jr = useMemo(() => (X && params.view === 'jury' ? jury(X.d) : null), [X, params.view]);

  // s→z 三映射
  const map = useMemo(() => {
    if (params.view !== 'map') return null;
    const g = parseTF(params.gExpr);
    if (!g || !(g.den[0] || 0)) return null;
    const imp = sToZ(g.num, g.den, params.T);
    const zoh = zohDiscretize(g.num, g.den, params.T);
    const tus = tustin(g.num, g.den, params.T);
    return { g, imp, zoh, tus };
  }, [params.view, params.gExpr, params.T]);

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
      subtitle: () => `|z|max=${rhoMax.toFixed(3)} · ${stable ? '稳定' : critical ? '临界' : '不稳定'}`,
      metrics: () =>
        X
          ? [
              { label: '极点最大模 ρmax', value: rhoMax, precision: 3, tone: stable ? 'ok' : critical ? 'warn' : 'danger' },
              { label: 'ROC · 收敛域', value: lines ? lines.rocTex.replace('\\text{ROC}: ', '') : '—' },
              { label: '阶次', value: `${poles.length} 极点 / ${zeros.length} 零点` },
            ]
          : [],
      exports: () => [
        {
          id: 'csv',
          label: '序列 CSV',
          run: () => {
            if (!items) return;
            const rows = ['n,x[n]'];
            for (let k = 0; k <= 40; k++) rows.push(`${k},${xNumeric(items, k)}`);
            const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'z-sequence.csv';
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
            a.download = 'z-experiment.json';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          },
        },
      ],
    });
    return () => props.api(null);
  }, [params, X, rhoMax, stable, critical, lines, poles.length, zeros.length, items]);

  return (
    <>
      {props.leftOpen ? (
        <aside class="ws-left">
          <FieldGroup title="序列 x[n]" desc="因果序列；语法与 v1 一致（a^n、n、n·a^n、cos/sin(w n)、u[n]、delta[n]）。">
            <ExprField
              label="x[n]"
              value={params.expr}
              onChange={(v) => apply({ expr: v })}
              status={items ? 'ok' : 'err'}
              message={items ? '已解析' : '无法解析：请检查写法'}
              hint="示例：0.8^n*u[n]、n*u[n]、n*2^n*u[n]、cos(pi/3*n)u[n]"
            />
            <div class="row">
              {PRESETS.map((p) => (
                <button key={p.label} class="btn" onClick={() => apply({ expr: p.expr })}>
                  {p.label}
                </button>
              ))}
            </div>
          </FieldGroup>

          <FieldGroup title="视图" onReset={() => apply(DEFAULT)}>
            <SegmentedChips options={VIEWS} value={params.view} onChange={(v) => apply({ view: v })} ariaLabel="视图" />
            <p class="muted">
              解析结果：x(n) 与 X(z) 由 core.parseZCombo + 有理通分得到（与 v1 数值一致，回归网保障）。
            </p>
          </FieldGroup>

          {params.view === 'map' ? (
            <FieldGroup title="离散化参数">
              <ExprField
                label="G(s)"
                value={params.gExpr}
                onChange={(v) => apply({ gExpr: v })}
                status={map ? 'ok' : 'err'}
                message={map ? '已解析' : '无法解析'}
              />
            </FieldGroup>
          ) : null}

          <FieldGroup title="采样周期" defaultOpen={false}>
            <SliderField label="T · 采样周期" value={params.T} onChange={(v) => applyLive({ T: v })} min={0.001} max={1} step={0.001} precision={3} unit="s" />
            <div class="row">
              <NumField value={params.T} onChange={(v) => apply({ T: v })} min={0.001} max={2} step={0.01} precision={3} unit="s" ariaLabel="采样周期 T" />
            </div>
            <p class="muted">用于 s→z 映射；频响与单位圆视图与 T 无关（离散域本身）。</p>
          </FieldGroup>
        </aside>
      ) : null}

      <section class="ws-main">
        {!items || !X ? (
          <StatePanel
            kind="error"
            title="序列无法解析"
            desc="支持：a^n*u[n]、n*u[n]、n*a^n、cos(w n)u[n]、sin(w n)u[n]、u[n]、delta[n]、常数项及其线性组合。"
            action={{ label: '恢复默认序列', onClick: () => apply({ expr: DEFAULT.expr }) }}
          />
        ) : null}

        {items && X && params.view === 'plane' ? (
          <div class="grid2">
            <div class="card stack">
              <h3>单位圆 · 极点 ✕ / 零点 ○（只读：由序列表达式决定）</h3>
              <ComplexPlane markers={markers} mode="unit" height={300} halfW={2.2} />
              <p class="muted">滚轮缩放 · 拖动空白平移；零极点位置随左侧序列表达式变化。</p>
              <div class="row">
                <StatusBadge kind={stable ? 'ok' : critical ? 'warn' : 'err'}>
                  {stable ? '稳定（全部极点在单位圆内）' : critical ? '临界（含单位圆上极点）' : '不稳定（含单位圆外极点）'}
                </StatusBadge>
                <Metric label="ρmax" value={rhoMax} precision={3} />
                <Metric label="1−ρmax 裕度" value={1 - rhoMax} precision={3} />
              </div>
            </div>
            <div class="card stack">
              <h3>解析结果</h3>
              <div class="tex-line">
                <TeX tex={lines?.xLine ?? ''} />
              </div>
              <div class="tex-line">
                <TeX tex={lines?.zLine ?? ''} />
              </div>
              <div class="tex-line">
                <TeX tex={lines?.rocTex ?? ''} />
              </div>
              <p class="muted">
                极点 {poles.length} 个 · 零点 {zeros.length} 个；解析由 core.parseZCombo + 有理通分给出，与 v1 数值一致（回归网保障）。
              </p>
            </div>
          </div>
        ) : null}

        {params.view === 'freq' && freq ? (
          <div class="card stack">
            <h3>频率响应 |X(e^jω)| 与相位（ω ∈ (0, π)）</h3>
            <Chart
              series={[{ xs: freq.w, ys: freq.mag }]}
              xRange={[0, Math.PI]}
              yRange={[-60, Math.max(10, ...freq.mag.slice(0, 200)) + 6]}
              height={240}
              xTickFmt={(v, step) => (Math.abs(v) < 1e-9 ? '0' : Math.abs(v - Math.PI) < 1e-9 ? 'π' : fmtTickAt(v, step))}
              xLabel="ω (rad)"
              yLabel="幅值 (dB)"
            />
            <Chart
              series={[{ xs: freq.w, ys: freq.ph, color: 'var(--series-3)' }]}
              xRange={[0, Math.PI]}
              yRange={[-270, 90]}
              height={200}
              xTickFmt={(v, step) => (Math.abs(v) < 1e-9 ? '0' : Math.abs(v - Math.PI) < 1e-9 ? 'π' : fmtTickAt(v, step))}
              xLabel="ω (rad)"
              yLabel="相位 (°)"
            />
          </div>
        ) : null}

        {params.view === 'seq' && seq ? (
          <div class="card stack">
            <h3>序列 x[n]（n = 0…40）</h3>
            <Chart
              series={[{ xs: seq.n, ys: seq.v, glow: 3 }]}
              xRange={[0, 40]}
              yRange={[
                Math.min(0, ...seq.v) * 1.12,
                Math.max(1, ...seq.v) * 1.12,
              ]}
              height={280}
              xLabel="n"
              yLabel="x[n]"
            />
            <p class="muted">数值由 core.xNumeric 逐点给出（与 v1 完全一致）。</p>
          </div>
        ) : null}

        {params.view === 'jury' ? (
          <div class="card stack">
            <h3>Jury 稳定性判据（特征表）</h3>
            {jr && jr.ok ? (
              <>
                <div class="row">
                  <StatusBadge kind={jr.stable ? 'ok' : jr.margin != null && Math.abs(jr.margin) <= 1e-9 ? 'warn' : 'err'}>
                  {jr.stable ? 'Jury 判据：稳定' : jr.margin != null && Math.abs(jr.margin) <= 1e-9 ? 'Jury 判据：临界（含圆上极点）' : 'Jury 判据：不稳定'}
                </StatusBadge>
                  <Metric label="ρmax" value={jr.rhoMax ?? '—'} precision={4} />
                  <Metric label="稳定裕度 1−ρmax" value={jr.margin ?? '—'} precision={4} tone={jr.margin != null && jr.margin <= 0 ? 'danger' : 'ok'} />
                </div>
                <table class="tbl scroll">
                  <thead>
                    <tr>
                      <th>条件</th>
                      <th style="width:90px">结果</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jr.conds.map((c, i) => (
                      <tr key={i}>
                        <td class="mono">{c.text}</td>
                        <td>{c.ok ? <StatusBadge kind="ok">通过</StatusBadge> : <StatusBadge kind="err">不满足</StatusBadge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <details class="jury-rows">
                  <summary class="muted">特征表全部行（{jr.rows.length} 行）</summary>
                  <table class="tbl scroll mono">
                    <tbody>
                      {jr.rows.map((r, i) => (
                        <tr key={i}>
                          <td>
                            [{(r[0] ?? []).map((v) => v.toFixed(4)).join(', ')}
                            {r[1] && r[1].length ? ' | ' + r[1].map((v) => v.toFixed(4)).join(', ') : ''}]
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </>
            ) : (
              <StatePanel kind="error" title="Jury 判据不可用" desc={jr && !jr.ok ? jr.note : '分母非法。'} />
            )}
          </div>
        ) : null}

        {params.view === 'map' ? (
          <div class="card stack">
            <h3>s→z 三映射（冲激不变 / 零阶保持 / 双线性）</h3>
            {map ? (
              <>
                <table class="tbl scroll">
                  <thead>
                    <tr>
                      <th style="width:130px">方法</th>
                      <th>分子 n(z)</th>
                      <th>分母 d(z)</th>
                      <th style="width:260px">极点（z 平面）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { name: '冲激不变', r: map.imp },
                      { name: '零阶保持 ZOH', r: map.zoh },
                      { name: '双线性 Tustin', r: map.tus },
                    ].map((row) => (
                      <tr key={row.name}>
                        <td>{row.name}</td>
                        <td class="mono">{row.r.ok ? row.r.n.map((v) => +v.toFixed(5)).join(', ') : '—'}</td>
                        <td class="mono">{row.r.ok ? row.r.d.map((v) => +v.toFixed(5)).join(', ') : '—'}</td>
                        <td class="mono">
                          {row.r.ok
                            ? polyRoots(row.r.d)
                                .map((p) => `${p.re.toFixed(4)}${p.im >= 0 ? '+' : '−'}j${Math.abs(p.im).toFixed(4)}`)
                                .join(' , ')
                            : (row.r as { note?: string }).note ?? '失败'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p class="muted">
                  T = {params.T}s；三种映射对应不同的频率轴弯曲与零点分布（Tustin ω_s = (2/T)tan(ωT/2)）。系数与 v1 完全一致（回归网保障）。
                </p>
                <div class="row">
                  <StatusBadge kind="info">冲激不变：极点 e^(pT)</StatusBadge>
                  <StatusBadge kind="info">ZOH：附加零点</StatusBadge>
                  <StatusBadge kind="info">Tustin：s=(2/T)(z−1)/(z+1)</StatusBadge>
                </div>
              </>
            ) : (
              <StatePanel kind="error" title="G(s) 无法解析" desc="示例：1/(s+1)、10/(s^2+2s+10)。" />
            )}
          </div>
        ) : null}
      </section>

      {props.rightOpen ? (
        <aside class="ws-right">
          <div class="card stack">
            <h4 class="card-h">Z 域指标</h4>
            <div class="row">
              <Metric label="ρmax · 极点最大模" value={rhoMax} precision={4} tone={stable ? 'ok' : critical ? 'warn' : 'danger'} hint="<1 稳定" />
              <Metric label="稳定裕度 1−ρmax" value={1 - rhoMax} precision={4} />
            </div>
            <div class="row">
              <Metric label="极点" value={poles.length} precision={0} />
              <Metric label="零点" value={zeros.length} precision={0} />
            </div>
          </div>

          <div class="card stack">
            <h4 class="card-h">极点 / 零点（单位圆）</h4>
            <ComplexPlane markers={markers} mode="unit" height={190} halfW={2.0} />
            <p class="muted">单位圆内 = 稳定域；临界稳定为圆上极点。</p>
          </div>
        </aside>
      ) : null}
    </>
  );
}