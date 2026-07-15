import {
  createConnection,
  getPluginCatalog,
  migrate,
  upsertPluginCatalog,
  type DbConnection,
} from "@bb/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginService } from "../../../src/services/plugins/plugin-service.js";
import {
  createPluginCatalogService,
  PLUGIN_CATALOG_MAX_BODY_BYTES,
  PLUGIN_CATALOG_REFRESH_INTERVAL_MS,
} from "../../../src/services/plugin-catalog/plugin-catalog-service.js";
import { BUNDLED_PLUGIN_CATALOG } from "../../../src/services/plugin-catalog/official-catalog.js";

function response(body: BodyInit | null, init?: ResponseInit): Response {
  return new Response(body, init);
}

describe("singleton plugin catalog service", () => {
  let db: DbConnection;
  let installArgs:
    | Parameters<PluginService["installFromCatalog"]>[0]
    | undefined;

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
    installArgs = undefined;
  });

  afterEach(() => db.$client.close());

  function plugins(enabled = true) {
    return {
      isEnabled: () => enabled,
      installFromCatalog: async (
        args: Parameters<PluginService["installFromCatalog"]>[0],
      ) => {
        installArgs = args;
        throw new Error("installation stopped by test");
      },
    };
  }

  it("starts from the bundled LKG and repairs invalid persisted JSON", () => {
    const service = createPluginCatalogService({
      db,
      appVersion: "1.0.0",
      plugins: plugins(),
      notifyCatalogChanged: vi.fn(),
    });
    expect(service.status()).toMatchObject({
      pluginCount: BUNDLED_PLUGIN_CATALOG.plugins.length,
    });

    upsertPluginCatalog(db, {
      catalogJson: '{"schemaVersion":99}',
      etag: '"bad"',
      lastModified: null,
      lastSuccessfulRefreshAt: 10,
      lastAttemptedRefreshAt: 20,
      lastError: null,
    });
    const repaired = createPluginCatalogService({
      db,
      appVersion: "1.0.0",
      plugins: plugins(),
      notifyCatalogChanged: vi.fn(),
    });
    expect(repaired.status()).toMatchObject({
      pluginCount: BUNDLED_PLUGIN_CATALOG.plugins.length,
      lastAttemptAt: 20,
      lastError: expect.stringContaining("bundled fallback"),
    });
    expect(getPluginCatalog(db)).toMatchObject({ etag: null });
  });

  it("repairs persisted catalogs that fail semantic source validation", () => {
    upsertPluginCatalog(db, {
      catalogJson: JSON.stringify({
        schemaVersion: 1,
        plugins: [
          {
            id: "escaping-plugin",
            displayName: "Escaping plugin",
            description: "Invalid persisted source",
            source: {
              git: {
                url: "https://github.com/example/plugin.git",
                ref: "main",
                subdir: "../outside",
              },
            },
          },
        ],
      }),
      etag: '"invalid-semantic-lkg"',
      lastModified: null,
      lastSuccessfulRefreshAt: 10,
      lastAttemptedRefreshAt: 20,
      lastError: null,
    });

    const repaired = createPluginCatalogService({
      db,
      appVersion: "1.0.0",
      plugins: plugins(),
      notifyCatalogChanged: vi.fn(),
    });

    expect(repaired.status()).toMatchObject({
      pluginCount: BUNDLED_PLUGIN_CATALOG.plugins.length,
      lastAttemptAt: 20,
      lastError: expect.stringContaining("git subdir must stay inside"),
    });
    expect(getPluginCatalog(db)).toMatchObject({
      etag: null,
      lastSuccessfulRefreshAt: null,
    });
  });

  it("retains and normalizes the trustworthy legacy official LKG", () => {
    upsertPluginCatalog(db, {
      catalogJson: JSON.stringify({
        ...BUNDLED_PLUGIN_CATALOG,
        name: "bb-official",
        displayName: "BB Official",
      }),
      etag: '"legacy"',
      lastModified: "Tue, 14 Jul 2026 12:00:00 GMT",
      lastSuccessfulRefreshAt: 10,
      lastAttemptedRefreshAt: 20,
      lastError: "offline",
    });
    const service = createPluginCatalogService({
      db,
      appVersion: "1.0.0",
      plugins: plugins(),
      notifyCatalogChanged: vi.fn(),
    });
    expect(service.status()).toEqual({
      pluginCount: BUNDLED_PLUGIN_CATALOG.plugins.length,
      lastRefreshAt: 10,
      lastAttemptAt: 20,
      lastError: "offline",
    });
    const persisted = getPluginCatalog(db);
    expect(persisted).toMatchObject({
      etag: '"legacy"',
      lastModified: "Tue, 14 Jul 2026 12:00:00 GMT",
    });
    expect(JSON.parse(persisted?.catalogJson ?? "null")).toEqual(
      BUNDLED_PLUGIN_CATALOG,
    );
  });

  it("conditionally fetches with persisted validators and emits on 200 and 304 status changes", async () => {
    const changedCatalog = {
      ...BUNDLED_PLUGIN_CATALOG,
      plugins: BUNDLED_PLUGIN_CATALOG.plugins.slice(0, 2),
    };
    const requests: RequestInit[] = [];
    const fetch = vi
      .fn(async (_url: string, init: RequestInit) => {
        requests.push(init);
        return response(JSON.stringify(changedCatalog), {
          status: 200,
          headers: {
            etag: '"v2"',
            "last-modified": "Wed, 15 Jul 2026 12:00:00 GMT",
          },
        });
      })
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        requests.push(init);
        return response(JSON.stringify(changedCatalog), {
          status: 200,
          headers: {
            etag: '"v2"',
            "last-modified": "Wed, 15 Jul 2026 12:00:00 GMT",
          },
        });
      })
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        requests.push(init);
        return response(null, { status: 304 });
      });
    const notify = vi.fn();
    const service = createPluginCatalogService({
      db,
      appVersion: "1.0.0",
      plugins: plugins(),
      notifyCatalogChanged: notify,
      fetch,
    });

    await expect(service.refresh(100)).resolves.toMatchObject({
      pluginCount: 2,
      lastRefreshAt: 100,
      lastAttemptAt: 100,
    });
    await expect(service.refresh(200)).resolves.toMatchObject({
      pluginCount: 2,
      lastRefreshAt: 200,
      lastAttemptAt: 200,
    });
    expect(notify).toHaveBeenCalledTimes(2);
    const secondHeaders = new Headers(requests[1]?.headers);
    expect(secondHeaders.get("if-none-match")).toBe('"v2"');
    expect(secondHeaders.get("if-modified-since")).toBe(
      "Wed, 15 Jul 2026 12:00:00 GMT",
    );
    expect(requests[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("bounds response bodies and retains the previous catalog on failure", async () => {
    const notify = vi.fn();
    const service = createPluginCatalogService({
      db,
      appVersion: "1.0.0",
      plugins: plugins(),
      notifyCatalogChanged: notify,
      fetch: async () =>
        response("too large", {
          headers: {
            "content-length": String(PLUGIN_CATALOG_MAX_BODY_BYTES + 1),
          },
        }),
    });
    await expect(service.refresh(300)).rejects.toThrow(/exceeds/);
    expect(service.status()).toMatchObject({
      pluginCount: BUNDLED_PLUGIN_CATALOG.plugins.length,
      lastAttemptAt: 300,
      lastError: expect.stringContaining("exceeds"),
    });
    expect(notify).toHaveBeenCalledOnce();
  });

  it("rejects redirects and coalesces concurrent refresh requests", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolve) => {
          expect(init.redirect).toBe("error");
          resolveFetch = resolve;
        }),
    );
    const service = createPluginCatalogService({
      db,
      appVersion: "1.0.0",
      plugins: plugins(),
      notifyCatalogChanged: vi.fn(),
      fetch,
    });
    const first = service.refresh(400);
    const second = service.refresh(500);
    expect(fetch).toHaveBeenCalledOnce();
    resolveFetch?.(response(JSON.stringify(BUNDLED_PLUGIN_CATALOG)));
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ lastAttemptAt: 400 }),
      expect.objectContaining({ lastAttemptAt: 400 }),
    ]);
    expect(service.status()).toMatchObject({ lastAttemptAt: 400 });
  });

  it("refreshes immediately on startup, then schedules the six-hour interval", async () => {
    upsertPluginCatalog(db, {
      catalogJson: JSON.stringify(BUNDLED_PLUGIN_CATALOG),
      etag: null,
      lastModified: null,
      lastSuccessfulRefreshAt: 900,
      lastAttemptedRefreshAt: 1_000,
      lastError: null,
    });
    const delays: number[] = [];
    const cancel = vi.fn();
    const fetch = vi.fn(async () => response(null, { status: 304 }));
    const service = createPluginCatalogService({
      db,
      appVersion: "1.0.0",
      plugins: plugins(),
      notifyCatalogChanged: vi.fn(),
      fetch,
      now: () => 1_500,
      schedule: (_callback, delay) => {
        delays.push(delay);
        return cancel;
      },
    });
    service.startPeriodicRefresh();
    expect(fetch).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(delays).toEqual([PLUGIN_CATALOG_REFRESH_INTERVAL_MS]);
    });
    expect(service.status()).toMatchObject({ lastAttemptAt: 1_500 });
    service.stopPeriodicRefresh();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("resets the periodic deadline after a manual refresh", async () => {
    upsertPluginCatalog(db, {
      catalogJson: JSON.stringify(BUNDLED_PLUGIN_CATALOG),
      etag: null,
      lastModified: null,
      lastSuccessfulRefreshAt: 900,
      lastAttemptedRefreshAt: 1_000,
      lastError: null,
    });
    let currentTime = 1_500;
    const delays: number[] = [];
    const cancel = vi.fn();
    const service = createPluginCatalogService({
      db,
      appVersion: "1.0.0",
      plugins: plugins(),
      notifyCatalogChanged: vi.fn(),
      fetch: async () => response(null, { status: 304 }),
      now: () => currentTime,
      schedule: (_callback, delay) => {
        delays.push(delay);
        return cancel;
      },
    });
    service.startPeriodicRefresh();
    await vi.waitFor(() => {
      expect(delays).toEqual([PLUGIN_CATALOG_REFRESH_INTERVAL_MS]);
    });
    currentTime = 2_000;
    await service.refresh();

    expect(delays).toEqual([
      PLUGIN_CATALOG_REFRESH_INTERVAL_MS,
      PLUGIN_CATALOG_REFRESH_INTERVAL_MS,
    ]);
    expect(cancel).toHaveBeenCalledOnce();
    service.stopPeriodicRefresh();
  });

  it("resolves catalog install sources without changing the entry's intent", async () => {
    const service = createPluginCatalogService({
      db,
      appVersion: "1.0.0",
      plugins: plugins(),
      notifyCatalogChanged: vi.fn(),
    });
    await expect(service.install("memory")).rejects.toThrow(
      "installation stopped by test",
    );
    expect(installArgs).toMatchObject({
      entryId: "memory",
      source: "npm:bb-plugin-memory@^0.2.0",
      npmRegistry: expect.stringContaining("github-release"),
    });
    expect(installArgs).not.toHaveProperty("marketplaceId");
  });
});
