import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { navigate } from '../router';
import { Metric, NumField, StatePanel, StatusBadge, Switch } from '../ui/components';
import { newExperiment, setModuleState, setSuppressSave, subscribe, getCurrent } from '../state/experiments';
import {
  clearSlot,
  composeOverlay,
  fmtMetricVal,
  metricDiff,
  paramDiff,
  readSlot,
  type AbSlot,
  type SlotKey,
} from '../state/ab';
import { downloadText } from '../report/report';
import { Chart, getSeriesByGroup } from '../chart/Chart';
import { ToolGroupContext } from '../tools/group';
import { hasToolView, loadToolView } from '../tools/lazy';
import { publishLiveOverride } from '../state/live';
import { paramKind, scalarKeys, stepForValue } from '../state/params';
import type { MetricItem, ToolApi, ToolViewProps } from '../tools/api';

/**
 * Compare — 对比实验 A/B（FR-06）
 * 并排展示两个槽（工具 · 参数快照 · 指标快照 · 缩略图）＋ 参数/指标差异表；
 * 一键把某个槽载入工作区（同工具 → 写入当前实验；不同工具 → 新建该工具实验）。
 */

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 参数项的可读化（对象/数组折叠为紧凑 JSON） */
function showVal(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  if (typeof v === 'object') {
    try {
      const s = JSON.stringify(v);
      return s.length > 60 ? s.slice(0, 57) + '…' : s;
    } catch {
      return '[对象]';
    }
  }
  return String(v);
}

/** 参数单元格（M12）：按值类型给出控件——数值 NumField / 开关 Switch / 文本·枚举 输入框。
 *  文本走原生 change（失焦或回车提交），避免逐键触发两侧实例重算。规则见 state/params.ts。 */
function ParamCell(props: { name: string; side: 'A' | 'B'; value: unknown; onSet: (v: unknown) => void }) {
  const { name, side, value, onSet } = props;
  const label = `参数 ${name} 槽 ${side}`;
  const kind = paramKind(value);
  if (kind === 'number') {
    const s = stepForValue(value as number);
    return <NumField value={value as number} onChange={onSet} step={s.step} precision={s.precision} width={84} ariaLabel={label} />;
  }
  if (kind === 'boolean') {
    return <Switch label={value ? '开' : '关'} checked={value as boolean} onChange={onSet} />;
  }
  if (kind === 'string') {
    return (
      <input
        class="c-num-input"
        style="text-align:left;width:100%;min-width:120px"
        value={value as string}
        aria-label={label}
        onChange={(e) => onSet((e.currentTarget as HTMLInputElement).value)}
      />
    );
  }
  return <span class="muted">—</span>;
}

export interface CompareProps {
  onToast: (msg: string) => void;
}

export function Compare(props: CompareProps) {
  const { onToast } = props;
  const [, bump] = useState(0);
  const [overlay, setOverlay] = useState<string | null>(null);
  const [overlayBusy, setOverlayBusy] = useState(false);
  /** 实时双跑（M7）：工具视图组件 + 由其两个实例实时算出的对照曲线 */
  const [DualView, setDualView] = useState<ComponentType<ToolViewProps> | null>(null);
  const [liveOverlay, setLiveOverlay] = useState<{
    series: { xs: number[]; ys: number[]; color: string; width: number; dash?: number[] }[];
    xRange: [number, number];
    yRange: [number, number];
    xLog: boolean;
  } | null>(null);
  /** 可调参数（M8）：初值取槽参数；编辑后经分组覆盖通道驱动双跑实例**实时**更新 */
  const [edA, setEdA] = useState<Record<string, unknown> | null>(null);
  const [edB, setEdB] = useState<Record<string, unknown> | null>(null);
  /** 两实例**自报指标**（M16）：经各工具既有的 `ToolApi.metrics()` 采集，随参数编辑实时刷新 */
  const [liveMetrics, setLiveMetrics] = useState<[MetricItem[], MetricItem[]] | null>(null);
  /** 分组的 ToolApi 注册表（工具在挂载/参数变化时注册，卸载时传 null）；只写 ref，不触发重渲染 */
  const apisRef = useRef<Record<string, ToolApi | null>>({});
  /** 各侧指标签名缓存：避免工具重复注册时无谓重渲染（也防止渲染回路） */
  const metricSigRef = useRef<[string, string]>(['', '']);
  /**
   * 采集某侧实例的自报指标（M16）。
   * 时机的关键：`metrics()` 是工具在 `useEffect` 里注册 api 时给出的**闭包**，
   * 它在「参数/指标变化后重注册」时才变新——所以要在**注册回调里**读，而不是在 rAF 里读
   * （被动 effect 晚于绘制，rAF 读到的往往还是上一轮闭包 → 指标会滞后一轮）。
   */
  const onApi = (side: 0 | 1, a: ToolApi | null): void => {
    apisRef.current[side === 0 ? 'ab-a' : 'ab-b'] = a;
    if (!a) return;
    let ms: MetricItem[] = [];
    try {
      ms = a.metrics() ?? [];
    } catch {
      ms = [];
    }
    const sig = ms.map((m) => `${m.label}\u0001${String(m.value)}\u0001${m.unit ?? ''}`).join('\u0002');
    if (metricSigRef.current[side] === sig) return; // 指标无变化 → 不触发重渲染
    metricSigRef.current[side] = sig;
    setLiveMetrics((prev) => {
      const next: [MetricItem[], MetricItem[]] = prev ? [prev[0], prev[1]] : [[], []];
      next[side] = ms;
      return next;
    });
  };
  useEffect(() => subscribe(() => bump((x) => x + 1)), []);

  const slotA = readSlot('A');
  const slotB = readSlot('B');
  const both = slotA && slotB;
  const sameTool = both && slotA.toolId === slotB.toolId;
  /** 实时双跑工具 id（同工具 + 两槽齐备时） */
  const dualToolId = both && sameTool ? slotA.toolId : null;

  /** 真实曲线同屏叠加（M5）：两槽为同工具且都冻结了主图曲线时，直接用数据叠加 */
  const realOverlay =
    both && sameTool && slotA.series && slotB.series
      ? {
          series: [
            ...slotA.series.tracks.map((t) => ({ xs: t.xs, ys: t.ys, color: '#e0359b', width: 1.8 })),
            ...slotB.series.tracks.map((t) => ({ xs: t.xs, ys: t.ys, color: '#0a9fbf', width: 1.8, dash: [5, 4] })),
          ],
          xRange: [
            Math.min(slotA.series.xRange[0], slotB.series.xRange[0]),
            Math.max(slotA.series.xRange[1], slotB.series.xRange[1]),
          ] as [number, number],
          yRange: [
            Math.min(slotA.series.yRange[0], slotB.series.yRange[0]),
            Math.max(slotA.series.yRange[1], slotB.series.yRange[1]),
          ] as [number, number],
          xLog: slotA.series.xLog,
        }
      : null;

  const noop = (): void => {};

  // 实时双跑（M7）：按需加载工具视图组件
  useEffect(() => {
    if (!dualToolId || !hasToolView(dualToolId)) {
      setDualView(null);
      return;
    }
    let alive = true;
    const p = loadToolView(dualToolId);
    p?.then((C) => {
      if (alive) setDualView(() => C);
    }).catch(() => {
      if (alive) setDualView(null);
    });
    return () => {
      alive = false;
    };
  }, [dualToolId]);

  // 槽变化 → 重置可调参数为槽值 + 清空自报指标（换工具/换槽时不留旧值）
  useEffect(() => {
    setEdA(slotA ? { ...(slotA.params as Record<string, unknown>) } : null);
    setEdB(slotB ? { ...(slotB.params as Record<string, unknown>) } : null);
    setLiveMetrics(null);
    metricSigRef.current = ['', ''];
  }, [dualToolId, slotA?.savedAt, slotB?.savedAt]);

  // 挂载两个实例期间：抑制写盘 + 投递两侧参数（分组 ab-a / ab-b）→ 读回两条真实曲线
  // （自报指标由 api 注册回调采集，见 onApi）
  useEffect(() => {
    if (!dualToolId || !DualView || !edA || !edB) {
      setLiveOverlay(null);
      return;
    }
    setSuppressSave(true);
    let cancelled = false;
    const raf1 = requestAnimationFrame(() => {
      if (cancelled) return;
      publishLiveOverride('ab-a', dualToolId, edA);
      publishLiveOverride('ab-b', dualToolId, edB);
      requestAnimationFrame(() => {
        if (cancelled) return;
        const a = getSeriesByGroup('ab-a');
        const b = getSeriesByGroup('ab-b');
        if (a && b) {
          setLiveOverlay({
            series: [
              ...a.series.map((se) => ({ xs: se.xs as number[], ys: se.ys as number[], color: '#e0359b', width: 1.8 })),
              ...b.series.map((se) => ({ xs: se.xs as number[], ys: se.ys as number[], color: '#0a9fbf', width: 1.8, dash: [5, 4] })),
            ],
            xRange: [Math.min(a.xRange[0], b.xRange[0]), Math.max(a.xRange[1], b.xRange[1])] as [number, number],
            yRange: [Math.min(a.yRange[0], b.yRange[0]), Math.max(a.yRange[1], b.yRange[1])] as [number, number],
            xLog: a.xLog,
          });
        } else {
          setLiveOverlay(null);
        }
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      setSuppressSave(false);
    };
  }, [dualToolId, DualView, edA, edB]);

  const setParam = (side: 'A' | 'B', k: string, v: unknown): void => {
    if (side === 'A') setEdA((p) => (p ? { ...p, [k]: v } : p));
    else setEdB((p) => (p ? { ...p, [k]: v } : p));
  };
  const resetEdits = (): void => {
    setEdA(slotA ? { ...(slotA.params as Record<string, unknown>) } : null);
    setEdB(slotB ? { ...(slotB.params as Record<string, unknown>) } : null);
  };
  /** 可调键（M12）= 两侧参数的**标量键**并集（数值 / 开关 / 文本·枚举），规则见 state/params.ts */
  const editKeys = useMemo(() => scalarKeys([edA, edB]), [edA, edB]);

  /** 载入某个槽到工作区 */
  const loadSlot = (key: SlotKey, s: AbSlot): void => {
    try {
      const cur = getCurrent();
      if (cur && cur.module === s.toolId) {
        setModuleState(s.toolId, s.params);
        onToast(`已把 ${key} 载入当前实验`);
      } else {
        newExperiment({ module: s.toolId, name: `${s.toolName} · ${key} 槽`, state: s.params });
        onToast(`已为 ${s.toolName} 新建实验并载入 ${key}`);
      }
      navigate({ page: 'tool', toolId: s.toolId });
    } catch (e) {
      onToast((e as Error).message || '载入失败');
    }
  };

  const copySlot = (key: SlotKey, s: AbSlot): void => {
    // 以「槽 + 参数」为内容导出 JSON（可离线留存或作为提交件）
    const payload = {
      kind: 'fltp-ab-slot',
      slot: key,
      toolId: s.toolId,
      toolName: s.toolName,
      savedAt: s.savedAt,
      subtitle: s.subtitle,
      metrics: s.metrics,
      params: s.params,
    };
    downloadText(`AB-${key}-${s.toolId}.json`, JSON.stringify(payload, null, 2), 'application/json');
    onToast(`已导出 ${key} 槽（JSON）`);
  };

  /** 同屏叠加（快照层面）：A 洋红 + B 青 → 重合白、差异彩 */
  const makeOverlay = (): void => {
    if (!slotA?.thumb || !slotB?.thumb) {
      onToast('两槽都需要缩略图才能叠加（若某槽无缩略图，请回工作区重新「存 A / 存 B」）');
      return;
    }
    setOverlayBusy(true);
    void composeOverlay(slotA.thumb, slotB.thumb)
      .then((url) => {
        if (!url) {
          onToast('叠加失败：缩略图无法解码');
          return;
        }
        setOverlay(url);
        onToast('已生成叠加对比图（A 洋红 / B 青，重合处为白）');
      })
      .finally(() => setOverlayBusy(false));
  };

  const exportDiff = (): void => {
    if (!both) return;
    const rows = paramDiff(slotA.params, slotB.params).filter((r) => r.differ);
    const mrows = metricDiff(slotA.metrics, slotB.metrics);
    const md = `# A/B 对比 · ${slotA.toolName}\n\n生成于 ${new Date().toLocaleString('zh-CN')}\n\n## 参数差异\n\n| 参数 | A | B |\n|---|---|---|\n${rows
      .map((r) => `| ${r.key} | ${showVal(r.a)} | ${showVal(r.b)} |`)
      .join('\n')}\n\n## 指标对比\n\n| 指标 | A | B | Δ(B−A) |\n|---|---|---|---|\n${mrows
      .map((m) => `| ${m.label} | ${fmtMetricVal(m.a)} | ${fmtMetricVal(m.b)} | ${m.delta != null ? m.delta.toPrecision(4) : '—'} |`)
      .join('\n')}\n`;
    downloadText(`AB对比-${slotA.toolId}.md`, md, 'text/markdown');
    onToast('已导出 A/B 对比（Markdown）');
  };

  const slotCard = (key: SlotKey, s: AbSlot | null) => (
    <div class="card stack">
      <div class="row">
        <strong>槽 {key}</strong>
        {s ? (
          <>
            <StatusBadge kind="info">{s.toolName}</StatusBadge>
            <span class="muted">{fmtTime(s.savedAt)}</span>
            <span class="spacer" />
            <button class="btn" onClick={() => loadSlot(key, s)} title="把该槽的参数载入工作区">
              载入工作区 →
            </button>
            <button class="btn" onClick={() => copySlot(key, s)}>
              导出 JSON
            </button>
            <button
              class="btn"
              onClick={() => {
                clearSlot(key);
                bump((x) => x + 1);
                onToast(`已清空槽 ${key}`);
              }}
            >
              清空
            </button>
          </>
        ) : (
          <span class="muted">（空）</span>
        )}
      </div>

      {s ? (
        <>
          {s.thumb ? (
            <img src={s.thumb} alt={`槽 ${key} 缩略图`} style="width:100%;height:auto;border:1px solid var(--line);border-radius:var(--r-sm)" />
          ) : (
            <p class="muted">无缩略图：{s.thumbNote || '该视图无 Canvas 图表'}</p>
          )}
          {s.subtitle ? <p class="muted">{s.subtitle}</p> : null}
          <h3>指标快照（{s.metrics.length}）</h3>
          {s.metrics.length ? (
            <table class="tbl">
              <tbody>
                {s.metrics.map((m) => (
                  <tr key={m.label}>
                    <td>{m.label}</td>
                    <td class="mono" style="text-align:right">
                      {fmtMetricVal(m)}
                      {m.unit ? ' ' + m.unit : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p class="muted">该工具当前未上报指标。</p>
          )}
          <h3>参数快照</h3>
          <textarea class="c-area" readOnly value={JSON.stringify(s.params, null, 2)} />
        </>
      ) : (
        <StatePanel
          kind="empty"
          title={`槽 ${key} 为空`}
          desc="在工作区结果条点「存 A」/「存 B」把当前参数与指标快照存入该槽（随实验保存）。"
          action={{ label: '去工作区', onClick: () => navigate({ page: 'tool', toolId: getCurrent()?.module ?? 'sys' }) }}
        />
      )}
    </div>
  );

  return (
    <div class="stack">
      <section class="hero">
        <h1>对比实验 A/B</h1>
        <p>
          把两套参数分别存入槽 <strong>A</strong> 与 <strong>B</strong>（含指标快照与图表缩略图），在此并排比较；
          可一键载入工作区或导出对比报告。槽随当前实验保存。
        </p>
      </section>

      <div class="grid2">
        {slotCard('A', slotA)}
        {slotCard('B', slotB)}
      </div>

      {both ? (
        <section class="card stack">
          <div class="row">
            <h3 style="margin:0">差异对比</h3>
            {sameTool ? <StatusBadge kind="ok">同工具（可对照）</StatusBadge> : <StatusBadge kind="info">不同工具（仅并列展示）</StatusBadge>}
            <span class="spacer" />
            <button class="btn" onClick={makeOverlay} disabled={overlayBusy} title="无真实曲线时，把两槽缩略图做通道合成（A 洋红 / B 青）">
              {overlayBusy ? '合成中…' : '缩略图叠加'}
            </button>
            <button class="btn" onClick={exportDiff}>
              导出对比 (.md)
            </button>
          </div>

          {realOverlay ? (
            <div class="stack">
              <h3 style="margin:0">同屏曲线叠加（真实数据 · A 洋红实线 / B 青虚线）</h3>
              <Chart
                series={realOverlay.series}
                xRange={realOverlay.xRange}
                yRange={realOverlay.yRange}
                xLog={realOverlay.xLog}
                height={340}
              />
              <p class="muted">两槽为保存时刻冻结的**真实曲线数据**（非像素合成）；参数不同时可直接看出走势在哪一段分叉。</p>
            </div>
          ) : null}

          {dualToolId && DualView ? (
            <div class="stack">
              <h3 style="margin:0">实时同屏双跑（A / B 并行运行同一工具）</h3>
              <p class="muted">
                两个实例在**同一时刻**分别运行槽 A / 槽 B 的参数（本区挂载期间不写入实验存储）；
                可**直接调参**（见下方参数表），两个实例与上方对照图都会**实时**响应。
              </p>
              {liveOverlay ? (
                <Chart
                  series={liveOverlay.series}
                  xRange={liveOverlay.xRange}
                  yRange={liveOverlay.yRange}
                  xLog={liveOverlay.xLog}
                  height={320}
                />
              ) : (
                <p class="muted">正在并行计算两套参数…</p>
              )}

              {edA && edB ? (
                <>
                  <h3 style="margin:0">参数（可直接调 · 数值 / 开关 / 枚举·表达式 · A / B 双跑实时响应）</h3>
                  {editKeys.length ? (
                    <table class="tbl scroll">
                      <thead>
                        <tr>
                          <th style="width:180px">参数</th>
                          <th>槽 A</th>
                          <th>槽 B</th>
                        </tr>
                      </thead>
                      <tbody>
                        {editKeys.map((k) => (
                          <tr key={k}>
                            <td class="mono">{k}</td>
                            <td>
                              <ParamCell name={k} side="A" value={edA[k]} onSet={(v) => setParam('A', k, v)} />
                            </td>
                            <td>
                              <ParamCell name={k} side="B" value={edB[k]} onSet={(v) => setParam('B', k, v)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p class="muted">该工具当前参数没有可调的标量项（对象 / 数组类参数请在工具页内调整）。</p>
                  )}
                  <p class="muted">
                    数值可直接输入或拖动 ⇔ 把手；开关点击切换；**枚举 / 表达式**为文本输入，失焦或回车提交。
                    取值非法时由工具自身回退到默认（实例画面随之变化）。
                  </p>
                  <div class="row">
                    <button class="btn" onClick={resetEdits} title="把参数恢复为槽 A / 槽 B 保存时的值">
                      重置为槽值
                    </button>
                    <span class="muted">编辑仅作用于本页双跑实例，不写回实验存储。</span>
                  </div>
                  {liveMetrics && (liveMetrics[0].length || liveMetrics[1].length) ? (
                    <>
                      <h3 style="margin:0">实例自报指标（A / B · 随参数编辑实时刷新）</h3>
                      <table class="tbl scroll">
                        <thead>
                          <tr>
                            <th style="width:180px">指标</th>
                            <th>槽 A 实例</th>
                            <th>槽 B 实例</th>
                            <th style="width:110px">差（B−A）</th>
                          </tr>
                        </thead>
                        <tbody>
                          {metricDiff(liveMetrics[0], liveMetrics[1]).map((m) => (
                            <tr key={m.label}>
                              <td>{m.label}</td>
                              <td class="mono">
                                {fmtMetricVal(m.a)}
                                {m.unit ? ' ' + m.unit : ''}
                              </td>
                              <td class="mono">
                                {fmtMetricVal(m.b)}
                                {m.unit ? ' ' + m.unit : ''}
                              </td>
                              <td class="mono" style={m.delta != null && Math.abs(m.delta) > 1e-9 ? 'color:var(--accent)' : ''}>
                                {m.delta != null ? (Math.abs(m.delta) < 1e-9 ? '0' : m.delta.toPrecision(4)) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p class="muted">
                        指标由两个实例各自上报（各工具的 `ToolApi.metrics()`），与上方对照曲线同一节拍刷新。
                        <strong>它也能帮你判断一次编辑是否真的生效</strong>——若某参数取值不被工具接受，工具会回退为默认值，
                        此时指标不会随你的输入变化。
                      </p>
                    </>
                  ) : null}
                </>
              ) : null}

              <div class="grid2">
                <div class="card stack">
                  <div class="row">
                    <strong>槽 A 实时</strong>
                    <StatusBadge kind="info">{slotA.toolName}</StatusBadge>
                  </div>
                  <ToolGroupContext.Provider value="ab-a">
                    <DualView
                      focus
                      api={(a) => onApi(0, a)}
                      onChange={noop}
                      leftOpen={false}
                      rightOpen={false}
                    />
                  </ToolGroupContext.Provider>
                </div>
                <div class="card stack">
                  <div class="row">
                    <strong>槽 B 实时</strong>
                    <StatusBadge kind="info">{slotB.toolName}</StatusBadge>
                  </div>
                  <ToolGroupContext.Provider value="ab-b">
                    <DualView
                      focus
                      api={(a) => onApi(1, a)}
                      onChange={noop}
                      leftOpen={false}
                      rightOpen={false}
                    />
                  </ToolGroupContext.Provider>
                </div>
              </div>
            </div>
          ) : null}

          {overlay ? (
            <div class="stack">
              <h3 style="margin:0">同屏叠加（A 洋红 · B 青 · 重合处为白）</h3>
              <img src={overlay} alt="A/B 叠加对照图" style="width:100%;height:auto;border:1px solid var(--line);border-radius:var(--r-sm)" />
              <p class="muted">
                这是**快照层面**的像素叠加（两槽为不同时刻冻结的图表），用于快速看出两条曲线在哪一段分叉；
                严格同屏实时曲线见上方「实时同屏双跑」区块。
              </p>
            </div>
          ) : null}

          <h3>参数差异（仅列出不同项）</h3>
          {(() => {
            const rows = paramDiff(slotA.params, slotB.params);
            const diff = rows.filter((r) => r.differ);
            if (!diff.length) return <p class="muted">两套参数完全一致（逐键逐值相同）。</p>;
            return (
              <table class="tbl scroll">
                <thead>
                  <tr>
                    <th style="width:180px">参数</th>
                    <th>A</th>
                    <th>B</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.map((r) => (
                    <tr key={r.key}>
                      <td class="mono">{r.key}</td>
                      <td class="mono">{showVal(r.a)}</td>
                      <td class="mono">{showVal(r.b)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()}

          <h3>指标对比</h3>
          <table class="tbl scroll">
            <thead>
              <tr>
                <th style="width:200px">指标</th>
                <th style="width:130px">A</th>
                <th style="width:130px">B</th>
                <th style="width:130px">Δ(B−A)</th>
              </tr>
            </thead>
            <tbody>
              {metricDiff(slotA.metrics, slotB.metrics).map((m) => (
                <tr key={m.label}>
                  <td>{m.label}</td>
                  <td class="mono">
                    {fmtMetricVal(m.a)}
                    {m.unit ? ' ' + m.unit : ''}
                  </td>
                  <td class="mono">
                    {fmtMetricVal(m.b)}
                    {m.unit ? ' ' + m.unit : ''}
                  </td>
                  <td class="mono" style={m.delta != null && Math.abs(m.delta) > 1e-9 ? 'color:var(--accent)' : ''}>
                    {m.delta != null ? (Math.abs(m.delta) < 1e-9 ? '0' : m.delta.toPrecision(4)) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p class="muted">
            说明：A/B 为**保存时刻的冻结快照**（同一时刻只运行一套参数）。若两槽为同一工具且都冻结了主图曲线，
            上方「同屏曲线叠加」直接叠加两套**真实曲线数据**；「缩略图叠加」（洋红 / 青通道合成）作为无曲线数据的备选。
          </p>
        </section>
      ) : (
        <section class="card stack">
          <h3>怎么用</h3>
          <ol class="steps">
            <li class="step">
              <span class="step-check">1</span>
              <div class="step-body">
                <div class="step-title">在任意工具里调好第一套参数</div>
                <div class="muted">点结果条「存 A」——冻结工具、参数、指标与图表缩略图。</div>
              </div>
            </li>
            <li class="step">
              <span class="step-check">2</span>
              <div class="step-body">
                <div class="step-title">改成第二套参数，点「存 B」</div>
                <div class="muted">两槽齐备后本页自动出现参数差异与指标对比表。</div>
              </div>
            </li>
            <li class="step">
              <span class="step-check">3</span>
              <div class="step-body">
                <div class="step-title">按需载入或导出</div>
                <div class="muted">「载入工作区」把某个槽写回工具；「导出对比 (.md)」留存记录。</div>
              </div>
            </li>
          </ol>
          <div class="row">
            <Metric label="槽 A" value={slotA ? slotA.toolName : '空'} />
            <Metric label="槽 B" value={slotB ? slotB.toolName : '空'} />
            <button class="btn primary" onClick={() => navigate({ page: 'tool', toolId: getCurrent()?.module ?? 'sys' })}>
              去工作区存槽
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
