/**
 * params.ts — 参数表规则（M12 / M13）：把「哪些参数可调 / 用哪种控件 / 数值步长」抽成**纯函数**，
 * 供对比页（`pages/Compare.tsx` 的可调参数表）与 UI 数据层断言（`scripts/uidata.mjs`）共用。
 *
 * 契约：
 * - 只有**标量**参数（number / boolean / string）进表；对象与数组（自定义条目、模型库等）留在工具页内编辑；
 * - number 需为有限数（NaN / ±Infinity 视为不可调）；
 * - 控件由 `paramKind` 分派：number → NumField、boolean → Switch、string（含枚举与表达式）→ 文本输入。
 */

export type ParamKind = 'number' | 'boolean' | 'string' | 'none';

/** 单值的控件类型判定 */
export function paramKind(v: unknown): ParamKind {
  if (typeof v === 'number') return Number.isFinite(v) ? 'number' : 'none';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'string') return 'string';
  return 'none';
}

/** 可调键并集（跨对象去重 + 字典序排序）；两侧参数形态不同也各自按自身类型渲染控件 */
export function scalarKeys(objs: ReadonlyArray<Record<string, unknown> | null | undefined>): string[] {
  const ks = new Set<string>();
  for (const o of objs) {
    if (!o) continue;
    for (const [k, v] of Object.entries(o)) if (paramKind(v) !== 'none') ks.add(k);
  }
  return [...ks].sort();
}

/** 数值输入的步长与小数位：按量级自适应（与工具页 NumField 的观感一致） */
export function stepForValue(v: number): { step: number; precision: number } {
  const m = Math.abs(v);
  if (m >= 100) return { step: 1, precision: 1 };
  if (m >= 10) return { step: 0.1, precision: 2 };
  if (m >= 1) return { step: 0.01, precision: 3 };
  if (m >= 0.1) return { step: 0.001, precision: 4 };
  return { step: 0.0001, precision: 5 };
}
