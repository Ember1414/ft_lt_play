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

  return { $, $$, clamp, lerp, mapRange, el, html, loop, throttle, fmt, toDb, angle, mag, cadd, cscale, cmul, cexp, polar, fitRange, shuffle };
})();

window.U = U;