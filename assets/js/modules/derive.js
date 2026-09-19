/* ============================================================
 * derive.js — 公式推导
 *   性质表 + 逐步推导 + 小例子
 * ============================================================ */
App.register('derive', (host) => {
  /* ---------- 性质表数据 ---------- */
  const tables = {
    ft: {
      name: '傅立叶变换性质',
      rows: [
        ['线性', 'a\\,x_1(t)+b\\,x_2(t)', 'a\\,X_1(f)+b\\,X_2(f)'],
        ['时移', 'x(t-t_0)', 'X(f)e^{-j2\\pi f t_0}'],
        ['频移(调制)', 'x(t)e^{j2\\pi f_0 t}', 'X(f-f_0)'],
        ['时间缩放', 'x(at)', '\\frac{1}{|a|}X\\!\\left(\\tfrac{f}{a}\\right)'],
        ['时域微分', 'x\'(t)', 'j2\\pi f\\,X(f)'],
        ['对偶性', 'X(t)', 'x(-f)'],
        ['卷积定理', 'x(t)\\ast h(t)', 'X(f)\\,H(f)'],
        ['乘积定理', 'x(t)\\,h(t)', 'X(f)\\ast H(f)'],
        ['Parseval', '\\int| x(t)|^2\\,dt', '\\int|X(f)|^2\\,df']
      ]
    },
    la: {
      name: '拉普拉斯变换性质',
      rows: [
        ['线性', 'a f(t)+b g(t)', 'aF(s)+bG(s)'],
        ['时移', 'f(t-t_0)\\,u(t-t_0)', 'e^{-s t_0}F(s)'],
        ['s 域移位', 'e^{at}f(t)', 'F(s-a)'],
        ['时域微分', 'f\'(t)', 'sF(s)-f(0^-)'],
        ['时域积分', '\\int_0^t f(\\tau)d\\tau', '\\frac{F(s)}{s}'],
        ['s 域微分', '-t\\,f(t)', 'F\'(s)'],
        ['初值定理', '\\lim_{t\\to 0^+} f(t)', '\\lim_{s\\to\\infty}sF(s)'],
        ['终值定理', '\\lim_{t\\to\\infty} f(t)', '\\lim_{s\\to 0}sF(s)'],
        ['卷积定理', 'f(t)\\ast g(t)', 'F(s)\\,G(s)']
      ]
    },
    lt: {
      name: '常用拉普拉斯变换对',
      rows: [
        ['\\delta(t)', '1'],
        ['u(t)', '\\frac{1}{s}'],
        ['t^{n}\\,u(t)', '\\frac{n!}{s^{n+1}}'],
        ['e^{-at}u(t)', '\\frac{1}{s+a}'],
        ['\\cos(\\omega_0 t)u(t)', '\\frac{s}{s^2+\\omega_0^2}'],
        ['\\sin(\\omega_0 t)u(t)', '\\frac{\\omega_0}{s^2+\\omega_0^2}'],
        ['e^{-at}\\cos(\\omega_0 t)u(t)', '\\frac{s+a}{(s+a)^2+\\omega_0^2}'],
        ['e^{-at}\\sin(\\omega_0 t)u(t)', '\\frac{\\omega_0}{(s+a)^2+\\omega_0^2}']
      ]
    },
    zt: {
      name: 'Z 变换性质',
      rows: [
        ['线性', 'a\\,x[n]+b\\,y[n]', 'aX(z)+bY(z)'],
        ['延迟 k 拍', 'x[n-k]\\,u[n-k]', 'z^{-k}X(z)'],
        ['超前 k 拍', 'x[n+k]', 'z^{k}\\!\\left(X(z)-\\sum_{m=0}^{k-1}x[m]z^{-m}\\right)'],
        ['指数加权', 'a^{n}x[n]', 'X(z/a)'],
        ['卷积和', 'x[n]*y[n]', 'X(z)\\,Y(z)'],
        ['初值定理', 'x[0]=\\lim_{z\\to\\infty}X(z)', '\\text{(因果序列)}'],
        ['终值定理', '\\lim_{n\\to\\infty}x[n]', '\\lim_{z\\to 1}(z-1)X(z)'],
        ['与 s 域联系', 'z=e^{sT}', '\\text{单位圆}\\leftrightarrow j\\omega\\text{ 轴}']
      ]
    },
    ztp: {
      name: '常用 Z 变换对',
      rows: [
        ['\\delta[n]', '1', '\\text{全部 }z'],
        ['u[n]', '\\frac{z}{z-1}', '|z|>1'],
        ['a^{n}u[n]', '\\frac{z}{z-a}', '|z|>|a|'],
        ['n\\,a^{n}u[n]', '\\frac{az}{(z-a)^2}', '|z|>|a|'],
        ['\\cos(\\omega_0 n)u[n]', '\\frac{z(z-\\cos\\omega_0)}{z^2-2z\\cos\\omega_0+1}', '|z|>1'],
        ['\\sin(\\omega_0 n)u[n]', '\\frac{z\\sin\\omega_0}{z^2-2z\\cos\\omega_0+1}', '|z|>1'],
        ['r^{n}\\cos(\\omega_0 n)u[n]', '\\frac{z(z-r\\cos\\omega_0)}{z^2-2rz\\cos\\omega_0+r^2}', '|z|>r']
      ]
    }
  };
  /* ---------- 逐步推导数据 ---------- */
  const derivations = {
    square: {
      name: '方波的傅立叶级数（逐步算系数）',
      desc: '一个奇对称、周期为 T 的方波：+1 在 (0,T/2)，−1 在 (T/2,T)。求它的三角傅立叶级数。',
      steps: [
        { t: '定义与周期', desc: '取 T=2π 使基频 ω₀=2π/T=1。奇函数 f(−t)=−f(t)，因此只有正弦项。', body: 'f(t)=\\begin{cases}+1 & 0<t<\\pi \\\\ -1 & \\pi<t<2\\pi\\end{cases}, \\qquad \\omega_0=\\frac{2\\pi}{T}' },
        { t: '系数公式：只剩 aₙ 或 bₙ',
          desc: '三角级数通式 f(t)=a₀/2 + Σ aₙcos(nω₀t) + Σ bₙ sin(nω₀t)。因奇函数，a₀=0 且 aₙ=0。',
          body: 'b_n = \\frac{2}{T}\\int_{0}^{T} f(t)\\sin(n\\omega_0 t)\\,dt, \\quad a_0=a_n=0' },
        { t: '代入并分段积分（关键一步）',
          desc: '在 [0,π] 上 f=+1，在 [π,2π] 上 f=−1，两段积分。',
          body: 'b_n=\\frac{1}{\\pi}\\int_0^{\\pi}(+1)\\sin(nt)dt + \\frac{1}{\\pi}\\int_{\\pi}^{2\\pi}(-1)\\sin(nt)dt' },
        { t: '求出积分结果',
          desc: '∫sin(nt)dt = −cos(nt)/n，代入上下限。',
          body: '=\\frac{1}{\\pi}\\left[-\\frac{\\cos(nt)}{n}\\right]_0^{\\pi} - \\frac{1}{\\pi}\\left[-\\frac{\\cos(nt)}{n}\\right]_{\\pi}^{2\\pi}' },
        { t: '代入端点值',
          desc: 'cos(nπ)=(−1)ⁿ（n 为偶数 +1，奇数 −1）；cos(2nπ)=1；cos0=1。',
          body: 'b_n=\\frac{1-\\cos(n\\pi)}{n\\pi} + \\frac{1-\\cos(n\\pi)}{n\\pi} = \\frac{2\\, (1-\\cos(n\\pi))}{n\\pi}' },
        { t: '区分奇偶得到最终系数',
          desc: 'n 为偶数：cos(nπ)=1 → bₙ=0。n 为奇数：cos(nπ)=−1 → bₙ=(2·2)/(nπ)=4/(nπ)。',
          body: 'b_n=\\begin{cases}0& n\\text{ even}\\\\ \\dfrac{4}{n\\pi}& n\\text{ odd}\\end{cases}' },
        { t: '写出级数并讨论 Gibbs',
          body: 'f(t)=\\sum_{k=1}^{\\infty}\\frac{4}{(2k-1)\\pi}\\,\\sin\\big((2k-1)\\omega_0 t\\big)' }
      ]
    },
    laplace: {
      name: '拉普拉斯变换：e^{-at}u(t) 的定义积分',
      desc: '直接用单边拉普拉斯变换定义推导。',
      steps: [
        { t: '三条定义', body: 'F(s)=\\int_{0^-}^{\\infty} f(t)e^{-st}dt, \\quad s=\\sigma+j\\omega' },
        { t: '代入 f(t)=e^{-at}u(t)', body: 'F(s)=\\int_0^{\\infty} e^{-at}e^{-st}dt=\\int_0^{\\infty} e^{-(s+a)t}dt' },
        { t: '积分（注意需 Re(s+a)>0 才收敛）', body: 'F(s)=\\left[-\\frac{e^{-(s+a)t}}{s+a}\\right]_0^{\\infty}' },
        { t: '代入上下限：t→∞ 指数→0，t=0 →1', body: 'F(s)=\\frac{0-(-1)}{s+a}=\\frac{1}{s+a}, \\qquad \\operatorname{Re}(s)>-a' }
      ]
    },
    rect: {
      name: '矩形脉冲 ↔ sinc：傅立叶变换推导',
      desc: '宽度 T 的矩形脉冲，中心在原点。',
      steps: [
        { t: '定义变换对（用角频率 ω）', body: 'X(\\omega)=\\int_{-\\infty}^{\\infty} x(t)e^{-j\\omega t}dt' },
        { t: '代入矩形（有限支撑，只需积 −T/2 到 T/2）', body: 'X(\\omega)=\\int_{-T/2}^{T/2} 1\\cdot e^{-j\\omega t}dt=\\left[\\frac{e^{-j\\omega t}}{-j\\omega}\\right]_{-T/2}^{T/2}' },
        { t: '端点相减', body: '=\\frac{e^{-j\\omega T/2}-e^{j\\omega T/2}}{-j\\omega}' },
        { t: '用 Euler：e^{jθ}−e^{−jθ}=2j sin θ', body: '=\\frac{(-\\;2j\\sin(\\omega T/2))}{-j\\omega}=\\frac{2\\sin(\\omega T/2)}{\\omega}' },
        { t: '写成 sinc 形式（sinc(x)=sin(πx)/(πx)）',
          desc: '分子分母同乘 T：ωT/2 = π·(Tf)，其中 f=ω/2π。于是 sin(ωT/2)/(ωT/2) = sinc(Tf)。',
          body: 'X(\\omega)=\\frac{2\\sin(\\omega T/2)}{\\omega}=T\\cdot\\frac{\\sin(\\omega T/2)}{\\omega T/2}=T\\,\\mathrm{sinc}\\!\\left(\\frac{\\omega T}{2\\pi}\\right)=T\\,\\mathrm{sinc}(T f)' }
      ]
    },
    zsum: {
      name: 'Z 变换：a^{n}u[n] 的定义求和',
      desc: '单边 Z 变换定义 X(z)=Σ_{n=0}^{∞} x[n] z^{-n}，对指数序列用几何级数求和。',
      steps: [
        { t: '定义代入', body: 'X(z)=\\sum_{n=0}^{\\infty}a^{n}z^{-n}=\\sum_{n=0}^{\\infty}\\left(az^{-1}\\right)^{n}' },
        { t: '几何级数（需 |az^{-1}|<1，即 |z|>|a|）', body: '=\\frac{1}{1-az^{-1}}=\\frac{z}{z-a}, \\qquad \\text{ROC: } |z|>|a|' },
        { t: '极点与 ROC', desc: '极点 z=a 在 ROC 边界上；a 在单位圆内 ⇔ 序列有界收敛（稳定）。', body: 'z=a\\;\\text{(一阶极点)}, \\quad |a|<1 \\Leftrightarrow \\text{稳定}' },
        { t: '频响（单位圆上的 Z 变换）', desc: '令 z=e^{jω}，ROC 含单位圆时可代入。', body: 'H(e^{j\\omega})=\\frac{1}{1-ae^{-j\\omega}}' }
      ]
    },
    conv1: {
      name: '小例子：卷积求响应',
      desc: '系统 h(t)=e^{-t}u(t)，输入 x(t)=e^{-2t}u(t)，求输出 y(t)=x∗h。',
      steps: [
        { t: '卷积积分（因果：t<0 时 y=0；t≥0 积分从 0 到 t）', body: 'y(t)=\\int_{-\\infty}^{\\infty} x(\\tau)h(t-\\tau)d\\tau=\\int_0^{t} e^{-2\\tau}e^{-(t-\\tau)}d\\tau' },
        { t: '合并指数', body: '=e^{-t}\\int_0^{t} e^{-\\tau}d\\tau = e^{-t}\\left[-e^{-\\tau}\\right]_0^{t}' },
        { t: '结果', body: 'y(t)=e^{-t}(1-e^{-t})u(t)' },
        { t: '用拉普拉斯验证（乘法更省事）', desc: 's 域中卷积变成乘法：Y(s)=X(s)H(s)，部分分式展开后与直接积分的结果一致。',
          body: 'Y(s)=\\frac{1}{s+2}\\cdot\\frac{1}{s+1}=\\frac{1}{s+1}-\\frac{1}{s+2}\\;\\Rightarrow\\;y(t)=e^{-t}-e^{-2t}=e^{-t}(1-e^{-t})\\,u(t)' }
      ]
    }
  };

  // 步骤标题：支持 tm（KaTeX 内联数学）+ t（纯文本），避免标题里出现 e^(-2t) 之类的代码感写法
  function stepHeadEl(st, i) {
    const head = U.el('button', { class: 'step-head' });
    head.append(U.el('span', { class: 'arrow' }, '▶'));
    const txt = U.el('span', { style: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap' });
    if (st.tm) {
      txt.append(document.createTextNode((i + 1) + '. '));
      txt.append(FX.span(st.tm));
      txt.append(document.createTextNode(st.t));
    } else {
      txt.textContent = `${i + 1}. ${st.t}`;
    }
    head.append(txt);
    return head;
  }

  /* ---------- 自定义推导：输入 f(t) → 拉普拉斯 + 傅里叶 ---------- */
  // 解析复用 TR.parseTimeCombo（宽松格式 + 共享语法）；u(t) 项等价于常数项 c·u(t)
  function parseCombo(str) {
    const items = TR.parseTimeCombo(str);
    return items ? items.map((it) => (it.kind === 'u' ? { ...it, kind: 'const' } : it)) : null;
  }
  const fact = (n) => { let r = 1; for (let k = 2; k <= n; k++) r *= k; return r; };
  const num2tex = (v) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(4)));
  // 单项的 F(s)（不含符号，符号统一由线性合并行负责，写法对齐 TR.itemLapTex）
  function itemFsTex(it) {
    switch (it.kind) {
      case 'exp': return `\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef)}}{s+${num2tex(it.a)}}`;
      case 'texp': return `\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef) + '\\,'}${fact(it.n)}}{(s+${num2tex(it.a)})^{${it.n + 1}}}`;
      case 'sin': return `\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef) + '\\cdot'}${num2tex(it.w)}}{s^{2}+${num2tex(it.w * it.w)}}`;
      case 'cos': return `\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef) + '\\cdot'}s}{s^{2}+${num2tex(it.w * it.w)}}`;
      case 'tpow': return `\\dfrac{${it.coef === 1 ? '' : num2tex(it.coef) + '\\cdot'}${fact(it.n)}}{s^{${it.n + 1}}}`;
      case 'const': return `\\dfrac{${num2tex(it.coef)}}{s}`;
    }
    return '';
  }
  // f(t) 数值 / F(s) 数值
  function itemF(it, t) {
    switch (it.kind) {
      case 'exp': return Math.exp(-it.a * t);
      case 'texp': return Math.pow(t, it.n) * Math.exp(-it.a * t);
      case 'sin': return Math.sin(it.w * t);
      case 'cos': return Math.cos(it.w * t);
      case 'tpow': return Math.pow(t, it.n);
      case 'const': return 1;
    }
    return 0;
  }
  function itemFsVal(it, s) {
    switch (it.kind) {
      case 'exp': return 1 / (s + it.a);
      case 'texp': return fact(it.n) / Math.pow(s + it.a, it.n + 1);
      case 'sin': return it.w / (s * s + it.w * it.w);
      case 'cos': return s / (s * s + it.w * it.w);
      case 'tpow': return fact(it.n) / Math.pow(s, it.n + 1);
      case 'const': return 1 / s;
    }
    return 0;
  }
  function comboF(items, t) { return t < 0 ? 0 : items.reduce((acc, it) => acc + it.sign * it.coef * itemF(it, t), 0); }
  function comboFs(items, s) { return items.reduce((acc, it) => acc + it.sign * it.coef * itemFsVal(it, s), 0); }

  // 生成推导步骤
  function comboDerivation(items) {
    const fTex = items.map((it) => {
      const sg = it.sign < 0 ? '-' : '+';
      const c = it.coef === 1 ? '' : num2tex(it.coef);
      let core = '';
      if (it.kind === 'exp') core = `e^{-${num2tex(it.a)}t}u(t)`;
      else if (it.kind === 'texp') core = `t^{${it.n}}e^{-${num2tex(it.a)}t}u(t)`;
      else if (it.kind === 'sin') core = `\\sin(${num2tex(it.w)}t)u(t)`;
      else if (it.kind === 'cos') core = `\\cos(${num2tex(it.w)}t)u(t)`;
      else if (it.kind === 'tpow') core = `t^{${it.n}}u(t)`;
      else core = 'u(t)';
      return { sg, body: (c ? c + '\\,' : '') + core };
    });
    const fLine = 'f(t)=' + fTex[0].body + fTex.slice(1).map((x) => x.sg + x.body).join('');
    const steps = [{ t: '输入信号', desc: '识别为因果信号（含 u(t)）的线性组合，可逐项变换后用线性性质合并。', body: fLine }];

    const kinds = new Set(items.map((x) => x.kind));
    // 各类型规则推导
    const explain = (it) => {
      const A = it.a != null ? num2tex(it.a) : '', W = it.w != null ? num2tex(it.w) : '', N = it.n != null ? it.n : '';
      switch (it.kind) {
        case 'exp': return [
          { tm: `e^{-${A}t}u(t)`, t: '：定义积分', desc: `单边拉普拉斯定义直接积分，收敛条件 Re(s)>-${A}。`, body: `\\int_0^{\\infty}e^{-${A}t}e^{-st}dt=\\left[-\\frac{e^{-(s+${A})t}}{s+${A}}\\right]_0^{\\infty}=\\frac{1}{s+${A}}` },
          { t: '傅里叶（衰减信号，ROC 含 jω 轴）', desc: '令 s=jω 直接代入。', body: `F(j\\omega)=\\frac{1}{${A}+j\\omega}` }
        ];
        case 'texp': return [
          { tm: `t^{${N}}e^{-${A}t}u(t)`, t: '：s 域微分性质', desc: `由 L{t^n f(t)}=(-1)^n d^nF/ds^n，对 1/(s+a) 求 ${N} 阶导。`, body: `(-1)^{${N}}\\frac{d^{${N}}}{ds^{${N}}}\\frac{1}{s+${A}}=\\frac{${fact(N)}}{(s+${A})^{${N + 1}}}` },
          { t: '傅里叶', desc: '令 s=jω。', body: `F(j\\omega)=\\frac{${fact(N)}}{(${A}+j\\omega)^{${N + 1}}}` }
        ];
        case 'sin': return [
          { tm: `\\sin(${W}t)u(t)`, t: '：欧拉展开', desc: '正弦拆成一对共轭指数。', body: `\\sin(${W}t)=\\frac{e^{j${W}t}-e^{-j${W}t}}{2j}` },
          { t: 's 域平移性质', desc: 'L{e^{at}f(t)}=F(s-a)，对 L{u(t)}=1/s 平移。', body: `\\mathcal{L}\\{e^{\\pm j${W}t}u(t)\\}=\\frac{1}{s\\mp j${W}}` },
          { t: '合并', desc: '通分相减。', body: `\\frac{1}{2j}\\left[\\frac{1}{s-j${W}}-\\frac{1}{s+j${W}}\\right]=\\frac{${W}}{s^{2}+${num2tex(it.w * it.w)}}` },
          { t: '傅里叶（含冲激谱线）', desc: '正弦无衰减，频谱在 ±ω₀ 处有冲激谱线。', body: `F(j\\omega)=\\frac{\\pi}{2j}\\left[\\delta(\\omega-${W})-\\delta(\\omega+${W})\\right]` }
        ];
        case 'cos': return [
          { tm: `\\cos(${W}t)u(t)`, t: '：欧拉展开', desc: '余弦拆成一对共轭指数。', body: `\\cos(${W}t)=\\frac{e^{j${W}t}+e^{-j${W}t}}{2}` },
          { t: 's 域平移 + 合并', desc: '同正弦路径。', body: `\\frac{1}{2}\\left[\\frac{1}{s-j${W}}+\\frac{1}{s+j${W}}\\right]=\\frac{s}{s^{2}+${num2tex(it.w * it.w)}}` },
          { t: '傅里叶（含冲激谱线）', desc: '余弦的频谱为 ±ω₀ 处两条冲激谱线。', body: `F(j\\omega)=\\frac{\\pi}{2}\\left[\\delta(\\omega-${W})+\\delta(\\omega+${W})\\right]` }
        ];
        case 'tpow': return [
          { tm: `t^{${N}}u(t)`, t: '：分部积分归纳', desc: 'L{t·u(t)}=1/s²；反复用频域微分性质 L{tⁿf}=(-1)ⁿF⁽ⁿ⁾(s)。', body: `\\mathcal{L}\\{t^{${N}}u(t)\\}=\\frac{${fact(N)}}{s^{${N + 1}}}` },
          { t: '傅里叶（分布意义）', desc: '幂信号频谱含 ω=0 处的 δ 导数项与主值项。', body: `F(j\\omega)=\\frac{${fact(N)}}{(j\\omega)^{${N + 1}}}+\\pi j^{${N}}\\delta^{(${N})}(\\omega)` }
        ];
        case 'const': {
          // 符号提到分式外，避免出现 \dfrac{-1}{j\omega} 这种写法
          const cc = it.coef * it.sign;
          const ca = Math.abs(cc) === 1 ? '' : num2tex(Math.abs(cc));
          const sg = cc < 0 ? '-' : '';
          return [
            { t: '常数（即 c·u(t)）', desc: `L{u(t)}=1/s；本项幅度 c=${num2tex(cc)}。`, body: `\\mathcal{L}\\{u(t)\\}=\\frac{1}{s}` },
            { t: '傅里叶', desc: '直流分量的频谱在 ω=0 处有冲激，同时保留 1/(jω) 主值项（分布意义）。', body: `F(j\\omega)=${sg}${ca}\\pi\\delta(\\omega)${sg || '+'}\\dfrac{${ca || '1'}}{j\\omega}` }
          ];
        }
      }
      return [];
    };
    const seen = new Set();
    items.forEach((it) => {
      const key = it.kind + ':' + (it.a != null ? it.a : '') + ':' + (it.w != null ? it.w : '') + ':' + (it.n != null ? it.n : '');
      if (seen.has(key)) return;
      seen.add(key);
      steps.push(...explain(it));
    });
    // 线性合并
    const sumLine = 'F(s)=' + items.map((it) => (it.sign < 0 ? '-' : '+') + itemFsTex(it)).join('').replace(/^\+/, '');
    steps.push({ t: '线性性质合并', desc: 'L{a·f+b·g}=aF+bG，把各项目的结果相加。', body: sumLine });
    // ROC
    const decayA = items.filter((x) => x.kind === 'exp' || x.kind === 'texp').map((x) => x.a);
    const minA = decayA.length ? Math.min(...decayA) : null;
    const hasNondecay = items.some((x) => x.kind === 'sin' || x.kind === 'cos' || x.kind === 'tpow' || x.kind === 'const');
    const rocTex = minA != null && !hasNondecay ? `\\operatorname{Re}(s)>-${num2tex(minA)}` : '\\operatorname{Re}(s)>0';
    steps.push({ t: '收敛域 ROC', desc: 'ROC 由最右极点决定；傅里叶变换存在当且仅当 ROC 包含 jω 轴（衰减正弦等无衰减项以冲激谱线形式存在）。', body: rocTex });
    return { steps, minA, hasNondecay };
  }

  function renderCustom() {
    const content = host.querySelector('#dv-content');
    content.innerHTML = `
      <div class="pane" style="margin-bottom:14px;background:var(--panel-2)">
        <h3>输入函数 → 逐步变换推导</h3>
        <p class="hint" style="margin-top:-6px">输入一个因果信号 f(t)，这里会像教科书一样<b>逐项写出拉普拉斯变换的推导步骤</b>（定义积分 / 欧拉展开 / s 域性质），给出 ROC 与傅里叶变换，最后用数值积分验证每一步得到的 F(s)。</p>
        <div id="dv-mi" style="margin-top:10px"></div>
        <div class="hint">支持的项：<code>c*exp(-a*t)*u(t)</code>、<code>c*sin(w*t)*u(t)</code>、<code>c*cos(w*t)*u(t)</code>、<code>c*t^n*u(t)</code>、<code>c*t^n*exp(-a*t)*u(t)</code>、<code>u(t)</code>、常数 c。写法宽松：<code>2sin(3t)</code>、<code>e^(-2t)</code>、<code>t²e^{-t}</code>、<code>sin(2πt)</code> 都可以；用 + - 连接多项。</div>
      </div>
      <div id="dv-cout"><p class="hint">输入表达式后点击“推导”。</p></div>`;
    const examples = [
      ['3*exp(-2*t)*u(t)', '指数衰减'],
      ['2*exp(-1*t)*u(t)+sin(5*t)*u(t)', '指数+正弦'],
      ['t^2*exp(-3*t)*u(t)', '幂×指数'],
      ['5-2*cos(2*t)*u(t)', '常数+余弦'],
      ['exp(-0.5*t)*u(t)-exp(-1*t)*u(t)', '两个指数']
    ];
    /* ---------- 输入（统一输入组件 MI：徽标/示例/历史） ---------- */
    const kindName = { exp: '指数', texp: '幂×指数', sin: '正弦', cos: '余弦', tpow: '幂', const: '常数' };
    const dv = MI.exprInput(content.querySelector('#dv-mi'), {
      id: 'dv-cin',
      placeholder: '3*exp(-2*t)*u(t) + sin(5*t)*u(t) - t^2*exp(-1*t)*u(t)',
      parse: (str) => {
        const items = parseCombo(str);
        if (!items) return { verdict: 'err', message: '暂无法解析：每项需为 c*exp(-a*t)*u(t)、c*sin(w*t)*u(t)、c*cos(w*t)*u(t)、c*t^n*u(t)、c*t^n*exp(-a*t)*u(t) 或常数，用 + - 连接。' };
        const summary = items.map((it) => (it.sign < 0 ? '−' : '') + (it.coef === 1 ? '' : num2tex(it.coef)) + (kindName[it.kind] || it.kind)).join('、');
        return { verdict: 'ok', message: `已识别 ${items.length} 项：${summary}` };
      },
      examples,
      historyKey: 'flt-derive-custom',
      debounce: 250,
      autoApply: false,
      onApply: () => runCustom()
    });
    const goBtn = U.el('button', { class: 'btn primary', id: 'dv-cgo' }, '推导');
    goBtn.addEventListener('click', () => dv.apply());
    dv.bar.append(goBtn);
    const runCustom = () => {
      const out = content.querySelector('#dv-cout');
      const items = parseCombo(dv.get());
      if (!items) { out.innerHTML = '<p style="color:var(--danger)">无法解析。请按提示格式输入，例如 3*exp(-2*t)*u(t) + sin(5*t)*u(t)。</p>'; return; }
      const { steps, minA, hasNondecay } = comboDerivation(items);
      out.innerHTML = '';
      // 步骤折叠
      const wrap = U.el('div', { class: 'steps' });
      steps.forEach((st, i) => {
        const step = U.el('div', { class: 'step' + (i === 0 || i === steps.length - 1 ? ' open' : '') });
        const head = stepHeadEl(st, i);
        head.addEventListener('click', () => step.classList.toggle('open'));
        const body = U.el('div', { class: 'step-body' });
        if (st.desc) body.append(U.el('p', { class: 'desc' }, st.desc));
        if (st.body) { const bx = U.el('div', { class: 'formula-center' }); FX.katex(st.body, bx, { displayMode: true }); body.append(bx); }
        step.append(head, body);
        wrap.append(step);
      });
      out.append(wrap);
      // 数值验证（符号 F(s) vs 数值积分）
      const vStart = minA != null ? Math.max(0.5, -minA + 0.5) : 0.5;
      const sList = [vStart, vStart + 1, vStart + 2];
      const T = 60, NN = 24000, h = T / NN;
      const rows = sList.map((sv) => {
        // 复化辛普森；两端点都要乘衰减因子 e^{-s·t}
        let sum = comboF(items, 0) + comboF(items, T) * Math.exp(-sv * T);
        for (let i = 1; i < NN; i++) sum += (i % 2 ? 4 : 2) * comboF(items, i * h) * Math.exp(-sv * i * h);
        const numeric = (sum * h) / 3;
        const sym = comboFs(items, sv);
        const err = Math.abs(numeric - sym) / (Math.abs(sym) || 1);
        return { sv, numeric, sym, err };
      });
      const tbl = U.el('table', { class: 'tbl', style: 'margin-top:14px' });
      tbl.innerHTML = `<tr><th>验证点 s</th><th>数值 ∫₀^∞ f(t)e⁻ˢᵗdt</th><th>符号 F(s)</th><th>相对误差</th></tr>` +
        rows.map((r) => `<tr><td>${r.sv}</td><td>${U.fmt(r.numeric, 6)}</td><td>${U.fmt(r.sym, 6)}</td><td style="color:${r.err < 1e-4 ? 'var(--accent-2)' : 'var(--warn)'}">${r.err < 1e-12 ? '<1e-12' : U.fmt(r.err, 3)}</td></tr>`).join('');
      out.append(U.el('p', { class: 'hint', html: '数值验证：把每一步得到的符号 F(s) 与直接数值积分对比，误差应接近机器精度——推导无误的硬证据。' }), tbl);
      if (hasNondecay) out.append(U.el('p', { class: 'hint', html: '注：含 sin/cos/tⁿ/常数项时 ROC 为 Re(s)>0，数值验证取 s>0 仍然收敛；其傅里叶变换含冲激谱线，见对应步骤。' }));
    };
    // 初始值 + 首次推导
    dv.set('2*exp(-1*t)*u(t)+sin(5*t)*u(t)');
    runCustom();
  }

  /* ---------- 渲染 ---------- */
  host.innerHTML = `
    <div class="module layout">
      <div class="pane">
        <h3>选择推导 / 性质表</h3>
        <div class="row" id="dv-nav" style="flex-direction:column;align-items:stretch"></div>
        <div class="row" style="gap:6px;margin-top:12px;align-items:center">
          <span class="hint" style="margin:0;flex:1">公式大小</span>
          <button class="chip" id="dv-zout" title="缩小公式">A−</button>
          <button class="chip" id="dv-zin" title="放大公式">A+</button>
          <button class="chip" id="dv-zreset" title="恢复默认">100%</button>
        </div>
      </div>
      <div class="pane" id="dv-main">
        <div id="dv-content"></div>
      </div>
    </div>`;

  const nav = host.querySelector('#dv-nav');
  const content = host.querySelector('#dv-content');

  function renderItem(key) {
    content.innerHTML = '';
    if (key === 'custom') { renderCustom(); return; }
    if (tables[key]) { renderTable(key); return; }
    if (derivations[key]) renderDerivation(key);
  }
  function navButton(label, key, cls) {
    const b = U.el('button', { class: 'chip' + (cls ? ' active' : ''), 'data-k': key, style: 'text-align:left' }, label);
    b.addEventListener('click', () => { nav.querySelectorAll('.chip').forEach((x) => x.classList.remove('active')); b.classList.add('active'); renderItem(key); });
    nav.append(b);
  }
  // 导航：自定义 + 表格组 + 推导组
  navButton('🧮 输入函数 → 变换推导', 'custom');
  const g1 = U.el('div', { style: 'color:var(--text-faint);font-size:12px;margin:8px 4px 4px' }, '性质与变换对'); nav.append(g1);
  navButton('性质表 · 傅立叶变换', 'ft');
  navButton('性质表 · 拉普拉斯', 'la');
  navButton('常用变换对对照表', 'lt');
  navButton('性质表 · Z 变换', 'zt');
  navButton('常用 Z 变换对（含 ROC）', 'ztp');
  const g2 = U.el('div', { style: 'color:var(--text-faint);font-size:12px;margin:8px 4px 4px' }, '逐步推导'); nav.append(g2);
  navButton('方波的傅立叶级数', 'square');
  navButton('L{e^{-at}u(t)} 定义积分', 'laplace');
  navButton('矩形 ↔ sinc 变换', 'rect');
  navButton('Z{a^n u[n]} 定义求和', 'zsum');
  navButton('小例子：卷积求响应', 'conv1');

  function renderTable(key) {
    const t = tables[key];
    content.innerHTML = '';
    const h3 = document.createElement('h3'); h3.textContent = t.name; content.append(h3);
    const table = document.createElement('table');
    table.className = 'tbl';
    const thead = document.createElement('tr');
    const heads = key === 'lt' ? ['信号 f(t)', '拉普拉斯 F(s)']
      : key === 'ztp' ? ['序列 x[n]', 'Z 变换 X(z)', 'ROC']
      : key === 'zt' ? ['性质', '时域 / 序列域', 'z 域']
      : ['名称', '时域 / f(t)', '频域 / F(s)'];
    for (const h of heads) { const th = document.createElement('th'); th.textContent = h; thead.append(th); }
    table.append(thead);
    for (const r of t.rows) {
      const tr = document.createElement('tr');
      if (key === 'ztp') {
        tr.append(tdTex(r[0]), tdTex(r[1]), tdTex(r[2]));
      } else if (r.length === 3) {
        const td1 = document.createElement('td'); td1.textContent = r[0]; tr.append(td1);
        tr.append(tdTex(r[1]), tdTex(r[2]));
      } else {
        tr.append(tdTex(typeof r[0] === 'string' ? r[0] : r[0].t), tdTex(r[1]));
      }
      table.append(tr);
    }
    content.append(table);
    const p = document.createElement('p'); p.className = 'hint';
    p.textContent = key === 'lt' ? '行首为时域因果信号，右侧为对应的拉普拉斯变换。运行性质/乘积规则可相互推导。' : '行内条目的双向对应关系 X(f) / F(s)。';
    content.append(p);
    function tdTex(tex) { const td = document.createElement('td'); const s = document.createElement('span'); FX.katex(tex, s); td.append(s); return td; }
  }

  function renderDerivation(key) {
    const d = derivations[key];
    const h3 = document.createElement('h3'); h3.textContent = d.name; content.append(h3);
    const p = document.createElement('p'); p.className = 'hint'; p.textContent = d.desc; content.append(p);
    const wrap = document.createElement('div'); wrap.className = 'steps'; content.append(wrap);
    d.steps.forEach((st, i) => {
      const step = U.el('div', { class: 'step' + (i === 0 ? ' open' : '') });
      const head = stepHeadEl(st, i);
      head.addEventListener('click', () => step.classList.toggle('open'));
      const body = U.el('div', { class: 'step-body' });
      if (st.desc) body.append((() => { const dd = U.el('p', { class: 'desc' }, st.desc); return dd; })());
      if (st.body) {
        body.append((() => { const bx = U.el('div', { class: 'formula-center' }); FX.katex(st.body, bx, { displayMode: true }); return bx; })());
      }
      step.append(head, body);
      wrap.append(step);
    });
  }

  renderItem('custom');

  // 公式大小：缩放主面板根字号（KaTeX 为 em 相对尺寸，随根字号等比缩放）
  const dvMain = host.querySelector('#dv-main');
  let zscale = 1;
  const zReset = host.querySelector('#dv-zreset');
  const applyZ = () => {
    dvMain.style.fontSize = zscale + 'em';
    zReset.textContent = Math.round(zscale * 100) + '%';
  };
  host.querySelector('#dv-zin').addEventListener('click', () => { zscale = Math.min(1.7, +(zscale + 0.1).toFixed(2)); applyZ(); });
  host.querySelector('#dv-zout').addEventListener('click', () => { zscale = Math.max(0.8, +(zscale - 0.1).toFixed(2)); applyZ(); });
  zReset.addEventListener('click', () => { zscale = 1; applyZ(); });

  return { title: '公式推导', api: { dispose } };
  function dispose() { }
});
