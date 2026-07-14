# Connect DB migration metadata

Migrations 0000–0003 predate this package's Drizzle Kit workflow and remain the
deployed SQL source of truth. Their journal positions were bootstrapped with
Drizzle custom migrations, and 0003 is the generated full-schema baseline.
Migration 0004 uses the normal schema-diff workflow and generated snapshot.
Migration 0005 is an explicitly generated custom migration because Drizzle's
SQLite schema diff and snapshots do not model triggers.

From this package, generate the next migration with:

```sh
pnpm db:generate --name <migration_name>
```

Never edit snapshot JSON by hand.

For SQL objects that Drizzle does not model, create a journaled custom migration
before adding the SQL:

```sh
pnpm exec drizzle-kit generate --config drizzle.config.ts --custom --name <migration_name>
```

This creates the SQL file plus its journal/snapshot entry. Edit only the custom
SQL file; never hand-edit `_journal.json` or snapshot JSON.

## Machine-label migration deployment order

Migration `0004_machine_labels.sql` creates `label_claim` and the nullable
machine label column. Custom migration `0005_label_claim_triggers.sql` installs
the insert/update/delete triggers that make every profile, server, and machine
label mutation update `label_claim` in the same SQLite statement. Before
installing them, 0005 reconciles both directions of drift from an old worker
after 0004's backfill: it removes claims with no current source, then inserts
claims missing for current or renamed sources. A cross-source collision aborts
the migration for manual resolution instead of choosing a claim owner. D1 runs
the reconciliation and trigger installation as one migration transaction.

Apply migrations through 0005 before deploying either worker version that
relies on `label_claim`. After that database-first step, the gate and web workers
may deploy independently. The old gate does not resolve machine labels, while
new machine TunnelDO/cache keys are generation-isolated from their first use.

Server label resolution, cache/DO keys, disconnect, and reuse behavior remain
exactly as on main. The pre-existing server-label reuse race is out of scope for
this migration and must be handled as separate server hardening.
