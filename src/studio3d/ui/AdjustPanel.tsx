import { useState } from 'preact/hooks';
import { ChevronDown, ChevronUp } from 'lucide-preact';
import { adjustLastOp } from '../state/actions3d';
import { lastOp } from '../state/store3d';

/** "Adjust last operation": change the numbers of the tool you just used. */
export function AdjustPanel() {
  const op = lastOp.value;
  const [open, setOpen] = useState(true);
  if (!op) return null;
  return (
    <div class="adjust-panel" data-coach="adjust3d">
      <button class="adjust-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span class="grow">Adjust: {op.label}</span>
        {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      {open && (
        <div class="adjust-body">
          {op.fields.map((f) => (
            <NumberField
              key={f.key}
              label={f.label}
              unit={f.unit}
              value={op.params[f.key] ?? 0}
              min={f.min}
              max={f.max}
              step={f.step}
              onChange={(v) => adjustLastOp({ ...op.params, [f.key]: v })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A number you can drag sideways (like Blender's fields), click to type into, or nudge
 * with the arrow keys. Shift drags slower.
 */
export function NumberField(props: {
  label: string;
  value: number;
  onChange: (v: number, final: boolean) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  digits?: number;
  /** Shown value = value × scale (e.g. radians shown as degrees). */
  scale?: number;
  title?: string;
  color?: string;
}) {
  const { step = 0.01, scale = 1 } = props;
  const [editing, setEditing] = useState(false);
  const digits = props.digits ?? (step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3);
  const shown = props.value * scale;
  const clamp = (v: number) => Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, v));
  const text = `${Number.isFinite(shown) ? shown.toFixed(digits) : '—'}${props.unit ? ` ${props.unit}` : ''}`;
  if (editing) {
    return (
      <label class="numfield editing" title={props.title}>
        <span class="numfield-label" style={props.color ? { color: props.color } : undefined}>
          {props.label}
        </span>
        <input
          class="numfield-input"
          autoFocus
          inputMode="decimal"
          defaultValue={String(Number(shown.toFixed(digits + 2)))}
          onFocus={(e) => (e.target as HTMLInputElement).select()}
          onBlur={(e) => {
            const v = evalNumber((e.target as HTMLInputElement).value);
            if (v !== null) props.onChange(clamp(v / scale), true);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      </label>
    );
  }
  return (
    <div
      class="numfield"
      role="spinbutton"
      tabIndex={0}
      aria-label={props.label}
      aria-valuenow={shown}
      title={props.title ?? 'Drag sideways, or click to type'}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight')
          props.onChange(clamp(props.value + step / scale), true);
        else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft')
          props.onChange(clamp(props.value - step / scale), true);
        else if (e.key === 'Enter') setEditing(true);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerDown={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.setPointerCapture(e.pointerId);
        const x0 = e.clientX;
        const v0 = props.value;
        let moved = false;
        let last = v0;
        const move = (ev: PointerEvent) => {
          const dx = ev.clientX - x0;
          if (!moved && Math.abs(dx) < 3) return;
          moved = true;
          const per = (ev.shiftKey ? step * 0.1 : step) / scale;
          last = clamp(v0 + Math.round(dx / 2) * per);
          props.onChange(last, false);
        };
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          if (moved) props.onChange(last, true);
          else setEditing(true);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      }}
    >
      <span class="numfield-label" style={props.color ? { color: props.color } : undefined}>
        {props.label}
      </span>
      <span class="numfield-value">{text}</span>
    </div>
  );
}

/** Accepts plain numbers and simple math like "2*3" or "1/3" (no eval). */
export function evalNumber(src: string): number | null {
  const s = src
    .replace(/,/g, '.')
    .replace(/[^\d.+\-*/() e]/gi, '')
    .trim();
  if (!s) return null;
  let i = 0;
  const peek = () => s[i];
  const skip = () => {
    while (s[i] === ' ') i++;
  };
  const num = (): number => {
    skip();
    if (peek() === '(') {
      i++;
      const v = expr();
      skip();
      if (peek() === ')') i++;
      return v;
    }
    if (peek() === '-') {
      i++;
      return -num();
    }
    const m = /^\d*\.?\d+(e[+-]?\d+)?|^\d+\.?/i.exec(s.slice(i));
    if (!m) throw new Error('bad');
    i += m[0].length;
    return Number.parseFloat(m[0]);
  };
  const term = (): number => {
    let v = num();
    for (;;) {
      skip();
      if (peek() === '*') {
        i++;
        v *= num();
      } else if (peek() === '/') {
        i++;
        v /= num();
      } else return v;
    }
  };
  const expr = (): number => {
    let v = term();
    for (;;) {
      skip();
      if (peek() === '+') {
        i++;
        v += term();
      } else if (peek() === '-') {
        i++;
        v -= term();
      } else return v;
    }
  };
  try {
    const v = expr();
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
