import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractServerArchive,
  installImportedServerFiles,
  listServerOwnedEntries,
  readServerImportFile,
  readServerImportJournalFile,
  rollBackServerImport,
  SERVER_IMPORT_BACKUP_DIR_NAME,
  SERVER_IMPORT_JOURNAL_FILE_NAME,
  ServerArchiveError,
  type ServerArchiveManifest,
  type ServerImportFile,
  writeServerArchive,
  writeServerImportFile,
} from "../src/index.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "bb-server-journal-"));
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

async function writeDataFile(
  dataDir: string,
  relativePath: string,
  body: string,
): Promise<void> {
  const filePath = path.join(dataDir, ...relativePath.split("/"));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, body);
}

function readDataFile(dataDir: string, relativePath: string): Promise<string> {
  return readFile(path.join(dataDir, ...relativePath.split("/")), "utf8");
}

const PLANNED_ENTRIES = [
  "attachments/thr_1/image.png",
  "auth-secret",
  "skills/review/SKILL.md",
  "config.json",
  "env.json",
  "bb.db",
];
const PREEXISTING_ENTRIES = [
  "skills/review/SKILL.md",
  "config.json",
  "env.json",
];
const TARGET_ENTRIES = [
  "config.json",
  "env.json",
  "host-id",
  "skills",
  "thread-storage",
];

async function stageImport(): Promise<{
  stagingDir: string;
  manifest: ServerArchiveManifest;
}> {
  const sourceDataDir = await makeTempDir();
  await writeDataFile(sourceDataDir, "bb.db", "server database");
  await writeDataFile(
    sourceDataDir,
    "config.json",
    JSON.stringify({ config: { BB_LOG_LEVEL: "info" } }),
  );
  await writeDataFile(
    sourceDataDir,
    "env.json",
    JSON.stringify({ env: { SOURCE_ONLY: "1" } }),
  );
  await writeDataFile(sourceDataDir, "auth-secret", "secret");
  await writeDataFile(sourceDataDir, "attachments/thr_1/image.png", "png");
  await writeDataFile(
    sourceDataDir,
    "skills/review/SKILL.md",
    "imported skill",
  );
  const inventory = await listServerOwnedEntries(sourceDataDir);
  const workDir = await makeTempDir();
  const archivePath = path.join(workDir, "server.tar.gz");
  await writeServerArchive({
    outPath: archivePath,
    files: inventory.entries
      .flatMap((entry) => entry.files)
      .map((file) => ({
        sourcePath: file.absolutePath,
        archivePath: file.path,
      })),
    manifest: {
      createdAt: 1,
      bbVersion: "0.43.1",
      protocolVersion: 209,
      migrationCount: 142,
      sourceDataDir,
      sourceServerHostId: "host-old",
      serverMoveExperiment: true,
    },
  });
  const stagingDir = path.join(workDir, "staging");
  const manifest = await extractServerArchive({
    archivePath,
    destinationDir: stagingDir,
  });
  return { stagingDir, manifest };
}

function manualImportMarker(importedEntries: string[]): ServerImportFile {
  return {
    version: 1,
    kind: "manual",
    moveId: null,
    activationToken: null,
    sourceDataDir: "/home/old/.bb",
    sourceServerHostId: "host-old",
    targetHostId: null,
    serverUrl: null,
    importedEntries,
    createdAt: 1,
    fixupsAppliedAt: null,
  };
}

async function createTargetDataDir(): Promise<string> {
  const dataDir = await makeTempDir();
  await writeDataFile(dataDir, "host-id", "host-target");
  await writeDataFile(
    dataDir,
    "config.json",
    JSON.stringify({ serverUrl: "https://old-server.example" }),
  );
  await writeDataFile(
    dataDir,
    "env.json",
    JSON.stringify({ env: { TARGET_ONLY: "1" } }),
  );
  await writeDataFile(dataDir, "skills/review/SKILL.md", "target skill");
  await writeDataFile(dataDir, "thread-storage/thr_1/notes.md", "notes");
  return dataDir;
}

describe("server import journal", () => {
  it("records the planned and pre-existing entries before installing", async () => {
    const { stagingDir, manifest } = await stageImport();
    const dataDir = await createTargetDataDir();

    const result = await installImportedServerFiles({
      stagingDir,
      dataDir,
      manifest,
      localServerUrl: null,
    });

    expect(result.importedEntries).toEqual(PLANNED_ENTRIES);
    expect(await readServerImportJournalFile(dataDir)).toEqual({
      version: 1,
      entries: PLANNED_ENTRIES,
      preexistingEntries: PREEXISTING_ENTRIES,
    });
  });

  it("rolls back a finished install that its caller never recorded", async () => {
    const { stagingDir, manifest } = await stageImport();
    const dataDir = await createTargetDataDir();
    const originalConfig = await readDataFile(dataDir, "config.json");
    const originalEnv = await readDataFile(dataDir, "env.json");
    await installImportedServerFiles({
      stagingDir,
      dataDir,
      manifest,
      localServerUrl: "http://127.0.0.1:39886",
    });
    await writeDataFile(dataDir, "bb.db-wal", "pending server wal");

    const rolledBack = await rollBackServerImport(dataDir);

    expect(rolledBack?.entries).toEqual(PLANNED_ENTRIES);
    expect((await readdir(dataDir)).sort()).toEqual([
      ".config.json.lock",
      ".env.json.lock",
      ...TARGET_ENTRIES,
    ]);
    expect(await readDataFile(dataDir, "config.json")).toBe(originalConfig);
    expect(await readDataFile(dataDir, "env.json")).toBe(originalEnv);
    expect(await readDataFile(dataDir, "skills/review/SKILL.md")).toBe(
      "target skill",
    );
  });

  it("keeps an import that server-import.json recorded and removes only the leftover journal", async () => {
    const { stagingDir, manifest } = await stageImport();
    const dataDir = await createTargetDataDir();
    const installed = await installImportedServerFiles({
      stagingDir,
      dataDir,
      manifest,
      localServerUrl: null,
    });
    await writeServerImportFile(
      dataDir,
      manualImportMarker(installed.importedEntries),
    );

    expect(await rollBackServerImport(dataDir)).toBeNull();

    expect(await readServerImportJournalFile(dataDir)).toBeNull();
    expect(await readDataFile(dataDir, "bb.db")).toBe("server database");
    expect(await readDataFile(dataDir, "auth-secret")).toBe("secret");
    expect(await readDataFile(dataDir, "skills/review/SKILL.md")).toBe(
      "imported skill",
    );
    expect(await readServerImportFile(dataDir)).toEqual(
      manualImportMarker(PLANNED_ENTRIES),
    );
  });

  it("rolls back an install whose server-import.json doesn't record every journaled entry", async () => {
    const { stagingDir, manifest } = await stageImport();
    const dataDir = await createTargetDataDir();
    const installed = await installImportedServerFiles({
      stagingDir,
      dataDir,
      manifest,
      localServerUrl: null,
    });
    await writeServerImportFile(
      dataDir,
      manualImportMarker(
        installed.importedEntries.filter((entry) => entry !== "bb.db"),
      ),
    );

    expect((await rollBackServerImport(dataDir))?.entries).toEqual(
      PLANNED_ENTRIES,
    );

    expect(await readdir(dataDir)).not.toContain("bb.db");
    expect(await readDataFile(dataDir, "skills/review/SKILL.md")).toBe(
      "target skill",
    );
  });

  it("drops a stale server-import.json before journaling, so it never records the new install", async () => {
    const { stagingDir, manifest } = await stageImport();
    const dataDir = await createTargetDataDir();
    await writeServerImportFile(dataDir, manualImportMarker(PLANNED_ENTRIES));

    await installImportedServerFiles({
      stagingDir,
      dataDir,
      manifest,
      localServerUrl: null,
    });

    expect(await readServerImportFile(dataDir)).toBeNull();
    expect((await rollBackServerImport(dataDir))?.entries).toEqual(
      PLANNED_ENTRIES,
    );
    expect(await readdir(dataDir)).not.toContain("bb.db");
  });

  it("rolls back an install interrupted partway without touching entries it never reached", async () => {
    const dataDir = await createTargetDataDir();
    const originalConfig = await readDataFile(dataDir, "config.json");
    const originalEnv = await readDataFile(dataDir, "env.json");
    await writeDataFile(dataDir, "attachments/thr_1/image.png", "imported png");
    await writeDataFile(dataDir, "auth-secret", "imported secret");
    await mkdir(
      path.join(dataDir, SERVER_IMPORT_BACKUP_DIR_NAME, "skills", "review"),
      { recursive: true },
    );
    await rename(
      path.join(dataDir, "skills", "review", "SKILL.md"),
      path.join(
        dataDir,
        SERVER_IMPORT_BACKUP_DIR_NAME,
        "skills",
        "review",
        "SKILL.md",
      ),
    );
    await writeDataFile(
      dataDir,
      SERVER_IMPORT_JOURNAL_FILE_NAME,
      JSON.stringify({
        version: 1,
        entries: PLANNED_ENTRIES,
        preexistingEntries: PREEXISTING_ENTRIES,
      }),
    );

    await rollBackServerImport(dataDir);

    expect((await readdir(dataDir)).sort()).toEqual(TARGET_ENTRIES);
    expect(await readDataFile(dataDir, "skills/review/SKILL.md")).toBe(
      "target skill",
    );
    expect(await readDataFile(dataDir, "config.json")).toBe(originalConfig);
    expect(await readDataFile(dataDir, "env.json")).toBe(originalEnv);
  });

  it("changes nothing when there is no interrupted import", async () => {
    const dataDir = await createTargetDataDir();

    expect(await rollBackServerImport(dataDir)).toBeNull();

    expect((await readdir(dataDir)).sort()).toEqual(TARGET_ENTRIES);
  });

  it("refuses to install while an interrupted import's journal is present", async () => {
    const { stagingDir, manifest } = await stageImport();
    const dataDir = await createTargetDataDir();
    await writeDataFile(
      dataDir,
      SERVER_IMPORT_JOURNAL_FILE_NAME,
      JSON.stringify({
        version: 1,
        entries: ["bb.db"],
        preexistingEntries: [],
      }),
    );

    const error = await installImportedServerFiles({
      stagingDir,
      dataDir,
      manifest,
      localServerUrl: null,
    }).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(ServerArchiveError);
    expect(error instanceof ServerArchiveError ? error.code : null).toBe(
      "server_data_exists",
    );
    expect(await readdir(dataDir)).not.toContain("bb.db");
    expect(await readdir(dataDir)).not.toContain(SERVER_IMPORT_BACKUP_DIR_NAME);
  });
});
