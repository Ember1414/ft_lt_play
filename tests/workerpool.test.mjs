/* ============================================================
 * workerpool.test.mjs — Worker 池测试（Node 无 Worker → 回退路径 + 协议）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['assets/js/lib/util.js', 'assets/js/lib/mathdsp.js', 'assets/js/lib/workerpool.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { WP, DSP } = sandbox;

let pass = 0;
const fails = [];
const ok = (n, c, extra) => { if (c) { pass++; return; } fails.push(n + (extra ? '  → ' + extra : '')); };

/* Node 无 Worker/Blob → 回退主线程 */
ok('Node 环境 supported()=false', WP.supported() === false);
{
  WP.register('DSP.pidOptimize', (...args) => DSP.pidOptimize(...args));
  const r = await WP.run('DSP.pidOptimize', [[1], [1, 1], 'itae', { kp: 1, ki: 0.5, kd: 0 }, { tmax: 8, steps: 600, maxSims: 60 }], { timeout: 5000 });
  ok('回退执行成功', r.ok && r.fallback === true && r.value.ok === true, JSON.stringify(r).slice(0, 80));
  ok('寻优结果有效', r.ok && r.value.gains.kp >= 0 && r.value.value <= r.value.startValue);
  // 错误回传
  const e1 = await WP.run('DSP.pidOptimize', [[1], [1, 1], 'bad', {}, {}], { timeout: 5000 });
  ok('任务内错误回传（返回 ok:false 结果）', e1.ok === true && e1.value.ok === false && /criterion/.test(e1.value.note), JSON.stringify(e1.value));
  // 抛错型错误回传
  WP.register('Test.Throw', () => { throw new Error('boom'); });
  const e2 = await WP.run('Test.Throw', [], {});
  ok('抛错型错误回传', e2.ok === false && e2.error === 'boom');
  // 未注册且不可用
  const e3 = await WP.run('No.Such', [], {});
  ok('未注册任务拒绝', e3.ok === false && /未注册/.test(e3.error));
  // Worker 源码协议检查（点路径分发 / 超时 / id 回显）
  ok('worker 源码含 importScripts 内核', /importScripts/.test(fs.readFileSync(path.join(root, 'assets/js/lib/workerpool.js'), 'utf8')));
}

console.log(fails.length
  ? `✗ workerpool ${pass} 通过，${fails.length} 失败:\n  ` + fails.join('\n  ')
  : `✓ workerpool ${pass} 项全部通过`);
process.exit(fails.length ? 1 : 0);
