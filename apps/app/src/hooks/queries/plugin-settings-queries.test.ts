import { describe, expect, it } from "vitest";
import { fetchPluginList, removePlugin } from "./plugin-settings-queries";

function fetchReturning(body: unknown, status = 200): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
}

function receiverSensitiveFetch(body: unknown): typeof fetch {
  return function (this: typeof globalThis) {
    if (this !== globalThis) throw new TypeError("Illegal invocation");
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  } as typeof fetch;
}

const ROW = {
  id: "linear",
  source: "npm:@bb-plugins/linear@^1",
  rootDir: "/tmp/linear",
  version: "1.6.2",
  enabled: true,
  status: "running",
  statusDetail: null,
  provenance: "direct",
  publisherLabel: null,
  isOrphanedBuiltin: false,
  sourceDisplay: "npm · @bb-plugins/linear · pinned",
  updateState: {
    availableVersion: "1.7.0",
    lastCheckAt: 1752300000000,
    lastFailure: { version: "1.7.0", at: 1752300000000, detail: "boom" },
  },
  description: "Linear integration",
  name: "Linear",
  icon: null,
  iconUrl: null,
  handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
  services: [],
  schedules: [],
  cliCommand: null,
  hasSettings: true,
  app: { hasApp: false, bundle: null },
  logoUrl: null,
  logoDarkUrl: null,
};

describe("fetchPluginList envelope", () => {
  it("binds browser fetch before the SDK invokes it", async () => {
    const result = await fetchPluginList(
      receiverSensitiveFetch({ plugins: [ROW] }),
    );
    expect(result.plugins).toHaveLength(1);
  });

  it("parses the { enabled, plugins } envelope and normalizes updateState", async () => {
    const result = await fetchPluginList(fetchReturning({ plugins: [ROW] }));
    expect(result.plugins).toHaveLength(1);
    const plugin = result.plugins[0];
    expect(plugin?.provenance).toBe("direct");
    expect(plugin?.updateState.availableVersion).toBe("1.7.0");
    expect(plugin?.updateState.lastFailure).toEqual({
      version: "1.7.0",
      at: 1752300000000,
      detail: "boom",
    });
    // Absent quiet fields normalize to the explicit quiet value.
    expect(plugin?.updateState.blockedVersion).toBeNull();
    expect(plugin?.updateState.blockedReasons).toEqual([]);
  });

  it("preserves authoritative source and activity metadata for detail pages", async () => {
    const result = await fetchPluginList(
      fetchReturning({
        plugins: [
          {
            ...ROW,
            source: "path:/plugins/linear",
            rootDir: "/plugins/linear",
            handlerStats: {
              count: 4,
              totalMs: 12,
              maxMs: 5,
              errorCount: 1,
            },
            services: [{ name: "sync", state: "backoff" }],
            schedules: [
              {
                name: "refresh",
                cron: "*/5 * * * *",
                nextRunAt: 200,
                lastRunAt: 100,
                lastStatus: "error",
                lastError: "rate limited",
              },
            ],
            cliCommand: { name: "linear", summary: "Manage Linear" },
            app: { hasApp: true, bundle: null },
          },
        ],
      }),
    );

    const plugin = result.plugins[0];
    expect(plugin?.source).toBe("path:/plugins/linear");
    expect(plugin?.rootDir).toBe("/plugins/linear");
    expect(plugin?.handlerStats.errorCount).toBe(1);
    expect(plugin?.services).toEqual([{ name: "sync", state: "backoff" }]);
    expect(plugin?.schedules[0]?.lastError).toBe("rate limited");
    expect(plugin?.cliCommand?.name).toBe("linear");
    expect(plugin?.app.hasApp).toBe(true);
  });

  it("rejects an envelope missing plugins instead of half-parsing it", async () => {
    await expect(fetchPluginList(fetchReturning({}))).rejects.toThrow();
  });

  it("rejects a list containing rows missing server-mandated fields", async () => {
    const { updateState, ...noUpdateState } = ROW;
    const { provenance, ...noProvenance } = ROW;
    const { sourceDisplay, ...noSourceDisplay } = ROW;
    const { isOrphanedBuiltin, ...noOrphanedBuiltin } = ROW;
    await expect(
      fetchPluginList(
        fetchReturning({
          plugins: [
            noUpdateState,
            noProvenance,
            noSourceDisplay,
            noOrphanedBuiltin,
            ROW,
          ],
        }),
      ),
    ).rejects.toThrow();
  });

  it("drops a row with a partial lastFailure rather than showing the quiet state", async () => {
    // A rollback whose record lost `at` or `detail` is contract drift; the
    // quiet state would suppress the Needs-attention pill and banner.
    const partialFailure = {
      ...ROW,
      updateState: { lastFailure: { version: "1.7.0" } },
    };
    await expect(
      fetchPluginList(fetchReturning({ plugins: [partialFailure] })),
    ).rejects.toThrow();
  });

  it("returns an empty list only for a successful empty response", async () => {
    await expect(
      fetchPluginList(fetchReturning({ plugins: [] })),
    ).resolves.toEqual({ plugins: [] });
  });

  it("rejects malformed, HTTP, and network failures", async () => {
    await expect(fetchPluginList(fetchReturning(null))).rejects.toThrow();
    await expect(fetchPluginList(fetchReturning({}, 404))).rejects.toThrow();
    await expect(
      fetchPluginList(async () => {
        throw new TypeError("network unavailable");
      }),
    ).rejects.toThrow("network unavailable");
  });
});

describe("removePlugin", () => {
  it("DELETEs the plugin by encoded id and resolves on ok", async () => {
    const calls: Array<{ url: string; init?: { method?: string } }> = [];
    const fetchImpl = (async (url: string, init?: { method?: string }) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }) as unknown as typeof fetch;
    await removePlugin(fetchImpl, "demo/widget");
    expect(calls[0]?.url).toBe("/api/v1/plugins/demo%2Fwidget");
    expect(calls[0]?.init).toMatchObject({ method: "DELETE" });
  });

  it("throws the server's error message on failure", async () => {
    await expect(
      removePlugin(fetchReturning({ error: "unknown plugin" }, 404), "gone"),
    ).rejects.toThrow("unknown plugin");
  });
});
