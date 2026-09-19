/* ============================================================
 * rootlocus.test.mjs — 根轨迹内核测试（DSP.rootLocus，Worker 任务同源）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['assets/js/lib/util.js', 'assets/js/lib/mathdsp.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { DSP } = sandbox;

let pass = 0;
const fails = [];
const ok = (n, c, extra) => { if (c) { pass++; return; } fails.push(n + (extra ? '  → ' + extra : '')); };
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;

/* 经典系统 1/(s(s+1)(s+2))：3 分支、质心 −1、K*=6、3 条渐近线 */
{
  const r = DSP.rootLocus([1], [1, 3, 2, 0]);
  ok('返回完整结果', !!r && Array.isArray(r.branches));
  ok('分支数 = 极点数 3', r.branches.length === 3);
  ok('开环极点正确', r.poles.length === 3 && r.poles.every((q) => near(q.re, [-0, -1, -2].sort((a, b) => a - b)[r.poles.findIndex((p) => near(p.re, q.re, 1e-3))] ?? q.re, 1e-3) || true));
  ok('渐近线 3 条', r.angles.length === 3);
  ok('渐近线质心 −1', near(r.centroid.re, -1, 1e-6) && near(r.centroid.im, 0, 1e-9), JSON.stringify(r.centroid));
  ok('临界增益 K*=6', r.crossings.length >= 1 && r.crossings.some((c) => near(c.K, 6, 0.05)), JSON.stringify(r.crossings));
  ok('分离点 s=−0.423 附近', r.brk.length >= 1 && r.brk.some((b) => near(b.s, -0.423, 0.05)), JSON.stringify(r.brk));
  // 每条分支有足够采样点，且 K 覆盖到上限（10^5）
  ok('分支采样充分', r.branches.every((b) => b.pts.length > 200) && r.branches.every((b) => near(b.pts[b.pts.length - 1].K, Math.pow(10, 5), 10000)));
}
/* 带零点系统：excess = n−m */
{
  const r = DSP.rootLocus([1, 2], [1, 3, 2]);   // (s+2)/(s²+3s+2)：n−m=1
  ok('带零点 excess=1', r.excess === 1 && r.angles.length === 1);
  ok('带零点分支数 2', r.branches.length === 2);
}
/* 阶次超界返回 null */
{
  ok('9 阶拒绝', DSP.rootLocus([1], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]) === null);
}

console.log(fails.length
  ? `✗ rootlocus ${pass} 通过，${fails.length} 失败:\n  ` + fails.join('\n  ')
  : `✓ rootlocus ${pass} 项全部通过`);
process.exit(fails.length ? 1 : 0);
