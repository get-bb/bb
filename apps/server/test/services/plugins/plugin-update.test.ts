import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createConnection,
  getInstalledPluginRegistration,
  listPluginArtifacts,
  migrate,
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
    const legacyRoot = join(workDir, "data", "plugins", "git", "legacy-updater");
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
