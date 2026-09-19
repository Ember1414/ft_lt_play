/* ============================================================
 * util.js — 通用工具函数
 * ============================================================ */
const U = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Clamp / map
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mapRange = (v, a0, a1, b0, b1) => b0 + ((v - a0) * (b1 - b0)) / (a1 - a0);

  // DOM 帮助
  const el = (tag, attrs = {}, children = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else n.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
      if (c != null) n.append(c instanceof Node ? c : document.createTextNode(c));
    }
    return n;
  };

  const html = (tag, s) => { const n = document.createElement(tag); n.innerHTML = s; return n; };

  // requestAnimationFrame 循环帮助
  const loop = (fn) => { let raf, running = false; const tick = () => { if (!running) return; fn(); raf = requestAnimationFrame(tick); }; return {
    start() { if (running) return; running = true; raf = requestAnimationFrame(tick); },
    stop() { running = false; if (raf) cancelAnimationFrame(raf); },
    get running() { return running; }
  }; };

  // 节流
  const throttle = (fn, ms) => { let last = 0; return (...a) => { const now = Date.now(); if (now - last >= ms) { last = now; fn(...a); } }; };

  const fmt = (n, d = 3) => {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    if (Math.abs(n) < 1e-12) n = 0;
    return (Math.abs(n) >= 1000 || (Math.abs(n) > 0 && Math.abs(n) < 0.001))
      ? n.toExponential(2) : Number(n.toFixed(d)).toString();
  };

  const toDb = (n) => 20 * Math.log10(Math.max(Math.abs(n), 1e-12));
  const angle = (c) => Math.atan2(c.im, c.re);
  const mag = (c) => Math.hypot(c.re, c.im);

  // 复数
  const cadd = (a, b) => ({ re: a.re + b.re, im: a.im + b.im });
  const cscale = (a, k) => ({ re: a.re * k, im: a.im * k });
  const cmul = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
  const cexp = (ph) => ({ re: Math.cos(ph), im: Math.sin(ph) });

  // 极坐标与直角坐标
  const polar = (mag, ph) => ({ re: mag * Math.cos(ph), im: mag * Math.sin(ph) });

  // 线性映射到画布
  const fitRange = (min, max, pad = 0.05) => {
    if (min === max) { min -= 1; max += 1; }
    const r = (max - min) * pad;
    return [min - r, max + r];
  };

  // Knuth 洗牌（保留原数组）
  const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // 上标数字/ⁿ → ^N（注意 ¹²³ 属 Latin-1 区段，与 ⁴-⁹ 不同）
  const SUPS = { '\u2070': '0', '\u00B9': '1', '\u00B2': '2', '\u00B3': '3', '\u2074': '4', '\u2075': '5', '\u2076': '6', '\u2077': '7', '\u2078': '8', '\u2079': '9', '\u207F': 'n' };
  // 全角/Unicode 变体归一化（全站数学表达式解析器的统一入口处理）：
  // FF01–FF5E 全角 ASCII → 半角、全角空格、中文顿号/句号 → 逗号、Unicode 负号/破折号 → -、上标 → ^N、** → ^
  const normChars = (s) => String(s == null ? '' : s)
    .replace(/[\uFF01-\uFF5E\u3000]/g, (c) => (c === '\u3000' ? ' ' : String.fromCharCode(c.charCodeAt(0) - 0xFEE0)))
    .replace(/[，、]/g, ',').replace(/[。．]/g, '.')
    .replace(/[\u2010-\u2015\u2212\uFF0D]/g, '-')
    .replace(/[\u2070\u00B9\u00B2\u00B3\u2074-\u2079\u207F]/g, (c) => '^' + SUPS[c])
    .replace(/\*\*/g, '^');

  // 多项式 → KaTeX 片段（自高到低系数；vn 为变量名，默认 s；全零返回 '0'）
  const polyTex = (c, vn = 's') => {
    let out = '';
    for (let i = 0; i < c.length; i++) {
      const pow = c.length - 1 - i, a = c[i];
      if (Math.abs(a) < 1e-9) continue;
      // 首项也要带负号（前导零被跳过后，i===0 未必是首个输出项）
      const sgn = out === '' ? (a < 0 ? '-' : '') : (a > 0 ? '+' : '-');
      const coef = (Math.abs(Math.abs(a) - 1) < 1e-9 && pow > 0) ? '' : fmt(Math.abs(a), 3);
      out += sgn + coef + (pow === 0 ? '' : pow === 1 ? vn : vn + '^{' + pow + '}');
    }
    return out || '0';
  };

  // 白名单算术求值器（替代 Function/eval 执行用户常量表达式，如 sin(π*2*t) 的括号内）
  // 语法：数字 · + - * / ^ % · 括号 · 一元 ± · 常量 pi/e；其余一律抛错。
  // 深度限制防超长嵌套括号打爆调用栈。
  const safeCalc = (src) => {
    const s = String(src == null ? '' : src).replace(/\s+/g, '');
    if (!s || s.length > 200) throw new Error('表达式为空或过长');
    let i = 0, depth = 0;
    const peek = () => s[i];
    const eat = (c) => { if (s[i] === c) { i++; return true; } return false; };
    function parseExpr() {
      let v = parseTerm();
      for (;;) {
        if (eat('+')) v += parseTerm();
        else if (eat('-')) v -= parseTerm();
        else return v;
      }
    }
    function parseTerm() {
      let v = parseUnary();
      for (;;) {
        if (eat('*')) v *= parseUnary();
        else if (eat('/')) { const d = parseUnary(); if (d === 0) throw new Error('除零'); v /= d; }
        else if (eat('%')) { const d = parseUnary(); if (d === 0) throw new Error('模零'); v %= d; }
        else return v;
      }
    }
    function parseUnary() {
      if (eat('-')) return -parseUnary();
      if (eat('+')) return parseUnary();
      return parsePow();
    }
    function parsePow() {
      const b = parseAtom();
      if (eat('^')) return Math.pow(b, parseUnary());   // 右结合
      return b;
    }
    function parseAtom() {
      if (eat('(')) {
        if (++depth > 32) throw new Error('嵌套过深');
        const v = parseExpr();
        if (!eat(')')) throw new Error('括号不闭合');
        depth--;
        return v;
      }
      const m = s.slice(i).match(/^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/);
      if (m) { i += m[0].length; return parseFloat(m[0]); }
      if (s.startsWith('pi', i)) { i += 2; return Math.PI; }
      if (s[i] === 'e' && !/[0-9.]/.test(s[i + 1] || '')) { i++; return Math.E; }
      throw new Error('非法字符或写法「' + (s[i] || '末尾') + '」');
    }
    const v = parseExpr();
    if (i !== s.length) throw new Error('存在无法解析的残留「' + s.slice(i).slice(0, 12) + '」');
    if (!isFinite(v)) throw new Error('结果非有限数');
    return v;
  };

  return { $, $$, clamp, lerp, mapRange, el, html, loop, throttle, fmt, toDb, angle, mag, cadd, cscale, cmul, cexp, polar, fitRange, shuffle, polyTex, normChars, safeCalc };
})();

window.U = U;
