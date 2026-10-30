import { execFile } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteInstalledPlugin,
  getInstalledPluginRegistration,
  getPluginKvValue,
  listExpiredPluginStateSnapshots,
  listPluginStateSnapshots,
  setPluginKvValue,
  setPluginStateSnapshotRollbackPending,
  type DbConnection,
  type PluginStateSnapshotRow,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import type { Logger } from "@bb/logger";
import { createAiServiceRegistry } from "../../../src/services/ai/ai-service-registry.js";
import {
  createPluginService,
  type PluginService,
  type PluginServiceDeps,
} from "../../../src/services/plugins/plugin-service.js";
import { pluginRestoreHold } from "../../../src/services/plugins/plugin-state-snapshot.js";
import { withPluginUpdateProgress } from "../../../src/services/plugins/plugin-update-progress.js";
import { createNoopTelemetryService } from "../../../src/services/system/telemetry.js";
import { testLogger } from "../../helpers/test-app.js";

const logger = testLogger as unknown as Logger;
const run = promisify(execFile);
const PLUGIN_ID = "recovering";
const BYSTANDER_ID = "bystander";
const HELD = `held until bb finishes undoing its update: Path is a directory`;
const withoutFilePermissions =
  process.platform === "win32" ||
  (typeof process.getuid === "function" && process.getuid() === 0);

async function git(cwd: string, args: string[]): Promise<string> {
  return (await run("git", args, { cwd })).stdout.trim();
}

describe("plugin update recovery", () => {
  let db: DbConnection;
  let workDir: string;
  let repo: string;
  let dataDir: string;
  let service: PluginService;

  function createService(overrides: Partial<PluginServiceDeps> = {}) {
    return createPluginService({
      aiServices: createAiServiceRegistry(),
      telemetry: createNoopTelemetryService(),
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginChanged: () => {},
        notifyPluginSignal: () => 0,
        onWatchedTargets: () => () => {},
        notifySystem: () => {},
      },
      logger,
      dataDir,
      appVersion: "1.0.0",
      loadTimeoutMs: 2000,
      stabilizationWindowMs: 0,
      ...overrides,
    });
  }

  async function restart(overrides: Partial<PluginServiceDeps> = {}) {
    await service.stop();
    service = createService(overrides);
    await service.start();
  }

  async function release(version: string): Promise<string> {
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({
        name: `bb-plugin-${PLUGIN_ID}`,
        version,
        bb: {
          name: "Recovery fixture",
          description: "Plugin recovery fixture.",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(
      join(repo, "server.ts"),
      `export default function plugin() {
        if (((globalThis as any).__bbFailingReleases ?? []).includes(${JSON.stringify(version)})) {
          throw new Error(${JSON.stringify(`release ${version} failed to start`)});
        }
      }`,
    );
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "-qm", version]);
    await git(repo, ["tag", `v${version}`]);
    return git(repo, ["rev-parse", "HEAD"]);
  }

  function failReleases(...versions: string[]) {
    vi.stubGlobal("__bbFailingReleases", versions);
  }

  function listed(id: string) {
    return service.list().find((plugin) => plugin.id === id);
  }

  async function offered(version: string): Promise<string> {
    const commit = await release(version);
    expect(await service.checkForUpdates(PLUGIN_ID)).toMatchObject([
      { outcome: "update-available", candidate: { version: commit } },
    ]);
    return commit;
  }

  function cursor(): unknown {
    const value = getPluginKvValue(db, PLUGIN_ID, "cursor");
    return value === undefined ? undefined : JSON.parse(value);
  }

  function setCursor(value: string) {
    setPluginKvValue(db, PLUGIN_ID, "cursor", JSON.stringify(value));
  }

  function pluginDatabasePath(): string {
    return join(dataDir, "plugins", PLUGIN_ID, "data.db");
  }

  async function holdFailedUpdate(
    version = "1.1.0",
  ): Promise<PluginStateSnapshotRow> {
    const commit = await offered(version);
    failReleases(version);
    await expect(
      withPluginUpdateProgress(
        (phase) => {
          if (phase === "rolling-back") {
            mkdirSync(pluginDatabasePath(), { recursive: true });
          }
        },
        () => service.applyUpdate(PLUGIN_ID, { expectedVersion: commit }),
      ),
    ).rejects.toThrow(`plugin "${PLUGIN_ID}" is ${HELD}`);
    vi.unstubAllGlobals();
    const snapshot = listPluginStateSnapshots(db, PLUGIN_ID).at(-1);
    expect(snapshot).toMatchObject({
      status: "restoring",
      failureDetail: expect.stringContaining("Path is a directory"),
    });
    if (snapshot === undefined) throw new Error("missing snapshot");
    return snapshot;
  }

  async function clearWriteFailure() {
    await rm(pluginDatabasePath(), { recursive: true, force: true });
  }

  function expectHeld(reason = "Path is a directory") {
    expect(listed(PLUGIN_ID)).toMatchObject({
      status: "error",
      statusDetail: expect.stringContaining(
        `held until bb finishes undoing its update: ${reason}`,
      ),
    });
    expect(service.getApi(PLUGIN_ID)).toBeUndefined();
  }

  function liveSecretPath(): string {
    return join(dataDir, "plugins", PLUGIN_ID, "secrets", "token");
  }

  async function writeLiveSecret(value: string) {
    await mkdir(join(dataDir, "plugins", PLUGIN_ID, "secrets"), {
      recursive: true,
    });
    await writeFile(liveSecretPath(), value);
  }

  function liveSecret(): string {
    return readFileSync(liveSecretPath(), "utf8");
  }

  function collectable(snapshotId: string): boolean {
    return listExpiredPluginStateSnapshots(db, Number.MAX_SAFE_INTEGER).some(
      ({ id }) => id === snapshotId,
    );
  }

  beforeEach(async () => {
    db = createMigratedConnection();
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-update-recovery-"));
    dataDir = join(workDir, "data");
    repo = join(workDir, "repo");
    await mkdir(repo, { recursive: true });
    await git(repo, ["init", "-q", "-b", "main"]);
    await git(repo, ["config", "user.email", "test@example.com"]);
    await git(repo, ["config", "user.name", "Test"]);
    await release("1.0.0");
    const bystander = join(workDir, BYSTANDER_ID);
    await mkdir(bystander, { recursive: true });
    await writeFile(
      join(bystander, "package.json"),
      JSON.stringify({
        name: `bb-plugin-${BYSTANDER_ID}`,
        version: "1.0.0",
        bb: {
          name: "Bystander",
          description: "A healthy plugin next to the one being restored.",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(
      join(bystander, "server.ts"),
      "export default function plugin() {}",
    );
    service = createService();
    await service.install(`git:${repo}@semver:^1.0.0`, { kind: "root" });
    await service.installPath(bystander);
    setCursor("v1-data");
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await service.stop();
    db.$client.close();
    await rm(workDir, { recursive: true, force: true });
  });

  it("restores the updated release when it fails to start after a failed rollback, and starts the other plugins", async () => {
    const previousCommit =
      getInstalledPluginRegistration(db, PLUGIN_ID)?.gitResolvedCommit ?? "";
    const nextCommit = await offered("1.1.0");
    await expect(
      service.applyUpdate(PLUGIN_ID, { expectedVersion: nextCommit }),
    ).resolves.toMatchObject({ ok: true, result: { outcome: "updated" } });
    failReleases("1.0.0", "1.1.0");

    await expect(
      service.rollbackUpdate(PLUGIN_ID, { expectedVersion: previousCommit }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        applied: false,
        outcome: "rolled-back",
        from: { version: nextCommit },
        to: { version: previousCommit },
        detail:
          "rolling back to 1.0.0 failed, so bb restored 1.1.0 and the data it had before the rollback: release 1.0.0 failed to start; the restored 1.1.0 failed to start as well: release 1.1.0 failed to start",
      },
    });
    expect(getInstalledPluginRegistration(db, PLUGIN_ID)).toMatchObject({
      version: "1.1.0",
      gitResolvedCommit: nextCommit,
    });
    expect(listed(PLUGIN_ID)).toMatchObject({
      status: "error",
      statusDetail: "release 1.1.0 failed to start",
    });
    expect(
      listPluginStateSnapshots(db, PLUGIN_ID).map(({ operation, status }) => ({
        operation,
        status,
      })),
    ).toEqual([
      { operation: "update", status: "ready" },
      { operation: "rollback", status: "restored" },
    ]);

    await restart();

    expect(listed(BYSTANDER_ID)).toMatchObject({ status: "running" });
    expect(listed(PLUGIN_ID)).toMatchObject({
      version: "1.1.0",
      status: "error",
    });
    expect(listed(PLUGIN_ID)?.updateState.rollback).toMatchObject({
      version: previousCommit,
    });
  }, 60_000);

  it("restores the previous release when it fails to start after a failed update", async () => {
    const previousCommit =
      getInstalledPluginRegistration(db, PLUGIN_ID)?.gitResolvedCommit ?? "";
    const nextCommit = await offered("1.1.0");
    failReleases("1.0.0", "1.1.0");

    await expect(
      service.applyUpdate(PLUGIN_ID, { expectedVersion: nextCommit }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        applied: false,
        outcome: "rolled-back",
        detail:
          "activation of 1.1.0 failed and was rolled back: release 1.1.0 failed to start; the restored 1.0.0 failed to start as well: release 1.0.0 failed to start; run apply update again to retry explicitly",
      },
    });
    expect(getInstalledPluginRegistration(db, PLUGIN_ID)).toMatchObject({
      version: "1.0.0",
      gitResolvedCommit: previousCommit,
      lastFailureVersion: nextCommit,
      lastFailureDetail: "release 1.1.0 failed to start",
    });
    expect(
      listPluginStateSnapshots(db, PLUGIN_ID).map(({ status }) => status),
    ).toEqual(["restored"]);

    await restart();

    expect(listed(BYSTANDER_ID)).toMatchObject({ status: "running" });
    expect(listed(PLUGIN_ID)).toMatchObject({
      version: "1.0.0",
      status: "error",
    });
  }, 60_000);

  it("names a restored release whose files are gone as a failed start", async () => {
    const previousRoot =
      getInstalledPluginRegistration(db, PLUGIN_ID)?.rootDir ?? "";
    const nextCommit = await offered("1.1.0");
    failReleases("1.1.0");

    await expect(
      withPluginUpdateProgress(
        (phase) => {
          if (phase === "activating") {
            rmSync(previousRoot, { recursive: true, force: true });
          }
        },
        () => service.applyUpdate(PLUGIN_ID, { expectedVersion: nextCommit }),
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        outcome: "rolled-back",
        detail: `activation of 1.1.0 failed and was rolled back: release 1.1.0 failed to start; the restored 1.0.0 failed to start as well: plugin directory not found: ${previousRoot} (reinstall); run apply update again to retry explicitly`,
      },
    });
    expect(listed(PLUGIN_ID)).toMatchObject({
      version: "1.0.0",
      status: "missing",
    });
  }, 60_000);

  it("keeps the update failure recorded before a rollback that fails", async () => {
    const firstCommit =
      getInstalledPluginRegistration(db, PLUGIN_ID)?.gitResolvedCommit ?? "";
    const secondCommit = await offered("1.1.0");
    await expect(
      service.applyUpdate(PLUGIN_ID, { expectedVersion: secondCommit }),
    ).resolves.toMatchObject({ ok: true, result: { outcome: "updated" } });
    const thirdCommit = await offered("1.2.0");
    failReleases("1.2.0");
    await expect(
      service.applyUpdate(PLUGIN_ID, { expectedVersion: thirdCommit }),
    ).resolves.toMatchObject({ ok: true, result: { outcome: "rolled-back" } });
    const failure = listed(PLUGIN_ID)?.updateState.lastFailure;
    expect(failure).toEqual({
      version: thirdCommit,
      label: "1.2.0",
      at: expect.any(Number),
      detail: "release 1.2.0 failed to start",
      restored: true,
    });
    failReleases("1.0.0", "1.2.0");

    await expect(
      service.rollbackUpdate(PLUGIN_ID, { expectedVersion: firstCommit }),
    ).resolves.toMatchObject({ ok: true, result: { outcome: "rolled-back" } });

    expect(getInstalledPluginRegistration(db, PLUGIN_ID)).toMatchObject({
      version: "1.1.0",
      gitResolvedCommit: secondCommit,
    });
    expect(listed(PLUGIN_ID)).toMatchObject({ status: "running" });
    expect(listed(PLUGIN_ID)?.updateState.lastFailure).toEqual(failure);
  }, 90_000);

  it("holds a plugin whose restore cannot write, starts the other plugins, and finishes the restore at a later start", async () => {
    const snapshot = await holdFailedUpdate();
    setCursor("written-by-1.1.0");
    expectHeld();
    expect(getInstalledPluginRegistration(db, PLUGIN_ID)).toMatchObject({
      version: "1.0.0",
    });

    await restart();

    expect(listed(BYSTANDER_ID)).toMatchObject({ status: "running" });
    expectHeld();
    expect(listPluginStateSnapshots(db, PLUGIN_ID)).toMatchObject([
      { id: snapshot.id, status: "restoring" },
    ]);

    await clearWriteFailure();
    await restart();

    expect(getInstalledPluginRegistration(db, PLUGIN_ID)).toMatchObject({
      version: "1.0.0",
    });
    expect(listed(PLUGIN_ID)).toMatchObject({
      version: "1.0.0",
      status: "running",
    });
    expect(cursor()).toBe("v1-data");
    expect(listPluginStateSnapshots(db, PLUGIN_ID)).toMatchObject([
      { id: snapshot.id, status: "restored" },
    ]);
  }, 60_000);

  it("stops the previous release when its restore fails after that release started", async () => {
    await restart({
      afterPluginRollbackStateRestored: async ({ snapshotId }) => {
        const saved = listPluginStateSnapshots(db, PLUGIN_ID).find(
          ({ id }) => id === snapshotId,
        );
        if (saved === undefined) throw new Error("missing snapshot");
        await rm(saved.statePath);
        await mkdir(saved.statePath);
      },
    });
    const commit = await offered("1.1.0");
    failReleases("1.1.0");
    const held = "held until bb finishes undoing its update: EISDIR";

    await expect(
      service.applyUpdate(PLUGIN_ID, { expectedVersion: commit }),
    ).rejects.toThrow(`plugin "${PLUGIN_ID}" is ${held}`);

    expect(listed(PLUGIN_ID)).toMatchObject({
      status: "error",
      statusDetail: expect.stringContaining(held),
    });
    expect(
      service.getApi(PLUGIN_ID) === undefined,
      "the held plugin is still loaded",
    ).toBe(true);
    expect(listed(BYSTANDER_ID)).toMatchObject({ status: "running" });
    expect(listPluginStateSnapshots(db, PLUGIN_ID)).toMatchObject([
      { status: "restoring", failureDetail: expect.stringContaining("EISDIR") },
    ]);
  }, 60_000);

  it.skipIf(withoutFilePermissions)(
    "keeps a plugin held with its data untouched while its saved secrets cannot be read, and finishes the restore once they can",
    async () => {
      await writeLiveSecret("v1-secret");
      const commit = await offered("1.1.0");
      failReleases("1.1.0");
      let snapshot: PluginStateSnapshotRow | undefined;

      await expect(
        withPluginUpdateProgress(
          (phase) => {
            if (phase === "activating") {
              writeFileSync(liveSecretPath(), "written-by-1.1.0");
            }
            if (phase !== "rolling-back") return;
            snapshot = listPluginStateSnapshots(db, PLUGIN_ID).at(-1);
            chmodSync(join(snapshot?.secretsPath ?? "", "token"), 0o000);
          },
          () => service.applyUpdate(PLUGIN_ID, { expectedVersion: commit }),
        ),
      ).rejects.toThrow(
        `plugin "${PLUGIN_ID}" is held until bb finishes undoing its update: its copy of the plugin secrets could not be read: EACCES`,
      );
      vi.unstubAllGlobals();
      if (snapshot === undefined) throw new Error("missing snapshot");
      const savedSecret = join(snapshot.secretsPath ?? "", "token");
      try {
        expect(listPluginStateSnapshots(db, PLUGIN_ID)).toMatchObject([
          { id: snapshot.id, status: "rollback-pending" },
        ]);
        expect(getInstalledPluginRegistration(db, PLUGIN_ID)).toMatchObject({
          version: "1.1.0",
        });
        expect(liveSecret()).toBe("written-by-1.1.0");
        expectHeld("its copy of the plugin secrets could not be read: EACCES");
        expect(collectable(snapshot.id)).toBe(false);

        await restart();

        expect(listPluginStateSnapshots(db, PLUGIN_ID)).toMatchObject([
          { id: snapshot.id, status: "rollback-pending" },
        ]);
        expectHeld("its copy of the plugin secrets could not be read: EACCES");
        expect(liveSecret()).toBe("written-by-1.1.0");
      } finally {
        chmodSync(savedSecret, 0o600);
      }

      await expect(service.reload(PLUGIN_ID)).resolves.toMatchObject({
        ok: true,
      });

      expect(listed(PLUGIN_ID)).toMatchObject({
        version: "1.0.0",
        status: "running",
      });
      expect(liveSecret()).toBe("v1-secret");
      expect(cursor()).toBe("v1-data");
      expect(listPluginStateSnapshots(db, PLUGIN_ID)).toMatchObject([
        { id: snapshot.id, status: "restored" },
      ]);
    },
    60_000,
  );

  it.skipIf(withoutFilePermissions)(
    "keeps a plugin held when its saved host state cannot be read after a restart, and finishes the restore once it can",
    async () => {
      const snapshot = await holdFailedUpdate();
      chmodSync(snapshot.statePath, 0o000);
      try {
        await clearWriteFailure();

        await restart();

        expect(listPluginStateSnapshots(db, PLUGIN_ID)).toMatchObject([
          {
            id: snapshot.id,
            status: "restoring",
            failureDetail: expect.stringContaining(
              "its saved host state could not be read: EACCES",
            ),
          },
        ]);
        expectHeld("its saved host state could not be read: EACCES");
        expect(collectable(snapshot.id)).toBe(false);
      } finally {
        chmodSync(snapshot.statePath, 0o600);
      }

      await expect(service.reload(PLUGIN_ID)).resolves.toMatchObject({
        ok: true,
      });

      expect(listed(PLUGIN_ID)).toMatchObject({
        version: "1.0.0",
        status: "running",
      });
      expect(cursor()).toBe("v1-data");
      expect(listPluginStateSnapshots(db, PLUGIN_ID)).toMatchObject([
        { id: snapshot.id, status: "restored" },
      ]);
    },
    60_000,
  );

  it("reports through reload that bb gave up a held update once its saved host state is gone, and keeps the release it could not undo", async () => {
    const commit = await offered("1.1.0");
    failReleases("1.1.0");
    let snapshot: PluginStateSnapshotRow | undefined;

    await expect(
      withPluginUpdateProgress(
        (phase) => {
          if (phase !== "rolling-back") return;
          snapshot = listPluginStateSnapshots(db, PLUGIN_ID).at(-1);
          setCursor("written-by-1.1.0");
          rmSync(snapshot?.statePath ?? "");
          mkdirSync(snapshot?.statePath ?? "");
        },
        () => service.applyUpdate(PLUGIN_ID, { expectedVersion: commit }),
      ),
    ).rejects.toThrow(
      `plugin "${PLUGIN_ID}" is held until bb finishes undoing its update: its saved host state could not be read: EISDIR`,
    );
    vi.unstubAllGlobals();
    if (snapshot === undefined) throw new Error("missing snapshot");
    rmSync(snapshot.statePath, { recursive: true });
    const gaveUp = `bb could not undo the update to ${commit.slice(0, 12)}: its saved state is unusable (its saved host state is missing); the plugin keeps its current release and data`;

    await expect(service.reload(PLUGIN_ID)).resolves.toMatchObject({
      ok: true,
      warnings: [`plugin "${PLUGIN_ID}": ${gaveUp}`],
    });

    expect(listed(PLUGIN_ID)).toMatchObject({
      version: "1.1.0",
      status: "running",
      updateState: {
        lastFailure: {
          version: commit,
          detail: `release 1.1.0 failed to start; ${gaveUp}`,
          restored: false,
        },
      },
    });
    expect(cursor()).toBe("written-by-1.1.0");
    expect(listPluginStateSnapshots(db, PLUGIN_ID)).toMatchObject([
      { id: snapshot.id, status: "failed" },
    ]);
  }, 60_000);

  it("keeps a plugin held across a restart when its restore failed after replacing the data, and finishes on reload once the saved state is back", async () => {
    await writeLiveSecret("v1-secret");
    let savedState = "";
    await restart({
      afterPluginRollbackStateRestored: async ({ snapshotId }) => {
        const saved = listPluginStateSnapshots(db, PLUGIN_ID).find(
          ({ id }) => id === snapshotId,
        );
        if (saved === undefined) throw new Error("missing snapshot");
        savedState = readFileSync(saved.statePath, "utf8");
        await rm(saved.statePath);
        await mkdir(saved.statePath);
      },
    });
    const commit = await offered("1.1.0");
    failReleases("1.1.0");
    await expect(
      withPluginUpdateProgress(
        (phase) => {
          if (phase === "activating") {
            writeFileSync(liveSecretPath(), "written-by-1.1.0");
          }
        },
        () => service.applyUpdate(PLUGIN_ID, { expectedVersion: commit }),
      ),
    ).rejects.toThrow(
      `plugin "${PLUGIN_ID}" is held until bb finishes undoing its update: EISDIR`,
    );
    vi.unstubAllGlobals();
    const [snapshot] = listPluginStateSnapshots(db, PLUGIN_ID);
    if (snapshot === undefined) throw new Error("missing snapshot");
    expect(liveSecret()).toBe("v1-secret");

    await restart();

    expect(listPluginStateSnapshots(db, PLUGIN_ID)).toMatchObject([
      {
        id: snapshot.id,
        status: "restoring",
        failureDetail: expect.stringContaining(
          "its saved host state could not be read: EISDIR",
        ),
      },
    ]);
    expectHeld("its saved host state could not be read: EISDIR");
    expect(getInstalledPluginRegistration(db, PLUGIN_ID)).toMatchObject({
      version: "1.0.0",
    });
    expect(collectable(snapshot.id)).toBe(false);

    rmSync(snapshot.statePath, { recursive: true });
    writeFileSync(snapshot.statePath, savedState);
    await expect(service.reload(PLUGIN_ID)).resolves.toMatchObject({
      ok: true,
    });

    expect(listed(PLUGIN_ID)).toMatchObject({
      version: "1.0.0",
      status: "running",
    });
    expect(cursor()).toBe("v1-data");
    expect(liveSecret()).toBe("v1-secret");
    expect(listPluginStateSnapshots(db, PLUGIN_ID)).toMatchObject([
      { id: snapshot.id, status: "restored" },
    ]);
  }, 60_000);

  it("keeps a held plugin stopped when it is reloaded, enabled, or safe mode turns off", async () => {
    await holdFailedUpdate();

    await expect(service.reload(PLUGIN_ID)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining(
        `plugin "${PLUGIN_ID}" reload failed: ${HELD}`,
      ),
    });
    expectHeld();

    await expect(service.setEnabled(PLUGIN_ID, false)).resolves.toMatchObject({
      status: "disabled",
    });
    await expect(service.setEnabled(PLUGIN_ID, true)).resolves.toMatchObject({
      status: "error",
      statusDetail: expect.stringContaining(HELD),
    });
    expect(service.getApi(PLUGIN_ID)).toBeUndefined();

    await service.setSafeMode(true);
    await expect(service.setSafeMode(false)).resolves.toMatchObject({
      enabled: false,
      problems: [
        expect.stringContaining(`plugin "${PLUGIN_ID}" did not start: ${HELD}`),
      ],
    });
    expectHeld();
    expect(listed(BYSTANDER_ID)).toMatchObject({ status: "running" });
    expect(getInstalledPluginRegistration(db, PLUGIN_ID)).toMatchObject({
      version: "1.0.0",
    });
    expect(
      listPluginStateSnapshots(db, PLUGIN_ID).map(({ status }) => status),
    ).toEqual(["restoring"]);
  }, 60_000);

  it("retries a held restore on reload and starts the plugin once the write succeeds", async () => {
    const snapshot = await holdFailedUpdate();
    setCursor("written-by-1.1.0");
    await clearWriteFailure();

    await expect(service.reload(PLUGIN_ID)).resolves.toMatchObject({
      ok: true,
    });

    expect(listed(PLUGIN_ID)).toMatchObject({
      version: "1.0.0",
      status: "running",
    });
    expect(service.getApi(PLUGIN_ID)).toBeDefined();
    expect(cursor()).toBe("v1-data");
    expect(listPluginStateSnapshots(db, PLUGIN_ID)).toMatchObject([
      { id: snapshot.id, status: "restored" },
    ]);
  }, 60_000);

  it("keeps a plugin disabled while it was held when its restore finishes", async () => {
    await holdFailedUpdate();
    await service.setEnabled(PLUGIN_ID, false);
    await clearWriteFailure();

    await expect(service.reload(PLUGIN_ID)).resolves.toMatchObject({
      ok: true,
    });

    expect(getInstalledPluginRegistration(db, PLUGIN_ID)).toMatchObject({
      version: "1.0.0",
      enabled: false,
    });
    expect(listed(PLUGIN_ID)).toMatchObject({ status: "disabled" });
    expect(service.getApi(PLUGIN_ID)).toBeUndefined();
  }, 60_000);

  it("refuses to update, change the range of, or roll back a held plugin", async () => {
    await holdFailedUpdate();
    await clearWriteFailure();
    const refused = (action: string) =>
      `${action} refused: plugin "${PLUGIN_ID}" is ${HELD}`;
    const nextCommit = await offered("1.2.0");

    await expect(
      service.applyUpdate(PLUGIN_ID, { expectedVersion: nextCommit }),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining(refused("update")),
    });
    await expect(
      service.setTrackingRange(PLUGIN_ID, { range: "^1.1.0" }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "refused",
      error: expect.stringContaining(refused("range change")),
    });
    await expect(service.rollbackUpdate(PLUGIN_ID)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining(refused("rollback")),
    });
    await expect(service.getRollbackPoint(PLUGIN_ID)).resolves.toMatchObject({
      outcome: "unavailable",
      detail: expect.stringContaining(refused("rollback")),
    });

    expect(getInstalledPluginRegistration(db, PLUGIN_ID)).toMatchObject({
      version: "1.0.0",
      sourceGitRange: "^1.0.0",
    });
    expect(
      listPluginStateSnapshots(db, PLUGIN_ID).map(({ status }) => status),
    ).toEqual(["restoring"]);
    expectHeld();
  }, 60_000);

  it("answers a rollback point lookup made during a rollback once that rollback finishes", async () => {
    const previousCommit =
      getInstalledPluginRegistration(db, PLUGIN_ID)?.gitResolvedCommit ?? "";
    const nextCommit = await offered("1.1.0");
    await expect(
      service.applyUpdate(PLUGIN_ID, { expectedVersion: nextCommit }),
    ).resolves.toMatchObject({ ok: true, result: { outcome: "updated" } });
    let windowReached!: () => void;
    const reached = new Promise<void>((resolve) => {
      windowReached = resolve;
    });
    let elapse = () => {};
    await restart({
      stabilizationWindowMs: 1,
      scheduleStabilizationWindow: (_durationMs, onElapsed) => {
        elapse = onElapsed;
        windowReached();
        return () => {};
      },
    });

    const rollback = service.rollbackUpdate(PLUGIN_ID, {
      expectedVersion: previousCommit,
    });
    await reached;
    const lookup = service.getRollbackPoint(PLUGIN_ID);
    elapse();

    await expect(rollback).resolves.toMatchObject({
      ok: true,
      result: { outcome: "reverted" },
    });
    await expect(lookup).resolves.toEqual({
      outcome: "unavailable",
      detail: expect.not.stringContaining("held until"),
    });
  }, 60_000);

  it("offers no update or rollback for a held plugin until its restore finishes", async () => {
    const firstCommit =
      getInstalledPluginRegistration(db, PLUGIN_ID)?.gitResolvedCommit ?? "";
    const secondCommit = await offered("1.1.0");
    await expect(
      service.applyUpdate(PLUGIN_ID, { expectedVersion: secondCommit }),
    ).resolves.toMatchObject({ ok: true, result: { outcome: "updated" } });
    const snapshot = await holdFailedUpdate("1.2.0");
    expect(getInstalledPluginRegistration(db, PLUGIN_ID)).toMatchObject({
      version: "1.1.0",
      availableCompatibleVersion: snapshot.rollbackCandidateVersion,
    });

    const held = listed(PLUGIN_ID)?.updateState;
    expect(held).not.toHaveProperty("availableVersion");
    expect(held).not.toHaveProperty("rollback");

    await clearWriteFailure();
    await expect(service.reload(PLUGIN_ID)).resolves.toMatchObject({
      ok: true,
    });
    expect(listed(PLUGIN_ID)?.updateState).toMatchObject({
      availableVersion: snapshot.rollbackCandidateVersion,
      rollback: { version: firstCommit },
    });
  }, 90_000);

  it.each([
    {
      saved: "a missing host state file",
      damage: (snapshot: PluginStateSnapshotRow) => rmSync(snapshot.statePath),
      reason: "its saved host state is missing",
    },
    {
      saved: "a corrupt registration",
      damage: (snapshot: PluginStateSnapshotRow) =>
        writeFileSync(snapshot.registrationPath ?? "", "{ not json"),
      reason: "its saved registration is not valid JSON",
    },
    {
      saved: "no registration, from before restart-safe rollback",
      damage: (snapshot: PluginStateSnapshotRow) => {
        db.$client
          .prepare(
            "UPDATE plugin_state_snapshots SET registration_path = NULL WHERE id = ?",
          )
          .run(snapshot.id);
      },
      reason: "it predates restart-safe rollback metadata",
    },
    {
      saved: "a registration that breaks its own rules",
      damage: (snapshot: PluginStateSnapshotRow) => {
        const path = snapshot.registrationPath ?? "";
        writeFileSync(
          path,
          JSON.stringify({
            ...JSON.parse(readFileSync(path, "utf8")),
            provenance: "catalog",
            catalogEntryId: null,
          }),
        );
      },
      reason: `its saved registration is inconsistent (plugin "${PLUGIN_ID}" has corrupt catalog provenance)`,
    },
    {
      saved: "a release bb no longer keeps",
      damage: (snapshot: PluginStateSnapshotRow) => {
        db.$client
          .prepare("DELETE FROM plugin_artifacts WHERE id = ?")
          .run(snapshot.fromArtifactId);
      },
      reason: "the release it restores is no longer kept",
    },
  ])(
    "keeps the current release and data of a plugin whose restore has $saved",
    async ({ damage, reason }) => {
      const commit = await offered("1.1.0");
      failReleases("1.1.0");
      let snapshotId = "";

      await expect(
        withPluginUpdateProgress(
          (phase) => {
            if (phase !== "rolling-back") return;
            const snapshot = listPluginStateSnapshots(db, PLUGIN_ID).at(-1);
            if (snapshot === undefined) throw new Error("missing snapshot");
            snapshotId = snapshot.id;
            setCursor("written-by-1.1.0");
            damage(snapshot);
          },
          () => service.applyUpdate(PLUGIN_ID, { expectedVersion: commit }),
        ),
      ).rejects.toThrow(
        `activation of 1.1.0 failed: release 1.1.0 failed to start; bb could not undo the update to ${commit.slice(0, 12)}: its saved state is unusable (${reason}`,
      );

      expect(listPluginStateSnapshots(db, PLUGIN_ID)).toMatchObject([
        {
          id: snapshotId,
          status: "failed",
          failureDetail: expect.stringContaining(reason),
        },
      ]);
      expect(getInstalledPluginRegistration(db, PLUGIN_ID)).toMatchObject({
        version: "1.1.0",
        gitResolvedCommit: commit,
      });
      expect(cursor()).toBe("written-by-1.1.0");
      expect(listed(PLUGIN_ID)?.updateState.lastFailure).toEqual({
        version: commit,
        label: commit.slice(0, 7),
        at: expect.any(Number),
        detail: expect.stringContaining(
          `release 1.1.0 failed to start; bb could not undo the update to ${commit.slice(0, 12)}: its saved state is unusable (${reason}`,
        ),
        restored: false,
      });
      expect(pluginRestoreHold(db, PLUGIN_ID)).toBeNull();
      vi.unstubAllGlobals();

      await restart();

      expect(listed(PLUGIN_ID)).toMatchObject({
        version: "1.1.0",
        status: "running",
      });
      expect(cursor()).toBe("written-by-1.1.0");
      expect(listed(BYSTANDER_ID)).toMatchObject({ status: "running" });
    },
    60_000,
  );

  async function twoUnfinishedRestores() {
    const firstCommit = await offered("1.1.0");
    await expect(
      service.applyUpdate(PLUGIN_ID, { expectedVersion: firstCommit }),
    ).resolves.toMatchObject({ ok: true, result: { outcome: "updated" } });
    setCursor("v1.1-data");
    const [older] = listPluginStateSnapshots(db, PLUGIN_ID);
    if (older === undefined) throw new Error("missing snapshot");
    const newer = await holdFailedUpdate("1.2.0");
    expect(
      setPluginStateSnapshotRollbackPending(db, older.id, {
        candidateVersion: firstCommit,
        sourceFingerprint: "older-unfinished-restore",
        bbVersion: "1.0.0",
        sdkVersion: "0.0.0",
        detail: "release 1.1.0 failed to start",
        updatedAt: Date.now(),
      }),
    ).toBe(true);
    await clearWriteFailure();
    return { older, newer };
  }

  it("restores the older of two unfinished restores and discards the newer one (wiring only: no current path leaves two)", async () => {
    const { older, newer } = await twoUnfinishedRestores();
    await writeFile(newer.registrationPath ?? "", "{ not json");

    await restart();

    expect(
      listPluginStateSnapshots(db, PLUGIN_ID).map(({ id, status }) => ({
        id,
        status,
      })),
    ).toEqual([
      { id: older.id, status: "restored" },
      { id: newer.id, status: "discarded" },
    ]);
    await expect(stat(newer.snapshotPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(listed(PLUGIN_ID)).toMatchObject({
      version: "1.0.0",
      status: "running",
    });
    expect(cursor()).toBe("v1-data");
  }, 90_000);

  it("restores the newer of two unfinished restores when the older one is unusable (wiring only: no current path leaves two)", async () => {
    const { older, newer } = await twoUnfinishedRestores();
    await rm(older.statePath);

    await restart();

    expect(
      listPluginStateSnapshots(db, PLUGIN_ID).map(({ id, status }) => ({
        id,
        status,
      })),
    ).toEqual([
      { id: older.id, status: "failed" },
      { id: newer.id, status: "restored" },
    ]);
    expect(listed(PLUGIN_ID)).toMatchObject({
      version: "1.1.0",
      status: "running",
    });
    expect(cursor()).toBe("v1.1-data");
  }, 90_000);

  it("discards a rollback's safety snapshot and deletes its files when the rollback fails before it writes the registration", async () => {
    const previousCommit =
      getInstalledPluginRegistration(db, PLUGIN_ID)?.gitResolvedCommit ?? "";
    const nextCommit = await offered("1.1.0");
    await expect(
      service.applyUpdate(PLUGIN_ID, { expectedVersion: nextCommit }),
    ).resolves.toMatchObject({ ok: true, result: { outcome: "updated" } });

    await expect(
      withPluginUpdateProgress(
        (phase) => {
          if (phase !== "activating") return;
          db.$client
            .prepare("UPDATE plugins SET enabled = 0 WHERE id = ?")
            .run(PLUGIN_ID);
        },
        () =>
          service.rollbackUpdate(PLUGIN_ID, {
            expectedVersion: previousCommit,
          }),
      ),
    ).rejects.toThrow(
      `plugin "${PLUGIN_ID}" registration changed during activation`,
    );

    const snapshots = listPluginStateSnapshots(db, PLUGIN_ID);
    expect(
      snapshots.map(({ operation, status }) => ({ operation, status })),
    ).toEqual([
      { operation: "update", status: "ready" },
      { operation: "rollback", status: "discarded" },
    ]);
    const [kept, safety] = snapshots.map(({ snapshotPath }) => snapshotPath);
    await stat(kept ?? "");
    await expect(stat(safety ?? "")).rejects.toMatchObject({ code: "ENOENT" });
    expect(getInstalledPluginRegistration(db, PLUGIN_ID)).toMatchObject({
      version: "1.1.0",
      gitResolvedCommit: nextCommit,
    });
  }, 60_000);

  it("keeps a rollback held when it fails while writing the kept data, even if its safety snapshot is then unusable", async () => {
    const previousCommit =
      getInstalledPluginRegistration(db, PLUGIN_ID)?.gitResolvedCommit ?? "";
    const nextCommit = await offered("1.1.0");
    await expect(
      service.applyUpdate(PLUGIN_ID, { expectedVersion: nextCommit }),
    ).resolves.toMatchObject({ ok: true, result: { outcome: "updated" } });

    await expect(
      withPluginUpdateProgress(
        (phase) => {
          if (phase === "activating") {
            mkdirSync(pluginDatabasePath(), { recursive: true });
          }
          if (phase !== "rolling-back") return;
          const safety = listPluginStateSnapshots(db, PLUGIN_ID).at(-1);
          rmSync(safety?.statePath ?? "");
        },
        () =>
          service.rollbackUpdate(PLUGIN_ID, {
            expectedVersion: previousCommit,
          }),
      ),
    ).rejects.toThrow(
      `plugin "${PLUGIN_ID}" is held until bb finishes undoing its rollback: its saved host state is missing`,
    );

    expect(
      listPluginStateSnapshots(db, PLUGIN_ID).map(
        ({ operation, status, failureDetail }) => ({
          operation,
          status,
          failureDetail,
        }),
      ),
    ).toEqual([
      { operation: "update", status: "ready", failureDetail: null },
      {
        operation: "rollback",
        status: "restoring",
        failureDetail: "its saved host state is missing",
      },
    ]);
    expect(listed(PLUGIN_ID)).toMatchObject({
      status: "error",
      statusDetail: expect.stringContaining(
        "held until bb finishes undoing its rollback: its saved host state is missing",
      ),
    });
    expect(service.getApi(PLUGIN_ID)).toBeUndefined();
  }, 60_000);

  it("gives up undoing a rollback that wrote all of the kept data when its safety snapshot is unusable, and records why", async () => {
    const previousCommit =
      getInstalledPluginRegistration(db, PLUGIN_ID)?.gitResolvedCommit ?? "";
    const nextCommit = await offered("1.1.0");
    await expect(
      service.applyUpdate(PLUGIN_ID, { expectedVersion: nextCommit }),
    ).resolves.toMatchObject({ ok: true, result: { outcome: "updated" } });
    setCursor("v1.1-data");
    failReleases("1.0.0");
    const gaveUp = `release 1.0.0 failed to start; bb could not undo the rollback to ${previousCommit.slice(0, 12)}: its saved state is unusable (its saved host state is missing); the plugin keeps its current release and data`;

    await expect(
      withPluginUpdateProgress(
        (phase) => {
          if (phase !== "rolling-back") return;
          const safety = listPluginStateSnapshots(db, PLUGIN_ID).at(-1);
          rmSync(safety?.statePath ?? "");
        },
        () =>
          service.rollbackUpdate(PLUGIN_ID, {
            expectedVersion: previousCommit,
          }),
      ),
    ).rejects.toThrow(`rolling back to 1.0.0 failed: ${gaveUp}`);

    expect(
      listPluginStateSnapshots(db, PLUGIN_ID).map(({ operation, status }) => ({
        operation,
        status,
      })),
    ).toEqual([
      { operation: "update", status: "ready" },
      { operation: "rollback", status: "failed" },
    ]);
    expect(getInstalledPluginRegistration(db, PLUGIN_ID)).toMatchObject({
      version: "1.0.0",
      gitResolvedCommit: previousCommit,
    });
    expect(cursor()).toBe("v1-data");
    expect(listed(PLUGIN_ID)?.updateState.lastFailure).toEqual({
      version: previousCommit,
      label: previousCommit.slice(0, 7),
      at: expect.any(Number),
      detail: gaveUp,
      restored: false,
    });
    expect(pluginRestoreHold(db, PLUGIN_ID)).toBeNull();
  }, 60_000);

  it("keeps a plugin removed while its restore was unfinished removed after a restart", async () => {
    const snapshot = await holdFailedUpdate();

    await expect(service.remove(PLUGIN_ID)).resolves.toBe(true);
    expect(listPluginStateSnapshots(db, PLUGIN_ID)).toEqual([]);
    await expect(stat(snapshot.snapshotPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await restart();

    expect(getInstalledPluginRegistration(db, PLUGIN_ID)).toBeUndefined();
    expect(listed(PLUGIN_ID)).toBeUndefined();
    expect(listed(BYSTANDER_ID)).toMatchObject({ status: "running" });
  }, 60_000);

  it("deletes instead of restoring an unfinished restore whose plugin is gone", async () => {
    const snapshot = await holdFailedUpdate();
    await service.stop();
    deleteInstalledPlugin(db, PLUGIN_ID);

    service = createService();
    await service.start();

    expect(getInstalledPluginRegistration(db, PLUGIN_ID)).toBeUndefined();
    expect(listed(PLUGIN_ID)).toBeUndefined();
    expect(listPluginStateSnapshots(db, PLUGIN_ID)).toEqual([]);
    await expect(stat(snapshot.snapshotPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(listed(BYSTANDER_ID)).toMatchObject({ status: "running" });
  }, 60_000);
});
