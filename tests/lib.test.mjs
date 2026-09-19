/* ============================================================
 * lib.test.mjs — 核心库回归断言（极简，无框架）
 *   运行：node tests/lib.test.mjs
 *   覆盖：util.js / mathdsp.js / transforms.js 中的纯函数。
 *   这三个库不依赖 DOM，可直接在 Node 中加载执行。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIBS = ['assets/js/lib/util.js', 'assets/js/lib/mathdsp.js', 'assets/js/lib/fx.js', 'assets/js/lib/transforms.js'];

// 极简沙箱：只需自引用的 window（各库末尾都写 window.X = X）
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of LIBS) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { U, DSP, TR, FX_LIB } = sandbox;

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? '  → ' + extra : ''));
}
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
function sorted(xs) { return xs.map((c) => c.re).concat().sort((a, b) => a - b); }

/* ---------- mathdsp: polyRoots ---------- */
{
  // 前导零（分子补零对齐后的常见输入）不得产生 NaN 根
  ok('polyRoots 前导零 [0,0,1] 无根', DSP.polyRoots([0, 0, 1]).length === 0);
  ok('polyRoots 全零 [0,0] 无根', DSP.polyRoots([0, 0]).length === 0);
  const r = DSP.polyRoots([0, 1, -3, 2]);          // 实际是 z²−3z+2
  ok('polyRoots 去零后 z²−3z+2 → {1,2}',
    r.length === 2 && near(sorted(r)[0], 1, 1e-3) && near(sorted(r)[1], 2, 1e-3),
    JSON.stringify(r));

  const rc = DSP.polyRoots([1, 0.5, 1.25]);         // 二阶欠阻尼：−0.25 ± j1.0897
  ok('polyRoots 复根共轭', rc.length === 2 && near(rc[0].re, -0.25, 1e-3)
    && near(Math.abs(rc[0].im), 1.08972, 1e-3)
    && near(rc[0].im, -rc[1].im, 1e-9), JSON.stringify(rc));
  ok('polyRoots 无 NaN', rc.every((c) => isFinite(c.re) && isFinite(c.im)));

  // 由根重构多项式应还原原系数
  const back = DSP.polyFromRoots(DSP.polyRoots([1, 3, 2]));
  ok('polyFromRoots 往返 [1,3,2]',
    back.length === 3 && near(back[0], 1, 1e-6) && near(back[1], 3, 1e-6) && near(back[2], 2, 1e-6),
    JSON.stringify(back));
}

/* ---------- mathdsp: FFT / spectrum / conv / ltiResponse / bode ---------- */
{
  // 单边幅度谱：cos(2π·3t)、fs=64、N=1024 → 3Hz 处峰值≈1
  const N = 1024, dt = 1 / 64;
  const y = Array.from({ length: N }, (_, i) => Math.cos(2 * Math.PI * 3 * i * dt));
  const sp = DSP.spectrum(y, dt);
  let bi = 0;
  for (let i = 1; i < sp.mag.length - 1; i++) if (sp.mag[i] > sp.mag[bi]) bi = i;
  ok('spectrum 峰值频率 ≈3Hz', near(sp.f[bi], 3, 0.1), 'f=' + sp.f[bi]);
  // 约定：|X(f)| 为幅度密度（对单位幅值余弦，单边峰值 = 幅值 × 总时长 T）
  ok('spectrum 单边峰值为密度约定 A·T', near(sp.mag[bi] / (N * dt), 1, 0.02), 'mag=' + sp.mag[bi]);

  const c = DSP.conv([1, 2, 3], [1, 1]);
  ok('conv [1,2,3]*[1,1] = [1,3,5,3]',
    c.length === 4 && c.every((v, i) => near(v, [1, 3, 5, 3][i])), JSON.stringify(c));

  // 一阶系统 1/(s+1) 的阶跃响应：y(t)=1−e^{−t}
  const sim = DSP.ltiResponse([1], [1, 1], (t) => (t >= 0 ? 1 : 0), 0, 5, 5000);
  const k = sim.t.findIndex((v) => v >= 1);
  ok('ltiResponse 一阶阶跃 y(1)≈1−e⁻¹', near(sim.y[k], 1 - Math.exp(-1), 2e-3), 'y=' + sim.y[k]);
  ok('ltiResponse 末值 ≈1−e⁻⁵', near(sim.y[sim.y.length - 1], 1 - Math.exp(-5), 2e-3),
    'y=' + sim.y[sim.y.length - 1]);

  // |1/(j·1 + 1)| = 1/√2 → −3.01 dB
  const b = DSP.bode([1], [1, 1], 0, 1, 400);
  const i1 = b.w.findIndex((w) => w >= 1);
  ok('bode |H(j1)| ≈ −3dB', near(b.mag[i1], -3.0103, 0.05), 'mag=' + b.mag[i1]);
}

/* ---------- util: polyTex（首项负号 / 跳零系数） ---------- */
{
  ok('polyTex 首项负号', U.polyTex([-1, -2]) === '-s-2', U.polyTex([-1, -2]));
  ok('polyTex 首项负系数', U.polyTex([-3, 1]) === '-3s+1', U.polyTex([-3, 1]));
  ok('polyTex 跳前导零系数', U.polyTex([0, 1]) === '1', U.polyTex([0, 1]));
  ok('polyTex 常规', U.polyTex([2, -4]) === '2s-4', U.polyTex([2, -4]));
  ok('polyTex 全零', U.polyTex([0, 0]) === '0', U.polyTex([0, 0]));
  ok('polyTex 单位系数', U.polyTex([1, 0, 1]) === 's^{2}+1', U.polyTex([1, 0, 1]));
}

/* ---------- transforms: 连续变换与反变换 ---------- */
{
  const items = TR.parseTimeCombo('2*exp(-3*t)*u(t)');
  ok('parseTimeCombo 解析指数项', !!items && items.length === 1 && items[0].kind === 'exp' && items[0].a === 3);
  const lap = TR.laplaceOfItems(items);
  ok('laplaceOfItems 2e^{-3t} → 2/(s+3)', lap.fsLine.indexOf('2') >= 0 && lap.fsLine.indexOf('s+3') >= 0, lap.fsLine);
  ok('FsNumeric 与解析式一致', near(TR.FsNumeric(items, 5), 2 / (5 + 3), 1e-9));
  ok('fNumeric t<0 为 0', TR.fNumeric(items, -1) === 0 && near(TR.fNumeric(items, 0), 2, 1e-9));

  // 1/(s+1)² 有重极点 s=−1（重数 2）→ f(t)=t·e^{−t}
  const pf = TR.partialFracGroups([1], [1, 2, 1]);
  ok('partialFracGroups 识别重极点', pf.ok && pf.groups.length === 1 && pf.groups[0].m === 2,
    JSON.stringify(pf.groups && pf.groups.map((g) => g.m)));
  ok('evalLaplaceGroups 重极点 → t·e^{−t}', near(TR.evalLaplaceGroups(pf.groups, 1), Math.exp(-1), 1e-6));

  const il = TR.invLaplace([1], [1, 2]);
  ok('invLaplace 1/(s+2) → e^{−2t}u(t)', near(il.evalT(1), Math.exp(-2), 1e-6), il.tex);
  ok('invLaplace tex 含 u(t)', /u\(t\)/.test(il.tex));

  // 1/(z−0.5) = z⁻¹/(1−0.5z⁻¹) → h(n)=0.5^{n−1} (n≥1)
  const iz = TR.invZ([1], [1, -0.5]);
  ok('invZ 1/(z−0.5) → 0.5^{n−1}', near(iz.evalN(1), 1, 1e-9) && near(iz.evalN(3), 0.25, 1e-9),
    JSON.stringify([iz.evalN(1), iz.evalN(3)]));
}

/* ---------- 增补：符号参数提取与代入 ---------- */
{
  const ps = FX_LIB.extractParams('(s+z)/(s+p)');
  ok('extractParams 提取 z/p', ps.length === 2 && ps[0] === 'z' && ps[1] === 'p', JSON.stringify(ps));
  ok('extractParams 排除 s/函数名', FX_LIB.extractParams('s*sin(s*w)/s').length === 1 && FX_LIB.extractParams('s*sin(s*w)/s')[0] === 'w', JSON.stringify(FX_LIB.extractParams('s*sin(s*w)/s')));
  ok('extractParams 排除 pi/e', FX_LIB.extractParams('pi*s+e*z').join(',') === 'z', JSON.stringify(FX_LIB.extractParams('pi*s+e*z')));
  const sub = FX_LIB.substituteParams('wn*wn', { wn: 2 });
  ok('substituteParams 代入', FX_LIB.parseTF(sub).num[0] === 4, sub);
  const sub2 = FX_LIB.substituteParams('s^2+2*z*wn*s+wn*wn', { z: 0.25, wn: 3 });
  const t2 = FX_LIB.parseTF(sub2);
  ok('substituteParams 二阶模板', t2 && t2.num[0] === 1 && Math.abs(t2.num[1] - 1.5) < 1e-9 && t2.num[2] === 9, JSON.stringify(t2 && t2.num));
  ok('substituteParams 保留未知标识符', FX_LIB.substituteParams('s+z', {}) === 's+z');
  ok('substituteParams 幂等（数值不变）', FX_LIB.parseTF(FX_LIB.substituteParams('1/(s^2+2*s+5)', {})).den[2] === 5);
}

/* ---------- 结果输出 ---------- */
console.log('\n通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (fails.length) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('✓ 全部断言通过');
}
