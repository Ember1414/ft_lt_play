/**
 * SegmentedChips — 枚举 / 模式选择（输入契约第 6 类）
 * 统一形态：分段芯片；不以原生 select 作为主形态。
 * 键盘：← → ↑ ↓ 在选项间移动并直接选中（roving tabindex）。
 */

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SegmentedChipsProps<T extends string> {
  options: ReadonlyArray<ChipOption<T>>;
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}

export function SegmentedChips<T extends string>(props: SegmentedChipsProps<T>) {
  const { options, value, onChange, ariaLabel } = props;
  const idx = options.findIndex((o) => o.value === value);

  const move = (dir: number) => {
    const n = options.length;
    if (n === 0) return;
    let i = idx;
    for (let k = 0; k < n; k++) {
      i = (i + dir + n) % n;
      const opt = options[i];
      if (opt && !opt.disabled) {
        onChange(opt.value);
        return;
      }
    }
  };

  return (
    <div class="c-chips" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          class={`c-chip${o.value === value ? ' is-on' : ''}`}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
              e.preventDefault();
              move(1);
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
              e.preventDefault();
              move(-1);
            }
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}