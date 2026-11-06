import {
  type ConnectDbMigration,
  connectDbMigrations,
} from "@bb/connect-db/migrations";
import type { PgQueryable } from "./pg-client.js";

const MIGRATION_LOCK_KEY = 7_204_311;

export async function applyConnectDbMigrations(
  pg: PgQueryable,
  migrations: readonly ConnectDbMigration[] = connectDbMigrations(),
): Promise<string[]> {
  await pg.queryArrays(
    `CREATE TABLE IF NOT EXISTS "connect_db_migrations" ("tag" text PRIMARY KEY, "applied_at" bigint NOT NULL)`,
    [],
  );
  await pg.queryArrays("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
  const applied: string[] = [];
  try {
    const { rows } = await pg.queryArrays(
      `SELECT "tag" FROM "connect_db_migrations"`,
      [],
    );
    const done = new Set(rows.map((row) => String(row[0])));
    for (const migration of migrations) {
      if (done.has(migration.tag)) continue;
      await pg.queryArrays("BEGIN", []);
      try {
        for (const statement of migration.statements) {
          await pg.queryArrays(statement, []);
        }
        await pg.queryArrays(
          `INSERT INTO "connect_db_migrations" ("tag", "applied_at") VALUES ($1, $2)`,
          [migration.tag, Date.now()],
        );
        await pg.queryArrays("COMMIT", []);
      } catch (error) {
        await pg.queryArrays("ROLLBACK", []).catch(() => undefined);
        throw error;
      }
      applied.push(migration.tag);
    }
  } finally {
    await pg.queryArrays("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
  }
  return applied;
}
