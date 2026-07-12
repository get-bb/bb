import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import Database from "better-sqlite3";
import type { AddressInfo } from "node:net";
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
  setAppSettings,
  setPluginSettingsValues,
  upsertPluginSchedule,
  upsertInstalledPlugin,
  type DbConnection,
} from "@bb/db";
import { defaultAppSettings } from "@bb/domain";
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
    registerPluginRoutes(app, { config: { serverPort: 3334 }, db }, service);
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
        autoApply: false,
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

  it("automatically applies an opted-in compatible update through activation", async () => {
    await service.setUpdatePolicy("updater", "compatible");
    await service.setAutoApply("updater", true);
    const candidateCommit = await commitPlugin(repo, "1.1.0");

    await service.sweepAutomaticUpdates(Date.now());

    expect(getInstalledPluginRegistration(db, "updater")).toMatchObject({
      gitResolvedCommit: candidateCommit,
      version: "1.1.0",
    });
    expect(service.list()).toMatchObject([
      { id: "updater", version: "1.1.0", status: "running", autoApply: true },
    ]);
    expect(service.listUpdateHistory("updater", 20)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "check", outcome: "update-available" }),
        expect.objectContaining({ kind: "download", outcome: "started" }),
        expect.objectContaining({ kind: "activate", outcome: "updated" }),
      ]),
    );
  });

  it("audits a discovered candidate when automatic application is off", async () => {
    await service.setUpdatePolicy("updater", "compatible");
    const installedCommit = getInstalledPluginRegistration(
      db,
      "updater",
    )?.gitResolvedCommit;
    await commitPlugin(repo, "1.1.0");

    await service.sweepAutomaticUpdates(Date.now());

    expect(
      getInstalledPluginRegistration(db, "updater")?.gitResolvedCommit,
    ).toBe(installedCommit);
    expect(service.listUpdateHistory("updater", 10)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "auto-apply-skipped",
          outcome: "skipped",
          detail: "automatic application is not enabled",
        }),
      ]),
    );
  });

  it("never automatically applies a major git plugin version", async () => {
    await service.setUpdatePolicy("updater", "compatible");
    await service.setAutoApply("updater", true);
    const installedCommit = getInstalledPluginRegistration(
      db,
      "updater",
    )?.gitResolvedCommit;
    await commitPlugin(repo, "2.0.0");

    await service.sweepAutomaticUpdates(Date.now());

    expect(
      getInstalledPluginRegistration(db, "updater")?.gitResolvedCommit,
    ).toBe(installedCommit);
    expect(service.listUpdateHistory("updater", 10)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "auto-apply-skipped",
          detail: "major updates are never automatically applied",
        }),
      ]),
    );
  });

  it("respects ignored candidates and the organization disable toggle", async () => {
    await service.setUpdatePolicy("updater", "compatible");
    await service.setAutoApply("updater", true);
    const ignoredCommit = await commitPlugin(repo, "1.1.0");
    await service.ignoreVersion("updater", ignoredCommit);
    await service.sweepAutomaticUpdates(Date.now());
    expect(getInstalledPluginRegistration(db, "updater")?.version).toBe(
      "1.0.0",
    );
    expect(service.listUpdateHistory("updater", 10)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "auto-apply-skipped",
          detail: expect.stringContaining("ignored"),
        }),
      ]),
    );

    await service.ignoreVersion("updater", "older-candidate");
    await commitPlugin(repo, "1.2.0");
    setAppSettings(db, {
      ...defaultAppSettings,
      pluginAutoApplyDisabled: true,
    });
    await service.sweepAutomaticUpdates(Date.now());
    expect(getInstalledPluginRegistration(db, "updater")?.version).toBe(
      "1.0.0",
    );
    expect(service.listUpdateHistory("updater", 10)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "auto-apply-skipped",
          detail: "organization policy disables automatic application",
        }),
      ]),
    );
  });

  it("persists patch/minor policy and skips an ignored version until a newer release appears", async () => {
    upsertInstalledPlugin(db, {
      id: "policy-test",
      source: "npm:bb-plugin-policy-test@^1.0.0",
      provenance: { kind: "direct" },
      sourceIntent: {
        kind: "npm",
        packageName: "bb-plugin-policy-test",
        registry: "https://policy.test",
        requestedSpec: "^1.0.0",
        specKind: "range",
      },
      exactResolution: {
        kind: "npm",
        version: "1.0.0",
        integrity: "sha512-current",
      },
      updatePolicy: "compatible",
      autoApply: false,
      updateState: {
        lastCheckAt: null,
        availableCompatibleVersion: null,
        newestIncompatibleVersion: null,
        statusDetail: null,
        ignoredVersion: null,
      },
      activeArtifactId: null,
      rootDir: join(workDir, "policy-test"),
      version: "1.0.0",
      enabled: false,
    });
    let versions = ["1.0.0", "1.0.9", "1.1.0", "2.0.0"];
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            versions: Object.fromEntries(
              versions.map((version) => [
                version,
                { version, dist: { integrity: `sha512-${version}` } },
              ]),
            ),
            "dist-tags": { latest: versions.at(-1) },
          }),
          { status: 200 },
        ),
    );

    const patchPolicy = await app.request(
      "/plugins/policy-test/update-policy",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policy: "patch" }),
      },
    );
    expect(patchPolicy.status).toBe(200);
    expect(await patchPolicy.json()).toEqual({ policy: "patch" });
    await expect(service.checkForUpdates("policy-test")).resolves.toMatchObject(
      [{ outcome: "update-available", candidate: { version: "1.0.9" } }],
    );

    const ignored = await app.request("/plugins/policy-test/ignore-version", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: "1.0.9" }),
    });
    expect(ignored.status).toBe(200);
    expect(await ignored.json()).toEqual({ ignoredVersion: "1.0.9" });
    await expect(service.checkForUpdates("policy-test")).resolves.toMatchObject(
      [{ outcome: "current", detail: "version 1.0.9 is ignored" }],
    );

    versions = ["1.0.0", "1.0.9", "1.0.10", "1.1.0", "2.0.0"];
    await expect(service.checkForUpdates("policy-test")).resolves.toMatchObject(
      [{ outcome: "update-available", candidate: { version: "1.0.10" } }],
    );
    expect(getInstalledPluginRegistration(db, "policy-test")).toMatchObject({
      ignoredVersion: null,
    });

    await service.setUpdatePolicy("policy-test", "minor");
    await expect(service.checkForUpdates("policy-test")).resolves.toMatchObject(
      [{ outcome: "update-available", candidate: { version: "1.1.0" } }],
    );
  });

  it("serializes ignore-version and update-policy writes behind an in-flight check", async () => {
    upsertInstalledPlugin(db, {
      id: "race-test",
      source: "npm:bb-plugin-race-test@^1.0.0",
      provenance: { kind: "direct" },
      sourceIntent: {
        kind: "npm",
        packageName: "bb-plugin-race-test",
        registry: "https://race.test",
        requestedSpec: "^1.0.0",
        specKind: "range",
      },
      exactResolution: {
        kind: "npm",
        version: "1.0.0",
        integrity: "sha512-current",
      },
      updatePolicy: "compatible",
      autoApply: false,
      updateState: {
        lastCheckAt: null,
        availableCompatibleVersion: null,
        newestIncompatibleVersion: null,
        statusDetail: null,
        ignoredVersion: null,
      },
      activeArtifactId: null,
      rootDir: join(workDir, "race-test"),
      version: "1.0.0",
      enabled: false,
    });
    let releaseFetch!: () => void;
    const fetchHeld = new Promise<void>((resolvePromise) => {
      releaseFetch = resolvePromise;
    });
    let announceFetch!: () => void;
    const fetchStarted = new Promise<void>((resolvePromise) => {
      announceFetch = resolvePromise;
    });
    vi.stubGlobal("fetch", async () => {
      announceFetch();
      await fetchHeld;
      return new Response(
        JSON.stringify({
          versions: {
            "1.0.0": {
              version: "1.0.0",
              dist: { integrity: "sha512-current" },
            },
            "1.0.1": {
              version: "1.0.1",
              dist: { integrity: "sha512-next" },
            },
          },
          "dist-tags": { latest: "1.0.1" },
        }),
        { status: 200 },
      );
    });

    const check = service.checkForUpdates("race-test");
    await fetchStarted;
    let ignoreSettled = false;
    let policySettled = false;
    const ignored = Promise.resolve(
      app.request("/plugins/race-test/ignore-version", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: "1.0.1" }),
      }),
    ).then((response) => {
      ignoreSettled = true;
      return response;
    });
    const policy = Promise.resolve(
      app.request("/plugins/race-test/update-policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policy: "patch" }),
      }),
    ).then((response) => {
      policySettled = true;
      return response;
    });
    await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
    expect({ ignoreSettled, policySettled }).toEqual({
      ignoreSettled: false,
      policySettled: false,
    });

    releaseFetch();
    await expect(check).resolves.toMatchObject([
      { outcome: "update-available", candidate: { version: "1.0.1" } },
    ]);
    expect((await ignored).status).toBe(200);
    expect((await policy).status).toBe(200);
    expect(getInstalledPluginRegistration(db, "race-test")).toMatchObject({
      ignoredVersion: "1.0.1",
      updatePolicy: "patch",
    });
  });

  it(
    "applies the same patch/minor candidate selected within the original intent range",
    { timeout: 120_000 },
    async () => {
      const packageName = "bb-plugin-policy-apply";
      const tarballs = new Map<string, Buffer>();
      for (const version of ["1.6.5", "1.9.0"]) {
        const fixture = join(workDir, `policy-apply-${version}`);
        await mkdir(fixture, { recursive: true });
        await writeFile(
          join(fixture, "package.json"),
          JSON.stringify({
            name: packageName,
            version,
            bb: { server: "./server.js" },
          }),
        );
        await writeFile(
          join(fixture, "server.js"),
          "export default function plugin() {}\n",
        );
        const packDir = join(workDir, `policy-pack-${version}`);
        await mkdir(packDir, { recursive: true });
        await run("npm", ["pack", "--pack-destination", packDir], {
          cwd: fixture,
        });
        const [tarballName] = await readdir(packDir);
        if (tarballName === undefined)
          throw new Error("npm pack produced no tarball");
        tarballs.set(version, await readFile(join(packDir, tarballName)));
      }
      const registry = await new Promise<Server>((resolvePromise) => {
        const server = createServer((request, response) => {
          const url = request.url ?? "";
          const tarballMatch = /^\/(1\.6\.5|1\.9\.0)\.tgz$/u.exec(url);
          if (tarballMatch !== null) {
            const tarball = tarballs.get(tarballMatch[1] ?? "");
            if (tarball === undefined) {
              response.writeHead(404).end();
              return;
            }
            response.writeHead(200, {
              "content-type": "application/octet-stream",
            });
            response.end(tarball);
            return;
          }
          if (decodeURIComponent(url) === `/${packageName}`) {
            const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
            const versions = Object.fromEntries(
              ["1.4.0", "1.6.0", "1.6.5", "1.9.0", "2.0.0"].map((version) => {
                const tarball = tarballs.get(version);
                return [
                  version,
                  {
                    name: packageName,
                    version,
                    dist: {
                      integrity:
                        tarball === undefined
                          ? `sha512-${version}`
                          : `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
                      ...(tarball === undefined
                        ? {}
                        : { tarball: `${origin}/${version}.tgz` }),
                    },
                  },
                ];
              }),
            );
            response.writeHead(200, { "content-type": "application/json" });
            response.end(
              JSON.stringify({
                name: packageName,
                "dist-tags": { latest: "2.0.0" },
                versions,
              }),
            );
            return;
          }
          response.writeHead(404).end();
        });
        server.listen(0, "127.0.0.1", () => resolvePromise(server));
      });
      const registryUrl = `http://127.0.0.1:${(registry.address() as AddressInfo).port}`;
      const previousCache = process.env.npm_config_cache;
      const previousPackageLock = process.env.npm_config_package_lock;
      process.env.npm_config_cache = join(workDir, "policy-npm-cache");
      process.env.npm_config_package_lock = "false";
      try {
        for (const scenario of [
          { policy: "patch" as const, current: "1.6.0", expected: "1.6.5" },
          { policy: "minor" as const, current: "1.4.0", expected: "1.9.0" },
        ]) {
          upsertInstalledPlugin(db, {
            id: "policy-apply",
            source: `npm:${packageName}@^1.4.0`,
            provenance: { kind: "direct" },
            sourceIntent: {
              kind: "npm",
              packageName,
              registry: registryUrl,
              requestedSpec: "^1.4.0",
              specKind: "range",
            },
            exactResolution: {
              kind: "npm",
              version: scenario.current,
              integrity: `sha512-${scenario.current}`,
            },
            updatePolicy: scenario.policy,
            autoApply: false,
            updateState: {
              lastCheckAt: null,
              availableCompatibleVersion: null,
              newestIncompatibleVersion: null,
              statusDetail: null,
              ignoredVersion: null,
            },
            activeArtifactId: null,
            rootDir: join(workDir, `policy-current-${scenario.current}`),
            version: scenario.current,
            enabled: false,
          });
          await expect(
            service.applyUpdate("policy-apply", {
              dryRun: false,
              latest: false,
            }),
          ).resolves.toMatchObject({
            ok: true,
            result: {
              applied: true,
              from: { version: scenario.current },
              to: { version: scenario.expected },
              outcome: "updated",
            },
          });
          expect(
            getInstalledPluginRegistration(db, "policy-apply"),
          ).toMatchObject({
            source: `npm:${packageName}@^1.4.0`,
            sourceNpmRequestedSpec: "^1.4.0",
            sourceNpmSpecKind: "range",
            npmResolvedVersion: scenario.expected,
            updatePolicy: scenario.policy,
          });
        }
      } finally {
        if (previousCache === undefined) delete process.env.npm_config_cache;
        else process.env.npm_config_cache = previousCache;
        if (previousPackageLock === undefined)
          delete process.env.npm_config_package_lock;
        else process.env.npm_config_package_lock = previousPackageLock;
        await new Promise<void>((resolvePromise, reject) => {
          registry.close((error) => {
            if (error) reject(error);
            else resolvePromise();
          });
        });
      }
    },
  );

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
    expect(
      service.list().find((entry) => entry.id === "updater"),
    ).toMatchObject({
      provenance: "direct",
      sourceDisplay: expect.stringContaining("git ·"),
      updatePolicy: "compatible",
      autoApply: false,
      updateState: {
        quarantined: true,
        lastFailure: {
          version: candidateCommit,
          at: expect.any(Number),
          detail: expect.stringContaining("candidate factory exploded"),
        },
      },
    });
    const sourceResponse = await app.request("/plugins/updater/source");
    expect(sourceResponse.status).toBe(200);
    expect(await sourceResponse.json()).toMatchObject({
      requested: `git:${repo}@main`,
      resolved: expect.stringContaining(repo),
      engines: {},
      installedAt: expect.any(Number),
      history: expect.arrayContaining([
        {
          version: expect.stringMatching(/^[0-9a-f]{40}$/),
          activatedAt: expect.any(Number),
        },
      ]),
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
    await service.setAutoApply("updater", true);
    await service.sweepAutomaticUpdates(Date.now());
    expect(getInstalledPluginRegistration(db, "updater")).toMatchObject({
      version: "1.0.0",
      quarantinedVersion: candidateCommit,
    });
    expect(service.listUpdateHistory("updater", 10)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "auto-apply-skipped",
          detail: expect.stringContaining("quarantined"),
        }),
        expect.objectContaining({ kind: "rollback", outcome: "restored" }),
      ]),
    );
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
      autoApply: false,
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
