import io

p = 'assets/js/lib/transforms.js'
s = io.open(p, encoding='utf-8').read()

# 把复数验证改为实轴验证（FsNumeric 仅支持实 s）
old_start = s.index('  function propVerify(items, prop, param) {')
old_end = s.index('  return {\n    parseTimeCombo, laplaceOfItems, fourierOfItems, fNumeric, FsNumeric, propVerify,')
new_block = '''  function propVerify(items, prop, param) {
    if (!items || !items.length) return { ok: false, note: '\\u4fe1\\u53f7\\u4e3a\\u7a7a' };
    let right = 0;
    for (const it of items) right = Math.max(right, (it.kind === 'exp' || it.kind === 'texp') ? -it.a : 0);
    const sigma = right + 1.5;                      // Re(s) > ROC \\u53f3\\u7f18\\uff0c\\u5b9e\\u8f74\\u9a8c\\u8bc1\\u70b9
    const N = 6000, Tmax = 60 / sigma, dt = Tmax / N;
    const numLap = (f) => {                          // \\u5b9a\\u4e49\\u79ef\\u5206 \\u222bf(t)e^{-\\u03c3t}dt\\uff08\\u5b9e\\u68af\\u5f62\\uff09
      let acc = 0;
      for (let i = 0; i <= N; i++) {
        const t = i * dt;
        const m = (i === 0 || i === N) ? 1 : 2;
        acc += f(t) * Math.exp(-sigma * t) * m * dt / 2;
      }
      return acc;
    };
    const rel = (a, b) => Math.abs(a - b) / Math.max(1e-12, Math.abs(b));
    const checks = [];
    let title = '', rhsTex = '';
    const Fsv = FsNumeric(items, sigma);
    const Ftex = laplaceOfItems(items).fsLine.replace('F(s)=', '');
    const sTex = 's=' + sigma.toFixed(2);
    if (prop === 'shift') {
      const tau = Math.max(0, +param || 0);
      title = '\\u65f6\\u79fb\\uff1aL{f(t\\u2212' + num2tex(tau) + ')u(t\\u2212' + num2tex(tau) + ')} = e^{\\u2212' + num2tex(tau) + 's}F(s)';
      rhsTex = 'e^{\\u2212' + num2tex(tau) + 's}\\\\cdot[' + Ftex + ']';
      const lhs = numLap((t) => (t < tau ? 0 : fNumeric(items, t - tau)));
      const rhs = Math.exp(-sigma * tau) * Fsv;
      checks.push({ s: sTex, lhs, rhs, rel: rel(lhs, rhs) });
    } else if (prop === 'freq') {
      const a = +param || 0;
      title = '\\u9891\\u79fb\\uff1aL{e^{\\u2212' + num2tex(a) + 't}f(t)} = F(s+' + num2tex(a) + ')';
      rhsTex = '[' + Ftex + ']_{s\\\\to s+' + num2tex(a) + '}';
      const lhs = numLap((t) => Math.exp(-a * t) * fNumeric(items, t));
      const rhs = FsNumeric(items, sigma + a);
      checks.push({ s: sTex, lhs, rhs, rel: rel(lhs, rhs) });
    } else if (prop === 'scale') {
      const a = Math.max(0.1, +param || 2);
      title = '\\u5c3a\\u5ea6\\uff1aL{f(' + num2tex(a) + 't)} = (1/' + num2tex(a) + ')F(s/' + num2tex(a) + ')';
      rhsTex = '\\\\dfrac{1}{' + num2tex(a) + '}[' + Ftex + ']_{s\\\\to s/' + num2tex(a) + '}';
      const lhs = numLap((t) => fNumeric(items, a * t));
      const rhs = FsNumeric(items, sigma / a) / a;
      checks.push({ s: sTex, lhs, rhs, rel: rel(lhs, rhs) });
    } else if (prop === 'diff') {
      title = '\\u5fae\\u5206\\uff1aL{f\\u2032(t)} = sF(s) \\u2212 f(0+)';
      rhsTex = 's\\\\cdot[' + Ftex + '] - f(0^{+})';
      const h = 1e-4;
      const lhs = numLap((t) => (fNumeric(items, t + h) - fNumeric(items, t - h)) / (2 * h));
      const f0 = fNumeric(items, 1e-6);
      const rhs = sigma * Fsv - f0;
      checks.push({ s: sTex, lhs, rhs, rel: rel(lhs, rhs) });
    } else return { ok: false, note: '\\u672a\\u77e5\\u6027\\u8d28' };
    const maxRel = Math.max(...checks.map((c) => c.rel));
    return { ok: true, title, rhsTex, sPoint: sTex, checks, maxRel, passed: isFinite(maxRel) && maxRel < 1e-6 };
  }

'''
s = s[:old_start] + new_block + s[old_end:]
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('patched')
