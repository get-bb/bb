import { createConnection, migrate, type DbConnection } from "@bb/db";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPluginCatalogRoutes } from "../../../src/routes/plugin-catalog.js";
import { createPluginCatalogService } from "../../../src/services/plugin-catalog/plugin-catalog-service.js";
import { BUNDLED_PLUGIN_CATALOG } from "../../../src/services/plugin-catalog/official-catalog.js";

function response(body: BodyInit | null, init?: ResponseInit): Response {
  return new Response(body, init);
}

describe("plugin catalog routes", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
  });

  afterEach(() => db.$client.close());

  it("serves status/search and validates refresh/install requests", async () => {
    const catalog = createPluginCatalogService({
      db,
      appVersion: "1.0.0",
      plugins: {
        isEnabled: () => false,
        installFromCatalog: async () => {
          throw new Error("unexpected install");
        },
      },
      notifyCatalogChanged: vi.fn(),
      fetch: async () => response(JSON.stringify(BUNDLED_PLUGIN_CATALOG)),
    });
    const app = new Hono();
    registerPluginCatalogRoutes(app, catalog);

    const status = await app.request("/plugin-catalog");
    await expect(status.json()).resolves.toMatchObject({
      catalog: { pluginCount: 3 },
    });
    const search = await app.request("/plugin-catalog/search?q=memory");
    await expect(search.json()).resolves.toMatchObject({
      results: [{ entryId: "memory", installed: false }],
    });

    const invalidRefresh = await app.request("/plugin-catalog/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unexpected: true }),
    });
    expect(invalidRefresh.status).toBe(422);
    const refresh = await app.request("/plugin-catalog/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(refresh.status).toBe(200);

    const install = await app.request("/plugin-catalog/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entryId: "memory" }),
    });
    expect(install.status).toBe(422);
    await expect(install.json()).resolves.toMatchObject({
      error: expect.stringContaining("Plugins are disabled"),
    });

    const versionOverride = await app.request("/plugin-catalog/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entryId: "memory", version: "0.2.0" }),
    });
    expect(versionOverride.status).toBe(422);
  });
});
