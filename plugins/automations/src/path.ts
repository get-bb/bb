import { dirname } from "node:path";
import { z } from "zod";
import type { Db } from "./data.js";

const databaseListEntrySchema = z.object({
  name: z.string(),
  file: z.string().nullable().optional(),
});

export function pluginDataDirFromDb(db: Db): string {
  const row = db
    .prepare(`PRAGMA database_list`)
    .all()
    .map((entry) => databaseListEntrySchema.safeParse(entry))
    .find((parsed) => parsed.success && parsed.data.name === "main");
  const file = row?.success === true ? row.data.file : undefined;
  if (file === undefined || file === null || file.length === 0) {
    throw new Error(
      "Unable to resolve plugin data directory from SQLite handle",
    );
  }
  return dirname(file);
}
