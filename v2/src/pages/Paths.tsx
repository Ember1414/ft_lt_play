import { useEffect, useState } from 'preact/hooks';
import { toolById } from '../tools/registry';
import { navigate } from '../router';
import { newExperiment } from '../state/experiments';
import { Metric } from '../ui/components';

/**
 * Paths — 学习路径与自测（FR-03，M2 实装）
 * 三条内置路径（信号入门 / 控制系统入门 / 工程师速查），每步绑定一个工具 + 建议参数 + 目标说明；
 * 进度本地持久化（与实验状态解耦，全局共享）。路径为可选体验：专业用户可完全不进路径。
 */

interface Step {
  id: string;
  title: string;
  desc: string;
  toolId: string;
  state?: Record<string, unknown>;
}

interface PathDef {
  id: string;
  name: string;
  blurb: string;
  steps: Step[];
}

const PATHS: PathDef[] = [
  {
    id: 'p-signal',
    name: '信号与系统入门',
    blurb: '从周期信号分解到变换域，再到采样与随机信号（10 步）',
    steps: [
      { id: 's1', title: '傅立叶级数：方波的谐波合成', desc: '观察谐波叠加逼近方波与 Gibbs 过冲；再用画圈页观察旋转矢量合成。', toolId: 'ft', state: { view: 'harmonics' } },
      { id: 's2', title: '傅立叶变换：时频联动与卷积', desc: '看时域卷积 ↔ 频域相乘的对称性（卷积定理），并观察对称性质。', toolId: 'fourier', state: { view: 'conv' } },
      { id: 's3', title: '拉普拉斯变换：s 平面与 ROC', desc: '拖拽零极点观察 ROC 条带；用留数反变换核对解析解。', toolId: 'laplace', state: { view: 'plane' } },
      { id: 's4', title: 'Z 变换：单位圆与 Jury 判据', desc: '观察极点在单位圆内外对稳定性的影响，并用 Jury 特征表逐条判据。', toolId: 'z', state: { view: 'plane' } },
      { id: 's5', title: '系统分析：波特图与稳定裕度', desc: '读取 PM/GM 与穿越频率；理解裕度与阻尼的关系。', toolId: 'sys', state: { expr: '1/(s*(s+1)*(s+2))', view: 'bode' } },
      {
        id: 's6',
        title: '系统框图：负反馈与传函求解',
        desc: '搭建 G/(1+GH) 拓扑，核对闭环极点与理论一致。',
        toolId: 'block',
        state: {
          nodes: [
            { id: 1, kind: 'sum', x: 240, y: 220, src: true, f: { n: [1], d: [1] } },
            { id: 2, kind: 'box', x: 480, y: 220, expr: '10/(s+1)', dom: 's', out: true },
          ],
          edges: [
            { from: 1, to: 2, sign: 1 },
            { from: 2, to: 1, sign: -1 },
          ],
          seq: 2,
        },
      },
      { id: 's7', title: '交互求解：微分方程与数据滤波', desc: '解析解与数值仿真互验；对数据做移动平均/一阶滤波。', toolId: 'solve', state: { view: 'ode' } },
      { id: 's8', title: '滤波器设计器：Butterworth 低通', desc: '按规格自动定阶，看幅频/群时延与零极点，并做系数量化对比。', toolId: 'filter', state: { kind: 'iir', family: 'butter', band: 'lp', view: 'mag' } },
      { id: 's9', title: '随机信号实验室：噪声 PSD 与自相关', desc: '对比周期图与 Welch；观察滤波后自相关展宽。', toolId: 'random', state: { view: 'psd' } },
      { id: 's10', title: '公式推导：性质表与逐步推导', desc: '查阅变换性质表；跟随逐步推导把结论自己推一遍。', toolId: 'derive', state: { view: 'steps' } },
    ],
  },
  {
    id: 'p-control',
    name: '控制系统入门',
    blurb: '从二阶系统到校正器与极点配置的闭环设计主线（10 步）',
    steps: [
      { id: 'c1', title: '二阶系统的时域指标', desc: '从 ζ、ωn 读出超调量、峰值时间、调节时间。', toolId: 'sys', state: { expr: '10/(s^2+2s+10)', view: 'step' } },
      { id: 'c2', title: '根轨迹与极点走向', desc: '随 K 增大观察闭环极点移动与稳定性边界。', toolId: 'sys', state: { expr: '1/(s*(s+1)*(s+2))', view: 'locus' } },
      { id: 'c3', title: 'PID 整定：ZN 临界比例度', desc: '从 Ku/Tu 一键试算 PID 增益并仿真；对比抗饱和方案。', toolId: 'pid', state: { expr: '1/(s^3+3s^2+3s+1)' } },
      { id: 'c4', title: '超前校正：提高相位裕度', desc: '给定目标 PM 与 ωm，自动求 C(s)=Kc(s+z)/(s+p) 并对比校正前后波特图。', toolId: 'control', state: { view: 'lead', plant: '1/(s*(s+1))' } },
      { id: 'c5', title: '滞后校正：提升低频增益', desc: '降低穿越频率换取裕度，同时提高低频增益以减小静差。', toolId: 'control', state: { view: 'lag', plant: '1/(s*(s+1))' } },
      { id: 'c6', title: '极点配置：状态反馈 K', desc: '由 ζ、ωn 期望极点出发，经 Ackermann 求 K，核对闭环极点。', toolId: 'control', state: { view: 'place', plant: '1/(s*(s+1))' } },
      { id: 'c7', title: '灵敏度校核：Ms 与鲁棒性', desc: '读取 |S|、|T| 峰值，评估对对象摄动的敏感度。', toolId: 'control', state: { view: 'sens', plant: '1/(s*(s+1))' } },
      { id: 'c8', title: '前置滤波器：抗混叠与噪声抑制', desc: '控制系统中的前置滤波：设计低通并检查相位代价。', toolId: 'filter', state: { kind: 'iir', family: 'butter', band: 'lp', view: 'mag' } },
      {
        id: 'c9',
        title: '采样系统：误差点采样 + ZOH',
        desc: '在框图中搭建采样回路，核对 z 域闭环极点与理论。',
        toolId: 'block',
        state: {
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
        },
      },
      { id: 'c10', title: '采样定理与眼图', desc: '观察欠采样混叠与 sinc 重建；看 NRZ 成形眼图张开度。', toolId: 'comm', state: { view: 'sample' } },
    ],
  },
  {
    id: 'p-engineer',
    name: '工程师速查',
    blurb: '从需求到交付的最短闭环：建模 → 裕度 → 设计 → 验证 → 导出（6 步）',
    steps: [
      { id: 'e1', title: '对象建模与辨识', desc: '把物理对象写成 G(s)，检查极点/零点与稳定性。', toolId: 'sys', state: { expr: '10/(s*(s+1)*(s+2))', view: 'bode' } },
      { id: 'e2', title: '稳定性裕度体检', desc: '读 PM/GM；PM≥45°、GM≥8dB 作为工程红线。', toolId: 'sys', state: { expr: '10/(s*(s+1)*(s+2))', view: 'bode' } },
      { id: 'e3', title: '控制器设计（超前/滞后/极点配置）', desc: '按目标裕度或期望极点综合控制器，前后对比。', toolId: 'control', state: { view: 'lead', plant: '10/(s*(s+1)*(s+2))' } },
      { id: 'e4', title: '信号链滤波与量化', desc: '设计数字滤波器并做系数量化，评估频响偏差。', toolId: 'filter', state: { kind: 'iir', family: 'cheby1', band: 'lp', view: 'quant' } },
      { id: 'e5', title: '鲁棒性与噪声验证', desc: '灵敏度校核 + 随机信号 PSD/相关分析。', toolId: 'random', state: { view: 'filter' } },
      { id: 'e6', title: '交接与导出', desc: '把结果交接系统分析查看波特/根轨迹，并导出系数 CSV/JSON。', toolId: 'control', state: { view: 'plant', plant: '10/(s*(s+1)*(s+2))' } },
    ],
  },
];

const KEY = 'v2:paths:progress';

function loadProgress(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as Record<string, string[]>;
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

function saveProgress(p: Record<string, string[]>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 存储不可用：仅内存态 */
  }
}

export interface PathsProps {
  onToast: (msg: string) => void;
}

export function Paths(props: PathsProps) {
  const { onToast } = props;
  const [progress, setProgress] = useState<Record<string, string[]>>(() => loadProgress());
  const [open, setOpen] = useState<string | null>(PATHS[0]?.id ?? null);

  useEffect(() => saveProgress(progress), [progress]);

  const done = (pathId: string): string[] => progress[pathId] ?? [];

  const mark = (pathId: string, stepId: string, on: boolean): void => {
    setProgress((p) => {
      const cur = new Set(p[pathId] ?? []);
      if (on) cur.add(stepId);
      else cur.delete(stepId);
      return { ...p, [pathId]: Array.from(cur) };
    });
  };

  const startStep = (pathId: string, step: Step): void => {
    const tool = toolById(step.toolId);
    if (!tool) return;
    try {
      newExperiment({ module: step.toolId, name: step.title, state: step.state ?? {} });
    } catch (e) {
      onToast((e as Error).message || '创建实验失败');
    }
    mark(pathId, step.id, true);
    navigate({ page: 'tool', toolId: step.toolId });
  };

  return (
    <div class="stack">
      <section class="hero">
        <h1>学习路径与自测</h1>
        <p>
          三条内置路径把 14 个工具串成有起点、有进度、可自测的闭环。每步绑定一个工具与建议参数——点「进入」即新建对应实验并
          <strong>自动完成该步</strong>；也可手动勾选/取消。进度保存在本地，与实验数据解耦。
        </p>
      </section>

      {PATHS.map((p) => {
        const d = done(p.id);
        const pct = Math.round((d.length / p.steps.length) * 100);
        const isOpen = open === p.id;
        return (
          <section class="card path-block" key={p.id}>
            <button class="path-head" onClick={() => setOpen(isOpen ? null : p.id)} aria-expanded={isOpen}>
              <span class="path-chev" aria-hidden="true">
                {isOpen ? '▾' : '▸'}
              </span>
              <span class="path-title">
                <span class="path-name">{p.name}</span>
                <span class="muted">{p.blurb}</span>
              </span>
              <span class="path-prog">
                {d.length}/{p.steps.length} · {pct}%
              </span>
            </button>
            <div class="pbar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${p.name} 进度`}>
              <span class="pbar-fill" style={{ width: `${pct}%` }} />
            </div>

            {isOpen ? (
              <ol class="steps">
                {p.steps.map((s, i) => {
                  const complete = d.includes(s.id);
                  const tool = toolById(s.toolId);
                  return (
                    <li class={'step' + (complete ? ' is-done' : '')} key={s.id}>
                      <button
                        class={'step-check' + (complete ? ' is-on' : '')}
                        aria-pressed={complete}
                        title={complete ? '标记为未完成' : '标记为已完成'}
                        onClick={() => mark(p.id, s.id, !complete)}
                      >
                        {complete ? '✓' : i + 1}
                      </button>
                      <div class="step-body">
                        <div class="step-title">
                          {s.title}
                          <span class="step-tool">
                            {tool?.glyph ?? '·'} {tool?.name ?? s.toolId}
                          </span>
                        </div>
                        <div class="muted">{s.desc}</div>
                      </div>
                      <div class="step-actions">
                        <button class="btn" onClick={() => startStep(p.id, s)}>
                          进入 →
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </section>
        );
      })}

      <section class="section">
        <div class="row">
          <Metric label="路径总数" value={PATHS.length} precision={0} />
          <Metric label="步骤总数" value={PATHS.reduce((s, p) => s + p.steps.length, 0)} precision={0} />
          <button
            class="btn"
            onClick={() => {
              if (typeof confirm === 'function' && !confirm('清除全部路径进度？')) return;
              setProgress({});
              onToast('已清除路径进度');
            }}
          >
            清除全部进度
          </button>
        </div>
        <p class="muted">路径为可选体验：也可以完全跳过路径，直接用 ⌘K 打开任意工具。</p>
      </section>
    </div>
  );
}
