import { AsyncLocalStorage } from "node:async_hooks";
import type { DbConnection } from "@bb/db";

const cleanup = new AsyncLocalStorage<{ db: DbConnection; hostId: string }>();

export function withHostCleanup<T>(
  deps: { db: DbConnection },
  hostId: string | null,
  run: () => Promise<T>,
): Promise<T> {
  return hostId === null ? run() : cleanup.run({ db: deps.db, hostId }, run);
}

export function isHostCleanupAllowed(
  deps: { db: DbConnection },
  hostId: string,
): boolean {
  const context = cleanup.getStore();
  return context?.db === deps.db && context.hostId === hostId;
}
