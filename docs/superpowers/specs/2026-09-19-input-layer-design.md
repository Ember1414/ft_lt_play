# 输入层升级 · 统一输入子系统 + 方程求解 + 符号参数 + 模型库 设计说明

- 日期：2026-09-19
- 范围：新增 `assets/js/lib/mathinput.js`（window.MI）、`assets/js/lib/odesolve.js`（纯函数内核）；`fx.js`/`transforms.js` 入口归一化；`plots.js` ComplexPlane 撤销；`zt.js`/`laplace.js`/`system.js`/`explore.js`/`derive.js`/`blockdiag.js` 输入迁移；`app.js` 模型库；`style.css`、`index.html`；新增 4 个测试文件、增补 3 个
- 目标：输入层作为子系统重构——① 五处重复输入实现收敛为共享组件并全站统一纠错基线；② 补齐教材缺失的输入形式（微分方程/差分方程/数据序列）；③ 符号参数与家族曲线（先 sys）；④ 模型库与跨模块交接
- 依据：输入模态×模块矩阵审计 + 「输入质量基线 8 条」（见会话评审记录）；四组分叉已确认：
  1. 方程求解 UI 落 **explore 新页签**（la/zt 不动）
  2. 符号参数**仅 sys 先行**
  3. MathInput 对现有五处输入**全量替换**
  4. 模型库入口为**模块内工具行**（不新增导航页）
- 非目标：iOS 专项（用户指示搁置）；pid 任意 G(s)（批次 4）；状态空间矩阵（批次 2a）；分段/周期信号（批次 6）；LaTeX 导入解析；zt/la/explore 的参数化铺开（本轮后评估）

---

## 1. 统一输入子系统（`lib/mathinput.js` → `window.MI`）

### 1.1 API

```js
// 分数线传函输入（zt/la/sys 用）
const tf = MI.tfInput(hostEl, {
  variable: 's' | 'z',
  properness: true,               // 非真分式 → ⚠ 徽标（onApply 不触发）
  pad: ['s', '^2', '^3', '*', '(', ')', '+', '-'],
  examples: [[num, den, 标签], ...],
  historyKey: 'flt-tf-sys',       // 可选；localStorage 最近 8 条
  debounce: 350,                  // 输入防抖 ms
  onApply({num, den, tf}, source) // source: 'input'|'enter'|'button'|'example'|'history'
});
// tf.set(numStr, denStr) / tf.get() / tf.apply() / tf.destroy()

// 单行表达式输入（explore/derive 用）
const ex = MI.exprInput(hostEl, {
  parse(str) → { verdict:'ok'|'warn'|'err', message, tex?, summary? },
  pad: [...], examples: [[expr, 标签], ...], historyKey, debounce, onApply(str, source)
});
// ex.set(str) / ex.get() / ex.destroy()

// 键盘行复用（blk 检查器/就地编辑用）
MI.padRow(hostEl, tokens, { getTarget() → input })   // 光标处插入 + input 事件
```

- 渲染结构复用现有类名（`.tf-frac`/`.row.kbd`/`.hint`/`.chip`），CSS 不新增大块；徽标与 LaTeX 预览行为以 laplace 现状为基准（最完整的一份）。
- 历史格式沿用 explore 的 chips 形态；`historyKey` 各模块独立（explore 保持 `flt-expr-history` 兼容旧数据）。

### 1.2 归一化与纠错（两层）

| 层 | 位置 | 内容 |
| --- | --- | --- |
| 归一化 | `FX_LIB.parsePoly/parseTF/parseTimeCombo/parseZCombo` 入口统一过 `normChars()` | 全角→半角：`＋－＊／（）：，．ｓｚｔｎ` 与全角数字；`**`→`^`；制表符清理。**全站解析器一次性受益（含 blk）** |
| 纠错词典 | MathInput 校验管线（解析失败时） | `i` 出现在 s/z 表达式 → 「虚数单位请用 j」；末尾悬空 `+ - * /` → 「末尾多了运算符」；空 `()` 与括号不配对 → 定位提示；空输入 → 静默 |

- 归一化必须保持幂等且对合法输入零影响（现有 145+ 项测试回归兜底）。

### 1.3 五处迁移映射

| 模块 | 换成 | 保留在模块侧 |
| --- | --- | --- |
| `zt.js` | `MI.tfInput('z', properness:true)`（**补上非真分式 ⚠，抹平与 la 的差异**） | 模式 chips、清空、`fromInputs` 数据流 |
| `laplace.js` | `MI.tfInput('s', properness:true)` | `lastSrc` 优先级逻辑（onApply source 参与判定）、零极点文本输入（不动，享受归一化） |
| `system.js` | `MI.tfInput('s', properness:true)` | 预设/结构模板按钮、劳斯/特征方程输入框（仅享受归一化，暂不迁 MI——单行+按钮形态，收益低） |
| `explore.js` | `MI.exprInput`（parse = TF/时域双识别，徽标文案沿用现状） | 历史/示例数据格式不变 |
| `derive.js` | `MI.exprInput`（parse = parseCombo，summary = 「✓ 已识别 N 项：…」） | 示例 chips 数据 |
| `blockdiag.js` | `MI.padRow` 挂检查器 `.blk-inp` 与就地编辑 `.blk-edit`（补齐符号键盘缺口） | 编辑器全部逻辑 |

回归红线：迁移后各模块既有行为不回退——`module-pz.test.mjs` 全部断言、zt 防抖自动应用、la 的 lastSrc 分支、explore 的历史/识别徽标、derive 的实时校验。

### 1.4 ComplexPlane 撤销

- 组件内 `_undoStack`（≤30，超出丢最旧）：`onAdd`/`onDelete` 回调前置成功后压栈；拖动在 `pointerup` 且发生移动时压栈（拖动中不压）。
- 新增 opts `onRestore({poles, zeros})`：模块恢复自身数据模型——zt 克隆赋值后 `applySpecs()`；la 经 `rootsToSpecs` 塌缩为共轭对形态后 `buildFromPZ()+syncInputs()`。
- 入口：长按菜单第二项「撤销」（栈空不显示）；Ctrl/Cmd+Z——组件构造时挂 document 键盘监听（守卫：activeElement 为 input/textarea/contentEditable 时忽略；`this.cv.isConnected` 为 false 时忽略），`dispose()` 时移除。
- 快照 = `getSpecs()` 深拷贝，与数据模型解耦。

---

## 2. 方程求解双件套（`lib/odesolve.js`，纯函数）

### 2.1 微分方程（s 域）

```
parseODE(str) → { ok, order n, a:[a0..an]（y^k 系数，缺项为 0）, rhsItems, note? }
  · LHS 语法：y''/y'/y（含 y'''、y''''）、y0..y4、y[[k]]；系数支持小数与省略 1*
  · 「=」分隔 LHS/RHS；RHS 走 TR.parseTimeCombo（u(t) 可省略）
  · order ≤ 4；A(s) 首系数 a_n ≠ 0
solveODE(a, rhsItems, ics) →
  { A:[..], F:{n,d}, P:{n,d},
    full:{tex, evalT(t), poles}, zeroInput:{...}, zeroState:{...},
    stableText }
  · P(s) = Σ_{k=1..n} a_k·Σ_{m=0}^{k-1} s^{k-1-m}·y^{(m)}(0)   （IC 多项式）
  · 全解 Y(s) = (F(s)+P(s))/A(s)；零输入 = P/A；零状态 = F/A
  · 每组：TR.partialFracGroups → tex（KaTeX）+ evalT（逐点）+ 极点
  · 数值通道：零输入/零状态均为有理 TF → DSP.ltiResponse 精确仿真，
    与解析 evalT 逐点对照（相对误差 < 1e-6，测试断言）
```

约束：RHS 限 `TR.parseTimeCombo` 支持的常规函数（无 δ(t) 输入项）；`a_n=0` → `ok:false` 带提示；ics 长度 < n 时高位补 0 并给 note。

### 2.2 差分方程（z 域）

```
parseDiffEq(str) → { ok, order n, a:[a0..an], rhsItems, note? }
  · LHS：y[n+2]、y[n]、y(n+1) 等写法；RHS 走 TR.parseZCombo
solveDiffEq(a, rhsItems, ics) → { D(z), Q(z)（IC 多项式）, full/zeroInput/zeroState:{tex, evalN(n)},
  recur(ics, x)（递推器，供数值对照）, stableText }
  · 初值移位：Z{y[n+k]} = z^k Y − Σ_{m=0}^{k-1} z^{k-1-m}·y[m]
  · 全解 Y(z) = (X(z)+Q(z))/D(z)；解析 evalN 走 TR.invZ；数值 = 递推器；
    对照断言同上
```

### 2.3 UI：explore 新页签「方程求解」（`#ex-eq`）

- 模式 chips：**微分方程 / 差分方程 / 数据序列**。
- 方程模式：方程输入行（MI 风格徽标）+ 按阶次生成的初值数字行（`y(0)`、`y'(0)`…，默认 0）+ 求解按钮 + 输入即算（防抖）。输出：全解 LaTeX（零输入项 + 零状态项分色/分栏标注）、三线响应图（全解/零输入/零状态，解析点叠加数值线，沿 la 的解析/数值对照模式）、数值验证表（选点 |解析−数值| 相对误差）、稳定性与极点列表。示例 chips（齐次/受迫/带初值/无初值各一）。
- 数据模式：textarea 粘贴一列数（逗号/空格/换行/分号分隔）→ stem 图 + `DSP.fft` 幅度谱 + 统计栏（点数/均值/能量）。错误数据（非数值 token）→ 定位提示。
- 移动端：初值行换行堆叠、16px 输入（全局白名单已覆盖 `.ctrl`/`.tf-frac`，新元素沿用相同类名）；响应图画布走 `clamp` 高度。

---

## 3. 符号参数与家族曲线（仅 sys）

### 3.1 参数提取与求值

```
FX_LIB.extractParams(str, exclude?) → ['z','p',...]（保序去重）
  · 排除：s/z/t/n/e/j/pi、函数名（标识符后跟「(」）、纯数字上下文
  · sys 默认 exclude = ['s']；变量按输入框语境
```

- mathjs 已加载，参数代入用 `math.parse(str).evaluate(scope)`；解析失败的代数值 → 该成员跳过并提示。

### 3.2 sys 集成

- `solve()` 时对 num/den 字符串提取参数 → 有参数则渲染**参数行**：每参数一个数值输入 + 可选扫掠框（`0.5,1,2`，≤5 个成员）；参数变更防抖重解。
- 家族曲线：成员 = 参数组合（多参数时取逐一扫掠而非笛卡尔积，上限 5）；Bode/奈奎斯特/根轨迹/阶跃/脉冲**叠加绘制**，颜色 `hsla` 色阶渐变（fs 3D 已有先例），图例标注参数值；指标按成员列出（`.tbl` 表格：成员 / Kp?…/ 稳定性 / PM / GM / ζ）。
- 单值参数（无扫掠）时行为 = 现状单曲线；无参数时零开销。
- 结构模板参数化：`structs` 插入符号串（如 `s^2+2*z*wn*s+wn*wn` 分母、`wn*wn` 分子）+ `defaults:{z:0.25, wn:1}` 种子值，参数行自动出现滑杆语义——替代现在的硬编码代入。

---

## 4. 模型库与工作流（app.js + 四模块）

### 4.1 存储（`app.js` 内 `App.models`）

```js
App.models = {
  list(): [{id, name, kind, data, ts}],        // localStorage 'flt-models'，上限 20（超出丢最旧+提示）
  save({name, kind, data}): entry,             // kind: 'tf' {num,den,variable} | 'pz' {poles,zeros,variable} | 'blk' {slim}
  remove(id), rename(id, name)
};
App.models.renderChips(hostEl, { kinds, emptyText, onLoad(entry) })
  // 「我的模型」chips 行：点击 → onLoad（由当前模块注册，直接应用数据，绕开 App.open 同模块早退）
  // chip 尾部 ✕ 删除（触屏命中区 ≥ 24px）
```

- 各模块工具行加 **💾 保存**：弹出内联命名小浮层（非 `window.prompt`），默认名「系统 N」，保存后 flash。
- chips 行按模块过滤 kind：sys/la/zt 显示 `tf`+`pz`；blk 显示 `blk`。加载即写回模块输入（tf → 填 num/den 并触发应用；pz → 恢复 specs；blk → 按 slim 重建）。

### 4.2 跨模块交接（v1 矩阵）

| 按钮 | 位置 | 行为 |
| --- | --- | --- |
| ↗ 框图 | sys 工具行 | 当前 H(s) 编码为单块框图 slim（R→G→Y，`#blk=blk1.<b64>`）→ `App.open('blk')` |
| ↗ 系统分析 | blk 结果区 | 合成 T(s) 写 `#hn/#hd` → `App.open('sys')` |
| ↗ 交互求解 | sys / laplace 工具行 | 表达式串写 `#ex=` → `App.open('explore')`（zt 暂无对接出口，不加按钮） |

- 顺序约定：**先写 hash 再 `App.open`**（模块工厂初始化时读 hash）；同模块早退由 `App.open` 既有语义保证无害。

---

## 5. 测试（先测后码）

| 文件 | 覆盖 |
| --- | --- |
| `tests/mathinput.test.mjs`（新） | 归一化幂等/全角表、tfInput 校验三态（ok/warn 非真分式/err 定位词典）、pad 插入光标语义、历史回填、exprInput 徽标、destroy 清理 |
| `tests/odesolve.test.mjs`（新） | parseODE 各写法/阶次上限/a_n=0；solveODE 零输入与零状态分别对照 `DSP.ltiResponse`（有理 TF 数值双通道，相对误差 < 1e-6）；tex 存在性；parseDiffEq 写法；solveDiffEq 解析 evalN vs 递推器逐点对照；数据序列解析与坏 token 提示 |
| `tests/models.test.mjs`（新） | save/list/remove/rename、上限 20 逐出、renderChips onLoad 回调（localStorage 桩）；sys→blk 的 slim 编码解码往返 |
| `complexplane.test.mjs`（增补） | 撤销栈：增/删/拖动压栈、undo 回调收到深拷贝、菜单「撤销」项、Ctrl+Z 输入框守卫、dispose 移除监听 |
| `module-pz.test.mjs`（增补） | zt/la 的 onRestore 数据往返（la 经塌缩仍为共轭对形态）；迁移到 MI 后原行为断言不回退 |
| `blk-interaction.test.mjs`（增补） | 检查器符号键盘出现并可插入；↗ 系统分析按钮写 `#hn/#hd` |
| 既有全部（145 项） | 保持全绿 |

验证一律代码层：`node --check` + 全部测试脚本；静态审查不跑浏览器；真机项单列。

---

## 6. 收口

- `index.html`：`?v=6.2 → 6.3`；加载序在 `fx.js` 之后插入 `mathinput.js`、`transforms.js` 之后插入 `odesolve.js`（均在 app.js 与模块之前）；帮助文本补「方程求解」页签与模型库说明；侧栏 `v3.5 → v3.6`。
- `style.css`：参数行/扫掠框/模型 chips/命名浮层小量新增；`≤900px` 断点适配（初值行堆叠、图例折叠）。

## 7. 落地顺序

1. `tests/mathinput.test.mjs`（先写，跑红）→ `fx.js`/`transforms.js` 归一化 + `lib/mathinput.js` → 绿。
2. `complexplane.test.mjs` 增补（红）→ ComplexPlane 撤销 → 绿。
3. 五处输入迁移 + blk pad（`module-pz`/`blk-interaction` 增补先写）→ 全绿。
4. `tests/odesolve.test.mjs`（红）→ `lib/odesolve.js` → 绿。
5. explore「方程求解」页签（三模式）→ 增补断言 → 绿。
6. `FX_LIB.extractParams` + sys 参数/家族/模板参数化 → 增补断言 → 绿。
7. `App.models` + 四模块 💾/chips + 交接按钮（`tests/models.test.mjs` 先写）→ 绿。
8. 全量回归（`node --check` + 全部测试）→ `index.html`/帮助/侧栏版本 → 静态审查 → 真机人工验收清单。

---

## 8. 实现期修正记录（相对本文上述条目的偏差）

1. **参数求值不依赖 mathjs**：`FX_LIB.substituteParams(str, scope)` 采用「标识符 → 数值字面量」的字符串替换 + 既有 `parseTF` 解析（scope 附带 pi/e），CDN 断网（无 mathjs）时符号参数与家族曲线依然可用，且可被 Node 单测覆盖（lib.test.mjs 增补 7 项）。
2. **根轨迹不画家族**（设计 §3.2 的渐进）：Bode 幅相 / 奈奎斯特 / 阶跃均叠加家族细线（`famColor` 色阶 + 家族指标表），根轨迹保持主成员——每成员重算全 K 扫描的渲染成本与读图可读性不划算，留待后续评估。
3. **odesolve 的 tex 前缀**：`TR.invZ` 固定输出 `h(n)=`，组件以字符串替换换为 `y_{zi}(n)=` 等前缀（求值器不变）；初值多项式 z 域幂次为 `z^{k−m}`（s 域为 `s^{k−1−m}`），已由「解析 evalN vs 递推逐点对照 <1e-9」双通道钉死。
4. **`TR.parseTimeCombo` 支持裸 `t`**（tpow n=1）：方程右端 `y''=t` 的自然写法；这是共享解析器的纯增强，explore/derive 的斜坡输入同步受益。
5. **zt 的保存入口**未用 `MI.library` 全条（模板空间有限），改为 `💾 保存` 按钮 + `App.models.renderChips` 行，行为与 library 一致。
6. **测试计数落定**：mathinput 40 / odesolve 48 / models 15 / lib 34（+7）/ module-pz 62（+8）/ blk-interaction 57（+2）/ complexplane 66（+13，撤销）；既有 blk-z 37、blocksolve 22、blk-dom-contract 4 保持全绿，**合计 385 项断言、10 个测试脚本**。
