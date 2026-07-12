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
  autoApply: true,
};

describe("fetchPluginList envelope", () => {
  it("parses autoApplyDisabled and the per-row effective autoApply", async () => {
    const result = await fetchPluginList(
      fetchReturning({ autoApplyDisabled: true, plugins: [ROW] }),
    );
    expect(result.autoApplyDisabled).toBe(true);
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]?.autoApply).toBe(true);
  });

  it("tolerates older servers that omit the Phase 6 fields", async () => {
    const { autoApply, ...oldRow } = ROW;
    const result = await fetchPluginList(
      fetchReturning({ plugins: [oldRow] }),
    );
    expect(result.autoApplyDisabled).toBe(false);
    expect(result.plugins[0]?.autoApply).toBeNull();
  });

  it("renders the quiet empty state for a malformed org kill-switch instead of reading it as off", async () => {
    // A drifted autoApplyDisabled:"true" must NOT surface auto-update
    // controls as available (the org policy might really be ON).
    const result = await fetchPluginList(
      fetchReturning({ autoApplyDisabled: "true", plugins: [ROW] }),
    );
    expect(result).toEqual({ autoApplyDisabled: false, plugins: [] });
  });
});
