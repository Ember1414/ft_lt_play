/**
 * Switch — 开关 / 复选框（输入契约第 7 类）
 * 统一样式、统一位置（参数区行尾右对齐）、统一焦点环。
 */

export interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  disabled?: boolean;
}

export function Switch(props: SwitchProps) {
  const { label, checked, onChange, hint, disabled } = props;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      class={`c-switch${checked ? ' is-on' : ''}`}
      title={hint}
      onClick={() => onChange(!checked)}
    >
      <span class="c-switch-label">{label}</span>
      <span class="c-switch-track" aria-hidden="true">
        <i />
      </span>
    </button>
  );
}