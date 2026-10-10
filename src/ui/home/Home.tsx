import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  BookOpen,
  Box,
  Boxes,
  Clapperboard,
  FileUp,
  Orbit,
  ShoppingBag,
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
import { pickFiles } from '../components/filePicker';

/** The 3D studio is a separate download: load it only when someone goes 3D. */
const studio3d = () => import('../../studio3d/state/actions3d');

async function start3d(kind: 'model' | 'product' | 'animate'): Promise<void> {
  try {
    await (await studio3d()).newScene(kind);
  } catch {
    toast('Couldn’t load the 3D studio. Check your connection and try again.', 'error');
  }
}

async function open3dFile(): Promise<void> {
  // Pick first, while the tap still counts as a user gesture.
  const files = await pickFiles({ accept: '.glb,.gltf,.fbx,.obj,.stl,.ply', multiple: true });
  if (!files.length) return;
  try {
    const m = await studio3d();
    await m.newScene('blank', files[0]!.name.replace(/\.[^.]+$/, ''));
    const io = await import('../../studio3d/io/import3d');
    await io.importModelFiles(files);
  } catch {
    toast('Couldn’t open that file.', 'error');
  }
}

interface Goal {
  id: string;
  title: string;
  text: string;
  icon: typeof Film;
  tint: string;
  run: () => void;
}

const GOALS: Goal[] = [
  {
    id: 'photo',
    title: 'Edit a photo',
    text: 'Brighten, fix colors, crop, add text',
    icon: WandSparkles,
    tint: 'violet',
    run: () => void startPhotoEdit(),
  },
  {
    id: 'video',
    title: 'Make a video',
    text: 'Combine clips, add music and titles',
    icon: Clapperboard,
    tint: 'blue',
    run: () => void startVideo(),
  },
  {
    id: 'slideshow',
    title: 'Photo slideshow',
    text: 'Turn photos into a video with music',
    icon: Images,
    tint: 'pink',
    run: () => void startSlideshow(),
  },
  {
    id: 'trim',
    title: 'Quick trim',
    text: 'Cut the start or end of a video',
    icon: Scissors,
    tint: 'green',
    run: () => void startQuickTrim(),
  },
  {
    id: 'meme',
    title: 'Make a meme',
    text: 'A picture with big bold text',
    icon: Laugh,
    tint: 'amber',
    run: () => void startMeme(),
  },
  {
    id: 'template',
    title: 'Use a template',
    text: 'Birthday, travel, sale and more',
    icon: LayoutTemplate,
    tint: 'teal',
    run: () => openDialog({ type: 'templates' }),
  },
];

const GOALS_3D: Goal[] = [
  {
    id: '3d-model',
    title: 'Model in 3D',
    text: 'Shape objects, characters and game props',
    icon: Box,
    tint: 'violet',
    run: () => void start3d('model'),
  },
  {
    id: '3d-product',
    title: '3D product shot',
    text: 'Studio lights and a pedestal, ready to render',
    icon: ShoppingBag,
    tint: 'amber',
    run: () => void start3d('product'),
  },
  {
    id: '3d-animate',
    title: 'Animate in 3D',
    text: 'Make things bounce, spin and fly',
    icon: Orbit,
    tint: 'pink',
    run: () => void start3d('animate'),
  },
  {
    id: '3d-open',
    title: 'Open a 3D file',
    text: 'GLB, FBX, OBJ, STL — characters with animations too',
    icon: FileUp,
    tint: 'teal',
    run: () => void open3dFile(),
  },
];

type Card =
  | (db.ProjectSummary & { is3d?: false })
  | { is3d: true; id: string; name: string; updatedAt: number; objectCount: number; cover?: Blob };

function timeAgo(t: number): string {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return 'yesterday';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function Home() {
  const [projects, setProjects] = useState<Card[] | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const reload = () =>
    Promise.all([db.listProjects().catch(() => []), db.listScenes().catch(() => [])])
      .then(([ps, ss]) =>
        setProjects(
          [...ps, ...ss.map((x) => ({ ...x, is3d: true as const }))].sort(
            (a, b) => b.updatedAt - a.updatedAt,
          ),
        ),
      )
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
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && !matchMedia('(prefers-color-scheme: light)').matches);

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
          <button
            class="icon-btn"
            aria-label="Settings"
            onClick={() => openDialog({ type: 'settings' })}
          >
            <Settings size={20} />
          </button>
        </div>
      </header>

      <main class="home-main">
        <section class="hero">
          <h1>
            What do you want to <span class="grad-text">make</span> today?
          </h1>
          <p class="muted">
            Pro-quality photo, video &amp; 3D — ridiculously easy. Pick a goal and Kinora sets
            everything up.
          </p>
        </section>

        <section class="goals" aria-label="Start something new">
          {GOALS.map((g) => (
            <button
              key={g.id}
              class={`goal tint-${g.tint}`}
              onClick={g.run}
              data-coach={`goal-${g.id}`}
            >
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

        <section class="goals-3d" aria-label="Create in 3D">
          <h2 class="goals-title">
            <Boxes size={20} /> Create in 3D <span class="new-pill">New</span>
          </h2>
          <div class="goals">
            {GOALS_3D.map((g) => (
              <button
                key={g.id}
                class={`goal tint-${g.tint}`}
                onClick={g.run}
                data-coach={`goal-${g.id}`}
              >
                <span class="goal-icon">
                  <g.icon size={26} />
                </span>
                <span class="goal-text">
                  <strong>{g.title}</strong>
                  <span>{g.text}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        {projects && projects.length > 0 && (
          <section class="recent">
            <h2>Your projects</h2>
            <div class="recent-grid">
              {projects.map((p) => (
                <div key={p.id} class="project-card">
                  <button
                    class="project-open"
                    onClick={() =>
                      void (p.is3d ? studio3d().then((m) => m.openScene(p.id)) : openProject(p.id))
                    }
                    aria-label={`Open ${p.name}`}
                  >
                    <div class="project-cover">
                      {covers.get(p.id) ? (
                        <img src={covers.get(p.id)} alt="" />
                      ) : (
                        <span class="project-cover-empty">
                          {p.is3d ? (
                            <Box size={28} />
                          ) : p.kind === 'photo' ? (
                            <WandSparkles size={28} />
                          ) : (
                            <Film size={28} />
                          )}
                        </span>
                      )}
                      <span class="project-kind">
                        {p.is3d
                          ? '3D'
                          : p.kind === 'photo'
                            ? 'Photo'
                            : p.duration > 0
                              ? formatDuration(p.duration)
                              : 'Video'}
                      </span>
                    </div>
                    <div class="project-meta">
                      <strong>{p.name}</strong>
                      <span class="faint">Edited {timeAgo(p.updatedAt)}</span>
                    </div>
                  </button>
                  <button
                    class="icon-btn small project-menu-btn"
                    aria-label="Project options"
                    onClick={() => setMenu(menu === p.id ? null : p.id)}
                  >
                    <EllipsisVertical size={18} />
                  </button>
                  {menu === p.id && (
                    <div class="menu" onPointerLeave={() => setMenu(null)}>
                      <button
                        onClick={async () => {
                          setMenu(null);
                          const name = await promptDialog('Rename project', 'Name', p.name);
                          if (name && name.trim()) {
                            const raw = (await (p.is3d
                              ? db.loadScene(p.id)
                              : db.loadProject(p.id))) as { id: string; name: string } | undefined;
                            if (raw) {
                              raw.name = name.trim();
                              await (p.is3d ? db.saveScene(raw) : db.saveProject(raw as never));
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
                          await (p.is3d
                            ? (await studio3d()).duplicateScene(p.id)
                            : duplicateProject(p.id));
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
                            message: p.is3d
                              ? `"${p.name}" will be removed from this device. Model files you imported stay wherever they are on your device. This can't be undone.`
                              : `"${p.name}" will be removed from this device. Your original photos and videos (on your device) are not affected. This can't be undone.`,
                            confirmLabel: 'Delete',
                            danger: true,
                          });
                          if (ok) {
                            await (p.is3d ? db.deleteScene(p.id) : deleteProjectById(p.id));
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
                Start any project and Kinora shows you around in 2 minutes. Every button explains
                itself — hover or press and hold.
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
