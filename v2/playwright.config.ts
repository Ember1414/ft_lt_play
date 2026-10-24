import { defineConfig, devices } from '@playwright/test';

/**
 * playwright.config.ts — 浏览器级冒烟（改进计划 A3）
 * - 只跑 Chromium（保持 CI 稳定；如需多浏览器再扩 projects）
 * - webServer 复用 npm run dev（端口 5199，strictPort）
 * - 截图统一输出到 e2e/screenshots/<主题>/<工具>.png：首轮结果属「待人工确认的基线」，
 *   确认前不作为视觉断言（禁止自动接受差异），确认后升级为 toHaveScreenshot 基线
 * - CI：单 worker + 失败重试 1 次 + 失败保留 trace/截图
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  snapshotPathTemplate: '{testDir}/baseline/{arg}{ext}',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:5199',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5199',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
