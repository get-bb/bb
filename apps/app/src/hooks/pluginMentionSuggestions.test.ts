import { describe, expect, it } from "vitest";
import { buildPluginMentionSuggestions } from "./pluginMentionSuggestions";
import type { PluginMentionSearchGroup } from "./queries/plugin-contribution-queries";

const GROUPS: PluginMentionSearchGroup[] = [
  {
    pluginId: "linear",
    providerId: "issues",
    label: "Linear issues",
    items: [
      {
        itemId: "issues:ISS-42",
        title: "Fix login bug",
        subtitle: "In progress",
        icon: null,
      },
      {
        itemId: "issues:ISS-43",
        title: "Ship mention providers",
        subtitle: null,
        icon: null,
      },
    ],
  },
  {
    pluginId: "linear",
    providerId: "docs",
    label: "Docs",
    items: [
      {
        itemId: "docs:onboarding",
        title: "Onboarding",
        subtitle: null,
        icon: null,
      },
    ],
  },
];

describe("buildPluginMentionSuggestions", () => {
  it("flattens groups into plugin suggestions carrying the provider label", () => {
    expect(buildPluginMentionSuggestions(GROUPS)).toEqual([
      {
        kind: "plugin",
        pluginId: "linear",
        providerId: "issues",
        itemId: "issues:ISS-42",
        providerLabel: "Linear issues",
        title: "Fix login bug",
        subtitle: "In progress",
        replacement: "Fix login bug",
      },
      {
        kind: "plugin",
        pluginId: "linear",
        providerId: "issues",
        itemId: "issues:ISS-43",
        providerLabel: "Linear issues",
        title: "Ship mention providers",
        subtitle: null,
        replacement: "Ship mention providers",
      },
      {
        kind: "plugin",
        pluginId: "linear",
        providerId: "docs",
        itemId: "docs:onboarding",
        providerLabel: "Docs",
        title: "Onboarding",
        subtitle: null,
        replacement: "Onboarding",
      },
    ]);
  });

  it("drops rows whose title is blank and returns nothing for empty groups", () => {
    expect(
      buildPluginMentionSuggestions([
        {
          pluginId: "linear",
          providerId: "issues",
          label: "Linear issues",
          items: [
            {
              itemId: "issues:blank",
              title: "   ",
              subtitle: null,
              icon: null,
            },
          ],
        },
      ]),
    ).toEqual([]);
    expect(buildPluginMentionSuggestions([])).toEqual([]);
  });
});
