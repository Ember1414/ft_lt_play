/* ============================================================
 * run-tests.mjs — 顺序执行 tests/*.test.mjs，汇总结果
 *   每个测试文件是独立 Node 脚本，进程退出码非 0 即视为失败。
 * ============================================================ */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(root, 'tests');
const files = fs.readdirSync(testDir).filter((f) => f.endsWith('.test.mjs')).sort();

if (!files.length) { console.error('未找到任何 tests/*.test.mjs'); process.exit(1); }

let failed = 0;
const t0 = Date.now();
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(testDir, f)], { encoding: 'utf8', timeout: 120000 });
  const out = (r.stdout || '') + (r.stderr || '');
  // 打印末尾 3 行摘要；失败时打印全部输出便于定位
  const lines = out.trim().split('\n');
  console.log(`\n=== ${f}`);
  console.log((r.status === 0 ? lines.slice(-3) : lines).join('\n'));
  if (r.status !== 0 || r.error) { failed++; console.log(`✗ ${f} 退出码 ${r.status ?? 'ERR'}`); }
}
const dt = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n${failed ? '✗' : '✓'} ${files.length} 个测试脚本，失败 ${failed} 个，用时 ${dt}s`);
process.exit(failed ? 1 : 0);
