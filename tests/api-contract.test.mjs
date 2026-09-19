/* ============================================================
 * api-contract.test.mjs — 模块实验接入契约
 *   接入实验的模块必须暴露 api.getState / api.applyState，
 *   且返回纯 JSON（可被 PX 校验接受）。缺失即模板/恢复静默失效
 *   （Node 桩下不可见、浏览器才炸的 bug 类，2026-09-19 实例）。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function matchesSel(el, sel) {
  if (sel.startsWith('#')) return el.id === sel.slice(1);
  if (sel.startsWith('.')) return String(el.className || '').split(/\s+/).includes(sel.slice(1));
  return el.tagName === sel.toUpperCase();
}
class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = []; this.style = {}; this.dataset = {};
    this._a = {}; this._l = {}; this._html = ''; this._text = '';
    this.value = ''; this.title = ''; this.id = '';
    this.clientWidth = 640; this.clientHeight = 420; this.offsetWidth = 170; this.offsetHeight = 40;
    this.isConnected = true; this.parentElement = null;
    const cls = new Set();
    this.classList = { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; v ? cls.add(c) : cls.delete(c); return v; }, contains: (c) => cls.has(c) };
    Object.defineProperty(this, 'className', { get: () => [...cls].join(' '), set: (v) => { cls.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => cls.add(c)); } });
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  get textContent() { return this.children.length ? this.children.map((c) => (c && c.textContent) || '').join('') : this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
  removeEventListener() { }
  setAttribute(k, v) { this._a[k] = String(v); if (k === 'id') this.id = String(v); if (k === 'value') this.value = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5)] = String(v); }
  getAttribute(k) { return k in this._a ? this._a[k] : null; }
  appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  remove() { }
  _matches(sel) { return matchesSel(this, sel); }
  _search(sel, out) { for (const c of this.children) { if (c._matches && matchesSel(c, sel)) out.push(c); if (c._search) c._search(sel, out); } return out; }
  querySelector(sel) { const r = this._search(sel, [])[0]; if (r) return r; return sel.startsWith('#') ? reg(sel) : null; }
  querySelectorAll(sel) { return this._search(sel, []); }
  focus() { } select() { } fire(type, evt) { (this._l[type] || []).forEach((f) => f(evt)); return true; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  getContext() { return this._ctx || (this._ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : typeof t[k] === 'function' ? t[k] : () => { }), set: (t, k, v) => (t[k] = v, true) })); }
}
const registry = {};
const reg = (key) => (registry[key] = registry[key] || new El('canvas'));
const store = new Map();
const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const sandbox = {
  console: { log: () => { }, warn: () => { }, error: () => { } },
  JSON, Math, Blob, Node: class { }, Event: class { constructor(t) { this.type = t; } }, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
  document: {
    body: new El('body'), activeElement: null,
    createElement: (t) => new El(t), createTextNode: (t) => ({ data: String(t), textContent: String(t) }),
    addEventListener: () => { }, removeEventListener: () => { },
    getElementById: (id) => reg('#' + id), querySelectorAll: () => []
  },
  localStorage, URLSearchParams, btoa, atob, escape, unescape,
  setTimeout: () => 0, clearTimeout: () => { },
  location: { hash: '', origin: 'http://x', pathname: '/index.html' },
  navigator: {}, history: { replaceState: () => { } },
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  matchMedia: () => ({ matches: false }),
  requestAnimationFrame: () => 0,
  ResizeObserver: class { observe() { } disconnect() { } },
  App: { modules: {}, register(name, f) { this.modules[name] = f; } }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['assets/js/lib/util.js', 'assets/js/lib/mathdsp.js', 'assets/js/lib/plots.js', 'assets/js/lib/fx.js',
  'assets/js/lib/mathinput.js', 'assets/js/lib/blocksolve.js', 'assets/js/lib/transforms.js', 'assets/js/lib/odesolve.js',
  'assets/js/lib/project.js', 'assets/js/lib/toolbar.js', 'assets/js/app.js', 'assets/js/modules/workbench.js',
  'assets/js/modules/zt.js', 'assets/js/modules/system.js']) {
  vm.runInContext(read(f), sandbox, { filename: f });
}
const { App, PX } = sandbox.window;

let pass = 0;
const fails = [];
const ok = (n, c, extra) => { c ? pass++ : fails.push(n + (extra ? '  → ' + extra : '')); };
App.open = () => { };
App.toast = () => { };
App.hashFree = () => !App.exps.cur();

for (const key of ['sys', 'zt']) {
  const host = new El('div');
  const mod = App.modules[key](host);
  const api = mod.api || mod;
  ok(`${key}: api.getState 是函数`, typeof api.getState === 'function');
  ok(`${key}: api.applyState 是函数`, typeof api.applyState === 'function');
  ok(`${key}: api.dispose / onTheme 保持`, typeof api.dispose === 'function' && typeof api.onTheme === 'function');
  if (typeof api.getState === 'function') {
    const state = api.getState();
    ok(`${key}: getState 返回纯对象`, !!state && typeof state === 'object' && !Array.isArray(state));
    const exp = PX.normalize({ name: '契约检查', module: key, moduleStates: { [key]: { savedAt: 1, data: state } } });
    const v = PX.validate(exp);
    ok(`${key}: getState 产物通过 PX 校验`, v.ok, v.errors && v.errors.join(';'));
    // applyState(自身状态) 不抛错
    let applyOk = true;
    try { api.applyState(JSON.parse(JSON.stringify(state))); } catch (e) { applyOk = false; }
    ok(`${key}: applyState 往返不抛错`, applyOk);
  }
}
// workbench：api.render 可重复调用
{
  const host = new El('div');
  const mod = App.modules['home'](host);
  ok('home: api.render 存在', typeof mod.api.render === 'function');
  let okFlag = true;
  try { mod.api.render(); } catch (e) { okFlag = false; }
  ok('home: render 重复调用不抛错', okFlag);
}

console.log(fails.length
  ? `✗ api-contract ${pass} 通过，${fails.length} 失败:\n  ` + fails.join('\n  ')
  : `✓ api-contract ${pass} 项全部通过`);
process.exit(fails.length ? 1 : 0);
