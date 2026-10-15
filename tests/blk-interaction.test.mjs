/* ============================================================
 * blk-interaction.test.mjs — 系统框图模块的交互逻辑测试（无浏览器）
 *   运行：node tests/blk-interaction.test.mjs
 *
 *   做法：用一套极简 DOM 桩把模块真正实例化，再合成 pointer 事件驱动
 *   命中检测 → 拖动 → 连线 → 撤销/重做 → 触屏长按 → 捏合缩放 →
 *   分享还原 等完整链路，断言可观测的产出（渲染出的 SVG 片段、计数栏文本）。
 *
 *   注意边界：这是**逻辑流**测试，不是渲染测试。桩会假造
 *   getBoundingClientRect / getContext / 元素查询等，因此它证明的是
 *   "状态机与算法走对了"，不能替代真机上的视觉与触感验收。
 *   求解内核的数学正确性由 tests/blocksolve.test.mjs 覆盖。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

/* ================= 极简 DOM 桩 ================= */
class DomNode {}
class TextNode extends DomNode { constructor(t) { super(); this.data = String(t); } }
const mkCtx = () => new Proxy({}, {
  get(t, k) {
    if (k === 'measureText') return () => ({ width: 10 });
    return k in t ? t[k] : () => {};
  },
  set(t, k, v) { t[k] = v; return true; }
});
const registry = {};
const reg = (key) => (registry[key] = registry[key] || new El(key.startsWith('#') ? 'svg' : 'div'));

class El extends DomNode {
  constructor(tag) {
    super();
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this._a = {};
    this._l = {};
    this._html = '';
    this.textContent = ''; this.value = ''; this.title = ''; this.className = '';
    this.clientWidth = 640; this.clientHeight = 420;
    this.offsetWidth = 170; this.offsetHeight = 40;
    this.width = 640; this.height = 420;
    this.parentElement = null;          // 让 Plot 跳过 ResizeObserver
    const cls = new Set();
    this.classList = {
      add: (...c) => c.forEach((x) => cls.add(x)),
      remove: (...c) => c.forEach((x) => cls.delete(x)),
      toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; v ? cls.add(c) : cls.delete(c); return v; },
      contains: (c) => cls.has(c)
    };
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; }   // 模拟真实 DOM：innerHTML 赋值整体替换子树
  get firstElementChild() { return this.children[0] || null; }
  addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
  removeEventListener() {}
  setAttribute(k, v) { this._a[k] = String(v); if (k === 'value') this.value = String(v); }   // 模拟真实 DOM：value 属性同步默认值
  getAttribute(k) { return k in this._a ? this._a[k] : null; }
  appendChild(c) { this.children.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.children.push(c)); }
  remove() {}
  contains() { return false; }
  closest() { return null; }
  querySelector(sel) { return reg(String(sel)); }
  querySelectorAll() { return []; }
  insertAdjacentHTML() {}
  focus() {} select() {} blur() {}
  setPointerCapture() {} releasePointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 420, right: 640, bottom: 420 }; }
  getContext() { return mkCtx(); }
  fire(type, evt) { (this._l[type] || []).forEach((f) => f(evt)); }
  dispatchEvent(evt) { this.fire(evt.type, evt); return true; }
  setSelectionRange() {}
}

const timers = new Map();
let timerSeq = 0;
const runTimers = () => { const q = [...timers.entries()]; timers.clear(); q.forEach(([, f]) => f()); };

const sandbox = {
  console,
  Node: DomNode,
  document: {
    body: new El('body'),
    createElement: (t) => new El(t),
    createTextNode: (t) => new TextNode(t),
    getElementById: (id) => reg('#' + id),
    querySelector: (s) => reg(s),
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {}
  },
  getComputedStyle: () => ({ fontFamily: 'sans-serif', getPropertyValue: () => '' }),
  matchMedia: () => ({ matches: false }),
  requestAnimationFrame: (f) => { rafQ.push(f); return rafQ.length; },
  setTimeout: (f) => { const id = ++timerSeq; timers.set(id, f); return id; },
  clearTimeout: (id) => { timers.delete(id); },
  ResizeObserver: class { observe() {} disconnect() {} },
  Event: class { constructor(t) { this.type = t; } },
  URLSearchParams, btoa, atob, escape, unescape,
  localStorage: { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } },
  history: { replaceState: (a, b, url) => { if (typeof url === 'string' && url.includes('#')) sandbox.location.hash = url.slice(url.indexOf('#')); } },
  location: { hash: '', origin: 'http://x', pathname: '/index.html' },
  navigator: {},
  confirm: () => true,
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
  addEventListener: () => {}, removeEventListener: () => {},
  App: { modules: {}, register(name, f) { this.modules[name] = f; } }
};
const rafQ = [];
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['assets/js/lib/util.js', 'assets/js/lib/mathdsp.js', 'assets/js/lib/plots.js',
  'assets/js/lib/fx.js', 'assets/js/lib/blocksolve.js', 'assets/js/lib/project.js', 'assets/js/lib/toolbar.js', 'assets/js/lib/transforms.js',
  'assets/js/lib/mathinput.js', 'assets/js/app.js',
  'assets/js/modules/blockdiag.js']) {
  vm.runInContext(read(f), sandbox, { filename: f });
}

/* ================= 断言工具 ================= */
let pass = 0;
const fails = [];
const ok = (n, c, extra) => { c ? pass++ : fails.push(n + (extra ? '  → ' + extra : '')); };
const staticHtml = () => registry['#blk-g-static'].innerHTML;
const tabHtml = () => registry['#blk-tabbody'].innerHTML;
const counts = () => registry['#blk-counts'].textContent;
const flash = () => registry['#blk-status'].textContent;
const runRaf = () => { while (rafQ.length) rafQ.shift()(); };
const rectOf = () => /<rect x="([-\d.]+)" y="([-\d.]+)" width="120" height="46"/.exec(staticHtml());
const transform = () => {
  const m = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)/.exec(registry['#blk-g-static'].getAttribute('transform') || '');
  return m ? { tx: +m[1], ty: +m[2], s: +m[3] } : { tx: 0, ty: 0, s: 1 };
};
const toScreen = (wx, wy) => { const v = transform(); return { x: wx * v.s + v.tx, y: wy * v.s + v.ty }; };
const svgEl = () => registry['#blk-svg'];
// 同一次手势必须复用同一个 pointerId，否则 pointers 计数会泄漏（多指判定会被误触发）
const mkEvt = (o) => Object.assign({
  button: 0, pointerType: 'mouse', pointerId: 1, clientX: 0, clientY: 0,
  shiftKey: false, preventDefault() {}, stopPropagation() {},
  target: { closest: () => null }, setPointerCapture() {}
}, o);
const ev = (type, x, y, o) => svgEl().fire(type, mkEvt(Object.assign({ clientX: x, clientY: y }, o)));
// 桩里 textContent 不从子节点派生，U.el 产生的文本都是 TextNode：递归收集 .data
const textOf = (el) => el.data != null ? el.data : (el.children || []).reduce((s, c) => s + textOf(c), '');
// 多实例共享元素 / 定时器：新场景开始前清场，让事件只由最新实例响应（避免交叉污染）
const freshStage = () => {
  timers.clear();
  for (const k in registry) { const el = registry[k]; if (el && el._l) el._l = {}; }
  sandbox.document.body.children = sandbox.document.body.children
    .filter((c) => c.className !== 'blk-ctx' && c.className !== 'blk-edit');
};

/* ================= ① 初始化与符号体系 ================= */
const mod = sandbox.App.modules['blk'](new El('div'));
runRaf();
ok('初始化返回 api', !!mod && typeof mod.api.dispose === 'function');
ok('默认载入示例：计数 2 元件 2 连线', /2 元件 · 2 连线/.test(counts()), counts());
ok('提示与计数分栏显示', /已载入/.test(flash()) && /元件/.test(counts()), flash() + ' | ' + counts());

let html = staticHtml();
ok('渲染出求和圈 Σ', html.includes('>Σ<'));
ok('渲染出 R(s) 输入端子', html.includes('>R(s)<'));
ok('渲染出 Y(s) 输出端子', html.includes('>Y(s)<'));
ok('反馈回路为虚线', /stroke-dasharray="6 4"/.test(html));
ok('求和圈上标出 − 号', /fill="var\(--danger\)"[^>]*>−</.test(html));
ok('结果区给出阶次/极点/稳定性', tabHtml().includes('阶次') && tabHtml().includes('稳定性'));
ok('一阶负反馈闭环极点为 -11', /-11/.test(tabHtml()), (/blk-poles">([^<]*)/.exec(tabHtml()) || [])[1]);

/* ================= ② 拖动 / 撤销 / 重做 ================= */
const r0 = rectOf();
const beforeX = +r0[1];
const bp = toScreen(beforeX + 60, +r0[2] + 23);
ev('pointerdown', bp.x, bp.y);
ev('pointermove', bp.x + 60, bp.y + 40);
ev('pointerup', bp.x + 60, bp.y + 40);
const r1 = rectOf();
const afterX = r1 ? +r1[1] : NaN;
ok('拖动改变方框位置', Number.isFinite(afterX) && Math.abs(afterX - beforeX) > 5, beforeX + ' → ' + afterX);
ok('拖动后撤销按钮可用', !registry['#blk-undo'].classList.contains('blk-off'));

registry['#blk-undo'].fire('click', mkEvt({}));
const r2 = rectOf();
ok('撤销回到原位', r2 && Math.abs(+r2[1] - beforeX) < 0.6, r2 && +r2[1]);
registry['#blk-redo'].fire('click', mkEvt({}));
const r3 = rectOf();
ok('重做回到移动后位置', r3 && Math.abs(+r3[1] - afterX) < 0.6, r3 && +r3[1]);

/* ================= ③ 端口连线 → 空白处新建（含自动接线） ================= */
const r4 = rectOf();
const outPt = toScreen(+r4[1] + 60 + 65, +r4[2] + 23);
ev('pointerdown', outPt.x, outPt.y);
ev('pointermove', 40, 380);
ok('拖到空白处给出新建提示', /新建元件/.test(registry['#blk-hint'].textContent), registry['#blk-hint'].textContent);
ev('pointerup', 40, 380);
const menu = sandbox.document.body.children.find((c) => c.className === 'blk-ctx');
ok('空白松手弹出上下文菜单', !!menu);
if (menu) {
  const items = menu.children.map((c) => c.textContent);
  ok('菜单含五类新建项', items.length === 5 && items.join('|').includes('求和点') && items.join('|').includes('采样开关') && items.join('|').includes('零阶保持器'), items.join('|'));
  menu.children.find((c) => c.textContent.includes('方框')).fire('click', mkEvt({}));
  ok('新建元件并自动接上来源（3 元件 2 连线：按在已连线端口 = 端点改接）', /3 元件 · 2 连线/.test(counts()), counts());
  registry['#blk-share'].fire('click', mkEvt({}));
  const back3 = JSON.parse(decodeURIComponent(escape(atob(sandbox.location.hash.slice('#blk=blk1.'.length)))));
  ok('改接保留负反馈符号与方向（新元件 → Σ）', JSON.stringify(back3.e) === '[[1,2,1],[3,1,0]]', JSON.stringify(back3.e));
}

/* ================= ④ 结果页签 ================= */
const tabs = () => registry['#blk-tabs'].children.filter((c) => (c.className || '').includes('blk-tab'));
ok('结果页签为 3 个', tabs().length === 3, String(tabs().length));
tabs()[1].fire('click', mkEvt({}));
ok('闭环极点页签渲染画布', tabHtml().includes('id="blk-pz"'));
tabs()[2].fire('click', mkEvt({}));
ok('阶跃响应页签渲染画布', tabHtml().includes('id="blk-step"'));
tabs()[0].fire('click', mkEvt({}));

/* ================= ⑤ 无按键移动不改动元件 ================= */
const r5 = rectOf();
const hover = toScreen(+r5[1] + 60, +r5[2] + 23);
ev('pointermove', hover.x + 80, hover.y + 80);
ev('pointermove', hover.x + 120, hover.y + 120);
ok('无按键移动不产生改动', staticHtml().includes('<rect x="' + r5[1] + '"'));

/* ================= ⑥ 触屏：长按菜单 ================= */
const r6 = rectOf();
const nodePt = toScreen(+r6[1] + 60, +r6[2] + 23);
sandbox.document.body.children = sandbox.document.body.children.filter((c) => c.className !== 'blk-ctx');
ev('pointerdown', nodePt.x, nodePt.y, { pointerType: 'touch', pointerId: 900 });
runTimers();
let tmenu = sandbox.document.body.children.find((c) => c.className === 'blk-ctx');
ok('触屏长按弹出菜单', !!tmenu);
if (tmenu) {
  const labels = tmenu.children.map((c) => c.textContent).join('|');
  ok('长按菜单含编辑/重命名/输出/删除', /编辑传函/.test(labels) && /重命名/.test(labels) && /Y\(s\)/.test(labels) && /删除/.test(labels), labels);
}
// 关掉菜单
ev('pointerup', nodePt.x, nodePt.y, { pointerType: 'touch', pointerId: 900 });

/* ================= ⑦ 触屏：拖动会取消长按 ================= */
sandbox.document.body.children = sandbox.document.body.children.filter((c) => c.className !== 'blk-ctx');
ev('pointerdown', nodePt.x, nodePt.y, { pointerType: 'touch', pointerId: 901 });
ev('pointermove', nodePt.x + 70, nodePt.y + 20, { pointerType: 'touch', pointerId: 901 });
runTimers();
ok('拖动超过阈值后不再弹菜单', !sandbox.document.body.children.some((c) => c.className === 'blk-ctx'));
ev('pointerup', nodePt.x + 70, nodePt.y + 20, { pointerType: 'touch', pointerId: 901 });

/* ================= ⑧ 触屏：双指捏合缩放 ================= */
const zBefore = registry['#blk-zoom-val'].textContent;
ev('pointerdown', 200, 200, { pointerType: 'touch', pointerId: 910 });
ev('pointerdown', 300, 200, { pointerType: 'touch', pointerId: 911 });
ev('pointermove', 120, 200, { pointerType: 'touch', pointerId: 910 });
ev('pointermove', 380, 200, { pointerType: 'touch', pointerId: 911 });
const zAfter = registry['#blk-zoom-val'].textContent;
ok('双指张开使缩放变大', parseInt(zAfter, 10) > parseInt(zBefore, 10), zBefore + ' → ' + zAfter);
ev('pointerup', 120, 200, { pointerType: 'touch', pointerId: 910 });
ev('pointerup', 380, 200, { pointerType: 'touch', pointerId: 911 });

/* ================= ⑨ 删除选中 / 清空 ================= */
const n0 = counts();
const r7 = rectOf();
const pt7 = toScreen(+r7[1] + 60, +r7[2] + 23);
ev('pointerdown', pt7.x, pt7.y);
ev('pointerup', pt7.x, pt7.y);
registry['#blk-del'].fire('click', mkEvt({}));
ok('删除选中后计数减少', counts() !== n0, n0 + ' → ' + counts());
registry['#blk-clear'].fire('click', mkEvt({}));
ok('清空后为 0 元件 0 连线', /0 元件 · 0 连线/.test(counts()), counts());

/* ================= ⑩ 分享链接与还原 ================= */
registry['#blk-demo'].fire('click', mkEvt({}));
registry['#blk-demo'].fire('click', mkEvt({}));
const beforeShare = counts();
registry['#blk-share'].fire('click', mkEvt({}));
ok('分享出 #blk=blk1.<base64>', /^#blk=blk1\./.test(sandbox.location.hash), sandbox.location.hash.slice(0, 40));

let threw = null;
try { mod.api.onTheme(); mod.api.dispose(); } catch (e) { threw = e; }
ok('onTheme / dispose 不抛异常', !threw, threw && threw.message);

let mod2 = null; threw = null;
try { mod2 = sandbox.App.modules['blk'](new El('div')); runRaf(); } catch (e) { threw = e; }
ok('带 hash 初始化不抛异常', !threw, threw && threw.message);
ok('分享链接还原出同样的元件/连线', counts() === beforeShare, beforeShare + ' → ' + counts());
ok('还原后仍渲染出求和圈', staticHtml().includes('>Σ<'));
if (mod2) mod2.api.dispose();

/* ================= ⑪ 采样元件 / Z 域分析 ================= */
// 先用按钮加两个采样元件：只验交互入口与「采样周期」行的出现
registry['#blk-clear'].fire('click', mkEvt({}));
registry['#blk-add-sample'].fire('click', mkEvt({}));
registry['#blk-add-zoh'].fire('click', mkEvt({}));
ok('新增采样开关 / ZOH 后计数增加', /2 元件/.test(counts()), counts());
ok('出现「采样周期 T」行', registry['#blk-tparam'].style.display === '', registry['#blk-tparam'].style.display);
// 采样模式下页签切换为 z 域两项
let zTabs = tabs().map((c) => c.textContent).join('|');
ok('采样模式页签为 脉冲传函 + 连续片段', tabs().length === 2 && /脉冲传函/.test(zTabs) && /连续片段/.test(zTabs), zTabs);

// 用分享编码搭标准采样回路：Σ(src) → 采样 → D(z) → ZOH → G(s) → 采样 → Σ(−1)
const slim = {
  v: 1, T: 0.05,
  n: [
    { i: 1, k: 'sum', m: 'Σ1', s: '1', x: 160, y: 220, r: 1, o: 0, z: 0 },
    { i: 2, k: 'sample', m: 'S2', s: '1', x: 320, y: 220, r: 0, o: 0, z: 0 },
    { i: 3, k: 'box', m: 'D3', s: '(z-0.5)/(z-1)', x: 480, y: 220, r: 0, o: 0, z: 1 },
    { i: 4, k: 'zoh', m: 'H4', s: '1', x: 640, y: 220, r: 0, o: 0, z: 0 },
    { i: 5, k: 'box', m: 'G5', s: '1/(s+1)', x: 810, y: 220, r: 0, o: 1, z: 0 },
    { i: 6, k: 'sample', m: 'S6', s: '1', x: 810, y: 360, r: 0, o: 0, z: 0 }
  ],
  e: [[1, 2, 1], [2, 3, 1], [3, 4, 1], [4, 5, 1], [5, 6, 1], [6, 1, 0]],
  vw: { s: 1, tx: 0, ty: 0 }
};
sandbox.location.hash = '#blk=blk1.' + btoa(unescape(encodeURIComponent(JSON.stringify(slim))));
let mod3 = null, e3 = null;
try { mod3 = sandbox.App.modules['blk'](new El('div')); runRaf(); } catch (err) { e3 = err; }
ok('带采样元件的分享链接还原不抛异常', !e3, e3 && e3.message);
ok('还原出 6 元件 6 连线', /6 元件 · 6 连线/.test(counts()), counts());
ok('还原出采样周期 T=0.05', registry['#blk-t'].value === '0.05', registry['#blk-t'].value);
let h = staticHtml();
ok('渲染出采样开关符号（T 标注）', h.includes('>T<'), h.slice(0, 0));
ok('渲染出零阶保持器（ZOH 标注）', h.includes('>ZOH<'));
ok('z 域块带 z 徽标', h.includes('>z<'));

// 结果：脉冲传函页签内解析式 + z 平面 + 采样点响应三块
let body = tabHtml();
ok('T(z) 页签含解析式 / z 平面 / 采样响应',
  body.includes('id="blk-ztex"') && body.includes('id="blk-zpz"') && body.includes('id="blk-zstem"'),
  body.slice(0, 80));
ok('T(z) 页签给出单位圆判稳说明', /圆内为稳定域/.test(body));
ok('标准采样回路解出闭环极点', /blk-poles">([^—][^<]*)/.test(body), (/blk-poles">([^<]*)/.exec(body) || [])[1]);
const polesBefore = (/blk-poles">([^<]*)/.exec(body) || [])[1];

// 连续片段页签：识别出前置 ZOH 并给出 T(s) → T(z) 的对照
tabs()[1].fire('click', mkEvt({}));
body = tabHtml();
ok('连续片段页签识别 ZOH 头因子', /ZOH \(1−z⁻¹\)/.test(body), body.slice(0, 120));
ok('连续片段页签给出 T(s) 与 T(z)', body.includes('T(s)') && body.includes('T(z)'));
tabs()[0].fire('click', mkEvt({}));

// 采样周期改动 → 重解（极点随之变化）
registry['#blk-t'].value = '0.2';
registry['#blk-t'].fire('change', mkEvt({ target: registry['#blk-t'] }));
body = tabHtml();
ok('改 T 后重新求解（极点变化）', (/blk-poles">([^<]*)/.exec(body) || [])[1] !== polesBefore,
  polesBefore + ' → ' + (/blk-poles">([^<]*)/.exec(body) || [])[1]);
ok('改 T 后无警告', registry['#blk-t-warn'].textContent === '', registry['#blk-t-warn'].textContent);
// 非法 T 不采纳并提示。注：本桩里模块被多次实例化，事件会同时打到多个实例的处理器上
// （先注册的处理器会把 target.value 改回它自己的 T），故用「值恒为 -1 的只读 target」
// 把该断言与处理器叠加顺序解耦
const polesNow = (/blk-poles">([^<]*)/.exec(tabHtml()) || [])[1];
registry['#blk-t'].fire('change', mkEvt({ target: { get value() { return '-1'; }, set value(_v) {} } }));
ok('非法 T 不采纳（分析结果不变）', (/blk-poles">([^<]*)/.exec(tabHtml()) || [])[1] === polesNow, polesNow);
ok('非法 T 给出提示', /正数/.test(registry['#blk-t-warn'].textContent), registry['#blk-t-warn'].textContent);

// 把 G(s) 标为「已在 z 域」→ 连续片段消失，退化为全离散回路
const ptG = toScreen(810, 220);
ev('pointerdown', ptG.x, ptG.y);
ev('pointerup', ptG.x, ptG.y);
const zcb = (registry['#blk-insp'].children || []).filter((c) => (c.className || '').includes('blk-zdom'))
  .map((lab) => lab.children[0])[0];
ok('检查器给出「已在 z 域」开关', !!zcb);
if (zcb) {
  zcb.checked = true;
  zcb.fire('change', mkEvt({}));
  tabs()[1].fire('click', mkEvt({}));
  ok('标记 z 域后片段消失（退化为全离散）', /没有连续片段/.test(tabHtml()), tabHtml().slice(0, 100));
}

// 分享往返：T 与 z 标记都要能还原
registry['#blk-share'].fire('click', mkEvt({}));
const raw = decodeURIComponent(escape(atob(sandbox.location.hash.slice('#blk=blk1.'.length))));
const back = JSON.parse(raw);
ok('分享链接带采样周期 T', back.T === 0.2, String(back.T));
ok('分享链接带 z 域标记', back.n.some((n) => n.z === 1) && back.n.some((n) => n.k === 'sample'),
  JSON.stringify(back.n.map((n) => n.k + (n.z ? ':z' : ''))));
if (mod3) mod3.api.dispose();

/* ================= ⑫b 检查器符号键盘（移动端补齐） ================= */
{
  // 选中一个方框 → 检查器渲染出 pad-key 键盘，点击可在传函输入光标处插入
  const r8 = rectOf();
  const pt8 = toScreen(+r8[1] + 60, +r8[2] + 23);
  ev('pointerdown', pt8.x, pt8.y);
  ev('pointerup', pt8.x, pt8.y);
  const insp = registry['#blk-insp'];
  const padKeys = [];
  const walk = (el) => { (el.children || []).forEach((c) => { if ((c.className || '').includes('pad-key')) padKeys.push(c); walk(c); }); };
  walk(insp);
  ok('检查器出现符号键盘', padKeys.length >= 8, String(padKeys.length));
  const inp8 = [];
  const walkInp = (el) => { (el.children || []).forEach((c) => { if (c.tagName === 'INPUT' && (c.className || '').includes('blk-inp')) inp8.push(c); walkInp(c); }); };
  walkInp(insp);
  const tfInp = inp8.find((c) => (c.value || '').includes('/')) || inp8[0];
  if (padKeys.length && tfInp) {
    const before = tfInp.value;
    const chipText = (c) => (c.children || []).map((t) => t.data != null ? t.data : (t.textContent || '')).join('') || c.textContent;
    const tok0 = chipText(padKeys[0]);
    padKeys[0].fire('click', mkEvt({}));
    ok('键盘点击在传函输入末尾插入 token', tfInp.value === before + tok0, before + ' → ' + tfInp.value);
  }
}

/* ================= ⑬ 连线避障：同轴三盒 1→3 应绕行而非直穿中间盒 ================= */
{
  const slim3 = {
    v: 1, T: 0.1,
    n: [
      { i: 1, k: 'box', m: 'A', s: '1/(s+1)', x: 200, y: 220, r: 1, o: 0, z: 0 },
      { i: 2, k: 'box', m: 'B', s: '1/(s+2)', x: 460, y: 220, r: 0, o: 0, z: 0 },
      { i: 3, k: 'box', m: 'C', s: '1/(s+3)', x: 720, y: 220, r: 0, o: 1, z: 0 }
    ],
    e: [[1, 3, 1]], vw: { s: 1, tx: 0, ty: 0 }
  };
  sandbox.location.hash = '#blk=blk1.' + btoa(unescape(encodeURIComponent(JSON.stringify(slim3))));
  let m4 = null, e4 = null;
  try { m4 = sandbox.App.modules['blk'](new El('div')); runRaf(); } catch (err) { e4 = err; }
  ok('同轴三盒还原不抛异常', !e4, e4 && e4.message);
  ok('还原出 3 元件 1 连线', /3 元件 · 1 连线/.test(counts()), counts());
  // 绕行后连线下移到 y=220+44=264 车道（避开中间盒 197~243 的框体）
  ok('同轴穿框连线走上/下绕行（含非 220 拐点）', /\b264\b/.test(staticHtml()), (staticHtml().match(/<path d="[^"]+"/) || [''])[0]);
  if (m4) m4.api.dispose();
}

/* ================= ⑭ 双击方框进入就地编辑（确定坐标） ================= */
{
  const slimE = { v: 1, T: 0.1, n: [{ i: 1, k: 'box', m: 'G', s: '1/(s+1)', x: 300, y: 160, r: 1, o: 1, z: 0 }], e: [], vw: { s: 1, tx: 0, ty: 0 } };
  sandbox.location.hash = '#blk=blk1.' + btoa(unescape(encodeURIComponent(JSON.stringify(slimE))));
  const mE = sandbox.App.modules['blk'](new El('div')); runRaf();
  sandbox.document.body.children = sandbox.document.body.children.filter((c) => c.className !== 'blk-edit');
  const pe = toScreen(300, 160);
  svgEl().fire('dblclick', mkEvt({ clientX: pe.x, clientY: pe.y }));
  const edit = sandbox.document.body.children.find((c) => c.className === 'blk-edit');
  ok('双击方框弹出就地编辑输入框', !!edit && (edit.children || []).some((c) => c.tagName === 'INPUT'), edit ? 'has' : 'none');
  mE.api.dispose();
}

/* ================= ⑮ 反向拉线：从入端口拖到上游输出端 → 方向 源→本 ================= */
{
  const slimW = {
    v: 1, T: 0.1,
    n: [
      { i: 1, k: 'box', m: 'A', s: '1/(s+1)', x: 200, y: 160, r: 1, o: 0, z: 0 },
      { i: 2, k: 'box', m: 'B', s: '1/(s+2)', x: 460, y: 160, r: 0, o: 1, z: 0 }
    ],
    e: [], vw: { s: 1, tx: 0, ty: 0 }
  };
  sandbox.location.hash = '#blk=blk1.' + btoa(unescape(encodeURIComponent(JSON.stringify(slimW))));
  const mW = sandbox.App.modules['blk'](new El('div')); runRaf();
  ok('反向拉线初始 2 元件 0 连线', /2 元件 · 0 连线/.test(counts()), counts());
  const inB = toScreen(460 - 65, 160);    // box B 左入端口
  const outA = toScreen(200 + 65, 160);   // box A 右出端口
  ev('pointerdown', inB.x, inB.y);
  ev('pointermove', outA.x, outA.y);
  ev('pointerup', outA.x, outA.y);
  ok('反向拉线生成连线（2 元件 1 连线）', /2 元件 · 1 连线/.test(counts()), counts());
  registry['#blk-share'].fire('click', mkEvt({}));
  const backW = JSON.parse(decodeURIComponent(escape(atob(sandbox.location.hash.slice('#blk=blk1.'.length)))));
  ok('方向正确：源(A)→本(B) 即 e=[[1,2,1]]', JSON.stringify(backW.e) === '[[1,2,1]]', JSON.stringify(backW.e));
  mW.api.dispose();
}

/* ================= ⑯ 连线重连接 + 连线列表 + ± 徽标命中 ================= */
{
  freshStage();
  const slimR = {
    v: 1, T: 0.1,
    n: [
      { i: 1, k: 'box', m: 'A', s: '1/(s+1)', x: 200, y: 160, r: 1, o: 0, z: 0 },
      { i: 2, k: 'box', m: 'B', s: '1/(s+2)', x: 460, y: 160, r: 0, o: 0, z: 0 },
      { i: 3, k: 'box', m: 'C', s: '1/(s+3)', x: 720, y: 160, r: 0, o: 0, z: 0 }
    ],
    e: [[1, 2, 1]], vw: { s: 1, tx: 0, ty: 0 }
  };
  sandbox.location.hash = '#blk=blk1.' + btoa(unescape(encodeURIComponent(JSON.stringify(slimR))));
  const mR = sandbox.App.modules['blk'](new El('div')); runRaf();
  ok('重连接场景还原 3 元件 1 连线', /3 元件 · 1 连线/.test(counts()), counts());
  ok('静态层渲染 ± 徽标（blk-badge 类）', staticHtml().includes('class="blk-badge'));

  // 元件列表新增「连线」小节：A → B + ± 说明
  const listR = registry['#blk-list'];
  const headsR = [], namesR = [], itemsR = [];
  const walkL = (el) => { (el.children || []).forEach((c) => {
    const cls = c.className || '';
    if (cls.includes('blk-listhead')) headsR.push(textOf(c));
    if (cls.includes('blk-itemname')) namesR.push(textOf(c));
    if ((cls + ' ').includes('blk-item ')) itemsR.push(c);
    walkL(c);
  }); };
  walkL(listR);
  ok('列表含「连线」小节标题', headsR.includes('连线'), JSON.stringify(headsR));
  ok('连线列表项显示 A → B', namesR.includes('A → B'), JSON.stringify(namesR));
  ok('列表为 3 元件行 + 1 连线行', itemsR.length === 4, String(itemsR.length));
  if (itemsR.length === 4) {
    itemsR[3].fire('click', mkEvt({}));
    ok('点选连线行在画布加粗高亮（accent-2 选中色）', staticHtml().includes('stroke="var(--accent-2)" stroke-width="3.2"'));
    runTimers();
    ok('高亮为短暂效果（750ms 后还原）', !staticHtml().includes('stroke="var(--accent-2)" stroke-width="3.2"'));
  }

  // 空闲端口拉新线的手势保持不变（B 出端口无连线占用）
  const outB = toScreen(525, 160), inC = toScreen(655, 160);
  ev('pointerdown', outB.x, outB.y);
  ev('pointermove', inC.x, inC.y);
  ev('pointerup', inC.x, inC.y);
  ok('空闲端口正向拉线仍可用（3 元件 2 连线）', /3 元件 · 2 连线/.test(counts()), counts());

  // 重连接：按住 A→B 源头端（A 出端口）→ 原边暂隐 → 落到 C 出端口改接，撤销一步还原
  const endA = toScreen(265, 160), outC = toScreen(785, 160);
  ev('pointerdown', endA.x, endA.y);
  ok('抓住连线端点后原边暂隐（预览接管）', !staticHtml().includes('M 265 160'));
  ev('pointermove', outC.x, outC.y);
  ev('pointerup', outC.x, outC.y);
  ok('端点改接到新端口（3 元件 2 连线）', /3 元件 · 2 连线/.test(counts()), counts());
  registry['#blk-share'].fire('click', mkEvt({}));
  const backR = JSON.parse(decodeURIComponent(escape(atob(sandbox.location.hash.slice('#blk=blk1.'.length)))));
  ok('改接后边集为 B→C 与 C→B', JSON.stringify(backR.e) === '[[2,3,1],[3,2,1]]', JSON.stringify(backR.e));
  registry['#blk-undo'].fire('click', mkEvt({}));
  registry['#blk-share'].fire('click', mkEvt({}));
  const backR2 = JSON.parse(decodeURIComponent(escape(atob(sandbox.location.hash.slice('#blk=blk1.'.length)))));
  ok('重连接可一步撤销（还原 A→B 与 B→C）', JSON.stringify(backR2.e) === '[[1,2,1],[2,3,1]]', JSON.stringify(backR2.e));
  ok('撤销后原边恢复渲染', staticHtml().includes('M 265 160'));

  // 重连接落空白 → 新建元件接上（同为一步撤销）
  const endB = toScreen(395, 160);
  ev('pointerdown', endB.x, endB.y);
  sandbox.document.body.children = sandbox.document.body.children.filter((c) => c.className !== 'blk-ctx');
  ev('pointermove', 40, 380);
  ev('pointerup', 40, 380);
  const menuR = sandbox.document.body.children.find((c) => c.className === 'blk-ctx');
  ok('端点拖到空白弹出新建菜单（5 项）', !!menuR && menuR.children.length === 5, menuR && String(menuR.children.length));
  if (menuR) menuR.children.find((c) => c.textContent.includes('方框')).fire('click', mkEvt({}));
  ok('改接新建后为 4 元件 2 连线', /4 元件 · 2 连线/.test(counts()), counts());
  registry['#blk-share'].fire('click', mkEvt({}));
  const backR3 = JSON.parse(decodeURIComponent(escape(atob(sandbox.location.hash.slice('#blk=blk1.'.length)))));
  ok('改接新建的边集为 B→C 与 A→新', JSON.stringify(backR3.e) === '[[2,3,1],[1,4,1]]', JSON.stringify(backR3.e));
  registry['#blk-undo'].fire('click', mkEvt({}));
  ok('改接新建可一步撤销（回到 3 元件 2 连线）', /3 元件 · 2 连线/.test(counts()), counts());

  // ± 徽标点击切换符号（点击行为与命中区保留；closest 按选择器区分端子 / 徽标）
  svgEl().fire('pointerdown', mkEvt({ clientX: 10, clientY: 10, target: { closest: (sel) => sel === '[data-badge]' ? { dataset: { badge: '0' } } : null } }));
  registry['#blk-share'].fire('click', mkEvt({}));
  const backR4 = JSON.parse(decodeURIComponent(escape(atob(sandbox.location.hash.slice('#blk=blk1.'.length)))));
  ok('徽标点击切换符号（e 首项 sign=0）', JSON.stringify(backR4.e) === '[[1,2,0],[2,3,1]]', JSON.stringify(backR4.e));
  registry['#blk-undo'].fire('click', mkEvt({}));
  mR.api.dispose();
}

/* ================= ⑰ 采样周期 T 入快照：Ctrl+Z 可回退 T ================= */
{
  freshStage();
  const slimT = { v: 1, T: 0.1, n: [{ i: 1, k: 'box', m: 'A', s: '1/(s+1)', x: 300, y: 160, r: 1, o: 1, z: 0 }], e: [], vw: { s: 1, tx: 0, ty: 0 } };
  sandbox.location.hash = '#blk=blk1.' + btoa(unescape(encodeURIComponent(JSON.stringify(slimT))));
  const mT = sandbox.App.modules['blk'](new El('div')); runRaf();
  ok('干净结构无引导提示', registry['#blk-guide'].hidden === true, String(registry['#blk-guide'].hidden));
  registry['#blk-t'].value = '0.25';
  registry['#blk-t'].fire('change', mkEvt({ target: registry['#blk-t'] }));
  ok('T 修改生效为 0.25', registry['#blk-t'].value === '0.25', registry['#blk-t'].value);
  registry['#blk-undo'].fire('click', mkEvt({}));
  ok('撤销还原采样周期 T（回到 0.1）', registry['#blk-t'].value === '0.1', registry['#blk-t'].value);
  registry['#blk-redo'].fire('click', mkEvt({}));
  ok('重做恢复 T=0.25', registry['#blk-t'].value === '0.25', registry['#blk-t'].value);
  mT.api.dispose();
}

/* ================= ⑱ 结构检查引导条（无 R / 多 R，不阻断求解） ================= */
{
  freshStage();
  const slimG1 = { v: 1, T: 0.1, n: [
    { i: 1, k: 'box', m: 'A', s: '1/(s+1)', x: 200, y: 160, r: 0, o: 0, z: 0 },
    { i: 2, k: 'box', m: 'B', s: '1/(s+2)', x: 460, y: 160, r: 0, o: 1, z: 0 }
  ], e: [[1, 2, 1]], vw: { s: 1, tx: 0, ty: 0 } };
  sandbox.location.hash = '#blk=blk1.' + btoa(unescape(encodeURIComponent(JSON.stringify(slimG1))));
  const mG1 = sandbox.App.modules['blk'](new El('div')); runRaf();
  const gv = registry['#blk-guide'];
  ok('无 R 时引导条出现', gv.hidden === false && /未检测到输入端子 R/.test(gv.innerHTML), 'hidden=' + gv.hidden);
  ok('引导条说明按哪个节点注入', /节点 A/.test(gv.innerHTML), gv.innerHTML.slice(0, 80));
  ok('引导条不阻断求解（T(s) 仍渲染）', tabHtml().includes('id="blk-tex"'));
  mG1.api.dispose();
}
{
  freshStage();
  const slimG2 = { v: 1, T: 0.1, n: [
    { i: 1, k: 'box', m: 'A', s: '1/(s+1)', x: 200, y: 160, r: 1, o: 0, z: 0 },
    { i: 2, k: 'box', m: 'B', s: '1/(s+2)', x: 460, y: 160, r: 1, o: 0, z: 0 },
    { i: 3, k: 'box', m: 'C', s: '1/(s+3)', x: 720, y: 160, r: 0, o: 1, z: 0 }
  ], e: [[1, 2, 1], [2, 3, 1]], vw: { s: 1, tx: 0, ty: 0 } };
  sandbox.location.hash = '#blk=blk1.' + btoa(unescape(encodeURIComponent(JSON.stringify(slimG2))));
  const mG2 = sandbox.App.modules['blk'](new El('div')); runRaf();
  ok('多 R 时提示多点注入', /检测到 2 个输入端子 R/.test(registry['#blk-guide'].innerHTML), registry['#blk-guide'].innerHTML.slice(0, 80));
  mG2.api.dispose();
}

/* ================= ⑲ 触屏长按空白框选 + 组操作 + 空状态引导 ================= */
{
  freshStage();
  sandbox.localStorage.removeItem('blk-marquee-hint');
  const slimS = { v: 1, T: 0.1, n: [
    { i: 1, k: 'box', m: 'A', s: '1/(s+1)', x: 200, y: 160, r: 0, o: 0, z: 0 },
    { i: 2, k: 'box', m: 'B', s: '1/(s+2)', x: 460, y: 160, r: 0, o: 0, z: 0 },
    { i: 3, k: 'box', m: 'C', s: '1/(s+3)', x: 200, y: 360, r: 0, o: 0, z: 0 },
    { i: 4, k: 'box', m: 'D', s: '1/(s+4)', x: 460, y: 360, r: 0, o: 0, z: 0 }
  ], e: [], vw: { s: 1, tx: 0, ty: 0 } };
  sandbox.location.hash = '#blk=blk1.' + btoa(unescape(encodeURIComponent(JSON.stringify(slimS))));
  const hostS = new El('div');
  const mS = sandbox.App.modules['blk'](hostS); runRaf();
  ok('有元件时空状态引导隐藏', registry['#blk-empty'].hidden === true, String(registry['#blk-empty'].hidden));
  ok('空状态模板含三步上手文案', /id="blk-empty"/.test(hostS.innerHTML) && /① 点击左侧添加元件/.test(hostS.innerHTML) && /② 从端口拖出连线/.test(hostS.innerHTML) && /③ 自动求解/.test(hostS.innerHTML));

  // 触屏长按空白 → 框选（首次给一次性提示；单指拖空白无长按仍为平移）
  ev('pointerdown', 60, 60, { pointerType: 'touch', pointerId: 920 });
  runTimers();
  ok('首次长按空白提示「松开以选择元件」', /松开以选择元件/.test(registry['#blk-hint'].textContent), registry['#blk-hint'].textContent);
  ev('pointermove', 520, 430, { pointerType: 'touch', pointerId: 920 });
  ev('pointerup', 520, 430, { pointerType: 'touch', pointerId: 920 });
  const inspTxt = [];
  const walkI = (el) => { (el.children || []).forEach((c) => { if (c.data != null) inspTxt.push(c.data); walkI(c); }); };
  walkI(registry['#blk-insp']);
  ok('触屏框选保留 4 个选中元件', inspTxt.join('|').includes('已选中 4 个元件'), inspTxt.join('|').slice(0, 60));

  // 触屏双击元件 → 弹菜单（触屏语义），组选时给整组复制/删除
  sandbox.document.body.children = sandbox.document.body.children.filter((c) => c.className !== 'blk-ctx');
  const ptA = toScreen(200, 160);
  svgEl().fire('dblclick', mkEvt({ clientX: ptA.x, clientY: ptA.y, pointerType: 'touch' }));
  const gmenu = sandbox.document.body.children.find((c) => c.className === 'blk-ctx');
  const gl = gmenu ? gmenu.children.map((c) => c.textContent).join('|') : '';
  ok('触屏双击元件弹出菜单（非就地编辑）', !!gmenu, gl);
  ok('组选时菜单为整组复制/删除', /复制 4 个元件/.test(gl) && /删除 4 个元件/.test(gl), gl);
  if (gmenu) gmenu.children.find((c) => c.textContent.includes('删除')).fire('click', mkEvt({}));
  ok('整组删除后为 0 元件 0 连线', /0 元件 · 0 连线/.test(counts()), counts());
  ok('清空后出现空状态引导', registry['#blk-empty'].hidden === false, String(registry['#blk-empty'].hidden));
  registry['#blk-undo'].fire('click', mkEvt({}));
  ok('撤销恢复 4 元件且空状态隐藏', /4 元件/.test(counts()) && registry['#blk-empty'].hidden === true, counts());

  // 再框选一行（A、B）→ 触屏双击 → 整组复制
  ev('pointerdown', 60, 60, { pointerType: 'touch', pointerId: 921 });
  runTimers();
  ev('pointermove', 520, 250, { pointerType: 'touch', pointerId: 921 });
  ev('pointerup', 520, 250, { pointerType: 'touch', pointerId: 921 });
  sandbox.document.body.children = sandbox.document.body.children.filter((c) => c.className !== 'blk-ctx');
  svgEl().fire('dblclick', mkEvt({ clientX: ptA.x, clientY: ptA.y, pointerType: 'touch' }));
  const gmenu2 = sandbox.document.body.children.filter((c) => c.className === 'blk-ctx').pop();
  const gl2 = gmenu2 ? gmenu2.children.map((c) => c.textContent).join('|') : '';
  ok('框选 2 个元件后组菜单数量正确', /复制 2 个元件/.test(gl2) && /删除 2 个元件/.test(gl2), gl2);
  if (gmenu2) gmenu2.children.find((c) => c.textContent.includes('复制')).fire('click', mkEvt({}));
  ok('整组复制 2 个元件（4 → 6）', /6 元件/.test(counts()), counts());
  mS.api.dispose();
}

/* ================= 结果输出 ================= */
console.log('\n通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (fails.length) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('✓ 交互逻辑全部通过');
}
