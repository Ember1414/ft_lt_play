/**
 * backup.ts — 备份包（M10）：把「全部实验 + 自建剧场剧本」编成单个 JSON 文件的**纯函数**层。
 * 打包 `buildBackup` / 解析 `readBackup`；逐项校验仍在调用方
 * （实验走 core 的 `importJSON`，剧本走 state 的 `saveUserScript`）——本模块只管包外壳与字段定位，
 * 因此无 DOM、可独立断言（也是「设置中心」备份卡的全部数据逻辑）。
 * 兼容：旧版备份无 `theaterScripts` → 解析结果里为 null（只恢复实验）；
 *      非对象根节点（历史单实验文件）按 `[root]` 处理，行为与 M2 一致。
 */

import { SCHEMA_VERSION, type Experiment } from '../core';
import type { TheaterScript } from '../state/theater';

export interface BackupBundle {
  kind: 'fltp-backup';
  schema: number;
  version: string;
  exportedAt: string;
  count: number;
  experiments: Experiment[];
  theaterCount: number;
  /** 自建剧本（结构同 `state/theater` 的 TheaterScript；合法性由 `saveUserScript` 判定） */
  theaterScripts: TheaterScript[];
}

/** 打包：实验 + 自建剧本 → 备份包（内置剧本属代码内置，不入包） */
export function buildBackup(experiments: Experiment[], scripts: TheaterScript[], version: string): BackupBundle {
  return {
    kind: 'fltp-backup',
    schema: SCHEMA_VERSION,
    version,
    exportedAt: new Date().toISOString(),
    count: experiments.length,
    experiments,
    theaterCount: scripts.length,
    theaterScripts: scripts,
  };
}

export type BackupReadResult =
  | { ok: true; experiments: unknown[]; theaterScripts: unknown[] | null }
  | { ok: false; error: string };

/** 解析备份文件文本：定位实验数组与剧本数组（不校验项内数据，失败给出具体原因） */
export function readBackup(text: string): BackupReadResult {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法 JSON 文件' };
  }
  const oo = obj as Record<string, unknown> | null;
  const experiments = Array.isArray(oo?.experiments)
    ? (oo.experiments as unknown[])
    : Array.isArray(obj)
      ? (obj as unknown[])
      : [obj];
  const theaterScripts = Array.isArray(oo?.theaterScripts) ? (oo.theaterScripts as unknown[]) : null;
  return { ok: true, experiments, theaterScripts };
}
