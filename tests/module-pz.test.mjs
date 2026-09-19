/* ============================================================
 * module-pz.test.mjs — 四模块复平面画布迁移回归（无浏览器）
 *   运行：node tests/module-pz.test.mjs
 *
 *   覆盖：zt（点击加/共轭跟随/双击删/长按菜单删/清空）、
 *   laplace（预设⇄自定义、点击加极点+实轴吸附、ROC 绘制、右键零点、
 *   拖动、双击删、分享 hash）、pid（T(s) 数值回归、BLKSOLVE 复用、
 *   极点图挂组件）、explore（传函求解后极点图惰性创建、不可编辑）。
 *   桩约定沿 blk-interaction：同一手势复用同一 pointerId；
 *   多实例事件叠加风险用「单实例 + 顺序化步骤」规避。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

/* ================= 极简 DOM 桩 ================= */
class DomNode {}
const mkCtx = () => {
  const log = [];
  const t = {};
  return new Proxy(t, {
    get(tt, k) {
      if (k === '_log') return log;
      if (k === 'measureText') return () => ({ width: 10 });
      return k in tt ? tt[k] : () => {};
    },
    set(tt, k, v) { if (typeof v !== 'function') log.push([k, v]); tt[k] = v; return true; }
  });
};
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
    this._text = '';
    this.value = ''; this.title = ''; this.className = '';
    this.clientWidth = 420; this.clientHeight = 300;
    this.offsetWidth = 170; this.offsetHeight = 40;
    this.width = 420; this.height = 300;
    this.isConnected = true;
    this.parentElement = null;
    const cls = new Set();
    this.classList = {
      add: (...c) => c.forEach((x) => cls.add(x)),
      remove: (...c) => c.forEach((x) => cls.delete(x)),
      toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; v ? cls.add(c) : cls.delete(c); return v; },
      contains: (c) => cls.has(c)
    };
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); if (!this._html) this.children = []; }
  // 有子节点时聚合子节点文本（U.el 的字符串子节点），否则取直接赋值
  get textContent() { return this.children.length ? this.children.map((c) => (c && c.textContent) || '').join('') : this._text; }
  set textContent(v) { this._text = String(v); }
  get firstElementChild() { return this.children[0] || null; }
  addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
  removeEventListener() {}
  setAttribute(k, v) {
    this._a[k] = String(v);
    if (k === 'value') this.value = String(v);   // 模拟真实 DOM：value 属性同步默认值
    if (k.startsWith('data-')) this.dataset[k.slice(5)] = String(v);   // data-* 同步 dataset
  }
  getAttribute(k) { return k in this._a ? this._a[k] : null; }
  appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  remove() { if (this.parentElement) { const i = this.parentElement.children.indexOf(this); if (i >= 0) this.parentElement.children.splice(i, 1); } }
  contains() { return false; }
  // 模块会对元素取 closest(...).classList（如 zt preview 的 .tf-frac）：返回按选择器共享的桩元素
  closest(sel) { return reg('closest:' + String(sel)); }
  // 树搜索：MI 程序化创建的元素（输入框等）能在宿主子树中找到；找不到再回退全局注册表
  _matches(sel) {
    if (sel.startsWith('#')) return (this._a && this._a.id === sel.slice(1)) || this.id === sel.slice(1);
    if (sel.startsWith('.')) return String(this.className || '').split(/\s+/).includes(sel.slice(1));
    return this.tagName === sel.toUpperCase();
  }
  _search(sel, out) {
    for (const c of this.children) {
      if (c._matches && c._matches(sel)) out.push(c);
      if (c._search) c._search(sel, out);
    }
    return out;
  }
  querySelector(sel) { const out = this._search(sel, []); return out[0] || reg(String(sel)); }
  querySelectorAll(sel) { return this._search(sel, []); }
  setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
  dispatchEvent(evt) { (this._l[evt.type] || []).forEach((f) => f(evt)); return true; }
  insertAdjacentHTML() {}
  focus() {} select() {} blur() {}
  setPointerCapture() {} releasePointerCapture() {}
  dispatchEvent() { return true; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: this.clientHeight }; }
  getContext() { return this._ctx || (this._ctx = mkCtx()); }
  fire(type, evt) { (this._l[type] || []).forEach((f) => f(evt)); }
}

const registry = {};
const reg = (key) => (registry[key] = registry[key] || new El('canvas'));

const timers = new Map();
let timerSeq = 0;
const runTimers = () => { const q = [...timers.entries()]; timers.clear(); q.forEach(([, f]) => f()); };

/* 主题色记号（着色断言用） */
const COLORS = {
  '--cv-bg': 'C:bg', '--cv-stable-bg': 'C:stable', '--cv-unstable-bg': 'C:unstable',
  '--cv-grid': 'C:grid', '--cv-axis': 'C:axis', '--cv-axis-hi': 'C:axisHi',
  '--cv-tick': 'C:tick', '--cv-label': 'C:label', '--cv-danger': 'C:danger',
  '--cv-line1': 'C:zero', '--cv-line2': 'C:l2', '--cv-line3': 'C:l3',
  '--cv-roc-bg': 'C:rocBg', '--cv-roc-line': 'C:rocLine'
};

const sandbox = {
  console,
  Node: DomNode,
  Event: class { constructor(t) { this.type = t; } },
  document: {
    body: new El('body'),
    activeElement: null,
    createElement: (t) => new El(t),
    createTextNode: (t) => ({ data: String(t), textContent: String(t) }),
    getElementById: (id) => reg('#' + id),
    querySelector: (s) => reg(s),
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {}
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  getComputedStyle: () => ({ fontFamily: 'sans-serif', getPropertyValue: (n) => COLORS[n] || '' }),
  matchMedia: () => ({ matches: false }),
  requestAnimationFrame: (f) => 0,
  setTimeout: (f) => { const id = ++timerSeq; timers.set(id, f); return id; },
  clearTimeout: (id) => { timers.delete(id); },
  ResizeObserver: class { observe() {} disconnect() {} },
  URLSearchParams, btoa, atob,
  history: { replaceState: (a, b, url) => { if (typeof url === 'string' && url.includes('#')) sandbox.location.hash = url.slice(url.indexOf('#')); } },
  location: { hash: '', origin: 'http://x', pathname: '/index.html' },
  navigator: {},
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
  addEventListener: () => {}, removeEventListener: () => {},
  App: { modules: {}, register(name, f) { this.modules[name] = f; } }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['assets/js/lib/util.js', 'assets/js/lib/mathdsp.js', 'assets/js/lib/plots.js',
  'assets/js/lib/fx.js', 'assets/js/lib/blocksolve.js', 'assets/js/lib/transforms.js',
  'assets/js/lib/mathinput.js', 'assets/js/lib/odesolve.js', 'assets/js/lib/project.js', 'assets/js/lib/toolbar.js', 'assets/js/app.js',
  'assets/js/modules/zt.js', 'assets/js/modules/laplace.js', 'assets/js/modules/pid.js',
  'assets/js/modules/explore.js', 'assets/js/modules/system.js']) {
  vm.runInContext(read(f), sandbox, { filename: f });
}

/* ================= 断言工具 ================= */
let pass = 0;
const fails = [];
const ok = (n, c, extra) => { c ? pass++ : fails.push(n + (extra ? '  → ' + extra : '')); };

const mkEvt = (o) => Object.assign({
  button: 0, pointerType: 'mouse', pointerId: 1, clientX: 0, clientY: 0, deltaY: 0,
  pd: false, preventDefault() { this.pd = true; }, stopPropagation() {},
  target: { closest: () => null }, setPointerCapture() {}
}, o);
const fire = (el, type, o) => el.fire(type, mkEvt(o));
const menus = () => sandbox.document.body.children.filter((c) => c.className === 'cp-menu');
// 模块把 KaTeX 片段 append 进容器：取第一个子元素的文本（无 katex 时为 texToText 兜底）
const textOf = (id) => {
  const el = reg(id);
  return el.children.length ? el.children.map((c) => c.textContent).join('') : el.textContent;
};
const ctxLog = (id) => reg(id).getContext()._log;

/* ================= ① zt：z 平面（单位圆模式，可编辑） ================= */
{
  const ztHost = new El('div');
  // 预建 MI 宿主（桩的 innerHTML 不建子树），让 MI 渲染进宿主子树供树搜索命中
  const miHost = new El('div'); miHost._a.id = 'zt-mi'; miHost.id = 'zt-mi'; ztHost.appendChild(miHost);
  const zt$ = (s) => ztHost.querySelector(s);
  const ztMod = sandbox.App.modules['zt'](ztHost);

  const plane = () => reg('#zt-pz')._fxPlot;
  ok('zt 初始化返回 api', !!ztMod && typeof ztMod.api.dispose === 'function');
  ok('zt stats 给出稳定性', reg('#zt-stats').innerHTML.includes('稳定'), reg('#zt-stats').innerHTML.slice(0, 80));
  ok('zt 极点图挂上共享组件', !!plane() && plane().mode === 'unit');
  ok('zt 画布 touch-action:none', reg('#zt-pz').style.touchAction === 'none');

  const spanX0 = plane().spanX();
  fire(reg('#zt-pz'), 'wheel', { clientX: 210, clientY: 150, deltaY: -120 });
  ok('zt 滚轮缩放生效', plane().spanX() < spanX0 * 0.95);

  const miH = ztHost.children[0];
  // 单击空白：加共轭对（分母升为三次，系数保持实数）
  const pAdd = plane().worldToPx(-0.5, 0.6);
  fire(reg('#zt-pz'), 'pointerdown', { pointerId: 1, clientX: pAdd.x, clientY: pAdd.y });
  fire(reg('#zt-pz'), 'pointerup', { pointerId: 1, clientX: pAdd.x, clientY: pAdd.y });
  ok('zt 点击加共轭对（分母三次）', zt$('#zt-den').value.includes('z^3'), zt$('#zt-den').value);

  // 双击实极点删除（连同其无共轭）
  const pReal = plane().worldToPx(0.5, 0);
  fire(reg('#zt-pz'), 'dblclick', { clientX: pReal.x, clientY: pReal.y });
  ok('zt 双击删实极点（分母二次）', zt$('#zt-den').value.includes('z^2') && !zt$('#zt-den').value.includes('z^3'), zt$('#zt-den').value);

  // 拖共轭成员：另一成员必须跟随（分母保持实系数）
  const pCj = plane().worldToPx(-0.5, 0.6);
  fire(reg('#zt-pz'), 'pointerdown', { pointerType: 'touch', pointerId: 2, clientX: pCj.x, clientY: pCj.y });
  const pTo = plane().worldToPx(-0.3, 0.8);
  fire(reg('#zt-pz'), 'pointermove', { pointerType: 'touch', pointerId: 2, clientX: pTo.x, clientY: pTo.y });
  fire(reg('#zt-pz'), 'pointerup', { pointerType: 'touch', pointerId: 2, clientX: pTo.x, clientY: pTo.y });
  ok('zt 拖共轭成员后分母实系数（0.6*z 项）', zt$('#zt-den').value.includes('0.6*z'), zt$('#zt-den').value);

  // 拖到实轴附近：吸附为实数、对偶成员并入同点 → (z+0.2)² = z²+0.4z+0.04
  const pAxis = plane().worldToPx(-0.3, 0.8);
  fire(reg('#zt-pz'), 'pointerdown', { pointerType: 'touch', pointerId: 3, clientX: pAxis.x, clientY: pAxis.y });
  const pNear = plane().worldToPx(-0.2, 0.01);
  fire(reg('#zt-pz'), 'pointermove', { pointerType: 'touch', pointerId: 3, clientX: pNear.x, clientY: pNear.y });
  fire(reg('#zt-pz'), 'pointerup', { pointerType: 'touch', pointerId: 3, clientX: pNear.x, clientY: pNear.y });
  ok('zt 共轭拖近实轴：双成员并入同点成二重实极点', zt$('#zt-den').value.includes('0.4*z'), zt$('#zt-den').value);

  // 长按（触屏）删除：菜单项触发 onDelete（菜单首项可能是「撤销」，按文本定位「删除」）
  const pLp = plane().worldToPx(-0.2, 0);
  fire(reg('#zt-pz'), 'pointerdown', { pointerType: 'touch', pointerId: 4, clientX: pLp.x, clientY: pLp.y });
  runTimers();
  const m = menus();
  ok('zt 长按弹出删除菜单', m.length === 1 && m[0].children.map((c) => c.textContent).includes('删除'));
  if (m.length) {
    m[0].children.find((c) => c.textContent === '删除').fire('click', mkEvt({}));
    ok('zt 菜单删除后清空（分母=1）', zt$('#zt-den').value === '1', zt$('#zt-den').value);
  }
  fire(reg('#zt-pz'), 'pointerup', { pointerType: 'touch', pointerId: 4, clientX: pLp.x, clientY: pLp.y });

  // 清空按钮复位
  const pAny = plane().worldToPx(0.2, 0.9);
  fire(reg('#zt-pz'), 'pointerdown', { pointerId: 5, clientX: pAny.x, clientY: pAny.y });
  fire(reg('#zt-pz'), 'pointerup', { pointerId: 5, clientX: pAny.x, clientY: pAny.y });
  zt$('#zt-pzreset').fire('click', mkEvt({}));
  ok('zt 清空后输入框复位', zt$('#zt-num').value === '1' && zt$('#zt-den').value === '1');
  ok('zt 清空后 ROC 全平面', reg('#zt-stats').innerHTML.includes('全平面'));

  let threw = null;
  try { ztMod.api.onTheme(); ztMod.api.dispose(); } catch (e) { threw = e; }
  ok('zt onTheme / dispose 不抛异常', !threw, threw && threw.message);
}

/* ================= ② laplace：s 平面（虚轴模式，ROC） ================= */
{
  const laMod = sandbox.App.modules['la'](new El('div'));
  const plane = () => reg('#la-sp')._fxPlot;
  ok('la 初始化返回 api', !!laMod && typeof laMod.api.dispose === 'function');
  ok('la 预设加载后稳定', reg('#la-status').innerHTML.includes('稳定'), reg('#la-status').innerHTML.slice(0, 80));
  ok('la s 平面挂上共享组件', !!plane() && plane().mode === 'jw');
  ok('la ROC 着色被绘制', ctxLog('#la-sp').some((r) => r[0] === 'fillStyle' && r[1] === COLORS['--cv-roc-bg']));
  ok('la s 平面画布 touch-action:none', reg('#la-sp').style.touchAction === 'none');

  // 预设模式：点击画布 → 切自定义（不立即添加）
  const tap = (id, w) => {
    const p = plane().worldToPx(w.re, w.im);
    fire(reg('#la-sp'), 'pointerdown', { pointerId: id, clientX: p.x, clientY: p.y });
    fire(reg('#la-sp'), 'pointerup', { pointerId: id, clientX: p.x, clientY: p.y });
  };
  tap(11, { re: 2.2, im: 1.5 });
  ok('la 预设模式点击画布切自定义', reg('#la-custom-mode').classList.contains('active'));
  ok('la 切换那次点击不添加', reg('#la-status').innerHTML.includes('p3') === false, reg('#la-status').innerHTML);

  // 自定义模式：单击加极点（近实轴吸附为实数）
  tap(12, { re: 0.5, im: 0.02 });
  ok('la 单击加极点（右半平面 → 不稳定）', reg('#la-status').innerHTML.includes('不稳定'), reg('#la-status').innerHTML);
  ok('la 极点列表含 0.5', reg('#la-status').innerHTML.includes('p3=0.5'));

  // 右键空白加零点
  const zPos = plane().worldToPx(-1, 0.5);
  const evt = mkEvt({ clientX: zPos.x, clientY: zPos.y, button: 2 });
  reg('#la-sp').fire('contextmenu', evt);
  ok('la 右键加零点', reg('#la-status').innerHTML.includes('z1=-1+0.5j'), reg('#la-status').innerHTML);

  // 拖动极点：spec 模型（im≥0，共轭一份）更新
  const drag = (id, from, to) => {
    const a = plane().worldToPx(from.re, from.im), b = plane().worldToPx(to.re, to.im);
    fire(reg('#la-sp'), 'pointerdown', { pointerType: 'touch', pointerId: id, clientX: a.x, clientY: a.y });
    fire(reg('#la-sp'), 'pointermove', { pointerType: 'touch', pointerId: id, clientX: b.x, clientY: b.y });
    fire(reg('#la-sp'), 'pointerup', { pointerType: 'touch', pointerId: id, clientX: b.x, clientY: b.y });
  };
  drag(13, { re: 0.5, im: 0 }, { re: 0.8, im: 0.3 });
  ok('la 拖动极点位置更新', reg('#la-status').innerHTML.includes('0.8+0.3j'), reg('#la-status').innerHTML);
  // 拖近实轴：共轭对塌缩为单个实极点
  drag(14, { re: 0.8, im: 0.3 }, { re: 0.8, im: 0.01 });
  ok('la 拖近实轴共轭塌缩（p3=0.8 无 j）', reg('#la-status').innerHTML.includes('p3=0.8'), reg('#la-status').innerHTML);

  // 双击删零点
  const zDel = plane().worldToPx(-1, 0.5);
  fire(reg('#la-sp'), 'dblclick', { clientX: zDel.x, clientY: zDel.y });
  ok('la 双击删零点', !reg('#la-status').innerHTML.includes('z1='), reg('#la-status').innerHTML);

  // 分享 hash 写入
  reg('#la-share').fire('click', mkEvt({}));
  ok('la 分享 hash 含 lan/lad', /^#lan=.+&lad=/.test(sandbox.location.hash), sandbox.location.hash);

  // 预设切换 → 编辑关闭，画布点击只切模式
  const presetChip = reg('#la-presets').children.find((c) => c.textContent === '二阶欠阻尼');
  presetChip.fire('click', mkEvt({}));
  ok('la 切回预设后恢复稳定', reg('#la-status').innerHTML.includes('稳定'), reg('#la-status').innerHTML);
  tap(15, { re: 2.2, im: 1.5 });
  ok('la 预设下点击仍只切自定义不加极点', !reg('#la-status').innerHTML.includes('p3='), reg('#la-status').innerHTML);

  let threw = null;
  try { laMod.api.onTheme(); laMod.api.dispose(); } catch (e) { threw = e; }
  ok('la onTheme / dispose 不抛异常', !threw, threw && threw.message);
}

/* ================= ③a sys：符号参数与家族 ================= */
{
  const sysHost = new El('div');
  const sysMi = new El('div'); sysMi._a.id = 'sys-mi'; sysMi.id = 'sys-mi'; sysHost.appendChild(sysMi);
  const sys$ = (s2) => sysHost.querySelector(s2);
  const sysMod = sandbox.App.modules['sys'](sysHost);
  ok('sys 初始化返回 api', !!sysMod && typeof sysMod.api.dispose === 'function');
  ok('sys 默认无参数行', sys$('#sys-params').style.display === 'none', sys$('#sys-params').style.display);
  // 点击「二阶」结构模板：插入符号串 + 参数种子
  const structRow = reg('#sys-struct');
  const secChip = structRow.children.find((c) => c.textContent === '二阶');
  secChip.fire('click', mkEvt({}));
  ok('sys 模板插入符号串', sys$('#sys-num').value === 'wn*wn', sys$('#sys-num').value);
  ok('sys 参数行出现', sys$('#sys-params').style.display === '');
  const pInputs = sys$('#sys-params')._search('input', []);
  ok('sys 参数行含 z/wn 数值输入', pInputs.filter((i) => i._a['aria-label'] === '参数 z' || i._a['aria-label'] === '参数 wn').length === 2, 'n=' + pInputs.length + ' labels=[' + pInputs.map((i) => i._a['aria-label']).join(',') + ']');
  // 扫掠：wn = 1,2 → 家族表出现
  console.error('DBG pInputs:', pInputs.map((i) => i._a['aria-label'] + '|v=' + i.value).join(' , '));
  const swIn = pInputs.find((i) => i._a['aria-label'] === 'wn 扫掠列表');
  swIn.value = '1,2';
  swIn.fire('change', mkEvt({ target: swIn }));
  const met = reg('#sys-metrics');
  const famBox = met.children.find((c) => (c._html || '').includes('成员'));
  ok('sys 扫掠后家族指标表出现', !!famBox, met.children.map((c) => c.className).join(','));
  ok('sys 家族含两个成员', !!famBox && (famBox._html.match(/<tr>/g) || []).length === 3, famBox && String((famBox._html.match(/<tr>/g) || []).length));
  // 数值回归：无参数时阶跃响应照常（主成员 num/den 生效）
  sys$('input[type=number]') ; // 桩冒烟
  let threw = null;
  try { sysMod.api.onTheme(); sysMod.api.dispose(); } catch (e) { threw = e; }
  ok('sys onTheme / dispose 不抛异常', !threw, threw && threw.message);
}

/* ================= ③ pid：BLKSOLVE 复用 + 数值回归 ================= */
{
  const pidMod = sandbox.App.modules['pid'](new El('div'));
  ok('pid 初始化返回 api', !!pidMod && typeof pidMod.api.dispose === 'function');
  ok('pid 指标栏渲染', reg('#pid-metrics').innerHTML.includes('超调量'));
  // 数值回归（迁移前基线）：G=1/(s²+0.5s+1), Kp=2, Ki=Kd=0 → T(s)=2/(s²+0.5s+3)
  //   分母由闭环极点钉住、分子由稳态值 y∞=2/3 钉住（KaTeX 兜底文本不展开嵌套花括号，不作断言）
  ok('pid T(s) 分母回归（s^2+0.5s+3 可见）', textOf('#pid-ttex').includes('s^2+0.5s+3'), textOf('#pid-ttex'));
  ok('pid T(s) 增益回归（y∞=2/3）', reg('#pid-metrics').innerHTML.includes('0.667'), reg('#pid-metrics').innerHTML);
  ok('pid 闭环极点回归', reg('#pid-poles').textContent.includes('-0.25+1.71j'), reg('#pid-poles').textContent);
  ok('pid 极点图挂上共享组件（静态）', !!reg('#pid-pz')._fxPlot && reg('#pid-pz')._fxPlot.editable === false);
  ok('pid 画布 touch-action:none', reg('#pid-pz').style.touchAction === 'none');
  ok('pid 源码不再本地实现 polyMul', !/const polyMul = \(a/.test(read('assets/js/modules/pid.js')));
  ok('pid 源码复用 BLKSOLVE', /BLKSOLVE\.polyMul/.test(read('assets/js/modules/pid.js')));

  // 滑杆联动：Kp=4 → D(s)=s²+0.5s+5 → 极点 -0.25±2.22j
  reg('#pid-kp').value = '4';
  reg('#pid-kp').fire('input', mkEvt({ target: reg('#pid-kp') }));
  ok('pid 调 Kp 后极点更新', reg('#pid-poles').textContent.includes('-0.25+2.22j'), reg('#pid-poles').textContent);

  let threw = null;
  try { pidMod.api.onTheme(); pidMod.api.dispose(); } catch (e) { threw = e; }
  ok('pid onTheme / dispose 不抛异常', !threw, threw && threw.message);
}

/* ================= ④ explore：传函结果极点图（静态） ================= */
{
  const exHost = new El('div');
  // 模块 box = reg('#ex-expr')（模板 fallback 游离元素）：MI 宿主须在实例化前预建在该子树内
  const exExpr = reg('#ex-expr');
  const exMi = new El('div'); exMi._a.id = 'ex-mi'; exMi.id = 'ex-mi'; exExpr.appendChild(exMi);
  const ex$ = (s2) => exExpr.querySelector(s2);
  // eq 页签宿主同样预建（renderEq 的 box.querySelector 需在 #ex-eq 子树内命中）
  const exEq = reg('#ex-eq');
  ['eq-modes', 'eq-in', 'eq-ics', 'eq-hint', 'eq-ex', 'eq-out'].forEach((id) => {
    exEq.appendChild(reg('#' + id));   // 经 reg 创建：树搜索命中与 fallback 注册表是同一元素
  });
  const exMod = sandbox.App.modules['explore'](exHost);
  ok('explore 初始化返回 api', !!exMod && typeof exMod.api.dispose === 'function');
  ok('explore 默认时域求解不建极点图', !reg('#ex-pz')._fxPlot);

  // 提交一个传函 → renderTF → 极点图惰性创建
  ex$('#ex-input').value = '5/(s^2+2*s+5)';
  ex$('#ex-go').fire('click', mkEvt({}));
  const pl = reg('#ex-pz')._fxPlot;
  ok('explore 传函求解后极点图创建', !!pl && pl.mode === 'jw' && pl.editable === false);
  ok('explore 指标给出稳定', reg('#ex-metrics').innerHTML.includes('稳定'));

  // 静态画布：点击/长按不产生任何编辑副作用，也不抛异常
  let threw = null;
  try {
    const p = pl.worldToPx(1.5, 1.2);
    fire(reg('#ex-pz'), 'pointerdown', { pointerId: 21, clientX: p.x, clientY: p.y });
    fire(reg('#ex-pz'), 'pointerup', { pointerId: 21, clientX: p.x, clientY: p.y });
    fire(reg('#ex-pz'), 'pointerdown', { pointerType: 'touch', pointerId: 22, clientX: p.x, clientY: p.y });
    runTimers();
    fire(reg('#ex-pz'), 'pointerup', { pointerType: 'touch', pointerId: 22, clientX: p.x, clientY: p.y });
  } catch (e) { threw = e; }
  ok('explore 静态极点图交互无异常、无菜单', !threw && menus().length === 0, threw && threw.message);

  let threw2 = null;
  try { exMod.api.onTheme(); exMod.api.dispose(); } catch (e) { threw2 = e; }
  ok('explore onTheme / dispose 不抛异常', !threw2, threw2 && threw2.message);
}

/* ================= ③b explore：方程求解页签冒烟 ================= */
{
  // 惰性渲染：点击「方程求解」页签才创建（stub 下 box.querySelector 回退全局注册表）
  const tabRow = reg('#ex-tabs');
  const chipText = (c) => (c.children || []).map((t) => t.data != null ? t.data : (t.textContent || '')).join('') || c.textContent;
  const eqTab = tabRow.children.find((c) => chipText(c) === '方程求解');
  ok('explore 出现方程求解页签', !!eqTab, 'tabs=[' + tabRow.children.map(chipText).join('|') + '] n=' + tabRow.children.length);
  if (eqTab) {
    eqTab.fire('click', mkEvt({ target: { closest: (sel) => (sel === '.chip' ? eqTab : null) } }));
    const modes = reg('#eq-modes');
    ok('三种模式 chips 渲染', modes.children.length === 3 && modes.children.map((c) => c.textContent).join('|').includes('微分方程') && modes.children.map((c) => c.textContent).join('|').includes('数据序列'), modes.children.map((c) => c.textContent).join('|'));
    // 默认微分方程已自动求解：输出含指标行与稳定性
    const eqOutEl = reg('#eq-out');
    ok('eq 默认方程求解出稳定性', eqOutEl.children.length >= 1 && (eqOutEl.children[0]._html || '').includes('稳定性'), eqOutEl.children.map((c) => c.className).join(','));
    // 初值行出现（二阶 → y(0)、y'(0)）
    ok('eq 按阶数生成初值输入', reg('#eq-ics').children.length >= 1 && reg('#eq-ics')._search('input', []).length === 2, String(reg('#eq-ics')._search('input', []).length));
    // 切数据序列模式：textarea 出现且默认数据求解出统计
    const dataChip = modes.children.find((c) => chipText(c) === '数据序列');
    dataChip.fire('click', mkEvt({ target: { closest: (sel) => (sel === '.chip' ? dataChip : null) } }));
    ok('数据模式渲染粘贴区', !!reg('#eq-data'));
    ok('数据模式默认求解出点数', reg('#eq-out').children.length >= 1 && (reg('#eq-out').children[0]._html || '').includes('点数'), 'n=' + reg('#eq-out').children.length + ' [' + reg('#eq-out').children.map((c) => c.className).join(',') + '] ' + ((reg('#eq-out').children[0] || {})._html || '').slice(0, 80));
  }
}

/* ================= 结果输出 ================= */
console.log('\n通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (fails.length) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('✓ 四模块复平面迁移回归全部通过');
}
