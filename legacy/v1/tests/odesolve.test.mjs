/* ============================================================
 * odesolve.test.mjs — 方程求解内核测试（无浏览器）
 *   运行：node tests/odesolve.test.mjs
 *
 *   覆盖：parseODE/parseDiffEq 各写法与错误路径；
 *   solveODE 零输入/零状态/全解 —— 解析闭式对照（教材例）+ RK4 数值对照；
 *   solveDiffEq 解析 evalN vs 差分方程递推逐点对照；数据序列解析。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const sandbox = { console, JSON, Math };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['assets/js/lib/util.js', 'assets/js/lib/mathdsp.js', 'assets/js/lib/fx.js',
  'assets/js/lib/blocksolve.js', 'assets/js/lib/transforms.js', 'assets/js/lib/odesolve.js']) {
  vm.runInContext(read(f), sandbox, { filename: f });
}

let pass = 0;
const fails = [];
const ok = (n, c, extra) => { c ? pass++ : fails.push(n + (extra ? '  → ' + extra : '')); };
const OS = sandbox.window.ODE;
const TR = sandbox.window.TR;
const close = (x, y, eps) => Math.abs(x - y) <= eps * Math.max(1, Math.abs(y));

/* ================= ① parseODE ================= */
{
  const p1 = OS.parseODE("y'' + 3*y' + 2*y = 0");
  ok('二阶齐次（引号写法）', p1.ok && p1.n === 2 && close(p1.a[0], 2, 1e-12) && close(p1.a[1], 3, 1e-12) && close(p1.a[2], 1, 1e-12), JSON.stringify(p1.a));
  ok('右端 0 → 无输入项', p1.ok && p1.rhsItems.length === 0, JSON.stringify(p1.rhsItems));

  const p2 = OS.parseODE("y'' = exp(-t)*u(t)");
  ok('右端 exp 输入项', p2.ok && p2.rhsItems.length === 1 && p2.rhsItems[0].kind === 'exp', JSON.stringify(p2.rhsItems));

  const p3 = OS.parseODE("y''' + y = t*u(t)");
  ok('三阶（y\'\'\'）', p3.ok && p3.n === 3 && close(p3.a[3], 1, 1e-12) && close(p3.a[0], 1, 1e-12));
  const p4 = OS.parseODE('y2 + y = 0');
  ok('y2 写法', p4.ok && p4.n === 2);
  const p5 = OS.parseODE('y[[2]] + 0.5*y[1] + y = 0');
  ok('y[[k]] 写法', p5.ok && p5.n === 2 && close(p5.a[1], 0.5, 1e-12), JSON.stringify(p5.a));
  const p6 = OS.parseODE('y^(4) + y = 0');
  ok('四阶 y^(4)', p6.ok && p6.n === 4);

  ok('缺等号', OS.parseODE("y'' + y").ok === false);
  ok('左端非常数项', /识别/.test(OS.parseODE('y + 3 = 0').note || ''));
  ok('零阶方程', OS.parseODE('y = u(t)').ok === false);
  ok('超四阶', OS.parseODE("y''''' + y = 0").ok === false);
  ok('右端无法解析', OS.parseODE("y'' = foo(t)").ok === false);
}

/* ================= ② solveODE：零输入（教材闭式） ================= */
{
  const r = OS.solveODE([2, 3, 1], [], [1, 0]);
  ok('zi 求解 ok', r.ok === true, r.note);
  // y''+3y'+2y=0, y(0)=1, y'(0)=0 → y = 2e^{-t} − e^{-2t}
  ok('zi y(0)=1', close(r.zi.evalT(0), 1, 1e-9), String(r.zi.evalT(0)));
  ok('zi y(1)=2/e−e^{-2}', close(r.zi.evalT(1), 2 * Math.exp(-1) - Math.exp(-2), 1e-9), String(r.zi.evalT(1)));
  ok('zi tex 生成', typeof r.zi.tex === 'string' && r.zi.tex.includes('y_{zi}'), r.zi.tex);
  ok('极点 -1/-2', r.poles.length === 2 && close(r.poles[0].re, -1, 1e-6) && close(r.poles[1].re, -2, 1e-6), JSON.stringify(r.poles));
  ok('稳定文案', /稳定/.test(r.stableText));
}

/* ================= ③ solveODE：零状态 + 全解分解 ================= */
{
  const rhs = TR.parseTimeCombo('u(t)');
  const r = OS.solveODE([2, 3, 1], rhs, [0, 0]);
  // y_zs = 0.5 − e^{-t} + 0.5e^{-2t}
  ok('zs y(2) 闭式', close(r.zs.evalT(2), 0.5 - Math.exp(-2) + 0.5 * Math.exp(-4), 1e-9), String(r.zs.evalT(2)));
  ok('zs 终值 → 0.5', close(r.zs.evalT(30), 0.5, 1e-6), String(r.zs.evalT(30)));
  ok('zs tex 生成', typeof r.zs.tex === 'string' && r.zs.tex.includes('y_{zs}'));

  const r2 = OS.solveODE([2, 3, 1], rhs, [1, 0]);
  ok('全解 = zi + zs（t=0.7）', close(r2.full.evalT(0.7), r2.zi.evalT(0.7) + r2.zs.evalT(0.7), 1e-9));
  ok('全解 tex 生成', typeof r2.full.tex === 'string' && r2.full.tex.includes('y(t)'));
}

/* ================= ④ RK4 数值对照 ================= */
{
  const rhs = TR.parseTimeCombo('u(t)');
  const r = OS.solveODE([2, 3, 1], rhs, [1, 0]);
  const sim = OS.simulateODE([2, 3, 1], (t) => TR.fNumeric(rhs, t), [1, 0], 0, 3, 900);
  let maxRel = 0;
  for (const tv of [0.5, 1.5, 3]) {
    const i = Math.round(tv / 3 * 900);
    const ana = r.full.evalT(tv);
    maxRel = Math.max(maxRel, Math.abs(sim.y[i] - ana) / Math.max(1, Math.abs(ana)));
  }
  ok('RK4 全解 vs 解析（<1e-5）', maxRel < 1e-5, 'maxRel=' + maxRel.toExponential(2));

  const rzi = OS.solveODE([2, 3, 1], [], [1, 0]);
  const simZi = OS.simulateODE([2, 3, 1], () => 0, [1, 0], 0, 3, 900);
  let maxZi = 0;
  for (const tv of [0.5, 1.5, 3]) {
    const i = Math.round(tv / 3 * 900);
    maxZi = Math.max(maxZi, Math.abs(simZi.y[i] - rzi.zi.evalT(tv)) / Math.max(1, Math.abs(rzi.zi.evalT(tv))));
  }
  ok('RK4 零输入 vs 解析（<1e-5）', maxZi < 1e-5, 'maxRel=' + maxZi.toExponential(2));
}

/* ================= ⑤ 一阶 / 初值补零 ================= */
{
  const r1 = OS.solveODE([1, 1], [], [2]);
  ok('一阶 y\'+y=0, y(0)=2 → 2e^{-t}', close(r1.zi.evalT(1), 2 * Math.exp(-1), 1e-9), String(r1.zi.evalT(1)));
  const r2 = OS.solveODE([2, 3, 1], [], [1]);
  ok('初值不足补零 note', r2.ok && /补零/.test(r2.note || ''), r2.note);
  ok('补零后与 y\'(0)=0 一致', close(r2.zi.evalT(1), 2 * Math.exp(-1) - Math.exp(-2), 1e-9));
}

/* ================= ⑥ parseDiffEq ================= */
{
  const p1 = OS.parseDiffEq('y[n+2] - 1.5*y[n+1] + 0.5*y[n] = u[n]');
  ok('差分二阶', p1.ok && p1.n === 2 && close(p1.a[0], 0.5, 1e-12) && close(p1.a[1], -1.5, 1e-12) && close(p1.a[2], 1, 1e-12), JSON.stringify(p1.a));
  ok('右端 u[n] 解析', p1.ok && p1.rhsItems.length === 1 && p1.rhsItems[0].kind === 'un', JSON.stringify(p1.rhsItems));
  const p2 = OS.parseDiffEq('y(n+1) - 0.5*y(n) = 0');
  ok('圆括号写法 + 零输入', p2.ok && p2.n === 1 && p2.rhsItems.length === 0);
  const p3 = OS.parseDiffEq('y2 + y = 0');
  ok('y2 写法', p3.ok && p3.n === 2);
  ok('缺等号', OS.parseDiffEq('y[n+1] + y[n]').ok === false);
  ok('零阶', OS.parseDiffEq('y[n] = u[n]').ok === false);
  ok('右端无法解析', OS.parseDiffEq('y[n+1] = ??').ok === false);
}

/* ================= ⑦ solveDiffEq：零输入闭式 ================= */
{
  const r = OS.solveDiffEq([-0.5, 1], [], [4]);
  // y[n+1] − 0.5y[n] = 0, y[0]=4 → y[n] = 4·0.5^n
  ok('zi y[0]=4', close(r.zi.evalN(0), 4, 1e-9), String(r.zi.evalN(0)));
  ok('zi y[3]=0.5', close(r.zi.evalN(3), 0.5, 1e-9), String(r.zi.evalN(3)));
  ok('zi tex 生成（前缀替换）', typeof r.zi.tex === 'string' && /y_\{zi\}\(n\)/.test(r.zi.tex), r.zi.tex);
  ok('极点 0.5 稳定', /稳定/.test(r.stableText), r.stableText);

  const r2 = OS.solveDiffEq([-2, 1], [], [1]);
  ok('不稳定判定（极点 z=2）', /不稳定/.test(r2.stableText), r2.stableText);
}

/* ================= ⑧ solveDiffEq：解析 vs 递推逐点对照 ================= */
{
  const rhs = TR.parseZCombo('u[n]');
  // 零状态：y[n+2] − 1.5y[n+1] + 0.5y[n] = u[n], ICs 0
  const rzs = OS.solveDiffEq([0.5, -1.5, 1], rhs, [0, 0]);
  const rec = OS.recurDiff([0.5, -1.5, 1], [0, 0], (m) => TR.xNumeric(rhs, m), 24);
  let maxZs = 0;
  for (let n = 0; n <= 24; n++) maxZs = Math.max(maxZs, Math.abs(rzs.zs.evalN(n) - rec[n]));
  ok('zs 解析 vs 递推（<1e-9）', maxZs < 1e-9, 'max=' + maxZs.toExponential(2));

  // 全解：非零初值 y[0]=0, y[1]=1
  const rfull = OS.solveDiffEq([0.5, -1.5, 1], rhs, [0, 1]);
  const recF = OS.recurDiff([0.5, -1.5, 1], [0, 1], (m) => TR.xNumeric(rhs, m), 24);
  let maxF = 0;
  for (let n = 0; n <= 24; n++) maxF = Math.max(maxF, Math.abs(rfull.full.evalN(n) - recF[n]));
  ok('全解解析 vs 递推（<1e-9）', maxF < 1e-9, 'max=' + maxF.toExponential(2));
  ok('全解 y[0] = 初值 0', close(rfull.full.evalN(0), 0, 1e-9), String(rfull.full.evalN(0)));
  ok('全解 y[1] = 初值 1', close(rfull.full.evalN(1), 1, 1e-9), String(rfull.full.evalN(1)));
  ok('分解一致：full = zi + zs（n=10）', close(rfull.full.evalN(10), rfull.zi.evalN(10) + rzs.zs.evalN(10), 1e-9));
}

/* ================= ⑨ 数据序列解析 ================= */
{
  const d1 = OS.parseDataSeq('1, 2.5, -3; 4\n5');
  ok('多分隔符解析', d1.ok && d1.values.length === 5 && close(d1.values[1], 2.5, 1e-12), JSON.stringify(d1));
  const d2 = OS.parseDataSeq('1, x, 3');
  ok('坏 token 定位', d2.ok === false && d2.badToken === 'x', JSON.stringify(d2));
  ok('空输入', OS.parseDataSeq('   ').ok === false);
}

/* ================= 结果输出 ================= */
console.log('\n通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (fails.length) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('✓ 方程求解内核全部通过');
}
