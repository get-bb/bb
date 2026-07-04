import { describe, expect, it } from "vitest";
import {
  buildInstalledPluginMentionSuggestions,
  buildPluginMentionSuggestions,
} from "./pluginMentionSuggestions";
import type { PluginListItem } from "./queries/plugin-settings-queries";
import type { PluginMentionSearchGroup } from "./queries/plugin-contribution-queries";

const PLUGINS: PluginListItem[] = [
  {
    id: "codex",
    version: "0.1.0",
    enabled: true,
    status: "running",
    statusDetail: null,
    logoUrl: "/api/v1/plugins/codex/assets/logo",
    logoDarkUrl: null,
  },
  {
    id: "linear",
    version: "1.2.3",
    enabled: true,
    status: "running",
    statusDetail: null,
    logoUrl: null,
    logoDarkUrl: null,
  },
  {
    id: "disabled",
    version: "1.0.0",
    enabled: false,
    status: "stopped",
    statusDetail: null,
    logoUrl: null,
    logoDarkUrl: null,
  },
  {
    id: "broken",
    version: "1.0.0",
    enabled: true,
    status: "error",
    statusDetail: "boom",
    logoUrl: null,
    logoDarkUrl: null,
  },
];

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
  it("builds @ mention suggestions for running installed plugins", () => {
    expect(
      buildInstalledPluginMentionSuggestions({
        plugins: PLUGINS,
        query: "co",
        limit: 8,
      }),
    ).toEqual([
      {
        kind: "plugin",
        pluginId: "codex",
        title: "codex",
        subtitle: "v0.1.0",
        replacement: "codex",
      },
    ]);
  });

  it("does not suggest disabled or errored plugins", () => {
    expect(
      buildInstalledPluginMentionSuggestions({
        plugins: PLUGINS,
        query: "broken",
        limit: 8,
      }),
    ).toEqual([]);
    expect(
      buildInstalledPluginMentionSuggestions({
        plugins: PLUGINS,
        query: "disabled",
        limit: 8,
      }),
    ).toEqual([]);
  });

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
