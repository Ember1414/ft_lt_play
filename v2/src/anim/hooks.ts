/**
 * hooks.ts — 动画 Hooks（数据动效层，§8.6：180–360ms 插值、可打断）
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { easeOutCubic, spring, type Easing } from './easing';

/**
 * 数值插值：target 变化时以 ms 毫秒缓动逼近（可打断，取当前值续接）。
 * 用于参数联动、指标跳字等"数据动效"。
 */
export function useAnimatedNumber(target: number, ms = 260, easing: Easing = easeOutCubic): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const startRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = value;
    fromRef.current = from;
    if (from === target) return;
    startRef.current = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - startRef.current) / ms);
      const v = from + (target - from) * easing(t);
      setValue(t >= 1 ? target : v);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // 仅跟随 target 变化；value 作为续接起点读取（有意不列入依赖）
  }, [target, ms]);

  return value;
}

/**
 * 弹簧插值：用于"即时慢镜头"式联动（极点拖动 → 响应曲线）。
 */
export function useSpringNumber(target: number, ms = 420): number {
  return useAnimatedNumber(target, ms, spring);
}

/** 布尔淡入淡出（聚光/高亮） */
export function useFade(active: boolean, ms = 200): number {
  return useAnimatedNumber(active ? 1 : 0, ms);
}