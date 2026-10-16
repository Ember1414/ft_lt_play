import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { toolById } from '../tools/registry';
import { navigate } from '../router';
import { StatePanel, StatusBadge, Metric as MetricView } from '../ui/components';
import { hasToolView, loadToolView } from '../tools/lazy';
import { getCurrent, ensureExperiment, getModuleState, setAuxState, subscribe } from '../state/experiments';
import {
  buildReportHtml,
  collectCharts,
  collectCss,
  collectSvgs,
  downloadDataUrl,
  downloadText,
  largestCanvas,
} from '../report/report';
import { readSlot, saveSlot, type SlotKey } from '../state/ab';
import {
  getScript,
  getSession,
  nextStep,
  prevStep,
  restart,
  setPlaying,
  setSpeed,
  stop,
  subscribeTheater,
  type Session,
} from '../state/theater';
import type { ToolApi, ToolViewProps } from '../tools/api';

/**
 * Workspace — 统一工作区骨架（FR-09）
 * 顶栏（模块 · 实验 · 工具栏）＋ 三区（参数｜主内容｜分析）＋ 底部结果条；
 * 区域独立折叠 + 专注模式；撤销/重做在顶栏（⌘Z / ⌘⇧Z）。
 */

export interface WorkspaceProps {
  toolId: string;
  onToast: (msg: string) => void;
  /** 打开全局命令面板（由外壳注入） */
  onCommand?: () => void;
}

export function Workspace(props: WorkspaceProps) {
  const { toolId, onToast, onCommand } = props;
  const tool = toolById(toolId);

  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [focus, setFocus] = useState(false);
  const [rev, setRev] = useState(0);
  const apiRef = useRef<ToolApi | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const bump = useCallback(() => setRev((x) => x + 1), []);

  const setApi = useCallback(
    (a: ToolApi | null) => {
      apiRef.current = a;
      bump();
    },
    [bump],
  );

  // 进入工具即确保有实验（自动保存目标）
  useEffect(() => {
    if (!tool) return;
    try {
      ensureExperiment({ module: tool.id, name: tool.name + '实验' });
    } catch {
      /* 存储上限等由上层提示 */
    }
  }, [tool]);

  useEffect(() => subscribe(bump), [bump]);

  // 工具视图按需加载（代码分割）：切换工具时拉取该工具分片，已加载的命中缓存
  const [View, setView] = useState<ComponentType<ToolViewProps> | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  useEffect(() => {
    if (!toolId) return;
    setView(null);
    setLoadErr(false);
    const p = loadToolView(toolId);
    let alive = true;
    p?.then((C) => {
      if (alive) setView(() => C);
    }).catch(() => {
      if (alive) setLoadErr(true);
    });
    return () => {
      alive = false;
    };
  }, [toolId]);

  // ⌘Z / ⌘⇧Z 撤销重做（工具需要时自行实现内部快捷键；此处为骨架级兜底）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== 'z') return;
      const api = apiRef.current;
      if (!api) return;
      if (e.shiftKey) {
        if (api.canRedo()) {
          api.redo();
          e.preventDefault();
        }
      } else if (api.canUndo()) {
        api.undo();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const api = apiRef.current;
  const metrics = useMemo(() => (api ? api.metrics() : []), [api, rev]);
  const exports = useMemo(() => (api ? api.exports() : []), [api, rev]);
  const subtitle = api?.subtitle ? api.subtitle() : null;
  const exp = getCurrent();

  /* 笔记（FR-07）：存于实验的 moduleStates.notes，随实验保存、随快照一并留存 */
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteText, setNoteText] = useState<string>(
    () => (getModuleState<{ text?: string }>('notes', {}) as { text?: string }).text ?? '',
  );
  const expId = exp?.id ?? null;
  useEffect(() => {
    setNoteText((getModuleState<{ text?: string }>('notes', {}) as { text?: string }).text ?? '');
    setNotesOpen(false);
  }, [expId]);
  const saveNote = (v: string): void => {
    setNoteText(v);
    setAuxState('notes', { text: v });
  };

  /* 演示剧场（M3/M5）：订阅会话，渲染电影式旁白条。
   * 参数生效方式：换工具 → 视图 key（toolId）变化自动重挂并读取存储；同工具 → 剧场经
   * state/live 覆盖通道逐帧就地应用（M5 参数插值），无需重挂、不打断工具动画。
   * 注意：theater 的会话对象是**原地变更**的，若把 getSession() 存进 state 会因引用相同而被
   * Preact 跳过重渲染（暂停按钮曾因此不刷新）。这里只保存一个自增版本号，渲染时现场读取。 */
  const [, theaterRev] = useState(0);
  useEffect(() => subscribeTheater(() => theaterRev((x) => x + 1)), []);
  const theater: Session | null = getSession();
  const theaterScript = theater ? getScript(theater.scriptId) : undefined;
  const theaterStep = theater && theaterScript ? theaterScript.steps[theater.index] : undefined;

  /* 导出报告（FR-05）：采集工作区内所有 Canvas/SVG + 指标 + 参数 → 自包含 HTML */
  const exportReport = (): void => {
    const root = bodyRef.current;
    if (!root) return;
    const charts = collectCharts(root);
    const svgs = collectSvgs(root);
    const html = buildReportHtml(
      {
        toolName: tool?.name ?? toolId,
        toolId,
        expName: exp?.name ?? '未命名实验',
        subtitle,
        metrics: apiRef.current?.metrics() ?? [],
        params: getModuleState<unknown>(toolId, {}),
        generatedAt: new Date().toLocaleString('zh-CN'),
      },
      charts,
      svgs,
      collectCss(),
    );
    downloadText(`报告-${toolId}-${new Date().toISOString().slice(0, 10)}.html`, html, 'text/html');
    onToast(`已导出实验报告（HTML · 图表 ${charts.length} 个）`);
  };

  /* 导出图表 PNG：取工作区内面积最大的 Canvas */
  const exportChartPng = (): void => {
    const root = bodyRef.current;
    if (!root) return;
    const c = largestCanvas(root);
    if (!c) {
      onToast('当前工具没有 Canvas 图表可导出（框图类为 SVG，请用「导出报告」）');
      return;
    }
    try {
      downloadDataUrl(`图表-${toolId}-${new Date().toISOString().slice(0, 10)}.png`, c.toDataURL('image/png'));
      onToast('已导出图表 PNG（工作区内最大画布）');
    } catch {
      onToast('该图表无法导出：画布被安全策略阻止');
    }
  };

  /* 对比实验 A/B：把当前工具的参数 + 指标 + 缩略图冻结进槽（FR-06） */
  const storeSlot = (key: SlotKey): void => {
    const r = saveSlot({
      key,
      toolId,
      toolName: tool?.name ?? toolId,
      params: getModuleState<unknown>(toolId, {}),
      metrics: apiRef.current?.metrics() ?? [],
      subtitle,
      root: bodyRef.current,
    });
    const extra = r.hasSeries
      ? r.hasThumb
        ? '（含真实曲线 + 缩略图）'
        : '（含真实曲线）'
      : r.hasThumb
        ? '（含缩略图）'
        : r.note
          ? `（${r.note}）`
          : '';
    onToast(`已存入槽 ${key} · ${tool?.name ?? toolId}${extra}，可在「对比实验」页查看`);
  };

  if (!tool) {
    return (
      <StatePanel
        kind="error"
        title="未知工具"
        desc={'路由指向不存在的工具「' + toolId + '」，可能链接已过期。'}
        action={{ label: '返回命令中心', onClick: () => navigate({ page: 'home' }) }}
      />
    );
  }

  if (!View) {
    // 分片加载中 / 加载失败 / 未登记：保留工作区顶栏（模块名 / 实验名 / 返回），内容区给状态引导
    const bad = loadErr || !hasToolView(tool.id);
    return (
      <div class="ws">
        <header class="ws-bar">
          <span class="ws-title">{tool.name}</span>
          <span class="muted">{tool.blurb}</span>
          {exp ? (
            <span class="muted ws-expname" title={'实验：' + exp.name}>
              {exp.name}
            </span>
          ) : null}
          <span class="spacer" />
          <StatusBadge kind={bad ? 'err' : 'info'}>{bad ? '不可用' : '加载中'}</StatusBadge>
          <button class="btn" onClick={() => navigate({ page: 'home' })}>
            返回命令中心
          </button>
        </header>
        <div class="ws-body">
          {bad ? (
            <StatePanel
              kind="error"
              title={tool.name + ' · 工具不可用'}
              desc="该工具代码分片加载失败或尚未登记。请返回命令中心，或用 ⌘K 选择其他工具。"
              action={{ label: '打开命令面板（⌘K）', onClick: () => (onCommand ? onCommand() : navigate({ page: 'home' })) }}
            />
          ) : (
            <StatePanel
              kind="loading"
              title={tool.name + ' · 正在加载…'}
              desc={tool.blurb + '。首次进入该工具需加载其独立代码分片，之后切换将命中缓存。'}
            />
          )}
        </div>
      </div>
    );
  }

  const wsCls =
    'ws' +
    (leftOpen && !focus ? '' : ' no-left') +
    (rightOpen && !focus ? '' : ' no-right') +
    (focus ? ' is-focus' : '');

  return (
    <div class={wsCls}>
      <header class="ws-bar">
        <span class="ws-title">{tool.name}</span>
        {subtitle ? (
          <span class="muted ws-sub" title={subtitle}>
            {subtitle}
          </span>
        ) : null}
        {exp ? (
          <span class="muted ws-expname" title={'实验：' + exp.name}>
            {exp.name}
          </span>
        ) : null}
        <div class="ws-bar-actions">
          <button class="btn" onClick={() => api?.undo()} disabled={!api?.canUndo()} title="撤销（⌘Z）">
            ↶ 撤销
          </button>
          <button class="btn" onClick={() => api?.redo()} disabled={!api?.canRedo()} title="重做（⌘⇧Z）">
            ↷ 重做
          </button>
          <button
            class={'btn' + (!focus && leftOpen ? ' is-on' : '')}
            onClick={() => setLeftOpen((v) => !v)}
            title="显示 / 隐藏参数区"
          >
            参数栏
          </button>
          <button
            class={'btn' + (!focus && rightOpen ? ' is-on' : '')}
            onClick={() => setRightOpen((v) => !v)}
            title="显示 / 隐藏分析区"
          >
            分析栏
          </button>
          <button class={'btn' + (focus ? ' is-on' : '')} onClick={() => setFocus((v) => !v)} title="专注模式（仅主内容区）">
            专注
          </button>
          <button
            class={'btn' + (notesOpen ? ' is-on' : '')}
            onClick={() => setNotesOpen((v) => !v)}
            title={noteText.trim() ? '笔记（已有内容）' : '本实验笔记'}
          >
            笔记<span class="dot-slot">{noteText.trim() ? '•' : ''}</span>
          </button>
        </div>
      </header>

      <div class="ws-body" ref={bodyRef}>
        <View
          key={theater ? `${toolId}#t` : `${toolId}#static`}
          api={setApi}
          onChange={bump}
          leftOpen={leftOpen && !focus}
          rightOpen={rightOpen && !focus}
          focus={focus}
        />
      </div>

      {theater && theaterScript ? (
        <section class="ws-theater" aria-label="演示剧场旁白">
          <div class="row">
            <StatusBadge kind="info">演示剧场</StatusBadge>
            <strong>{theaterScript.name}</strong>
            <span class="muted">
              第 {theater.index + 1} / {theaterScript.steps.length} 步
              {theater.done ? ' · 已结束' : theater.playing ? ' · 播放中' : ' · 已暂停'}
            </span>
            <span class="spacer" />
            <button class="btn" onClick={() => prevStep()} disabled={theater.index <= 0} title="上一节">
              ⏮ 上一节
            </button>
            <button class="btn" onClick={() => setPlaying(!theater.playing)} title={theater.playing ? '暂停' : '继续'}>
              {theater.playing ? '⏸ 暂停' : '▶ 播放'}
            </button>
            <button class="btn" onClick={() => nextStep()} title="下一节">
              下一节 ⏭
            </button>
            <button class="btn" onClick={() => restart()} title="从第一节重播">
              ↺ 重播
            </button>
            {[0.5, 1, 2].map((s) => (
              <button class={'btn' + (theater.speed === s ? ' is-on' : '')} key={s} onClick={() => setSpeed(s)} title={`${s}× 速度`}>
                {s}×
              </button>
            ))}
            <button class="btn" onClick={() => stop()} title="退出演示剧场">
              ✕ 退出
            </button>
          </div>
          <div class="pbar" role="progressbar" aria-valuenow={theater.index + 1} aria-valuemin={0} aria-valuemax={theaterScript.steps.length}>
            <span class="pbar-fill" style={{ width: `${((theater.index + 1) / theaterScript.steps.length) * 100}%` }} />
          </div>
          <p class="ws-theater-caption" key={theater.index}>
            {theaterStep ? theaterStep.caption : ''}
          </p>
        </section>
      ) : null}

      {notesOpen ? (
        <section class="ws-notes" aria-label="实验笔记">
          <div class="row">
            <strong>本实验笔记</strong>
            <span class="muted">随实验自动保存（debounce 600ms）；快照会一并留存，导出报告不含笔记。</span>
            <span class="spacer" />
            <button
              class="btn"
              disabled={!noteText.trim()}
              title={noteText.trim() ? '导出为 Markdown' : '笔记为空'}
              onClick={() => downloadText(`笔记-${toolId}.md`, `# ${tool?.name ?? toolId} · 实验笔记\n\n${noteText}\n`, 'text/markdown')}
            >
              导出 .md
            </button>
            <button class="btn" onClick={() => setNotesOpen(false)}>
              收起
            </button>
          </div>
          <textarea
            class="c-area"
            style="min-height:120px"
            placeholder="记录推导过程、参数取舍理由、待验证项、结论…"
            value={noteText}
            onInput={(e) => saveNote((e.currentTarget as HTMLTextAreaElement).value)}
            onBlur={(e) => saveNote((e.currentTarget as HTMLTextAreaElement).value)}
          />
        </section>
      ) : null}

      <footer class="ws-result" aria-label="结果条">
        {metrics.length ? (
          <div class="ws-metrics">
            {metrics.map((m) => (
              <MetricView key={m.label} label={m.label} value={m.value} unit={m.unit} precision={m.precision} tone={m.tone} hint={m.hint} />
            ))}
          </div>
        ) : (
          <span class="muted">结果条：调参后关键指标与导出动作将出现在这里。</span>
        )}
        <span class="spacer" />
        <button class="btn" onClick={() => storeSlot('A')} title="把当前参数 + 指标 + 图表缩略图冻结存入槽 A（对比实验）">
          存 A
        </button>
        <button class="btn" onClick={() => storeSlot('B')} title="把当前参数 + 指标 + 图表缩略图冻结存入槽 B（对比实验）">
          存 B
        </button>
        <button class="btn" onClick={() => navigate({ page: 'compare' })} title="打开对比实验页（A/B 并排 + 参数与指标差异）">
          对比<span class="dot-slot">{readSlot('A') && readSlot('B') ? '●' : ''}</span>
        </button>
        <button class="btn" onClick={exportChartPng} title="导出工作区内最大画布为 PNG">
          图表 PNG
        </button>
        <button class="btn" onClick={exportReport} title="导出当前实验为自包含 HTML 报告（含图表、指标与参数）">
          导出报告
        </button>
        {exports.length ? (
          exports.map((x) => (
            <button
              key={x.id}
              class="btn"
              disabled={x.disabled}
              title={x.disabled ? x.reason || '暂不可用' : x.label}
              onClick={() => {
                if (x.disabled) {
                  onToast(x.reason || '该导出暂不可用');
                  return;
                }
                x.run?.();
              }}
            >
              {x.label}
            </button>
          ))
        ) : (
          <StatusBadge kind="info">导出：随工具交付</StatusBadge>
        )}
      </footer>
    </div>
  );
}