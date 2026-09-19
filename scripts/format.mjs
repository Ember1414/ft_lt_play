/* ============================================================
 * format.mjs — 保守格式化（零依赖）
 *   仅做安全归一化：去行尾空白、补文件末尾换行；不改排版不换行。
 *   大规模重排版（Prettier）留待代码稳定后统一执行，避免噪声 diff。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exts = new Set(['.js', '.mjs', '.css', '.html', '.json', '.md']);
const skipDirs = new Set(['node_modules', '.git', '.wrangler', '.playwright-cli', '.claude', '.codebuddy']);

let changed = 0, scanned = 0;
function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(f.name)) continue;
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { walk(p); continue; }
    if (!exts.has(path.extname(f.name))) continue;
    scanned++;
    const src = fs.readFileSync(p, 'utf8');
    let out = src.replace(/[ \t]+$/gm, '');
    if (out.length && !out.endsWith('\n')) out += '\n';
    if (out !== src) { fs.writeFileSync(p, out); changed++; console.log('formatted ' + path.relative(root, p)); }
  }
}
walk(root);
console.log(`✓ format：扫描 ${scanned} 个文件，修正 ${changed} 个`);
