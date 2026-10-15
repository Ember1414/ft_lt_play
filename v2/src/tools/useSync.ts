/**
 * useSync.ts — 工具 ↔ 实验状态同步（所有工具复用）
 * 职责：
 *   1) 当“当前实验”发生切换（首页继续 / 实验管理打开 / 分享码导入 / 新建模板）时，
 *      重新从 moduleStates 读取本工具参数；订阅 state/experiments 的变更通知。
 *   2) 订阅「实时参数覆盖」通道（state/live）：剧场参数插值时按帧就地 apply，**不重挂视图**（M5）。
 *
 * 用法：useExperimentSync(toolId, load, apply)
 */

import { useContext, useEffect, useRef } from 'preact/hooks';
import { getCurrent, subscribe } from '../state/experiments';
import { subscribeLiveOverride } from '../state/live';
import { ToolGroupContext } from './group';

/**
 * @param toolId  本工具的模块 id（与 setModuleState 的 id 一致）
 * @param load    读取当前实验下本工具参数（含默认值回退）
 * @param apply   写回工具状态（通常是 setParams + 清撤销栈）
 */
export function useExperimentSync<T>(toolId: string, load: () => T, apply: (v: T) => void): void {
  const group = useContext(ToolGroupContext);
  const expIdRef = useRef<string | null>(getCurrent()?.id ?? null);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(
    () => {
      // 对比页实例（group ≠ ''）不参与实验切换同步，避免被工作区实验状态顶掉
      if (group !== '') return;
      return subscribe(() => {
        const id = getCurrent()?.id ?? null;
        if (id === expIdRef.current) return;
        expIdRef.current = id;
        applyRef.current(load());
      });
    },
    // load/apply 每次渲染新引用；同步只依赖实验切换，故有意只订阅一次
    // eslint 无；依赖收窄为「挂载一次」+ 分组
    [group],
  );
  // 实时参数覆盖：仅当「组 + toolId」都匹配时就地应用（M5 剧场插值 / M7 对比页双跑）
  useEffect(
    () =>
      subscribeLiveOverride((o) => {
        if (o.group !== group || o.toolId !== toolId) return;
        applyRef.current(o.params as T);
      }),
    [group, toolId],
  );
}
