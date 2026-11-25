import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createConnection,
  getHost,
  sanitizeEnvironmentDiagnosticSnapshot,
  setExperiments,
} from "@bb/db";
import { defaultExperiments, threadScope } from "@bb/domain";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import {
  extractServerArchive,
  serverMovedFileSchema,
} from "@bb/server-archive";
import { makeTempDir } from "@bb/test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportServerArchive } from "../../src/services/server-move/export.js";
import { seedEvent, seedHost, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

async function writeDataFile(
  dataDir: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const path = join(dataDir, ...relativePath.split("/"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

afterEach(() => {
  vi.restoreAllMocks();
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

  it("exports a standalone SQLite snapshot with legacy environment diagnostics sanitized", () =>
    withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      const secret = "fictional-export-3815";
      const legacy = JSON.stringify({
        entries: [{ name: "DEMO_AUTH_TOKEN", source: "shell", value: secret }],
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        providerThreadId: "fixture-provider",
        sequence: 1,
        type: "provider.env-resolved",
        scope: threadScope(),
        data: { entries: [] },
      });
      harness.db.$client
        .prepare("UPDATE events SET data = ? WHERE thread_id = ?")
        .run(legacy, thread.id);
      const beforeDryRun = harness.db.$client.serialize();
      expect(sanitizeEnvironmentDiagnosticSnapshot(harness.db.$client)).toBe(1);
      expect(harness.db.$client.serialize().equals(beforeDryRun)).toBe(true);
      const archive = await exportServerArchive({
        appVersion: harness.config.appVersion,
        dataDir: harness.config.dataDir,
        db: harness.db,
        fileName: "server.tar.gz",
        logger: harness.deps.logger,
        now: 1_700_000_000_000,
        sourceServerHostId: null,
        workDir: join(
          harness.config.dataDir,
          "server-export",
          "export-diagnostics",
        ),
      });
      const destinationDir = await makeTempDir();
      await extractServerArchive({ archivePath: archive.path, destinationDir });
      const path = join(destinationDir, "files", "bb.db");
      const exported = new Database(path, {
        readonly: true,
        fileMustExist: true,
      });
      const select =
        "SELECT data, sequence, provider_thread_id FROM events WHERE thread_id = ?";
      try {
        const row = exported
          .prepare<[string], { data: string }>(select)
          .get(thread.id);
        expect.soft(JSON.parse(row?.data ?? "null")).toEqual({
          entries: [
            {
              name: "DEMO_AUTH_TOKEN",
              source: "shell",
              value: { masked: true },
            },
          ],
        });
        expect(row).toMatchObject({
          sequence: 1,
          provider_thread_id: "fixture-provider",
        });
        expect
          .soft((await readFile(path)).includes(Buffer.from(secret)))
          .toBe(false);
        expect(harness.db.$client.prepare(select).get(thread.id)).toMatchObject(
          { data: legacy },
        );
        expect(sanitizeEnvironmentDiagnosticSnapshot(exported)).toBe(0);
      } finally {
        exported.close();
      }
    }));

  it("aborts export on a malformed diagnostic without changing the source or leaving artifacts", () =>
    withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      const legacyRows = [
        JSON.stringify({
          entries: [
            {
              name: "DEMO_AUTH_TOKEN",
              source: "shell",
              value: "fictional-abort-3815",
            },
          ],
        }),
        JSON.stringify({ entries: "malformed fictional diagnostic" }),
      ];
      const writeLegacy = harness.db.$client.prepare(
        "UPDATE events SET data = ? WHERE thread_id = ? AND sequence = ?",
      );
      for (const [index, data] of legacyRows.entries()) {
        const sequence = index + 1;
        seedEvent(harness.deps, {
          threadId: thread.id,
          providerThreadId: "fixture-provider",
          sequence,
          type: "provider.env-resolved",
          scope: threadScope(),
          data: { entries: [] },
        });
        writeLegacy.run(data, thread.id, sequence);
      }

      const workDir = join(harness.config.dataDir, "server-export", "abort");
      const before = harness.db.$client.serialize();
      const malformedDiagnostic =
        "Invalid provider environment diagnostic data";
      await expect
        .soft(
          exportServerArchive({
            appVersion: harness.config.appVersion,
            dataDir: harness.config.dataDir,
            db: harness.db,
            fileName: "server.tar.gz",
            logger: harness.deps.logger,
            now: 1_700_000_000_000,
            sourceServerHostId: null,
            workDir,
          }),
        )
        .rejects.toThrow(malformedDiagnostic);
      expect.soft(await readdir(workDir)).toEqual([]);
      expect.soft(harness.db.$client.serialize()).toEqual(before);

      const snapshotPath = join(await makeTempDir(), "snapshot.db");
      await harness.db.$client.backup(snapshotPath);
      const copy = createConnection(snapshotPath);
      try {
        expect
          .soft(() =>
            sanitizeEnvironmentDiagnosticSnapshot(copy.$client, "apply"),
          )
          .toThrow(malformedDiagnostic);
      } finally {
        copy.$client.close();
      }
      const readOnlyCopy = new Database(snapshotPath, {
        readonly: true,
        fileMustExist: true,
      });
      try {
        expect(
          readOnlyCopy
            .prepare<[string], { data: string }>(
              "SELECT data FROM events WHERE thread_id = ? ORDER BY rowid",
            )
            .all(thread.id),
        ).toEqual(legacyRows.map((data) => ({ data })));
      } finally {
        readOnlyCopy.close();
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
