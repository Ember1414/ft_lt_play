/* ============================================================
 * workbench.js — 工作台（平台入口，module key: 'home'）
 *   新用户闭环：模板/空白 → 建实验 → 打开模块（状态自动回放）
 *   → 分析 → 工具栏保存/分享/导出 → 回到工作台查看/恢复/管理。
 *   纯数据部分（templates / match / fmtTime）挂在 window.WB 供测试。
 * ============================================================ */
window.WB = (() => {
  /* ---------- 快速开始模板（state 必须通过 PX 校验；applyState 由各模块实现） ---------- */
  const templates = [
    { id: 'sys-2nd', name: '二阶欠阻尼系统', desc: '观察 ζ=0.25 的振荡阶跃响应与谐振峰', module: 'sys', state: { num: '1', den: 's^2+0.5*s+1' } },
    { id: 'sys-unstable', name: '不稳定系统观察', desc: '右半平面极点 → 响应发散，看奈奎斯特包围', module: 'sys', state: { num: '1', den: 's^2-0.3*s+1' } },
    { id: 'sys-lead', name: '超前校正基础', desc: '零点 -2 / 极点 -0.5，对比相位裕度变化', module: 'sys', state: { num: 's+2', den: 's+0.5' } },
    { id: 'zt-lp1', name: '离散一阶低通', desc: 'H(z)=1/(z-0.5)：极点 0.5，低通特性', module: 'zt', state: { num: '1', den: 'z-0.5' } },
    { id: 'zt-reso', name: '数字谐振器', desc: '极点靠近单位圆 → 窄带谐振峰', module: 'zt', state: { num: 'z', den: 'z^2-1.6*z+0.9425' } },
    { id: 'zt-2pole', name: '双极点滤波器', desc: '极点 ±0.5 的频率选择性与冲激响应', module: 'zt', state: { num: '1', den: 'z^2-0.25' } }
  ];

  const MODULE_NAMES = { sys: '系统分析', zt: 'Z 变换', la: '拉普拉斯', pid: 'PID', blk: '系统框图', ft: '傅立叶变换', fs: '傅立叶级数', explore: '交互求解', derive: '公式推导', home: '工作台' };

  /* ---------- 搜索过滤（name/tags/module 子串，大小写不敏感） ---------- */
  function match(query, item) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    const hay = [item.name, ...(item.tags || []), MODULE_NAMES[item.module] || item.module].join(' ').toLowerCase();
    return q.split(/\s+/).every((t) => hay.includes(t));
  }

  /* ---------- 时间显示 ---------- */
  function fmtTime(ts, now) {
    if (!Number.isFinite(ts)) return '—';
    const d = now != null ? now : Date.now();
    const diff = d - ts;
    if (diff < 60e3) return '刚刚';
    if (diff < 3600e3) return Math.floor(diff / 60e3) + ' 分钟前';
    if (diff < 86400e3) return Math.floor(diff / 3600e3) + ' 小时前';
    if (diff < 7 * 86400e3) return Math.floor(diff / 86400e3) + ' 天前';
    const dt = new Date(ts);
    return dt.getFullYear() + '/' + (dt.getMonth() + 1) + '/' + dt.getDate();
  }

  return { templates, MODULE_NAMES, match, fmtTime };
})();

App.register('home', (host) => {
  let query = '';

  host.innerHTML = `
    <div class="module layout">
      <div class="pane full">
        <h2 style="margin-top:0">工作台</h2>
        <p class="hint" style="margin-top:-4px">实验 = 模块状态 + 参数 + 快照，全部保存在浏览器本地（不上传）。输入会自动保存；💾 保存会额外打一个可恢复的快照。</p>
        <div class="row" id="wb-toolbar" style="flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:6px"></div>
        <h3>快速开始</h3>
        <div class="row" id="wb-tpl" style="flex-wrap:wrap;gap:8px"></div>
        <h3 id="wb-list-title">最近实验</h3>
        <div id="wb-empty"></div>
        <div id="wb-list" role="list" aria-label="实验列表"></div>
      </div>
    </div>`;

  const $ = (s) => host.querySelector(s);

  function render() { renderTpls(); renderList(); }

  /* ---------- 快速开始 ---------- */
  function renderTpls() {
    const box = $('#wb-tpl');
    box.innerHTML = '';
    WB.templates.filter((t) => WB.match(query, { name: t.name + ' ' + t.desc, tags: ['模板'], module: t.module })).forEach((t) => {
      const card = U.el('button', { class: 'wb-tpl-card', 'data-tpl': t.id, title: '创建实验并打开 ' + (WB.MODULE_NAMES[t.module] || t.module) });
      card.append(
        U.el('div', { class: 'wb-tpl-name' }, t.name),
        U.el('div', { class: 'wb-tpl-desc' }, t.desc),
        U.el('div', { class: 'wb-tpl-mod' }, '→ ' + (WB.MODULE_NAMES[t.module] || t.module))
      );
      card.addEventListener('click', () => {
        const exp = App.exps.createAndOpen({ name: t.name, module: t.module, state: t.state, tags: ['模板'] });
        if (exp) App.toast('实验「' + t.name + '」已创建，开始你的分析吧');
      });
      box.appendChild(card);
    });
    if (!box.children.length) box.appendChild(U.el('span', { class: 'hint', style: 'margin:0' }, '没有匹配的模板'));
  }

  /* ---------- 实验列表 ---------- */
  function renderList() {
    const list = $('#wb-list');
    const empty = $('#wb-empty');
    list.innerHTML = '';
    empty.innerHTML = '';
    const all = PX.list().filter((m) => WB.match(query, m));
    if (!PX.list().length) {
      empty.innerHTML = `
        <div class="wb-onboard">
          <b>三步开始第一个实验</b>
          <ol>
            <li>点上方「快速开始」任一模板（或「＋ 新建实验」）；</li>
            <li>在打开的模块里改参数、看响应 —— 输入会自动保存；</li>
            <li>用结果工具栏 💾 保存 / 🔗 分享 / 🖼📊📄 导出。</li>
          </ol>
        </div>`;
    } else if (!all.length) {
      empty.appendChild(U.el('p', { class: 'hint' }, '没有匹配「' + query + '」的实验'));
      $('#wb-list-title').textContent = '最近实验';
      return;
    }
    $('#wb-list-title').textContent = query ? '搜索结果（' + all.length + '）' : '最近实验';

    all.forEach((meta) => {
      const row = U.el('div', { class: 'wb-row', 'data-exp': meta.id, role: 'listitem' });
      const nameBtn = U.el('button', { class: 'wb-open', title: '打开实验' }, meta.name + (meta.favorite ? ' ★' : ''));
      nameBtn.addEventListener('click', () => App.exps.openById(meta.id));
      const badge = U.el('span', { class: 'wb-badge' }, WB.MODULE_NAMES[meta.module] || meta.module);
      const time = U.el('span', { class: 'wb-time', title: '最近更新' }, WB.fmtTime(meta.updatedAt));
      const act = U.el('span', { class: 'wb-act' });

      const mkBtn = (cls, label, title, fn) => {
        const b = U.el('button', { class: 'chip ' + cls, title }, label);
        b.addEventListener('click', fn);
        return b;
      };
      let delB;
      delB = mkBtn('wb-del', '🗑', '删除', () => confirmDelete(delB, meta));
      act.append(
        mkBtn('wb-fav', meta.favorite ? '★' : '☆', meta.favorite ? '取消收藏' : '收藏', () => { PX.patch(meta.id, { favorite: !meta.favorite }); render(); }),
        mkBtn('wb-rename', '✎', '重命名', () => startRename(row, meta)),
        mkBtn('wb-dup', '⧉', '复制为新实验', () => { try { PX.duplicate(meta.id); App.toast('已复制'); render(); } catch (e) { App.toast('复制失败：' + e.message, 'danger'); } }),
        mkBtn('wb-snap', '🕘', '快照列表', () => toggleSnaps(row, meta)),
        mkBtn('wb-export', '⤓', '导出此实验 JSON', () => {
          const exp = PX.load(meta.id);
          if (!exp) { App.toast('实验数据缺失', 'danger'); return; }
          try {
            const blob = new Blob([PX.exportJSON(exp)], { type: 'application/json' });
            if (RTB.download(exp.name.replace(/[\\/:*?"<>|]/g, '_') + '.json', blob)) App.toast('已导出 JSON');
          } catch (e) { App.toast('导出失败：' + e.message, 'danger'); }
        }),
        delB
      );
      row.append(nameBtn, badge, time, act);
      list.appendChild(row);
    });
  }

  function startRename(row, meta) {
    const nameBtn = row.querySelector('.wb-open');
    if (!nameBtn || row.querySelector('.wb-rename-inp')) return;
    const old = PX.load(meta.id);
    const inp = U.el('input', { type: 'text', class: 'wb-rename-inp', value: old ? old.name : '', 'aria-label': '实验名称', maxlength: '80' });
    const okB = U.el('button', { class: 'chip', title: '确认' }, '✓');
    const noB = U.el('button', { class: 'chip', title: '取消' }, '✕');
    nameBtn.replaceWith(inp);
    inp.after(okB, noB);
    okB.addEventListener('click', done);
    noB.addEventListener('click', render);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); else if (e.key === 'Escape') render(); });
    inp.focus();
    function done() {
      const v = inp.value.trim();
      if (v) { try { PX.patch(meta.id, { name: v }); } catch (e) { App.toast('重命名失败：' + e.message, 'danger'); } }
      render();
    }
  }

  function confirmDelete(btn, meta) {
    if (btn.dataset.confirm === '1') {
      PX.remove(meta.id);
      if (App.exps.cur() && App.exps.cur().id === meta.id) { try { localStorage.removeItem('fltp:last'); } catch (e) { } }
      App.toast('已删除「' + meta.name + '」');
      render();
      return;
    }
    btn.dataset.confirm = '1';
    btn.textContent = '确认?';
    btn.style.color = 'var(--danger)';
    setTimeout(() => { if (btn.isConnected) { btn.dataset.confirm = '0'; btn.textContent = '🗑'; btn.style.color = ''; } }, 2500);
  }

  function toggleSnaps(row, meta) {
    const old = row.nextElementSibling;
    if (old && old.classList.contains('wb-snaps')) { old.remove(); return; }
    document.querySelectorAll('.wb-snaps').forEach((x) => x.remove());
    const exp = PX.load(meta.id);
    if (!exp) return;
    const box = U.el('div', { class: 'wb-snaps' });
    box.appendChild(U.el('div', { class: 'hint', style: 'margin:0 0 4px' }, '快照（最多 10 个，保存时自动打点）：'));
    if (!(exp.snapshots || []).length) box.appendChild(U.el('div', { class: 'hint', style: 'margin:0' }, '还没有快照 —— 在实验里按 💾 保存 即可打点。'));
    (exp.snapshots || []).forEach((s) => {
      const r = U.el('div', { class: 'wb-snap-row' });
      const restore = U.el('button', { class: 'chip', title: '恢复到该快照并打开对应模块' }, '⤺ ' + s.label);
      restore.addEventListener('click', () => {
        try {
          PX.restoreSnapshot(exp, s.id);
          App.exps.openById(meta.id);
          App.toast('已恢复快照「' + s.label + '」');
        } catch (e) { App.toast('恢复失败：' + e.message, 'danger'); }
      });
      r.append(restore, U.el('span', { class: 'wb-time' }, WB.fmtTime(s.ts)));
      box.appendChild(r);
    });
    row.after(box);
  }

  /* ---------- 工具行（U.el 构建，保证 aria/事件可测可用） ---------- */
  function buildToolbar() {
    const bar = $('#wb-toolbar');
    bar.innerHTML = '';
    const search = U.el('input', { type: 'search', id: 'wb-search', placeholder: '搜索实验 / 标签 / 模块…', 'aria-label': '搜索实验', style: 'flex:1;min-width:180px' });
    search.addEventListener('input', (e) => { query = e.target.value; renderTpls(); renderList(); });
    const newBtn = U.el('button', { class: 'btn primary', id: 'wb-new', title: '新建一个空白实验并打开系统分析' }, '＋ 新建实验');
    newBtn.addEventListener('click', () => {
      const n = PX.list().length + 1;
      const exp = App.exps.createAndOpen({ name: '实验 ' + n, module: 'sys', state: { num: '1', den: 's^2+2*s+5' } });
      if (exp) App.toast('实验「' + exp.name + '」已创建');
    });
    const impBtn = U.el('button', { class: 'btn', id: 'wb-import', title: '导入实验 JSON 文件' }, '⬆ 导入 JSON');
    impBtn.addEventListener('click', () => fileInp.click());
    const codeBtn = U.el('button', { class: 'btn', id: 'wb-import-code', title: '粘贴版本化分享码导入实验' }, '🔗 分享码导入');
    codeBtn.addEventListener('click', importCodeDialog);
    const fileInp = U.el('input', { type: 'file', id: 'wb-import-file', accept: '.json,application/json', class: 'hidden', 'aria-label': '选择实验 JSON 文件' });
    fileInp.addEventListener('change', (e) => { importFile(e.target.files && e.target.files[0]); e.target.value = ''; });
    bar.append(search, newBtn, impBtn, codeBtn, fileInp);
  }

  /* ---------- 导入 ---------- */
  function importFile(file) {    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      const r = App.exps.importJSONText(String(rd.result));
      if (r.ok) App.toast('导入成功：「' + r.value.name + '」' + (r.migrated ? '（已从旧版本迁移）' : ''));
      else App.toast('导入失败：' + (r.error && r.error.message || '数据不合法'), 'danger');
    };
    rd.onerror = () => App.toast('读取文件失败', 'danger');
    rd.readAsText(file);
  }

  function importCodeDialog() {
    const wrap = U.el('div', { class: 'mask', style: 'position:fixed;z-index:998' });
    const box = U.el('div', { class: 'dialog', style: 'max-width:560px' });
    box.appendChild(U.el('h3', { style: 'margin-top:0' }, '粘贴分享码导入'));
    const ta = U.el('textarea', { 'aria-label': '分享码', placeholder: 'PX1.xxxxxxxx.yyyy…', style: 'width:100%;min-height:90px;font-family:var(--mono);font-size:12px' });
    const row = U.el('div', { class: 'row', style: 'margin-top:8px' });
    const okB = U.el('button', { class: 'btn primary' }, '导入');
    const noB = U.el('button', { class: 'btn' }, '取消');
    okB.addEventListener('click', () => {
      const code = ta.value.trim();
      const m = code.match(/PX1\.[A-Za-z0-9_-]+\.[0-9a-f]{8}/);
      if (!m) { App.toast('未找到有效的分享码（应以 PX1. 开头）', 'danger'); return; }
      const r = App.exps.importFromShare(m[0]);
      if (r.ok) { App.toast('导入成功：「' + r.value.name + '」'); wrap.remove(); }
      else App.toast('导入失败：' + (r.error && r.error.message || '数据不合法'), 'danger');
    });
    noB.addEventListener('click', () => wrap.remove());
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    row.append(okB, noB);
    box.append(ta, row);
    wrap.appendChild(box);
    host.appendChild(wrap);
    ta.focus();
  }

  buildToolbar();

  const api = {
    title: '工作台',
    subtitle: '实验管理',
    render,
    dispose() { },
    onTheme() { }
  };
  render();
  return { title: api.title, subtitle: api.subtitle, api };
});
