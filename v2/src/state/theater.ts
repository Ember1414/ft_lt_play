/**
 * theater.ts — 演示剧场（M3：把工具串成可播放的叙事演示）
 * 机制：脚本 = 若干「步」；每步指定工具 + 参数 + 停留时长 + 旁白字幕。
 * 播放时逐步：写入该工具参数（同工具 → setModuleState；换工具 → newExperiment）
 *   → 工作区按 `seq` 重挂工具视图使其重读参数（工具动画随新参数重新演出）
 *   → 旁白条显示字幕与进度 → 计时自动进入下一步。
 * 设计取舍：不修改任何工具内部契约；剧场只负责「参数编排 + 节奏 + 旁白」。
 * M9：剧本可自建 —— 内置剧本只读，用户剧本存 localStorage（键 flt2:theater:scripts）；
 *     剧本可用 `TS1.<数据>.<校验>` 分享码导出/导入（与实验 PX1 / 内容包 PK1 同源校验）。
 */

import { getCurrent, getModuleState, newExperiment, setModuleState } from './experiments';
import { navigate } from '../router';
import { clearLiveOverride, publishLiveOverride } from './live';
import { b64uDec, b64uEnc, fnv1a } from '../core/experiment';

export interface TheaterStep {
  toolId: string;
  /** 该步应用的参数（部分覆盖；工具自身的 sanitize 负责补默认） */
  params: Record<string, unknown>;
  /** 停留时长（ms，基准 1×） */
  dwell: number;
  /** 旁白字幕 */
  caption: string;
}

export interface TheaterScript {
  id: string;
  name: string;
  blurb: string;
  steps: TheaterStep[];
}

/** 内置剧场脚本（**只读**；步骤取各工具最具观赏性的视图，字幕为旁白而非操作说明）。
 *  自建剧本见下方剧本库（getAllScripts / saveUserScript）。 */
export const SCRIPTS: TheaterScript[] = [
  {
    id: 't-sq',
    name: '方波的诞生',
    blurb: '傅立叶级数 · 从 1 次谐波到 21 次谐波的逐层逼近与 Gibbs 过冲',
    steps: [
      { toolId: 'ft', params: { view: 'harmonics', terms: 1 }, dwell: 2600, caption: '一切从一条正弦开始 —— 基波。它单独只能描述一次振荡。' },
      { toolId: 'ft', params: { view: 'harmonics', terms: 3 }, dwell: 2600, caption: '加入 3 次谐波：波形开始向方波「塌肩膀」，但仍是圆润的。' },
      { toolId: 'ft', params: { view: 'harmonics', terms: 9 }, dwell: 2800, caption: '9 次谐波：边沿迅速变陡，平顶趋于水平 —— 级数在逐点收敛。' },
      { toolId: 'ft', params: { view: 'harmonics', terms: 21 }, dwell: 3200, caption: '21 次谐波：方波成形，而跳变处的过冲没有消失 —— 这就是 Gibbs 现象。' },
      { toolId: 'ft', params: { view: 'circles' }, dwell: 3400, caption: '换一个视角：每个谐波都是一枚旋转矢量，它们的合矢量端点画出方波。' },
    ],
  },
  {
    id: 't-conv',
    name: '卷积定理之旅',
    blurb: '傅立叶变换 · 时域卷积 = 频域相乘（本文凭对称性一目了然）',
    steps: [
      { toolId: 'fourier', params: { view: 'conv' }, dwell: 3200, caption: '卷积：把一条曲线翻转、平移、逐点相乘再积分 —— 时间轴上的「加权平均」。' },
      { toolId: 'fourier', params: { view: 'map' }, dwell: 3000, caption: '同一件事在频率域里：两条谱逐点相乘。宽的时域 ⇒ 窄的频域。' },
      { toolId: 'fourier', params: { view: 'samp' }, dwell: 3000, caption: '采样是频谱的周期复制：只要不重叠，就能用理想低通原样取回。' },
    ],
  },
  {
    id: 't-filter',
    name: '滤波器的阶梯',
    blurb: '滤波器设计器 · Butterworth → Chebyshev I/II → FIR 窗函数',
    steps: [
      { toolId: 'filter', params: { kind: 'iir', family: 'butter', band: 'lp', view: 'mag' }, dwell: 3000, caption: 'Butterworth：通带最平坦，代价是过渡带最「慢」。' },
      { toolId: 'filter', params: { kind: 'iir', family: 'cheby1', band: 'lp', view: 'mag' }, dwell: 3000, caption: 'Chebyshev I：允许通带等纹波，同阶下过渡带立刻变陡。' },
      { toolId: 'filter', params: { kind: 'iir', family: 'cheby2', band: 'lp', view: 'mag' }, dwell: 3000, caption: 'Chebyshev II：把纹波搬到阻带，换来平坦通带与虚轴零点。' },
      { toolId: 'filter', params: { kind: 'iir', family: 'butter', band: 'lp', view: 'zp' }, dwell: 2800, caption: '为什么陡？极点分布回答一切：越靠近单位圆，谐振越锐。' },
      { toolId: 'filter', params: { kind: 'fir', band: 'lp', view: 'fir', firN: 41, firWin: 'hamming' }, dwell: 3200, caption: 'FIR 窗函数法：用有限抽头换严格线性相位 —— 群时延恒为常数。' },
    ],
  },
  {
    id: 't-control',
    name: '闭环设计五步',
    blurb: '控制系统设计器 · 对象 → 超前 → 滞后 → 极点配置 → 灵敏度',
    steps: [
      { toolId: 'control', params: { view: 'plant', plant: '1/(s*(s+1))' }, dwell: 3000, caption: '先看清对象：1/(s(s+1))，一个积分环节决定了低频增益无穷、稳态无静差。' },
      { toolId: 'control', params: { view: 'lead', plant: '1/(s*(s+1))', PMdes: 50, wm: 2 }, dwell: 3400, caption: '超前校正：在穿越频率处「顶」出相位，把裕度从 51.8° 提到目标值。' },
      { toolId: 'control', params: { view: 'lag', plant: '1/(s*(s+1))', wc: 0.5, beta: 20 }, dwell: 3200, caption: '滞后校正：不碰相位，而是压低穿越频率附近增益 —— 慢一点，但更稳。' },
      { toolId: 'control', params: { view: 'place', plant: '1/(s*(s+1))', zeta: 0.6, wn: 2 }, dwell: 3200, caption: '极点配置：不再修修补补，直接令闭环极点落在你指定的位置。' },
      { toolId: 'control', params: { view: 'sens', plant: '1/(s*(s+1))' }, dwell: 3200, caption: '最后校核鲁棒性：|S| 峰值 Ms 越小，对对象摄动越不敏感。' },
    ],
  },
  {
    id: 't-sample',
    name: '采样与混叠',
    blurb: '调制与通信实验室 · 采样定理的成立与崩溃',
    steps: [
      { toolId: 'comm', params: { view: 'sample', f0: 60, fsamp: 600, nsamp: 24 }, dwell: 3000, caption: '过采样（fs 远大于 2f₀）：采样点忠实记录波形，sinc 重建几乎完美。' },
      { toolId: 'comm', params: { view: 'sample', f0: 60, fsamp: 130, nsamp: 16 }, dwell: 3200, caption: '降到刚过 Nyquist：形状开始粗糙，重建出现可见偏差。' },
      { toolId: 'comm', params: { view: 'sample', f0: 60, fsamp: 80, nsamp: 8 }, dwell: 3400, caption: '跌到 2f₀ 以下：高频被折叠成低频 —— 这就是混叠，且无法事后消除。' },
      { toolId: 'comm', params: { view: 'eye', alpha: 0.35 }, dwell: 3200, caption: '工程对策：先抗混叠滤波、再用升余弦成形，眼图张开度决定抗噪余量。' },
    ],
  },
];

/* ============================ M9 · 剧本库（内置 + 自建） ============================ */

/** 剧本分享码字符上限（剧本只含文本与参数，量级小于内容包） */
export const MAX_SCRIPT_CHARS = 16000;
/** 单个剧本最多步数（防止分享码与播放体验失控） */
export const MAX_SCRIPT_STEPS = 40;
/** 单步参数 JSON 文本上限 */
const MAX_STEP_PARAMS_CHARS = 8000;

const USER_SCRIPTS_KEY = 'flt2:theater:scripts';

let userScripts: TheaterScript[] | null = null;
let theaterStorageOk = true;

/** 启动探测：存储不可用时自建剧本仅存在于本次会话（不阻塞功能） */
(() => {
  try {
    const k = 'v2:theater:probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
  } catch {
    theaterStorageOk = false;
  }
})();

export function theaterStorageAvailable(): boolean {
  return theaterStorageOk;
}

/** 新自建剧本 id（前缀 u- 与内置 t- 区分，导入时据此判断是否为可覆盖的自建剧本） */
export function newScriptId(): string {
  return 'u-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function isUserScript(id: string): boolean {
  return loadUserScripts().some((s) => s.id === id);
}

/** 规范化任意来源的剧本数据（存储 / 分享码 / 编辑器）：非法则返回 null 并说明原因 */
export function sanitizeScript(raw: unknown): { ok: true; value: TheaterScript } | { ok: false; message: string } {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, message: '剧本应为对象' };
  const name = typeof o['name'] === 'string' ? o['name'].trim() : '';
  if (!name) return { ok: false, message: '剧本缺少名称' };
  const rawId = typeof o['id'] === 'string' ? o['id'] : '';
  const id = /^u-[a-z0-9]{4,24}$/.test(rawId) ? rawId : newScriptId();
  const blurb = typeof o['blurb'] === 'string' ? o['blurb'].trim().slice(0, 200) : '';
  const stepsRaw = Array.isArray(o['steps']) ? (o['steps'] as unknown[]) : null;
  if (!stepsRaw || !stepsRaw.length) return { ok: false, message: '剧本至少要包含 1 个步骤' };
  const steps: TheaterStep[] = [];
  for (const s of stepsRaw.slice(0, MAX_SCRIPT_STEPS)) {
    const so = s as Record<string, unknown> | null;
    if (!so || typeof so !== 'object') continue;
    const toolId = typeof so['toolId'] === 'string' ? so['toolId'].trim() : '';
    if (!toolId) continue;
    const dn = Number(so['dwell']);
    const dwell = Number.isFinite(dn) && dn > 0 ? Math.min(Math.max(Math.round(dn), 300), 20000) : 3000;
    const caption = typeof so['caption'] === 'string' ? so['caption'].slice(0, 200) : '';
    let params: Record<string, unknown> = {};
    const p = so['params'];
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      const text = JSON.stringify(p);
      if (text.length <= MAX_STEP_PARAMS_CHARS) params = p as Record<string, unknown>;
    }
    steps.push({ toolId, params, dwell, caption });
  }
  if (!steps.length) return { ok: false, message: '剧本内没有有效步骤（每步需要工具 id）' };
  return { ok: true, value: { id, name: name.slice(0, 80), blurb, steps } };
}

function loadUserScripts(): TheaterScript[] {
  if (userScripts) return userScripts;
  const out: TheaterScript[] = [];
  try {
    const raw = localStorage.getItem(USER_SCRIPTS_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(arr)) {
      for (const it of arr) {
        const r = sanitizeScript(it);
        if (r.ok) out.push(r.value);
      }
    }
  } catch {
    theaterStorageOk = false;
  }
  userScripts = out;
  return userScripts;
}

function persistUserScripts(list: TheaterScript[]): void {
  userScripts = list;
  if (!theaterStorageOk) return;
  try {
    localStorage.setItem(USER_SCRIPTS_KEY, JSON.stringify(list));
  } catch {
    theaterStorageOk = false;
  }
}

/** 全部剧本：内置在前，自建在后 */
export function getAllScripts(): TheaterScript[] {
  return [...SCRIPTS, ...loadUserScripts()];
}

export function getUserScripts(): TheaterScript[] {
  return loadUserScripts().slice();
}

export type SaveScriptResult = { ok: true; value: TheaterScript } | { ok: false; message: string };

/** 新建 / 覆盖保存自建剧本（按 id 覆盖） */
export function saveUserScript(raw: unknown): SaveScriptResult {
  const r = sanitizeScript(raw);
  if (!r.ok) return r;
  const list = loadUserScripts();
  const i = list.findIndex((s) => s.id === r.value.id);
  if (i >= 0) list[i] = r.value;
  else list.push(r.value);
  persistUserScripts([...list]);
  notify();
  return { ok: true, value: r.value };
}

export function deleteUserScript(id: string): void {
  if (!isUserScript(id)) return;
  persistUserScripts(loadUserScripts().filter((s) => s.id !== id));
  notify();
}

/** 清空全部自建剧本（设置中心「恢复出厂设置」调用） */
export function clearUserScripts(): void {
  if (!loadUserScripts().length) return;
  persistUserScripts([]);
  notify();
}

/** 剧本文件 / 分享码共用的文档外壳（含 kind 与 schemaVersion，便于未来演进） */
function scriptDoc(sc: TheaterScript): { kind: string; schemaVersion: number; script: TheaterScript } {
  const r = sanitizeScript(sc);
  if (!r.ok) throw Object.assign(new Error('剧本非法：' + r.message), { code: 'bad-script' });
  return { kind: 'fltp-theater', schemaVersion: 1, script: r.value };
}

/** 剧本 → `.json` 文件文本（可再次粘贴导入） */
export function scriptToJSON(sc: TheaterScript): string {
  return JSON.stringify(scriptDoc(sc), null, 2);
}

/** 剧本 → 分享码 `TS1.<数据>.<校验>`；超长抛出带 code 的错误 */
export function encodeScript(sc: TheaterScript): string {
  const payload = b64uEnc(JSON.stringify(scriptDoc(sc)));
  const code = 'TS1.' + payload + '.' + fnv1a(payload);
  if (code.length > MAX_SCRIPT_CHARS) {
    throw Object.assign(new Error(`剧本分享码过长（${code.length} > ${MAX_SCRIPT_CHARS} 字符），请减少步骤或精简参数`), {
      code: 'too-large',
    });
  }
  return code;
}

export type ScriptDecodeResult = { ok: true; value: TheaterScript } | { ok: false; message: string };

/** 分享码 → 剧本（前缀 + 校验和 + 结构校验，失败必给出具体原因） */
export function decodeScript(code: string): ScriptDecodeResult {
  if (typeof code !== 'string' || !code.trim()) return { ok: false, message: '剧本分享码为空' };
  const text = code.trim();
  if (text.length > MAX_SCRIPT_CHARS) {
    return { ok: false, message: `剧本分享码超过 ${MAX_SCRIPT_CHARS} 字符上限` };
  }
  const parts = text.split('.');
  if (parts.length !== 3 || parts[0] !== 'TS1') {
    return { ok: false, message: '剧本分享码格式不对（应为 TS1.<数据>.<校验>）' };
  }
  if (fnv1a(parts[1]) !== parts[2]) return { ok: false, message: '剧本校验失败：内容已损坏或不完整' };
  let json: string;
  try {
    json = b64uDec(parts[1]);
  } catch {
    return { ok: false, message: '剧本数据段无法解码（不是合法 base64url）' };
  }
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch (e) {
    return { ok: false, message: '剧本 JSON 解析失败：' + (e as Error).message };
  }
  const o = obj as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || o['kind'] !== 'fltp-theater') {
    return { ok: false, message: '不是剧场剧本分享码（kind 不匹配）' };
  }
  const r = sanitizeScript(o['script']);
  if (!r.ok) return { ok: false, message: '剧本内容非法：' + r.message };
  return { ok: true, value: r.value };
}

/** 导入入口：接受 `TS1.` 分享码，或剧本 JSON 文本（导出的 .json 文件内容，含/不含外壳皆可） */
export function importScriptText(text: string): ScriptDecodeResult {
  const t = (text ?? '').trim();
  if (!t) return { ok: false, message: '没有可导入的内容' };
  if (t.startsWith('TS1.')) return decodeScript(t);
  let obj: unknown;
  try {
    obj = JSON.parse(t);
  } catch {
    return { ok: false, message: '既不是 TS1.… 分享码，也不是合法 JSON' };
  }
  const o = obj as Record<string, unknown> | null;
  const raw = o && typeof o === 'object' && 'script' in o ? o['script'] : obj;
  const r = sanitizeScript(raw);
  if (!r.ok) return { ok: false, message: '剧本内容非法：' + r.message };
  return { ok: true, value: r.value };
}

export interface Session {
  scriptId: string;
  index: number;
  playing: boolean;
  done: boolean;
  /** 播放倍速（0.5 / 1 / 2） */
  speed: number;
  /** 上一步已应用的工具与**完整**参数（插值起点） */
  lastToolId: string | null;
  lastParams: Record<string, unknown> | null;
}

let session: Session | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

/* ---- 参数插值（M5）：同工具连续步之间平滑过渡（不重挂视图） ---- */
let tweenRaf: number | null = null;
let tweenToken = 0;
let tweenLast = 0;

function notify(): void {
  for (const fn of listeners) fn();
}

export function subscribeTheater(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSession(): Session | null {
  return session;
}

/** 按 id 查剧本（内置优先，其次自建） */
export function getScript(id: string): TheaterScript | undefined {
  return SCRIPTS.find((s) => s.id === id) ?? loadUserScripts().find((s) => s.id === id);
}

function clearTimer(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function stopTween(): void {
  tweenToken++;
  if (tweenRaf != null) {
    cancelAnimationFrame(tweenRaf);
    tweenRaf = null;
  }
}

const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** 可插值的数值键：两侧都存在、均为有限数且不相等。
 *  两个端点都是整数（枚举型，如 terms/order/sps）→ 不插值（保持跳变，避免非法中间值）。 */
function interpKeys(from: Record<string, unknown>, to: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of Object.keys(to)) {
    const a = from[k];
    const b = to[k];
    if (
      typeof a === 'number' &&
      typeof b === 'number' &&
      Number.isFinite(a) &&
      Number.isFinite(b) &&
      a !== b &&
      !(Number.isInteger(a) && Number.isInteger(b))
    ) {
      out.push(k);
    }
  }
  return out;
}

/** 读取该工具在当前实验下的全量参数，并叠加本步的部分覆盖（工具 apply 需要全量对象） */
function fullParams(toolId: string, partial: Record<string, unknown>): Record<string, unknown> {
  const base = getModuleState<Record<string, unknown>>(toolId, {});
  return { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}), ...partial };
}

/** 逐帧（~30fps 节流）经「实时覆盖通道」发布中间参数 → 已挂载工具就地 apply，不重挂视图 */
function runTween(
  toolId: string,
  from: Record<string, unknown>,
  to: Record<string, unknown>,
  keys: string[],
  dur: number,
): void {
  const my = ++tweenToken;
  const t0 = performance.now();
  tweenLast = 0;
  const frame = (): void => {
    if (my !== tweenToken) return; // 被新的步骤 / 停止打断
    const el = performance.now() - t0;
    if (el - tweenLast >= 33 || el >= dur) {
      tweenLast = el;
      const t = dur <= 0 ? 1 : Math.min(1, el / dur);
      const p: Record<string, unknown> = { ...to };
      for (const k of keys) {
        const a = from[k] as number;
        const b = to[k] as number;
        p[k] = a + (b - a) * easeInOut(t);
      }
      publishLiveOverride('', toolId, p);
    }
    if (el < dur) tweenRaf = requestAnimationFrame(frame);
    else {
      tweenRaf = null;
      publishLiveOverride('', toolId, to); // 收尾：精确目标值
    }
  };
  tweenRaf = requestAnimationFrame(frame);
}

/** 应用某一步：落库（换工具 → 新建实验；同工具 → 写当前实验）＋
 *  生效（换工具由视图 key 重挂读取；同工具走「实时覆盖通道」就地应用）＋
 *  同工具连续数值参数之间做插值过渡（M5）。 */
function apply(index: number): void {
  if (!session) return;
  const sc = getScript(session.scriptId);
  const st = sc?.steps[index];
  if (!sc || !st) return;
  stopTween();
  // 完整参数 = 存储中的当前全量参数 + 本步的部分覆盖（工具 apply 需要全量对象）
  const target = fullParams(st.toolId, st.params);
  const cur = getCurrent();
  const sameTool = cur != null && cur.module === st.toolId;
  try {
    if (sameTool) setModuleState(st.toolId, target);
    else newExperiment({ module: st.toolId, name: `演示剧场 · ${sc.name}`, state: target });
  } catch {
    /* 存储不可用：仍继续播放（参数写入会失败但不阻塞演示） */
  }
  session.index = index;
  session.done = false;
  const prev = session.lastParams;
  const canTween = sameTool && session.lastToolId === st.toolId && prev != null;
  const keys = canTween ? interpKeys(prev as Record<string, unknown>, target) : [];
  if (canTween && keys.length) {
    const dur = Math.min(Math.max(st.dwell * 0.45, 260), 900) / session.speed;
    runTween(st.toolId, prev as Record<string, unknown>, target, keys, dur);
  } else if (sameTool) {
    publishLiveOverride('', st.toolId, target); // 同工具（非插值）：就地生效，不重挂
  }
  session.lastToolId = st.toolId;
  session.lastParams = target;
  navigate({ page: 'tool', toolId: st.toolId });
  notify();
  scheduleNext(Math.round(st.dwell / session.speed));
}

function scheduleNext(dwell: number): void {
  clearTimer();
  if (!session || !session.playing) return;
  timer = setTimeout(() => {
    if (!session || !session.playing) return;
    const sc = getScript(session.scriptId);
    if (!sc) return stop();
    if (session.index + 1 >= sc.steps.length) {
      session.playing = false;
      session.done = true;
      clearTimer();
      notify();
      return;
    }
    apply(session.index + 1);
  }, dwell);
}

export function startScript(scriptId: string, speed = 1): void {
  const sc = getScript(scriptId);
  if (!sc) return;
  clearTimer();
  session = { scriptId, index: -1, playing: true, done: false, speed, lastToolId: null, lastParams: null };
  apply(0);
}

export function setPlaying(p: boolean): void {
  if (!session) return;
  session.playing = p;
  if (p) {
    const sc = getScript(session.scriptId);
    const st = sc?.steps[session.index];
    scheduleNext(st ? Math.round(st.dwell / session.speed) : 2000);
  } else {
    clearTimer();
  }
  notify();
}

export function setSpeed(speed: number): void {
  if (!session) return;
  session.speed = speed;
  notify();
  if (session.playing) {
    const sc = getScript(session.scriptId);
    const st = sc?.steps[session.index];
    scheduleNext(st ? Math.round(st.dwell / session.speed) : 2000);
  }
}

export function nextStep(): void {
  if (!session) return;
  const sc = getScript(session.scriptId);
  if (!sc) return stop();
  if (session.index + 1 >= sc.steps.length) {
    session.playing = false;
    session.done = true;
    clearTimer();
    notify();
    return;
  }
  apply(session.index + 1);
}

export function prevStep(): void {
  if (!session || session.index <= 0) return;
  apply(session.index - 1);
}

export function restart(): void {
  if (!session) return;
  clearTimer();
  session.playing = true;
  session.done = false;
  apply(0);
}

export function stop(): void {
  clearTimer();
  stopTween();
  clearLiveOverride();
  session = null;
  notify();
}
