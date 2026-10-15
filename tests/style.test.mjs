/* ============================================================
 * style.test.mjs — 界面样式契约（纯文本校验）
 *   运行：node tests/style.test.mjs
 *   为什么不用浏览器断言：滚动条宽度等表现依赖真实渲染环境，
 *   CI 无浏览器；这里守护「关键规则确实写在正确的媒体查询里」，
 *   配合人工/浏览器冒烟即可防止回归。
 *   覆盖：① 窄屏滚动条收细（手机版右侧滑动条过宽）
 *        ② 一次性 CDN 提示角标（不再常驻整宽横幅遮挡页面）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

let pass = 0;
const fails = [];
const ok = (n, c, extra) => { if (c) { pass++; return; } fails.push(n + (extra ? '  → ' + extra : '')); };

const css = read('assets/css/style.css');
const app = read('assets/js/app.js');

/* 抽出指定媒体查询的全部块（花括号配对；同一断点可能有多段） */
function mediaBlocks(query) {
  const out = [];
  let at = css.indexOf('@media ' + query);
  while (at >= 0) {
    const open = css.indexOf('{', at);
    let d = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') d++;
      else if (css[i] === '}') { d--; if (d === 0) { out.push(css.slice(open + 1, i)); at = css.indexOf('@media ' + query, i); break; } }
    }
  }
  return out.join('\n');
}
const narrow = mediaBlocks('(max-width: 900px)');

/* ---------- ① 滚动条：桌面 10px，窄屏收细到 ≤6px ---------- */
{
  const baseW = (css.match(/::-webkit-scrollbar\s*\{[^}]*width:\s*(\d+)px/) || [])[1];
  ok('桌面滚动条宽度 10px（基准不变）', baseW === '10', 'width=' + baseW);
  const m = narrow.match(/::-webkit-scrollbar\s*\{[^}]*width:\s*(\d+)px/);
  ok('≤900px 媒体块内声明滚动条宽度', !!m, narrow.slice(0, 80));
  ok('窄屏滚动条收细到 ≤6px（手机版右侧滑动条过宽）', m && Number(m[1]) <= 6, m && ('width=' + m[1]));
  ok('窄屏滚动条滑块圆角同步收窄', /::-webkit-scrollbar-thumb\s*\{[^}]*border-radius:\s*3px/.test(narrow));
}

/* ---------- ② CDN 提示：一次性角标（可关闭 + 自动消失 + 不盖底部标签栏） ---------- */
{
  ok('样式含一次性 CDN 提示角标 .cdn-notice', /\.cdn-notice\s*\{/.test(css));
  ok('.cdn-notice 不再是整宽横幅（left/right 同时固定）', !/\.cdn-notice\s*\{[^}]*left:\s*0[^}]*right:\s*0/.test(css));
  ok('.cdn-notice 提供关闭按钮样式', /\.cdn-notice-x\s*\{/.test(css));
  ok('窄屏下角标抬起避开底部标签栏', /\.cdn-notice\s*\{[^}]*bottom:\s*calc\(80px \+ env\(safe-area-inset-bottom/.test(narrow));
  // 旧实现：每个资源失败各 append 一条整宽 role=alert 横幅，且永久驻留
  ok('app.js 不再产出旧的常驻整宽 CDN 横幅', !app.includes('公式库 CDN 不可用') && !app.includes("role: 'alert'"));
  ok('app.js 按镜像顺序补载 KaTeX（多源回退）', /CDN_MIRRORS/.test(app) && /unpkg\.com\/katex/.test(app) && /cdnjs\.cloudflare\.com/.test(app));
  ok('app.js 提示去重（同一提示只保留一条）', /getElementById\('cdn-notice'\)\s*\)\s*return/.test(app) && /id: 'cdn-notice'/.test(app));
  ok('app.js 提示自动消失（不常驻）', /setTimeout\([\s\S]{0,90}?box\.remove\(\)/.test(app));
  ok('app.js 不再加载已移除的 mathjs', !/mathjs/.test(app));
}

console.log(fails.length
  ? `✗ style ${pass} 通过，${fails.length} 失败:\n  ` + fails.join('\n  ')
  : `✓ style ${pass} 项全部通过`);
process.exit(fails.length ? 1 : 0);
