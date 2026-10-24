/* ============================================================
 * workerpool.test.mjs — Worker 池测试（Node 无 Worker → 回退路径 + 协议）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { console, setTimeout: (f, ms) => 0, clearTimeout: () => { } };   // Worker 路径需要定时器（桩：立即返回，不真跑超时）
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

/* ---------- Worker 被页面策略拦截（生产 CSP 未放行 worker-src blob:）→ 主线程兜底 ----------
 * 回归背景：线上 _headers 的 CSP 未放行 blob: Worker，根轨迹 / PID 寻优
 * 在浏览器里 new Worker 抛 SecurityError，旧实现对错误直接返回 → 功能静默失效。 */
{
  sandbox.Worker = function () { throw new Error('SecurityError: blob worker blocked by CSP'); };
  sandbox.Blob = function () { };
  sandbox.URL = { createObjectURL: () => 'blob:stub' };
  ok('具备 Worker 能力时 supported()=true', WP.supported() === true);
  const r = await WP.run('DSP.rootLocus', [[1], [1, 2, 5]], { timeout: 5000 });
  ok('Worker 被拦截 → 回退主线程并成功返回', r.ok === true && r.fallback === true && Array.isArray(r.value && r.value.branches), JSON.stringify(r).slice(0, 120));
  ok('拦截后置位 workerBlocked（后续不再重试 Worker）', WP.isBlocked() === true);
  // 未显式 register 的任务：按点路径在 window 上解析（DSP.polyRoots）
  const r2 = await WP.run('DSP.polyRoots', [[1, 3, 2]], {});
  ok('未注册任务按点路径解析并回退执行', r2.ok === true && r2.value.length === 2, JSON.stringify(r2).slice(0, 100));
  const e4 = await WP.run('No.Such.Fn', [], {});
  ok('点路径解析不到 → 明确错误', e4.ok === false && /未注册/.test(e4.error), JSON.stringify(e4));
  delete sandbox.Worker; delete sandbox.Blob; delete sandbox.URL;
}

console.log(fails.length
  ? `✗ workerpool ${pass} 通过，${fails.length} 失败:\n  ` + fails.join('\n  ')
  : `✓ workerpool ${pass} 项全部通过`);
process.exit(fails.length ? 1 : 0);
