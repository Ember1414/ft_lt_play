/* ============================================================
 * blocksolve.test.mjs — 框图求解内核回归断言（极简，无框架）
 *   运行：node tests/blocksolve.test.mjs
 *   覆盖：assets/js/lib/blocksolve.js（纯函数，不依赖 DOM）
 *   每个用例都写明拓扑，避免歧义。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIBS = [
  'assets/js/lib/util.js',
  'assets/js/lib/mathdsp.js',
  'assets/js/lib/fx.js',        // 复用 parseTF / parsePoly
  'assets/js/lib/blocksolve.js'
];
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of LIBS) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { BLKSOLVE } = sandbox;

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? '  → ' + extra : ''));
}
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const arrNear = (a, b, tol = 1e-6) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => near(v, b[i], tol));

// 拓扑构造小工具
const U1 = { n: [1], d: [1] };                                   // 单位传函（求和点/分支点）
const box = (id, n, d, extra = {}) => ({ id, kind: 'box', f: { n, d }, ...extra });
const sum = (id, extra = {}) => ({ id, kind: 'sum', f: { n: [1], d: [1] }, ...extra });
const br = (id, extra = {}) => ({ id, kind: 'branch', f: { n: [1], d: [1] }, ...extra });
const e = (from, to, sign = 1) => ({ from, to, sign });

/* ---------- parseBlockTF ---------- */
{
  const r = BLKSOLVE.parseBlockTF('1/(s+1)');
  ok('parseBlockTF 一阶', r.ok && arrNear(r.n, [1]) && arrNear(r.d, [1, 1]), JSON.stringify(r));

  // 零极点对消：(s+1)/((s+1)(s+2)) → 1/(s+2)
  const c = BLKSOLVE.parseBlockTF('(s+1)/((s+1)*(s+2))');
  ok('parseBlockTF 零极点对消', c.ok && arrNear(c.n, [1]) && arrNear(c.d, [1, 2]), JSON.stringify(c));

  // 非 monic 分母：2/(2s+1) → 1/(s+0.5)
  const m = BLKSOLVE.parseBlockTF('2/(2*s+1)');
  ok('parseBlockTF 分母归一化', m.ok && arrNear(m.n, [1]) && arrNear(m.d, [1, 0.5]), JSON.stringify(m));

  // 非法输入一律不抛异常
  const bad = ['', '1/0', '1/(s^2-s^2)', 's^2/(s+1)', '1/s/s', '((s+1)'];
  for (const s of bad) {
    let res, threw = false;
    try { res = BLKSOLVE.parseBlockTF(s); } catch (err) { threw = true; }
    ok('parseBlockTF 非法输入不抛异常且被拒：' + JSON.stringify(s),
      !threw && res && res.ok === false && typeof res.reason === 'string', threw ? 'threw' : JSON.stringify(res));
  }
  ok('parseBlockTF 非真分式给出明确原因',
    (BLKSOLVE.parseBlockTF('s^2/(s+1)') || {}).reason === '非真分式（分子阶次 > 分母阶次）',
    JSON.stringify(BLKSOLVE.parseBlockTF('s^2/(s+1)')));
}

/* ---------- solveTransfer ---------- */
{
  // ① 单位负反馈（教材拓扑，无自环）：R → Σ → G → Y，Y 以 −1 回到 Σ
  const r1 = BLKSOLVE.solveTransfer(
    [sum(1, { src: true }), box(2, [10], [1, 1], { out: true })],
    [e(1, 2, 1), e(2, 1, -1)]);
  ok('① 单位负反馈 10/(s+1) → 10/(s+11)',
    r1.ok && arrNear(r1.frac.n, [10]) && arrNear(r1.frac.d, [1, 11]),
    JSON.stringify(r1.frac || r1.note));

  // ② 串联：A → B，A 接 R，B 无出边（即输出）
  const r2 = BLKSOLVE.solveTransfer(
    [box(1, [1], [1, 1], { src: true }), box(2, [1], [1, 2])],
    [e(1, 2, 1)]);
  ok('② 串联 1/(s+1)·1/(s+2) → 1/(s²+3s+2)',
    r2.ok && arrNear(r2.frac.n, [1]) && arrNear(r2.frac.d, [1, 3, 2]),
    JSON.stringify(r2.frac || r2.note));

  // ③ 并联：同一个 sum 驱动两块，两块各自为汇点 → 求和
  const r3 = BLKSOLVE.solveTransfer(
    [sum(1, { src: true }), box(2, [1], [1, 1]), box(3, [1], [1, 2])],
    [e(1, 2, 1), e(1, 3, 1)]);
  ok('③ 并联 → (2s+3)/(s²+3s+2)',
    r3.ok && arrNear(r3.frac.n, [2, 3]) && arrNear(r3.frac.d, [1, 3, 2]),
    JSON.stringify(r3.frac || r3.note));

  // ④ 插入分支点与求和点不改变串联结果
  const r4 = BLKSOLVE.solveTransfer(
    [box(1, [1], [1, 1], { src: true }), br(2), box(3, [1], [1, 2]), sum(4)],
    [e(1, 2, 1), e(2, 3, 1), e(3, 4, 1)]);
  ok('④ 分支点/求和点不改变结果',
    r4.ok && arrNear(r4.frac.n, [1]) && arrNear(r4.frac.d, [1, 3, 2]),
    JSON.stringify(r4.frac || r4.note));

  // ⑤ 显式输出端子（纯反馈拓扑没有汇点，必须靠 out 标记）
  const r5 = BLKSOLVE.solveTransfer(
    [sum(1, { src: true }), box(2, [10], [1, 1])],
    [e(1, 2, 1), e(2, 1, -1)]);
  ok('⑤ 无输出端子且无汇点 → 明确报错而非静默 T=0',
    r5.ok === false && typeof r5.note === 'string' && r5.note.length > 0, JSON.stringify(r5));

  // ⑥ 无延迟代数环（单位增益自环 1−L=0）→ 无解
  const r6 = BLKSOLVE.solveTransfer([box(1, [1], [1])], [e(1, 1, 1)]);
  ok('⑥ 单位增益自环 → ok:false 且 note 非空',
    r6.ok === false && typeof r6.note === 'string' && r6.note.length > 0, JSON.stringify(r6));

  // ⑦ 正反馈：R → Σ → G，Y 以 +1 回到 Σ → G/(1−G)
  const r7 = BLKSOLVE.solveTransfer(
    [sum(1, { src: true }), box(2, [1], [1, 1], { out: true })],
    [e(1, 2, 1), e(2, 1, 1)]);
  ok('⑦ 正反馈 1/(s+1) → 1/s',
    r7.ok && arrNear(r7.frac.n, [1]) && arrNear(r7.frac.d, [1, 0]), JSON.stringify(r7.frac || r7.note));

  // ⑧ 空图 / 非法块被过滤
  const r8 = BLKSOLVE.solveTransfer([], []);
  ok('⑧ 空图 → ok:false', r8.ok === false && !!r8.note, JSON.stringify(r8));
}

/* ---------- deriveReadout ---------- */
{
  const nodes = [sum(1, { src: true }), box(2, [10], [1, 1], { out: true })];
  const edges = [e(1, 2, 1), e(2, 1, -1)];
  const s = BLKSOLVE.solveTransfer(nodes, edges);
  const d = BLKSOLVE.deriveReadout(s.frac);
  ok('deriveReadout 阶次', d.order === 1, JSON.stringify(d.order));
  ok('deriveReadout 极点 −11', d.poles.length === 1 && near(d.poles[0].re, -11, 1e-3), JSON.stringify(d.poles));
  ok('deriveReadout 判稳', d.stable === true && d.hasRhp === false && d.hasJw === false, JSON.stringify(d));

  const s2 = BLKSOLVE.solveTransfer([box(1, [1], [1, 1], { src: true }), box(2, [1], [1, 2])], [e(1, 2, 1)]);
  const d2 = BLKSOLVE.deriveReadout(s2.frac);
  ok('deriveReadout 二阶复极点缺省为实极点', d2.order === 2 && d2.stable === true && d2.poles.length === 2,
    JSON.stringify(d2.poles));
}

/* ---------- 结果输出 ---------- */
console.log('\n通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (fails.length) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('✓ 全部断言通过');
}
