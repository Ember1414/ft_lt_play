/* ============================================================
 * check.mjs — 语法门：node --check 所有源码与脚本
 * ============================================================ */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = [];
for (const dir of ['assets/js/lib', 'assets/js/modules', 'scripts', 'tests']) {
  const p = path.join(root, dir);
  if (!fs.existsSync(p)) continue;
  for (const f of fs.readdirSync(p)) {
    if (f.endsWith('.js') || f.endsWith('.mjs')) targets.push(path.join(p, f));
  }
}
// app.js 在 assets/js 根目录
targets.push(path.join(root, 'assets/js/app.js'));

let bad = 0;
for (const f of targets) {
  const r = spawnSync(process.execPath, ['--check', f]);
  if (r.status !== 0) {
    bad++;
    console.error(`✗ 语法错误: ${path.relative(root, f)}`);
    process.stdout.write(r.stderr || '');
  }
}
console.log(`${bad ? '✗' : '✓'} node --check ${targets.length} 个文件，失败 ${bad}`);
process.exit(bad ? 1 : 0);
