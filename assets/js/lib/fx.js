/* ============================================================
 * fx.js — 信号/函数目录，形状生成，预设系统，表达式解析
 * ============================================================ */
const FX_LIB = (() => {
  /* ============ 傅立叶级数：笔画形状（返回复数点） ============ */
  function shapePoints(kind, N = 500) {
    const P = [];
    const push = (x, y) => P.push({ re: x, im: y });
    switch (kind) {
      case 'square': { const C = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]; for (let i = 0; i < N; i++) { const t = (i / N) * 4; const e = Math.min(3, Math.floor(t)); const f = t - e; push(U.lerp(C[e][0], C[e + 1][0], f), U.lerp(C[e][1], C[e + 1][1], f)); } break; }
      case 'triangle': { for (let i = 0; i < N; i++) { const x = U.lerp(-1, 1, i / N); const y = (i / N < 0.5 ? U.mapRange(i / N, 0, 0.5, 0, 1) : U.mapRange(i / N, 0.5, 1, 1, 0)); push(x, y); } break; }
      case 'heart': { for (let i = 0; i < N; i++) { const t = (i / N) * 2 * Math.PI; const x = 16 * Math.pow(Math.sin(t), 3); const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t); push(x / 18, y / 18); } break; }
      case 'star': { const outer = 5, inner = 2.2, points = 5; const spikes = points * 2; for (let i = 0; i < N; i++) { const seg = (i / N) * spikes; const s = Math.floor(seg), f = seg - s; const a0 = (s / spikes) * 2 * Math.PI - Math.PI / 2; const a1 = ((s + 1) / spikes) * 2 * Math.PI - Math.PI / 2; const r0 = s % 2 === 0 ? outer : inner, r1 = s % 2 === 0 ? inner : outer; const r = U.lerp(r0, r1, f) / 5; push(r * Math.cos(a0), r * Math.sin(a0)); } break; }
      case 'butterfly': { for (let i = 0; i < N; i++) { const t = (i / N) * 12 * Math.PI; const e = Math.exp(Math.cos(t)); const x = Math.sin(t) * (e - 2 * Math.cos(4 * t) - Math.pow(Math.sin(t / 12), 5)); const y = Math.cos(t) * (e - 2 * Math.cos(4 * t) - Math.pow(Math.sin(t / 12), 5)); push(x / 2.5, -y / 2.5); } break; }
      case 'gear': { const teeth = 8; const steps = N / teeth; for (let i = 0; i < N; i++) { const k = Math.floor(i / steps); const f = (i % steps) / steps; const a0 = (k / teeth) * 2 * Math.PI; const r = f < 0.5 ? 1 : 1.5; const a = a0 + f * (2 * Math.PI / teeth); push((r / 1.5) * Math.cos(a), (r / 1.5) * Math.sin(a)); } break; }
      case 'spiral': { for (let i = 0; i < N; i++) { const t = (i / N) * 6 * Math.PI; const r = 0.2 + 0.8 * (i / N); push(r * Math.cos(t), r * Math.sin(t)); } break; }
    }
    // 居中归一化到 [-1,1]²
    if (P.length) {
      let x0 = P[0].re, x1 = P[0].re, y0 = P[0].im, y1 = P[0].im;
      for (const p of P) { x0 = Math.min(x0, p.re); x1 = Math.max(x1, p.re); y0 = Math.min(y0, p.im); y1 = Math.max(y1, p.im); }
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, s = Math.max(x1 - x0, y1 - y0) || 1;
      return P.map((p) => ({ re: ((p.re - cx) / s) * 2, im: ((p.im - cy) / s) * 2 }));
    }
    return P;
  }

  /* ============ 傅立叶变换：常见信号（时域 + 解析频谱公式） ============ */
  const ftSignals = [
    { id: 'rect', name: '矩形脉冲', t0: -2, t1: 2, tex: 'x(t)=\\operatorname{rect}_{\\,T}(t)=\\begin{cases}1 & |t|<T/2 \\\\ 0 & \\text{otherwise}\\end{cases}', ft: 'X(f)=T\\,\\mathrm{sinc}(T f)', note: '时域矩形 ↔ 频域 sinc。主瓣宽度: Δf = 1/T，脉冲越窄频谱越宽。', f: (p, t) => Math.abs(t) < p.W / 2 ? 1 : 0, params: () => [{ k: 'W', label: '脉宽 T', min: 0.3, max: 3, v: 1, fmt: (v) => v.toFixed(2) }] },
    { id: 'gauss', name: '高斯脉冲', t0: -2, t1: 2, tex: 'x(t)=e^{-t^2/2\\sigma^2}', ft: 'X(f)=\\sqrt{2\\pi}\\sigma\\,e^{-2\\pi^2\\sigma^2 f^2}', note: '高斯 ↔ 高斯，是唯一的傅立叶变换“固定点”。σ 增大（更宽）→ 频谱更窄。', f: (p, t) => Math.exp(-(t * t) / (2 * p.sig * p.sig)), params: () => [{ k: 'sig', label: 'σ', min: 0.2, max: 1.6, v: 0.6, fmt: (v) => v.toFixed(2) }] },
    { id: 'decay', name: '单边指数衰减', t0: 0, t1: 4, tex: 'x(t)=e^{-at}\\;u(t)', ft: 'X(f)=\\frac{1}{a+j2\\pi f}', note: '幅度谱 |X|=1/\\sqrt{a^2+\\omega^2}，相位 ∠X=-\\arctan(\\omega/a)。衰减越快（a 大）→ 频谱越宽。', f: (p, t) => (t >= 0 ? Math.exp(-p.a * t) : 0), params: () => [{ k: 'a', label: '衰减 a', min: 0.2, max: 6, v: 2, fmt: (v) => v.toFixed(2) }] },
    { id: 'bilateral', name: '双边指数', t0: -2, t1: 2, tex: 'x(t)=e^{-a|t|}', ft: '|X(f)|=\\frac{2a}{a^2+\\omega^2}', note: '双边指数 ↔ 洛伦兹(Lorentzian)形状。', f: (p, t) => Math.exp(-p.a * Math.abs(t)), symmetric: true, params: () => [{ k: 'a', label: '衰减 a', min: 0.3, max: 4, v: 1.5, fmt: (v) => v.toFixed(2) }] },
    { id: 'sinc', name: 'sinc 脉冲', t0: -3, t1: 3, tex: 'x(t)=\\mathrm{sinc}\\left(B t\\right)=\\dfrac{\\sin(\\pi B t)}{\\pi B t}', ft: 'X(f)=\\dfrac{1}{B}\\,\\operatorname{rect}\\left(\\frac{f}{B}\\right)', note: 'sinc ↔ 矩形谱，是脉冲→频谱的一种理想“带限”对偶（与矩形互相对偶）。', f: (p, t) => { const x = Math.PI * p.B * t; return Math.abs(x) < 1e-9 ? 1 : Math.sin(x) / x; }, params: () => [{ k: 'B', label: 'B', min: 0.5, max: 3, v: 1.2, fmt: (v) => v.toFixed(2) }] },
    { id: 'cos', name: '余弦波', t0: -1, t1: 1, tex: 'x(t)=\\cos(2\\pi f_0 t)', ft: 'X(f)=\\tfrac12[\\delta(f{-}f_0)+\\delta(f{+}f_0)]', note: '理想余弦频谱是两条冲激线；若截断一段则会展宽为两个 sinc 峰。', f: (p, t) => Math.cos(2 * Math.PI * p.f0 * t), params: () => [{ k: 'f0', label: '频率 f₀', min: 1, max: 8, v: 3, step: 0.5, fmt: (v) => v.toFixed(1) }] },
    { id: 'delta', name: '单位冲激', t0: -1, t1: 1, tex: 'x(t)=\\delta(t)', ft: 'X(f)=1 \\quad (\\forall f)', note: '冲激 ↔ 常数（全频段平坦）。缩放：δ 越窄，频谱越平坦。', f: (p, t) => Math.abs(t) < p.W / 2 ? 1 / p.W : 0, params: () => [{ k: 'W', label: '宽度(近似δ)', min: 0.02, max: 0.2, v: 0.08, implicit: true, fmt: (v) => v.toFixed(3) }] },
    { id: 'tri', name: '三角脉冲', t0: -2, t1: 2, tex: 'x(t)=\\left(1-\\dfrac{2|t|}{T}\\right)^{+}', ft: 'X(f)=\\tfrac{T}{2}\\,\\mathrm{sinc}^2\\!\\left(\\tfrac{T f}{2}\\right)', note: '三角脉冲 ↔ sinc 平方。比矩形脉冲旁瓣衰减更快。', f: (p, t) => Math.max(0, 1 - (2 * Math.abs(t)) / p.T), params: () => [{ k: 'T', label: '宽度 T', min: 0.5, max: 3, v: 1.6, fmt: (v) => v.toFixed(2) }] }
  ];

  /* ============ 拉普拉斯变换：传递函数预设 ============ */
  const laplacePresets = {
    first: { name: '一阶低通', num: [1], den: [1, 1], note: '极点 s=-1，稳定，带宽 ω₀=1。', tex: 'H(s)=\\dfrac{1}{s+1}' },
    second_under: { name: '二阶欠阻尼', num: [1], den: [1, 0.5, 1.25], note: '极点 -0.25±j·1.089，稳定，有衰减振荡。', tex: 'H(s)=\\dfrac{1}{s^2+0.5s+1.25}' },
    second_crit: { name: '二阶临界阻尼', num: [1], den: [1, 2, 1], note: '重根极点 s=-1，临界阻尼。', tex: 'H(s)=\\dfrac{1}{(s+1)^2}' },
    second_over: { name: '二阶过阻尼', num: [1], den: [1, 3, 2], note: '两个实极点 s=-1, -2，过阻尼无振荡。', tex: 'H(s)=\\dfrac{1}{s^2+3s+2}' },
    bandpass: { name: '带通', num: [0.9, 0], den: [1, 0.4, 1.21], note: '零点在原点，jω 轴附近共轭极点 → 带通。', tex: 'H(s)=\\dfrac{0.9s}{s^2+0.4s+1.21}' },
    delay: { name: '不稳定', num: [1], den: [1, -0.3, 1], note: '极点在右半平面 (实部>0) → 不稳定的发散振荡。', tex: 'H(s)=\\dfrac{1}{s^2-0.3s+1}' },
    marginal: { name: '临界稳定(纯虚极点)', num: [1], den: [1, 0, 1], note: '极点在 jω 轴 ±j1 → 等幅振荡，临界稳定。', tex: 'H(s)=\\dfrac{1}{s^2+1}' }
  };

  /* ============ 表达式解析 ============ */
  // 解析实系数多项式字符串 => 系数（自高到低）。支持 s、s^2、数字、带 * 的系数项。
  // 例: "s^2 + 2*s + 5"  => [1, 2, 5]
  function parsePoly(str) {
    if (str == null) return null;
    let s = String(str).replace(/\s+/g, '').replace(/\*\*/g, '^');
    if (!s) return [0];
    // 展开成 token：用正则匹配 [+-]?(coefficient)(s)(^n)?
    const tokens = s.match(/[+-]?(?:[0-9.]+(?:\*)?s(?:\^\d+)?|s(?:\^\d+)?|[0-9.]+)/g);
    if (!tokens) return null;
    const coeff = new Map(); // 幂次 -> 系数（幂次低到高）
    let ok = true;
    for (let t of tokens) {
      let sign = 1;
      if (t[0] === '+') t = t.slice(1);
      else if (t[0] === '-') { sign = -1; t = t.slice(1); }
      // 分离 coefficient 与 s 部分
      const hasS = t.includes('s');
      let coefText, power;
      if (hasS) {
        const idx = t.indexOf('s');
        coefText = t.slice(0, idx).replace('*', '');
        const pPart = t.slice(idx + 1);
        power = pPart ? parseInt(pPart.replace('^', ''), 10) : 1;
        if (!(power >= 0) || isNaN(power)) { ok = false; break; }
      } else { coefText = t; power = 0; }
      let c = coefText === '' ? 1 : parseFloat(coefText);
      if (isNaN(c)) { ok = false; break; }
      coeff.set(power, (coeff.get(power) || 0) + sign * c);
    }
    if (!ok) return null;
    const maxDeg = Math.max(0, ...coeff.keys());
    const out = new Array(maxDeg + 1).fill(0);
    for (const [p, c] of coeff) out[maxDeg - p] = c;
    // 去掉首项为 0 造成的多余前导（不可删首项为0会改变次数）；保留
    return out;
  }

  // 解析传递函数字符串 "num/den"，返回 {num, den}（自高到低）
  function parseTF(str) {
    if (!str) return null;
    const parts = String(str).split('/');
    const num = parsePoly(parts[0]);
    const den = parts.length > 1 ? parsePoly(parts[1]) : [1];
    // 归一化分母首项
    if (!num || !den) return null;
    const d0 = den[0] || 0;
    if (d0 === 0) return null;
    // 若分母为零次且=1 直接返回
    return { num, den };
  }

  // 解析以 t 为变量的时域表达式，返回 f(t) 函数 + 校验
  // 内置信号函数：u 阶跃 / heaviside / sinc / rect / tri
  function parseTimeExpr(str) {
    if (!window.math) return null;
    try {
      const node = window.math.parse(str);
      const helpers = {
        u: (x) => (x >= 0 ? 1 : 0),
        heaviside: (x) => (x > 0 ? 1 : x < 0 ? 0 : 0.5),
        sinc: (x) => (Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)),
        rect: (x) => (Math.abs(x) < 0.5 ? 1 : 0),
        tri: (x) => Math.max(0, 1 - Math.abs(x))
      };
      const f = (t) => {
        try {
          const scope = Object.assign({}, helpers, { t });
          const v = node.evaluate(scope);
          if (typeof v === 'number') return v;
          if (v && typeof v.re === 'number') return v.re;
          if (v && typeof v.valueOf === 'function') { const n = v.valueOf(); return typeof n === 'number' ? n : 0; }
          return 0;
        } catch (e) { return 0; }
      };
      for (const q of [0.1, 1, 2.5]) if (!isFinite(f(q))) throw new Error('not finite');
      return f;
    } catch (e) { return null; }
  }

  return { shapePoints, ftSignals, laplacePresets, parseTF, parseTimeExpr };
})();

window.FX_LIB = FX_LIB;