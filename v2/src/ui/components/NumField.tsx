import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

/**
 * NumField — 数值参数（输入契约第 1 类）
 * 三态绑定中的两态：文本框 ↔ 拖拽标签（滑杆组合见 SliderField）。
 * 契约：步长随量级自适应（step），Shift 精调（step/10），非法输入即时红边，
 *       方向键 ↑↓ 步进，Enter 提交，Esc 还原。
 */

export interface NumFieldProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  /** 基础步长（拖拽每 4px 与方向键一次的量） */
  step?: number;
  /** 显示小数位 */
  precision?: number;
  unit?: string;
  disabled?: boolean;
  /** 输入框宽度（px） */
  width?: number;
  ariaLabel?: string;
}

function clamp(v: number, min?: number, max?: number): number {
  if (min !== undefined && v < min) return min;
  if (max !== undefined && v > max) return max;
  return v;
}

export function NumField(props: NumFieldProps) {
  const { value, onChange, min, max, step = 1, precision = 2, unit, disabled, width = 64, ariaLabel } = props;
  const [text, setText] = useState(value.toFixed(precision));
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const dragRef = useRef<{ startX: number; startV: number } | null>(null);

  useEffect(() => {
    if (!editing) setText(value.toFixed(precision));
  }, [value, precision, editing]);

  const commitText = () => {
    const trimmed = text.trim();
    const n = Number(trimmed);
    if (trimmed === '' || Number.isNaN(n)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const v = clamp(n, min, max);
    onChange(Number(v.toFixed(precision)));
    setText(v.toFixed(precision));
    setEditing(false);
  };

  const nudge = (dir: number, fine: boolean) => {
    const v = clamp(value + dir * step * (fine ? 0.1 : 1), min, max);
    onChange(Number(v.toFixed(precision)));
  };

  /* 拖拽调值：水平拖动；按住 Shift 精调 */
  const onGripDown = useCallback(
    (e: PointerEvent) => {
      if (disabled) return;
      const el = e.currentTarget as HTMLElement;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* 指针捕获不可用时退化为普通拖动 */
      }
      dragRef.current = { startX: e.clientX, startV: value };
    },
    [disabled, value],
  );

  const onGripMove = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const fine = e.shiftKey ? 0.1 : 1;
      const raw = d.startV + Math.round((e.clientX - d.startX) / 4) * step * fine;
      const next = clamp(raw, min, max);
      if (next !== value) onChange(Number(next.toFixed(precision)));
    },
    [onChange, min, max, step, precision, value],
  );

  const onGripUp = useCallback((e: PointerEvent) => {
    dragRef.current = null;
    const el = e.currentTarget as HTMLElement;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      /* 已释放 */
    }
  }, []);

  return (
    <span class={`c-num${invalid ? ' is-invalid' : ''}${disabled ? ' is-disabled' : ''}`}>
      <input
        class="c-num-input"
        style={{ width: `${width}px` }}
        inputMode="decimal"
        aria-label={ariaLabel}
        aria-invalid={invalid}
        disabled={disabled}
        value={text}
        onFocus={() => setEditing(true)}
        onInput={(e) => {
          setEditing(true);
          setInvalid(false);
          setText((e.currentTarget as HTMLInputElement).value);
        }}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitText();
            (e.currentTarget as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setText(value.toFixed(precision));
            setEditing(false);
            setInvalid(false);
            (e.currentTarget as HTMLInputElement).blur();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            nudge(1, e.shiftKey);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            nudge(-1, e.shiftKey);
          }
        }}
      />
      {unit ? <span class="c-num-unit">{unit}</span> : null}
      <button
        type="button"
        class="c-num-grip"
        aria-label="拖动调值：水平拖动，按住 Shift 精调"
        disabled={disabled}
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        onPointerCancel={onGripUp}
      >
        ⇔
      </button>
    </span>
  );
}