import { expect, type Page } from '@playwright/test';

/**
 * helpers.ts — e2e 公共工具
 * 工具清单直接引用 src/tools/registry.ts（单一来源）：注册表新增工具，冒烟自动覆盖。
 */

export type Theme = 'light' | 'dark';

export const THEMES: Theme[] = ['light', 'dark'];

export { TOOLS } from '../src/tools/registry';

/** 在应用脚本执行前写入主题偏好（ui/theme.ts 的存储键）， deterministically 固定主题 */
export function useTheme(page: Page, theme: Theme): void {
  void page.addInitScript((t) => localStorage.setItem('flt2:theme', t), theme);
}

/** 收集 console error 与未捕获异常；测试末尾统一断言为空 */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/** 打开工具路由并等待「主内容已渲染」：懒分片加载完成前 .ws-body 没有子元素 */
export async function openTool(page: Page, toolId: string, toolName: string): Promise<void> {
  await page.goto(`/#/tools/${toolId}`);
  await expect(page.locator('.ws-title')).toHaveText(toolName);
  await expect(page.locator('.ws-body > *').first()).toBeVisible({ timeout: 20_000 });
}
