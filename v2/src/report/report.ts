/**
 * report.ts — 导出与实验报告（FR-05 / M3）
 * 统一从工作区 DOM 采集可视化产物：Canvas 图表 → PNG（dataURL）；SVG 图（框图等）→ 内联序列化；
 * 连同顶部指标、参数与时间戳生成**自包含 HTML 报告**（内联样式与图片，单文件可离线打开/打印）。
 * 契约：纯前端、零依赖、不修改页面；采集失败（跨域画布等）逐项跳过并记录。
 */

import type { MetricItem } from '../tools/api';

export interface ChartShot {
  label: string;
  png: string;
  w: number;
  h: number;
  skipped?: string;
}

export interface SvgShot {
  label: string;
  markup: string;
}

export function collectCharts(root: ParentNode): ChartShot[] {
  const canvases = Array.from(root.querySelectorAll('canvas')) as HTMLCanvasElement[];
  const out: ChartShot[] = [];
  canvases.forEach((c, i) => {
    const label = labelOf(c, i, '图表');
    if (!c.width || !c.height) {
      out.push({ label, png: '', w: c.width, h: c.height, skipped: '画布尺寸为 0' });
      return;
    }
    try {
      out.push({ label, png: c.toDataURL('image/png'), w: c.width, h: c.height });
    } catch (e) {
      out.push({ label, png: '', w: c.width, h: c.height, skipped: (e as Error).message || '导出被安全策略阻止' });
    }
  });
  return out;
}

export function collectSvgs(root: ParentNode): SvgShot[] {
  const svgs = Array.from(root.querySelectorAll('svg'));
  return svgs.map((s, i) => ({ label: labelOf(s, i, '图形'), markup: s.outerHTML }));
}

function labelOf(el: Element, index: number, prefix: string): string {
  const card = el.closest('.card');
  const h = card?.querySelector('h3');
  const t = h?.textContent?.trim();
  return t ? t : `${prefix} ${index + 1}`;
}

/** 采集当前文档的可访问样式（同源样式表 CSS 文本），用于报告内联样式 */
export function collectCss(): string {
  let css = '';
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;
      for (const r of Array.from(rules)) css += r.cssText + '\n';
    } catch {
      /* 跨域样式表：跳过（本地 KaTeX 注入的样式表同源可读） */
    }
  }
  return css;
}

export interface ReportMeta {
  toolName: string;
  toolId: string;
  expName: string;
  subtitle: string | null;
  metrics: MetricItem[];
  params: unknown;
  generatedAt: string;
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const fmtVal = (m: MetricItem): string => {
  const v = m.value;
  if (typeof v === 'number') {
    const p = m.precision;
    return p == null ? String(v) : v.toFixed(p);
  }
  return String(v ?? '—');
};

/** 构建自包含 HTML 报告（内联样式 + 内联 PNG/SVG，单文件离线可打开与打印） */
export function buildReportHtml(meta: ReportMeta, charts: ChartShot[], svgs: SvgShot[], css: string): string {
  const metricRows = meta.metrics
    .map(
      (m) =>
        `<tr><td>${esc(m.label)}</td><td class="v">${esc(fmtVal(m))}${m.unit ? ' ' + esc(m.unit) : ''}</td></tr>`,
    )
    .join('');
  const chartBlocks = charts
    .map((c) =>
      c.png
        ? `<figure><figcaption>${esc(c.label)}</figcaption><img alt="${esc(c.label)}" src="${c.png}" width="${c.w}" height="${c.h}"/></figure>`
        : `<figure class="miss"><figcaption>${esc(c.label)}</figcaption><p>图表未能导出：${esc(c.skipped || '未知原因')}</p></figure>`,
    )
    .join('');
  const svgBlocks = svgs.map((s) => `<figure><figcaption>${esc(s.label)}</figcaption>${s.markup}</figure>`).join('');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>实验报告 · ${esc(meta.toolName)}</title>
<style>
${css}
.report { max-width: 900px; margin: 0 auto; padding: 24px; }
.report h1 { font-size: 20px; margin: 0 0 4px; }
.report .meta { color: #666; font-size: 12px; margin-bottom: 16px; }
.report table { width: 100%; border-collapse: collapse; margin: 8px 0 20px; font-size: 13px; }
.report table td { border-bottom: 1px solid #e5e7eb; padding: 6px 8px; }
.report table td.v { text-align: right; font-family: ui-monospace, Menlo, Consolas, monospace; }
.report figure { margin: 0 0 20px; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; }
.report figcaption { font-weight: 600; font-size: 13px; margin-bottom: 6px; }
.report figure img { max-width: 100%; height: auto; display: block; }
.report .miss p { color: #b42318; font-size: 12px; }
.report pre { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; font-size: 12px; overflow: auto; }
@media print { .report figure { break-inside: avoid; } }
</style></head>
<body><div class="report">
<h1>${esc(meta.toolName)} · 实验报告</h1>
<div class="meta">实验：${esc(meta.expName)}｜${esc(meta.subtitle || '')}｜生成于 ${esc(meta.generatedAt)}｜工具 id：${esc(meta.toolId)}</div>
<h2>关键指标</h2>
${metricRows ? `<table>${metricRows}</table>` : '<p>（无指标）</p>'}
<h2>可视化</h2>
${chartBlocks || svgBlocks ? chartBlocks + svgBlocks : '<p>（无可导出的图表）</p>'}
<h2>参数快照</h2>
<pre>${esc(JSON.stringify(meta.params, null, 2))}</pre>
<p class="meta">由「信号与控制实验平台 v2」导出 —— 单文件自包含，可离线打开、打印或存档。</p>
</div></body></html>`;
}

export function downloadText(name: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 复制到剪贴板；不可用时降级为提示框（内容可见、可手动复制） */
export async function copyOrShow(text: string, what: string, onToast: (m: string) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    onToast(what + '已复制到剪贴板');
  } catch {
    try {
      window.prompt(what + '（请手动复制）：', text);
    } catch {
      onToast('复制失败：请手动选择复制');
    }
  }
}

export function downloadDataUrl(name: string, dataUrl: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = name;
  a.click();
}

/** 采集最大的一块画布作为「图表 PNG」导出目标（工作区主内容优先） */
export function largestCanvas(root: ParentNode): HTMLCanvasElement | null {
  const cs = Array.from(root.querySelectorAll('canvas')) as HTMLCanvasElement[];
  let best: HTMLCanvasElement | null = null;
  for (const c of cs) {
    if (!c.width || !c.height) continue;
    if (!best || c.width * c.height > best.width * best.height) best = c;
  }
  return best;
}
