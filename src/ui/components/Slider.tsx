import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';

export interface SliderProps {
  label: ComponentChildren;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Value restored by double-click / double-tap. */
  defaultValue?: number;
  hint?: string;
  format?: (v: number) => string;
  /** `final` is true when the user lets go (end of the gesture). */
  onChange: (v: number, final: boolean) => void;
  disabled?: boolean;
}

/** Big, touch-friendly slider. Fills from the default value (so ± sliders fill from the middle). */
export function Slider(props: SliderProps) {
  const { value, min, max, step = 1, defaultValue = min } = props;
  const lastTap = useRef(0);
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  const from = Math.min(pct(value), pct(defaultValue));
  const to = Math.max(pct(value), pct(defaultValue));
  const changed = Math.abs(value - defaultValue) > 1e-9;
  const fmt = props.format ?? ((v: number) => (Number.isInteger(step) ? String(Math.round(v)) : v.toFixed(2)));
  const reset = () => props.onChange(defaultValue, true);
  return (
    <div class="slider">
      <div class="slider-head">
        <span class="name">{props.label}</span>
        <button
          class={`value ${changed ? 'changed' : ''}`}
          title="Reset"
          onClick={reset}
          disabled={!changed || props.disabled}
          aria-label="Reset to default"
        >
          {fmt(value)}
        </button>
      </div>
      <input
        class="range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={props.disabled}
        aria-label={typeof props.label === 'string' ? props.label : undefined}
        style={{ '--fill-from': `${from}%`, '--fill-to': `${to}%` }}
        onInput={(e) => props.onChange(Number((e.target as HTMLInputElement).value), false)}
        onChange={(e) => props.onChange(Number((e.target as HTMLInputElement).value), true)}
        onDblClick={reset}
        onPointerDown={() => {
          const now = Date.now();
          if (now - lastTap.current < 300) reset();
          lastTap.current = now;
        }}
      />
      {props.hint && <div class="slider-hint">{props.hint}</div>}
    </div>
  );
}
