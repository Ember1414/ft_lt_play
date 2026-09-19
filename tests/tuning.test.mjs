/* ============================================================
 * tuning.test.mjs — PID 整定向导内核测试（ZN 临界比例度 / FOPDT 两点法）
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

/* ---------- znUltimate：经典案例 1/(s(s+1)(s+2)) → Ku=6, ω_pc=√2 ---------- */
{
  const r = DSP.znUltimate([1], [1, 3, 2, 0]);
  ok('三阶含积分 Ku=6', r.ok && near(r.Ku, 6, 0.01), `Ku=${r.Ku && r.Ku.toFixed(4)}`);
  ok('Tu=2π/√2≈4.443', r.ok && near(r.Tu, 2 * Math.PI / Math.SQRT2, 0.01), `Tu=${r.Tu && r.Tu.toFixed(4)}`);
  // 五阶系统也有临界点
  const r2 = DSP.znUltimate([1], [1, 4, 6, 4, 1, 0]);   // 1/(s(s+1)^4)
  ok('五阶对象有临界增益', r2.ok && r2.Ku > 0);
  // 一阶对象无 −180° 穿越 → 明确拒绝
  const r3 = DSP.znUltimate([1], [1, 1]);
  ok('一阶对象无临界增益（明确说明）', !r3.ok && /−180/.test(r3.note));
  // 二阶欠阻尼亦无
  ok('二阶对象无临界增益', !DSP.znUltimate([1], [1, 0.5, 1]).ok);
}

/* ---------- fopdtFit：合成 FOPDT 响应还原 K/T/L ---------- */
{
  const K = 2, T = 1.5, L = 0.4;
  const t = [], y = [];
  for (let i = 0; i <= 600; i++) { const tv = (i / 600) * 30; t.push(tv); y.push(K * (1 - Math.exp(-(Math.max(0, tv - L)) / T))); }
  const r = DSP.fopdtFit(t, y);
  ok('FOPDT 还原 K', r.ok && near(r.K, K, 0.01), `K=${r.K && r.K.toFixed(3)}`);
  ok('FOPDT 还原 T', r.ok && near(r.T, T, 0.05), `T=${r.T && r.T.toFixed(3)}`);
  ok('FOPDT 还原 L', r.ok && near(r.L, L, 0.05), `L=${r.L && r.L.toFixed(3)}`);
  // 一阶对象 1/(s+1) 开环阶跃 → K=1, T≈1, L≈0
  const step = DSP.ltiResponse([1], [1, 1], (t) => (t >= 0 ? 1 : 0), 0, 15, 1500);
  const r2 = DSP.fopdtFit(step.t, step.y);
  ok('一阶对象 K=1、T≈1、L≈0', r2.ok && near(r2.K, 1, 0.01) && near(r2.T, 1, 0.03) && r2.L < 0.05, `K=${r2.K && r2.K.toFixed(3)} T=${r2.T && r2.T.toFixed(3)} L=${r2.L && r2.L.toFixed(3)}`);
  // 积分对象（无界）明确拒绝
  const ramp = DSP.ltiResponse([1], [1, 0], (t) => (t >= 0 ? 1 : 0), 0, 10, 1000);
  ok('积分对象拒绝（无稳态）', !DSP.fopdtFit(ramp.t, ramp.y).ok);
}

/* ---------- 整定公式联动（ZN-PID 应用后闭环稳定且衰减良好） ---------- */
{
  const r = DSP.znUltimate([1], [1, 3, 2, 0]);
  // ZN-PID：Kp=0.6Ku, Ti=0.5Tu, Td=0.125Tu → Ki=Kp/Ti, Kd=Kp·Td
  const Kp = 0.6 * r.Ku, Ki = Kp / (0.5 * r.Tu), Kd = Kp * 0.125 * r.Tu;
  ok('ZN-PID 参数为正', Kp > 0 && Ki > 0 && Kd > 0);
  // 理想差分微分在离散域高频发散（物理事实），ZN 应用需配微分滤波 Tf≈0.05–0.1·Tu
  const Tf = 0.1 * (Kd / Kp);   // 经典规则：微分滤波时间 = Td/10
  const sim = DSP.pidLoopSim([1], [1, 3, 2, 0], { kp: Kp, ki: Ki, kd: Kd, Tf }, { tmax: 40, steps: 8000 });
  ok('ZN-PID(Tf=Td/10) 闭环仿真有限且趋近 1', sim.y.every((v) => isFinite(v)) && Math.abs(sim.y[sim.y.length - 1] - 1) < 0.05, `y=${sim.y[sim.y.length - 1].toFixed(3)}`);
}

console.log(fails.length
  ? `✗ tuning ${pass} 通过，${fails.length} 失败:\n  ` + fails.join('\n  ')
  : `✓ tuning ${pass} 项全部通过`);
process.exit(fails.length ? 1 : 0);
