/* ============================================================
 * blk-dom-contract.test.mjs — 系统框图模块的 DOM 契约检查
 *   运行：node tests/blk-dom-contract.test.mjs
 *
 *   模块是 SVG 编辑器，最大的运行期风险不是数学而是"选择器打错"：
 *   引用了不存在的 id / 读了从未写出的 data-*，都会在某个分支才炸。
 *   这里做静态交叉核对（不启动浏览器）：
 *     ① 所有 $('#blk-x') / byId('-x') / getElementById('blk-x') 引用的 id
 *        都能在模块自身的 innerHTML 模板里找到；
 *     ② 所有 closest('[data-*]') / dataset.xxx 读取的 data-* 都确实被写出；
 *     ③ 反过来，写出的 data-* 也都被读到（防死属性）。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'assets/js/modules/blockdiag.js';
const src = fs.readFileSync(path.join(root, FILE), 'utf8');

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? '  → ' + extra : ''));
}

/* ---------- ① id 契约 ---------- */
const defined = new Set([...src.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const used = new Set();
for (const m of src.matchAll(/\$\('#([^']+)'\)/g)) used.add(m[1]);
for (const m of src.matchAll(/byId\('([^']+)'\)/g)) used.add('blk' + m[1]);
for (const m of src.matchAll(/getElementById\('([^']+)'\)/g)) used.add(m[1]);

const missingIds = [...used].filter((id) => !defined.has(id));
ok('所有引用的 id 都有定义', missingIds.length === 0, '未定义：' + missingIds.join(', '));

const unusedIds = [...defined].filter((id) => !used.has(id));
ok('模板里没有从未引用的 id（允许画布内 SVG id）', unusedIds.every((id) => id.startsWith('blk-')),
  '可疑：' + unusedIds.join(', '));

/* ---------- ② / ③ data-* 契约 ---------- */
const dataWritten = new Set([...src.matchAll(/\b(data-[a-z0-9-]+)=/g)].map((m) => m[1]));
const dataRead = new Set([...src.matchAll(/closest\('\[(data-[a-z0-9-]+)\]'\)/g)].map((m) => m[1]));
// dataset.termNode ←→ data-term-node
for (const m of src.matchAll(/dataset\.([a-zA-Z]+)/g)) {
  dataRead.add('data-' + m[1].replace(/[A-Z]/g, (ch) => '-' + ch.toLowerCase()));
}
for (const m of src.matchAll(/dataset\[['"]([^'"]+)['"]\]/g)) dataRead.add('data-' + m[1]);

const missingData = [...dataRead].filter((d) => !dataWritten.has(d));
ok('读取的 data-* 都有写出', missingData.length === 0, '未写出：' + missingData.join(', '));

const deadData = [...dataWritten].filter((d) => !dataRead.has(d));
ok('没有只写不读的死属性', deadData.length === 0, '死属性：' + deadData.join(', '));

/* ---------- 结果输出 ---------- */
console.log('\n通过 ' + pass + ' 项，失败 ' + fails.length + ' 项  [id ' + used.size + '/' + defined.size + ']');
if (fails.length) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('✓ DOM 契约闭合');
}
