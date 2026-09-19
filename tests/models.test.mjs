/* ============================================================
 * models.test.mjs — 模型库与跨模块交接测试（无浏览器）
 *   运行：node tests/models.test.mjs
 *
 *   覆盖：App.models 增删查/上限逐出、renderChips 回载与删除、
 *   sys → blk 的 slim 编码往返、MI.library 保存流程。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

class DomNode {}
const mkCtx = () => new Proxy({}, {
  get(t, k) { if (k === 'measureText') return () => ({ width: 10 }); return k in t ? t[k] : () => {}; },
  set(t, k, v) { t[k] = v; return true; }
});
function matchesSel(el, sel) {
  if (sel.startsWith('#')) return (el._a && el._a.id === sel.slice(1)) || el.id === sel.slice(1);
  if (sel.startsWith('.')) return String(el.className || '').split(/\s+/).includes(sel.slice(1));
  return el.tagName === sel.toUpperCase();
}
class El extends DomNode {
  constructor(tag) {
    super();
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this._a = {}; this._l = {}; this._html = ''; this._text = '';
    this.value = ''; this.title = ''; this.className = ''; this.id = '';
    this.clientWidth = 640; this.clientHeight = 420;
    this.offsetWidth = 170; this.offsetHeight = 40;
    this.width = 640; this.height = 420;
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
  set innerHTML(v) { this._html = String(v); this.children = []; }
  get textContent() { return this.children.length ? this.children.map((c) => (c && c.textContent) || '').join('') : this._text; }
  set textContent(v) { this._text = String(v); }
  get firstElementChild() { return this.children[0] || null; }
  addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
  removeEventListener() {}
  setAttribute(k, v) { this._a[k] = String(v); if (k === 'id') this.id = String(v); if (k === 'value') this.value = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5)] = String(v); }
  getAttribute(k) { return k in this._a ? this._a[k] : null; }
  appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  remove() { if (this.parentElement) { const i = this.parentElement.children.indexOf(this); if (i >= 0) this.parentElement.children.splice(i, 1); } }
  contains() { return false; }
  closest(sel) { return matchesSel(this, sel) ? this : null; }
  _matches(sel) { return matchesSel(this, sel); }
  _search(sel, out) { for (const c of this.children) { if (c._matches && matchesSel(c, sel)) out.push(c); if (c._search) c._search(sel, out); } return out; }
  querySelector(sel) { const out = this._search(sel, []); return out[0] || reg(String(sel)); }
  querySelectorAll(sel) { return this._search(sel, []); }
  insertAdjacentHTML() {}
  focus() {} select() {} blur() {}
  setPointerCapture() {} releasePointerCapture() {}
  setSelectionRange() {}
  dispatchEvent(evt) { (this._l[evt.type] || []).forEach((f) => f(evt)); return true; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: this.clientHeight }; }
  getContext() { return this._ctx || (this._ctx = mkCtx()); }
  fire(type, evt) { (this._l[type] || []).forEach((f) => f(evt)); }
}
const registry = {};
const reg = (key) => (registry[key] = registry[key] || new El('canvas'));

const timers = new Map();
let timerSeq = 0;
const runTimers = () => { const q = [...timers.entries()]; timers.clear(); q.forEach(([, f]) => f()); };
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};

const sandbox = {
  console, JSON, Math, Node: DomNode,
  Event: class { constructor(t) { this.type = t; } },
  document: {
    body: new El('body'), activeElement: null,
    createElement: (t) => new El(t),
    createTextNode: (t) => ({ data: String(t), textContent: String(t) }),
    addEventListener: () => {}, removeEventListener: () => {},
    getElementById: (id) => reg('#' + id)
  },
  localStorage,
  getComputedStyle: () => ({ fontFamily: 'sans', getPropertyValue: () => '' }),
  matchMedia: () => ({ matches: false }),
  requestAnimationFrame: (f) => 0,
  setTimeout: (f) => { const id = ++timerSeq; timers.set(id, f); return id; },
  clearTimeout: (id) => { timers.delete(id); },
  ResizeObserver: class { observe() {} disconnect() {} },
  URLSearchParams, btoa, atob, escape, unescape,
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
  'assets/js/modules/explore.js', 'assets/js/modules/system.js', 'assets/js/modules/blockdiag.js']) {
  vm.runInContext(read(f), sandbox, { filename: f });
}

let pass = 0;
const fails = [];
const ok = (n, c, extra) => { c ? pass++ : fails.push(n + (extra ? '  → ' + extra : '')); };
const mkEvt = (o) => Object.assign({ key: '', preventDefault() {}, target: { closest: () => null } }, o);
const App = sandbox.window.App;

/* ================= ① App.models 基础 ================= */
{
  ok('初始为空', App.models.list().length === 0);
  const e1 = App.models.save({ name: '二阶系统', kind: 'tf', data: { variable: 's', num: '1', den: 's^2+2*s+5' } });
  const e2 = App.models.save({ name: '框图A', kind: 'blk', data: { hash: 'blk1.abc' } });
  ok('保存两条', App.models.list().length === 2 && App.models.list()[0].name === '二阶系统');
  App.models.rename(e1.id, '二阶（改）');
  ok('重命名生效', App.models.list()[0].name === '二阶（改）');
  App.models.remove(e2.id);
  ok('删除生效', App.models.list().length === 1 && App.models.list()[0].id === e1.id);
  // 上限逐出
  for (let i = 0; i < 25; i++) App.models.save({ name: 'm' + i, kind: 'tf', data: { variable: 's', num: '1', den: 's+1' } });
  ok('上限 20 逐出最旧', App.models.list().length === 20 && App.models.list()[0].name !== '二阶（改）', String(App.models.list().length));
}

/* ================= ② renderChips 回载与删除 ================= */
{
  store.clear();
  const host = new El('div');
  const loaded = [];
  App.models.save({ name: 'S1', kind: 'tf', data: { variable: 's', num: '1', den: 's+1' } });
  App.models.save({ name: 'Z1', kind: 'tf', data: { variable: 'z', num: 'z', den: 'z-0.5' } });
  App.models.save({ name: 'B1', kind: 'blk', data: { hash: 'blk1.xyz' } });
  const refresh = App.models.renderChips(host, {
    kinds: ['tf'],
    onLoad: (m) => loaded.push(m.name),
    emptyText: '暂无'
  });
  const chips = host.querySelectorAll('.chip').filter((c) => c.tagName === 'BUTTON');
  ok('chips 按 kind 过滤（2 个 tf）', chips.length === 2, String(chips.length));
  const s1 = chips.find((c) => c.textContent === 'S1' || (c.children[0] || {}).textContent === 'S1');
  const label = (c) => (c.children[0] && c.children[0].textContent) || c.textContent;
  const s1b = chips.find((c) => label(c) === 'S1');
  if (s1b) {
    s1b.fire('click', mkEvt({ target: s1b }));
    ok('点击 chip 回载', loaded.includes('S1'), JSON.stringify(loaded));
  } else {
    ok('点击 chip 回载（chip 未找到）', false);
  }
  const delBtn = host.querySelectorAll('.chip').find((c) => c.tagName === 'SPAN' && c._a.title && String(c._a.title).startsWith('删除'));
  if (delBtn) delBtn.fire('click', mkEvt({}));
  ok('删除 chip 生效（3→2）', App.models.list().length === 2, String(App.models.list().length));
}

/* ================= ③ sys → blk 的 slim 编码往返 ================= */
{
  // 复现 sys-toblk 的 slim 构造，验证 blk 的 readHash 能还原出 2 元件 2 连线
  const sysHost = new El('div');
  const sysMi = new El('div'); sysMi._a.id = 'sys-mi'; sysMi.id = 'sys-mi'; sysHost.appendChild(sysMi);
  sandbox.App.modules['sys'](sysHost);
  const c = { numStr: '1', denStr: 's^2+2*s+5' };
  const H = (c.numStr || '1') + '/(' + (c.denStr || '1') + ')';
  const slim = { v: 1, n: [
    { i: 1, k: 'sum', m: 'Σ1', s: '1', x: 200, y: 230, r: 1, o: 0, z: 0 },
    { i: 2, k: 'box', m: 'G1', s: H, x: 470, y: 230, r: 0, o: 1, z: 0 }
  ], e: [[1, 2, 1], [2, 1, 0]] };
  sandbox.location.hash = '#blk=blk1.' + sandbox.btoa(sandbox.unescape(encodeURIComponent(JSON.stringify(slim))));
  const blkHost = new El('div');
  const blkMod = sandbox.App.modules['blk'](blkHost);
  sandbox.console.error = console.error;   // 桩保留
  const countsEl = reg('#blk-counts');
  ok('sys→blk：框图还原出 2 元件 2 连线', /2 元件 · 2 连线/.test(countsEl.textContent), countsEl.textContent);
  // T(s) 合成有效（闭环极点页签渲染）
  ok('sys→blk：合成传函可求解', /阶次/.test(reg('#blk-tabbody').innerHTML) || reg('#blk-tabbody').innerHTML.length > 0);
  try { blkMod.api.dispose(); } catch (e) { }
}

/* ================= ④ MI.library 保存流程 ================= */
{
  store.clear();
  const host = new El('div');
  const lib = sandbox.MI.library(host, {
    kinds: ['tf'],
    onSave: () => ({ kind: 'tf', data: { variable: 's', num: '2', den: 's+3' } }),
    onLoad: () => { },
    defaultName: '预设名'
  });
  const all = host.querySelectorAll('.btn');
  const saveBtn = host.querySelectorAll('.btn').find((b) => (b.children[0] && b.children[0].textContent) === '💾 保存' || b.textContent === '💾 保存');
  ok('library 渲染保存按钮', !!saveBtn);
  saveBtn.fire('click', mkEvt({}));
  // nameAsk 浮层出现：填名并保存
  const dlg = sandbox.document.body.children.find((c) => c.className === 'cp-menu');
  ok('命名浮层出现', !!dlg);
  if (dlg) {
    const inp = dlg._search('input', [])[0];
    inp.value = '我的系统';
    const okB = dlg._search('button', []).find((c) => c.textContent === '💾 保存');
    okB.fire('click', mkEvt({}));
    const list = App.models.list();
    ok('保存成功且用自定义名', list.length === 1 && list[0].name === '我的系统' && list[0].data.num === '2', JSON.stringify(list));
    ok('浮层已关闭', !sandbox.document.body.children.some((c) => c.className === 'cp-menu'));
  }
  // chips 出现在 library 行
  ok('保存后 chips 刷新', host.textContent.includes('我的系统') || host._search('.chip', []).length >= 1);
}

/* ================= 结果输出 ================= */
console.log('\n通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (fails.length) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('✓ 模型库与交接全部通过');
}
