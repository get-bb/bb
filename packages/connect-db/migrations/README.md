# Connect DB migration metadata

Migrations 0000–0003 predate this package's Drizzle Kit workflow and remain the
deployed SQL source of truth. Their journal positions were bootstrapped with
Drizzle custom migrations, and 0003 is the generated full-schema baseline.
Migration 0004 and later use the normal schema-diff workflow and generated
snapshots.

From this package, generate the next migration with:

```sh
pnpm db:generate --name <migration_name>
```

Never edit snapshot JSON by hand.

## Connect 0004 deployment order

Migration `0004_machine_labels.sql` installs triggers that make every profile,
server, and machine label mutation update `label_claim` in the same SQLite
statement. Old web workers are therefore safe after the migration: their source
writes cannot bypass the global namespace.

The gate and web deploys must still be ordered:

1. Apply migration 0004.
2. Deploy `apps/connect` and wait for the old gate deployment to be fully retired.
3. Deploy `apps/web`.

Do not deploy the new web worker while the old gate is serving traffic. The old
gate uses a bare-label edge-cache namespace that cannot be purged by ownership
generation; only the new gate isolates reusable server cache entries. Tunnel
disconnect/revocation closes both bare and generation DO keys, but that cannot
retroactively change the old gate's cache key.
