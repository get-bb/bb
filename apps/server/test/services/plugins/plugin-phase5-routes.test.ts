import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createConnection,
  getInstalledPluginRegistration,
  listInstalledPlugins,
  migrate,
  type DbConnection,
} from "@bb/db";
import type { Logger } from "@bb/logger";
import { registerPluginRoutes } from "../../../src/routes/plugins.js";
import { createMarketplaceService } from "../../../src/services/marketplaces/marketplace-service.js";
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

async function writePlugin(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "bb-plugin-local-preview",
      version: "1.2.3",
      description: "Local preview plugin",
      engines: { bb: "^1.0.0", bbPluginSdk: "^1.0.0" },
      bb: { server: "./server.js", displayName: "Local Preview" },
    }),
  );
  await writeFile(
    join(root, "server.js"),
    "export default function plugin() {}\n",
  );
}

describe("Phase 5 plugin routes", () => {
  let db: DbConnection;
  let workDir: string;
  let dataDir: string;
  let service: PluginService;
  let app: Hono;
  let materialize: ReturnType<typeof vi.fn<(args: { path: string }) => void>>;

  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-phase5-"));
    dataDir = join(workDir, "data");
    materialize = vi.fn<(args: { path: string }) => void>();
    service = createPluginService({
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger,
      dataDir,
      appVersion: "1.4.0",
      isEnabled: () => true,
      isConnectEnabled: () => false,
      builtinPlugins: [],
      onArtifactMaterialize: materialize,
    });
    app = new Hono();
    registerPluginRoutes(app, { config: { serverPort: 3334 } }, service);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await service.stop();
    db.$client.close();
    await rm(workDir, { recursive: true, force: true });
  });

  it("previews npm exact/range/default metadata and reports incompatible newer releases without mutation", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            versions: {
              "1.4.0": {
                name: "bb-plugin-linear",
                version: "1.4.0",
                description: "Linear integration",
                bb: { displayName: "Linear" },
                engines: { bb: "^1.0.0" },
                dist: { integrity: "sha512-140" },
              },
              "1.5.0": {
                name: "bb-plugin-linear",
                version: "1.5.0",
                engines: { bb: ">=99.0.0" },
                dist: { integrity: "sha512-150" },
              },
            },
            "dist-tags": { latest: "1.5.0" },
          }),
          { status: 200 },
        ),
    );
    const before = listInstalledPlugins(db);
    for (const [source, version] of [
      ["npm:bb-plugin-linear@1.4.0", "1.4.0"],
      ["npm:bb-plugin-linear@^1.4.0", "1.4.0"],
      ["npm:bb-plugin-linear", "1.4.0"],
    ] as const) {
      const response = await app.request("/plugins/install/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        plugin: {
          id: "linear",
          displayName: "Linear",
          description: "Linear integration",
        },
        resolved: { display: `bb-plugin-linear@${version}`, version },
        compatibility: { outcome: "compatible", problems: [] },
      });
    }
    const omitted = await app.request("/plugins/install/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "npm:bb-plugin-linear" }),
    });
    expect(await omitted.json()).toMatchObject({
      skipped: [
        {
          version: "1.5.0",
          reason: expect.stringContaining("requires bb >=99.0.0"),
        },
      ],
    });
    expect(listInstalledPlugins(db)).toEqual(before);
    expect(materialize).not.toHaveBeenCalled();
  });

  it("previews path, git, and marketplace sources without cloning or changing state", async () => {
    const pluginRoot = join(workDir, "plugin");
    await writePlugin(pluginRoot);
    const repo = join(workDir, "repo");
    await mkdir(repo);
    await git(repo, ["init", "-q", "-b", "main"]);
    await git(repo, ["config", "user.email", "test@example.com"]);
    await git(repo, ["config", "user.name", "Test"]);
    await writeFile(join(repo, "README.md"), "fixture\n");
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "-qm", "fixture"]);
    const commit = await git(repo, ["rev-parse", "HEAD"]);

    const pathResponse = await app.request("/plugins/install/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: `path:${pluginRoot}` }),
    });
    expect(await pathResponse.json()).toMatchObject({
      plugin: { id: "local-preview", displayName: "Local Preview" },
      resolved: { version: "1.2.3" },
      compatibility: { outcome: "compatible", problems: [] },
      updatePolicy: "pinned",
    });

    const gitResponse = await app.request("/plugins/install/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: `git:${repo}@main` }),
    });
    expect(await gitResponse.json()).toMatchObject({
      resolved: { commit },
      compatibility: { outcome: "compatible", problems: [] },
      warnings: ["manifest not inspected until install"],
    });
    expect(materialize).not.toHaveBeenCalled();
    expect(listInstalledPlugins(db)).toEqual([]);

    const marketplaceRoot = join(workDir, "marketplace");
    await mkdir(marketplaceRoot);
    await writePlugin(join(marketplaceRoot, "entry"));
    await writeFile(
      join(marketplaceRoot, "marketplace.json"),
      JSON.stringify({
        schemaVersion: 1,
        name: "phase5",
        displayName: "Phase 5",
        plugins: [
          {
            id: "catalog-id",
            displayName: "Catalog Name",
            description: "Catalog description",
            source: { path: "entry" },
          },
        ],
      }),
    );
    const marketplaces = createMarketplaceService({
      db,
      dataDir,
      appVersion: "1.4.0",
      plugins: service,
    });
    await marketplaces.add(marketplaceRoot);
    const marketplaceApp = new Hono();
    registerPluginRoutes(
      marketplaceApp,
      { config: { serverPort: 3334 } },
      service,
      marketplaces,
    );
    const filesBefore = await readdir(workDir, { recursive: true });
    const marketplaceResponse = await marketplaceApp.request(
      "/plugins/install/preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplace: { marketplaceId: "phase5", entryId: "catalog-id" },
        }),
      },
    );
    expect(await marketplaceResponse.json()).toMatchObject({
      plugin: {
        id: "catalog-id",
        displayName: "Catalog Name",
        description: "Catalog description",
      },
      resolved: { version: "1.2.3" },
    });
    expect(await readdir(workDir, { recursive: true })).toEqual(filesBefore);
    expect(listInstalledPlugins(db)).toEqual([]);
  });

  it("returns actionable route shapes for unknown previews and mutations", async () => {
    const preview = await app.request("/plugins/install/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "npm:not a package" }),
    });
    expect(preview.status).toBe(422);
    expect(await preview.json()).toMatchObject({
      error: expect.stringContaining("invalid npm package name"),
    });
    for (const [path, body] of [
      ["/plugins/missing/ignore-version", { version: "1.0.0" }],
      ["/plugins/missing/update-policy", { policy: "patch" }],
    ] as const) {
      const response = await app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(422);
      const error = await response.json();
      expect(error).toMatchObject({
        error: expect.stringContaining("unknown plugin"),
      });
    }
    const source = await app.request("/plugins/missing/source");
    expect(source.status).toBe(404);
    expect(await source.json()).toEqual({ error: "unknown plugin" });

    const pluginRoot = join(workDir, "pinned-path");
    await writePlugin(pluginRoot);
    await service.installPath(pluginRoot);
    const unsupportedPolicy = await app.request(
      "/plugins/local-preview/update-policy",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policy: "patch" }),
      },
    );
    expect(unsupportedPolicy.status).toBe(422);
    expect(await unsupportedPolicy.json()).toMatchObject({
      error: expect.stringContaining("only support the manual update policy"),
    });
    expect(getInstalledPluginRegistration(db, "local-preview")).toMatchObject({
      updatePolicy: "manual",
    });
    const unsupportedIgnore = await app.request(
      "/plugins/local-preview/ignore-version",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: "2.0.0" }),
      },
    );
    expect(unsupportedIgnore.status).toBe(422);
    expect(await unsupportedIgnore.json()).toMatchObject({
      error: expect.stringContaining("pinned"),
    });
  });
});
