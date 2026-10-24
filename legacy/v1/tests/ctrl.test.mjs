/* ============================================================
 * ctrl.test.mjs — 系统分析数学内核（稳态误差 / 完整奈奎斯特判据）
 *   运行：node tests/ctrl.test.mjs
 *   steadyState：型别与 Kp/Kv/Ka、三种输入的稳态误差
 *   nyquistFull：Z=N+P 与 Routh/求根交叉验证
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
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

/* ---------- steadyState ---------- */
{
  // 型别 0：L=K/(s+2)，K=6 → Kp=3，ess.step=1/4；斜坡/抛物线误差 ∞
  let r = DSP.steadyState([6], [1, 2]);
  ok('type0 型别', r.type === 0);
  ok('type0 Kp=K/2', near(r.Kp, 3));
  ok('type0 ess.step=1/4', near(r.ess.step, 0.25));
  ok('type0 Kv=0 → ramp ∞', r.Kv === 0 && !isFinite(r.ess.ramp));
  ok('type0 para ∞', !isFinite(r.ess.para));

  // 型别 1：K/(s(s+2))，K=4 → Kv=2，ess.ramp=0.5；阶跃误差 0
  r = DSP.steadyState([4], [1, 2, 0]);
  ok('type1 型别', r.type === 1);
  ok('type1 Kp=∞', !isFinite(r.Kp));
  ok('type1 ess.step=0', r.ess.step === 0);
  ok('type1 Kv=K/2', near(r.Kv, 2), String(r.Kv));
  ok('type1 ess.ramp=a/K', near(r.ess.ramp, 0.5));

  // 型别 2：K/(s²(s+1))，K=8 → Ka=8，ess.para=1/8；斜坡误差 0
  r = DSP.steadyState([8], [1, 1, 0, 0]);
  ok('type2 型别', r.type === 2);
  ok('type2 Kv=∞', !isFinite(r.Kv));
  ok('type2 Ka=K', near(r.Ka, 8));
  ok('type2 ess.ramp=0', r.ess.ramp === 0);
  ok('type2 ess.para=1/8', near(r.ess.para, 0.125));

  // 型别 3：Ka=∞，抛物线误差 0
  r = DSP.steadyState([1], [1, 1, 0, 0, 0]);
  ok('type3 Ka=∞ 且 ess.para=0', !isFinite(r.Ka) && r.ess.para === 0);

  // 带零点的对象：L=5(s+1)/(s(s+2)) → Kv=5/2
  r = DSP.steadyState([5, 5], [1, 2, 0]);
  ok('type1 带零点 Kv=2.5', near(r.Kv, 2.5), String(r.Kv));
}

/* ---------- nyquistFull（与求根/Routh 交叉验证） ---------- */
function closedLoopRHP(num, den) {
  // 1 + L = 0 → den + num（补零对齐），返回右半平面闭环极点数
  const n = den.slice(), m = num.slice();
  while (m.length < n.length) m.unshift(0);
  const ch = n.map((c, i) => c + (m[i] || 0));
  return DSP.polyRoots(ch).filter((q) => q.re > 1e-9).length;
}
function caseTF(name, num, den, expectStable) {
  const r = DSP.nyquistFull(num, den);
  const zTrue = closedLoopRHP(num, den);
  ok(`${name}: Z 与闭环求根一致（Z=${r.Z}, 实际=${zTrue}）`, r.Z === zTrue, `Z=${r.Z} 实际=${zTrue}`);
  ok(`${name}: 稳定性结论正确`, r.stable === expectStable, `stable=${r.stable}`);
  ok(`${name}: Z=N+P 自洽`, r.Z === r.N + r.P);
  return r;
}
{
  caseTF('一阶 1/(s+1)', [1], [1, 1], true);
  caseTF('二阶 10/((s+1)(s+2))', [10], [1, 3, 2], true);
  caseTF('K=3 三阶含积分 3/(s(s+1)(s+2))', [3], [1, 3, 2, 0], true);
  caseTF('K=10 同系统（临界 6 < 10）', [10], [1, 3, 2, 0], false);
  caseTF('不稳定开环 1/(s-1)^2（P=2）', [1], [1, -2, 1], false);
  caseTF('双积分器 2/(s^2(s+1))', [2], [1, 1, 0, 0], false);
  const r = caseTF('条件稳定带零点 (s+3)/(s(s+1)(s+2)^2)... 简化 K/(s^2+1)', [4], [1, 0, 1], true);
  ok('纯虚开环极点 P 不含虚轴', r.P === 0);
  const r2 = DSP.nyquistFull([1], [1, -2, 1]);
  ok('1/(s-1)² 的 P=2', r2.P === 2, String(r2.P));
  ok('1/(s-1)² 的 N=Z−P=0', r2.N === 0, String(r2.N));
}

/* ---------- errMetrics（ISE/IAE/ITAE） ---------- */
{
  // e(t)=1（阶跃误差，积分对象 Ki 作用前）：ISE=t, IAE=t, ITAE=t²/2
  const t = [], e = [];
  for (let i = 0; i <= 100; i++) { t.push(i / 10); e.push(1); }
  const r = DSP.errMetrics(t, e);
  ok('errMetrics 常值误差 ISE=IAE=T', near(r.ise, 10, 1e-6) && near(r.iae, 10, 1e-6), `ise=${r.ise} iae=${r.iae}`);
  ok('errMetrics ITAE=T²/2', near(r.itae, 50, 1e-3), `itae=${r.itae}`);
  // e(t)=e^{-t}u(t)（t∈[0,10]）：IAE=1−e^{−10}
  const t2 = [], e2 = [];
  for (let i = 0; i <= 1000; i++) { const tv = i / 100; t2.push(tv); e2.push(Math.exp(-tv)); }
  const r2 = DSP.errMetrics(t2, e2);
  ok('errMetrics 指数衰减 IAE≈1', near(r2.iae, 1 - Math.exp(-10), 1e-3), `iae=${r2.iae}`);
}

console.log(fails.length
  ? `✗ ctrl ${pass} 通过，${fails.length} 失败:\n  ` + fails.join('\n  ')
  : `✓ ctrl ${pass} 项全部通过`);
process.exit(fails.length ? 1 : 0);
