import { useEffect, useState } from 'preact/hooks';
import { GROUP_NAMES, TOOLS, toolById } from '../tools/registry';
import { navigate } from '../router';
import {
  getCurrent,
  listExperiments,
  newExperiment,
  openExperiment,
  storageAvailable,
  subscribe,
} from '../state/experiments';
import { StatePanel, Metric } from '../ui/components';
import { TeX } from '../ui/TeX';

/**
 * Home — 命令中心（FR-02）
 * 继续实验 / 快速开始（模板）/ 学习路径入口（M3）/ 最近与分享。
 * 规则：5 秒内可进入任意一种模式；存储不可用时顶部提示但不阻塞。
 */

interface TemplateDef {
  id: string;
  name: string;
  toolId: string;
  blurb: string;
  state: Record<string, unknown>;
  disabled?: boolean;
  reason?: string;
}

/** 内置快速开始模板：state 为对应工具的模块参数（由各工具 sanitize 校验，字段名见各工具 Params） */
const TEMPLATES: TemplateDef[] = [
  { id: 'tpl-2nd', name: '二阶系统 · 阶跃响应', toolId: 'sys', blurb: 'ωn=3.16, ζ=0.32 的欠阻尼响应与指标', state: { expr: '10/(s^2+2s+10)', K: 1, view: 'step' } },
  { id: 'tpl-margin', name: '相位裕度扫描', toolId: 'sys', blurb: 'K 滑杆与 PM/GM 实时读数（L = K/(s+1)³）', state: { expr: '1/(s^3+3s^2+3s+1)', K: 2, view: 'bode' } },
  { id: 'tpl-ss', name: '状态空间 · 极点配置', toolId: 'control', blurb: '可控标准型 + Ackermann 极点配置', state: { view: 'place' } },
  { id: 'tpl-zn', name: 'ZN 临界比例度', toolId: 'pid', blurb: 'L=1/(s+1)³（Ku=8）→ 一键试算 PID 增益', state: { expr: '1/(s^3+3s^2+3s+1)' } },
  { id: 'tpl-aw', name: 'PID 抗饱和对比', toolId: 'pid', blurb: '执行器限幅 + back-calculation 前后对比', state: { aw: 'back', uOn: true, uMax: 5 } },
  { id: 'tpl-reso', name: '极点逼近单位圆', toolId: 'z', blurb: 'ρ=0.95 的极点与 |X(e^jω)| 峰值 · 稳定裕度', state: { expr: '0.95^n*u[n]', view: 'freq' } },
  { id: 'tpl-jury', name: 'Jury 稳定性扫描', toolId: 'z', blurb: '特征表逐行判据与 ρmax 裕度', state: { view: 'jury' } },
  { id: 'tpl-sampled', name: '采样回路（框图）', toolId: 'block', blurb: '误差点采样 + ZOH 的 z 域归约与闭环极点', state: {
    nodes: [
      { id: 1, kind: 'sum', x: 180, y: 250, src: true },
      { id: 2, kind: 'sample', x: 360, y: 250, dom: 'z' },
      { id: 3, kind: 'zoh', x: 480, y: 250, dom: 'z' },
      { id: 4, kind: 'box', x: 640, y: 250, expr: '2/(s+1)', dom: 's', out: true },
    ],
    edges: [
      { from: 1, to: 2, sign: 1 },
      { from: 2, to: 3, sign: 1 },
      { from: 3, to: 4, sign: 1 },
      { from: 4, to: 1, sign: -1 },
    ],
    seq: 4,
  } },
  { id: 'tpl-butter', name: 'Butterworth 低通（滤波器）', toolId: 'filter', blurb: '按规格自动定阶 · 幅频/群时延 · 量化对比', state: { kind: 'iir', family: 'butter', band: 'lp', view: 'mag' } },
  { id: 'tpl-lead', name: '超前校正（控制系统）', toolId: 'control', blurb: '目标 PM 50° · 校正前后波特对比', state: { view: 'lead', plant: '1/(s*(s+1))' } },
  { id: 'tpl-psd', name: '噪声 PSD 与自相关', toolId: 'random', blurb: '周期图 vs Welch · 白噪声自相关 δ', state: { view: 'psd' } },
  { id: 'tpl-am', name: 'AM 调幅与边带', toolId: 'comm', blurb: '载波 + 双边带谱 · 包络检波条件', state: { view: 'am' } },
];

const PATHS: ReadonlyArray<{ id: string; name: string; steps: number; blurb: string }> = [
  { id: 'p-signal', name: '信号与系统入门', steps: 10, blurb: '变换 → 频响 → 稳定性 → 采样（复习向）' },
  { id: 'p-control', name: '控制系统入门', steps: 10, blurb: '二阶 → 裕度 → 校正 → 极点配置 → 验证' },
  { id: 'p-engineer', name: '工程师速查', steps: 6, blurb: '建模 → 裕度 → 设计 → 验证 → 导出' },
];

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface HomeProps {
  onToast: (msg: string) => void;
}

export function Home(props: HomeProps) {
  const { onToast } = props;
  const [, bump] = useState(0);
  useEffect(() => subscribe(() => bump((x) => x + 1)), []);

  const current = getCurrent();
  const recent = listExperiments().slice(0, 6).filter((m) => !current || m.id !== current.id);

  const startTemplate = (t: TemplateDef): void => {
    if (t.disabled) {
      onToast(t.reason || '该模板暂不可用');
      return;
    }
    try {
      newExperiment({ module: t.toolId, name: t.name, state: t.state });
      navigate({ page: 'tool', toolId: t.toolId });
    } catch (e) {
      onToast((e as Error).message || '创建实验失败');
    }
  };

  const resume = (): void => {
    if (!current) return;
    // 已有当前实验：直接回去
    navigate({ page: 'tool', toolId: current.module });
  };

  return (
    <div class="stack home">
      <section class="hero">
        <h1>信号与控制实验平台</h1>
        <p>
          面向一切与信号、控制知识打交道的人：<strong>13 个专业工具 + 命令中心</strong> · 教科书级符号 · 电影级动画演示 ·
          本地优先（数据不出浏览器）。
        </p>
      </section>

      {!storageAvailable() ? (
        <div class="banner banner-warn" role="status">
          当前为临时会话：本地存储不可用，实验数据不会保存（功能可正常使用）。
        </div>
      ) : null}

      {/* —— 继续实验 —— */}
      <section class="section">
        <h2>继续实验</h2>
        {current ? (
          <div class="card cont-card">
            <div class="cont-main">
              <div class="muted">当前实验 · {GROUP_NAMES[toolById(current.module)?.group ?? 'transform']}</div>
              <div class="cont-name">{current.name}</div>
              <div class="muted">
                {toolById(current.module)?.name ?? current.module} · 自动保存于 {fmtTime(current.updatedAt)}
              </div>
            </div>
            <button class="btn primary" onClick={resume}>
              回到工作区 →
            </button>
          </div>
        ) : (
          <StatePanel
            kind="empty"
            title="还没有进行中的实验"
            desc="从下方模板快速开始，或用 ⌘K 打开命令面板直接进入任意工具。"
            action={{ label: '打开命令面板', onClick: () => onToast('按 ⌘K / Ctrl+K 打开命令面板') }}
          />
        )}
      </section>

      {/* —— 快速开始 —— */}
      <section class="section">
        <h2>快速开始 · 模板</h2>
        <div class="grid3">
          {TEMPLATES.map((t) => {
            const tool = toolById(t.toolId);
            return (
              <button
                key={t.id}
                type="button"
                class={'tpl-card' + (t.disabled ? ' is-disabled' : '')}
                onClick={() => startTemplate(t)}
                title={t.disabled ? t.reason : t.blurb}
              >
                <span class="tpl-glyph" aria-hidden="true">
                  {tool?.glyph ?? '·'}
                </span>
                <span class="tpl-name">{t.name}</span>
                <span class="tpl-blurb">{t.blurb}</span>
                <span class="tpl-tool">
                  {tool?.name ?? t.toolId}
                  {t.disabled ? ' · 建设中' : ''}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* —— 学习路径 —— */}
      <section class="section">
        <h2>学习路径</h2>
        <div class="grid3">
          {PATHS.map((p) => (
            <button type="button" class="card path-card" key={p.id} onClick={() => navigate({ page: 'paths' })}>
              <div class="path-name">{p.name}</div>
              <div class="muted">{p.blurb}</div>
              <div class="row">
                <Metric label="步骤" value={p.steps} precision={0} />
                <span class="badge">可跟踪进度</span>
              </div>
            </button>
          ))}
        </div>
        <p class="muted">路径为可选体验：可直接使用工具，不进路径。点卡片进入「学习路径」页查看每步目标并跟踪进度。</p>
      </section>

      {/* —— 演示剧场 / 对比实验 —— */}
      <section class="section">
        <h2>演示与对比</h2>
        <div class="grid2">
          <button type="button" class="card path-card" onClick={() => navigate({ page: 'theater' })}>
            <div class="path-name">▷ 演示剧场</div>
            <div class="muted">
              5 部叙事演示（方波的诞生 / 卷积定理之旅 / 滤波器的阶梯 / 闭环设计五步 / 采样与混叠）：一键播放，
              逐节切换工具与参数，配旁白字幕，可暂停与变速。
            </div>
            <div class="row">
              <span class="badge">一键播放</span>
              <span class="badge">0.5×–2×</span>
            </div>
          </button>
          <button type="button" class="card path-card" onClick={() => navigate({ page: 'compare' })}>
            <div class="path-name">⇄ 对比实验 A/B</div>
            <div class="muted">
              把两套参数分别冻结进槽 A / B，并排查看图表缩略图、指标快照与参数差异，一键载入工作区或导出对比报告。
            </div>
            <div class="row">
              <span class="badge">参数差异</span>
              <span class="badge">指标 Δ</span>
            </div>
          </button>
        </div>
      </section>

      {/* —— 最近 —— */}
      <section class="section">
        <h2>最近实验</h2>
        {recent.length ? (
          <table class="tbl">
            <thead>
              <tr>
                <th>名称</th>
                <th style="width:140px">工具</th>
                <th style="width:120px">更新时间</th>
                <th style="width:80px">收藏</th>
                <th style="width:100px" />
              </tr>
            </thead>
            <tbody>
              {recent.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td>{toolById(m.module)?.name ?? m.module}</td>
                  <td class="mono">{fmtTime(m.updatedAt)}</td>
                  <td>{m.favorite ? '★' : '—'}</td>
                  <td>
                    <button
                      class="btn"
                      onClick={() => {
                        if (openExperiment(m.id)) {
                          navigate({ page: 'tool', toolId: m.module });
                        } else onToast('实验打开失败');
                      }}
                    >
                      打开
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p class="muted">最近没有其他实验。全部 {TOOLS.length} 个工具都可用 ⌘K 直达。</p>
        )}
        <p class="muted">
          符号与公式渲染：{'\u00A0'}
          <TeX tex="H(s)=\dfrac{1}{s^2+2\zeta\omega_n s+\omega_n^2}" /> {'\u00A0'}（全站同一套符号与 KaTeX 排版）。
        </p>
      </section>
    </div>
  );
}