-- bb connect — machines (execution hosts reached through the tunnel).
-- See src/schema.ts `machine`.

CREATE TABLE machine (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name text,
  credential_hash text NOT NULL,
  last_seen_at integer,
  created_at integer NOT NULL,
  revoked_at integer
);
CREATE INDEX machine_user_id_idx ON machine(user_id);
