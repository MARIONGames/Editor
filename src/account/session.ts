/**
 * The optional Kinora account: who is signed in on this device and the account actions.
 * Nothing here is needed to use Kinora; the app never waits for the network.
 */
import { signal } from '@preact/signals';
import { EULA_VERSION } from '../legal/eula';
import { toast } from '../state/store';
import { ApiError, call } from './api';

export interface AccountUser {
  id: string;
  email: string;
  name: string;
  createdAt: number;
}

export interface Usage {
  bytes: number;
  quota: number;
}

interface Stored {
  token: string;
  user: AccountUser;
}

const KEY = 'kinora.account';

function load(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

function store(v: Stored | null): void {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: signed in for this session only */
  }
}

export const account = signal<Stored | null>(load());
export const usage = signal<Usage | null>(null);

function setAccount(v: Stored | null): void {
  account.value = v;
  store(v);
  if (!v) usage.value = null;
}

export function token(): string | null {
  return account.peek()?.token ?? null;
}

/** The server no longer accepts this device's session: sign out locally, keep all projects. */
export function sessionEnded(): void {
  if (!account.peek()) return;
  setAccount(null);
  toast(
    'You’ve been signed out of your Kinora account. Your projects are still here — sign in again to keep backing them up.',
    'info',
    undefined,
    7000,
  );
}

/** Wraps a signed-in call: a 401 means the session ended elsewhere. */
async function authed<T>(fn: (t: string) => Promise<T>): Promise<T> {
  const t = token();
  if (!t) throw new ApiError(401, 'signed_out', 'Please sign in.');
  try {
    return await fn(t);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) sessionEnded();
    throw err;
  }
}

export async function signUp(name: string, email: string, password: string): Promise<void> {
  const r = await call<Stored>('/v1/auth/signup', {
    method: 'POST',
    json: { name, email, password, eula: EULA_VERSION },
  });
  setAccount(r);
}

export async function signIn(email: string, password: string): Promise<void> {
  const r = await call<Stored>('/v1/auth/login', { method: 'POST', json: { email, password } });
  setAccount(r);
}

export async function signOut(): Promise<void> {
  const t = token();
  setAccount(null);
  // Best effort: the device forgets the session either way.
  if (t) await call('/v1/auth/logout', { method: 'POST', token: t }).catch(() => undefined);
}

export async function refreshAccount(): Promise<void> {
  const r = await authed((t) => call<{ user: AccountUser; usage: Usage }>('/v1/me', { token: t }));
  const cur = account.peek();
  if (cur) setAccount({ ...cur, user: r.user });
  usage.value = r.usage;
}

export async function rename(name: string): Promise<void> {
  const r = await authed((t) =>
    call<{ user: AccountUser }>('/v1/me', { method: 'PATCH', token: t, json: { name } }),
  );
  const cur = account.peek();
  if (cur) setAccount({ ...cur, user: r.user });
}

export async function changePassword(current: string, next: string): Promise<void> {
  await authed((t) =>
    call('/v1/me/password', { method: 'POST', token: t, json: { current, next } }),
  );
}

export async function forgotPassword(email: string): Promise<void> {
  await call('/v1/auth/forgot', { method: 'POST', json: { email } });
}

export async function resetPassword(resetToken: string, password: string): Promise<void> {
  const r = await call<Stored>('/v1/auth/reset', {
    method: 'POST',
    json: { token: resetToken, password },
  });
  setAccount(r);
}

/** Deletes the account and its cloud backups. Projects on this device stay. */
export async function deleteAccount(password: string): Promise<void> {
  await authed((t) => call('/v1/me', { method: 'DELETE', token: t, json: { password } }));
  const uid = account.peek()?.user.id;
  setAccount(null);
  try {
    if (uid) localStorage.removeItem(`kinora.sync.${uid}`);
  } catch {
    /* ignore */
  }
}

export { authed };
