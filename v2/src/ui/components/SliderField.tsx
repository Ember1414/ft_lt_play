import { NumField } from './NumField';

/**
 * SliderField — 有界连续参数（输入契约第 1 类的完整三态绑定）
 * 文本框 ↔ 滑杆 ↔ 拖拽标签 同一取值路径、同一格式化、同一校验。
 */

export interface SliderFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  precision?: number;
  unit?: string;
  hint?: string;
  disabled?: boolean;
}

export function SliderField(props: SliderFieldProps) {
  const { label, value, onChange, min, max, step = 0.01, precision = 2, unit, hint, disabled } = props;
  return (
    <div class={`c-slider${disabled ? ' is-disabled' : ''}`}>
      <div class="c-slider-head">
        <span class="c-slider-label" title={hint}>
          {label}
        </span>
        <NumField
          value={value}
          onChange={onChange}
          min={min}
          max={max}
          step={step}
          precision={precision}
          unit={unit}
          disabled={disabled}
          width={72}
          ariaLabel={label}
        />
      </div>
      <input
        class="c-slider-track"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onInput={(e) => onChange(Number((e.currentTarget as HTMLInputElement).value))}
      />
    </div>
  );
}