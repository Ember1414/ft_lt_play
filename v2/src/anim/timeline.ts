/**
 * timeline.ts — 自研时间轴引擎（规划书 §4.16 / §8.10）
 * 确定性帧驱动（tick(dt) 纯推进，可回放、可逐帧）：
 * - play / pause / seek / speed(0.25×–2×) / loop；
 * - 帧回调 onFrame(t, progress)，由调用方负责绘制；
 * - 不依赖 rAF 时间戳做时间基准（用 performance.now 差值累计），同一 dt 序列结果可复现。
 */

import { easeInOutCubic, type Easing } from './easing';

export interface TimelineState {
  time: number;
  duration: number;
  playing: boolean;
  speed: number;
  loop: boolean;
}

export interface TimelineOptions {
  duration: number;
  loop?: boolean;
  speed?: number;
  onFrame: (t: number, progress: number) => void;
  onState?: (s: TimelineState) => void;
  /** 收尾缓动（进度接近 1 时的平滑，默认 easeInOutCubic；剧场内分幕自行缓动时可设 linear） */
  easing?: Easing;
}

export interface Timeline {
  play(): void;
  pause(): void;
  toggle(): void;
  seek(t: number): void;
  setSpeed(v: number): void;
  setLoop(v: boolean): void;
  time(): number;
  state(): TimelineState;
  /** 手动推进（逐帧按钮 / 单测）：与 rAF 循环共用同一路径 */
  tick(dt: number): void;
  destroy(): void;
}

export function createTimeline(opts: TimelineOptions): Timeline {
  const easing = opts.easing ?? easeInOutCubic;
  let time = 0;
  let playing = false;
  let speed = opts.speed ?? 1;
  let loop = !!opts.loop;
  let raf: number | null = null;
  let last = 0;
  let destroyed = false;

  const state = (): TimelineState => ({ time, duration: opts.duration, playing, speed, loop });

  const emitState = (): void => {
    opts.onState?.(state());
  };

  const emitFrame = (): void => {
    const raw = opts.duration > 0 ? Math.min(1, time / opts.duration) : 1;
    opts.onFrame(time, easing(raw));
  };

  const loopFn = (now: number): void => {
    if (!playing || destroyed) return;
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    tick(dt);
    if (playing) raf = requestAnimationFrame(loopFn);
  };

  function tick(dt: number): void {
    time += dt * speed;
    if (time >= opts.duration) {
      if (loop) {
        time = time % Math.max(opts.duration, 1e-9);
      } else {
        time = opts.duration;
        playing = false;
        emitFrame();
        // 定格一帧后停
        if (raf != null) {
          cancelAnimationFrame(raf);
          raf = null;
        }
        emitState();
        return;
      }
    }
    emitFrame();
  }

  function play(): void {
    if (destroyed || playing) return;
    if (time >= opts.duration && !loop) time = 0; // 结束后再播 → 从头
    playing = true;
    last = 0;
    emitState();
    raf = requestAnimationFrame(loopFn);
  }

  function pause(): void {
    playing = false;
    if (raf != null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
    emitState();
  }

  return {
    play,
    pause,
    toggle(): void {
      if (playing) pause();
      else play();
    },
    seek(t: number): void {
      time = Math.max(0, Math.min(opts.duration, t));
      emitFrame();
      emitState();
    },
    setSpeed(v: number): void {
      speed = Math.max(0.25, Math.min(2, v));
      emitState();
    },
    setLoop(v: boolean): void {
      loop = v;
      emitState();
    },
    time: () => time,
    state,
    tick,
    destroy(): void {
      destroyed = true;
      playing = false;
      if (raf != null) cancelAnimationFrame(raf);
      raf = null;
    },
  };
}