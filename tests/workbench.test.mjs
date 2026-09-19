/* ============================================================
 * workbench.test.mjs — 工作台 + 统一工具栏契约测试（无浏览器）
 *   覆盖：WB 模板/搜索/时间纯函数；工作台 DOM 交互（建实验/收藏/
 *   重命名/复制/两步删除/快照面板与恢复/分享码导入）；工具栏导出降级。
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
    this.children = [];
    this.style = {}; this.dataset = {};
    this._a = {}; this._l = {}; this._html = ''; this._text = '';
    this.value = ''; this.title = ''; this.id = '';
    this.clientWidth = 640; this.clientHeight = 420; this.offsetWidth = 170; this.offsetHeight = 40;
    this.isConnected = true; this.parentElement = null;
    const cls = new Set();
    this.classList = {
      add: (...c) => c.forEach((x) => cls.add(x)),
      remove: (...c) => c.forEach((x) => cls.delete(x)),
      toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; v ? cls.add(c) : cls.delete(c); return v; },
      contains: (c) => cls.has(c)
    };
    // className 与 classList 双向同步（U.el 通过 .className 赋值）
    Object.defineProperty(this, 'className', {
      get: () => [...cls].join(' '),
      set: (v) => { cls.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => cls.add(c)); }
    });
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
  remove() { if (this.parentElement) { const i = this.parentElement.children.indexOf(this); if (i >= 0) this.parentElement.children.splice(i, 1); } }
  replaceWith(n) { const p = this.parentElement; if (!p) return; const i = p.children.indexOf(this); p.children[i] = n; n.parentElement = p; this.parentElement = null; }
  after(...cs) { const p = this.parentElement; if (!p) return; const i = p.children.indexOf(this); p.children.splice(i + 1, 0, ...cs); cs.forEach((c) => (c.parentElement = p)); }
  get nextElementSibling() { const p = this.parentElement; if (!p) return null; const i = p.children.indexOf(this); return p.children[i + 1] || null; }
  _matches(sel) { return matchesSel(this, sel); }
  _search(sel, out) { for (const c of this.children) { if (c._matches && matchesSel(c, sel)) out.push(c); if (c._search) c._search(sel, out); } return out; }
  querySelector(sel) { const r = this._search(sel, [])[0]; if (r) return r; return sel.startsWith('#') ? reg(sel) : null; }
  querySelectorAll(sel) { return this._search(sel, []); }
  focus() { } select() { } blur() { }
  fire(type, evt) { (this._l[type] || []).forEach((f) => f(evt)); return true; }
}
const registry = {};
const reg = (key) => (registry[key] = registry[key] || new El('canvas'));
const timers = new Map();
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};

const sandbox = {
  console: { log: () => { }, warn: () => { }, error: () => { } },
  JSON, Math, Blob, Node: class { },
  Event: class { constructor(t) { this.type = t; } },
  CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
  document: {
    body: new El('body'), activeElement: null,
    createElement: (t) => new El(t), createTextNode: (t) => ({ data: String(t), textContent: String(t) }),
    addEventListener: () => { }, removeEventListener: () => { },
    getElementById: (id) => reg('#' + id),
    querySelectorAll: () => []
  },
  localStorage, URLSearchParams, btoa, atob, escape, unescape,
  setTimeout: (f) => { const id = timers.size + 1; timers.set(id, f); return id; },
  clearTimeout: (id) => timers.delete(id),
  location: { hash: '', origin: 'http://x', pathname: '/index.html' },
  navigator: {},
  history: { replaceState: () => { } },
  innerWidth: 1280,
  App: { modules: {}, register(name, f) { this.modules[name] = f; } }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['assets/js/lib/util.js', 'assets/js/lib/project.js', 'assets/js/lib/toolbar.js', 'assets/js/app.js', 'assets/js/modules/workbench.js']) {
  vm.runInContext(read(f), sandbox, { filename: f });
}
const { App, PX, WB, RTB } = sandbox.window;

let pass = 0;
const fails = [];
const ok = (n, c, extra) => { c ? pass++ : fails.push(n + (extra ? '  → ' + extra : '')); };
const mkEvt = (o) => Object.assign({ preventDefault() { }, target: null }, o);

/* ================= ① WB 纯函数 ================= */
{
  ok('模板非空且 id 唯一', WB.templates.length >= 5 && new Set(WB.templates.map((t) => t.id)).size === WB.templates.length);
  let allValid = true;
  for (const t of WB.templates) {
    if (!['sys', 'zt'].includes(t.module)) allValid = false;   // 只有已接入 getState/applyState 的模块可做模板
    const exp = PX.normalize({ name: t.name, module: t.module, moduleStates: { [t.module]: { savedAt: 1, data: t.state } } });
    if (!PX.validate(exp).ok) allValid = false;
  }
  ok('全部模板 state 通过 PX 校验且模块已接入', allValid);
  ok('match 空查询全过', WB.match('', { name: 'x', tags: [], module: 'sys' }));
  ok('match 名称子串', WB.match('谐振', { name: '数字谐振器', tags: [], module: 'zt' }));
  ok('match 模块中文名', WB.match('Z 变换', { name: 'x', tags: [], module: 'zt' }));
  ok('match 多词 AND', WB.match('离散 低通', { name: '离散一阶低通', tags: [], module: 'zt' }) && !WB.match('离散 低通', { name: '数字谐振器', tags: [], module: 'zt' }));
  ok('match 标签', WB.match('作业3', { name: 'x', tags: ['作业3'], module: 'sys' }));
  const now = 1000 * 60 * 60 * 24 * 3;
  ok('fmtTime 相对文案', WB.fmtTime(now - 30e3, now) === '刚刚' && WB.fmtTime(now - 5 * 60e3, now) === '5 分钟前' && WB.fmtTime(now - 3 * 3600e3, now) === '3 小时前');
  ok('fmtTime 非法输入', WB.fmtTime(NaN) === '—');
}

/* ================= ② 实验控制器（真实 App.exps，替换 App.open 依赖） ================= */
let toasts = [];
App.toast = (m, kind) => toasts.push({ m, kind });
let openedWith = null;
App.open = (name) => { openedWith = name; };
App.hashFree = () => !App.exps.cur();
{
  store.clear();
  // 空实验创建 → 模块状态捕获 → 防抖落盘 → 刷新恢复
  const exp = App.exps.createAndOpen({ name: '工作台闭环', module: 'sys', state: { num: '1', den: 's+2' } });
  ok('createAndOpen 建实验并记录 last', !!exp && sandbox.localStorage.getItem('fltp:last') === exp.id);
  ok('createAndOpen 打开对应模块', openedWith === 'sys');
  ok('创建时状态已入库', PX.load(exp.id).moduleStates.sys.data.den === 's+2');
  App.exps.persistNow();
  ok('落盘可读回', PX.load(exp.id).name === '工作台闭环');
  // 分享往返
  const link = App.exps.shareLink();
  ok('shareLink 含 #exp= 且能解码', /^http:\/\/x\/index\.html#exp=PX1\./.test(link));
  const code = link.split('#exp=')[1];
  store.clear();   // 模拟接收方
  const r = App.exps.importFromShare(code);
  ok('分享码导入成功并切模块', r.ok && PX.list().length === 1 && openedWith === 'sys');
  // JSON 导入导出
  const json = PX.exportJSON(PX.load(PX.list()[0].id));
  const r2 = App.exps.importJSONText(json);
  ok('JSON 导入成功', r2.ok && PX.list().length === 1);
}

/* ================= ③ 工作台 DOM 契约 ================= */
{
  store.clear(); registry && Object.keys(registry).forEach((k) => delete registry[k]);
  toasts = [];
  const created = [];
  App.exps.createAndOpen = (o) => { created.push(o); const e = PX.create(o); return e; };
  let openedId = null;
  App.exps.openById = (id) => { openedId = id; return PX.load(id); };

  const host = new El('div');
  App.modules['home'](host);
  const tplBox = reg('#wb-tpl');
  const cards = tplBox.querySelectorAll('.wb-tpl-card');
  ok('渲染 6 张模板卡', cards.length === WB.templates.length, String(cards.length));
  ok('空状态引导可见', /三步开始/.test(reg('#wb-empty').innerHTML));
  const search = reg('#wb-toolbar').querySelector('#wb-search');
  ok('搜索框有 aria-label', !!search && search.getAttribute('aria-label') === '搜索实验');

  // 点击模板 → 创建实验（正确载荷）→ 实验入库
  const reso = cards.find((c) => c.children[0].textContent === '数字谐振器');
  ok('模板卡存在', !!reso);
  reso.fire('click', mkEvt({}));
  ok('模板点击创建实验（module/state 正确）', created.length === 1 && created[0].module === 'zt' && created[0].state.num === 'z', JSON.stringify(created[0] || {}));
  ok('实验带模板标签', (PX.list()[0].tags || []).includes('模板'));

  // 搜索过滤（已有 1 个实验）
  search.value = '不存在的关键词xyz';
  search.fire('input', mkEvt({ target: search }));
  ok('搜索无结果给出提示', /没有匹配/.test(reg('#wb-empty').textContent));
  search.value = '';
  search.fire('input', mkEvt({ target: search }));

  // 行操作：收藏 / 重命名 / 复制 / 两步删除 / 快照
  const e1 = PX.create({ name: '行实验A', module: 'sys', state: { v: 1 } });
  const e2 = PX.create({ name: '行实验B', module: 'zt', state: { v: 2 } });
  sandbox.App.toast = App.toast;   // 保持一致
  const host2 = new El('div');
  App.modules['home'](host2);
  const listBox = reg('#wb-list');
  let rows = listBox.querySelectorAll('.wb-row');
  ok('渲染 3 行实验', rows.length === 3, String(rows.length));

  const rowA = rows.find((r) => r.getAttribute('data-exp') === e1.id);
  const fav = rowA.querySelectorAll('button').find((b) => b._a.title === '收藏');
  fav.fire('click', mkEvt({}));
  ok('收藏写回 PX 且置顶', PX.load(e1.id).favorite === true && PX.list()[0].id === e1.id);

  const rowA2 = reg('#wb-list').querySelectorAll('.wb-row').find((r) => r.getAttribute('data-exp') === e1.id);
  const ren = rowA2.querySelectorAll('button').find((b) => b._a.title === '重命名');
  ren.fire('click', mkEvt({}));
  const inp = rowA2.querySelector('.wb-rename-inp');
  ok('重命名出现行内输入框', !!inp);
  inp.value = '改名后的A';
  const okBtn = rowA2.querySelectorAll('button').find((b) => b.textContent === '✓');
  okBtn.fire('click', mkEvt({}));
  ok('重命名写回 PX', PX.load(e1.id).name === '改名后的A');

  const rowA3 = reg('#wb-list').querySelectorAll('.wb-row').find((r) => r.getAttribute('data-exp') === e1.id);
  rowA3.querySelectorAll('button').find((b) => b._a.title === '复制为新实验').fire('click', mkEvt({}));
  ok('复制产生副本', PX.list().some((m) => m.name === '改名后的A 副本'));

  // 快照面板与恢复
  PX.addSnapshot(PX.load(e1.id), 'v1 快照', 'sys');
  const rowA4 = reg('#wb-list').querySelectorAll('.wb-row').find((r) => r.getAttribute('data-exp') === e1.id);
  rowA4.querySelectorAll('button').find((b) => b._a.title === '快照列表').fire('click', mkEvt({}));
  const snapPanel = rowA4.nextElementSibling;
  ok('快照面板出现', !!snapPanel && snapPanel.classList.contains('wb-snaps'));
  const restoreBtn = snapPanel.querySelectorAll('button')[0];
  restoreBtn.fire('click', mkEvt({}));
  ok('恢复快照调用 openById', openedId === e1.id);

  // 两步删除
  const rowB = reg('#wb-list').querySelectorAll('.wb-row').find((r) => r.getAttribute('data-exp') === e2.id);
  const del = rowB.querySelectorAll('button').find((b) => b._a.title === '删除');
  del.fire('click', mkEvt({}));
  ok('第一次点删除只是确认态', !!PX.load(e2.id) && del.textContent === '确认?');
  del.fire('click', mkEvt({}));
  ok('二次点击真正删除', PX.load(e2.id) === null);

  // 分享码导入对话框
  const host3 = new El('div');
  App.modules['home'](host3);
  const codeBtn = reg('#wb-toolbar').querySelectorAll('button').find((b) => b._a.title === '粘贴版本化分享码导入实验');
  codeBtn.fire('click', mkEvt({}));
  const dlg = host3.children.find((c) => c.classList && c.classList.contains('mask'));
  ok('分享码导入浮层出现', !!dlg);
  const ta = dlg._search('textarea', [])[0];
  ta.value = '前面是说明文字 PX1.AAAAAAAA.00000000 后面随便';   // 非法校验和
  dlg.querySelectorAll('button').find((b) => b.textContent === '导入').fire('click', mkEvt({}));
  ok('非法分享码拒绝并提示 danger', toasts.some((t) => t.kind === 'danger' && /导入失败/.test(t.m)));
  ok('非法导入后浮层保留', !!host3.children.find((c) => c.classList && c.classList.contains('mask')));
  const real = PX.encodeShare(PX.load(PX.list()[0].id));
  ta.value = '垃圾前缀' + real;
  dlg.querySelectorAll('button').find((b) => b.textContent === '导入').fire('click', mkEvt({}));
  ok('合法分享码导入成功并关浮层', !host3.children.find((c) => c.classList && c.classList.contains('mask')) && toasts.some((t) => /导入成功/.test(t.m)));
}

/* ================= ④ 工具栏降级行为 ================= */
{
  store.clear();
  toasts = [];
  App.exps.createAndOpen = (o) => PX.create(o);   // 还原为近似真实实现（App.open 已被替换为 noop）
  const host = new El('div');
  RTB.attach(host, {
    module: 'sys',
    getState: () => ({ num: '1', den: 's+1' }),
    csv: () => null
  });
  const btns = host.querySelectorAll('button');
  ok('工具栏渲染 6 个操作（无 canvases 时无 PNG）', btns.length === 6, String(btns.length));
  const byTitle = (t) => btns.find((b) => b._a.title === t);
  byTitle('保存当前状态到实验（含可恢复快照）').fire('click', mkEvt({}));
  ok('无实验时保存自动创建并提示', toasts.some((t) => /已保存实验/.test(t.m)) && PX.list().length === 1);
  const csvBtn = byTitle('导出当前结果数据（CSV，Excel 可直接打开）');
  csvBtn.fire('click', mkEvt({}));
  ok('csv() 返回 null 时提示不可导出', toasts.some((t) => t.kind === 'danger' && /没有可导出的数据/.test(t.m)));
  byTitle('复制当前实验为新实验').fire('click', mkEvt({}));
  ok('复制按钮生效', PX.list().length === 2);
}

console.log(fails.length
  ? `✗ workbench ${pass} 通过，${fails.length} 失败:\n  ` + fails.join('\n  ')
  : `✓ workbench ${pass} 项全部通过`);
process.exit(fails.length ? 1 : 0);
