import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  backupDatabase,
  parseMigrationTags,
  requiresDatabaseBackup,
  restoreDatabase,
} from "../src/app-update/database-backup.js";

const scratchDirs: string[] = [];

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bb-app-update-db-"));
  scratchDirs.push(dir);
  return dir;
}

describe("database backup", () => {
  it("restores the database and WAL captured before the update", async () => {
    const dataDir = scratchDir();
    const dbPath = join(dataDir, "bb.db");
    const backupDir = join(dataDir, "app-update-backups", "update-1");
    writeFileSync(dbPath, "before");
    writeFileSync(`${dbPath}-wal`, "before-wal");

    await backupDatabase({ backupDir, dbPath });
    writeFileSync(dbPath, "migrated by the new version");
    writeFileSync(`${dbPath}-wal`, "new wal");
    writeFileSync(`${dbPath}-shm`, "new shm");
    await restoreDatabase({ backupDir, dbPath });

    expect(readFileSync(dbPath, "utf8")).toBe("before");
    expect(readFileSync(`${dbPath}-wal`, "utf8")).toBe("before-wal");
    expect(existsSync(`${dbPath}-shm`)).toBe(false);
    expect(existsSync(join(backupDir, "bb.db"))).toBe(false);
  });

  it("replaces bb.db in place so there is never a moment without a database", async () => {
    const dataDir = scratchDir();
    const dbPath = join(dataDir, "bb.db");
    const backupDir = join(dataDir, "backup");
    writeFileSync(dbPath, "before");
    await backupDatabase({ backupDir, dbPath });
    writeFileSync(dbPath, "migrated");
    const inodeBefore = statSync(join(backupDir, "bb.db")).ino;

    await restoreDatabase({ backupDir, dbPath });

    expect(statSync(dbPath).ino).toBe(inodeBefore);
    expect(readFileSync(dbPath, "utf8")).toBe("before");
  });

  it("drops a WAL the new version created when the backup had none", async () => {
    const dataDir = scratchDir();
    const dbPath = join(dataDir, "bb.db");
    const backupDir = join(dataDir, "backup");
    writeFileSync(dbPath, "before");

    await backupDatabase({ backupDir, dbPath });
    writeFileSync(`${dbPath}-wal`, "written after the update");
    await restoreDatabase({ backupDir, dbPath });

    expect(readFileSync(dbPath, "utf8")).toBe("before");
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
  });

  it("refuses to restore from a missing backup instead of deleting the database", async () => {
    const dataDir = scratchDir();
    const dbPath = join(dataDir, "bb.db");
    writeFileSync(dbPath, "current");

    await expect(
      restoreDatabase({ backupDir: join(dataDir, "missing"), dbPath }),
    ).rejects.toThrow("Database backup is missing");
    expect(readFileSync(dbPath, "utf8")).toBe("current");
  });
});

describe("migration journal comparison", () => {
  const journal = (tags: string[]) =>
    JSON.stringify({ entries: tags.map((tag, idx) => ({ idx, tag })) });

  it("skips the backup when the new version adds no migrations", () => {
    expect(
      requiresDatabaseBackup({
        fromTags: parseMigrationTags(journal(["0001_a", "0002_b"])),
        toTags: parseMigrationTags(journal(["0001_a", "0002_b"])),
      }),
    ).toBe(false);
  });

  it("backs up when the new version adds a migration", () => {
    expect(
      requiresDatabaseBackup({
        fromTags: parseMigrationTags(journal(["0001_a"])),
        toTags: parseMigrationTags(journal(["0001_a", "0002_b"])),
      }),
    ).toBe(true);
  });

  it("backs up when either journal is unreadable", () => {
    expect(
      requiresDatabaseBackup({
        fromTags: parseMigrationTags("not json"),
        toTags: parseMigrationTags(journal(["0001_a"])),
      }),
    ).toBe(true);
    expect(
      requiresDatabaseBackup({
        fromTags: parseMigrationTags(journal(["0001_a"])),
        toTags: parseMigrationTags(null),
      }),
    ).toBe(true);
  });
});
