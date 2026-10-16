import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

/**
 * NumField — 数值参数（输入契约第 1 类）
 * 形态：`− [数值框] 单位 +`（步进按钮两侧对称），可选保留旧版拖拽手柄 ⇔。
 * 契约：步长随量级自适应（step），Shift 精调（step/10），非法输入即时红边，
 *       方向键 ↑↓ 步进，Enter 提交，Esc 还原；步进按钮支持长按连发。
 */

export interface NumFieldProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  /** 基础步长（按钮/方向键一次的量，拖拽每 4px 同等） */
  step?: number;
  /** 显示小数位 */
  precision?: number;
  unit?: string;
  disabled?: boolean;
  /** 输入框宽度（px） */
  width?: number;
  ariaLabel?: string;
  /** 是否显示 −/+ 步进按钮（默认显示） */
  stepper?: boolean;
  /** 是否显示旧版拖拽手柄 ⇔（默认隐藏） */
  grip?: boolean;
}

function clamp(v: number, min?: number, max?: number): number {
  if (min !== undefined && v < min) return min;
  if (max !== undefined && v > max) return max;
  return v;
}

export function NumField(props: NumFieldProps) {
  const {
    value,
    onChange,
    min,
    max,
    step = 1,
    precision = 2,
    unit,
    disabled,
    width = 64,
    ariaLabel,
    stepper = true,
    grip = false,
  } = props;
  const [text, setText] = useState(value.toFixed(precision));
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const dragRef = useRef<{ startX: number; startV: number } | null>(null);
  /** 步进按钮长按连发：定时器句柄与“是否已触发长按”标记 */
  const holdRef = useRef<{ t1: number | null; t2: number | null; fired: boolean }>({ t1: null, t2: null, fired: false });

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

  /** 最新值镜像：长按连发时 props.value 尚未回流，需要本地累加 */
  const valRef = useRef(value);
  valRef.current = value;

  const stepBy = useCallback(
    (dir: number, fine: boolean) => {
      const base = valRef.current;
      const next = Number(clamp(base + dir * step * (fine ? 0.1 : 1), min, max).toFixed(precision));
      if (next === base) return;
      valRef.current = next;
      onChange(next);
    },
    [onChange, min, max, step, precision],
  );

  /* 步进按钮长按连发（420 ms 后每 80 ms 一步） */
  const stopHold = useCallback(() => {
    const h = holdRef.current;
    if (h.t1 != null) window.clearTimeout(h.t1);
    if (h.t2 != null) window.clearInterval(h.t2);
    h.t1 = null;
    h.t2 = null;
  }, []);

  useEffect(() => stopHold, [stopHold]);

  const startHold = (dir: number) => () => {
    if (disabled) return;
    holdRef.current.fired = false;
    holdRef.current.t1 = window.setTimeout(() => {
      holdRef.current.fired = true;
      holdRef.current.t2 = window.setInterval(() => stepBy(dir, false), 80);
    }, 420);
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
      {stepper ? (
        <button
          type="button"
          class="c-num-step"
          aria-label={ariaLabel ? `减小 ${ariaLabel}` : '减小一步'}
          disabled={disabled || (min !== undefined && value <= min + 1e-12)}
          onPointerDown={startHold(-1)}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          onClick={(e) => {
            if (holdRef.current.fired) {
              holdRef.current.fired = false;
              return;
            }
            stepBy(-1, (e as MouseEvent).shiftKey);
          }}
        >
          −
        </button>
      ) : null}
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
            stepBy(1, e.shiftKey);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            stepBy(-1, e.shiftKey);
          }
        }}
      />
      {unit ? <span class="c-num-unit">{unit}</span> : null}
      {stepper ? (
        <button
          type="button"
          class="c-num-step"
          aria-label={ariaLabel ? `增大 ${ariaLabel}` : '增大一步'}
          disabled={disabled || (max !== undefined && value >= max - 1e-12)}
          onPointerDown={startHold(1)}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          onClick={(e) => {
            if (holdRef.current.fired) {
              holdRef.current.fired = false;
              return;
            }
            stepBy(1, (e as MouseEvent).shiftKey);
          }}
        >
          +
        </button>
      ) : null}
      {grip ? (
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
      ) : null}
    </span>
  );
}