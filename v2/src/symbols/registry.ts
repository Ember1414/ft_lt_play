/**
 * registry.ts — 符号登记表（FR-17）
 *
 * 全站唯一符号来源：组件、绘图、文案、报告、路径内容一律引用本表。
 * 每条登记项 = 界面呈现 + KaTeX 源码 + 单位 + 用法说明 + 禁用别名（供 lint 扫描）。
 * 依据：《信号与控制实验平台 v2 · 重构规划书》§8.11；本表在 M0 定稿后冻结。
 */

export type SymbolGroup =
  | 'base'        // 基本变量
  | 'sampling'    // 采样
  | 'secondOrder' // 二阶系统
  | 'signals'     // 基本信号
  | 'transforms'  // 变换与传函
  | 'metrics'     // 性能指标
  | 'blocks'      // 控制系统框图
  | 'digital'     // 数字滤波
  | 'stateSpace'  // 状态空间
  | 'comm'        // 调制与通信
  | 'axes';       // 坐标与轴标注

export interface SymbolEntry {
  /** 稳定标识（代码引用用） */
  id: string;
  group: SymbolGroup;
  /** 界面呈现（Unicode 文本） */
  display: string;
  /** KaTeX 源码（公式渲染用） */
  latex: string;
  /** 单位（正体；无量纲则为空） */
  unit?: string;
  /** 用法说明 / 禁用说明 */
  note?: string;
  /** 禁用别名（lint 扫描；不区分大小写的纯文本匹配在 M0 定稿时启用） */
  forbidden?: string[];
}

export const GROUP_NAMES: Record<SymbolGroup, string> = {
  base: '基本变量',
  sampling: '采样',
  secondOrder: '二阶系统',
  signals: '基本信号',
  transforms: '变换与传函',
  metrics: '性能指标',
  blocks: '控制系统框图',
  digital: '数字滤波',
  stateSpace: '状态空间',
  comm: '调制与通信',
  axes: '坐标与轴标注',
};

export const SYMBOLS: SymbolEntry[] = [
  /* —— 基本变量 —— */
  { id: 't', group: 'base', display: 't', latex: 't', unit: 's', note: '连续时间变量' },
  { id: 'f', group: 'base', display: 'f', latex: 'f', unit: 'Hz', note: '频率', forbidden: ['F（作为频率）'] },
  { id: 'omega', group: 'base', display: 'ω', latex: '\\omega', unit: 'rad/s', note: '角频率', forbidden: ['w'] },
  { id: 'sigma', group: 'base', display: 'σ', latex: '\\sigma', note: '衰减因子（s = σ + jω 的实部）' },
  { id: 's', group: 'base', display: 's', latex: 's', note: '复频率 s = σ + jω' },
  { id: 'z', group: 'base', display: 'z', latex: 'z', note: 'z 变换复变量' },

  /* —— 采样 —— */
  { id: 'T', group: 'sampling', display: 'T', latex: 'T', unit: 's', note: '采样周期' },
  { id: 'fs', group: 'sampling', display: 'fs', latex: 'f_s', unit: 'Hz', note: '采样频率', forbidden: ['Fs'] },
  { id: 'fN', group: 'sampling', display: 'fN', latex: 'f_N', unit: 'Hz', note: '奈奎斯特频率 fN = fs/2' },

  /* —— 二阶系统 —— */
  { id: 'zeta', group: 'secondOrder', display: 'ζ', latex: '\\zeta', note: '阻尼比' },
  { id: 'wn', group: 'secondOrder', display: 'ωn', latex: '\\omega_n', unit: 'rad/s', note: '自然频率', forbidden: ['wn'] },
  { id: 'wd', group: 'secondOrder', display: 'ωd', latex: '\\omega_d', unit: 'rad/s', note: '阻尼振荡频率 ωd = ωn√(1−ζ²)' },

  /* —— 基本信号 —— */
  { id: 'u', group: 'signals', display: 'u(t)', latex: 'u(t)', note: '单位阶跃', forbidden: ['heaviside（界面文案以外）'] },
  { id: 'delta', group: 'signals', display: 'δ(t)', latex: '\\delta(t)', note: '单位冲激' },
  { id: 'sinc', group: 'signals', display: 'sinc(x)', latex: '\\operatorname{sinc}(x)', note: 'sinc(x) = sin(πx)/(πx)' },
  { id: 'rect', group: 'signals', display: 'rect(x)', latex: '\\operatorname{rect}(x)', note: '矩形脉冲' },
  { id: 'tri', group: 'signals', display: 'tri(x)', latex: '\\operatorname{tri}(x)', note: '三角脉冲' },

  /* —— 变换与传函 —— */
  { id: 'laplace', group: 'transforms', display: 'ℒ', latex: '\\mathcal{L}', note: '拉普拉斯变换 ℒ{·}' },
  { id: 'fourier', group: 'transforms', display: 'ℱ', latex: '\\mathcal{F}', note: '傅里叶变换 ℱ{·}' },
  { id: 'ztrans', group: 'transforms', display: '𝒵', latex: '\\mathcal{Z}', note: 'Z 变换 𝒵{·}' },
  { id: 'Hs', group: 'transforms', display: 'H(s)', latex: 'H(s)', note: '传递函数' },
  { id: 'Gs', group: 'transforms', display: 'G(s)', latex: 'G(s)', note: '被控对象 / 环节' },
  { id: 'Ls', group: 'transforms', display: 'L(s)', latex: 'L(s)', note: '开环传递函数' },
  { id: 'Ts', group: 'transforms', display: 'T(s)', latex: 'T(s)', note: '闭环传递函数' },
  { id: 'jw', group: 'transforms', display: 'H(jω)', latex: 'H(\\mathrm{j}\\omega)', note: '连续频率响应' },
  { id: 'ejw', group: 'transforms', display: 'H(e^jω)', latex: 'H(\\mathrm{e}^{\\mathrm{j}\\omega})', note: '离散频率响应' },

  /* —— 性能指标 —— */
  { id: 'Mp', group: 'metrics', display: 'Mp', latex: 'M_p', note: '超调量' },
  { id: 'tr', group: 'metrics', display: 'tr', latex: 't_r', unit: 's', note: '上升时间' },
  { id: 'ts', group: 'metrics', display: 'ts', latex: 't_s', unit: 's', note: '调节时间' },
  { id: 'ess', group: 'metrics', display: 'ess', latex: 'e_{ss}', note: '稳态误差' },
  { id: 'PM', group: 'metrics', display: 'PM', latex: '\\mathrm{PM}', unit: '°', note: '相位裕度' },
  { id: 'GM', group: 'metrics', display: 'GM', latex: '\\mathrm{GM}', unit: 'dB', note: '幅值裕度' },
  { id: 'wc', group: 'metrics', display: 'ωc', latex: '\\omega_c', unit: 'rad/s', note: '增益穿越频率', forbidden: ['wc'] },
  { id: 'wg', group: 'metrics', display: 'ωg', latex: '\\omega_g', unit: 'rad/s', note: '相位穿越频率' },
  { id: 'Mr', group: 'metrics', display: 'Mr', latex: 'M_r', note: '谐振峰' },
  { id: 'wb', group: 'metrics', display: 'ωb', latex: '\\omega_b', unit: 'rad/s', note: '闭环带宽' },
  { id: 'Ms', group: 'metrics', display: 'Ms', latex: 'M_s', note: '灵敏度峰值' },

  /* —— 控制系统框图（图形符号：display 为占位字形，M0 定稿替换为规范图形） —— */
  { id: 'block', group: 'blocks', display: '▭', latex: '\\square', note: '方框 = 传递函数 G(s)' },
  { id: 'sum', group: 'blocks', display: 'Σ', latex: '\\Sigma', note: '求和点：圈内标 ±' },
  { id: 'branch', group: 'blocks', display: '●', latex: '\\bullet', note: '分支点（实心圆）' },
  { id: 'sampler', group: 'blocks', display: '⌄', latex: '\\downarrow', note: '采样开关（闭合采样）' },
  { id: 'zoh', group: 'blocks', display: '⊓', latex: '\\sqcap', note: '零阶保持器 ZOH' },

  /* —— 数字滤波 —— */
  { id: 'bk', group: 'digital', display: 'b_k', latex: 'b_k', note: '分子系数（按 b0…bM 顺序展示）' },
  { id: 'ak', group: 'digital', display: 'a_k', latex: 'a_k', note: '分母系数（按 a0…aN 顺序展示）' },
  { id: 'Bq', group: 'digital', display: 'B', latex: 'B', unit: 'bit', note: '量化位数' },
  { id: 'q', group: 'digital', display: 'q', latex: 'q', note: '量化步长' },

  /* —— 状态空间 —— */
  { id: 'ss-eq', group: 'stateSpace', display: 'ẋ = Ax + Bu', latex: '\\dot{x} = Ax + Bu', note: '状态方程' },
  { id: 'ss-out', group: 'stateSpace', display: 'y = Cx + Du', latex: 'y = Cx + Du', note: '输出方程' },
  { id: 'ctrb', group: 'stateSpace', display: '𝒞', latex: '\\mathcal{C}', note: '能控性矩阵 [B AB ⋯ A^(n−1)B]' },
  { id: 'obsv', group: 'stateSpace', display: '𝒪', latex: '\\mathcal{O}', note: '能观性矩阵' },
  { id: 'n-dim', group: 'stateSpace', display: 'n ≤ 6', latex: 'n \\le 6', note: '状态维度上限' },

  /* —— 调制与通信（M2/M3 新增工具引入的记法） —— */
  { id: 'fc', group: 'comm', display: 'fc', latex: 'f_c', unit: 'Hz', note: '载波频率', forbidden: ['Fc'] },
  { id: 'fm', group: 'comm', display: 'fm', latex: 'f_m', unit: 'Hz', note: '消息频率' },
  { id: 'am', group: 'comm', display: 'm', latex: 'm', note: 'AM 调制度（m>1 为过调幅）' },
  { id: 'df', group: 'comm', display: 'Δf', latex: '\\Delta f', unit: 'Hz', note: 'FM 峰值频偏 = kf·max|m(t)|' },
  { id: 'kf', group: 'comm', display: 'kf', latex: 'k_f', unit: 'Hz', note: '调频灵敏度（Hz / 单位消息幅度）' },
  { id: 'beta', group: 'comm', display: 'β', latex: '\\beta', note: 'FM 调制指数 β = Δf / fm' },
  { id: 'carson', group: 'comm', display: 'B_FM', latex: 'B_{\\mathrm{FM}}', unit: 'Hz', note: 'Carson 带宽 ≈ 2(Δf + fm)' },
  { id: 'ssb', group: 'comm', display: 's(t)', latex: 's(t)', note: '已调信号（AM/DSB/FM 通用）' },
  { id: 'nrz', group: 'comm', display: 'NRZ', latex: '\\mathrm{NRZ}', note: '不归零码（±amp，每符号 sps 样点）' },
  { id: 'rc', group: 'comm', display: 'RC(α)', latex: '\\mathrm{RC}(\\alpha)', note: '升余弦成形，α 为滚降系数' },
  { id: 'eye', group: 'comm', display: '眼图', latex: '\\text{eye}', note: '眼高 = 判决时刻最小张开度' },

  /* —— 坐标与轴标注（标注模板） —— */
  { id: 'ax-mag', group: 'axes', display: '幅值 (dB)', latex: '|H|\\ (\\mathrm{dB})', note: '波特图幅值轴' },
  { id: 'ax-phase', group: 'axes', display: '相位 (°)', latex: '\\angle H\\ (^\\circ)', note: '波特图相位轴' },
  { id: 'ax-omega', group: 'axes', display: 'ω (rad/s，对数轴)', latex: '\\omega\\ (\\mathrm{rad/s})', note: '横轴：对数轴档位标注 1/2/5' },
  { id: 'ax-splane', group: 'axes', display: 'σ–jω', latex: '\\sigma\\text{–}\\mathrm{j}\\omega', note: 's 平面坐标' },
  { id: 'ax-zplane', group: 'axes', display: 'Re–Im + 单位圆', latex: '\\operatorname{Re}\\text{–}\\operatorname{Im}', note: 'z 平面坐标（含单位圆）' },
];

/** 按分组取符号（供文档页 / 验收清单用） */
export function symbolsOf(group: SymbolGroup): SymbolEntry[] {
  return SYMBOLS.filter((s) => s.group === group);
}