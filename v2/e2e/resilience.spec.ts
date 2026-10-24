import { expect, test } from '@playwright/test';
import fs from 'node:fs';

/**
 * resilience.spec.ts — A4 验收的运行时证明（改进计划 A4）
 * ① ErrorBoundary：人为渲染异常（dev 崩溃探针 #/dev/crash）不白屏，重试 / 返回可用；
 * ② 诊断通道：window.onerror / unhandledrejection 入环形缓冲，「导出诊断 JSON」纯本地可取证。
 * 注意：本 spec 故意制造错误，不做 0 console error 断言（那是 smoke.spec 的职责）。
 */

test('ErrorBoundary · 人为渲染异常不白屏，重试后恢复主界面', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  // #/dev/crash 仅在 dev 构建存在（import.meta.env.DEV）；首次渲染抛错 → ErrorBoundary 接管
  await page.goto('/#/dev/crash');
  await expect(page.locator('text=该工具出错')).toBeVisible();
  await expect(page.locator('text=人为渲染异常')).toBeVisible();
  // 错误被边界捕获，不应作为未捕获异常漏到 window（漏出即等于白屏级故障）
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  // 「重试」：探针只抛一次 → App 恢复正常渲染（回到首页内容）
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.locator('text=快速开始 · 模板')).toBeVisible();
});

test('ErrorBoundary · 「返回命令中心」可脱离错误视图', async ({ page }) => {
  await page.goto('/#/dev/crash');
  await expect(page.locator('text=该工具出错')).toBeVisible();
  await page.getByRole('button', { name: '返回命令中心' }).click();
  await expect(page.locator('text=快速开始 · 模板')).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
});

test('诊断导出 · onerror 与 unhandledrejection 入环形缓冲，JSON 纯本地且含版本', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page.locator('section.hero h1')).toHaveText('设置中心');
  // 人为制造两类错误（不返回被拒 Promise，确保走 window 级监听而非 Playwright 的 evaluate 捕获）
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('boom-onerror-e2e');
    }, 0);
  });
  await page.evaluate(() => {
    void Promise.reject(new Error('boom-rejection-e2e'));
  });
  await page.waitForTimeout(300); // 事件派发落盘到环形缓冲
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15_000 }),
    page.getByRole('button', { name: '导出诊断 JSON' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^诊断-\d+\.\d+\.\d+-\d{4}-\d{2}-\d{2}\.json$/);
  const file = await download.path();
  const snap = JSON.parse(fs.readFileSync(file!, 'utf8')) as {
    app: string;
    version: string;
    entries: Array<{ kind: string; msg: string }>;
  };
  expect(snap.app).toBe('ft-lt-play-v2');
  expect(snap.version).toMatch(/^\d+\.\d+\.\d+$/);
  // Chrome 会对未捕获错误加 "Uncaught " 前缀，这里只断言 kind + 消息原文命中
  expect(snap.entries.some((e) => e.kind === 'error' && e.msg.includes('boom-onerror-e2e'))).toBe(true);
  expect(snap.entries.some((e) => e.kind === 'rejection' && e.msg.includes('boom-rejection-e2e'))).toBe(true);
  // 隐私契约：快照只有固定字段，绝无实验 / 剧本 / 笔记等 localStorage 内容
  expect(Object.keys(snap).sort()).toEqual(['app', 'entries', 'env', 'exportedAt', 'route', 'version']);
});
