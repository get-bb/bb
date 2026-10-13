import { describe, expect, it } from "vitest";

import { MARKETPLACE_V2_FIXTURE } from "../marketplace/marketplace-v2.fixture.js";
import type { MarketplaceV2Entry } from "../marketplace/marketplace-v2.js";
import { builtinPluginDestination } from "./builtin-plugin-destination.js";

function bundledEntry(id: string, plugin: string): MarketplaceV2Entry {
  return {
    id,
    displayName: id,
    description: `The ${id} plugin.`,
    icon: "Brain",
    category: "memory-and-context",
    screenshots: [],
    tags: [],
    author: { name: "BB" },
    source: { bundled: { plugin } },
  };
}

const available = {
  status: "available" as const,
  stats: null,
  manifest: {
    ...MARKETPLACE_V2_FIXTURE,
    plugins: [
      ...MARKETPLACE_V2_FIXTURE.plugins,
      bundledEntry("simple-notes", "docs"),
      bundledEntry("bb--provider-usage", "provider-usage"),
    ],
  },
};

describe("builtinPluginDestination", () => {
  it("opens the public page under its marketplace id, even when it differs from the directory", () => {
    expect(builtinPluginDestination(available, "docs")).toEqual({
      kind: "marketplace",
      pluginId: "simple-notes",
    });
    expect(builtinPluginDestination(available, "provider-usage")).toEqual({
      kind: "marketplace",
      pluginId: "bb--provider-usage",
    });
  });

  it("falls back to the plugin's source when it has no public page", () => {
    expect(
      builtinPluginDestination(available, "environment-git-worktree"),
    ).toEqual({
      kind: "source",
      href: "https://github.com/get-bb/bb/tree/main/plugins/environment-git-worktree",
    });
    expect(
      builtinPluginDestination({ status: "unavailable" }, "docs"),
    ).toEqual({
      kind: "source",
      href: "https://github.com/get-bb/bb/tree/main/plugins/docs",
    });
  });
});
