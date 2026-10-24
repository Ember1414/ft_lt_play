/* ============================================================
 * szmap.test.mjs — s↔z 三种映射测试（冲激不变 / ZOH / 双线性）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['assets/js/lib/util.js', 'assets/js/lib/mathdsp.js', 'assets/js/lib/transforms.js', 'assets/js/lib/blocksolve.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { DSP, BLKSOLVE } = sandbox;

let pass = 0;
const fails = [];
const ok = (n, c, extra) => { if (c) { pass++; return; } fails.push(n + (extra ? '  → ' + extra : '')); };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

/* ---------- Tustin 已知变换对：1/(s+1), T=0.1 → (z+1)/(21z−19) 归一化 ---------- */
{
  const r = BLKSOLVE.tustin([1], [1, 1], 0.1);
  ok('tustin ok', r.ok, r.note);
  ok('tustin 分母 z−19/21', r.d.length === 2 && near(r.d[1], -19 / 21, 1e-9), JSON.stringify(r.d));
  ok('tustin 分子 (1/21)(z+1)', r.n.length === 2 && near(r.n[0], 1 / 21, 1e-9) && near(r.n[1], 1 / 21, 1e-9), JSON.stringify(r.n));
  // 极点 = Möbius 映射 (1+pT/2)/(1−pT/2)（p=−1 → 0.90476 = e^{−T} 在小 T 时近似一致）
  const pole = -r.d[1];
  ok('tustin 极点=(1+pT/2)/(1−pT/2)', near(pole, (1 - 0.05) / (1 + 0.05), 1e-9));
  ok('tustin DC 增益守恒', near((r.n[0] + r.n[1]) / (r.d[0] + r.d[1]), 1, 1e-9));
  // 二阶对象也保持 DC 增益
  const r2 = BLKSOLVE.tustin([1], [1, 0.5, 1], 0.2);
  ok('tustin 二阶 DC 守恒', r2.ok && near((r2.n[0] + r2.n[1] + r2.n[2]) / (r2.d[0] + r2.d[1] + r2.d[2]), 1, 1e-9));
  ok('tustin 非法 T 拒绝', !BLKSOLVE.tustin([1], [1, 1], 0).ok);
}

/* ---------- 三种映射极点一致：s 极点 → z 极点 = e^{pT} ---------- */
{
  const T = 0.3;
  const num = [2], den = [1, 3, 2];   // 2/((s+1)(s+2))，s 极点 −1, −2
  const zPoles = (d) => DSP.polyRoots(d).map((q) => ({ re: q.re, im: q.im })).sort((a, b) => a.re - b.re);
  const expect = [{ re: Math.exp(-1 * T), im: 0 }, { re: Math.exp(-2 * T), im: 0 }].sort((a, b) => a.re - b.re);
  const m1 = BLKSOLVE.sToZ(num, den, T), m2 = BLKSOLVE.zohDiscretize(num, den, T), m3 = BLKSOLVE.tustin(num, den, T);
  ok('sToZ ok', m1.ok !== false);
  ok('zohDiscretize ok', m2.ok !== false);
  ok('tustin ok', m3.ok !== false);
  const cmp = (got, name) => {
    const zp = zPoles(got.d || got.den || got.d);
    ok(`${name} 极点=e^{pT}`, zp.length === 2 && zp.every((q, i) => near(q.re, expect[i].re, 1e-6) && near(q.im, expect[i].im, 1e-6)), JSON.stringify(zp));
  };
  cmp(m1, '冲激不变'); cmp(m2, 'ZOH');
  // 双线性极点为 Möbius 映射 z=(1+pT/2)/(1−pT/2)
  const zp3 = zPoles(m3.d);
  const mo = (p) => (1 + p * T / 2) / (1 - p * T / 2);
  ok('双线性极点=Möbius 映射', zp3.length === 2 && zp3.every((q, i) => near(q.re, [-1, -2].map(mo).sort((a, b) => a - b)[i], 1e-9) && near(Math.abs(q.im), 0, 1e-9)), JSON.stringify(zp3));
}

console.log(fails.length
  ? `✗ szmap ${pass} 通过，${fails.length} 失败:\n  ` + fails.join('\n  ')
  : `✓ szmap ${pass} 项全部通过`);
process.exit(fails.length ? 1 : 0);
