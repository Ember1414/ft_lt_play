/**
 * transforms.ts — 符号变换引擎（自 v1 transforms.js 迁移，原 window.TR）
 *   连续：parseTimeCombo → Laplace F(s) / Fourier F(jω)；invLaplace 反变换
 *   离散：parseZCombo   → Z 变换 X(z)；invZ 反变换
 *   全部输出 KaTeX 字符串 + ROC + 数值自检
 * 数值/字符串语义与 v1 完全一致（回归网：lib/lapprops.test.mjs + parity.mjs）。
 *
 * 说明：本文件内的 cAdd/cSub2/cMul2/cDiv2 保留 v1 语义（cDiv2 的兜底为 1e-300，
 * 与 dsp.cdiv 的 1e-30 不同），故不并入 complex.ts。
 */

import { normChars, safeCalc } from './expr';
import { polyRoots } from './dsp';
import { TOL_ZERO, TOL_AXIS, TOL_REL, TOL_GROUP, TOL_TEX, TOL_CHECK, MIN_FLOOR } from './tol';
import type { Complex } from './complex';

const fact = (n: number): number => {
  let r = 1;
  for (let k = 2; k <= n; k++) r *= k;
  return r;
};
const num2tex = (v: number): string => (Number.isInteger(v) ? String(v) : String(+v.toFixed(4)));
// 三位小数幅值（符号由调用方处理）
const fmt3 = (v: number): string => {
  const x = Math.abs(v) < TOL_TEX ? 0 : +v.toFixed(3);
  return String(x);
};

/* ================= 连续时域组合（因果信号） ================= */
// 语法：项用 + - 连接；项：[c*]exp(-a*t)[*u(t)] | [c*]sin(w*t)[*u(t)] | [c*]cos(w*t)[*u(t)]
//       | [c*]t^n[*u(t)] | [c*]t^n*exp(-a*t)[*u(t)] | [c*]u(t) | 常数 c

interface ItemBase {
  sign: number;
  coef: number;
}

export type TimeItem =
  | (ItemBase & { kind: 'exp'; a: number })
  | (ItemBase & { kind: 'texp'; n: number; a: number })
  | (ItemBase & { kind: 'sin'; w: number })
  | (ItemBase & { kind: 'cos'; w: number })
  | (ItemBase & { kind: 'tpow'; n: number })
  | (ItemBase & { kind: 'u' })
  | (ItemBase & { kind: 'const' });

export function parseTimeCombo(str: string | null | undefined): TimeItem[] | null {
  const s = lenient(String(str || ''));
  if (!s) return null;
  const items: TimeItem[] = [];
  let i = 0;
  while (i < s.length) {
    let sign = 1;
    if (s[i] === '+') i++;
    else if (s[i] === '-') {
      sign = -1;
      i++;
    }
    if (i >= s.length) return null;
    let coef = 1;
    const m = s.slice(i).match(/^(\d+(?:\.\d+)?)/);
    if (m) {
      coef = parseFloat(m[1]);
      i += m[1].length;
      if (s[i] === '*') i++;
      if (i >= s.length || s[i] === '+' || s[i] === '-') {
        items.push({ sign, coef, kind: 'const' });
        continue;
      }
    }
    const rest = s.slice(i);
    let mt: RegExpMatchArray | null;
    if ((mt = rest.match(/^t\^(\d+)\*?exp\(-(?:(\d+(?:\.\d+)?)\*?)?t\)/))) {
      items.push({ sign, coef, kind: 'texp', n: +mt[1], a: mt[2] ? +mt[2] : 1 });
      i += mt[0].length;
    } else if ((mt = rest.match(/^exp\(-(?:(\d+(?:\.\d+)?)\*?)?t\)/))) {
      items.push({ sign, coef, kind: 'exp', a: mt[1] ? +mt[1] : 1 });
      i += mt[0].length;
    } else if ((mt = rest.match(/^sin\(([0-9pi+\-*/.()]+)\*?t\)/))) {
      const w = evalW(mt[1]);
      if (!isFinite(w)) return null;
      items.push({ sign, coef, kind: 'sin', w });
      i += mt[0].length;
    } else if ((mt = rest.match(/^cos\(([0-9pi+\-*/.()]+)\*?t\)/))) {
      const w = evalW(mt[1]);
      if (!isFinite(w)) return null;
      items.push({ sign, coef, kind: 'cos', w });
      i += mt[0].length;
    } else if ((mt = rest.match(/^t\^(\d+)/))) {
      items.push({ sign, coef, kind: 'tpow', n: +mt[1] });
      i += mt[0].length;
    } else if ((mt = rest.match(/^t(?![a-z(])/))) {
      // 裸 t = t¹
      items.push({ sign, coef, kind: 'tpow', n: 1 });
      i += 1;
    } else if ((mt = rest.match(/^u\(t\)/))) {
      items.push({ sign, coef, kind: 'u' });
      i += mt[0].length;
    } else return null;
    if (s.slice(i).startsWith('*u(t)')) i += 5;
    else if (s.slice(i).startsWith('u(t)')) i += 4;
  }
  return items.length ? items : null;
}

function evalW(txt: string): number {
  const t = txt.replace(/\*+$/, ''); // 去掉正则贪婪吞下的尾部孤儿 '*'
  try {
    return safeCalc(t); // 白名单求值（曾用 Function 动态执行）
  } catch {
    return NaN;
  }
}

/** 宽松预处理：全角符号、unicode 上标、^{...}、数字与字母/括号间隐式乘号（0.5^n 不受影响） */
function lenient(s: string): string {
  // 入口归一化：全角字符/负号变体 → 半角（normChars，含 ** → ^），先于其余宽松改写
  return normChars(s)
    .replace(/\s+/g, '')
    .replace(/e\^\{([^}]*)\}/g, 'exp($1)') // e^{-2t} → exp(-2t)（须先于 ^{...} 归一化）
    .replace(/e\^\(/g, 'exp(')
    .replace(/−/g, '-')
    .replace(/×/g, '*')
    .replace(/·/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, 'pi')
    .replace(/⁰/g, '^0')
    .replace(/¹/g, '^1')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/⁴/g, '^4')
    .replace(/⁵/g, '^5')
    .replace(/⁶/g, '^6')
    .replace(/\^\{([^}]*)\}/g, '^$1')
    .replace(/(\d)([a-df-z(])/g, '$1*$2'); // 3t、2sin(、5u( 等；不动 0.5^n
}

const timeCoreTex = (it: TimeItem): string => {
  const c = it.coef === 1 ? '' : num2tex(it.coef);
  switch (it.kind) {
    case 'exp':
      return `${c}e^{-${num2tex(it.a)}t}u(t)`;
    case 'texp':
      return `${c}t^{${it.n}}e^{-${num2tex(it.a)}t}u(t)`;
    case 'sin':
      return `${c}\\sin(${num2tex(it.w)}t)u(t)`;
    case 'cos':
      return `${c}\\cos(${num2tex(it.w)}t)u(t)`;
    case 'tpow':
      return `${c}t^{${it.n}}u(t)`;
    case 'u':
      return `${c}u(t)`;
    case 'const':
      return num2tex(it.coef);
    default:
      return '';
  }
};

/**
 * 分式分子：多项式因子相乘，常量 1 在有其它因子时省略（1·s → s），
 * 但分子**不允许为空**（系数为 1 时给出 `1`，避免渲染出 \dfrac{}{s+a} 的空白分子）。
 */
const numTexOf = (coefTex: string, rest: string[]): string => {
  const parts = [coefTex, ...rest].filter((p) => p !== '');
  const kept = parts.length > 1 ? parts.filter((p) => p !== '1') : parts;
  return kept.length ? kept.join('\\cdot') : '1';
};

export const itemLapTex = (it: TimeItem): string => {
  const s = it.sign < 0 ? '-' : '';
  const cn = num2tex(it.coef);
  switch (it.kind) {
    case 'exp':
      return `${s}\\dfrac{${numTexOf(cn, [])}}{s+${num2tex(it.a)}}`;
    case 'texp':
      return `${s}\\dfrac{${numTexOf(cn, [String(fact(it.n))])}}{(s+${num2tex(it.a)})^{${it.n + 1}}}`;
    case 'sin':
      return `${s}\\dfrac{${numTexOf(cn, [num2tex(it.w)])}}{s^{2}+${num2tex(it.w * it.w)}}`;
    case 'cos':
      return `${s}\\dfrac{${numTexOf(cn, ['s'])}}{s^{2}+${num2tex(it.w * it.w)}}`;
    case 'tpow':
      return `${s}\\dfrac{${numTexOf(cn, [String(fact(it.n))])}}{s^{${it.n + 1}}}`;
    case 'u':
    case 'const':
      return `${s}\\dfrac{${numTexOf(cn, [])}}{s}`;
    default:
      return '';
  }
};

export interface LaplaceLines {
  fLine: string;
  fsLine: string;
  rocTex: string;
  hasOsc: boolean;
  right: number;
}

export function laplaceOfItems(items: TimeItem[]): LaplaceLines {
  const fLine =
    'f(t)=' + timeCoreTex(items[0]) + items.slice(1).map((it) => (it.sign < 0 ? '-' : '+') + timeCoreTex(it)).join('');
  const fsLine =
    'F(s)=' +
    items
      .map(itemLapTex)
      .join('')
      .replace(/^\+/, '');
  // ROC：最右极点（sin/cos/t²/u/const 极点在 0）
  let right = -Infinity;
  for (const it of items) {
    if (it.kind === 'exp') right = Math.max(right, -it.a);
    else if (it.kind === 'texp') right = Math.max(right, -it.a);
    else right = Math.max(right, 0);
  }
  const rocTex = '\\operatorname{ROC}:\\ \\operatorname{Re}(s)>' + num2tex(right === -Infinity ? 0 : right);
  const hasOsc = items.some((it) => ['sin', 'cos', 'tpow', 'u', 'const'].includes(it.kind));
  return { fLine, fsLine, rocTex, hasOsc, right };
}

export function fourierOfItems(items: TimeItem[]): { tex: string; imp: boolean } {
  const parts: string[] = [];
  let imp = false;
  for (const it of items) {
    const c = it.coef * it.sign;
    switch (it.kind) {
      case 'exp':
        parts.push(`\\dfrac{${num2tex(c)}}{${num2tex(it.a)}+j\\omega}`);
        break;
      case 'texp':
        parts.push(`\\dfrac{${num2tex(c * fact(it.n))}}{(${num2tex(it.a)}+j\\omega)^{${it.n + 1}}}`);
        break;
      case 'sin':
        parts.push(
          `\\dfrac{\\pi${num2tex(c / 2)}}{j}\\left[\\delta(\\omega-${num2tex(it.w)})-\\delta(\\omega+${num2tex(it.w)})\\right]`,
        );
        imp = true;
        break;
      case 'cos':
        parts.push(
          `\\dfrac{\\pi${num2tex(c / 2)}}{1}\\left[\\delta(\\omega-${num2tex(it.w)})+\\delta(\\omega+${num2tex(it.w)})\\right]`.replace(
            '\\dfrac{\\pi' + num2tex(c / 2) + '}{1}',
            num2tex(c / 2) + '\\pi',
          ),
        );
        imp = true;
        break;
      case 'tpow':
        parts.push(
          `\\dfrac{${num2tex(c * fact(it.n))}}{(j\\omega)^{${it.n + 1}}}+\\pi j^{${it.n}}${num2tex(c)}\\delta^{(${it.n})}(\\omega)`,
        );
        imp = true;
        break;
      case 'u':
      case 'const':
        parts.push(`${num2tex(c)}\\pi\\delta(\\omega)+\\dfrac{${num2tex(c)}}{j\\omega}`);
        imp = true;
        break;
    }
  }
  const tex = 'F(j\\omega)=' + parts.join('+').replace(/\+-/g, '-');
  return { tex, imp };
}

export function fNumeric(items: TimeItem[], t: number): number {
  return t < 0
    ? 0
    : items.reduce((acc, it) => {
        const v = it.coef * it.sign;
        switch (it.kind) {
          case 'exp':
            return acc + v * Math.exp(-it.a * t);
          case 'texp':
            return acc + v * Math.pow(t, it.n) * Math.exp(-it.a * t);
          case 'sin':
            return acc + v * Math.sin(it.w * t);
          case 'cos':
            return acc + v * Math.cos(it.w * t);
          case 'tpow':
            return acc + v * Math.pow(t, it.n);
          case 'u':
          case 'const':
            return acc + v;
          default:
            return acc;
        }
      }, 0);
}

export function FsNumeric(items: TimeItem[], sv: number): number {
  return items.reduce((acc, it) => {
    const v = it.coef * it.sign;
    switch (it.kind) {
      case 'exp':
        return acc + v / (sv + it.a);
      case 'texp':
        return acc + (v * fact(it.n)) / Math.pow(sv + it.a, it.n + 1);
      case 'sin':
        return acc + (v * it.w) / (sv * sv + it.w * it.w);
      case 'cos':
        return acc + (v * sv) / (sv * sv + it.w * it.w);
      case 'tpow':
        return acc + (v * fact(it.n)) / Math.pow(sv, it.n + 1);
      case 'u':
      case 'const':
        return acc + v / sv;
      default:
        return acc;
    }
  }, 0);
}

/* ================= 离散序列组合（因果序列） ================= */
// 语法：项：[c*]a^n*u[n] | [c*]n*u[n] | [c*]n*a^n[*u[n]] | [c*]cos(w*n)[*u[n]] | [c*]sin(w*n)[*u[n]]
//       | [c*]r^n*cos(w*n)[*u[n]] | [c*]r^n*sin(w*n)[*u[n]]（阻尼振荡 / 复极点对）
//       | [c*]u[n] | [c*]delta[n]（或 d[n]）| 常数 c（按 c·u[n] 处理）

export type ZItem =
  | (ItemBase & { kind: 'an'; a: number })
  | (ItemBase & { kind: 'nan'; a: number })
  | (ItemBase & { kind: 'np2' })
  | (ItemBase & { kind: 'n' })
  | (ItemBase & { kind: 'zn'; w: number })
  | (ItemBase & { kind: 'zsn'; w: number })
  | (ItemBase & { kind: 'rncos'; r: number; w: number })
  | (ItemBase & { kind: 'rnsin'; r: number; w: number })
  | (ItemBase & { kind: 'un' })
  | (ItemBase & { kind: 'delta' })
  | (ItemBase & { kind: 'const' });

export function parseZCombo(str: string | null | undefined): ZItem[] | null {
  const s = lenient(String(str || ''))
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/δ/g, 'delta');
  if (!s) return null;
  const items: ZItem[] = [];
  let i = 0;
  while (i < s.length) {
    let sign = 1;
    if (s[i] === '+') i++;
    else if (s[i] === '-') {
      sign = -1;
      i++;
    }
    if (i >= s.length) return null;
    let coef = 1;
    const m = s.slice(i).match(/^(\d+(?:\.\d+)?)/);
    if (m) {
      coef = parseFloat(m[1]);
      i += m[1].length;
      if (s[i] === '*') i++;
      if (i >= s.length || s[i] === '+' || s[i] === '-') {
        items.push({ sign, coef, kind: 'un' });
        continue;
      }
      // 数字后紧跟 ^n → 几何底数（0.5^n）；若后面接 cos/sin 则为阻尼振荡 r^n·cos(w n)
      if (s[i] === '^') {
        const mm = s.slice(i).match(/^\^n(\*u\(n\))?/);
        if (!mm) return null;
        i += mm[0].length;
        const mo = s.slice(i).match(/^\*?(cos|sin)\(([0-9pi+\-*/.()]+)\*?n\)/);
        if (mo) {
          const w = evalW(mo[2]);
          items.push(mo[1] === 'cos' ? { sign, coef: 1, kind: 'rncos', r: coef, w } : { sign, coef: 1, kind: 'rnsin', r: coef, w });
          i += mo[0].length;
          if (s.slice(i).startsWith('*u(n)')) i += 5;
          else if (s.slice(i).startsWith('u(n)')) i += 4;
          continue;
        }
        items.push({ sign, coef: 1, kind: 'an', a: coef });
        continue;
      }
    }
    const rest = s.slice(i);
    let mt: RegExpMatchArray | null;
    if ((mt = rest.match(/^delta\(n\)/))) {
      items.push({ sign, coef, kind: 'delta' });
      i += mt[0].length;
    } else if ((mt = rest.match(/^n\^2(\*u\(n\))?/))) {
      items.push({ sign, coef, kind: 'np2' });
      i += mt[0].length;
    } else if ((mt = rest.match(/^n\*(\d+(?:\.\d+)?)\^n(\*u\(n\))?/))) {
      items.push({ sign, coef, kind: 'nan', a: +mt[1] });
      i += mt[0].length;
    } else if ((mt = rest.match(/^n\*a\^(\d+(?:\.\d+)?)/))) {
      items.push({ sign, coef, kind: 'nan', a: +mt[1] });
      i += mt[0].length;
    } else if ((mt = rest.match(/^n(\*u\(n\))?/)) && !rest.startsWith('na')) {
      items.push({ sign, coef, kind: 'n' });
      i += mt[0].length;
    } else if ((mt = rest.match(/^a\^(\d+(?:\.\d+)?)/))) {
      items.push({ sign, coef, kind: 'an', a: +mt[1] });
      i += mt[0].length;
    } else if ((mt = rest.match(/^cos\(([0-9pi+\-*/.()]+)\*?n\)/))) {
      items.push({ sign, coef, kind: 'zn', w: evalW(mt[1]) });
      i += mt[0].length;
    } else if ((mt = rest.match(/^sin\(([0-9pi+\-*/.()]+)\*?n\)/))) {
      items.push({ sign, coef, kind: 'zsn', w: evalW(mt[1]) });
      i += mt[0].length;
    } else if ((mt = rest.match(/^u\(n\)/))) {
      items.push({ sign, coef, kind: 'un' });
      i += mt[0].length;
    } else return null;
    if (s.slice(i).startsWith('*u(n)')) i += 5;
    else if (s.slice(i).startsWith('u(n)')) i += 4;
  }
  return items.length ? items : null;
}

const zCoreTex = (it: ZItem): string => {
  const c = it.coef === 1 ? '' : num2tex(it.coef);
  switch (it.kind) {
    case 'an':
      return `${c}${num2tex(it.a)}^{n}u(n)`;
    case 'nan':
      return `${c}n\\,${num2tex(it.a)}^{n}u(n)`;
    case 'np2':
      return `${c}n^{2}u(n)`;
    case 'n':
      return `${c}n\\,u(n)`;
    case 'zn':
      return `${c}\\cos(${num2tex(it.w)}n)u(n)`;
    case 'zsn':
      return `${c}\\sin(${num2tex(it.w)}n)u(n)`;
    case 'rncos':
      return `${c}${num2tex(it.r)}^{n}\\cos(${num2tex(it.w)}n)u(n)`;
    case 'rnsin':
      return `${c}${num2tex(it.r)}^{n}\\sin(${num2tex(it.w)}n)u(n)`;
    case 'un':
      return `${c}u(n)`;
    case 'delta':
      return `${it.coef === 1 ? '' : num2tex(it.coef)}\\delta(n)`;
    case 'const':
      return num2tex(it.coef) + 'u(n)';
    default:
      return '';
  }
};

const itemZTex = (it: ZItem): string => {
  const s = it.sign < 0 ? '-' : '';
  switch (it.kind) {
    case 'an':
      return it.a === 0
        ? `${s}${num2tex(it.coef)}`
        : `${s}\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef) + '\\cdot'}z}{z-${num2tex(it.a)}}`;
    case 'nan':
      return `${s}\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef) + '\\cdot'}${num2tex(it.a)}z}{(z-${num2tex(it.a)})^{2}}`;
    case 'n':
      return `${s}\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef) + '\\cdot'}z}{(z-1)^{2}}`;
    case 'np2':
      return `${s}\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef) + '\\cdot'}z(z+1)}{(z-1)^{3}}`;
    case 'zn':
      return `${s}\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef) + '\\cdot'}z(z-\\cos ${num2tex(it.w)})}{z^{2}-2z\\cos ${num2tex(it.w)}+1}`;
    case 'zsn':
      return `${s}\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef) + '\\cdot'}z\\sin ${num2tex(it.w)}}{z^{2}-2z\\cos ${num2tex(it.w)}+1}`;
    case 'rncos':
      return it.r === 0
        ? `${s}${num2tex(it.coef)}`
        : `${s}\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef) + '\\cdot'}z\\left(z-${num2tex(it.r)}\\cos ${num2tex(it.w)}\\right)}{z^{2}-2\\cdot${num2tex(it.r)}\\cos ${num2tex(it.w)}\\,z+${num2tex(it.r * it.r)}}`;
    case 'rnsin':
      return it.r === 0
        ? `${s}0`
        : `${s}\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef) + '\\cdot'}${num2tex(it.r)}z\\sin ${num2tex(it.w)}}{z^{2}-2\\cdot${num2tex(it.r)}\\cos ${num2tex(it.w)}\\,z+${num2tex(it.r * it.r)}}`;
    case 'un':
      return `${s}\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef) + '\\cdot'}z}{z-1}`;
    case 'delta':
      return `${s}${num2tex(it.coef)}`;
    case 'const':
      return `${s}\\dfrac{${num2tex(it.coef)}z}{z-1}`;
    default:
      return '';
  }
};

export interface ZLines {
  xLine: string;
  zLine: string;
  rocTex: string;
  roc: number;
}

export function zOfItems(items: ZItem[]): ZLines {
  const xLine =
    'x(n)=' + zCoreTex(items[0]) + items.slice(1).map((it) => (it.sign < 0 ? '-' : '+') + zCoreTex(it)).join('');
  const zLine =
    'X(z)=' +
    items
      .map(itemZTex)
      .join('')
      .replace(/^\+/, '');
  let roc = 0;
  for (const it of items) {
    if (it.kind === 'rncos' || it.kind === 'rnsin') roc = Math.max(roc, Math.abs(it.r));
    else if (it.kind === 'an' || it.kind === 'nan') roc = Math.max(roc, Math.abs(it.a));
    else if (it.kind === 'np2') roc = Math.max(roc, 1);
    else if (it.kind !== 'delta') roc = Math.max(roc, 1);
  }
  return { xLine, zLine, rocTex: `\\text{ROC}: |z|>${roc === 0 ? '0' : num2tex(roc)}`, roc };
}

export function xNumeric(items: ZItem[], n: number): number {
  return n < 0
    ? 0
    : items.reduce((acc, it) => {
        const v = it.coef * it.sign;
        switch (it.kind) {
          case 'an':
            return acc + (n === 0 && it.a === 0 ? v : v * Math.pow(it.a, n));
          case 'nan':
            return acc + v * n * Math.pow(it.a, n);
          case 'n':
            return acc + v * n;
          case 'np2':
            return acc + v * n * n;
          case 'zn':
            return acc + v * Math.cos(it.w * n);
          case 'zsn':
            return acc + v * Math.sin(it.w * n);
          case 'rncos':
            return acc + v * Math.pow(it.r, n) * Math.cos(it.w * n);
          case 'rnsin':
            return acc + v * Math.pow(it.r, n) * Math.sin(it.w * n);
          case 'un':
            return acc + v;
          case 'delta':
            return acc + (n === 0 ? v : 0);
          case 'const':
            return acc + v;
          default:
            return acc;
        }
      }, 0);
}

export function XzNumeric(items: ZItem[], z: number, roc: number, N = 400): number {
  // X(z) = Σ x[n] z^{-n}（因果序列截断求和）
  let sum = 0;
  for (let n = 0; n < N; n++) {
    const xn = xNumeric(items, n);
    if (Math.abs(z) > roc) sum += xn * Math.pow(z, -n);
  }
  return sum;
}

/* ================= 反变换 ================= */
/* ---------- 重极点部分分式引擎 ----------
   把真分式 N/D 展开为 Σ_p Σ_{k=1..m_p} A_{p,k}/(s−p)^{k}，支持任意重极点。
   方法：对每个极点 p（重数 m）：D_rest = D/(s−p)^m（复数综合除法），
   N/D_rest 在 p 处的泰勒系数（反复综合除法）做级数除法，A_k = c_{m−k}。
   返回 groups: [{ p:{re,im}, m, A:[A1..Am](复数), pair:bool }]，direct 为直通项系数。 */
const cSub2 = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });
const cMul2 = (a: Complex, b: Complex): Complex => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const cDiv2 = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im || MIN_FLOOR;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};

/** 综合除法：P(s) ÷ (s−p)，返回商（自高到低），余数丢弃 */
function synthDiv(P: Complex[], p: Complex): Complex[] {
  let b: Complex = { re: P[0].re, im: P[0].im };
  const q: Complex[] = [];
  for (let i = 1; i < P.length; i++) {
    q.push({ re: b.re, im: b.im });
    b = { re: P[i].re + b.re * p.re - b.im * p.im, im: P[i].im + b.re * p.im + b.im * p.re };
  }
  return q;
}

/** 多项式在 p 处泰勒系数（升幂 c0..c_{order−1}）：反复综合除法取余数 */
function taylorAt(P: Complex[], p: Complex, order: number): Complex[] {
  const out: Complex[] = [];
  let cur = P.map((c) => ({ re: c.re, im: c.im }));
  for (let i = 0; i < order; i++) {
    let b: Complex = { re: cur[0].re, im: cur[0].im };
    const q: Complex[] = [];
    for (let j = 1; j < cur.length; j++) {
      q.push({ re: b.re, im: b.im });
      b = { re: cur[j].re + b.re * p.re - b.im * p.im, im: cur[j].im + b.re * p.im + b.im * p.re };
    }
    out.push({ re: b.re, im: b.im });
    cur = q;
    if (!cur.length) {
      while (out.length < order) out.push({ re: 0, im: 0 });
      break;
    }
  }
  return out;
}

export interface FracGroup {
  p: Complex;
  m: number;
  A: Complex[];
  pair: boolean;
}

export type PartialFracResult = { ok: true; groups: FracGroup[]; direct: number } | { ok: false; note: string };

export function partialFracGroups(num: number[], den: number[]): PartialFracResult {
  const d0 = den[0];
  if (!isFinite(d0) || Math.abs(d0) < TOL_ZERO) return { ok: false, note: '分母首项系数为 0' };
  const D = den.map((c) => c / d0);
  let N = num.map((c) => c / d0);
  while (N.length < D.length) N.unshift(0);
  let direct = 0;
  if (N.length === D.length && Math.abs(N[0]) > TOL_ZERO) {
    direct = N[0];
    N = N.map((c, i) => c - D[i] * direct);
  }
  while (N.length && Math.abs(N[0]) < TOL_ZERO) N.shift();
  if (!N.length) return { ok: true, groups: [], direct };
  const poles = polyRoots(D);
  // 按位置分组（重根 → 重数）
  const tol = TOL_GROUP;
  const raw: Array<{ p: Complex; m: number }> = [];
  for (const q of poles) {
    const g = raw.find((g0) => Math.hypot(g0.p.re - q.re, g0.p.im - q.im) < tol);
    if (g) g.m++;
    else raw.push({ p: { re: q.re, im: q.im }, m: 1 });
  }
  // 共轭配对检查
  for (const g of raw) {
    if (
      g.p.im > tol &&
      !raw.some(
        (h) => h !== g && Math.abs(h.p.re - g.p.re) < tol && Math.abs(h.p.im + g.p.im) < tol,
      )
    ) {
      return { ok: false, note: '存在非共轭复根（系数非实？）' };
    }
  }
  const groups: FracGroup[] = [];
  for (const g of raw) {
    if (g.p.im < -tol) continue; // 共轭成员由 pair 组代表
    const rest = D.map((c) => ({ re: c, im: 0 }));
    let dr = rest;
    for (let it = 0; it < g.m; it++) dr = synthDiv(dr, g.p);
    const a = taylorAt(N.map((c) => ({ re: c, im: 0 })), g.p, g.m);
    const b = taylorAt(dr, g.p, g.m);
    const c: Complex[] = [];
    for (let i = 0; i < g.m; i++) {
      let acc: Complex = { re: a[i].re, im: a[i].im };
      for (let j = 0; j < i; j++) acc = cSub2(acc, cMul2(c[j], b[i - j]));
      c.push(cDiv2(acc, b[0]));
    }
    // c_i 是 (s−p)^i 的系数 → A_k（1/(s−p)^k 的系数）= c_{m−k}，反转对齐
    c.reverse();
    groups.push({ p: g.p, m: g.m, A: c, pair: g.p.im > tol });
  }
  return { ok: true, groups, direct };
}

/** f(t) 数值：Σ_p Σ_k A_k t^{k−1} e^{pt}/(k−1)!（共轭组自动成对取实）
 *  注：groups 中每对共轭极点多仅保留正虚部代表（pair=true），成对取实需 ×2（存量问题重修） */
export function evalLaplaceGroups(groups: FracGroup[], t: number): number {
  let acc = 0;
  for (const g of groups) {
    const et = Math.exp(g.p.re * t);
    let sr = 0;
    for (let k = 1; k <= g.m; k++) {
      const A = g.A[k - 1];
      const sc = (Math.pow(t, k - 1) / fact(k - 1)) * et;
      const wr = g.p.im * t;
      const cr = Math.cos(wr);
      const ci = Math.sin(wr);
      const ar = A.re * sc;
      const ai = A.im * sc;
      sr += ar * cr - ai * ci;
    }
    acc += g.pair ? 2 * sr : sr;
  }
  return acc;
}

/** h(n) 数值（n≥1）：Σ_p Σ_k A_k·C(n−1,k−1)·p^{n−k}（共轭组同样 ×2，与 texZGroups 一致） */
function evalZGroups(groups: FracGroup[], n: number): number {
  if (n < 1) return 0;
  const x = n - 1;
  let acc = 0;
  for (const g of groups) {
    let sr = 0;
    for (let k = 1; k <= g.m; k++) {
      // C(x, k−1)：x < k−1 时为 0
      if (x < k - 1) continue;
      let c = 1;
      for (let j = 1; j <= k - 1; j++) c = (c * (x - j + 1)) / j;
      const pw = Math.pow(Math.hypot(g.p.re, g.p.im), n - k);
      const th = Math.atan2(g.p.im, g.p.re) * (n - k);
      const pr = pw * Math.cos(th);
      const pi = pw * Math.sin(th);
      sr += g.A[k - 1].re * c * pr - g.A[k - 1].im * c * pi;
    }
    acc += g.pair ? 2 * sr : sr;
  }
  return acc;
}

/** 升幂实系数 → 降幂 tex（变量名 vn） */
function texPolyAsc(c: number[], vn: string): string {
  const parts: string[] = [];
  for (let i = c.length - 1; i >= 0; i--) {
    const a = c[i];
    if (Math.abs(a) < TOL_AXIS) continue;
    const pw = i;
    const sgn = parts.length ? (a > 0 ? '+' : '-') : a < 0 ? '-' : '';
    const co = Math.abs(Math.abs(a) - 1) < TOL_AXIS && pw > 0 ? '' : fmt3(Math.abs(a));
    parts.push(sgn + co + (pw === 0 ? '' : pw === 1 ? vn : vn + '^{' + pw + '}'));
  }
  return parts.join('') || '0';
}

export function texLaplaceGroups(groups: FracGroup[], prefix = 'f(t)='): string {
  const fx = (v: number): string => {
    const x = Math.abs(v) < TOL_TEX ? 0 : +v.toFixed(3);
    return (x < 0 ? '-' : '') + Math.abs(x);
  };
  let body = '';
  for (const g of groups) {
    if (g.p.im < -TOL_REL) continue; // 共轭成员由 pair 代表
    if (!g.pair) {
      // 实极点：c_j = A_{j+1}/j!（升幂）→ 多项式(t)·e^{σt}
      const c = g.A.map((A, j) => A.re / fact(j));
      const poly = texPolyAsc(c, 't');
      const et = Math.abs(g.p.re) < TOL_AXIS ? '' : 'e^{' + fx(g.p.re) + 't}';
      let term: string;
      if (poly === '1' && et) term = et;
      else if (poly === '0') term = '';
      else term = (/[+\-]/.test(poly.slice(1)) ? '\\left(' + poly + '\\right)' : poly) + et;
      body += '+' + term;
    } else {
      // 共轭对：2e^{σt}[P(t)cos ωt + Q(t)sin ωt]，P/Q 为升幂多项式
      const P = g.A.map((A, j) => A.re / fact(j));
      const Q = g.A.map((A, j) => -A.im / fact(j));
      const pTex = texPolyAsc(P, 't');
      const qTex = texPolyAsc(Q, 't');
      let inner = '';
      if (pTex !== '0') inner += pTex + '\\cos(' + fx(g.p.im) + 't)';
      if (qTex !== '0') {
        const neg = qTex.startsWith('-');
        inner +=
          (inner ? (neg ? '-' : '+') : neg ? '-' : '') +
          (neg ? texPolyAsc(Q.map((v) => -v), 't') : qTex) +
          '\\sin(' + fx(g.p.im) + 't)';
      }
      body += '+2e^{' + fx(g.p.re) + 't}\\left[' + (inner || '0') + '\\right]';
    }
  }
  body = body.replace(/^\+/, '') || '0';
  return prefix + body;
}

export function texZGroups(groups: FracGroup[]): string {
  const fx = (v: number): string => {
    const x = Math.abs(v) < TOL_TEX ? 0 : +v.toFixed(3);
    return (x < 0 ? '-' : '') + Math.abs(x);
  };
  // C(x,j) 的 monomial 系数表（j ≤ 3）
  const binomTable = [[1], [0, 1], [0, -0.5, 0.5], [0, 1 / 3, -0.5, 1 / 6]];
  let body = '';
  for (const g of groups) {
    if (g.p.im < -TOL_REL) continue;
    // B_j = A_{j+1}·p^{−j}；h 部 = p^{n−1}·Σ B_j C(n−1, j)（实极点）或共轭 2Re 形式
    const B = g.A.map((A, j) => {
      const pw = Math.pow(Math.hypot(g.p.re, g.p.im), -j);
      const th = Math.atan2(g.p.im, g.p.re) * -j;
      return {
        re: A.re * pw * Math.cos(th) - A.im * pw * Math.sin(th),
        im: A.re * pw * Math.sin(th) + A.im * pw * Math.cos(th),
      };
    });
    if (!g.pair) {
      const mono = new Array<number>(g.m).fill(0);
      for (let j = 0; j < g.m && j < 4; j++) {
        const cj = B[j].re;
        if (Math.abs(cj) < TOL_AXIS) continue;
        for (let i = 0; i < binomTable[j].length; i++) mono[i] += cj * binomTable[j][i];
      }
      const poly = texPolyAsc(mono, '(n{-}1)');
      if (Math.abs(g.p.re) < TOL_AXIS) {
        // 极点在原点：A₁·δ(n−1)（高阶项 A₂·δ'(n−1) 等不展示）
        body += '+' + fmt3(g.A[0].re) + '\\delta(n{-}1)';
      } else if (g.m === 1) {
        const co = fmt3(g.A[0].re);
        body += '+' + (co === '1' ? '' : co + '\\,') + fx(g.p.re) + '^{\\,n-1}';
      } else {
        body += '+\\left(' + poly + '\\right)\\,' + fx(g.p.re) + '^{\\,n-1}';
      }
    } else {
      const r = Math.hypot(g.p.re, g.p.im);
      const th = Math.atan2(g.p.im, g.p.re);
      const P = B.map((b) => b.re);
      const Q = B.map((b) => b.im);
      const pTex = texPolyAsc(P, '(n{-}1)');
      const qTex = texPolyAsc(Q, '(n{-}1)');
      let inner = '';
      if (pTex !== '0') inner += pTex + '\\cos\\!\\big(' + fx(th) + '(n{-}1)\\big)';
      if (qTex !== '0') {
        const neg = qTex.startsWith('-');
        inner +=
          (inner ? (neg ? '-' : '+') : neg ? '-' : '') +
          (neg ? texPolyAsc(Q.map((v) => -v), '(n{-}1)') : qTex) +
          '\\sin\\!\\big(' + fx(th) + '(n{-}1)\\big)';
      }
      body += '+2\\,' + fx(r) + '^{\\,n-1}\\left[' + (inner || '0') + '\\right]';
    }
  }
  return body.replace(/^\+/, '') || '0';
}

export type InvLaplaceResult =
  | { tex: null; note: string }
  | { tex: string; note: string; direct: number; groups: FracGroup[]; evalT: (t: number) => number };

/** 连续：H(s)=N/D（真分式，支持重极点）→ f(t) 解析式 */
export function invLaplace(num: number[], den: number[]): InvLaplaceResult {
  const n = den.length - 1;
  const b = num.slice();
  while (b.length < n + 1) b.unshift(0);
  const pf = partialFracGroups(num, den);
  if (!pf.ok) return { tex: null, note: pf.note };
  let body = texLaplaceGroups(pf.groups, '');
  body = body === '0' ? '' : body;
  if (Math.abs(pf.direct) > TOL_ZERO) body += (body ? '+' : '') + `${num2tex(pf.direct)}\\delta(t)`;
  let tex = 'f(t)=' + (body || '0');
  if (body) tex += '\\cdot u(t)';
  return {
    tex,
    note: '',
    direct: pf.direct,
    groups: pf.groups,
    evalT: (t) => evalLaplaceGroups(pf.groups, t),
  };
}

export type InvZResult =
  | { tex: null; note: string }
  | { tex: string; note: string; direct: number; groups: FracGroup[]; evalN: (n: number) => number };

/** 离散：H(z)=N/D（正幂，真分式，支持重极点）→ h[n] 解析式 */
export function invZ(num: number[], den: number[]): InvZResult {
  const pf = partialFracGroups(num, den);
  if (!pf.ok) return { tex: null, note: pf.note };
  const b0 = pf.direct;
  let tex = texZGroups(pf.groups);
  let body = tex === '0' ? '' : tex;
  if (Math.abs(b0) > TOL_ZERO) body += (body ? '+' : '') + `${num2tex(b0)}\\delta(n)`;
  tex = 'h(n)=' + (body || '0') + '\\ (n\\ge 1)';
  const maxAbs = pf.groups.reduce((m, g) => Math.max(m, Math.hypot(g.p.re, g.p.im)), 0);
  const note =
    maxAbs < 1
      ? '全部极点在单位圆内 → h(n) 收敛（稳定）'
      : maxAbs > 1
        ? '存在单位圆外极点 → h(n) 发散（不稳定）'
        : '极点在单位圆上 → 临界';
  return {
    tex,
    note,
    direct: b0,
    groups: pf.groups,
    evalN: (n) => (n === 0 ? b0 : evalZGroups(pf.groups, n)),
  };
}

/* ---------- 拉普拉斯性质数值验证：定义积分 vs 符号公式 ----------
 * prop: 'shift'(时移 tau) | 'freq'(频移 e^{-at}) | 'scale'(尺度 a>0) | 'diff'(微分)
 * 左侧 = 变换后时域信号的定义积分（复梯形），右侧 = 符号公式（FsNumeric 闭式）。 */

export interface PropCheck {
  s: string;
  lhs: number;
  rhs: number;
  rel: number;
}

export type PropVerifyResult =
  | { ok: false; note: string }
  | {
      ok: true;
      title: string;
      rhsTex: string;
      sPoint: string;
      checks: PropCheck[];
      maxRel: number;
      passed: boolean;
    };

export function propVerify(items: TimeItem[] | null | undefined, prop: string, param?: number): PropVerifyResult {
  if (!items || !items.length) return { ok: false, note: '信号为空' };
  let right = 0;
  for (const it of items) right = Math.max(right, it.kind === 'exp' || it.kind === 'texp' ? -it.a : 0);
  const sigma = right + 1.5; // Re(s) > ROC 右缘，实轴验证点
  const N = 120000;
  const Tmax = 60 / sigma;
  // 定义积分 ∫_{t0}^{Tmax} f(t)e^{-σt}dt：复合梯形（起点可对齐间断，避免跨跳变采样）
  const numLap = (f: (t: number) => number, t0: number): number => {
    const a0 = Math.max(0, t0 || 0);
    const dt = (Tmax - a0) / N;
    let acc = 0;
    for (let i = 0; i <= N; i++) {
      const t = a0 + i * dt;
      const m = i === 0 || i === N ? 1 : 2;
      acc += (f(t) * Math.exp(-sigma * t) * m * dt) / 2;
    }
    return acc;
  };
  const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(TOL_ZERO, Math.abs(b));
  const checks: PropCheck[] = [];
  let title = '';
  let rhsTex = '';
  const Fsv = FsNumeric(items, sigma);
  const Ftex = laplaceOfItems(items).fsLine.replace('F(s)=', '');
  const sTex = 's=' + sigma.toFixed(2);
  if (prop === 'shift') {
    const tau = Math.max(0, Number(param) || 0);
    title = '时移：L{f(t−' + num2tex(tau) + ')u(t−' + num2tex(tau) + ')} = e^{−' + num2tex(tau) + 's}F(s)';
    rhsTex = 'e^{−' + num2tex(tau) + 's}\\cdot[' + Ftex + ']';
    const lhs = numLap((t) => fNumeric(items, t - tau), tau);
    const rhs = Math.exp(-sigma * tau) * Fsv;
    checks.push({ s: sTex, lhs, rhs, rel: rel(lhs, rhs) });
  } else if (prop === 'freq') {
    const a = Number(param) || 0;
    title = '频移：L{e^{−' + num2tex(a) + 't}f(t)} = F(s+' + num2tex(a) + ')';
    rhsTex = '[' + Ftex + ']_{s\\to s+' + num2tex(a) + '}';
    const lhs = numLap((t) => Math.exp(-a * t) * fNumeric(items, t), 0);
    const rhs = FsNumeric(items, sigma + a);
    checks.push({ s: sTex, lhs, rhs, rel: rel(lhs, rhs) });
  } else if (prop === 'scale') {
    const a = Math.max(0.1, Number(param) || 2);
    title = '尺度：L{f(' + num2tex(a) + 't)} = (1/' + num2tex(a) + ')F(s/' + num2tex(a) + ')';
    rhsTex = '\\dfrac{1}{' + num2tex(a) + '}[' + Ftex + ']_{s\\to s/' + num2tex(a) + '}';
    const lhs = numLap((t) => fNumeric(items, a * t), 0);
    const rhs = FsNumeric(items, sigma / a) / a;
    checks.push({ s: sTex, lhs, rhs, rel: rel(lhs, rhs) });
  } else if (prop === 'diff') {
    title = '微分：L{f′(t)} = sF(s) − f(0+)';
    rhsTex = 's\\cdot[' + Ftex + '] - f(0^{+})';
    const h = 1e-5;
    const df = (t: number): number =>
      t < h
        ? (fNumeric(items, t + h) - fNumeric(items, t)) / h // 0 附近单侧差分（跳过间断）
        : (fNumeric(items, t + h) - fNumeric(items, t - h)) / (2 * h);
    const lhs = numLap(df, 0);
    const f0 = fNumeric(items, 1e-6);
    const rhs = sigma * Fsv - f0;
    checks.push({ s: sTex, lhs, rhs, rel: rel(lhs, rhs) });
  } else return { ok: false, note: '未知性质' };
  const maxRel = checks.reduce((m, c) => Math.max(m, c.rel), -Infinity);
  return { ok: true, title, rhsTex, sPoint: sTex, checks, maxRel, passed: isFinite(maxRel) && maxRel < TOL_CHECK };
}

/* ---------- 多 ROC 分析：按极点实部划分收敛域，逐域判定因果性/稳定性 ----------
 * 复极点不新增边界（只看实部）；jω 轴极点使任何 ROC 都不含虚轴（无稳定域）。 */

export interface RocRegion {
  lo: number;
  hi: number;
  containsJw: boolean;
  causal: boolean;
  anti: boolean;
  twoSided: boolean;
  stable: boolean;
  rocTex: string;
}

export type RocsResult =
  | { ok: false; note: string }
  | {
      ok: true;
      poles: Complex[];
      regions: RocRegion[];
      stableRegion: RocRegion | null;
      causalRegion: RocRegion | null;
      axisPole: boolean;
    };

export function rocs(_num: number[], den: number[]): RocsResult {
  const poles = polyRoots(den);
  if (!poles.length || poles.some((q) => !isFinite(q.re) || !isFinite(q.im))) {
    return { ok: false, note: '极点求解失败' };
  }
  const reals = [...new Set(poles.map((p) => +p.re.toFixed(9)))].sort((a, b) => a - b);
  const axisPole = reals.some((r) => Math.abs(r) < TOL_AXIS);
  const regions: RocRegion[] = [];
  for (let i = 0; i <= reals.length; i++) {
    const lo = i === 0 ? -Infinity : reals[i - 1];
    const hi = i === reals.length ? Infinity : reals[i];
    const containsJw = lo < 0 && hi > 0; // 虚轴 Re=0 在开区间内
    const causal = i === reals.length; // 最右区域→ 右侧（因果）信号
    const anti = i === 0; // 最左区域→ 左侧（反因果）
    regions.push({
      lo,
      hi,
      containsJw,
      causal,
      anti,
      twoSided: !causal && !anti,
      stable: containsJw,
      rocTex: (lo === -Infinity ? 'Re(s) < ' : 'Re(s) > ') + (hi === Infinity ? (lo === -Infinity ? 0 : num2tex(lo)) : num2tex(hi)),
    });
    // rocTex 对中间区域需要双边表述
    const r = regions[regions.length - 1];
    if (lo !== -Infinity && hi !== Infinity) r.rocTex = num2tex(lo) + ' < Re(s) < ' + num2tex(hi);
    else if (lo === -Infinity && hi !== Infinity) r.rocTex = 'Re(s) < ' + num2tex(hi);
    else if (lo !== -Infinity && hi === Infinity) r.rocTex = 'Re(s) > ' + num2tex(lo);
  }
  const stableRegion = regions.find((r) => r.stable) || null;
  const causalRegion = regions.find((r) => r.causal) || null;
  return { ok: true, poles, regions, stableRegion, causalRegion, axisPole };
}