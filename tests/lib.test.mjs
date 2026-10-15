/* ============================================================
 * lib.test.mjs — 核心库回归断言（极简，无框架）
 *   运行：node tests/lib.test.mjs
 *   覆盖：util.js / mathdsp.js / transforms.js / plots.js 中的纯函数。
 *   这几个库不依赖 DOM（plots.js 仅在运行时触碰 DOM），可在 Node 中加载执行。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIBS = ['assets/js/lib/util.js', 'assets/js/lib/mathdsp.js', 'assets/js/lib/fx.js', 'assets/js/lib/transforms.js', 'assets/js/lib/plots.js'];

// 极简沙箱：只需自引用的 window（各库末尾都写 window.X = X）
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of LIBS) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { U, DSP, TR, FX_LIB } = sandbox;

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? '  → ' + extra : ''));
}
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
function sorted(xs) { return xs.map((c) => c.re).concat().sort((a, b) => a - b); }

/* ---------- mathdsp: polyRoots ---------- */
{
  // 前导零（分子补零对齐后的常见输入）不得产生 NaN 根
  ok('polyRoots 前导零 [0,0,1] 无根', DSP.polyRoots([0, 0, 1]).length === 0);
  ok('polyRoots 全零 [0,0] 无根', DSP.polyRoots([0, 0]).length === 0);
  const r = DSP.polyRoots([0, 1, -3, 2]);          // 实际是 z²−3z+2
  ok('polyRoots 去零后 z²−3z+2 → {1,2}',
    r.length === 2 && near(sorted(r)[0], 1, 1e-3) && near(sorted(r)[1], 2, 1e-3),
    JSON.stringify(r));

  const rc = DSP.polyRoots([1, 0.5, 1.25]);         // 二阶欠阻尼：−0.25 ± j1.0897
  ok('polyRoots 复根共轭', rc.length === 2 && near(rc[0].re, -0.25, 1e-3)
    && near(Math.abs(rc[0].im), 1.08972, 1e-3)
    && near(rc[0].im, -rc[1].im, 1e-9), JSON.stringify(rc));
  ok('polyRoots 无 NaN', rc.every((c) => isFinite(c.re) && isFinite(c.im)));

  // 由根重构多项式应还原原系数
  const back = DSP.polyFromRoots(DSP.polyRoots([1, 3, 2]));
  ok('polyFromRoots 往返 [1,3,2]',
    back.length === 3 && near(back[0], 1, 1e-6) && near(back[1], 3, 1e-6) && near(back[2], 2, 1e-6),
    JSON.stringify(back));
}

/* ---------- mathdsp: FFT / spectrum / conv / ltiResponse / bode ---------- */
{
  // 单边幅度谱：cos(2π·3t)、fs=64、N=1024 → 3Hz 处峰值≈1
  const N = 1024, dt = 1 / 64;
  const y = Array.from({ length: N }, (_, i) => Math.cos(2 * Math.PI * 3 * i * dt));
  const sp = DSP.spectrum(y, dt);
  let bi = 0;
  for (let i = 1; i < sp.mag.length - 1; i++) if (sp.mag[i] > sp.mag[bi]) bi = i;
  ok('spectrum 峰值频率 ≈3Hz', near(sp.f[bi], 3, 0.1), 'f=' + sp.f[bi]);
  // 约定：|X(f)| 为幅度密度（对单位幅值余弦，单边峰值 = 幅值 × 总时长 T）
  ok('spectrum 单边峰值为密度约定 A·T', near(sp.mag[bi] / (N * dt), 1, 0.02), 'mag=' + sp.mag[bi]);

  const c = DSP.conv([1, 2, 3], [1, 1]);
  ok('conv [1,2,3]*[1,1] = [1,3,5,3]',
    c.length === 4 && c.every((v, i) => near(v, [1, 3, 5, 3][i])), JSON.stringify(c));

  // 一阶系统 1/(s+1) 的阶跃响应：y(t)=1−e^{−t}
  const sim = DSP.ltiResponse([1], [1, 1], (t) => (t >= 0 ? 1 : 0), 0, 5, 5000);
  const k = sim.t.findIndex((v) => v >= 1);
  ok('ltiResponse 一阶阶跃 y(1)≈1−e⁻¹', near(sim.y[k], 1 - Math.exp(-1), 2e-3), 'y=' + sim.y[k]);
  ok('ltiResponse 末值 ≈1−e⁻⁵', near(sim.y[sim.y.length - 1], 1 - Math.exp(-5), 2e-3),
    'y=' + sim.y[sim.y.length - 1]);

  // |1/(j·1 + 1)| = 1/√2 → −3.01 dB
  const b = DSP.bode([1], [1, 1], 0, 1, 400);
  const i1 = b.w.findIndex((w) => w >= 1);
  ok('bode |H(j1)| ≈ −3dB', near(b.mag[i1], -3.0103, 0.05), 'mag=' + b.mag[i1]);
}

/* ---------- util: polyTex（首项负号 / 跳零系数） ---------- */
{
  ok('polyTex 首项负号', U.polyTex([-1, -2]) === '-s-2', U.polyTex([-1, -2]));
  ok('polyTex 首项负系数', U.polyTex([-3, 1]) === '-3s+1', U.polyTex([-3, 1]));
  ok('polyTex 跳前导零系数', U.polyTex([0, 1]) === '1', U.polyTex([0, 1]));
  ok('polyTex 常规', U.polyTex([2, -4]) === '2s-4', U.polyTex([2, -4]));
  ok('polyTex 全零', U.polyTex([0, 0]) === '0', U.polyTex([0, 0]));
  ok('polyTex 单位系数', U.polyTex([1, 0, 1]) === 's^{2}+1', U.polyTex([1, 0, 1]));
}

/* ---------- transforms: 连续变换与反变换 ---------- */
{
  const items = TR.parseTimeCombo('2*exp(-3*t)*u(t)');
  ok('parseTimeCombo 解析指数项', !!items && items.length === 1 && items[0].kind === 'exp' && items[0].a === 3);
  const lap = TR.laplaceOfItems(items);
  ok('laplaceOfItems 2e^{-3t} → 2/(s+3)', lap.fsLine.indexOf('2') >= 0 && lap.fsLine.indexOf('s+3') >= 0, lap.fsLine);
  ok('FsNumeric 与解析式一致', near(TR.FsNumeric(items, 5), 2 / (5 + 3), 1e-9));
  ok('fNumeric t<0 为 0', TR.fNumeric(items, -1) === 0 && near(TR.fNumeric(items, 0), 2, 1e-9));

  // 1/(s+1)² 有重极点 s=−1（重数 2）→ f(t)=t·e^{−t}
  const pf = TR.partialFracGroups([1], [1, 2, 1]);
  ok('partialFracGroups 识别重极点', pf.ok && pf.groups.length === 1 && pf.groups[0].m === 2,
    JSON.stringify(pf.groups && pf.groups.map((g) => g.m)));
  ok('evalLaplaceGroups 重极点 → t·e^{−t}', near(TR.evalLaplaceGroups(pf.groups, 1), Math.exp(-1), 1e-6));

  const il = TR.invLaplace([1], [1, 2]);
  ok('invLaplace 1/(s+2) → e^{−2t}u(t)', near(il.evalT(1), Math.exp(-2), 1e-6), il.tex);
  ok('invLaplace tex 含 u(t)', /u\(t\)/.test(il.tex));

  // 1/(z−0.5) = z⁻¹/(1−0.5z⁻¹) → h(n)=0.5^{n−1} (n≥1)
  const iz = TR.invZ([1], [1, -0.5]);
  ok('invZ 1/(z−0.5) → 0.5^{n−1}', near(iz.evalN(1), 1, 1e-9) && near(iz.evalN(3), 0.25, 1e-9),
    JSON.stringify([iz.evalN(1), iz.evalN(3)]));
}

/* ---------- 增补：符号参数提取与代入 ---------- */
{
  const ps = FX_LIB.extractParams('(s+z)/(s+p)');
  ok('extractParams 提取 z/p', ps.length === 2 && ps[0] === 'z' && ps[1] === 'p', JSON.stringify(ps));
  ok('extractParams 排除 s/函数名', FX_LIB.extractParams('s*sin(s*w)/s').length === 1 && FX_LIB.extractParams('s*sin(s*w)/s')[0] === 'w', JSON.stringify(FX_LIB.extractParams('s*sin(s*w)/s')));
  ok('extractParams 排除 pi/e', FX_LIB.extractParams('pi*s+e*z').join(',') === 'z', JSON.stringify(FX_LIB.extractParams('pi*s+e*z')));
  const sub = FX_LIB.substituteParams('wn*wn', { wn: 2 });
  ok('substituteParams 代入', FX_LIB.parseTF(sub).num[0] === 4, sub);
  const sub2 = FX_LIB.substituteParams('s^2+2*z*wn*s+wn*wn', { z: 0.25, wn: 3 });
  const t2 = FX_LIB.parseTF(sub2);
  ok('substituteParams 二阶模板', t2 && t2.num[0] === 1 && Math.abs(t2.num[1] - 1.5) < 1e-9 && t2.num[2] === 9, JSON.stringify(t2 && t2.num));
  ok('substituteParams 保留未知标识符', FX_LIB.substituteParams('s+z', {}) === 's+z');
  ok('substituteParams 幂等（数值不变）', FX_LIB.parseTF(FX_LIB.substituteParams('1/(s^2+2*s+5)', {})).den[2] === 5);
}

/* ---------- fx: parseTF 隐式乘法（explore 传函自动路由的解析基础，v1.1 回归锁定） ---------- */
{
  const eqNum = (name, t, want) => ok(name, !!t && JSON.stringify(t.num) === JSON.stringify(want), JSON.stringify(t && t.num));
  eqNum('parseTF (s+1)(s+2)', FX_LIB.parseTF('(s+1)(s+2)'), [1, 3, 2]);
  eqNum('parseTF (s+1)^2(s+3)', FX_LIB.parseTF('(s+1)^2(s+3)'), [1, 5, 7, 3]);
  eqNum('parseTF 2(s+1)', FX_LIB.parseTF('2(s+1)'), [2, 2]);
  eqNum('parseTF s(s+1)(s+2)', FX_LIB.parseTF('s(s+1)(s+2)'), [1, 3, 2, 0]);
  eqNum('parseTF 2s', FX_LIB.parseTF('2s'), [2, 0]);
  eqNum('parseTF s^2(s+1)', FX_LIB.parseTF('s^2(s+1)'), [1, 1, 0, 0]);
  const tfd = FX_LIB.parseTF('1/((s+1)(s+2))');
  ok('parseTF 分母隐式乘法', !!tfd && JSON.stringify(tfd.den) === JSON.stringify([1, 3, 2]), JSON.stringify(tfd && tfd.den));
  const tfw = FX_LIB.parseTF('１／(s+1)');   // 全角分数线 ／：入口 normChars 后再切分
  ok('parseTF 全角分数线', !!tfw && JSON.stringify(tfw.num) === '[1]' && JSON.stringify(tfw.den) === '[1,1]', JSON.stringify(tfw));
  // den 形状回归（v1.1.2 explore 门控放行依据）：纯多项式输入（无 '/'）→ 分母为非零常数 [1]，
  // explore 的 tfProperOk 以 den.length===1 && den[0]!==0 放行；分母常数 0 由 parseTF 源头拒绝
  const tfp1 = FX_LIB.parseTF('(s+1)(s+2)');
  ok('parseTF (s+1)(s+2) den=[1]', !!tfp1 && JSON.stringify(tfp1.den) === JSON.stringify([1]), JSON.stringify(tfp1 && tfp1.den));
  const tfp2 = FX_LIB.parseTF('2(s+1)');
  ok('parseTF 2(s+1) den=[1]', !!tfp2 && JSON.stringify(tfp2.den) === JSON.stringify([1]), JSON.stringify(tfp2 && tfp2.den));
  ok('parseTF 1/0 拒绝（分母常数 0）', FX_LIB.parseTF('1/0') === null);
}

/* ---------- fx: parseTimeExpr（内置解析器，零外部依赖） ----------
 * v1.1.3 起不再依赖 CDN 的 mathjs：Node 沙箱（无任何外部库）即可完整覆盖
 * 解析 + 求值 + 拒绝路径，也保证「CDN 不可达时交互求解照常工作」。 */
{
  const P = (s) => FX_LIB.parseTimeExpr(s);
  // 交互求解页「示例 chips」全量（用户点得到的案例必须都能解析）
  const examples = [
    ['exp(-2*t)*sin(10*t)*u(t)', 0.1, Math.exp(-0.2) * Math.sin(1)],
    ['sin(2*pi*3*t)', 1 / 12, 1],
    ['3*sinc(t)', 0, 3],
    ['rect(t)-rect(t-2)', 0.25, 1],
    ['exp(-abs(t))', -1, Math.exp(-1)]
  ];
  for (const [s, q, want] of examples) {
    const f = P(s);
    ok('parseTimeExpr 示例「' + s + '」可解析', typeof f === 'function');
    ok('parseTimeExpr 示例「' + s + '」求值', f && near(f(q), want, 1e-9), f && String(f(q)));
  }
  ok('parseTimeExpr 阶跃 u(t) t<0 为 0', P('u(t)')(-1) === 0 && P('u(t)')(2) === 1);
  // 语法覆盖：隐式乘法 / 常量 / 归一化 / 科学计数 / 幂结合性 / 多参函数
  ok('parseTimeExpr 隐式乘法', near(P('2t')(3), 6) && near(P('3(t+1)')(1), 6) && near(P('(t+1)(t-1)')(3), 8));
  ok('parseTimeExpr 常量 pi/e/tau', near(P('e')(0), Math.E) && near(P('pi')(0), Math.PI) && near(P('tau')(0), 2 * Math.PI));
  ok('parseTimeExpr 全角归一化', near(P('ｅｘｐ（－２＊ｔ）')(1), Math.exp(-2)));
  ok('parseTimeExpr ** 归一化为幂', near(P('t**2')(3), 9) && near(P('t^2^3')(2), 256));
  ok('parseTimeExpr 科学计数不误拆', near(P('1e-3*t')(2), 0.002));
  ok('parseTimeExpr tri/min/max/ln', near(P('tri(t)')(0.25), 0.75) && near(P('max(0,t)')(-2), 0) && near(P('min(2,t)')(5), 2) && near(P('ln(e)')(0), 1));
  ok('parseTimeExpr 负指数', near(P('t^-2')(2), 0.25));
  // 拒绝路径（安全基线：白名单之外一律 null）
  ok('parseTimeExpr 拒绝非白名单函数', P('require(t)') === null && P('alert(1)') === null);
  ok('parseTimeExpr 拒绝未知标识符', P('window') === null && P('t+foo') === null);
  ok('parseTimeExpr 拒绝残缺表达式', P('1+') === null && P('(1+2') === null && P('1+2)') === null);
  ok('parseTimeExpr 拒绝空串/超长', P('') === null && P('   ') === null && P('1+'.repeat(200) + '1') === null);
  ok('parseTimeExpr 拒绝深层嵌套', P('('.repeat(40) + 't' + ')'.repeat(40)) === null);
  ok('parseTimeExpr 拒绝无穷值', P('1/(t-t)') === null);
}

/* ---------- plots: FX.texToText（KaTeX 缺失时的可读兜底，绝不显示源码） ---------- */
{
  const T = sandbox.FX.texToText;
  // cases 环境（derive 模块分段系数公式）：不得残留 \begin{cases}/&/\\ 字面量
  const casesIn = 'b_n=\\begin{cases}0& n\\text{ even}\\\\ \\dfrac{4}{n\\pi}& n\\text{ odd}\\end{cases}';
  const casesOut = T(casesIn);
  ok('texToText cases 环境无源码残留', !/(begin|end)|\\\\|&/.test(casesOut), casesOut);
  ok('texToText cases 输出可读', casesOut === 'b_n=｛0，n even；(4)/(nπ)，n odd｝', casesOut);
  ok('texToText bmatrix 矩阵兜底', T('\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}') === '[ a，b；c，d ]',
    T('\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}'));
  ok('texToText 转义花括号 \\{ \\}', T('\\mathcal{L}\\{e^{-at}u(t)\\}') === 'L｛e^-atu(t)｝', T('\\mathcal{L}\\{e^{-at}u(t)\\}'));
}

/* ---------- plots: FX.katex 非法 LaTeX 预校验（不渲染红色源码，ParseError 走纯文本兜底） ---------- */
{
  const fakeEl = () => {
    const cls = new Set();
    const attrs = {};
    return {
      classList: { add: (c) => cls.add(c), contains: (c) => cls.has(c) }, innerHTML: '', textContent: '',
      setAttribute: (k, v) => { attrs[k] = String(v); }, getAttribute: (k) => (k in attrs ? attrs[k] : null),
      removeAttribute: (k) => { delete attrs[k]; }
    };
  };
  sandbox.katex = {   // sandbox.window === sandbox；FX.katex 运行时读 window.katex
    renderToString: (tex) => { if (String(tex).includes('BAD')) throw new Error('ParseError: BAD'); return '<span>ok</span>'; },
    render: (tex, el) => { el.innerHTML = 'RENDERED:' + tex; }
  };
  const good = fakeEl();
  sandbox.FX.katex('x^2', good);
  ok('katex 合法公式正常渲染', good.innerHTML === 'RENDERED:x^2' && !good.classList.contains('tex-fallback'), good.innerHTML);
  const bad = fakeEl();
  sandbox.FX.katex('\\frac{BAD}{', bad);
  ok('katex 非法公式走纯文本兜底', bad.classList.contains('tex-fallback') && bad.textContent === sandbox.FX.texToText('\\frac{BAD}{'), bad.textContent);
  delete sandbox.katex;   // 清场，不影响其他测试
  // 无 KaTeX（CDN 不可达）：兜底时记录原 tex（data-tex）→ 备用源就绪（libs-ready）后可就地重排
  const late = fakeEl();
  sandbox.FX.katex('H(s)=\\dfrac{1}{s+1}', late, { displayMode: true });
  ok('无 KaTeX 时降级为可读纯文本', late.classList.contains('tex-fallback') && late.textContent === sandbox.FX.texToText('H(s)=\\dfrac{1}{s+1}'), late.textContent);
  ok('katex 兜底记录 data-tex 供迟到重排', late.getAttribute('data-tex') === 'H(s)=\\dfrac{1}{s+1}' && late.getAttribute('data-tex-display') === '1',
    JSON.stringify([late.getAttribute('data-tex'), late.getAttribute('data-tex-display')]));
}

/* ---------- 结果输出 ---------- */
console.log('\n通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (fails.length) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('✓ 全部断言通过');
}
