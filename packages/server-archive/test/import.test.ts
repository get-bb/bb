import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  archiveExistingServerData,
  discardImportBackups,
  extractServerArchive,
  installImportedServerFiles,
  listServerOwnedEntries,
  mergeImportedManagedConfig,
  removeImportedServerFiles,
  SERVER_IMPORT_BACKUP_DIR_NAME,
  ServerArchiveError,
  type ServerArchiveErrorCode,
  type ServerArchiveManifest,
  serverArchiveManifestSchema,
  writeServerArchive,
} from "../src/index.js";
import {
  fixtureBody,
  HOST_OWNED_FIXTURE_PATHS,
  SERVER_OWNED_FIXTURE_PATHS,
  writeFixtureFile,
} from "./data-dir-fixtures.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "bb-server-import-"));
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

async function readJson(
  dataDir: string,
  relativePath: string,
): Promise<unknown> {
  return JSON.parse(await readDataFile(dataDir, relativePath));
}

async function expectArchiveError(
  promise: Promise<unknown>,
  code: ServerArchiveErrorCode,
): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ServerArchiveError);
  expect(error instanceof ServerArchiveError ? error.code : null).toBe(code);
}

const SOURCE_CONFIG = {
  config: { BB_INFERENCE: "codex/gpt-5.4-mini", BB_LOG_LEVEL: "info" },
  customModels: [{ providerId: "codex", model: "gpt-5.4" }],
  customAcpAgents: [
    { id: "grok", displayName: "Grok", command: "grok", unknownField: true },
  ],
  sharedSkillRoots: { user: [".agents/skills"], project: [] },
};

const TARGET_CONFIG = {
  config: { BB_LOG_LEVEL: "debug", BB_APP_URL: "https://target.example" },
  serverUrl: "https://old-server.example",
  serverHeaders: { "x-bb-connect-machine": "credential" },
  machineCredential: "credential",
  connectMachineId: "machine-1",
};

async function stageImport(): Promise<{
  stagingDir: string;
  manifest: ServerArchiveManifest;
}> {
  const sourceDataDir = await makeTempDir();
  await writeDataFile(sourceDataDir, "bb.db", "server database");
  await writeDataFile(
    sourceDataDir,
    "config.json",
    JSON.stringify(SOURCE_CONFIG),
  );
  await writeDataFile(
    sourceDataDir,
    "env.json",
    JSON.stringify({ env: { SHARED: "from-source", SOURCE_ONLY: "1" } }),
  );
  await writeDataFile(sourceDataDir, "auth-secret", "secret");
  await writeDataFile(sourceDataDir, "attachments/thr_1/image.png", "png");
  await writeDataFile(
    sourceDataDir,
    "skills/review/SKILL.md",
    "imported skill",
  );
  await writeDataFile(sourceDataDir, "plugins/docs/data.db", "docs database");
  await writeDataFile(sourceDataDir, "plugins/docs/secrets/token", "token");
  await writeDataFile(
    sourceDataDir,
    "plugins/docs/host-data/source-only",
    "host",
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

async function createTargetDataDir(): Promise<string> {
  const dataDir = await makeTempDir();
  await writeDataFile(dataDir, "host-id", "host-target");
  await writeDataFile(dataDir, "auth.json", "{}");
  await writeDataFile(dataDir, "config.json", JSON.stringify(TARGET_CONFIG));
  await writeDataFile(
    dataDir,
    "env.json",
    JSON.stringify({ env: { SHARED: "from-target", TARGET_ONLY: "1" } }),
  );
  await writeDataFile(dataDir, "skills/review/SKILL.md", "target skill");
  await writeDataFile(dataDir, "plugins/docs/host-data/vault.md", "vault");
  await writeDataFile(dataDir, "thread-storage/thr_1/notes.md", "notes");
  return dataDir;
}

describe("mergeImportedManagedConfig", () => {
  it("keeps server keys, drops machine keys, and points serverUrl at the local server", () => {
    const merged = mergeImportedManagedConfig({
      importedConfig: {
        config: { BB_LOG_LEVEL: "info" },
        customAcpAgents: [{ id: "raw-agent", futureField: 1 }],
        serverUrl: "https://ignored.example",
        machineCredential: "source-credential",
      },
      existingConfig: {
        config: { BB_LOG_LEVEL: "debug", BB_APP_URL: "https://target.example" },
        customModels: [{ providerId: "codex", model: "gpt-5.4" }],
        serverHeaders: { "x-bb-connect-machine": "target-credential" },
        machineCredential: "target-credential",
        connectMachineId: "machine-1",
      },
      localServerUrl: "http://127.0.0.1:39886",
    });

    expect(merged).toEqual({
      config: { BB_LOG_LEVEL: "info", BB_APP_URL: "https://target.example" },
      customAcpAgents: [{ id: "raw-agent", futureField: 1 }],
      serverUrl: "http://127.0.0.1:39886",
    });
  });

  it("takes custom models, ACP agents, and shared skill roots only from the imported server", () => {
    expect(
      mergeImportedManagedConfig({
        importedConfig: {},
        existingConfig: {
          customModels: [{ providerId: "codex", model: "target-model" }],
          customAcpAgents: [{ id: "target-agent" }],
          sharedSkillRoots: { user: ["~/target-skills"], project: [] },
        },
        localServerUrl: null,
      }),
    ).toEqual({});
  });

  it("omits serverUrl when no local server address is known and lets empty imported lists win", () => {
    expect(
      mergeImportedManagedConfig({
        importedConfig: { customModels: [] },
        existingConfig: {
          customModels: [{ providerId: "codex", model: "gpt-5.4" }],
          serverUrl: "https://old-server.example",
        },
        localServerUrl: null,
      }),
    ).toEqual({});
  });
});

describe("installImportedServerFiles and removeImportedServerFiles", () => {
  it("installs server files, merges managed config, and restores the target on removal", async () => {
    const { stagingDir, manifest } = await stageImport();
    const dataDir = await createTargetDataDir();
    const originalConfig = await readDataFile(dataDir, "config.json");
    const originalEnv = await readDataFile(dataDir, "env.json");

    const result = await installImportedServerFiles({
      stagingDir,
      dataDir,
      manifest,
      localServerUrl: "http://127.0.0.1:39886",
    });

    expect([...result.importedEntries].sort()).toEqual([
      "attachments/thr_1/image.png",
      "auth-secret",
      "bb.db",
      "config.json",
      "env.json",
      "plugins/docs/data.db",
      "plugins/docs/secrets/token",
      "skills/review/SKILL.md",
    ]);
    expect(result.importedEntries.at(-1)).toBe("bb.db");
    expect([...result.backups].sort()).toEqual([
      "config.json",
      "env.json",
      "skills/review/SKILL.md",
    ]);
    expect(await readDataFile(dataDir, "bb.db")).toBe("server database");
    expect(await readDataFile(dataDir, "skills/review/SKILL.md")).toBe(
      "imported skill",
    );
    expect(await readDataFile(dataDir, "plugins/docs/secrets/token")).toBe(
      "token",
    );
    expect(await readDataFile(dataDir, "host-id")).toBe("host-target");
    expect(await readDataFile(dataDir, "plugins/docs/host-data/vault.md")).toBe(
      "vault",
    );
    expect(await readdir(path.join(dataDir, "plugins", "docs"))).not.toContain(
      "source-only",
    );
    expect(await readJson(dataDir, "config.json")).toEqual({
      config: {
        BB_APP_URL: "https://target.example",
        BB_INFERENCE: "codex/gpt-5.4-mini",
        BB_LOG_LEVEL: "info",
      },
      customModels: SOURCE_CONFIG.customModels,
      customAcpAgents: SOURCE_CONFIG.customAcpAgents,
      sharedSkillRoots: SOURCE_CONFIG.sharedSkillRoots,
      serverUrl: "http://127.0.0.1:39886",
    });
    expect((await stat(path.join(dataDir, "config.json"))).mode & 0o777).toBe(
      0o600,
    );
    expect(await readJson(dataDir, "env.json")).toEqual({
      env: { SHARED: "from-source", SOURCE_ONLY: "1", TARGET_ONLY: "1" },
    });
    expect(
      await readDataFile(
        dataDir,
        `${SERVER_IMPORT_BACKUP_DIR_NAME}/config.json`,
      ),
    ).toBe(originalConfig);

    await writeDataFile(dataDir, "bb.db-wal", "pending server wal");
    await removeImportedServerFiles({
      dataDir,
      importedEntries: result.importedEntries,
    });

    expect((await readdir(dataDir)).sort()).toEqual([
      "auth.json",
      "config.json",
      "env.json",
      "host-id",
      "plugins",
      "skills",
      "thread-storage",
    ]);
    expect(await readDataFile(dataDir, "config.json")).toBe(originalConfig);
    expect(await readDataFile(dataDir, "env.json")).toBe(originalEnv);
    expect(await readDataFile(dataDir, "skills/review/SKILL.md")).toBe(
      "target skill",
    );
    expect(await readdir(path.join(dataDir, "plugins", "docs"))).toEqual([
      "host-data",
    ]);
  });

  it("refuses to import over existing server data without touching the target", async () => {
    const { stagingDir, manifest } = await stageImport();
    for (const existing of [
      "bb.db",
      "bb.db-wal",
      SERVER_IMPORT_BACKUP_DIR_NAME,
    ]) {
      const dataDir = await createTargetDataDir();
      await writeDataFile(
        dataDir,
        existing === SERVER_IMPORT_BACKUP_DIR_NAME
          ? `${existing}/config.json`
          : existing,
        "existing",
      );
      const originalConfig = await readDataFile(dataDir, "config.json");

      await expectArchiveError(
        installImportedServerFiles({
          stagingDir,
          dataDir,
          manifest,
          localServerUrl: "http://127.0.0.1:39886",
        }),
        "server_data_exists",
      );

      expect(await readDataFile(dataDir, "config.json")).toBe(originalConfig);
      expect(await readdir(dataDir)).not.toContain("auth-secret");
    }
  });

  it("refuses to write through a symbolic link inside the target data directory", async () => {
    const { stagingDir, manifest } = await stageImport();
    const dataDir = await createTargetDataDir();
    const outside = await makeTempDir();
    await rm(path.join(dataDir, "plugins", "docs"), { recursive: true });
    await symlink(outside, path.join(dataDir, "plugins", "docs"));

    await expectArchiveError(
      installImportedServerFiles({
        stagingDir,
        dataDir,
        manifest,
        localServerUrl: null,
      }),
      "unsafe_entry",
    );

    expect(await readdir(outside)).toEqual([]);
    expect(await readdir(dataDir)).not.toContain("bb.db");
  });

  it("rejects an invalid imported config before changing the target", async () => {
    const { stagingDir, manifest } = await stageImport();
    await writeFile(
      path.join(stagingDir, "files", "config.json"),
      JSON.stringify({ config: {}, unexpectedTopLevelKey: true }),
    );
    const invalidSize = (
      await stat(path.join(stagingDir, "files", "config.json"))
    ).size;
    const invalidManifest: ServerArchiveManifest = {
      ...manifest,
      entries: manifest.entries.map((entry) =>
        entry.path === "config.json" ? { ...entry, size: invalidSize } : entry,
      ),
    };
    const dataDir = await createTargetDataDir();
    const originalConfig = await readDataFile(dataDir, "config.json");

    await expectArchiveError(
      installImportedServerFiles({
        stagingDir,
        dataDir,
        manifest: invalidManifest,
        localServerUrl: null,
      }),
      "corrupt",
    );

    expect(await readDataFile(dataDir, "config.json")).toBe(originalConfig);
    expect(await readDataFile(dataDir, "skills/review/SKILL.md")).toBe(
      "target skill",
    );
    expect(await readdir(dataDir)).not.toContain(SERVER_IMPORT_BACKUP_DIR_NAME);
  });
});

async function stageManifestEntries(paths: readonly string[]): Promise<{
  stagingDir: string;
  manifest: ServerArchiveManifest;
}> {
  const stagingDir = await makeTempDir();
  const entries = [];
  for (const relativePath of paths) {
    const body = fixtureBody(relativePath);
    await writeFixtureFile(path.join(stagingDir, "files"), relativePath, body);
    entries.push({
      path: relativePath,
      size: Buffer.byteLength(body),
      sha256: createHash("sha256").update(body).digest("hex"),
    });
  }
  const manifest = serverArchiveManifestSchema.parse({
    format: "bb-server-archive",
    version: 1,
    createdAt: 1,
    bbVersion: "0.43.1",
    protocolVersion: 209,
    migrationCount: 142,
    sourceDataDir: "/home/old/.bb",
    sourceServerHostId: "host-old",
    serverMoveExperiment: true,
    entries,
  });
  return { stagingDir, manifest };
}

describe("server-owned allowlist on import", () => {
  it("installs every file the inventory classifies as server-owned", async () => {
    const sourceDataDir = await makeTempDir();
    for (const relativePath of [
      ...SERVER_OWNED_FIXTURE_PATHS,
      ...HOST_OWNED_FIXTURE_PATHS,
    ]) {
      await writeFixtureFile(sourceDataDir, relativePath);
    }
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
    const dataDir = await makeTempDir();

    const result = await installImportedServerFiles({
      stagingDir,
      dataDir,
      manifest,
      localServerUrl: null,
    });

    expect([...result.importedEntries].sort()).toEqual(
      [...SERVER_OWNED_FIXTURE_PATHS].sort(),
    );
  });

  it.each([
    ...HOST_OWNED_FIXTURE_PATHS,
    "bb.db/nested",
    "plugins/docs",
    "plugins/docs/host-data",
  ])(
    "refuses a manifest entry for %s before moving anything into place",
    async (hostOwnedPath) => {
      const { stagingDir, manifest } = await stageManifestEntries([
        "attachments/thr_1/image.png",
        hostOwnedPath,
      ]);
      const dataDir = await createTargetDataDir();

      await expectArchiveError(
        installImportedServerFiles({
          stagingDir,
          dataDir,
          manifest,
          localServerUrl: "http://127.0.0.1:39886",
        }),
        "unsafe_entry",
      );

      expect((await readdir(dataDir)).sort()).toEqual([
        "auth.json",
        "config.json",
        "env.json",
        "host-id",
        "plugins",
        "skills",
        "thread-storage",
      ]);
      expect(await readDataFile(dataDir, "auth.json")).toBe("{}");
      expect(await readDataFile(dataDir, "host-id")).toBe("host-target");
      expect(await readJson(dataDir, "config.json")).toEqual(TARGET_CONFIG);
      expect(
        await readDataFile(
          path.join(stagingDir, "files"),
          "attachments/thr_1/image.png",
        ),
      ).toBe(fixtureBody("attachments/thr_1/image.png"));
    },
  );

  it("refuses to remove host-owned entries", async () => {
    const dataDir = await createTargetDataDir();
    await writeDataFile(dataDir, "bb.db", "imported database");

    await expectArchiveError(
      removeImportedServerFiles({
        dataDir,
        importedEntries: ["bb.db", "auth.json"],
      }),
      "unsafe_entry",
    );

    expect(await readDataFile(dataDir, "bb.db")).toBe("imported database");
    expect(await readDataFile(dataDir, "auth.json")).toBe("{}");
  });
});

describe("discardImportBackups", () => {
  it("removes the backup directory without following symbolic links", async () => {
    const dataDir = await createTargetDataDir();
    const outside = await makeTempDir();
    await writeDataFile(outside, "keep/notes.md", "outside notes");
    await writeDataFile(
      dataDir,
      `${SERVER_IMPORT_BACKUP_DIR_NAME}/config.json`,
      "backup",
    );
    await symlink(
      path.join(outside, "keep"),
      path.join(dataDir, SERVER_IMPORT_BACKUP_DIR_NAME, "skills"),
    );
    await symlink(
      path.join(outside, "keep", "notes.md"),
      path.join(dataDir, SERVER_IMPORT_BACKUP_DIR_NAME, "env.json"),
    );

    await discardImportBackups(dataDir);
    await discardImportBackups(dataDir);

    expect(await readdir(dataDir)).not.toContain(SERVER_IMPORT_BACKUP_DIR_NAME);
    expect(await readDataFile(outside, "keep/notes.md")).toBe("outside notes");
    expect(await readDataFile(dataDir, "config.json")).toBe(
      JSON.stringify(TARGET_CONFIG),
    );
  });

  it("unlinks a symbolic link at the backup path instead of deleting its target", async () => {
    const dataDir = await createTargetDataDir();
    const outside = await makeTempDir();
    await writeDataFile(outside, "config.json", "outside");
    await symlink(outside, path.join(dataDir, SERVER_IMPORT_BACKUP_DIR_NAME));

    await discardImportBackups(dataDir);

    expect(await readdir(dataDir)).not.toContain(SERVER_IMPORT_BACKUP_DIR_NAME);
    expect(await readDataFile(outside, "config.json")).toBe("outside");
  });

  it("lets a later import proceed after backups are discarded", async () => {
    const { stagingDir, manifest } = await stageImport();
    const dataDir = await createTargetDataDir();
    await writeDataFile(
      dataDir,
      `${SERVER_IMPORT_BACKUP_DIR_NAME}/config.json`,
      "stale backup",
    );

    await discardImportBackups(dataDir);
    const result = await installImportedServerFiles({
      stagingDir,
      dataDir,
      manifest,
      localServerUrl: null,
    });

    expect(result.importedEntries).toContain("bb.db");
  });
});

describe("archiveExistingServerData", () => {
  it("renames the data directory with a local timestamp suffix and avoids collisions", async () => {
    const parent = await makeTempDir();
    const dataDir = path.join(parent, ".bb");
    await writeDataFile(dataDir, "bb.db", "standalone");
    const now = new Date(2026, 8, 15, 9, 5, 7).getTime();

    const archivedPath = await archiveExistingServerData({
      dataDir: `${dataDir}/`,
      now,
    });

    expect(archivedPath).toBe(`${dataDir}.before-move-20260915-090507`);
    expect(await readDataFile(archivedPath, "bb.db")).toBe("standalone");
    expect(await readdir(parent)).toEqual([".bb.before-move-20260915-090507"]);

    await writeDataFile(dataDir, "bb.db", "second standalone");
    const secondArchivedPath = await archiveExistingServerData({
      dataDir,
      now,
    });

    expect(secondArchivedPath).toBe(`${dataDir}.before-move-20260915-090507-2`);
    expect(await readDataFile(secondArchivedPath, "bb.db")).toBe(
      "second standalone",
    );
    expect(await readDataFile(archivedPath, "bb.db")).toBe("standalone");
  });
});
