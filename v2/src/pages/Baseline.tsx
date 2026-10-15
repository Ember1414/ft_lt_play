import { GROUP_NAMES, SYMBOLS } from '../symbols/registry';

/**
 * Baseline — 基线页：设计令牌 + 符号登记表（M0 验收物）
 * 令牌色板随主题即时切换；符号表为全站唯一符号来源的可视化核对入口。
 */

const SWATCHES: ReadonlyArray<readonly [string, string]> = [
  ['paper 背景', 'var(--paper)'],
  ['panel 面板', 'var(--panel)'],
  ['accent 主色', 'var(--accent)'],
  ['accent-2 辅助', 'var(--accent-2)'],
  ['violet 对比组', 'var(--violet)'],
  ['warn 注意', 'var(--warn)'],
  ['danger 错误', 'var(--danger)'],
  ['ink 文字', 'var(--ink)'],
];

export function Baseline() {
  const groupCount = Object.keys(GROUP_NAMES).length;

  return (
    <div class="stack">
      <section class="hero">
        <h1>M0 · 架构与设计基线</h1>
        <p>
          Vite + TypeScript + Preact 骨架已就位；本页核对两项已落地的基线资产：
          <strong>设计令牌</strong>（规划书 §8.3，双主题「精密仪器」）与
          <strong>符号登记表</strong>（§8.11，全站唯一符号来源）。主题默认跟随系统。
        </p>
      </section>

      <section class="section">
        <h2>设计令牌（随主题即时切换）</h2>
        <div class="swatches">
          {SWATCHES.map(([name, color]) => (
            <div class="swatch" key={name}>
              <i style={{ background: color }} />
              <span>{name}</span>
            </div>
          ))}
        </div>
      </section>

      <section class="section">
        <h2>
          符号登记表（共 {SYMBOLS.length} 条 · {groupCount} 个分组）
        </h2>
        <table class="tbl">
          <thead>
            <tr>
              <th style={{ width: '110px' }}>呈现</th>
              <th style={{ width: '90px' }}>标识</th>
              <th style={{ width: '120px' }}>分组</th>
              <th style={{ width: '80px' }}>单位</th>
              <th>说明</th>
              <th style={{ width: '170px' }}>禁用别名</th>
            </tr>
          </thead>
          <tbody>
            {SYMBOLS.map((s) => (
              <tr key={s.id}>
                <td>
                  <span class="sym">{s.display}</span>
                </td>
                <td class="mono">{s.id}</td>
                <td>{GROUP_NAMES[s.group]}</td>
                <td class="mono">{s.unit ?? '—'}</td>
                <td>{s.note ?? '—'}</td>
                <td class="mono">{s.forbidden?.join('、') ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="muted">
          登记项 = 界面呈现 + KaTeX 源码 + 单位 + 用法说明 + 禁用别名（构建期 lint 扫描）。
          本表在 M0 定稿后冻结，组件、绘图、文案一律引用。
        </p>
      </section>
    </div>
  );
}