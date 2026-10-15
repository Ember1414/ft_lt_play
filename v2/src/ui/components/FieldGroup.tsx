import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

/**
 * FieldGroup — 参数组 / 折叠（输入契约第 9 类）
 * 统一形态：标题 + 说明 + 重置；折叠状态由上层接入实验持久化（本期先内存态）。
 */

export interface FieldGroupProps {
  title: string;
  desc?: string;
  children: ComponentChildren;
  defaultOpen?: boolean;
  onReset?: () => void;
}

export function FieldGroup(props: FieldGroupProps) {
  const { title, desc, children, defaultOpen = true, onReset } = props;
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section class={`c-group${open ? ' is-open' : ''}`}>
      <header class="c-group-head">
        <button
          type="button"
          class="c-group-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span class="c-group-chev" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <span class="c-group-title">{title}</span>
        </button>
        {onReset ? (
          <button type="button" class="c-group-reset" onClick={onReset}>
            重置
          </button>
        ) : null}
      </header>
      {desc ? <p class="c-group-desc">{desc}</p> : null}
      {open ? <div class="c-group-body">{children}</div> : null}
    </section>
  );
}