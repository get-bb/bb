import type { DbConnection } from "@bb/db";

type PathPluginPreserver = (directory: string) => Promise<void>;

const preservers = new WeakMap<DbConnection, PathPluginPreserver>();

export function setPathPluginPreserver(
  db: DbConnection,
  preserver: PathPluginPreserver,
): void {
  preservers.set(db, preserver);
}

export async function preservePathPluginsInside(
  db: DbConnection,
  directory: string,
): Promise<void> {
  await preservers.get(db)?.(directory);
}
