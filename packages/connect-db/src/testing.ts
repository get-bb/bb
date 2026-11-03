import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const CONNECT_DB_MIGRATIONS_DIR = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

export function connectDbMigrationFiles(): string[] {
  return readdirSync(CONNECT_DB_MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

export function readConnectDbMigration(file: string): string {
  return readFileSync(join(CONNECT_DB_MIGRATIONS_DIR, file), "utf8");
}

function withoutLineComments(statement: string): string {
  return statement
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .trim();
}

export function connectDbMigrationStatements(): string[] {
  return connectDbMigrationFiles().flatMap((file) => {
    const sql = readConnectDbMigration(file);
    const chunks = sql.includes("--> statement-breakpoint")
      ? sql.split("--> statement-breakpoint")
      : sql.split(/;\s*\n/u);
    return chunks.map(withoutLineComments).filter((chunk) => chunk !== "");
  });
}

export async function applyConnectDbMigrationsToD1<
  Statement extends { run(): Promise<unknown> },
>(db: {
  prepare(query: string): Statement;
  batch(statements: Statement[]): Promise<unknown>;
}): Promise<void> {
  let pending: Statement[] = [];
  for (const statement of connectDbMigrationStatements()) {
    if (/^PRAGMA\b/iu.test(statement)) {
      if (pending.length > 0) {
        await db.batch(pending);
        pending = [];
      }
      await db.prepare(statement).run();
    } else {
      pending.push(db.prepare(statement));
    }
  }
  if (pending.length > 0) await db.batch(pending);
}
