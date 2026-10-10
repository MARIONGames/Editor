/**
 * Where the Kinora account service lives. Set at build time with VITE_KINORA_API
 * (e.g. in .env.production). Without it, accounts are hidden and Kinora works exactly
 * as before — everything stays on the device.
 */
function readBase(): string {
  // The sandboxed demo build can't reach other servers.
  if (import.meta.env.MODE === 'artifact') return '';
  let base = (import.meta.env.VITE_KINORA_API as string | undefined) ?? '';
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
