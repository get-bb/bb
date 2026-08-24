import { describe, expect, it } from "vitest";

import {
  pluginSurfaceAgentContext,
  pluginSurfaceAgentMention,
  SURFACES_BY_ID,
} from "../src/index";

describe("Plugin Guide agent references", () => {
  it("uses the stable surface id and concise card label", () => {
    const surface = SURFACES_BY_ID.get("composer-actions");
    if (!surface) throw new Error("composer-actions surface missing");

    expect(pluginSurfaceAgentMention(surface)).toEqual({
      provider: "surface",
      id: "composer-actions",
      label: "Inline actions",
    });
  });

  it("resolves only surface identity, SDK symbols, and the authoring guide", () => {
    const context = pluginSurfaceAgentContext("composer-actions");
    expect(context).toContain("Inline actions (composer-actions)");
    expect(context).toContain("PluginComposerApi");
    expect(context).toContain("bb-plugin-authoring skill");
    expect(context?.split("\n")).toHaveLength(3);
    expect(pluginSurfaceAgentContext("missing-surface")).toBeNull();
  });
});
