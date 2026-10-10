import { Circle, CircleDot, Diamond, Trash2 } from 'lucide-preact';
import { Slider } from '../../ui/components/Slider';
import { EASES, MOTION_PRESETS } from '../model/animation';
import {
  applyMotion,
  clearAnimation,
  deleteKeysAtTime,
  insertKeys,
  patchRender,
  setAnimRange,
  setKeyEase,
} from '../state/actions3d';
import { activeObject, autoKey, scene3d, selection3d, time3d } from '../state/store3d';
import { Group } from './Properties';

export function AnimateProps() {
  const s = scene3d.value!;
  const o = activeObject.value;
  const t = time3d.value;
  const hasSel = selection3d.value.ids.length > 0;
  const keyHere = o?.anim
    ? Object.values(o.anim)
        .flat()
        .find((k) => Math.abs(k.t - t) < 1 / 240)
    : undefined;
  return (
    <>
      <Group title="Make it move">
        <p class="faint">Tap a motion: it becomes normal keyframes you can change later.</p>
        <div class="motion-grid">
          {MOTION_PRESETS.map((m) => (
            <button
              key={m.id}
              class="motion-item"
              title={m.hint}
              disabled={!hasSel}
              onClick={() => applyMotion(m.id)}
              data-coach={`motion-${m.id}`}
            >
              <strong>{m.name}</strong>
              <small>{m.hint}</small>
            </button>
          ))}
        </div>
        {!hasSel && <p class="faint">Select an object first.</p>}
      </Group>
      <Group title="Keyframes">
        <p class="faint">
          A keyframe remembers where something is at a moment. Kinora fills in the motion between
          keyframes.
        </p>
        <div class="btn-row">
          <button
            class="btn small primary"
            disabled={!hasSel}
            onClick={() => insertKeys()}
            title="I"
          >
            <Diamond size={16} /> Add keyframe
          </button>
          <button class="btn small" disabled={!keyHere} onClick={deleteKeysAtTime} title="Alt+I">
            Remove keyframe
          </button>
          <button
            class={`btn small ${autoKey.value ? 'rec' : ''}`}
            aria-pressed={autoKey.value}
            onClick={() => (autoKey.value = !autoKey.peek())}
            title="Auto-key: every change you make becomes a keyframe at the current time"
          >
            {autoKey.value ? <CircleDot size={16} /> : <Circle size={16} />} Auto-key{' '}
            {autoKey.value ? 'on' : 'off'}
          </button>
        </div>
        {keyHere && (
          <>
            <div class="field-label">How it moves after this keyframe</div>
            <div class="chips">
              {EASES.map((e) => (
                <button
                  key={e.id}
                  class={`chip ${keyHere.e === e.id ? 'on' : ''}`}
                  title={e.hint}
                  onClick={() => setKeyEase([keyHere.t], e.id)}
                >
                  {e.name}
                </button>
              ))}
            </div>
          </>
        )}
        {o?.anim && (
          <button class="btn small ghost" onClick={clearAnimation}>
            <Trash2 size={15} /> Remove all animation from the selection
          </button>
        )}
      </Group>
      <Group title="Length">
        <Slider
          label="Ends at"
          value={s.anim.end}
          min={0.5}
          max={120}
          step={0.1}
          defaultValue={5}
          format={(v) => `${v.toFixed(1)} s`}
          onChange={(v) => setAnimRange(s.anim.start, v)}
        />
        <Slider
          label="Frames per second"
          value={s.render.fps}
          min={12}
          max={60}
          step={1}
          defaultValue={30}
          onChange={(v) => patchRender({ fps: v }, 'fps')}
        />
      </Group>
    </>
  );
}
