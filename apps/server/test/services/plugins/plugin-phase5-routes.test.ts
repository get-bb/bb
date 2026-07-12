import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createConnection,
  createPluginArtifact,
  getInstalledPluginRegistration,
  migrate,
  upsertInstalledPlugin,
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

async function snapshotFilesystem(root: string): Promise<unknown[]> {
  const snapshot: unknown[] = [];
  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relativePath =
        prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      const stats = await lstat(path);
      if (entry.isDirectory()) {
        snapshot.push({
          path: relativePath,
          type: "directory",
          mode: stats.mode,
        });
        await visit(path, relativePath);
      } else if (entry.isSymbolicLink()) {
        snapshot.push({
          path: relativePath,
          type: "symlink",
          mode: stats.mode,
          target: await readlink(path),
        });
      } else {
        snapshot.push({
          path: relativePath,
          type: "file",
          mode: stats.mode,
          content: (await readFile(path)).toString("base64"),
        });
      }
    }
  }
  await visit(root, "");
  return snapshot;
}

describe("Phase 5 plugin routes", () => {
  let db: DbConnection;
  let workDir: string;
  let dataDir: string;
  let service: PluginService;
  let app: Hono;
  let materialize: ReturnType<typeof vi.fn<(args: { path: string }) => void>>;

  async function requestPreviewWithoutMutation(
    targetApp: Hono,
    body: unknown,
  ): Promise<Response> {
    const before = {
      database: db.$client.serialize().toString("base64"),
      filesystem: await snapshotFilesystem(workDir),
    };
    const response = await targetApp.request("/plugins/install/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect({
      database: db.$client.serialize().toString("base64"),
      filesystem: await snapshotFilesystem(workDir),
    }).toEqual(before);
    return response;
  }

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
    upsertInstalledPlugin(db, {
      id: "preview-sentinel",
      source: "npm:bb-plugin-preview-sentinel@^1.0.0",
      provenance: { kind: "direct" },
      sourceIntent: {
        kind: "npm",
        packageName: "bb-plugin-preview-sentinel",
        registry: "https://sentinel.invalid",
        requestedSpec: "^1.0.0",
        specKind: "range",
      },
      exactResolution: {
        kind: "npm",
        version: "1.0.0",
        integrity: "sha512-sentinel",
      },
      updatePolicy: "patch",
      updateState: {
        lastCheckAt: 123,
        availableCompatibleVersion: "1.0.1",
        newestIncompatibleVersion: "2.0.0",
        statusDetail: "sentinel update state",
        ignoredVersion: "1.0.1",
      },
      activeArtifactId: null,
      rootDir: join(workDir, "sentinel"),
      version: "1.0.0",
      enabled: false,
    });
    createPluginArtifact(db, {
      id: "preview-sentinel-artifact",
      pluginId: "preview-sentinel",
      sourceKind: "npm",
      npmResolvedVersion: "1.0.0",
      gitResolvedCommit: null,
      path: join(workDir, "sentinel-artifact"),
      integrity: "sha512-sentinel",
      contentHash: "sha256-sentinel",
      validationResult: "valid",
      validationDetail: null,
      validatedAt: 123,
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
    for (const [source, version, updatePolicy, updatePolicyDisplay] of [
      ["npm:bb-plugin-linear@1.4.0", "1.4.0", "manual", "pinned"],
      [
        "npm:bb-plugin-linear@^1.4.0",
        "1.4.0",
        "compatible",
        "tracks compatible releases in ^1.4.0",
      ],
      [
        "npm:bb-plugin-linear",
        "1.4.0",
        "compatible",
        "tracks compatible releases",
      ],
    ] as const) {
      const response = await requestPreviewWithoutMutation(app, { source });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        plugin: {
          id: "linear",
          displayName: "Linear",
          description: "Linear integration",
        },
        resolved: { display: `bb-plugin-linear@${version}`, version },
        compatibility: { outcome: "compatible", problems: [] },
        updatePolicy,
        updatePolicyDisplay,
      });
    }
    const omitted = await requestPreviewWithoutMutation(app, {
      source: "npm:bb-plugin-linear",
    });
    expect(await omitted.json()).toMatchObject({
      skipped: [
        {
          version: "1.5.0",
          reason: expect.stringContaining("requires bb >=99.0.0"),
        },
      ],
    });
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

    const pathResponse = await requestPreviewWithoutMutation(app, {
      source: `path:${pluginRoot}`,
    });
    expect(await pathResponse.json()).toMatchObject({
      plugin: { id: "local-preview", displayName: "Local Preview" },
      resolved: { version: "1.2.3" },
      compatibility: { outcome: "compatible", problems: [] },
      updatePolicy: "manual",
      updatePolicyDisplay: "pinned",
    });

    const gitResponse = await requestPreviewWithoutMutation(app, {
      source: `git:${repo}@main`,
    });
    expect(await gitResponse.json()).toMatchObject({
      resolved: { commit },
      compatibility: { outcome: "compatible", problems: [] },
      updatePolicy: "compatible",
      updatePolicyDisplay: "tracks branch main",
      warnings: ["manifest not inspected until install"],
    });
    const pinnedGitResponse = await requestPreviewWithoutMutation(app, {
      source: `git:${repo}@${commit}`,
    });
    expect(await pinnedGitResponse.json()).toMatchObject({
      resolved: { commit },
      updatePolicy: "manual",
      updatePolicyDisplay: "pinned",
    });
    expect(materialize).not.toHaveBeenCalled();

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
    const marketplaceResponse = await requestPreviewWithoutMutation(
      marketplaceApp,
      {
        marketplace: { marketplaceId: "phase5", entryId: "catalog-id" },
      },
    );
    expect(await marketplaceResponse.json()).toMatchObject({
      plugin: {
        id: "catalog-id",
        displayName: "Catalog Name",
        description: "Catalog description",
      },
      resolved: { version: "1.2.3" },
      updatePolicy: "manual",
      updatePolicyDisplay: "pinned",
    });
  });

  it("returns actionable route shapes for unknown previews and mutations", async () => {
    const preview = await requestPreviewWithoutMutation(app, {
      source: "npm:not a package",
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
