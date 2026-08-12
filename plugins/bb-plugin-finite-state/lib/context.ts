// FROZEN. Amend only through AMENDMENTS.md and a CONTRACT_VERSION broadcast.
import type { BbPluginApi } from "@bb/plugin-sdk";
import type Database from "better-sqlite3";
import { MIGRATIONS } from "./store/schema.js";

export const PLUGIN_ID = "finite-state" as const;

export interface PluginContext {
  readonly bb: BbPluginApi;
  readonly log: BbPluginApi["log"];
  /** Migrated, memoized shared plugin DB (<dataDir>/plugins/finite-state/data.db). */
  db(): Database.Database;
  /** Cross-lane memoized singletons — narrow remote services, watchers, limiters. */
  service<T>(key: string, factory: () => T): T;
}

export function createPluginContext(bb: BbPluginApi): PluginContext {
  const services = new Map<string, unknown>();
  let dbHandle: Database.Database | undefined;
  return {
    bb,
    log: bb.log,
    db() {
      if (!dbHandle) {
        const candidate = bb.storage.database();
        bb.storage.migrate(candidate, MIGRATIONS);
        dbHandle = candidate;
      }
      return dbHandle;
    },
    service<T>(key: string, factory: () => T) {
      if (!services.has(key)) services.set(key, factory());
      return services.get(key) as T;
    },
  };
}
