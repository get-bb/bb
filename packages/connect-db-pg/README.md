# Connect DB on Postgres (PlanetScale)

The connect gate and TunnelDO (`apps/connect`), the web worker and
better-auth (`apps/web`) and the AI gateway (`apps/ai-gateway`) share one
PlanetScale Postgres database. Workers reach it through the `HYPERDRIVE`
binding.

`openConnectDb(env)` returns `{ db, close }`. `db` is a Drizzle node-postgres
database over one `pg` client on `env.HYPERDRIVE.connectionString`, typed as
`ConnectDb` from `@bb/connect-db`. The client connects on the first query.
Long-lived callers (the TunnelDO presence write, the AI gateway cron) call
`close()` when done; request handlers leave the socket to the Workers runtime,
which closes it when the invocation ends.

## Schema and migrations

`packages/connect-db/src/schema.ts` is the Drizzle `pg-core` schema.
Timestamps are `bigint` epoch milliseconds in SQL and `Date` in TypeScript.
`packages/connect-db/migrations/` holds the migrations; see its README.

`pnpm --filter @bb/connect-db-pg run db:migrate` applies pending migrations
with `CONNECT_DB_PG_MIGRATOR_URL` (a direct admin connection, not Hyperdrive)
and records them in `connect_db_migrations` under an advisory lock.
`deploy-connect` and `deploy-web` run it before deploying.

Keep the Hyperdrive origin connection limit below the database's
`max_connections`. A PS-5 allows 25 connections, so staging uses 12.

## Local development

`pnpm cloud:dev` calls `startCloudDevDatabase()` from `@bb/connect-db-pg/dev`
unless `BB_CLOUD_DEV_DATABASE_URL` is set. It opens a persistent PGlite data
directory, applies the migrations in process, and serves it over the Postgres
wire protocol on a fixed loopback port; the workers' Hyperdrive bindings
connect there as they would to Postgres. With `BB_CLOUD_DEV_DATABASE_URL` it
runs `db:migrate` against that database instead. See
[debugging-and-qa.md](../../docs/debugging-and-qa.md#local-cloud).

A plain `wrangler dev` in `apps/connect` or `apps/ai-gateway` uses the
binding's `localConnectionString`,
`postgresql://bb:bb@localhost:5432/bb_connect`; run `db:migrate` against it
first.

### PGlite wire server

`servePglite()` (`src/wire-server.ts`) serves one PGlite instance to many
connections, for `pnpm cloud:dev` and for `serveTestConnectDb()`. PGlite is a
single Postgres session, so the server serializes:

- Each connection's messages up to `Sync` (extended protocol) or `Query`
  (simple protocol) run as one unit; units from different connections never
  interleave.
- When a unit leaves a transaction open, including a failed one, only that
  connection runs until the transaction ends. Other connections queue.
- A connection that closes inside its transaction is rolled back before
  anything else runs. One that idles inside a transaction for 60 seconds is
  ended with `25P03`, like `idle_in_transaction_session_timeout`.

Limits: there is no real isolation level, since transactions run one at a
time, and code that waits inside a transaction on a second connection blocks
until that idle timeout. Session state is shared: named prepared statements,
`SET`, temporary tables, and session advisory locks are visible to every
connection, and two connections preparing the same statement name collide.
`COPY`, cancel requests and TLS are not supported.

## Tests

`@bb/connect-db-pg/testing` runs the real migrations in PGlite:

- `createTestConnectDb()` returns a migrated, empty database. The migrated
  data directory is built once per test run (`test/setup/connect-db-template.ts`
  as Vitest `globalSetup`) and loaded once per worker. `close()` returns the
  instance to the worker's pool; the next test gets it back truncated, or a
  fresh copy if the test changed the schema.
- `serveTestConnectDb()` also serves that database with `servePglite()` on a
  loopback port, for Miniflare `hyperdrives` bindings.
