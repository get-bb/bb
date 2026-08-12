export const MANIFEST_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS fs_meta (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS fs_node (
     path TEXT PRIMARY KEY,
     kind TEXT NOT NULL CHECK (kind IN ('file','directory','symlink')),
     file_hash TEXT,
     size INTEGER,
     mime_type TEXT,
     full_type TEXT,
     unix_mode INTEGER,
     unix_uid INTEGER,
     unix_gid INTEGER,
     is_setuid INTEGER NOT NULL DEFAULT 0 CHECK (is_setuid IN (0,1)),
     is_setgid INTEGER NOT NULL DEFAULT 0 CHECK (is_setgid IN (0,1)),
     symlink_target TEXT,
     materialized INTEGER NOT NULL DEFAULT 0 CHECK (materialized IN (0,1)),
     errors TEXT,
     CHECK (
       (kind = 'file' AND symlink_target IS NULL) OR
       (kind = 'directory' AND file_hash IS NULL AND size IS NULL AND symlink_target IS NULL AND materialized = 0) OR
       (kind = 'symlink' AND file_hash IS NULL AND size IS NULL AND materialized = 0)
     )
   );
   CREATE INDEX IF NOT EXISTS fs_node_hash ON fs_node(file_hash);
  CREATE INDEX IF NOT EXISTS fs_node_materialized ON fs_node(materialized);`,
] as const;
