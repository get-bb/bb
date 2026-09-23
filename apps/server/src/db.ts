import { createConnection, ensurePersonalProject, migrate } from "@bb/db";
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
  try {
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
    return db;
  } catch (error) {
    // bb-fork(windows): a failed init must not leak a locked database file.
    db.$client.close();
    throw error;
  }
}
