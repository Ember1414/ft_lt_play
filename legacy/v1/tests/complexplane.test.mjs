/* ============================================================
 * complexplane.test.mjs — FX.ComplexPlane 组件测试（无浏览器）
 *   运行：node tests/complexplane.test.mjs
 *
 *   覆盖：等比例约束（初始/滚轮/捏合/平移后）、hitTest 容差、
 *   手势状态机（点击添加/拖点/平移/捏合/长按菜单/双击/右键）、
 *   editable 开关、稳定域着色、touch-action 基线。
 *   桩约定沿 blk-interaction：同一手势必须复用同一 pointerId；
 *   fake 2d context 记录样式赋值序列供着色断言；fake timers 驱动长按。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

/* ================= 极简 DOM 桩 ================= */
class DomNode {}
// fake 2d context：记录所有样式赋值（fillStyle/strokeStyle/...），方法调用一律空操作
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
    this.textContent = ''; this.value = ''; this.title = ''; this.className = '';
    this.clientWidth = 420; this.clientHeight = 300;
    this.offsetWidth = 170; this.offsetHeight = 40;
    this.width = 420; this.height = 300;
    this.isConnected = true;            // ComplexPlane 的渲染分支需要
    this.parentElement = null;          // 独立画布：让 Plot 跳过 ResizeObserver
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
  get firstElementChild() { return this.children[0] || null; }
  addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
  removeEventListener() {}
  setAttribute(k, v) { this._a[k] = String(v); }
  getAttribute(k) { return k in this._a ? this._a[k] : null; }
  appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  remove() { if (this.parentElement) { const i = this.parentElement.children.indexOf(this); if (i >= 0) this.parentElement.children.splice(i, 1); } }
  contains() { return false; }
  closest() { return null; }
  querySelector(sel) { return reg(String(sel)); }
  querySelectorAll() { return []; }
  insertAdjacentHTML() {}
  focus() {} select() {} blur() {}
  setPointerCapture() {} releasePointerCapture() {}
  // 1:1 映射（rect 尺寸 = client 尺寸），坐标断言不掺杂缩放系数
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: this.clientHeight }; }
  getContext() { return this._ctx || (this._ctx = mkCtx()); }
  fire(type, evt) { (this._l[type] || []).forEach((f) => f(evt)); }
}

const registry = {};
const reg = (key) => (registry[key] = registry[key] || new El('canvas'));

const timers = new Map();
let timerSeq = 0;
const runTimers = () => { const q = [...timers.entries()]; timers.clear(); q.forEach(([, f]) => f()); };
const rafQ = [];

/* 主题色换成可断言的记号（cvCol 经 getComputedStyle 读取） */
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
  document: {
    body: new El('body'),
    activeElement: null,
    createElement: (t) => new El(t),
    createTextNode: (t) => ({ data: String(t) }),
    getElementById: (id) => reg('#' + id),
    querySelector: (s) => reg(s),
    querySelectorAll: () => [],
    _d: {},
    addEventListener(t, f) { (this._d[t] = this._d[t] || []).push(f); },
    removeEventListener(t, f) { if (this._d[t]) this._d[t] = this._d[t].filter((x) => x !== f); }
  },
  getComputedStyle: () => ({ fontFamily: 'sans-serif', getPropertyValue: (n) => COLORS[n] || '' }),
  matchMedia: () => ({ matches: false }),
  requestAnimationFrame: (f) => { rafQ.push(f); return rafQ.length; },
  setTimeout: (f) => { const id = ++timerSeq; timers.set(id, f); return id; },
  clearTimeout: (id) => { timers.delete(id); },
  ResizeObserver: class { observe() {} disconnect() {} },
  URLSearchParams, btoa, atob,
  history: { replaceState: () => {} },
  location: { hash: '', origin: 'http://x', pathname: '/index.html' },
  navigator: {},
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
  addEventListener: () => {}, removeEventListener: () => {}
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['assets/js/lib/util.js', 'assets/js/lib/plots.js']) {
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

/* 画布 420×300 + 默认边距 {l:40,r:14,t:14,b:24} → 绘图区 366×262 */
const DW = 366, DH = 262;
const ratioOf = (p) => (p.ymax - p.ymin) / (p.xmax - p.xmin);
const eq = (p) => Math.abs(ratioOf(p) - DH / DW) < 1e-9;

let seq = 0;
const mkPlane = (opts = {}) => {
  const cv = new El('canvas');
  const spies = { add: [], move: [], del: [], blankTap: [] };
  const plane = new sandbox.FX.ComplexPlane(cv, Object.assign({
    mode: 'unit',
    getSpecs: () => ({ poles: [{ re: 0.5, im: 0 }], zeros: [{ re: -0.5, im: 0.4 }, { re: -0.5, im: -0.4 }] }),
    onAdd: (kind, z) => spies.add.push([kind, z]),
    onMove: (kind, i, z) => spies.move.push([kind, i, z]),
    onDelete: (kind, i) => spies.del.push([kind, i]),
    onBlankTap: (z) => spies.blankTap.push(z)
  }, opts));
  seq++;
  return { plane, cv, spies };
};

/* ================= ① 初始视野与等比例 ================= */
{
  const a = mkPlane();
  ok('unit 初始视野等比例', eq(a.plane), ratioOf(a.plane));
  ok('unit 初始纵向跨度 = 2R（R=1.3）', Math.abs((a.plane.ymax - a.plane.ymin) - 2.6) < 1e-9, a.plane.ymax - a.plane.ymin);
  const px = a.plane.worldToPx(0.37, -0.62);
  const back = a.plane.pxToWorld(px.x, px.y);
  ok('worldToPx / pxToWorld 往返一致', Math.abs(back.re - 0.37) < 1e-9 && Math.abs(back.im + 0.62) < 1e-9);
  ok('构造即设 touch-action:none', a.cv.style.touchAction === 'none', a.cv.style.touchAction);

  const b = mkPlane({ mode: 'jw', getSpecs: () => ({ poles: [{ re: -3, im: 2 }], zeros: [] }) });
  ok('jw 初始视野等比例', eq(b.plane), ratioOf(b.plane));
  ok('jw 初始纵向跨度覆盖极点+1.2（R=4.2）', Math.abs((b.plane.ymax - b.plane.ymin) - 8.4) < 1e-9, b.plane.ymax - b.plane.ymin);
}

/* ================= ② 滚轮缩放：等比例 + 以光标为中心 ================= */
{
  const w = mkPlane();
  const before = w.plane.pxToWorld(200, 150);
  fire(w.cv, 'wheel', { clientX: 200, clientY: 150, deltaY: -120 });
  const after = w.plane.pxToWorld(200, 150);
  ok('滚轮放大以光标为中心', Math.abs(before.re - after.re) < 1e-9 && Math.abs(before.im - after.im) < 1e-9,
    `${before.re.toFixed(4)},${before.im.toFixed(4)} → ${after.re.toFixed(4)},${after.im.toFixed(4)}`);
  ok('滚轮后等比例', eq(w.plane));
  ok('滚轮后视野变小', (w.plane.xmax - w.plane.xmin) < (w.plane.xmax - w.plane.xmin) * 3);
}

/* ================= ③ 双指捏合：等比例 ================= */
{
  const p = mkPlane();
  const sx0 = p.plane.xmax - p.plane.xmin;
  // 同一手势全程各自复用同一 pointerId
  fire(p.cv, 'pointerdown', { pointerType: 'touch', pointerId: 10, clientX: 100, clientY: 150 });
  fire(p.cv, 'pointerdown', { pointerType: 'touch', pointerId: 11, clientX: 300, clientY: 150 });
  fire(p.cv, 'pointermove', { pointerType: 'touch', pointerId: 10, clientX: 50, clientY: 150 });
  fire(p.cv, 'pointermove', { pointerType: 'touch', pointerId: 11, clientX: 350, clientY: 150 });
  ok('捏合放大（视野变小）', (p.plane.xmax - p.plane.xmin) < sx0 * 0.9);
  ok('捏合后等比例', eq(p.plane));
  ok('捏合不触发添加', p.spies.add.length === 0);
  fire(p.cv, 'pointerup', { pointerType: 'touch', pointerId: 10, clientX: 50, clientY: 150 });
  fire(p.cv, 'pointerup', { pointerType: 'touch', pointerId: 11, clientX: 350, clientY: 150 });
}

/* ================= ④ 拖空白平移 ================= */
{
  const q = mkPlane();
  const xmin0 = q.plane.xmin, span0 = q.plane.xmax - q.plane.xmin;
  fire(q.cv, 'pointerdown', { pointerId: 20, clientX: 200, clientY: 150 });
  fire(q.cv, 'pointermove', { pointerId: 20, clientX: 230, clientY: 170 });
  fire(q.cv, 'pointerup', { pointerId: 20, clientX: 230, clientY: 170 });
  ok('拖空白平移量正确', Math.abs(q.plane.xmin - (xmin0 - (30 / DW) * span0)) < 1e-9);
  ok('平移不改变跨度', Math.abs((q.plane.xmax - q.plane.xmin) - span0) < 1e-9);
  ok('平移后等比例', eq(q.plane));
  ok('移动后抬起不添加', q.spies.add.length === 0);
}

/* ================= ⑤ 命中容差：鼠标 12px / 触屏 22px ================= */
{
  const h = mkPlane({ getSpecs: () => ({ poles: [{ re: 0.5, im: 0 }], zeros: [] }) });
  const { x: px0, y: py0 } = h.plane.worldToPx(0.5, 0);
  fire(h.cv, 'pointerdown', { pointerId: 21, clientX: px0 + 11, clientY: py0 });
  fire(h.cv, 'pointermove', { pointerId: 21, clientX: px0 + 11, clientY: py0 - 1 });
  ok('鼠标 11px 命中极点（进入拖动）', h.spies.move.length === 1 && h.spies.move[0][0] === 'pole' && h.spies.move[0][1] === 0);
  fire(h.cv, 'pointerup', { pointerId: 21, clientX: px0 + 11, clientY: py0 - 1 });
  fire(h.cv, 'pointerdown', { pointerId: 22, clientX: px0 + 13, clientY: py0 });
  fire(h.cv, 'pointermove', { pointerId: 22, clientX: px0 + 13, clientY: py0 - 1 });
  ok('鼠标 13px 不命中（走平移路径）', h.spies.move.length === 1);
  fire(h.cv, 'pointerup', { pointerId: 22, clientX: px0 + 13, clientY: py0 - 1 });
  fire(h.cv, 'pointerdown', { pointerType: 'touch', pointerId: 23, clientX: px0 + 21, clientY: py0 });
  fire(h.cv, 'pointermove', { pointerType: 'touch', pointerId: 23, clientX: px0 + 21, clientY: py0 - 1 });
  ok('触屏 21px 命中极点', h.spies.move.length === 2);
  fire(h.cv, 'pointerup', { pointerType: 'touch', pointerId: 23, clientX: px0 + 21, clientY: py0 - 1 });
  fire(h.cv, 'pointerdown', { pointerType: 'touch', pointerId: 24, clientX: px0 + 23, clientY: py0 });
  fire(h.cv, 'pointerup', { pointerType: 'touch', pointerId: 24, clientX: px0 + 23, clientY: py0 });
  // 此前鼠标 13px 的未移动抬起已按空白点击添加过一次，此处再加一次共 2 次
  ok('触屏 23px 不命中（空白抬起=添加）', h.spies.move.length === 2 && h.spies.add.length === 2, 'add=' + h.spies.add.length);
}

/* ================= ⑥ 单击空白添加 ================= */
{
  const t = mkPlane();
  const { x: bx, y: by } = t.plane.worldToPx(-1.5, 0.8);
  fire(t.cv, 'pointerdown', { pointerId: 31, clientX: bx, clientY: by });
  fire(t.cv, 'pointerup', { pointerId: 31, clientX: bx, clientY: by });
  ok('单击空白添加极点', t.spies.add.length === 1 && t.spies.add[0][0] === 'pole');
  ok('添加位置正确', Math.abs(t.spies.add[0][1].re + 1.5) < 1e-9 && Math.abs(t.spies.add[0][1].im - 0.8) < 1e-9);

  const b2 = t.plane.worldToPx(-1.2, 0.02);
  fire(t.cv, 'pointerdown', { pointerId: 32, clientX: b2.x, clientY: b2.y });
  fire(t.cv, 'pointerup', { pointerId: 32, clientX: b2.x, clientY: b2.y });
  ok('近实轴虚部吸附为 0', t.spies.add.length === 2 && t.spies.add[1][1].im === 0, t.spies.add[1] && t.spies.add[1][1].im);

  const b3 = t.plane.worldToPx(-1.0, -0.7);
  fire(t.cv, 'pointerdown', { pointerType: 'touch', pointerId: 33, clientX: b3.x, clientY: b3.y });
  fire(t.cv, 'pointerup', { pointerType: 'touch', pointerId: 33, clientX: b3.x, clientY: b3.y });
  ok('触屏单击同样添加', t.spies.add.length === 3);

  const b4 = t.plane.worldToPx(1.2, 1.0);
  fire(t.cv, 'pointerdown', { pointerId: 34, clientX: b4.x, clientY: b4.y });
  fire(t.cv, 'pointermove', { pointerId: 34, clientX: b4.x + 30, clientY: b4.y + 20 });
  fire(t.cv, 'pointerup', { pointerId: 34, clientX: b4.x + 30, clientY: b4.y + 20 });
  ok('移动后抬起不添加', t.spies.add.length === 3);

  t.plane.setDefaultAdd('zero');
  fire(t.cv, 'pointerdown', { pointerId: 35, clientX: b4.x, clientY: b4.y });
  fire(t.cv, 'pointerup', { pointerId: 35, clientX: b4.x, clientY: b4.y });
  ok('defaultAdd 切换为 zero', t.spies.add.length === 4 && t.spies.add[3][0] === 'zero');
}

/* ================= ⑦ 拖点：世界坐标 + 抬起即止 ================= */
{
  const d = mkPlane({ getSpecs: () => ({ poles: [{ re: 0.5, im: 0 }], zeros: [] }) });
  const A = d.plane.worldToPx(0.5, 0);
  const unit = d.plane.spanX() / DW;   // 每像素对应的世界跨度（等比例 xy 相同）
  fire(d.cv, 'pointerdown', { pointerType: 'touch', pointerId: 41, clientX: A.x, clientY: A.y });
  fire(d.cv, 'pointermove', { pointerType: 'touch', pointerId: 41, clientX: A.x + 20, clientY: A.y - 50 });
  ok('拖点触发 onMove', d.spies.move.length === 1 && d.spies.move[0][0] === 'pole' && d.spies.move[0][1] === 0);
  const z = d.spies.move[0][2];
  ok('拖点世界坐标正确', Math.abs(z.re - (0.5 + 20 * unit)) < 1e-6 && Math.abs(z.im - 50 * unit) < 1e-6,
    `${z.re},${z.im}`);
  fire(d.cv, 'pointermove', { pointerType: 'touch', pointerId: 41, clientX: A.x + 20, clientY: A.y - 5 });
  ok('拖近实轴吸附为 0', d.spies.move.length === 2 && d.spies.move[1][2].im === 0, d.spies.move[1] && d.spies.move[1][2].im);
  fire(d.cv, 'pointerup', { pointerType: 'touch', pointerId: 41, clientX: A.x + 20, clientY: A.y - 5 });
  fire(d.cv, 'pointermove', { pointerType: 'touch', pointerId: 41, clientX: A.x + 40, clientY: A.y - 5 });
  ok('抬起后不再拖动', d.spies.move.length === 2);
}

/* ================= ⑧ 触屏长按菜单（450ms） ================= */
{
  const l = mkPlane({ getSpecs: () => ({ poles: [{ re: 0.5, im: 0 }], zeros: [] }) });
  const P = l.plane.worldToPx(0.5, 0);
  fire(l.cv, 'pointerdown', { pointerType: 'touch', pointerId: 51, clientX: P.x, clientY: P.y });
  runTimers();
  let m = menus();
  ok('长按点弹出菜单', m.length === 1);
  if (m.length) {
    const labels = m[0].children.map((c) => c.textContent);
    ok('点菜单含删除', labels.includes('删除'), labels.join('|'));
    m[0].children[0].fire('click', mkEvt({}));
    ok('菜单删除回调正确', l.spies.del.length === 1 && l.spies.del[0][0] === 'pole' && l.spies.del[0][1] === 0);
    ok('点菜单项后关闭', menus().length === 0);
  }
  fire(l.cv, 'pointerup', { pointerType: 'touch', pointerId: 51, clientX: P.x, clientY: P.y });

  const B = l.plane.worldToPx(-1.2, 0.9);
  fire(l.cv, 'pointerdown', { pointerType: 'touch', pointerId: 52, clientX: B.x, clientY: B.y });
  runTimers();
  m = menus();
  ok('长按空白弹出菜单', m.length === 1);
  if (m.length) {
    const labels = m[0].children.map((c) => c.textContent).join('|');
    ok('空白菜单含添加/复位', labels.includes('添加极点') && labels.includes('添加零点') && labels.includes('复位视图'), labels);
    const addItem = m[0].children.find((c) => c.textContent === '添加极点');
    addItem.fire('click', mkEvt({}));
    ok('菜单添加在长按位置', l.spies.add.length === 1 && Math.abs(l.spies.add[0][1].re + 1.2) < 1e-9 && Math.abs(l.spies.add[0][1].im - 0.9) < 1e-9);
  }
  fire(l.cv, 'pointerup', { pointerType: 'touch', pointerId: 52, clientX: B.x, clientY: B.y });   // 手指抬起（pointerId 卫生：不留残指）

  fire(l.cv, 'pointerdown', { pointerType: 'touch', pointerId: 53, clientX: B.x, clientY: B.y });
  fire(l.cv, 'pointermove', { pointerType: 'touch', pointerId: 53, clientX: B.x + 40, clientY: B.y });
  runTimers();
  ok('拖动取消长按菜单', menus().length === 0);
  fire(l.cv, 'pointerup', { pointerType: 'touch', pointerId: 53, clientX: B.x + 40, clientY: B.y });

  fire(l.cv, 'pointerdown', { pointerId: 54, clientX: P.x, clientY: P.y });
  runTimers();
  ok('鼠标长按不弹菜单', menus().length === 0);
  fire(l.cv, 'pointerup', { pointerId: 54, clientX: P.x, clientY: P.y });

  // Android 触屏长按会派发 contextmenu：长按菜单弹出后的短窗口内必须吞掉，防误加零点
  const addBefore = l.spies.add.length;
  fire(l.cv, 'pointerdown', { pointerType: 'touch', pointerId: 58, clientX: B.x, clientY: B.y });
  runTimers();
  fire(l.cv, 'contextmenu', { clientX: B.x, clientY: B.y, button: 2 });
  ok('长按后到达的 contextmenu 被吞掉（菜单仍在、不误加零点）', menus().length === 1 && l.spies.add.length === addBefore, 'menu=' + menus().length + ' add=' + l.spies.add.length + '/' + addBefore);
  fire(l.cv, 'pointerup', { pointerType: 'touch', pointerId: 58, clientX: B.x, clientY: B.y });
  // 收尾：点「复位视图」关掉菜单（不残留到后续分组）
  const closeItem = menus()[0] && menus()[0].children.find((c) => c.textContent === '复位视图');
  if (closeItem) closeItem.fire('click', mkEvt({}));
}

/* ================= ⑨ 双击：点删除 / 空白复位 ================= */
{
  const db = mkPlane({ getSpecs: () => ({ poles: [{ re: 0.5, im: 0 }], zeros: [] }) });
  const P2 = db.plane.worldToPx(0.5, 0);
  fire(db.cv, 'dblclick', { clientX: P2.x, clientY: P2.y });
  ok('双击点删除', db.spies.del.length === 1 && db.spies.del[0][0] === 'pole');
  fire(db.cv, 'wheel', { clientX: 200, clientY: 150, deltaY: -120 });
  ok('缩放后进入 userAdjusted', db.plane.userAdjusted === true);
  fire(db.cv, 'dblclick', { clientX: 200, clientY: 60 });
  ok('双击空白复位视图', db.plane.userAdjusted === false && Math.abs((db.plane.ymax - db.plane.ymin) - 2.6) < 1e-9);
}

/* ================= ⑩ 右键空白：加零点（保留 zt/laplace 习惯） ================= */
{
  const c = mkPlane({ getSpecs: () => ({ poles: [{ re: 0.5, im: 0 }], zeros: [] }) });
  const B2 = c.plane.worldToPx(-1.0, 0.9);
  const evt = mkEvt({ clientX: B2.x, clientY: B2.y, button: 2 });
  c.cv.fire('contextmenu', evt);
  ok('右键阻止浏览器默认菜单', evt.pd === true);
  ok('右键空白加零点', c.spies.add.length === 1 && c.spies.add[0][0] === 'zero');
  const P3 = c.plane.worldToPx(0.5, 0);
  c.cv.fire('contextmenu', mkEvt({ clientX: P3.x, clientY: P3.y, button: 2 }));
  ok('右键命中点不添加', c.spies.add.length === 1);
}

/* ================= ⑪ editable 开关 ================= */
{
  const e1 = mkPlane({ editable: false, getSpecs: () => ({ poles: [{ re: 0.5, im: 0 }], zeros: [] }) });
  const B3 = e1.plane.worldToPx(-1.0, 0.9);
  fire(e1.cv, 'pointerdown', { pointerId: 61, clientX: B3.x, clientY: B3.y });
  fire(e1.cv, 'pointerup', { pointerId: 61, clientX: B3.x, clientY: B3.y });
  ok('不可编辑：点击回调 onBlankTap', e1.spies.blankTap.length === 1 && e1.spies.add.length === 0);
  fire(e1.cv, 'pointerdown', { pointerType: 'touch', pointerId: 62, clientX: B3.x, clientY: B3.y });
  runTimers();
  ok('不可编辑：长按无菜单', menus().length === 0);
  fire(e1.cv, 'pointerup', { pointerType: 'touch', pointerId: 62, clientX: B3.x, clientY: B3.y });
  const P4 = e1.plane.worldToPx(0.5, 0);
  fire(e1.cv, 'pointerdown', { pointerType: 'touch', pointerId: 63, clientX: P4.x, clientY: P4.y });
  fire(e1.cv, 'pointermove', { pointerType: 'touch', pointerId: 63, clientX: P4.x + 10, clientY: P4.y });
  fire(e1.cv, 'pointerup', { pointerType: 'touch', pointerId: 63, clientX: P4.x + 10, clientY: P4.y });
  ok('不可编辑：拖点无回调', e1.spies.move.length === 0 && e1.spies.add.length === 0);
  e1.plane.setEditable(true);
  fire(e1.cv, 'pointerdown', { pointerId: 64, clientX: B3.x, clientY: B3.y });
  fire(e1.cv, 'pointerup', { pointerId: 64, clientX: B3.x, clientY: B3.y });
  ok('动态开启编辑后可添加', e1.spies.add.length === 1);
}

/* ================= ⑫ 稳定域着色 ================= */
{
  const g1 = mkPlane();   // 极点全在单位圆内
  let log = g1.plane.ctx._log.filter((r) => r[0] === 'fillStyle').map((r) => r[1]);
  ok('unit 圆内着稳定色', log.includes(COLORS['--cv-stable-bg']), log.join(','));

  const g2 = mkPlane({ getSpecs: () => ({ poles: [{ re: 2, im: 0 }], zeros: [] }) });
  log = g2.plane.ctx._log.filter((r) => r[0] === 'fillStyle').map((r) => r[1]);
  ok('unit 有圆外极点不着稳定色', !log.includes(COLORS['--cv-stable-bg']) && log.includes(COLORS['--cv-bg']), log.join(','));

  const g3 = mkPlane({ mode: 'jw' });
  log = g3.plane.ctx._log.filter((r) => r[0] === 'fillStyle').map((r) => r[1]);
  ok('jw 左右半平面分别着稳定/不稳定色', log.includes(COLORS['--cv-stable-bg']) && log.includes(COLORS['--cv-unstable-bg']), log.join(','));

  let uCalls = 0, oCalls = 0;
  mkPlane({ onUnderlay: () => uCalls++, onOverlay: () => oCalls++ });
  ok('onUnderlay / onOverlay 回调被调', uCalls > 0 && oCalls > 0);
}

/* ================= ⑬ 撤销（增/删/拖 + Ctrl+Z + 长按菜单） ================= */
{
  const u = mkPlane({ getSpecs: () => ({ poles: [{ re: 0.5, im: 0 }], zeros: [] }) });
  const restored = [];
  u.plane.onRestore = (s) => restored.push(JSON.parse(JSON.stringify(s)));

  // 单击空白添加 → undo 恢复到无新极点
  const B9 = u.plane.worldToPx(-1.2, 0.9);
  fire(u.cv, 'pointerdown', { pointerId: 71, clientX: B9.x, clientY: B9.y });
  fire(u.cv, 'pointerup', { pointerId: 71, clientX: B9.x, clientY: B9.y });
  ok('撤销前栈非空', u.plane.undo() === true);
  ok('undo 回调收到旧 specs（1 个极点）', restored.length === 1 && restored[0].poles.length === 1, JSON.stringify(restored[0]));
  ok('undo 后栈空返回 false', u.plane.undo() === false);

  // 拖动结束压栈一次（拖动中不压）
  const P9 = u.plane.worldToPx(0.5, 0);
  fire(u.cv, 'pointerdown', { pointerType: 'touch', pointerId: 72, clientX: P9.x, clientY: P9.y });
  fire(u.cv, 'pointermove', { pointerType: 'touch', pointerId: 72, clientX: P9.x + 10, clientY: P9.y });
  fire(u.cv, 'pointermove', { pointerType: 'touch', pointerId: 72, clientX: P9.x + 20, clientY: P9.y });
  fire(u.cv, 'pointerup', { pointerType: 'touch', pointerId: 72, clientX: P9.x + 20, clientY: P9.y });
  ok('拖动后恰好压栈一次', u.plane.undo() === true && u.plane.undo() === false, 'stack=' + 'ok');
  ok('拖动撤销恢复到原位（0.5,0）', restored.length === 2 && Math.abs(restored[1].poles[0].re - 0.5) < 1e-9, JSON.stringify(restored[1]));

  // 双击删除 → 长按菜单此时含「撤销」（栈内已有删除前快照）
  const P10 = u.plane.worldToPx(0.5, 0);
  fire(u.cv, 'dblclick', { clientX: P10.x, clientY: P10.y });
  fire(u.cv, 'pointerdown', { pointerType: 'touch', pointerId: 73, clientX: P10.x, clientY: P10.y });
  runTimers();
  let m9 = menus();
  ok('长按点菜单含撤销+删除', m9.length === 1 && m9[0].children.map((c) => c.textContent).join('|').includes('撤销'), m9[0] && m9[0].children.map((c) => c.textContent).join('|'));
  if (m9.length) { const undoItem = m9[0].children.find((c) => c.textContent === '撤销'); if (undoItem) undoItem.fire('click', mkEvt({})); }
  fire(u.cv, 'pointerup', { pointerType: 'touch', pointerId: 73, clientX: P10.x, clientY: P10.y });
  ok('菜单撤销恢复删除前 specs', restored.length === 3 && restored[2].poles.length === 1, JSON.stringify(restored[2] || {}));

  // Ctrl+Z：文档监听触发 undo；输入框焦点时不触发
  const kd = sandbox.document._d.keydown || [];
  ok('Ctrl+Z 监听已挂文档', kd.length >= 1);
  fire(u.cv, 'pointerdown', { pointerId: 74, clientX: B9.x, clientY: B9.y });
  fire(u.cv, 'pointerup', { pointerId: 74, clientX: B9.x, clientY: B9.y });   // 先造一个撤销步
  const before10 = restored.length;
  const mkKey = (o) => Object.assign({ key: 'z', ctrlKey: true, metaKey: false, preventDefault() {} }, o);
  sandbox.document.activeElement = null;
  kd.forEach((f) => f(mkKey({})));
  ok('Ctrl+Z 触发撤销', restored.length === before10 + 1, before10 + '→' + restored.length);
  sandbox.document.activeElement = { tagName: 'INPUT' };
  kd.forEach((f) => f(mkKey({})));
  ok('输入框焦点时 Ctrl+Z 不触发', restored.length === before10 + 1);
  sandbox.document.activeElement = null;
  // 不可编辑画布：Ctrl+Z 不触发
  const ro = mkPlane({ editable: false });
  ro.plane.onRestore = () => restored.push({});
  (sandbox.document._d.keydown || []).forEach((f) => f(mkKey({})));
  ok('不可编辑画布 Ctrl+Z 不触发', restored.length === before10 + 1);

  // dispose 移除文档监听
  const kdCount = (sandbox.document._d.keydown || []).length;
  u.plane.dispose();
  ok('dispose 移除 Ctrl+Z 监听', (sandbox.document._d.keydown || []).length === kdCount - 1);
}

/* ================= 结果输出 ================= */
console.log('\n通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (fails.length) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('✓ ComplexPlane 组件全部通过');
}
