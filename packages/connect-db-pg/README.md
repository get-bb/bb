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

`pnpm cloud:dev` migrates and uses a local Postgres at
`postgresql://bb:bb@localhost:5432/bb_connect`, the binding's
`localConnectionString` (override with `BB_CLOUD_DEV_DATABASE_URL`). Start one
with:

```sh
docker run -d --name bb-connect-pg -p 5432:5432 \
  -e POSTGRES_USER=bb -e POSTGRES_PASSWORD=bb -e POSTGRES_DB=bb_connect \
  postgres:17
```

A plain `wrangler dev` in `apps/connect` or `apps/ai-gateway` uses the same
`localConnectionString`; run `db:migrate` against it first.

## Tests

`@bb/connect-db-pg/testing` runs the real migrations in PGlite:

- `createTestConnectDb()` returns a migrated, empty database. The migrated
  data directory is built once per test run (`test/setup/connect-db-template.ts`
  as Vitest `globalSetup`) and loaded once per worker. `close()` returns the
  instance to the worker's pool; the next test gets it back truncated, or a
  fresh copy if the test changed the schema.
- `serveTestConnectDb()` also serves that database over the Postgres wire
  protocol on a loopback port, for Miniflare `hyperdrives` bindings. Each
  connection's statements up to `Sync` run as one unit, and an open
  transaction keeps the session until it ends.
