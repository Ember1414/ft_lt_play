import { expect, test } from '@playwright/test';
import { collectErrors, openTool, useTheme } from './helpers';
import fs from 'node:fs';

/**
 * interactions.spec.ts — 关键交互回归（改进计划 A3，浅色主题）
 * 覆盖：参数步进 / 图表滚轮缩放+双击复位 / 框图端口拉线 / 分享码导入 / 报告导出。
 * 每条均以「行为结果」断言（值变化 / 连线数 / 下载文件），并断言 0 console error。
 */

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.beforeEach(async ({ page }) => {
  useTheme(page, 'light');
});

test('sys · 参数步进（−/+ 按钮改变参数值）', async ({ page }) => {
  const errors = collectErrors(page);
  await openTool(page, 'sys', '系统分析');
  const input = page.locator('.c-num-input').first();
  const before = await input.inputValue();
  await page.locator('.c-num-step[aria-label^="增大"]').first().click();
  await expect
    .poll(() => input.inputValue(), { timeout: 5_000 })
    .not.toEqual(before);
  await page.locator('.c-num-step[aria-label^="减小"]').first().click();
  await expect.poll(() => input.inputValue(), { timeout: 5_000 }).toEqual(before);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('sys · 图表滚轮缩放 + 双击复位（0 console error）', async ({ page }) => {
  const errors = collectErrors(page);
  await openTool(page, 'sys', '系统分析');
  const canvas = page.locator('.ws-body canvas').first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('sys 画布无 boundingBox');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -240); // 放大
  await page.mouse.move(cx - 30, cy - 20);
  await page.mouse.move(cx + 30, cy + 20); // 平移
  await page.mouse.dblclick(cx, cy); // 双击复位（图表层统一行为）
  await expect(canvas).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('block · 从输出端口拉线到目标元件（连线数 0 → 1）', async ({ page }) => {
  const errors = collectErrors(page);
  await openTool(page, 'block', '系统框图');
  await expect(page.locator('.ws-left')).toBeVisible();
  // 空白画布 → 添加两个元件（方框 + 求和点）
  await page.getByRole('button', { name: '方框', exact: true }).click();
  await page.getByRole('button', { name: '求和点', exact: true }).click();
  await expect(page.locator('text=/2 元件 · 0 连线/').first()).toBeVisible();
  // 从第 1 个元件的输出端口按下，拖到第 2 个元件上松手
  const from = await page.locator('.blk-port-hit').first().boundingBox();
  const to = await page.locator('.blk-port-hit').nth(1).boundingBox();
  if (!from || !to) throw new Error('端口无 boundingBox');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('text=/2 元件 · 1 连线/').first()).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('分享码导入（首页模板 → 分享码 → #exp= 导入并打开）', async ({ page }) => {
  const errors = collectErrors(page);
  // 1) 首页模板创建一个实验（sys）
  await page.goto('#/');
  await expect(page.locator('.tpl-card').first()).toBeVisible();
  await page.locator('.tpl-card').first().click();
  await expect(page.locator('.ws-title')).toHaveText('系统分析');
  // 2) 实验管理 → 勾选 → 复制 PX1 分享码
  await page.goto('/#/experiments');
  await page.locator('input[type="checkbox"]').first().check();
  await page.getByRole('button', { name: '复制单实验分享码' }).click();
  const code = await page.evaluate(() => navigator.clipboard.readText());
  expect(code.startsWith('PX1.'), '分享码应为 PX1. 前缀：' + code.slice(0, 12)).toBeTruthy();
  // 3) 打开导入页 → 校验通过 → 导入并打开
  await page.goto(`/#exp=${code}`);
  await expect(page.locator('text=分享码校验通过')).toBeVisible();
  await page.getByRole('button', { name: '导入并打开' }).click();
  await expect(page.locator('.ws-title')).toHaveText('系统分析');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('sys · 报告导出（自包含 HTML，含注入版本号）', async ({ page }) => {
  const errors = collectErrors(page);
  await openTool(page, 'sys', '系统分析');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    page.getByRole('button', { name: '导出报告' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^报告-sys-\d{4}-\d{2}-\d{2}\.html$/);
  const file = await download.path();
  const html = fs.readFileSync(file!, 'utf8');
  expect(html).toContain('实验报告');
  expect(html).toContain('图表');
  // A1 版本单一来源：报告 footer 的版本 = __APP_VERSION__（package.json 2.16.0）
  expect(html).toMatch(/版本：\d+\.\d+\.\d+/);
  expect(errors, errors.join('\n')).toEqual([]);
});
