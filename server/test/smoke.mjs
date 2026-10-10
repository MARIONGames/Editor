/**
 * End-to-end check of the accounts API. Run against `npm run dev` (default) or your Worker:
 *   node test/smoke.mjs https://kinora-api.<you>.workers.dev
 * It creates a throw-away account and deletes it again at the end.
 */
const API = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:5173';
let failures = 0;

function check(label, ok, extra = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
}

async function call(path, { method = 'GET', token, json } = {}) {
  const headers = { Origin: ORIGIN };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: json !== undefined ? JSON.stringify(json) : undefined });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data, headers: res.headers };
}

const email = `smoke-${Date.now()}@example.com`;
const password = 'correct horse battery';

const health = await call('/v1/health');
check('health', health.status === 200 && health.data?.ok === true, JSON.stringify(health.data));

const pre = await fetch(`${API}/v1/me`, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET' } });
check('CORS allows the app', pre.headers.get('Access-Control-Allow-Origin') === ORIGIN);
const bad = await fetch(`${API}/v1/health`, { headers: { Origin: 'https://evil.example' } });
await bad.text();
check('CORS refuses other sites', !bad.headers.get('Access-Control-Allow-Origin'));

check('rejects short passwords', (await call('/v1/auth/signup', { method: 'POST', json: { email, password: 'short', eula: 'x' } })).status === 400);
const su = await call('/v1/auth/signup', { method: 'POST', json: { email, password, name: 'Smoke Test', eula: '2026-10-10' } });
check('sign up', su.status === 201 && typeof su.data?.token === 'string' && /^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/.test(su.data?.recoveryCode ?? ''), su.data?.recoveryCode);
const t1 = su.data.token;
const code1 = su.data.recoveryCode;
check('one account per email', (await call('/v1/auth/signup', { method: 'POST', json: { email: email.toUpperCase(), password, eula: 'x' } })).status === 409);

check('wrong password refused', (await call('/v1/auth/login', { method: 'POST', json: { email, password: 'nope nope nope' } })).status === 401);
const li = await call('/v1/auth/login', { method: 'POST', json: { email, password } });
check('sign in', li.status === 200 && li.data?.user?.email === email);
const t2 = li.data.token;

const me = await call('/v1/me', { token: t1 });
check('me', me.status === 200 && me.data?.user?.name === 'Smoke Test');
check('rename', (await call('/v1/me', { method: 'PATCH', token: t1, json: { name: 'Renamed' } })).data?.user?.name === 'Renamed');
check('requires sign-in', (await call('/v1/me')).status === 401);

check('change password', (await call('/v1/me/password', { method: 'POST', token: t1, json: { current: password, next: 'another long password' } })).status === 204);
check('other devices signed out', (await call('/v1/me', { token: t2 })).status === 401);
check('this device stays signed in', (await call('/v1/me', { token: t1 })).status === 200);

// Forgot password: the recovery code works once and is replaced.
check('wrong recovery code refused', (await call('/v1/auth/recover', { method: 'POST', json: { email, recoveryCode: 'AAAAA-BBBBB-CCCCC-DDDDD', password: 'brand new password' } })).status === 401);
const rec = await call('/v1/auth/recover', { method: 'POST', json: { email, recoveryCode: code1.toLowerCase(), password: 'brand new password' } });
check('recover with code', rec.status === 200 && typeof rec.data?.token === 'string' && rec.data?.recoveryCode !== code1);
check('old sessions ended', (await call('/v1/me', { token: t1 })).status === 401);
check('code works only once', (await call('/v1/auth/recover', { method: 'POST', json: { email, recoveryCode: code1, password: 'yet another password' } })).status === 401);
const t3 = rec.data.token;
const newCode = await call('/v1/me/recovery', { method: 'POST', token: t3, json: { password: 'brand new password' } });
check('new recovery code', newCode.status === 200 && newCode.data?.recoveryCode !== rec.data.recoveryCode);

const out = await call('/v1/auth/logout', { method: 'POST', token: t3 });
check('sign out', out.status === 204 && (await call('/v1/me', { token: t3 })).status === 401);

const t4 = (await call('/v1/auth/login', { method: 'POST', json: { email, password: 'brand new password' } })).data?.token;
check('delete needs the password', (await call('/v1/me', { method: 'DELETE', token: t4, json: { password: 'wrong' } })).status === 403);
check('delete account', (await call('/v1/me', { method: 'DELETE', token: t4, json: { password: 'brand new password' } })).status === 204);
check('account is gone', (await call('/v1/auth/login', { method: 'POST', json: { email, password: 'brand new password' } })).status === 401);

let throttled = false;
for (let i = 0; i < 12 && !throttled; i++) {
  throttled = (await call('/v1/auth/login', { method: 'POST', json: { email: `guess-${email}`, password: `guess ${i}` } })).status === 429;
}
check('password guessing is throttled', throttled);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
