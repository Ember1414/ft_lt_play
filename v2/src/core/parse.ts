/**
 * parse.ts — 表达式解析引擎（自 v1 fx.js 迁移）
 * 传函/多项式解析（parsePoly/parseTF 系列）、自由参数提取与代入、
 * 时域表达式编译（parseTimeExpr，内置递归下降 + 白名单函数表，零外部依赖）。
 * 数值/错误语义与 v1 完全一致（回归网：lib/safeeval/mathinput.test.mjs + parity.mjs）。
 */

import { normChars } from './expr';
import { polyMul, polyAdd } from './poly';
import { TOL_AXIS } from './tol';

/* ============ 多项式/传函解析 ============ */

function stripOuter(s: string): string {
  while (s.length >= 2 && s[0] === '(' && s[s.length - 1] === ')') {
    let d = 0;
    let wrapped = true;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') d++;
      else if (s[i] === ')') {
        d--;
        if (d === 0 && i < s.length - 1) {
          wrapped = false;
          break;
        }
      }
    }
    if (!wrapped) break;
    s = s.slice(1, -1);
  }
  return s;
}

/** 按顶层（括号外）谓词切分 */
export function splitDepth(s: string, pred: (c: string, i: number, start: number) => boolean): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && pred(c, i, start)) {
      parts.push(s.slice(start, i));
      start = i;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

function parseMonomial(t: string, v = 's'): number[] | null {
  let sign = 1;
  if (t[0] === '+') t = t.slice(1);
  else if (t[0] === '-') {
    sign = -1;
    t = t.slice(1);
  }
  if (!t) return [0];
  if (!t.includes(v)) {
    const c = parseFloat(t);
    return isNaN(c) ? null : [sign * c];
  }
  const idx = t.indexOf(v);
  const coefText = t.slice(0, idx).replace('*', '');
  const pPart = t.slice(idx + 1);
  const power = pPart ? parseInt(pPart.replace('^', ''), 10) : 1;
  if (!(power >= 0) || isNaN(power)) return null;
  const c = coefText === '' ? 1 : parseFloat(coefText);
  if (isNaN(c)) return null;
  const out = new Array<number>(power + 1).fill(0);
  out[0] = sign * c;
  return out;
}

function parseFactor(f: string, v = 's'): number[] | null {
  if (!f) return [1];
  // 括号幂：(s+1)^2 → 多项式自乘（支持二重/三重极点的自然写法）
  const pm = f.match(/^\((.+)\)\^(\d+)$/);
  if (pm) {
    const base = parsePoly(pm[1], v);
    if (!base) return null;
    let out = [1];
    for (let i = 0; i < +pm[2]; i++) out = polyMul(out, base);
    return out;
  }
  // 单目项直接解析（s、2*s、z^2、常数…），成功即返回——避免与 parsePoly 互递归
  const mono = parseMonomial(f, v);
  if (mono) return mono;
  // 外层成对括号：剥壳后字符串严格缩短，递归必然终止
  if (f[0] === '(' && f[f.length - 1] === ')') {
    let d = 0;
    let wrapped = true;
    for (let i = 0; i < f.length; i++) {
      if (f[i] === '(') d++;
      else if (f[i] === ')') {
        d--;
        if (d === 0 && i < f.length - 1) {
          wrapped = false;
          break;
        }
      }
    }
    if (wrapped) return parsePoly(f.slice(1, -1), v);
  }
  // 顶层（括号外）含 +/-：按和差拆项（与 parsePoly 的 splitDepth 深度规则一致）
  let d = 0;
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '(') d++;
    else if (f[i] === ')') d--;
    else if (d === 0 && i > 0 && (f[i] === '+' || f[i] === '-')) return parsePoly(f, v);
  }
  return null;
}

/** 解析实系数多项式 → 系数自高到低。支持 (s+2)*(s+3)、s^2+2*s+5。 */
export function parsePoly(str: string | null | undefined, v = 's'): number[] | null {
  if (str == null) return null;
  // 入口归一化：全角字符/负号变体/** 统一转半角（全站解析器共享，见 normChars）
  let s = normChars(str).replace(/\s+/g, '').replace(/\^\((\d+)\)/g, '^$1');
  if (!s) return [0];
  // 括号不平衡直接判非法：否则 parseFactor↔parsePoly 会无限互递归导致栈溢出
  let bal = 0;
  for (const c of s) {
    if (c === '(') bal++;
    else if (c === ')') bal--;
    if (bal < 0) return null;
  }
  if (bal !== 0) return null;
  s = s
    .replace(/\)\(/g, ')*(')
    .replace(new RegExp('(\\d)\\(', 'g'), '$1*(')
    .replace(new RegExp(v + '\\(', 'g'), v + '*(')
    .replace(new RegExp('\\)' + v, 'g'), ')*' + v)
    .replace(new RegExp('\\)(\\d)', 'g'), ')*$1');
  s = stripOuter(s);
  const terms = splitDepth(s, (c, i, start) => i > start && (c === '+' || c === '-'));
  let acc: number[] | null = null;
  for (let term of terms) {
    if (!term || term === '+') continue;
    let sign = 1;
    if (term[0] === '+') term = term.slice(1);
    else if (term[0] === '-') {
      sign = -1;
      term = term.slice(1);
    }
    if (!term) continue;
    const factors = splitDepth(term, (c) => c === '*')
      .map((f) => f.replace(/^\*/, ''))
      .filter(Boolean);
    let prod = [1];
    for (const f of factors) {
      const piece = parseFactor(f, v);
      if (!piece) return null;
      prod = polyMul(prod, piece);
    }
    if (sign < 0) prod = prod.map((x) => -x);
    acc = acc ? polyAdd(acc, prod) : prod;
  }
  return acc || [0];
}

/** 提取表达式中的自由参数名（符号参数功能）：排除变量/函数名（标识符后跟「(」） */
export function extractParams(str: string | null | undefined, exclude?: string[]): string[] {
  const s = normChars(str);
  const ex = new Set(['e', 'j', 'pi', 'PI', ...(exclude || ['s'])]);
  const out: string[] = [];
  const re = /[a-zA-Z_][a-zA-Z0-9_]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const name = m[0];
    let j = re.lastIndex;
    while (j < s.length && /\s/.test(s[j])) j++;
    if (s[j] === '(') continue; // 函数名（sin/exp…）
    if (ex.has(name) || (name.length === 1 && ex.has(name.toLowerCase()))) continue;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** 参数代入：把 scope 中的标识符替换为数值字面量（供 parseTF 解析）
 *  scope 未覆盖的标识符原样保留；数值用足够精度避免解析误差 */
export function substituteParams(str: string, scope: Record<string, number>): string {
  const s = normChars(str);
  if (!scope || !Object.keys(scope).length) return s;
  return s.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, (name) => {
    if (!(name in scope)) return name;
    const v = scope[name];
    if (!isFinite(v)) return name;
    return '(' + Number(v.toPrecision(12)) + ')';
  });
}

/** 传函字符串 → { num, den }（系数自高到低）；非法返回 null */
export function parseTF(str: string | null | undefined, v = 's'): { num: number[]; den: number[] } | null {
  if (!str) return null;
  // 入口归一化：全角（含全角分数线 ／、全角数字/负号）→ ASCII 后再切分子/分母；** → ^ 由 normChars 一并处理
  const s = normChars(String(str)).replace(/\s+/g, '').replace(/\*\*/g, '^');
  const parts = splitDepth(s, (c) => c === '/');
  const num = parsePoly(parts[0], v);
  const denStr = parts.slice(1).map((p) => p.replace(/^\//, '')).join('/');
  const den = denStr ? parsePoly(denStr, v) : [1];
  if (!num || !den) return null;
  if (!(den[0] || 0)) return null;
  return { num, den };
}

/** 分子/分母分栏输入 → 传函；denStr 空且 numStr 含 '/' 时直接走 parseTF */
export function parseTFFields(
  numStr: string | null | undefined,
  denStr: string | null | undefined,
  v = 's',
): { num: number[]; den: number[] } | null {
  let ns = (numStr || '').trim();
  let ds = (denStr || '').trim();
  if (!ds && /\/.+/.test(ns)) return parseTF(ns, v);
  if (!ns) ns = '1';
  if (!ds) ds = '1';
  return parseTF('(' + ns + ')/(' + ds + ')', v);
}

/** 传函字符串 → 分栏文本框内容 */
export function tfToFields(str: string | null | undefined): { num: string; den: string } {
  const s = String(str || '').replace(/\s+/g, '');
  const parts = splitDepth(s, (c) => c === '/');
  return { num: parts[0] || '1', den: parts.slice(1).map((p) => p.replace(/^\//, '')).join('/') || '1' };
}

/* ============ 时域表达式解析（内置解析器，零外部依赖） ============
 * 自 1.1.3 起不再依赖 CDN 的 mathjs：断网 / 网络受限（CDN 不可达）时
 * 「交互求解」的时域信号同样可解析，符合平台 local-first 定位。
 * 语法：数字（含 .5 / 1e-3）· 变量 t · 常量 pi/e/tau · + - * / ^ % ·
 *      括号 · 一元 ± · 隐式乘法（2t、3(t+1)、(t+1)(t-1)、2pi、2sin(t)）
 * 安全：纯递归下降解析 + 白名单函数表，不执行任何字符串代码；
 *      入口限长 300 字符、括号嵌套 ≤ 32 层，杜绝栈溢出与能力滥用。 */

type TimeFn = (...args: number[]) => number;

const TIME_FNS: Record<string, TimeFn> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: (...a) => Math.atan2(a[0], a[1]),
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  pow: (...a) => Math.pow(a[0], a[1]),
  abs: Math.abs,
  sign: Math.sign,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  ln: Math.log,
  log: (...a) => (a.length < 2 ? Math.log(a[0]) : Math.log(a[0]) / Math.log(a[1])),
  log2: Math.log2,
  log10: Math.log10,
  min: Math.min,
  max: Math.max,
  u: (x) => (x >= 0 ? 1 : 0),
  heaviside: (x) => (x > 0 ? 1 : x < 0 ? 0 : 0.5),
  sinc: (x) => (Math.abs(x) < TOL_AXIS ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)),
  rect: (x) => (Math.abs(x) < 0.5 ? 1 : 0),
  tri: (x) => Math.max(0, 1 - Math.abs(x)),
};

const TIME_CONSTS: Record<string, number> = { pi: Math.PI, PI: Math.PI, e: Math.E, tau: 2 * Math.PI };

/** 编译为 f(t) 闭包树；任何非法写法 → 返回 null（调用方按解析失败处理） */
function compileTimeExpr(src: string): ((t: number) => number) | null {
  const s = String(src).replace(/\s+/g, '');
  let i = 0;
  let depth = 0;
  type Fn = (t: number) => number;
  const startsAtom = (c: string | undefined): boolean => c != null && (/[0-9.]/.test(c) || /[A-Za-z_(]/.test(c));
  const eat = (c: string): boolean => {
    if (s[i] === c) {
      i++;
      return true;
    }
    return false;
  };
  function parseExpr(): Fn {
    let f = parseTerm();
    for (;;) {
      if (eat('+')) {
        const l = f;
        const r = parseTerm();
        f = (t) => l(t) + r(t);
      } else if (eat('-')) {
        const l = f;
        const r = parseTerm();
        f = (t) => l(t) - r(t);
      } else return f;
    }
  }
  function parseTerm(): Fn {
    let f = parseUnary();
    for (;;) {
      if (eat('*')) {
        const l = f;
        const r = parseUnary();
        f = (t) => l(t) * r(t);
      } else if (eat('/')) {
        const l = f;
        const r = parseUnary();
        f = (t) => l(t) / r(t);
      } else if (eat('%')) {
        const l = f;
        const r = parseUnary();
        f = (t) => l(t) % r(t);
      }
      // 隐式乘法（终点后紧跟新原子）：2t、3(t+1)、(t+1)(t-1)、2pi、2sin(t)
      else if (startsAtom(s[i])) {
        const l = f;
        const r = parseUnary();
        f = (t) => l(t) * r(t);
      } else return f;
    }
  }
  function parseUnary(): Fn {
    if (eat('+')) return parseUnary();
    if (eat('-')) {
      const r = parseUnary();
      return (t) => -r(t);
    }
    return parsePower();
  }
  function parsePower(): Fn {
    const b = parseAtom();
    if (eat('^')) {
      const e = parseUnary();
      return (t) => Math.pow(b(t), e(t)); // 右结合
    }
    return b;
  }
  function parseAtom(): Fn {
    if (eat('(')) {
      if (++depth > 32) throw new Error('嵌套过深');
      const f = parseExpr();
      if (!eat(')')) throw new Error('括号不闭合');
      depth--;
      return f;
    }
    const num = s.slice(i).match(/^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if (num) {
      i += num[0].length;
      const v = parseFloat(num[0]);
      return () => v;
    }
    const id = s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (!id) throw new Error('非法字符「' + (s[i] || '末尾') + '」');
    const name = id[0];
    i += name.length;
    if (s[i] === '(') {
      // 函数调用（仅白名单）
      const fn = Object.prototype.hasOwnProperty.call(TIME_FNS, name) ? TIME_FNS[name] : null;
      if (!fn) throw new Error('不支持的函数「' + name + '」');
      i++;
      const args = [parseExpr()];
      while (eat(',')) args.push(parseExpr());
      if (!eat(')')) throw new Error('函数 ' + name + ' 缺少右括号');
      if (args.length === 1) return (t) => fn(args[0](t));
      return (t) => fn(...args.map((a) => a(t)));
    }
    if (name === 't') return (t) => t;
    if (Object.prototype.hasOwnProperty.call(TIME_CONSTS, name)) {
      const v = TIME_CONSTS[name];
      return () => v;
    }
    throw new Error('未知符号「' + name + '」');
  }
  try {
    const f = parseExpr();
    if (i !== s.length) return null; // 有残留 → 非法
    for (const q of [0.1, 1, 2.5]) if (!isFinite(f(q))) return null; // 抽样必须有限
    return f;
  } catch {
    return null;
  }
}

/** 时域表达式 → f(t)；与其他解析入口一致先做归一化；非法/超长返回 null */
export function parseTimeExpr(str: string | null | undefined): ((t: number) => number) | null {
  // 与其他解析入口一致：先做全角/Unicode 负号/上标/** 归一化（normChars）
  const s0 = normChars(String(str || ''));
  if (!s0.trim() || s0.length > 300) return null;
  return compileTimeExpr(s0);
}