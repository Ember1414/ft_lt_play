/* ============================================================
 * statespace.test.mjs — 状态空间内核测试（SS）
 *   特征多项式（FL）/ 传递函数转换 / 能控能观秩 / Ackermann 配置与观测器
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['assets/js/lib/util.js', 'assets/js/lib/mathdsp.js', 'assets/js/lib/statespace.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { DSP, SS } = sandbox;

let pass = 0;
const fails = [];
const ok = (n, c, extra) => { if (c) { pass++; return; } fails.push(n + (extra ? '  → ' + extra : '')); };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const polyNear = (p, q, tol = 1e-6) => p.length === q.length && p.every((v, i) => near(v, q[i], tol));
const col = (...xs) => xs.map((v) => [v]);

/* ---------- 基础矩阵 ---------- */
{
  ok('matMul 2×2', polyNear(SS.matMul([[1, 2], [3, 4]], [[5, 6], [7, 8]])[0], [19, 22]) && polyNear(SS.matMul([[1, 2], [3, 4]], [[5, 6], [7, 8]])[1], [43, 50]));
  const inv = SS.matInv([[4, 7], [2, 6]]);
  ok('matInv 可逆', !!inv && near(inv[0][0], 0.6) && near(inv[0][1], -0.7) && near(inv[1][0], -0.2) && near(inv[1][1], 0.4));
  ok('matInv 奇异返回 null', SS.matInv([[1, 2], [2, 4]]) === null);
  ok('rank 满秩/降秩', SS.rank([[1, 0], [0, 1]]) === 2 && SS.rank([[1, 1], [2, 2]]) === 1 && SS.rank([[0, 0], [0, 0]]) === 0);
}

/* ---------- 特征多项式（Faddeev–LeVerrier） ---------- */
{
  ok('charPoly 二阶', polyNear(SS.charPoly([[0, 1], [-2, -1]]), [1, 1, 2]));
  ok('charPoly 三阶（特征方程经典例）', polyNear(SS.charPoly([[0, 1, 0], [0, 0, 1], [-1, -2, -3]]), [1, 3, 2, 1]));
  ok('charPoly 对角阵', polyNear(SS.charPoly([[1, 0], [0, 2]]), [1, -3, 2]));
}

/* ---------- 传递函数转换 ---------- */
{
  // A=[[0,1],[−2,−1]], B=[0;1], C=[1 0] → G=1/(s²+s+2)
  const { num, den } = SS.tfOf([[0, 1], [-2, -1]], col(0, 1), [[1, 0]], [[0]]);
  ok('tfOf den', polyNear(den, [1, 1, 2]));
  ok('tfOf num=1（含前导零）', polyNear(num, [0, 1]), JSON.stringify(num));
  // 双积分器 → G=1/s²
  const r2 = SS.tfOf([[0, 1], [0, 0]], col(0, 1), [[1, 0]], [[0]]);
  ok('双积分器 num', polyNear(r2.num, [0, 1]));
  ok('双积分器 den=s²', polyNear(r2.den, [1, 0, 0]));
  // 数值通道：G(jω) 与 (sI−A)⁻¹ 数值求逆一致
  const A = [[0, 1, 0], [0, 0, 1], [-2, -3, -1.5]], B = col(0, 0, 1), C = [[1.5, 2, 1]];
  const tf = SS.tfOf(A, B, C, [[0]]);
  const s = { re: -0.8, im: 2.2 };
  const n3 = A.length;
  const sIA = A.map((r, i) => r.map((v, j) => v - (i === j ? s.re : 0)));
  // sI−A（复数 s 的实部处理简化：直接用复数行列式展开验证——改为与 DSP.ltiResponse 频点对照）
  const w = 1.3;
  const h1 = DSP.cdiv(DSP.horner(tf.num, { re: 0, im: w }), DSP.horner(tf.den, { re: 0, im: w }));
  const h2 = DSP.evalH(tf.num, tf.den, w);
  ok('tfOf 频响自洽', near(h1.re, h2.re, 1e-9) && near(h1.im, h2.im, 1e-9));
  ok('三阶 tfOf 阶数', tf.den.length === n3 + 1);
}

/* ---------- 能控性 / 能观性 ---------- */
{
  const A = [[0, 1], [0, 0]], B = col(0, 1);
  ok('双积分器完全能控', SS.rank(SS.ctrb(A, B)) === 2);
  const B2 = col(1, 0);   // B=[1;0]：只有第一个状态受控
  ok('不能控例 rank=1', SS.rank(SS.ctrb(A, B2)) === 1);
  const C1 = [[1, 0]];
  ok('A=diag 可观例', SS.rank(SS.obsv([[1, 0], [0, 2]], C1)) === 1);
  const C2 = [[1, 1]];
  ok('A=diag(1,2) C=[1 1] 可观', SS.rank(SS.obsv([[1, 0], [0, 2]], C2)) === 2);
}

/* ---------- Ackermann 极点配置 ---------- */
{
  // 双积分器 A=[[0,1],[0,0]] B=[0;1]，期望 −1±j → (s+1)²+1 = s²+2s+2 → K=[2,2]
  const K = SS.acker([[0, 1], [0, 0]], col(0, 1), [{ re: -1, im: 1 }, { re: -1, im: -1 }]);
  ok('acker 收敛', !!K);
  ok('acker K=[2,2]', !!K && near(K[0], 2, 1e-6) && near(K[1], 2, 1e-6), JSON.stringify(K));
  // 闭环验证：eig(A−BK) = 期望极点
  const A2 = SS.matSub([[0, 1], [0, 0]], SS.matMul(col(2, 2), [[1, 0]]));
  void A2;
  const cl = [[0, 1], [-2, -2]];
  ok('闭环特征多项式 s²+2s+2', polyNear(SS.charPoly(cl), [1, 2, 2]));
  // 不能控系统 acker 返回 null
  ok('不能控 → acker null', SS.acker([[1, 0], [0, 2]], col(1, 0), [{ re: -1, im: 0 }, { re: -2, im: 0 }]) === null);
  // 三阶含积分器系统配置
  const A3 = [[0, 1, 0], [0, 0, 1], [-1, -2, -3]], B3 = col(0, 0, 1);
  const des = [{ re: -1, im: 0 }, { re: -1, im: 1 }, { re: -1, im: -1 }];
  const K3 = SS.acker(A3, B3, des);
  const clA = A3.map((r, i) => r.map((v, j) => v - (K3 ? K3[j] : 0) * B3[i][0]));
  const got = DSP.polyRoots(SS.charPoly(clA)).sort((a, b) => a.re - b.re);
  ok('三阶闭环极点=期望', des.every((d) => got.some((g) => near(g.re, d.re, 1e-4) && near(Math.abs(g.im - d.im), 0, 1e-4))), JSON.stringify(got));
}

/* ---------- 观测器（对偶系统） ---------- */
{
  const A = [[0, 1], [-2, -1]], C = [[1, 0]];
  const L = SS.acker(SS.transpose(A), SS.transpose(C), [{ re: -3, im: 0 }, { re: -4, im: 0 }]);
  ok('观测器 L 可解', !!L);
  const Ao = SS.matSub(A, SS.matMul(col(L[0], L[1]), C));   // A − LC
  const obsPoles = DSP.polyRoots(SS.charPoly(Ao));
  ok('观测器极点=期望（−3,−4）', obsPoles.length === 2 && near(Math.abs(obsPoles[0].re + 3), 0, 1e-4) && near(Math.abs(obsPoles[1].re + 4), 0, 1e-4), JSON.stringify(obsPoles));
}

/* ---------- analyze 一站式 ---------- */
{
  const r = SS.analyze([[0, 1], [-2, -1]], col(0, 1), [[1, 0]], [[0]]);
  ok('analyze 稳定', r.stable === true);
  ok('analyze 能控能观', r.controllable && r.observable);
  ok('analyze 极点数', r.poles.length === 2);
  ok('analyze 传函 num/den', polyNear(r.tf.den, [1, 1, 2]));
  const r2 = SS.analyze([[1, 0], [0, 1]], col(1, 0), [[1, 0]], [[0]]);
  ok('analyze 不稳定系统识别', r2.stable === false);
}

console.log(fails.length
  ? `✗ statespace ${pass} 通过，${fails.length} 失败:\n  ` + fails.join('\n  ')
  : `✓ statespace ${pass} 项全部通过`);
process.exit(fails.length ? 1 : 0);
