-- bb connect — multi-server: every server owns a globally-unique `subdomain`
-- label in the same namespace as `profile.handle`. See src/schema.ts `server`.
--
-- SQLite cannot `ALTER TABLE ... ADD COLUMN` a NOT NULL *and* UNIQUE column, so
-- this is the standard table-rebuild: create the new shape, copy every row while
-- backfilling `subdomain` from the owner's handle (each account has exactly one
-- server today, so handles map 1:1 and stay unique), then swap. FK enforcement
-- is disabled around the swap so DROP TABLE does not cascade-delete the
-- `connect_code` / `machine`-adjacent child rows that reference `server(id)`;
-- D1 leaves foreign keys off by default, and the in-memory test harness (which
-- forces them ON) runs these statements outside a transaction, so the PRAGMA
-- takes effect in both.
PRAGMA foreign_keys=OFF;

CREATE TABLE server_new (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'default',
  subdomain text NOT NULL UNIQUE,
  credential_hash text,
  version text,
  last_seen_at integer,
  created_at integer NOT NULL,
  revoked_at integer
);

INSERT INTO server_new (
  id, user_id, name, subdomain, credential_hash, version, last_seen_at, created_at, revoked_at
)
SELECT
  s.id,
  s.user_id,
  s.name,
  (SELECT p.handle FROM profile p WHERE p.user_id = s.user_id),
  s.credential_hash,
  s.version,
  s.last_seen_at,
  s.created_at,
  s.revoked_at
FROM server s;

DROP TABLE server;
ALTER TABLE server_new RENAME TO server;
CREATE UNIQUE INDEX server_user_name_idx ON server(user_id, name);

PRAGMA foreign_keys=ON;
