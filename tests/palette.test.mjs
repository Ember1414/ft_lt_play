/* ============================================================
 * palette.test.mjs — 命令面板契约测试（Ctrl+K 搜索）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
function matchesSel(el, sel) { if (sel.startsWith('#')) return el.id === sel.slice(1); if (sel.startsWith('.')) return String(el.className || '').split(/\s+/).includes(sel.slice(1)); return el.tagName === sel.toUpperCase(); }
class El {
  constructor(tag) { this.tagName = String(tag || 'div').toUpperCase(); this.children = []; this.style = {}; this.dataset = {}; this._a = {}; this._l = {}; this._html = ''; this._text = ''; this.value = ''; this.title = ''; this.id = ''; this.clientWidth = 640; this.clientHeight = 420; this.isConnected = true; this.parentElement = null; const cls = new Set(); this.classList = { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; v ? cls.add(c) : cls.delete(c); return v; }, contains: (c) => cls.has(c) }; Object.defineProperty(this, 'className', { get: () => [...cls].join(' '), set: (v) => { cls.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => cls.add(c)); } }); }
  get innerHTML() { return this._html; } set innerHTML(v) { this._html = String(v); this.children = []; }
  get textContent() { return this.children.length ? this.children.map((c) => (c && c.textContent) || '').join('') : this._text; } set textContent(v) { this._text = String(v); this.children = []; }
  addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); } removeEventListener() { }
  setAttribute(k, v) { this._a[k] = String(v); if (k === 'id') this.id = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5)] = String(v); }
  getAttribute(k) { return k in this._a ? this._a[k] : null; }
  appendChild(c) { c.parentElement = this; this.children.push(c); return c; } append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  remove() { if (this.parentElement) { const i = this.parentElement.children.indexOf(this); if (i >= 0) this.parentElement.children.splice(i, 1); } }
  _matches(sel) { return matchesSel(this, sel); }
  _search(sel, out) { for (const c of this.children) { if (c._matches && matchesSel(c, sel)) out.push(c); if (c._search) c._search(sel, out); } return out; }
  querySelector(sel) { const r = this._search(sel, [])[0]; if (r) return r; return reg(sel); }
  querySelectorAll(sel) { return this._search(sel, []); }
  fire(type, evt) { (this._l[type] || []).forEach((f) => f(evt)); return true; }
  focus() { } select() { }
  getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 420 }; }
}
const registry = {}; const reg = (key) => (registry[key] = registry[key] || new El('canvas'));
const sandbox = {
  console: { log() { }, warn() { }, error() { } }, JSON, Math, Node: class { },
  document: { body: new El('body'), activeElement: null, createElement: (t) => new El(t), createTextNode: (t) => ({ data: String(t), textContent: String(t) }), addEventListener: () => { }, getElementById: (id) => reg('#' + id), querySelectorAll: () => [] },
  localStorage: { getItem: () => null, setItem: () => { }, removeItem: () => { } },
  URLSearchParams, btoa, atob, escape, unescape, setTimeout: () => 0, clearTimeout: () => { },
  location: { hash: '', origin: 'http://x', pathname: '/' }, navigator: {}, history: { replaceState: () => { } },
  innerWidth: 1280, addEventListener: () => { }, removeEventListener: () => { }, dispatchEvent: () => true,
  App: { modules: { home: () => { }, sys: () => { }, zt: () => { } }, register() { } }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['assets/js/lib/util.js', 'assets/js/lib/project.js', 'assets/js/lib/palette.js']) {
  vm.runInContext(read(f), sandbox, { filename: f });
}
const { CP, PX } = sandbox.window;
sandbox.window.WB = { templates: [{ id: 't1', name: '数字谐振器', module: 'zt', state: {} }] };

let pass = 0;
const fails = [];
const ok = (n, c, extra) => { if (c) { pass++; return; } fails.push(n + (extra ? '  → ' + extra : '')); };

/* collect / match 纯逻辑 */
{
  const opened = [];
  CP.setActions({
    openModule: (k) => opened.push(['mod', k]),
    openExperiment: (id) => opened.push(['exp', id]),
    createExperiment: (t) => opened.push(['tpl', t.id])
  });
  sandbox.PX.setStorage(null);
  sandbox.PX.create({ name: '谐振实验', module: 'zt', state: {} });
  sandbox.PX.create({ name: '系统辨识', module: 'sys', state: {} });
  const items = CP.collect();
  ok('collect 含模块+实验+模板', items.filter((i) => i.kind === 'module').length >= 3 && items.filter((i) => i.kind === 'exp').length === 2 && items.filter((i) => i.kind === 'tpl').length === 1);
  ok('match 子串过滤', CP.match('谐振', { name: '数字谐振器', hint: '模板' }) && !CP.match('谐振', { name: '系统辨识', hint: '实验' }));
  ok('match 多词 AND', CP.match('实验 系统', { name: 'x', hint: '实验 · 系统分析' }));
}

/* DOM 交互：toggle → 搜索 → 回车执行 */
{
  const created = [];
  CP.setActions({ createExperiment: (t) => created.push(t.id) });
  CP.open();
  const input = sandbox.document.body._search('input', [])[0];
  ok('面板打开且搜索框存在', !!input);
  input.value = '模板';
  input.fire('input', { target: input });
  const listEl = sandbox.document.body._search('.cp-list', [])[0];
  const rows = listEl.querySelectorAll('.cp-item');
  ok('搜索过滤出模板项', rows.length === 1 && rows[0].textContent.includes('数字谐振器'), String(rows.length));
  // 回车执行
  input.fire('keydown', { key: 'Enter', preventDefault() { } });
  ok('回车执行模板创建', created.length === 1 && created[0] === 't1', JSON.stringify(created));
  ok('执行后面板关闭', sandbox.document.body._search('.cp-box', []).length === 0);
  // Escape 关闭
  CP.open();
  const input2 = sandbox.document.body._search('input', [])[0];
  input2.fire('keydown', { key: 'Escape', preventDefault() { } });
  ok('Escape 关闭面板', sandbox.document.body._search('.cp-box', []).length === 0);
  // 无匹配
  CP.open();
  const input3 = sandbox.document.body._search('input', [])[0];
  input3.value = '不存在的关键词zzz';
  input3.fire('input', { target: input3 });
  ok('无匹配给出提示', sandbox.document.body._search('.cp-list', [])[0].textContent.includes('没有匹配项'));
  CP.close();
}

console.log(fails.length
  ? `✗ palette ${pass} 通过，${fails.length} 失败:\n  ` + fails.join('\n  ')
  : `✓ palette ${pass} 项全部通过`);
process.exit(fails.length ? 1 : 0);
