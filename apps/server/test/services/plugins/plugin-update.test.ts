import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createConnection,
  getPluginKvValue,
  getInstalledPluginRegistration,
  getPluginSettingsValues,
  listPluginSchedules,
  listPluginArtifacts,
  listPluginStateSnapshots,
  migrate,
  setPluginSettingsValues,
  upsertPluginSchedule,
  upsertInstalledPlugin,
  type DbConnection,
} from "@bb/db";
import type { Logger } from "@bb/logger";
import { registerPluginRoutes } from "../../../src/routes/plugins.js";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import { testLogger } from "../../helpers/test-app.js";

const logger = testLogger as unknown as Logger;
const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  return (await run("git", args, { cwd })).stdout.trim();
}

async function commitPlugin(
  repo: string,
  version: string,
  engines?: { bb?: string; bbPluginSdk?: string },
  serverSource?: string,
): Promise<string> {
  await mkdir(repo, { recursive: true });
  await writeFile(
    join(repo, "package.json"),
    JSON.stringify({
      name: "bb-plugin-updater",
      version,
      ...(engines ? { engines } : {}),
      bb: { server: "./server.ts" },
    }),
  );
  await writeFile(
    join(repo, "server.ts"),
    serverSource ??
      `export default function plugin(bb: any) { bb.log.info(${JSON.stringify(version)}); }`,
  );
  await git(repo, ["add", "-A"]);
  await git(repo, ["commit", "-qm", version]);
  return git(repo, ["rev-parse", "HEAD"]);
}

describe("plugin update service and routes", () => {
  let db: DbConnection;
  let workDir: string;
  let repo: string;
  let service: PluginService;
  let app: Hono;
  let afterArtifactPromoted:
    | ((args: {
        pluginId: string;
        artifactId: string;
        path: string;
      }) => Promise<void>)
    | undefined;

  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-update-"));
    repo = join(workDir, "repo");
    await mkdir(repo, { recursive: true });
    await git(repo, ["init", "-q", "-b", "main"]);
    await git(repo, ["config", "user.email", "test@example.com"]);
    await git(repo, ["config", "user.name", "Test"]);
    await commitPlugin(repo, "1.0.0");
    afterArtifactPromoted = undefined;
    service = createPluginService({
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger,
      dataDir: join(workDir, "data"),
      appVersion: "1.0.0",
      isEnabled: () => true,
      isConnectEnabled: () => false,
      loadTimeoutMs: 2000,
      stabilizationWindowMs: 0,
      afterArtifactPromoted: async (args) => afterArtifactPromoted?.(args),
    });
    await service.install(`git:${repo}@main`);
    app = new Hono();
    registerPluginRoutes(app, { config: { serverPort: 3334 } }, service);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await service.stop();
    db.$client.close();
    await rm(workDir, { recursive: true, force: true });
  });

  it("keeps a multi-plugin check usable when one npm registry is offline", async () => {
    const updateState = {
      lastCheckAt: null,
      availableCompatibleVersion: null,
      newestIncompatibleVersion: null,
      statusDetail: null,
      ignoredVersion: null,
    };
    for (const packageName of [
      "bb-plugin-offline-registry",
      "bb-plugin-healthy-registry",
    ]) {
      const id = packageName.replace("bb-plugin-", "");
      upsertInstalledPlugin(db, {
        id,
        source: `npm:${packageName}`,
        provenance: { kind: "direct" },
        sourceIntent: {
          kind: "npm",
          packageName,
          registry: `https://${id}.test`,
          requestedSpec: "",
          specKind: "default",
        },
        exactResolution: {
          kind: "npm",
          version: "1.0.0",
          integrity: "sha512-current",
        },
        updatePolicy: "compatible",
        updateState,
        activeArtifactId: null,
        rootDir: join(workDir, id),
        version: "1.0.0",
        enabled: false,
      });
    }
    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request): Promise<Response> => {
        const url = String(input);
        if (url.startsWith("https://offline-registry.test/")) {
          throw new TypeError("network unreachable");
        }
        if (url.startsWith("https://healthy-registry.test/")) {
          return new Response(
            JSON.stringify({
              versions: {
                "1.0.0": {
                  version: "1.0.0",
                  dist: { integrity: "sha512-current" },
                },
                "1.1.0": {
                  version: "1.1.0",
                  dist: { integrity: "sha512-next" },
                },
              },
              "dist-tags": { latest: "1.1.0" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        throw new Error(`unexpected registry request: ${url}`);
      },
    );

    const results = await service.checkForUpdates();
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "offline-registry",
          outcome: "unavailable",
          detail: expect.stringContaining("network unreachable"),
        }),
        expect.objectContaining({
          id: "healthy-registry",
          outcome: "update-available",
          candidate: expect.objectContaining({ version: "1.1.0" }),
        }),
      ]),
    );
    expect(service.listUpdateResults()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "offline-registry",
          outcome: "unavailable",
        }),
        expect.objectContaining({
          id: "healthy-registry",
          outcome: "update-available",
        }),
      ]),
    );
  });

  it("checks, reads persisted state, and dry-runs through the exact HTTP contract", async () => {
    // Simulate a Phase 1 normalized row migrated before ref classification
    // existed. The first network resolution classifies and persists it.
    db.$client
      .prepare("UPDATE plugins SET source_git_ref_kind = NULL WHERE id = ?")
      .run("updater");
    const nextCommit = await commitPlugin(repo, "1.1.0");
    const checkedResponse = await app.request("/plugins/updates/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(checkedResponse.status).toBe(200);
    const checked: unknown = await checkedResponse.json();
    expect(checked).toMatchObject({
      results: [
        {
          id: "updater",
          outcome: "update-available",
          installed: { version: expect.stringMatching(/^[0-9a-f]{40}$/) },
          candidate: { version: nextCommit },
        },
      ],
    });
    expect(getInstalledPluginRegistration(db, "updater")).toMatchObject({
      sourceGitRefKind: "branch",
    });

    const persistedResponse = await app.request("/plugins/updates");
    expect(persistedResponse.status).toBe(200);
    expect(await persistedResponse.json()).toEqual(checked);

    const dryRunResponse = await app.request("/plugins/updater/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: true }),
    });
    expect(dryRunResponse.status).toBe(200);
    expect(await dryRunResponse.json()).toMatchObject({
      applied: false,
      dryRun: true,
      to: { version: nextCommit },
      outcome: "update-available",
    });
  });

  it("returns an actionable 422 and keeps the installed commit for an incompatible candidate", async () => {
    const installedCommit = await git(repo, ["rev-parse", "HEAD"]);
    const incompatibleCommit = await commitPlugin(repo, "2.0.0", {
      bb: ">=99.0.0",
    });
    const checkResponse = await app.request("/plugins/updates/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "updater" }),
    });
    expect(checkResponse.status).toBe(200);
    expect(await checkResponse.json()).toMatchObject({
      results: [
        {
          outcome: "incompatible",
          blocked: {
            version: incompatibleCommit,
            reasons: [expect.stringContaining("requires bb >=99.0.0")],
          },
        },
      ],
    });

    const updateResponse = await app.request("/plugins/updater/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(updateResponse.status).toBe(422);
    expect(await updateResponse.json()).toMatchObject({
      error: expect.stringContaining("is incompatible"),
    });
    expect(
      service.list().find((entry) => entry.id === "updater"),
    ).toMatchObject({ version: "1.0.0", status: "running" });
    expect(
      service.listUpdateResults().find((entry) => entry.id === "updater"),
    ).toMatchObject({
      installed: { version: installedCommit },
      blocked: { version: incompatibleCommit },
    });
  });

  it("serializes two updates for one plugin so only one applies", async () => {
    const before = getInstalledPluginRegistration(db, "updater");
    if (before === undefined) throw new Error("missing installed updater");
    const oldRoot = before.rootDir;
    const oldPackage = await readFile(join(oldRoot, "package.json"), "utf8");
    const nextCommit = await commitPlugin(repo, "1.1.0");
    const results = await Promise.all([
      service.applyUpdate("updater", { dryRun: false, latest: false }),
      service.applyUpdate("updater", { dryRun: false, latest: false }),
    ]);

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ok: true,
          result: expect.objectContaining({ applied: true }),
        }),
        expect.objectContaining({
          ok: true,
          result: expect.objectContaining({
            applied: false,
            outcome: "current",
          }),
        }),
      ]),
    );
    expect(service.listUpdateResults()).toMatchObject([
      {
        outcome: "current",
        installed: { version: nextCommit },
      },
    ]);
    expect(service.list()).toMatchObject([
      { id: "updater", version: "1.1.0", status: "running" },
    ]);
    const updated = getInstalledPluginRegistration(db, "updater");
    expect(updated).toMatchObject({
      rootDir: expect.stringContaining(nextCommit),
      activeArtifactId: expect.any(String),
    });
    expect(updated?.rootDir).not.toBe(oldRoot);
    await stat(oldRoot);
    expect(await readFile(join(oldRoot, "package.json"), "utf8")).toBe(
      oldPackage,
    );
    expect(listPluginArtifacts(db, "updater")).toHaveLength(2);
  });

  it("rolls back full bb-owned state, quarantines the failed candidate, and allows explicit retry", async () => {
    const infoLog = vi.spyOn(testLogger, "info");
    const warningLog = vi.spyOn(testLogger, "warn");
    const pluginDir = join(workDir, "data", "plugins", "updater");
    const databasePath = join(pluginDir, "data.db");
    const secretPath = join(pluginDir, "secrets", "token");
    const failureMarker = join(workDir, "fail-activation");
    const api = service.getApi("updater");
    if (api === undefined) throw new Error("updater did not load");
    const pluginDb = api.storage.sqlite();
    pluginDb.exec("CREATE TABLE state (value TEXT NOT NULL)");
    pluginDb.prepare("INSERT INTO state (value) VALUES (?)").run("old-db");
    await api.storage.kv.set("cursor", "old-kv");
    setPluginSettingsValues(db, "updater", {
      mode: JSON.stringify("old-setting"),
    });
    upsertPluginSchedule(db, {
      pluginId: "updater",
      name: "sync",
      cron: "0 * * * *",
      nextRunAt: 1234,
    });
    await mkdir(join(pluginDir, "secrets"), { recursive: true });
    await writeFile(secretPath, "super-secret-value", { mode: 0o600 });
    await writeFile(failureMarker, "fail");

    const candidateCommit = await commitPlugin(
      repo,
      "1.1.0",
      undefined,
      `
        import { existsSync, writeFileSync } from "node:fs";
        export default async function plugin(bb: any) {
          const database = bb.storage.sqlite();
          database.prepare("UPDATE state SET value = ?").run("new-db");
          await bb.storage.kv.set("cursor", "new-kv");
          writeFileSync(${JSON.stringify(secretPath)}, "changed-secret");
          if (existsSync(${JSON.stringify(failureMarker)})) throw new Error("candidate factory exploded");
        }
      `,
    );
    const result = await service.applyUpdate("updater", {
      dryRun: false,
      latest: false,
    });
    expect(result).toMatchObject({
      ok: true,
      result: {
        applied: false,
        outcome: "rolled-back",
        detail: expect.stringContaining("candidate factory exploded"),
      },
    });
    expect(
      service.list().find((entry) => entry.id === "updater"),
    ).toMatchObject({ id: "updater", version: "1.0.0", status: "running" });
    expect(getInstalledPluginRegistration(db, "updater")).toMatchObject({
      quarantinedVersion: candidateCommit,
      quarantineDetail: expect.stringContaining("candidate factory exploded"),
    });
    const restored = new Database(databasePath, { readonly: true });
    expect(restored.prepare("SELECT value FROM state").pluck().get()).toBe(
      "old-db",
    );
    restored.close();
    expect(getPluginKvValue(db, "updater", "cursor")).toBe(
      JSON.stringify("old-kv"),
    );
    expect(getPluginSettingsValues(db, "updater")).toEqual({
      mode: JSON.stringify("old-setting"),
    });
    expect(listPluginSchedules(db, "updater")).toMatchObject([
      { name: "sync", cron: "0 * * * *" },
    ]);
    expect(await readFile(secretPath, "utf8")).toBe("super-secret-value");
    const snapshots = listPluginStateSnapshots(db, "updater");
    expect(snapshots).toMatchObject([{ status: "restored" }]);
    expect(JSON.stringify(snapshots)).not.toContain("super-secret-value");
    expect(await readFile(snapshots[0]!.statePath, "utf8")).not.toContain(
      "super-secret-value",
    );
    expect(
      JSON.stringify([infoLog.mock.calls, warningLog.mock.calls]),
    ).not.toContain("super-secret-value");

    await expect(service.checkForUpdates("updater")).resolves.toMatchObject([
      {
        outcome: "unavailable",
        detail: expect.stringContaining("quarantined"),
      },
    ]);
    await rm(failureMarker);
    await expect(
      service.applyUpdate("updater", { dryRun: false, latest: false }),
    ).resolves.toMatchObject({
      ok: true,
      result: { applied: true, outcome: "updated" },
    });
    expect(service.list()).toMatchObject([
      { id: "updater", version: "1.1.0", status: "running" },
    ]);
  });

  it("rolls back when a background service crashes during stabilization", async () => {
    const installedCommit = getInstalledPluginRegistration(
      db,
      "updater",
    )?.gitResolvedCommit;
    if (installedCommit === null || installedCommit === undefined) {
      throw new Error("missing installed commit");
    }
    let rejectService!: (error: Error) => void;
    const serviceCrash = new Promise<void>((_resolve, reject) => {
      rejectService = reject;
    });
    vi.stubGlobal("__bbPluginStabilizationCrash", serviceCrash);
    await service.stop();
    service = createPluginService({
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger,
      dataDir: join(workDir, "data"),
      appVersion: "1.0.0",
      isEnabled: () => true,
      isConnectEnabled: () => false,
      loadTimeoutMs: 2000,
      stabilizationWindowMs: 1,
      serviceRestartBaseMs: 1000,
      scheduleStabilizationWindow: () => {
        rejectService(new Error("service exploded"));
        return () => {};
      },
    });
    await service.start();
    const candidateCommit = await commitPlugin(
      repo,
      "1.1.0",
      undefined,
      `export default function plugin(bb: any) {
        bb.background.service("unstable", { async start() {
          await (globalThis as any).__bbPluginStabilizationCrash;
        }});
      }`,
    );
    await expect(
      service.applyUpdate("updater", { dryRun: false, latest: false }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        applied: false,
        outcome: "rolled-back",
        detail: expect.stringContaining("service unstable crashed"),
      },
    });
    expect(getInstalledPluginRegistration(db, "updater")).toMatchObject({
      gitResolvedCommit: installedCommit,
      quarantinedVersion: candidateCommit,
    });
    expect(
      service.list().find((entry) => entry.id === "updater"),
    ).toMatchObject({ id: "updater", version: "1.0.0", status: "running" });
  });

  it("finishes an interrupted rollback before loading plugins after restart", async () => {
    const pluginDir = join(workDir, "data", "plugins", "updater");
    const databasePath = join(pluginDir, "data.db");
    const secretPath = join(pluginDir, "secrets", "token");
    const oldRegistration = getInstalledPluginRegistration(db, "updater");
    if (
      oldRegistration?.activeArtifactId === null ||
      oldRegistration === undefined
    ) {
      throw new Error("missing old registration");
    }
    const oldArtifact = listPluginArtifacts(db, "updater").find(
      (artifact) => artifact.id === oldRegistration.activeArtifactId,
    );
    if (oldArtifact === undefined) throw new Error("missing old artifact");
    const api = service.getApi("updater");
    if (api === undefined) throw new Error("updater did not load");
    const pluginDb = api.storage.sqlite();
    pluginDb.exec("CREATE TABLE restart_state (value TEXT NOT NULL)");
    pluginDb.prepare("INSERT INTO restart_state VALUES (?)").run("old-db");
    await api.storage.kv.set("restart-cursor", "old-kv");
    setPluginSettingsValues(db, "updater", {
      restartMode: JSON.stringify("old-setting"),
    });
    await mkdir(join(pluginDir, "secrets"), { recursive: true });
    await writeFile(secretPath, "restart-secret", { mode: 0o600 });

    await commitPlugin(
      repo,
      "1.1.0",
      undefined,
      `
        import { writeFileSync } from "node:fs";
        export default async function plugin(bb: any) {
          const database = bb.storage.sqlite();
          database.prepare("UPDATE restart_state SET value = ?").run("new-db");
          await bb.storage.kv.set("restart-cursor", "new-kv");
          writeFileSync(${JSON.stringify(secretPath)}, "changed-secret");
          throw new Error("restart rollback candidate failed");
        }
      `,
    );
    await service.stop();
    service = createPluginService({
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger,
      dataDir: join(workDir, "data"),
      appVersion: "1.0.0",
      isEnabled: () => true,
      isConnectEnabled: () => false,
      stabilizationWindowMs: 0,
      afterPluginRollbackStateRestored: async () => {
        throw new Error("simulated process exit during rollback");
      },
    });
    await service.start();
    upsertPluginSchedule(db, {
      pluginId: "updater",
      name: "restart-sync",
      cron: "0 * * * *",
      nextRunAt: 4321,
    });
    await expect(
      service.applyUpdate("updater", { dryRun: false, latest: false }),
    ).rejects.toThrow("simulated process exit during rollback");
    expect(getInstalledPluginRegistration(db, "updater")).toMatchObject({
      version: "1.1.0",
      activeArtifactId: expect.not.stringMatching(
        oldRegistration.activeArtifactId,
      ),
    });
    expect(listPluginStateSnapshots(db, "updater")).toMatchObject([
      { status: "restoring", fromArtifactId: oldRegistration.activeArtifactId },
    ]);

    await service.stop();
    service = createPluginService({
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger,
      dataDir: join(workDir, "data"),
      appVersion: "1.0.0",
      isEnabled: () => true,
      isConnectEnabled: () => false,
      stabilizationWindowMs: 0,
    });
    await service.start();

    expect(getInstalledPluginRegistration(db, "updater")).toMatchObject({
      version: oldRegistration.version,
      activeArtifactId: oldRegistration.activeArtifactId,
      quarantinedVersion: expect.any(String),
    });
    expect(
      service.list().find((entry) => entry.id === "updater"),
    ).toMatchObject({ version: oldRegistration.version, status: "running" });
    const restored = new Database(databasePath, { readonly: true });
    expect(
      restored.prepare("SELECT value FROM restart_state").pluck().get(),
    ).toBe("old-db");
    restored.close();
    expect(getPluginKvValue(db, "updater", "restart-cursor")).toBe(
      JSON.stringify("old-kv"),
    );
    expect(getPluginSettingsValues(db, "updater")).toEqual({
      restartMode: JSON.stringify("old-setting"),
    });
    expect(listPluginSchedules(db, "updater")).toMatchObject([
      { name: "restart-sync", cron: "0 * * * *", nextRunAt: 4321 },
    ]);
    expect(await readFile(secretPath, "utf8")).toBe("restart-secret");
    await stat(oldArtifact.path);
    expect(listPluginStateSnapshots(db, "updater")).toMatchObject([
      { status: "restored" },
    ]);
  });

  it("retains rollback state through the grace period and collects it afterward", async () => {
    await service.stop();
    let clock = Date.now();
    const makeService = () =>
      createPluginService({
        db,
        hub: {
          getDaemonSessionIdForHost: () => null,
          notifyPluginSignal: () => 0,
          notifySystem: () => {},
        },
        logger,
        dataDir: join(workDir, "data"),
        appVersion: "1.0.0",
        isEnabled: () => true,
        isConnectEnabled: () => false,
        stabilizationWindowMs: 0,
        artifactRetentionMs: 50,
        now: () => clock,
      });
    service = makeService();
    await service.start();
    const oldArtifact = listPluginArtifacts(db, "updater").find(
      (artifact) =>
        artifact.id ===
        getInstalledPluginRegistration(db, "updater")?.activeArtifactId,
    );
    if (oldArtifact === undefined) throw new Error("missing old artifact");
    await commitPlugin(repo, "1.1.0");
    await expect(
      service.applyUpdate("updater", { dryRun: false, latest: false }),
    ).resolves.toMatchObject({ ok: true, result: { applied: true } });
    expect(listPluginStateSnapshots(db, "updater")).toHaveLength(1);
    expect(listPluginArtifacts(db, "updater")).toHaveLength(2);
    await stat(oldArtifact.path);

    clock += 51;
    await service.stop();
    service = makeService();
    await service.start();
    expect(listPluginStateSnapshots(db, "updater")).toHaveLength(0);
    const remaining = listPluginArtifacts(db, "updater");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(
      getInstalledPluginRegistration(db, "updater")?.activeArtifactId,
    );
    await expect(stat(oldArtifact.path)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await stat(remaining[0]!.path);
  });

  it("orders removal after an in-flight update without resurrecting the plugin", async () => {
    await commitPlugin(repo, "1.1.0");
    let releasePromotion: (() => void) | undefined;
    let reportPromotion: (() => void) | undefined;
    const promotionReached = new Promise<void>((resolvePromise) => {
      reportPromotion = resolvePromise;
    });
    const holdPromotion = new Promise<void>((resolvePromise) => {
      releasePromotion = resolvePromise;
    });
    afterArtifactPromoted = async () => {
      reportPromotion?.();
      await holdPromotion;
    };

    const update = service.applyUpdate("updater", {
      dryRun: false,
      latest: false,
    });
    await promotionReached;
    const removal = service.remove("updater");
    releasePromotion?.();

    await expect(update).resolves.toMatchObject({
      ok: true,
      result: { applied: true },
    });
    await expect(removal).resolves.toBe(true);
    expect(getInstalledPluginRegistration(db, "updater")).toBeUndefined();
  });

  it("orders disablement after an in-flight update without re-enabling it", async () => {
    await commitPlugin(repo, "1.1.0");
    let releasePromotion: (() => void) | undefined;
    let reportPromotion: (() => void) | undefined;
    const promotionReached = new Promise<void>((resolvePromise) => {
      reportPromotion = resolvePromise;
    });
    const holdPromotion = new Promise<void>((resolvePromise) => {
      releasePromotion = resolvePromise;
    });
    afterArtifactPromoted = async () => {
      reportPromotion?.();
      await holdPromotion;
    };

    const update = service.applyUpdate("updater", {
      dryRun: false,
      latest: false,
    });
    await promotionReached;
    const disable = service.setEnabled("updater", false);
    releasePromotion?.();

    await expect(update).resolves.toMatchObject({
      ok: true,
      result: { applied: true },
    });
    await expect(disable).resolves.toMatchObject({ enabled: false });
    expect(getInstalledPluginRegistration(db, "updater")).toMatchObject({
      version: "1.1.0",
      enabled: false,
    });
  });

  it("uses isolated staging directories for concurrent check and update", async () => {
    const nextCommit = await commitPlugin(repo, "1.1.0");
    const [checked, applied] = await Promise.all([
      service.checkForUpdates("updater"),
      service.applyUpdate("updater", { dryRun: false, latest: false }),
    ]);

    expect(checked).toHaveLength(1);
    expect(applied).toMatchObject({ ok: true });
    expect(getInstalledPluginRegistration(db, "updater")).toMatchObject({
      gitResolvedCommit: nextCommit,
      version: "1.1.0",
    });
  });

  it("refuses a pinned git tag unless the source is changed explicitly", async () => {
    await service.remove("updater");
    await git(repo, ["tag", "v1"]);
    await service.install(`git:${repo}@v1`);
    const response = await app.request("/plugins/updater/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error:
        'plugin "updater" is pinned to a git ref; install a branch source to track updates',
    });
  });

  it("loads a legacy-layout plugin unchanged, then migrates lazily on update", async () => {
    await service.remove("updater");
    const legacyRoot = join(
      workDir,
      "data",
      "plugins",
      "git",
      "legacy-updater",
    );
    await run("git", ["clone", "--quiet", repo, legacyRoot]);
    const currentCommit = await git(repo, ["rev-parse", "HEAD"]);
    upsertInstalledPlugin(db, {
      id: "updater",
      source: `git:${repo}@main`,
      provenance: { kind: "direct" },
      sourceIntent: {
        kind: "git",
        url: repo,
        subdirectory: null,
        requestedRef: "main",
        refKind: "branch",
      },
      exactResolution: { kind: "git", commit: currentCommit },
      updatePolicy: "compatible",
      updateState: {
        lastCheckAt: null,
        availableCompatibleVersion: null,
        newestIncompatibleVersion: null,
        statusDetail: null,
        ignoredVersion: null,
      },
      activeArtifactId: null,
      rootDir: legacyRoot,
      version: "1.0.0",
      enabled: true,
    });
    await service.reload("updater");
    expect(service.list()).toMatchObject([
      { id: "updater", rootDir: legacyRoot, status: "running" },
    ]);

    const nextCommit = await commitPlugin(repo, "1.1.0");
    const applied = await service.applyUpdate("updater", {
      dryRun: false,
      latest: false,
    });
    expect(applied).toMatchObject({ ok: true, result: { applied: true } });
    const migrated = getInstalledPluginRegistration(db, "updater");
    expect(migrated).toMatchObject({
      rootDir: expect.stringContaining(
        join("plugins", "cache", "git", "local"),
      ),
      activeArtifactId: expect.any(String),
      gitResolvedCommit: nextCommit,
    });
    await stat(join(legacyRoot, "package.json"));
  });
});
