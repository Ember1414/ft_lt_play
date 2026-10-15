/**
 * tol.ts — 具名数值容差 / 兜底常量（M4 存量重修：#8 魔法容差具名化 + #7 静默兜底具名化）
 *
 * 背景：v1 内核中散落大量「魔法数字」（1e-9 / 1e-11 / 1e-12 / 1e-18 / 1e-30 / 1e-300 …），
 * 无法分辨是容差、物理常数还是算法尺度。本模块把它们收敛为**按用途命名**的常量。
 *
 * 红线：**数值一字不改**。这些常量只是把既有字面量搬到命名处，算法与控制流不变，
 * 因此对拍网（`v2/scripts/parity.mjs`）结果必须保持 77/77 组一致 + 37/37 闭式真值通过。
 *
 * 命名约定：
 *   TOL_*    —— 判定阈值（判零 / 收敛 / 相对误差 / 分组）
 *   FLOOR_*  —— 防 0 除 / 防 log(0) 的兜底下限（v1 的静默兜底，见 #7）
 */

/* ---------- 判零 / 退化阈值 ---------- */

/** 通用「判零 / 系数退化」阈值（v1：dsp/transforms/blocksolve/margins/statespace 各处 1e-12） */
export const TOL_ZERO = 1e-12;

/** dB 下限：线性值 → dB 时防 −∞（v1 util.toDb 的 1e-12） */
export const DB_FLOOR = 1e-12;

/** 极点位置分类阈值：虚轴 / 稳定边界判定与公式项归零（v1 各处 1e-9） */
export const TOL_AXIS = 1e-9;

/** 迭代收敛阈值（v1 dsp.polyRoots 的 1e-11；blocksolve 极小量归零同值） */
export const TOL_ITER = 1e-11;

/** 近重根保护：根校正量的绝对下限（v1 dsp.polyRoots 的 1e-18） */
export const TOL_SNAP = 1e-18;

/** 紧相对容差：实根判定 / 极小量截断（v1 dsp/blocksolve 的 1e-7） */
export const TOL_TIGHT = 1e-7;

/** 相对容差：鲁棒性判定 / 共轭配对（v1 各处 1e-6） */
export const TOL_REL = 1e-6;

/** 数值自检通过上限（v1 dsp 裕度自检的 1e-5） */
export const TOL_CHECK = 1e-5;

/** 消去 / 归零判定（v1 blocksolve 的 1e-4） */
export const TOL_SWEEP = 1e-4;

/** 极点分组 / 聚类容差（v1 transforms.partialFracGroups 的 1e-3） */
export const TOL_GROUP = 1e-3;

/** 数值循环收敛判定（v1 dsp pidOptimize 的 1e-3） */
export const TOL_CONV = 1e-3;

/** 公式显示量归零阈值（v1 transforms 的 5e-4） */
export const TOL_TEX = 5e-4;

/* ---------- 静默兜底下限（#7） ---------- */

/**
 * 复数除法分母下限（v1 dsp.cdiv 的 `|| 1e-30`）。
 * 分母模平方为 0 时用它兜底，避免 0/0 → NaN；数值行为与原版一致。
 */
export const DIV_FLOOR = 1e-30;

/**
 * 极小下限（v1 transforms.cDiv2 的 `|| 1e-300`，及各处防 log(0) 的兜底）。
 * 与 DIV_FLOOR 不同量级：cDiv2 保留 v1 语义，未并入 complex.ts。
 */
export const MIN_FLOOR = 1e-300;
