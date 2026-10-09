/**
 * Optional integration with a hosting frame (for example a claude.ai artifact
 * viewer), which may offer a "save this file" capability. Everywhere else
 * Kinora uses normal browser downloads and sharing.
 */
interface HostDownloads {
  save(req: { filename: string; data: Blob }): Promise<{ status: string }>;
}

interface HostWindow {
  claude?: { use?: (name: string) => Promise<unknown> };
}

const hostWindow = (typeof window !== 'undefined' ? window : undefined) as (Window & HostWindow) | undefined;

/** True when running inside a host frame that exposes capabilities. */
export const inHostFrame = typeof hostWindow?.claude?.use === 'function';

let downloads: Promise<HostDownloads | null> | null = null;

export function hostDownloads(): Promise<HostDownloads | null> {
  if (!inHostFrame) return Promise.resolve(null);
  downloads ??= (hostWindow!.claude!.use!('downloads') as Promise<HostDownloads | null>).catch(() => null);
  return downloads;
}

export type SaveOutcome = 'saved' | 'declined' | 'busy' | 'too-large' | 'unavailable';

/** Saves a file: through the host when it offers saving, otherwise as a browser download. */
export async function saveFile(blob: Blob, name: string): Promise<SaveOutcome> {
  const host = await hostDownloads();
  if (host) {
    try {
      await host.save({ filename: name, data: blob });
      return 'saved';
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'declined') return 'declined';
      if (code === 'rate_limited') return 'busy';
      if (code === 'too_large') return 'too-large';
      return 'unavailable';
    }
  }
  // A host frame without the capability also blocks downloads the page starts itself.
  if (inHostFrame && window.top !== window) return 'unavailable';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'saved';
}
