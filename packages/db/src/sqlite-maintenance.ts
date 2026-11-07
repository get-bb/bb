import type Database from "better-sqlite3";

export const DATABASE_INCREMENTAL_VACUUM_MIN_FREELIST_PAGES = 1_024;
export const DATABASE_INCREMENTAL_VACUUM_MAX_PAGES = 20_000;
export const DATABASE_MAINTENANCE_BUSY_TIMEOUT_MS = 100;

interface PageCountRow {
  page_count: number;
}

interface PageSizeRow {
  page_size: number;
}

interface FreelistCountRow {
  freelist_count: number;
}

interface BusyTimeoutRow {
  timeout: number;
}

export interface DatabaseFreelistStats {
  databaseBytes: number;
  freelistBytes: number;
  freelistCount: number;
  pageCount: number;
  pageSize: number;
}

export interface DatabaseIncrementalVacuumDecisionArgs {
  minFreelistPages: number;
  stats: DatabaseFreelistStats;
}

export interface IncrementalVacuumResult {
  after: DatabaseFreelistStats;
  before: DatabaseFreelistStats;
}

export interface RunIncrementalVacuumArgs {
  maxPages: number;
}

export type DatabaseAutoVacuumMode = "none" | "full" | "incremental";

interface AutoVacuumModeRow {
  auto_vacuum: number;
}

interface RunWithMaintenanceBusyTimeoutArgs<TValue> {
  client: Database.Database;
  work: () => TValue;
}

function readPageCount(client: Database.Database): number {
  return (
    client.prepare<[], PageCountRow>("PRAGMA page_count").get()
      ?.page_count ?? 0
  );
}

function readPageSize(client: Database.Database): number {
  return (
    client.prepare<[], PageSizeRow>("PRAGMA page_size").get()?.page_size ??
    0
  );
}

function readFreelistCount(client: Database.Database): number {
  return (
    client
      .prepare<[], FreelistCountRow>("PRAGMA freelist_count")
      .get()?.freelist_count ?? 0
  );
}

function readBusyTimeoutMs(client: Database.Database): number {
  return (
    client.prepare<[], BusyTimeoutRow>("PRAGMA busy_timeout").get()
      ?.timeout ?? 0
  );
}

export function runWithMaintenanceBusyTimeout<TValue>(
  args: RunWithMaintenanceBusyTimeoutArgs<TValue>,
): TValue {
  const originalBusyTimeoutMs = readBusyTimeoutMs(args.client);
  args.client.exec(
    `PRAGMA busy_timeout = ${DATABASE_MAINTENANCE_BUSY_TIMEOUT_MS}`,
  );
  try {
    return args.work();
  } finally {
    args.client.exec(`PRAGMA busy_timeout = ${originalBusyTimeoutMs}`);
  }
}

export function getDatabaseFreelistStats(
  client: Database.Database,
): DatabaseFreelistStats {
  const pageCount = readPageCount(client);
  const pageSize = readPageSize(client);
  const freelistCount = readFreelistCount(client);
  const databaseBytes = pageCount * pageSize;
  const freelistBytes = freelistCount * pageSize;

  return {
    databaseBytes,
    freelistBytes,
    freelistCount,
    pageCount,
    pageSize,
  };
}

export function shouldRunIncrementalVacuum(
  args: DatabaseIncrementalVacuumDecisionArgs,
): boolean {
  return args.stats.freelistCount >= args.minFreelistPages;
}

export function getDatabaseAutoVacuumMode(
  client: Database.Database,
): DatabaseAutoVacuumMode {
  const mode =
    client
      .prepare<[], AutoVacuumModeRow>("PRAGMA auto_vacuum")
      .get()?.auto_vacuum ?? 0;
  switch (mode) {
    case 1:
      return "full";
    case 2:
      return "incremental";
    default:
      return "none";
  }
}

export function runIncrementalVacuum(
  client: Database.Database,
  args: RunIncrementalVacuumArgs,
): IncrementalVacuumResult {
  return runWithMaintenanceBusyTimeout({
    client,
    work: () => {
      const before = getDatabaseFreelistStats(client);

      client.exec(`PRAGMA incremental_vacuum(${args.maxPages})`);

      return {
        after: getDatabaseFreelistStats(client),
        before,
      };
    },
  });
}
