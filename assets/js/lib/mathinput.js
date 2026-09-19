/* ============================================================
 * mathinput.js — 统一数学输入组件（window.MI）
 *   把各模块重复的「分数线传函输入 / 单行表达式输入 + 符号键盘 +
 *   校验徽标 + LaTeX 预览 + 示例/历史 chips」收敛为一个共享组件。
 *
 *   校验管线：MI 层纠错词典（定位到写法）→ FX_LIB/TR 解析（入口已做
 *   全角归一化，见 U.normChars）→ 三态徽标 ok/warn/err。
 * ============================================================ */
window.MI = (() => {
  /* ---------- 纠错词典：解析失败时给出「定位到写法」的提示 ---------- */
  function diagnose(str, variable) {
    const s = String(str || '').trim();
    if (!s) return null;
    if (/[+\-*/^(]$/.test(s)) return '末尾多了运算符';
    if (/\(\s*\)/.test(s) || /\[\s*\]/.test(s)) return '有空的括号';
    if (/i(?![a-zA-Z])/.test(s) && (variable === 's' || variable === 'z')) return '虚数单位请用 j（如 -0.25+1.09j）';
    let bal = 0;
    for (const c of s) { if (c === '(') bal++; else if (c === ')') bal--; }
    if (bal > 0) return `有 ${bal} 个「(」未闭合`;
    if (bal < 0) return `有 ${-bal} 个「)」多余`;
    return null;
  }

  /* ---------- 徽标 ---------- */
  // verdict: 'ok' | 'warn' | 'err'；message 为空时清空徽标
  function setBadge(box, verdict, message, tex) {
    box.innerHTML = '';
    box.classList.remove('invalid');
    if (!message && !tex) return;
    const color = verdict === 'ok' ? 'var(--accent-2)' : verdict === 'warn' ? 'var(--warn)' : 'var(--danger)';
    const mark = verdict === 'ok' ? '✓ ' : verdict === 'warn' ? '⚠ ' : '✗ ';
    const st = document.createElement('span');
    st.style.color = color;
    st.textContent = mark + (message || '');
    box.appendChild(st);
    if (tex) box.appendChild(FX.span(tex));
  }

  /* ---------- 历史（localStorage，最近 8 条，点击回填） ---------- */
  function histLoad(key) {
    try { const a = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function histSave(key, arr) { try { localStorage.setItem(key, JSON.stringify(arr.slice(0, 8))); } catch (e) { } }
  function renderHist(row, key, current, onPick) {
    row.innerHTML = '';
    const arr = histLoad(key).filter((x) => x !== current);
    if (!arr.length) return;
    row.appendChild(U.el('span', { class: 'hint', style: 'margin:0' }, '历史：'));
    arr.slice(0, 6).forEach((rec) => {
      const short = rec.length > 22 ? rec.slice(0, 22) + '…' : rec;
      const c = U.el('button', { class: 'chip', title: rec }, short);
      c.addEventListener('click', () => onPick(rec));
      row.appendChild(c);
    });
    const clr = U.el('button', { class: 'chip', title: '清空历史' }, '🗑');
    clr.addEventListener('click', () => { histSave(key, []); renderHist(row, key, current, onPick); });
    row.appendChild(clr);
  }
  const histRecord = (key, rec) => {
    if (!key || !rec) return;
    histSave(key, [rec, ...histLoad(key).filter((x) => x !== rec)]);
  };

  /* ---------- 符号键盘行（光标处插入 token，可独立使用） ---------- */
  function padRow(hostEl, tokens, getTarget) {
    const row = U.el('div', { class: 'row kbd' });
    tokens.forEach((tok) => {
      const b = U.el('button', { class: 'chip pad-key', title: '插入 ' + tok }, tok === '^2' ? 'x²' : tok === '^3' ? 'x³' : tok);
      b.addEventListener('click', () => {
        const inp = getTarget();
        if (!inp) return;
        const s = inp.selectionStart == null ? inp.value.length : inp.selectionStart;
        const e = inp.selectionEnd == null ? s : inp.selectionEnd;
        inp.value = inp.value.slice(0, s) + tok + inp.value.slice(e);
        inp.focus();
        try { inp.setSelectionRange(s + tok.length, s + tok.length); } catch (err) { }
        inp.dispatchEvent(new Event('input'));
      });
      row.appendChild(b);
    });
    hostEl.appendChild(row);
    return row;
  }

  /* ---------- 示例 chips 行 ---------- */
  function renderExamples(row, examples, onPick) {
    row.innerHTML = '';
    (examples || []).forEach((args) => {
      const label = args[args.length - 1];
      const c = U.el('button', { class: 'chip', title: args.slice(0, -1).join(' / ') }, label);
      c.addEventListener('click', () => onPick(args));
      row.appendChild(c);
    });
  }

  /* ============================================================
   * tfInput：分数线传函输入（分子/分母 + 键盘 + 徽标 + 预览 + 示例/历史）
   * ============================================================ */
  function tfInput(hostEl, opts = {}) {
    const variable = opts.variable === 'z' ? 'z' : 's';
    const vName = variable === 'z' ? 'H(z)' : 'H(s)';
    let timer = null;
    let destroyed = false;

    const frac = U.el('div', { class: 'tf-frac' });
    const numI = U.el('input', { type: 'text', spellcheck: 'false', 'aria-label': '分子' });
    const bar = U.el('div', { class: 'tf-bar', title: '分数线' });
    const denI = U.el('input', { type: 'text', spellcheck: 'false', 'aria-label': '分母' });
    if (opts.ids && opts.ids.num) numI.setAttribute('id', opts.ids.num);
    if (opts.ids && opts.ids.den) denI.setAttribute('id', opts.ids.den);
    if (opts.placeholder) {
      numI.setAttribute('placeholder', opts.placeholder.num || '');
      denI.setAttribute('placeholder', opts.placeholder.den || '');
    }
    frac.append(numI, bar, denI);

    const badge = U.el('div', { class: 'hint', style: 'margin:8px 0' });
    const wrap = U.el('div', {}, [frac, badge]);
    hostEl.appendChild(wrap);
    let padEl = null, exRow = null, histRow = null;
    if (opts.pad && opts.pad.length) { padEl = U.el('div', { class: 'row kbd', style: 'margin-top:8px' }); wrap.appendChild(padEl); }
    if ((opts.examples || []).length) { exRow = U.el('div', { class: 'row', style: 'margin:8px 0' }); wrap.appendChild(exRow); }
    if (opts.historyKey) { histRow = U.el('div', { class: 'row', style: 'margin:8px 0' }); wrap.appendChild(histRow); }

    /* 校验：返回 {verdict, result}；result 仅在可应用时非空 */
    function validate() {
      if (destroyed) return null;
      const nStr = numI.value.trim(), dStr = denI.value.trim();
      if (!nStr && !dStr) { setBadge(badge, 'ok', '', ''); return null; }
      const t = FX_LIB.parseTFFields(nStr || '1', dStr || '1', variable);
      if (!t || !t.den || !t.den[0]) {
        const hint = diagnose(nStr && !dStr ? nStr : (dStr || nStr), variable);
        setBadge(badge, 'err', '解析失败：' + (opts.parseFailHint || '') + (hint ? '（' + hint + '）' : ''));
        frac.classList.add('invalid');
        return { verdict: 'err', result: null };
      }
      if (opts.properness !== false && t.num.length > t.den.length) {
        setBadge(badge, 'warn', '非真分式（分子阶次 > 分母阶次），无法应用');
        return { verdict: 'warn', result: null };
      }
      frac.classList.remove('invalid');
      const tex = vName + '=\\dfrac{' + U.polyTex(t.num, variable) + '}{' + U.polyTex(t.den, variable) + '}';
      setBadge(badge, 'ok', '', tex);
      return { verdict: 'ok', result: { numStr: nStr || '1', denStr: dStr || '1', tf: t } };
    }

    function doApply(source) {
      const v = validate();
      if (!v || v.verdict !== 'ok' || !v.result) return null;
      histRecord(opts.historyKey, v.result.numStr + '|' + v.result.denStr);
      if (histRow) renderHist(histRow, opts.historyKey, v.result.numStr + '|' + v.result.denStr, pickHist);
      if (opts.onApply) opts.onApply(v.result, source || 'button');
      return v.result;
    }
    const pickHist = (rec) => {
      const [n, d] = rec.split('|');
      numI.value = n || '1'; denI.value = d || '';
      doApply('history');
    };
    const pickExample = (args) => {
      numI.value = args[0] || '1'; denI.value = args[1] || '1';
      doApply('example');
    };

    const debounce = opts.debounce == null ? 350 : opts.debounce;
    const onInput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const v = validate();
        // autoApply=false（如 sys）：输入只刷新徽标，应用仍走按钮/Enter
        if (v && v.verdict === 'ok' && opts.autoApply !== false && opts.onApply) opts.onApply(v.result, 'input');
      }, debounce);
    };
    numI.addEventListener('input', onInput);
    denI.addEventListener('input', onInput);
    const onEnter = (e) => { if (e.key === 'Enter') doApply('enter'); };
    numI.addEventListener('keydown', onEnter);
    denI.addEventListener('keydown', onEnter);

    if (padEl) padRow(padEl, opts.pad, () => document.activeElement === numI ? numI : denI);
    if (exRow) renderExamples(exRow, opts.examples, pickExample);
    if (histRow) renderHist(histRow, opts.historyKey, '', pickHist);

    return {
      bar: frac,
      set(n, d) { numI.value = n == null ? '' : String(n); denI.value = d == null ? '' : String(d); validate(); },
      get() { return { numStr: numI.value.trim(), denStr: denI.value.trim() }; },
      apply(source) { return doApply(source || 'button'); },
      destroy() { destroyed = true; clearTimeout(timer); if (wrap.parentElement) wrap.remove(); }
    };
  }

  /* ============================================================
   * exprInput：单行表达式输入（徽标语义由模块 parse 回调给出）
   * ============================================================ */
  function exprInput(hostEl, opts = {}) {
    let timer = null;
    let destroyed = false;
    const bar = U.el('div', { class: 'input-bar' });
    const inp = U.el('input', { type: 'text', spellcheck: 'false', autocomplete: 'off' });
    if (opts.id) inp.setAttribute('id', opts.id);
    if (opts.placeholder) inp.setAttribute('placeholder', opts.placeholder);
    bar.appendChild(inp);
    const badge = U.el('div', { class: 'hint', style: 'margin:8px 0' });
    const wrap = U.el('div', {}, [bar, badge]);
    hostEl.appendChild(wrap);
    let exRow = null, histRow = null;
    if ((opts.examples || []).length) { exRow = U.el('div', { class: 'row', style: 'margin:8px 0' }); wrap.appendChild(exRow); }
    if (opts.historyKey) { histRow = U.el('div', { class: 'row', style: 'margin:8px 0' }); wrap.appendChild(histRow); }

    function validate() {
      if (destroyed) return null;
      const str = inp.value.trim();
      if (!str) { setBadge(badge, 'ok', '', ''); return { verdict: 'ok', result: { str: '' } }; }
      let v;
      try { v = opts.parse ? opts.parse(str) : { verdict: 'ok' }; }
      catch (e) { v = { verdict: 'err', message: '解析出错：' + e.message }; }
      v = v || { verdict: 'err', message: '无法解析' };
      setBadge(badge, v.verdict, v.message || '', v.tex);
      return { verdict: v.verdict, result: { str } };
    }
    function doApply(source) {
      const v = validate();
      if (!v || v.verdict === 'err' || !v.result.str) return null;
      histRecord(opts.historyKey, v.result.str);
      if (histRow) renderHist(histRow, opts.historyKey, v.result.str, pickHist);
      if (opts.onApply) opts.onApply(v.result.str, source || 'button');
      return v.result;
    }
    const pickHist = (rec) => { inp.value = rec; doApply('history'); };
    const pickExample = (args) => { inp.value = args[0]; doApply('example'); };

    const debounce = opts.debounce == null ? 250 : opts.debounce;
    inp.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const v = validate();
        if (v && v.verdict === 'ok' && opts.autoApply !== false && v.result.str && opts.onApply) opts.onApply(v.result.str, 'input');
      }, debounce);
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') doApply('enter'); });

    if (opts.pad && opts.pad.length) padRow(wrap, opts.pad, () => inp);
    if (exRow) renderExamples(exRow, opts.examples, pickExample);
    if (histRow) renderHist(histRow, opts.historyKey, '', pickHist);

    return {
      bar,
      input: inp,
      set(s) { inp.value = s == null ? '' : String(s); validate(); },
      get() { return inp.value.trim(); },
      apply(source) { return doApply(source || 'button'); },
      validate,
      destroy() { destroyed = true; clearTimeout(timer); if (wrap.parentElement) wrap.remove(); }
    };
  }

  /* ---------- 命名浮层（保存模型用，内联而非 prompt） ---------- */
  function nameAsk(defaultName, onOk) {
    const el = document.createElement('div');
    el.className = 'cp-menu';
    el.style.minWidth = '220px';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = defaultName || '';
    inp.spellcheck = false;
    inp.style.cssText = 'width:100%;margin:2px 0 6px;padding:8px 10px;border-radius:7px;border:1px solid var(--line-2);background:var(--panel-2);color:var(--text);font-family:var(--mono);font-size:13px';
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '4px';
    const okB = document.createElement('button');
    okB.className = 'cp-menu-item';
    okB.textContent = '💾 保存';
    const noB = document.createElement('button');
    noB.className = 'cp-menu-item danger';
    noB.textContent = '取消';
    row.append(okB, noB);
    el.append(inp, row);
    document.body.appendChild(el);
    el.style.left = Math.max(8, (window.innerWidth - (el.offsetWidth || 240)) / 2) + 'px';
    el.style.top = '90px';
    const close = () => el.remove();
    const done = () => {
      const v = inp.value.trim();
      close();
      if (v && onOk) onOk(v);
    };
    okB.addEventListener('click', done);
    noB.addEventListener('click', close);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done();
      else if (e.key === 'Escape') close();
    });
    inp.focus();
    inp.select();
  }

  /* ---------- 模型库工具条（💾 保存 + 「我的模型」chips 行） ----------
     onSave() → { kind, data }（null = 当前无可保存内容）
     onLoad(entry) → 模块按自身数据模型恢复 */
  function library(hostEl, opts) {
    const wrap = U.el('div', {});
    const btnRow = U.el('div', { class: 'row', style: 'margin:6px 0;align-items:center' });
    const saveBtn = U.el('button', { class: 'btn', title: '保存当前系统到模型库' }, '💾 保存');
    saveBtn.addEventListener('click', () => {
      const d = opts.onSave ? opts.onSave() : null;
      if (!d) return;
      const n = App.models.list().length;
      nameAsk(opts.defaultName || ('模型 ' + (n + 1)), (name) => {
        App.models.save({ name, kind: d.kind, data: d.data });
        if (opts.onSaved) opts.onSaved();
        render();
      });
    });
    btnRow.append(saveBtn);
    const chipsRow = U.el('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px;margin:6px 0' });
    wrap.append(btnRow, chipsRow);
    hostEl.appendChild(wrap);
    const render = App.models.renderChips(chipsRow, { kinds: opts.kinds, onLoad: opts.onLoad, emptyText: '暂无保存的模型' });
    return { refresh: render };
  }

  return { tfInput, exprInput, padRow, diagnose, setBadge, nameAsk, library };
})();
