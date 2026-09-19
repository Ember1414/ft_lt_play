/* ============================================================
 * toolbar.js — 统一结果工具栏（window.RTB）
 *   所有分析模块共用的一排结果操作：
 *   💾 保存实验 · ⧉ 复制 · ↺ 重置 · 🔗 分享 · 🖼 PNG · 📊 CSV · 📄 JSON
 *
 *   用法（模块内）：
 *     RTB.attach(hostEl, {
 *       module: 'sys',
 *       getState: () => ({ num, den }),          // 接入实验自动保存
 *       applyState: (s) => {...},                // 重置用（可选）
 *       canvases: () => [cv1, cv2],              // PNG 导出源（可选）
 *       csv: () => ({ name: 'bode', header: [...], rows: [[...]] }),  // 可选
 *     });
 *   无当前实验时，首次保存/导出会以当前模块状态自动创建一个实验。
 * ============================================================ */
window.RTB = (() => {
  const MODULE_NAMES = { sys: '系统分析', zt: 'Z 变换', la: '拉普拉斯', pid: 'PID', blk: '系统框图', ft: '傅立叶变换', fs: '傅立叶级数', explore: '交互求解', derive: '公式推导', home: '工作台' };

  /* ---------- 下载帮助 ---------- */
  function download(name, blob) {
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
      return true;
    } catch (e) {
      App.toast('导出失败：浏览器阻止了下载（' + e.message + '）', 'danger');
      return false;
    }
  }
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');

  /* ---------- 分享：剪贴板失败时给出可手动复制的浮层 ---------- */
  function copyText(text, okMsg) {
    const fallback = () => {
      const wrap = U.el('div', { class: 'mask', style: 'position:fixed;z-index:998' });
      const box = U.el('div', { class: 'dialog', style: 'max-width:520px' });
      const tip = U.el('p', { class: 'hint' }, '剪贴板不可用（非 HTTPS 或权限被拒），请手动复制下面的链接：');
      const inp = U.el('input', { type: 'text', readonly: 'readonly', 'aria-label': '分享链接' });
      inp.value = text;
      inp.style.cssText = 'width:100%;padding:8px 10px;font-family:var(--mono);font-size:12px';
      const close = U.el('button', { class: 'btn primary', style: 'margin-top:8px' }, '关闭');
      close.addEventListener('click', () => wrap.remove());
      wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
      box.append(tip, inp, close);
      wrap.appendChild(box);
      document.body.appendChild(wrap);
      try { inp.focus(); inp.select(); } catch (e) { }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => App.toast(okMsg), fallback);
    } else fallback();
  }

  function attach(hostEl, opts) {
    const module = opts.module;
    const modName = MODULE_NAMES[module] || module;

    /* 无实验时以当前状态自动建一个，让保存/导出/分享语义完整 */
    function ensureExp() {
      if (App.exps.cur()) return true;
      if (typeof opts.getState !== 'function') { App.toast('请先填写要保存的内容', 'danger'); return false; }
      const state = opts.getState();
      if (!state) return false;
      const exp = App.exps.createAndOpen({ name: modName + ' · ' + new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }), module, state });
      if (exp) App.toast('已创建实验「' + exp.name + '」');
      return !!exp;
    }

    const bar = U.el('div', { class: 'row rtb-bar', role: 'toolbar', 'aria-label': '结果操作', style: 'flex-wrap:wrap;gap:8px;margin:0 0 10px' });
    const mk = (label, title, fn) => {
      const b = U.el('button', { class: 'btn', title }, label);
      b.addEventListener('click', fn);
      bar.appendChild(b);
      return b;
    };

    mk('💾 保存实验', '保存当前状态到实验（含可恢复快照）', () => { if (ensureExp()) App.exps.saveNow(); });

    mk('⧉ 复制', '复制当前实验为新实验', () => {
      const cur = App.exps.cur();
      if (!cur) { if (!ensureExp()) return; }
      try {
        const copy = PX.duplicate(App.exps.cur().id);
        App.toast('已复制为「' + copy.name + '」（在工作台查看）');
      } catch (e) { App.toast('复制失败：' + e.message, 'danger'); }
    });

    mk('↺ 重置', '恢复到实验上次保存的状态', () => { if (!App.exps.resetCurrent()) App.toast('没有可恢复的已保存状态', 'danger'); });

    mk('🔗 分享', '复制版本化实验分享链接（含校验，可还原全部状态）', () => {
      if (!ensureExp()) return;
      const link = App.exps.shareLink();
      if (link) copyText(link, '🔗 实验分享链接已复制');
    });

    if (typeof opts.canvases === 'function') {
      mk('🖼 PNG', '把当前图导出为 PNG 图片', () => {
        const canvases = (opts.canvases() || []).filter((c) => c && !c.closest('.hidden'));
        if (!canvases.length) { App.toast('没有可导出的图（先求解并绘图）', 'danger'); return; }
        const base = (App.exps.cur() ? App.exps.cur().name : modName).replace(/[\\/:*?"<>|]/g, '_');
        let n = 0;
        canvases.forEach((c, i) => {
          if (!c.toBlob) return;
          c.toBlob((blob) => {
            if (blob && download(base + '-' + (i + 1) + '.png', blob)) n++;
            if (i === canvases.length - 1 && n) App.toast('已导出 ' + n + ' 张 PNG');
          });
        });
      });
    }

    if (typeof opts.csv === 'function') {
      mk('📊 CSV', '导出当前结果数据（CSV，Excel 可直接打开）', () => {
        const d = opts.csv();
        if (!d || !d.rows || !d.rows.length) { App.toast('没有可导出的数据（先求解）', 'danger'); return; }
        const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const lines = [(d.header || []).map(esc).join(',')].concat(d.rows.map((r) => r.map(esc).join(',')));
        // BOM：Excel 识别 UTF-8 中文表头
        const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const base = (App.exps.cur() ? App.exps.cur().name : modName).replace(/[\\/:*?"<>|]/g, '_');
        if (download(base + '-' + (d.name || 'data') + '.csv', blob)) App.toast('已导出 CSV（' + d.rows.length + ' 行）');
      });
    }

    mk('📄 JSON', '导出实验 JSON（含全部模块状态，可再导入）', () => {
      if (!ensureExp()) return;
      const cur = App.exps.cur();
      try {
        const json = PX.exportJSON(cur);
        const blob = new Blob([json], { type: 'application/json' });
        if (download(cur.name.replace(/[\\/:*?"<>|]/g, '_') + '-' + stamp() + '.json', blob)) App.toast('已导出实验 JSON');
      } catch (e) { App.toast('导出失败：' + e.message, 'danger'); }
    });

    hostEl.appendChild(bar);
    return { el: bar };
  }

  return { attach, download, copyText, stamp, MODULE_NAMES };
})();
