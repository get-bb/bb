import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection, migrate, type DbConnection } from "@bb/db";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerPluginCatalogRoutes } from "../../../src/routes/plugin-catalog.js";
import { createPluginCatalogService } from "../../../src/services/plugin-catalog/plugin-catalog-service.js";
import { BUNDLED_OFFICIAL_MARKETPLACE } from "../../../src/services/plugin-catalog/official-marketplace.js";
import {
  BUILTIN_PLUGINS,
  BUNDLED_PLUGINS,
  OFFICIAL_PLUGINS,
} from "../../../src/services/plugins/builtin-registry.js";

const MANIFEST_URL = "https://marketplace.test/marketplace/v1/marketplace.json";
const SEED_ENTRY_COUNT = BUNDLED_OFFICIAL_MARKETPLACE.plugins.length;
const VALID_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h16v16H0z"/></svg>',
);

describe("plugin catalog routes", () => {
  let db: DbConnection;

  let dataDir: string;

  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    dataDir = await mkdtemp(join(tmpdir(), "bb-catalog-routes-"));
  });

  afterEach(async () => {
    db.$client.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  function catalogApp(
    fetchImpl?: Parameters<typeof createPluginCatalogService>[0]["fetch"],
  ) {
    const catalog = createPluginCatalogService({
      db,
      appVersion: "1.0.0",
      marketplaceUrl: MANIFEST_URL,
      dataDir,
      plugins: {
        installOfficialPlugin: async () => {
          throw new Error("unexpected install");
        },
        installCatalogPlugin: async () => {
          throw new Error("unexpected catalog install");
        },
      },
      ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
    });
    const app = new Hono();
    registerPluginCatalogRoutes(app, catalog);
    return { app, catalog };
  }

  it("serves status/search and validates install requests", async () => {
    const { app } = catalogApp();

    const status = await app.request("/plugin-catalog");
    await expect(status.json()).resolves.toMatchObject({
      catalog: {
        pluginCount: BUNDLED_PLUGINS.length + SEED_ENTRY_COUNT,
        includedPluginCount: BUILTIN_PLUGINS.length,
        optionalPluginCount: OFFICIAL_PLUGINS.length + SEED_ENTRY_COUNT,
      },
    });
    const search = await app.request("/plugin-catalog/search?q=memory");
    await expect(search.json()).resolves.toMatchObject({
      results: [{ entryId: "memory", installed: false }],
    });

    // Refreshes are server-owned (startup plus a six-hour interval); no route
    // lets a caller drive them.
    const refresh = await app.request("/plugin-catalog/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(refresh.status).toBe(404);

    const install = await app.request("/plugin-catalog/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entryId: "memory" }),
    });
    expect(install.status).toBe(422);
    await expect(install.json()).resolves.toMatchObject({
      error: expect.stringContaining("unexpected install"),
    });

    const versionOverride = await app.request("/plugin-catalog/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entryId: "memory", version: "0.2.0" }),
    });
    expect(versionOverride.status).toBe(422);
  });

  it("serves a cached icon with hash-gated caching and refuses unknown ones", async () => {
    const { app, catalog } = catalogApp(async (url) =>
      url === MANIFEST_URL
        ? new Response(
            JSON.stringify({
              schemaVersion: 1,
              name: "bb-official",
              displayName: "BB Official",
              plugins: [
                {
                  id: "widgets",
                  displayName: "Acme Widgets",
                  description: "Widgets for threads.",
                  icon: { url: "./icons/widgets.svg" },
                  author: { name: "Acme" },
                  source: {
                    git: {
                      url: "https://github.com/acme/plugins.git",
                      ref: "v1.0.0",
                    },
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        : new Response(VALID_SVG, { status: 200 }),
    );
    await catalog.refresh(1_000);
    const hash = catalog.icon("bb-official", "widgets")?.hash;
    expect(hash).toBeDefined();

    const hashed = await app.request(
      `/plugin-catalog/icons/bb-official/widgets?h=${hash}`,
    );
    expect(hashed.status).toBe(200);
    expect(hashed.headers.get("content-type")).toBe("image/svg+xml");
    expect(hashed.headers.get("cache-control")).toContain("immutable");
    expect(await hashed.text()).toBe(VALID_SVG.toString());

    const stale = await app.request(
      "/plugin-catalog/icons/bb-official/widgets?h=stale",
    );
    expect(stale.headers.get("cache-control")).toBe("no-store");

    const missing = await app.request(
      "/plugin-catalog/icons/bb-official/nothing",
    );
    expect(missing.status).toBe(404);
  });
});
