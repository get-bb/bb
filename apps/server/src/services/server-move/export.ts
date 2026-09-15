import Database from "better-sqlite3";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { countAppliedMigrations, type DbConnection } from "@bb/db";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import {
  listServerOwnedEntries,
  writeServerArchive,
  type ServerArchiveEncryption,
  type ServerArchiveSourceFile,
} from "@bb/server-archive";
import type { ServerLogger } from "../../types.js";
import { listOldCopyEntries } from "./switch.js";

const SERVER_DATABASE_ARCHIVE_PATH = "bb.db";
const SNAPSHOT_DIR_NAME = "snapshot";

export interface ExportServerArchiveArgs {
  appVersion: string;
  dataDir: string;
  db: DbConnection;
  encryption: ServerArchiveEncryption | null;
  fileName: string;
  logger: Pick<ServerLogger, "warn">;
  now: number;
  sourceServerHostId: string | null;
  workDir: string;
}

export interface ServerArchiveExport {
  oldCopyEntries: string[];
  path: string;
  sha256: string;
  sizeBytes: number;
  skippedPaths: string[];
}

async function snapshotPluginDatabase(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  await mkdir(dirname(destinationPath), { recursive: true });
  const connection = new Database(sourcePath, {
    fileMustExist: true,
    readonly: true,
  });
  try {
    await connection.backup(destinationPath);
  } finally {
    connection.close();
  }
}

export async function exportServerArchive(
  args: ExportServerArchiveArgs,
): Promise<ServerArchiveExport> {
  const snapshotDir = join(args.workDir, SNAPSHOT_DIR_NAME);
  await rm(snapshotDir, { force: true, recursive: true });
  await mkdir(snapshotDir, { recursive: true });
  try {
    const databaseSnapshotPath = join(
      snapshotDir,
      SERVER_DATABASE_ARCHIVE_PATH,
    );
    await args.db.$client.backup(databaseSnapshotPath);
    const migrationCount = countAppliedMigrations(args.db);
    const inventory = await listServerOwnedEntries(args.dataDir);
    if (inventory.skippedPaths.length > 0) {
      args.logger.warn(
        { dataDir: args.dataDir, skippedPaths: inventory.skippedPaths },
        "Server export skipped symbolic links and special files",
      );
    }
    const files: ServerArchiveSourceFile[] = [
      {
        archivePath: SERVER_DATABASE_ARCHIVE_PATH,
        sourcePath: databaseSnapshotPath,
      },
    ];
    for (const entry of inventory.entries) {
      for (const file of entry.files) {
        if (file.path === SERVER_DATABASE_ARCHIVE_PATH) {
          continue;
        }
        if (!file.sqliteDatabase) {
          files.push({ archivePath: file.path, sourcePath: file.absolutePath });
          continue;
        }
        const snapshotPath = join(snapshotDir, ...file.path.split("/"));
        await snapshotPluginDatabase(file.absolutePath, snapshotPath);
        files.push({ archivePath: file.path, sourcePath: snapshotPath });
      }
    }
    const outPath = join(args.workDir, args.fileName);
    const result = await writeServerArchive({
      outPath,
      files,
      manifest: {
        createdAt: args.now,
        bbVersion: args.appVersion,
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        migrationCount,
        sourceDataDir: args.dataDir,
        sourceServerHostId: args.sourceServerHostId,
      },
      encryption: args.encryption,
    });
    return {
      oldCopyEntries: listOldCopyEntries(inventory.entries),
      path: outPath,
      sha256: result.sha256,
      sizeBytes: result.sizeBytes,
      skippedPaths: inventory.skippedPaths,
    };
  } finally {
    await rm(snapshotDir, { force: true, recursive: true });
  }
}
