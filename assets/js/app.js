/* ============================================================
 * app.js — 应用启动器 / 导航 / 模块生命周期 / 实验控制器
 *   实验模型与版本化存储见 lib/project.js（window.PX，schema v1）。
 *   模块通过 api.getState() / api.applyState(state) 接入实验：
 *   自动保存 = 切换模块/刷新前捕获 + 防抖落盘；手动保存 = 工具栏💾。
 * ============================================================ */
(() => {
  const App = {
    modules: {},      // name -> factory
    current: null,    // { name, api } active instance
    register(name, factory) { this.modules[name] = factory; },

    init() {
      this.nav = document.getElementById('nav');
      this.title = document.getElementById('module-title');
      this.content = document.getElementById('content');
      this.$theme = document.getElementById('btn-theme');
      this.navButtons = U.$$('.nav-item');

      // CDN 主源失败时动态补备用源（不再用 document.write 内联脚本，配合 CSP）
      ensureCdnLibs();

      // 导航事件（手机端选中后自动收起抽屉侧边栏）
      this.nav.addEventListener('click', (e) => {
        const b = e.target.closest('.nav-item');
        if (b) { this.open(b.dataset.module); if (this._closeDrawer) this._closeDrawer(); }
      });

      // 移动端抽屉侧边栏（遮罩用 hidden 类切换，避免 !important 规则冲突）
      const menuBtn = document.getElementById('btn-menu');
      const mask = document.getElementById('sidebar-mask');
      const setDrawer = (open) => {
        document.body.classList.toggle('sidebar-open', open);
        if (mask) mask.classList.toggle('hidden', !open);
      };
      const closeDrawer = () => setDrawer(false);
      if (menuBtn) menuBtn.addEventListener('click', () => setDrawer(!document.body.classList.contains('sidebar-open')));
      if (mask) mask.addEventListener('click', closeDrawer);
      this._closeDrawer = closeDrawer;

      // 主题切换（深/浅），持久化到 localStorage
      const savedTheme = localStorage.getItem('flt-theme') === 'light' ? 'light' : 'dark';
      this.applyTheme(savedTheme);
      this.$theme.addEventListener('click', () => {
        const next = document.body.classList.contains('light') ? 'dark' : 'light';
        localStorage.setItem('flt-theme', next);
        this.applyTheme(next);
      });

      // 帮助
      const mk = document.getElementById('about-mask');
      document.getElementById('about-trigger').addEventListener('click', (e) => { e.preventDefault(); mk.classList.remove('hidden'); });
      document.getElementById('about-close').addEventListener('click', () => mk.classList.add('hidden'));
      mk.addEventListener('click', (e) => { if (e.target === mk) mk.classList.add('hidden'); });

      // 启动路由优先级：
      //   #exp=<分享码> → 导入并打开   ·  旧版模块 hash（#hn/#ex/#lan/...）→ 直达模块
      //   有最近实验 → 恢复实验        ·  否则 → 工作台
      let first = this.navButtons[0] && this.navButtons[0].dataset.module;
      let restored = false;
      try {
        const hp = new URLSearchParams(location.hash.replace(/^#/, ''));
        const expCode = hp.get('exp');
        if (expCode) {
          const r = App.exps.importFromShare(expCode);
          if (r.ok) { restored = true; first = null; }   // 导入时已打开对应模块，跳过兜底 open
          else { App.toast('分享导入失败：' + (r.error && r.error.message || '数据不合法'), 'danger'); }
        }
        if (!restored) {
          if (hp.get('ex') != null) first = 'explore';
          else if (hp.get('hn') != null) first = 'sys';
          else if (hp.get('lan') != null) first = 'la';
          else if (hp.get('ft') != null) first = 'ft';
          else if (hp.get('fs') != null) first = 'fs';
          else if (hp.get('zt') != null) first = 'zt';
          else if (hp.get('blk') != null) first = 'blk';
          else {
            const lastId = localStorage.getItem('fltp:last');
            const lastExp = lastId && PX.load(lastId);
            if (lastExp) { App.exps._use(lastExp); first = lastExp.module || 'home'; restored = true; }
          }
        }
      } catch (e) { }
      if (first) this.open(first);
      if (restored && first && this.current && this.current.name === first) App.exps.applyTo(first);

      // 全局键盘快捷键（输入框内不触发）
      document.addEventListener('keydown', (e) => {
        const t = e.target;
        const tag = (t && t.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable)) return;
        if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
          e.preventDefault();
          if (window.CP) CP.toggle();
          return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === ' ') {
          e.preventDefault();
          const r = this._call('togglePlay');
          if (typeof r === 'boolean') window.dispatchEvent(new CustomEvent('flt-play', { detail: r }));
        } else if (e.key === 'r' || e.key === 'R') {
          this._call('reset');
        } else if (e.key === 'f' || e.key === 'F') {
          this._call('frame');
        } else if (e.key === 't' || e.key === 'T') {
          this.$theme.click();
        } else if (e.key === 'Escape') {
          if (this._closeDrawer) this._closeDrawer();
          const mk = document.getElementById('about-mask');
          if (mk && !mk.classList.contains('hidden')) mk.classList.add('hidden');
        } else if (e.key >= '1' && e.key <= '9') {
          const b = this.navButtons[+e.key - 1];
          if (b) { this.open(b.dataset.module); if (this._closeDrawer) this._closeDrawer(); }
        }
      });
    },

    applyTheme(t) {
      document.body.classList.toggle('light', t === 'light');
      this.$theme.textContent = t === 'light' ? '🌙' : '☀️';
      this.$theme.title = t === 'light' ? '切换到深色主题' : '切换到浅色主题';
      FX.refreshTheme();
      // 当前模块重绘（canvas 颜色跟随主题）
      this._call('onTheme');
    },

    _call(method) {
      if (this.current && this.current.api && typeof this.current.api[method] === 'function') return this.current.api[method]();
    },

    // 实验激活期间，模块不得把 hash 改写为旧版单输入分享（会覆盖 #exp= 路由）
    hashFree() { return !(App.exps && App.exps.cur()); },

    open(name, opts = {}) {
      const factory = this.modules[name];
      if (!factory) return;
      if (!opts.force && this.current && this.current.name === name) return;
      // 切走前捕获当前模块状态到实验（自动保存的触发点之一）
      if (App.exps) App.exps.captureState();
      // 清理旧模块
      if (this.current && this.current.api && typeof this.current.api.dispose === 'function') {
        try { this.current.api.dispose(); } catch (e) { console.error(e); }
      }
      this.navButtons.forEach((b) => b.classList.toggle('active', b.dataset.module === name));
      this.content.innerHTML = '';
      const mod = factory(this.content);
      if (FX.enablePlotChrome) FX.enablePlotChrome(this.content);
      const api = mod.api || mod;
      const group = (this.navButtons.find((b) => b.dataset.module === name) || {}).dataset?.group || '';
      this.title.innerHTML = mod.title + (mod.subtitle ? '<small>' + mod.subtitle + '</small>' : '') + (group ? '<small style="margin-left:10px;color:var(--text-faint)">· ' + group + '</small>' : '');
      this.current = { name, api };
    }
  };

  window.App = App;

  /* ---------- 全局轻提示（aria-live，供工具栏/导入导出/保存反馈） ---------- */
  let toastEl = null, toastTimer = null;
  App.toast = (msg, kind) => {
    if (typeof document === 'undefined' || !document.body) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      toastEl.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:999;'
        + 'padding:9px 16px;border-radius:9px;background:var(--panel-2,#1c2534);color:var(--text,#e8eef8);'
        + 'border:1px solid var(--line-2,#2c384d);box-shadow:0 6px 24px rgba(0,0,0,.35);'
        + 'font-size:13px;max-width:80vw;transition:opacity .25s;opacity:0';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.borderColor = kind === 'danger' ? 'var(--danger,#ff6b6b)' : '';
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (toastEl) toastEl.style.opacity = '0'; }, 2600);
  };

  /* ---------- 模型库（localStorage，跨会话保存/回载当前系统） ---------- */
  App.models = (() => {
    const KEY = 'flt-models';
    const MAX = 20;
    let seq = 0;
    const load = () => {
      try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
    };
    const persist = (a) => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) { } };
    return {
      list: () => load(),
      save({ name, kind, data }) {
        const arr = load();
        if (arr.length >= MAX) arr.shift();   // 超出上限丢最旧
        const entry = { id: 'm' + Date.now().toString(36) + (seq++), name: name || ('模型 ' + (arr.length + 1)), kind, data, ts: Date.now() };
        arr.push(entry);
        persist(arr);
        return entry;
      },
      remove(id) { persist(load().filter((m) => m.id !== id)); },
      rename(id, name) { const a = load(); const m = a.find((x) => x.id === id); if (m) { m.name = name; persist(a); } }
    };
  })();
  // 「我的模型」chips 行：按 kinds 过滤，点击 onLoad(entry)，✕ 删除
  App.models.renderChips = (hostEl, { kinds, onLoad, emptyText }) => {
    const render = () => {
      hostEl.innerHTML = '';
      const all = App.models.list().filter((m) => !kinds || kinds.includes(m.kind));
      if (!all.length) { if (emptyText) hostEl.appendChild(U.el('span', { class: 'hint', style: 'margin:0' }, emptyText)); return; }
      hostEl.appendChild(U.el('span', { class: 'hint', style: 'margin:0' }, '我的模型：'));
      all.forEach((m) => {
        const chip = U.el('button', { class: 'chip', title: m.name }, m.name);
        chip.addEventListener('click', (e) => {
          if (e.target === chip) onLoad(m);
        });
        const del = U.el('span', { class: 'chip', title: '删除 ' + m.name, style: 'padding:2px 7px;min-width:24px;color:var(--danger)' }, '✕');
        del.addEventListener('click', () => { App.models.remove(m.id); render(); });
        chip.appendChild(del);
        hostEl.appendChild(chip);
      });
    };
    render();
    return render;
  };

  /* ============================================================
   * 实验控制器（App.exps）
   *   数据与校验全部在 PX（lib/project.js）；本层只做编排：
   *   捕获模块状态 → 防抖落盘 → 刷新恢复 → 分享/导入路由。
   * ============================================================ */
  App.exps = (() => {
    const LAST_KEY = 'fltp:last';
    let current = null;
    let saveTimer = null;

    const cur = () => current;

    function _use(exp) {
      current = exp;
      try { localStorage.setItem(LAST_KEY, exp ? exp.id : ''); } catch (e) { }
    }

    function schedulePersist() { clearTimeout(saveTimer); saveTimer = setTimeout(persistNow, 700); }

    function persistNow() {
      clearTimeout(saveTimer);
      if (!current) return;
      try { PX.save(current); } catch (e) {
        App.toast('实验保存失败：' + (e.name === 'QuotaExceededError' ? '浏览器本地存储空间不足' : e.message), 'danger');
      }
    }

    // 把当前活动模块的状态写进实验（模块需提供 api.getState）
    function captureState(moduleKey) {
      const active = App.current;
      const key = moduleKey || (active && active.name);
      if (!current || !key || !active || !active.api || typeof active.api.getState !== 'function') return;
      try {
        const data = active.api.getState();
        if (!data) return;
        current.moduleStates[key] = { savedAt: Date.now(), data };
        current.module = key;
        schedulePersist();
      } catch (e) { /* getState 抛错视为该状态暂不可保存 */ }
    }

    // 打开模块后把实验里保存的状态回放给它（模块需提供 api.applyState）
    function applyTo(moduleKey) {
      const active = App.current;
      if (!current || !active || active.name !== moduleKey) return;
      if (!active.api || typeof active.api.applyState !== 'function') return;
      const st = current.moduleStates[moduleKey];
      if (!st || !st.data) return;
      try { active.api.applyState(JSON.parse(JSON.stringify(st.data))); } catch (e) { console.error('applyState 失败', e); }
    }

    function openById(id) {
      const exp = PX.load(id);
      if (!exp) { App.toast('实验不存在或已被删除', 'danger'); return null; }
      _use(exp);
      App.open(exp.module || 'home');
      applyTo(exp.module || 'home');
      return exp;
    }

    function createAndOpen({ name, module, state, tags }) {
      let exp;
      try { exp = PX.create({ name, module, state, tags }); } catch (e) { App.toast('创建失败：' + e.message, 'danger'); return null; }
      _use(exp);
      App.open(exp.module || 'home');
      applyTo(exp.module || 'home');   // 模板/初始状态回放到模块
      return exp;
    }

    // 手动保存：捕获 + 落盘 + 快照（快照可在工作台恢复）
    function saveNow(label) {
      if (!current) return null;
      captureState();
      persistNow();
      let snap = null;
      try { snap = PX.addSnapshot(current, label || ('保存 ' + new Date().toLocaleTimeString()), App.current && App.current.name); } catch (e) { }
      App.toast('已保存实验「' + current.name + '」');
      return snap;
    }

    function shareLink() {
      if (!current) return null;
      captureState();
      persistNow();
      try { return location.origin + location.pathname + '#exp=' + PX.encodeShare(current); }
      catch (e) { App.toast('分享失败：' + e.message, 'danger'); return null; }
    }

    function importFromShare(code) {
      const r = PX.decodeShare(code);
      if (!r.ok) return r;
      try { PX.save(r.value); } catch (e) { return { ok: false, error: { message: e.message } }; }
      _use(r.value);
      App.open(r.value.module || 'home', { force: true });
      applyTo(r.value.module || 'home');
      return r;
    }

    function importJSONText(text) {
      const r = PX.importJSON(text);
      if (!r.ok) return r;
      try { PX.save(r.value); } catch (e) { return { ok: false, error: { message: e.message } }; }
      _use(r.value);
      App.open(r.value.module || 'home', { force: true });
      return r;
    }

    // 重置 = 回放到实验里上次保存的该模块状态
    function resetCurrent() {
      if (!current || !App.current) return false;
      const st = current.moduleStates[App.current.name];
      if (!st || !st.data || typeof App.current.api.applyState !== 'function') return false;
      try {
        App.current.api.applyState(JSON.parse(JSON.stringify(st.data)));
        App.toast('已恢复到上次保存的状态');
        return true;
      } catch (e) { return false; }
    }

    // 刷新/关闭前捕获 + 立即落盘
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('beforeunload', () => {
        if (!current) return;
        captureState();
        try { PX.save(current); } catch (e) { }
      });
    }

    return { cur, _use, openById, createAndOpen, applyTo, captureState, saveNow, shareLink, importFromShare, importJSONText, resetCurrent, persistNow };
  })();

  /* ---------- CDN 回退（备用源动态加载；失败给出可理解提示） ---------- */
  function ensureCdnLibs() {
    if (typeof document === 'undefined') return;
    const need = [];
    if (!window.katex) need.push('https://unpkg.com/katex@0.16.21/dist/katex.min.js');
    if (!window.math) need.push('https://unpkg.com/mathjs@12.4.3/lib/browser/math.js');
    need.forEach((src) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onerror = () => {
        try {
          document.body.appendChild(U.el('div', {
            role: 'alert',
            style: 'position:fixed;left:12px;right:12px;bottom:12px;z-index:999;padding:10px 14px;border-radius:9px;'
              + 'background:var(--panel-2,#1c2534);border:1px solid var(--danger,#ff6b6b);color:var(--text,#e8eef8);font-size:13px'
          }, '⚠ 公式库 CDN 不可用（已尝试备用源）：数值计算不受影响，公式可能显示为源码。检查网络后刷新可恢复。'));
        } catch (e) { console.warn('CDN 回退加载失败', src); }
      };
      document.head.appendChild(s);
    });
  }

  // PWA：Service Worker 注册（仅安全上下文；新版本就绪时提示刷新）
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && location.protocol === 'https:' || (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && ['localhost', '127.0.0.1'].includes(location.hostname))) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) App.toast('新版本已就绪，刷新页面即可启用');
          });
        });
      }).catch(() => { });
    });
  }

  document.addEventListener('DOMContentLoaded', () => App.init());

  // 模块自注册：每个 module 文件调用 App.register(名称, factory)
})();
