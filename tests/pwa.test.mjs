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
  ok('sw.js 含 CDN 缓存（KaTeX/mathjs）', sw.includes('katex.min.js') && sw.includes('math.js'));
  ok('sw.js 导航 network-first 回落', /req\.mode === 'navigate'/.test(sw) && sw.includes("cache.match('./')"));
  ok('sw.js 旧缓存清理', sw.includes('caches.delete'));
  ok('app.js 注册守卫（仅 https/localhost）', /serviceWorker' in navigator/.test(read('assets/js/app.js')) && /localhost/.test(read('assets/js/app.js')));
  // fetch 拦截不缓存非 GET
  ok('sw.js 仅拦截 GET', sw.includes("req.method !== 'GET'"));
}

console.log(fails.length
  ? `✗ pwa ${pass} 通过，${fails.length} 失败:\n  ` + fails.join('\n  ')
  : `✓ pwa ${pass} 项全部通过`);
process.exit(fails.length ? 1 : 0);
