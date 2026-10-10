/**
 * Cloud backup & sync. Offline-first: projects always live on the device and are saved
 * there first; when signed in and online, changes are copied to the account and changes
 * from other devices are brought in. Nothing ever waits for the network.
 *
 * Each project remembers which version was last in sync on both sides. If only one side
 * changed, that side wins; if both changed, both versions are kept (the other device's
 * copy is added as "… (other device)").
 */
import { signal } from '@preact/signals';
import { emit } from '../state/events';
import { route, toast } from '../state/store';
import * as db from '../storage/db';
import { uid as newId } from '../util/id';
import { ApiError, callRaw, OfflineError } from './api';
import { accountsEnabled, BACKUP_ENABLED } from './config';
import { account, authed, refreshAccount } from './session';
import { pack, packDerived, unpack, unpackDerived } from './serialize';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'full';

export interface SyncState {
  status: SyncStatus;
  lastSync: number | null;
  message: string | null;
}

const BACKUP_KEY = 'kinora.backup';

function readBackup(): boolean {
  try {
    return localStorage.getItem(BACKUP_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** "Back up automatically" (on by default once signed in). */
export const autoBackup = signal(readBackup());
export const syncState = signal<SyncState>({ status: 'idle', lastSync: null, message: null });

export function setAutoBackup(on: boolean): void {
  autoBackup.value = on;
  try {
    localStorage.setItem(BACKUP_KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
  if (on) requestSync(200);
}

interface Remote {
  id: string;
  kind: db.LocalKind;
  name: string;
  updatedAt: number;
  size: number;
  encoding: string;
  deleted: boolean;
}

/** Per project: change times last seen in sync (l = this device, r = the account). */
type Ledger = Record<string, { l: number; r: number; k: db.LocalKind }>;

const ledgerKey = (userId: string) => `kinora.sync.${userId}`;

function readLedger(userId: string): Ledger {
  try {
    return JSON.parse(localStorage.getItem(ledgerKey(userId)) ?? '{}') as Ledger;
  } catch {
    return {};
  }
}

function writeLedger(userId: string, l: Ledger): void {
  try {
    localStorage.setItem(ledgerKey(userId), JSON.stringify(l));
  } catch {
    /* worst case: the next sync re-checks everything */
  }
}

const MAX_MEDIA = 95 * 1024 * 1024;
const derivedId = (assetId: string) => `${assetId}__d`;

/** The project open right now: never replaced under the user's hands. */
function openId(): string | null {
  const r = route.peek();
  return r.name === 'editor' ? r.projectId : r.name === 'studio3d' ? r.sceneId : null;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> | null = null;

/** Syncs soon (debounced). Safe to call often. */
export function requestSync(delay = 1500): void {
  if (!BACKUP_ENABLED || !accountsEnabled || !account.peek() || !autoBackup.peek()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, delay);
}

export function syncNow(): Promise<void> {
  if (!BACKUP_ENABLED || !account.peek()) return Promise.resolve();
  running ??= run().finally(() => (running = null));
  return running;
}

async function run(): Promise<void> {
  const acc = account.peek();
  if (!acc) return;
  const userId = acc.user.id;
  syncState.value = { ...syncState.peek(), status: 'syncing', message: null };
  let changedHere = 0;
  const skipped: string[] = [];
  try {
    const remote = await authed(async (t) => {
      const res = await callRaw('/v1/items', { token: t });
      return ((await res.json()) as { items: Remote[] }).items;
    });
    const local = await db.listLocal();
    const ledger = readLedger(userId);
    const R = new Map(remote.map((r) => [r.id, r]));
    const L = new Map(local.map((l) => [l.id, l]));
    const open = openId();
    const ids = new Set([...R.keys(), ...L.keys(), ...Object.keys(ledger)]);

    for (const id of ids) {
      const l = L.get(id);
      const r = R.get(id);
      const s = ledger[id];
      if (l && (!r || r.deleted)) {
        // Deleted on another device and unchanged here since: remove it here too. (Only on an
        // explicit deletion marker — a project missing from the account is uploaded again.)
        if (r?.deleted && s && l.updatedAt <= s.l) {
          if (id !== open) {
            await db.deleteLocal(l.kind, id);
            delete ledger[id];
            changedHere++;
          }
        } else await upload(l, 0, ledger, skipped);
      } else if (l && r) {
        if (!s) {
          if (l.updatedAt === r.updatedAt)
            ledger[id] = { l: l.updatedAt, r: r.updatedAt, k: l.kind };
          else if (l.updatedAt > r.updatedAt) await upload(l, r.updatedAt, ledger, skipped);
          else if (id !== open) changedHere += await download(r, ledger);
          continue;
        }
        const here = l.updatedAt > s.l;
        const there = r.updatedAt > s.r;
        if (here && !there) await upload(l, s.r, ledger, skipped);
        else if (there && !here && id !== open) changedHere += await download(r, ledger);
        else if (here && there) {
          // Changed on both sides: keep the other device's version as a copy, then back up this one.
          changedHere += await download(r, ledger, true);
          await upload(l, r.updatedAt, ledger, skipped);
        }
      } else if (!l && r && !r.deleted) {
        if (s) {
          // Deleted on this device since the last sync.
          try {
            await authed((t) =>
              callRaw(`/v1/items/${id}?base=${s.r}`, { method: 'DELETE', token: t }),
            );
            delete ledger[id];
          } catch (err) {
            if (!(err instanceof ApiError && err.status === 409)) throw err;
            changedHere += await download(r, ledger); // Changed elsewhere meanwhile: bring it back.
          }
        } else changedHere += await download(r, ledger);
      } else delete ledger[id];
      writeLedger(userId, ledger);
    }
    writeLedger(userId, ledger);
    syncState.value = {
      status: 'idle',
      lastSync: Date.now(),
      message: skipped.length
        ? `${skipped.length} file(s) are too large for cloud backup and stay on this device only.`
        : null,
    };
    void refreshAccount().catch(() => undefined);
  } catch (err) {
    if (err instanceof OfflineError)
      syncState.value = { ...syncState.peek(), status: 'offline', message: null };
    else if (err instanceof ApiError && err.code === 'quota_full')
      syncState.value = { ...syncState.peek(), status: 'full', message: err.message };
    else if (err instanceof ApiError && err.status === 401)
      syncState.value = { status: 'idle', lastSync: null, message: null };
    else {
      console.warn('Sync failed', err);
      syncState.value = {
        ...syncState.peek(),
        status: 'error',
        message: err instanceof Error ? err.message : 'Backup failed.',
      };
    }
  } finally {
    if (changedHere) emit('sync:changed', { count: changedHere });
  }
}

/** Media of a project, plus thumbnails/waveforms for videos and songs. */
async function mediaFor(
  l: db.LocalItem,
): Promise<{ id: string; load: () => Promise<Blob | null> }[]> {
  const out: { id: string; load: () => Promise<Blob | null> }[] = [];
  for (const a of l.assets) {
    out.push({ id: a, load: async () => (await db.getMedia(a)) ?? null });
    if (l.kind === 'project') {
      out.push({
        id: derivedId(a),
        load: async () => {
          const d = await db.getDerived(a);
          return d ? packDerived(d) : null;
        },
      });
    }
  }
  return out;
}

async function upload(
  l: db.LocalItem,
  base: number,
  ledger: Ledger,
  skipped: string[],
): Promise<void> {
  const value = await db.getLocal(l.kind, l.id);
  if (!value) return;
  const media = await mediaFor(l);
  const sent: string[] = [];
  if (media.length) {
    const { missing } = await authed(async (t) => {
      const res = await callRaw('/v1/media/check', {
        method: 'POST',
        token: t,
        json: { ids: media.map((m) => m.id) },
      });
      return (await res.json()) as { missing: string[] };
    });
    const need = new Set(missing);
    for (const m of media) {
      if (!need.has(m.id)) {
        sent.push(m.id);
        continue;
      }
      const blob = await m.load();
      if (!blob) continue;
      if (blob.size > MAX_MEDIA) {
        skipped.push(m.id);
        continue;
      }
      await authed((t) =>
        callRaw(`/v1/media/${m.id}`, {
          method: 'PUT',
          token: t,
          body: blob,
          headers: { 'Content-Type': blob.type || 'application/octet-stream' },
          timeoutMs: 600_000,
        }),
      );
      sent.push(m.id);
    }
  }
  const { body, encoding } = await pack(value);
  try {
    await authed((t) =>
      callRaw(`/v1/items/${l.id}`, {
        method: 'PUT',
        token: t,
        body,
        timeoutMs: 300_000,
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Kinora-Kind': l.kind,
          'X-Kinora-Name': encodeURIComponent(l.name),
          'X-Kinora-Updated': String(l.updatedAt),
          'X-Kinora-Encoding': encoding,
          'X-Kinora-Assets': sent.join(','),
          'X-Kinora-Base': String(base),
        },
      }),
    );
    ledger[l.id] = { l: l.updatedAt, r: l.updatedAt, k: l.kind };
  } catch (err) {
    // Another device got there first: the next sync keeps both versions.
    if (err instanceof ApiError && err.status === 409) {
      if (ledger[l.id]) ledger[l.id]!.r = -1;
      requestSync(500);
      return;
    }
    throw err;
  }
}

/** Brings a project from the account onto this device. Returns 1 when something changed. */
async function download(r: Remote, ledger: Ledger, asCopy = false): Promise<number> {
  const res = await authed((t) => callRaw(`/v1/items/${r.id}`, { token: t, timeoutMs: 300_000 }));
  const value = await unpack<
    Record<string, unknown> & { id: string; name: string; updatedAt: number }
  >(await res.blob(), res.headers.get('X-Kinora-Encoding') ?? r.encoding);
  // Media first, so the project opens complete.
  const assets =
    r.kind === 'project'
      ? Object.keys((value.assets as Record<string, unknown>) ?? {})
      : db.sceneAssets(value as unknown as Parameters<typeof db.sceneAssets>[0]);
  for (const a of assets) {
    if (!(await db.getMedia(a))) {
      try {
        const m = await authed((t) => callRaw(`/v1/media/${a}`, { token: t, timeoutMs: 600_000 }));
        await db.putMedia(a, await m.blob());
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) throw err; // Too large to back up: stays missing.
      }
    }
    if (r.kind === 'project' && !(await db.getDerived(a))) {
      try {
        const d = await authed((t) => callRaw(`/v1/media/${derivedId(a)}`, { token: t }));
        await db.putDerived(a, await unpackDerived(await d.blob()));
      } catch {
        /* thumbnails are optional */
      }
    }
  }
  if (asCopy) {
    const copy = {
      ...value,
      id: newId(r.kind === 'project' ? 'p' : 's'),
      name: `${value.name} (other device)`,
    };
    await db.putLocal(r.kind, copy);
    return 1;
  }
  await db.putLocal(r.kind, value);
  ledger[r.id] = { l: value.updatedAt, r: r.updatedAt, k: r.kind };
  return 1;
}

/* ----------------------------------------------------------------- triggers */

let started = false;

/** Starts background sync (sign-in, coming back online, leaving a project, every few minutes). */
export function startSync(): void {
  if (started || !accountsEnabled || !BACKUP_ENABLED) return;
  started = true;
  requestSync(3000);
  window.addEventListener('online', () => requestSync(1000));
  window.addEventListener('offline', () => {
    if (account.peek()) syncState.value = { ...syncState.peek(), status: 'offline' };
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const last = syncState.peek().lastSync ?? 0;
      if (Date.now() - last > 120_000) requestSync(1000);
    }
  });
  setInterval(() => requestSync(0), 5 * 60_000);
  let prev = route.peek().name;
  route.subscribe((r) => {
    if (r.name === 'home' && prev !== 'home') requestSync(800);
    prev = r.name;
  });
  account.subscribe((a) => {
    if (a) requestSync(300);
    else syncState.value = { status: 'idle', lastSync: null, message: null };
  });
}

/** Human summary for the account screen and the home badge. */
export function syncLabel(s: SyncState): string {
  if (!autoBackup.value) return 'Backup is off';
  if (s.status === 'syncing') return 'Backing up…';
  if (s.status === 'offline') return 'Offline — will back up when you’re online';
  if (s.status === 'full') return 'Cloud storage is full';
  if (s.status === 'error') return 'Backup paused — will retry';
  if (!s.lastSync) return 'Not backed up yet';
  const mins = Math.round((Date.now() - s.lastSync) / 60_000);
  return mins < 1 ? 'Backed up just now' : mins < 60 ? `Backed up ${mins} min ago` : 'Backed up';
}

export function notifyDeleted(): void {
  requestSync(500);
}

export { toast };
