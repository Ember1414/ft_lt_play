/**
 * group.ts — 工具实例分组作用域（M7：对比页并行双跑）
 *
 * 背景：对比页要在**同一渲染中并行运行同一工具的两套参数**，因此需要同时挂载该工具的两个实例。
 * 但两者 toolId 相同——「实验切换同步」与「实时参数覆盖」都会互相串扰，且工具自身的自动保存
 * 会污染用户的当前实验。
 *
 * 方案：用 Preact context 给工具实例打**分组标记**（`''` = 工作区常规实例；其它 = 对比页实例）：
 *  - `useExperimentSync` 只对 `''` 组参与实验切换同步；实时覆盖按「组 + toolId」精确投递；
 *  - `chart/Chart` 依分组登记主序列，供对比页按组取回两条真实曲线；
 *  - 对比页挂载实例期间用 `state/experiments.setSuppressSave(true)` 抑制写盘。
 */
import { createContext } from 'preact';

/** 工具实例分组：''（默认）= 工作区实例 */
export const ToolGroupContext = createContext<string>('');
