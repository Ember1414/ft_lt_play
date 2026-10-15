import type { ComponentChildren } from 'preact';

/**
 * StatusBadge — 状态徽标（显示契约第 5 类）
 * 统一三态（ok / warn / err）+ 固定文案模板；颜色之外必须有图标（不以颜色单独表意）。
 */

export type StatusKind = 'ok' | 'warn' | 'err' | 'info';

const ICON: Record<StatusKind, string> = { ok: '✓', warn: '!', err: '✕', info: 'i' };

export interface StatusBadgeProps {
  kind: StatusKind;
  children: ComponentChildren;
}

export function StatusBadge(props: StatusBadgeProps) {
  return (
    <span class={`c-badge c-badge-${props.kind}`}>
      <i class="c-badge-ico" aria-hidden="true">
        {ICON[props.kind]}
      </i>
      {props.children}
    </span>
  );
}