# Connect DB migrations (Postgres)

These are the Postgres migrations for the shared connect database, generated
by Drizzle Kit from `src/schema.ts`. `@bb/connect-db-pg` applies them in
journal order (`pnpm --filter @bb/connect-db-pg run db:migrate`) and records
each tag in `connect_db_migrations`.

- `0000_init` is the generated full schema.
- `0001_label_claim_triggers` is a custom migration. It installs the
  `label_claim` insert, update and delete triggers on `profile`, `server` and
  `machine`, the `label_claim_generation()` function they use, and a
  `unixepoch()` function. Every label change updates `label_claim` in the same
  statement, so a cross-namespace collision fails that statement with a unique
  violation. Nothing in the workers calls `unixepoch()` any more; it stays in
  the database and no migration drops it.

The SQLite (D1) migration chain that preceded these lives in git history
before the Postgres-only change.

From this package, generate the next migration with:

```sh
pnpm db:generate --name <migration_name>
```

Never edit snapshot JSON by hand.

For SQL objects that Drizzle does not model (triggers, functions), create a
journaled custom migration before adding the SQL:

```sh
pnpm exec drizzle-kit generate --config drizzle.config.ts --custom --name <migration_name>
```

This creates the SQL file plus its journal and snapshot entries. Edit only the
custom SQL file.

## Deployment order

On a merge to `main`, `deploy-web.yml` and `deploy-connect.yml` each run
`db:migrate` before their deploy and share the `connect-db-deploy` concurrency
group, so a migration lands before either worker ships. `deploy-ai-gateway.yml`
does not migrate, so land a migration the gateway needs in an earlier merge
than the gateway change that reads it.

Keep migrations additive for the workers that are still running: old workers
select whole `server` and `machine` rows, so new columns must be nullable or
have defaults, and a column may only be dropped after no deployed worker
reads it.
