import type { ComponentChildren } from 'preact';

export function Switch(props: {
  label: ComponentChildren;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label class="switch">
      <span class="label">
        {props.label}
        {props.hint && <small>{props.hint}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={props.checked}
        onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)}
      />
    </label>
  );
}

export function Segmented<T extends string | number>(props: {
  value: T;
  options: { value: T; label: ComponentChildren; title?: string }[];
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div class="segmented" role="radiogroup" aria-label={props.ariaLabel}>
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === props.value}
          class={o.value === props.value ? 'on' : ''}
          title={o.title}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const PALETTE = [
  '#ffffff',
  '#000000',
  '#ff4d4d',
  '#ff9f1c',
  '#ffd23f',
  '#3ddc84',
  '#2ec4b6',
  '#4d96ff',
  '#7c5cff',
  '#f15bb5',
  '#8d6e63',
  '#9e9e9e',
];

export function ColorSwatches(props: {
  value: string;
  onChange: (c: string) => void;
  allowNone?: boolean;
  colors?: string[];
}) {
  const colors = props.colors ?? PALETTE;
  const norm = (c: string) => c.toLowerCase().slice(0, 7);
  const isCustom = props.value !== 'transparent' && !colors.some((c) => norm(c) === norm(props.value));
  return (
    <div class="swatches">
      {props.allowNone && (
        <button
          class={`swatch none ${props.value === 'transparent' ? 'on' : ''}`}
          title="None"
          aria-label="No color"
          onClick={() => props.onChange('transparent')}
        />
      )}
      {colors.map((c) => (
        <button
          key={c}
          class={`swatch ${norm(c) === norm(props.value) ? 'on' : ''}`}
          style={{ background: c }}
          title={c}
          aria-label={`Color ${c}`}
          onClick={() => props.onChange(c)}
        />
      ))}
      <label class={`swatch custom ${isCustom ? 'on' : ''}`} title="Pick any color">
        <input
          type="color"
          value={props.value.startsWith('#') ? props.value.slice(0, 7) : '#ffffff'}
          onInput={(e) => props.onChange((e.target as HTMLInputElement).value)}
          aria-label="Pick any color"
        />
      </label>
    </div>
  );
}

export function Section(props: { title?: ComponentChildren; children: ComponentChildren; right?: ComponentChildren }) {
  return (
    <div class="section">
      {props.title && (
        <div class="section-title">
          <span class="grow">{props.title}</span>
          {props.right}
        </div>
      )}
      {props.children}
    </div>
  );
}
