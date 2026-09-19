import io

p = 'assets/js/lib/transforms.js'
s = io.open(p, encoding='utf-8').read()

anchor = "    parseTimeCombo, laplaceOfItems, fourierOfItems, fNumeric, FsNumeric, propVerify,"
assert anchor in s

block = '''  /* ---------- 多 ROC 分析：按极点实部划分收敛域，逐域判定因果性/稳定性 ----------
   * 复极点不新增边界（只看实部）；jω 轴极点使任何 ROC 都不含虚轴（无稳定域）。 */
  function rocs(num, den) {
    const poles = polyRoots(den);
    if (!poles.length || poles.some((q) => !isFinite(q.re) || !isFinite(q.im))) return { ok: false, note: '\\u6781\\u70b9\\u6c42\\u89e3\\u5931\\u8d25' };
    const reals = [...new Set(poles.map((p) => +p.re.toFixed(9)))].sort((a, b) => a - b);
    const axisPole = reals.some((r) => Math.abs(r) < 1e-9);
    const regions = [];
    for (let i = 0; i <= reals.length; i++) {
      const lo = i === 0 ? -Infinity : reals[i - 1];
      const hi = i === reals.length ? Infinity : reals[i];
      const containsJw = lo < 0 && hi > 0;          // \\u865a\\u8f74 Re=0 \\u5728\\u5f00\\u533a\\u95f4\\u5185
      const causal = i === reals.length;             // \\u6700\\u53f3\\u533a\\u57df\\u2192 \\u53f3\\u4fa7\\uff08\\u56e0\\u679c\\uff09\\u4fe1\\u53f7
      const anti = i === 0;                          // \\u6700\\u5de6\\u533a\\u57df\\u2192 \\u5de6\\u4fa7\\uff08\\u53cd\\u56e0\\u679c\\uff09
      regions.push({
        lo, hi, containsJw, causal, anti, twoSided: !causal && !anti,
        stable: containsJw,
        rocTex: (lo === -Infinity ? 'Re(s) < ' : 'Re(s) > ') + (hi === Infinity ? (lo === -Infinity ? 0 : num2tex(lo)) : num2tex(hi))
      });
      // rocTex \\u5bf9\\u4e2d\\u95f4\\u533a\\u57df\\u9700\\u8981\\u53cc\\u8fb9\\u8868\\u8ff0
      const r = regions[regions.length - 1];
      if (lo !== -Infinity && hi !== Infinity) r.rocTex = num2tex(lo) + ' < Re(s) < ' + num2tex(hi);
      else if (lo === -Infinity && hi !== Infinity) r.rocTex = 'Re(s) < ' + num2tex(hi);
      else if (lo !== -Infinity && hi === Infinity) r.rocTex = 'Re(s) > ' + num2tex(lo);
    }
    const stableRegion = regions.find((r) => r.stable) || null;
    const causalRegion = regions.find((r) => r.causal) || null;
    return { ok: true, poles, regions, stableRegion, causalRegion, axisPole };
  }

''' + anchor
s = s.replace(anchor, block, 1)
s = s.replace('fNumeric, FsNumeric, propVerify,', 'fNumeric, FsNumeric, propVerify, rocs,', 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('rocs added')
