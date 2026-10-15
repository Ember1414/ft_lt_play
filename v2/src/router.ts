/**
 * router.ts — hash 路由（规划书 §4.1）
 * 语义优先级：#exp= / #pkg=（导入分享码）＞ 路径 / 工具路由 ＞ 默认首页。
 * 浏览器返回 = 回到上一视图且不丢当前输入（工具状态由 state/experiments 持有，与路由解耦）。
 */

export type Route =
  | { page: 'home' }
  | { page: 'tool'; toolId: string }
  | { page: 'experiments' }
  | { page: 'paths' }
  | { page: 'compare' }
  | { page: 'theater' }
  | { page: 'settings' }
  | { page: 'baseline' }
  | { page: 'gallery' }
  | { page: 'import'; code: string };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#/, '');
  if (!h || h === '/' || h === '') return { page: 'home' };
  const mExp = h.match(/^(?:exp|pkg)=(.+)$/);
  if (mExp) return { page: 'import', code: mExp[1] };
  const parts = h.replace(/^\//, '').split('/').filter(Boolean);
  const head = parts[0];
  if (head === 'tools' && parts[1]) return { page: 'tool', toolId: parts[1] };
  if (head === 'experiments') return { page: 'experiments' };
  if (head === 'paths') return { page: 'paths' };
  if (head === 'compare') return { page: 'compare' };
  if (head === 'theater') return { page: 'theater' };
  if (head === 'settings') return { page: 'settings' };
  if (head === 'baseline') return { page: 'baseline' };
  if (head === 'gallery') return { page: 'gallery' };
  return { page: 'home' };
}

/** 路由 → hash 字符串（规范形，用于 link 与 navigate） */
export function routeHash(route: Route): string {
  switch (route.page) {
    case 'home':
      return '#/';
    case 'tool':
      return '#/tools/' + route.toolId;
    case 'experiments':
      return '#/experiments';
    case 'paths':
      return '#/paths';
    case 'compare':
      return '#/compare';
    case 'theater':
      return '#/theater';
    case 'settings':
      return '#/settings';
    case 'baseline':
      return '#/baseline';
    case 'gallery':
      return '#/gallery';
    case 'import':
      return '#exp=' + route.code;
  }
}

export function currentRoute(): Route {
  return parseHash(typeof location === 'undefined' ? '' : location.hash);
}

export function navigate(route: Route): void {
  const next = routeHash(route);
  if (location.hash === next) return;
  location.hash = next;
}

export function onRouteChange(cb: (r: Route) => void): () => void {
  const handler = (): void => cb(currentRoute());
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}