# 信号与控制实验平台 · v2

面向**一切与信号 / 控制打交道的人**（学生、教师、工程师）的专业级通用工具箱。
纯前端、无服务端、不上传任何数据——全部计算、图表与存储在浏览器本地完成（local-first）。

- 技术栈：**Vite 5 + TypeScript(strict) + Preact 10**，零运行时框架以外的依赖；KaTeX 已本地打包但**按需动态加载**。
- 13 个工具：傅立叶级数 `ft` · 傅立叶变换 `fourier` · 拉普拉斯 `laplace` · Z 变换 `z` · 系统分析 `sys` ·
  PID 整定 `pid` · 系统框图 `block` · 交互求解 `solve` · 公式推导 `derive` · 滤波器设计 `filter` ·
  控制系统设计 `control` · 随机信号实验室 `random` · 调制与通信 `comm`。
- 学习路径（3 条内置，进度本地保存）· 演示剧场（5 部内置剧本 + **自建剧本可编辑 / 分享**，参数插值平滑过渡，可导出内容包） ·
  对比实验 A/B（**真实曲线同屏叠加** + **实时同屏双跑 · 可调参**） · 内容包 / 提交包 · 备份（实验 + 自建剧本）· 笔记 · 语音输入。

## 开发与构建

```bash
cd v2
npm ci            # 或 npm install
npm run dev       # 开发服务器
npm run check     # TypeScript strict 类型检查（零错误）
npm run parity    # 内核回归网：v1 ↔ v2 数值对拍 + 闭式真值校验
npm run audit     # 内核语义 / 审计断言（§四 空洞 + #12/#14/#9 + M21 阻尼振荡项）
npm run uidata    # UI 数据层断言（剧本库 / 备份包 / 参数表规则 / 指标对照 / 坐标图刻度与缩放规则）
npm run perf      # 主线程重算开销巡检（灾难级预算 + 基线表）
npm run build     # 类型检查 + 生产构建（产物在 dist/）
npm run preview   # 本地预览生产产物（http://localhost:5200）
npm run e2e       # Playwright 冒烟：13 工具 × 浅/深主题 0 console error + 5 条关键交互（需先 npx playwright install chromium）
npm run verify    # check + parity + audit + uidata + perf + build + e2e（本地与 CI 同口径）
```

## 质量门（每次改动内核后必须全绿）

| 门 | 命令 | 基线 |
|---|---|---|
| 类型 | `npm run check` | tsc strict 零错误 |
| 回归网 | `npm run parity` | **77/77 组 v1↔v2 一致** + **37/37 闭式真值通过** |
| 语义审计 | `npm run audit` | 9 组语义/闭式断言全通过 |
| UI 数据层 | `npm run uidata` | **90 条断言全通过**（剧本库编解码 / 备份数据通路 / 参数表规则 / 指标对照规则 / 坐标图刻度与缩放规则） |
| 开销巡检 | `npm run perf` | 主线程合计 ≤ 150 ms（基线 15.1 ms）、单项 ≤ 25 ms（基线最大 3.5 ms）；≥5 ms 打 ⚠ |
| 构建 | `npm run build` | 通过；入口 chunk JS **137.2 KB（gzip 55.8 KB）**、KaTeX 分片 262.5 KB（按需），dist ≈ 1.80 MB |
| 版本一致性 | `npm run version:check` | package.json = CHANGELOG 最新条目；src 无硬编码版本；设置页走 `__APP_VERSION__` 注入 |
| 浏览器冒烟 | `npm run e2e` | 13 工具 × 浅/深主题加载 0 console error + **双主题截图视觉基线**（`e2e/baseline/`，首轮经人工确认；`toHaveScreenshot` 断言） + 5 条关键交互 + ErrorBoundary/诊断韧性（Chromium；CI 单 worker） |

> 责任边界：`parity` / `audit` 管**内核正确性**，`uidata` 管**内核之外的数据逻辑**，`perf` 管**内核调用开销**
> （它只覆盖 `src/core`；JSX 渲染与交互由各里程碑的**浏览器走查**负责）。
> `perf` 的门是有意放宽的**灾难级**预算——数量级以下的退化请把输出与《M15 验收单》§二 基线表人工比对。

## 内核约定（迁移红线）

- 多项式系数一律**自高到低**；复数一律 `{ re, im }`；`{ ok, ... }` / `{ ok:false, note }` 字段名与语义**不得更改**。
- UI 层只允许 `import '../core'`（统一出口 `src/core/index.ts`）。
- 数值容差一律取自 `src/core/tol.ts`（具名常量，见 M4 #8）；**禁止**再散落魔法数字。
- 任何内核改动后必须运行 `npm run parity`（+ `npm run audit`），全部通过方可提交。
- 对拍网含「闭式真值校验」段（防 v1 / v2 同错）：新增 / 修改解析式求值路径时必须补对应闭式真值用例，
  真值用例只允许依赖数学闭式，不得引用任一侧实现。
- **奈奎斯特围线采样（M11/M14）**：`nyquistFull` 的虚轴直线段为 `NYQ_AXIS_SEG`（5000 点/段），
  并对**全部互不相邻**的「近临界轴段」做临界邻域自适应加密
  （`NYQ_REFINE_ROUNDS` / `NYQ_REFINE_MAX` / `NYQ_REFINE_FACTOR`）。
  改动这些常量或加密策略后**必须**重跑 `npm run parity`（16 组奈奎斯特用例的
  `P/N/Z/stable/onCritical` 须与 v1 逐字段一致）与 `npm run audit`（#12 的 11 条 Routh 闭式断言）。
  ⚠ 另注意：**「相邻采样密度下结果一致」不能作为正确性判据**（粗采样可能稳定地漏看局部几何，
  见《M14 验收单》§一），因此不要把它替换为「结果收敛就停」的实现。

## 目录

```
v2/
├─ src/
│  ├─ core/        # 纯数值内核（TS，无 DOM；只经 index.ts 出口）
│  ├─ tools/       # 13 个工具视图（按需加载，tools/lazy.ts）
│  ├─ chart/       # 图表层（Canvas / SVG）
│  ├─ ui/          # 通用组件与控件
│  ├─ state/       # 实验模型 / 应用状态 / 剧场 / 对比槽
│  ├─ pages/       # 首页 / 设置 / 实验管理 / 对比 / 剧场 / 画廊
│  └─ report/      # 导出（PNG / 自包含 HTML 报告）
├─ public/_headers # Cloudflare Pages 缓存与安全头（含收紧 CSP）
├─ scripts/        # parity.mjs（内核回归网）· audit.mjs（内核语义审计）· uidata.mjs（UI 数据层断言）· perf.mjs（开销巡检）
└─ docs（见仓库根 docs/v2/）
```

## 部署

Cloudflare Pages 取向：`v2/public/_headers` 随构建进入 `dist/`（`/assets/*` 一年 immutable 长缓存、
`/index.html` no-cache、全站安全头 + 收紧 CSP）。相对 base 为 `./assets/`，可部署到任意子路径。
CI（`.github/workflows/ci.yml`）与发布流程（`deploy-v2.yml`，未配置密钥时自动跳过部署）已就绪。
详见 `docs/v2/部署说明.md`。

## 文档索引

| 文档 | 说明 |
|---|---|
| `docs/v2/规划书.html` | M0 规划书（14 项产品维度 / 信息架构 / 交互规范） |
| `docs/v2/改进计划.md` | 2026-10 全仓体检 + 三批改进路线（批次 A 基线收口 / B 数据与可访问性 / C 性能与工程化） |
| `docs/v2/M1-验收单.md` … `M19-验收单.md`、`M6-走查报告.md`、`M17-走查报告.md` | 各里程碑交付、M5/M7/M8 增强、M9 剧场剧本库、M10 备份含剧本、M11 奈奎斯特临界判定、M12 对比页标量参数可调、M13 UI 数据层断言并入 CI、M14 临界档位圈数修正、M15 开销基线、M16 双跑自报指标对照、M18 坐标图交互质量、**M19 全站缺陷修复与显示精简**（工具而非教学）、M6 全站走查、M17 全站回归走查（21 视图 · 零缺陷） |
| `docs/v2/M20-验收单.md`、`docs/v2/M21-验收单.md` | **M20** 参数控件/坐标图/框图交互/PID 正确性；**M21** Z 域阻尼振荡项（复极点谐振器） |
| `docs/v2/存量问题清单.md` | v1 审计 → v2 处置（含 #7–#15 重修记录） |
| `docs/v2/部署说明.md` | 构建 / 发布 / 缓存与 CSP / 发布前检查清单 |
| `CHANGELOG.md`（本目录） | 版本变更记录 |
