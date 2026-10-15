/**
 * components/index.ts — 控件库统一出口
 * 契约（规划书 §8.5.1）：所有工具页只允许从本出口引入输入/显示组件；
 * 组件只引用 tokens.css 令牌，类名前缀 c-。
 */

export { NumField } from './NumField';
export type { NumFieldProps } from './NumField';

export { SliderField } from './SliderField';
export type { SliderFieldProps } from './SliderField';

export { ExprField } from './ExprField';
export type { ExprFieldProps } from './ExprField';

export { SegmentedChips } from './SegmentedChips';
export type { ChipOption, SegmentedChipsProps } from './SegmentedChips';

export { Switch } from './Switch';
export type { SwitchProps } from './Switch';

export { FieldGroup } from './FieldGroup';
export type { FieldGroupProps } from './FieldGroup';

export { Metric } from './Metric';
export type { MetricProps } from './Metric';

export { StatusBadge } from './StatusBadge';
export type { StatusBadgeProps, StatusKind } from './StatusBadge';

export { StatePanel } from './StatePanel';
export type { StatePanelProps, StateAction } from './StatePanel';