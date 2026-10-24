/* ============================================================
 * dataproc.test.mjs — 数据处理升级内核测试（v1.1.0 Phase 5）
 *   DSP.deconv：频域 ε 正则化反卷积（卷积回代恢复 / 频谱零点退化检测）
 *   DSP.window：rect/hamming/hanning/blackman 对称性、端点值、值域
 *   DSP.gaussNoise：Box–Muller 白噪声统计特性（均值/标准差松界）
 *   DSP.iir1：一阶 IIR 低通递推（阶跃输入对照解析解 1−(1−α)^{k+1}）
 *   ODE.parseDataSeq：两列 (t,y) 粘贴（均匀 → Fs / 非均匀 → 报错）、单列不变
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
const DSP = sandbox.window.DSP;
const OS = sandbox.window.ODE;

let pass = 0;
const fails = [];
const ok = (n, c, extra) => { if (c) { pass++; return; } fails.push(n + (extra ? '  → ' + extra : '')); };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

/* ---------- DSP.deconv：卷积回代恢复 ---------- */
{
  const x = [1, -2, 3, 0.5, 0, 1];
  const h = [1, 0.5, -0.25];
  const y = DSP.conv(x, h);
  const r = DSP.deconv(y, h);
  ok('deconv 输出长度 = len(y)', r.x && r.x.length === y.length, String(r.x && r.x.length));
  let mx = 0;
  for (let i = 0; i < x.length; i++) mx = Math.max(mx, Math.abs(r.x[i] - x[i]));
  ok('deconv 卷积回代恢复 x（<1e-6）', mx < 1e-6, 'max=' + mx.toExponential(2));
  ok('deconv 干净数据 ok=true 且残差 <0.1', r.ok === true && r.residual < 0.1, JSON.stringify({ ok: r.ok, res: r.residual }));

  // 频谱零点：h=[1,−1] 在 DC 处 H(0)=0 → 反演退化 → 残差 >0.1 → ok=false
  const r2 = DSP.deconv(DSP.conv([1, 2, 3, 4], [1, -1]), [1, -1]);
  ok('h 频谱含零点（DC）→ ok=false', r2.ok === false && r2.residual > 0.1, JSON.stringify({ ok: r2.ok, res: r2.residual }));

  ok('deconv 空输入拒绝', DSP.deconv([], [1]).ok === false && DSP.deconv([1], []).ok === false);
}

/* ---------- DSP.window：对称性 / 端点 / 值域 ---------- */
{
  const w = DSP.window('hamming', 8);
  ok('hamming N=8 长度', w.length === 8, String(w.length));
  let sym = true, in01 = true;
  for (let i = 0; i < 8; i++) { if (!near(w[i], w[7 - i], 1e-12)) sym = false; if (!(w[i] >= 0 && w[i] <= 1)) in01 = false; }
  ok('hamming 偶对称', sym);
  ok('hamming 值域 [0,1]', in01);
  ok('hamming 端点 ≈0.08', near(w[0], 0.08, 1e-9) && near(w[7], 0.08, 1e-9), String(w[0]));
  const wmax = Math.max(...w);
  ok('hamming 峰值 <1 且接近 1', wmax <= 1 && wmax > 0.95, String(wmax));

  const hn = DSP.window('hanning', 8);
  ok('hanning 端点 ≈0', near(hn[0], 0, 1e-9) && near(hn[7], 0, 1e-9), String(hn[0]));
  let symH = true;
  for (let i = 0; i < 8; i++) if (!near(hn[i], hn[7 - i], 1e-12)) symH = false;
  ok('hanning 偶对称且值域 [0,1]', symH && hn.every((v) => v >= 0 && v <= 1));

  const bk = DSP.window('blackman', 8);
  ok('blackman 端点 ≈0', near(bk[0], 0, 1e-9) && near(bk[7], 0, 1e-9), String(bk[0]));
  let symB = true;
  for (let i = 0; i < 8; i++) if (!near(bk[i], bk[7 - i], 1e-12)) symB = false;
  ok('blackman 偶对称且值域 [0,1]', symB && bk.every((v) => v >= 0 && v <= 1));

  ok('rect 全 1', DSP.window('rect', 6).every((v) => v === 1));
  ok('window N=1 无 NaN', DSP.window('hamming', 1).every(Number.isFinite));
}

/* ---------- DSP.gaussNoise：统计特性（松界，避免随机抖动导致 flaky） ---------- */
{
  const g = DSP.gaussNoise(4000, 2);
  ok('gaussNoise 长度', g.length === 4000, String(g.length));
  let s = 0; for (const v of g) s += v;
  const mu = s / g.length;
  let vv = 0; for (const w of g) vv += (w - mu) * (w - mu);
  const sd = Math.sqrt(vv / g.length);
  ok('gaussNoise 均值≈0（±0.15）', Math.abs(mu) < 0.15, mu.toFixed(3));
  ok('gaussNoise 标准差≈2（±0.3）', Math.abs(sd - 2) < 0.3, sd.toFixed(3));
  ok('gaussNoise 有限值', g.every(Number.isFinite));
  ok('gaussNoise sigma=0 → 全零', DSP.gaussNoise(50, 0).every((x) => x === 0));
}

/* ---------- DSP.iir1：一阶 IIR 低通递推（阶跃输入） ---------- */
{
  const y = DSP.iir1(new Array(12).fill(1), 0.2);
  let mx = 0;
  for (let k = 0; k < 12; k++) mx = Math.max(mx, Math.abs(y[k] - (1 - Math.pow(0.8, k + 1))));
  ok('iir1 阶跃 = 1−(1−α)^{k+1}（<1e-12）', mx < 1e-12, 'max=' + mx.toExponential(2));
  ok('iir1 y[0] = α', near(y[0], 0.2, 1e-12), String(y[0]));
  ok('iir1 稳态趋近 1（1−0.8¹²≈0.931）', Math.abs(y[11] - 1) < 0.075, String(y[11]));
  ok('iir1 α=1 直通', DSP.iir1([3, 1, 4], 1).every((v, i) => v === [3, 1, 4][i]));
  ok('iir1 α=0 → 全零', DSP.iir1([1, 2, 3], 0).every((v) => v === 0));
}

/* ---------- ODE.parseDataSeq：两列 (t,y) 粘贴 / 单列不变 ---------- */
{
  // 两列均匀 → Fs = 1/Δt
  const d = OS.parseDataSeq('0, 0\n0.125, 1\n0.25, 0\n0.375, -1\n0.5, 0');
  ok('两列解析 ok', !!d.ok && d.values.length === 5, JSON.stringify(d));
  ok('两列 y 值正确', d.values.join() === '0,1,0,-1,0', JSON.stringify(d.values));
  ok('两列 Fs=8、dt=0.125', near(d.Fs, 8, 1e-9) && near(d.dt, 0.125, 1e-12), JSON.stringify({ Fs: d.Fs, dt: d.dt }));
  ok('两列时间轴返回', Array.isArray(d.t) && d.t.length === 5 && near(d.t[4], 0.5, 1e-12));

  // 空格分隔两列同样支持
  const ds = OS.parseDataSeq('0 1\n0.5 2\n1 3');
  ok('两列空格分隔 → Fs=2', !!ds.ok && near(ds.Fs, 2, 1e-9), JSON.stringify(ds));

  // 非均匀 → 拒绝并提示
  const dn = OS.parseDataSeq('0, 1\n0.1, 2\n0.5, 3');
  ok('两列非均匀 Δt → 拒绝并提示', !dn.ok && /非均匀/.test(dn.note || ''), JSON.stringify(dn));

  // 时间非递增 → 拒绝
  ok('两列时间非递增拒绝', !OS.parseDataSeq('1, 0\n0.5, 1\n0, 2').ok);

  // 坏 token 定位（两列语境）
  const db = OS.parseDataSeq('0, 1\nx, 2');
  ok('两列坏 token 定位', !db.ok && db.badToken === 'x', JSON.stringify(db));

  // 单列行为不变（含换行的单列仍是扁平序列，无 Fs 字段）
  const d1 = OS.parseDataSeq('1, 2.5, -3; 4\n5');
  ok('单列多行仍扁平解析（向后兼容）', !!d1.ok && d1.values.length === 5 && d1.Fs === undefined, JSON.stringify(d1));
  const d2 = OS.parseDataSeq('1, x, 3');
  ok('单列坏 token 定位不变', d2.ok === false && d2.badToken === 'x', JSON.stringify(d2));

  // 单行两列不误判为时间轴（向后兼容：一行多值 = 单列序列）
  const d3 = OS.parseDataSeq('1, 2');
  ok('单行两列仍为单列序列', !!d3.ok && d3.values.length === 2 && d3.Fs === undefined, JSON.stringify(d3));

  ok('空输入仍拒绝', OS.parseDataSeq('   ').ok === false);
}

/* ---------- 结果输出 ---------- */
console.log(fails.length
  ? `✗ dataproc ${pass} 通过，${fails.length} 失败:\n  ` + fails.join('\n  ')
  : `✓ dataproc ${pass} 项全部通过`);
process.exit(fails.length ? 1 : 0);
