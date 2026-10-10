-- Kinora accounts and cloud backup.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  pw_salt TEXT NOT NULL,
  pw_iter INTEGER NOT NULL,
  eula_version TEXT NOT NULL,
  eula_accepted_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Sign-in sessions. Only a SHA-256 hash of each token is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  device TEXT NOT NULL DEFAULT ''
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Password-reset links (hashed, short-lived, single use).
CREATE TABLE reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- Failed sign-in attempts (to slow down password guessing).
CREATE TABLE auth_failures (
  key TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX auth_failures_key ON auth_failures(key, at);

-- Backed-up projects (photo/video projects and 3D scenes). The content is in R2.
CREATE TABLE items (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  size INTEGER NOT NULL,
  encoding TEXT NOT NULL DEFAULT '',
  assets TEXT NOT NULL DEFAULT '[]',
  deleted INTEGER NOT NULL DEFAULT 0,
  server_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);

-- Media files (photos, videos, music, models, textures), shared by a user's projects.
CREATE TABLE media (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  size INTEGER NOT NULL,
  type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, asset_id)
);
