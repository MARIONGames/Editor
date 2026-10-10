/** Semantic app events. The coach listens to these to know what the user just did. */
export interface AppEvents {
  'project:opened': { kind: 'video' | 'photo' };
  'media:added': { count: number; kinds: string[] };
  'clip:selected': { id: string; type: string };
  'clip:split': { id: string };
  'clip:trimmed': { id: string };
  'clip:deleted': { count: number };
  'clip:moved': { id: string };
  'clip:duplicated': { id: string };
  'text:added': { id: string };
  'text:edited': { id: string };
  'sticker:added': { id: string };
  'music:added': { id: string };
  'transition:set': { id: string };
  'filter:set': { id: string };
  'adjust:changed': { key: string };
  'magic:used': { name: string };
  'playback:played': Record<string, never>;
  'playhead:moved': Record<string, never>;
  'canvas:changed': { width: number; height: number };
  'panel:opened': { panel: string };
  'export:started': { kind: 'image' | 'video' };
  'export:done': { kind: 'image' | 'video' };
  undo: Record<string, never>;
  '3d:opened': { kind: string };
  '3d:added': { kind: string };
  '3d:selected': { kind: string };
  '3d:transformed': { how: string };
  '3d:edited': { op: string };
  '3d:mode': { mode: string };
  '3d:material': { preset: string };
  '3d:modifier': { kind: string };
  '3d:keyed': { how: string };
  '3d:played': Record<string, never>;
  '3d:rendered': { kind: 'image' | 'video' | 'model' };
  /** Cloud sync added, changed or removed projects on this device. */
  'sync:changed': { count: number };
}

type Handler<K extends keyof AppEvents> = (payload: AppEvents[K]) => void;

const handlers = new Map<keyof AppEvents, Set<Handler<never>>>();

export function on<K extends keyof AppEvents>(event: K, handler: Handler<K>): () => void {
  let set = handlers.get(event);
  if (!set) handlers.set(event, (set = new Set()));
  set.add(handler as Handler<never>);
  return () => set!.delete(handler as Handler<never>);
}

export function emit<K extends keyof AppEvents>(event: K, payload: AppEvents[K]): void {
  const set = handlers.get(event);
  if (!set) return;
  for (const h of [...set]) {
    try {
      (h as Handler<K>)(payload);
    } catch (err) {
      console.error('event handler failed', event, err);
    }
  }
}
