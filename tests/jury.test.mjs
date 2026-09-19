/* ============================================================
 * jury.test.mjs — Jury 离散稳定判据测试
 *   已知案例 + 随机多项式与 polyRoots 交叉验证（种子确定性）
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

/* ---------- 已知案例 ---------- */
{
  ok('z²−0.25（根 ±0.5）稳定', DSP.jury([1, 0, -0.25]).ok && DSP.jury([1, 0, -0.25]).stable);
  ok('z²−2z+0.75（根 1.37/0.63）不稳定', !DSP.jury([1, -2, 0.75]).stable);
  ok('z²−1（根 ±1 临界）不稳定', !DSP.jury([1, 0, -1]).stable);
  ok('z²+1（根 ±j 临界）不稳定', !DSP.jury([1, 0, 1]).stable);
  ok('n=1 拒绝', !DSP.jury([1, -1]).ok);
  ok('首项为负拒绝（未归一化）', !DSP.jury([-1, 0, 0.25]).ok);
  const r3 = DSP.jury([1, -0.5, 0.25, -0.125]);
  ok('三阶案例返回表格', r3.ok && r3.rows.length >= 2 && r3.conds.length >= 4);
}

/* ---------- 随机多项式交叉验证（与 polyRoots 一致） ---------- */
{
  // 确定性 LCG 种子，保证测试可复现
  let seed = 20260919;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let checked = 0, mismatch = 0;
  for (let t = 0; t < 200; t++) {
    const n = 2 + ((rnd() * 4) | 0);   // 2..5 阶
    const coef = [];
    for (let i = 0; i <= n; i++) coef.push(Math.round((rnd() * 6 - 3) * 1000) / 1000);
    if (!(coef[0] > 0)) coef[0] = Math.abs(coef[0]) + 0.5;
    const roots = DSP.polyRoots(coef).filter((q) => isFinite(q.re) && isFinite(q.im));
    if (roots.length !== n) continue;   // 求根失败/降阶的样本跳过
    const maxMod = Math.max(...roots.map((q) => Math.hypot(q.re, q.im)));
    // 跳过贴近单位圆的样本（判据在临界处不给出结论属正常）
    if (Math.abs(maxMod - 1) < 0.02) continue;
    const j = DSP.jury(coef);
    if (!j.ok) continue;
    checked++;
    const rootStable = maxMod < 1;
    if (j.stable !== rootStable) {
      mismatch++;
      if (mismatch <= 3) console.log(`  样本 coef=[${coef}] roots=${roots.map(q => q.re + '+' + q.im + 'j')} maxMod=${maxMod.toFixed(3)} jury=${j.stable}`);
    }
  }
  ok(`随机 200 样本 Jury 与求根一致（有效 ${checked}，错 ${mismatch}）`, checked > 100 && mismatch === 0);
}

console.log(fails.length
  ? `✗ jury ${pass} 通过，${fails.length} 失败:\n  ` + fails.join('\n  ')
  : `✓ jury ${pass} 项全部通过`);
process.exit(fails.length ? 1 : 0);
