import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LAST_SERVER_MOVE_FILE_NAME,
  readLastServerMoveFile,
  readServerImportFile,
  readServerMovedFile,
  SERVER_IMPORT_FILE_NAME,
  SERVER_MOVED_FILE_NAME,
  type ServerImportFile,
  type ServerMovedFile,
  writeLastServerMoveFile,
  writeServerImportFile,
  writeServerMovedFile,
} from "../src/index.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "bb-server-markers-"));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((tempDir) => rm(tempDir, { force: true, recursive: true })),
  );
});

const MOVED_FILE: ServerMovedFile = {
  version: 1,
  moveId: "move-1",
  movedAt: 1_757_000_000_000,
  fromHostId: "host-old",
  toHostId: "host-new",
  toHostName: "desktop",
  serverUrl: "https://bb.example",
  mode: "connect",
  connectHandle: "sawyer",
  oldCopyEntries: ["bb.db", "attachments", "plugins/docs/data.db"],
};

const IMPORT_FILE: ServerImportFile = {
  version: 1,
  kind: "move",
  moveId: "move-1",
  activationToken: "activation-token-0123456789",
  sourceDataDir: "/home/old/.bb",
  sourceServerHostId: "host-old",
  targetHostId: "host-new",
  serverUrl: null,
  importedEntries: ["bb.db", "config.json"],
  createdAt: 1_757_000_000_000,
  fixupsAppliedAt: null,
};

describe("server move marker files", () => {
  it("returns null for absent markers and round trips each marker with mode 0600", async () => {
    const dataDir = await makeTempDir();
    expect(await readServerMovedFile(dataDir)).toBeNull();
    expect(await readServerImportFile(dataDir)).toBeNull();
    expect(await readLastServerMoveFile(dataDir)).toBeNull();

    const lastMove = {
      version: 1 as const,
      moveId: "move-1",
      fromHostId: "host-old",
      fromHostName: "laptop",
      toHostId: "host-new",
      toHostName: "desktop",
      completedAt: 1_757_000_000_000,
      oldCopyDeletedAt: null,
    };
    await writeServerMovedFile(dataDir, MOVED_FILE);
    await writeServerImportFile(dataDir, IMPORT_FILE);
    await writeLastServerMoveFile(dataDir, lastMove);

    expect(await readServerMovedFile(dataDir)).toEqual(MOVED_FILE);
    expect(await readServerImportFile(dataDir)).toEqual(IMPORT_FILE);
    expect(await readLastServerMoveFile(dataDir)).toEqual(lastMove);
    expect((await readdir(dataDir)).sort()).toEqual(
      [
        LAST_SERVER_MOVE_FILE_NAME,
        SERVER_IMPORT_FILE_NAME,
        SERVER_MOVED_FILE_NAME,
      ].sort(),
    );
    for (const fileName of await readdir(dataDir)) {
      expect((await stat(path.join(dataDir, fileName))).mode & 0o777).toBe(
        0o600,
      );
    }
  });

  it("throws on invalid JSON and on markers that fail the schema", async () => {
    const dataDir = await makeTempDir();
    await writeFile(path.join(dataDir, SERVER_MOVED_FILE_NAME), "{ not json");
    await expect(readServerMovedFile(dataDir)).rejects.toThrow(/Invalid JSON/u);

    await writeFile(
      path.join(dataDir, SERVER_IMPORT_FILE_NAME),
      JSON.stringify({ ...IMPORT_FILE, extra: true }),
    );
    await expect(readServerImportFile(dataDir)).rejects.toThrow(/Invalid/u);
  });

  it("refuses to write markers that could target paths outside the data directory", async () => {
    const dataDir = await makeTempDir();
    for (const oldCopyEntry of ["../.ssh", "auth.json", "plugins/docs"]) {
      await expect(
        writeServerMovedFile(dataDir, {
          ...MOVED_FILE,
          oldCopyEntries: [oldCopyEntry],
        }),
      ).rejects.toThrow(/server-owned/u);
    }
    for (const importedEntry of ["/etc/passwd", "host-id", "npm/lib/x"]) {
      await expect(
        writeServerImportFile(dataDir, {
          ...IMPORT_FILE,
          importedEntries: [importedEntry],
        }),
      ).rejects.toThrow(/server-owned/u);
    }
    await expect(
      writeServerImportFile(dataDir, {
        ...IMPORT_FILE,
        activationToken: null,
      }),
    ).rejects.toThrow(/activationToken/u);
    expect(await readdir(dataDir)).toEqual([]);
  });
});
