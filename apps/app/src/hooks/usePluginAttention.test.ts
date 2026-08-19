import { describe, expect, it } from "vitest";
import { pluginAttentionLabel } from "./usePluginAttention";

describe("pluginAttentionLabel", () => {
  it("pluralizes", () => {
    expect(pluginAttentionLabel(1)).toBe("1 plugin needs attention");
    expect(pluginAttentionLabel(2)).toBe("2 plugins need attention");
  });
});
