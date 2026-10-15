/**
 * live.ts — 工具「实时参数覆盖」通道（M5：剧场参数插值）
 *
 * 背景：工具只在**挂载时**从 moduleStates 读取参数（`useExperimentSync` 仅在实验切换时重载），
 * 因此剧场逐步切换参数若靠「重挂视图」会每帧重启动画。这里提供一条**只读覆盖通道**：
 * 剧场按帧发布中间参数，已挂载的对应工具就地 apply（不重挂）→ 参数平滑过渡。
 *
 * 契约：发布方（剧场）只负责发布；订阅方（各工具）只在自己的 toolId 匹配时应用。
 * 通道不参与实验存储：最终状态仍由剧场以 setModuleState 正式落库。
 */

export interface LiveOverride {
  /** 目标实例分组（'' = 工作区实例；对比页实例用独立组名） */
  group: string;
  toolId: string;
  params: unknown;
  /** 自增版本号：订阅方据此判断是否为新的覆盖 */
  rev: number;
}

let current: LiveOverride | null = null;
const listeners = new Set<(o: LiveOverride) => void>();

/** 发布一次参数覆盖（剧场 / 对比页调用）；订阅方按「组 + toolId」精确投递 */
export function publishLiveOverride(group: string, toolId: string, params: unknown): void {
  current = { group, toolId, params, rev: (current?.rev ?? 0) + 1 };
  for (const fn of listeners) fn(current);
}

/** 清空覆盖（剧场停止 / 退出时调用）；已挂载工具保留当前参数 */
export function clearLiveOverride(): void {
  current = null;
}

export function getLiveOverride(): LiveOverride | null {
  return current;
}

export function subscribeLiveOverride(fn: (o: LiveOverride) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
