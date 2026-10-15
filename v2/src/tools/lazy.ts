import type { ComponentType } from 'preact';
import type { ToolViewProps } from './api';

/**
 * lazy.ts — 工具视图按需加载（M3 代码分割，FR-09/§12.5）
 * 每个工具一个独立的动态 import 分片：首屏只加载外壳与命令中心，进入工具时才拉取该工具代码。
 * 已解析的组件进程内缓存；未知工具返回 null（工作区走"不可用"空态）。
 */

type ToolView = ComponentType<ToolViewProps>;

const LOADERS: Record<string, () => Promise<ToolView>> = {
  sys: () => import('./sys').then((m) => m.SysTool),
  pid: () => import('./pid').then((m) => m.PidTool),
  z: () => import('./z').then((m) => m.ZTool),
  laplace: () => import('./laplace').then((m) => m.LaplaceTool),
  fourier: () => import('./fourier').then((m) => m.FourierTool),
  ft: () => import('./ft').then((m) => m.FtTool),
  block: () => import('./block').then((m) => m.BlockTool),
  solve: () => import('./solve').then((m) => m.SolveTool),
  derive: () => import('./derive').then((m) => m.DeriveTool),
  filter: () => import('./filter').then((m) => m.FilterTool),
  control: () => import('./control').then((m) => m.ControlTool),
  random: () => import('./random').then((m) => m.RandomTool),
  comm: () => import('./comm').then((m) => m.CommTool),
};

const cache = new Map<string, ToolView>();

export function hasToolView(id: string): boolean {
  return id in LOADERS;
}

/** 加载工具视图；未知工具返回 null；同一工具重复调用共享同一 Promise 结果 */
export function loadToolView(id: string): Promise<ToolView> | null {
  const hit = cache.get(id);
  if (hit) return Promise.resolve(hit);
  const loader = LOADERS[id];
  if (!loader) return null;
  return loader().then((C) => {
    cache.set(id, C);
    return C;
  });
}
