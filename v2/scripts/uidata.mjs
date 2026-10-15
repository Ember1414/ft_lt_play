/* ============================================================
 * uidata.mjs — UI **数据层**断言（M13：把 M9/M10/M12 的临时断言并入 CI）
 *
 * 定位：parity.mjs 与 audit.mjs 只覆盖**内核**（`src/core`，DOM-free 可直接 import）。
 *   本脚本覆盖内核之外的三处数据逻辑：
 *     ① 剧本库编解码（M9）：`src/state/theater.ts` —— 分享码往返 / 篡改检出 / 结构与长度校验 / 增删查
 *     ② 备份数据通路（M10）：`src/report/backup.ts` —— 打包解析 / 旧包兼容 / 逐项校验与幂等覆盖
 *     ③ 参数表规则（M12）：`src/state/params.ts` —— 可调键（标量并集）/ 控件分派 / 数值步长
 *   这些模块依赖 localStorage（与极少数浏览器全局），故统一用 esbuild 打包为 ESM，
 *   在 Node 里以**桩替身**（localStorage 内存实现）运行；只调用不触 DOM 的纯数据路径。
 *
 * 运行：node scripts/uidata.mjs   （或 npm run uidata）
 * ============================================================ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const v2Root = path.resolve(here, '..');

/* ---------- 0) 环境桩：localStorage（内存实现） ---------- */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};

/* ---------- 1) 打包并导入被测模块 ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-v2-uidata-'));
async function bundleModule(entry, rel) {
  const out = path.join(tmp, rel);
  await build({
    entryPoints: [path.join(v2Root, entry)],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    outfile: out,
    logLevel: 'silent',
  });
  return import(pathToFileURL(out).href);
}

const T = await bundleModule('src/state/theater.ts', 'theater.mjs');
const B = await bundleModule('src/report/backup.ts', 'backup.mjs');
const P = await bundleModule('src/state/params.ts', 'params.mjs');
const AB = await bundleModule('src/state/ab.ts', 'ab.mjs');
const CV = await bundleModule('src/chart/canvas.ts', 'canvas.mjs');

/* ---------- 2) 断言小工具 ---------- */
let pass = 0;
const fails = [];
/** 记录一条断言（失败项带分组名与说明） */
function ok(group, cond, label) {
  if (cond) pass++;
  else fails.push(`[${group}] ${label}`);
}
const eqJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ============================================================
 * ① 剧本库编解码（M9）
 * ============================================================ */
{
  const G = 'M9·剧本库';
  const sA = { id: 'u-aa0001', name: '剧本甲', blurb: '甲', steps: [{ toolId: 'ft', params: { view: 'harmonics', terms: 3 }, dwell: 1500, caption: '甲一' }] };
  const sB = {
    id: 'u-bb0002',
    name: '剧本乙',
    blurb: '乙',
    steps: [
      { toolId: 'sys', params: {}, dwell: 2000, caption: '乙一' },
      { toolId: 'comm', params: { view: 'eye' }, dwell: 2000, caption: '乙二' },
    ],
  };
  const sample = {
    id: 'u-abc123',
    name: '冒烟剧本',
    blurb: '用来验证编解码',
    steps: [
      { toolId: 'ft', params: { view: 'harmonics', terms: 3 }, dwell: 1500, caption: '第一步旁白' },
      { toolId: 'fourier', params: { view: 'conv' }, dwell: 1500, caption: '第二步旁白' },
    ],
  };

  /* 分享码往返 */
  const code = T.encodeScript(sample);
  ok(G, code.startsWith('TS1.'), '分享码前缀为 TS1.');
  ok(G, code.split('.').length === 3, '三段结构 <前缀>.<数据>.<校验>');
  const dec = T.decodeScript(code);
  ok(G, dec.ok === true, '解码成功');
  if (dec.ok) {
    ok(G, dec.value.name === sample.name && dec.value.blurb === sample.blurb, '名称 / 简介一致');
    ok(G, dec.value.id === sample.id, '自建 id 保留（u-abc123）');
    ok(G, eqJSON(dec.value.steps, sample.steps), '步骤逐字段一致');
  }

  /* JSON 文件通道往返 */
  const imp = T.importScriptText(T.scriptToJSON(sample));
  ok(G, imp.ok === true && eqJSON(imp.value.steps, sample.steps), '.json 文本通道往返一致');

  /* 错误路径必须给出具体原因 */
  const tampered = code.slice(0, -1) + (code.slice(-1) === '0' ? '1' : '0');
  const r1 = T.decodeScript(tampered);
  ok(G, r1.ok === false && /校验失败/.test(r1.message), '篡改一位 → 校验失败：' + (r1.ok ? '' : r1.message));
  const r2 = T.decodeScript('PK1.eyJhIjoxfQ.abc123');
  ok(G, r2.ok === false && /格式/.test(r2.message), '错前缀 → 格式提示：' + (r2.ok ? '' : r2.message));
  const r3 = T.importScriptText('既不是码也不是 JSON');
  ok(G, r3.ok === false && /JSON/.test(r3.message), '非码非 JSON → 具体提示：' + (r3.ok ? '' : r3.message));
  const r4 = T.importScriptText('');
  ok(G, r4.ok === false && /可导入/.test(r4.message), '空输入 → 具体提示：' + (r4.ok ? '' : r4.message));

  /* 内置 id 不得被分享码「洗白」为内置 */
  const d2 = T.decodeScript(
    T.encodeScript({ id: 't-sq', name: '副本', blurb: '', steps: [{ toolId: 'ft', params: {}, dwell: 2000, caption: '' }] }),
  );
  ok(G, d2.ok === true && /^u-/.test(d2.value.id), '内置 id 解码后重新分配为自建 id：' + (d2.ok ? d2.value.id : ''));

  /* 结构校验与兜底 */
  ok(G, T.saveUserScript({ name: '', steps: [] }).ok === false, '无名称 → 拒绝保存');
  ok(G, T.saveUserScript({ name: 'x', steps: [] }).ok === false, '无步骤 → 拒绝保存');
  const sd = T.saveUserScript({
    name: '脏数据',
    blurb: '',
    steps: [
      { toolId: '', params: {}, dwell: 1, caption: '' },
      { toolId: 'sys', params: {}, dwell: 1, caption: '' },
    ],
  });
  ok(G, sd.ok === true && sd.value.steps.length === 1, '空 toolId 步被丢弃，只留有效步');
  if (sd.ok) ok(G, sd.value.steps[0].dwell === 300, 'dwell 越界（1ms）→ 夹到 300ms');
  ok(
    G,
    T.saveUserScript({ name: 'y', steps: [{ toolId: 'sys', params: { big: 'x'.repeat(9000) }, dwell: 3000, caption: '' }] }).ok === true,
    '超限参数被丢弃但仍可保存',
  );

  /* 增删查与计数 */
  for (const s of T.getUserScripts()) T.deleteUserScript(s.id);
  ok(G, T.getUserScripts().length === 0, '清场后自建为空');
  const before = T.getAllScripts().length;
  const sv = T.saveUserScript(sample);
  ok(G, sv.ok === true, '保存自建剧本成功');
  ok(G, T.getAllScripts().length === before + 1, 'getAllScripts = 内置 + 自建');
  ok(G, T.getUserScripts().length === 1, 'getUserScripts 计数为 1');
  ok(G, T.isUserScript(sample.id) === true, 'isUserScript 命中');
  ok(G, T.getScript(sample.id)?.name === sample.name, 'getScript 能查到自建剧本');
  T.deleteUserScript(sample.id);
  ok(G, T.getUserScripts().length === 0, '删除后自建清空');
  ok(G, T.getScript('t-sq')?.name === '方波的诞生', '内置剧本仍可查');
  T.clearUserScripts();
  ok(G, T.getScript('t-sq') != null && T.getUserScripts().length === 0, 'clearUserScripts 只清自建');

  /* 分享码长度上限 */
  const huge = { id: 'u-big', name: '大剧本', blurb: '', steps: [] };
  for (let i = 0; i < 40; i++) huge.steps.push({ toolId: 'ft', params: { pad: 'x'.repeat(300), i }, dwell: 3000, caption: 'y'.repeat(150) });
  let threw = null;
  try {
    T.encodeScript(huge);
  } catch (e) {
    threw = e;
  }
  ok(G, threw != null && threw.code === 'too-large', '超长分享码抛 too-large');
}

/* ============================================================
 * ② 备份数据通路（M10）
 * ============================================================ */
{
  const G = 'M10·备份';
  const sA = { id: 'u-aa0001', name: '剧本甲', blurb: '甲', steps: [{ toolId: 'ft', params: { view: 'harmonics', terms: 3 }, dwell: 1500, caption: '甲一' }] };
  const sB = {
    id: 'u-bb0002',
    name: '剧本乙',
    blurb: '乙',
    steps: [
      { toolId: 'sys', params: {}, dwell: 2000, caption: '乙一' },
      { toolId: 'comm', params: { view: 'eye' }, dwell: 2000, caption: '乙二' },
    ],
  };
  const fakeExp = { id: 'e000001', name: '实验一', module: 'sys' };

  /* 打包 → JSON → 解析 */
  const bundle = B.buildBackup([fakeExp], [sA, sB], 'uidata');
  ok(G, bundle.kind === 'fltp-backup', 'kind = fltp-backup');
  ok(G, bundle.count === 1 && bundle.experiments.length === 1, '实验计数 / 数组一致');
  ok(G, bundle.theaterCount === 2 && bundle.theaterScripts.length === 2, '剧本计数 / 数组一致');
  ok(G, typeof bundle.exportedAt === 'string' && bundle.exportedAt.includes('T'), 'exportedAt 为 ISO 时间戳');
  const r1 = B.readBackup(JSON.stringify(bundle, null, 2));
  ok(G, r1.ok === true, '解析成功');
  if (r1.ok) {
    ok(G, r1.experiments.length === 1, '解析出 1 个实验');
    ok(G, r1.theaterScripts !== null && r1.theaterScripts.length === 2, '解析出 2 部剧本');
    ok(G, eqJSON(r1.theaterScripts, [sA, sB]), '剧本内容逐字段一致');
  }

  /* 兼容旧备份与历史单实验文件 */
  const legacy = B.readBackup(JSON.stringify({ kind: 'fltp-backup', schema: 1, version: '2.0.0', count: 1, experiments: [fakeExp] }));
  ok(G, legacy.ok === true && legacy.theaterScripts === null, '旧备份无 theaterScripts → null（只恢复实验）');
  const single = B.readBackup(JSON.stringify(fakeExp));
  ok(G, single.ok === true && single.experiments.length === 1 && single.theaterScripts === null, '历史单实验文件 → 按 [root] 处理');
  const bad = B.readBackup('{oops');
  ok(G, bad.ok === false && bad.error === '不是合法 JSON 文件', '非法 JSON → 具体原因：' + (bad.ok ? '' : bad.error));

  /* 剧本恢复合成：saveUserScript 幂等覆盖 + 逐项计数 */
  T.clearUserScripts();
  let sok = 0;
  let sbad = 0;
  let sovr = 0;
  for (const sc of r1.theaterScripts) {
    const existed = T.isUserScript(sc.id);
    const r = T.saveUserScript(sc);
    if (r.ok) {
      sok++;
      if (existed) sovr++;
    } else sbad++;
  }
  ok(G, sok === 2 && sbad === 0 && sovr === 0, '首次导入：成功 2 / 失败 0 / 覆盖 0');
  ok(G, T.getUserScripts().length === 2, '导入后自建剧本数 = 2');
  ok(G, T.getScript('u-aa0001')?.steps[0]?.caption === '甲一', '内容落地正确（甲一）');
  sovr = 0;
  for (const sc of r1.theaterScripts) {
    const existed = T.isUserScript(sc.id);
    const r = T.saveUserScript(sc);
    if (r.ok && existed) sovr++;
  }
  ok(G, sovr === 2 && T.getUserScripts().length === 2, '重复导入 → 覆盖 2 部且数量不变（幂等）');

  /* 包内非法项被拒并计数，不影响合法项 */
  const mixed = B.readBackup(JSON.stringify({ experiments: [], theaterScripts: [null, { name: '', steps: [] }, sA] }));
  ok(G, mixed.ok === true && mixed.theaterScripts.length === 3, '解析不做项内校验（3 项原样交出）');
  let mok = 0;
  let mbad = 0;
  for (const sc of mixed.theaterScripts) {
    if (T.saveUserScript(sc).ok) mok++;
    else mbad++;
  }
  ok(G, mok === 1 && mbad === 2, '调用方校验：成功 1 / 失败 2（null 与空名称被拒）');
  T.clearUserScripts();
}

/* ============================================================
 * ③ 参数表规则（M12）
 * ============================================================ */
{
  const G = 'M12·参数表';
  /* 控件分派 */
  ok(G, P.paramKind(3) === 'number' && P.paramKind(-0.5) === 'number', '有限数 → number');
  ok(G, P.paramKind(NaN) === 'none' && P.paramKind(Infinity) === 'none', 'NaN / Infinity → 不可调（none）');
  ok(G, P.paramKind(true) === 'boolean' && P.paramKind(false) === 'boolean', '布尔 → boolean');
  ok(G, P.paramKind('nyquist') === 'string' && P.paramKind('') === 'string', '字符串（含枚举 / 表达式）→ string');
  ok(G, P.paramKind(null) === 'none' && P.paramKind(undefined) === 'none', 'null / undefined → none');
  ok(G, P.paramKind({}) === 'none' && P.paramKind([]) === 'none', '对象 / 数组 → none（留在工具页内编辑）');

  /* 可调键并集 */
  const keys = P.scalarKeys([
    { expr: '1/(s+1)', K: 1, view: 'bode' },
    { expr: '1/(s+3)', K: 5, view: 'nyquist', extra: true, items: [{ a: 1 }], nil: null, bad: NaN },
  ]);
  ok(G, eqJSON(keys, ['K', 'expr', 'extra', 'view']), '标量键并集 + 字典序排序：' + JSON.stringify(keys));
  ok(G, !keys.includes('items') && !keys.includes('nil') && !keys.includes('bad'), '对象 / null / NaN 键被排除');
  ok(G, eqJSON(P.scalarKeys([null, undefined, {}]), []), '空 / 缺参对象 → 空表');
  ok(G, eqJSON(P.scalarKeys([{ b: 1 }, { a: 2 }]), ['a', 'b']), '跨对象合并（两侧形态不同）');

  /* 数值步长（按量级） */
  const stepCases = [
    [1000, 1, 1],
    [120, 1, 1],
    [12, 0.1, 2],
    [3, 0.01, 3],
    [0.3, 0.001, 4],
    [0.03, 0.0001, 5],
    [-7.5, 0.01, 3],
  ];
  for (const [v, wantStep, wantPrec] of stepCases) {
    const s = P.stepForValue(v);
    ok(G, s.step === wantStep && s.precision === wantPrec, `stepForValue(${v}) = ${wantStep}/${wantPrec}（实得 ${s.step}/${s.precision}）`);
  }
}

/* ============================================================
 * ④ 指标对照规则（M16）：metricDiff / fmtMetricVal
 *     ——对比页「参数差异表」「实例自报指标表」与「槽指标对比表」共用同一对纯函数
 * ============================================================ */
{
  const G = 'M16·指标对照';
  const ma = [
    { label: '相位裕度', value: 51.8, unit: '°', precision: 1 },
    { label: '穿越频率', value: 1.2, unit: 'rad/s', precision: 2 },
    { label: '状态', value: 'ok' },
  ];
  const mb = [
    { label: '相位裕度', value: 63.2, unit: '°', precision: 1 },
    { label: '带宽', value: 2.4, unit: 'rad/s', precision: 2 },
    { label: '状态', value: 'warn' },
  ];
  const rows = AB.metricDiff(ma, mb);
  ok(G, eqJSON(rows.map((r) => r.label), ['相位裕度', '穿越频率', '状态', '带宽']), '行序 = A 标签顺序 + B 独有标签：' + JSON.stringify(rows.map((r) => r.label)));
  const rMg = rows[0];
  ok(G, rMg.a?.value === 51.8 && rMg.b?.value === 63.2 && Math.abs(rMg.delta - 11.4) < 1e-9, '两侧数值 + 差 = B−A（相位裕度 +11.4）');
  ok(G, rMg.unit === '°', '单位取 A 侧');
  const rCf = rows[1];
  ok(G, rCf.a?.value === 1.2 && rCf.b === null && rCf.delta === null, 'B 侧缺失 → 该列 —、差为 null');
  const rState = rows[2];
  ok(G, rState.a?.value === 'ok' && rState.b?.value === 'warn' && rState.delta === null, '非数值（字符串）→ 两列仍显示、差为 null');
  const rBw = rows[3];
  ok(G, rBw.a === null && rBw.b?.value === 2.4 && rBw.delta === null, 'A 侧缺失 → 差为 null（不臆造 0）');
  ok(G, AB.metricDiff([], []).length === 0, '两侧皆空 → 空表');
  ok(G, AB.metricDiff([{ label: 'x', value: 1 }], [{ label: 'x', value: 1 }])[0].delta === 0, '同值 → 差为 0（不显示为 null）');
  // 单位回退：A 侧无 unit 时取 B 侧
  ok(G, AB.metricDiff([{ label: 'u', value: 1 }], [{ label: 'u', value: 2, unit: 'V' }])[0].unit === 'V', 'A 无 unit → 回退 B 侧');

  /* 显示格式化 */
  ok(G, AB.fmtMetricVal(null) === '—', 'fmtMetricVal(null) = —');
  ok(G, AB.fmtMetricVal({ label: 'x', value: 51.84, precision: 1 }) === '51.8', '有 precision → 按位显示');
  ok(G, AB.fmtMetricVal({ label: 'x', value: 3 }) === '3', '无 precision → 原样显示');
  ok(G, AB.fmtMetricVal({ label: 'x', value: 'stable' }) === 'stable', '字符串值原样显示');
}

/* ============================================================
 * ⑤ 坐标图刻度与缩放规则（M18）：fmtTickAt（步长自适应）/ clampSpan（跨度保护）
 *    ——所有 13 个工具的坐标图共用同一套；锁定「缩放后刻度不重复、跨度不退化」
 * ============================================================ */
{
  const G = 'M18·坐标图';
  /* 步长自适应：相邻两个刻度（相差一个步长）的标签必须不同 */
  const cases = [
    [0.3, 0.002],
    [1, 0.5],
    [0, 2],
    [12.5, 0.02],
    [1e6, 20],
    [1e-5, 2e-6],
  ];
  for (const [v, step] of cases) {
    const a = CV.fmtTickAt(v, step);
    const b = CV.fmtTickAt(v + step, step);
    ok(G, a !== b, `相邻刻度可区分：step=${step} → "${a}" ≠ "${b}"`);
  }
  /* 复现旧缺陷并验证新法：深缩放下固定 4 位有效会重复，步长自适应不重复 */
  const deep = [0.3000002, 0.3000004, 0.3000006];
  const oldLabels = deep.map((v) => CV.fmtTick(v));
  const newLabels = deep.map((v) => CV.fmtTickAt(v, 2e-7));
  ok(G, new Set(oldLabels).size === 1, '旧法在深缩放下重复（' + oldLabels.join(' / ') + '）');
  ok(G, new Set(newLabels).size === 3, '新法在深缩放下仍可区分：' + newLabels.join(' / '));
  /* 边界与回退 */
  ok(G, CV.fmtTickAt(0, 0.1) === '0', 'v=0 → "0"');
  ok(G, CV.fmtTickAt(1.5) === CV.fmtTick(1.5), '未给步长 → 回退 fmtTick（悬停读数同口径）');
  ok(G, CV.fmtTickAt(1.5, 0) === CV.fmtTick(1.5), '步长 0 → 回退 fmtTick（不抛错）');
  ok(G, /e/.test(CV.fmtTickAt(2e6, 1000)), '大数走指数表示');
  /* 跨度保护：既不限制正常缩放，也杜绝退化 */
  const rBig = CV.clampSpan([0, 1e9], [0, 2]);
  ok(G, Math.abs(rBig[1] - rBig[0] - 2e6) < 1e-3, '过度放大 → 跨度夹到基准 1e6 倍');
  const rTiny = CV.clampSpan([0.5, 0.5], [0, 2]);
  ok(G, Math.abs(rTiny[1] - rTiny[0] - 2e-6) < 1e-12 && Math.abs((rTiny[0] + rTiny[1]) / 2 - 0.5) < 1e-9, '过度缩小（跨度塌陷为 0）→ 夹到基准 1e-6 倍且保留中心');
  const rNan = CV.clampSpan([NaN, NaN], [0, 2]);
  ok(G, rNan[0] === 0 && rNan[1] === 2, '非法区间（NaN）→ 回退基准范围');
  const rOk = CV.clampSpan([0.2, 0.8], [0, 2]);
  ok(G, Math.abs(rOk[0] - 0.2) < 1e-12 && Math.abs(rOk[1] - 0.8) < 1e-12, '正常区间原样返回（不干扰缩放）');
}

/* ---------- 4) 汇总 ---------- */
const total = pass + fails.length;
console.log(`\nUI 数据层断言：${pass}/${total} 条通过`);
console.log('  ① 剧本库编解码（M9）· ② 备份数据通路（M10）· ③ 参数表规则（M12）· ④ 指标对照规则（M16）· ⑤ 坐标图刻度与缩放规则（M18）');
if (fails.length) {
  console.log('\n失败明细：');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('M9 / M10 / M12 / M16 / M18 的 UI 数据层行为已锁定为可回归断言\n');
}
