/* ============================================================
 * pwa.test.mjs — PWA 契约测试（manifest / Service Worker / 注册守卫）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

let pass = 0;
const fails = [];
const ok = (n, c, extra) => { if (c) { pass++; return; } fails.push(n + (extra ? '  → ' + extra : '')); };

const html = read('index.html');
const sw = read('sw.js');
const manifest = read('manifest.webmanifest');
const ver = (html.match(/\?v=([^"]+)/) || [])[1];

{
  ok('index.html 引用 manifest', html.includes('manifest.webmanifest'));
  ok('index.html 含 theme-color', html.includes('theme-color'));
  ok('manifest 是合法 JSON 且含图标/独立显示', (() => { try { const m = JSON.parse(manifest); return m.display === 'standalone' && Array.isArray(m.icons) && m.icons.length >= 1; } catch (e) { return false; } })());
  ok('icon.svg 存在且为 SVG', fs.existsSync(path.join(root, 'assets/icon.svg')) && read('assets/icon.svg').includes('<svg'));
  ok('sw.js VER 与 ?v= 同步', ver && sw.includes('fltp-' + ver), 'ver=' + ver);
  // index.html 全部本地资源被 sw.js CORE 覆盖
  const refs = [...html.matchAll(/(?:src|href)="(assets\/[^"?]+)/g)].map((m) => m[1]);
  const missing = refs.filter((p) => !sw.includes(p));
  ok('sw.js CORE 覆盖全部本地资源', missing.length === 0, missing.join(', '));
  // v1.1.3：mathjs 已移除（时域解析改内置解析器，零外部依赖）；仅缓存 KaTeX 与字体
  ok('sw.js 含 CDN 缓存（KaTeX）', sw.includes('katex.min.js') && sw.includes('katex.min.css'));
  ok('sw.js 预缓存不含已移除的 mathjs', !sw.includes('math.js'));
  ok('sw.js 备用镜像域名纳入 CDN 缓存分支', /cdnjs\\?\.cloudflare\\?\.com/.test(sw));
  ok('sw.js 导航 network-first 回落', /req\.mode === 'navigate'/.test(sw) && sw.includes("cache.match('./')"));
  ok('sw.js 旧缓存清理', sw.includes('caches.delete'));
  ok('app.js 注册守卫（仅 https/localhost）', /serviceWorker' in navigator/.test(read('assets/js/app.js')) && /localhost/.test(read('assets/js/app.js')));
  // fetch 拦截不缓存非 GET
  ok('sw.js 仅拦截 GET', sw.includes("req.method !== 'GET'"));
}

/* ---------- _headers（部署响应头）契约 ---------- */
{
  const headers = read('_headers');
  // 生产事故回归：CSP 未放行 blob: Worker → 根轨迹 / PID 寻优 new Worker 抛错、功能静默失效
  ok('_headers 显式放行 worker-src blob:', /worker-src[^;]*blob:/.test(headers));
  ok('_headers script-src 覆盖备用镜像', /script-src[^;]*unpkg\.com/.test(headers) && /script-src[^;]*fastly\.jsdelivr\.net/.test(headers) && /script-src[^;]*cdnjs\.cloudflare\.com/.test(headers));
  ok('_headers font-src 覆盖自身与备用镜像（KaTeX 字体）', /font-src[^;]*'self'/.test(headers) && /font-src[^;]*unpkg\.com/.test(headers) && /font-src[^;]*data:/.test(headers));
  // 站点已不再依赖 mathjs（时域解析为内置解析器）
  ok('index.html 不再引入 mathjs', !html.includes('mathjs'));
  // KaTeX 主源 = fastly.jsdelivr（CSS 与字体同源，避免 CSS 可达而字体被单点阻断）+ SRI 保留
  ok('index.html KaTeX 主源为 fastly.jsdelivr 且带 SRI', /href="https:\/\/fastly\.jsdelivr\.net\/npm\/katex@[\d.]+\/dist\/katex\.min\.css" integrity="/.test(html)
    && /src="https:\/\/fastly\.jsdelivr\.net\/npm\/katex@[\d.]+\/dist\/katex\.min\.js" integrity="/.test(html));
  ok('sw.js 预缓存与主源同源（fastly.jsdelivr）', sw.includes('fastly.jsdelivr.net/npm/katex'));
}

console.log(fails.length
  ? `✗ pwa ${pass} 通过，${fails.length} 失败:\n  ` + fails.join('\n  ')
  : `✓ pwa ${pass} 项全部通过`);
process.exit(fails.length ? 1 : 0);
