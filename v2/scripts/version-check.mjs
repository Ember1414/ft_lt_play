/* ============================================================
 * version-check.mjs — 版本单一来源一致性校验（零依赖，进 CI）
 *
 * 规则（改进计划 A1）：
 *   1) v2/package.json 的 version 是全仓唯一版本来源（形态 2.x.y）；
 *   2) v2/CHANGELOG.md 最新条目 `## [x.y.z]` 必须与之一致；
 *   3) src/** 不允许再出现硬编码的应用版本字面量（2.x.y）——
 *      显示一律走构建期注入的 __APP_VERSION__（vite.config.ts define）；
 *   4) Settings.tsx 必须通过 __APP_VERSION__ 取版本（设置页「关于」）。
 *
 * 运行：node scripts/version-check.mjs   （或 npm run version:check）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];

/* 1) package.json */
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const ver = String(pkg.version ?? '');
if (!/^\d+\.\d+\.\d+$/.test(ver)) fails.push(`package.json version 非法："${ver}"（应为 x.y.z）`);

/* 2) CHANGELOG 最新条目 */
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const m = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m);
if (!m) fails.push('CHANGELOG.md 未找到 `## [x.y.z]` 版本条目');
else if (m[1] !== ver) fails.push(`CHANGELOG.md 最新条目 [${m[1]}] ≠ package.json [${ver}]`);

/* 3) src 内禁止硬编码应用版本字面量（2.x.y 形态） */
const scan = (dir) => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) scan(p);
    else if (/\.(ts|tsx)$/.test(f.name)) {
      const text = fs.readFileSync(p, 'utf8');
      const hits = text.match(/\b2\.\d+\.\d+\b/g);
      if (hits) fails.push(`${path.relative(root, p)} 出现硬编码版本字面量：${hits.join(', ')}（请改用 __APP_VERSION__）`);
    }
  }
};
scan(path.join(root, 'src'));

/* 4) 设置页必须走注入值 */
const settings = fs.readFileSync(path.join(root, 'src/pages/Settings.tsx'), 'utf8');
if (!settings.includes('__APP_VERSION__')) fails.push('src/pages/Settings.tsx 未使用 __APP_VERSION__（设置页版本号必须来自构建期注入）');

if (fails.length) {
  console.log(`\n版本一致性校验：✗ ${fails.length} 项失败`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`\n版本一致性校验：✓ package.json=${ver} = CHANGELOG 最新条目；src 无硬编码版本；设置页走 __APP_VERSION__`);
