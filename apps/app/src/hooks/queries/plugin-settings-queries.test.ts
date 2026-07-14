import { describe, expect, it } from "vitest";
import { fetchPluginList, removePlugin } from "./plugin-settings-queries";

function fetchReturning(body: unknown, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

const ROW = {
  id: "linear",
  version: "1.6.2",
  enabled: true,
  status: "running",
  statusDetail: null,
  provenance: "direct",
  isOrphanedBuiltin: false,
  sourceDisplay: "npm · @bb-plugins/linear · pinned",
  updateState: {
    availableVersion: "1.7.0",
    lastCheckAt: 1752300000000,
    lastFailure: { version: "1.7.0", at: 1752300000000, detail: "boom" },
  },
};

describe("fetchPluginList envelope", () => {
  it("parses the { enabled, plugins } envelope and normalizes updateState", async () => {
    const result = await fetchPluginList(
      fetchReturning({ enabled: true, plugins: [ROW] }),
    );
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

  it("rejects an envelope missing enabled or plugins instead of half-parsing it", async () => {
    expect(await fetchPluginList(fetchReturning({ plugins: [ROW] }))).toEqual({
      plugins: [],
    });
    expect(await fetchPluginList(fetchReturning({ enabled: true }))).toEqual({
      plugins: [],
    });
  });

  it("drops rows missing the server-mandated fields instead of defaulting them", async () => {
    const { updateState, ...noUpdateState } = ROW;
    const { provenance, ...noProvenance } = ROW;
    const { sourceDisplay, ...noSourceDisplay } = ROW;
    const { isOrphanedBuiltin, ...noOrphanedBuiltin } = ROW;
    const result = await fetchPluginList(
      fetchReturning({
        enabled: true,
        plugins: [
          noUpdateState,
          noProvenance,
          noSourceDisplay,
          noOrphanedBuiltin,
          ROW,
        ],
      }),
    );
    expect(result.plugins.map((plugin) => plugin.id)).toEqual(["linear"]);
  });

  it("drops a row with a partial lastFailure rather than showing the quiet state", async () => {
    // A rollback whose record lost `at` or `detail` is contract drift; the
    // quiet state would suppress the Needs-attention pill and banner.
    const partialFailure = {
      ...ROW,
      updateState: { lastFailure: { version: "1.7.0" } },
    };
    const result = await fetchPluginList(
      fetchReturning({ enabled: true, plugins: [partialFailure] }),
    );
    expect(result.plugins).toEqual([]);
  });

  it("returns the quiet empty state on a malformed envelope or error", async () => {
    expect(await fetchPluginList(fetchReturning(null))).toEqual({
      plugins: [],
    });
    expect(await fetchPluginList(fetchReturning({}, 404))).toEqual({
      plugins: [],
    });
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
    expect(calls[0]?.init).toEqual({ method: "DELETE" });
  });

  it("throws the server's error message on failure", async () => {
    const fetchImpl = (async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: "unknown plugin" }),
    })) as unknown as typeof fetch;
    await expect(removePlugin(fetchImpl, "gone")).rejects.toThrow(
      "unknown plugin",
    );
  });
});
