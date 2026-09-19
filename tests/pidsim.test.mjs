/* ============================================================
 * pidsim.test.mjs — PID 闭环时域仿真内核测试（DSP.pidLoopSim）
 *   ① P/PI 与闭环传函 ltiResponse 严格等价（严格真分式，无直通跳变）
 *   ② D 项：t=0 直通跳变为理想微分特性（按闭环慢极点衰减），尾部对照
 *   ③ 执行器限幅生效；抗饱和（条件积分/反算）抑制退饱和超调
 *   ④ 微分先行消除设定值阶跃的微分踢；微分滤波削尖峰；
 *      大 kd 无滤波高频发散（滤波存在理由的复现）
 *   ⑤ 数字 PID：有限、稳态正确、周期影响可控
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

const PLANT = { num: [1], den: [1, 1] };   // 1/(s+1)
const pm = (a, b) => { const o = new Array(a.length + b.length - 1).fill(0); a.forEach((x, i) => b.forEach((y, j) => o[i + j] += x * y)); return o; };
const pa = (a, b) => { const n = Math.max(a.length, b.length); const o = new Array(n).fill(0); a.forEach((x, i) => o[n - a.length + i] += x); b.forEach((x, i) => o[n - b.length + i] += x); return o; };

/* ---------- ① P / PI 严格等价 ---------- */
{
  // P：T = Kp·G/(1+Kp·G) = 2/(s+3)
  const simP = DSP.pidLoopSim(PLANT.num, PLANT.den, { kp: 2 }, { tmax: 10, steps: 5000 });
  const refP = DSP.ltiResponse([2], [1, 3], (t) => (t >= 0 ? 1 : 0), 0, 10, 5000);
  let d = 0; for (let i = 0; i < refP.y.length; i++) d = Math.max(d, Math.abs(refP.y[i] - simP.y[i]));
  ok('P 控制与闭环传函一致（maxDiff=' + d.toFixed(7) + '）', d < 1e-3);
  // PI：C=(2s+1)/s → T=(2s+1)/(s²+3s+1)（严格真分式，无跳变）
  const simPI = DSP.pidLoopSim(PLANT.num, PLANT.den, { kp: 2, ki: 1 }, { tmax: 10, steps: 5000 });
  const refPI = DSP.ltiResponse([2, 1], [1, 3, 1], (t) => (t >= 0 ? 1 : 0), 0, 10, 5000);
  d = 0; for (let i = 0; i < refPI.y.length; i++) d = Math.max(d, Math.abs(refPI.y[i] - simPI.y[i]));
  ok('PI 控制与闭环传函一致（maxDiff=' + d.toFixed(7) + '）', d < 1e-3);
}

/* ---------- ② D 项尾部对照（理想微分直通跳变按闭环慢极点衰减） ---------- */
{
  const sim = DSP.pidLoopSim(PLANT.num, PLANT.den, { kp: 2, ki: 1, kd: 0.5 }, { tmax: 30, steps: 6000 });
  const N0 = pm([0.5, 2, 1], [1]), D0 = pa(pm([1, 0], [1, 1]), [0.5, 2, 1]);
  const ref = DSP.ltiResponse(N0, D0, (t) => (t >= 0 ? 1 : 0), 0, 30, 6000);
  let dTail = 0;
  for (let i = 3000; i < ref.y.length; i++) dTail = Math.max(dTail, Math.abs(ref.y[i] - sim.y[i]));
  ok('D 项：10s 后轨迹重合（dTail=' + dTail.toFixed(5) + '）', dTail < 0.05);
  ok('D 项：t=0 复现直通跳变（ref≈0.333，sim=0）', Math.abs(ref.y[0] - 0.333) < 0.01 && sim.y[0] === 0);
}

/* ---------- ③ 限幅与抗饱和 ---------- */
{
  const big = { kp: 12, ki: 6, kd: 0 };
  const free = DSP.pidLoopSim(PLANT.num, PLANT.den, big, { tmax: 10, steps: 3000 });
  const satOff = DSP.pidLoopSim(PLANT.num, PLANT.den, big, { tmax: 10, steps: 3000, uMax: 2, aw: 'off' });
  const satClamp = DSP.pidLoopSim(PLANT.num, PLANT.den, big, { tmax: 10, steps: 3000, uMax: 2, aw: 'clamp' });
  const satBack = DSP.pidLoopSim(PLANT.num, PLANT.den, big, { tmax: 10, steps: 3000, uMax: 2, aw: 'back', Tt: 0.5 });
  const peak = (r) => Math.max(...r.y);
  ok('限幅时 |u| 全程 ≤ uMax', satClamp.u.every((v) => v <= 2 + 1e-9 && v >= -2 - 1e-9));
  ok('积分饱和加剧超调（aw=off 峰值更大）', peak(satOff) > peak(satClamp), `off=${peak(satOff).toFixed(3)} clamp=${peak(satClamp).toFixed(3)}`);
  ok('反算法同样抑制退饱和超调', peak(satBack) < peak(satOff), `back=${peak(satBack).toFixed(3)}`);
  ok('限幅使前半程上升变慢', free.y[300] > satClamp.y[300]);
}

/* ---------- ④ 微分先行 / 微分滤波（设定值 t=2s 阶跃 0→1 复现微分踢） ---------- */
{
  const rFn = (t) => (t < 2 ? 0 : 1);
  const withD = { kp: 4, ki: 1, kd: 0.5 };
  const onErr = DSP.pidLoopSim(PLANT.num, PLANT.den, withD, { tmax: 6, steps: 3000, r: rFn });
  const onMeas = DSP.pidLoopSim(PLANT.num, PLANT.den, { ...withD, dOnM: true }, { tmax: 6, steps: 3000, r: rFn });
  const peakU = (r) => Math.max(...r.u);
  ok('设定值阶跃复现微分踢（onErr u 峰值巨大）', peakU(onErr) > 100, `峰值=${peakU(onErr).toFixed(1)}`);
  ok('微分先行消除微分踢（u 峰值≈P 项）', peakU(onMeas) < peakU(onErr) * 0.05, `meas=${peakU(onMeas).toFixed(2)}`);
  const filt = DSP.pidLoopSim(PLANT.num, PLANT.den, { ...withD, Tf: 0.1 }, { tmax: 6, steps: 3000, r: rFn });
  ok('微分滤波把尖峰削掉一个量级以上', peakU(filt) < peakU(onErr) * 0.1, `Tf=0.1 峰值=${peakU(filt).toFixed(2)}`);
  // 大 kd：无滤波高频发散，有滤波有界（不完全微分存在理由的复现）
  const bigNo = DSP.pidLoopSim(PLANT.num, PLANT.den, { kp: 4, ki: 1, kd: 2 }, { tmax: 6, steps: 3000, r: rFn });
  const bigYes = DSP.pidLoopSim(PLANT.num, PLANT.den, { kp: 4, ki: 1, kd: 2, Tf: 0.1 }, { tmax: 6, steps: 3000, r: rFn });
  ok('大 kd 无滤波发散、有滤波有界', !bigNo.y.every((v) => isFinite(v) && Math.abs(v) < 1e3) && bigYes.y.every((v) => isFinite(v) && Math.abs(v) < 50));
}

/* ---------- ⑤ 数字 PID ---------- */
{
  const r = DSP.pidLoopSim(PLANT.num, PLANT.den, { kp: 2, ki: 1, kd: 0.5 }, { tmax: 30, steps: 6000, Ts: 0.05 });
  ok('数字 PID 输出有限', r.y.every((v) => isFinite(v)));
  ok('数字 PID 稳态趋近 1', Math.abs(r.y[r.y.length - 1] - 1) < 0.05, `y=${r.y[r.y.length - 1].toFixed(4)}`);
  const slow = DSP.pidLoopSim(PLANT.num, PLANT.den, { kp: 2, ki: 1, kd: 0.5 }, { tmax: 30, steps: 6000, Ts: 0.5 });
  ok('大采样周期 u 变化次数更少（ZOH 特性）', slow.u.filter((v, i) => i && v !== slow.u[i - 1]).length < r.u.filter((v, i) => i && v !== r.u[i - 1]).length);
}

/* ---------- 边界 ---------- */
{
  ok('非真分式对象拒绝', !DSP.pidLoopSim([1, 0], [1, 1], { kp: 1 }, { tmax: 1, steps: 100 }).ok);
  ok('纯 P 控制器可运行', DSP.pidLoopSim(PLANT.num, PLANT.den, { kp: 1 }, { tmax: 2, steps: 500 }).ok);
  ok('三阶对象（含积分器）可运行', DSP.pidLoopSim([1], [1, 2, 0, 0], { kp: 1 }, { tmax: 2, steps: 500 }).ok);
}

console.log(fails.length
  ? `✗ pidsim ${pass} 通过，${fails.length} 失败:\n  ` + fails.join('\n  ')
  : `✓ pidsim ${pass} 项全部通过`);
process.exit(fails.length ? 1 : 0);
