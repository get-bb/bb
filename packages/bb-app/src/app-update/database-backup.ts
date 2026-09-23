import {
  constants,
  copyFile,
  mkdir,
  rename,
  rm,
  stat,
  statfs,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";

const BACKED_UP_SUFFIXES = ["", "-wal"] as const;
const FREE_SPACE_MARGIN_BYTES = 256 * 1024 * 1024;

const migrationJournalSchema = z.object({
  entries: z.array(z.object({ tag: z.string().min(1) }).passthrough()),
});

interface DatabaseBackupArgs {
  backupDir: string;
  dbPath: string;
}

interface DatabaseFile {
  backupPath: string;
  path: string;
  size: number;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function existingDatabaseFiles(
  args: DatabaseBackupArgs,
): Promise<DatabaseFile[]> {
  const files: DatabaseFile[] = [];
  for (const suffix of BACKED_UP_SUFFIXES) {
    const path = `${args.dbPath}${suffix}`;
    try {
      const stats = await stat(path);
      files.push({
        backupPath: join(args.backupDir, `${basename(args.dbPath)}${suffix}`),
        path,
        size: stats.size,
      });
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) throw error;
    }
  }
  return files;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

async function cloneFiles(files: readonly DatabaseFile[]): Promise<boolean> {
  try {
    for (const file of files) {
      await copyFile(
        file.path,
        file.backupPath,
        constants.COPYFILE_FICLONE_FORCE,
      );
    }
    return true;
  } catch {
    return false;
  }
}

export async function backupDatabase(args: DatabaseBackupArgs): Promise<void> {
  await rm(args.backupDir, { force: true, recursive: true });
  await mkdir(args.backupDir, { mode: 0o700, recursive: true });
  const files = await existingDatabaseFiles(args);
  if (await cloneFiles(files)) return;

  const requiredBytes = files.reduce((total, file) => total + file.size, 0);
  const space = await statfs(args.backupDir);
  const availableBytes = space.bavail * space.bsize;
  if (availableBytes < requiredBytes + FREE_SPACE_MARGIN_BYTES) {
    await rm(args.backupDir, { force: true, recursive: true });
    throw new Error(
      `Not enough free disk space to back up the database before updating (needs ${formatBytes(
        requiredBytes + FREE_SPACE_MARGIN_BYTES,
      )}, ${formatBytes(availableBytes)} available).`,
    );
  }
  try {
    for (const file of files) {
      await copyFile(file.path, file.backupPath);
    }
  } catch (error) {
    await rm(args.backupDir, { force: true, recursive: true });
    throw error;
  }
}

async function replaceFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if (!hasErrorCode(error, "EXDEV")) throw error;
    const staged = `${to}.restore-${String(process.pid)}`;
    await copyFile(from, staged);
    await rename(staged, to);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function hasDatabaseBackup(
  args: DatabaseBackupArgs,
): Promise<boolean> {
  return exists(join(args.backupDir, basename(args.dbPath)));
}

export async function restoreDatabase(args: DatabaseBackupArgs): Promise<void> {
  const backupName = basename(args.dbPath);
  const backupMain = join(args.backupDir, backupName);
  const backupWal = join(args.backupDir, `${backupName}-wal`);
  if (!(await exists(backupMain))) {
    throw new Error(`Database backup is missing from ${args.backupDir}`);
  }
  await rm(`${args.dbPath}-wal`, { force: true });
  await rm(`${args.dbPath}-shm`, { force: true });
  await replaceFile(backupMain, args.dbPath);
  if (await exists(backupWal)) {
    await replaceFile(backupWal, `${args.dbPath}-wal`);
  }
}

export function parseMigrationTags(
  journalJson: string | null,
): string[] | null {
  if (journalJson === null) return null;
  try {
    const parsed = migrationJournalSchema.safeParse(JSON.parse(journalJson));
    return parsed.success
      ? parsed.data.entries.map((entry) => entry.tag)
      : null;
  } catch {
    return null;
  }
}

export function requiresDatabaseBackup(args: {
  fromTags: readonly string[] | null;
  toTags: readonly string[] | null;
}): boolean {
  if (args.fromTags === null || args.toTags === null) return true;
  const known = new Set(args.fromTags);
  return args.toTags.some((tag) => !known.has(tag));
}
