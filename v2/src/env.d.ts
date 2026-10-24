/**
 * 构建期注入的全局常量（vite.config.ts `define`）。
 * 唯一来源是 v2/package.json 的 version；代码中禁止再出现硬编码版本号
 * （一致性由 scripts/version-check.mjs 在 CI 校验）。
 */
declare const __APP_VERSION__: string;
