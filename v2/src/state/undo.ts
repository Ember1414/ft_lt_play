/**
 * undo.ts — 通用撤销栈（FR-09 全局撤销：模块输入级 ≥30 步）
 * 与实验级快照（core/experiment）分层：本栈负责"输入级"高频撤销，快照负责"里程碑"。
 */

export interface UndoStack<T> {
  /** 记录一次变更前的状态；清空 redo 分支 */
  push(before: T): void;
  /** 撤销：返回上一状态（并把 current 放入 redo） */
  undo(current: T): T | null;
  /** 重做：返回下一状态（并把 current 放回 past） */
  redo(current: T): T | null;
  canUndo(): boolean;
  canRedo(): boolean;
  /** 已记录的历史步数 */
  size(): number;
  clear(): void;
}

export function createUndoStack<T>(limit = 30): UndoStack<T> {
  const past: T[] = [];
  const future: T[] = [];
  return {
    push(before: T): void {
      past.push(before);
      if (past.length > limit) past.shift();
      future.length = 0;
    },
    undo(cur: T): T | null {
      const prev = past.pop();
      if (prev === undefined) return null;
      future.push(cur);
      return prev;
    },
    redo(cur: T): T | null {
      const next = future.pop();
      if (next === undefined) return null;
      past.push(cur);
      return next;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    size: () => past.length,
    clear(): void {
      past.length = 0;
      future.length = 0;
    },
  };
}