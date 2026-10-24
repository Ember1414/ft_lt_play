/* ============================================================
 * parity.mjs — v1 ↔ v2 内核数值对拍（Batch A：math/complex/poly/expr/utf8/dsp/statespace；
 *              Batch B：signals/parse/transforms；Batch C：blocksolve/odesolve/experiment）
 *
 * 机制：v1 内核用 vm 沙箱加载（与 tests/*.mjs 相同）；v2 内核经 esbuild
 *       打包为 ESM 后动态 import；用同一批确定性输入分别调用两边，深度比较输出。
 * 红线：数值语义必须一致（浮点相对容差 1e-9；NaN/±Infinity 按位等价判断）。
 * 扩展：Batch B/C 迁移（transforms/blocksolve/odesolve）时在 CASES 中追加用例。
 *
 * 运行：node scripts/parity.mjs   （或 npm run parity）
 * ============================================================ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const v2Root = path.resolve(here, '..');
const repoRoot = path.resolve(v2Root, '..');

/* ---------- 1) 加载 v1 内核（vm 沙箱） ---------- */
const sandbox = { console };
sandbox.window = sandbox;
sandbox.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
sandbox.atob = (s) => Buffer.from(s, 'base64').toString('binary');
vm.createContext(sandbox);
/* v1 已归档至 legacy/v1（只读 fixture，2026-10 迁移；见 docs/v2/改进计划.md A2） */
const V1_ROOT = path.join(repoRoot, 'legacy', 'v1');
for (const f of [
  'assets/js/lib/util.js',
  'assets/js/lib/mathdsp.js',
  'assets/js/lib/statespace.js',
  'assets/js/lib/fx.js',
  'assets/js/lib/transforms.js',
  'assets/js/lib/blocksolve.js',
  'assets/js/lib/odesolve.js',
  'assets/js/lib/project.js',
]) {
  vm.runInContext(fs.readFileSync(path.join(V1_ROOT, f), 'utf8'), sandbox, { filename: f });
}
const V1 = {
  U: sandbox.U,
  DSP: sandbox.DSP,
  SS: sandbox.SS,
  TR: sandbox.TR,
  FX: sandbox.FX_LIB,
  BLKSOLVE: sandbox.BLKSOLVE,
  ODE: sandbox.ODE,
  PX: sandbox.PX,
};

/* ---------- 2) 打包 v2 内核并 import ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-v2-parity-'));
const outfile = path.join(tmp, 'core.mjs');
await build({
  entryPoints: [path.join(v2Root, 'src/core/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  outfile,
  logLevel: 'silent',
});
const core = await import(pathToFileURL(outfile).href);
const V2 = {
  U: core,
  DSP: core,
  SS: core,
  TR: core,
  FX: core,
  BLKSOLVE: core,
  ODE: core,
  PX: core,
};

/* ---------- 比较工具 ---------- */
function deep(a, b, where, diffs, tol = 1e-9) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return;
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      if (a !== b) diffs.push(`${where}: v1=${a} v2=${b}`);
      return;
    }
    const rel = Math.abs(a - b) / Math.max(1, Math.abs(b));
    if (rel > tol) diffs.push(`${where}: v1=${a} v2=${b}（相对差 ${rel.toExponential(2)}）`);
    return;
  }
  if (a === b) return;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      diffs.push(`${where}: 数组不匹配（len ${a && a.length} vs ${b && b.length}）`);
      return;
    }
    for (let i = 0; i < a.length; i++) deep(a[i], b[i], `${where}[${i}]`, diffs, tol);
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.join(',') !== kb.join(',')) {
      diffs.push(`${where}: 键集合不同 [${ka}] vs [${kb}]`);
      return;
    }
    for (const k of ka) deep(a[k], b[k], `${where}.${k}`, diffs, tol);
    return;
  }
  diffs.push(`${where}: v1=${JSON.stringify(a)} v2=${JSON.stringify(b)}`);
}

function callSafe(fn) {
  try {
    return { value: fn(), err: null };
  } catch (e) {
    return { value: undefined, err: String(e && e.message ? e.message : e) };
  }
}

/* ---------- 固定种子伪随机（保证两边输入一致） ---------- */
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/* ---------- 用例表 ---------- */
const LP = 'π';

const CASES = [
  /* —— U / math / complex / poly / expr / utf8 —— */
  ['math.fmt', (L) => [L.U.fmt(0.5), L.U.fmt(1234.567), L.U.fmt(1e-5), L.U.fmt(0), L.U.fmt(3.14159, 2), L.U.fmt(-0.0001), L.U.fmt(NaN)]],
  ['math.clamp/lerp/mapRange/toDb/fitRange', (L) => [
    L.U.clamp(5, 0, 3), L.U.clamp(-1, 0, 3), L.U.lerp(2, 8, 0.25), L.U.mapRange(5, 0, 10, 100, 200),
    L.U.toDb(0.5), L.U.toDb(0), L.U.fitRange(0, 0), L.U.fitRange(-3, 9),
  ]],
  ['poly.polyMul/polyAdd/polyTex', (L) => [
    L.U.polyMul([1, 2], [1, -3, 2]), L.U.polyAdd([1, 2, 3], [1]), L.U.polyAdd([1], [1, 2, 3]),
    L.U.polyTex([1, 2, 1]), L.U.polyTex([-1, 0, 2]), L.U.polyTex([0, 0, 0]), L.U.polyTex([2, -3, 0.5, 0]), L.U.polyTex([1, 0, 1], 'z'),
  ]],
  ['complex.add/mul/exp/polar/angle/mag', (L) => [
    L.U.cadd({ re: 1, im: 2 }, { re: 3, im: -1 }), L.U.cscale({ re: 2, im: -3 }, 1.5),
    L.U.cmul({ re: 1, im: 2 }, { re: -2, im: 0.5 }), L.U.cexp(1.2), L.U.polar(2, 0.7),
    L.U.angle({ re: 1, im: 1 }), L.U.mag({ re: 3, im: 4 }),
  ]],
  ['expr.normChars', (L) => ['２＋３×４', 'ｓ²＋２ｓ＋１', '（１＋２）', 'a**2', 'x\u2013y', 'π', '　　1，2。3'].map((s) => L.U.normChars(s))],
  ['expr.safeCalc 合法', (L) => ['2(3)', '(1+2)(3+4)', '2pi', '1e-3', 'π*2', '3%2', '2^3^2', '-2^2', '1.5e2+0.5'].map((s) => L.U.safeCalc(s))],
  ['expr.safeCalc 非法（异常消息需一致）', (L) => ['2/(1-1)', 'sin(1)', '2+', '(1+2', '1/0', '(1+(2+(3+(4+(5+(6+(7+(8))))))))'].map((s) => {
    try { return { v: L.U.safeCalc(s) }; } catch (e) { return { err: e.message }; }
  })],
  ['utf8 往返', (L) => {
    const src = '信号与控制 · ẋ=A x+B u · 🎛';
    return [L.U.utf8Encode(src).length, L.U.utf8Decode(L.U.utf8Encode(src)) === src];
  }],

  /* —— DSP 多项式 / 变换 —— */
  ['DSP.horner/cdiv', (L) => [
    L.DSP.horner([1, 2, 10], { re: 1, im: 1 }), L.DSP.cdiv({ re: 1, im: 2 }, { re: 3, im: 4 }),
    L.DSP.cdiv({ re: 1, im: 0 }, { re: 0, im: 0 }),
  ]],
  ['DSP.polyRoots 典型', (L) => [[1, 2, 10], [1, 2, 2, 1], [0, 1, -3, 2], [1, 0.5, 1.25], [0, 0], [1], [1, -1.5, 0.5, -0.1], [2, 0, -8]].map((c) => L.DSP.polyRoots(c))],
  ['DSP.polyFromRoots 往返', (L) => [L.DSP.polyFromRoots(L.DSP.polyRoots([1, 3, 2])), L.DSP.polyFromRoots(L.DSP.polyRoots([1, 0, 4]), 2)]],
  ['DSP.fft/ifft', (L) => {
    const re = [1, 0.5, -0.25, 2, 0, -1, 0.75, 0.1];
    const im = [0, 0.1, 0, -0.2, 0.3, 0, 0, 0.05];
    const f = L.DSP.fft(re.slice(), im.slice());
    const back = L.DSP.ifft(f.re.slice(), f.im.slice());
    return [f, back];
  }],
  ['DSP.spectrum', (L) => {
    const N = 256, dt = 1 / 64;
    const y = Array.from({ length: N }, (_, i) => Math.cos(2 * Math.PI * 3 * i * dt) + 0.4 * Math.sin(2 * Math.PI * 9 * i * dt));
    return L.DSP.spectrum(y, dt);
  }],
  ['DSP.dftPhasors', (L) => L.DSP.dftPhasors([{ re: 1, im: 0 }, { re: 0, im: 1 }, { re: -1, im: 0 }, { re: 0, im: -1 }])],
  ['DSP.integrate/conv', (L) => [
    L.DSP.integrate(Math.sin, 0, Math.PI, 1000), L.DSP.integrate((x) => x * x, 0, 3, 2001),
    L.DSP.conv([1, 2, 3], [1, 1]), L.DSP.conv([0.5, -0.25], [1, 0, 2, 0, -1]),
  ]],
  ['DSP.deconv', (L) => {
    const h = [1, 0.5, 0.25];
    const xTrue = [1, 2, -1, 0.5, 0, 1.5];
    const y = L.DSP.conv(xTrue, h);
    return L.DSP.deconv(y, h);
  }],
  ['DSP.window', (L) => ['rect', 'hamming', 'hanning', 'blackman'].map((t) => L.DSP.window(t, 8))],
  ['DSP.iir1', (L) => [L.DSP.iir1([1, 2, 3, 4, 5], 0.3), L.DSP.iir1([1, -1, 1, -1], 0), L.DSP.iir1([1, 1, 1], 2)]],
  ['DSP.ltiResponse', (L) => [
    L.DSP.ltiResponse([10], [1, 2, 10], () => 1, 0, 5, 600),
    L.DSP.ltiResponse([1, 0], [1, 3, 3, 1], (t) => Math.sin(t), 0, 4, 400),
  ]],
  ['DSP.evalH/bode', (L) => [L.DSP.evalH([10], [1, 2, 10], 1.5), L.DSP.bode([10], [1, 2, 10]), L.DSP.bode([1, 0], [1, 3, 3, 1], -1, 2, 60)]],

  /* —— DSP 分析类 —— */
  ['DSP.closedLoopMetrics', (L) => [
    L.DSP.closedLoopMetrics([10], [1, 2, 10]),
    L.DSP.closedLoopMetrics([1], [1, -1, 0]),
    L.DSP.closedLoopMetrics([1, 0], [1, 2, 3]),
  ]],
  ['DSP.errSeries', (L) => [L.DSP.errSeries([10], [1, 2, 10]), L.DSP.errSeries([1, 0], [1, 2, 10]), L.DSP.errSeries([1, 1, 1], [1, 1, 1])]],
  ['DSP.steadyState', (L) => [
    L.DSP.steadyState([10], [1, 2, 10]),
    L.DSP.steadyState([5], [1, 2, 0]),
    L.DSP.steadyState([5], [1, 2, 0, 0]),
    L.DSP.steadyState([1, 0], [1, 3, 2, 0, 0]),
  ]],
  ['DSP.nyquistFull', (L) => [
    L.DSP.nyquistFull([1], [1, 2, 2, 1]),
    L.DSP.nyquistFull([1], [1, 2, 3]),
    L.DSP.nyquistFull([1], [1, -1]),
    L.DSP.nyquistFull([1, 0], [1, 2, 1, 0]),
  ]],
  ['DSP.jury', (L) => [[1, -1.5, 0.5], [1, -2, 1.1], [-1, 0.5], [1, 0.5], [1, -0.3, 0.02, -0.001]].map((a) => L.DSP.jury(a))],
  ['DSP.errMetrics', (L) => L.DSP.errMetrics([0, 0.1, 0.2, 0.3], [1, 0.5, 0.2, 0.05])],

  /* —— DSP 控制 —— */
  ['DSP.pidLoopSim', (L) => [
    L.DSP.pidLoopSim([1], [1, 1], { kp: 2 }, { tmax: 5, steps: 500 }),
    L.DSP.pidLoopSim([1], [1, 2, 1], { kp: 3, ki: 2, kd: 0.5, Tf: 0.1 }, { tmax: 6, steps: 600, uMax: 5, aw: 'back', Tt: 1 }),
    L.DSP.pidLoopSim([1], [1, 1], { kp: 1, ki: 1 }, { tmax: 4, steps: 400, Ts: 0.2, dSeq: [0, 0, 1, 0, 0, 0, 0, 0] }),
    L.DSP.pidLoopSim([1], [1, 2, 1], { kp: 2, ki: 1, kd: 0.2, dOnM: true }, { tmax: 5, steps: 500, aw: 'clamp', uMax: 3 }),
  ]],
  ['DSP.znUltimate', (L) => [L.DSP.znUltimate([1], [1, 3, 3, 1]), L.DSP.znUltimate([1], [1, 2, 1])]],
  ['DSP.fopdtFit', (L) => {
    const r = L.DSP.ltiResponse([1], [3, 1], () => 1, 0, 10, 400);
    return L.DSP.fopdtFit(r.t, r.y);
  }],
  ['DSP.pidOptimize', (L) => L.DSP.pidOptimize([1], [1, 2, 1], 'ise', { kp: 1, ki: 0.5, kd: 0 }, { maxSims: 60, tmax: 6, steps: 300 })],
  ['DSP.rootLocus', (L) => [
    L.DSP.rootLocus([1, 0], [1, 3, 2, 0]),
    L.DSP.rootLocus([1, 2], [1, 1]),
    L.DSP.rootLocus([1], [1, 6, 11, 6]),
  ]],

  /* —— SS 状态空间 —— */
  ['SS.matrix 基础', (L) => [
    L.SS.matI(3), L.SS.matMul([[1, 2], [3, 4]], [[0, 1], [1, 0]]),
    L.SS.matAdd([[1, 2], [3, 4]], [[1, 1], [1, 1]]), L.SS.matSub([[1, 2], [3, 4]], [[1, 1], [1, 1]]),
    L.SS.transpose([[1, 2, 3], [4, 5, 6]]), L.SS.matVec([[1, 2], [3, 4]], [1, 1]),
  ]],
  ['SS.matInv/rank', (L) => [
    L.SS.matInv([[1, 2], [3, 4]]), L.SS.matInv([[1, 2], [2, 4]]), L.SS.matInv([[2, 0, 0], [0, 3, 0], [0, 0, 4]]),
    L.SS.rank([[1, 2], [2, 4]]), L.SS.rank([[1, 2], [3, 4]]), L.SS.rank([[1, 2, 3], [4, 5, 6], [7, 8, 9]]),
  ]],
  ['SS.charPoly/tfOf', (L) => {
    const A = [[0, 1], [-2, -3]];
    const B = [[0], [1]];
    const C = [[1, 0]];
    return [L.SS.charPoly(A), L.SS.charPoly([[0, 1, 0], [0, 0, 1], [-6, -11, -6]]), L.SS.tfOf(A, B, C), L.SS.tfOf(A, B, C, [[1]])];
  }],
  ['SS.ctrb/obsv/acker', (L) => {
    const A = [[0, 1], [-2, -3]];
    const B = [[0], [1]];
    const C = [[1, 0]];
    return [
      L.SS.ctrb(A, B), L.SS.obsv(A, C),
      L.SS.acker(A, B, [{ re: -2, im: 0 }, { re: -3, im: 0 }]),
      L.SS.acker(A, B, [{ re: -2, im: 0 }]),
    ];
  }],
  ['SS.analyze', (L) => L.SS.analyze([[0, 1], [-2, -3]], [[0], [1]], [[1, 0]])],

  /* —— Batch B：TR 变换引擎 —— */
  ['TR.parseTimeCombo 典型', (L) => ['2*exp(-3t)u(t)', 'exp(-2t)+3t^2', 'sin(2*pi*t)u(t)+cos(t)', '5', 't^3*exp(-t)u(t)', '2*e^{-2t}u(t)', '3u(t)', '0.5*sin(π t)'].map((s) => L.TR.parseTimeCombo(s))],
  ['TR.laplaceOfItems', (L) => [L.TR.laplaceOfItems(L.TR.parseTimeCombo('2*exp(-3t)u(t)+sin(2*t)u(t)')), L.TR.laplaceOfItems(L.TR.parseTimeCombo('-t^2*exp(-t)+3'))]],
  ['TR.fourierOfItems', (L) => ['2*exp(-3t)u(t)', 'sin(2t)u(t)+cos(3t)', 't^2*exp(-t)+u(t)'].map((s) => L.TR.fourierOfItems(L.TR.parseTimeCombo(s)))],
  ['TR.fNumeric/FsNumeric', (L) => {
    const its = L.TR.parseTimeCombo('exp(-2t)+3t^2+sin(2t)');
    return [0, 0.3, 1.2, 3.5].map((t) => L.TR.fNumeric(its, t)).concat([0.5, 1, 2].map((s) => L.TR.FsNumeric(its, s)));
  }],
  ['TR.parseZCombo', (L) => ['2*0.5^n*u[n]', 'n*u[n]+3delta[n]', 'cos(pi*n)u[n]', 'n*2^n*u[n]', '0.5^n', 'u(n)', 'delta[n]', '3'].map((s) => L.TR.parseZCombo(s))],
  ['TR.zOfItems/xNumeric/XzNumeric', (L) => {
    const its = L.TR.parseZCombo('0.8^n*u[n]+n*u[n]');
    return [L.TR.zOfItems(its), [0, 1, 2, 3, 5].map((n) => L.TR.xNumeric(its, n)), [1.2, 2.5].map((z) => L.TR.XzNumeric(its, z, 0.8))];
  }],
  ['TR.partialFracGroups', (L) => [[[1], [1, 3, 2]], [[1], [1, 2, 1]], [[1, 0], [1, 0.5, 1.25]], [[1], [1, 0, 1]], [[2, 3], [1, 3, 3, 1]], [[1], [1, 1]], [[0], [1, 1]]].map(([n, d]) => L.TR.partialFracGroups(n, d))],
  ['TR.evalLaplaceGroups/texGroups', (L) => {
    const pf = L.TR.partialFracGroups([1], [1, 3, 2]);
    const pf2 = L.TR.partialFracGroups([1], [1, -1.5, 0.5]);
    return [[0, 0.5, 2].map((t) => L.TR.evalLaplaceGroups(pf.groups, t)), L.TR.texLaplaceGroups(pf.groups), L.TR.texZGroups(pf2.groups)];
  }],
  ['TR.invLaplace', (L) => [[[1], [1, 3, 2]], [[1], [1, 2, 1]], [[1, 0], [1, 0.5, 1.25]], [[2, 1], [1, 3, 3, 1]]].map(([n, d]) => {
    const r = L.TR.invLaplace(n, d);
    return [r.tex, r.note, r.evalT ? [0.5, 1.5].map((t) => r.evalT(t)) : null];
  })],
  ['TR.invZ', (L) => [[[1], [1, -1.5, 0.5]], [[1, 0], [1, -1, 0.5]], [[1], [1, -0.5]]].map(([n, d]) => {
    const r = L.TR.invZ(n, d);
    return [r.tex, r.note, r.evalN ? [1, 2, 3].map((k) => r.evalN(k)) : null];
  })],
  ['TR.propVerify', (L) => ['shift', 'freq', 'scale', 'diff'].map((p) => L.TR.propVerify(L.TR.parseTimeCombo('exp(-2t)+sin(3t)'), p, 0.5))],
  ['TR.rocs', (L) => [[[1], [1, 3, 2]], [[1], [1, 0, 1]], [[1], [1, -1, -2]], [[1], [1, 0, 0]]].map(([n, d]) => L.TR.rocs(n, d))],

  /* —— Batch B：FX 解析与信号目录 —— */
  ['FX.parsePoly', (L) => ['s^2+2*s+5', '(s+2)*(s+3)', '(s+1)^3', '2*s^2-3s+1', 's', '5', '(s+1)(s-1)', 's^2+2s+5', 'z^2-1.5z+0.5', '2(s+1)'].map((s) => L.FX.parsePoly(s))],
  ['FX.parsePoly 非法', (L) => ['s^2++1', '(s+1', 's^a', ')s(', '', null].map((s) => L.FX.parsePoly(s))],
  ['FX.parseTF', (L) => ['10/(s^2+2s+10)', '(s+1)/(s^2+3s+2)', '1/s', '(0.9s)/(s^2+0.4s+1.21)', '5', '0/1'].map((s) => L.FX.parseTF(s))],
  ['FX.parseTFFields/tfToFields', (L) => [L.FX.parseTFFields('10', 's^2+2s+10'), L.FX.parseTFFields('10/(s+1)', ''), L.FX.parseTFFields('', ''), L.FX.tfToFields('10/(s^2+2s+10)'), L.FX.tfToFields('(s+1)/((s+2)(s+3))')]],
  ['FX.extractParams/substituteParams', (L) => [L.FX.extractParams('a*s^2+b*s+c'), L.FX.extractParams('Kp*s/(T*s+1)', ['s']), L.FX.substituteParams('a*s+2', { a: 3.5 }), L.FX.substituteParams('a*s+b', { a: 2 })]],
  ['FX.parseTimeExpr 合法', (L) => ['2t+1', 'exp(-t)*sin(2*pi*t)', '3(t+1)', '(t+1)(t-1)', '2sin(t)+u(t-1)', 'sinc(t)+tri(2t)', 'heaviside(t)', '2pi*t', 't^2+%3', 'sqrt(abs(t))'].map((s) => {
    const f = L.FX.parseTimeExpr(s);
    return f ? [0, 0.5, 1.7, 3].map((t) => f(t)) : null;
  })],
  ['FX.parseTimeExpr 边界', (L) => ['sqrt(', 'foo(t)', 't+', 'sin(1,2,3)', 'max(1,t)', 'log(t,2)', '', 't'.repeat(400)].map((s) => {
    const f = L.FX.parseTimeExpr(s);
    return f ? [1, 2].map((t) => f(t)) : 'null';
  })],
  ['FX.shapePoints', (L) => ['square', 'heart', 'star', 'gear', 'spiral', 'triangle', 'butterfly'].map((k) => L.FX.shapePoints(k, 64))],
  ['FX.customShapePoints', (L) => L.FX.customShapePoints([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }], 32)],
  ['FX.ftSignals 波形与参数', (L) => L.FX.ftSignals.map((s) => {
    const ps = s.params();
    const p = {};
    for (const q of ps) p[q.k] = q.v;
    return [s.id, s.name, s.t0, s.t1, [s.t0, (s.t0 + s.t1) / 2, s.t1].map((t) => s.f(p, t)), ps.map((q) => [q.k, q.min, q.max, q.v, q.fmt(q.v)])];
  })],
  ['FX.laplacePresets', (L) => Object.keys(L.FX.laplacePresets).map((k) => [k, L.FX.laplacePresets[k].name, L.FX.laplacePresets[k].num, L.FX.laplacePresets[k].den, L.FX.laplacePresets[k].tex])],

  /* —— Batch C：BLKSOLVE 框图求解 —— */
  ['BLKSOLVE 多项式工具', (L) => [
    L.BLKSOLVE.pTrim([0, 0, 1, 2]), L.BLKSOLVE.pTrim([0]),
    L.BLKSOLVE.polyDivMod([1, 3, 2], [1, 1]), L.BLKSOLVE.polyDivMod([1, 2], [1, 3, 2]),
    L.BLKSOLVE.polyGCD([1, 3, 2], [1, 1]), L.BLKSOLVE.polyGCD([1, 5, 6], [1, 2]),
    L.BLKSOLVE.freduce({ n: [1, 3, 2], d: [1, 1] }), L.BLKSOLVE.freduce({ n: [0], d: [1, 2] }),
  ]],
  ['BLKSOLVE.parseBlockTF', (L) => [['1/(s+1)', 's'], ['10/(s^2+2s+10)', 's'], ['1/(z-0.5)', 'z'], ['(s+1)/(s^2+3s+2)', 's'], ['s/(s+1)', 's'], ['', 's'], ['1/s^2', 's']].map((p) => L.BLKSOLVE.parseBlockTF(p[0], p[1]))],
  ['BLKSOLVE.solveTransfer 拓扑（开环/反馈/双环/无输出/代数环）', (L) => {
    const open = [
      { id: 1, kind: 'box', f: { n: [1], d: [1, 1] }, src: true },
      { id: 2, kind: 'box', f: { n: [2], d: [1, 2] }, out: true },
    ];
    const eOpen = [{ from: 1, to: 2, sign: 1 }];
    const fb = [
      { id: 1, kind: 'sum', f: { n: [1], d: [1] }, src: true },
      { id: 2, kind: 'box', f: { n: [10], d: [1, 2, 10] }, out: true },
    ];
    const eFb = [{ from: 1, to: 2, sign: 1 }, { from: 2, to: 1, sign: -1 }];
    const two = [
      { id: 1, kind: 'sum', f: { n: [1], d: [1] }, src: true },
      { id: 2, kind: 'box', f: { n: [1], d: [1, 0] } },
      { id: 3, kind: 'box', f: { n: [2], d: [1, 1] }, out: true },
    ];
    const eTwo = [{ from: 1, to: 2, sign: 1 }, { from: 2, to: 3, sign: 1 }, { from: 3, to: 1, sign: -1 }];
    const noOut = [
      { id: 1, kind: 'sum', f: { n: [1], d: [1] }, src: true },
      { id: 2, kind: 'box', f: { n: [1], d: [1, 1] } },
    ];
    const eNoOut = [{ from: 1, to: 2, sign: 1 }, { from: 2, to: 1, sign: -1 }];
    const alg = [
      { id: 1, kind: 'box', f: { n: [1], d: [1] }, src: true },
      { id: 2, kind: 'box', f: { n: [1], d: [1] }, out: true },
    ];
    const eAlg = [{ from: 1, to: 2, sign: 1 }, { from: 2, to: 1, sign: 1 }];
    return [
      L.BLKSOLVE.solveTransfer(open, eOpen),
      L.BLKSOLVE.solveTransfer(fb, eFb),
      L.BLKSOLVE.solveTransfer(two, eTwo),
      L.BLKSOLVE.solveTransfer(noOut, eNoOut),
      L.BLKSOLVE.solveTransfer(alg, eAlg),
      L.BLKSOLVE.solveTransfer([], []),
      L.BLKSOLVE.solveTransfer([{ id: 1, kind: 'box', f: null, err: true }], []),
    ];
  }],
  ['BLKSOLVE.deriveReadout/deriveZReadout', (L) => [
    L.BLKSOLVE.deriveReadout({ n: [10], d: [1, 2, 10] }),
    L.BLKSOLVE.deriveReadout({ n: [1], d: [1, -1] }),
    L.BLKSOLVE.deriveReadout({ n: [1], d: [1, 0, 1] }),
    L.BLKSOLVE.deriveReadout(null),
    L.BLKSOLVE.deriveZReadout({ n: [1, 0], d: [1, -1.5, 0.5] }),
    L.BLKSOLVE.deriveZReadout({ n: [1], d: [1, -1.2] }),
    L.BLKSOLVE.deriveZReadout({ n: [1], d: [1, -1] }),
  ]],
  ['BLKSOLVE.sToZ/zohDiscretize/tustin', (L) => [
    L.BLKSOLVE.sToZ([1], [1, 1], 0.1), L.BLKSOLVE.sToZ([1], [1, 2, 10], 0.05), L.BLKSOLVE.sToZ([1], [1], 0.1),
    L.BLKSOLVE.sToZ([1], [1, 1], -1),
    L.BLKSOLVE.zohDiscretize([1], [1, 1], 0.1), L.BLKSOLVE.zohDiscretize([1], [1, 2, 10], 0.05),
    L.BLKSOLVE.tustin([1], [1, 1], 0.1), L.BLKSOLVE.tustin([1, 0], [1, 2, 10], 0.05),
  ]],
  ['BLKSOLVE.analyzeSampled/solveSampled', (L) => {
    const zOnly = [{ id: 1, kind: 'box', dom: 'z', f: { n: [1], d: [1, -0.5] }, src: true, out: true }];
    const sOnly = [{ id: 1, kind: 'box', f: { n: [1], d: [1, 1] }, src: true, out: true }];
    const sampled = [
      { id: 1, kind: 'sum', f: { n: [1], d: [1] }, src: true },
      { id: 2, kind: 'sample', f: null },
      { id: 3, kind: 'box', f: { n: [1], d: [1, 1] }, out: true },
      { id: 4, kind: 'sample', f: null },
    ];
    const eSampled = [
      { from: 1, to: 2, sign: 1 },
      { from: 2, to: 3, sign: 1 },
      { from: 3, to: 4, sign: 1 },
      { from: 4, to: 1, sign: -1 },
    ];
    const bad = [
      { id: 1, kind: 'box', f: { n: [1], d: [1, 1] }, src: true, out: true },
      { id: 2, kind: 'sample', f: null },
    ];
    return [
      L.BLKSOLVE.analyzeSampled(zOnly, [], 0.1),
      L.BLKSOLVE.analyzeSampled(sOnly, [], 0.1),
      L.BLKSOLVE.analyzeSampled(sampled, eSampled, 0.1),
      L.BLKSOLVE.solveSampled(zOnly, [], 0.1),
      L.BLKSOLVE.solveSampled(sampled, eSampled, 0.1),
      L.BLKSOLVE.analyzeSampled(bad, [{ from: 1, to: 2, sign: 1 }], 0.1),
      L.BLKSOLVE.analyzeSampled(zOnly, [], -1),
    ];
  }],

  /* —— Batch C：ODE 方程求解 —— */
  ['ODE.parseODE', (L) => ["y''+3y'+2y = u(t)", "y' + y = exp(-2t)", 'y"=sin(2t)+3t^2', "y''''+y=0", 'y+y=1', "y'+y", 'y^(2)+y=0', "y''+3y'+2y = 5"].map((s) => L.ODE.parseODE(s))],
  ['ODE.solveODE 通道（zi/zs/full + 求值）', (L) => {
    const r = L.ODE.parseODE("y''+3y'+2y = u(t)");
    const sol = L.ODE.solveODE(r.a, r.rhsItems, [0, 0]);
    const ev = (ch, ts) => (ch.evalT ? ts.map((t) => ch.evalT(t)) : null);
    return [
      sol.n, sol.A, sol.P, sol.F, sol.zi.tex, sol.zs.tex, sol.full.tex, sol.stableText, sol.note,
      ev(sol.full, [0, 0.5, 1, 2]), ev(sol.zi, [0, 1, 2]), ev(sol.zs, [0.5, 1.5]),
    ];
  }],
  ['ODE.solveODE 初值不足 / 非法', (L) => {
    const r = L.ODE.parseODE("y''+2y'=0");
    const sol = L.ODE.solveODE(r.a, r.rhsItems, [1]);
    return [sol.note, sol.zi.tex, sol.full.tex];
  }],
  ['ODE.simulateODE RK4', (L) => {
    const r = L.ODE.parseODE("y''+3y'+2y = 1");
    const sim = L.ODE.simulateODE(r.a, () => 1, [0, 0], 0, 3, 600);
    const idx = [0, 60, 120, 300, 600];
    return [idx.map((i) => sim.t[i]), idx.map((i) => sim.y[i])];
  }],
  ['ODE.parseDiffEq/solveDiffEq/recurDiff', (L) => {
    const r = L.ODE.parseDiffEq('y[n+2] - 1.5y[n+1] + 0.5y[n] = 0.5^n*u(n)');
    const sol = L.ODE.solveDiffEq(r.a, r.rhsItems, [0, 0]);
    const rec = L.ODE.recurDiff(r.a, [0, 0], (m) => Math.pow(0.5, m), 12);
    const ev = (ch, ns) => (ch.evalN ? ns.map((n) => ch.evalN(n)) : null);
    return [r.n, r.a, sol.zi.tex, sol.full.tex, sol.stableText, rec, ev(sol.full, [1, 2, 3, 4])];
  }],
  ['ODE.parseDataSeq', (L) => ['1 2 3 4.5', '0,0.1,0.2\n1,2,3', '0 1\n0.1 2\n0.2 3', '0 1\n0.15 2\n0.2 3', '1;2;x', ''].map((s) => L.ODE.parseDataSeq(s))],

  /* —— Batch C：PX 实验模型 —— */
  ['PX.fnv1a/b64u 往返', (L) => {
    const f = L.PX.fnv1a || L.PX._fnv1a;
    const enc = L.PX.b64uEnc || L.PX._b64uEnc;
    const dec = L.PX.b64uDec || L.PX._b64uDec;
    return [f('hello'), f(''), dec(enc('信号与控制 · test'))];
  }],
  ['PX.validate/normalize/importJSON 错误路径', (L) => {
    const val = L.PX.validate || L.PX.validateExperiment;
    const bad = val({ schemaVersion: 1 });
    const imp = ['', '{bad json', JSON.stringify({ schemaVersion: 99 }), JSON.stringify({ schemaVersion: 1 })].map((s) => {
      const r = L.PX.importJSON(s);
      return r.ok ? 'ok:' + (r.migrated ? 'migrated' : 'plain') : r.error.code;
    });
    return [bad.ok, bad.errors.length, imp];
  }],
  ['PX CRUD/快照/分享（内存存储）', (L) => {
    L.PX.setStorage(null);
    const e = L.PX.create({ name: '实验 A', module: 'sys', state: { a: 1, s: 'x' }, tags: ['t1'] });
    L.PX.patch(e.id, { favorite: true });
    const snap = L.PX.addSnapshot(e, '快照1', 'sys');
    const code = L.PX.encodeShare(e);
    const dec = L.PX.decodeShare(code);
    const dup = L.PX.duplicate(e.id);
    const list = L.PX.list();
    const exp = L.PX.exportJSON(e);
    const back = L.PX.importJSON(exp);
    const restored = L.PX.restoreSnapshot(dup, dup.snapshots[0].id);
    return [
      code.slice(0, 4), code.split('.').length, dec.ok, dec.ok ? dec.value.module : null,
      snap.label, list.length, list[0].favorite, dup.name.endsWith(' 副本'), back.ok,
      restored.moduleStates.sys.data.a,
    ];
  }],
  ['PX.decodeShare 错误路径', (L) => ['PX1.abc.00000000', 'bad', 'PX1.a.b.c'].map((s) => {
    const r = L.PX.decodeShare(s);
    return r.ok ? 'ok' : r.error.code + '|' + r.error.message;
  })],

  /* —— 随机化对拍（固定种子，两边输入一致） —— */
  ['随机 polyRoots/bode/指标（12 组）', (L) => {
    const rnd = lcg(20261012);
    const out = [];
    for (let i = 0; i < 12; i++) {
      const n = 2 + (i % 2); // 2~3 阶
      const den = [1, ...Array.from({ length: n }, () => +(rnd() * 4 - 2).toFixed(3))];
      const num = Array.from({ length: 1 + (i % n) }, () => +(rnd() * 3 - 1.5).toFixed(3));
      out.push(L.DSP.polyRoots(den));
      out.push(L.DSP.bode(num, den, -1, 2, 40));
      out.push(L.DSP.steadyState(num, den));
      out.push(L.DSP.nyquistFull(num, den));
      out.push(L.DSP.errSeries(num, den, 4));
      out.push(L.DSP.closedLoopMetrics(num, den));
    }
    return out;
  }],
  ['随机 pidLoopSim/rootLocus（4 组）', (L) => {
    const rnd = lcg(7717);
    const out = [];
    for (let i = 0; i < 4; i++) {
      const num = [1, +(rnd() * 2 - 1).toFixed(3)];
      const den = [1, +(1 + rnd() * 2).toFixed(3), +(0.5 + rnd() * 3).toFixed(3)];
      out.push(L.DSP.pidLoopSim(num, den, { kp: 1 + rnd() * 3, ki: rnd() * 2, kd: rnd() }, { tmax: 6, steps: 300 }));
      out.push(L.DSP.rootLocus(num, den));
    }
    return out;
  }],
];

/* ---------- 执行 ---------- */
let pass = 0;
const fails = [];
for (const [name, factory] of CASES) {
  const a = callSafe(() => factory(V1));
  const b = callSafe(() => factory(V2));
  if (a.err || b.err) {
    if (a.err === b.err) {
      pass++;
      continue;
    }
    fails.push(`[${name}] 异常不一致：v1=${a.err}  v2=${b.err}`);
    continue;
  }
  const diffs = [];
  deep(a.value, b.value, name, diffs);
  if (diffs.length) fails.push(...diffs.slice(0, 10));
  else pass++;
}

/* ---------- 闭式真值校验：防「v1/v2 同错」型缺陷（存量问题重修钉子用例） ---------- */
/* 每个用例只依赖解析真值（不引用任何实现），v1 与 v2 两边都必须通过。
   背景：留数解析求值在共轭极点组上曾漏乘 2（FracGroup.pair 组对应一对共轭极点，
   而 groups 列表只保留正虚部代表），导致 h(t) 的解析点幅值减半——v1 与 v2 同错，
   对拍网无法发现；此处以闭式真值钉死。 */
const TRUTH_CASES = [
  ['真值·invLaplace 共轭极点 h(t)', (L) => {
    const r = L.TR.invLaplace([1], [1, 0.5, 1.25]);
    const wd = Math.sqrt(1.1875); // (s+0.25)² + ωd²
    return [1, 2].map((t) => r.evalT(t) - (1 / wd) * Math.exp(-0.25 * t) * Math.sin(wd * t));
  }],
  ['真值·invLaplace 共轭极点（双真分式直通）', (L) => {
    const r = L.TR.invLaplace([1, 0], [1, 0.5, 1.25]);
    const wd = Math.sqrt(1.1875);
    return [1, 2].map(
      (t) => r.evalT(t) - Math.exp(-0.25 * t) * (Math.cos(wd * t) - (0.25 / wd) * Math.sin(wd * t)),
    );
  }],
  ['真值·invZ 共轭极点 h(n)', (L) => {
    const r = L.TR.invZ([0.5 * Math.sin(Math.PI / 3), 0], [1, -0.5, 0.25]);
    return [1, 2, 3, 5].map((n) => r.evalN(n) - Math.pow(0.5, n) * Math.sin((Math.PI / 3) * n));
  }],
  /* —— 滤波器设计（M2 新增内核，v2 专属真值；第三位 true = 仅 v2 校验） —— */
  ['真值·Butterworth LP：阶数估计 + 通带边缘 = −Rp', (L) => {
    const spec = { family: 'butter', band: 'lp', fp: 1000, fstop: 2000, Rp: 1, Rs: 40, fsamp: 8000 };
    const est = L.FX.estimateOrder(spec);
    const d = L.FX.designIIR(spec);
    if (est.ok === false || !d.ok) return [NaN];
    const f = L.FX.freqz(d.num, d.den, 2048);
    return [est.n - 6, f.magDb[512] + spec.Rp]; // ω = π/4 恰为网格点
  }, true],
  ['真值·Chebyshev I LP：通带边缘 = −Rp + 阻带达标', (L) => {
    const spec = { family: 'cheby1', band: 'lp', fp: 1000, fstop: 2000, Rp: 1, Rs: 40, fsamp: 8000 };
    const d = L.FX.designIIR(spec);
    if (!d.ok) return [NaN];
    const f = L.FX.freqz(d.num, d.den, 2048);
    const mag = (i) => f.magDb[i];
    return [mag(512) + spec.Rp, mag(1024) <= -spec.Rs ? 0 : 1];
  }, true],
  ['真值·Chebyshev II LP：阻带边缘 = −Rs + 直流 0 dB', (L) => {
    const spec = { family: 'cheby2', band: 'lp', fp: 1000, fstop: 2000, Rp: 1, Rs: 40, fsamp: 8000 };
    const d = L.FX.designIIR(spec);
    if (!d.ok) return [NaN];
    const f = L.FX.freqz(d.num, d.den, 2048);
    return [f.magDb[1024] + spec.Rs, f.magDb[0]];
  }, true],
  ['真值·高通设计：边缘 −Rp + 阻带与直流深度抑制', (L) => {
    const spec = { family: 'butter', band: 'hp', fp: 2000, fstop: 1000, Rp: 1, Rs: 40, fsamp: 8000 };
    const d = L.FX.designIIR(spec);
    if (!d.ok) return [NaN];
    const f = L.FX.freqz(d.num, d.den, 2048);
    return [f.magDb[1024] + spec.Rp, f.magDb[512] <= -spec.Rs ? 0 : 1, f.magDb[0] <= -60 ? 0 : 1];
  }, true],
  ['真值·FIR 窗函数法：线性相位对称 + 直流增益 ≈ 1', (L) => {
    const r = L.FX.designFIR('lp', 21, 1000, 'hamming', 8000);
    if (!r.ok) return [NaN];
    let sym = 0;
    for (let k = 0; k < r.n; k++) sym = Math.max(sym, Math.abs(r.h[k] - r.h[r.n - 1 - k]));
    let dc = 0;
    for (const v of r.h) dc += v;
    return [sym, Math.abs(dc - 1) < 0.05 ? 0 : 1];
  }, true],
  ['真值·系数量化：8 位误差 ≤ 半步长', (L) => {
    const q = L.FX.quantizeCoef([1 / 3, -0.2718, 0.1234], 8);
    return [Math.abs(q[0] - 1 / 3) < Math.pow(2, -5) ? 0 : 1];
  }, true],
  ['真值·Chebyshev I 奇数阶低通：直流 0 dB（无直流衰减）', (L) => {
    const spec = { family: 'cheby1', band: 'lp', fp: 1000, fstop: 3000, Rp: 1, Rs: 40, fsamp: 8000 };
    const est = L.FX.estimateOrder(spec);
    const d = L.FX.designIIR(spec);
    if ('ok' in est) return [NaN];
    const f = L.FX.freqz(d.num, d.den, 1024);
    return [est.n - 3, f.magDb[0]];
  }, true],
  ['真值·Chebyshev II 高通：高频通带 0 dB + 阻带达标', (L) => {
    const spec = { family: 'cheby2', band: 'hp', fp: 3000, fstop: 1000, Rp: 1, Rs: 40, fsamp: 8000 };
    const d = L.FX.designIIR(spec);
    if (!d.ok) return [NaN];
    const f = L.FX.freqz(d.num, d.den, 1024);
    return [f.magDb[1024], f.magDb[256] <= -spec.Rs ? 0 : 1, f.magDb[0] <= -60 ? 0 : 1];
  }, true],
  ['真值·FIR 高通：直流被阻（Σh ≈ 0）+ 线性相位对称', (L) => {
    const r = L.FX.designFIR('hp', 21, 1000, 'hamming', 8000);
    if (!r.ok) return [NaN];
    let sym = 0;
    for (let k = 0; k < r.n; k++) sym = Math.max(sym, Math.abs(r.h[k] - r.h[r.n - 1 - k]));
    let dc = 0;
    for (const v of r.h) dc += v;
    return [sym, Math.abs(dc) < 0.05 ? 0 : 1];
  }, true],
  ['真值·IIR 极点稳定性：设计的极点全部在单位圆内', (L) => {
    const d = L.FX.designIIR({ family: 'butter', band: 'lp', fp: 500, fstop: 1500, Rp: 0.5, Rs: 50, fsamp: 4000 });
    if (!d.ok) return [NaN];
    const ps = L.FX.filterPoles(d.den);
    return [ps.length - d.n, ps.reduce((m, p) => Math.max(m, Math.hypot(p.re, p.im)), 0) < 1 - 1e-9 ? 0 : 1];
  }, true],
  /* —— 控制器设计（M2 新增内核，v2 专属真值） —— */
  ['真值·可控标准型往返：tfOf(A,B,C,D) = 原 num/den', (L) => {
    const num = [2, 3];
    const den = [1, 3, 2];
    const ss = L.FX.controllableCanonical(num, den);
    const back = L.FX.tfOf(ss.A, ss.B, ss.C, ss.D);
    const n = [0, 0, 0];
    const dn = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      n[i] = (back.num[i] ?? 0) - (num[i] ?? 0);
      dn[i] = (back.den[i] ?? 0) - (den[i] ?? 0);
    }
    return [ss.n - 2, ...n, ...dn];
  }, true],
  ['真值·超前校正：∠C(jωm) = 最大相位 φm（闭式）', (L) => {
    const g = L.FX.ctrlFreq([1], [1, 1, 0], 2); // 对象 1/(s(s+1)) 在 ωm=2
    const PMdes = 50;
    const need = PMdes - (180 + g.ph);
    const c = L.FX.designLead([1], [1, 1, 0], PMdes, 2);
    if (!c.ok) return [NaN];
    const phim = (need * Math.PI) / 180;
    const ac = L.FX.ctrlFreq(c.num, c.den, 2);
    // 相位应恰为 φm；且 |C·G|=1
    return [ac.ph - (phim * 180) / Math.PI, ac.mag * g.mag - 1];
  }, true],
  ['真值·滞后校正：低频增益比 z/p = β 且 |C·G(jωc′)| = 1', (L) => {
    const c = L.FX.designLag([1], [1, 1, 0], 0.5, 20);
    if (!c.ok) return [NaN];
    const ac = L.FX.ctrlFreq(c.num, c.den, 0.5);
    const g = L.FX.ctrlFreq([1], [1, 1, 0], 0.5);
    return [c.z / c.p - 20, ac.mag * g.mag - 1];
  }, true],
  ['真值·极点配置：闭环特征多项式 = 期望极点多项式', (L) => {
    const desired = [{ re: -3, im: 0 }, { re: -2, im: 1 }, { re: -2, im: -1 }];
    const r = L.FX.placePoles([2, 3], [1, 3, 2, 0], desired);
    if (!r.ok) return [NaN];
    const want = L.FX.desiredPoly(desired);
    const got = L.FX.tfOf(r.Acl, [[1], [0], [0]], [[1, 0, 0]], [[0]]).den;
    const d = [];
    for (let i = 0; i < 4; i++) d.push((got[i] ?? 0) - (want[i] ?? 0) / want[0]);
    return d;
  }, true],
  /* —— 随机信号内核（M2 新增，v2 专属真值） —— */
  ['真值·自相关 lag0 = mean(x²)（有偏估计闭式）', (L) => {
    const x = [1, -2, 3, 0.5, -1.5, 2, 0.25, -3];
    const r = L.FX.autocorr(x, 0);
    const mean = x.reduce((s, v) => s + v * v, 0) / x.length;
    return [r.r[0] - mean];
  }, true],
  ['真值·互相关(x,x) 与自相关逐点相同', (L) => {
    const x = L.FX.whiteNoise(32, 1, 12345);
    const a = L.FX.autocorr(x, 5);
    const b = L.FX.xcorr(x, x, 5);
    return a.r.map((v, i) => v - b.r[i]);
  }, true],
  ['真值·噪声可复现：同 seed → 同序列', (L) => {
    const a = L.FX.whiteNoise(48, 2, 7);
    const b = L.FX.whiteNoise(48, 2, 7);
    return a.map((v, i) => v - b[i]);
  }, true],
  ['真值·周期图 Parseval：∫P df = mean(x²)', (L) => {
    const x = L.FX.whiteNoise(256, 1, 99);
    const fs = 1000;
    const r = L.FX.periodogram(x, fs, 'rect');
    let area = 0;
    const df = r.f[1] - r.f[0];
    for (const v of r.p) area += v * df;
    const mean = x.reduce((s, v) => s + v * v, 0) / x.length;
    return [area - mean];
  }, true],
  /* —— 调制与通信内核（M2 新增，v2 专属真值） —— */
  ['真值·AM 边带比：|X(fc±fm)| / |X(fc)| = m/2', (L) => {
    const fs = 1024;
    const N = 1024; // 与 FFT 长度一致 → fc、fm 恰在整 bin
    const dt = 1 / fs;
    const msg = [];
    for (let i = 0; i < N; i++) msg.push(Math.cos((2 * Math.PI * 64 * i) / fs));
    const m = 0.5;
    const x = L.FX.amModulate(msg, 256, fs, m);
    const sp = L.FX.spectrum(x, dt);
    const at = (f) => sp.mag[f];
    return [at(320) / at(256) - m / 2];
  }, true],
  ['真值·DSB-SC 无载波分量：|X(fc)| ≈ 0 且双边带相等', (L) => {
    const fs = 1024;
    const N = 1024;
    const dt = 1 / fs;
    const msg = [];
    for (let i = 0; i < N; i++) msg.push(Math.cos((2 * Math.PI * 64 * i) / fs));
    const x = L.FX.dsbSc(msg, 256, fs);
    const sp = L.FX.spectrum(x, dt);
    const at = (f) => sp.mag[f];
    return [at(256) / Math.max(at(320), 1e-30), (at(192) - at(320)) / Math.max(at(320), 1e-30)];
  }, true],
  ['真值·FM 瞬时频率：常量消息 → 等价于 cos(2π(fc+kf)t)', (L) => {
    const fs = 1000;
    const N = 200;
    const fc = 100;
    const kf = 50;
    const dt = 1 / fs;
    const msg = new Array(N).fill(1);
    const x = L.FX.fmModulate(msg, fc, fs, kf);
    const d = [];
    for (let i = 0; i < N; i++) d.push(x[i] - Math.cos(2 * Math.PI * (fc + kf) * i * dt));
    return d;
  }, true],
  ['真值·带限 sinc 重建：样本点插值恒等 x(kT)=样本', (L) => {
    const fs = 800;
    const f0 = 100; // fs = 8·f0（过采样）
    const Sp = 128;
    const samples = [];
    const t = [];
    for (let k = 0; k < Sp; k++) {
      samples.push(Math.sin((2 * Math.PI * f0 * k) / fs));
      t.push(k / fs);
    }
    const rec = L.FX.sincReconstruct(samples, fs, t);
    let worst = 0;
    for (let i = 0; i < t.length; i++) worst = Math.max(worst, Math.abs(rec[i] - samples[i]));
    return [worst];
  }, true],
  /* —— 内容包 / 提交包（M3 新增内核，v2 专属真值） —— */
  ['真值·内容包往返：encode→decode 后 meta 与项数一致', (L) => {
    const mk = (name) =>
      L.FX.importJSON(JSON.stringify({ schemaVersion: 1, name, module: 'sys', moduleStates: { sys: { savedAt: 1, data: { expr: '1/(s+1)' } } } })).value;
    const b = L.FX.buildPackage([mk('实验A'), mk('实验B')], { name: '包1' });
    if (!b.ok) return [NaN];
    const d = L.FX.decodePackage(L.FX.encodePackage(b.value));
    if (!d.ok) return [NaN];
    return [d.value.items.length - 2, d.value.meta.name === '包1' ? 0 : 1, d.value.items[0].name === '实验A' ? 0 : 1, d.value.failed.length];
  }, true],
  ['真值·内容包篡改检出：改动 1 字符 → 校验失败', (L) => {
    const mk = (name) => L.FX.importJSON(JSON.stringify({ schemaVersion: 1, name, module: 'sys' })).value;
    const b = L.FX.buildPackage([mk('A')], { name: 'x' });
    if (!b.ok) return [NaN];
    const code = L.FX.encodePackage(b.value);
    const tampered = code.slice(0, code.length - 1) + (code.endsWith('0') ? '1' : '0');
    const d = L.FX.decodePackage(tampered);
    return [d.ok ? 1 : 0, d.ok || d.error.code === 'bad-checksum' ? 0 : 1];
  }, true],
  ['真值·内容包上限：>60 个实验 → too-many', (L) => {
    const mk = (i) => L.FX.importJSON(JSON.stringify({ schemaVersion: 1, name: 'e' + i, module: 'sys' })).value;
    const many = [];
    for (let i = 0; i < 61; i++) many.push(mk(i));
    const b = L.FX.buildPackage(many, { name: 'big' });
    return [b.ok ? 1 : b.error.code === 'too-many' ? 0 : 1];
  }, true],
  ['真值·内容包 JSON 往返（.pkg 文件路径）', (L) => {
    const mk = (name) => L.FX.importJSON(JSON.stringify({ schemaVersion: 1, name, module: 'pid' })).value;
    const b = L.FX.buildPackage([mk('P1'), mk('P2'), mk('P3')], { name: '文件包', desc: 'd' });
    if (!b.ok) return [NaN];
    const d = L.FX.decodePackageJSON(L.FX.packToJSON(b.value));
    if (!d.ok) return [NaN];
    return [d.value.items.length - 3, d.value.items[1].module === 'pid' ? 0 : 1, d.value.failed.length];
  }, true],
  /* —— 语音口述规范化（M3 新增，v2 专属真值） —— */
  ['真值·口述→表达式：运算符与去空白', (L) => {
    const out = L.FX.voiceToExpr('sin 3 t 乘以 e 的负零点五 t');
    return [out === 'sin3t*e-0.5t' ? 0 : 1, out.includes('乘以') ? 1 : 0, out.includes(' ') ? 1 : 0];
  }, true],
  ['真值·口述→表达式：平方 / 加', (L) => {
    const out = L.FX.voiceToExpr('x 的平方 加 1');
    return [out === 'x^2+1' ? 0 : 1];
  }, true],
  ['真值·口述→表达式：负小数（负 三点一四）', (L) => {
    const out = L.FX.voiceToExpr('负 三点一四');
    return [out === '-3.14' ? 0 : 1];
  }, true],
  ['真值·口述→表达式：ASCII 幂等（不改动合法表达式）', (L) => {
    const out = L.FX.voiceToExpr('sin(3*t)/(s^2+2*s+1)');
    return [out === 'sin(3*t)/(s^2+2*s+1)' ? 0 : 1];
  }, true],
  ['真值·口述→表达式：微分方程（撇 / 等于）', (L) => {
    const out = L.FX.voiceToExpr('y 两撇 加 3 乘 y 一撇 等于 0');
    return [out === "y''+3*y'=0" ? 0 : 1];
  }, true],
];
let tPass = 0;
let tTotal = 0;
const tFails = [];
for (const [name, factory, v2Only] of TRUTH_CASES) {
  for (const [tag, L] of [['v1', V1], ['v2', V2]]) {
    if (v2Only && tag === 'v1') continue;
    tTotal++;
    const res = callSafe(() => factory(L));
    if (res.err) {
      tFails.push(`[${name}·${tag}] 异常：${res.err}`);
      continue;
    }
    const bad = (res.value || []).filter((d) => !(Math.abs(d) <= 1e-9));
    if (bad.length) tFails.push(`[${name}·${tag}] 与闭式偏差=${JSON.stringify(bad)}`);
    else tPass++;
  }
}

console.log(`\n对拍结果：${pass}/${CASES.length} 组一致`);
console.log(`闭式真值校验：${tPass}/${tTotal} 项通过`);
if (fails.length || tFails.length) {
  console.log('\n差异明细：');
  for (const f of fails) console.log('  ✗ ' + f);
  for (const f of tFails) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('v1 ↔ v2 内核数值完全一致（Batch A+B+C：全部 13 个内核模块）');
  console.log('闭式真值全部通过（含留数解析共轭极点组 ×2 修正）\n');
}
fs.rmSync(tmp, { recursive: true, force: true });