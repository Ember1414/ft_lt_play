/**
 * experiments.ts — 实验会话状态（接入 core/experiment，唯一实验入口）
 * 规则：
 * - 工具页的输入状态存在当前实验的 moduleStates[moduleId] 上，自动保存（debounce）；
 * - 存储不可用（隐私模式/配额满）时降级为临时会话，顶部提示但不阻塞功能；
 * - 路由与实验状态解耦：切换工具不丢输入（规划书 §4.1「返回不丢输入」）。
 */

import * as PX from '../core/experiment';
import type { Experiment, ExpMeta } from '../core/experiment';

let current: Experiment | null = null;
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let storageOk = true;

/** 启动探测：localStorage 不可用（隐私模式等）→ 临时会话降级 */
(() => {
  try {
    const k = 'v2:probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
  } catch {
    storageOk = false;
  }
})();

/**
 * 临时抑制写盘（M7）：对比页并行双跑会挂载工具实例，其自动保存须被抑制，
 * 以免把「双跑实例的参数」写进用户的当前实验。进入时置 true，离开时恢复 false。
 */
let suppressSave = false;
export function setSuppressSave(v: boolean): void {
  suppressSave = v;
}

/** 强制新建实验（模板 / 新建按钮）；已有当前实验则替换 */
export function newExperiment(opts: { module: string; name?: string; state?: unknown }): Experiment {
  const now = Date.now();
  let exp: Experiment;
  try {
    exp = PX.create({ module: opts.module, name: opts.name, state: opts.state ?? {} });
  } catch (e) {
    // 配额上限属于"用户需先清理"的情形，交由调用方提示；其余视为存储不可用 → 临时会话
    if ((e as { code?: string }).code === 'too-many') throw e;
    storageOk = false;
    exp = PX.normalize({
      name: opts.name || '未命名实验',
      module: opts.module,
      createdAt: now,
      updatedAt: now,
      moduleStates: { [opts.module]: { savedAt: now, data: opts.state ?? {} } },
    });
  }
  setCurrent(exp);
  return exp;
}

export function storageAvailable(): boolean {
  return storageOk;
}

export function getCurrent(): Experiment | null {
  return current;
}

function notify(): void {
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setCurrent(exp: Experiment | null): void {
  current = exp;
  notify();
}

/** 打开已有实验；返回是否成功 */
export function openExperiment(id: string): boolean {
  const exp = PX.load(id);
  if (!exp) return false;
  setCurrent(exp);
  return true;
}

/** 确保存在当前实验（工作区入口调用）；已有实验则原样返回 */
export function ensureExperiment(opts: { module: string; name?: string; state?: unknown }): Experiment {
  if (current) {
    if (!current.moduleStates[opts.module]) current.moduleStates[opts.module] = { savedAt: Date.now(), data: opts.state ?? {} };
    return current;
  }
  try {
    current = PX.create({ module: opts.module, name: opts.name, state: opts.state ?? {} });
  } catch {
    // 存储不可用：退化到内存实验（不持久化）
    storageOk = false;
    current = PX.normalize({
      name: opts.name || '未命名实验',
      module: opts.module,
      moduleStates: { [opts.module]: { savedAt: Date.now(), data: opts.state ?? {} } },
    });
  }
  notify();
  return current;
}

/** 读取工具模块状态（无则返回 fallback，不写入） */
export function getModuleState<T>(moduleId: string, fallback: T): T {
  const st = current?.moduleStates?.[moduleId];
  if (st && st.data != null) return st.data as T;
  return fallback;
}

/** 写入工具模块状态并自动保存（debounce 600ms） */
export function setModuleState(moduleId: string, data: unknown): void {
  if (suppressSave) return;
  if (!current) return;
  current.moduleStates[moduleId] = { savedAt: Date.now(), data };
  current.module = moduleId;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
}

/**
 * 写入辅助模块状态（笔记等非工具数据）：与 setModuleState 同样的自动保存，
 * 但**不改变实验归属的 module**（否则实验会被记到不存在的工具名下）。
 */
export function setAuxState(moduleId: string, data: unknown): void {
  if (suppressSave) return;
  if (!current) return;
  current.moduleStates[moduleId] = { savedAt: Date.now(), data };
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
}

/** 立即写盘（离开页面 / 手动保存 / 快照前调用） */
export function flushSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (suppressSave) return;
  if (!current) return;
  try {
    current = PX.save(current);
    notify();
  } catch {
    storageOk = false;
    notify();
  }
}

export function listExperiments(): ExpMeta[] {
  try {
    return PX.list();
  } catch {
    return [];
  }
}

/** 最近一次实验（首页「继续实验」用） */
export function latestExperiment(): ExpMeta | null {
  const list = listExperiments();
  return list.length ? list[0] : null;
}

/** 启动时恢复最近一次实验（刷新可恢复输入，§8.8-10「状态不丢、刷新可恢复」） */
export function restoreLastSession(): boolean {
  if (current) return true;
  const latest = latestExperiment();
  if (!latest) return false;
  const exp = PX.load(latest.id);
  if (!exp) return false;
  current = exp;
  notify();
  return true;
}

export function removeExperiment(id: string): void {
  try {
    PX.remove(id);
  } catch {
    /* 忽略 */
  }
  if (current && current.id === id) setCurrent(null);
  notify();
}

export function shareCodeOfCurrent(): string | null {
  if (!current) return null;
  try {
    return PX.encodeShare(current);
  } catch {
    return null;
  }
}