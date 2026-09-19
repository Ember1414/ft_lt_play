/* ============================================================
 * project.js — 版本化实验数据模型 + 本地存储 + 分享编码（window.PX）
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
 *   - 本地优先（local-first）：不上传任何数据；接口形状为未来 IndexedDB/云同步预留。
 * ============================================================ */
window.PX = (() => {
  const SCHEMA_VERSION = 1;
  const MAX_EXPERIMENTS = 60;
  const MAX_STATE_BYTES = 32 * 1024;
  const MAX_SNAPSHOTS = 10;
  const MAX_SHARE_CHARS = 6000;
  const MAX_JSON_BYTES = 256 * 1024;
  const ID_RE = /^[a-z0-9]{6,24}$/;
  const MODULE_RE = /^[a-z]{1,12}$/;
  const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  /* ---------- 存储（可注入以便测试） ---------- */
  const memoryShim = (() => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
  })();
  let LS = (typeof localStorage !== 'undefined' && localStorage) || memoryShim;
  const setStorage = (ls) => { LS = ls || memoryShim; };
  const K = { INDEX: 'fltp:v1:index', EXP: (id) => 'fltp:v1:exp:' + id };
  const lsGet = (k) => { try { return LS.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { LS.setItem(k, v); };   // 配额错误直接上抛（QuotaExceededError）

  /* ---------- 校验：纯 JSON 数据（拒绝式） ---------- */
  function deepSanitize(v, depth, path) {
    if (depth > 8) throw new PXError('data-too-deep', `嵌套过深：${path}`);
    const ty = typeof v;
    if (v === null) return;
    if (ty === 'string') { if (v.length > 2000) throw new PXError('string-too-long', `字符串过长：${path}`); return; }
    if (ty === 'number') { if (!isFinite(v)) throw new PXError('non-finite', `非有限数值：${path}`); return; }
    if (ty === 'boolean') return;
    if (Array.isArray(v)) {
      if (v.length > 2000) throw new PXError('array-too-long', `数组过长：${path}`);
      v.forEach((x, i) => deepSanitize(x, depth + 1, `${path}[${i}]`));
      return;
    }
    if (ty === 'object') {
      for (const k of Object.keys(v)) {
        if (BAD_KEYS.has(k)) throw new PXError('bad-key', `禁止的键「${k}」：${path}`);
        deepSanitize(v[k], depth + 1, `${path}.${k}`);
      }
      return;
    }
    throw new PXError('bad-type', `不允许的类型 ${ty}：${path}`);
  }
  function PXError(code, message) { const e = new Error(message); e.code = code; return e; }

  /* ---------- 校验 / 归一化 ---------- */
  function checkStateMap(states, where) {
    if (typeof states !== 'object' || states === null || Array.isArray(states)) throw new PXError('bad-states', `${where} 必须是对象`);
    for (const key of Object.keys(states)) {
      if (!MODULE_RE.test(key) || BAD_KEYS.has(key)) throw new PXError('bad-module-key', `${where} 的模块键非法：${key}`);
      const st = states[key];
      if (typeof st !== 'object' || st === null || Array.isArray(st)) throw new PXError('bad-state', `${where}.${key} 非对象`);
      if (st.savedAt != null && !isFinite(st.savedAt)) throw new PXError('bad-state', `${where}.${key}.savedAt 非法`);
      const bytes = JSON.stringify(st.data == null ? {} : st.data);
      if (bytes.length > MAX_STATE_BYTES) throw new PXError('state-too-large', `${where}.${key} 状态超过 ${MAX_STATE_BYTES / 1024}KB`);
      deepSanitize(st.data == null ? {} : st.data, 0, `${where}.${key}`);
    }
  }
  function validateExperiment(raw) {
    const e = raw;
    if (typeof e !== 'object' || e === null || Array.isArray(e)) return { ok: false, errors: ['实验数据必须是对象'] };
    const errs = [];
    const need = (cond, msg) => { if (!cond) errs.push(msg); };
    need(e.schemaVersion === SCHEMA_VERSION, `schemaVersion 必须为 ${SCHEMA_VERSION}（得到 ${JSON.stringify(e.schemaVersion)}）`);
    need(typeof e.id === 'string' && ID_RE.test(e.id), 'id 非法');
    need(typeof e.name === 'string' && e.name.length <= 80 && e.name.trim() !== '', 'name 缺失或超长');
    need(Number.isFinite(e.createdAt) && Number.isFinite(e.updatedAt), 'createdAt/updatedAt 必须是有限数值');
    need(typeof e.favorite === 'boolean', 'favorite 必须是布尔');
    need(Array.isArray(e.tags) && e.tags.length <= 10 && e.tags.every((t) => typeof t === 'string' && t.length <= 20), 'tags 非法');
    need(typeof e.module === 'string' && MODULE_RE.test(e.module), 'module 键非法');
    try { checkStateMap(e.moduleStates, 'moduleStates'); } catch (er) { errs.push(er.message); }
    if (!Array.isArray(e.snapshots)) errs.push('snapshots 必须是数组');
    else {
      need(e.snapshots.length <= MAX_SNAPSHOTS, `快照最多 ${MAX_SNAPSHOTS} 个`);
      e.snapshots.forEach((s, i) => {
        need(typeof s === 'object' && s !== null && typeof s.id === 'string' && ID_RE.test(s.id.replace(/[^a-z0-9]/g, '') || ''), `快照 #${i} id 非法`);
        need(typeof s.label === 'string' && s.label.length <= 60, `快照 #${i} label 非法`);
        need(Number.isFinite(s.ts), `快照 #${i} ts 非法`);
        try { checkStateMap(s.state, `snapshots[${i}].state`); } catch (er) { errs.push(er.message); }
      });
    }
    return errs.length ? { ok: false, errors: errs } : { ok: true, value: e };
  }

  function normalize(raw) {
    // 补默认值（import/旧数据的宽容入口；validate 仍在其后把关）
    const e = typeof raw === 'object' && raw !== null ? raw : {};
    return {
      schemaVersion: SCHEMA_VERSION,
      id: typeof e.id === 'string' && ID_RE.test(e.id) ? e.id : uid(),
      name: typeof e.name === 'string' && e.name.trim() ? e.name.slice(0, 80) : '未命名实验',
      createdAt: Number.isFinite(e.createdAt) ? e.createdAt : Date.now(),
      updatedAt: Number.isFinite(e.updatedAt) ? e.updatedAt : Date.now(),
      favorite: e.favorite === true,
      tags: Array.isArray(e.tags) ? e.tags.filter((t) => typeof t === 'string').slice(0, 10) : [],
      module: typeof e.module === 'string' && MODULE_RE.test(e.module) ? e.module : 'sys',
      moduleStates: typeof e.moduleStates === 'object' && e.moduleStates !== null ? e.moduleStates : {},
      snapshots: Array.isArray(e.snapshots) ? e.snapshots.slice(0, MAX_SNAPSHOTS) : []
    };
  }

  /* ---------- 迁移框架：v(n-1) → v(n) 逐级升级 ---------- */
  const MIGRATIONS = {
    // 1: (raw) => raw,   // 示例：出现 v2 时在此登记 1→2 迁移
  };
  function migrate(raw) {
    let v = raw && typeof raw === 'object' ? raw.schemaVersion : null;
    if (!Number.isInteger(v) || v < 1) return { ok: false, error: { code: 'bad-version', message: '实验数据缺少有效的 schemaVersion' } };
    if (v > SCHEMA_VERSION) return { ok: false, error: { code: 'newer-version', message: `实验数据版本 v${v} 高于当前支持 v${SCHEMA_VERSION}，请升级应用` } };
    let cur = raw;
    let from = v;
    while (from < SCHEMA_VERSION) {
      const step = MIGRATIONS[from];
      if (!step) return { ok: false, error: { code: 'no-migration', message: `缺少 v${from} → v${from + 1} 迁移` } };
      try { cur = step(cur); } catch (e) { return { ok: false, error: { code: 'migration-failed', message: '迁移失败：' + e.message } }; }
      from++;
      cur.schemaVersion = from;
    }
    return { ok: true, value: cur, fromVersion: v };
  }

  /* ---------- 编码工具 ---------- */
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  // UTF-8 → base64url：encodeURIComponent 产出 UTF-8 百分号序列，unescape 逐字节映射后 btoa。
  // 不依赖 TextEncoder/TextDecoder，测试桩与旧环境同样可用；对外是标准 base64url。
  function b64uEnc(str) {
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64uDec(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return decodeURIComponent(escape(atob(s)));
  }
  function uid() { return ('e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)).slice(0, 20); }

  /* ---------- 存储 API ---------- */
  function readIndex() {
    try { const a = JSON.parse(lsGet(K.INDEX) || '[]'); return Array.isArray(a) ? a.filter((x) => x && typeof x.id === 'string') : []; }
    catch (e) { return []; }
  }
  function writeIndex(meta) { lsSet(K.INDEX, JSON.stringify(meta)); }
  function load(id) {
    try { const raw = lsGet(K.EXP(id)); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function save(exp) {
    const v = validateExperiment(exp);
    if (!v.ok) throw new PXError('invalid-experiment', '实验数据非法：' + v.errors[0]);
    v.value.updatedAt = Date.now();
    const json = JSON.stringify(v.value);
    lsSet(K.EXP(v.value.id), json);   // 先写主体，再更新索引（索引坏可重建，主体不能）
    const meta = readIndex().filter((m) => m.id !== v.value.id);
    meta.unshift({ id: v.value.id, name: v.value.name, module: v.value.module, favorite: v.value.favorite, tags: v.value.tags, updatedAt: v.value.updatedAt });
    writeIndex(meta.slice(0, MAX_EXPERIMENTS));
    return v.value;
  }
  function rebuildIndex() {
    // 索引丢失/损坏时从主体键重建
    const meta = [];
    for (let i = 0; i < LS.length; i++) {
      const k = LS.key(i);
      if (k && k.startsWith(K.EXP(''))) {
        const e = load(k.slice(K.EXP('').length));
        if (e) meta.push({ id: e.id, name: e.name, module: e.module, favorite: e.favorite, tags: e.tags, updatedAt: e.updatedAt });
      }
    }
    meta.sort((a, b) => b.updatedAt - a.updatedAt);
    writeIndex(meta);
    return meta;
  }
  function list() {
    let meta = readIndex();
    if (!meta.length) meta = rebuildIndex();
    return meta.sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt);
  }
  function create({ name, module, state, tags }) {
    if (list().length >= MAX_EXPERIMENTS) throw new PXError('too-many', `实验最多保留 ${MAX_EXPERIMENTS} 个，请先删除旧实验`);
    const now = Date.now();
    const exp = normalize({
      name: (name || '').trim() || '未命名实验', module: module || 'sys',
      createdAt: now, updatedAt: now, tags: tags || [],
      moduleStates: state ? { [module || 'sys']: { savedAt: now, data: state } } : {}
    });
    return save(exp);
  }
  function remove(id) {
    try { LS.removeItem(K.EXP(id)); } catch (e) { }
    writeIndex(readIndex().filter((m) => m.id !== id));
  }
  function duplicate(id) {
    const src = load(id);
    if (!src) throw new PXError('not-found', '实验不存在');
    const now = Date.now();
    const copy = normalize({ ...JSON.parse(JSON.stringify(src)), id: uid(), name: (src.name + ' 副本').slice(0, 80), createdAt: now, updatedAt: now, favorite: false });
    return save(copy);
  }
  function patch(id, fields) {
    const e = load(id);
    if (!e) throw new PXError('not-found', '实验不存在');
    if (fields.name != null) e.name = String(fields.name).trim().slice(0, 80) || e.name;
    if (fields.favorite != null) e.favorite = fields.favorite === true;
    if (fields.tags != null) e.tags = fields.tags.slice(0, 10);
    if (fields.module != null) e.module = fields.module;
    if (fields.moduleStates != null) e.moduleStates = fields.moduleStates;
    return save(e);
  }
  /* 快照：深拷贝全部模块状态；restore 用快照覆盖 moduleStates */
  function addSnapshot(exp, label, moduleKey) {
    const now = Date.now();
    const snap = { id: uid(), label: String(label || ('快照 ' + new Date(now).toLocaleString())).slice(0, 60), ts: now, module: moduleKey || exp.module, state: JSON.parse(JSON.stringify(exp.moduleStates || {})) };
    exp.snapshots = [snap, ...(exp.snapshots || [])].slice(0, MAX_SNAPSHOTS);
    save(exp);
    return snap;
  }
  function restoreSnapshot(exp, snapId) {
    const s = (exp.snapshots || []).find((x) => x.id === snapId);
    if (!s) throw new PXError('not-found', '快照不存在');
    exp.moduleStates = JSON.parse(JSON.stringify(s.state));
    exp.module = s.module;
    return save(exp);
  }

  /* ---------- 导出 / 分享 ---------- */
  function exportJSON(exp) {
    const v = validateExperiment(exp);
    if (!v.ok) throw new PXError('invalid-experiment', '实验数据非法：' + v.errors[0]);
    return JSON.stringify({ kind: 'fltp-experiment', exportedAt: new Date().toISOString(), experiment: v.value }, null, 2);
  }
  function importJSON(str) {
    if (typeof str !== 'string' || !str.trim()) return { ok: false, error: { code: 'empty', message: '导入内容为空' } };
    if (str.length > MAX_JSON_BYTES) return { ok: false, error: { code: 'too-large', message: `文件超过 ${MAX_JSON_BYTES / 1024}KB 上限` } };
    let obj;
    try { obj = JSON.parse(str); } catch (e) { return { ok: false, error: { code: 'bad-json', message: '不是合法 JSON：' + e.message } }; }
    const raw = obj && typeof obj === 'object' && obj.experiment ? obj.experiment : obj;
    const m = migrate(raw);
    if (!m.ok) return m;
    const exp = normalize(m.value);
    const v = validateExperiment(exp);
    if (!v.ok) return { ok: false, error: { code: 'invalid', message: '实验数据非法：' + v.errors.join('；') } };
    return { ok: true, value: v.value, migrated: m.fromVersion !== SCHEMA_VERSION };
  }
  function encodeShare(exp) {
    const v = validateExperiment(exp);
    if (!v.ok) throw new PXError('invalid-experiment', '实验数据非法：' + v.errors[0]);
    const payload = b64uEnc(JSON.stringify(v.value));
    const code = 'PX1.' + payload + '.' + fnv1a(payload);
    if (code.length > MAX_SHARE_CHARS) throw new PXError('too-large', `分享码过长（${code.length} > ${MAX_SHARE_CHARS} 字符），请减少实验内容`);
    return code;
  }
  function decodeShare(str) {
    if (typeof str !== 'string') return { ok: false, error: { code: 'empty', message: '分享码为空' } };
    const parts = str.trim().split('.');
    if (parts.length !== 3 || parts[0] !== 'PX1') return { ok: false, error: { code: 'bad-format', message: '分享码格式不对（应为 PX1.<数据>.<校验>）' } };
    const [, payload, sum] = parts;
    if (fnv1a(payload) !== sum) return { ok: false, error: { code: 'bad-checksum', message: '分享码校验失败：内容已损坏或不完整' } };
    let json;
    try { json = b64uDec(payload); } catch (e) { return { ok: false, error: { code: 'bad-base64', message: '分享码数据段无法解码' } }; }
    let raw;
    try { raw = JSON.parse(json); } catch (e) { return { ok: false, error: { code: 'bad-json', message: '分享码内的数据不是合法 JSON' } }; }
    const m = migrate(raw);
    if (!m.ok) return m;
    const exp = normalize(m.value);
    const v = validateExperiment(exp);
    if (!v.ok) return { ok: false, error: { code: 'invalid', message: '分享的实验数据非法：' + v.errors.join('；') } };
    return { ok: true, value: v.value };
  }

  return {
    SCHEMA_VERSION, MAX_EXPERIMENTS, MAX_SNAPSHOTS, MAX_STATE_BYTES, MAX_SHARE_CHARS,
    setStorage, uid,
    validate: validateExperiment, normalize, migrate,
    list, load, save, create, remove, duplicate, patch,
    addSnapshot, restoreSnapshot,
    exportJSON, importJSON, encodeShare, decodeShare,
    _fnv1a: fnv1a, _b64uEnc: b64uEnc, _b64uDec: b64uDec, _deepSanitize: deepSanitize, _PXError: PXError
  };
})();
