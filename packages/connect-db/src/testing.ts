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

export interface D1LikeDatabase {
  prepare(query: string): { run(): Promise<unknown> };
}

export async function applyConnectDbMigrationsToD1(
  db: D1LikeDatabase,
): Promise<void> {
  for (const statement of connectDbMigrationStatements()) {
    await db.prepare(statement).run();
  }
}
