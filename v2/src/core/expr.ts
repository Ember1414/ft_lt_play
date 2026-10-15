/**
 * expr.ts — 表达式归一化与白名单算术求值（自 v1 util.js 迁移）
 * 全站表达式解析的统一入口预处理（normChars）与安全求值器（safeCalc，替代 eval）。
 * 数值/错误语义与 v1 完全一致（回归网：safeeval.test.mjs）。
 */

/* 上标数字/ⁿ → ^N（注意 ¹²³ 属 Latin-1 区段，与 ⁴-⁹ 不同） */
const SUPS: Record<string, string> = {
  '\u2070': '0', '\u00B9': '1', '\u00B2': '2', '\u00B3': '3', '\u2074': '4',
  '\u2075': '5', '\u2076': '6', '\u2077': '7', '\u2078': '8', '\u2079': '9', '\u207F': 'n',
};

/**
 * 全角/Unicode 变体归一化（全站数学表达式解析器的统一入口处理）：
 * FF01–FF5E 全角 ASCII → 半角、全角空格、中文顿号/句号 → 逗号、Unicode 负号/破折号 → -、上标 → ^N、** → ^
 */
export function normChars(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/[\uFF01-\uFF5E\u3000]/g, (c) =>
      c === '\u3000' ? ' ' : String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .replace(/[，、]/g, ',')
    .replace(/[。．]/g, '.')
    .replace(/[\u2010-\u2015\u2212\uFF0D]/g, '-')
    .replace(/[\u2070\u00B9\u00B2\u00B3\u2074-\u2079\u207F]/g, (c) => '^' + SUPS[c])
    .replace(/\*\*/g, '^');
}

/**
 * 白名单算术求值器（替代 Function/eval 执行用户常量表达式，如 sin(π*2*t) 的括号内）。
 * 语法：数字 · + - * / ^ % · 括号 · 一元 ± · 常量 pi/e · 隐式乘法（2(3)、(1+2)(3+4)、2pi）；其余一律抛错。
 * 深度限制防超长嵌套括号打爆调用栈。
 */
export function safeCalc(src: string | null | undefined): number {
  // 入口归一化：全角数字/括号/运算符、Unicode 负号、上标、** → ASCII（π 不在 normChars 内，单独映射）
  // 隐式乘法补全（本求值器无函数名、无常量名以外的标识符，规则安全）：
  //   )( → )*( · 数字( → 数字*( · )数字 → )*数字 · 数字+字母 → 数字*字母（2pi → 2*pi）。
  //   字母类排除 e/E：保护科学计数 1e-3 / 1E5 不被拆坏。
  //   顺序：先 )( 后 )数字——避免 (2)(3)4 被 )数字 规则先拆坏括号配对。
  const s = normChars(String(src == null ? '' : src))
    .replace(/π/g, 'pi')
    .replace(/\s+/g, '')
    .replace(/\)\(/g, ')*(')
    .replace(/(\d)\(/g, '$1*(')
    .replace(/\)(\d)/g, ')*$1')
    .replace(/(\d)([a-df-z])/g, '$1*$2');
  if (!s || s.length > 200) throw new Error('表达式为空或过长');
  let i = 0;
  let depth = 0;
  const eat = (c: string): boolean => {
    if (s[i] === c) {
      i++;
      return true;
    }
    return false;
  };
  function parseExpr(): number {
    let v = parseTerm();
    for (;;) {
      if (eat('+')) v += parseTerm();
      else if (eat('-')) v -= parseTerm();
      else return v;
    }
  }
  function parseTerm(): number {
    let v = parseUnary();
    for (;;) {
      if (eat('*')) v *= parseUnary();
      else if (eat('/')) {
        const d = parseUnary();
        if (d === 0) throw new Error('除零');
        v /= d;
      } else if (eat('%')) {
        const d = parseUnary();
        if (d === 0) throw new Error('模零');
        v %= d;
      } else return v;
    }
  }
  function parseUnary(): number {
    if (eat('-')) return -parseUnary();
    if (eat('+')) return parseUnary();
    return parsePow();
  }
  function parsePow(): number {
    const b = parseAtom();
    if (eat('^')) return Math.pow(b, parseUnary()); // 右结合
    return b;
  }
  function parseAtom(): number {
    if (eat('(')) {
      if (++depth > 32) throw new Error('嵌套过深');
      const v = parseExpr();
      if (!eat(')')) throw new Error('括号不闭合');
      depth--;
      return v;
    }
    const m = s.slice(i).match(/^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if (m) {
      i += m[0].length;
      return parseFloat(m[0]);
    }
    if (s.startsWith('pi', i)) {
      i += 2;
      return Math.PI;
    }
    if (s[i] === 'e' && !/[0-9.]/.test(s[i + 1] || '')) {
      i++;
      return Math.E;
    }
    throw new Error('非法字符或写法「' + (s[i] || '末尾') + '」');
  }
  const v = parseExpr();
  if (i !== s.length) throw new Error('存在无法解析的残留「' + s.slice(i).slice(0, 12) + '」');
  if (!Number.isFinite(v)) throw new Error('结果非有限数');
  return v;
}