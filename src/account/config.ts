/**
 * Where the Kinora account service lives (server/worker.js on Cloudflare Workers).
 * VITE_KINORA_API at build time overrides it; set it to "off" to build without accounts.
 */
export const DEFAULT_API = 'https://kinora-api.rubby-studios.com';

function readBase(): string {
  // The sandboxed demo build can't reach other servers.
  if (import.meta.env.MODE === 'artifact') return '';
  const env = ((import.meta.env.VITE_KINORA_API as string | undefined) ?? '').trim();
  let base = env === 'off' ? '' : env || DEFAULT_API;
  try {
    // Developers can point a build at another server without rebuilding.
    base = localStorage.getItem('kinora.api') ?? base;
  } catch {
    /* storage blocked */
  }
  return base.trim().replace(/\/+$/, '');
}

export const API_BASE = readBase();
export const accountsEnabled = API_BASE !== '';

/**
 * Cloud backup of projects. Switched off for everyone: accounts only hold a name, email
 * and password, and every project stays on the device. (Turning it on needs the backup
 * endpoints and R2 storage on the server as well.)
 */
export const BACKUP_ENABLED = false;
