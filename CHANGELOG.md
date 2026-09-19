# Changelog

格式参考 Keep a Changelog；版本号 = `package.json` version（页面资源 `?v=` 与侧栏版本同步更新）。

## [7.1.0] — 2026-09-19 · Phase 2 第一批

### 新增
- **实验契约扩展到 5 个模块**：`la`（H(s) 状态 + s 平面/响应 PNG + 阶跃 CSV）、
  `pid`（对象+Kp/Ki/Kd 状态 + 响应 PNG/CSV）、`explore`（页签+表达式状态 + PNG）
  ——实验闭环（保存/复制/重置/分享/导出）现覆盖 sys / zt / la / pid / explore
- **稳态误差与系统型别**（`DSP.steadyState`，系统分析模块）：
  型别 ν、静态误差系数 Kp/Kv/Ka、单位阶跃/斜坡/抛物线输入的稳态误差
  （型别不足 → ∞，富余 → 0），随指标栏实时更新
- **完整奈奎斯特判据 Z = N + P**（`DSP.nyquistFull`，奈奎斯特图注）：
  s 域围线含虚轴极点右侧 indent 与大半圆闭合，数值计算对 (−1,0) 的顺时针
  包围圈数 N，Z=N+P 与闭环求根交叉验证（K=3 稳定 / K=10 不稳定 / P=2 等案例）
- `tests/ctrl.test.mjs`（41 项：稳态误差全型别 + 奈奎斯特判据交叉验证）；
  api-contract 扩至 32 项（5 模块）

### 兼容性
- 奈奎斯特图注从「仅开环稳定简化判据」升级为完整判据，开环稳定时的简化说明保留

## [7.0.0] — 2026-09-19 · Phase 0 + Phase 1

平台升级起点：从「交互式可视化学习工具」升级为「信号与控制实验平台」的第一阶段（工程/安全基线 + 实验闭环垂直切片）。

### 新增
- **实验工作台**（`assets/js/modules/workbench.js`，侧栏新入口 ⌂ 工作台）：
  - 快速开始模板（6 个：sys×3、zt×3，一键创建实验并打开模块）
  - 最近实验 / 收藏 / 搜索（实验+模板）/ 新建 / 重命名 / 复制 / 两步删除
  - 快照列表与一键恢复；JSON 文件导入导出；版本化分享码粘贴导入
  - 新用户三步引导
- **版本化实验存储**（`assets/js/lib/project.js` → `window.PX`）：
  - Experiment schema v1（moduleStates / snapshots / favorite / tags），拒绝式校验
    （NaN/Infinity/`__proto__`/超深/超长一律拒绝），迁移框架，配额错误显式处理
  - 存储 `fltp:v1:*`，上限 60 个；索引损坏自动重建
  - 分享码 v2：`PX1.<base64url>.<FNV-1a>`（校验和 + 长度上限 + Unicode 支持）
- **实验控制器**（`app.js` → `App.exps`）：自动保存（切换/刷新前捕获 + 防抖落盘）、
  刷新恢复最近实验、`#exp=` 分享导入路由、实验激活期间抑制模块旧版 hash 覆盖
- **统一结果工具栏**（`assets/js/lib/toolbar.js` → `window.RTB`）：
  💾 保存实验 · ⧉ 复制 · ↺ 重置 · 🔗 分享 · 🖼 PNG · 📊 CSV · 📄 JSON；
  首批接入 **系统分析** 与 **Z 变换**
- 全局轻提示 `App.toast`（aria-live）；剪贴板不可用时的手动复制浮层
- 工程化：`package.json` + `npm run check/lint/format/build/preview/test/verify`
  （零依赖脚本）；GitHub Actions CI；Cloudflare Pages `_headers`（CSP 等）
- 测试：`tests/project.test.mjs`（54）、`tests/safeeval.test.mjs`（22）、
  `tests/workbench.test.mjs`（40，含工具栏降级与分享码导入对话流程）

### 变更
- 安全：删除 `transforms.js` 中经 `Function()` 动态执行用户表达式的实现
  （`U.safeCalc` 白名单算术求值器替代）；mathjs `parseTimeExpr` 增加 AST
  白名单与长度/节点数上限；`index.html` 移除 `document.write` 内联回退脚本，
  备用源加载移入 `app.js`（配合 CSP）
- 品牌与文案：标题/描述更新为「信号与控制实验平台」；帮助弹窗补工作台与工具栏说明
- `system.js`/`zt.js` 实现 `getState/applyState`，实验状态可捕获可回放

### 兼容性
- 旧版单输入分享链接（`#hn/#ex/#lan/#ft/#fs/#zt/#blk`）全部保持可用
- 模型库（`flt-models`）与各输入历史键不受影响
- 实验数据带 `schemaVersion`，未来升级走 `PX.migrate` 迁移表

### 修复（本轮浏览器冒烟发现的存量问题）
- `system.js`：MI 迁移后遗留的 `#sys-num/#sys-den` 提前绑定导致系统分析打开即崩
  （Enter 键行为由 MI 组件原生处理，删除冗余绑定）
- `system.js`：符号参数行容器 `#sys-params` 缺失导致求解即崩
- 新增静态防线：`tests/dom-ids.test.mjs`（全模块 id 引用交叉核对）、
  lint L5（MI 运行时 id 不得提前引用）、`tests/api-contract.test.mjs`
  （sys/zt 必须暴露 getState/applyState 且产物过 PX 校验）

## [6.3] — 2026-09-19
输入层子系统（MI 统一输入、方程求解、符号参数与家族曲线、模型库与跨模块交接）、
ComplexPlane 撤销、块图采样分析（详见 `docs/superpowers/specs/2026-09-19-input-layer-design.md`）。

## [6.2] 及更早
见 git log（v2.0 框图编辑器 / v1.4 手绘形状 / v1.3 根轨迹修正 / v1.2 分数线 TF…）。
