/* ============================================================
 * safeeval.test.mjs — 动态执行移除后的安全求值基线
 *   覆盖：U.safeCalc 白名单算术求值器、TR.parseTimeCombo 内的
 *   频率常量表达式（原 Function 实现路径）、FX_LIB.parseTimeExpr
 *   的 AST 白名单语义（Node 侧无 mathjs，仅验证拒绝路径）。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIBS = ['assets/js/lib/util.js', 'assets/js/lib/mathdsp.js', 'assets/js/lib/transforms.js', 'assets/js/lib/fx.js'];
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of LIBS) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
const { U, TR, FX_LIB } = sandbox;

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? '  → ' + extra : ''));
}
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };

/* ---------- U.safeCalc ---------- */
ok('safeCalc 基本四则', near(U.safeCalc('1+2*3'), 7));
ok('safeCalc 括号', near(U.safeCalc('(1+2)*3'), 9));
ok('safeCalc 幂右结合', near(U.safeCalc('2^3^2'), 512));
ok('safeCalc 一元负号', near(U.safeCalc('-2+5'), 3) && near(U.safeCalc('2*-3'), -6));
ok('safeCalc 常量 pi/e', near(U.safeCalc('pi'), Math.PI) && near(U.safeCalc('pi/2'), Math.PI / 2) && near(U.safeCalc('e'), Math.E));
ok('safeCalc 小数与科学计数', near(U.safeCalc('.5*2'), 1) && near(U.safeCalc('1e-2'), 0.01));
ok('safeCalc 取模', near(U.safeCalc('7%3'), 1));
ok('safeCalc 空白容忍', near(U.safeCalc(' 1 + 2 '), 3));
ok('safeCalc 拒绝字母标识符', throws(() => U.safeCalc('sin(2)')));
ok('safeCalc 拒绝空串', throws(() => U.safeCalc('')));
ok('safeCalc 拒绝残留运算符', throws(() => U.safeCalc('2+')));
ok('safeCalc 拒绝括号不闭合', throws(() => U.safeCalc('(1+2')));
ok('safeCalc 拒绝除零', throws(() => U.safeCalc('1/0')));
ok('safeCalc 拒绝超长输入', throws(() => U.safeCalc('1+'.repeat(300) + '1')));
ok('safeCalc 拒绝深层嵌套', throws(() => U.safeCalc('('.repeat(40) + '1' + ')'.repeat(40))));
ok('safeCalc 拒绝对象/属性访问', throws(() => U.safeCalc('constructor')));

/* ---------- TR.parseTimeCombo（evalW 替换后的行为回归） ---------- */
{
  const items = TR.parseTimeCombo('sin(2*pi*1*t)');
  ok('parseTimeCombo sin(2*pi*1*t) 识别', !!items && items.length === 1 && items[0].kind === 'sin');
  ok('sin 内 pi 表达式求值正确', items && near(items[0].w, 2 * Math.PI, 1e-9));
  const it2 = TR.parseTimeCombo('cos(pi*t)');
  ok('cos(pi*t) → w=π', it2 && near(it2[0].w, Math.PI, 1e-9));
  ok('非法频率写法整体拒绝', TR.parseTimeCombo('sin(bad*t)') === null);
  ok('除零频率写法整体拒绝', TR.parseTimeCombo('sin(1/0*t)') === null);
}

/* ---------- FX_LIB.parseTimeExpr AST 白名单（无 mathjs 时拒绝路径） ---------- */
ok('无 mathjs → parseTimeExpr 返回 null', FX_LIB.parseTimeExpr('sin(t)') === null);

console.log(fails.length
  ? `✗ safeeval ${pass} 通过，${fails.length} 失败:\n  ` + fails.join('\n  ')
  : `✓ safeeval ${pass} 项全部通过`);
process.exit(fails.length ? 1 : 0);
