/* ============================================================
 * lint.mjs — 轻量静态审计（零依赖）
 *   硬性规则（错误）：
 *   L1  禁止动态执行：new Function / eval( / setTimeout("str")
 *   L2  禁止 document.write（CDN 回退必须走 app.js 动态加载器）
 *   L3  index.html 引用的本地资源必须存在；?v= 版本号必须全局一致
 *   L4  实验存储必须带 schemaVersion（禁止新增裸 localStorage 业务键 ——
 *       允许清单：flt-theme / flt-models / flt-expr-history / MI 历史键 flt-tf-* / fltp:*）
 *   提示（警告，不失败）：innerHTML 赋值行内含 ${ 模板插值（人工确认插值内容是否用户可控）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [], warns = [];

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (f.name !== 'node_modules' && f.name !== '.git') walk(p, out); }
    else out.push(p);
  }
  return out;
}

const jsFiles = walk(path.join(root, 'assets/js')).filter((p) => p.endsWith('.js'));
const evalAllow = new Set([path.join(root, 'tests/lib.test.mjs')]); // 测试沙箱自身用 vm

for (const f of jsFiles) {
  const rel = path.relative(root, f);
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const n = `${rel}:${i + 1}`;
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*$/, '');   // 去行注释后再匹配，注释提及不违规
    if (/(^|[^\w.])Function\s*\(/.test(code) || /(^|[^.\w])eval\s*\(/.test(code)) errors.push(`L1 动态执行 ${n}: ${line.trim().slice(0, 90)}`);
    if (/document\.write/.test(code)) errors.push(`L2 document.write ${n}: ${line.trim().slice(0, 90)}`);
    if (/innerHTML\s*=/.test(line) && /\$\{/.test(line)) warns.push(`innerHTML+插值 ${n}: ${line.trim().slice(0, 90)}`);
    if (/localStorage\.(set|get)Item\(\s*['"`]/.test(line)) {
      const m = line.match(/['"`]([^'"`]+)['"`]/);
      const key = m ? m[1] : '';
      const ok = /^(flt-theme|flt-models|flt-expr-history|flt-tf-|fltp:|fs-|blk-)/.test(key);
      if (key && !ok) errors.push(`L4 未登记的 localStorage 键 "${key}" ${n}（业务数据请走 fltp: 版本化存储）`);
    }
  });
}

/* index.html 引用完整性 + 版本一致性 */
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="(assets\/[^"?]+)(?:\?v=([^"]*))?"/g)];
for (const [, p] of refs) if (!fs.existsSync(path.join(root, p))) errors.push(`L3 index.html 引用缺失: ${p}`);
const vers = refs.map((m) => m[2]).filter(Boolean);
if (vers.length && new Set(vers).size !== 1) errors.push(`L3 ?v= 版本不一致: ${[...new Set(vers)].join(', ')}`);
if (/document\.write/.test(html)) errors.push('L2 index.html 含 document.write 内联回退');

/* L5：MI 组件运行时创建的输入 id，不得在其创建之前被 $() 引用（Node 桩会掩盖 null 崩溃） */
for (const f of jsFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split('\n');
  let miLine = -1;
  for (let i = 0; i < lines.length; i++) if (/MI\.(tfInput|exprInput)\(/.test(lines[i])) { miLine = i; break; }
  if (miLine < 0) continue;
  const block = lines.slice(0, miLine + 6).join('\n');
  const miIds = [...block.matchAll(/ids:\s*\{[^}]*num:\s*'([a-z0-9-]+)'[^}]*den:\s*'([a-z0-9-]+)'/g)].flatMap((m) => [m[1], m[2]]);
  const miLine2 = lines.findIndex((l) => /MI\.(tfInput|exprInput)\(/.test(l));
  for (let i = 0; i < miLine2; i++) {
    for (const id of miIds) {
      if (lines[i].includes("#'" + id + "'")) errors.push(`L5 ${path.relative(root, f)}:${i + 1} 在 MI 创建前引用运行时输入 #${id}（浏览器中为 null）`);
    }
  }
}

if (warns.length) console.log(`ℹ ${warns.length} 条 innerHTML 插值待人工确认（不阻断）:`);
warns.slice(0, 12).forEach((w) => console.log('  ' + w));

if (errors.length) { console.error(`\n✗ lint ${errors.length} 个错误:`); errors.forEach((e) => console.error('  ' + e)); process.exit(1); }
console.log(`✓ lint 通过（${jsFiles.length} 个 JS 文件 + index.html）`);
