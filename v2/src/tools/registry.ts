/**
 * registry.ts — 工具注册表（FR-18 工具矩阵 13 个）
 * 全站唯一的工具元数据来源：侧栏导航、命令面板、首页模板卡、路由校验一律引用本表。
 * status: ready = 可用；wip = 建设中（工作区显示空态引导，不给出错误）。
 */

export type ToolGroup = 'transform' | 'analysis' | 'design' | 'sim' | 'data' | 'ref';

export interface ToolMeta {
  id: string;
  name: string;
  group: ToolGroup;
  /** 单色几何字形（与设计语言一致，不使用 emoji） */
  glyph: string;
  /** 一句话说明（命令面板 / 卡片副标题共用） */
  blurb: string;
  status: 'ready' | 'wip';
  /** v1 对应模块（迁移出处，便于溯源） */
  legacy?: string;
  isNew?: boolean;
}

export const GROUP_NAMES: Record<ToolGroup, string> = {
  transform: '信号与变换',
  analysis: '系统与分析',
  design: '设计与综合',
  sim: '仿真与求解',
  data: '数据与实验',
  ref: '参考与推导',
};

export const GROUP_ORDER: ToolGroup[] = ['transform', 'analysis', 'design', 'sim', 'data', 'ref'];

export const TOOLS: ToolMeta[] = [
  { id: 'ft', name: '傅立叶级数', group: 'transform', glyph: '◠', blurb: '画圈动画 · 手绘波形 · 谐波叠加', status: 'ready', legacy: 'fs' },
  { id: 'fourier', name: '傅立叶变换', group: 'transform', glyph: '∿', blurb: '时频联动 · 卷积定理 · 采样重建', status: 'ready', legacy: 'ft' },
  { id: 'laplace', name: '拉普拉斯变换', group: 'transform', glyph: 'ℒ', blurb: 's 平面 · ROC · 反变换 · 性质验证', status: 'ready', legacy: 'la' },
  { id: 'z', name: 'Z 变换', group: 'transform', glyph: '𝒵', blurb: '单位圆 · Jury 判据 · 频响 · s↔z 映射', status: 'ready', legacy: 'zt' },
  { id: 'sys', name: '系统分析', group: 'analysis', glyph: '⌁', blurb: '波特 · 奈奎斯特 · 根轨迹 · 稳定性指标', status: 'ready', legacy: 'sys' },
  { id: 'pid', name: 'PID 整定', group: 'analysis', glyph: '⌇', blurb: '环路仿真 · ZN/CC/CHR · 寻优 · 抗饱和', status: 'ready', legacy: 'pid' },
  { id: 'filter', name: '滤波器设计器', group: 'design', glyph: '⧩', blurb: 'IIR（Butterworth/Chebyshev）· FIR 窗函数法 · 量化对比', status: 'ready', isNew: true },
  { id: 'control', name: '控制系统设计器', group: 'design', glyph: '⊹', blurb: '超前/滞后校正 · 极点配置 · 灵敏度校核', status: 'ready', isNew: true },
  { id: 'block', name: '系统框图', group: 'sim', glyph: '▭', blurb: '框图编辑 · 传函求解 · 采样系统 z 域分析', status: 'ready', legacy: 'blk' },
  { id: 'solve', name: '交互求解', group: 'sim', glyph: '≟', blurb: '表达式 · 微分/差分方程 · 数据与滤波 · 符号变换', status: 'ready', legacy: 'explore' },
  { id: 'random', name: '随机信号实验室', group: 'data', glyph: '⁘', blurb: '噪声 · 功率谱密度 · 自/互相关 · 滤波对比', status: 'ready', isNew: true },
  { id: 'comm', name: '调制与通信实验室', group: 'data', glyph: '≋', blurb: 'AM/DSB/FM · 频谱搬移 · 采样定理 · 眼图雏形', status: 'ready', isNew: true },
  { id: 'derive', name: '公式推导', group: 'ref', glyph: '⊢', blurb: '性质表 · 逐步推导 · 自定义推导', status: 'ready', legacy: 'derive' },
];

export function toolById(id: string): ToolMeta | undefined {
  return TOOLS.find((t) => t.id === id);
}

export function toolsOf(group: ToolGroup): ToolMeta[] {
  return TOOLS.filter((t) => t.group === group);
}