/**
 * textext.ts — 公式纯文本工具（自 v1 plots.js 抽取的纯函数）
 * texToText：KaTeX 缺失时的降级渲染（规划书 §8.11「公式一律 KaTeX，缺失时纯文本降级」）。
 * niceStep：坐标轴"好看步长"（1/2/5 × 10^k）。
 */

export function texToText(tex: string): string {
  return String(tex)
    .replace(/\\dfrac\s*{([^{}]*)}\s*{([^{}]*)}/g, '($1)/($2)')
    .replace(/\\frac\s*{([^{}]*)}\s*{([^{}]*)}/g, '($1)/($2)')
    .replace(/\\sqrt\s*{([^{}]*)}/g, '√($1)')
    // 环境与分隔符（必须先于命令剥离，否则会残留 \begin{cases}、&、\\ 字面量）：
    // 矩阵→[]、分段→｛｝、对齐/数组容器→去掉；行分隔 \\→；、列分隔 &→，、转义花括号 \{ \}→｛｝
    .replace(/\\begin\{(?:b|B|p|P|v|V)matrix\}/g, '[')
    .replace(/\\end\{(?:b|B|p|P|v|V)matrix\}/g, ']')
    .replace(/\\begin\{cases\}/g, '｛')
    .replace(/\\end\{cases\}/g, '｝')
    .replace(/\\begin\{array\}\s*\{[^{}]*\}/g, '')
    .replace(/\\end\{array\}/g, '')
    .replace(/\\begin\{(?:align(?:ed)?\*?|gathered)\}/g, '')
    .replace(/\\end\{(?:align(?:ed)?\*?|gathered)\}/g, '')
    .replace(/\\\{/g, '｛')
    .replace(/\\\}/g, '｝')
    .replace(/\\\\/g, '；')
    .replace(/&/g, '，')
    .replace(/\^{([^{}]*)}/g, '^$1')
    .replace(/\\text\s*{([^{}]*)}/g, '$1')
    .replace(/\\operatorname\{([^{}]*)\}/g, '$1')
    .replace(/\\left|\\right|\\!|\\,|\\;|\\quad|\\qquad/g, ' ')
    .replace(/\\delta/g, 'δ')
    .replace(/\\omega/g, 'ω')
    .replace(/\\Omega/g, 'Ω')
    .replace(/\\pi/g, 'π')
    .replace(/\\sigma/g, 'σ')
    .replace(/\\infty/g, '∞')
    .replace(/\\times/g, '×')
    .replace(/\\cdot/g, '·')
    .replace(/\\pm/g, '±')
    .replace(/\\sum/g, 'Σ')
    .replace(/\\int/g, '∫')
    .replace(/\\approx/g, '≈')
    .replace(/\\neq/g, '≠')
    .replace(/\\leq/g, '≤')
    .replace(/\\geq/g, '≥')
    .replace(/\\alpha/g, 'α')
    .replace(/\\beta/g, 'β')
    .replace(/\\theta/g, 'θ')
    .replace(/\\zeta/g, 'ζ')
    .replace(/\\lambda/g, 'λ')
    .replace(/\\mu/g, 'μ')
    .replace(/\\tau/g, 'τ')
    .replace(/\\rho/g, 'ρ')
    .replace(/\\phi/g, 'φ')
    .replace(/\\cos/g, 'cos')
    .replace(/\\sin/g, 'sin')
    .replace(/\\tan/g, 'tan')
    .replace(/\\log/g, 'log')
    .replace(/\\ln/g, 'ln')
    .replace(/\\exp/g, 'exp')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s*([，；])\s*/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function niceStep(range: number): number {
  if (range <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(range)));
  const m = range / pow;
  let nm = 1;
  if (m >= 5) nm = 5;
  else if (m >= 2) nm = 2;
  else if (m >= 1) nm = 1;
  return nm * pow;
}