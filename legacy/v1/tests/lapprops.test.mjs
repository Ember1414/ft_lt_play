/* ============================================================
 * lapprops.test.mjs — 拉普拉斯性质数值验证器测试（TR.propVerify）
 *   时移 / 频移 / 尺度 / 微分：定义积分 vs 符号公式，相对误差 < 1e-6
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['assets/js/lib/util.js', 'assets/js/lib/mathdsp.js', 'assets/js/lib/transforms.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { TR } = sandbox;

let pass = 0;
const fails = [];
const ok = (n, c, extra) => { if (c) { pass++; return; } fails.push(n + (extra ? '  → ' + extra : '')); };

const expSignal = () => TR.parseTimeCombo('exp(-2*t)*u(t)');
const sinSignal = () => TR.parseTimeCombo('sin(3*t)*u(t)');

{
  const r = TR.propVerify(expSignal(), 'shift', 1);
  ok('时移：验证通过（rel=' + (r.maxRel || 0).toExponential(1) + '）', r.ok && r.passed);
  ok('时移：标题含 e^{−s}', /e\^{/.test(r.title) || /e\^/.test(r.title));
  const r2 = TR.propVerify(sinSignal(), 'shift', 0.5);
  ok('时移：正弦信号通过', r2.ok && r2.passed, 'rel=' + (r2.maxRel || 0).toExponential(1));
}
{
  const r = TR.propVerify(expSignal(), 'freq', 0.5);
  ok('频移：验证通过', r.ok && r.passed, 'rel=' + (r.maxRel || 0).toExponential(1));
  const r2 = TR.propVerify(sinSignal(), 'freq', 1.2);
  ok('频移：正弦通过', r2.ok && r2.passed);
}
{
  const r = TR.propVerify(expSignal(), 'scale', 2);
  ok('尺度：验证通过', r.ok && r.passed, 'rel=' + (r.maxRel || 0).toExponential(1));
  const r2 = TR.propVerify(sinSignal(), 'scale', 0.5);
  ok('尺度：正弦通过', r2.ok && r2.passed);
}
{
  const r = TR.propVerify(expSignal(), 'diff', 0);
  ok('微分：验证通过', r.ok && r.passed, 'rel=' + (r.maxRel || 0).toExponential(1));
  const r2 = TR.propVerify(sinSignal(), 'diff', 0);
  ok('微分：正弦通过', r2.ok && r2.passed);
}
{
  ok('空信号拒绝', !TR.propVerify([], 'shift', 1).ok);
  ok('未知性质拒绝', !TR.propVerify(expSignal(), 'xxx', 1).ok);
  // 组合信号（两项）时移
  const combo = TR.parseTimeCombo('exp(-2*t)*u(t) + sin(3*t)*u(t)');
  const r = TR.propVerify(combo, 'shift', 0.8);
  ok('组合信号时移通过', r.ok && r.passed, 'rel=' + (r.maxRel || 0).toExponential(1));
}

console.log(fails.length
  ? `✗ lapprops ${pass} 通过，${fails.length} 失败:\n  ` + fails.join('\n  ')
  : `✓ lapprops ${pass} 项全部通过`);
process.exit(fails.length ? 1 : 0);
