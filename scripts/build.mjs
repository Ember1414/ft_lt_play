/* ============================================================
 * build.mjs — 构建校验（静态站点，无打包）
 *   1) 语法 + lint + 测试由 npm run verify 串联，本脚本负责产物校验：
 *      - index.html 引用的本地资源全部存在
 *      - _headers 安全响应头存在且 CSP 覆盖 script/style 来源
 *      - 输出资源体积报告（>400KB 告警）
 *   2) 部署：npx wrangler pages deploy . --project-name=ft-lt-play --branch=main
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let bad = 0;
const err = (m) => { bad++; console.error('✗ ' + m); };

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="(assets\/[^"?]+)/g)].map((m) => m[1]);
for (const p of refs) if (!fs.existsSync(path.join(root, p))) err(`index.html 引用缺失: ${p}`);

const headersPath = path.join(root, '_headers');
if (!fs.existsSync(headersPath)) err('缺少 _headers（CSP 等安全响应头）');
else {
  const h = fs.readFileSync(headersPath, 'utf8');
  for (const must of ['Content-Security-Policy', 'script-src', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy'])
    if (!h.includes(must)) err(`_headers 缺少 ${must}`);
}

console.log('资源体积：');
for (const p of refs) {
  const fp = path.join(root, p);
  if (!fs.existsSync(fp)) continue;
  const kb = (fs.statSync(fp).size / 1024).toFixed(1);
  if (parseFloat(kb) > 400) console.log(`  ⚠ ${p} ${kb}KB（偏大）`);
  else console.log(`  ${p} ${kb}KB`);
}

if (bad) { console.error(`✗ build 校验失败 ${bad} 项`); process.exit(1); }
console.log(`✓ build 校验通过（静态直传，无打包产物）`);
