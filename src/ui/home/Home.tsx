import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  BookOpen,
  Clapperboard,
  Copy,
  EllipsisVertical,
  Film,
  GraduationCap,
  Images,
  LayoutTemplate,
  Laugh,
  Moon,
  Pencil,
  Scissors,
  Settings,
  ShieldCheck,
  Sun,
  Trash2,
  WandSparkles,
  WifiOff,
} from 'lucide-preact';
import { formatDuration } from '../../model/time';
import { deleteProjectById, duplicateProject, openProject } from '../../state/actions';
import { settings, toast, updateSettings } from '../../state/store';
import * as db from '../../storage/db';
import { Logo } from '../components/Logo';
import { confirmDialog, openDialog, promptDialog } from '../dialogs/dialogState';
import { startMeme, startPhotoEdit, startQuickTrim, startSlideshow, startVideo } from './flows';

interface Goal {
  id: string;
  title: string;
  text: string;
  icon: typeof Film;
  tint: string;
  run: () => void;
}

const GOALS: Goal[] = [
  { id: 'photo', title: 'Edit a photo', text: 'Brighten, fix colors, crop, add text', icon: WandSparkles, tint: 'violet', run: () => void startPhotoEdit() },
  { id: 'video', title: 'Make a video', text: 'Combine clips, add music and titles', icon: Clapperboard, tint: 'blue', run: () => void startVideo() },
  { id: 'slideshow', title: 'Photo slideshow', text: 'Turn photos into a video with music', icon: Images, tint: 'pink', run: () => void startSlideshow() },
  { id: 'trim', title: 'Quick trim', text: 'Cut the start or end of a video', icon: Scissors, tint: 'green', run: () => void startQuickTrim() },
  { id: 'meme', title: 'Make a meme', text: 'A picture with big bold text', icon: Laugh, tint: 'amber', run: () => void startMeme() },
  { id: 'template', title: 'Use a template', text: 'Birthday, travel, sale and more', icon: LayoutTemplate, tint: 'teal', run: () => openDialog({ type: 'templates' }) },
];

function timeAgo(t: number): string {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return 'yesterday';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function Home() {
  const [projects, setProjects] = useState<db.ProjectSummary[] | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const reload = () =>
    db
      .listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
  useEffect(() => {
    void reload();
  }, []);
  const covers = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects ?? []) if (p.cover) m.set(p.id, URL.createObjectURL(p.cover));
    return m;
  }, [projects]);
  useEffect(() => () => covers.forEach((u) => URL.revokeObjectURL(u)), [covers]);

  const theme = settings.value.theme;
  const isDark = theme === 'dark' || (theme === 'system' && !matchMedia('(prefers-color-scheme: light)').matches);

  return (
    <div class="home scroll-y">
      <header class="home-header">
        <div class="brand">
          <Logo size={34} />
          <span class="brand-name">Kinora</span>
        </div>
        <div class="row">
          <button class="btn ghost small" onClick={() => openDialog({ type: 'glossary' })}>
            <BookOpen size={18} /> <span class="hide-xs">Learn</span>
          </button>
          <button
            class="icon-btn"
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            title={isDark ? 'Light theme' : 'Dark theme'}
            onClick={() => updateSettings({ theme: isDark ? 'light' : 'dark' })}
          >
            {isDark ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <button class="icon-btn" aria-label="Settings" onClick={() => openDialog({ type: 'settings' })}>
            <Settings size={20} />
          </button>
        </div>
      </header>

      <main class="home-main">
        <section class="hero">
          <h1>
            What do you want to <span class="grad-text">make</span> today?
          </h1>
          <p class="muted">Pro-quality photo &amp; video editing — ridiculously easy. Pick a goal and Kinora sets everything up.</p>
        </section>

        <section class="goals" aria-label="Start something new">
          {GOALS.map((g) => (
            <button key={g.id} class={`goal tint-${g.tint}`} onClick={g.run} data-coach={`goal-${g.id}`}>
              <span class="goal-icon">
                <g.icon size={26} />
              </span>
              <span class="goal-text">
                <strong>{g.title}</strong>
                <span>{g.text}</span>
              </span>
            </button>
          ))}
        </section>

        {projects && projects.length > 0 && (
          <section class="recent">
            <h2>Your projects</h2>
            <div class="recent-grid">
              {projects.map((p) => (
                <div key={p.id} class="project-card">
                  <button class="project-open" onClick={() => void openProject(p.id)} aria-label={`Open ${p.name}`}>
                    <div class="project-cover">
                      {covers.get(p.id) ? (
                        <img src={covers.get(p.id)} alt="" />
                      ) : (
                        <span class="project-cover-empty">{p.kind === 'photo' ? <WandSparkles size={28} /> : <Film size={28} />}</span>
                      )}
                      <span class="project-kind">
                        {p.kind === 'photo' ? 'Photo' : p.duration > 0 ? formatDuration(p.duration) : 'Video'}
                      </span>
                    </div>
                    <div class="project-meta">
                      <strong>{p.name}</strong>
                      <span class="faint">Edited {timeAgo(p.updatedAt)}</span>
                    </div>
                  </button>
                  <button class="icon-btn small project-menu-btn" aria-label="Project options" onClick={() => setMenu(menu === p.id ? null : p.id)}>
                    <EllipsisVertical size={18} />
                  </button>
                  {menu === p.id && (
                    <div class="menu" onPointerLeave={() => setMenu(null)}>
                      <button
                        onClick={async () => {
                          setMenu(null);
                          const name = await promptDialog('Rename project', 'Name', p.name);
                          if (name && name.trim()) {
                            const raw = (await db.loadProject(p.id)) as { name: string } | undefined;
                            if (raw) {
                              raw.name = name.trim();
                              await db.saveProject(raw as never);
                              void reload();
                            }
                          }
                        }}
                      >
                        <Pencil size={16} /> Rename
                      </button>
                      <button
                        onClick={async () => {
                          setMenu(null);
                          await duplicateProject(p.id);
                          toast('Project copied', 'success');
                          void reload();
                        }}
                      >
                        <Copy size={16} /> Make a copy
                      </button>
                      <button
                        class="danger"
                        onClick={async () => {
                          setMenu(null);
                          const ok = await confirmDialog({
                            title: 'Delete this project?',
                            message: `"${p.name}" will be removed from this device. Your original photos and videos (on your device) are not affected. This can't be undone.`,
                            confirmLabel: 'Delete',
                            danger: true,
                          });
                          if (ok) {
                            await deleteProjectById(p.id);
                            void reload();
                          }
                        }}
                      >
                        <Trash2 size={16} /> Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <section class="learn-strip">
          <div class="learn-card">
            <GraduationCap size={28} />
            <div class="grow">
              <strong>Never edited before?</strong>
              <p class="muted">
                Start any project and Kinora shows you around in 2 minutes. Every button explains itself — hover or press and hold.
              </p>
            </div>
            <button
              class="btn"
              onClick={() => {
                updateSettings({ tourDone: false });
                void startVideo();
              }}
            >
              Start with a tour
            </button>
          </div>
          <div class="promises">
            <span>
              <ShieldCheck size={18} /> Private: your files never leave this device
            </span>
            <span>
              <WifiOff size={18} /> Works offline
            </span>
            <span>
              <Film size={18} /> Exports in full quality, no watermark
            </span>
          </div>
        </section>
      </main>
    </div>
  );
}
