# 信号与控制实验平台 · 傅立叶 / 拉普拉斯 / Z / 系统分析

面向学生、教师和工程师的信号与控制实验平台：以「实验」为单位组织学习与分析——输入信号/传函/方程 → 仿真可视化 → 保存快照 → 分享导出。纯前端、无服务端、无数据上传，全部计算与存储都在浏览器本地完成（local-first）。

**在线使用：[ft-lt-play.pages.dev](https://ft-lt-play.pages.dev/)**

## 实验工作台（平台入口）

- **快速开始**：6 个示例模板一键创建实验（二阶系统 / 不稳定系统 / 超前校正 / 离散低通 / 数字谐振器 / 双极点滤波器）
- **实验管理**：最近使用、收藏、搜索、重命名、复制、删除；JSON 导入导出；版本化分享码（`PX1.…`，带数据校验和，改坏即拒绝）
- **自动保存**：切换模块/刷新页面自动捕获模块状态；💾 保存额外打可恢复快照（最多 10 个）
- **统一结果工具栏**（系统分析 / Z 变换）：保存实验 · 复制 · 重置 · 分享 · 导出 PNG / CSV / JSON
- 模块接入实验只需实现 `api.getState() / api.applyState(s)`（见 `docs/platform.md`）

## 功能

### 傅立叶级数
- **画圈套画圈**：选择形状（方形 / 三角 / 爱心 / 五角星 / 蝴蝶 / 齿轮 / 螺旋 / **✏️ 手绘自定义**），观看 DFT 相量逐圈叠加绘制出目标路径；手绘任意闭合曲线，松手即自动分解生成动画；主画布支持缩放 / 平移
- **谐波幅度谱 / 谐波叠加**：默认折叠，点开即可看当前形状的 DFT 分解，以及方波由奇次正弦逐步合成（Gibbs 过冲）

### 傅立叶变换
- **时域 ↔ 频域联动**：8 种常见信号（矩形 / 高斯 / 指数 / sinc / 余弦 / 冲激 / 三角 …）一键切换，时域波形、幅度谱、相位谱联动，悬停读数
- **卷积定理**：翻转-平移-重叠面积动画，直观展示 (f∗g)(t) 的累积过程；频域 |F·G| 与 |FFT{f∗g}| 重合验证（误差 ~1e-15）

### 拉普拉斯变换
- **s 平面**：极点 / 零点可视化 + ROC 收敛域 + 稳定性区域，滚轮缩放后点击更精准
- **分数线输入 H(s)**：分子 / 分母分行填写，支持因式 `(s+1)*(s+2)`；结构模板（一阶 / 二阶欠阻尼 / 带通 / 因式）一键套入。也可输入极点 / 零点列表（`-0.25+1.09j, -2`），或在图上点选（左键极点 / 右键零点 / 拖动移动 / 双击删除，共轭对自动生成）
- **反变换解析**：留数法自动求部分分式展开，解析解（点）与数值仿真（线）叠加对照
- **时域联动**：脉冲 / 阶跃响应随极点位置实时变化（默认折叠，点标题展开）

### 系统分析
- **分数线 + 结构模板**输入 H(s)（一阶 / 二阶 / 超前 / 滞后 / 积分 / PID），支持因式
- 三种图切换查看：**波特图**（幅度 / 相位展开、含相位裕度）、**奈奎斯特图**（G(jω) 轨迹 + (-1,0) 临界点 + 单位圆 + 判稳提示）、**根轨迹**（K 对数扫描、匈牙利式分支匹配、渐近线、视野按极零点收紧）
- 阶跃 / 脉冲响应默认折叠；DC 增益、带宽、ωn/ζ 等指标

### 公式推导
- 傅立叶 / 拉普拉斯性质表、常用变换对对照表
- 逐步推导：方波级数系数、L{e^(-at)u(t)} 定义积分、矩形 ↔ sinc、卷积求响应
- **自定义推导**：输入因果信号组合（如 `3*exp(-2*t)*u(t)+sin(5*t)*u(t)`），自动生成拉普拉斯 / 傅里叶推导步骤，并用数值积分验证（误差 ~1e-11）

### 交互求解
- **表达式求解**：自动识别时域信号或传递函数，示例一键填入；支持 `u(t)`、`sinc`、`rect`、`tri` 等信号函数；时间范围可调
- **手绘画圈**：画任意闭合曲线（弧长均匀重采样），观看傅立叶圈套圈动画复现
- **语音输入**：念出表达式自动映射（Chrome / Edge，Web Speech API）

## 通用操作

| 操作 | 桌面 | 手机 |
|---|---|---|
| 内容缩放 | 滚轮 | 双指捏合 |
| 平移 | 拖拽 | 单指拖动 |
| 复位 | 双击 | 双击 |
| 图框高度 | 拖图框底边 | 拖底边把手 |
| 图框宽度 | 拖右边 / 右下角 | 拖右边把手 |
| 栏宽 | 拖两栏之间的分隔条 | — |
| 精度读数 | 悬停十字线 | — |

部分次要图默认折叠，点标题展开。右上角 ☀️ / 🌙 切换深 / 浅主题（自动记忆）。

## 技术栈

- 纯 vanilla JavaScript + Canvas 2D，无框架、无构建步骤
- [KaTeX](https://katex.org/)（CDN，备用源自动回退）公式渲染、[mathjs](https://mathjs.org/)（CDN）表达式求值（AST 白名单 + 长度限制，拒绝动态执行）
- 自实现：FFT（Cooley–Tukey）、Durand–Kerner 多项式求根（根轨迹含暖启动）、留数法部分分式、RK4 状态空间仿真、白名单算术求值器（`U.safeCalc`）
- 实验数据：版本化 schema + localStorage（`fltp:v1:*`），拒绝式校验与 FNV-1a 分享校验（`lib/project.js`）

## 开发

```bash
npm test          # 全部测试（13 个脚本，无浏览器 Node 断言）
npm run check     # 语法门（node --check）
npm run lint      # 静态安全审计 + 引用/版本一致性
npm run format    # 保守格式化
npm run build     # 部署产物校验（引用存在 / _headers / CSP）
npm run preview   # 本地静态服务器 http://localhost:8080
npm run verify    # check + lint + test + build（CI 同款）
```

架构、实验 schema v1 契约与安全基线详见 **[docs/platform.md](docs/platform.md)**；变更记录见 [CHANGELOG.md](CHANGELOG.md)。

## 本地运行

任意静态服务器即可，例如：

```bash
npx http-server -p 8321
# 打开 http://localhost:8321
```

## 部署

Cloudflare Pages（静态直传，`_headers` 提供 CSP 等安全响应头）：

```bash
npx wrangler pages deploy . --project-name=ft-lt-play --branch=main
```

## 目录结构

```
index.html                    入口（无内联脚本）
assets/css/style.css          样式（深/浅主题变量）
assets/js/app.js              应用骨架 / 导航 / 模型库 / 实验控制器
assets/js/lib/util.js         通用工具 + safeCalc 白名单求值器
assets/js/lib/project.js      ★ 实验数据模型 / 版本化存储 / 分享 v2
assets/js/lib/toolbar.js      ★ 统一结果工具栏
assets/js/lib/plots.js        Canvas 图表基类（缩放/平移/悬停读数/主题色）
assets/js/lib/mathdsp.js      数值计算（FFT/求根/频响/仿真）
assets/js/lib/fx.js           信号库 / 形状 / 解析器
assets/js/lib/mathinput.js    统一数学输入组件
assets/js/lib/transforms.js   符号变换引擎（拉普拉斯/傅立叶/Z）
assets/js/lib/odesolve.js     微分/差分方程求解内核
assets/js/lib/blocksolve.js   框图求解 / 采样 / s↔z
assets/js/modules/*.js        工作台 + 九大功能模块
scripts/                      test/check/lint/format/build/serve（零依赖）
tests/*.test.mjs              13 个测试脚本（Node，无浏览器）
_headers                      Cloudflare Pages 安全响应头（CSP 等）
```

## License

MIT
