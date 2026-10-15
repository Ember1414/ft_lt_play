import { defineConfig } from 'vite';

/**
 * v2 构建配置
 * - 产物为纯静态（相对路径 base，可部署到任意子路径 / 静态托管）
 * - JSX 走 Preact 的 automatic runtime（不引 @preact/preset-vite，保持依赖最小）
 */
export default defineConfig({
  base: './',
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