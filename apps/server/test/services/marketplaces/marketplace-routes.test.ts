import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  defaultExperiments,
  PLUGIN_SDK_MAJOR,
  PLUGIN_SDK_VERSION,
} from "@bb/domain";
import {
  getInstalledPlugin,
  getMarketplace,
  listPluginArtifacts,
  setExperiments,
} from "@bb/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  return (await run("git", args, { cwd })).stdout.trim();
}

async function initRepo(root: string): Promise<void> {
  await git(root, ["init", "-q", "-b", "main"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "user.name", "Test"]);
}

async function commit(root: string, message: string): Promise<string> {
  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-qm", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

async function json(response: Response): Promise<unknown> {
  return response.json();
}

async function writePlugin(
  root: string,
  name: string,
  marker: string,
): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      engines: { bb: ">=0.0.0", bbPluginSdk: ">=1.0.0" },
      bb: { server: "./server.js" },
    }),
  );
  await writeFile(
    join(root, "server.js"),
    `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "loaded"); export default function plugin() {}`,
  );
}

async function writeManagedPlugin(
  root: string,
  name: string,
  id: string,
): Promise<void> {
  await writePlugin(root, name, join(root, "loaded.marker"));
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(
    join(root, "dist", "server.meta.json"),
    JSON.stringify({
      artifactFormatVersion: 1,
      sdkMajor: PLUGIN_SDK_MAJOR,
      sdkVersion: PLUGIN_SDK_VERSION,
      pluginId: id,
      pluginVersion: "1.0.0",
      builtWith: {
        bbVersion: "1.5.0",
        pluginSdkVersion: PLUGIN_SDK_VERSION,
      },
    }),
  );
}

describe("marketplace HTTP routes", () => {
  let harness: TestAppHarness;
  let marketplaceRoot: string;
  let marker: string;

  beforeEach(async () => {
    harness = await createTestAppHarness({ appVersion: "1.5.0" });
    setExperiments(harness.db, { ...defaultExperiments, plugins: true });
    marketplaceRoot = await mkdtemp(join(tmpdir(), "bb-marketplace-routes-"));
    marker = join(marketplaceRoot, "loaded.marker");
    await writePlugin(
      join(marketplaceRoot, "notes"),
      "bb-plugin-notes",
      marker,
    );
    await writePlugin(
      join(marketplaceRoot, "tasks"),
      "bb-plugin-tasks",
      marker,
    );
    await writeFile(
      join(marketplaceRoot, "marketplace.json"),
      JSON.stringify({
        schemaVersion: 1,
        name: "local-test",
        displayName: "Local Test",
        plugins: [
          {
            id: "notes",
            displayName: "Notes",
            description: "Searchable notes",
            category: "productivity",
            source: { path: "notes" },
            updatePolicy: "manual",
            installation: { engines: { bb: ">=1.0.0 <2.0.0" } },
          },
          {
            id: "tasks",
            displayName: "Tasks",
            description: "Task lists",
            source: { path: "tasks" },
          },
          {
            id: "connect-shadow",
            displayName: "Connect Shadow",
            description: "Reserved builtin id",
            source: { npm: { package: "bb-plugin-connect" } },
          },
        ],
      }),
    );
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
    await rm(marketplaceRoot, { recursive: true, force: true });
  });

  it("refreshes without loading code, retains last-known-good, searches, installs, and removes safely", async () => {
    const added = await harness.app.request("/api/v1/marketplaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: marketplaceRoot }),
    });
    expect(added.status).toBe(201);
    expect(await json(added)).toMatchObject({
      marketplace: { id: "local-test", pluginCount: 3 },
    });
    await expect(
      import("node:fs/promises").then(({ stat }) => stat(marker)),
    ).rejects.toThrow();

    const search = await harness.app.request(
      "/api/v1/marketplaces/search?q=productivity",
    );
    expect(await json(search)).toMatchObject({
      results: [{ entryId: "notes", installed: false, compatible: true }],
    });

    await writeFile(
      join(marketplaceRoot, "marketplace.json"),
      JSON.stringify({ schemaVersion: 99 }),
    );
    const failedRefresh = await harness.app.request(
      "/api/v1/marketplaces/local-test/refresh",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(failedRefresh.status).toBe(422);
    expect(getMarketplace(harness.db, "local-test")).toMatchObject({
      lastError: expect.stringMatching(/schemaVersion 99/),
    });
    expect(
      await json(await harness.app.request("/api/v1/marketplaces")),
    ).toMatchObject({
      marketplaces: [{ id: "local-test", pluginCount: 3 }],
    });

    const shadow = await harness.app.request("/api/v1/plugins/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        marketplace: {
          marketplaceId: "local-test",
          entryId: "connect-shadow",
        },
      }),
    });
    expect(shadow.status).toBe(422);
    expect(await json(shadow)).toMatchObject({
      error: expect.stringMatching(/reserved by the builtin plugin/),
    });

    for (const entryId of ["notes", "tasks"]) {
      const installed = await harness.app.request("/api/v1/plugins/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplace: { marketplaceId: "local-test", entryId },
        }),
      });
      expect(installed.status).toBe(200);
    }
    expect(getInstalledPlugin(harness.db, "notes")).toMatchObject({
      provenance: "marketplace",
      marketplaceId: "local-test",
      marketplaceEntryId: "notes",
      updatePolicy: "manual",
    });
    expect(
      await json(
        await harness.app.request("/api/v1/marketplaces/search?q=searchable"),
      ),
    ).toMatchObject({ results: [{ entryId: "notes", installed: true }] });

    const missing = await harness.app.request(
      "/api/v1/marketplaces/local-test",
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(missing.status).toBe(422);
    expect(await json(missing)).toMatchObject({
      affectedPlugins: [
        { id: "notes", version: "1.0.0" },
        { id: "tasks", version: "1.0.0" },
      ],
    });

    const incomplete = await harness.app.request(
      "/api/v1/marketplaces/local-test",
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dispositions: [{ pluginId: "notes", action: "keep" }],
        }),
      },
    );
    expect(incomplete.status).toBe(422);
    expect(await json(incomplete)).toMatchObject({
      affectedPlugins: [
        { id: "notes", version: "1.0.0" },
        { id: "tasks", version: "1.0.0" },
      ],
    });

    const removed = await harness.app.request(
      "/api/v1/marketplaces/local-test",
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dispositions: [
            { pluginId: "notes", action: "keep" },
            { pluginId: "tasks", action: "uninstall" },
          ],
        }),
      },
    );
    expect(await json(removed)).toEqual({
      kept: ["notes"],
      uninstalled: ["tasks"],
    });
    expect(getInstalledPlugin(harness.db, "notes")).toMatchObject({
      provenance: "direct",
      marketplaceId: null,
      marketplaceEntryId: null,
      updatePolicy: "manual",
      sourcePath: join(marketplaceRoot, "notes"),
    });
    expect(getInstalledPlugin(harness.db, "tasks")).toBeUndefined();
  });

  it("refreshes a remote git catalog and reuses its validated artifact for a direct install", async () => {
    const pluginRepo = await mkdtemp(
      join(tmpdir(), "bb-marketplace-plugin-git-"),
    );
    const catalogRepo = await mkdtemp(
      join(tmpdir(), "bb-marketplace-catalog-git-"),
    );
    try {
      await writeManagedPlugin(pluginRepo, "bb-plugin-git-notes", "git-notes");
      await initRepo(pluginRepo);
      await commit(pluginRepo, "plugin");

      const writeCatalog = (displayName: string, description: string) =>
        writeFile(
          join(catalogRepo, "marketplace.json"),
          JSON.stringify({
            schemaVersion: 1,
            name: "remote-test",
            displayName,
            plugins: [
              {
                id: "git-notes",
                displayName: "Git Notes",
                description,
                source: { git: { url: pluginRepo, ref: "main" } },
              },
            ],
          }),
        );
      await writeCatalog("Remote Test", "Git source");
      await initRepo(catalogRepo);
      const firstCommit = await commit(catalogRepo, "catalog");

      const added = await harness.app.request("/api/v1/marketplaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: `file://${catalogRepo}@main` }),
      });
      expect(await json(added)).toMatchObject({
        marketplace: { id: "remote-test", resolvedCommit: firstCommit },
      });

      await writeCatalog("Remote Test Updated", "Updated catalog only");
      const secondCommit = await commit(catalogRepo, "refresh");
      const refreshed = await harness.app.request(
        "/api/v1/marketplaces/remote-test/refresh",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      expect(await json(refreshed)).toMatchObject({
        marketplace: {
          displayName: "Remote Test Updated",
          resolvedCommit: secondCommit,
        },
      });

      const marketplaceInstall = await harness.app.request(
        "/api/v1/plugins/install",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            marketplace: {
              marketplaceId: "remote-test",
              entryId: "git-notes",
            },
          }),
        },
      );
      expect(marketplaceInstall.status).toBe(200);
      expect(getInstalledPlugin(harness.db, "git-notes")).toMatchObject({
        provenance: "marketplace",
      });
      const artifact = listPluginArtifacts(harness.db, "git-notes")[0];
      expect(artifact).toMatchObject({ validationResult: "valid" });

      await harness.app.request("/api/v1/marketplaces/remote-test", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dispositions: [{ pluginId: "git-notes", action: "uninstall" }],
        }),
      });
      const directInstall = await harness.app.request(
        "/api/v1/plugins/install",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: `git:${pluginRepo}@main` }),
        },
      );
      expect(directInstall.status).toBe(200);
      expect(getInstalledPlugin(harness.db, "git-notes")).toMatchObject({
        provenance: "direct",
        activeArtifactId: artifact?.id,
      });
      expect(listPluginArtifacts(harness.db, "git-notes")).toHaveLength(1);
    } finally {
      await rm(pluginRepo, { recursive: true, force: true });
      await rm(catalogRepo, { recursive: true, force: true });
    }
  });
});
