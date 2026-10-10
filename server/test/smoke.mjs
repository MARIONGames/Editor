/**
 * End-to-end check of the API. Run against `npm run dev` (default) or a deployed URL:
 *   node test/smoke.mjs [https://api.example.com]
 * It creates a throw-away account and deletes it again at the end.
 */
const API = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:5173';
let failures = 0;

function check(label, ok, extra = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
}

async function call(path, { method = 'GET', token, json, body, headers = {} } = {}) {
  const h = { Origin: ORIGIN, ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (json !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { method, headers: h, body: json !== undefined ? JSON.stringify(json) : body });
  const type = res.headers.get('Content-Type') ?? '';
  const data = type.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer());
  return { status: res.status, data, headers: res.headers };
}

const email = `smoke-${Date.now()}@example.com`;
const password = 'correct horse battery';

const health = await call('/v1/health');
check('health', health.status === 200 && health.data.ok);

const pre = await fetch(`${API}/v1/me`, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET' } });
check('CORS preflight allows the app', pre.headers.get('Access-Control-Allow-Origin') === ORIGIN);
const bad = await fetch(`${API}/v1/health`, { headers: { Origin: 'https://evil.example' } });
check('CORS refuses other sites', !bad.headers.get('Access-Control-Allow-Origin'));

const weak = await call('/v1/auth/signup', { method: 'POST', json: { email, password: 'short', eula: 'test' } });
check('rejects short passwords', weak.status === 400);
const su = await call('/v1/auth/signup', { method: 'POST', json: { email, password, name: 'Smoke Test', eula: '2026-10-10' } });
check('sign up', su.status === 201 && typeof su.data.token === 'string', JSON.stringify(su.data.user));
const token1 = su.data.token;
const dup = await call('/v1/auth/signup', { method: 'POST', json: { email: email.toUpperCase(), password, eula: 'x' } });
check('one account per email', dup.status === 409 && dup.data.error.code === 'email_taken');

const wrong = await call('/v1/auth/login', { method: 'POST', json: { email, password: 'nope nope nope' } });
check('wrong password refused', wrong.status === 401);
const li = await call('/v1/auth/login', { method: 'POST', json: { email, password } });
check('sign in', li.status === 200 && li.data.user.email === email);
const token2 = li.data.token;

const me = await call('/v1/me', { token: token1 });
check('me', me.status === 200 && me.data.user.name === 'Smoke Test' && me.data.usage.quota > 0, JSON.stringify(me.data.usage));
const renamed = await call('/v1/me', { method: 'PATCH', token: token1, json: { name: 'Renamed' } });
check('rename', renamed.data.user?.name === 'Renamed');
const anon = await call('/v1/me');
check('requires sign-in', anon.status === 401);

// Media + project backup.
const chk = await call('/v1/media/check', { method: 'POST', token: token1, json: { ids: ['a1', 'a2'] } });
check('media check lists missing', JSON.stringify(chk.data.missing) === '["a1","a2"]');
const pic = new Uint8Array(1000).map((_, i) => i % 251);
const up = await call('/v1/media/a1', { method: 'PUT', token: token1, body: pic, headers: { 'Content-Type': 'image/png' } });
check('upload media', up.status === 204);
const chk2 = await call('/v1/media/check', { method: 'POST', token: token1, json: { ids: ['a1', 'a2'] } });
check('media now stored', JSON.stringify(chk2.data.missing) === '["a2"]');
const down = await call('/v1/media/a1', { token: token1 });
check('download media', down.status === 200 && down.data.length === 1000 && down.data[10] === 10 && down.headers.get('Content-Type') === 'image/png');

const project = new TextEncoder().encode(JSON.stringify({ id: 'p1', name: 'Trip', clips: [1, 2, 3] }));
const meta = (updated, base) => ({
  'X-Kinora-Kind': 'project',
  'X-Kinora-Name': encodeURIComponent('Trip ✈'),
  'X-Kinora-Updated': String(updated),
  'X-Kinora-Assets': 'a1',
  'X-Kinora-Base': String(base),
});
const put1 = await call('/v1/items/p1', { method: 'PUT', token: token1, body: project, headers: meta(1000, 0) });
check('back up a project', put1.status === 200 && put1.data.item.updatedAt === 1000);
const list = await call('/v1/items', { token: token2 });
check('other device sees it', list.data.items.length === 1 && list.data.items[0].name === 'Trip ✈');
const got = await call('/v1/items/p1', { token: token2 });
check('download project', new TextDecoder().decode(got.data) === new TextDecoder().decode(project) && got.headers.get('X-Kinora-Updated') === '1000');
const stale = await call('/v1/items/p1', { method: 'PUT', token: token2, body: project, headers: meta(2000, 500) });
check('stale write is a conflict', stale.status === 409 && stale.data.error.code === 'conflict');
const put2 = await call('/v1/items/p1', { method: 'PUT', token: token2, body: project, headers: meta(2000, 1000) });
check('newer write accepted', put2.status === 200);
const del = await call('/v1/items/p1?base=2000', { method: 'DELETE', token: token1 });
check('delete project', del.status === 204);
const list2 = await call('/v1/items', { token: token1 });
check('deletion is shared', list2.data.items[0]?.deleted === true);

// Password change signs out other devices.
const cp = await call('/v1/me/password', { method: 'POST', token: token1, json: { current: password, next: 'another long password' } });
check('change password', cp.status === 204);
const old = await call('/v1/me', { token: token2 });
check('other devices signed out', old.status === 401);
const still = await call('/v1/me', { token: token1 });
check('this device stays signed in', still.status === 200);

const forgot = await call('/v1/auth/forgot', { method: 'POST', json: { email } });
check('password reset (needs RESEND_API_KEY)', forgot.status === 204 || forgot.status === 501, `status ${forgot.status}`);

const out = await call('/v1/auth/logout', { method: 'POST', token: token1 });
check('sign out', out.status === 204 && (await call('/v1/me', { token: token1 })).status === 401);

// Account deletion removes everything.
const li2 = await call('/v1/auth/login', { method: 'POST', json: { email, password: 'another long password' } });
const t3 = li2.data.token;
const nope = await call('/v1/me', { method: 'DELETE', token: t3, json: { password: 'wrong' } });
check('delete needs the password', nope.status === 403);
const gone = await call('/v1/me', { method: 'DELETE', token: t3, json: { password: 'another long password' } });
check('delete account', gone.status === 204);
const after = await call('/v1/auth/login', { method: 'POST', json: { email, password: 'another long password' } });
check('account is gone', after.status === 401);

// Password guessing is slowed down.
let throttled = false;
for (let i = 0; i < 12 && !throttled; i++) {
  const r = await call('/v1/auth/login', { method: 'POST', json: { email: `guess-${email}`, password: `guess ${i}` } });
  throttled = r.status === 429;
}
check('password guessing is throttled', throttled);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
