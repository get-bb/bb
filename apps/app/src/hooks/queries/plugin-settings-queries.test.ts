import { describe, expect, it } from "vitest";
import { fetchPluginList } from "./plugin-settings-queries";

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

  it("drops half-shaped rows instead of defaulting required fields", async () => {
    const result = await fetchPluginList(
      fetchReturning({
        enabled: true,
        plugins: [{ id: "half" }, ROW],
      }),
    );
    expect(result.plugins.map((plugin) => plugin.id)).toEqual(["linear"]);
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
