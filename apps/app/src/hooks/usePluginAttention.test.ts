import { describe, expect, it } from "vitest";
import type { PluginRuntimeStatus } from "@bb/server-contract";
import {
  pluginAttentionLabel,
  pluginsNeedingAttention,
} from "./usePluginAttention";

function plugin(id: string, status: PluginRuntimeStatus) {
  return { id, status };
}

describe("pluginsNeedingAttention", () => {
  it("counts only plugins that are enabled but not running", () => {
    const plugins = [
      plugin("notify", "incompatible"),
      plugin("broken", "error"),
      plugin("gone", "missing"),
      plugin("ok", "running"),
      plugin("off", "disabled"),
      plugin("setup", "needs-configuration"),
      plugin("slow", "degraded"),
    ];

    expect(pluginsNeedingAttention(plugins).map((p) => p.id)).toEqual([
      "notify",
      "broken",
      "gone",
    ]);
  });

  it("is empty when every plugin runs", () => {
    expect(pluginsNeedingAttention([plugin("ok", "running")])).toEqual([]);
  });
});

describe("pluginAttentionLabel", () => {
  it("pluralizes", () => {
    expect(pluginAttentionLabel(1)).toBe("1 plugin needs attention");
    expect(pluginAttentionLabel(2)).toBe("2 plugins need attention");
  });
});
