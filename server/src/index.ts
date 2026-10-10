/**
 * Kinora accounts & cloud backup API — a Cloudflare Worker.
 *
 * D1 holds accounts, sessions and the list of backed-up projects; R2 holds the project
 * files and media. The Kinora app works fully without this service (and offline): an
 * account only adds backup and sync between devices.
 *
 * © 2026 Marios Kouretis. All rights reserved.
 */
import { hashPassword, randomId, randomToken, sha256, verifyPassword } from './crypto';

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  /** Comma-separated origins allowed to call the API ("*" = any). */
  ALLOWED_ORIGINS: string;
  QUOTA_MB: string;
  APP_URL: string;
  MAIL_FROM: string;
  /** Optional: enables password-reset emails (https://resend.com). */
  RESEND_API_KEY?: string;
}

const VERSION = '1.0.0';
const DAY = 86_400_000;
const SESSION_DAYS = 60;
const MAX_ITEM_BYTES = 50 * 1024 * 1024;
/** Workers accept request bodies up to 100 MB on the free plan. */
const MAX_MEDIA_BYTES = 95 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  pw_hash: string;
  pw_salt: string;
  pw_iter: number;
  created_at: number;
}

interface Session {
  user: UserRow;
  tokenHash: string;
}

/* ------------------------------------------------------------------ http */

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

const noContent = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  const ok = origin && (allowed.includes('*') || allowed.includes(origin));
  return {
    ...(ok ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, X-Kinora-Kind, X-Kinora-Name, X-Kinora-Updated, X-Kinora-Encoding, X-Kinora-Assets, X-Kinora-Base',
    'Access-Control-Expose-Headers': 'X-Kinora-Kind, X-Kinora-Name, X-Kinora-Updated, X-Kinora-Encoding',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'bad_request', 'The request was not valid JSON.');
  }
}

function str(v: unknown, field: string, min: number, max: number): string {
  if (typeof v !== 'string' || v.length < min || v.length > max) {
    throw new HttpError(400, 'invalid_' + field, `Please check the ${field}.`);
  }
  return v;
}

function clientIp(req: Request): string {
  return req.headers.get('CF-Connecting-IP') ?? 'unknown';
}

/* ---------------------------------------------------------------- worker */

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const cors = corsHeaders(req.headers.get('Origin'), env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let res: Response;
    try {
      res = await route(req, env, ctx);
    } catch (err) {
      if (err instanceof HttpError) res = json({ error: { code: err.code, message: err.message } }, err.status);
      else {
        console.error(err);
        res = json({ error: { code: 'server_error', message: 'Something went wrong on our side. Please try again.' } }, 500);
      }
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },

  /** Daily clean-up of expired sessions, reset links and old failed sign-ins. */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
      env.DB.prepare('DELETE FROM reset_tokens WHERE expires_at < ?').bind(now),
      env.DB.prepare('DELETE FROM auth_failures WHERE at < ?').bind(now - DAY),
    ]);
  },
} satisfies ExportedHandler<Env>;

async function route(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;

  if (path === '/' || path === '/v1/health') return json({ ok: true, service: 'kinora-api', version: VERSION });

  if (path === '/v1/auth/signup' && m === 'POST') return signup(req, env);
  if (path === '/v1/auth/login' && m === 'POST') return login(req, env);
  if (path === '/v1/auth/forgot' && m === 'POST') return forgot(req, env);
  if (path === '/v1/auth/reset' && m === 'POST') return reset(req, env);

  const session = await authenticate(req, env);
  const uid = session.user.id;

  if (path === '/v1/auth/logout' && m === 'POST') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(session.tokenHash).run();
    return noContent();
  }
  if (path === '/v1/me') {
    if (m === 'GET') return json({ user: publicUser(session.user), usage: await usage(env, uid) });
    if (m === 'PATCH') return updateMe(req, env, session);
    if (m === 'DELETE') return deleteAccount(req, env, session);
  }
  if (path === '/v1/me/password' && m === 'POST') return changePassword(req, env, session);

  if (path === '/v1/items' && m === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, kind, name, updated_at, size, encoding, deleted FROM items WHERE user_id = ? ORDER BY updated_at DESC',
    )
      .bind(uid)
      .all<{ id: string; kind: string; name: string; updated_at: number; size: number; encoding: string; deleted: number }>();
    return json({
      items: results.map((r) => ({ id: r.id, kind: r.kind, name: r.name, updatedAt: r.updated_at, size: r.size, encoding: r.encoding, deleted: !!r.deleted })),
      serverTime: Date.now(),
    });
  }
  const item = /^\/v1\/items\/([^/]+)$/.exec(path);
  if (item) {
    const id = item[1]!;
    if (!ID_RE.test(id)) throw new HttpError(400, 'invalid_id', 'Invalid project id.');
    if (m === 'GET') return getItem(env, uid, id);
    if (m === 'PUT') return putItem(req, env, ctx, uid, id);
    if (m === 'DELETE') return deleteItem(req, env, ctx, uid, id);
  }
  if (path === '/v1/media/check' && m === 'POST') {
    const { ids } = await body<{ ids?: unknown }>(req);
    if (!Array.isArray(ids) || ids.length > 5000 || !ids.every((x) => typeof x === 'string' && ID_RE.test(x))) {
      throw new HttpError(400, 'invalid_ids', 'Invalid media list.');
    }
    const have = new Set<string>();
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90) as string[];
      const { results } = await env.DB.prepare(`SELECT asset_id FROM media WHERE user_id = ? AND asset_id IN (${chunk.map(() => '?').join(',')})`)
        .bind(uid, ...chunk)
        .all<{ asset_id: string }>();
      for (const r of results) have.add(r.asset_id);
    }
    return json({ missing: (ids as string[]).filter((x) => !have.has(x)) });
  }
  const media = /^\/v1\/media\/([^/]+)$/.exec(path);
  if (media) {
    const id = media[1]!;
    if (!ID_RE.test(id)) throw new HttpError(400, 'invalid_id', 'Invalid media id.');
    if (m === 'GET') {
      const obj = await env.FILES.get(`u/${uid}/m/${id}`);
      if (!obj) throw new HttpError(404, 'not_found', 'That file is not in your cloud backup.');
      return new Response(obj.body, {
        headers: { 'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream', 'Cache-Control': 'private, max-age=31536000, immutable' },
      });
    }
    if (m === 'PUT') return putMedia(req, env, uid, id);
  }
  throw new HttpError(404, 'not_found', 'Unknown address.');
}

/* ------------------------------------------------------------------ auth */

function publicUser(u: UserRow) {
  return { id: u.id, email: u.email, name: u.name, createdAt: u.created_at };
}

async function createSession(env: Env, userId: string, req: Request): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen, device) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await sha256(token), userId, now, now + SESSION_DAYS * DAY, now, (req.headers.get('User-Agent') ?? '').slice(0, 160))
    .run();
  return token;
}

async function authenticate(req: Request, env: Env): Promise<Session> {
  const h = req.headers.get('Authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token || token.length > 200) throw new HttpError(401, 'signed_out', 'Please sign in.');
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT s.expires_at, s.last_seen, u.id, u.email, u.name, u.pw_hash, u.pw_salt, u.pw_iter, u.created_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<UserRow & { expires_at: number; last_seen: number }>();
  const now = Date.now();
  if (!row || row.expires_at < now) throw new HttpError(401, 'signed_out', 'Your session has ended. Please sign in again.');
  // Sliding expiry: active devices stay signed in.
  if (now - row.last_seen > DAY) {
    await env.DB.prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?').bind(now, now + SESSION_DAYS * DAY, tokenHash).run();
  }
  return { user: row, tokenHash };
}

/** Counts recent events for a key (failed sign-ins, sign-ups) to slow down abuse. */
async function tooMany(env: Env, key: string, limit: number, windowMs: number): Promise<boolean> {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM auth_failures WHERE key = ? AND at > ?').bind(key, Date.now() - windowMs).first<{ n: number }>();
  return (r?.n ?? 0) >= limit;
}

async function note(env: Env, ...keys: string[]): Promise<void> {
  const now = Date.now();
  await env.DB.batch(keys.map((k) => env.DB.prepare('INSERT INTO auth_failures (key, at) VALUES (?, ?)').bind(k, now)));
}

async function signup(req: Request, env: Env): Promise<Response> {
  const b = await body<{ email?: unknown; password?: unknown; name?: unknown; eula?: unknown }>(req);
  const email = str(b.email, 'email', 3, 254).trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'invalid_email', 'That email address doesn’t look right.');
  const password = str(b.password, 'password', 8, 200);
  const name = str(b.name ?? email.split('@')[0], 'name', 1, 80).trim().slice(0, 60) || 'Kinora user';
  const eula = str(b.eula, 'eula', 1, 40);
  const ip = clientIp(req);
  if (await tooMany(env, `signup:${ip}`, 10, 3_600_000)) throw new HttpError(429, 'slow_down', 'Too many new accounts from here. Please try again later.');
  const exists = await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
  if (exists) throw new HttpError(409, 'email_taken', 'There is already an account with this email. Try signing in.');
  const pw = await hashPassword(password);
  const id = randomId();
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO users (id, email, name, pw_hash, pw_salt, pw_iter, eula_version, eula_accepted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, email, name, pw.hash, pw.salt, pw.iter, eula, now, now, now)
    .run();
  await note(env, `signup:${ip}`);
  const token = await createSession(env, id, req);
  return json({ token, user: { id, email, name, createdAt: now } }, 201);
}

async function login(req: Request, env: Env): Promise<Response> {
  const b = await body<{ email?: unknown; password?: unknown }>(req);
  const email = str(b.email, 'email', 3, 254).trim().toLowerCase();
  const password = str(b.password, 'password', 1, 200);
  const ip = clientIp(req);
  if ((await tooMany(env, `login:${email}`, 10, 15 * 60_000)) || (await tooMany(env, `ip:${ip}`, 60, 15 * 60_000))) {
    throw new HttpError(429, 'slow_down', 'Too many attempts. Please wait 15 minutes and try again.');
  }
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
  const ok = user ? await verifyPassword(password, user.pw_hash, user.pw_salt, user.pw_iter) : (await hashPassword(password), false);
  if (!user || !ok) {
    await note(env, `login:${email}`, `ip:${ip}`);
    throw new HttpError(401, 'wrong_login', 'Wrong email or password.');
  }
  await env.DB.prepare('DELETE FROM auth_failures WHERE key = ?').bind(`login:${email}`).run();
  const token = await createSession(env, user.id, req);
  return json({ token, user: publicUser(user) });
}

async function updateMe(req: Request, env: Env, s: Session): Promise<Response> {
  const b = await body<{ name?: unknown }>(req);
  const name = str(b.name, 'name', 1, 80).trim().slice(0, 60);
  if (!name) throw new HttpError(400, 'invalid_name', 'Please enter a name.');
  await env.DB.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?').bind(name, Date.now(), s.user.id).run();
  return json({ user: publicUser({ ...s.user, name }) });
}

async function changePassword(req: Request, env: Env, s: Session): Promise<Response> {
  const b = await body<{ current?: unknown; next?: unknown }>(req);
  const current = str(b.current, 'password', 1, 200);
  const next = str(b.next, 'new password', 8, 200);
  if (!(await verifyPassword(current, s.user.pw_hash, s.user.pw_salt, s.user.pw_iter))) {
    throw new HttpError(403, 'wrong_password', 'Your current password is not right.');
  }
  const pw = await hashPassword(next);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ?, updated_at = ? WHERE id = ?').bind(pw.hash, pw.salt, pw.iter, Date.now(), s.user.id),
    // Other devices have to sign in again with the new password.
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').bind(s.user.id, s.tokenHash),
  ]);
  return noContent();
}

async function deleteAccount(req: Request, env: Env, s: Session): Promise<Response> {
  const b = await body<{ password?: unknown }>(req);
  const password = str(b.password, 'password', 1, 200);
  if (!(await verifyPassword(password, s.user.pw_hash, s.user.pw_salt, s.user.pw_iter))) {
    throw new HttpError(403, 'wrong_password', 'That password is not right.');
  }
  // Every file first, then the account (sessions, items and media rows cascade).
  let cursor: string | undefined;
  do {
    const list = await env.FILES.list({ prefix: `u/${s.user.id}/`, cursor, limit: 1000 });
    if (list.objects.length) await env.FILES.delete(list.objects.map((o) => o.key));
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(s.user.id).run();
  return noContent();
}

async function forgot(req: Request, env: Env): Promise<Response> {
  const b = await body<{ email?: unknown }>(req);
  const email = str(b.email, 'email', 3, 254).trim().toLowerCase();
  if (!env.RESEND_API_KEY) throw new HttpError(501, 'email_unavailable', 'Password reset by email is not set up on this server.');
  const ip = clientIp(req);
  if (await tooMany(env, `forgot:${ip}`, 10, 3_600_000)) throw new HttpError(429, 'slow_down', 'Too many requests. Please try again later.');
  await note(env, `forgot:${ip}`);
  const user = await env.DB.prepare('SELECT id, email, name FROM users WHERE email = ?').bind(email).first<{ id: string; email: string; name: string }>();
  // Same answer whether or not the account exists (no account fishing).
  if (!user) return noContent();
  const token = randomToken();
  await env.DB.prepare('INSERT INTO reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), user.id, Date.now() + 3_600_000)
    .run();
  const link = `${env.APP_URL.replace(/#.*$/, '')}#/reset/${token}`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [user.email],
      subject: 'Reset your Kinora password',
      text: `Hi ${user.name},\n\nOpen this link within an hour to choose a new Kinora password:\n${link}\n\nIf you didn't ask for this, you can ignore this email.\n\n© 2026 Marios Kouretis. All rights reserved.`,
      html: `<p>Hi ${escapeHtml(user.name)},</p><p><a href="${link}">Choose a new Kinora password</a> (the link works for one hour).</p><p>If you didn't ask for this, you can ignore this email.</p><p style="color:#888;font-size:12px">© 2026 Marios Kouretis. All rights reserved.</p>`,
    }),
  });
  if (!res.ok) {
    console.error('Resend failed', res.status, await res.text());
    throw new HttpError(502, 'email_failed', 'We couldn’t send the email. Please try again later.');
  }
  return noContent();
}

async function reset(req: Request, env: Env): Promise<Response> {
  const b = await body<{ token?: unknown; password?: unknown }>(req);
  const token = str(b.token, 'link', 10, 200);
  const password = str(b.password, 'password', 8, 200);
  const hash = await sha256(token);
  const row = await env.DB.prepare('SELECT user_id, expires_at FROM reset_tokens WHERE token_hash = ?').bind(hash).first<{ user_id: string; expires_at: number }>();
  if (!row || row.expires_at < Date.now()) throw new HttpError(400, 'link_expired', 'This reset link has expired. Ask for a new one.');
  const pw = await hashPassword(password);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ?, updated_at = ? WHERE id = ?').bind(pw.hash, pw.salt, pw.iter, Date.now(), row.user_id),
    env.DB.prepare('DELETE FROM reset_tokens WHERE user_id = ?').bind(row.user_id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.user_id),
  ]);
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(row.user_id).first<UserRow>();
  const sessionToken = await createSession(env, row.user_id, req);
  return json({ token: sessionToken, user: publicUser(user!) });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/* --------------------------------------------------------------- storage */

async function usage(env: Env, uid: string): Promise<{ bytes: number; quota: number }> {
  const r = await env.DB.prepare(
    `SELECT (SELECT COALESCE(SUM(size), 0) FROM items WHERE user_id = ?1 AND deleted = 0) +
            (SELECT COALESCE(SUM(size), 0) FROM media WHERE user_id = ?1) AS bytes`,
  )
    .bind(uid)
    .first<{ bytes: number }>();
  return { bytes: r?.bytes ?? 0, quota: Number(env.QUOTA_MB || '2048') * 1024 * 1024 };
}

function contentLength(req: Request, max: number): number {
  const n = Number(req.headers.get('Content-Length') ?? NaN);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(411, 'length_required', 'Missing file size.');
  if (n > max) throw new HttpError(413, 'too_large', `This file is too large for cloud backup (limit ${Math.round(max / 1048576)} MB).`);
  return n;
}

async function checkQuota(env: Env, uid: string, adding: number, replacing = 0): Promise<void> {
  const u = await usage(env, uid);
  if (u.bytes - replacing + adding > u.quota) throw new HttpError(507, 'quota_full', 'Your cloud storage is full. Delete some backed-up projects to make room.');
}

async function getItem(env: Env, uid: string, id: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT kind, name, updated_at, encoding FROM items WHERE user_id = ? AND id = ? AND deleted = 0')
    .bind(uid, id)
    .first<{ kind: string; name: string; updated_at: number; encoding: string }>();
  const obj = row ? await env.FILES.get(`u/${uid}/items/${id}`) : null;
  if (!row || !obj) throw new HttpError(404, 'not_found', 'That project is not in your cloud backup.');
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Kinora-Kind': row.kind,
      'X-Kinora-Name': encodeURIComponent(row.name),
      'X-Kinora-Updated': String(row.updated_at),
      'X-Kinora-Encoding': row.encoding,
    },
  });
}

async function putItem(req: Request, env: Env, ctx: ExecutionContext, uid: string, id: string): Promise<Response> {
  const kind = req.headers.get('X-Kinora-Kind') ?? '';
  if (kind !== 'project' && kind !== 'scene') throw new HttpError(400, 'invalid_kind', 'Unknown project type.');
  const name = decodeURIComponent(req.headers.get('X-Kinora-Name') ?? '').slice(0, 120) || 'Untitled';
  const updatedAt = Number(req.headers.get('X-Kinora-Updated'));
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) throw new HttpError(400, 'invalid_updated', 'Missing change time.');
  const encoding = req.headers.get('X-Kinora-Encoding') === 'gzip' ? 'gzip' : '';
  const assetsRaw = req.headers.get('X-Kinora-Assets') ?? '';
  const assets = assetsRaw ? assetsRaw.split(',') : [];
  if (assets.length > 5000 || !assets.every((a) => ID_RE.test(a))) throw new HttpError(400, 'invalid_assets', 'Invalid media list.');
  const base = Number(req.headers.get('X-Kinora-Base') ?? '0');
  const size = contentLength(req, MAX_ITEM_BYTES);
  const cur = await env.DB.prepare('SELECT updated_at, size, deleted FROM items WHERE user_id = ? AND id = ?')
    .bind(uid, id)
    .first<{ updated_at: number; size: number; deleted: number }>();
  // Another device changed it since this device last synced: let the app decide.
  if (cur && !cur.deleted && cur.updated_at !== base && cur.updated_at !== updatedAt) {
    throw new HttpError(409, 'conflict', 'This project was changed on another device.');
  }
  await checkQuota(env, uid, size, cur && !cur.deleted ? cur.size : 0);
  await env.FILES.put(`u/${uid}/items/${id}`, req.body, { httpMetadata: { contentType: 'application/octet-stream' } });
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO items (user_id, id, kind, name, updated_at, size, encoding, assets, deleted, server_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT (user_id, id) DO UPDATE SET kind = excluded.kind, name = excluded.name, updated_at = excluded.updated_at,
       size = excluded.size, encoding = excluded.encoding, assets = excluded.assets, deleted = 0, server_at = excluded.server_at`,
  )
    .bind(uid, id, kind, name, updatedAt, size, encoding, JSON.stringify(assets), now)
    .run();
  ctx.waitUntil(collectMedia(env, uid));
  return json({ item: { id, kind, name, updatedAt, size, encoding, deleted: false } });
}

async function deleteItem(req: Request, env: Env, ctx: ExecutionContext, uid: string, id: string): Promise<Response> {
  const base = Number(new URL(req.url).searchParams.get('base') ?? '0');
  const cur = await env.DB.prepare('SELECT updated_at, deleted FROM items WHERE user_id = ? AND id = ?').bind(uid, id).first<{ updated_at: number; deleted: number }>();
  if (!cur) return noContent();
  if (!cur.deleted && base && cur.updated_at !== base) throw new HttpError(409, 'conflict', 'This project was changed on another device.');
  const now = Date.now();
  // Keep a small "deleted" marker so other devices also remove their copy.
  await env.DB.prepare("UPDATE items SET deleted = 1, size = 0, assets = '[]', updated_at = ?, server_at = ? WHERE user_id = ? AND id = ?")
    .bind(now, now, uid, id)
    .run();
  await env.FILES.delete(`u/${uid}/items/${id}`);
  ctx.waitUntil(collectMedia(env, uid));
  return noContent();
}

async function putMedia(req: Request, env: Env, uid: string, id: string): Promise<Response> {
  const size = contentLength(req, MAX_MEDIA_BYTES);
  const exists = await env.DB.prepare('SELECT size FROM media WHERE user_id = ? AND asset_id = ?').bind(uid, id).first<{ size: number }>();
  if (exists) return noContent(); // Media never changes once imported.
  await checkQuota(env, uid, size);
  const type = (req.headers.get('Content-Type') ?? 'application/octet-stream').slice(0, 100);
  await env.FILES.put(`u/${uid}/m/${id}`, req.body, { httpMetadata: { contentType: type } });
  await env.DB.prepare('INSERT OR REPLACE INTO media (user_id, asset_id, size, type, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(uid, id, size, type, Date.now())
    .run();
  return noContent();
}

/** Deletes media no backed-up project uses any more (fresh uploads get an hour of grace). */
async function collectMedia(env: Env, uid: string): Promise<void> {
  const { results: items } = await env.DB.prepare('SELECT assets FROM items WHERE user_id = ? AND deleted = 0').bind(uid).all<{ assets: string }>();
  const used = new Set<string>();
  for (const r of items) for (const a of JSON.parse(r.assets) as string[]) used.add(a);
  const { results: media } = await env.DB.prepare('SELECT asset_id FROM media WHERE user_id = ? AND created_at < ?')
    .bind(uid, Date.now() - 3_600_000)
    .all<{ asset_id: string }>();
  const unused = media.map((m) => m.asset_id).filter((a) => !used.has(a));
  for (let i = 0; i < unused.length; i += 500) {
    const chunk = unused.slice(i, i + 500);
    await env.FILES.delete(chunk.map((a) => `u/${uid}/m/${a}`));
    await env.DB.batch(chunk.map((a) => env.DB.prepare('DELETE FROM media WHERE user_id = ? AND asset_id = ?').bind(uid, a)));
  }
}
