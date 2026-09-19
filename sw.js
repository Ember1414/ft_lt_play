/* ============================================================
 * sw.js — Service Worker（PWA 离线支持）
 *   策略：
 *   - 本地带 ?v= 的版本化资产：cache-first + 后台更新（stale-while-revalidate）
 *   - 导航请求（index.html）：network-first，离线回落缓存
 *   - CDN（KaTeX/mathjs/字体）：stale-while-revalidate（首次需在线，之后离线可用）
 *   版本 VER 必须与 index.html 的 ?v= 同步（build.mjs 校验）。
 * ============================================================ */
const VER = 'fltp-8.6';
const CORE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/icon.svg',
  'assets/css/style.css?v=8.6',
  'assets/js/lib/util.js?v=8.6',
  'assets/js/lib/mathdsp.js?v=8.6',
  'assets/js/lib/plots.js?v=8.6',
  'assets/js/lib/fx.js?v=8.6',
  'assets/js/lib/mathinput.js?v=8.6',
  'assets/js/lib/blocksolve.js?v=8.6',
  'assets/js/lib/transforms.js?v=8.6',
  'assets/js/lib/odesolve.js?v=8.6',
  'assets/js/lib/statespace.js?v=8.6',
  'assets/js/lib/project.js?v=8.6',
  'assets/js/lib/toolbar.js?v=8.6',
  'assets/js/lib/palette.js?v=8.6',
  'assets/js/lib/workerpool.js?v=8.6',
  'assets/js/app.js?v=8.6',
  'assets/js/modules/workbench.js?v=8.6',
  'assets/js/modules/fourier-series.js?v=8.6',
  'assets/js/modules/fourier-transform.js?v=8.6',
  'assets/js/modules/laplace.js?v=8.6',
  'assets/js/modules/system.js?v=8.6',
  'assets/js/modules/pid.js?v=8.6',
  'assets/js/modules/zt.js?v=8.6',
  'assets/js/modules/blockdiag.js?v=8.6',
  'assets/js/modules/derive.js?v=8.6',
  'assets/js/modules/explore.js?v=8.6',
  'https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css',
  'https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.js',
  'https://cdn.jsdelivr.net/npm/mathjs@12.4.3/lib/browser/math.js',
  'https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.0.19/index.css'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VER);
    await Promise.all(CORE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => { })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VER).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 导航：network-first，离线回落 index.html 缓存
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(VER);
        cache.put('./', fresh.clone()).catch(() => { });
        return fresh;
      } catch (err) {
        const cache = await caches.open(VER);
        return (await cache.match('./')) || (await cache.match('index.html')) || Response.error();
      }
    })());
    return;
  }

  const local = url.origin === self.location.origin;
  const versioned = local && url.search.includes('v=');
  const cdn = /cdn\.jsdelivr\.net|unpkg\.com/.test(url.hostname);

  if (!local && !cdn) return;

  // stale-while-revalidate：先缓存后更新
  e.respondWith((async () => {
    const cache = await caches.open(VER);
    const cached = await cache.match(req);
    const refresh = fetch(req).then((res) => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => { }); return res; }).catch(() => { });
    if (cached) { e.waitUntil(refresh); return cached; }
    const fresh = await refresh;
    return fresh || Response.error();
  })());
});
