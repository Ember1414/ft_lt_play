/**
 * diagnostics.ts — 前端诊断通道（改进计划 A4）
 * window.onerror / unhandledrejection / ErrorBoundary 捕获的渲染异常 → 内存环形缓冲（最近 50 条，
 * 含版本 / 路由 / 时间 / 消息 / 截断堆栈）；设置页「导出诊断 JSON」纯本地下载。
 * 契约：不发起任何网络请求；缓冲区只存错误元数据与环境信息，**不含实验内容等隐私数据**。
 */

export interface DiagEntry {
  /** error = window 脚本错误；rejection = 未处理的 Promise 拒绝；boundary = 渲染异常兜底 */
  kind: 'error' | 'rejection' | 'boundary';
  /** 事件时间（epoch ms） */
  t: number;
  /** 事件时的 hash 路由 */
  route: string;
  /** 错误消息（单行化，截断 300 字符） */
  msg: string;
  /** 堆栈（截断 800 字符） */
  stack?: string;
}

const BUF_MAX = 50;
const TRUNC_MSG = 300;
const TRUNC_STACK = 800;

const buf: DiagEntry[] = [];
let installed = false;

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();
const trunc = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + '…' : s);

function routeNow(): string {
  try {
    return location.hash || '#/';
  } catch {
    return '';
  }
}

/** 记录一条诊断（环形缓冲，超上限淘汰最旧） */
export function recordDiag(kind: DiagEntry['kind'], rawMsg: string, rawStack?: string): void {
  buf.push({
    kind,
    t: Date.now(),
    route: routeNow(),
    msg: trunc(oneLine(String(rawMsg ?? '')) || '(无消息)', TRUNC_MSG),
    stack: rawStack ? trunc(String(rawStack), TRUNC_STACK) : undefined,
  });
  if (buf.length > BUF_MAX) buf.shift();
}

/** 安装全局错误监听（应用启动时调用一次；重复调用为空操作） */
export function initDiagnostics(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => {
    const err = e.error as Error | undefined;
    recordDiag('error', e.message || err?.message || '(未知脚本错误)', err?.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r: unknown = e.reason;
    const msg = typeof r === 'string' ? r : r instanceof Error ? r.message : (() => { try { return JSON.stringify(r); } catch { return String(r); } })();
    recordDiag('rejection', msg ?? '(unknown rejection)', r instanceof Error ? r.stack : undefined);
  });
}

/** 当前缓冲条数（设置页回显用） */
export function diagCount(): number {
  return buf.length;
}

/**
 * 组装诊断快照（导出 JSON 的内容）：只有错误元数据与浏览器环境，
 * 不读取 / 不包含 localStorage 中的实验、剧本、笔记等内容。
 */
export function diagSnapshot(): Record<string, unknown> {
  let ua = '';
  let lang = '';
  let vw = 0;
  let vh = 0;
  let dpr = 1;
  let theme: string | null = null;
  try {
    ua = navigator.userAgent;
    lang = navigator.language;
    vw = innerWidth;
    vh = innerHeight;
    dpr = devicePixelRatio;
    theme = localStorage.getItem('flt2:theme');
  } catch {
    /* 环境信息不可得时保持空值 */
  }
  return {
    app: 'ft-lt-play-v2',
    version: __APP_VERSION__,
    exportedAt: new Date().toISOString(),
    env: { userAgent: ua, language: lang, viewport: { w: vw, h: vh }, devicePixelRatio: dpr, theme },
    route: routeNow(),
    entries: buf.slice(),
  };
}
