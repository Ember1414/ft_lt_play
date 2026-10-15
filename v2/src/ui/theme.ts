/**
 * theme.ts — 主题控制（浅色纸感 / 深色夜景 / 跟随系统）
 * 契约：主题只经本模块修改；html[data-theme] 为唯一状态出口；
 *       主题色元数据（theme-color）随主题同步。
 */

export type ThemeChoice = 'light' | 'dark' | 'auto';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'flt2:theme';

export function isThemeChoice(v: unknown): v is ThemeChoice {
  return v === 'light' || v === 'dark' || v === 'auto';
}

export function getThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isThemeChoice(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function prefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'auto') return prefersDark() ? 'dark' : 'light';
  return choice;
}

const themeListeners = new Set<(r: ResolvedTheme) => void>();

/** 订阅主题解析结果（图表/公式需在主题切换后重绘） */
export function onThemeChange(cb: (r: ResolvedTheme) => void): () => void {
  themeListeners.add(cb);
  return () => themeListeners.delete(cb);
}

export function applyTheme(choice: ThemeChoice): ResolvedTheme {
  const resolved = resolveTheme(choice);
  document.documentElement.dataset['theme'] = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0B0E14' : '#F6F5F1');
  for (const fn of themeListeners) fn(resolved);
  return resolved;
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* 存储不可用：仅应用当前会话（临时会话模式，见 §4.2 异常约定） */
  }
  applyTheme(choice);
}

/** 应用启动时调用：应用已保存偏好，并在"跟随系统"下响应系统切换 */
export function initTheme(): ThemeChoice {
  const choice = getThemeChoice();
  applyTheme(choice);
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (getThemeChoice() === 'auto') applyTheme('auto');
    });
  } catch {
    /* 老引擎无 addEventListener：忽略（兼容矩阵见 §5.4） */
  }
  return choice;
}

export function nextChoice(c: ThemeChoice): ThemeChoice {
  return c === 'light' ? 'dark' : c === 'dark' ? 'auto' : 'light';
}

export const CHOICE_LABEL: Record<ThemeChoice, string> = {
  light: '浅色',
  dark: '深色',
  auto: '跟随系统',
};