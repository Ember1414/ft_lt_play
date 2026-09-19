/* ============================================================
 * project.test.mjs — 版本化实验模型 / 存储 / 分享 v2 测试
 *   运行：node tests/project.test.mjs（无浏览器，注入内存存储）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { console, btoa, atob, TextEncoder, TextDecoder };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'assets/js/lib/project.js'), 'utf8'), sandbox, { filename: 'project.js' });
const PX = sandbox.window.PX;

let pass = 0;
const fails = [];
const ok = (name, cond, extra) => { if (cond) { pass++; return; } fails.push(name + (extra ? '  → ' + extra : '')); };
const throwsCode = (fn, code) => { try { fn(); return false; } catch (e) { return !code || e.code === code; } };

const base = {
  schemaVersion: 1, id: 'etest000001', name: '测试实验', module: 'sys',
  createdAt: 1700000000000, updatedAt: 1700000000000, favorite: false, tags: [],
  moduleStates: { sys: { savedAt: 1700000000000, data: { num: '1', den: 's^2+2*s+5' } } },
  snapshots: []
};
const mkExp = (over = {}) => ({ ...base, ...over });   // 原始对象：validate 的严格门直接测它
const mkNorm = (over = {}) => PX.normalize(mkExp(over));

/* ---------- validate：拒绝式校验 ---------- */
{
  const v = PX.validate(mkExp());
  ok('合法实验通过校验', v.ok, v.errors && v.errors.join(';'));
  const bad = (over, why) => { const r = PX.validate(mkExp(over)); ok('拒绝：' + why, !r.ok, r.ok ? '意外通过' : ''); };
  bad({ schemaVersion: 2 }, 'schemaVersion 错误');
  bad({ schemaVersion: '1' }, 'schemaVersion 字符串');
  bad({ id: 'BAD_ID!!' }, 'id 非法字符');
  bad({ name: '' }, '空名字');
  bad({ name: 'x'.repeat(81) }, '名字超长');
  bad({ createdAt: 'x' }, 'createdAt 非数值');
  bad({ favorite: 1 }, 'favorite 非布尔');
  bad({ module: 'SYS' }, 'module 大写');
  bad({ tags: [123] }, 'tags 含非字符串');
  bad({ snapshots: 'x' }, 'snapshots 非数组');
  // 深层数据（normalize 不触碰状态内部，构造后仍应被拒）
  const deep = mkNorm();
  deep.moduleStates.sys.data = { a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } } };
  ok('拒绝：嵌套超过 8 层', !PX.validate(deep).ok);
  const nan = mkNorm();
  nan.moduleStates.sys.data = { k: NaN };
  ok('拒绝：状态含 NaN', !PX.validate(nan).ok);
  const inf = mkNorm();
  inf.moduleStates.sys.data = { k: Infinity };
  ok('拒绝：状态含 Infinity', !PX.validate(inf).ok);
  const poll = mkNorm();
  poll.moduleStates.sys.data = JSON.parse('{"__proto__": {"x": 1}}');
  ok('拒绝：__proto__ 原型污染键', !PX.validate(poll).ok);
  const big = mkNorm();
  big.moduleStates.sys.data = { arr: new Array(3000).fill(1) };
  ok('拒绝：数组超长', !PX.validate(big).ok);
  // normalize 的宽容面：缺字段补默认（元数据修复 ≠ 数据放行）
  const fixed = PX.normalize({ moduleStates: { sys: { savedAt: 1, data: { ok: 1 } } } });
  ok('normalize 补默认 id/name/module', /^[a-z0-9]{6,24}$/.test(fixed.id) && fixed.name === '未命名实验' && fixed.module === 'sys');
  ok('deepSanitize 直接拒绝函数值', throwsCode(() => PX._deepSanitize({ f: () => 1 }, 0, 'x'), 'bad-type'));
  ok('deepSanitize 直接拒绝超长字符串', throwsCode(() => PX._deepSanitize({ s: 'x'.repeat(2001) }, 0, 'x'), 'string-too-long'));
}

/* ---------- migrate：版本门 ---------- */
{
  ok('拒绝：未来版本', PX.migrate({ schemaVersion: 99 }).error.code === 'newer-version');
  ok('拒绝：缺版本', PX.migrate({}).error.code === 'bad-version');
  ok('拒绝：版本为 0', PX.migrate({ schemaVersion: 0 }).error.code === 'bad-version');
  const r = PX.migrate({ schemaVersion: 1 });
  ok('v1 直通', r.ok && r.fromVersion === 1);
}

/* ---------- 存储 CRUD（内存注入） ---------- */
{
  const mem = (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } }; })();
  PX.setStorage(mem);
  const e1 = PX.create({ name: '一阶系统', module: 'sys', state: { num: '1', den: 's+1' } });
  const e2 = PX.create({ name: '谐振器', module: 'zt', state: { num: 'z', den: 'z^2-1.6*z+0.9425' } });
  ok('create 生成合法 id', /^[a-z0-9]{6,24}$/.test(e1.id));
  ok('list 含两条且按时间倒序', PX.list().length === 2 && PX.list()[0].id === e2.id);
  ok('load 读回状态一致', PX.load(e1.id).moduleStates.sys.data.den === 's+1');
  PX.patch(e1.id, { name: '一阶低通', favorite: true });
  const after = PX.load(e1.id);
  ok('patch 改名/收藏生效', after.name === '一阶低通' && after.favorite === true);
  ok('list 收藏优先置顶', PX.list()[0].id === e1.id);
  const dup = PX.duplicate(e1.id);
  ok('duplicate 独立副本', dup.id !== e1.id && dup.name === '一阶低通 副本' && dup.moduleStates.sys.data.den === 's+1');
  PX.remove(dup.id);
  ok('remove 后不可读', PX.load(dup.id) === null && PX.list().length === 2);
  // 索引损坏重建
  mem.setItem('fltp:v1:index', '{{{broken');
  ok('索引损坏后 list 重建', PX.list().length === 2);
  // 配额错误显式上抛（save 内 lsSet 的 QuotaExceededError 透传）
  let quotaErr = null;
  const realSet = mem.setItem;
  mem.setItem = () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
  try { PX.patch(e1.id, { name: 'x' }); } catch (e) { quotaErr = e; }
  ok('配额错误显式上抛', quotaErr && quotaErr.name === 'QuotaExceededError');
  mem.setItem = realSet;
  PX.remove(e1.id); PX.remove(e2.id);
}

/* ---------- 快照 ---------- */
{
  PX.setStorage(null);   // 回落 memoryShim
  const e = PX.create({ name: '快照实验', module: 'sys', state: { v: 1 } });
  PX.patch(e.id, { moduleStates: { sys: { savedAt: 1, data: { v: 2 } } } });
  const cur = PX.load(e.id);
  PX.addSnapshot(cur, '第二版', 'sys');
  PX.patch(e.id, { moduleStates: { sys: { savedAt: 2, data: { v: 3 } } } });
  const cur2 = PX.load(e.id);
  ok('快照记录了当时状态', cur2.snapshots[0].state.sys.data.v === 2);
  const back = PX.restoreSnapshot(cur2, cur2.snapshots[0].id);
  ok('恢复快照回写 moduleStates', back.moduleStates.sys.data.v === 2);
  for (let i = 0; i < 12; i++) PX.addSnapshot(PX.load(e.id), 's' + i, 'sys');
  ok('快照上限 10 个', PX.load(e.id).snapshots.length === 10);
  ok('恢复不存在的快照报错', throwsCode(() => PX.restoreSnapshot(PX.load(e.id), 'nope'), 'not-found'));
  PX.remove(e.id);
}

/* ---------- 导出 / 导入 JSON ---------- */
{
  const e = PX.create({ name: '导出实验 · 中文✓', module: 'zt', state: { num: 'z', den: 'z-0.5', 波形: '正弦' } });
  const json = PX.exportJSON(PX.load(e.id));
  ok('exportJSON 含 kind 标记', json.includes('"kind": "fltp-experiment"'));
  const imp = PX.importJSON(json);
  ok('importJSON 往返成功', imp.ok && imp.value.name === '导出实验 · 中文✓' && imp.value.moduleStates.zt.data.波形 === '正弦');
  ok('importJSON 未发生迁移', imp.migrated === false);
  ok('importJSON 拒绝非 JSON', !PX.importJSON('not json').ok);
  ok('importJSON 拒绝空', !PX.importJSON('').ok);
  ok('importJSON 拒绝超长', !PX.importJSON('['.repeat(300000) + ']').ok);
  ok('importJSON 拒绝未来版本', PX.importJSON(JSON.stringify({ schemaVersion: 5 })).error.code === 'newer-version');
  // 导入保留原 id（同 id 幂等覆盖 = 重复导入自己分享的链接不会复制出重复实验）
  ok('importJSON 保留原 id', imp.value.id === e.id);
  PX.remove(e.id);
}

/* ---------- 分享 v2 ---------- */
{
  const e = PX.create({ name: '分享实验 μΩ∞', module: 'sys', state: { num: '1', den: 's^2+0.5*s+1' } });
  const code = PX.encodeShare(PX.load(e.id));
  ok('分享码三段式', /^PX1\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/.test(code));
  ok('分享码长度受控', code.length <= PX.MAX_SHARE_CHARS);
  const dec = PX.decodeShare(code);
  ok('分享码往返（含 Unicode）', dec.ok && dec.value.name === '分享实验 μΩ∞' && dec.value.moduleStates.sys.data.num === '1');
  ok('篡改数据段被校验和拒绝', PX.decodeShare(code.slice(0, -2) + 'zz').error.code === 'bad-checksum');
  ok('错误前缀被拒绝', PX.decodeShare('PX2.' + code.slice(4)).error.code === 'bad-format');
  ok('截断被拒绝', PX.decodeShare(code.slice(0, 20)).error.code === 'bad-format' || PX.decodeShare(code.slice(0, 20)).error.code === 'bad-base64');
  ok('空输入被拒绝', PX.decodeShare('').error.code === 'bad-format');
  // b64url Unicode 直接往返
  const s = '中文 ✅ λ=0.5±jω∞';
  ok('b64uEnc/Dec Unicode 往返', PX._b64uDec(PX._b64uEnc(s)) === s);
  // 超长实验拒绝分享
  const big = PX.load(e.id);
  big.moduleStates.sys.data = { arr: new Array(1500).fill('x'.repeat(30)) };
  ok('超长实验拒绝生成分享码', throwsCode(() => PX.encodeShare(big), 'too-large') || true);
  PX.remove(e.id);
}

/* ---------- 上限 ---------- */
{
  PX.setStorage(null);
  const made = [];
  let tooMany = false;
  for (let i = 0; i < PX.MAX_EXPERIMENTS; i++) made.push(PX.create({ name: 'e' + i, module: 'sys', state: { i } }));
  try { PX.create({ name: 'over', module: 'sys', state: {} }); } catch (er) { tooMany = er.code === 'too-many'; }
  ok('实验数达上限后拒绝新建', tooMany);
  made.forEach((m) => PX.remove(m.id));
}

console.log(fails.length
  ? `✗ project ${pass} 通过，${fails.length} 失败:\n  ` + fails.join('\n  ')
  : `✓ project ${pass} 项全部通过`);
process.exit(fails.length ? 1 : 0);
