import type Database from "better-sqlite3";
import {
  DATABASE_INCREMENTAL_VACUUM_MAX_PAGES,
  DATABASE_INCREMENTAL_VACUUM_MIN_FREELIST_PAGES,
  getDatabaseAutoVacuumMode,
  getDatabaseFreelistStats,
  runIncrementalVacuum,
  shouldRunIncrementalVacuum,
} from "@bb/db/sqlite-maintenance";
import type { WalCheckpointer } from "@bb/db";

const DATABASE_INCREMENTAL_VACUUM_CHUNK_PAGES = 256;

type IncrementalVacuumCheckpointer = Pick<WalCheckpointer, "checkpoint"> | null;

export interface IncrementalVacuumLogger {
  debug(fields: object, message: string): void;
  info(fields: object, message: string): void;
  warn(fields: object, message: string): void;
}

async function runChunkedIncrementalVacuum(
  client: Database.Database,
  walCheckpointer: IncrementalVacuumCheckpointer,
): Promise<ReturnType<typeof runIncrementalVacuum>> {
  let first: ReturnType<typeof runIncrementalVacuum> | null = null;
  let last: ReturnType<typeof runIncrementalVacuum> | null = null;
  for (
    let vacuumedPages = 0;
    vacuumedPages < DATABASE_INCREMENTAL_VACUUM_MAX_PAGES;
    vacuumedPages += DATABASE_INCREMENTAL_VACUUM_CHUNK_PAGES
  ) {
    if (last !== null) {
      await walCheckpointer?.checkpoint(client);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    last = runIncrementalVacuum(client, {
      maxPages: Math.min(
        DATABASE_INCREMENTAL_VACUUM_CHUNK_PAGES,
        DATABASE_INCREMENTAL_VACUUM_MAX_PAGES - vacuumedPages,
      ),
    });
    first ??= last;
    if (last.after.freelistCount === 0) {
      break;
    }
  }
  if (first === null || last === null) {
    throw new Error("Incremental vacuum ran no chunks");
  }
  return { before: first.before, after: last.after };
}

export async function runIncrementalVacuumAboveFreelistThreshold(
  client: Database.Database,
  args: {
    logFields: { pluginId?: string };
    logger: IncrementalVacuumLogger;
    walCheckpointer: IncrementalVacuumCheckpointer;
  },
): Promise<void> {
  const freelistStats = getDatabaseFreelistStats(client);
  if (
    !shouldRunIncrementalVacuum({
      minFreelistPages: DATABASE_INCREMENTAL_VACUUM_MIN_FREELIST_PAGES,
      stats: freelistStats,
    })
  ) {
    args.logger.debug(
      { ...args.logFields, freelistStats },
      "Incremental database vacuum skipped below freelist threshold",
    );
    return;
  }
  try {
    const result = await runChunkedIncrementalVacuum(
      client,
      args.walCheckpointer,
    );
    args.logger.info(
      { ...args.logFields, result },
      "Incremental database vacuum completed",
    );
  } catch (error) {
    args.logger.warn(
      { ...args.logFields, err: error },
      "Incremental database vacuum failed",
    );
  }
}

export async function maintainPluginDatabases(
  databases: Iterable<{ database: Database.Database; pluginId: string }>,
  logger: IncrementalVacuumLogger,
  walCheckpointer: IncrementalVacuumCheckpointer,
): Promise<void> {
  for (const { database, pluginId } of databases) {
    if (
      !database.open ||
      database.inTransaction ||
      getDatabaseAutoVacuumMode(database) !== "incremental"
    ) {
      continue;
    }
    await runIncrementalVacuumAboveFreelistThreshold(database, {
      logFields: { pluginId },
      logger,
      walCheckpointer,
    });
  }
}
