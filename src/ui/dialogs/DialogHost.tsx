import { useMemo, useState } from 'preact/hooks';
import {
  Film,
  Monitor,
  RectangleVertical,
  Search,
  Smartphone,
  Square,
  Tv,
  Wand2,
} from 'lucide-preact';
import type { LucideIcon } from 'lucide-preact';
import { CANVAS_PRESETS } from '../../model/defaults';
import { GLOSSARY } from '../../i18n/glossary';
import { settings, updateSettings } from '../../state/store';
import { TEMPLATES } from '../../templates/templates';
import { Dialog } from '../components/Dialog';
import { Segmented, Switch } from '../components/Controls';
import { SHORTCUTS } from '../editor/shortcuts';
import { startTemplate } from '../home/flows';
import { closeDialog, dialog, openDialog } from './dialogState';
import { ExportDialog } from './ExportDialog';
import { AccountDialog } from './AccountDialog';
import { COPYRIGHT } from '../../legal/eula';
import { EulaText } from '../../legal/EulaGate';
import { ISC_TEXT, MIT_TEXT, THIRD_PARTY } from '../../legal/notices';

const ASPECT_ICONS: Record<string, LucideIcon> = {
  '16:9': Monitor,
  '9:16': Smartphone,
  '1:1': Square,
  '4:5': RectangleVertical,
  '4:3': Tv,
  '21:9': Film,
};

export function DialogHost() {
  const d = dialog.value;
  if (!d) return null;
  switch (d.type) {
    case 'export':
      return <ExportDialog />;
    case 'glossary':
      return <GlossaryDialog initial={d.term} />;
    case 'account':
      return <AccountDialog mode={d.mode} resetToken={d.token} />;
    case 'eula':
      return (
        <Dialog
          title="License agreement"
          subtitle={`Kinora ${COPYRIGHT}`}
          onClose={closeDialog}
          wide
        >
          <EulaText />
        </Dialog>
      );
    case 'notices':
      return (
        <Dialog
          title="Third-party notices"
          subtitle="Open-source parts of Kinora and their licenses. Thank you to their authors."
          onClose={closeDialog}
          wide
        >
          <ul class="notices">
            {THIRD_PARTY.map((n) => (
              <li key={n.name}>
                <strong>{n.name}</strong> <span class="faint">· {n.license}</span>
                <br />
                <span class="faint">{n.copyright}</span>
              </li>
            ))}
          </ul>
          <details class="notice-text">
            <summary>MIT License</summary>
            <pre>{MIT_TEXT}</pre>
          </details>
          <details class="notice-text">
            <summary>ISC License</summary>
            <pre>{ISC_TEXT}</pre>
          </details>
          <p class="faint">
            Mozilla Public License 2.0: https://mozilla.org/MPL/2.0/ · SIL Open Font License 1.1:
            https://openfontlicense.org
          </p>
        </Dialog>
      );
    case 'shortcuts':
      return (
        <Dialog title="Keyboard shortcuts" onClose={closeDialog}>
          <table class="shortcuts">
            <tbody>
              {SHORTCUTS.map((s) => (
                <tr key={s.what}>
                  <td>
                    {s.keys.map((k, i) => (
                      <span key={k}>
                        {i > 0 && ' + '}
                        <kbd class="kbd">{k}</kbd>
                      </span>
                    ))}
                  </td>
                  <td>{s.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Dialog>
      );
    case 'settings':
      return <SettingsDialog />;
    case 'templates':
      return (
        <Dialog
          title="Start from a template"
          subtitle="Pick a design, then choose your own photos or videos. Everything stays editable."
          onClose={closeDialog}
          wide
        >
          <div class="template-grid">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                class="template-card"
                onClick={() => {
                  closeDialog();
                  void startTemplate(t);
                }}
              >
                <span class="template-emoji" aria-hidden="true">
                  {t.emoji}
                </span>
                <strong>{t.name}</strong>
                <span class="faint">{t.description}</span>
                <span class="badge">
                  {t.kind === 'photo' ? 'Photo' : 'Video'} ·{' '}
                  {t.width > t.height ? 'Wide' : t.width === t.height ? 'Square' : 'Tall'}
                </span>
              </button>
            ))}
          </div>
        </Dialog>
      );
    case 'aspect':
      return (
        <Dialog title={d.title} subtitle={d.subtitle} onClose={closeDialog} wide>
          <div class="aspect-grid big">
            {d.allowAuto && (
              <button
                class="aspect-tile recommended"
                onClick={() => {
                  dialog.value = null;
                  d.resolve('auto');
                }}
              >
                <span class="aspect-icon">
                  <Wand2 size={24} />
                </span>
                <strong>Not sure — match my video</strong>
                <span>Kinora uses the shape of your first clip. No black bars.</span>
              </button>
            )}
            {CANVAS_PRESETS.slice(0, 4).map((c) => {
              const Icon = ASPECT_ICONS[c.id] ?? Monitor;
              return (
                <button
                  key={c.id}
                  class="aspect-tile"
                  onClick={() => {
                    dialog.value = null;
                    d.resolve(c);
                  }}
                >
                  <span class="aspect-icon">
                    <Icon size={24} />
                  </span>
                  <strong>{c.hint.split(',')[0]}</strong>
                  <span>
                    {c.label} — {c.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </Dialog>
      );
    case 'confirm':
      return (
        <Dialog
          title={d.title}
          onClose={closeDialog}
          footer={
            <>
              <button class="btn ghost" onClick={closeDialog}>
                Cancel
              </button>
              <button
                class={`btn ${d.danger ? 'danger' : 'primary'}`}
                onClick={() => {
                  dialog.value = null;
                  d.resolve(true);
                }}
              >
                {d.confirmLabel}
              </button>
            </>
          }
        >
          <p>{d.message}</p>
        </Dialog>
      );
    case 'prompt':
      return <PromptDialog title={d.title} label={d.label} value={d.value} resolve={d.resolve} />;
  }
}

function PromptDialog(props: {
  title: string;
  label: string;
  value: string;
  resolve: (v: string | null) => void;
}) {
  const [v, setV] = useState(props.value);
  const ok = () => {
    dialog.value = null;
    props.resolve(v);
  };
  return (
    <Dialog
      title={props.title}
      onClose={closeDialog}
      footer={
        <>
          <button class="btn ghost" onClick={closeDialog}>
            Cancel
          </button>
          <button class="btn primary" onClick={ok}>
            Save
          </button>
        </>
      }
    >
      <label class="field">
        <span class="field-label">{props.label}</span>
        <input
          class="input"
          autoFocus
          value={v}
          onInput={(e) => setV((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && ok()}
        />
      </label>
    </Dialog>
  );
}

function GlossaryDialog({ initial }: { initial?: string }) {
  const [q, setQ] = useState(initial ?? '');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s
      ? GLOSSARY.filter((g) => `${g.term} ${g.aka ?? ''} ${g.meaning}`.toLowerCase().includes(s))
      : GLOSSARY;
  }, [q]);
  return (
    <Dialog
      title="Editing words, explained"
      subtitle="No jargon left behind. Search any word you’ve heard."
      onClose={closeDialog}
      wide
    >
      <label class="search">
        <Search size={18} />
        <input
          class="input"
          placeholder="Search, e.g. “cut” or “transition”"
          value={q}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          aria-label="Search the glossary"
        />
      </label>
      <dl class="glossary">
        {list.map((g) => (
          <div key={g.term} class="glossary-item">
            <dt>
              {g.term}
              {g.aka && <span class="faint"> · {g.aka}</span>}
            </dt>
            <dd>
              <p>{g.meaning}</p>
              <p class="faint">📍 {g.where}</p>
            </dd>
          </div>
        ))}
        {!list.length && <p class="faint">No match. Try another word.</p>}
      </dl>
    </Dialog>
  );
}

function SettingsDialog() {
  const s = settings.value;
  return (
    <Dialog title="Settings" onClose={closeDialog}>
      <div class="field">
        <span class="field-label">Appearance</span>
        <Segmented
          value={s.theme}
          onChange={(theme) => updateSettings({ theme })}
          options={[
            { value: 'system', label: 'Automatic' },
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
        />
      </div>
      <Switch
        label="Explain things"
        hint="Show what each button and slider does."
        checked={s.hints}
        onChange={(hints) => updateSettings({ hints })}
      />
      <Switch
        label="Pro mode"
        hint="Show every slider and option right away (blend modes, all adjustments)."
        checked={s.pro}
        onChange={(pro) => updateSettings({ pro })}
      />
      <Switch
        label="First-project checklist"
        hint="Show the step-by-step checklist in the editor."
        checked={!s.checklistHidden}
        onChange={(v) => updateSettings({ checklistHidden: !v })}
      />
      <button class="btn small ghost" onClick={() => updateSettings({ tourDone: false })}>
        Show the welcome tour again
      </button>
      <p class="faint">
        Kinora keeps everything on this device: your projects are saved here and your files are only
        uploaded if you sign in and turn on cloud backup.
      </p>
      <div class="about-block">
        <strong>Kinora {__APP_VERSION__}</strong>
        <span class="faint">{COPYRIGHT}</span>
        <div class="row">
          <button class="btn small ghost" onClick={() => openDialog({ type: 'eula' })}>
            License agreement
          </button>
          <button class="btn small ghost" onClick={() => openDialog({ type: 'notices' })}>
            Third-party notices
          </button>
        </div>
      </div>
    </Dialog>
  );
}
