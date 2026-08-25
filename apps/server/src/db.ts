import {
  createConnection,
  ensurePersonalProject,
  getDatabaseAutoVacuumMode,
  getDatabaseFreelistStats,
  migrate,
} from "@bb/db";
import type {
  DbConnection,
  MigrationWarningLogger,
  SlowDbQueryLogger,
} from "@bb/db";
import type { Logger } from "@bb/logger";
import {
  exportLegacyAutomationsForPluginImport,
  hasLegacyAutomationsToExport,
} from "./legacy-automations-export.js";

type InitDbLogger = MigrationWarningLogger &
  SlowDbQueryLogger &
  Pick<Logger, "error" | "info">;

interface InitDbOptions {
  dataDir?: string;
  logger?: InitDbLogger;
}

export function initDb(
  databasePath: string,
  options: InitDbOptions = {},
): DbConnection {
  const db = createConnection(databasePath, {
    slowQueryLogger: options.logger,
  });
  if (options.dataDir !== undefined && options.logger !== undefined) {
    exportLegacyAutomationsForPluginImport({
      dataDir: options.dataDir,
      db,
      logger: options.logger,
    });
  } else if (hasLegacyAutomationsToExport(db)) {
    throw new Error(
      "Cannot migrate legacy automations without dataDir and logger; refusing to drop kernel automation rows before exporting them for the automations plugin",
    );
  }
  migrate(db, {
    deferDestructiveLegacyCleanup: true,
    logger: options.logger,
  });
  ensurePersonalProject(db);
  // A legacy auto_vacuum=NONE file never shrinks until a full VACUUM
  // converts it; surface the resolved mode and the O(1) freelist counters at
  // startup so an operator can see which regime this database is in without
  // waiting for the hourly maintenance sweep to log.
  options.logger?.info(
    {
      autoVacuumMode: getDatabaseAutoVacuumMode(db),
      freelist: getDatabaseFreelistStats(db),
    },
    "Database auto-vacuum state",
  );
  return db;
}
