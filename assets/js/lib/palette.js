/* ============================================================
 * palette.js — 命令面板（window.CP，Ctrl+K 唤起）
 *   统一搜索：模块 / 实验 / 快速开始模板，键盘上下选择 + 回车执行。
 *   动作经回调注入（openModule/openExperiment/createExperiment），便于测试。
 * ============================================================ */
window.CP = (() => {
  const MODULE_NAMES = { sys: '系统分析', zt: 'Z 变换', la: '拉普拉斯', pid: 'PID', blk: '系统框图', ft: '傅立叶变换', fs: '傅立叶级数', explore: '交互求解', derive: '公式推导', home: '工作台' };
  let actions = { openModule: (k) => App.open(k), openExperiment: (id) => App.exps.openById(id), createExperiment: (t) => App.exps.createAndOpen({ name: t.name, module: t.module, state: t.state, tags: ['模板'] }) };
  const setActions = (a) => { actions = { ...actions, ...a }; };

  function collect() {
    const out = [];
    Object.keys(App.modules).forEach((k) => out.push({ kind: 'module', name: MODULE_NAMES[k] || k, hint: '模块', run: () => actions.openModule(k) }));
    try {
      PX.list().forEach((m) => out.push({ kind: 'exp', name: m.name, hint: '实验 · ' + (MODULE_NAMES[m.module] || m.module), run: () => actions.openExperiment(m.id) }));
    } catch (e) { }
    (window.WB && WB.templates ? WB.templates : []).forEach((t) => out.push({ kind: 'tpl', name: t.name, hint: '模板 · ' + (MODULE_NAMES[t.module] || t.module), run: () => actions.createExperiment(t) }));
    return out;
  }
  function match(query, it) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    return q.split(/\s+/).every((t) => (it.name + ' ' + it.hint).toLowerCase().includes(t));
  }

  let overlay = null, input = null, listEl = null, filtered = [], sel = 0;

  function renderList(q) {
    filtered = collect().filter((it) => match(q, it)).slice(0, 9);
    sel = Math.min(sel, Math.max(0, filtered.length - 1));
    listEl.innerHTML = '';
    if (!filtered.length) { listEl.appendChild(U.el('div', { class: 'cp-item hint' }, '没有匹配项')); return; }
    filtered.forEach((it, i) => {
      const row = U.el('button', { class: 'cp-item' + (i === sel ? ' active' : ''), 'data-i': i });
      row.append(U.el('span', { class: 'cp-name' }, it.name), U.el('span', { class: 'cp-hint' }, it.hint));
      row.addEventListener('click', () => run(i));
      listEl.appendChild(row);
    });
  }
  function run(i) {
    const it = filtered[i];
    close();
    if (it) it.run();
  }
  function close() { if (overlay && overlay.parentElement) overlay.remove(); overlay = null; }
  function toggle() { overlay ? close() : open(); }

  function open() {
    if (typeof document === 'undefined' || !document.body) return;
    overlay = U.el('div', { class: 'mask', style: 'position:fixed;z-index:998;align-items:flex-start;padding-top:12vh' });
    const box = U.el('div', { class: 'dialog cp-box', style: 'max-width:520px;padding:10px' });
    input = U.el('input', { type: 'text', placeholder: '搜索模块 / 实验 / 模板…', 'aria-label': '命令面板搜索' });
    input.style.cssText = 'width:100%;padding:9px 12px;border-radius:8px;border:1px solid var(--line-2);background:var(--panel-2);color:var(--text);font-size:14px';
    listEl = U.el('div', { class: 'cp-list', role: 'listbox' });
    box.append(input, listEl);
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    input.addEventListener('input', () => { sel = 0; renderList(input.value); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(filtered.length - 1, sel + 1); renderList(input.value); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); renderList(input.value); }
      else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
      else if (e.key === 'Escape') close();
    });
    document.body.appendChild(overlay);
    renderList('');
    try { input.focus(); } catch (e) { }
  }

  return { toggle, open, close, collect, match, setActions, MODULE_NAMES };
})();
