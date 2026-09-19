# Changelog

格式参考 Keep a Changelog；版本号 = `package.json` version（页面资源 `?v=` 与侧栏版本同步更新）。

## [8.1.0] — 2026-09-19 · 实验闭环覆盖 10/10 模块

### 新增
- **derive 公式推导接入实验契约与统一工具栏**：自定义推导表达式纳入
  实验状态（ getState/applyState ），工具栏支持保存/复制/分享/JSON
- api-contract 55 项 / **10 个模块全覆盖**；版本 8.1.0 / ?v=8.1

## [8.0.0] — 2026-09-19 · 统一结果工具栏覆盖 9/10 模块

### 新增
- **fs / ft / blk 接入统一结果工具栏（RTB）**：保存实验/复制/重置/分享/导出
  与其他模块一致；blk 的 PNG 导出按 SVG 编辑器特性自动省略，框图整体编码
  即实验状态（浏览器实测 blk1 编码入库）
- 实验闭环现覆盖 9/10 模块（仅 derive 待接），版本 8.0.0 / ?v=8.0

## [7.9.0] — 2026-09-19 · 实验契约覆盖 8/10 模块

### 新增
- **fs / ft / blk 接入实验契约**（getState/applyState）：
  fs 形状/谐波数/速度/圆环显示（经既有事件回放）；ft 页签+信号+参数
  （强制惰性重建后回放）；blk 框图整体编码往返（复用 blk1 编码与 readHash 重建）
- api-contract 扩至 50 项、8 个模块；浏览器实测 blk 编码往返一致、
  fs 保存→改乱→重置回放正确
- 版本 7.9.0 / ?v=7.9

### 已知边界
- fs 手绘自定义形状的点列不纳入实验状态（恢复的是形状模式而非手绘内容）；
  fs/ft/blk 暂无统一工具栏（保存经工作台/模块切换自动捕获），下批补齐

## [7.8.0] — 2026-09-19 · Z 变换：s↔z 三种映射对比

### 新增
- `BLKSOLVE.tustin` 双线性变换（s=(2/T)(z−1)/(z+1) 多项式代入，DC 增益守恒）
- Z 变换模块「s↔z 映射对比」面板：冲激不变 / ZOH / Tustin 三种映射的
  H(z) 多项式与 z 极点并列展示，附各方法的混叠/滞后/频率弯曲特性说明
- `tests/szmap.test.mjs` 13 项：Tustin 已知变换对、DC 守恒、三种映射极点
  （e^{pT} 与 Möbius 公式）逐一验证
- 版本 7.8.0 / ?v=7.8

## [7.7.0] — 2026-09-19 · PID 指标寻优

### 新增
- `DSP.pidOptimize`：坐标下降最小化 ISE/IAE/ITAE（确定性、增益非负、≤300 次
  仿真上限、继承当前限幅/抗饱和/采样约束）；tests/pidopt.test.mjs 8 项
- PID 整定向导新增「最优搜索」：指标选择（ISE/IAE/ITAE）+ 寻优前后对照表 +
  一键应用；浏览器实测 ITAE 170.6→0.47（降幅 99.7%，251 次仿真）
- 版本 7.7.0 / ?v=7.7

## [7.6.0] — 2026-09-19 · PID 整定向导（ZN / Cohen–Coon / CHR）

### 新增
- `DSP.znUltimate`：相位 −180° 穿越点求临界增益 Ku 与振荡周期 Tu（教科书案例
  1/(s(s+1)(s+2)) 精确给出 Ku=6、Tu=4.443）；无穿越对象明确说明
- `DSP.fopdtFit`：开环阶跃响应两点法（28.3%/63.2%）拟合 FOPDT 的 K、T、L，
  含稳态驻留检查（积分对象/未稳态拒绝）与 L→0 退化保护
- PID「整定向导」面板：ZN 闭环（P/PI/PID 三组一键应用）与反应曲线法
  （ZN 开环 / Cohen–Coon / CHR 0% / CHR 20%）；应用时自动设 Tf=Td/10
  （经典微分滤波规则）并联动滑杆重算
- `tests/tuning.test.mjs` 12 项；pidsim 补二阶/带零点对象等价回归（20 项）
- 版本 7.6.0 / ?v=7.6

## [7.5.0] — 2026-09-19 · PID 时域环路仿真（抗饱和/滤波/先行/数字 PID）

### 新增
- `DSP.pidLoopSim` 闭环时域仿真内核：对象相变量 RK4 + 控制器离散更新，支持
  执行器限幅、抗积分饱和（条件积分/反算 Tt）、不完全微分 Tf、微分先行 dOnM、
  数字 PID 采样周期 Ts（ZOH），设定值可为时变函数（r(t)）
- PID 模块「执行器与控制器细节」面板：上述参数全部可调并纳入实验状态（adv）；
  限幅时仿真窗口自适应加长、稳态以仿真末值评估；CSV 增加 u 列
- `tests/pidsim.test.mjs` 18 项：P/PI 与闭环传函严格等价、抗饱和方向性、
  微分踢复现与消除（设定值 t=2s 阶跃）、大 Kd 无滤波发散复现、数字 PID 收敛
- 版本 7.5.0 / ?v=7.5

### 变更
- PID 响应曲线由理想传函级联改为环路仿真（无附加项时二者一致由测试钉死）

## [7.4.0] — 2026-09-19 · PID 任意对象 + 误差积分指标

### 新增
- PID 模块支持**任意 G(s) 对象输入**（MI 分数线解析，挂入对象 chips，纳入实验状态）
- 阶跃响应指标新增 **ISE / IAE / ITAE**（DSP.errMetrics 梯形积分，ctrl.test 44 项）
- 版本 7.4.0 / ?v=7.4

## [7.3.0] — 2026-09-19 · Z 变换：Jury 判据

### 新增
- `DSP.jury` 离散稳定性特征表（a₀>0 / D(1)>0 / (−1)ⁿD(−1)>0 / |aₙ|<a₀ / 逐行 r₀>|r_last|）
- Z 变换模块新增「Jury 稳定判据」折叠面板：填当前分母一键生成表格 + 逐条判定 + 与最大极点模交叉验证
- `tests/jury.test.mjs`：已知案例 + 200 随机样本与 polyRoots 交叉验证（种子确定性）
- 版本 7.3.0 / ?v=7.3 / 侧栏 v4.0

## [7.2.0] — 2026-09-19 · 状态空间整章

### 新增
- **状态空间分析内核**（`assets/js/lib/statespace.js` → `window.SS`，纯函数）：
  Faddeev–LeVerrier 特征多项式、G(s)=C(sI−A)⁻¹B+D 传递函数转换、
  能控性/能观性秩判据、Ackermann 极点配置、对偶系统观测器设计（n ≤ 6）
- **系统分析「状态空间分析」面板**：A/B/C/D 矩阵输入（4 个预设一键填入）、
  特征值表与稳定性、能控/能观 rank、未约分传函 KaTeX、
  状态反馈 K 与闭环极点验证、观测器增益 L；
  矩阵与期望极点纳入实验状态（sys getState/applyState）
- `tests/statespace.test.mjs`（29 项：FL/秩/传函/Ackermann/观测器数值验证）

### 修复
- Ackermann 实现（对偶/对称矩阵下「取列」与「取行」混淆的隐患）由
  期望极点数值验证钉死：双积分器 K=[2,2]、三阶系统闭环特征值逐点对照

### 兼容性
- statespace.js 为新增独立库，无既有行为变更；系统分析面板折叠时零开销

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
