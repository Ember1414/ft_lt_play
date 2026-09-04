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
      this.$play = document.getElementById('btn-play');
      this.$reset = document.getElementById('btn-reset');
      this.$theme = document.getElementById('btn-theme');
      this.navButtons = U.$$('.nav-item');

      // 导航事件
      this.nav.addEventListener('click', (e) => {
        const b = e.target.closest('.nav-item');
        if (b) this.open(b.dataset.module);
      });

      // 全局播放/重置
      this.$play.addEventListener('click', () => {
        const r = this._call('togglePlay');
        if (typeof r === 'boolean') this.$play.textContent = r ? '⏸' : '▶';
      });
      this.$reset.addEventListener('click', () => this._call('reset'));

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

      // 默认打开第一个
      const first = this.navButtons[0] && this.navButtons[0].dataset.module;
      if (first) this.open(first);
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
      this.title.innerHTML = mod.title + (mod.subtitle ? '<small>' + mod.subtitle + '</small>' : '');
      this.current = { name, api };
      this.$play.disabled = !api.togglePlay;
      this.$reset.disabled = !api.reset;
      // 有动画的模块默认在播放 → 图标为暂停
      this.$play.textContent = api.togglePlay ? '⏸' : '▶';
    }
  };

  window.App = App;
  document.addEventListener('DOMContentLoaded', () => App.init());

  // 模块自注册：每个 module 文件调用 App.register(名称, factory)
})();