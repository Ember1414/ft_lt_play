/**
 * StatePanel — 空态 / 错误态 / 加载态（显示契约第 6 类）
 * 统一模板：图示 + 一句话 + 行动按钮（空态必给下一步；加载态给出取消入口的挂载位）。
 */

export interface StateAction {
  label: string;
  onClick: () => void;
}

export interface StatePanelProps {
  kind: 'empty' | 'error' | 'loading';
  title: string;
  desc?: string;
  action?: StateAction;
}

export function StatePanel(props: StatePanelProps) {
  const { kind, title, desc, action } = props;
  const glyph = kind === 'empty' ? '◇' : kind === 'error' ? '✕' : '';
  return (
    <div class={`c-state c-state-${kind}`} role={kind === 'error' ? 'alert' : undefined}>
      {kind === 'loading' ? (
        <span class="c-spinner" aria-hidden="true" />
      ) : (
        <span class="c-state-ico" aria-hidden="true">
          {glyph}
        </span>
      )}
      <div class="c-state-title">{title}</div>
      {desc ? <div class="c-state-desc">{desc}</div> : null}
      {action ? (
        <button type="button" class="btn" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}