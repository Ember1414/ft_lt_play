import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { VoiceInput } from '../ui/VoiceInput';
import {
  ExprField,
  FieldGroup,
  Metric,
  NumField,
  SegmentedChips,
  SliderField,
  StatePanel,
  StatusBadge,
  Switch,
  type StatusKind,
} from '../ui/components';
import { SYMBOLS } from '../symbols/registry';
import { Chart } from '../chart/Chart';
import { ComplexPlane, type CPMarker } from '../chart/ComplexPlane';
import { createTimeline, type TimelineState } from '../anim/timeline';
import { bode as bodeOf, ltiResponse } from '../core';

/**
 * Gallery — 控件画廊：统一输入/显示契约（§8.5.1）的可交互样例。
 * 所有工具页必须由本页组件拼装输入与显示，不得自造形态。
 */

/* 符号一律取自登记表（id → 呈现/单位），文案与图形同源。 */
const BY_ID = new Map(SYMBOLS.map((s) => [s.id, s] as const));
const sym = (id: string) => BY_ID.get(id)?.display ?? id;
const symUnit = (id: string) => BY_ID.get(id)?.unit;

const MODES = [
  { value: 'lowpass', label: '低通' },
  { value: 'bandpass', label: '带通' },
  { value: 'highpass', label: '高通' },
] as const;
type Mode = (typeof MODES)[number]['value'];

/* 简化版括号配对检查：仅为本页演示 ExprField 的三态外壳；完整解析器 M1 接入。 */
function checkExpr(text: string): { status: StatusKind | 'idle'; message?: string } {
  if (text.trim() === '') return { status: 'idle' };
  let depth = 0;
  for (const ch of text) {
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth < 0) return { status: 'err', message: '括号不配对：出现多余的右括号' };
    }
  }
  if (depth > 0) return { status: 'warn', message: `括号尚未闭合（还差 ${depth} 个）` };
  if (!/[0-9a-zA-Z]/.test(text)) return { status: 'warn', message: '未见有效操作数' };
  return { status: 'ok', message: '形态检查通过；M1 接入完整解析器与纠错词典' };
}

const DEFAULT_EXPR = '10/(s^2 + 2s + 10)';

export function Gallery() {
  const [wn, setWn] = useState(10);
  const [zeta, setZeta] = useState(0.35);
  const [mode, setMode] = useState<Mode>('lowpass');
  const [grid, setGrid] = useState(true);
  const [expr, setExpr] = useState(DEFAULT_EXPR);

  const reset = () => {
    setWn(10);
    setZeta(0.35);
    setMode('lowpass');
    setGrid(true);
    setExpr(DEFAULT_EXPR);
  };

  const calc = useMemo(() => {
    const s = Math.sqrt(1 - zeta * zeta);
    return {
      wd: wn * s,
      mp: Math.exp((-Math.PI * zeta) / s) * 100,
      ts: 4 / (zeta * wn),
    };
  }, [wn, zeta]);

  const exprState = useMemo(() => checkExpr(expr), [expr]);

  return (
    <div class="stack">
      <section class="hero">
        <h1>控件画廊 · 统一输入与显示契约</h1>
        <p>
          规划书 §8.5 要求所有工具页的输入与显示由本页组件拼装。输入统一：值旁标单位、步长随量级、
          非法即时反馈、全键盘可达；显示统一：等宽数字对齐、缺省显示 “—”、状态色之外必有图标。
        </p>
      </section>

      {/* —— 联动演示：控件 → 实时读数 —— */}
      <section class="section">
        <h2>联动演示 · 二阶系统（符号取自登记表）</h2>
        <div class="grid2">
          <FieldGroup
            title="系统参数"
            desc="滑杆 / 文本框 / 拖拽手柄共享同一取值路径与同一格式化。"
            onReset={reset}
          >
            <SliderField
              label={`${sym('wn')} · 自然频率`}
              value={wn}
              onChange={setWn}
              min={1}
              max={50}
              step={0.1}
              precision={1}
              unit={symUnit('wn')}
              hint="ωn 范围 1–50 rad/s，步长 0.1"
            />
            <SliderField
              label={`${sym('zeta')} · 阻尼比`}
              value={zeta}
              onChange={setZeta}
              min={0.05}
              max={0.95}
              step={0.01}
              precision={2}
              hint="ζ 范围 0.05–0.95"
            />
            <div class="row">
              <SegmentedChips options={MODES} value={mode} onChange={setMode} ariaLabel="滤波器模式" />
              <Switch label="显示网格" checked={grid} onChange={setGrid} hint="开关统一置于行尾" />
            </div>
          </FieldGroup>

          <div class="card stack">
            <h3>实时读数</h3>
            <div class="row">
              <Metric
                label={`${sym('wd')} · 振荡频率`}
                value={calc.wd}
                unit={symUnit('wd')}
                hint="ωd = ωn√(1−ζ²)"
              />
              <Metric
                label={`${sym('Mp')} · 超调量`}
                value={calc.mp}
                precision={1}
                unit="%"
                tone={calc.mp > 20 ? 'warn' : 'default'}
                hint="Mp = exp(−πζ/√(1−ζ²)) × 100%"
              />
              <Metric
                label={`${sym('ts')} · 调节时间`}
                value={calc.ts}
                unit="s"
                precision={2}
                hint="ts ≈ 4/(ζωn)，2% 准则"
              />
              <Metric
                label={`${sym('wb')} · 闭环带宽`}
                value={NaN}
                unit="rad/s"
                hint="M1 由频率响应内核接入；缺失值一律显示 “—”，不显示 0"
              />
            </div>
            <p class="muted">当前模式 {MODES.find((m) => m.value === mode)?.label}；网格{grid ? '开' : '关'}。</p>
          </div>
        </div>
      </section>

      {/* —— 输入类 —— */}
      <section class="section">
        <h2>输入类 · 统一形态</h2>
        <div class="grid2">
          <div class="card stack">
            <h3>数值参数（NumField）</h3>
            <div class="row">
              <NumField
                value={wn}
                onChange={setWn}
                min={1}
                max={50}
                step={0.1}
                precision={1}
                unit={symUnit('wn')}
                ariaLabel="自然频率"
              />
              <NumField
                value={0.35}
                onChange={() => {}}
                step={0.01}
                precision={2}
                ariaLabel="只读示例"
                disabled
              />
            </div>
            <p class="muted">
              ↑↓ 步进（Shift 精调十倍）、手柄 ⇔ 水平拖拽、Enter 提交、Esc 还原、非法文本即时红边并拒绝提交。
            </p>
          </div>

          <div class="card stack">
            <h3>表达式输入（ExprField）</h3>
            <ExprField
              label={`${sym('Hs')} · 传递函数`}
              value={expr}
              onChange={setExpr}
              status={exprState.status}
              message={exprState.message}
              placeholder={DEFAULT_EXPR}
              hint="等宽字体 + 三态徽标；状态与文案由外部解析结果驱动"
            />
            <div class="row">
              <button class="btn" onClick={() => setExpr(DEFAULT_EXPR)}>
                示例 1 · 正常
              </button>
              <button class="btn" onClick={() => setExpr('10/(s^2 + 2s + 10')}>
                示例 2 · 未闭合
              </button>
              <button class="btn" onClick={() => setExpr('10/s^2) + 2s')}>
                示例 3 · 不配对
              </button>
            </div>
          </div>

          <div class="card stack" style="grid-column: 1 / -1">
            <h3>枚举模式（SegmentedChips）与开关（Switch）</h3>
            <div class="row">
              <SegmentedChips options={MODES} value={mode} onChange={setMode} ariaLabel="演示模式" />
              <Switch label="显示网格" checked={grid} onChange={setGrid} />
              <Switch label="禁用示例" checked={false} onChange={() => {}} disabled />
            </div>
            <p class="muted">
              ← → 在芯片间移动即选中（roving tabindex）；开关使用 role="switch"，禁用态降低不透明度但不隐藏语义。
            </p>
          </div>
        </div>
      </section>

      {/* —— 显示类 —— */}
      <section class="section">
        <h2>显示类 · 读数 / 状态 / 空错载</h2>
        <div class="grid2">
          <div class="card stack">
            <h3>指标读数（Metric）</h3>
            <div class="row">
              <Metric label={`${sym('Mp')} · 超调量`} value={12.4} precision={1} unit="%" tone="ok" />
              <Metric label="tp · 峰值时间" value={0.33} unit="s" precision={2} />
              <Metric label={`${sym('ess')} · 稳态误差`} value={NaN} hint="未接入时显示 “—”" />
              <Metric label={`${sym('PM')} · 相位裕度`} value={41.8} precision={1} unit="°" tone="warn" />
            </div>
            <p class="muted">等宽数字 + tabular-nums；tone 仅强调语义，不单独依赖颜色表意。</p>
          </div>

          <div class="card stack">
            <h3>状态徽标（StatusBadge）</h3>
            <div class="row">
              <StatusBadge kind="ok">通过</StatusBadge>
              <StatusBadge kind="warn">括号未闭合</StatusBadge>
              <StatusBadge kind="err">语法错误</StatusBadge>
              <StatusBadge kind="info">M1 待接入</StatusBadge>
            </div>
            <p class="muted">固定文案模板：通过 / 注意 / 错误 / 说明；图标为颜色之外的冗余通道。</p>
          </div>

          <div class="card stack" style="grid-column: 1 / -1">
            <h3>空态 / 错误态 / 加载态（StatePanel）</h3>
            <div class="grid3">
              <StatePanel
                kind="empty"
                title="尚无实验记录"
                desc="运行一次仿真或实验后，记录会自动出现在这里。"
                action={{ label: '重置为示例参数', onClick: reset }}
              />
              <StatePanel
                kind="error"
                title="表达式无法解析"
                desc="请检查括号与运算符；M1 将给出具体位置提示。"
                action={{ label: '恢复默认表达式', onClick: () => setExpr(DEFAULT_EXPR) }}
              />
              <StatePanel
                kind="loading"
                title="正在计算频率响应…"
                desc="预计 1 秒内完成；加载态保留取消入口挂载位。"
              />
            </div>
          </div>
        </div>
      </section>

      {/* —— 图表层与动画（M1 批次 2）—— */}
      <ChartDemo />
      {/* —— M3 新增控件与样式（进度条 / 步骤 / 笔记 / 剧场旁白 / 语音输入）—— */}
      <M3BitsDemo />
    </div>
  );
}

/**
 * M3 新增控件与页级样式走查（控件画廊契约：所有工具页只允许从 ui/components 引入输入组件；
 * 以下为页级样式与工具级组合件，用于视觉走查与统一性核对）
 */
function M3BitsDemo() {
  const [note, setNote] = useState('记录推导过程、参数取舍理由…（此处为走查示例）');
  return (
    <section class="section">
      <h2>M3 新增控件与页级样式</h2>
      <div class="grid2">
        <div class="card stack">
          <h3>进度条 · 步骤列表（学习路径 / 内容包 / 剧场共用）</h3>
          <div class="pbar" role="progressbar" aria-valuenow={40} aria-valuemin={0} aria-valuemax={100} aria-label="示例进度">
            <span class="pbar-fill" style={{ width: '40%' }} />
          </div>
          <ol class="steps">
            <li class="step is-done">
              <span class="step-check is-on">✓</span>
              <div class="step-body">
                <div class="step-title">
                  已完成步骤
                  <span class="step-tool">◠ 傅立叶级数</span>
                </div>
                <div class="muted">步说明文字（点击圆圈可勾选/取消）。</div>
              </div>
              <div class="step-actions">
                <button class="btn">进入 →</button>
              </div>
            </li>
            <li class="step">
              <span class="step-check">2</span>
              <div class="step-body">
                <div class="step-title">
                  未完成步骤
                  <span class="step-tool">∿ 傅立叶变换</span>
                </div>
                <div class="muted">同一个列表同时承载「路径步骤」与「剧场分镜」。</div>
              </div>
              <div class="step-actions" />
            </li>
          </ol>
        </div>

        <div class="card stack">
          <h3>演示剧场旁白条（.ws-theater）</h3>
          <div class="ws-theater">
            <div class="row">
              <StatusBadge kind="info">演示剧场</StatusBadge>
              <strong>方波的诞生</strong>
              <span class="muted">第 3 / 5 步 · 播放中</span>
            </div>
            <div class="pbar">
              <span class="pbar-fill" style="width:60%" />
            </div>
            <p class="ws-theater-caption">9 次谐波：边沿迅速变陡，平顶趋于水平 —— 级数在逐点收敛。</p>
          </div>
          <div class="ws-notes">
            <div class="row">
              <strong>本实验笔记（.ws-notes）</strong>
            </div>
            <textarea class="c-area" value={note} onInput={(e) => setNote((e.currentTarget as HTMLTextAreaElement).value)} />
          </div>
        </div>

        <div class="card stack" style="grid-column: 1 / -1">
          <h3>语音输入（VoiceInput）</h3>
          <p class="muted">
            真实可用：点击后口述（Chrome / Edge），识别结果经 <code>core.voiceToExpr</code> 归一为表达式。
            不支持 / 权限被拒 / 无语音都会给出**具体原因**，不静默失败。
          </p>
          <div class="row">
            <VoiceInput
              label="试一句"
              onResult={(v) => setNote(v)}
            />
            <span class="muted">试说：「x 的平方 加 1」→ x^2+1</span>
          </div>
          <div class="muted mono">当前写入内容：{note}</div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * 图表层示例：Chart（对数轴/悬停/缩放）+ ComplexPlane（拖拽极点）
 * + 时间轴引擎（播放/速率/逐帧/循环）驱动数据动效
 * ============================================================ */

function ChartDemo() {
  const [poles, setPoles] = useState<CPMarker[]>([
    { re: -0.5, im: 1.2, kind: 'pole' },
    { re: -0.5, im: -1.2, kind: 'pole' },
    { re: -3, im: 0, kind: 'zero' },
  ]);
  const [progress, setProgress] = useState(0);
  const [tlState, setTlState] = useState<TimelineState | null>(null);
  const tlRef = useRef<ReturnType<typeof createTimeline> | null>(null);

  const bd = useMemo(() => bodeOf([10], [1, 2, 10], -1.5, 2.5, 200), []);
  const step = useMemo(() => ltiResponse([10], [1, 2, 10], () => 1, 0, 4, 400), []);

  useEffect(() => {
    const tl = createTimeline({
      duration: 4,
      loop: true,
      onFrame: (_t, p) => setProgress(p),
      onState: setTlState,
    });
    tlRef.current = tl;
    return () => tl.destroy();
  }, []);

  const dom = poles.find((p) => p.kind === 'pole' && p.re < 0) ?? poles[0];
  const wn = dom ? Math.hypot(dom.re, dom.im) : 0;
  const zeta = dom && wn > 0 ? -dom.re / wn : 0;

  const n = Math.max(2, Math.round(step.t.length * progress));

  return (
    <section class="section">
      <h2>图表层与动画（Chart / ComplexPlane / 时间轴引擎）</h2>
      <div class="grid2">
        <div class="card stack" style="grid-column: 1 / -1">
          <h3>波特图 · 对数轴（滚轮缩放 · 拖动平移 · 双击复位 · 悬停读数）</h3>
          <div class="grid2">
            <Chart
              series={[{ xs: bd.w, ys: bd.mag, color: undefined }]}
              xRange={[Math.pow(10, -1.5), Math.pow(10, 2.5)]}
              yRange={[-60, 30]}
              xLog
              height={230}
              xLabel="ω (rad/s，对数轴)"
              yLabel="幅值 (dB)"
            />
            <Chart
              series={[{ xs: bd.w, ys: bd.ph }]}
              xRange={[Math.pow(10, -1.5), Math.pow(10, 2.5)]}
              yRange={[-180, 40]}
              xLog
              height={230}
              xLabel="ω (rad/s，对数轴)"
              yLabel="相位 (°)"
            />
          </div>
          <p class="muted">对数轴仅 1/2/5 档位；轴标签与单位按符号登记表（rad/s、dB、°）。</p>
        </div>

        <div class="card stack">
          <h3>s 平面 · 拖拽极点即时读指标</h3>
          <ComplexPlane
            markers={poles}
            mode="jw"
            height={260}
            halfW={4}
            onMove={(i, re, im, phase) => {
              setPoles((ps) => ps.map((p, k) => (k === i ? { ...p, re, im } : p)));
              if (phase === 'end') {
                /* 实际工具在此写回实验状态（setModuleState） */
              }
            }}
            onDelete={(i) => setPoles((ps) => ps.filter((_, k) => k !== i))}
          />
          <div class="row">
            <Metric label="ωn · 自然频率" value={wn} unit="rad/s" precision={3} hint="主导极点模" />
            <Metric label="ζ · 阻尼比" value={zeta} precision={3} tone={zeta < 0.1 || zeta > 1 ? 'warn' : 'ok'} hint="ζ = −σ/ωn" />
          </div>
        </div>

        <div class="card stack">
          <h3>时间轴引擎（确定性帧驱动 · 可暂停/变速/逐帧/循环）</h3>
          <Chart
            series={[{ xs: step.t.slice(0, n), ys: step.y.slice(0, n), glow: 6 }]}
            xRange={[0, 4]}
            yRange={[0, 1.8]}
            height={200}
            pan={false}
            zoom={false}
            xLabel="t (s)"
            yLabel="y(t)"
          />
          <div class="row">
            <button class="btn primary" onClick={() => tlRef.current?.toggle()}>
              {tlState?.playing ? '⏸ 暂停' : '▶ 播放'}
            </button>
            {[0.25, 0.5, 1, 2].map((v) => (
              <button
                key={v}
                class={'btn' + (tlState && Math.abs(tlState.speed - v) < 1e-6 ? ' is-on' : '')}
                onClick={() => tlRef.current?.setSpeed(v)}
              >
                {v}×
              </button>
            ))}
            <Switch label="循环" checked={!!tlState?.loop} onChange={(v) => tlRef.current?.setLoop(v)} />
          </div>
          <input
            class="c-slider-track"
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={progress}
            aria-label="时间轴进度"
            onInput={(e) => {
              const p = Number((e.currentTarget as HTMLInputElement).value);
              tlRef.current?.seek(p * 4);
            }}
          />
          <p class="muted">
            进度 {progress.toFixed(2)} / 4.00 s · 帧驱动为纯函数（可回放、可逐帧导出）；数据动效（参数联动插值）见 anim/hooks。
          </p>
        </div>
      </div>
    </section>
  );
}