import { GROUP_NAMES, GROUP_ORDER, TOOLS, toolsOf } from '../tools/registry';
import { navigate, type Route } from '../router';

/**
 * Sidebar — 桌面左侧导航（分组 + 工具）；可折叠为图标条（FR-01）。
 * 移动端由 CSS 切换为底部标签栏（见 shell.css）。
 */

export interface SidebarProps {
  route: Route;
  collapsed: boolean;
  onToggle: () => void;
}

function isActive(route: Route, id: string): boolean {
  return route.page === 'tool' && route.toolId === id;
}

export function Sidebar(props: SidebarProps) {
  const { route, collapsed, onToggle } = props;
  const cls = 'side' + (collapsed ? ' is-collapsed' : '');

  return (
    <nav class={cls} aria-label="主导航">
      <div class="side-head">
        <span class="side-brand-mark" aria-hidden="true">
          ∿
        </span>
        <span class="side-brand">信号与控制</span>
        <button class="side-collapse btn-ghost" onClick={onToggle} title={collapsed ? '展开侧栏' : '折叠侧栏'}>
          {collapsed ? '»' : '«'}
        </button>
      </div>

      <button
        type="button"
        class={'side-item' + (route.page === 'home' ? ' is-on' : '')}
        onClick={() => navigate({ page: 'home' })}
        title="命令中心"
      >
        <span class="side-glyph" aria-hidden="true">
          ◧
        </span>
        <span class="side-label">命令中心</span>
      </button>

      {GROUP_ORDER.map((g) => {
        const list = toolsOf(g);
        if (!list.length) return null;
        return (
          <div class="side-group" key={g}>
            <div class="side-groupname">{GROUP_NAMES[g]}</div>
            {list.map((t) => (
              <button
                key={t.id}
                type="button"
                class={'side-item' + (isActive(route, t.id) ? ' is-on' : '')}
                onClick={() => navigate({ page: 'tool', toolId: t.id })}
                title={t.name + ' · ' + t.blurb}
              >
                <span class="side-glyph" aria-hidden="true">
                  {t.glyph}
                </span>
                <span class="side-label">{t.name}</span>
                {t.status === 'wip' ? <i class="side-dot" title="建设中" /> : null}
              </button>
            ))}
          </div>
        );
      })}

      <div class="side-foot">
        <button
          type="button"
          class={'side-item' + (route.page === 'paths' ? ' is-on' : '')}
          onClick={() => navigate({ page: 'paths' })}
          title="学习路径与自测"
        >
          <span class="side-glyph" aria-hidden="true">
            ◈
          </span>
          <span class="side-label">学习路径</span>
        </button>
        <button
          type="button"
          class={'side-item' + (route.page === 'compare' ? ' is-on' : '')}
          onClick={() => navigate({ page: 'compare' })}
          title="对比实验 A/B"
        >
          <span class="side-glyph" aria-hidden="true">
            ⇄
          </span>
          <span class="side-label">对比实验</span>
        </button>
        <button
          type="button"
          class={'side-item' + (route.page === 'theater' ? ' is-on' : '')}
          onClick={() => navigate({ page: 'theater' })}
          title="演示剧场（一键播放叙事演示）"
        >
          <span class="side-glyph" aria-hidden="true">
            ▷
          </span>
          <span class="side-label">演示剧场</span>
        </button>
        <button
          type="button"
          class={'side-item' + (route.page === 'experiments' ? ' is-on' : '')}
          onClick={() => navigate({ page: 'experiments' })}
          title="实验管理"
        >
          <span class="side-glyph" aria-hidden="true">
            ▤
          </span>
          <span class="side-label">实验管理</span>
        </button>
        <button
          type="button"
          class={'side-item' + (route.page === 'settings' ? ' is-on' : '')}
          onClick={() => navigate({ page: 'settings' })}
          title="设置"
        >
          <span class="side-glyph" aria-hidden="true">
            ⚙
          </span>
          <span class="side-label">设置</span>
        </button>
      </div>

      <div class="side-meta" aria-hidden="true">
        <span>{TOOLS.length} 个工具</span>
      </div>
    </nav>
  );
}