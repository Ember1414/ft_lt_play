import { useEffect, useState } from 'preact/hooks';
import { navigate } from '../router';
import { toolById } from '../tools/registry';
import { StatePanel } from '../ui/components';
import {
  getCurrent,
  listExperiments,
  openExperiment,
  removeExperiment,
  storageAvailable,
  subscribe,
} from '../state/experiments';
import * as PX from '../core/experiment';
import {
  buildPackage,
  decodePackage,
  decodePackageJSON,
  decodeShare,
  encodePackage,
  encodeShare,
  packToJSON,
} from '../core';
import { copyOrShow, downloadText } from '../report/report';
import type { ExpMeta } from '../core/experiment';

/**
 * Experiments — 实验管理（列表 / 打开 / 收藏 / 复制 / 删除 / 快照 / 内容包）
 * 内容包（FR-04）：多选导出 `.pkg`（或 PK1 分享码）、导入 `.pkg` 或粘贴分享码。
 * 破坏性操作二次确认（规划书 §4.1 全局交互基线）。
 */

export interface ExperimentsProps {
  onToast: (msg: string) => void;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function Experiments(props: ExperimentsProps) {
  const { onToast } = props;
  const [, bump] = useState(0);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [snapOf, setSnapOf] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [pkgName, setPkgName] = useState('');
  const [codeInput, setCodeInput] = useState('');

  useEffect(() => subscribe(() => bump((x) => x + 1)), []);

  const list: ExpMeta[] = listExperiments();
  const current = getCurrent();
  const snapExp = snapOf ? PX.load(snapOf) : null;

  const open = (m: ExpMeta): void => {
    if (openExperiment(m.id)) navigate({ page: 'tool', toolId: m.module });
    else onToast('实验打开失败（数据可能已损坏）');
  };

  const toggleSel = (id: string): void => {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const toggleAll = (): void => {
    setSel((s) => (s.size === list.length ? new Set<string>() : new Set(list.map((m) => m.id))));
  };

  const selectedExperiments = (): ReturnType<typeof PX.load>[] => list.filter((m) => sel.has(m.id)).map((m) => PX.load(m.id));

  /** 导出内容包（.pkg 文件） */
  const exportPkgFile = (): void => {
    const items = selectedExperiments().filter((e): e is NonNullable<ReturnType<typeof PX.load>> => !!e);
    if (!items.length) {
      onToast('请先勾选至少 1 个实验');
      return;
    }
    const b = buildPackage(items, { name: pkgName.trim() || `内容包-${new Date().toISOString().slice(0, 10)}`, author: '', desc: '由实验管理页导出' });
    if (!b.ok) {
      onToast('打包失败：' + b.error.message);
      return;
    }
    const base = (b.value.meta.name || 'content-pack').replace(/[\\/:*?"<>|\s]+/g, '_');
    downloadText(base + '.pkg', packToJSON(b.value), 'application/json');
    onToast(`已导出内容包（${b.value.experiments.length} 个实验）`);
  };

  /** 导出内容包分享码（PK1.…，超长给出原因） */
  const exportPkgCode = (): void => {
    const items = selectedExperiments().filter((e): e is NonNullable<ReturnType<typeof PX.load>> => !!e);
    if (!items.length) {
      onToast('请先勾选至少 1 个实验');
      return;
    }
    const b = buildPackage(items, { name: pkgName.trim() || '内容包' });
    if (!b.ok) {
      onToast('打包失败：' + b.error.message);
      return;
    }
    try {
      void copyOrShow(encodePackage(b.value), '内容包分享码（PK1）', onToast);
    } catch (e) {
      onToast((e as Error).message || '分享码生成失败（内容偏大，请改用 .pkg 文件）');
    }
  };

  /** 复制单实验分享码（PX1.…） */
  const copySingleShare = (): void => {
    const ids = Array.from(sel);
    if (ids.length !== 1) return;
    const e = PX.load(ids[0]);
    if (!e) {
      onToast('实验数据读取失败');
      return;
    }
    try {
      void copyOrShow(encodeShare(e), '实验分享码（PX1）', onToast);
    } catch (err) {
      onToast((err as Error).message || '分享码生成失败');
    }
  };

  /** 落库一组实验（内容包/分享码导入共用） */
  const persist = (items: unknown[]): void => {
    let ok = 0;
    let bad = 0;
    for (const it of items) {
      const ex = it as Parameters<typeof PX.save>[0];
      try {
        PX.save(ex);
        ok++;
      } catch {
        bad++;
      }
    }
    onToast(`导入完成：成功 ${ok} 个${bad ? `，失败 ${bad} 个` : ''}`);
    bump((x) => x + 1);
  };

  const importPkgFile = async (file: File): Promise<void> => {
    let text = '';
    try {
      text = await file.text();
    } catch {
      onToast('读取文件失败');
      return;
    }
    const d = decodePackageJSON(text);
    if (!d.ok) {
      onToast('内容包无法导入：' + d.error.message);
      return;
    }
    onToast(`内容包「${d.value.meta.name}」：导入 ${d.value.items.length} 个${d.value.failed.length ? `，跳过 ${d.value.failed.length} 个` : ''}`);
    persist(d.value.items);
  };

  const importFromCode = (): void => {
    const code = codeInput.trim();
    if (!code) {
      onToast('请先粘贴分享码');
      return;
    }
    if (code.startsWith('PK1.')) {
      const d = decodePackage(code);
      if (!d.ok) {
        onToast('内容包分享码无法导入：' + d.error.message);
        return;
      }
      setCodeInput('');
      onToast(`内容包「${d.value.meta.name}」：导入 ${d.value.items.length} 个`);
      persist(d.value.items);
      return;
    }
    if (code.startsWith('PX1.')) {
      const d = decodeShare(code);
      if (!d.ok) {
        onToast('分享码无法导入：' + d.error.message);
        return;
      }
      setCodeInput('');
      persist([d.value]);
      return;
    }
    onToast('无法识别的码：应以 PX1.（单实验）或 PK1.（内容包）开头');
  };

  return (
    <div class="stack">
      <section class="hero">
        <h1>实验管理</h1>
        <p>
          全部数据保存在浏览器本地（local-first）。{storageAvailable() ? '支持快照、复制与分享码导出。' : '当前存储不可用，仅临时会话。'}
        </p>
      </section>

      {list.length === 0 ? (
        <StatePanel
          kind="empty"
          title="还没有实验"
          desc="从命令中心选择模板，或直接进入任意工具开始。"
          action={{ label: '去命令中心', onClick: () => navigate({ page: 'home' }) }}
        />
      ) : (
        <>
          <section class="card stack">
            <h3>内容包 · 批量导出 / 导入（FR-04）</h3>
            <div class="row">
              <span class="muted">已选 {sel.size} / {list.length}</span>
              <button class="btn" onClick={toggleAll}>
                {sel.size === list.length ? '清除选择' : '全选'}
              </button>
              <input
                class="c-num-input"
                style="min-width:180px;flex:1"
                placeholder="内容包名称（可选）"
                value={pkgName}
                onInput={(e) => setPkgName((e.currentTarget as HTMLInputElement).value)}
                aria-label="内容包名称"
              />
              <button class="btn primary" onClick={exportPkgFile} disabled={!sel.size} title={sel.size ? '导出为 .pkg 文件' : '先勾选实验'}>
                导出内容包 (.pkg)
              </button>
              <button class="btn" onClick={exportPkgCode} disabled={!sel.size} title={sel.size ? '生成 PK1 分享码（超长会给出提示）' : '先勾选实验'}>
                复制内容包分享码
              </button>
              <button class="btn" onClick={copySingleShare} disabled={sel.size !== 1} title={sel.size === 1 ? '复制该实验的 PX1 分享码' : '仅勾选 1 个实验时可用'}>
                复制单实验分享码
              </button>
              <label class="btn" style="cursor:pointer">
                导入内容包…
                <input
                  type="file"
                  accept=".pkg,.json,application/json"
                  style="display:none"
                  onChange={(e) => {
                    const f = (e.currentTarget as HTMLInputElement).files?.[0];
                    if (f) void importPkgFile(f);
                    (e.currentTarget as HTMLInputElement).value = '';
                  }}
                />
              </label>
            </div>
            <div class="row">
              <input
                class="c-num-input"
                style="min-width:260px;flex:1"
                placeholder="粘贴分享码（PX1.… 单实验 / PK1.… 内容包）后点导入"
                value={codeInput}
                onInput={(e) => setCodeInput((e.currentTarget as HTMLInputElement).value)}
                aria-label="分享码"
              />
              <button class="btn" onClick={importFromCode} disabled={!codeInput.trim()}>
                导入分享码
              </button>
            </div>
            <p class="muted">
              内容包 = 一组实验 + 清单（名称/说明/标签/时间），可导出为单文件 `.pkg` 离线传递；分享码为小体积内联形式（超限时请用文件）。
            </p>
          </section>

          <table class="tbl">
            <thead>
              <tr>
                <th style="width:40px">选</th>
                <th>名称</th>
                <th style="width:130px">工具</th>
                <th style="width:150px">更新时间</th>
                <th style="width:90px">快照</th>
                <th style="width:250px">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((m) => {
                const isCur = current?.id === m.id;
                const full = PX.load(m.id);
                return (
                  <tr key={m.id} class={isCur ? 'is-current' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={sel.has(m.id)}
                        aria-label={'选择 ' + m.name}
                        onChange={() => toggleSel(m.id)}
                      />
                    </td>
                    <td>
                      {m.name}
                      {isCur ? <span class="badge">当前</span> : null}
                      {m.favorite ? ' ★' : ''}
                    </td>
                    <td>{toolById(m.module)?.name ?? m.module}</td>
                    <td class="mono">{fmtTime(m.updatedAt)}</td>
                    <td class="mono">{full ? full.snapshots.length : 0}</td>
                    <td>
                      <span class="row">
                        <button class="btn" onClick={() => open(m)}>
                          打开
                        </button>
                        <button
                          class="btn"
                          onClick={() => {
                            try {
                              PX.patch(m.id, { favorite: !m.favorite });
                              bump((x) => x + 1);
                            } catch {
                              onToast('操作失败');
                            }
                          }}
                        >
                          {m.favorite ? '取消收藏' : '收藏'}
                        </button>
                        <button
                          class="btn"
                          onClick={() => {
                            try {
                              const c = PX.duplicate(m.id);
                              onToast('已复制为「' + c.name + '」');
                              bump((x) => x + 1);
                            } catch {
                              onToast('复制失败（可能已达数量上限）');
                            }
                          }}
                        >
                          复制
                        </button>
                        <button class="btn" onClick={() => setSnapOf(m.id)}>
                          快照
                        </button>
                        {confirmId === m.id ? (
                          <>
                            <button
                              class="btn danger"
                              onClick={() => {
                                removeExperiment(m.id);
                                setConfirmId(null);
                                onToast('已删除');
                              }}
                            >
                              确认删除
                            </button>
                            <button class="btn" onClick={() => setConfirmId(null)}>
                              取消
                            </button>
                          </>
                        ) : (
                          <button class="btn" onClick={() => setConfirmId(m.id)}>
                            删除
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {snapExp ? (
        <section class="section">
          <h2>
            快照 · {snapExp.name}（{snapExp.snapshots.length}）
          </h2>
          {snapExp.snapshots.length === 0 ? (
            <StatePanel
              kind="empty"
              title="还没有快照"
              desc="在工具内保存快照后，可随时恢复到该状态。"
              action={{
                label: '新建快照',
                onClick: () => {
                  try {
                    const e = PX.load(snapExp.id);
                    if (e) {
                      PX.addSnapshot(e, undefined, e.module);
                      onToast('已创建快照');
                      bump((x) => x + 1);
                    }
                  } catch {
                    onToast('创建快照失败');
                  }
                },
              }}
            />
          ) : (
            <div class="row">
              {snapExp.snapshots.map((s) => (
                <div class="card snap-card" key={s.id}>
                  <div class="snap-label">{s.label}</div>
                  <div class="muted mono">{fmtTime(s.ts)}</div>
                  <button
                    class="btn"
                    onClick={() => {
                      try {
                        const e = PX.load(snapExp.id);
                        if (e) {
                          PX.restoreSnapshot(e, s.id);
                          setSnapOf(snapExp.id);
                          bump((x) => x + 1);
                          onToast('已恢复到该快照');
                        }
                      } catch {
                        onToast('恢复失败');
                      }
                    }}
                  >
                    恢复
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}