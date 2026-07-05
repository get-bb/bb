-- bb connect cloud — initial D1 schema.
-- Applied via `wrangler d1 migrations apply` (M1). Kept in sync by hand with
-- src/schema.ts; the schema test asserts every table/column here matches the
-- drizzle definition, so drift fails CI.

CREATE TABLE user (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified integer NOT NULL DEFAULT 0,
  image text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE session (
  id text PRIMARY KEY NOT NULL,
  token text NOT NULL UNIQUE,
  expires_at integer NOT NULL,
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
CREATE INDEX session_user_id_idx ON session(user_id);

CREATE TABLE account (
  id text PRIMARY KEY NOT NULL,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at integer,
  refresh_token_expires_at integer,
  scope text,
  password text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
CREATE INDEX account_user_id_idx ON account(user_id);

CREATE TABLE verification (
  id text PRIMARY KEY NOT NULL,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at integer NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
CREATE INDEX verification_identifier_idx ON verification(identifier);

CREATE TABLE profile (
  user_id text PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  handle text NOT NULL UNIQUE,
  created_at integer NOT NULL
);

CREATE TABLE server (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'default',
  credential_hash text,
  version text,
  last_seen_at integer,
  created_at integer NOT NULL,
  revoked_at integer
);
CREATE UNIQUE INDEX server_user_name_idx ON server(user_id, name);

CREATE TABLE connect_code (
  code text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  server_id text REFERENCES server(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  expires_at integer NOT NULL,
  consumed_at integer,
  created_at integer NOT NULL
);
CREATE INDEX connect_code_user_id_idx ON connect_code(user_id);

CREATE TABLE audit_log (
  id text PRIMARY KEY NOT NULL,
  user_id text REFERENCES user(id) ON DELETE SET NULL,
  action text NOT NULL,
  detail text,
  ip_address text,
  created_at integer NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX audit_log_user_id_idx ON audit_log(user_id);
