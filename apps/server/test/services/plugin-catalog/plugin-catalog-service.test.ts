import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createConnection,
  markInstalledPluginRemoved,
  migrate,
  upsertInstalledPlugin,
  type DbConnection,
} from "@bb/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPluginCatalogService } from "../../../src/services/plugin-catalog/plugin-catalog-service.js";
import {
  BUILTIN_PLUGINS,
  BUNDLED_PLUGINS,
  OFFICIAL_PLUGINS,
  PLUGIN_CATALOG_CATEGORIES,
  listBundledPluginRegistrations,
} from "../../../src/services/plugins/builtin-registry.js";

describe("bundled plugin catalog service", () => {
  let db: DbConnection;
  let installedNames: string[];

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
    installedNames = [];
  });

  afterEach(() => db.$client.close());

  function service(options?: {
    bundledPlugins?: Parameters<
      typeof createPluginCatalogService
    >[0]["bundledPlugins"];
    warn?: (message: string) => void;
  }) {
    return createPluginCatalogService({
      db,
      appVersion: "1.0.0",
      plugins: {
        installOfficialPlugin: async (name: string) => {
          installedNames.push(name);
          throw new Error("installation stopped by test");
        },
      },
      ...(options?.bundledPlugins === undefined
        ? {}
        : { bundledPlugins: options.bundledPlugins }),
      ...(options?.warn === undefined ? {} : { warn: options.warn }),
    });
  }

  function registerInstalledOfficial(args: {
    pluginId: string;
    name: string;
  }): void {
    upsertInstalledPlugin(db, {
      id: args.pluginId,
      source: `builtin:${args.name}`,
      provenance: { kind: "catalog", entryId: args.name },
      sourceIntent: { kind: "builtin", name: args.name },
      exactResolution: { kind: "builtin" },
      updateState: {
        lastCheckAt: null,
        availableCompatibleVersion: null,
        newestIncompatibleVersion: null,
        statusDetail: null,
      },
      activeArtifactId: null,
      rootDir: `/bundled/${args.name}`,
      version: "0.0.1",
      enabled: true,
    });
  }

  it("lists every bundled official plugin from its manifest", async () => {
    const catalog = service();
    expect(catalog.status()).toEqual({
      pluginCount: BUNDLED_PLUGINS.length,
      includedPluginCount: BUILTIN_PLUGINS.length,
      optionalPluginCount: OFFICIAL_PLUGINS.length,
    });

    const results = await catalog.search("");
    expect(results.map((entry) => entry.entryId).sort()).toEqual(
      BUNDLED_PLUGINS.map((plugin) => plugin.name).sort(),
    );
    expect(results).toHaveLength(catalog.status().pluginCount);
    expect(results.some((entry) => entry.category === "Included with BB")).toBe(
      false,
    );
    expect([...new Set(results.map((entry) => entry.category))]).toEqual(
      PLUGIN_CATALOG_CATEGORIES,
    );
    const docs = results.find((entry) => entry.entryId === "docs");
    expect(docs).toMatchObject({
      pluginId: "simple-notes",
      displayName: "Docs",
      icon: "FileText",
      category: "Context & knowledge",
      source: "builtin:docs",
      installed: false,
      compatible: true,
      incompatibleReason: null,
    });
    for (const category of PLUGIN_CATALOG_CATEGORIES) {
      const categoryNames = results
        .filter((entry) => entry.category === category)
        .map((entry) => entry.displayName);
      expect(categoryNames).toEqual(
        [...categoryNames].sort((a, b) => a.localeCompare(b)),
      );
    }
  });

  it("matches queries against entry id, plugin id, and manifest text", async () => {
    const catalog = service();
    const byEntryId = await catalog.search("docs");
    expect(byEntryId.map((entry) => entry.entryId)).toContain("docs");
    // The docs directory installs under the plugin id "simple-notes".
    const byPluginId = await catalog.search("simple-notes");
    expect(byPluginId.map((entry) => entry.entryId)).toEqual(["docs"]);
    expect(await catalog.search("no-such-plugin")).toEqual([]);
  });

  it("reflects install and remove in the installed flag", async () => {
    const catalog = service();
    registerInstalledOfficial({ pluginId: "simple-notes", name: "docs" });
    let docs = (await catalog.search("docs"))[0];
    expect(docs?.installed).toBe(true);

    markInstalledPluginRemoved(db, "simple-notes");
    docs = (await catalog.search("docs"))[0];
    expect(docs?.installed).toBe(false);
  });

  it("delegates install to the plugin service by bundled name", async () => {
    const catalog = service();
    await expect(catalog.install("docs")).rejects.toThrow(
      "installation stopped by test",
    );
    expect(installedNames).toEqual(["docs"]);
  });

  it("rejects unknown catalog entries", async () => {
    const catalog = service();
    await expect(catalog.install("does-not-exist")).rejects.toThrow(
      'unknown plugin catalog entry "does-not-exist"',
    );
  });

  it("drops entries whose bundled manifest is unreadable", async () => {
    const missingRoot = await mkdtemp(join(tmpdir(), "bb-missing-plugin-"));
    await rm(missingRoot, { recursive: true, force: true });
    const warnings: string[] = [];
    const [github] = listBundledPluginRegistrations().filter(
      (plugin) => plugin.name === "github",
    );
    if (github === undefined) throw new Error("github registration missing");
    const catalog = service({
      bundledPlugins: [
        github,
        {
          name: "broken",
          pluginId: "broken",
          autoInstall: false,
          defaultEnabled: true,
          category: "Productivity",
          rootDir: missingRoot,
        },
      ],
      warn: (message) => warnings.push(message),
    });
    const results = await catalog.search("");
    expect(results.map((entry) => entry.entryId)).toEqual(["github"]);
    expect(warnings.some((warning) => warning.includes("broken"))).toBe(true);
  });
});
