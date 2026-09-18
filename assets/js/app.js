/* ============================================================
 * app.js — 应用启动器 / 导航 / 模块生命周期
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

      // 播放/重置/逐帧为模块本地控件（见各模块），此处仅保留键盘快捷键

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

      // 默认打开第一个；URL 带分享参数时直达对应模块
      // #ex= 交互求解 · #hn= 系统分析 · #lan= 拉普拉斯 · #ft= 傅立叶变换 · #fs= 傅立叶级数
      let first = this.navButtons[0] && this.navButtons[0].dataset.module;
      try {
        const hp = new URLSearchParams(location.hash.replace(/^#/, ''));
        if (hp.get('ex') != null) first = 'explore';
        else if (hp.get('hn') != null) first = 'sys';
        else if (hp.get('lan') != null) first = 'la';
        else if (hp.get('ft') != null) first = 'ft';
        else if (hp.get('fs') != null) first = 'fs';
        else if (hp.get('zt') != null) first = 'zt';
        else if (hp.get('blk') != null) first = 'blk';
      } catch (e) { }
      if (first) this.open(first);

      // 全局键盘快捷键（输入框内不触发）
      document.addEventListener('keydown', (e) => {
        const t = e.target;
        const tag = (t && t.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable)) return;
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

    open(name) {
      const factory = this.modules[name];
      if (!factory) return;
      if (this.current && this.current.name === name) return;
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
  document.addEventListener('DOMContentLoaded', () => App.init());

  // 模块自注册：每个 module 文件调用 App.register(名称, factory)
})();