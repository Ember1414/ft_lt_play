/**
 * api.ts — 工具 ↔ 工作区骨架的契约（FR-09）
 * 每个工具向 Workspace 注册一个 ToolApi：撤销/重做、结果条指标、导出动作。
 * 骨架只读这些接口渲染顶栏与结果条，工具内部布局完全自由。
 */

export interface MetricItem {
  label: string;
  value: number | string;
  unit?: string;
  precision?: number;
  tone?: 'default' | 'ok' | 'warn' | 'danger';
  hint?: string;
}

export interface ExportAction {
  id: string;
  label: string;
  disabled?: boolean;
  /** 禁用原因（必须给出，遵循「禁用项给出原因而非静默灰掉」） */
  reason?: string;
  run?: () => void;
}

export interface ToolApi {
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  metrics(): MetricItem[];
  exports(): ExportAction[];
  /** 结果条/顶栏标题需要展示的副标题（如"二阶系统 · K=3.2"） */
  subtitle?(): string;
}

export interface ToolViewProps {
  /** 注册（null = 卸载） */
  api: (a: ToolApi | null) => void;
  /** 工具内部状态变化后调用：刷新骨架的撤销按钮与结果条 */
  onChange: () => void;
  leftOpen: boolean;
  rightOpen: boolean;
  focus: boolean;
}