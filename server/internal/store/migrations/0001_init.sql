CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash   BLOB PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent   TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Keyed by (user_id, id): a card id from another account can never touch your row.
CREATE TABLE cards (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id           TEXT NOT NULL,
  name         TEXT NOT NULL,
  format       TEXT NOT NULL,
  value        TEXT NOT NULL,
  color        TEXT,
  notes        TEXT,
  sort_order   REAL NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  last_used_at TEXT,
  deleted      INTEGER NOT NULL DEFAULT 0,
  server_rev   INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX cards_user_rev ON cards(user_id, server_rev);
