/* ============================================================
 * pidopt.test.mjs — PID 参数寻优内核测试（DSP.pidOptimize）
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

/* 一阶对象：起点粗略，ITAE 寻优应显著下降且闭环表现良好 */
{
  const r = DSP.pidOptimize([1], [1, 1], 'itae', { kp: 1, ki: 0.5, kd: 0 }, { tmax: 15, steps: 1500, maxSims: 300 });
  ok('寻优收敛', r.ok);
  ok('ITAE 单调不升（start→best）', r.value <= r.startValue, `${r.startValue?.toFixed(3)} → ${r.value?.toFixed(3)}`);
  ok('ITAE 显著下降（≥15%）', r.value <= r.startValue * 0.85, `降幅 ${(100 * (1 - r.value / r.startValue)).toFixed(1)}%`);
  ok('增益非负', r.gains.kp >= 0 && r.gains.ki >= 0 && r.gains.kd >= 0);
  const sim = DSP.pidLoopSim([1], [1, 1], r.gains, { tmax: 15, steps: 3000 });
  ok('寻优结果闭环收敛到 1', Math.abs(sim.y[sim.y.length - 1] - 1) < 0.02, `y=${sim.y[sim.y.length - 1].toFixed(4)}`);
  ok('仿真次数受控（≤300）', r.sims <= 300, String(r.sims));
}
/* IAE 指标同样有效；非法指标拒绝 */
{
  const r = DSP.pidOptimize([1], [1, 1], 'iae', { kp: 2, ki: 2, kd: 0.5 }, { tmax: 12, steps: 1200, maxSims: 250 });
  ok('IAE 寻优不升', r.ok && r.value <= r.startValue + 1e-9);
  ok('非法指标拒绝', !DSP.pidOptimize([1], [1, 1], 'xxx', { kp: 1 }).ok);
}

console.log(fails.length
  ? `✗ pidopt ${pass} 通过，${fails.length} 失败:\n  ` + fails.join('\n  ')
  : `✓ pidopt ${pass} 项全部通过`);
process.exit(fails.length ? 1 : 0);
