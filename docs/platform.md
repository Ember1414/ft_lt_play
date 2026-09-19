# 平台架构与数据契约

- 版本：v7.0（对应 `index.html` 资源 `?v=7.0`、侧栏 v3.7）
- 状态：Phase 0（工程与安全基线）✅ 已完成；Phase 1（平台骨架 + 第一个端到端实验闭环）✅ 已完成（试点模块：系统分析 sys、Z 变换 zt）
- 上游设计：`docs/superpowers/specs/2026-09-19-upgrade-roadmap.md`（模块深度批次）、`2026-09-19-input-layer-design.md`（输入层，已实现）

---

## 1. 分层

```
index.html                      入口（无内联脚本，CSP 见 _headers）
assets/js/lib/
  util.js        U.   DOM/数学工具 + safeCalc 白名单算术求值器（替代 eval/Function）
  mathdsp.js     DSP. FFT/求根/频响/仿真
  plots.js       FX.Plot / FX.ComplexPlane（缩放/平移/触控/撤销）
  fx.js          FX_LIB 信号库/形状/解析器（parseTF/parsePoly/parseTimeExpr）
  mathinput.js   MI.  统一输入组件（tfInput/exprInput/历史/校验徽标）
  blocksolve.js  BLKSOLVE 框图求解 / 采样 / s↔z 映射
  transforms.js  TR.  符号变换（拉普拉斯/傅立叶/Z + 反变换）
  odesolve.js    OS.  微分/差分方程求解内核
  statespace.js  SS.  状态空间内核（特征多项式/能控能观/Ackermann/观测器）
  project.js     PX.  ★ 实验数据模型 + 版本化存储 + 分享 v2（本文件 §3）
  toolbar.js     RTB. ★ 统一结果工具栏（保存/复制/重置/分享/导出）
assets/js/app.js     App：导航/主题/模型库/★实验控制器 App.exps
assets/js/modules/   模块只做「领域逻辑 × UI × 交互」的组合
  workbench.js  ★ 工作台（home，平台入口）
  …（fs/ft/la/sys/pid/zt/blk/derive/explore）
scripts/             工程：run-tests / check / lint / format / build / serve（零依赖）
```

★ = Phase 0/1 新增。分层目标（math-core / transforms / models / ui-components / modules）按此节奏推进，不引入框架，不改变 vanilla JS。

## 2. 实验闭环（Phase 1 已贯通的部分）

```
工作台：模板/新建 → PX.create → App.open(module) → applyState 回放
模块内：输入 → 求解 →（自动保存：切换模块/刷新前捕获 getState + 防抖落盘）
        工具栏 💾 保存 → 落盘 + 快照（≤10，可从工作台恢复）
        工具栏 🔗 分享 → #exp=PX1.<base64url>.<fnv1a> 版本化分享码
接收方：#exp= 打开 → 校验/解码 → 入库 → 打开模块 → 状态回放
刷新：  fltp:last → 恢复最近实验
```

### 模块接入契约（接入实验/工具栏的最低要求）

```js
return {
  title: '…',
  api: {
    getState()  { return /* 纯 JSON（PX 校验通过），≤32KB */; },
    applyState(s) { /* 用 s 恢复输入并触发求解 */ },
    dispose(), onTheme()
  }
};
```

已接入：`sys`（num/den/chart/params/状态空间矩阵 + PNG/CSV）、`zt`（num/den/editMode + PNG/CSV）、
`la`（num/den + PNG/CSV）、`pid`（plant/kp/ki/kd + PNG/CSV）、`explore`（tab/expr + PNG）。
未接入模块不受影响（工作台/控制器对其降级为不可捕获）。

### hash 路由约定

- `#exp=<PX1 分享码>`：实验导入（优先级最高）。
- 旧版模块 hash（`#hn/#hd/#ex/#lan/#ft/#fs/#zt/#blk`）：保持兼容；实验激活期间，模块的**状态同步**写入被 `App.hashFree()` 抑制（避免覆盖 `#exp=`），**跨模块交接**按钮（↗ 框图 / ↗ 求解）仍照常写 hash。

## 3. Experiment schema v1（window.PX）

```js
{
  schemaVersion: 1,
  id: 'e<base36>',            // /^[a-z0-9]{6,24}$/
  name: '≤80 字符',
  createdAt: 0, updatedAt: 0, // 有限数值
  favorite: false,
  tags: ['≤10 项，每项 ≤20 字符'],
  module: 'sys',              // /^[a-z]{1,12}$/
  moduleStates: {
    sys: { savedAt: 0, data: {/* 模块自定义纯 JSON，≤32KB */} }
  },
  snapshots: [ /* ≤10 个：{id,label≤60,ts,module,state:{<module>:{savedAt,data}}} */ ]
}
```

- **校验（拒绝式）**：`PX.validate` 检查类型/长度/有限性；`deepSanitize` 拒绝 NaN/Infinity、函数、`__proto__`/`constructor`/`prototype` 键、>8 层嵌套、>2000 长数组、>2000 字符字符串。拒绝而非静默剥离。
- **迁移**：`PX.migrate` 按 `MIGRATIONS` 表逐级升级；高于当前版本 → 明确报「请升级应用」；v1 直通。
- **存储**：`fltp:v1:index`（元数据索引，损坏可从主体键重建）+ `fltp:v1:exp:<id>`；上限 60 个实验；配额错误显式上抛并 toast。旧 `flt-models`（模型库）不受影响。
- **分享码**：`PX1.<base64url(json)>.<FNV-1a 校验前8位>`；UTF-8 走 `encodeURIComponent/unescape` 路径（无 TextEncoder 依赖）；编码后 ≤6000 字符；改坏任何一段都会被拒绝。
- **导入导出**：`PX.importJSON` 支持 `{"kind":"fltp-experiment", experiment:{…}}` 包裹或裸对象；同 id 幂等覆盖（重复导入自己的分享链接不会复制出重复实验）。

## 4. 安全基线（Phase 0）

| 项 | 现状 |
| --- | --- |
| 动态执行 | 已删除 `transforms.js` 的 `Function()`；`U.safeCalc` 白名单求值器接管常量算术；`scripts/lint.mjs` L1 规则防回归 |
| mathjs | 仅 `FX_LIB.parseTimeExpr` 使用；已加 AST 白名单（节点类型/函数/符号/运算符）+ 300 字符/2000 节点上限 |
| innerHTML | 静态模板可用；用户输入统一走 textContent/KaTeX render/`U.el`；lint 对「innerHTML+`${}` 插值」出警告清单人工复核 |
| 分享数据 | 见 §3 校验与校验和 |
| CDN | jsDelivr 主源 + app.js 动态加载 unpkg 备用源 + 可理解失败提示；已移除 document.write 内联脚本 |
| CSP/响应头 | `_headers`：CSP（script 无 unsafe-inline）、X-Content-Type-Options、Referrer-Policy、Permissions-Policy、X-Frame-Options |
| 数据外发 | 无任何网络上传（connect-src 'self'）；local-first |

## 5. 工程流程

```bash
npm test        # 顺序跑 tests/*.test.mjs（13 个脚本）
npm run check   # node --check 全部源码
npm run lint    # 静态安全审计 + index.html 引用/版本一致性 + localStorage 键登记
npm run format  # 保守格式化（行尾空白/EOF；大重排版暂缓以免噪声 diff）
npm run build   # 产物校验（引用存在/_headers/CSP/体积报告）
npm run preview # 零依赖静态服务器（默认 :8080）
npm run verify  # check + lint + test + build
```

CI：`.github/workflows/ci.yml`（push/PR → verify 全链）。部署：Cloudflare Pages 静态直传仓库根（`_headers` 随部署生效）。

## 6. 尚未完成（如实清单）

- 实验撤销/重做目前以「快照恢复」形式存在（工作台 🕘），尚无输入级 undo 栈。
- 命令面板（Ctrl+K 统一搜索）未做；工作台内搜索已覆盖实验与模板。
- getState/applyState 仅 sys/zt 接入；la/explore/pid/blk/ft/fs/derive 待接入。
- Web Worker 化、PWA/离线、IndexedDB、i18n 资源层、axe 可访问性自动化、Playwright E2E：Phase 2–4。
- SRI 未启用（需逐 hash 校验 CDN 资源，避免误锁导致全站公式失效，单列一个批次做）。
- KaTeX/mathjs 自托管（去除 CDN 依赖）待 PWA 批次一起评估。

## 7. 发布检查清单

1. `npm run verify` 全绿；
2. 更新 `index.html` 的 `?v=` 与侧栏版本号、`package.json` version、`CHANGELOG.md`；
3. `npx wrangler pages deploy . --project-name=ft-lt-play --branch=main`；
4. 线上冒烟：工作台建实验 → sys 改参数 → 💾 保存 → 刷新恢复 → 分享链接无痕窗口导入；
5. 回滚：Cloudflare Pages 控制台回退到上一部署即可（静态资源无迁移；实验存储带 schemaVersion，向前兼容）。

### 浏览器已验证（2026-09-19，桌面 Chromium 1280×720）

- 工作台渲染（模板卡/引导/搜索/列表）；模板点击 → 建实验 → 打开模块 → **模板状态回放**（zt 谐振器 num=z den=z²−1.6z+0.9425）
- 💾 保存 → 快照入库；实验激活期间模块不再改写旧版 hash；刷新自动恢复最近实验
- `#exp=PX1.…` 分享链接：清空存储后导入 → 直达模块 → 状态一致
- 10 个模块逐一打开无异常（home/fs/ft/la/zt/sys/pid/blk/derive/explore）
- 随本轮冒烟修复的存量 bug（上一工作区遗留、Node 桩掩盖）：sys 在 MI 创建前绑定 `#sys-num/#sys-den`（打开即崩）；`#sys-params` 容器缺失（solve 即崩）；sys/zt 未把 `getState/applyState` 挂到 api（恢复/模板静默失效）

### 待真机人工验收

- 手机端：工作台卡片换行、工具栏换行、触控命中区（≥44px）、窄屏 360px 无遮挡
- 系统分析「Z 变换」工具栏 🖼 PNG 导出的实际图片内容（canvas 跨设备像素密度）
- 深浅主题切换下工作台/工具栏配色、Windows 高对比度模式
