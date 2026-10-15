/**
 * prefs.ts — 用户偏好（主题之外的动效偏好；主题见 ui/theme.ts）
 * 契约：偏好只经本模块修改；出口为 html[data-motion]（CSS 层统一约束动画/过渡）。
 * 'auto' = 跟随系统 prefers-reduced-motion；'reduce' = 强制减弱；'full' = 强制完整（覆盖系统）。
 */

export type MotionPref = 'auto' | 'reduce' | 'full';

const KEY = 'flt2:motion';

export const MOTION_LABEL: Record<MotionPref, string> = {
  auto: '跟随系统',
  reduce: '强制减弱',
  full: '强制完整',
};

export function getMotionPref(): MotionPref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'reduce' || v === 'full' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyMotion(p: MotionPref): void {
  const root = document.documentElement;
  if (p === 'auto') delete root.dataset['motion'];
  else root.dataset['motion'] = p;
}

export function setMotionPref(p: MotionPref): void {
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* 存储不可用：仅当前会话生效 */
  }
  applyMotion(p);
}

export function initPrefs(): void {
  applyMotion(getMotionPref());
}
