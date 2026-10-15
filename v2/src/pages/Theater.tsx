import { useEffect, useState } from 'preact/hooks';
import { navigate } from '../router';
import { NumField, StatusBadge } from '../ui/components';
import { TOOLS, toolById } from '../tools/registry';
import {
  MAX_SCRIPT_STEPS,
  getScript,
  getSession,
  getAllScripts,
  newScriptId,
  isUserScript,
  saveUserScript,
  deleteUserScript,
  encodeScript,
  importScriptText,
  scriptToJSON,
  startScript,
  stop,
  subscribeTheater,
  theaterStorageAvailable,
  type TheaterScript,
  type TheaterStep,
} from '../state/theater';
import { buildPackage, encodePackage, importJSON, packToJSON } from '../core';
import type { Experiment } from '../core/experiment';
import { copyOrShow, downloadText } from '../report/report';

/**
 * Theater — 演示剧场（M3 播放 + M9 剧本编辑与分享）
 * 剧本列表（内置 + 自建）→ 一键播放；自建剧本可新建 / 编辑 / 删除 / 导出分享码，也可粘贴分享码导入。
 */

export interface TheaterProps {
  onToast: (msg: string) => void;
}

/* ——————————————————— 编辑器草稿模型（参数以 JSON 文本编辑，保存时逐项校验） ——————————————————— */

interface DraftStep {
  toolId: string;
  dwell: number;
  caption: string;
  paramsText: string;
}

interface Draft {
  id: string;
  name: string;
  blurb: string;
  steps: DraftStep[];
}

function toDraft(sc: TheaterScript): Draft {
  return {
    id: sc.id,
    name: sc.name,
    blurb: sc.blurb,
    steps: sc.steps.map((st) => ({
      toolId: st.toolId,
      dwell: st.dwell,
      caption: st.caption,
      paramsText: Object.keys(st.params).length ? JSON.stringify(st.params, null, 2) : '{}',
    })),
  };
}

function blankScript(): TheaterScript {
  return { id: newScriptId(), name: '', blurb: '', steps: [{ toolId: TOOLS[0].id, params: {}, dwell: 3000, caption: '' }] };
}

type DraftBuild = { ok: true; value: TheaterScript } | { ok: false; message: string };

/** 草稿 → 剧本：名称非空、每步工具存在、参数为合法 JSON 对象 */
function buildScript(d: Draft): DraftBuild {
  if (!d.name.trim()) return { ok: false, message: '请填写剧本名称' };
  if (!d.steps.length) return { ok: false, message: '剧本至少要包含 1 个步骤' };
  const steps: TheaterStep[] = [];
  for (let i = 0; i < d.steps.length; i++) {
    const s = d.steps[i];
    if (!toolById(s.toolId)) return { ok: false, message: `第 ${i + 1} 步的工具「${s.toolId}」不存在` };
    const text = s.paramsText.trim();
    let params: Record<string, unknown> = {};
    if (text) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        return { ok: false, message: `第 ${i + 1} 步参数不是合法 JSON：${(e as Error).message}` };
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, message: `第 ${i + 1} 步参数应为 JSON 对象（形如 { "view": "harmonics" }）` };
      }
      params = parsed as Record<string, unknown>;
    }
    steps.push({ toolId: s.toolId, params, dwell: s.dwell, caption: s.caption.trim() });
  }
  return { ok: true, value: { id: d.id, name: d.name.trim(), blurb: d.blurb.trim(), steps } };
}

/* ————————————————————————————— 剧本编辑器 ————————————————————————————— */

interface EditorProps {
  seed: TheaterScript;
  isNew: boolean;
  onSave: (sc: TheaterScript) => void;
  onCancel: () => void;
  onToast: (msg: string) => void;
}

function ScriptEditor(props: EditorProps) {
  const { seed, isNew, onSave, onCancel, onToast } = props;
  const [draft, setDraft] = useState<Draft>(() => toDraft(seed));

  const patchStep = (i: number, patch: Partial<DraftStep>) => {
    setDraft((d) => ({ ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  };
  const moveStep = (i: number, dir: number) => {
    setDraft((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.steps.length) return d;
      const steps = [...d.steps];
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...d, steps };
    });
  };
  const addStep = () => {
    setDraft((d) => {
      if (d.steps.length >= MAX_SCRIPT_STEPS) return d;
      const last = d.steps[d.steps.length - 1];
      return { ...d, steps: [...d.steps, { toolId: last?.toolId ?? TOOLS[0].id, dwell: last?.dwell ?? 3000, caption: '', paramsText: '{}' }] };
    });
  };
  const removeStep = (i: number) => {
    setDraft((d) => (d.steps.length <= 1 ? d : { ...d, steps: d.steps.filter((_, j) => j !== i) }));
  };

  const submit = () => {
    const r = buildScript(draft);
    if (!r.ok) {
      onToast(r.message);
      return;
    }
    onSave(r.value);
  };

  return (
    <section class="card stack">
      <div class="row">
        <h3 style="margin:0">{isNew ? '新建剧本' : '编辑剧本'}</h3>
        <span class="muted">每步：选择工具 → 填写参数（部分覆盖，工具自动补默认）→ 停留时长 → 旁白字幕</span>
        <span class="spacer" />
        <button class="btn primary" onClick={submit}>
          保存剧本
        </button>
        <button class="btn" onClick={onCancel}>
          取消
        </button>
      </div>

      <div class="row">
        <label class="row" style="gap:6px">
          <span class="muted">名称</span>
          <input
            class="c-num-input"
            style="text-align:left;min-width:200px"
            placeholder="剧本名称（必填）"
            aria-label="剧本名称"
            value={draft.name}
            onInput={(e) => setDraft((d) => ({ ...d, name: (e.currentTarget as HTMLInputElement).value }))}
          />
        </label>
        <label class="row" style="gap:6px;flex:1">
          <span class="muted">简介</span>
          <input
            class="c-num-input"
            style="text-align:left;min-width:240px;flex:1"
            placeholder="一句话说明这部演示在讲什么"
            aria-label="剧本简介"
            value={draft.blurb}
            onInput={(e) => setDraft((d) => ({ ...d, blurb: (e.currentTarget as HTMLInputElement).value }))}
          />
        </label>
      </div>

      {draft.steps.map((s, i) => (
        <div class="card stack" key={i}>
          <div class="row">
            <StatusBadge kind="info">第 {i + 1} 步</StatusBadge>
            <select
              class="c-num-input"
              style="text-align:left;min-width:170px"
              aria-label={`第 ${i + 1} 步工具`}
              value={s.toolId}
              onChange={(e) => patchStep(i, { toolId: (e.currentTarget as HTMLSelectElement).value })}
            >
              {TOOLS.map((t) => (
                <option value={t.id} key={t.id}>
                  {t.glyph} {t.name}
                </option>
              ))}
            </select>
            <span class="muted">停留</span>
            <NumField
              value={Number((s.dwell / 1000).toFixed(1))}
              min={0.3}
              max={20}
              step={0.5}
              precision={1}
              unit="s"
              ariaLabel={`第 ${i + 1} 步停留时长`}
              onChange={(v) => patchStep(i, { dwell: Math.round(v * 1000) })}
            />
            <span class="spacer" />
            <button class="btn" onClick={() => moveStep(i, -1)} disabled={i === 0} title="上移一步">
              ↑
            </button>
            <button class="btn" onClick={() => moveStep(i, 1)} disabled={i === draft.steps.length - 1} title="下移一步">
              ↓
            </button>
            <button class="btn" onClick={() => removeStep(i)} disabled={draft.steps.length <= 1} title="删除本步">
              删除
            </button>
          </div>
          <label class="stack" style="gap:4px">
            <span class="muted">旁白字幕</span>
            <input
              class="c-num-input"
              style="text-align:left"
              placeholder="播放到本步时显示的字幕"
              aria-label={`第 ${i + 1} 步字幕`}
              value={s.caption}
              onInput={(e) => patchStep(i, { caption: (e.currentTarget as HTMLInputElement).value })}
            />
          </label>
          <label class="stack" style="gap:4px">
            <span class="muted">参数（JSON 对象，留空或 {'{}'} 表示使用工具当前/默认值）</span>
            <textarea
              class="c-area"
              style="min-height:64px"
              spellcheck={false}
              aria-label={`第 ${i + 1} 步参数 JSON`}
              value={s.paramsText}
              onInput={(e) => patchStep(i, { paramsText: (e.currentTarget as HTMLTextAreaElement).value })}
            />
          </label>
        </div>
      ))}

      <div class="row">
        <button class="btn" onClick={addStep} disabled={draft.steps.length >= MAX_SCRIPT_STEPS}>
          + 添加一步
        </button>
        <span class="muted">
          共 {draft.steps.length} 步 / 上限 {MAX_SCRIPT_STEPS}
        </span>
      </div>
    </section>
  );
}

/* ————————————————————————————— 页面 ————————————————————————————— */

export function Theater(props: TheaterProps) {
  const { onToast } = props;
  const [, bump] = useState(0);
  useEffect(() => subscribeTheater(() => bump((x) => x + 1)), []);
  const session = getSession();
  const scripts = getAllScripts();
  const userCount = scripts.filter((s) => isUserScript(s.id)).length;
  const playing = session ? getScript(session.scriptId) : undefined;

  const [seed, setSeed] = useState<TheaterScript | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [importText, setImportText] = useState('');

  /** 剧场 → 内容包（M5）：把剧本每节导为一个实验，打包成 .pkg / PK1 分享码 */
  const buildScriptPkg = (sc: TheaterScript): { json: string; code: string } | null => {
    const exps: Experiment[] = [];
    sc.steps.forEach((st, i) => {
      const r = importJSON(
        JSON.stringify({
          schemaVersion: 1,
          name: `剧场·${sc.name}·第${i + 1}节`,
          module: st.toolId,
          moduleStates: { [st.toolId]: { savedAt: Date.now(), data: st.params } },
        }),
      );
      if (r.ok) exps.push(r.value);
    });
    if (!exps.length) return null;
    const b = buildPackage(exps, { name: `演示剧场 · ${sc.name}`, desc: sc.blurb, tags: ['剧场'], author: 'ft-lt-play' });
    if (!b.ok) return null;
    return { json: packToJSON(b.value), code: encodePackage(b.value) };
  };

  const exportScriptPkg = (sc: TheaterScript): void => {
    const p = buildScriptPkg(sc);
    if (!p) {
      onToast('构建内容包失败（步骤数据非法）');
      return;
    }
    downloadText(`剧场-${sc.id}.pkg`, p.json, 'application/json');
    onToast(`已导出内容包：${sc.name}（${sc.steps.length} 个实验，可在「实验管理」导入）`);
  };

  const copyScriptPkgCode = (sc: TheaterScript): void => {
    const p = buildScriptPkg(sc);
    if (!p) {
      onToast('构建分享码失败（步骤数据非法）');
      return;
    }
    void copyOrShow(p.code, `内容包分享码（${sc.name}）`, onToast);
  };

  /* —— M9：剧本本身的导出 / 导入 —— */

  const exportScriptFile = (sc: TheaterScript): void => {
    try {
      downloadText(`剧场剧本-${sc.id}.json`, scriptToJSON(sc), 'application/json');
      onToast(`已导出剧本文件：${sc.name}`);
    } catch (e) {
      onToast((e as Error).message || '导出失败');
    }
  };

  const copyScriptCode = (sc: TheaterScript): void => {
    try {
      void copyOrShow(encodeScript(sc), `剧本分享码（${sc.name}）`, onToast);
    } catch (e) {
      onToast((e as Error).message || '生成分享码失败');
    }
  };

  const doImport = (): void => {
    const r = importScriptText(importText);
    if (!r.ok) {
      onToast('导入失败：' + r.message);
      return;
    }
    const existed = isUserScript(r.value.id);
    const s = saveUserScript(r.value);
    if (!s.ok) {
      onToast('导入失败：' + s.message);
      return;
    }
    setImportText('');
    onToast(existed ? `已覆盖自建剧本「${s.value.name}」（${s.value.steps.length} 节）` : `已导入剧本「${s.value.name}」（${s.value.steps.length} 节）`);
  };

  const play = (id: string, name: string): void => {
    try {
      startScript(id, 1);
      onToast(`演示剧场已开始：${name}（工作区底部可暂停/跳节）`);
    } catch (e) {
      onToast((e as Error).message || '无法开始演示');
    }
  };

  const saveSeed = (sc: TheaterScript): void => {
    const r = saveUserScript(sc);
    if (!r.ok) {
      onToast('保存失败：' + r.message);
      return;
    }
    setSeed(null);
    onToast(`已保存自建剧本「${r.value.name}」（${r.value.steps.length} 节）`);
  };

  const editScript = (sc: TheaterScript): void => {
    if (isUserScript(sc.id)) {
      setSeed(sc);
      setIsNew(false);
    } else {
      // 内置剧本只读：编辑其副本，避免改动内置内容
      setSeed({ ...sc, id: newScriptId(), name: `${sc.name}（自建副本）` });
      setIsNew(true);
    }
  };

  const removeScript = (sc: TheaterScript): void => {
    deleteUserScript(sc.id);
    if (session?.scriptId === sc.id) stop();
    onToast(`已删除自建剧本「${sc.name}」`);
  };

  return (
    <div class="stack">
      <section class="hero">
        <h1>演示剧场</h1>
        <p>
          把工具与参数编成脚本，一键播放：每节自动切换工具与参数、同步旁白字幕，节奏可暂停与变速（0.5× / 1× / 2×）。
          剧场不改动工具内部，只负责<strong>编排与节奏</strong>；工具自带的动画（画圈 / 卷积 / 混叠 / 瀑布）就是画面本体。
        </p>
      </section>

      {session ? (
        <section class="card stack">
          <div class="row">
            <StatusBadge kind="info">正在播放</StatusBadge>
            <strong>{playing?.name ?? session.scriptId}</strong>
            <span class="muted">
              第 {session.index + 1} / {playing?.steps.length ?? 0} 步
            </span>
            <span class="spacer" />
            <button class="btn primary" onClick={() => navigate({ page: 'tool', toolId: playing?.steps[session.index]?.toolId ?? 'sys' })}>
              回到画面
            </button>
            <button
              class="btn"
              onClick={() => {
                stop();
                onToast('已退出演示剧场');
              }}
            >
              退出剧场
            </button>
          </div>
        </section>
      ) : null}

      {seed ? (
        <ScriptEditor key={seed.id} seed={seed} isNew={isNew} onSave={saveSeed} onCancel={() => setSeed(null)} onToast={onToast} />
      ) : (
        <>
          <section class="row">
            <button class="btn primary" onClick={() => { setSeed(blankScript()); setIsNew(true); }}>
              + 新建剧本
            </button>
            <span class="muted">
              共 {scripts.length} 部剧本（内置 {scripts.length - userCount} 部 / 自建 {userCount} 部）
            </span>
          </section>

          {!theaterStorageAvailable() ? (
            <section class="card">
              <p class="muted">存储不可用（隐私模式或配额已满）：自建剧本仅在本次会话内有效，刷新后丢失。</p>
            </section>
          ) : null}

          {scripts.map((sc) => (
            <section class="card stack" key={sc.id}>
              <div class="row">
                <h3 style="margin:0">{sc.name}</h3>
                <span class="muted">{sc.blurb}</span>
                <span class="spacer" />
                <StatusBadge kind={isUserScript(sc.id) ? 'ok' : 'info'}>{isUserScript(sc.id) ? '自建' : '内置'}</StatusBadge>
                <StatusBadge kind="info">{sc.steps.length} 节</StatusBadge>
                <button class="btn primary" onClick={() => play(sc.id, sc.name)}>
                  ▶ 播放
                </button>
                <button class="btn" onClick={() => editScript(sc)} title={isUserScript(sc.id) ? '编辑这部自建剧本' : '以内置剧本为模板新建一部自建副本'}>
                  {isUserScript(sc.id) ? '编辑' : '编辑副本'}
                </button>
              </div>
              <div class="row">
                <button class="btn" onClick={() => exportScriptFile(sc)} title="导出剧本 JSON（可再次粘贴导入）">
                  导出剧本
                </button>
                <button class="btn" onClick={() => copyScriptCode(sc)} title="复制剧本分享码（TS1.…），可在本页或他处粘贴导入">
                  复制剧本分享码
                </button>
                <button class="btn" onClick={() => exportScriptPkg(sc)} title="把本剧本每节导出为一个实验，打包成 .pkg（可在「实验管理」导入）">
                  导出内容包
                </button>
                <button class="btn" onClick={() => copyScriptPkgCode(sc)} title="复制内容包分享码（PK1.…），可在「实验管理」粘贴导入">
                  复制内容包分享码
                </button>
                {isUserScript(sc.id) ? (
                  <button class="btn" onClick={() => removeScript(sc)} title="删除这部自建剧本">
                    删除
                  </button>
                ) : null}
              </div>
              <ol class="steps">
                {sc.steps.map((st, i) => (
                  <li class={'step' + (session?.scriptId === sc.id && session.index === i ? ' is-done' : '')} key={i}>
                    <span class="step-check">{i + 1}</span>
                    <div class="step-body">
                      <div class="step-title">
                        {st.caption}
                        <span class="step-tool">
                          {toolById(st.toolId)?.glyph ?? '·'} {toolById(st.toolId)?.name ?? st.toolId} · {(st.dwell / 1000).toFixed(1)}s
                        </span>
                      </div>
                      <div class="muted mono">
                        {Object.entries(st.params)
                          .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                          .join('  ')}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}

          <section class="card stack">
            <h3>导入剧本</h3>
            <div class="row">
              <input
                class="c-num-input"
                style="text-align:left;min-width:320px;flex:1"
                placeholder="粘贴 TS1.… 剧本分享码，或导出的剧本 JSON 文本"
                aria-label="剧本分享码或 JSON"
                value={importText}
                onInput={(e) => setImportText((e.currentTarget as HTMLInputElement).value)}
              />
              <button class="btn primary" onClick={doImport} disabled={!importText.trim()}>
                导入
              </button>
            </div>
            <p class="muted">
              分享码为 `TS1.&lt;数据&gt;.&lt;校验&gt;` 单行文本，便于聊天工具传递；剧本 JSON 可直接粘贴其内容导入。导入的自建剧本可在列表中编辑、播放与再次分享。
            </p>
          </section>

          <section class="section">
            <p class="muted">
              小贴士：剧场会为每段演示新建一个实验（名称前缀「演示剧场 · 剧本名」），不会覆盖你手头的实验；退出剧场后工作区恢复常规模式。
            </p>
          </section>
        </>
      )}
    </div>
  );
}
