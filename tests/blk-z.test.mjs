/* ============================================================
 * blk-z.test.mjs — 采样 / 离散（Z 域）求解内核断言（极简，无框架）
 *   运行：node tests/blk-z.test.mjs
 *   覆盖：assets/js/lib/blocksolve.js 的 z 域部分
 *         sToZ / zohDiscretize / deriveZReadout / analyzeSampled / solveSampled
 *   提示：多项式一律「自高到低」系数，z/(z−a) 记作 n=[1,0] d=[1,−a]
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIBS = [
  'assets/js/lib/util.js',
  'assets/js/lib/mathdsp.js',
  'assets/js/lib/fx.js',
  'assets/js/lib/transforms.js',   // partialFracGroups / invZ / evalLaplaceGroups
  'assets/js/lib/blocksolve.js'
];
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of LIBS) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { BLKSOLVE, TR } = sandbox;

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? '  → ' + extra : ''));
}
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const arrNear = (a, b, tol = 1e-9) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => near(v, b[i], tol));
// 有理函数在某点的值（比较「传函本身」而不是系数表示，避免规范形差异）
const evalRat = (f, z) => {
  const ev = (p) => p.reduce((acc, c) => acc * z + c, 0);
  return ev(f.n) / ev(f.d);
};
const ratNear = (f, g, pts, tol = 1e-9) =>
  pts.every((z) => near(evalRat(f, z), evalRat(g, z), tol));

/* 拓扑小工具 */
const box = (id, n, d, extra = {}) => ({ id, kind: 'box', f: { n, d }, ...extra });
const zbox = (id, n, d, extra = {}) => ({ id, kind: 'box', dom: 'z', f: { n, d }, ...extra });
const sum = (id, extra = {}) => ({ id, kind: 'sum', f: { n: [1], d: [1] }, ...extra });
const sample = (id, extra = {}) => ({ id, kind: 'sample', f: null, ...extra });
const zoh = (id, extra = {}) => ({ id, kind: 'zoh', f: null, ...extra });
const e = (from, to, sign = 1) => ({ from, to, sign });

const T = 0.1;
const E1 = Math.exp(-T);          // e^{−T}
const E2 = Math.exp(-2 * T);

/* ================= sToZ：对照 Z 变换表 ================= */
{
  // Z[1/(s+1)] = z/(z−e^{−T})
  const a = BLKSOLVE.sToZ([1], [1, 1], T);
  ok('sToZ 一阶', a.ok && arrNear(a.n, [1, 0]) && arrNear(a.d, [1, -E1]), JSON.stringify(a));

  // Z[1/(s+1)²] = T·e^{−T}·z/(z−e^{−T})²（重极点递推）
  const b = BLKSOLVE.sToZ([1], [1, 2, 1], T);
  ok('sToZ 二阶重极点', b.ok && arrNear(b.n, [T * E1, 0]) && arrNear(b.d, [1, -2 * E1, E2]),
    JSON.stringify(b));

  // Z[(s+3)/((s+1)(s+2))] = 2z/(z−e^{−T}) − z/(z−e^{−2T})
  const c = BLKSOLVE.sToZ([1, 3], [1, 3, 2], T);
  ok('sToZ 两个实极点',
    c.ok && arrNear(c.n, [1, E1 - 2 * E2, 0]) && arrNear(c.d, [1, -(E1 + E2), E1 * E2]),
    JSON.stringify(c));

  // 共轭对：Z[1/(s²+2s+5)] = ½e^{−T}sin(2T)·z/(z²−2e^{−T}cos2T·z+e^{−2T})，分母必须为实
  const d = BLKSOLVE.sToZ([1], [1, 2, 5], T);
  ok('sToZ 共轭对分母为实',
    d.ok && arrNear(d.d, [1, -2 * E1 * Math.cos(2 * T), E2]),
    JSON.stringify(d));
  ok('sToZ 共轭对分子', d.ok && arrNear(d.n, [0.5 * E1 * Math.sin(2 * T), 0]), JSON.stringify(d));

  // 重极点 + 单极点混合：Z[1/(s(s+1)²)] 与解析手算对照
  //   1/(s(s+1)²) = 1/s − 1/(s+1) − 1/(s+1)²
  //   → z/(z−1) − z/(z−E1) − T·E1·z/(z−E1)²
  // 注：重极点的残差由共享引擎（TR.partialFracGroups）给出，其对重根求根精度约 1e-8，
  //     叠加本式的大幅相消后值误差约 2e-7，故此处容差取 2e-6（该用例验的是重建逻辑）
  const mix = BLKSOLVE.sToZ([1], [1, 2, 1, 0], T);
  const ref = (z) => evalRat({ n: [1, 0], d: [1, -1] }, z);
  ok('sToZ 混合极点（数值对照）',
    mix.ok && [0.35, 0.7, 1.4, 2.2].every((z) => {
      // 解析手算值：z/(z−1) − z/(z−E1) − T·E1·z/(z−E1)²
      const v = ref(z) - z / (z - E1) - (T * E1 * z) / Math.pow(z - E1, 2);
      return near(evalRat(mix, z), v, 2e-6);
    }), JSON.stringify(mix));

  // 常数（无极点）
  const k = BLKSOLVE.sToZ([5], [2], T);
  ok('sToZ 常数', k.ok && arrNear(k.n, [2.5]) && arrNear(k.d, [1]), JSON.stringify(k));

  // 非法 T
  ok('sToZ T=0 报错', BLKSOLVE.sToZ([1], [1, 1], 0).ok === false);
  ok('sToZ T 非有限报错', BLKSOLVE.sToZ([1], [1, 1], Infinity).ok === false);
}

/* ================= zohDiscretize ================= */
{
  // ZOH∘1/(s+1) = (1−e^{−T})/(z−e^{−T})，且 z=1 处 DC 增益为 1
  const g = BLKSOLVE.zohDiscretize([1], [1, 1], T);
  ok('zoh 一阶', g.ok && arrNear(g.n, [1 - E1]) && arrNear(g.d, [1, -E1]), JSON.stringify(g));
  ok('zoh DC 增益为 1', g.ok && near(evalRat(g, 1), 1, 1e-9), String(g.ok && evalRat(g, 1)));

  // ZOH∘1/(s(s+1))：G(s) 自带积分 → G(z) 仍含 z=1 极点，且 DC 增益发散
  const h = BLKSOLVE.zohDiscretize([1], [1, 1, 0], T);
  ok('zoh 含积分环节', h.ok && Math.abs(evalRat(h, 1)) > 1e5, JSON.stringify(h));
}

/* ================= 双向数值校核：解析 Z[G] ↔ 冲激响应采样 ================= */
{
  const cases = [
    { n: [1], d: [1, 1] },
    { n: [1], d: [1, 2, 1] },
    { n: [1, 3], d: [1, 3, 2] },
    { n: [1], d: [1, 2, 5] },
    { n: [1], d: [1, 2, 1, 0] }
  ];
  for (const cs of cases) {
    const z = BLKSOLVE.sToZ(cs.n, cs.d, T);
    const pf = TR.partialFracGroups(cs.n, cs.d);
    const invz = z.ok ? TR.invZ(z.n, z.d) : null;
    let worst = 0;
    if (z.ok && invz) {
      for (let k = 0; k <= 8; k++) {
        // 解析结果 → h[k]；数值参照 = g(t) 在 t=kT 的采样
        worst = Math.max(worst, Math.abs(invz.evalN(k) - TR.evalLaplaceGroups(pf.groups, k * T)));
      }
    }
    ok('双向校核 ' + JSON.stringify(cs.d), z.ok && worst < 1e-6, 'worst=' + worst);
  }
  // ZOH 情形：对 G(s)(1−e^{−sT})/s 的冲激响应即「保持器输出」的采样序列
  const gj = BLKSOLVE.zohDiscretize([1], [1, 1], T);
  const invg = TR.invZ(gj.n, gj.d);
  let worst = 0;
  for (let k = 0; k <= 8; k++) {
    // g_zoh(t) = L⁻¹[(1−e^{−sT})/(s(s+1))] = 1 − e^{−t} (t∈[0,T)) ，在 t=kT 处 = 1−e^{−T}·(k≥1 时为 1−e^{−kT}+(1−e^{−T})·…)
    // 直接用「无延迟部分」的采样差：h[k] = a[k] − a[k−1]，a(t)=L⁻¹[1/(s(s+1))]=1−e^{−t}
    const a = (t) => (t >= 0 ? 1 - Math.exp(-t) : 0);
    const ref = a(k * T) - (k >= 1 ? a((k - 1) * T) : 0);
    worst = Math.max(worst, Math.abs(invg.evalN(k) - ref));
  }
  ok('双向校核 ZOH', gj.ok && worst < 1e-6, 'worst=' + worst);
}

/* ================= analyzeSampled：模式判定 ================= */
{
  // 无采样元件 → mode 's'（零回归：走原路径）
  const g = [sum(1, { src: true }), box(2, [10], [1, 1], { out: true })];
  const an = BLKSOLVE.analyzeSampled(g, [e(1, 2), e(2, 1, -1)], T);
  ok('无采样 → mode s', an.ok === false && an.mode === 's', JSON.stringify(an));

  // 只有 z 域块 → mode 'z'
  const g2 = [sum(1, { src: true }), zbox(2, [1, -0.5], [1, -1], { out: true })];
  const an2 = BLKSOLVE.analyzeSampled(g2, [e(1, 2), e(2, 1, -1)], T);
  ok('全离散 → mode z', an2.ok === true && an2.mode === 'z', JSON.stringify(an2 && an2.note));

  // T 非法
  ok('T 非法 → 报错', BLKSOLVE.analyzeSampled(g2, [e(1, 2), e(2, 1, -1)], -1).ok === false);
}

/* ================= solveSampled：全离散回路 ================= */
{
  // Σ(src) → D(z)=(z−0.5)/(z−1) → G(z)=1/(z−0.5) → Y(out)，G → Σ(−1)
  // DG = 1/(z−1) → T = DG/(1+DG) = 1/z
  const nodes = [sum(1, { src: true }), zbox(2, [1, -0.5], [1, -1]), zbox(3, [1], [1, -0.5], { out: true })];
  const edges = [e(1, 2), e(2, 3), e(3, 1, -1)];
  const r = BLKSOLVE.solveSampled(nodes, edges, T);
  ok('全离散回路 ok', r.ok === true && r.mode === 'z', JSON.stringify(r && (r.note || r.mode)));
  if (r.ok) {
    ok('全离散 T(z)=1/z',
      ratNear(r.z, { n: [1], d: [1, 0] }, [0.3, 1.7, 2.5]),
      JSON.stringify(r.z));
  }
}

/* ================= solveSampled：标准采样回路（§5.4 范例） ================= */
{
  // R→Σ(src)→S₁→D(z)→ZOH→G(s)=1/(s+1)→Y(out)→S₂→Σ(−1)
  // G_zoh = (1−E1)/(z−E1) = c/(z−p) → T(z) = c(z−0.5)/[(z−1)(z−p)+c(z−0.5)]
  const c = 1 - E1, p = E1;
  const nodes = [
    sum(1, { src: true }), sample(2), zbox(3, [1, -0.5], [1, -1]),
    zoh(4), box(5, [1], [1, 1], { out: true }), sample(6)
  ];
  const edges = [e(1, 2), e(2, 3), e(3, 4), e(4, 5), e(5, 6), e(6, 1, -1)];
  const r = BLKSOLVE.solveSampled(nodes, edges, T);
  ok('标准采样回路 ok', r.ok === true && r.mode === 'sampled', JSON.stringify(r && (r.note || r.mode)));
  if (r.ok) {
    const expected = { n: [c, -0.5 * c], d: [1, c - 1 - p, p - 0.5 * c] };
    ok('标准采样回路 T(z) 与手算一致',
      ratNear(r.z, expected, [0.3, 0.7, 1.7, 2.5], 1e-8),
      JSON.stringify(r.z) + ' vs ' + JSON.stringify(expected));
    ok('标准采样回路分母为实且首一同号', r.z.d.every((v) => isFinite(v)) && near(r.z.d[0], 1, 1e-9));
    ok('片段记录含 ZOH 头因子', Array.isArray(r.segs) && r.segs.length === 1 && r.segs[0].hasZoh === true,
      JSON.stringify(r.segs));
  }
}

/* ================= 采样器下沉等价性 ================= */
{
  // 拓扑 1：采样器直接在 Σ 之后（由下沉规则自动在 R / 反馈支路补采样）
  const n1 = [
    sum(1, { src: true }), sample(2), zbox(3, [1, -0.5], [1, -1]),
    zoh(4), box(5, [1], [1, 1], { out: true }), sample(6)
  ];
  const e1 = [e(1, 2), e(2, 3), e(3, 4), e(4, 5), e(5, 6), e(6, 1, -1)];
  // 拓扑 2：手动在 R 支路与反馈支路各放采样器（等价结构，R 直接注入到输入采样器）
  const n2 = [
    sum(1), sample(10, { src: true }), zbox(3, [1, -0.5], [1, -1]),
    zoh(4), box(5, [1], [1, 1], { out: true }), sample(6)
  ];
  const e2 = [e(10, 1), e(1, 3), e(3, 4), e(4, 5), e(5, 6), e(6, 1, -1)];
  const r1 = BLKSOLVE.solveSampled(n1, e1, T);
  const r2 = BLKSOLVE.solveSampled(n2, e2, T);
  ok('采样器下沉等价', r1.ok && r2.ok && ratNear(r1.z, r2.z, [0.3, 1.3, 2.5], 1e-8),
    JSON.stringify([r1.note, r2.note]));
}

/* ================= 片段内部的连续局部反馈 ================= */
{
  // R→Σ₁(src)→S→ZOH→Σ₂→G₁→Y(out)→S₈→Σ₁(−1)；内层连续反馈 G₁→G₂→Σ₂(−1)
  // 片段入口 Σ₂、出口 Y(=H=1/(s+1))，T_{a→b}(s) = H·G₁/(1+G₁G₂) = (s+2)/((s+1)(s²+3s+3))
  const G1n = [1], G1d = [1, 1], G2n = [1], G2d = [1, 2];
  const inner = { n: [1, 2], d: [1, 4, 6, 3] };
  const Gz = BLKSOLVE.zohDiscretize(inner.n, inner.d, T);
  const expected = { n: Gz.n, d: BLKSOLVE.polyAdd(Gz.n, Gz.d) };   // T = Gz/(1+Gz)

  const nodes = [
    sum(1, { src: true }), sample(2), zoh(3), sum(4),
    box(5, G1n, G1d), box(6, G2n, G2d), box(7, [1], [1, 1], { out: true }), sample(8)
  ];
  const edges = [e(1, 2), e(2, 3), e(3, 4), e(4, 5), e(5, 6), e(6, 4, -1), e(5, 7), e(7, 8), e(8, 1, -1)];
  const r = BLKSOLVE.solveSampled(nodes, edges, T);
  ok('片段内局部反馈 ok', r.ok === true, JSON.stringify(r && r.note));
  if (r.ok) {
    ok('片段内局部反馈 T(z) 与手算一致',
      ratNear(r.z, expected, [0.3, 0.7, 1.3, 2.5], 1e-7),
      JSON.stringify(r.z) + ' vs ' + JSON.stringify(expected));
  }
}

/* ================= 不支持条件 ================= */
{
  // U3：ZOH 的输入不是采样信号
  const u3 = [box(1, [1], [1, 1], { src: true }), zoh(2), zbox(3, [1, 0], [1, -1], { out: true })];
  const r3 = BLKSOLVE.solveSampled(u3, [e(1, 2), e(2, 3)], T);
  ok('U3 报错且文案命中', r3.ok === false && /零阶保持器/.test(r3.note || ''), JSON.stringify(r3));

  // U4：z 域块直接驱动连续元件
  const u4 = [zbox(1, [1, 0], [1, -1], { src: true }), box(2, [1], [1, 1], { out: true })];
  const r4 = BLKSOLVE.solveSampled(u4, [e(1, 2)], T);
  ok('U4 报错且文案命中', r4.ok === false && /零阶保持器|采样开关/.test(r4.note || ''), JSON.stringify(r4));

  // U1：连续元件未被采样（旁挂一条未被采样的连续支路）
  const u1 = [sum(1, { src: true }), box(2, [1], [1, 1], { out: true }), sample(3), zbox(4, [1, 0], [1, -1], { out: true })];
  const r1 = BLKSOLVE.solveSampled(u1, [e(1, 2), e(1, 3), e(3, 4)], T);
  ok('U1 报错且文案命中', r1.ok === false && /未被采样/.test(r1.note || ''), JSON.stringify(r1));

  // U2：同一连续片段两个入口
  const u2 = [
    zbox(1, [1, 0], [1, -1], { src: true }), sample(2), box(3, [1], [1, 1]),
    zbox(5, [1, 0], [1, -1], { src: true }), sample(6), box(7, [1], [1, 2]),
    sample(8), zbox(9, [1, 0], [1, -1], { out: true })
  ];
  const r2 = BLKSOLVE.solveSampled(u2, [e(1, 2), e(2, 3), e(3, 7), e(5, 6), e(6, 7), e(7, 8), e(8, 9)], T);
  ok('U2 报错且文案命中', r2.ok === false && /多个采样点|多速率/.test(r2.note || ''), JSON.stringify(r2));
}

/* ================= deriveZReadout ================= */
{
  const s1 = BLKSOLVE.deriveZReadout({ n: [1, 0], d: [1, -0.5] });
  ok('z 稳定判据：单位圆内', s1.stable === true && s1.order === 1, JSON.stringify(s1));

  const s2 = BLKSOLVE.deriveZReadout({ n: [1, 0], d: [1, -2] });
  ok('z 稳定判据：单位圆外', s2.stable === false && s2.hasOut === true, JSON.stringify(s2));

  const s3 = BLKSOLVE.deriveZReadout({ n: [1, 0], d: [1, 0, -1] });
  ok('z 稳定判据：单位圆上', s3.stable === false && s3.hasOnCircle === true, JSON.stringify(s3));
}

console.log(`\nblk-z: ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
