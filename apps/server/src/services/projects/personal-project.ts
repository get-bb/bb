import { ensurePersonalProject } from "@bb/db";
import type { DbConnection } from "@bb/db";

export function ensurePersonalProjectBootstrap(db: DbConnection): void {
  ensurePersonalProject(db);
}
