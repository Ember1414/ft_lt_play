import { StatusBadge, type StatusKind } from './StatusBadge';

/**
 * ExprField — 表达式输入（输入契约第 2 类的「统一外壳」）
 * 统一形态：等宽字体输入 + 三态徽标（ok / warn / err）+ 提示语。
 * 解析与纠错内核（归一化 / 白名单 / 纠错词典）在 M1 由 MI 迁移接入；
 * 组件契约在此先行冻结：状态与文案一律由外部解析结果驱动，组件自身不做语法判断。
 */

export interface ExprFieldProps {
  value: string;
  onChange: (v: string) => void;
  status?: StatusKind | 'idle';
  message?: string;
  label?: string;
  placeholder?: string;
  hint?: string;
}

export function ExprField(props: ExprFieldProps) {
  const { value, onChange, status = 'idle', message, label, placeholder, hint } = props;
  return (
    <div class="c-expr">
      {label ? <span class="c-expr-label">{label}</span> : null}
      <input
        class={`c-expr-input${status === 'err' ? ' is-invalid' : ''}`}
        value={value}
        placeholder={placeholder}
        spellcheck={false}
        autocomplete="off"
        aria-label={label}
        aria-invalid={status === 'err'}
        onInput={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
      />
      {status !== 'idle' && message ? <StatusBadge kind={status}>{message}</StatusBadge> : null}
      {hint ? <span class="c-expr-hint">{hint}</span> : null}
    </div>
  );
}