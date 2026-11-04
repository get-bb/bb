# Connect DB on Postgres (PlanetScale)

The connect gate, web and AI gateway workers share one database. Queries are
written once with Drizzle's SQLite dialect (`@bb/connect-db` schema).
`openConnectDb` runs them on D1, on Postgres through Hyperdrive, or on both.

## Modes

The `connect-db-mode` key in the `CONNECT_DB_FLAGS` KV namespace picks the mode.
Workers re-read it within about 45 s (15 s isolate cache plus 30 s KV cache).
A worker without a `HYPERDRIVE` or `CONNECT_DB_FLAGS` binding always uses `d1`.

| Mode    | Reads and writes | Writes copied to |
| ------- | ---------------- | ---------------- |
| `d1`    | D1               | nothing          |
| `d1+pg` | D1               | Postgres         |
| `pg+d1` | Postgres         | D1               |
| `pg`    | Postgres         | nothing          |

How the copy works:

- The second database receives the same statement after the response, through
  `waitUntil`, in request order. A failed copy is logged as
  `connect-db mirror failed` and never fails the request.
- Writes that change a label (`profile`, `server`, `machine`) also copy the
  primary's `label_claim.generation` to the second database. A machine's
  routing key then stays the same in both databases.
- `last_seen_at`-only updates, gate presence writes and `ai_request_log` inserts
  are not copied. They refresh themselves.

## Shadow reads

In `d1+pg`, the `connect-db-shadow-reads` key (a rate from `0` to `1`) also
runs that share of reads on Postgres after the response and compares the rows
with D1's. Users always get D1's rows. Failures and differences are logged as
`connect-db shadow read` with stage `shadow_read` or `shadow_mismatch`, the
table and the row counts. Reads racing a write from another request can show
up as occasional mismatches. Other modes ignore the key.

Flip with:

```sh
pnpm --filter @bb/connect exec wrangler kv key put connect-db-mode "pg+d1" \
  --namespace-id <CONNECT_DB_FLAGS id> --remote
```

Rolling back is the same command with the previous mode.

## Schema

`packages/connect-db/src/pg-schema.ts` mirrors `schema.ts`. Timestamps stay
`bigint` milliseconds. `migrations-pg/` is generated with
`pnpm --filter @bb/connect-db db:generate:pg`. `0001_label_claim_triggers` is
the Postgres version of SQLite migration 0005, plus a `unixepoch()` function for
Drizzle's SQLite defaults. Every schema change needs both migrations. `deploy-connect` and `deploy-web`
run `pnpm --filter @bb/connect-db-pg run db:migrate` with the
`CONNECT_DB_PG_MIGRATOR_URL` secret before deploying.

## Sync script

`scripts/sync.ts` compares and copies rows between D1 (read through
`wrangler d1 execute`) and Postgres (read with a direct admin connection):

```sh
pnpm exec tsx packages/connect-db-pg/scripts/sync.ts \
  --d1 bb-connect-staging --wrangler-cwd apps/connect \
  --pg-url-file ~/.config/bb-connect-db/staging-migrator.url \
  --action migrate|check|backfill|repair [--from d1|pg]
```

- `migrate` applies `migrations-pg` and records them in `connect_db_migrations`.
- `check` reports missing, changed and extra rows per table. It ignores the
  presence columns and skips `ai_request_log` unless that table is named in
  `--tables`.
- `backfill` inserts missing rows into Postgres with the label triggers off,
  then copies `label_claim` exactly.
- `repair` makes the target match `--from`.

## Cutover

1. Run `migrate`. Deploy the workers with the `HYPERDRIVE` and
   `CONNECT_DB_FLAGS` bindings. Mode is still `d1`.
2. Set `d1+pg`, run `backfill`, then run `check` until every table says `ok`.
3. Set `pg+d1`. Watch the worker logs. Run `check --from pg`.
4. To roll back, set `d1+pg`. D1 kept receiving every write.
5. After a quiet week, set `pg` and remove the D1 binding.

Keep the Hyperdrive origin connection limit below the database's
`max_connections`. A PS-5 allows 25 connections, so staging uses 12.
