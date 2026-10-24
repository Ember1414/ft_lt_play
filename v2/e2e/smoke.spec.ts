import { expect, test } from '@playwright/test';
import { collectErrors, openTool, THEMES, TOOLS, useTheme } from './helpers';

/**
 * smoke.spec.ts — 13 个工具 × 浅色/深色 双主题加载冒烟（改进计划 A3）
 * 每条：进入路由 → 等待主内容（懒分片加载完成）→ 断言 0 console error → 截图视觉断言。
 * 基线：e2e/baseline/<主题>-<工具>.png —— 2026-10-24 首轮输出经人工逐项确认后作为基线；
 * 后续任何像素差异都会让 CI 变红（差异图在 test-results 供比对），不允许静默接受差异。
 * 容差说明：动画工具（ft/fourier 等 Canvas rAF）按实测帧相位差给 maxDiffPixelRatio，
 * 静态工具零容差；阈值只吸收动画相位，不放宽布局/缺失类差异。
 */

const ANIMATED = new Set(['ft', 'fourier', 'comm', 'random']);

for (const theme of THEMES) {
  test.describe(`工具冒烟 · ${theme}`, () => {
    for (const tool of TOOLS) {
      test(`${tool.id} · ${tool.name}`, async ({ page }) => {
        const errors = collectErrors(page);
        useTheme(page, theme);
        await openTool(page, tool.id, tool.name);
        // 等待按需分片（含 KaTeX 等动态加载）全部落地后再取证
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveScreenshot(`${theme}-${tool.id}.png`, {
          fullPage: true,
          animations: 'disabled',
          // Canvas 动画的相位差只发生在绘图区内部；静态工具保持零容差
          ...(ANIMATED.has(tool.id) ? { maxDiffPixelRatio: 0.02 } : {}),
        });
        expect(errors, errors.join('\n')).toEqual([]);
      });
    }
  });
}
