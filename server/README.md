# Kinora accounts & cloud backup (Cloudflare Worker)

© 2026 Marios Kouretis. All rights reserved.

This is the backend for Kinora accounts. It runs on **Cloudflare Workers** with:

- **D1** (Cloudflare's SQLite database): accounts, sign-in sessions and the list of backed-up projects.
- **R2** (Cloudflare's file storage): the backed-up projects and their photos, videos and 3D models.

Kinora works without this service, including offline. An account is optional and only
adds cloud backup and sync between devices.

Everything below fits in Cloudflare's free plan to start: 100,000 requests a day, 5 GB of
D1 and 10 GB of R2.

## What you need

- A Cloudflare account (free): <https://dash.cloudflare.com/sign-up>
- Your domain added to Cloudflare. Skip this until you want the API on your own domain;
  it also works at a free `*.workers.dev` address.
- Node.js 20 or newer on your computer: <https://nodejs.org>

## Step by step

All commands run in this `server/` folder.

### 1. Install the tools

```sh
cd server
npm install
```

### 2. Sign in to Cloudflare

```sh
npx wrangler login
```

A browser window opens. Allow access, then come back to the terminal.

### 3. Create the database

```sh
npx wrangler d1 create kinora
```

It prints a block with `"database_id": "…"`. Copy that id into `wrangler.jsonc`,
replacing `00000000-0000-0000-0000-000000000000`.

### 4. Create the file storage

```sh
npx wrangler r2 bucket create kinora-files
```

If R2 is not enabled on your account yet, the dashboard asks you to enable it once
(R2 → Overview). The free tier needs a payment method on file, but 10 GB stay free.

### 5. Create the tables

```sh
npx wrangler d1 migrations apply kinora --remote
```

### 6. Say which websites may use the API

In `wrangler.jsonc`, `vars.ALLOWED_ORIGINS` lists the addresses Kinora runs from. Add
your domain, for example:

```jsonc
"ALLOWED_ORIGINS": "https://kinora.example.com,https://mariongames.github.io,app://kinora,http://localhost:5173"
```

`app://kinora` is the Windows app. Keep it.

Also set:

- `APP_URL`: the address people open Kinora at. Password-reset links point there.
- `QUOTA_MB`: cloud storage per account (default 2048 = 2 GB).

### 7. Deploy

```sh
npx wrangler deploy
```

It prints the address, for example `https://kinora-api.<your-subdomain>.workers.dev`.
Check that it works:

```sh
curl https://kinora-api.<your-subdomain>.workers.dev/v1/health
# {"ok":true,"service":"kinora-api","version":"1.0.0"}
```

### 8. Put it on your domain (recommended)

Either:

- in `wrangler.jsonc`, uncomment `routes` and set `"pattern": "api.<your-domain>"`, then
  run `npx wrangler deploy` again; or
- in the dashboard, go to Workers & Pages → kinora-api → Settings → Domains & Routes →
  Add → Custom domain → `api.<your-domain>`.

Cloudflare creates the DNS record and the HTTPS certificate automatically.

### 9. Run the full check against the live API (optional)

```sh
node test/smoke.mjs https://api.<your-domain>
```

It creates a throw-away account, backs up a test project, then deletes the account.

### 10. Password-reset emails (optional)

Without this, everything works except "Forgot password?", which tells people that
reset by email isn't available.

1. Create a free account at <https://resend.com> and verify your domain there (it shows
   the DNS records to add; in Cloudflare: DNS → Records).
2. Create an API key in Resend.
3. Store it as a secret. Secrets are never written in files:
   ```sh
   npx wrangler secret put RESEND_API_KEY
   ```
4. In `wrangler.jsonc`, set `MAIL_FROM`, for example `"Kinora <no-reply@your-domain>"`,
   then run `npx wrangler deploy`.

### 11. Connect the app

Send the API address (for example `https://api.your-domain`) to whoever builds Kinora.
The app reads it from `VITE_KINORA_API` at build time (`.env.production`). Until it is
set, Kinora hides accounts and works exactly as before.

## Local development

```sh
npm run db:migrate:local   # once
npm run dev                # http://127.0.0.1:8787, with a local database and storage
npm test                   # the end-to-end check against it
```

To try the app against it, run Kinora with `VITE_KINORA_API=http://127.0.0.1:8787 npm run dev`.

## API

All responses are JSON unless noted. Signed-in calls send `Authorization: Bearer <token>`.

| Method & path | What it does |
| --- | --- |
| `GET /v1/health` | Is the service up? |
| `POST /v1/auth/signup` `{email, password, name, eula}` | Create an account (records the accepted EULA version) → `{token, user}` |
| `POST /v1/auth/login` `{email, password}` | Sign in → `{token, user}` |
| `POST /v1/auth/logout` | Sign out this device |
| `POST /v1/auth/forgot` `{email}` | Email a reset link (needs `RESEND_API_KEY`) |
| `POST /v1/auth/reset` `{token, password}` | Set a new password from the emailed link → `{token, user}` |
| `GET /v1/me` | The account and storage used → `{user, usage}` |
| `PATCH /v1/me` `{name}` | Change the display name |
| `POST /v1/me/password` `{current, next}` | Change the password (signs other devices out) |
| `DELETE /v1/me` `{password}` | Delete the account and every backed-up file |
| `GET /v1/items` | List backed-up projects (including deletion markers) |
| `GET /v1/items/:id` | Download a project (binary; metadata in `X-Kinora-*` headers) |
| `PUT /v1/items/:id` | Upload a project (headers `X-Kinora-Kind`, `-Name`, `-Updated`, `-Encoding`, `-Assets`, `-Base`); `409` if another device changed it first |
| `DELETE /v1/items/:id?base=` | Delete a backed-up project |
| `POST /v1/media/check` `{ids}` | Which media files still need uploading → `{missing}` |
| `PUT /v1/media/:id` / `GET /v1/media/:id` | Upload / download one media file (up to 95 MB) |

## Security notes

- Passwords are hashed with PBKDF2-SHA256 (100,000 rounds, the Workers maximum) and a
  random salt. Session tokens are random 256-bit values; only their SHA-256 hash is stored.
- Repeated wrong passwords are throttled per email and per IP address.
- Sessions last 60 days and renew while used. Changing the password signs out every
  other device.
- CORS only allows the origins in `ALLOWED_ORIGINS`.
- Every user's files sit under their own prefix in R2, and every query is limited to the
  signed-in user.
- Deleting an account deletes all of its files and rows.
