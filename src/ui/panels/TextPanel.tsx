import { useEffect, useRef } from 'preact/hooks';
import { AlignCenter, AlignLeft, AlignRight, Bold, CaseUpper, Italic, Plus } from 'lucide-preact';
import { FONTS } from '../../model/fonts';
import { TEXT_PRESETS, type TextPreset } from '../../model/textPresets';
import type { TextClip, TextStyle } from '../../model/types';
import { addText, endGesture, updateClipById } from '../../state/actions';
import { emit } from '../../state/events';
import { editingTextId, project, selectedClip } from '../../state/store';
import { ColorSwatches, Section, Segmented } from '../components/Controls';
import { Slider } from '../components/Slider';

/** CSS approximation of a text style for the preset picker. */
export function presetCss(style: Partial<TextStyle>, size = 22): Record<string, string> {
  const css: Record<string, string> = {
    fontFamily: `"${style.font ?? 'Poppins'}", system-ui, sans-serif`,
    fontWeight: String(style.weight ?? 700),
    fontStyle: style.italic ? 'italic' : 'normal',
    color: style.color ?? '#fff',
    fontSize: `${size}px`,
    textTransform: style.uppercase ? 'uppercase' : 'none',
    letterSpacing: `${(style.letterSpacing ?? 0) * size}px`,
  };
  const shadows: string[] = [];
  if (style.strokeWidth) {
    const w = Math.max(1, style.strokeWidth * size);
    const c = style.strokeColor ?? '#000';
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      shadows.push(`${(Math.cos(ang) * w).toFixed(1)}px ${(Math.sin(ang) * w).toFixed(1)}px 0 ${c}`);
    }
  }
  if (style.shadow) {
    shadows.push(`0 ${(style.shadowOffset ?? 0.04) * size}px ${(style.shadowBlur ?? 0.12) * size * 1.5}px ${style.shadowColor ?? '#0009'}`);
  }
  if (shadows.length) css.textShadow = shadows.join(',');
  if (style.box) {
    css.background = style.boxColor ?? '#000a';
    css.padding = '2px 8px';
    css.borderRadius = `${(style.boxRadius ?? 0.25) * size}px`;
  }
  return css;
}

function PresetGrid({ onPick, current }: { onPick: (p: TextPreset) => void; current?: string }) {
  return (
    <div class="preset-grid">
      {TEXT_PRESETS.map((pr) => (
        <button key={pr.id} class={`preset-tile ${current === pr.id ? 'on' : ''}`} onClick={() => onPick(pr)} title={pr.name} aria-label={`${pr.name} text style`}>
          <span style={presetCss(pr.style, 19)}>{pr.sample.length > 12 ? pr.name : pr.sample}</span>
        </button>
      ))}
    </div>
  );
}

export function TextPanel() {
  const c = selectedClip.value;
  const p = project.value!;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const clip = c?.type === 'text' ? (c as TextClip) : null;
  const focusEdit = clip && editingTextId.value === clip.id;
  useEffect(() => {
    if (focusEdit && taRef.current) {
      taRef.current.focus();
      taRef.current.select();
    }
  }, [focusEdit, clip?.id]);

  if (!clip) {
    return (
      <div class="panel">
        <p class="faint">Pick a style — your text appears {p.kind === 'video' ? 'at the white line' : 'on the picture'}. Then type your words.</p>
        <PresetGrid onPick={(pr) => addText(pr.id)} />
      </div>
    );
  }
  const st = clip.style;
  const k = Math.min(p.width, p.height) / 1080;
  const setStyle = (patch: Partial<TextStyle>, label = 'Text style', coalesce?: string) =>
    updateClipById(clip.id, label, (cl) => ({ style: { ...(cl as TextClip).style, ...patch } }) as Partial<TextClip>, coalesce);
  const fin = (final: boolean) => final && endGesture();

  return (
    <div class="panel text-panel">
      <textarea
        ref={taRef}
        class="textarea text-input"
        value={clip.text}
        rows={2}
        placeholder="Type your text"
        aria-label="Your text"
        style={{ fontFamily: `"${st.font}", system-ui`, fontWeight: String(Math.min(st.weight, 800)) }}
        onInput={(e) => updateClipById(clip.id, 'Edit text', { text: (e.target as HTMLTextAreaElement).value } as Partial<TextClip>, 'text')}
        onBlur={() => {
          endGesture();
          emit('text:edited', { id: clip.id });
          if (editingTextId.peek() === clip.id) editingTextId.value = null;
        }}
      />
      <Section title="Style">
        <PresetGrid
          onPick={(pr) => {
            const size = Math.round((pr.style.size ?? 96) * k);
            updateClipById(clip.id, `Style: ${pr.name}`, (cl) => ({
              style: { ...(cl as TextClip).style, ...defaultsReset(), ...pr.style, size },
              animation: { ...cl.animation, ...(pr.animation ?? {}) },
            }) as Partial<TextClip>);
          }}
        />
        <button class="btn small ghost" onClick={() => addText('title')}>
          <Plus size={16} /> Add another text
        </button>
      </Section>
      <Section title="Font">
        <div class="font-list scroll-x">
          {FONTS.map((f) => (
            <button
              key={f.family}
              class={`font-chip ${st.font === f.family ? 'on' : ''}`}
              style={{ fontFamily: `"${f.family}", system-ui`, fontWeight: String(f.weights.includes(700) ? 700 : f.weights.at(-1)) }}
              onClick={() => setStyle({ font: f.family, weight: f.weights.includes(st.weight) ? st.weight : f.weights.at(-1)! }, 'Change font')}
            >
              <span class="font-sample">Aa</span>
              <span class="font-name">{f.label}</span>
            </button>
          ))}
        </div>
        <div class="row">
          <Segmented
            ariaLabel="Alignment"
            value={st.align}
            onChange={(align) => setStyle({ align }, 'Align text')}
            options={[
              { value: 'left', label: <AlignLeft size={18} />, title: 'Left' },
              { value: 'center', label: <AlignCenter size={18} />, title: 'Center' },
              { value: 'right', label: <AlignRight size={18} />, title: 'Right' },
            ]}
          />
          <button class={`icon-btn ${st.weight >= 700 ? 'active' : ''}`} aria-label="Bold" title="Bold" onClick={() => setStyle({ weight: st.weight >= 700 ? 400 : 800 }, 'Bold')}>
            <Bold size={18} />
          </button>
          <button class={`icon-btn ${st.italic ? 'active' : ''}`} aria-label="Italic" title="Italic" onClick={() => setStyle({ italic: !st.italic }, 'Italic')}>
            <Italic size={18} />
          </button>
          <button class={`icon-btn ${st.uppercase ? 'active' : ''}`} aria-label="All capitals" title="ALL CAPS" onClick={() => setStyle({ uppercase: !st.uppercase }, 'Capitals')}>
            <CaseUpper size={18} />
          </button>
        </div>
        <Slider
          label="Size"
          value={Math.round(st.size / k)}
          min={16}
          max={400}
          defaultValue={96}
          onChange={(v, f) => {
            setStyle({ size: Math.round(v * k) }, 'Text size', 'text-size');
            fin(f);
          }}
        />
      </Section>
      <Section title="Color">
        <ColorSwatches value={st.color} onChange={(color) => setStyle({ color }, 'Text color')} />
      </Section>
      <Section title="Outline" right={<input type="checkbox" class="mini-switch" aria-label="Outline on/off" checked={st.strokeWidth > 0} onChange={(e) => setStyle({ strokeWidth: (e.target as HTMLInputElement).checked ? 0.06 : 0 }, 'Outline')} />}>
        {st.strokeWidth > 0 && (
          <>
            <ColorSwatches value={st.strokeColor} onChange={(strokeColor) => setStyle({ strokeColor }, 'Outline color')} />
            <Slider label="Thickness" value={Math.round(st.strokeWidth * 100)} min={1} max={20} defaultValue={6} onChange={(v, f) => { setStyle({ strokeWidth: v / 100 }, 'Outline', 'stroke'); fin(f); }} />
          </>
        )}
      </Section>
      <Section title="Shadow / glow" right={<input type="checkbox" class="mini-switch" aria-label="Shadow on/off" checked={st.shadow} onChange={(e) => setStyle({ shadow: (e.target as HTMLInputElement).checked }, 'Shadow')} />}>
        {st.shadow && (
          <>
            <ColorSwatches value={st.shadowColor} onChange={(shadowColor) => setStyle({ shadowColor: shadowColor.length === 7 ? shadowColor + 'cc' : shadowColor }, 'Shadow color')} />
            <Slider label="Softness" value={Math.round(st.shadowBlur * 100)} min={0} max={60} defaultValue={12} onChange={(v, f) => { setStyle({ shadowBlur: v / 100 }, 'Shadow', 'shadow-blur'); fin(f); }} />
            <Slider label="Distance" value={Math.round(st.shadowOffset * 100)} min={0} max={20} defaultValue={4} onChange={(v, f) => { setStyle({ shadowOffset: v / 100 }, 'Shadow', 'shadow-off'); fin(f); }} />
          </>
        )}
      </Section>
      <Section title="Background box" right={<input type="checkbox" class="mini-switch" aria-label="Background on/off" checked={st.box} onChange={(e) => setStyle({ box: (e.target as HTMLInputElement).checked }, 'Text background')} />}>
        {st.box && (
          <>
            <ColorSwatches value={st.boxColor} onChange={(boxColor) => setStyle({ boxColor }, 'Box color')} />
            <Slider label="Roundness" value={Math.round(st.boxRadius * 100)} min={0} max={100} defaultValue={25} onChange={(v, f) => { setStyle({ boxRadius: v / 100 }, 'Box', 'box-r'); fin(f); }} />
            <Slider label="Padding" value={Math.round(st.boxPadding * 100)} min={5} max={100} defaultValue={30} onChange={(v, f) => { setStyle({ boxPadding: v / 100 }, 'Box', 'box-p'); fin(f); }} />
          </>
        )}
      </Section>
      <Section title="Spacing">
        <Slider label="Letters" value={Math.round(st.letterSpacing * 100)} min={-10} max={60} defaultValue={0} onChange={(v, f) => { setStyle({ letterSpacing: v / 100 }, 'Letter spacing', 'ls'); fin(f); }} />
        <Slider label="Lines" value={Math.round(st.lineHeight * 100)} min={70} max={250} defaultValue={115} format={(v) => (v / 100).toFixed(2)} onChange={(v, f) => { setStyle({ lineHeight: v / 100 }, 'Line spacing', 'lh'); fin(f); }} />
      </Section>
      <p class="faint">Tip: double-tap text on the picture to edit it.</p>
    </div>
  );
}

/** Style fields a preset may not mention, reset so presets look the same every time. */
function defaultsReset(): Partial<TextStyle> {
  return {
    strokeWidth: 0,
    shadow: true,
    shadowColor: '#00000099',
    shadowBlur: 0.12,
    shadowOffset: 0.04,
    box: false,
    uppercase: false,
    italic: false,
    letterSpacing: 0,
    lineHeight: 1.15,
  };
}
