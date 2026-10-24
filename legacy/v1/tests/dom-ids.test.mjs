/* ============================================================
 * dom-ids.test.mjs — 全模块 DOM id 契约静态检查
 *   背景：Node 测试桩的 $() 有注册表兜底，模块引用不存在的 id 在
 *   Node 全绿、在浏览器却抛 null 崩溃（sys#sys-params 实例）。
 *   这里静态交叉核对每个模块文件：
 *     所有 $('#x') 引用的 id 都能在本文件内找到定义来源：
 *       ① 模板字符串 id="x"   ② U.el/setAttribute('id','x')
 *       ③ .id = 'x'          ④ MI ids:{num,den}（运行时创建）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['assets/js/app.js', ...fs.readdirSync(path.join(root, 'assets/js/modules')).map((f) => 'assets/js/modules/' + f)];

let pass = 0;
const fails = [];
const ok = (n, c, extra) => { c ? pass++ : fails.push(n + (extra ? '  → ' : '') + (extra || '')); };

for (const rel of files) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const defined = new Set();
  for (const m of src.matchAll(/\bid="([a-zA-Z0-9_-]+)"/g)) defined.add(m[1]);
  for (const m of src.matchAll(/setAttribute\(\s*'id'\s*,\s*'([a-zA-Z0-9_-]+)'\s*\)/g)) defined.add(m[1]);
  for (const m of src.matchAll(/\bid:\s*'([a-zA-Z0-9_-]+)'/g)) defined.add(m[1]);
  for (const m of src.matchAll(/\.id\s*=\s*'([a-zA-Z0-9_-]+)'/g)) defined.add(m[1]);
  for (const m of src.matchAll(/ids:\s*\{[^}]*num:\s*'([a-zA-Z0-9_-]+)'[^}]*den:\s*'([a-zA-Z0-9_-]+)'/g)) { defined.add(m[1]); defined.add(m[2]); }
  for (const m of src.matchAll(/getElementById\(\s*'([a-zA-Z0-9_-]+)'\s*\)/g)) defined.add(m[1]);   // 全局 id（app 布局）

  const used = new Set();
  for (const m of src.matchAll(/\$\('#([a-zA-Z0-9_-]+)'\)/g)) used.add(m[1]);
  for (const m of src.matchAll(/querySelector\('#([a-zA-Z0-9_-]+)'\)/g)) used.add(m[1]);

  const missing = [...used].filter((id) => !defined.has(id));
  ok(`${rel}: 引用的 id 均有定义来源`, missing.length === 0, missing.length ? `缺失：${missing.join(', ')}` : '');
}

console.log(fails.length
  ? `✗ dom-ids ${pass} 通过，${fails.length} 失败:\n  ` + fails.join('\n  ')
  : `✓ dom-ids ${pass} 项全部通过`);
process.exit(fails.length ? 1 : 0);
