/* ============================================================
 * perf.mjs — 主线程重算开销巡检（M15）
 *
 * 定位：parity / audit / uidata 管**正确性**，本脚本管**开销**——把「工具页参数变化时
 *   主线程同步执行的内核调用」逐个计时，建立可回归的基线。
 *   （内核调用是主线程卡顿的主要来源；JSX 渲染与图表绘制不在本脚本范围内，由浏览器走查负责。）
 *
 * 断言策略（**只拦灾难级回归**，避免慢机器误红）：
 *   · 单项 ≤ 25 ms、合计 ≤ 150 ms —— 用于拦截数量级退化（基线最大项 ≈ 3.7 ms，留 7× 余量）
 *   · 单项 ≥ 5 ms 打印 ⚠ 供人工复核（与《M15 验收单》的基线表比对）
 *   数量级以下的退化由里程碑走查 + 基线表人工比对负责；不要把阈值收紧到基线附近（会抖）。
 *
 * 注意：pidOptimize 在工具内走 **worker**（不阻塞主线程），本表仍给出耗时供参考，
 *   但**不参与**主线程预算断言。
 *
 * 运行：node scripts/perf.mjs   （或 npm run perf）
 * ============================================================ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const v2Root = path.resolve(here, '..');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-v2-perf-'));
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
const C = await import(pathToFileURL(outfile).href);

/* ---------- 代表性输入（量级取自 parity.mjs 的既有用例与各工具默认参数） ---------- */
const num4 = [1, 3, 2, 0];
const x4096 = C.whiteNoise(4096, 1, 7);
const bits = Array.from({ length: 64 }, (_, i) => ((i * 7) % 3 === 0 ? 1 : 0));
const msg = Array.from({ length: 2048 }, (_, i) => Math.sin((2 * Math.PI * i) / 64));
const tArr = Array.from({ length: 4096 }, (_, i) => i / 4000);
const spec = { family: 'butter', band: 'lp', fp: 1000, fstop: 2000, Rp: 1, Rs: 40, fsamp: 8000 };

/** [名称, 是否主线程（false = 工具内走 worker）, 工厂] */
const CASES = [
  ['sys · polyRoots(6 阶)', true, () => C.polyRoots([1, 4, 6, 4, 1, 2, 3])],
  ['sys · bode(200 点)', true, () => C.bode([10], [1, 2, 10], -1, 2, 200)],
  ['sys · evalH ×220（奈奎斯特曲线）', true, () => { for (let i = 0; i <= 220; i++) C.evalH([1], num4, Math.pow(10, -2 + (4 * i) / 220)); }],
  ['sys · loopMargins', true, () => C.loopMargins([1], num4)],
  ['sys · closedLoopMetrics', true, () => C.closedLoopMetrics([10], [1, 2, 10])],
  ['sys · steadyState', true, () => C.steadyState([10], [1, 2, 10])],
  ['sys · errSeries', true, () => C.errSeries([10], [1, 2, 10])],
  ['sys · nyquistFull（1/(s+1)³）', true, () => C.nyquistFull([8], [1, 3, 3, 1])],
  ['sys · nyquistFull（含原点极点）', true, () => C.nyquistFull([6.1], [1, 3, 2, 0])],
  ['sys · rootLocus', true, () => C.rootLocus([1, 0], [1, 3, 2, 0])],
  ['sys · ltiResponse(700 步)', true, () => C.ltiResponse([10], [1, 2, 10], () => 1, 0, 12, 700)],
  ['pid · pidLoopSim(700 步)', true, () => C.pidLoopSim([1], [1, 2, 1], { kp: 3, ki: 2, kd: 0.5, Tf: 0.1 }, { tmax: 6, steps: 700 })],
  ['pid · znUltimate', true, () => C.znUltimate([1], [1, 3, 3, 1])],
  ['pid · fopdtFit(400 点)', true, () => { const r = C.ltiResponse([1], [3, 1], () => 1, 0, 10, 400); C.fopdtFit(r.t, r.y); }],
  ['pid · errMetrics(700)', true, () => C.errMetrics(Array.from({ length: 700 }, (_, i) => i * 0.01), Array.from({ length: 700 }, (_, i) => Math.exp(-i / 100)))],
  ['pid · pidOptimize(60 次仿真)〔工具内走 worker〕', false, () => C.pidOptimize([1], [1, 2, 1], 'ise', { kp: 1, ki: 0.5, kd: 0 }, { maxSims: 60, tmax: 6, steps: 300 })],
  ['filter · estimateOrder', true, () => C.estimateOrder(spec)],
  ['filter · designIIR', true, () => C.designIIR(spec)],
  ['filter · freqz(2048 点)', true, () => C.freqz([1], [1, -1.2, 0.5], 2048)],
  ['filter · filterPoles', true, () => C.filterPoles([1, -1.2, 0.5])],
  ['filter · quantizeCoef', true, () => C.quantizeCoef([1 / 3, -0.2718, 0.1234], 8)],
  ['filter · designFIR(41)', true, () => C.designFIR('lp', 41, 1000, 'hamming', 8000)],
  ['filter · firFreqz(1024)', true, () => C.firFreqz(C.designFIR('lp', 41, 1000, 'hamming', 8000).h, 1024)],
  ['control · designLead', true, () => C.designLead([1], [1, 1, 0], 50, 2)],
  ['control · designLag', true, () => C.designLag([1], [1, 1, 0], 0.5, 20)],
  ['control · placePoles', true, () => C.placePoles([1], [1, 1, 0], C.secondOrderPoles(0.6, 2))],
  ['control · ctrlFreq ×200', true, () => { for (let i = 0; i < 200; i++) C.ctrlFreq([1], [1, 1, 0], Math.pow(10, -1 + (3 * i) / 200)); }],
  ['random · whiteNoise(4096)', true, () => C.whiteNoise(4096, 1, 7)],
  ['random · periodogram(4096)', true, () => C.periodogram(x4096, 4000)],
  ['random · welch(4096)', true, () => C.welch(x4096, 4000)],
  ['random · autocorr(4096)', true, () => C.autocorr(x4096, 128)],
  ['random · xcorr(4096)', true, () => C.xcorr(x4096, x4096, 128)],
  ['random · iir1(4096)', true, () => C.iir1(x4096, 0.3)],
  ['comm · amModulate(2048)', true, () => C.amModulate(msg, 100, 1000, 0.8)],
  ['comm · fmModulate(2048)', true, () => C.fmModulate(msg, 100, 1000, 20)],
  ['comm · envelope(2048)', true, () => C.envelope(msg)],
  ['comm · sincReconstruct(64→4096)', true, () => C.sincReconstruct(C.amModulate(msg, 100, 1000, 0.8).slice(0, 64), 1000, tArr)],
  ['comm · eyeTraces(64 bit)', true, () => C.eyeTraces(C.shapeNRZ(bits, 16, 4, 0.35), 16, 4)],
  ['fourier · fft(1024)', true, () => C.fft(x4096.slice(0, 1024), new Array(1024).fill(0))],
  ['fourier · conv(1024×256)', true, () => C.conv(x4096.slice(0, 1024), C.raisedCosine(8, 16, 0.35).concat(new Array(240).fill(0)))],
  ['fourier · spectrum(1024)', true, () => C.spectrum(x4096.slice(0, 1024), 1 / 1000)],
  ['ft · dftPhasors(64)', true, () => C.dftPhasors(C.shapePoints('square', 64))],
  ['ft · shapePoints×7(64)', true, () => { for (const k of ['square', 'heart', 'star', 'gear', 'spiral', 'triangle', 'butterfly']) C.shapePoints(k, 64); }],
  ['tr · parseTimeCombo', true, () => C.parseTimeCombo('2*exp(-3t)u(t)+sin(2*t)u(t)')],
  ['tr · laplaceOfItems', true, () => C.laplaceOfItems(C.parseTimeCombo('2*exp(-3t)u(t)+sin(2*t)u(t)'))],
  ['tr · fourierOfItems', true, () => C.fourierOfItems(C.parseTimeCombo('sin(2t)u(t)+cos(3t)'))],
  ['tr · fNumeric×400', true, () => { const its = C.parseTimeCombo('exp(-2t)+3t^2+sin(2t)'); for (let i = 0; i < 400; i++) C.fNumeric(its, i * 0.01); }],
  ['tr · rocs', true, () => C.rocs([1], [1, 3, 2])],
  ['tr · partialFracGroups', true, () => C.partialFracGroups([1], [1, 3, 2])],
  ['tr · invLaplace', true, () => C.invLaplace([1], [1, 3, 2])],
  ['tr · parseZCombo / zOfItems', true, () => C.zOfItems(C.parseZCombo('0.8^n*u[n]+n*u[n]'))],
  ['tr · xNumeric×400 / XzNumeric', true, () => { const its = C.parseZCombo('0.8^n*u[n]'); for (let n = 0; n < 400; n++) C.xNumeric(its, n); C.XzNumeric(its, 2.5, 0.8); }],
  ['z · jury(3 阶)', true, () => C.jury([1, -1.5, 0.5])],
  ['block · tustin / sToZ', true, () => { C.tustin([1], [1, 1], 0.01); C.sToZ([1], [1, 1], 0.01); }],
  ['solve · parseTimeExpr ×400 求值', true, () => { const f = C.parseTimeExpr('exp(-2t)*sin(3t)+0.5*t'); for (let i = 0; i < 400; i++) f(i * 0.01); }],
  ['solve · recurrence(400 步)', true, () => C.recurDiff([1, -0.9], 400, (n) => (n === 0 ? 1 : 0))],
  ['solve · simulateODE(400 步)', true, () => C.simulateODE((t, y) => -2 * y + Math.sin(t), 0, 5, 1, 400)],
  ['solve · parseDataSeq（两列 2000 行）', true, () => C.parseDataSeq(Array.from({ length: 2000 }, (_, i) => `${(i * 0.005).toFixed(4)} ${Math.sin(i / 30).toFixed(6)}`).join('\n'))],
];

/** 断言预算（灾难级，见文件头） */
const BUDGET_ITEM = 25; // ms（灾难级：基线最大项 ≈ 3.9 ms，留 ~6× 余量）
const BUDGET_TOTAL = 150; // ms（仅计主线程项）
const WARN_ITEM = 5; // ms

const ITER = 30;
const rows = [];
for (const [name, mainThread, fn] of CASES) {
  try {
    fn(); // 预热（含 JIT）
    const t0 = performance.now();
    for (let i = 0; i < ITER; i++) fn();
    rows.push({ name, mainThread, ms: (performance.now() - t0) / ITER });
  } catch (e) {
    rows.push({ name, mainThread, ms: NaN, err: String((e && e.message) || e) });
  }
}
rows.sort((a, b) => b.ms - a.ms);

const fails = [];
for (const r of rows) {
  if (Number.isNaN(r.ms)) fails.push(`[异常] ${r.name}：${r.err}`);
}
const mainRows = rows.filter((r) => r.mainThread && !Number.isNaN(r.ms));
const total = mainRows.reduce((s, r) => s + r.ms, 0);
for (const r of mainRows) if (r.ms > BUDGET_ITEM) fails.push(`[超预算] ${r.name} ${r.ms.toFixed(3)} ms > ${BUDGET_ITEM} ms`);
if (total > BUDGET_TOTAL) fails.push(`[超预算] 主线程合计 ${total.toFixed(1)} ms > ${BUDGET_TOTAL} ms`);

console.log('\n主线程重算开销（单次，' + ITER + ' 次平均；基线见 docs/v2/M15-验收单.md）\n');
for (const r of rows) {
  if (Number.isNaN(r.ms)) {
    console.log(`      异常   ${r.name}  ← ${r.err}`);
    continue;
  }
  const flag = !r.mainThread ? '〔worker〕' : r.ms >= WARN_ITEM ? '⚠ 需人工复核' : '';
  console.log(`  ${r.ms.toFixed(3).padStart(8)} ms   ${r.name}  ${flag}`);
}
console.log(
  `\n主线程合计 ${total.toFixed(1)} ms（${mainRows.length} 项，预算 ${BUDGET_TOTAL} ms）；` +
    `单项最大 ${mainRows[0].ms.toFixed(3)} ms（预算 ${BUDGET_ITEM} ms）；` +
    `⚠ 项 ${mainRows.filter((r) => r.ms >= WARN_ITEM).length} 个`,
);
if (fails.length) {
  console.log('\n失败明细：');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('主线程重算开销在灾难级预算内（数量级以下的退化请对照基线表人工复核）\n');
}
