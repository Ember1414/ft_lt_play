/* ============================================================
 * audit.mjs — v2 内核语义/闭式断言（M4 存量重修）
 *
 * 定位：对拍网（parity.mjs）只保证 v1↔v2 **数值一致**，无法覆盖「v1 本身就没测过」
 *       的语义空洞（《存量问题清单》§四 6 项）与只在 v2 才存在的边界语义（#12/#14）。
 *       本文件对 v2 内核（`src/core/index.ts`）与 UI 纯函数（`src/ui/textext.ts`）
 *       做**语义级断言 + 闭式真值**校验；每条断言返回偏差数组，0（或 ≤1e-9）即通过。
 *
 * 运行：node scripts/audit.mjs   （或 npm run audit）
 * ============================================================ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const v2Root = path.resolve(here, '..');

async function bundle(entry, name) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-v2-audit-'));
  const outfile = path.join(tmp, name);
  await build({
    entryPoints: [path.join(v2Root, entry)],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    outfile,
    logLevel: 'silent',
  });
  return pathToFileURL(outfile).href;
}

const C = await import(await bundle('src/core/index.ts', 'core.mjs'));
const TX = await import(await bundle('src/ui/textext.ts', 'textext.mjs'));

const eq = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const push = (diffs, cond) => {
  if (!cond) diffs.push(1);
};

/* ---------- 断言表：【名称, 工厂】；工厂返回偏差数组 ---------- */
const CASES = [
  /* §四·1 transforms.fourierOfItems（v1 无任何断言） */
  [
    '§四·1 fourierOfItems 冲激标志与形式',
    () => {
      const diffs = [];
      const IMP_KINDS = ['sin', 'cos', 'tpow', 'u', 'const'];
      for (const s of ['2*exp(-3t)u(t)', 'sin(2t)u(t)+cos(3t)', 't^2*exp(-t)+u(t)', '5', 't^3']) {
        const its = C.parseTimeCombo(s);
        const f = C.fourierOfItems(its);
        push(diffs, f.imp === its.some((it) => IMP_KINDS.includes(it.kind)));
        push(diffs, f.tex.startsWith('F(j\\omega)='));
      }
      // 纯指数：非冲激，且含 (a+jω) 形式
      const fe = C.fourierOfItems(C.parseTimeCombo('2*exp(-3t)u(t)'));
      push(diffs, fe.imp === false);
      push(diffs, fe.tex.includes('3+j'));
      // 正弦：含 ±ω 的 δ 对
      const fs = C.fourierOfItems(C.parseTimeCombo('sin(2t)u(t)'));
      push(diffs, fs.tex.includes('\\delta(\\omega-2)') && fs.tex.includes('\\delta(\\omega+2)'));
      return diffs;
    },
  ],
  /* §四·2 transforms.rocs / zOfItems / XzNumeric */
  [
    '§四·2 rocs/zOfItems/XzNumeric 语义',
    () => {
      const diffs = [];
      // zOfItems：0.5^n u[n] → ROC |z|>0.5，tex 含 (z−0.5)
      const z = C.zOfItems(C.parseZCombo('0.5^n*u[n]'));
      push(diffs, eq(z.roc, 0.5));
      push(diffs, z.zLine.includes('z-0.5'));
      // XzNumeric：0.8^n u[n] 在 z=2.5 处 = z/(z−a)（闭式，|z|>|a|）
      const its = C.parseZCombo('0.8^n*u[n]');
      push(diffs, eq(C.XzNumeric(its, 2.5, 0.8), 2.5 / (2.5 - 0.8)));
      // rocs：双左半平面极点 → 存在稳定且因果的 ROC（Re(s) > −1）
      const r = C.rocs([1], [1, 3, 2]);
      push(diffs, r.ok === true);
      if (r.ok) {
        push(diffs, r.axisPole === false);
        push(diffs, !!r.stableRegion && r.stableRegion.causal === true);
        push(diffs, !!r.stableRegion && r.stableRegion.rocTex.includes('Re(s) > -1'));
      }
      // rocs：虚轴极点（±j，den=s²+1）→ axisPole=true 且无稳定域
      const r2 = C.rocs([1], [1, 0, 1]);
      push(diffs, r2.ok === true && r2.axisPole === true);
      if (r2.ok) push(diffs, r2.stableRegion === null);
      return diffs;
    },
  ],
  /* §四·3 dsp.dftPhasors / dsp.integrate */
  [
    '§四·3 dftPhasors 单 bin + integrate 闭式',
    () => {
      const diffs = [];
      // 单位圆步进 π/2 → 频谱集中于 k=1，amp = 1，其余为 0
      const ph = C.dftPhasors([
        { re: 1, im: 0 },
        { re: 0, im: 1 },
        { re: -1, im: 0 },
        { re: 0, im: -1 },
      ]);
      push(diffs, ph[0].k === 1);
      push(diffs, eq(ph[0].amp, 1));
      for (const p of ph) if (p.k !== 1) push(diffs, eq(p.amp, 0));
      // integrate：∫₀^π sin = 2；∫₀³ x² = 9（辛普森）
      push(diffs, eq(C.integrate(Math.sin, 0, Math.PI, 1000), 2, 1e-3));
      push(diffs, eq(C.integrate((x) => x * x, 0, 3, 2000), 9, 1e-6));
      return diffs;
    },
  ],
  /* §四·4 signals.shapePoints / customShapePoints / tfToFields */
  [
    '§四·4 shapePoints/customShapePoints/tfToFields 语义',
    () => {
      const diffs = [];
      const bbox = (P) => {
        let mx = 0;
        let my = 0;
        for (const p of P) {
          mx = Math.max(mx, Math.abs(p.re));
          my = Math.max(my, Math.abs(p.im));
        }
        return [mx, my];
      };
      // shapePoints：点数一致 + 外接尺寸归一到 [-1,1]（正方形）
      const sq = C.shapePoints('square', 64);
      push(diffs, sq.length === 64);
      push(diffs, eq(bbox(sq)[0], 1) && eq(bbox(sq)[1], 1));
      for (const k of ['triangle', 'heart', 'star', 'gear', 'butterfly', 'spiral']) {
        push(diffs, C.shapePoints(k, 64).length === 64);
      }
      // customShapePoints：4 角点 → 32 点，闭合居中归一化
      const cp = C.customShapePoints(
        [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 2 },
          { x: 0, y: 2 },
        ],
        32,
      );
      push(diffs, cp.length === 32);
      push(diffs, eq(bbox(cp)[0], 1) && eq(bbox(cp)[1], 1));
      // tfToFields ↔ parseTFFields 往返一致（tfToFields 保留原分母括号写法）
      const f = C.tfToFields('10/(s^2+2s+10)');
      push(diffs, f.num === '10' && f.den === '(s^2+2s+10)');
      const back = C.parseTFFields(f.num, f.den, 's');
      const orig = C.parseTF('10/(s^2+2s+10)', 's');
      push(diffs, !!back && !!orig);
      if (back && orig) {
        const n = Math.max(back.num.length, orig.num.length);
        for (let i = 0; i < n; i++) push(diffs, eq(back.num[i] ?? 0, orig.num[i] ?? 0));
        for (let i = 0; i < Math.max(back.den.length, orig.den.length); i++) {
          push(diffs, eq(back.den[i] ?? 0, orig.den[i] ?? 0));
        }
      }
      return diffs;
    },
  ],
  /* §四·5 experiment：UTF-8 字节上限（#15）与 _deepSanitize 拒绝路径 */
  [
    '§四·5 experiment UTF-8 上限与拒绝路径',
    () => {
      const diffs = [];
      const mk = (data) => ({
        schemaVersion: 1,
        id: 'e123456',
        name: '实验',
        createdAt: 1,
        updatedAt: 1,
        favorite: false,
        tags: [],
        module: 'sys',
        moduleStates: { sys: { savedAt: 1, data } },
        snapshots: [],
      });
      const fill = (nKeys, s) => {
        const d = {};
        for (let i = 0; i < nKeys; i++) d['k' + i] = s;
        return d;
      };
      const zh = '中'.repeat(2000); // 2000 码元 = 6000 UTF-8 字节（未触 deepSanitize 的 2000 字符上限）
      // 6 键：UTF-16 长 ≈12k（旧实现放行），UTF-8 ≈36k → 新实现必须拒绝（#15 行为修正）
      const r6 = C.validateExperiment(mk(fill(6, zh)));
      push(diffs, r6.ok === false);
      if (!r6.ok) push(diffs, r6.errors.some((e) => e.includes('32KB') || e.includes('超过')));
      // 4 键：UTF-8 ≈24k → 放行（对照）
      push(diffs, C.validateExperiment(mk(fill(4, zh))).ok === true);
      // _deepSanitize 拒绝：非有限 / 嵌套过深 / 禁止键
      push(diffs, C.validateExperiment(mk({ v: Infinity })).ok === false);
      let deep = 1;
      for (let i = 0; i < 12; i++) deep = { a: deep };
      push(diffs, C.validateExperiment(mk(deep)).ok === false);
      push(diffs, C.validateExperiment(mk(JSON.parse('{"__proto__":1}'))).ok === false);
      push(diffs, C.validateExperiment(mk({ s: 'x'.repeat(2001) })).ok === false); // 字符串过长
      return diffs;
    },
  ],
  /* §四·6 plots.niceStep（v1 cvCol 在 v2 已随图表层重写，无对应实现） */
  [
    '§四·6 niceStep（1/2/5×10^k）',
    () => {
      const diffs = [];
      const cases = [
        [1, 1],
        [9, 5],
        [3, 2],
        [0.9, 0.5],
        [0.03, 0.02],
        [0, 1],
        [-5, 1],
      ];
      for (const [r, want] of cases) push(diffs, eq(TX.niceStep(r), want, 1e-12));
      return diffs;
    },
  ],
  /* #12 nyquistFull 圈数/临界标志：与教材理论（Routh–Hurwitz）交叉验证
   * （M11 补充：临界邻域加密后，临界增益前的「刚越过临界」档位不得再漏圈） */
  [
    '#12 nyquistFull 圈数 = 理论 Z−P（含 M11 临界档位）',
    () => {
      const diffs = [];
      // —— 族一：G=K/(s+1)³，闭环特征 (s+1)³+K = s³+3s²+3s+(1+K)
      //    Routh 首列 [1, 3, (8−K)/3, 1+K]：K<8 → 无变号（0 个右半根）；K>8 → 2 个变号（2 个右半根）；
      //    K=8 → 第 3 行恰为 0，辅助多项式 3s²+9 给出 ±j√3；实为 (s+1)³=−8 → s = −3, ±j√3（虚轴极点）
      // 1) K=2：稳定、非临界
      const a = C.nyquistFull([2], [1, 3, 3, 1]);
      push(diffs, a.P === 0 && a.N === 0 && a.Z === 0 && a.stable === true && a.onCritical === false);
      // 2) K=20：2 个右半平面根 → Z=2、N=2、不稳定
      const b = C.nyquistFull([20], [1, 3, 3, 1]);
      push(diffs, b.P === 0 && b.N === 2 && b.Z === 2 && b.stable === false && b.onCritical === false);
      // 3) K=8（临界）：闭环极点恰在 ±j√3（虚轴）→ 无净包围（N=0、Z=0），但**必须**判为临界
      const c = C.nyquistFull([8], [1, 3, 3, 1]);
      push(diffs, c.P === 0 && c.N === 0 && c.Z === 0 && c.onCritical === true && c.stable === false);
      // 4) K=7（临界前）：不得误报临界
      const d = C.nyquistFull([7], [1, 3, 3, 1]);
      push(diffs, d.Z === 0 && d.stable === true && d.onCritical === false);
      // 5) K=9（刚越过临界 → Routh 第 3 行 (8−K)/3 变号 → 2 个右半根）：必须给 2 圈（M11 前此档位漏圈报 Z=0）
      const e = C.nyquistFull([9], [1, 3, 3, 1]);
      push(diffs, e.Z === 2 && e.N === 2 && e.stable === false && e.onCritical === false);
      // 6) K=8.01（**刚越过**临界 0.125%，M14 前此档位 Z 报 1）：Routh (8−K)/3 < 0 → 2 个右半根
      const e2 = C.nyquistFull([8.01], [1, 3, 3, 1]);
      push(diffs, e2.Z === 2 && e2.stable === false && e2.onCritical === false);

      // —— 族二：G=K/(s(s+1)(s+2))，闭环特征 s³+3s²+2s+K（含原点极点 → 需 indent 绕行）
      //    Routh 首列 [1, 3, (6−K)/3, K]：K<6 → 0 个右半根；K>6 → 2 个右半根；
      //    K=6 → 辅助多项式 3s²+6 → s=±j√2（虚轴极点）
      // 6) K=6（临界）
      const f = C.nyquistFull([6], [1, 3, 2, 0]);
      push(diffs, f.P === 0 && f.Z === 0 && f.onCritical === true && f.stable === false);
      // 7) K=6.1（刚越过临界 → 2 个右半根；M11 前此档位漏圈报 Z=0）
      const g = C.nyquistFull([6.1], [1, 3, 2, 0]);
      push(diffs, g.Z === 2 && g.stable === false && g.onCritical === false);
      // 8) K=6.01 / 6.02（**刚越过**临界 0.17% / 0.33%，M14 前 Z 报 1）：
      //    该族在 ω=±√2 有**两个对称穿越**，加密须覆盖两处才给足 2 圈；Routh (6−K)/3 < 0 → 2 个右半根
      const g2 = C.nyquistFull([6.01], [1, 3, 2, 0]);
      push(diffs, g2.Z === 2 && g2.stable === false && g2.onCritical === false);
      const g3 = C.nyquistFull([6.02], [1, 3, 2, 0]);
      push(diffs, g3.Z === 2 && g3.stable === false && g3.onCritical === false);
      // 9) K=5（临界前）
      const h = C.nyquistFull([5], [1, 3, 2, 0]);
      push(diffs, h.Z === 0 && h.stable === true && h.onCritical === false);
      return diffs;
    },
  ],
  /* #14 parseDataSeq 两列格式边界语义 */
  [
    '#14 parseDataSeq 边界语义',
    () => {
      const diffs = [];
      const r1 = C.parseDataSeq('0 1\n0 2'); // 首尾同刻 → 拒绝
      push(diffs, r1.ok === false);
      if (!r1.ok) push(diffs, /递增/.test(r1.note || ''));
      const r2 = C.parseDataSeq('1 1\n0 2'); // 负 Δt → 拒绝
      push(diffs, r2.ok === false);
      const r3 = C.parseDataSeq('0 1\n0.1 2\n0.2 3'); // 均匀 → 通过，dt=0.1、Fs=10
      push(diffs, r3.ok === true);
      if (r3.ok) {
        push(diffs, eq(r3.dt, 0.1) && eq(r3.Fs, 10) && r3.t.length === 3 && r3.values.length === 3);
      }
      const r4 = C.parseDataSeq('0 1\n0.15 2\n0.2 3'); // 非均匀 → 拒绝
      push(diffs, r4.ok === false);
      if (!r4.ok) push(diffs, /非均匀/.test(r4.note || ''));
      const r5 = C.parseDataSeq('0,0.1,0.2\n1,2,3'); // 每行非 2 列 → 回落单列通道
      push(diffs, r5.ok === true && r5.values.length === 6);
      const r6 = C.parseDataSeq('1;2;x'); // 坏 token → 报出 token
      push(diffs, r6.ok === false && r6.badToken === 'x');
      return diffs;
    },
  ],
  /* #9 polyRootsEx：新增收敛字段，根与 polyRoots 一致；良态输入收敛 */
  [
    '#9 polyRootsEx 收敛标志（根与 polyRoots 一致）',
    () => {
      const diffs = [];
      for (const coef of [
        [1, 2, 10],
        [1, 3, 2],
        [1, 0, 0, 1],
        [2, 0, -8],
        [1, -1.5, 0.5, -0.1],
      ]) {
        const base = C.polyRoots(coef);
        const ex = C.polyRootsEx(coef);
        push(diffs, ex.roots.length === base.length);
        push(diffs, ex.converged === true);
        push(diffs, typeof ex.iterations === 'number' && ex.iterations >= 1);
        for (let i = 0; i < Math.min(base.length, ex.roots.length); i++) {
          push(diffs, eq(ex.roots[i].re, base[i].re) && eq(ex.roots[i].im, base[i].im));
        }
      }
      return diffs;
    },
  ],
];

/* ---------- 执行 ---------- */
let pass = 0;
const fails = [];
for (const [name, fn] of CASES) {
  let res;
  try {
    res = fn();
  } catch (e) {
    fails.push(`[${name}] 异常：${e && e.message ? e.message : e}`);
    continue;
  }
  if ((res || []).length) fails.push(`[${name}] 偏差项 ${res.length} 处`);
  else pass++;
}
console.log(`\n语义/闭式断言：${pass}/${CASES.length} 组通过`);
if (fails.length) {
  console.log('\n失败明细：');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('§四 审计空洞 6 项 + #12/#14/#9 语义断言全部通过\n');
}
