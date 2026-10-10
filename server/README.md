# Kinora accounts — Cloudflare Worker

© 2026 Marios Kouretis. All rights reserved.

The whole backend is **one file, [`worker.js`](worker.js)**. It runs on Cloudflare Workers
with one **D1 database** (Cloudflare's built-in SQL database). Nothing else is needed: no
server of your own, no file storage and no email service. Cloud backup is switched off,
so accounts only hold a name, an email and a password. Projects never leave people's
devices.

What it does:

- sign up, sign in, sign out
- change name, change password (other devices are signed out)
- forgot password with a **recovery code**: shown once at sign-up, it works once and a
  new one is given each time
- delete account
- throttles password guessing; passwords are stored only as salted PBKDF2 hashes

Cost: Cloudflare's free plan is enough to start. It covers 100,000 requests a day and
5 GB of D1.

---

## Setup in the Cloudflare dashboard (no command line)

### 1. Create a Cloudflare account

Go to <https://dash.cloudflare.com/sign-up> and verify your email.

### 2. Create the database

1. In the left menu: **Storage & databases → D1 SQL database**.
2. Click **Create database**.
3. Name: `kinora`. Location: leave **Automatic**.
4. Click **Create**.

That's all for the database. You don't need to create tables or run SQL: the Worker
creates its tables the first time it runs.

### 3. Create the Worker

1. In the left menu: **Compute (Workers) → Workers & Pages**.
2. Click **Create** and choose **Start with Hello World!** (or **Create Worker**).
3. Name: `kinora-api`. Click **Deploy**.
4. Click **Edit code**.
5. In the editor, delete everything in `worker.js` and paste the whole content of
   [`worker.js`](worker.js) from this folder.
6. Click **Deploy** (top right).

### 4. Connect the database to the Worker

1. Open the Worker `kinora-api`, then the **Bindings** tab (or **Settings → Bindings**).
2. Click **Add binding** and choose **D1 database**.
3. Variable name: `DB` (exactly that, capital letters).
4. D1 database: `kinora`.
5. Click **Add binding**. Deploy again if it asks.

### 5. (Optional) Choose which websites may use it

By default, the Worker accepts requests from the GitHub Pages site
(`https://mariongames.github.io`), the Windows app (`app://kinora`) and local
development. To change this:

1. Worker → **Settings → Variables and Secrets → Add**.
2. Type **Text**, name `ALLOWED_ORIGINS`, value: a comma-separated list, e.g.
   `https://mariongames.github.io,app://kinora,https://kinora.example.com`.
3. Click **Deploy**.

### 6. Check that it works

On the Worker's page, copy its address. It looks like
`https://kinora-api.<your-name>.workers.dev`. Open this in a browser:

```
https://kinora-api.<your-name>.workers.dev/v1/health
```

You should see:

```json
{"ok":true,"service":"kinora-accounts","version":"1.0.0","backup":false}
```

If you see `"no_database"` instead, step 4 is missing or the binding isn't named `DB`.

### 7. Connect the app

The app is already set to `https://kinora-api.rubby-studios.com`
(`DEFAULT_API` in `src/account/config.ts`). A different address can be given at build
time with `VITE_KINORA_API`.

### 8. (Optional) Your own domain

Worker → **Settings → Domains & Routes → Add → Custom domain** → e.g. `api.yourdomain.com`.
The domain must be on Cloudflare (**Add a domain** on the dashboard home). Cloudflare
creates the DNS record and HTTPS certificate automatically. If you do this, send the
new address instead.

### Updating the code later

Worker → **Edit code** → paste the new `worker.js` → **Deploy**. Accounts stay; they
live in the database, not in the code.

### Seeing the accounts

**Storage & databases → D1 → kinora → Console** runs SQL, for example:

```sql
SELECT email, name, datetime(created_at / 1000, 'unixepoch') AS created FROM users ORDER BY created_at DESC;
```

Passwords and recovery codes are stored only as hashes and can't be read back.

---

## API

JSON in and out. Signed-in calls send `Authorization: Bearer <token>`.

| Method & path | Body | Result |
| --- | --- | --- |
| `GET /v1/health` | | `{ok, service, version, backup}` |
| `POST /v1/auth/signup` | `{name, email, password, eula}` | `{token, user, recoveryCode}` |
| `POST /v1/auth/login` | `{email, password}` | `{token, user}` |
| `POST /v1/auth/recover` | `{email, recoveryCode, password}` | `{token, user, recoveryCode}` (new code; other sessions end) |
| `POST /v1/auth/logout` | | 204 |
| `GET /v1/me` | | `{user}` |
| `PATCH /v1/me` | `{name}` | `{user}` |
| `POST /v1/me/password` | `{current, next}` | 204 (other devices signed out) |
| `POST /v1/me/recovery` | `{password}` | `{recoveryCode}` (replaces the old one) |
| `DELETE /v1/me` | `{password}` | 204 |

## Developers: test it locally

```sh
cd server
npm install
npm run dev     # http://127.0.0.1:8787 with a local database
npm test        # signs up, signs in, recovers, deletes — 24 checks
```

`node test/smoke.mjs https://kinora-api.<your-name>.workers.dev` runs the same checks
against the live Worker. It creates a throw-away account and deletes it.
