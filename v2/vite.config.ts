import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

/**
 * v2 构建配置
 * - 产物为纯静态（相对路径 base，可部署到任意子路径 / 静态托管）
 * - JSX 走 Preact 的 automatic runtime（不引 @preact/preset-vite，保持依赖最小）
 * - __APP_VERSION__ 是全仓唯一版本来源（v2/package.json）→ 设置页 / 备份包 / 报告均读取它
 */
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  server: {
    port: 5199,
    strictPort: true,
  },
});