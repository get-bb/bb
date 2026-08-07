import { createConnection, migrate, type DbConnection } from "@bb/db";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerPluginCatalogRoutes } from "../../../src/routes/plugin-catalog.js";
import { createPluginCatalogService } from "../../../src/services/plugin-catalog/plugin-catalog-service.js";
import { BUNDLED_PLUGINS } from "../../../src/services/plugins/builtin-registry.js";

describe("plugin catalog routes", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
  });

  afterEach(() => db.$client.close());

  it("serves status/search and validates install requests", async () => {
    const catalog = createPluginCatalogService({
      db,
      appVersion: "1.0.0",
      plugins: {
        installOfficialPlugin: async () => {
          throw new Error("unexpected install");
        },
      },
    });
    const app = new Hono();
    registerPluginCatalogRoutes(app, catalog);

    const status = await app.request("/plugin-catalog");
    await expect(status.json()).resolves.toMatchObject({
      catalog: {
        pluginCount: BUNDLED_PLUGINS.length,
        includedPluginCount: BUNDLED_PLUGINS.filter(
          (plugin) => plugin.autoInstall,
        ).length,
        optionalPluginCount: BUNDLED_PLUGINS.filter(
          (plugin) => !plugin.autoInstall,
        ).length,
      },
    });
    const search = await app.request("/plugin-catalog/search?q=memory");
    await expect(search.json()).resolves.toMatchObject({
      results: [{ entryId: "memory", installed: false }],
    });

    // The remote-catalog refresh route is gone: official plugins are bundled.
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
});
