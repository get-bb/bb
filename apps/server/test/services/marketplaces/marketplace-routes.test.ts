import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
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
import { createMarketplaceService } from "../../../src/services/marketplaces/marketplace-service.js";

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
      engines: { bb: ">=0.0.0", bbPluginSdk: ">=0.2.0" },
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
      marketplace: {
        id: "local-test",
        pluginCount: 3,
      },
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
    });
    expect(
      await json(
        await harness.app.request("/api/v1/marketplaces/search?q=searchable"),
      ),
    ).toMatchObject({ results: [{ entryId: "notes", installed: true }] });

    const removed = await harness.app.request(
      "/api/v1/marketplaces/local-test",
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(await json(removed)).toEqual({
      convertedPluginIds: ["notes", "tasks"],
    });
    expect(getInstalledPlugin(harness.db, "notes")).toMatchObject({
      provenance: "direct",
      marketplaceId: null,
      marketplaceEntryId: null,
      sourcePath: await realpath(join(marketplaceRoot, "notes")),
    });
    expect(getInstalledPlugin(harness.db, "tasks")).toMatchObject({
      provenance: "direct",
      marketplaceId: null,
      marketplaceEntryId: null,
    });
  });

  it("refuses a marketplace-path frontend reinstall before touching its registration or built files", async () => {
    const pluginRoot = join(marketplaceRoot, "frontend");
    await writePlugin(pluginRoot, "bb-plugin-marketplace-frontend", marker);
    await writeFile(
      join(pluginRoot, "package.json"),
      JSON.stringify({
        name: "bb-plugin-marketplace-frontend",
        version: "1.0.0",
        engines: { bb: ">=0.0.0", bbPluginSdk: ">=0.2.0" },
        bb: { server: "./server.js", app: "./app.tsx" },
      }),
    );
    await writeFile(
      join(pluginRoot, "app.tsx"),
      'export default function App() { return <div className="line-clamp-2">before</div>; }\n',
    );
    await writeFile(
      join(marketplaceRoot, "marketplace.json"),
      JSON.stringify({
        schemaVersion: 1,
        name: "frontend-test",
        displayName: "Frontend Test",
        plugins: [
          {
            id: "marketplace-frontend",
            displayName: "Marketplace Frontend",
            description: "Frontend reinstall safety fixture",
            source: { path: "frontend" },
          },
        ],
      }),
    );

    const added = await harness.app.request("/api/v1/marketplaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: marketplaceRoot }),
    });
    expect(added.status).toBe(201);

    const installBody = JSON.stringify({
      marketplace: {
        marketplaceId: "frontend-test",
        entryId: "marketplace-frontend",
      },
    });
    const installed = await harness.app.request("/api/v1/plugins/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: installBody,
    });
    expect(installed.status).toBe(200);

    const registrationBefore = getInstalledPlugin(
      harness.db,
      "marketplace-frontend",
    );
    expect(registrationBefore).toBeDefined();
    const bundleBefore = harness.pluginService
      .list()
      .find((plugin) => plugin.id === "marketplace-frontend")?.app.bundle;
    expect(bundleBefore).not.toBeNull();
    const builtPaths = [
      join(pluginRoot, "dist", "app.js"),
      join(pluginRoot, "dist", "app.css"),
      join(pluginRoot, "dist", "app.meta.json"),
    ];
    const builtBytesBefore = await Promise.all(
      builtPaths.map((path) => readFile(path)),
    );

    await writeFile(
      join(pluginRoot, "app.tsx"),
      'export default function App() { return <div className="line-clamp-3">after</div>; }\n',
    );
    const refused = await harness.app.request("/api/v1/plugins/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: installBody,
    });
    expect(refused.status).toBe(422);
    expect(await json(refused)).toMatchObject({
      error: expect.stringContaining("bb plugin update marketplace-frontend"),
    });

    expect(getInstalledPlugin(harness.db, "marketplace-frontend")).toEqual(
      registrationBefore,
    );
    expect(
      harness.pluginService
        .list()
        .find((plugin) => plugin.id === "marketplace-frontend")?.app.bundle,
    ).toEqual(bundleBefore);
    await expect(
      Promise.all(builtPaths.map((path) => readFile(path))),
    ).resolves.toEqual(builtBytesBefore);
  }, 120_000);

  it("refreshes a remote git catalog and preserves its artifact when removal converts provenance", async () => {
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
      expect(await json(marketplaceInstall)).toMatchObject({
        plugin: {
          provenance: "marketplace",
          marketplaceName: "Remote Test Updated",
          sourceDisplay: expect.stringContaining("git ·"),
          updateState: {},
        },
      });
      expect(getInstalledPlugin(harness.db, "git-notes")).toMatchObject({
        provenance: "marketplace",
      });
      const artifact = listPluginArtifacts(harness.db, "git-notes")[0];
      expect(artifact).toMatchObject({ validationResult: "valid" });

      await harness.app.request("/api/v1/marketplaces/remote-test", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const directInstall = await harness.app.request(
        "/api/v1/plugins/install",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: `git:${pluginRepo}@main` }),
        },
      );
      expect(directInstall.status).toBe(422);
      expect(await json(directInstall)).toMatchObject({
        error: expect.stringContaining("bb plugin update git-notes"),
      });
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

  it("rejects an explicit traversal name before materialization or cache writes", async () => {
    const catalogRepo = await mkdtemp(
      join(tmpdir(), "bb-marketplace-name-traversal-"),
    );
    try {
      await writeFile(
        join(catalogRepo, "marketplace.json"),
        JSON.stringify({
          schemaVersion: 1,
          name: "safe-name",
          displayName: "Safe Name",
          plugins: [],
        }),
      );
      await initRepo(catalogRepo);
      await commit(catalogRepo, "catalog");
      const injectedRoot = join(
        harness.config.dataDir,
        "plugins",
        "cache",
        "injected",
      );
      const response = await harness.app.request("/api/v1/marketplaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: `file://${catalogRepo}@main`,
          name: "../../plugins/cache/injected",
        }),
      });
      expect(response.status).toBe(422);
      expect(await json(response)).toMatchObject({
        error: expect.stringMatching(/invalid marketplace name/),
      });
      await expect(stat(injectedRoot)).rejects.toThrow();
    } finally {
      await rm(catalogRepo, { recursive: true, force: true });
    }
  });

  it("rejects a git plugin subdir symlink that resolves outside its checkout", async () => {
    const pluginRepo = await mkdtemp(
      join(tmpdir(), "bb-marketplace-subdir-git-"),
    );
    const outside = await mkdtemp(
      join(tmpdir(), "bb-marketplace-subdir-outside-"),
    );
    const catalogRoot = await mkdtemp(
      join(tmpdir(), "bb-marketplace-subdir-catalog-"),
    );
    try {
      await writeManagedPlugin(
        outside,
        "bb-plugin-subdir-escape",
        "subdir-escape",
      );
      await symlink(outside, join(pluginRepo, "escape"));
      await initRepo(pluginRepo);
      await commit(pluginRepo, "escaping subdir");
      await writeFile(
        join(catalogRoot, "marketplace.json"),
        JSON.stringify({
          schemaVersion: 1,
          name: "subdir-test",
          displayName: "Subdir Test",
          plugins: [
            {
              id: "subdir-escape",
              displayName: "Subdir Escape",
              description: "Must not load",
              source: {
                git: { url: pluginRepo, ref: "main", subdir: "escape" },
              },
            },
          ],
        }),
      );
      const added = await harness.app.request("/api/v1/marketplaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: catalogRoot }),
      });
      expect(added.status).toBe(201);
      const installed = await harness.app.request("/api/v1/plugins/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplace: {
            marketplaceId: "subdir-test",
            entryId: "subdir-escape",
          },
        }),
      });
      expect(installed.status).toBe(422);
      expect(await json(installed)).toMatchObject({
        error: expect.stringMatching(/resolves outside its root/),
      });
      await expect(stat(join(outside, "loaded.marker"))).rejects.toThrow();
    } finally {
      await rm(pluginRepo, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
      await rm(catalogRoot, { recursive: true, force: true });
    }
  });

  it("rejects a local path entry symlink before persisting its marketplace", async () => {
    const outside = await mkdtemp(
      join(tmpdir(), "bb-marketplace-path-outside-"),
    );
    try {
      await writePlugin(
        outside,
        "bb-plugin-path-escape",
        join(outside, "loaded.marker"),
      );
      await symlink(outside, join(marketplaceRoot, "escape"));
      await writeFile(
        join(marketplaceRoot, "marketplace.json"),
        JSON.stringify({
          schemaVersion: 1,
          name: "path-symlink-test",
          displayName: "Path Symlink Test",
          plugins: [
            {
              id: "path-escape",
              displayName: "Path Escape",
              description: "Must not load",
              source: { path: "escape" },
            },
          ],
        }),
      );
      const response = await harness.app.request("/api/v1/marketplaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: marketplaceRoot }),
      });
      expect(response.status).toBe(422);
      expect(await json(response)).toMatchObject({
        error: expect.stringMatching(/resolves outside its root/),
      });
      expect(getMarketplace(harness.db, "path-symlink-test")).toBeUndefined();
      await expect(stat(join(outside, "loaded.marker"))).rejects.toThrow();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("serializes concurrent refreshes for one marketplace", async () => {
    let blockRefresh = false;
    let materializations = 0;
    let totalMaterializations = 0;
    let releaseFirst = (): void => {};
    let markFirstEntered = (): void => {};
    const firstEntered = new Promise<void>((resolvePromise) => {
      markFirstEntered = resolvePromise;
    });
    const firstGate = new Promise<void>((resolvePromise) => {
      releaseFirst = resolvePromise;
    });
    const service = createMarketplaceService({
      db: harness.db,
      dataDir: harness.config.dataDir,
      appVersion: harness.config.appVersion,
      plugins: harness.pluginService,
      beforeMaterialize: async ({ idHint }) => {
        totalMaterializations += 1;
        if (!blockRefresh || idHint !== "serialized-test") return;
        materializations += 1;
        if (materializations === 1) {
          markFirstEntered();
          await firstGate;
        }
      },
    });
    await service.add(marketplaceRoot, "serialized-test");
    expect(totalMaterializations).toBe(1);
    await expect(
      service.add("/definitely/missing/marketplace", "serialized-test"),
    ).rejects.toThrow(/already exists/);
    expect(totalMaterializations).toBe(1);
    blockRefresh = true;
    const first = service.refresh("serialized-test");
    await firstEntered;
    const second = service.refresh("serialized-test");
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 20));
    expect(materializations).toBe(1);
    releaseFirst();
    await Promise.all([first, second]);
    expect(materializations).toBe(2);
  });

  it("orders install before removal and never leaves orphaned provenance", async () => {
    let releaseInstall = (): void => {};
    let markInstallEntered = (): void => {};
    const installEntered = new Promise<void>((resolvePromise) => {
      markInstallEntered = resolvePromise;
    });
    const installGate = new Promise<void>((resolvePromise) => {
      releaseInstall = resolvePromise;
    });
    const originalInstall = harness.pluginService.installFromMarketplace.bind(
      harness.pluginService,
    );
    const service = createMarketplaceService({
      db: harness.db,
      dataDir: harness.config.dataDir,
      appVersion: harness.config.appVersion,
      plugins: {
        ...harness.pluginService,
        async installFromMarketplace(args) {
          markInstallEntered();
          await installGate;
          return originalInstall(args);
        },
      },
    });
    await service.add(marketplaceRoot, "install-remove-test");
    const install = service.install("install-remove-test", "notes");
    await installEntered;
    const removal = service.remove("install-remove-test");
    let removalSettled = false;
    void removal.then(
      () => {
        removalSettled = true;
      },
      () => {
        removalSettled = true;
      },
    );
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 20));
    expect(removalSettled).toBe(false);
    releaseInstall();
    await install;
    await expect(removal).resolves.toEqual({ convertedPluginIds: ["notes"] });
    expect(getMarketplace(harness.db, "install-remove-test")).toBeUndefined();
    expect(getInstalledPlugin(harness.db, "notes")).toMatchObject({
      provenance: "direct",
      marketplaceId: null,
    });
  });
});
