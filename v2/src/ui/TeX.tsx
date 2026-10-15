import { useEffect, useRef, useState } from 'preact/hooks';
import { texToText } from './textext';

/**
 * TeX — 公式渲染组件（规划书 §8.11，M3 改为按需加载）
 * KaTeX 的 JS + CSS 首次渲染公式时动态加载（独立分片，主包不含）；加载中/不可用/非法 → 纯文本降级
 * （与 v1 同款策略：data-tex 记录源码，便于后续就地重排）。
 */

interface KatexLike {
  render(tex: string, el: HTMLElement, opts?: unknown): void;
  renderToString(tex: string, opts?: unknown): string;
}

declare global {
  interface Window {
    katex?: KatexLike;
  }
}

let katexPromise: Promise<KatexLike | null> | null = null;

/** 按需加载 KaTeX（JS + CSS 动态分片）；失败返回 null（保持纯文本降级，不阻塞页面） */
function loadKatex(): Promise<KatexLike | null> {
  if (typeof window !== 'undefined' && window.katex) return Promise.resolve(window.katex);
  if (!katexPromise) {
    katexPromise = Promise.all([import('katex'), import('katex/dist/katex.min.css')])
      .then(([m]) => {
        const k = (m as { default?: KatexLike }).default ?? (m as unknown as KatexLike);
        if (typeof window !== 'undefined') window.katex = k as unknown as typeof window.katex;
        return k;
      })
      .catch(() => null);
  }
  return katexPromise;
}

export interface TeXProps {
  tex: string;
  display?: boolean;
  class?: string;
}

export function TeX(props: TeXProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const { tex, display = false } = props;
  // ready 变化触发重渲染：KaTeX 到位后把先前的纯文本降级重排为公式
  const [ready, setReady] = useState<boolean>(() => typeof window !== 'undefined' && !!window.katex);

  useEffect(() => {
    if (ready) return;
    let alive = true;
    loadKatex().then((k) => {
      if (alive && k) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [ready]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const k = typeof window !== 'undefined' ? window.katex : undefined;
    el.classList.remove('tex-fallback');
    if (!k) {
      el.classList.add('tex-fallback');
      el.textContent = texToText(tex);
      return;
    }
    try {
      // throwOnError:false 会把非法 LaTeX 渲染成红色源码而非抛错 → 先按严格模式预校验
      k.renderToString(tex, { throwOnError: true, displayMode: display });
      el.textContent = '';
      k.render(tex, el, { throwOnError: false, displayMode: display });
    } catch {
      el.classList.add('tex-fallback');
      el.textContent = texToText(tex);
    }
  }, [tex, display, ready]);

  return <span ref={ref} class={'tex' + (props.class ? ' ' + props.class : '')} data-tex={tex} />;
}
