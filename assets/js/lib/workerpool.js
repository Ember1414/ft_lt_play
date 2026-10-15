/* ============================================================
 * workerpool.js — 通用计算 Worker 池（window.WP）
 *   把重计算（寻优/根轨迹/FFT 扫描）移出主线程：
 *   - Worker 以 Blob URL 创建，importScripts 数学内核后按点路径分发任务
 *     （如 'DSP.pidOptimize'），支持 超时终止 / 错误回传
 *   - 环境不支持 Worker（测试桩/旧浏览器）**或 Worker 被页面策略拦截**
 *     （如 CSP 未放行 worker-src blob:，生产环境常见）时自动回退主线程同步执行
 *   - register(job, syncFn) 可显式登记主线程回退；未登记时按点路径在 window 上解析
 * ============================================================ */
window.WP = (() => {
  const LIBS = ['assets/js/lib/util.js', 'assets/js/lib/mathdsp.js'];
  const JOBS = {};   // job → 主线程回退函数
  let workerUrl = null;
  let workerBlocked = false;   // Worker 创建被策略拦截（CSP/权限）后不再重试

  const supported = () => typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';

  /* 主线程回退实现：优先显式注册，其次按 'DSP.xxx' 点路径在 window 上解析
     （与 worker 内同一套内核，保证两条路径结果一致） */
  function resolveSync(job) {
    if (typeof JOBS[job] === 'function') return JOBS[job];
    try {
      const root = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null);
      const fn = String(job).split('.').reduce((o, k) => (o == null ? o : o[k]), root);
      return typeof fn === 'function' ? fn : null;
    } catch (e) { return null; }
  }
  function runSync(job, args) {
    const fn = resolveSync(job);
    if (!fn) return Promise.resolve({ ok: false, error: '任务未注册且 Worker 不可用：' + job, fallback: true });
    return Promise.resolve().then(() => {
      try { return { ok: true, value: fn.apply(null, args), fallback: true }; }
      catch (e) { return { ok: false, error: e && e.message ? e.message : String(e), fallback: true }; }
    });
  }

  function boot() {
    if (workerUrl) return workerUrl;
    // 内核 URL 必须在主线程解析（worker 内 self.location 是 blob: URL，相对路径无法解析）
    const base = (typeof location !== 'undefined' && location.href) || '/';
    const src = 'self.window = self;\n' +
      'importScripts(' + LIBS.map((l) => JSON.stringify(new URL(l, base).href)).join(',') + ');\n' +
      'self.onmessage = function (e) {\n' +
      '  var d = e.data;\n' +
      '  try {\n' +
      '    var fn = String(d.job).split(".").reduce(function (o, k) { return o[k]; }, self);\n' +
      '    if (typeof fn !== "function") throw new Error("\\u672a\\u77e5\\u4efb\\u52a1 " + d.job);\n' +
      '    var r = fn.apply(null, d.args || []);\n' +
      '    self.postMessage({ id: d.id, ok: true, value: r });\n' +
      '  } catch (err) {\n' +
      '    self.postMessage({ id: d.id, ok: false, error: err && err.message ? err.message : String(err) });\n' +
      '  }\n' +
      '};\n';
    workerUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    return workerUrl;
  }

  function register(job, syncFn) { JOBS[job] = syncFn; }

  /* run(job, args, opts) → Promise<{ok, value?}|{ok:false, error, fallback?, timeout?}> */
  function run(job, args, opts) {
    opts = opts || {};
    const timeout = +opts.timeout || 30000;
    // 无 Worker 能力（测试桩/旧浏览器）或已被策略拦截 → 主线程兜底
    if (!supported() || workerBlocked) return runSync(job, args);
    return new Promise((resolve) => {
      let w = null, done = false;
      const id = Math.random().toString(36).slice(2);
      const finish = (r) => { if (done) return; done = true; clearTimeout(timer); try { if (w) w.terminate(); } catch (e) { } resolve(r); };
      // Worker 起不来 / 运行期错误：标记拦截并回退主线程，绝不让功能静默失效
      const degrade = () => {
        if (done) return;
        done = true;
        workerBlocked = true;
        clearTimeout(timer);
        try { if (w) w.terminate(); } catch (e) { }
        runSync(job, args).then(resolve, (e) => resolve({ ok: false, error: String(e && e.message || e), fallback: true }));
      };
      const timer = setTimeout(() => finish({ ok: false, error: '计算超时（' + timeout / 1000 + 's），已终止', timeout: true }), timeout);
      try { w = new Worker(boot()); } catch (e) { degrade(); return; }
      w.onmessage = (e) => { const d = e.data; if (!d || d.id !== id) return; finish(d); };
      w.onerror = () => degrade();
      w.postMessage({ id, job, args });
    });
  }

  return { register, run, resolveSync, supported, JOBS, isBlocked: () => workerBlocked };
})();
