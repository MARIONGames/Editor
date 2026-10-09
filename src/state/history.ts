import type { ID, Project } from '../model/types';

export interface HistoryEntry {
  project: Project;
  selection: ID | null;
  label: string;
}

const LIMIT = 250;
/** Commits with the same coalesce key within this window become one undo step. */
const COALESCE_MS = 1200;

/**
 * Undo/redo stack of immutable project snapshots. Because projects share structure,
 * keeping hundreds of snapshots costs very little memory.
 */
export class History {
  past: HistoryEntry[] = [];
  future: HistoryEntry[] = [];
  private lastKey: string | null = null;
  private lastTime = 0;

  /** Record the state *before* a change. */
  record(prev: Project, selection: ID | null, label: string, coalesceKey?: string): void {
    const now = Date.now();
    if (coalesceKey && coalesceKey === this.lastKey && now - this.lastTime < COALESCE_MS) {
      this.lastTime = now;
      this.future = [];
      return;
    }
    this.past.push({ project: prev, selection, label });
    if (this.past.length > LIMIT) this.past.shift();
    this.future = [];
    this.lastKey = coalesceKey ?? null;
    this.lastTime = now;
  }

  /** Ends the current coalescing run (e.g. on pointer up). */
  breakCoalescing(): void {
    this.lastKey = null;
  }

  undo(current: HistoryEntry): HistoryEntry | null {
    const entry = this.past.pop();
    if (!entry) return null;
    // The redo entry carries the label of the change being undone.
    this.future.push({ ...current, label: entry.label });
    this.lastKey = null;
    return entry;
  }

  redo(current: HistoryEntry): HistoryEntry | null {
    const entry = this.future.pop();
    if (!entry) return null;
    this.past.push({ ...current, label: entry.label });
    this.lastKey = null;
    return entry;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.lastKey = null;
  }

  get undoLabel(): string | null {
    return this.past.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.future.at(-1)?.label ?? null;
  }
}
