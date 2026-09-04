/* ============================================================
 * plots.js — Canvas 图表基类 + KaTeX 渲染助手
 *   Plot 支持：滚轮/双指缩放（含对数轴）、拖拽/单指平移、
 *   双击复位、悬停十字线+精度读数、曲线自动裁剪
 *   颜色全部来自 CSS 变量（--cv-*），支持主题切换
 * ============================================================ */
const FX = (() => {
  /* ---------- 主题色（CSS 变量读取 + 缓存） ---------- */
  let themeVer = 0;
  const colorCache = { _ver: -1 };
  function cvCol(name) {
    if (colorCache._ver !== themeVer) { for (const k of Object.keys(colorCache)) if (k !== '_ver') delete colorCache[k]; colorCache._ver = themeVer; }
    if (!(name in colorCache)) colorCache[name] = (getComputedStyle(document.body).getPropertyValue(name) || '').trim() || '#888888';
    return colorCache[name];
  }
  function refreshTheme() { themeVer++; FX.themeVer = themeVer; }

  /* ---------- KaTeX ---------- */
  function katex(tex, el, { displayMode = false } = {}) {
    if (!window.katex) { if (el) el.textContent = tex; return; }
    try {
      window.katex.render(tex, el, { throwOnError: false, displayMode });
    } catch (e) { if (el) el.textContent = tex; }
  }
  function span(tex, cls = '') {
    const s = document.createElement('span');
    if (cls) s.className = cls;
    katex(tex, s);
    return s;
  }
  function div(tex, cls = 'formula-center') {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    katex(tex, d, { displayMode: true });
    return d;
  }

  /* ---------- 通用 Canvas 绘图 ---------- */
  class Plot {
    constructor(canvas, { margin = { l: 54, r: 16, t: 14, b: 34 }, padding = 0.05, logX = false, logY = false, zoom = true, pan = true, hover = true, dblclickReset = true } = {}) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.margin = margin;
      this.padding = padding;
      this.logX = logX; this.logY = logY;
      this.zoomEnabled = zoom; this.panEnabled = pan;
      this.hoverEnabled = hover; this.dblclickReset = dblclickReset;
      this.xmin = 0; this.xmax = 1; this.ymin = 0; this.ymax = 1;
      this.userAdjusted = false;   // 用户手动缩放/平移后，忽略模块的 setRange
      this.hoverPx = null;
      this._bg = null; this._bgVer = -1;
      this._pointers = new Map();
      this._pinch = null;
      this._setupSize();
      this._bind();
      canvas._fxPlot = this;
      if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
        this.ro = new ResizeObserver(() => { this._setupSize(); if (this.onDraw) this.onDraw(); });
        this.ro.observe(canvas.parentElement);
      }
    }
    _setupSize() {
      const w = this.cv.clientWidth || this.cv.parentElement.clientWidth || 400;
      const h = this.cv.clientHeight || this.cv.parentElement.clientHeight || 300;
      const dpr = window.devicePixelRatio || 1;
      this.W = w; this.H = h;
      // 尺寸没变就不重设属性，避免 RO 初始回调清空已绘制内容
      const nw = Math.round(w * dpr), nh = Math.round(h * dpr);
      if (this.cv.width !== nw || this.cv.height !== nh) { this.cv.width = nw; this.cv.height = nh; }
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.drawableW = w - this.margin.l - this.margin.r;
      this.drawableH = h - this.margin.t - this.margin.b;
    }

    /* ---------- 交互：缩放 / 平移 / 悬停 / 双指 ---------- */
    _bind() {
      const cv = this.cv;
      const pointers = this._pointers;
      const twoPts = () => [...pointers.values()].slice(0, 2);
      const toCanvas = (cx, cy) => {
        const r = cv.getBoundingClientRect();
        return [(cx - r.left) * (cv.clientWidth / r.width), (cy - r.top) * (cv.clientHeight / r.height)];
      };

      if (this.zoomEnabled) {
        cv.addEventListener('wheel', (e) => {
          const r = cv.getBoundingClientRect();
          const px = (e.clientX - r.left) * (cv.clientWidth / r.width);
          const py = (e.clientY - r.top) * (cv.clientHeight / r.height);
          if (!this._inData(px, py)) return;
          e.preventDefault();
          // 向上滚（deltaY<0）= 放大
          const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
          this._zoomAt(px, py, factor);
        }, { passive: false });
      }
      if (this.dblclickReset) {
        cv.addEventListener('dblclick', () => { this.resetView(); });
      }

      cv.addEventListener('pointerdown', (e) => {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2 && this.zoomEnabled) {
          const [a, b] = twoPts();
          this._pinch = { d: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)) };
          this._drag = null;
        } else if (pointers.size === 1 && this.panEnabled && e.button === 0) {
          this._drag = { x: e.clientX, y: e.clientY };
          cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
        }
      });
      cv.addEventListener('pointermove', (e) => {
        const tracked = pointers.has(e.pointerId);
        if (tracked) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        // 双指捏合缩放：张开（d 变大）= 放大
        if (this._pinch && pointers.size >= 2) {
          const [a, b] = twoPts();
          const d = Math.max(20, Math.hypot(a.x - b.x, a.y - b.y));
          const [px, py] = toCanvas((a.x + b.x) / 2, (a.y + b.y) / 2);
          this._zoomAt(px, py, d / this._pinch.d);
          this._pinch.d = d;
          e.preventDefault();
          return;
        }
        // 单指/鼠标拖拽平移
        if (this._drag) {
          const dx = e.clientX - this._drag.x, dy = e.clientY - this._drag.y;
          if (this._drag.moved || Math.abs(dx) + Math.abs(dy) > 3) {
            this._drag.moved = true;
            this.hoverPx = null;
            this._pan(dx, dy);
            this._drag.x = e.clientX; this._drag.y = e.clientY;
            cv.style.cursor = 'grabbing';
          }
          return;
        }
        // 悬停读数（鼠标）
        if (this.hoverEnabled && !tracked) {
          const r = cv.getBoundingClientRect();
          const px = (e.clientX - r.left) * (cv.clientWidth / r.width);
          const py = (e.clientY - r.top) * (cv.clientHeight / r.height);
          const inside = this._inData(px, py);
          const changed = (this.hoverPx == null) !== !inside || (this.hoverPx && (this.hoverPx.x !== px || this.hoverPx.y !== py));
          this.hoverPx = inside ? { x: px, y: py } : null;
          if (changed) { const cb = this.onUpdate || this.onDraw; if (cb) cb(); }
        }
      });
      const endPointer = (e) => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) this._pinch = null;
        if (pointers.size === 0) { this._drag = null; cv.style.cursor = ''; }
      };
      cv.addEventListener('pointerup', endPointer);
      cv.addEventListener('pointercancel', endPointer);
      cv.addEventListener('pointerleave', (e) => {
        endPointer(e);
        if (e.pointerType === 'mouse' && this.hoverEnabled && this.hoverPx) {
          this.hoverPx = null;
          const cb = this.onUpdate || this.onDraw; if (cb) cb();
        }
      });
    }
    _inData(px, py) {
      const m = this.margin;
      return px >= m.l && px <= m.l + this.drawableW && py >= m.t && py <= m.t + this.drawableH;
    }
    // 像素 → 世界坐标（对数轴已处理）
    xAt(px) {
      if (this.logX) {
        const a = Math.log10(Math.max(this.xmin, 1e-300)), b = Math.log10(Math.max(this.xmax, 1e-299));
        return Math.pow(10, U.mapRange(px, this.margin.l, this.margin.l + this.drawableW, a, b));
      }
      return U.mapRange(px, this.margin.l, this.margin.l + this.drawableW, this.xmin, this.xmax);
    }
    yAt(py) {
      if (this.logY) {
        const a = Math.log10(Math.max(this.ymin, 1e-300)), b = Math.log10(Math.max(this.ymax, 1e-299));
        return Math.pow(10, U.mapRange(py, this.margin.t + this.drawableH, this.margin.t, a, b));
      }
      return U.mapRange(py, this.margin.t + this.drawableH, this.margin.t, this.ymin, this.ymax);
    }
    // factor>1 = 放大（视野变小），factor<1 = 缩小
    _zoomAt(px, py, factor) {
      if (!this._inData(px, py)) return;
      const k = 1 / factor;   // 跨度缩放系数与放大倍数互为倒数
      this.userAdjusted = true;
      const wx = this.xAt(px), wy = this.yAt(py);
      const clampSpan = (lo, hi) => {
        const span = hi - lo;
        if (span < 1e-12) { const c = (lo + hi) / 2; return [c - 1e-12, c + 1e-12]; }
        if (span > 1e15) { const c = (lo + hi) / 2; return [c - 1e15, c + 1e15]; }
        return [lo, hi];
      };
      if (this.logX) {
        const lx = Math.log10(wx), a = Math.log10(Math.max(this.xmin, 1e-300)), b = Math.log10(Math.max(this.xmax, 1e-299));
        this.xmin = Math.pow(10, lx - (lx - a) * k);
        this.xmax = Math.pow(10, lx + (b - lx) * k);
      } else {
        this.xmin = wx - (wx - this.xmin) * k;
        this.xmax = wx + (this.xmax - wx) * k;
        [this.xmin, this.xmax] = clampSpan(this.xmin, this.xmax);
      }
      if (this.logY) {
        const ly = Math.log10(wy), a = Math.log10(Math.max(this.ymin, 1e-300)), b = Math.log10(Math.max(this.ymax, 1e-299));
        this.ymin = Math.pow(10, ly - (ly - a) * k);
        this.ymax = Math.pow(10, ly + (b - ly) * k);
      } else {
        this.ymin = wy - (wy - this.ymin) * k;
        this.ymax = wy + (this.ymax - wy) * k;
        [this.ymin, this.ymax] = clampSpan(this.ymin, this.ymax);
      }
      { const cb = this.onUpdate || this.onDraw; if (cb) cb(); }
    }
    _pan(dpx, dpy) {
      this.userAdjusted = true;
      if (this.logX) {
        const a = Math.log10(this.xmin), b = Math.log10(this.xmax);
        const sh = -(dpx / this.drawableW) * (b - a);
        this.xmin = Math.pow(10, a + sh); this.xmax = Math.pow(10, b + sh);
      } else {
        const sh = -(dpx / this.drawableW) * (this.xmax - this.xmin);
        this.xmin += sh; this.xmax += sh;
      }
      if (this.logY) {
        const a = Math.log10(this.ymin), b = Math.log10(this.ymax);
        const sh = (dpy / this.drawableH) * (b - a);
        this.ymin = Math.pow(10, a + sh); this.ymax = Math.pow(10, b + sh);
      } else {
        const sh = (dpy / this.drawableH) * (this.ymax - this.ymin);
        this.ymin += sh; this.ymax += sh;
      }
      { const cb = this.onUpdate || this.onDraw; if (cb) cb(); }
    }
    resetView() {
      this.userAdjusted = false;
      if (this._initial) this.setRange(this._initial[0], this._initial[1], this._initial[2], this._initial[3], true);
      { const cb = this.onUpdate || this.onDraw; if (cb) cb(); }
    }

    // 世界范围（fit 同样尊重 userAdjusted）
    fit(charts) {
      let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
      const visit = (xs, ys) => {
        if (!xs || !ys || !xs.length) return;
        for (let i = 0; i < xs.length; i++) {
          const x = xs[i], y = ys[i];
          if (!isFinite(y)) continue;
          if (x < xmin) xmin = x; if (x > xmax) xmax = x;
          if (y < ymin) ymin = y; if (y > ymax) ymax = y;
        }
      };
      for (const c of charts) visit(c.x, c.y);
      if (xmin === Infinity) { xmin = 0; xmax = 1; }
      if (ymin === Infinity) { ymin = 0; ymax = 1; }
      this.setRange(xmin, xmax, ymin, ymax);
    }
    autoRange(ymin, ymax) { this.setRange(this.xmin, this.xmax, ymin, ymax); }
    setRange(xmin, xmax, ymin, ymax, force) {
      if (this.userAdjusted && !force) return;
      if (xmin === xmax) { xmin -= 1; xmax += 1; }
      if (ymin === ymax) { ymin -= 1; ymax += 1; }
      const px = (xmax - xmin) * this.padding, py = (ymax - ymin) * this.padding;
      this.xmin = xmin - px; this.xmax = xmax + px; this.ymin = ymin - py; this.ymax = ymax + py;
      // 对数轴：padding 不得把下界推到 0 以下——最多缩到原下界的一半
      if (this.logX) this.xmin = (xmin > 0) ? Math.max(this.xmin, xmin / 2) : 1e-12;
      if (this.logY) this.ymin = (ymin > 0) ? Math.max(this.ymin, ymin / 2) : 1e-12;
      this._initial = [this.xmin, this.xmax, this.ymin, this.ymax];
    }
    sx(x) {
      if (this.logX) x = Math.log10(Math.max(x, 1e-12));
      const a = this.logX ? Math.log10(this.xmin) : this.xmin;
      const b = this.logX ? Math.log10(this.xmax) : this.xmax;
      return this.margin.l + U.mapRange(x, a, b, 0, this.drawableW);
    }
    sy(y) {
      if (this.logY) y = Math.log10(Math.max(y, 1e-12));
      const a = this.logY ? Math.log10(this.ymin) : this.ymin;
      const b = this.logY ? Math.log10(this.ymax) : this.ymax;
      return this.margin.t + this.drawableH - U.mapRange(y, a, b, 0, this.drawableH);
    }
    clear() {
      const { ctx } = this;
      if (this._bg == null || this._bgVer !== FX.themeVer) {
        this._bg = cvCol('--cv-bg');
        this._bgVer = FX.themeVer;
      }
      ctx.save();
      ctx.fillStyle = this._bg;
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.restore();
    }
    clip() { this.ctx.save(); this.ctx.beginPath(); this.ctx.rect(this.margin.l, this.margin.t, this.drawableW, this.drawableH); this.ctx.clip(); }
    unclip() { this.ctx.restore(); }
    /* 网格：未缩放时尊重调用方固定步长；缩放后（或未给步长）自适应，
       目标约 6 条网格线；对数轴按跨度选刻度档位；标签按像素间距过滤防重合 */
    grid(xstep, ystep, { xtickFmt, ytickFmt } = {}) {
      const { ctx } = this;
      ctx.strokeStyle = cvCol('--cv-grid'); ctx.lineWidth = 1; ctx.fillStyle = cvCol('--cv-tick');
      ctx.font = '10px SFMono-Regular, monospace';
      const top = this.margin.t, bot = this.margin.t + this.drawableH;
      const left = this.margin.l, right = this.margin.l + this.drawableW;

      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const xs = this.axisTicks('x', xstep);
      let lastRight = -Infinity;
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i];
        const px = this.sx(x);
        if (px < left - 1 || px > right + 1) continue;
        ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, bot); ctx.stroke();
        const label = xtickFmt ? xtickFmt(x) : this.fmtTick(x, xs.step, this.logX);
        if (!label) continue;
        const w = ctx.measureText(label).width;
        if (px - w / 2 < lastRight + 6) continue;
        lastRight = px + w / 2;
        ctx.fillText(label, px, bot + 5);
      }

      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      const ys = this.axisTicks('y', ystep);
      // 刻度值从小到大 → 像素从上到下递减；先画网格，再按像素从上到下标数字
      const yItems = [];
      for (let i = 0; i < ys.length; i++) {
        const y = ys[i];
        const py = this.sy(y);
        if (py < top - 1 || py > bot + 1) continue;
        yItems.push({ y, py });
        ctx.beginPath(); ctx.moveTo(left, py); ctx.lineTo(right, py); ctx.stroke();
      }
      yItems.sort((a, b) => a.py - b.py);
      let lastPy = -Infinity;
      for (let i = 0; i < yItems.length; i++) {
        const { y, py } = yItems[i];
        const label = ytickFmt ? ytickFmt(y) : this.fmtTick(y, ys.step, this.logY);
        if (!label) continue;
        if (py < lastPy + 12) continue;
        lastPy = py;
        ctx.fillText(label, left - 6, py);
      }
    }
    // 轴刻度生成：返回数组并挂 .step（线性）供格式化
    axisTicks(axis, fixedStep) {
      const isLog = axis === 'x' ? this.logX : this.logY;
      const lo = axis === 'x' ? this.xmin : this.ymin;
      const hi = axis === 'x' ? this.xmax : this.ymax;
      const pxLen = axis === 'x' ? this.drawableW : this.drawableH;
      let out = [];
      if (isLog) {
        const a = Math.log10(Math.max(lo, 1e-300)), b = Math.log10(Math.max(hi, 1e-299));
        const decades = b - a;
        // 跨度大：只标整十；中：1,2,5；小：副刻度 2,5,10
        let mults, stride = 1;
        if (decades > 12) { mults = [1]; stride = Math.ceil(decades / 6); }  // 超大跨度：每 stride 个十进位取一条
        else if (decades > 3.5) mults = [1];
        else if (decades > 1.6) mults = [1, 2, 5];
        else mults = [2, 5, 10];
        for (let e = Math.floor(a); e <= Math.ceil(b); e++) {
          if (mults.length === 1 && stride > 1 && (e - Math.floor(a)) % stride !== 0) continue;
          for (const m of mults) {
            const v = m * Math.pow(10, e);
            if (v >= lo && v <= hi) out.push(v);
          }
        }
        // 相邻像素过近时抽稀（保底 4 条）
        const toPx = (v) => axis === 'x' ? this.sx(v) : this.sy(v);
        while (out.length > 4) {
          let minGap = Infinity;
          for (let i = 1; i < out.length; i++) minGap = Math.min(minGap, Math.abs(toPx(out[i]) - toPx(out[i - 1])));
          if (minGap >= 30) break;
          out = out.filter((_, i) => i % 2 === 0 || i === out.length - 1);   // 隔一取一（保尾）
        }
        return out;
      }
      // 线性：用户未缩放且给了固定步长 → 用固定；否则自适应 ~6 格
      let step = (!this.userAdjusted && fixedStep) ? fixedStep : niceStep((hi - lo) / 6);
      let v = Math.ceil(lo / step) * step;
      let guard = 0;
      for (; v <= hi + step * 1e-9 && guard < 500; v += step, guard++) {
        if (v >= lo - step * 1e-9 && v <= hi + step * 1e-9) out.push(+v.toPrecision(12));
      }
      out.step = step;
      return out;
    }
    // 刻度数字：小数位随步长自适应（步长 0.001 → 3 位）
    fmtTick(v, step, isLog) {
      if (isLog) { if (v <= 0) return ''; return Math.abs(v) >= 10000 || Math.abs(v) < 0.01 ? v.toExponential(0) : +v.toPrecision(3) + ''; }
      let d = 0;
      if (step && step > 0) d = Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
      else d = 1;
      const n = +v.toFixed(d);
      return Math.abs(n) >= 1e6 || (Math.abs(n) > 0 && Math.abs(n) < 1e-4) ? n.toExponential(1) : n + '';
    }
    ticks(min, max, step) {
      // 兼容旧接口：固定步长刻度
      if (this.logX || this.logY) {
        const a = Math.ceil(Math.log10(Math.max(min, 1e-300))), b = Math.floor(Math.log10(Math.max(max, 1e-299)));
        const out = [];
        for (let e = a; e <= b; e++) {
          for (const m of [1, 2, 5]) { const v = m * Math.pow(10, e); if (v >= min && v <= max) out.push(v); }
        }
        return out;
      }
      if (step == null) step = niceStep((max - min) / 5);
      const out = [];
      let v = Math.ceil(min / step) * step;
      for (; v <= max; v += step) out.push(+v.toPrecision(10));
      return out;
    }
    line(xs, ys, { color = '#5b9bff', width = 2, fill, fillUpTo = null } = {}) {
      const { ctx } = this;
      ctx.save();
      // 默认裁剪到绘图区，曲线不会溢出面板
      ctx.beginPath();
      ctx.rect(this.margin.l, this.margin.t, this.drawableW, this.drawableH);
      ctx.clip();
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < xs.length; i++) {
        const px = this.sx(xs[i]), py = this.sy(ys[i]);
        if (!isFinite(py) || !isFinite(px)) { started = false; continue; }
        if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
      }
      ctx.stroke();
      if (fill) {
        const base = fillUpTo != null ? this.sy(fillUpTo) : this.margin.t + this.drawableH;
        ctx.lineTo(this.sx(xs[xs.length - 1]), base);
        ctx.lineTo(this.sx(xs[0]), base);
        ctx.closePath();
        ctx.fillStyle = fill; ctx.fill();
      }
      ctx.restore();
    }
    dots(xs, ys, { color = '#37d0a0', r = 2.5 } = {}) {
      const { ctx } = this;
      ctx.save();
      ctx.beginPath();
      ctx.rect(this.margin.l, this.margin.t, this.drawableW, this.drawableH);
      ctx.clip();
      ctx.fillStyle = color;
      for (let i = 0; i < xs.length; i++) { ctx.beginPath(); ctx.arc(this.sx(xs[i]), this.sy(ys[i]), r, 0, 7); ctx.fill(); }
      ctx.restore();
    }
    axis(origin = false) {
      const { ctx } = this;
      ctx.save();
      ctx.strokeStyle = cvCol('--cv-axis'); ctx.lineWidth = 1;
      ctx.beginPath();
      if (this.logX) { } else {
        let y0 = this.sy(0);
        if (y0 < this.margin.t) y0 = this.margin.t;
        if (y0 > this.margin.t + this.drawableH) y0 = this.margin.t + this.drawableH;
        ctx.moveTo(this.margin.l, y0); ctx.lineTo(this.margin.l + this.drawableW, y0);
      }
      if (this.logY) { } else {
        let x0 = this.sx(0);
        if (x0 < this.margin.l) x0 = this.margin.l;
        if (x0 > this.margin.l + this.drawableW) x0 = this.margin.l + this.drawableW;
        ctx.moveTo(x0, this.margin.t); ctx.lineTo(x0, this.margin.t + this.drawableH);
      }
      ctx.stroke();
      ctx.restore();
    }
    label(text, x, y, { color, size = 11, align = 'left', baseline = 'alphabetic' } = {}) {
      const { ctx } = this;
      ctx.fillStyle = color || cvCol('--cv-label');
      ctx.font = `${size}px ${getComputedStyle(document.body).fontFamily}`;
      ctx.textAlign = align; ctx.textBaseline = baseline;
      ctx.fillText(text, x, y);
    }
    /* 悬停十字线 + 精度读数（模块在重绘末尾调用） */
    crosshair(fmtX, fmtY) {
      if (!this.hoverEnabled || !this.hoverPx) return null;
      const { x: px, y: py } = this.hoverPx;
      if (!this._inData(px, py)) return null;
      const wx = this.xAt(px), wy = this.yAt(py);
      const { ctx } = this;
      ctx.save();
      ctx.strokeStyle = cvCol('--cv-crosshair');
      ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, this.margin.t); ctx.lineTo(px, this.margin.t + this.drawableH);
      ctx.moveTo(this.margin.l, py); ctx.lineTo(this.margin.l + this.drawableW, py);
      ctx.stroke();
      ctx.setLineDash([]);
      // 精度随当前视野跨度自适应：跨度的 ~0.1% 作为有效数字
      const spanX = Math.abs(this.xmax - this.xmin), spanY = Math.abs(this.ymax - this.ymin);
      const dX = U.clamp(Math.round(-Math.log10(spanX / 1000)), 0, 8);
      const dY = U.clamp(Math.round(-Math.log10(spanY / 1000)), 0, 8);
      const txt1 = fmtX ? fmtX(wx) : 'x=' + (+wx.toFixed(dX));
      const txt2 = fmtY ? fmtY(wy, wx) : 'y=' + (+wy.toFixed(dY));
      ctx.font = '11px SFMono-Regular, monospace';
      const bw = Math.max(ctx.measureText(txt1).width, ctx.measureText(txt2).width) + 16;
      const bh = 38;
      let bx = px + 12, by = py - bh - 10;
      if (bx + bw > this.margin.l + this.drawableW) bx = px - bw - 12;
      if (by < this.margin.t) by = py + 14;
      ctx.fillStyle = cvCol('--cv-readout-bg');
      ctx.strokeStyle = cvCol('--cv-readout-border');
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(bx, by, bw, bh, 6) : ctx.rect(bx, by, bw, bh);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = cvCol('--cv-text'); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(txt1, bx + 8, by + 6);
      ctx.fillStyle = cvCol('--cv-line2');
      ctx.fillText(txt2, bx + 8, by + 20);
      ctx.restore();
      return { x: wx, y: wy };
    }
  }

  function niceStep(range) {
    if (range <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(range)));
    const m = range / pow;
    let nm = 1;
    if (m >= 5) nm = 5; else if (m >= 2) nm = 2; else if (m >= 1) nm = 1;
    return nm * pow;
  }

  function redrawFold(details) {
    if (!details.open) return;
    requestAnimationFrame(() => {
      details.querySelectorAll('canvas.plot').forEach((cv) => {
        const p = cv._fxPlot;
        if (p) { p._setupSize(); if (p.onDraw) p.onDraw(); }
        else if (typeof cv._redraw === 'function') cv._redraw();
      });
    });
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('toggle', (e) => {
      if (e.target && e.target.classList && e.target.classList.contains('plot-fold')) redrawFold(e.target);
    }, true);
  }

  function enablePlotChrome(root) {
    (root || document).querySelectorAll('.canvas-wrap').forEach((wrap) => {
      if (wrap.dataset.chrome || wrap.querySelector('.draw-canvas')) return;
      wrap.dataset.chrome = '1';
      const h = document.createElement('div');
      h.className = 'plot-resize';
      h.title = '拖拽调整图高';
      wrap.appendChild(h);
      let startY = 0, startH = 0;
      const onMove = (e) => {
        const nh = Math.max(80, Math.min(900, startH + (e.clientY - startY)));
        wrap.style.height = nh + 'px';
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      h.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startY = e.clientY;
        startH = wrap.getBoundingClientRect().height;
        try { h.setPointerCapture(e.pointerId); } catch (err) { }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    });
  }

  const api = { katex, span, div, Plot, niceStep, cvCol, refreshTheme, enablePlotChrome };
  api.themeVer = themeVer;
  return api;
})();

window.FX = FX;
