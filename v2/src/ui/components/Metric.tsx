/**
 * Metric — 指标读数（显示契约第 1 类）
 * 统一形态：标签 + 等宽数字（tabular-nums）+ 单位不换行；悬停显示定义（对接符号登记表）。
 * 缺失值一律显示 "—"，不显示 0。
 */

export interface MetricProps {
  label: string;
  value: string | number;
  unit?: string;
  precision?: number;
  hint?: string;
  tone?: 'default' | 'ok' | 'warn' | 'danger';
}

export function Metric(props: MetricProps) {
  const { label, value, unit, precision = 3, hint, tone = 'default' } = props;
  const text = typeof value === 'number' ? (Number.isFinite(value) ? value.toFixed(precision) : '—') : value;
  return (
    <div class={`c-metric${tone !== 'default' ? ` tone-${tone}` : ''}`} title={hint}>
      <span class="c-metric-label">{label}</span>
      <span class="c-metric-value">
        {text}
        {unit ? <span class="c-metric-unit">{unit}</span> : null}
      </span>
    </div>
  );
}