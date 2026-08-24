import { describe, expect, it } from "vitest";

import { pluginComposerMentionResource } from "./plugin-composer-mention";

describe("pluginComposerMentionResource", () => {
  it("creates a plugin-owned resource with a stable composite item id", () => {
    expect(
      pluginComposerMentionResource("plugin-api-docs", {
        provider: " surface ",
        id: "composer-actions",
        label: "Inline actions",
      }),
    ).toEqual({
      kind: "plugin",
      pluginId: "plugin-api-docs",
      icon: null,
      itemId: "surface:composer-actions",
      label: "Inline actions",
    });
  });

  it("rejects a provider id that would corrupt the composite identity", () => {
    expect(
      pluginComposerMentionResource("plugin-api-docs", {
        provider: "bad:provider",
        id: "composer-actions",
        label: "Inline actions",
      }),
    ).toBeNull();
  });
});
