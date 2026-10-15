/**
 * core/index.ts — 数值内核统一出口（Batch A：纯函数层）
 * 契约：Batch A/B/C 的内核模块一律从这里导出；UI 层只允许 import '../core'。
 * 迁移红线：系数自高到低、复数 {re,im}、{ok,...} 返回结构不得更改（回归网保障）。
 */

export * from './tol';
export * from './math';
export * from './complex';
export * from './poly';
export * from './expr';
export * from './utf8';
export * from './dsp';
export * from './statespace';
export * from './margins';
export * from './signals';
export * from './parse';
export * from './transforms';
export * from './blocksolve';
export * from './odesolve';
export * from './filterdesign';
export * from './controldesign';
export * from './randomsig';
export * from './comm';
export * from './experiment';
export * from './pkg';
export * from './voice';