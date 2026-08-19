import type { PluginAttentionEntry } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { pluginAttentionLabel } from "./usePluginAttention";

function entry(overrides: Partial<PluginAttentionEntry>): PluginAttentionEntry {
  return {
    id: "notify",
    name: "Notify",
    status: "incompatible",
    statusDetail: "requires bb >=0.38.0 <0.39.0, this is 0.39.0",
    ...overrides,
  };
}

describe("pluginAttentionLabel", () => {
  it("names one incompatible plugin with the running bb version", () => {
    expect(pluginAttentionLabel([entry({})], "0.39.0")).toBe(
      "Notify is incompatible with bb 0.39.0",
    );
  });

  it("does not blame the bb version for an SDK or artifact incompatibility", () => {
    expect(
      pluginAttentionLabel(
        [
          entry({
            statusDetail:
              "requires bb plugin SDK >=2.0.0, running SDK is 1.4.0",
          }),
        ],
        "0.39.0",
      ),
    ).toBe(
      "Notify is incompatible: requires bb plugin SDK >=2.0.0, running SDK is 1.4.0",
    );
    expect(
      pluginAttentionLabel([entry({ statusDetail: "x".repeat(200) })], "0.39.0"),
    ).toBe("Notify is incompatible");
  });

  it("falls back to the id when the manifest never parsed", () => {
    expect(
      pluginAttentionLabel(
        [entry({ name: null, status: "error", statusDetail: "boom" })],
        "0.39.0",
      ),
    ).toBe("notify is not running: boom");
  });

  it("drops a long detail and keeps the status word", () => {
    expect(
      pluginAttentionLabel(
        [entry({ status: "error", statusDetail: "x".repeat(200) })],
        "0.39.0",
      ),
    ).toBe("Notify is not running (error)");
  });

  it("counts several plugins", () => {
    expect(
      pluginAttentionLabel([entry({}), entry({ id: "foo" })], "0.39.0"),
    ).toBe("2 plugins are not running");
  });
});
