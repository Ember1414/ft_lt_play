# 批次 1 · 共享复平面画布 FX.ComplexPlane + 触屏基线 设计说明

- 日期：2026-09-19
- 范围：`assets/js/lib/plots.js`（新增 `FX.ComplexPlane` + `touch-action` 一行）、`assets/js/modules/zt.js`、`laplace.js`、`pid.js`、`explore.js`（画布迁移 + pid 去重）、`assets/css/style.css`（菜单类名共享）、`index.html`（版本号/帮助文本）；新增 `tests/complexplane.test.mjs`、`tests/module-pz.test.mjs`
- 目标：四处复平面画布（pid / explore / zt / laplace）收敛为一个共享组件，统一等比例坐标与触屏能力，修掉「laplace 触屏不可用」「zt 无捏合」「pid/explore 纯静态」三个硬伤；顺带去掉 pid 与 blocksolve 重复的多项式函数
- 来源：`2026-09-19-upgrade-roadmap.md` 批次 1；四段设计（组件接口 / 交互 / 等比例 / 范围与测试）已逐段确认
- 已确认的决策：
  1. **继承 FX.Plot + 回调式数据接口**——零极点数据仍由各模块持有，组件经 `getSpecs` 读、`onAdd/onMove/onDelete` 写回
  2. **触屏添加 = 点击直加 + 长按菜单并存**（450ms，沿用 blockdiag 约定）
  3. **强制等比例**，laplace s 平面接受等比例化的视觉变化（唯一行为变化点）
  4. 范围按段 C 界定：fs/ft/sys/derive 的深触屏改造不纳入本批
- 非目标：
  1. 不统一四模块的零极点数据模型（zt 完整复数数组 / laplace `{re, im≥0}` 共轭对一份，均保留）
  2. 不给 fs/ft/sys/derive 加长按菜单（它们是曲线图，无可长按对象，全局 CSS 已覆盖命中区基线）
  3. 不改 FX.Plot 的手势框架（`_bind` 的捏合/滚轮/平移原样复用，子类只做覆写与叠加）
  4. 不引入第三方库、不加构建步骤

---

## 1. 现状与缺口（file:line 证据）

| 模块 | 现状 | 硬伤 |
| --- | --- | --- |
| `zt.js:200-359` | 自写完整交互：`pzView/pzZoom` 视图、pointer 点击加/拖动/平移、右键加零点、双击删/复位、wheel 缩放、ResizeObserver、共轭成对、实轴吸附（绝对阈值 0.04） | **无捏合**（wheel only，`zt.js:328`）；无双击删除的触屏保障；无长按菜单 |
| `laplace.js:455-578` | 半复用 FX.Plot（`pan:false/hover:false`），ROC 竖线 + 左右半平面着色；交互全 mouse（`mousedown/mousemove/mouseup/dblclick`） | **触屏完全不可用**（`:550/561/568`）；画布未设 `touch-action`，捏合也半残；mousedown 即添加（拖空白会先加一个点） |
| `pid.js:140-167` | `drawPoles` 纯静态手绘，等比例 R、左右半平面着色 | **无任何交互**（无缩放/平移/悬停） |
| `explore.js:916-937` | `pzPlot` 纯静态手绘（仅 `:297` 一处调用，传函分支） | 同上 |
| 重复函数 | `pid.js:9-10`、`fx.js:136-147`（内部）、`blocksolve.js:18-27`（已导出）三份同语义 `polyMul/polyAdd` | pid 改复用 `BLKSOLVE`（pid 在 `index.html:130` 加载于 `blocksolve.js:123` 之后） |

手势基建现成：`FX.Plot._bind`（`plots.js:106-192`）已有 pointer 框架（`_pointers` Map、双指 `_pinch`、单指 `_drag` 平移、wheel、dblclick 复位）；blockdiag 已验证长按 450ms + `openCtx` 菜单 + `touch-action:none` 约定（`blockdiag.js:27,704-762`）。

---

## 2. 组件 API（`lib/plots.js` 新增）

```js
new FX.ComplexPlane(canvas, {
  mode: 'jw' | 'unit',            // 'jw'=虚轴(σ 横轴，s 域)；'unit'=单位圆(z 域)
  editable: true,                 // pid/explore 为 false
  defaultAdd: 'pole' | 'zero',    // 点击空白添加的类型（模块可切换）
  blankContextAction: 'zero',     // 桌面右键空白 = 加零点（zt/laplace 现状保留）；null=无
  getSpecs: () => ({ poles:[{re,im}], zeros:[{re,im}] }),   // 完整复数（共轭各占一位）
  onMove(kind, index, z),         // z 为世界坐标复数；共轭同步/吸附由模块处理
  onAdd(kind, z),                 // 单击空白（未移动抬起）或右键
  onDelete(kind, index),          // 双击点（桌面）/长按菜单删除
  onBlankTap(z),                  // editable=false 时点击空白也回调（laplace 预设模式切自定义用）
  onUnderlay(ctx, plane),         // 稳定域着色之后、网格之前（laplace 的 ROC 画这层）
  onOverlay(ctx, plane),          // specs 之后（模块标注）
})
// 实例：redraw() / resetView() / pxToWorld(x,y) / worldToPx(re,im) / spanX() / spanY()
//      setEditable(bool) / setDefaultAdd(kind)
```

**继承与覆写关系**（不改父类代码）：

| 成员 | 处理 |
| --- | --- |
| `wheel` / `_pinch` / `_pan` / `_zoomAt` | 直接复用父类；子类覆写 `_zoomAt`、`_pan`，`super` 调用后执行 `_equalize()` |
| `setRange` | 覆写：先按等比修正入参再落（保证初始视野即等比） |
| `dblclick` | 构造时传 `dblclickReset:false`，子类自管：命中点 → `onDelete`，空白 → `resetView()` |
| `hover` | 传 `hover:false`（复平面无十字读数需求） |
| `touch-action` | **父类构造新增一行 `canvas.style.touchAction='none'`**（全站 FX.Plot 画布生效，见 §6） |
| ResizeObserver / DPR / 主题色 | 直接复用父类 |

---

## 3. 视图模型与等比例数学

**不变量**：任意时刻 `worldSpanX / drawableW === worldSpanY / drawableH`（xy 单位长度像素相同）。

- `_equalize()`：以视野中心为准，把跨度「偏大」的轴缩回等比（中心不动）。wheel、双指、平移全部经父类路径改 `xmin..ymax`，随后被强制回等比。
- 缩放跨度极限沿用父类 `clampSpan`（`1e-12 ~ 1e15`）。
- **初始视野**（`userAdjusted=false` 时每次重算，覆盖零极点）：
  - `unit` 模式：`R = max(1.3, max|spec| + 0.35)`（zt 现状 baseR 语义）；中心 (0,0)，纵向半高 = R，横向半宽 = R × (drawableW/drawableH)。
  - `jw` 模式：`R = max(2.5, max(|re|+1.2, |im|+1.2))`（laplace `defaultSPRange` 的覆盖语义）；中心 (0,0) 等比展开。画布横宽时右半平面自然可见更多（ROC 随之可见）。
- **网格**：`jw` 模式沿用父类 `grid()`（带刻度数字，与 laplace 现状一致）；`unit` 模式画无数字网格（zt 现状），单位圆用 `--cv-axis-hi`、旁标 `|z|=1`；`jw` 模式虚轴 `--cv-axis-hi`，轴标注 `σ`/`jω` 或 `Re(z)`/`Im`。
- **着色**：`jw` → x<0 填 `--cv-stable-bg`、x>0 填 `--cv-unstable-bg`（pid/explore/laplace 现状）；`unit` → 圆内填 `--cv-stable-bg`（zt 现状，圆外不着色）。
- **specs 绘制**：极点 ×（`--cv-danger`）、零点 ○（`--cv-line1`），符号半径统一 7px、线宽 2。

---

## 4. 交互模型

### 4.1 手势表（editable=true）

| 手势 | 桌面 | 触屏 |
| --- | --- | --- |
| 拖零极点 | 移动（共轭联动由模块 `onMove` 处理） | 同左 |
| 拖空白 | 平移（父类 `_drag`） | 平移 |
| 单击空白 | 按当前 `defaultAdd` 添加 | **未移动抬起才添加**（>6px 判 moved，zt 已验证的约定） |
| 右键空白 | `blankContextAction`（加零点，zt/laplace 现状） | — |
| 双击点 / 双击空白 | `onDelete` / `resetView` | 双击仅桌面保障（不作触屏依赖） |
| **长按 450ms** | 不触发 | 命中点 → 菜单（删除）；空白 → 菜单（加极点/加零点/复位视图） |
| 滚轮 / 双指 | 缩放（以光标/中点为中心） | 捏合缩放 |

editable=false（pid/explore）：仅平移/缩放/双击复位 + `onBlankTap`；无添加/拖点/删除/长按。

### 4.2 状态机要点

- 组件事件 handler 注册于父类 `_bind` 之后（构造顺序保证）。命中点时把父类 `this._drag` 置 null 以屏蔽平移，自己的 `_specDrag` 接管；捏合（`_pinch`）始终走父类，第二指按下即取消长按与拖点。
- **同一手势全程复用同一 pointerId**（`pointers` 计数约定，见 blk-interaction 的教训）；`pointercancel` 清全部临时态。
- 长按：`pointerType==='touch'` 才启动；move 超阈值 / 第二指 / 抬起均取消；到点弹 `.cp-menu`（挂 `document.body` 防裁切，逻辑同 `blockdiag.js:744-762 openCtx`）。
- `hitTest` 像素容差：触屏 22px（≈44px 直径命中区）、鼠标 12px；极点优先于零点（zt 现状）。
- 实轴吸附：统一为「|im| < 3% 垂直视野 → im=0」建议值（由组件在 `onAdd/onMove` 的 z 上预吸附；laplace 的 `snapIm` 语义一致，zt 的绝对阈值 0.04 微调为自适应，记录为可接受的小行为变化）。

### 4.3 菜单

`.cp-menu` / `.cp-menu-item` 与 `.blk-ctx` / `.blk-ctx-item` 共享同一 CSS 块（style.css 选择器合并），`≤900px` 断点同步加大触控区。菜单项：点 → `删除（连同共轭）`；空白 → `添加极点`、`添加零点`、`复位视图`。模块后续可用 `menuItems` 钩子扩展（本批不开放）。

---

## 5. 四模块迁移映射

| 模块 | 删除 | 保留/接入 | 行为变化 |
| --- | --- | --- | --- |
| `zt.js` | `drawPZ`/`hitTest`/`toZ`/`moveSpec`/`pzCv` 七个事件监听/`pzZoom`/`pzView`/`pzRO`（`:198-359`，约 160 行）→ 约 40 行接入 | `pzPoles/pzZeros`、`applySpecs`、模式 chips（切 `setDefaultAdd`）、清空按钮（改调 `plane.resetView()`）；`onMove` 复用共轭同步、`onAdd` 复用共轭成对、`onDelete` 复用连共轭删除 | 新增捏合/长按菜单；吸附改 3% 视野；画布加 `class="plot"`（获得 `redrawFold` 兜底）；legend 文案补「长按」 |
| `laplace.js` | mouse 四监听与 `drawSP` 的手绘段（`:455-578`）→ ROC 进 `onUnderlay`（`--cv-roc-bg` 竖线 + 文案原样） | `{re, im≥0}` spec 模型、`specsToRoots` 展开、`snapIm`、预设/自定义切换、分享 hash | **等比例化**（§3）；默认视野从非对称改为覆盖零极点的等比窗口；点击从「按下即加」改为「未移动抬起才加」+ 可平移；预设模式经 `onBlankTap` 切自定义；`setEditable` 随模式切换 |
| `pid.js` | `drawPoles`（`:140-167`）+ 本地 `polyMul/polyAdd`（`:9-10`） | `solve()` 末尾 `plane.redraw()`；`T(s)` 数值不变（`BLKSOLVE.polyMul/polyAdd` 与原实现逐行同语义） | 极点图获得缩放/平移（原纯静态） |
| `explore.js` | `pzPlot`（`:916-937`） | `:297` 调用点改为惰性创建组件实例（存 `cache`）+ `redraw()`；`editable:false, mode:'jw'` | 极点图获得缩放/平移 |

---

## 6. 触屏基线（本批范围）

1. ComplexPlane 自带全部触屏能力 → 四画布立即生效（§4）。
2. **FX.Plot 构造统一 `canvas.style.touchAction='none'`**：修掉 laplace 捏合半残；对所有 FX.Plot 画布，移动端「单指在画布上 = 平移」与帮助文本既有描述一致（页面滚动改用画布外区域，blockdiag 已是此约定）。桌面无影响。
3. CSS：`.blk-ctx`→`.blk-ctx, .cp-menu` 选择器合并；`≤900px` 断点同步。
4. fs/ft/sys/derive 不动（曲线图无可长按对象；命中区/16px 输入/捏合已由全局 CSS 与 FX.Plot 覆盖）。

---

## 7. 兼容与收口

- 分享链接（zt 无画布状态、laplace `#lan/lad`）不变；`window.TR`/内核零改动。
- 视觉变化仅 laplace 一处（等比例 + 默认视野），已确认接受。
- `index.html`：资源版本 `?v=6.1 → ?v=6.2`（全部脚本行）；帮助文本「拉普拉斯变换」「Z 变换」条目补触屏操作说明；侧栏版本 `v3.4 → v3.5`。
- `dispose()`：组件实例随模块 DOM 一起废弃；模块现有 RO 清理逻辑由组件 RO 的 `isConnected` 自检替代（zt 的 `pzRO.disconnect` 删除）。

---

## 8. 测试（先测后码）

### 8.1 新增 `tests/complexplane.test.mjs`（组件，vm 加载 util/mathdsp/plots + 极简 DOM 桩）

沿用 blk-interaction 桩约定（El 桩、`fire()` 合成事件、**同一手势同一 pointerId**、fake 2d ctx 记录 `fillStyle`/`arc` 序列、fake timers 驱动 450ms 长按）：

1. 等比例：unit/jw 两模式初始视野 span 比例 = drawableW/drawableH；wheel 缩放后、双指捏合后、拖空白平移后均守恒；以光标为中心（缩放前后光标下世界点不变）。
2. `hitTest`：极点优先；触屏 22px / 鼠标 12px 容差边界。
3. 手势状态机：单击空白未移动 → `onAdd('pole', z)`；按下后移动 >6px 抬起 → 平移且无 `onAdd`；拖点 → `onMove` 世界坐标正确；全程同 pointerId，`pointercancel` 清态。
4. 长按：触屏长按点 → `.cp-menu` 含「删除」；空白 → 含「加极点/加零点/复位视图」；拖动取消长按；鼠标长按不触发；`defaultAdd` 切换后菜单/点击行为跟随。
5. 双击（mouse）：点 → `onDelete`；空白 → `resetView` 回初始窗口。
6. 右键：`preventDefault` 被调 + `blankContextAction='zero'` 时 `onAdd('zero')`。
7. `editable=false`：点击/长按/拖点均无编辑回调，平移缩放正常，`onBlankTap` 触发。
8. 着色：unit 模式 fill 序列含 `--cv-stable-bg`（圆内）、jw 模式含左半 `--cv-stable-bg` 与右半 `--cv-unstable-bg`。
9. `touch-action`：构造后 `canvas.style.touchAction === 'none'`。

### 8.2 新增 `tests/module-pz.test.mjs`（四模块迁移回归，DOM 桩实例化）

- **zt**：初始渲染 stats；画布空白单击 → 极点 +1 且 `#zt-num/#zt-den` 同步（共轭成对进多项式）；双击点删除 → 多项式回落；长按菜单删除；拖共轭成员另一成员跟随（多项式系数保持实数）；清空按钮复位视图。
- **laplace**：预设模式点画布 → 切自定义；自定义单击加极点（近实轴吸附 im=0）；ROC `onUnderlay` 被调（fill 序列含 `--cv-roc-bg`）；`#lan/#lad` 分享往返不变；预设 ⇄ 自定义 `setEditable` 生效。
- **pid**：数值回归——固定 plant + Kp/Ki/Kd，断言 `T(s)` 系数、闭环极点与迁移前一致（基线值在测试里硬编码）；源码静态断言不再含本地 `polyMul`；`solve()` 后组件 `redraw` 被调。
- **explore**：传函求解后极点图画布实例化（惰性、只建一次）；`editable=false` 无编辑回调。
- 全部既有测试保持全绿：`blk-z(37)/blocksolve(22)/lib(27)/blk-dom-contract(4)/blk-interaction(55)`。

### 8.3 验证方式

`node --check` 全部改动文件 → 新旧测试全绿 → 静态审查（代码层，不跑浏览器）→ 真机视觉项单列 §9。

---

## 9. 人工真机验收清单（代码桩覆盖不到）

- 手机端 laplace s 平面：捏合缩放顺滑、单指平移、拖零极点不误触平移、长按删除有菜单。
- zt：捏合缩放（原缺失项）；点击添加无「想平移却加了个点」的误触感。
- 长按菜单不超出屏幕、点外关闭、双指操作不误弹菜单。
- `≤900px` 四画布高度与布局；双主题下稳定域着色/单位圆对比度。
- 桌面回归：zt/laplace 原有滚轮/右键/双击习惯不回退。

---

## 10. 落地顺序

1. `tests/complexplane.test.mjs`（先写，跑红）。
2. `plots.js`：`ComplexPlane`（约 +260 行）+ 父类 `touch-action` 一行 → 组件测试全绿。
3. `tests/module-pz.test.mjs`（先写，跑红）。
4. `zt.js` → `laplace.js` → `pid.js`（含去重）→ `explore.js` 迁移；`style.css` 菜单类名合并 → 模块测试全绿。
5. 全量回归（`node --check` + 7 个测试脚本）。
6. `index.html` 版本号/帮助文本/侧栏版本。
7. 静态审查 + §9 清单交付人工验收。

---

## 11. 实现期修正记录（相对本文上述条目的偏差）

1. **zt 拖动共轭「真正跟随」（缺陷修正）**：旧 `moveSpec` 的共轭伙伴查找发生在 `arr[i]` 重赋值**之后**、按新位置反推旧伙伴且容差 1e-6（`zt.js` 旧 :264-274）——真实拖动步长 ~0.01 世界单位下必然查不到，共轭并不跟随，只是 `DSP.polyFromRoots`（`mathdsp.js:80`）按「共轭根配对」假设丢弃虚部系数兜底，多项式与所画极点悄悄失配。新 `onMove` 在重赋值**前**按旧位置锁定伙伴索引再同步移动；共轭成员拖近实轴时双成员并入同点成二重实极点（保阶次）。测试断言：拖后分母恰为 `z²+0.6z+0.73` / `(z+0.2)²` 形态。
2. **Android 长按 `contextmenu` 守卫**：Android 触屏长按除组件自身的 450ms 定时器外，还会派生浏览器 `contextmenu` 事件——两者叠加会在弹菜单的同时误加一个零点（blockdiag 无此问题因其 contextmenu 只重开同一菜单，幂等；本组件的右键是数据变更）。守卫：长按定时器挂起期间或菜单弹出后 750ms 内（`_lpGuardAt`），contextmenu 只 `preventDefault` 不执行；桌面右键不受影响。测试断言：长按菜单弹出后到达的 contextmenu 不改变数据、菜单保留。
3. **测试计数落定**：`complexplane.test.mjs` 54 项断言（设计 §8.1 的 9 组 + contextmenu 守卫）、`module-pz.test.mjs` 48 项断言（四模块迁移回归）；既有 5 个测试脚本 145 项保持全绿，合计 247 项。
