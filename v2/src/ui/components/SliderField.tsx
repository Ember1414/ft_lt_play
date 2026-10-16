import { NumField } from './NumField';

/**
 * SliderField — 有界参数（输入契约第 1 类）
 * 形态：`标签 · − [数值框] 单位 +` **＋ 拖动条**：
 * - 拖动条负责「粗调/连续扫」（用户反馈：拖动条不能取消）；
 * - −/+ 与数值框负责「定值/微调」（长按连发、Shift 精调 0.1×、Enter 提交、Esc 还原）。
 * 取值路径与格式化仍单点收口在 NumField（clamp / toFixed(precision)）。
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
  /** 是否显示拖动条（默认显示；个别紧凑场景可关掉只留 −/数值框/+） */
  withSlider?: boolean;
}

export function SliderField(props: SliderFieldProps) {
  const { label, value, onChange, min, max, step = 0.01, precision = 2, unit, hint, disabled, withSlider = true } = props;
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