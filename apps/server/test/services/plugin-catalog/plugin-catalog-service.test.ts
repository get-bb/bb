import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createConnection,
  getPluginMarketplace,
  markInstalledPluginRemoved,
  migrate,
  upsertInstalledPlugin,
  type DbConnection,
} from "@bb/db";
import { ROOT_PLUGIN_SOURCE_SELECTION } from "@bb/server-contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPluginCatalogService } from "../../../src/services/plugin-catalog/plugin-catalog-service.js";
import type { MarketplaceFetch } from "../../../src/services/plugin-catalog/marketplace-http.js";
import { BUNDLED_OFFICIAL_MARKETPLACE } from "../../../src/services/plugin-catalog/official-marketplace.js";
import {
  BUILTIN_PLUGINS,
  BUNDLED_PLUGINS,
  OFFICIAL_PLUGINS,
  PLUGIN_CATALOG_CATEGORIES,
  listBundledPluginRegistrations,
} from "../../../src/services/plugins/builtin-registry.js";

const MANIFEST_URL = "https://marketplace.test/marketplace/v1/marketplace.json";
const ICON_URL = "https://marketplace.test/marketplace/v1/icons/widgets.svg";
const SEED_ENTRY_COUNT = BUNDLED_OFFICIAL_MARKETPLACE.plugins.length;

const VALID_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>',
);

function remoteEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "widgets",
    displayName: "Acme Widgets",
    description: "Widgets for threads.",
    icon: { url: "./icons/widgets.svg" },
    tags: ["interface", "widgets"],
    author: { name: "Acme", github: "acme" },
    engines: { bb: ">=0.0.1" },
    source: {
      git: {
        url: "https://github.com/acme/plugins.git",
        subdir: "plugins/widgets",
        ref: "v1.0.0",
      },
    },
    ...overrides,
  };
}

function manifest(plugins: unknown[]): unknown {
  return {
    schemaVersion: 1,
    name: "bb-official",
    displayName: "BB Official",
    plugins,
  };
}

function jsonResponse(
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("plugin catalog service", () => {
  let db: DbConnection;
  let installedNames: string[];
  let installedCatalogEntries: unknown[];

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
    installedNames = [];
    installedCatalogEntries = [];
  });

  afterEach(() => db.$client.close());

  function service(options?: {
    bundledPlugins?: Parameters<
      typeof createPluginCatalogService
    >[0]["bundledPlugins"];
    fetch?: MarketplaceFetch;
    warn?: (message: string) => void;
  }) {
    return createPluginCatalogService({
      db,
      appVersion: "1.0.0",
      marketplaceUrl: MANIFEST_URL,
      plugins: {
        installOfficialPlugin: async (name: string) => {
          installedNames.push(name);
          throw new Error("installation stopped by test");
        },
        installCatalogPlugin: async (args: unknown) => {
          installedCatalogEntries.push(args);
          throw new Error("catalog installation stopped by test");
        },
      },
      ...(options?.bundledPlugins === undefined
        ? {}
        : { bundledPlugins: options.bundledPlugins }),
      ...(options?.fetch === undefined ? {} : { fetch: options.fetch }),
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
      provenance: {
        kind: "catalog",
        marketplace: "bb-official",
        entryId: args.name,
      },
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

  it("lists bundled plugins and the seeded official catalog", async () => {
    const catalog = service();
    expect(catalog.status()).toEqual({
      pluginCount: BUNDLED_PLUGINS.length + SEED_ENTRY_COUNT,
      includedPluginCount: BUILTIN_PLUGINS.length,
      optionalPluginCount: OFFICIAL_PLUGINS.length + SEED_ENTRY_COUNT,
    });

    const results = await catalog.search("");
    expect(results.map((entry) => entry.entryId).sort()).toEqual(
      [
        ...BUNDLED_PLUGINS.map((plugin) => plugin.name),
        ...BUNDLED_OFFICIAL_MARKETPLACE.plugins.map((entry) => entry.id),
      ].sort(),
    );
    const docs = results.find((entry) => entry.entryId === "docs");
    expect(docs).toMatchObject({
      pluginId: "simple-notes",
      displayName: "Docs",
      icon: "FileText",
      iconUrl: null,
      category: "Context & knowledge",
      source: "builtin:docs",
      installed: false,
      compatible: true,
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

  it("groups a catalog entry by its curated tag", async () => {
    const catalog = service();
    const [hoverCards] = await catalog.search("thread-hover-cards");
    expect(hoverCards).toMatchObject({
      entryId: "thread-hover-cards",
      pluginId: "thread-hover-cards",
      category: "Interface",
      icon: "ZoomIn",
      iconUrl: null,
      source:
        "git:https://github.com/brsbl/bb-plugins.git@30f91fd977ba1ce60532af27a68534464fb62516",
      installed: false,
      compatible: true,
    });
  });

  it("matches queries against entry id, plugin id, manifest text, and tags", async () => {
    const catalog = service();
    expect(
      (await catalog.search("docs")).map((entry) => entry.entryId),
    ).toContain("docs");
    // The docs directory installs under the plugin id "simple-notes".
    expect(
      (await catalog.search("simple-notes")).map((entry) => entry.entryId),
    ).toEqual(["docs"]);
    expect(
      (await catalog.search("sidebar")).map((entry) => entry.entryId),
    ).toContain("thread-hover-cards");
    expect(await catalog.search("no-such-plugin")).toEqual([]);
  });

  it("reflects install and remove in the installed flag", async () => {
    const catalog = service();
    registerInstalledOfficial({ pluginId: "simple-notes", name: "docs" });
    expect((await catalog.search("docs"))[0]?.installed).toBe(true);

    markInstalledPluginRemoved(db, "simple-notes");
    expect((await catalog.search("docs"))[0]?.installed).toBe(false);
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
          category: "Developer tools",
          rootDir: missingRoot,
        },
      ],
      warn: (message) => warnings.push(message),
    });
    const results = await catalog.search("");
    expect(results.map((entry) => entry.entryId)).not.toContain("broken");
    expect(results.map((entry) => entry.entryId)).toContain("github");
    expect(warnings.some((warning) => warning.includes("broken"))).toBe(true);
  });

  describe("refresh", () => {
    it("replaces the catalog, caches icons, and revalidates with the ETag", async () => {
      const requests: Array<{ url: string; headers: Headers }> = [];
      const fetchImpl: MarketplaceFetch = async (url, init) => {
        requests.push({ url, headers: new Headers(init.headers) });
        if (url === MANIFEST_URL) {
          return requests.filter((request) => request.url === MANIFEST_URL)
            .length === 1
            ? jsonResponse(manifest([remoteEntry()]), { etag: '"v1"' })
            : new Response(null, { status: 304 });
        }
        return new Response(VALID_SVG, {
          status: 200,
          headers: { "content-type": "image/svg+xml", etag: '"icon-1"' },
        });
      };
      const catalog = service({ fetch: fetchImpl });

      await catalog.refresh(1_000);
      const results = await catalog.search("widgets");
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        entryId: "widgets",
        displayName: "Acme Widgets",
        category: "Interface",
        icon: null,
        source:
          "git:https://github.com/acme/plugins.git@v1.0.0#plugins/widgets",
      });
      expect(results[0]?.iconUrl).toBe(
        "/api/v1/plugin-catalog/icons/bb-official/widgets?h=" +
          catalog.icon("bb-official", "widgets")?.hash,
      );
      expect(catalog.icon("bb-official", "widgets")).toMatchObject({
        contentType: "image/svg+xml",
      });
      // The seeded entries are gone: the published manifest is authoritative.
      expect((await catalog.search("thread-hover-cards")).length).toBe(0);
      expect(requests[1]?.url).toBe(ICON_URL);

      await catalog.refresh(2_000);
      const conditional = requests.filter(
        (request) => request.url === MANIFEST_URL,
      )[1];
      expect(conditional?.headers.get("if-none-match")).toBe('"v1"');
      // A 304 keeps the stored catalog and does not re-read the icon.
      expect((await catalog.search("widgets"))[0]?.displayName).toBe(
        "Acme Widgets",
      );
      expect(
        requests.filter((request) => request.url === ICON_URL),
      ).toHaveLength(1);
      const row = getPluginMarketplace(db, "bb-official");
      expect(row).toMatchObject({
        etag: '"v1"',
        lastSuccessfulRefreshAt: 2_000,
        lastError: null,
      });
    });

    it("keeps the last-known-good catalog when the payload is invalid", async () => {
      const catalog = service({
        fetch: async () =>
          jsonResponse(manifest([remoteEntry({ id: "Not Valid" })])),
      });
      await expect(catalog.refresh(5_000)).rejects.toThrow(
        /invalid marketplace manifest/,
      );
      expect((await catalog.search("thread-hover-cards")).length).toBe(1);
      expect(getPluginMarketplace(db, "bb-official")).toMatchObject({
        lastAttemptedRefreshAt: 5_000,
        lastSuccessfulRefreshAt: null,
      });
      expect(getPluginMarketplace(db, "bb-official")?.lastError).toMatch(
        /invalid marketplace manifest/,
      );
    });

    it("keeps the last-known-good catalog when the request fails", async () => {
      const catalog = service({
        fetch: async () => new Response("nope", { status: 503 }),
      });
      await expect(catalog.refresh(7_000)).rejects.toThrow("HTTP 503");
      expect((await catalog.search("")).length).toBe(
        BUNDLED_PLUGINS.length + SEED_ENTRY_COUNT,
      );
      expect(getPluginMarketplace(db, "bb-official")?.lastError).toContain(
        "HTTP 503",
      );
    });

    it("refuses a manifest published under another marketplace name", async () => {
      const catalog = service({
        fetch: async () =>
          jsonResponse({
            ...(manifest([remoteEntry()]) as Record<string, unknown>),
            name: "someone-else",
          }),
      });
      await expect(catalog.refresh(9_000)).rejects.toThrow(/someone-else/);
      expect((await catalog.search("widgets")).length).toBe(0);
    });

    it("falls back to the bundled snapshot when the stored catalog is unreadable", async () => {
      service();
      const stored = getPluginMarketplace(db, "bb-official");
      if (stored === undefined) throw new Error("catalog row missing");
      db.$client
        .prepare("UPDATE plugin_marketplaces SET manifest_json = ?")
        .run("{not json");
      const warnings: string[] = [];
      const catalog = service({ warn: (message) => warnings.push(message) });
      expect((await catalog.search("thread-hover-cards")).length).toBe(1);
      expect(warnings.some((warning) => warning.includes("bundled"))).toBe(
        true,
      );
    });

    it("keeps an entry whose icon fails validation and warns", async () => {
      const warnings: string[] = [];
      const catalog = service({
        warn: (message) => warnings.push(message),
        fetch: async (url) =>
          url === MANIFEST_URL
            ? jsonResponse(manifest([remoteEntry()]))
            : new Response(Buffer.from("<html>not an icon</html>"), {
                status: 200,
              }),
      });
      await catalog.refresh(1_000);
      const [entry] = await catalog.search("widgets");
      expect(entry).toMatchObject({ entryId: "widgets", iconUrl: null });
      expect(catalog.icon("bb-official", "widgets")).toBeUndefined();
      expect(warnings.some((warning) => warning.includes("widgets"))).toBe(
        true,
      );
    });

    it("refuses an icon larger than the cap", async () => {
      const warnings: string[] = [];
      const catalog = service({
        warn: (message) => warnings.push(message),
        fetch: async (url) =>
          url === MANIFEST_URL
            ? jsonResponse(manifest([remoteEntry()]))
            : new Response(Buffer.alloc(300 * 1024, 0x41), { status: 200 }),
      });
      await catalog.refresh(1_000);
      expect(catalog.icon("bb-official", "widgets")).toBeUndefined();
      expect(
        warnings.some((warning) => warning.includes("exceeds 262144 bytes")),
      ).toBe(true);
    });

    it("keeps cached icons while retrying a missing one on a 304", async () => {
      let iconRequests = 0;
      let failFirstIcon = true;
      const catalog = service({
        warn: () => {},
        fetch: async (url) => {
          if (url === MANIFEST_URL) {
            return iconRequests === 0
              ? jsonResponse(
                  manifest([
                    remoteEntry(),
                    remoteEntry({
                      id: "gadgets",
                      icon: { url: "./icons/gadgets.svg" },
                    }),
                  ]),
                  { etag: '"v1"' },
                )
              : new Response(null, { status: 304 });
          }
          iconRequests += 1;
          if (url.endsWith("gadgets.svg") && failFirstIcon) {
            failFirstIcon = false;
            return new Response("boom", { status: 500 });
          }
          return new Response(VALID_SVG, { status: 200 });
        },
      });
      await catalog.refresh(1_000);
      expect(catalog.icon("bb-official", "widgets")).toBeDefined();
      expect(catalog.icon("bb-official", "gadgets")).toBeUndefined();

      await catalog.refresh(2_000);
      // The cached icon survives the unchanged manifest; the failed one retries.
      expect(catalog.icon("bb-official", "widgets")).toBeDefined();
      expect(catalog.icon("bb-official", "gadgets")).toBeDefined();
    });

    it("drops a cached icon the refreshed manifest no longer lists", async () => {
      let listIcon = true;
      const catalog = service({
        fetch: async (url) =>
          url === MANIFEST_URL
            ? jsonResponse(
                manifest([
                  listIcon ? remoteEntry() : remoteEntry({ icon: "Zap" }),
                ]),
              )
            : new Response(VALID_SVG, { status: 200 }),
      });
      await catalog.refresh(1_000);
      expect(catalog.icon("bb-official", "widgets")).toBeDefined();
      listIcon = false;
      await catalog.refresh(2_000);
      expect(catalog.icon("bb-official", "widgets")).toBeUndefined();
    });

    it("drops a cached icon when its replacement URL fails", async () => {
      let iconUrl = "./icons/widgets.svg";
      const catalog = service({
        warn: () => {},
        fetch: async (url) => {
          if (url === MANIFEST_URL) {
            return jsonResponse(
              manifest([remoteEntry({ icon: { url: iconUrl } })]),
            );
          }
          return url.endsWith("widgets.svg")
            ? new Response(VALID_SVG, { status: 200 })
            : new Response("nope", { status: 503 });
        },
      });
      await catalog.refresh(1_000);
      expect(catalog.icon("bb-official", "widgets")).toBeDefined();

      iconUrl = "./icons/replacement.svg";
      await catalog.refresh(2_000);
      expect(catalog.icon("bb-official", "widgets")).toBeUndefined();
    });

    it("keeps the prior snapshot when an icon-table commit fails", async () => {
      db.$client.exec(`
        CREATE TRIGGER reject_marketplace_icon
        BEFORE INSERT ON plugin_marketplace_icons
        BEGIN
          SELECT RAISE(ABORT, 'icon write failed');
        END;
      `);
      const catalog = service({
        fetch: async (url) =>
          url === MANIFEST_URL
            ? jsonResponse(manifest([remoteEntry()]))
            : new Response(VALID_SVG, { status: 200 }),
      });

      await expect(catalog.refresh(3_000)).rejects.toThrow("icon write failed");
      expect(await catalog.search("widgets")).toEqual([]);
      expect(await catalog.search("thread-hover-cards")).toHaveLength(1);
      expect(getPluginMarketplace(db, "bb-official")).toMatchObject({
        lastSuccessfulRefreshAt: null,
        lastAttemptedRefreshAt: 3_000,
        lastError: expect.stringContaining("icon write failed"),
      });
    });
  });

  describe("catalog installs", () => {
    async function refreshedCatalog(entry: Record<string, unknown>) {
      const catalog = service({
        fetch: async (url) =>
          url === MANIFEST_URL
            ? jsonResponse(manifest([entry]))
            : new Response(VALID_SVG, { status: 200 }),
      });
      await catalog.refresh(1_000);
      return catalog;
    }

    it("routes a subdirectory entry through the install pipeline", async () => {
      const catalog = await refreshedCatalog(remoteEntry());
      await expect(catalog.install("widgets")).rejects.toThrow(
        "catalog installation stopped by test",
      );
      expect(installedCatalogEntries).toEqual([
        {
          marketplace: "bb-official",
          entryId: "widgets",
          pluginId: "widgets",
          source: "git:https://github.com/acme/plugins.git@v1.0.0",
          selection: { kind: "subdirectory", path: "plugins/widgets" },
          engines: { bb: ">=0.0.1" },
        },
      ]);
      expect(installedNames).toEqual([]);
    });

    it("routes an npm entry with its dist-tag and registry", async () => {
      const catalog = await refreshedCatalog(
        remoteEntry({
          icon: "Zap",
          source: {
            npm: {
              package: "bb-plugin-widgets",
              tag: "beta",
              registry: "https://npm.acme.test",
            },
          },
        }),
      );
      await expect(catalog.install("widgets")).rejects.toThrow(
        "catalog installation stopped by test",
      );
      expect(installedCatalogEntries).toEqual([
        {
          marketplace: "bb-official",
          entryId: "widgets",
          pluginId: "widgets",
          source: "npm:bb-plugin-widgets@beta",
          selection: ROOT_PLUGIN_SOURCE_SELECTION,
          engines: { bb: ">=0.0.1" },
          npmRegistry: "https://npm.acme.test",
        },
      ]);
    });

    it("refuses an entry this bb build cannot run", async () => {
      const catalog = await refreshedCatalog(
        remoteEntry({ icon: "Zap", engines: { bb: ">=99.0.0" } }),
      );
      const [entry] = await catalog.search("widgets");
      expect(entry).toMatchObject({
        compatible: false,
        incompatibleReason: expect.stringContaining(">=99.0.0"),
      });
      await expect(catalog.install("widgets")).rejects.toThrow(
        /install refused/,
      );
      expect(installedCatalogEntries).toEqual([]);
    });

    it("reads the installed flag from catalog provenance", async () => {
      const catalog = service();
      upsertInstalledPlugin(db, {
        id: "hover-cards",
        source:
          "git:https://github.com/brsbl/bb-plugins.git@30f91fd977ba1ce60532af27a68534464fb62516",
        provenance: {
          kind: "catalog",
          marketplace: "bb-official",
          entryId: "thread-hover-cards",
        },
        sourceIntent: {
          kind: "git",
          url: "https://github.com/brsbl/bb-plugins.git",
          subdirectory: null,
          requestedRef: "30f91fd977ba1ce60532af27a68534464fb62516",
          refKind: "commit",
        },
        exactResolution: {
          kind: "git",
          commit: "30f91fd977ba1ce60532af27a68534464fb62516",
        },
        updateState: {
          lastCheckAt: null,
          availableCompatibleVersion: null,
          newestIncompatibleVersion: null,
          statusDetail: null,
        },
        activeArtifactId: null,
        rootDir: "/managed/thread-hover-cards",
        version: "0.1.0",
        enabled: true,
      });
      expect((await catalog.search("thread-hover-cards"))[0]?.installed).toBe(
        true,
      );
    });
  });
});
