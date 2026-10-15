/* ============================================================
 * sw.js — 自注销「保险栓」（v2 不注册任何 Service Worker）
 *
 * 用途：本站点（ft-lt-play.pages.dev）此前由 v1 承载，v1 会注册离线 SW（fltp-1.1.3）。
 *   v2 上线到同一域名后，老访客浏览器里**遗留的 v1 SW 仍会继续拦截请求**：
 *   v2 的工具页是懒加载分片（assets/*.js），一旦被旧 SW 的缓存/失效逻辑挡住，
 *   就会出现「外壳能开、工具打不开」的假故障。
 *
 * 做法：浏览器在「更新检查」时抓到本文件 → 立即 skipWaiting → activate 时
 *   清空所有旧缓存、注销自身，并让已打开的页面重新加载（此后不再有 SW 拦截）。
 * 这是**唯一**在 v2 内保留的 Service Worker 文件，且它一旦生效即自我移除。
 * ============================================================ */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k).catch(() => {})));
      } catch {
        /* 忽略 */
      }
      try {
        await self.registration.unregister();
      } catch {
        /* 忽略 */
      }
      try {
        const list = await self.clients.matchAll({ type: 'window' });
        for (const c of list) {
          try {
            c.navigate(c.url);
          } catch {
            /* 忽略 */
          }
        }
      } catch {
        /* 忽略 */
      }
    })(),
  );
});
