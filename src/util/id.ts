/** Short, URL-safe unique id. */
export function uid(prefix = ''): string {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = new Uint8Array(9);
    c.getRandomValues(bytes);
    let s = '';
    for (const b of bytes) s += ALPHABET[b & 63];
    return prefix + s;
  }
  return prefix + Math.random().toString(36).slice(2, 11);
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
