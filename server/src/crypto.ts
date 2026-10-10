/** Passwords, tokens and ids (Web Crypto, available in every Worker). */

/** Workers allow at most 100,000 PBKDF2 iterations. */
export const PBKDF2_ITERATIONS = 100_000;

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Short random id for users. */
export function randomId(): string {
  return `u${b64url(crypto.getRandomValues(new Uint8Array(12)))}`;
}

export async function sha256(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
  return b64url(d);
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string; iter: number }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return { hash: b64url(hash), salt: b64url(salt), iter: PBKDF2_ITERATIONS };
}

export async function verifyPassword(password: string, hash: string, salt: string, iter: number): Promise<boolean> {
  const got = await pbkdf2(password, fromB64url(salt), iter);
  const want = fromB64url(hash);
  if (got.length !== want.length) return false;
  // Constant-time comparison (a Workers extension to Web Crypto).
  return crypto.subtle.timingSafeEqual(got, want);
}
