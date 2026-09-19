/* ============================================================
 * mathinput.test.mjs — 统一数学输入组件 MI 测试（无浏览器）
 *   运行：node tests/mathinput.test.mjs
 *
 *   覆盖：全角/负号归一化（fx/transforms 入口）、纠错词典、
 *   tfInput（三态徽标/自动应用/真分式警告/示例/历史/Enter/autoApply）、
 *   exprInput（parse 徽标/防抖应用）、padRow 光标插入。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

/* ================= DOM 桩（树搜索 querySelector + 光标 API） ================= */
class DomNode {}
const mkCtx = () => new Proxy({}, {
  get(t, k) { if (k === 'measureText') return () => ({ width: 10 }); return k in t ? t[k] : () => {}; },
  set(t, k, v) { t[k] = v; return true; }
});
function matchesSel(el, sel) {
  if (sel.startsWith('#')) return (el._a && el._a.id === sel.slice(1)) || el.id === sel.slice(1);
  if (sel.startsWith('.')) return (el.className || '').split(/\s+/).includes(sel.slice(1));
  return el.tagName === sel.toUpperCase();
}
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
    this.value = ''; this.title = ''; this.className = ''; this.id = '';
    this.selectionStart = null; this.selectionEnd = null;
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
  get textContent() { return this.children.length ? this.children.map((c) => (c && c.textContent) || '').join('') : this._text; }
  set textContent(v) { this._text = String(v); }
  get firstElementChild() { return this.children[0] || null; }
  addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
  removeEventListener() {}
  setAttribute(k, v) { this._a[k] = String(v); if (k === 'id') this.id = String(v); }
  getAttribute(k) { return k in this._a ? this._a[k] : null; }
  appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  remove() { if (this.parentElement) { const i = this.parentElement.children.indexOf(this); if (i >= 0) this.parentElement.children.splice(i, 1); } }
  contains() { return false; }
  closest(sel) { return matchesSel(this, sel) ? this : null; }
  _search(sel, out) { for (const c of this.children) { if (c.matchesSelFn && matchesSel(c, sel)) out.push(c); if (c._search) c._search(sel, out); } return out; }
  querySelector(sel) { const out = this._search(sel, []); return out[0] || reg(String(sel)); }
  querySelectorAll(sel) { return this._search(sel, []); }
  insertAdjacentHTML() {}
  focus() {} select() {} blur() {}
  setPointerCapture() {} releasePointerCapture() {}
  setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
  dispatchEvent(evt) { (this._l[evt.type] || []).forEach((f) => f(evt)); return true; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: this.clientHeight }; }
  getContext() { return this._ctx || (this._ctx = mkCtx()); }
  fire(type, evt) { (this._l[type] || []).forEach((f) => f(evt)); }
}
El.prototype.matchesSelFn = true;

const registry = {};
const reg = (key) => (registry[key] = registry[key] || new El('canvas'));
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};

const timers = new Map();
let timerSeq = 0;
const runTimers = () => { const q = [...timers.entries()]; timers.clear(); q.forEach(([, f]) => f()); };

const sandbox = {
  console,
  Node: DomNode,
  Event: class { constructor(t) { this.type = t; } },
  document: {
    body: new El('body'),
    activeElement: null,
    createElement: (t) => new El(t),
    createTextNode: (t) => ({ data: String(t), textContent: String(t) }),
    addEventListener: () => {},
    removeEventListener: () => {}
  },
  localStorage,
  getComputedStyle: () => ({ fontFamily: 'sans', getPropertyValue: () => '' }),
  matchMedia: () => ({ matches: false }),
  requestAnimationFrame: (f) => 0,
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
for (const f of ['assets/js/lib/util.js', 'assets/js/lib/mathdsp.js', 'assets/js/lib/plots.js',
  'assets/js/lib/fx.js', 'assets/js/lib/transforms.js', 'assets/js/lib/mathinput.js']) {
  vm.runInContext(read(f), sandbox, { filename: f });
}

/* ================= 断言工具 ================= */
let pass = 0;
const fails = [];
const ok = (n, c, extra) => { c ? pass++ : fails.push(n + (extra ? '  → ' + extra : '')); };
const mkEvt = (o) => Object.assign({ key: '', preventDefault() {}, stopPropagation() {}, target: null }, o);
const MI = sandbox.window.MI, FX_LIB = sandbox.window.FX_LIB, TR = sandbox.window.TR;

/* ================= ① 归一化（fx / transforms 入口） ================= */
{
  const t1 = FX_LIB.parseTF('（ｓ＋２）＊（ｓ＋３）');
  ok('全角表达式解析成功', !!t1 && t1.num.length === 3 && Math.abs(t1.num[1] - 5) < 1e-9, JSON.stringify(t1 && t1.num));
  const t2 = FX_LIB.parseTF('s**2+1');
  ok('** 转为 ^', !!t2 && Math.abs(t2.num[2] - 1) < 1e-9);
  const t3 = FX_LIB.parseTF('s²−２');   // Unicode 负号 + 全角数字
  ok('Unicode 负号与全角数字', !!t3 && Math.abs(t3.num[0] - 1) < 1e-9 && Math.abs(t3.num[2] + 2) < 1e-9, JSON.stringify(t3 && t3.num));
  ok('归一化幂等（原文=归一化后解析一致）', (() => { const src = '（ｓ＋２）＊（ｓ＋３）'; return JSON.stringify(FX_LIB.parseTF(src)) === JSON.stringify(FX_LIB.parseTF(sandbox.U.normChars(src))); })());
  const it = TR.parseTimeCombo('３ｅｘｐ（－２ｔ）');
  ok('parseTimeCombo 全角输入', !!it && it.length === 1 && Math.abs(it[0].coef - 3) < 1e-9 && Math.abs(it[0].a - 2) < 1e-9, JSON.stringify(it));
  const it2 = TR.parseZCombo('０．５＾ｎ＊ｕ（ｎ）');
  ok('parseZCombo 全角输入', !!it2 && it2.length === 1 && Math.abs(it2[0].a - 0.5) < 1e-9, JSON.stringify(it2));
}

/* ================= ② 纠错词典 ================= */
{
  ok('末尾运算符', MI.diagnose('s^2+', 's') === '末尾多了运算符', MI.diagnose('s^2+', 's'));
  ok('空括号', MI.diagnose('s()', 's') === '有空的括号');
  ok('i 提示用 j', /j/.test(MI.diagnose('0.5i', 's')));
  ok('括号不配对', /未闭合/.test(MI.diagnose('(s+1', 's')));
  ok('合法串无提示', MI.diagnose('s^2+2*s+5', 's') === null);
}

/* ================= ③ tfInput ================= */
{
  const host = new El('div');
  const applied = [];
  const tf = MI.tfInput(host, {
    variable: 'z',
    properness: true,
    ids: { num: 'mi-num', den: 'mi-den' },
    pad: ['z', '^2', '*', '+'],
    examples: [['1', 'z-0.5', '一阶'], ['z', 'z^2-1', '谐振']],
    historyKey: 'mi-test-tf',
    debounce: 350,
    onApply: (r, source) => applied.push([r.numStr, r.denStr, source])
  });
  ok('tfInput 渲染出指定 id 的输入框', !!host.querySelector('#mi-num') && !!host.querySelector('#mi-den'));

  tf.set('1', 'z-0.5');
  ok('set 后 get 生效', tf.get().numStr === '1' && tf.get().denStr === 'z-0.5');
  const badge = host.querySelector('.hint');
  ok('合法输入给 ✓ 徽标 + LaTeX 预览', badge.textContent.includes('✓') && badge.textContent.includes('H(z)'), badge.textContent);

  runTimers();
  // set() 不触发 onApply；输入事件 + 防抖才触发
  const den = host.querySelector('#mi-den');
  den.value = 'z-0.5';
  den.fire('input', mkEvt({}));
  ok('防抖前不应用', applied.length === 0);
  runTimers();
  ok('输入防抖后自动应用（source=input）', applied.length === 1 && applied[0][2] === 'input', JSON.stringify(applied));

  // 非真分式 → warn 且不应用（z^2/z：分子阶次 > 分母阶次）
  const numI2 = host.querySelector('#mi-num');
  numI2.value = 'z^2';
  den.value = 'z';
  numI2.fire('input', mkEvt({}));
  runTimers();
  ok('非真分式给 ⚠ 且不应用', badge.textContent.includes('⚠') && badge.textContent.includes('非真分式') && applied.length === 1, badge.textContent);

  // 解析失败 → err + 词典提示（0.5*i 中 i 无法解析）
  den.value = '0.5*i';
  den.fire('input', mkEvt({}));
  runTimers();
  ok('解析失败给 ✗ + i→j 提示', badge.textContent.includes('✗') && badge.textContent.includes('j'), badge.textContent);
  ok('解析失败不走应用', applied.length === 1);

  // Enter 应用 + 历史记录
  tf.set('1', 'z^2-0.25');
  den.fire('keydown', mkEvt({ key: 'Enter' }));
  ok('Enter 应用（source=enter）', applied.length === 2 && applied[1][2] === 'enter', JSON.stringify(applied));
  ok('历史写入 localStorage', JSON.parse(store.get('mi-test-tf')).includes('1|z^2-0.25'), store.get('mi-test-tf'));

  // 示例 chip → 应用 + 字段回填
  const exChip = host.querySelectorAll('.chip').find((c) => c.textContent === '一阶');
  exChip.fire('click', mkEvt({}));
  ok('示例 chip 应用（source=example）', applied.length === 3 && applied[2][0] === '1' && applied[2][1] === 'z-0.5' && applied[2][2] === 'example', JSON.stringify(applied));

  // 历史 chip 回填
  const histChip = host.querySelectorAll('.chip').find((c) => c.textContent === '1|z^2-0.25');
  ok('历史 chip 渲染', !!histChip);
  if (histChip) {
    histChip.fire('click', mkEvt({}));
    ok('历史 chip 应用并回填字段', applied.length === 4 && tf.get().denStr === 'z^2-0.25', JSON.stringify(applied));
  }

  // 键盘插入
  tf.set('z', 'z-0.5');
  const num = host.querySelector('#mi-num');
  sandbox.document.activeElement = num;
  const padChip = host.querySelectorAll('.pad-key').find((c) => c.textContent === '+');
  padChip.fire('click', mkEvt({}));
  ok('符号键盘在光标处插入（activeElement 指向分子）', num.value === 'z+' && den.value === 'z-0.5', num.value + ' | ' + den.value);

  // autoApply:false：输入只刷徽标，apply() 才应用
  const host2 = new El('div');
  const applied2 = [];
  const tf2 = MI.tfInput(host2, { autoApply: false, ids: { num: 'mi2-num', den: 'mi2-den' }, onApply: (r) => applied2.push(r.numStr) });
  tf2.set('1', 's+1');
  host2.querySelector('input').fire('input', mkEvt({}));
  runTimers();
  ok('autoApply=false 输入不应用', applied2.length === 0);
  tf2.apply();
  ok('apply() 显式应用', applied2.length === 1 && applied2[0] === '1');

  // 非法时 apply() 返回 null
  tf2.set('s+', '');
  ok('非法输入 apply() 返回 null', tf2.apply() === null);

  tf.destroy(); tf2.destroy();
  ok('destroy 移除 DOM', host.children.length === 0 && host2.children.length === 0);
}

/* ================= ④ exprInput ================= */
{
  const host = new El('div');
  const applied = [];
  const ex = MI.exprInput(host, {
    id: 'ex-test-in',
    placeholder: '输入表达式',
    parse: (str) => (str.includes('bad') ? { verdict: 'err', message: '无法解析' } : { verdict: 'ok', message: '已识别', tex: 'x(t)=t' }),
    pad: ['t', '+'],
    examples: [['t', '斜坡'], ['sin(t)', '正弦']],
    historyKey: 'mi-test-expr',
    debounce: 250,
    onApply: (str, source) => applied.push([str, source])
  });
  ok('exprInput 渲染指定 id 输入框', !!host.querySelector('#ex-test-in'));
  const inp = host.querySelector('#ex-test-in');
  const badge = host.querySelector('.hint');

  inp.value = 't^2';
  inp.fire('input', mkEvt({}));
  runTimers();
  ok('表达式防抖应用', applied.length === 1 && applied[0][0] === 't^2' && applied[0][1] === 'input', JSON.stringify(applied));
  ok('ok 徽标含消息与 tex', badge.textContent.includes('✓') && badge.textContent.includes('已识别') && badge.textContent.includes('x(t)=t'), badge.textContent);

  inp.value = 'bad stuff';
  inp.fire('input', mkEvt({}));
  runTimers();
  ok('err 徽标 + 不应用', badge.textContent.includes('✗') && applied.length === 1);

  inp.value = 'sin(t)';
  inp.fire('keydown', mkEvt({ key: 'Enter' }));
  ok('Enter 立即应用', applied.length === 2 && applied[1][0] === 'sin(t)', JSON.stringify(applied));
  ok('表达式历史记录', JSON.parse(store.get('mi-test-expr')).includes('sin(t)'));

  const exChip = host.querySelectorAll('.chip').find((c) => c.textContent === '斜坡');
  exChip.fire('click', mkEvt({}));
  ok('表达式示例 chip 应用', applied.length === 3 && inp.value === 't', JSON.stringify(applied));

  const padChip = host.querySelectorAll('.pad-key')[0];
  padChip.fire('click', mkEvt({}));
  ok('表达式键盘插入', inp.value === 't' + 't', inp.value);

  ex.destroy();
  ok('exprInput destroy 移除 DOM', host.children.length === 0);
}

/* ================= ⑤ padRow 独立使用 ================= */
{
  const host = new El('div');
  const target = new El('input');
  target.value = 'ab';
  target.selectionStart = 1; target.selectionEnd = 1;
  MI.padRow(host, ['s', '^2'], () => target);
  const chip = host.querySelectorAll('.pad-key')[0];
  let fired = 0;
  target.addEventListener('input', () => fired++);
  chip.fire('click', mkEvt({}));
  ok('padRow 在光标处插入', target.value === 'asb', target.value);
  ok('padRow 派发 input 事件', fired === 1, String(fired));
}

/* ================= 结果输出 ================= */
console.log('\n通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (fails.length) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('✓ MathInput 组件全部通过');
}
