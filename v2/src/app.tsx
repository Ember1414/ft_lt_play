import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { CHOICE_LABEL, applyTheme, getThemeChoice, nextChoice, setThemeChoice, type ThemeChoice } from './ui/theme';
import { currentRoute, navigate, onRouteChange, type Route } from './router';
import { CommandPalette } from './ui/CommandPalette';
import { Sidebar } from './ui/Sidebar';
import { Home } from './pages/Home';
import { Workspace } from './pages/Workspace';
import { Experiments } from './pages/Experiments';
import { Paths } from './pages/Paths';
import { Compare } from './pages/Compare';
import { Theater } from './pages/Theater';
import { Settings } from './pages/Settings';
import { ImportPage } from './pages/ImportPage';
import { toolById } from './tools/registry';
import { flushSave, getCurrent, storageAvailable } from './state/experiments';

/**
 * app.tsx — 应用外壳（FR-01）
 * 左侧栏（可折叠 / 移动端底部标签栏）＋ 顶栏（面包屑 · 命令 · 主题）＋ 页面容器 ＋ 全局命令面板。
 * 路由：hash（#/…、#exp=…）；Esc 逐层关闭；⌘K 任何页面可用。
 */

function crumbs(route: Route): string {
  switch (route.page) {
    case 'home':
      return '命令中心';
    case 'tool':
      return '工作区 / ' + (toolById(route.toolId)?.name ?? route.toolId);
    case 'experiments':
      return '实验管理';
    case 'paths':
      return '学习路径';
    case 'compare':
      return '对比实验 A/B';
    case 'theater':
      return '演示剧场';
    case 'settings':
      return '设置';
    case 'import':
      return '导入分享码';
  }
}

/** 崩溃探针标记：模块级（放组件内会被重渲染复位，「重试」将永远循环）；仅 dev 探针使用 */
let devCrashFired = false;

export function App() {
  const [route, setRoute] = useState<Route>(currentRoute);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [choice, setChoice] = useState<ThemeChoice>(getThemeChoice());
  const [toast, setToast] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    applyTheme(choice);
  }, [choice]);
  useEffect(() => onRouteChange(setRoute), []);

  // 全局快捷键：⌘K 命令面板；Esc 逐层关闭（面板 → 帮助 → 移动导航）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape') {
        setPaletteOpen((v) => {
          if (v) return false;
          setHelpOpen((h) => {
            if (h) return false;
            setMobileNav(false);
            return h;
          });
          return v;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 离开前写盘
  useEffect(() => {
    const onLeave = (): void => flushSave();
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const cycleTheme = (): void => {
    const nx = nextChoice(choice);
    setThemeChoice(nx);
    setChoice(nx);
  };

  // 仅 dev 构建生效的崩溃探针（#/dev/crash）：首次渲染人为抛错，供 e2e 验证 ErrorBoundary 兜底；
  // 生产构建 import.meta.env.DEV 恒为 false，整段连同标记位一并被剔除。
  const page = (() => {
    if (import.meta.env.DEV && location.hash === '#/dev/crash') {
      if (!devCrashFired) {
        devCrashFired = true;
        throw new Error('dev crash probe：人为渲染异常（仅 dev 构建可见）');
      }
      return <Home onToast={showToast} />;
    }
    switch (route.page) {
      case 'home':
        return <Home onToast={showToast} />;
      case 'tool':
        return <Workspace toolId={route.toolId} onToast={showToast} onCommand={() => setPaletteOpen(true)} />;
      case 'experiments':
        return <Experiments onToast={showToast} />;
      case 'paths':
        return <Paths onToast={showToast} />;
      case 'compare':
        return <Compare onToast={showToast} />;
      case 'theater':
        return <Theater onToast={showToast} />;
      case 'settings':
        return <Settings onToast={showToast} />;
      case 'import':
        return <ImportPage code={route.code} />;
    }
  })();

  const activeTool = route.page === 'tool' ? route.toolId : getCurrent()?.module ?? 'sys';

  return (
    <div class={'app' + (navCollapsed ? ' is-nav-collapsed' : '') + (mobileNav ? ' is-mobile-nav' : '')}>
      <Sidebar route={route} collapsed={navCollapsed} onToggle={() => setNavCollapsed((v) => !v)} />
      <div class="nav-mask" onClick={() => setMobileNav(false)} aria-hidden="true" />

      <div class="app-main">
        <header class="top">
          <button class="btn-ghost only-narrow" onClick={() => setMobileNav((v) => !v)} title="导航" aria-label="打开导航">
            ☰
          </button>
          <nav class="crumbs" aria-label="面包屑">
            <button class="crumb-link" onClick={() => navigate({ page: 'home' })}>
              命令中心
            </button>
            {route.page !== 'home' ? <span class="crumb-sep">/</span> : null}
            {route.page !== 'home' ? <span class="crumb-cur">{crumbs(route)}</span> : null}
          </nav>
          <span class="spacer" />
          <button class="btn" onClick={() => setPaletteOpen(true)} title="命令面板（⌘K / Ctrl+K）">
            ⌘K 命令
          </button>
          <button class="btn" onClick={() => setHelpOpen(true)} title="快捷键帮助">
            帮助
          </button>
          <button class="btn" onClick={cycleTheme} title="切换主题：浅色 / 深色 / 跟随系统">
            ◐ {CHOICE_LABEL[choice]}
          </button>
        </header>

        {!storageAvailable() ? (
          <div class="banner banner-warn" role="status">
            当前为临时会话：本地存储不可用，实验数据不会保存（功能可正常使用）。
          </div>
        ) : null}

        <main class="content">{page}</main>
      </div>

      <nav class="tabbar" aria-label="移动导航">
        <button class={'tab' + (route.page === 'home' ? ' is-on' : '')} onClick={() => navigate({ page: 'home' })}>
          <span aria-hidden="true">◧</span>命令
        </button>
        <button class={'tab' + (route.page === 'paths' ? ' is-on' : '')} onClick={() => navigate({ page: 'paths' })}>
          <span aria-hidden="true">◈</span>路径
        </button>
        <button class={'tab' + (route.page === 'tool' ? ' is-on' : '')} onClick={() => navigate({ page: 'tool', toolId: activeTool })}>
          <span aria-hidden="true">∿</span>工作区
        </button>
        <button class={'tab' + (route.page === 'experiments' ? ' is-on' : '')} onClick={() => navigate({ page: 'experiments' })}>
          <span aria-hidden="true">▤</span>我的
        </button>
      </nav>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onToast={showToast}
        onHelp={() => setHelpOpen(true)}
      />

      {helpOpen ? (
        <div class="cmdk-mask" onClick={() => setHelpOpen(false)}>
          <div class="help-card card" role="dialog" aria-label="快捷键帮助" onClick={(e) => e.stopPropagation()}>
            <h3>键盘与快捷键</h3>
            <table class="tbl">
              <tbody>
                <tr>
                  <td class="mono">⌘K / Ctrl+K</td>
                  <td>打开 / 关闭命令面板（任何页面）</td>
                </tr>
                <tr>
                  <td class="mono">Esc</td>
                  <td>逐层关闭：命令面板 → 帮助 → 移动导航</td>
                </tr>
                <tr>
                  <td class="mono">⌘Z / Ctrl+Z</td>
                  <td>撤销（工作区内，输入级 ≥30 步）</td>
                </tr>
                <tr>
                  <td class="mono">⌘⇧Z</td>
                  <td>重做</td>
                </tr>
                <tr>
                  <td class="mono">↑ ↓ / Enter</td>
                  <td>命令面板内选择与执行；数值框内步进与提交</td>
                </tr>
                <tr>
                  <td class="mono">Shift + 拖动</td>
                  <td>数值手柄精调（步长 ÷10）</td>
                </tr>
              </tbody>
            </table>
            <div class="row">
              <button class="btn" onClick={() => setHelpOpen(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div class="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}