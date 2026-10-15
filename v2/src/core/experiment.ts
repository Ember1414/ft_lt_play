/**
 * experiment.ts — 版本化实验数据模型 + 本地存储 + 分享编码（自 v1 project.js 迁移，原 window.PX）
 *
 *   Experiment schema v1:
 *   {
 *     schemaVersion: 1,
 *     id: 'e<base36时间><rand>',          // /^[a-z0-9]{6,24}$/
 *     name: string ≤80,
 *     createdAt / updatedAt: number,
 *     favorite: boolean,
 *     tags: string[] ≤10,
 *     module: 'sys'|'zt'|...,             // 实验当前主模块
 *     moduleStates: { <module>: { savedAt, data:任意纯JSON ≤32KB } },
 *     snapshots: [ { id, label≤60, ts, module, state:{<module>:{savedAt,data}} } ] ≤10
 *   }
 *
 *   安全设计：
 *   - 全部数据过 deepSanitize：拒绝 NaN/Infinity、函数、__proto__/constructor 键、
 *     超深嵌套、超长字符串 —— 拒绝而非静默剥离。
 *   - 存储键前缀 fltp:v1:；index 与单实验分离，配额错误显式上抛。
 *   - 分享码 = 'PX1.' + base64url(json) + '.' + FNV-1a 校验，超长/改坏即拒绝。
 *   - 本地优先（local-first）：不上传任何数据；存储经 setStorage 注入（v2 保持同款端口）。
 * 数值/错误语义与 v1 一致（回归网：project.test.mjs + parity.mjs）。
 * 例外（M4 #15）：单模块状态体积按 **UTF-8 精确字节** 计（v1 用 UTF-16 码元数），
 * 非 ASCII 数据会更早触发 state-too-large —— 这是有意的行为修正，见《存量问题清单》#15。
 */

import { utf8Encode, utf8Decode } from './utf8';

export const SCHEMA_VERSION = 1;
export const MAX_EXPERIMENTS = 60;
export const MAX_STATE_BYTES = 32 * 1024;
export const MAX_SNAPSHOTS = 10;
export const MAX_SHARE_CHARS = 6000;
const MAX_JSON_BYTES = 256 * 1024;
const ID_RE = /^[a-z0-9]{6,24}$/;
const MODULE_RE = /^[a-z]{1,12}$/;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/* ---------- 类型 ---------- */

export interface ModuleState {
  savedAt?: number;
  data?: unknown;
}

export interface Snapshot {
  id: string;
  label: string;
  ts: number;
  module: string;
  state: Record<string, ModuleState>;
}

export interface Experiment {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  favorite: boolean;
  tags: string[];
  module: string;
  moduleStates: Record<string, ModuleState>;
  snapshots: Snapshot[];
}

export interface ExpMeta {
  id: string;
  name: string;
  module: string;
  favorite: boolean;
  tags: string[];
  updatedAt: number;
}

export interface CodedError extends Error {
  code: string;
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  key(i: number): string | null;
  readonly length: number;
}

/* ---------- 存储（可注入以便测试） ---------- */
const memoryShim: StorageLike = (() => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => {
      m.set(k, String(v));
    },
    removeItem: (k) => {
      m.delete(k);
    },
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
})();
let LS: StorageLike = (typeof localStorage !== 'undefined' && localStorage) || memoryShim;
export const setStorage = (ls?: StorageLike | null): void => {
  LS = ls || memoryShim;
};
const K = { INDEX: 'fltp:v1:index', EXP: (id: string) => 'fltp:v1:exp:' + id };
const lsGet = (k: string): string | null => {
  try {
    return LS.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string): void => {
  LS.setItem(k, v); // 配额错误直接上抛（QuotaExceededError）
};

/* ---------- 错误 ---------- */
export function pxError(code: string, message: string): CodedError {
  const e = new Error(message) as CodedError;
  e.code = code;
  return e;
}

/* ---------- 校验：纯 JSON 数据（拒绝式） ---------- */
function deepSanitize(v: unknown, depth: number, path: string): void {
  if (depth > 8) throw pxError('data-too-deep', `嵌套过深：${path}`);
  const ty = typeof v;
  if (v === null) return;
  if (ty === 'string') {
    if ((v as string).length > 2000) throw pxError('string-too-long', `字符串过长：${path}`);
    return;
  }
  if (ty === 'number') {
    if (!isFinite(v as number)) throw pxError('non-finite', `非有限数值：${path}`);
    return;
  }
  if (ty === 'boolean') return;
  if (Array.isArray(v)) {
    if (v.length > 2000) throw pxError('array-too-long', `数组过长：${path}`);
    v.forEach((x, i) => deepSanitize(x, depth + 1, `${path}[${i}]`));
    return;
  }
  if (ty === 'object') {
    const obj = v as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      if (BAD_KEYS.has(k)) throw pxError('bad-key', `禁止的键「${k}」：${path}`);
      deepSanitize(obj[k], depth + 1, `${path}.${k}`);
    }
    return;
  }
  throw pxError('bad-type', `不允许的类型 ${ty}：${path}`);
}

/* ---------- 校验 / 归一化 ---------- */
function checkStateMap(states: unknown, where: string): void {
  if (typeof states !== 'object' || states === null || Array.isArray(states)) {
    throw pxError('bad-states', `${where} 必须是对象`);
  }
  const sm = states as Record<string, unknown>;
  for (const key of Object.keys(sm)) {
    if (!MODULE_RE.test(key) || BAD_KEYS.has(key)) throw pxError('bad-module-key', `${where} 的模块键非法：${key}`);
    const st = sm[key];
    if (typeof st !== 'object' || st === null || Array.isArray(st)) throw pxError('bad-state', `${where}.${key} 非对象`);
    const sto = st as Record<string, unknown>;
    if (sto.savedAt != null && !isFinite(Number(sto.savedAt))) {
      throw pxError('bad-state', `${where}.${key}.savedAt 非法`);
    }
    const data = sto.data == null ? {} : sto.data;
    // M4 #15：原用 JSON.stringify(...).length（UTF-16 码元数）当字节数，非 ASCII 会低估配额。
    // 改为 UTF-8 精确字节（utf8Encode 每字符一字节）。行为变化：含中文/emoji 的状态会更早被拒绝。
    const bytes = utf8Encode(JSON.stringify(data)).length;
    if (bytes > MAX_STATE_BYTES) {
      throw pxError('state-too-large', `${where}.${key} 状态超过 ${MAX_STATE_BYTES / 1024}KB（实测 ${bytes} 字节）`);
    }
    deepSanitize(data, 0, `${where}.${key}`);
  }
}

export type ValidateResult = { ok: true; value: Experiment } | { ok: false; errors: string[] };

export function validateExperiment(raw: unknown): ValidateResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['实验数据必须是对象'] };
  }
  const e = raw as Record<string, unknown>;
  const errs: string[] = [];
  const need = (cond: boolean, msg: string): void => {
    if (!cond) errs.push(msg);
  };
  need(
    e.schemaVersion === SCHEMA_VERSION,
    `schemaVersion 必须为 ${SCHEMA_VERSION}（得到 ${JSON.stringify(e.schemaVersion)}）`,
  );
  need(typeof e.id === 'string' && ID_RE.test(e.id), 'id 非法');
  need(typeof e.name === 'string' && e.name.length <= 80 && e.name.trim() !== '', 'name 缺失或超长');
  need(Number.isFinite(e.createdAt) && Number.isFinite(e.updatedAt), 'createdAt/updatedAt 必须是有限数值');
  need(typeof e.favorite === 'boolean', 'favorite 必须是布尔');
  need(
    Array.isArray(e.tags) && e.tags.length <= 10 && e.tags.every((t) => typeof t === 'string' && t.length <= 20),
    'tags 非法',
  );
  need(typeof e.module === 'string' && MODULE_RE.test(e.module), 'module 键非法');
  try {
    checkStateMap(e.moduleStates, 'moduleStates');
  } catch (er) {
    errs.push((er as Error).message);
  }
  if (!Array.isArray(e.snapshots)) errs.push('snapshots 必须是数组');
  else {
    need(e.snapshots.length <= MAX_SNAPSHOTS, `快照最多 ${MAX_SNAPSHOTS} 个`);
    (e.snapshots as unknown[]).forEach((s, i) => {
      const so = s as Record<string, unknown>;
      need(
        typeof s === 'object' && s !== null && typeof so.id === 'string' && ID_RE.test(String(so.id).replace(/[^a-z0-9]/g, '') || ''),
        `快照 #${i} id 非法`,
      );
      need(typeof so.label === 'string' && so.label.length <= 60, `快照 #${i} label 非法`);
      need(Number.isFinite(so.ts), `快照 #${i} ts 非法`);
      try {
        checkStateMap(so.state, `snapshots[${i}].state`);
      } catch (er) {
        errs.push((er as Error).message);
      }
    });
  }
  return errs.length ? { ok: false, errors: errs } : { ok: true, value: raw as Experiment };
}

/** v1 导出名别名（回归网/旧调用方兼容） */
export const validate = validateExperiment;

export function normalize(raw: unknown): Experiment {
  // 补默认值（import/旧数据的宽容入口；validate 仍在其后把关）
  const e = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: typeof e.id === 'string' && ID_RE.test(e.id) ? e.id : uid(),
    name: typeof e.name === 'string' && e.name.trim() ? e.name.slice(0, 80) : '未命名实验',
    createdAt: Number.isFinite(e.createdAt) ? (e.createdAt as number) : Date.now(),
    updatedAt: Number.isFinite(e.updatedAt) ? (e.updatedAt as number) : Date.now(),
    favorite: e.favorite === true,
    tags: Array.isArray(e.tags) ? (e.tags.filter((t) => typeof t === 'string') as string[]).slice(0, 10) : [],
    module: typeof e.module === 'string' && MODULE_RE.test(e.module) ? e.module : 'sys',
    moduleStates:
      typeof e.moduleStates === 'object' && e.moduleStates !== null
        ? (e.moduleStates as Record<string, ModuleState>)
        : {},
    snapshots: Array.isArray(e.snapshots) ? (e.snapshots as Snapshot[]).slice(0, MAX_SNAPSHOTS) : [],
  };
}

/* ---------- 迁移框架：v(n-1) → v(n) 逐级升级 ---------- */
const MIGRATIONS: Record<number, ((raw: Record<string, unknown>) => Record<string, unknown>) | undefined> = {
  // 1: (raw) => raw,   // 示例：出现 v2 时在此登记 1→2 迁移
};

export type MigrateResult =
  | { ok: true; value: Record<string, unknown>; fromVersion: number }
  | { ok: false; error: { code: string; message: string } };

export function migrate(raw: unknown): MigrateResult {
  const vRaw = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).schemaVersion : null;
  if (typeof vRaw !== 'number' || !Number.isInteger(vRaw) || vRaw < 1) {
    return { ok: false, error: { code: 'bad-version', message: '实验数据缺少有效的 schemaVersion' } };
  }
  if (vRaw > SCHEMA_VERSION) {
    return {
      ok: false,
      error: { code: 'newer-version', message: `实验数据版本 v${vRaw} 高于当前支持 v${SCHEMA_VERSION}，请升级应用` },
    };
  }
  let cur = raw as Record<string, unknown>;
  let from = vRaw;
  while (from < SCHEMA_VERSION) {
    const step = MIGRATIONS[from];
    if (!step) {
      return { ok: false, error: { code: 'no-migration', message: `缺少 v${from} → v${from + 1} 迁移` } };
    }
    try {
      cur = step(cur);
    } catch (e) {
      return { ok: false, error: { code: 'migration-failed', message: '迁移失败：' + (e as Error).message } };
    }
    from++;
    cur.schemaVersion = from;
  }
  return { ok: true, value: cur, fromVersion: vRaw };
}

/* ---------- 编码工具 ---------- */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// UTF-8 → base64url：复用 utf8Encode/utf8Decode，仅做 base64url 编解码。
export function b64uEnc(str: string): string {
  return btoa(utf8Encode(str)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uDec(s: string): string {
  let t = s.replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  return utf8Decode(atob(t));
}

export function uid(): string {
  return ('e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)).slice(0, 20);
}

/* ---------- 存储 API ---------- */
function readIndex(): ExpMeta[] {
  try {
    const a = JSON.parse(lsGet(K.INDEX) || '[]');
    if (!Array.isArray(a)) return [];
    return (a as ExpMeta[]).filter((x) => x && typeof x.id === 'string');
  } catch {
    return [];
  }
}

function writeIndex(meta: ExpMeta[]): void {
  lsSet(K.INDEX, JSON.stringify(meta));
}

export function load(id: string): Experiment | null {
  try {
    const raw = lsGet(K.EXP(id));
    return raw ? (JSON.parse(raw) as Experiment) : null;
  } catch {
    return null;
  }
}

export function save(exp: Experiment): Experiment {
  const v = validateExperiment(exp);
  if (!v.ok) throw pxError('invalid-experiment', '实验数据非法：' + v.errors[0]);
  v.value.updatedAt = Date.now();
  const json = JSON.stringify(v.value);
  lsSet(K.EXP(v.value.id), json); // 先写主体，再更新索引（索引坏可重建，主体不能）
  const meta = readIndex().filter((m) => m.id !== v.value.id);
  meta.unshift({
    id: v.value.id,
    name: v.value.name,
    module: v.value.module,
    favorite: v.value.favorite,
    tags: v.value.tags,
    updatedAt: v.value.updatedAt,
  });
  writeIndex(meta.slice(0, MAX_EXPERIMENTS));
  return v.value;
}

function rebuildIndex(): ExpMeta[] {
  // 索引丢失/损坏时从主体键重建
  const meta: ExpMeta[] = [];
  for (let i = 0; i < LS.length; i++) {
    const k = LS.key(i);
    if (k && k.startsWith(K.EXP(''))) {
      const e = load(k.slice(K.EXP('').length));
      if (e) {
        meta.push({
          id: e.id,
          name: e.name,
          module: e.module,
          favorite: e.favorite,
          tags: e.tags,
          updatedAt: e.updatedAt,
        });
      }
    }
  }
  meta.sort((a, b) => b.updatedAt - a.updatedAt);
  writeIndex(meta);
  return meta;
}

export function list(): ExpMeta[] {
  let meta = readIndex();
  if (!meta.length) meta = rebuildIndex();
  return meta.sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt);
}

export interface CreateOpts {
  name?: string;
  module?: string;
  state?: unknown;
  tags?: string[];
}

export function create(opts: CreateOpts): Experiment {
  const { name, module, state, tags } = opts;
  if (list().length >= MAX_EXPERIMENTS) {
    throw pxError('too-many', `实验最多保留 ${MAX_EXPERIMENTS} 个，请先删除旧实验`);
  }
  const now = Date.now();
  const exp = normalize({
    name: (name || '').trim() || '未命名实验',
    module: module || 'sys',
    createdAt: now,
    updatedAt: now,
    tags: tags || [],
    moduleStates: state ? { [module || 'sys']: { savedAt: now, data: state } } : {},
  });
  return save(exp);
}

export function remove(id: string): void {
  try {
    LS.removeItem(K.EXP(id));
  } catch {
    /* 忽略：键不存在或存储拒绝 */
  }
  writeIndex(readIndex().filter((m) => m.id !== id));
}

export function duplicate(id: string): Experiment {
  const src = load(id);
  if (!src) throw pxError('not-found', '实验不存在');
  const now = Date.now();
  const copy = normalize({
    ...(JSON.parse(JSON.stringify(src)) as Record<string, unknown>),
    id: uid(),
    name: (src.name + ' 副本').slice(0, 80),
    createdAt: now,
    updatedAt: now,
    favorite: false,
  });
  return save(copy);
}

export interface PatchFields {
  name?: string;
  favorite?: boolean;
  tags?: string[];
  module?: string;
  moduleStates?: Record<string, ModuleState>;
}

export function patch(id: string, fields: PatchFields): Experiment {
  const e = load(id);
  if (!e) throw pxError('not-found', '实验不存在');
  if (fields.name != null) e.name = String(fields.name).trim().slice(0, 80) || e.name;
  if (fields.favorite != null) e.favorite = fields.favorite === true;
  if (fields.tags != null) e.tags = fields.tags.slice(0, 10);
  if (fields.module != null) e.module = fields.module;
  if (fields.moduleStates != null) e.moduleStates = fields.moduleStates;
  return save(e);
}

/* 快照：深拷贝全部模块状态；restore 用快照覆盖 moduleStates */
export function addSnapshot(exp: Experiment, label?: string, moduleKey?: string): Snapshot {
  const now = Date.now();
  const snap: Snapshot = {
    id: uid(),
    label: String(label || '快照 ' + new Date(now).toLocaleString()).slice(0, 60),
    ts: now,
    module: moduleKey || exp.module,
    state: JSON.parse(JSON.stringify(exp.moduleStates || {})) as Record<string, ModuleState>,
  };
  exp.snapshots = [snap, ...(exp.snapshots || [])].slice(0, MAX_SNAPSHOTS);
  save(exp);
  return snap;
}

export function restoreSnapshot(exp: Experiment, snapId: string): Experiment {
  const s = (exp.snapshots || []).find((x) => x.id === snapId);
  if (!s) throw pxError('not-found', '快照不存在');
  exp.moduleStates = JSON.parse(JSON.stringify(s.state)) as Record<string, ModuleState>;
  exp.module = s.module;
  return save(exp);
}

/* ---------- 导出 / 分享 ---------- */
export function exportJSON(exp: Experiment): string {
  const v = validateExperiment(exp);
  if (!v.ok) throw pxError('invalid-experiment', '实验数据非法：' + v.errors[0]);
  return JSON.stringify({ kind: 'fltp-experiment', exportedAt: new Date().toISOString(), experiment: v.value }, null, 2);
}

export type ImportResult =
  | { ok: true; value: Experiment; migrated: boolean }
  | { ok: false; error: { code: string; message: string } };

export function importJSON(str: string): ImportResult {
  if (typeof str !== 'string' || !str.trim()) return { ok: false, error: { code: 'empty', message: '导入内容为空' } };
  if (str.length > MAX_JSON_BYTES) {
    return { ok: false, error: { code: 'too-large', message: `文件超过 ${MAX_JSON_BYTES / 1024}KB 上限` } };
  }
  let obj: unknown;
  try {
    obj = JSON.parse(str);
  } catch (e) {
    return { ok: false, error: { code: 'bad-json', message: '不是合法 JSON：' + (e as Error).message } };
  }
  const oo = obj as Record<string, unknown> | null;
  const raw = oo && typeof oo === 'object' && oo.experiment ? oo.experiment : obj;
  const m = migrate(raw);
  if (!m.ok) return m;
  const exp = normalize(m.value);
  const v = validateExperiment(exp);
  if (!v.ok) return { ok: false, error: { code: 'invalid', message: '实验数据非法：' + v.errors.join('；') } };
  return { ok: true, value: v.value, migrated: m.fromVersion !== SCHEMA_VERSION };
}

export function encodeShare(exp: Experiment): string {
  const v = validateExperiment(exp);
  if (!v.ok) throw pxError('invalid-experiment', '实验数据非法：' + v.errors[0]);
  const payload = b64uEnc(JSON.stringify(v.value));
  const code = 'PX1.' + payload + '.' + fnv1a(payload);
  if (code.length > MAX_SHARE_CHARS) {
    throw pxError('too-large', `分享码过长（${code.length} > ${MAX_SHARE_CHARS} 字符），请减少实验内容`);
  }
  return code;
}

export type DecodeResult = { ok: true; value: Experiment } | { ok: false; error: { code: string; message: string } };

export function decodeShare(str: string): DecodeResult {
  if (typeof str !== 'string') return { ok: false, error: { code: 'empty', message: '分享码为空' } };
  const parts = str.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'PX1') {
    return { ok: false, error: { code: 'bad-format', message: '分享码格式不对（应为 PX1.<数据>.<校验>）' } };
  }
  const payload = parts[1];
  const sum = parts[2];
  if (fnv1a(payload) !== sum) {
    return { ok: false, error: { code: 'bad-checksum', message: '分享码校验失败：内容已损坏或不完整' } };
  }
  let json: string;
  try {
    json = b64uDec(payload);
  } catch {
    return { ok: false, error: { code: 'bad-base64', message: '分享码数据段无法解码' } };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: { code: 'bad-json', message: '分享码内的数据不是合法 JSON' } };
  }
  const m = migrate(raw);
  if (!m.ok) return m;
  const exp = normalize(m.value);
  const v = validateExperiment(exp);
  if (!v.ok) {
    return { ok: false, error: { code: 'invalid', message: '分享的实验数据非法：' + v.errors.join('；') } };
  }
  return { ok: true, value: v.value };
}