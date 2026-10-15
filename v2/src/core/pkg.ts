/**
 * pkg.ts — 内容包 / 提交包（FR-04）
 *   打包：一组实验 + 清单（名称 / 说明 / 标签 / 创建者 / 时间）→ 单个 `.pkg`（JSON）文件或分享码。
 *   导入：逐项校验（迁移 + 规范化 + 校验）→ 返回可用实验列表与失败项原因，**不落库**（由调用方 save）。
 * 分享码前缀 `PK1.`（与单实验 `PX1.` 区分）；校验同 fnv1a（与 experiment.fnv1a 同源算法）。
 * 正确性由 parity.mjs 闭式真值钉死（往返一致 / 篡改检出 / 上限拒绝）。
 */

import {
  MAX_STATE_BYTES,
  SCHEMA_VERSION,
  fnv1a,
  b64uEnc,
  b64uDec,
  importJSON,
  type Experiment,
} from './experiment';

/** 分享码字符上限（复用实验分享码量级；内容包通常更大，故给 4 倍） */
export const MAX_PKG_CHARS = 24000;
/** 单个 .pkg JSON 文本上限 */
export const MAX_PKG_BYTES = 2 * 1024 * 1024;
/** 一个包最多包含的实验数 */
export const MAX_PKG_ITEMS = 60;

export interface PkgMeta {
  name: string;
  desc?: string;
  author?: string;
  tags?: string[];
  /** 省略时由 buildPackage 填当前时间 */
  createdAt?: string;
}

export interface ContentPackage {
  kind: 'fltp-pkg';
  schemaVersion: number;
  meta: PkgMeta & { createdAt: string };
  /** 实验数组（已规范化） */
  experiments: Experiment[];
}

export type BuildResult = { ok: true; value: ContentPackage } | { ok: false; error: { code: string; message: string } };

/** 打包：校验每个实验并生成内容包（数量上限、逐项合法、状态体积上限） */
export function buildPackage(experiments: Experiment[], meta: PkgMeta): BuildResult {
  if (!experiments.length) return { ok: false, error: { code: 'empty', message: '内容包至少要包含 1 个实验' } };
  if (experiments.length > MAX_PKG_ITEMS) {
    return { ok: false, error: { code: 'too-many', message: `内容包最多 ${MAX_PKG_ITEMS} 个实验（当前 ${experiments.length}）` } };
  }
  if (!meta.name || !meta.name.trim()) return { ok: false, error: { code: 'no-name', message: '内容包需要名称' } };
  const items: Experiment[] = [];
  for (let i = 0; i < experiments.length; i++) {
    const r = importJSON(JSON.stringify({ experiment: experiments[i] }));
    if (!r.ok) return { ok: false, error: { code: r.error.code, message: `第 ${i + 1} 个实验非法：${r.error.message}` } };
    // 逐模块状态体积上限（与实验自身约束一致）
    for (const [k, st] of Object.entries(r.value.moduleStates)) {
      const bytes = JSON.stringify(st.data ?? null).length;
      if (bytes > MAX_STATE_BYTES) {
        return { ok: false, error: { code: 'too-large', message: `第 ${i + 1} 个实验的「${k}」状态超过 ${MAX_STATE_BYTES / 1024}KB 上限` } };
      }
    }
    items.push(r.value);
  }
  return {
    ok: true,
    value: { kind: 'fltp-pkg', schemaVersion: SCHEMA_VERSION, meta: { ...meta, createdAt: meta.createdAt || new Date().toISOString() }, experiments: items },
  };
}

export function packToJSON(pkg: ContentPackage): string {
  return JSON.stringify(pkg, null, 2);
}

/** 解析 JSON 文本 → 内容包（逐项校验，返回可用项与失败原因） */
export interface DecodedPackage {
  meta: PkgMeta & { createdAt: string };
  items: Experiment[];
  failed: Array<{ index: number; message: string }>;
}

export type PkgDecodeResult =
  | { ok: true; value: DecodedPackage }
  | { ok: false; error: { code: string; message: string } };

export function decodePackageJSON(str: string, opts?: { maxBytes?: number }): PkgDecodeResult {
  const maxBytes = opts?.maxBytes ?? MAX_PKG_BYTES;
  if (typeof str !== 'string' || !str.trim()) return { ok: false, error: { code: 'empty', message: '内容包为空' } };
  if (str.length > maxBytes) return { ok: false, error: { code: 'too-large', message: `内容包超过 ${Math.round(maxBytes / 1024)}KB 上限` } };
  let obj: unknown;
  try {
    obj = JSON.parse(str);
  } catch (e) {
    return { ok: false, error: { code: 'bad-json', message: '不是合法 JSON：' + (e as Error).message } };
  }
  const o = obj as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return { ok: false, error: { code: 'bad-shape', message: '内容包根节点应为对象' } };
  const arr = Array.isArray(o['experiments']) ? (o['experiments'] as unknown[]) : null;
  if (!arr) return { ok: false, error: { code: 'no-items', message: '内容包缺少 experiments 数组' } };
  if (arr.length > MAX_PKG_ITEMS) return { ok: false, error: { code: 'too-many', message: `内容包内实验数超过 ${MAX_PKG_ITEMS}` } };
  const metaRaw = (o['meta'] && typeof o['meta'] === 'object' ? o['meta'] : {}) as Record<string, unknown>;
  const meta: PkgMeta & { createdAt: string } = {
    name: typeof metaRaw['name'] === 'string' && metaRaw['name'] ? String(metaRaw['name']) : '未命名内容包',
    desc: typeof metaRaw['desc'] === 'string' ? String(metaRaw['desc']) : undefined,
    author: typeof metaRaw['author'] === 'string' ? String(metaRaw['author']) : undefined,
    tags: Array.isArray(metaRaw['tags']) ? (metaRaw['tags'] as unknown[]).filter((t) => typeof t === 'string') as string[] : [],
    createdAt: typeof metaRaw['createdAt'] === 'string' ? String(metaRaw['createdAt']) : new Date().toISOString(),
  };
  const items: Experiment[] = [];
  const failed: Array<{ index: number; message: string }> = [];
  arr.forEach((it, i) => {
    const r = importJSON(JSON.stringify(it));
    if (r.ok) items.push(r.value);
    else failed.push({ index: i, message: r.error.message });
  });
  if (!items.length) {
    return { ok: false, error: { code: 'all-invalid', message: `包内 ${arr.length} 个实验全部无法导入：` + (failed[0]?.message ?? '') } };
  }
  return { ok: true, value: { meta, items, failed } };
}

/** 内容包 → 分享码（PK1.<数据>.<校验>）；超长抛出带 code 的错误 */
export function encodePackage(pkg: ContentPackage): string {
  const payload = b64uEnc(packToJSON(pkg));
  const code = 'PK1.' + payload + '.' + fnv1a(payload);
  if (code.length > MAX_PKG_CHARS) {
    throw Object.assign(new Error(`内容包分享码过长（${code.length} > ${MAX_PKG_CHARS} 字符），请改用 .pkg 文件导出`), { code: 'too-large' });
  }
  return code;
}

/** 分享码 → 内容包（校验前缀 + 校验和 + 逐项导入） */
export function decodePackage(code: string): PkgDecodeResult {
  if (typeof code !== 'string') return { ok: false, error: { code: 'empty', message: '内容包分享码为空' } };
  const parts = code.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'PK1') {
    return { ok: false, error: { code: 'bad-format', message: '内容包分享码格式不对（应为 PK1.<数据>.<校验>）' } };
  }
  const payload = parts[1];
  if (fnv1a(payload) !== parts[2]) {
    return { ok: false, error: { code: 'bad-checksum', message: '内容包校验失败：内容已损坏或不完整' } };
  }
  let json: string;
  try {
    json = b64uDec(payload);
  } catch {
    return { ok: false, error: { code: 'bad-base64', message: '内容包数据段无法解码' } };
  }
  return decodePackageJSON(json, { maxBytes: MAX_PKG_BYTES });
}
