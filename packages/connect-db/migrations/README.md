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

Migration 0006 uses the normal schema-diff workflow. Drizzle Kit's
`connect_code` table rebuild selected the new columns from the old table, so
its `INSERT … SELECT` was corrected to copy only the columns that existed
before 0006. The snapshot is unchanged generated output.

Migration 0007 uses the normal schema-diff workflow and adds two nullable
`connect_code` columns for `server-link` rows: `request_location`, the
Cloudflare city and country that started the request, shown on `/link`; and
`delivered_credential_hash`, the hash of the credential the last poll
delivered, which lets a poll whose response was lost receive a freshly
rotated credential while that credential is still the server's current one.
Both are additive: old workers never read them, and rows written before 0007
keep `NULL` (unknown location; no re-delivery).

## Account-link and AI-usage migration deployment order

Migration `0006_account_link_and_ai_usage.sql` rebuilds `connect_code` so
`user_id` is nullable, adds the `server-link` columns (`device_code_hash`,
`client_name`, `polled_at`, `approved_at`, `denied_at`), and creates
`ai_usage_day` and `ai_request_log`. Every change is
additive for the current workers: existing pairing codes keep their owner and
nothing reads the new tables yet. Apply it before deploying the web worker that
serves `/api/account/*` or the `bb-ai-gateway` worker.

On a merge to `main`, `deploy-web.yml` and `deploy-connect.yml` each apply
pending migrations before their deploy and share the `connect-db-deploy`
concurrency group, so a migration lands once before either worker ships.
`deploy-ai-gateway.yml` does not apply migrations and uses its own
`ai-gateway-deploy` group: GitHub keeps only one pending run per group, so a
third workflow in the shared group would cancel one of the other deploys.
The gateway can therefore deploy before a new migration is applied. Until a
bb release calls the gateway this is harmless; after that, land a migration
the gateway needs in an earlier merge than the gateway change that reads it.
The gateway workflow uploads `OPENROUTER_API_KEY` from the repository's
Actions secrets with every deploy; add that secret before the first merge, or
the gateway job fails without deploying.

## Machine-label migration deployment order

Migration `0004_machine_labels.sql` creates `label_claim` and the nullable
machine label column. Custom migration `0005_label_claim_triggers.sql` installs
the insert/update/delete triggers that make every profile, server, and machine
label mutation update `label_claim` in the same SQLite statement. Before
installing them, 0005 rebuilds claims as the exact `(label, kind, owner_id,
user_id)` projection of current canonical sources. This repairs inserts,
deletes, renames, and ownership swaps from an old worker after 0004's backfill.
A cross-source collision aborts the migration for manual resolution instead of
choosing a claim owner. D1 runs reconciliation and trigger installation as one
migration transaction; no table has a foreign key to `label_claim`.

Apply migrations through 0005 before deploying either worker version that
relies on `label_claim`. After that database-first step, the gate and web workers
may deploy independently. The old gate does not resolve machine labels, while
new machine TunnelDO/cache keys are generation-isolated from their first use.

Server label resolution, cache/DO keys, disconnect, and reuse behavior remain
exactly as on main. The pre-existing server-label reuse race is out of scope for
this migration and must be handled as separate server hardening.
