import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createConnection, getHost, setExperiments } from "@bb/db";
import { defaultExperiments } from "@bb/domain";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import {
  extractServerArchive,
  serverMovedFileSchema,
} from "@bb/server-archive";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportServerArchive } from "../../src/services/server-move/export.js";
import { seedHost } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bb-server-move-export-"));
  tempDirs.push(dir);
  return dir;
}

async function writeDataFile(
  dataDir: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const path = join(dataDir, ...relativePath.split("/"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

describe("server archive export", () => {
  it("snapshots live databases and leaves host-owned files out of the archive", () =>
    withTestHarness(async (harness) => {
      const dataDir = harness.config.dataDir;
      seedHost(harness.deps, { id: "host-old", name: "Laptop" });
      await writeDataFile(dataDir, "config.json", '{"config":{}}\n');
      await writeDataFile(dataDir, "attachments/project-1/notes.txt", "notes");
      await writeDataFile(dataDir, "plugins/tasks/secrets/token", "secret");
      await writeDataFile(dataDir, "plugins/tasks/host-data/cache.txt", "x");
      await writeDataFile(dataDir, "plugins/tasks/logs/plugin.log", "x");
      await writeDataFile(dataDir, "host-id", "host-old\n");
      await writeDataFile(dataDir, "auth.json", "{}");
      await writeDataFile(dataDir, "thread-storage/thr_1/notes.md", "x");
      await writeDataFile(dataDir, "worktrees/wt/file.txt", "x");
      const outsideSkill = await makeTempDir();
      await writeDataFile(outsideSkill, "SKILL.md", "linked skill");
      await mkdir(join(dataDir, "skills"), { recursive: true });
      await symlink(outsideSkill, join(dataDir, "skills", "linked-skill"));
      const warn = vi.spyOn(harness.deps.logger, "warn");
      const pluginDatabasePath = join(dataDir, "plugins", "tasks", "data.db");
      const pluginDatabase = new Database(pluginDatabasePath);
      pluginDatabase.pragma("journal_mode = WAL");
      pluginDatabase.pragma("wal_autocheckpoint = 0");
      pluginDatabase.exec("CREATE TABLE items (name TEXT NOT NULL)");
      pluginDatabase
        .prepare("INSERT INTO items (name) VALUES (?)")
        .run("written only to the WAL");
      const workDir = join(dataDir, "server-move", "move-1");
      try {
        expect(existsSync(`${pluginDatabasePath}-wal`)).toBe(true);

        const archive = await exportServerArchive({
          appVersion: harness.config.appVersion,
          dataDir,
          db: harness.db,
          fileName: "server.tar.gz",
          logger: harness.deps.logger,
          now: 1_700_000_000_000,
          sourceServerHostId: "host-old",
          workDir,
        });

        expect(archive.path).toBe(join(workDir, "server.tar.gz"));
        expect(archive.skippedPaths).toEqual(["skills/linked-skill"]);
        expect(warn).toHaveBeenCalledWith(
          { dataDir, skippedPaths: ["skills/linked-skill"] },
          "Server export skipped symbolic links and special files",
        );
        expect(existsSync(join(workDir, "snapshot"))).toBe(false);
        expect((await readFile(archive.path)).subarray(0, 2)).toEqual(
          Buffer.from([0x1f, 0x8b]),
        );
        expect(archive.oldCopyEntries).toEqual([
          "attachments",
          "auth-secret",
          "plugins/tasks/data.db",
          "plugins/tasks/secrets",
          "skills",
        ]);
        expect(
          serverMovedFileSchema.shape.oldCopyEntries.parse(
            archive.oldCopyEntries,
          ),
        ).toEqual(archive.oldCopyEntries);

        const destination = await makeTempDir();
        const manifest = await extractServerArchive({
          archivePath: archive.path,
          destinationDir: destination,
        });
        expect(manifest).toMatchObject({
          bbVersion: harness.config.appVersion,
          createdAt: 1_700_000_000_000,
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          sourceDataDir: dataDir,
          sourceServerHostId: "host-old",
          serverMoveExperiment: false,
        });
        expect(manifest.migrationCount).toBeGreaterThan(100);
        const paths = manifest.entries.map((entry) => entry.path);
        expect(paths).toEqual(
          expect.arrayContaining([
            "bb.db",
            "config.json",
            "attachments/project-1/notes.txt",
            "plugins/tasks/data.db",
            "plugins/tasks/secrets/token",
          ]),
        );
        for (const hostOwned of [
          "host-id",
          "auth.json",
          "thread-storage/thr_1/notes.md",
          "worktrees/wt/file.txt",
          "plugins/tasks/host-data/cache.txt",
          "plugins/tasks/logs/plugin.log",
          "plugins/tasks/data.db-wal",
          "plugins/tasks/data.db-shm",
          "skills/linked-skill/SKILL.md",
        ]) {
          expect(paths).not.toContain(hostOwned);
        }
        expect(paths.some((path) => path.startsWith("server-move"))).toBe(
          false,
        );

        const importedDb = createConnection(
          join(destination, "files", "bb.db"),
        );
        try {
          expect(getHost(importedDb, "host-old")).toMatchObject({
            name: "Laptop",
          });
        } finally {
          importedDb.$client.close();
        }
        const importedPluginDatabase = new Database(
          join(destination, "files", "plugins", "tasks", "data.db"),
          { readonly: true },
        );
        try {
          expect(
            importedPluginDatabase.prepare("SELECT name FROM items").all(),
          ).toEqual([{ name: "written only to the WAL" }]);
        } finally {
          importedPluginDatabase.close();
        }
      } finally {
        pluginDatabase.close();
      }
    }));

  it("records the server's live serverMove experiment in the manifest", () =>
    withTestHarness(async (harness) => {
      setExperiments(harness.db, { ...defaultExperiments, serverMove: true });

      const archive = await exportServerArchive({
        appVersion: harness.config.appVersion,
        dataDir: harness.config.dataDir,
        db: harness.db,
        fileName: "server.tar.gz",
        logger: harness.deps.logger,
        now: 1_700_000_000_000,
        sourceServerHostId: null,
        workDir: join(harness.config.dataDir, "server-export", "export-1"),
      });

      const manifest = await extractServerArchive({
        archivePath: archive.path,
        destinationDir: await makeTempDir(),
      });
      expect(manifest.serverMoveExperiment).toBe(true);
    }));
});
