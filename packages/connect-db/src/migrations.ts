import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const CONNECT_DB_MIGRATIONS_DIR = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

export interface ConnectDbMigration {
  tag: string;
  statements: string[];
}

interface Journal {
  entries: { idx: number; tag: string }[];
}

export function connectDbMigrations(): ConnectDbMigration[] {
  const journal = JSON.parse(
    readFileSync(join(CONNECT_DB_MIGRATIONS_DIR, "meta/_journal.json"), "utf8"),
  ) as Journal;
  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map(({ tag }) => ({
      tag,
      statements: readFileSync(
        join(CONNECT_DB_MIGRATIONS_DIR, `${tag}.sql`),
        "utf8",
      )
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter((statement) => statement !== ""),
    }));
}
