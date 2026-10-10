// @ts-check
/**
 * Kinora accounts — Cloudflare Worker (paste this whole file into the Workers editor).
 * Needs one D1 database bound as `DB`. The tables are created automatically.
 * Optional variable: ALLOWED_ORIGINS (comma-separated sites allowed to use the API).
 *
 * © 2026 Marios Kouretis. All rights reserved.
 */

const VERSION = '1.0.0';
const DAY = 86_400_000;
const SESSION_DAYS = 60;
const ITERATIONS = 100_000; // PBKDF2 rounds (the Workers maximum)
const DEFAULT_ORIGINS = 'https://mariongames.github.io,app://kinora,http://localhost:5173,http://localhost:4173';
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    pw_hash TEXT NOT NULL,
    pw_salt TEXT NOT NULL,
    pw_iter INTEGER NOT NULL,
    recovery_hash TEXT NOT NULL,
    eula_version TEXT NOT NULL,
    eula_accepted_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    device TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS auth_failures (key TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS auth_failures_key ON auth_failures(key, at)`,
];

/** @typedef {{ DB: D1Database; ALLOWED_ORIGINS?: string }} Env */
/** @typedef {{ id: string; email: string; name: string; pw_hash: string; pw_salt: string; pw_iter: number; recovery_hash: string; created_at: number }} User */

class HttpError extends Error {
  /** @param {number} status @param {string} code @param {string} message */
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* ------------------------------------------------------------------ helpers */

/** @param {unknown} data @param {number} [status] */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

const noContent = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

/** @param {string | null} origin @param {Env} env @returns {Record<string, string>} */
function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map((s) => s.trim());
  const ok = origin && (allowed.includes('*') || allowed.includes(origin));
  return {
    ...(ok ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** @param {Request} req @returns {Promise<Record<string, unknown>>} */
async function body(req) {
  try {
    const b = await req.json();
    if (b && typeof b === 'object') return /** @type {Record<string, unknown>} */ (b);
  } catch {
    /* fall through */
  }
  throw new HttpError(400, 'bad_request', 'The request was not valid JSON.');
}

/** @param {unknown} v @param {string} field @param {number} min @param {number} max */
function text(v, field, min, max) {
  if (typeof v !== 'string' || v.length < min || v.length > max) throw new HttpError(400, `invalid_${field}`, `Please check the ${field}.`);
  return v;
}

/** @param {Request} req */
const ipOf = (req) => req.headers.get('CF-Connecting-IP') || 'unknown';

/* ------------------------------------------------------------------- crypto */

const enc = new TextEncoder();

/** @param {Uint8Array} bytes */
function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} s */
function fromB64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const randomBytes = (/** @type {number} */ n) => crypto.getRandomValues(new Uint8Array(n));

/** @param {string} s */
async function sha256(s) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));
}

/** @param {string} password @param {Uint8Array} salt @param {number} iterations */
async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

/** @param {string} password */
async function hashPassword(password) {
  const salt = randomBytes(16);
  return { hash: b64url(await pbkdf2(password, salt, ITERATIONS)), salt: b64url(salt), iter: ITERATIONS };
}

/** @param {string} password @param {User} u */
async function passwordOk(password, u) {
  const got = await pbkdf2(password, fromB64url(u.pw_salt), u.pw_iter);
  const want = fromB64url(u.pw_hash);
  return got.length === want.length && crypto.subtle.timingSafeEqual(got, want);
}

/** A code people write down to get back in if they forget their password (no email needed). */
function newRecoveryCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = randomBytes(20);
  let s = '';
  for (let i = 0; i < 20; i++) s += abc[r[i] % 32] + (i % 5 === 4 && i < 19 ? '-' : '');
  return s;
}

/** @param {string} code */
const recoveryHash = (code) => sha256(`kinora-recovery:${code.toUpperCase().replace(/[^A-Z0-9]/g, '')}`);

/* ----------------------------------------------------------------- database */

/** @type {Promise<unknown> | null} */
let schemaReady = null;

/** @param {Env} env */
function ensureSchema(env) {
  if (!env.DB) throw new HttpError(500, 'no_database', 'The database is not connected (add a D1 binding named DB).');
  schemaReady ??= env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s))).catch((e) => {
    schemaReady = null;
    throw e;
  });
  return schemaReady;
}

/** @param {User} u */
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, createdAt: u.created_at });

/** @param {Env} env @param {string} userId @param {Request} req */
async function newSession(env, userId, req) {
  const token = b64url(randomBytes(32));
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen, device) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await sha256(token), userId, now, now + SESSION_DAYS * DAY, now, (req.headers.get('User-Agent') || '').slice(0, 160))
    .run();
  return token;
}

/** @param {Request} req @param {Env} env @returns {Promise<{ user: User; tokenHash: string }>} */
async function signedIn(req, env) {
  const h = req.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token || token.length > 200) throw new HttpError(401, 'signed_out', 'Please sign in.');
  const tokenHash = await sha256(token);
  const row = /** @type {(User & { expires_at: number; last_seen: number }) | null} */ (
    await env.DB.prepare('SELECT s.expires_at, s.last_seen, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').bind(tokenHash).first()
  );
  const now = Date.now();
  if (!row || row.expires_at < now) throw new HttpError(401, 'signed_out', 'Your session has ended. Please sign in again.');
  if (now - row.last_seen > DAY) {
    await env.DB.prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?').bind(now, now + SESSION_DAYS * DAY, tokenHash).run();
  }
  return { user: row, tokenHash };
}

/** Counts recent attempts (to slow down password guessing). @param {Env} env @param {string} key @param {number} limit @param {number} windowMs */
async function tooMany(env, key, limit, windowMs) {
  const r = /** @type {{ n: number } | null} */ (await env.DB.prepare('SELECT COUNT(*) AS n FROM auth_failures WHERE key = ? AND at > ?').bind(key, Date.now() - windowMs).first());
  return (r?.n ?? 0) >= limit;
}

/** @param {Env} env @param {string[]} keys */
async function note(env, ...keys) {
  const now = Date.now();
  await env.DB.batch(keys.map((k) => env.DB.prepare('INSERT INTO auth_failures (key, at) VALUES (?, ?)').bind(k, now)));
}

/** Occasional clean-up of expired sessions and old attempts (no cron needed). @param {Env} env */
async function cleanUp(env) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM auth_failures WHERE at < ?').bind(now - DAY),
  ]);
}

/* ------------------------------------------------------------------- routes */

/** @param {Request} req @param {Env} env @param {ExecutionContext} ctx */
async function route(req, env, ctx) {
  const path = new URL(req.url).pathname.replace(/\/+$/, '') || '/';
  const m = req.method;
  if (path === '/' || path === '/v1/health') return json({ ok: true, service: 'kinora-accounts', version: VERSION, backup: false });
  await ensureSchema(env);
  if (Math.random() < 0.02) ctx.waitUntil(cleanUp(env));

  if (path === '/v1/auth/signup' && m === 'POST') {
    const b = await body(req);
    const email = text(b.email, 'email', 3, 254).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'invalid_email', 'That email address doesn’t look right.');
    const password = text(b.password, 'password', 8, 200);
    const name = text(b.name ?? email.split('@')[0], 'name', 1, 80).trim().slice(0, 60) || 'Kinora user';
    const eula = text(b.eula, 'eula', 1, 40);
    const ip = ipOf(req);
    if (await tooMany(env, `signup:${ip}`, 10, 3_600_000)) throw new HttpError(429, 'slow_down', 'Too many new accounts from here. Please try again later.');
    if (await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) {
      throw new HttpError(409, 'email_taken', 'There is already an account with this email. Try signing in.');
    }
    const pw = await hashPassword(password);
    const recoveryCode = newRecoveryCode();
    const id = `u${b64url(randomBytes(12))}`;
    const now = Date.now();
    await env.DB.prepare(
      'INSERT INTO users (id, email, name, pw_hash, pw_salt, pw_iter, recovery_hash, eula_version, eula_accepted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(id, email, name, pw.hash, pw.salt, pw.iter, await recoveryHash(recoveryCode), eula, now, now, now)
      .run();
    await note(env, `signup:${ip}`);
    return json({ token: await newSession(env, id, req), user: { id, email, name, createdAt: now }, recoveryCode }, 201);
  }

  if (path === '/v1/auth/login' && m === 'POST') {
    const b = await body(req);
    const email = text(b.email, 'email', 3, 254).trim().toLowerCase();
    const password = text(b.password, 'password', 1, 200);
    const ip = ipOf(req);
    if ((await tooMany(env, `login:${email}`, 10, 900_000)) || (await tooMany(env, `ip:${ip}`, 60, 900_000))) {
      throw new HttpError(429, 'slow_down', 'Too many attempts. Please wait 15 minutes and try again.');
    }
    const user = /** @type {User | null} */ (await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first());
    const ok = user ? await passwordOk(password, user) : (await hashPassword(password), false); // same timing either way
    if (!user || !ok) {
      await note(env, `login:${email}`, `ip:${ip}`);
      throw new HttpError(401, 'wrong_login', 'Wrong email or password.');
    }
    await env.DB.prepare('DELETE FROM auth_failures WHERE key = ?').bind(`login:${email}`).run();
    return json({ token: await newSession(env, user.id, req), user: publicUser(user) });
  }

  if (path === '/v1/auth/recover' && m === 'POST') {
    const b = await body(req);
    const email = text(b.email, 'email', 3, 254).trim().toLowerCase();
    const code = text(b.recoveryCode, 'code', 10, 60);
    const password = text(b.password, 'password', 8, 200);
    const ip = ipOf(req);
    if ((await tooMany(env, `recover:${email}`, 5, 900_000)) || (await tooMany(env, `ip:${ip}`, 60, 900_000))) {
      throw new HttpError(429, 'slow_down', 'Too many attempts. Please wait 15 minutes and try again.');
    }
    const user = /** @type {User | null} */ (await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first());
    if (!user || user.recovery_hash !== (await recoveryHash(code))) {
      await note(env, `recover:${email}`, `ip:${ip}`);
      throw new HttpError(401, 'wrong_code', 'That email and recovery code don’t match.');
    }
    const pw = await hashPassword(password);
    const fresh = newRecoveryCode(); // each code works once
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ?, recovery_hash = ?, updated_at = ? WHERE id = ?').bind(pw.hash, pw.salt, pw.iter, await recoveryHash(fresh), Date.now(), user.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    ]);
    return json({ token: await newSession(env, user.id, req), user: publicUser(user), recoveryCode: fresh });
  }

  const s = await signedIn(req, env);
  const uid = s.user.id;

  if (path === '/v1/auth/logout' && m === 'POST') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(s.tokenHash).run();
    return noContent();
  }

  if (path === '/v1/me' && m === 'GET') return json({ user: publicUser(s.user) });

  if (path === '/v1/me' && m === 'PATCH') {
    const name = text((await body(req)).name, 'name', 1, 80).trim().slice(0, 60);
    if (!name) throw new HttpError(400, 'invalid_name', 'Please enter a name.');
    await env.DB.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?').bind(name, Date.now(), uid).run();
    return json({ user: publicUser({ ...s.user, name }) });
  }

  if (path === '/v1/me/password' && m === 'POST') {
    const b = await body(req);
    const current = text(b.current, 'password', 1, 200);
    const next = text(b.next, 'new password', 8, 200);
    if (!(await passwordOk(current, s.user))) throw new HttpError(403, 'wrong_password', 'Your current password is not right.');
    const pw = await hashPassword(next);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ?, updated_at = ? WHERE id = ?').bind(pw.hash, pw.salt, pw.iter, Date.now(), uid),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').bind(uid, s.tokenHash), // other devices sign in again
    ]);
    return noContent();
  }

  if (path === '/v1/me/recovery' && m === 'POST') {
    const password = text((await body(req)).password, 'password', 1, 200);
    if (!(await passwordOk(password, s.user))) throw new HttpError(403, 'wrong_password', 'That password is not right.');
    const code = newRecoveryCode();
    await env.DB.prepare('UPDATE users SET recovery_hash = ?, updated_at = ? WHERE id = ?').bind(await recoveryHash(code), Date.now(), uid).run();
    return json({ recoveryCode: code });
  }

  if (path === '/v1/me' && m === 'DELETE') {
    const password = text((await body(req)).password, 'password', 1, 200);
    if (!(await passwordOk(password, s.user))) throw new HttpError(403, 'wrong_password', 'That password is not right.');
    await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(uid), env.DB.prepare('DELETE FROM users WHERE id = ?').bind(uid)]);
    return noContent();
  }

  throw new HttpError(404, 'not_found', 'Unknown address.');
}

export default {
  /** @param {Request} req @param {Env} env @param {ExecutionContext} ctx */
  async fetch(req, env, ctx) {
    const headers = cors(req.headers.get('Origin'), env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    let res;
    try {
      res = await route(req, env, ctx);
    } catch (err) {
      if (err instanceof HttpError) res = json({ error: { code: err.code, message: err.message } }, err.status);
      else {
        console.error(err);
        res = json({ error: { code: 'server_error', message: 'Something went wrong on our side. Please try again.' } }, 500);
      }
    }
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    return res;
  },
};
