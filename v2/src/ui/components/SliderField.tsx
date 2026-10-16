import { NumField } from './NumField';

/**
 * SliderField — 有界参数（输入契约第 1 类）
 * 形态：`标签 · − [数值框] 单位 +`（步进按钮 + 可键盘输入 + 长按连发）。
 * 取值路径与格式化仍单点收口在 NumField（clamp / toFixed(precision) / Shift 精调 / Enter 提交）。
 * `withSlider` 可额外显示滑杆（用于需要「粗调 + 连续拖动」的探索场景，默认关闭）。
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
  /** 额外显示滑杆（默认否：步进 + 输入框已覆盖精细调节） */
  withSlider?: boolean;
}

export function SliderField(props: SliderFieldProps) {
  const { label, value, onChange, min, max, step = 0.01, precision = 2, unit, hint, disabled, withSlider = false } = props;
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
      {withSlider ? (
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
      ) : null}
    </div>
  );
}