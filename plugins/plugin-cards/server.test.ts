import { describe, expect, it } from "vitest";
import type { PluginAgentToolResult } from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  makePluginAgentConfigurationContext,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import { TOOL_NAME } from "./shared";

function catalogResult(overrides: {
  pluginId: string;
  entryId?: string;
  displayName: string;
  marketplace: string;
  marketplaceDisplayName?: string;
  compatible?: boolean;
  incompatibleReason?: string | null;
  author?: { name: string; github: string | null; url: string | null } | null;
  installs?: number | null;
  installedByDefault?: boolean;
  publishedAt?: string;
}) {
  return {
    entryId: overrides.entryId ?? overrides.pluginId,
    pluginId: overrides.pluginId,
    displayName: overrides.displayName,
    description: `${overrides.displayName} description`,
    icon: "Globe",
    iconUrl: null,
    iconTinted: false,
    category: "Browser & Web",
    screenshots: [],
    collections: [],
    source: `bundled:${overrides.pluginId}`,
    repositoryUrl: null,
    marketplace: overrides.marketplace,
    marketplaceDisplayName:
      overrides.marketplaceDisplayName ?? overrides.marketplace,
    publisherKey: overrides.marketplace,
    publisherLabel: overrides.marketplace,
    official: overrides.marketplace.startsWith("bb-"),
    author: overrides.author ?? null,
    installed: false,
    installedByDefault: overrides.installedByDefault ?? false,
    conflictingInstallSource: null,
    installs: overrides.installs ?? null,
    ...(overrides.publishedAt === undefined
      ? {}
      : { publishedAt: overrides.publishedAt }),
    compatible: overrides.compatible ?? true,
    incompatibleReason: overrides.incompatibleReason ?? null,
  };
}

const catalog = [
  catalogResult({
    pluginId: "browser-automation-extras",
    displayName: "Browser extras",
    marketplace: "acme",
    marketplaceDisplayName: "Acme Plugins",
    author: { name: "Ada", github: "ada", url: null },
    installs: 1234,
  }),
  catalogResult({
    pluginId: "browser-automation",
    displayName: "Browser Automation",
    marketplace: "bb-official",
  }),
  catalogResult({
    pluginId: "simple-notes",
    entryId: "docs",
    displayName: "Docs",
    marketplace: "bb-official",
  }),
  catalogResult({
    pluginId: "future-tool",
    displayName: "Future tool",
    marketplace: "bb-community",
    compatible: false,
    incompatibleReason: "requires bb 9.0.0",
    publishedAt: new Date().toISOString(),
  }),
];

function createHost(
  installed: {
    id: string;
    enabled: boolean;
    name?: string | null;
    sourceDisplay?: string;
  }[] = [],
) {
  const searches: string[] = [];
  const host = createFakePluginHost({
    pluginId: "bb--plugin-cards",
    sdk: {
      plugins: {
        catalog: {
          search: async ({ query }: { query: string }) => {
            searches.push(query);
            return {
              results: catalog.filter(
                (entry) =>
                  entry.pluginId.includes(query) ||
                  entry.entryId.includes(query),
              ),
              collections: [],
              categories: [],
            };
          },
        },
        list: async () => ({
          plugins: installed.map((plugin) => ({
            id: plugin.id,
            enabled: plugin.enabled,
            name: plugin.name ?? null,
            description: null,
            icon: "Folder",
            iconUrl: null,
            sourceDisplay:
              plugin.sourceDisplay ?? `path · /plugins/${plugin.id}`,
          })),
        }),
      },
    },
  });
  plugin(host.bb);
  return { host, searches };
}

function resultText(result: PluginAgentToolResult): {
  text: string;
  isError: boolean;
} {
  if (typeof result === "string") return { text: result, isError: false };
  const [part] = result.content;
  if (part?.type !== "text") throw new Error("expected a text result");
  return { text: part.text, isError: result.isError === true };
}

describe("show_plugin_card tool", () => {
  it("is offered to every agent with one short instruction", async () => {
    const { host } = createHost();
    const resolved = await host.harness.resolveAgentConfiguration(
      makePluginAgentConfigurationContext(),
    );
    expect(resolved.tools.map((tool) => tool.name)).toEqual([TOOL_NAME]);
    expect(resolved.skills).toEqual([]);
    expect(resolved.instructions).toContain(TOOL_NAME);
    expect(resolved.instructions?.split("\n")).toHaveLength(1);
  });

  it("returns the directive line for an exact catalog id, not a prefix match", async () => {
    const { host, searches } = createHost();
    const { text, isError } = resultText(
      await host.harness.callAgentTool(TOOL_NAME, {
        pluginId: " browser-automation ",
      }),
    );
    expect(isError).toBe(false);
    expect(searches).toEqual(["browser-automation"]);
    expect(text).toContain("verbatim");
    expect(text.split("\n").at(-1)).toBe(
      '::plugin-card{id="browser-automation"}',
    );
  });

  it("normalizes a catalog entry id to the plugin id the detail page uses", async () => {
    const { host } = createHost();
    const { text } = resultText(
      await host.harness.callAgentTool(TOOL_NAME, { pluginId: "docs" }),
    );
    expect(text.split("\n").at(-1)).toBe('::plugin-card{id="simple-notes"}');
  });

  it("accepts an installed plugin the store does not list", async () => {
    const { host } = createHost([{ id: "local-tool", enabled: true }]);
    const { text, isError } = resultText(
      await host.harness.callAgentTool(TOOL_NAME, { pluginId: "local-tool" }),
    );
    expect(isError).toBe(false);
    expect(text.split("\n").at(-1)).toBe('::plugin-card{id="local-tool"}');
  });

  it.each(["browser", "Browser-Automation", "", "../secrets"])(
    "rejects %j with guidance to search instead of guessing",
    async (pluginId) => {
      const { host } = createHost();
      const { text, isError } = resultText(
        await host.harness.callAgentTool(TOOL_NAME, { pluginId }),
      );
      expect(isError).toBe(true);
      expect(text).toContain("bb plugin search <terms> --json");
      expect(text).not.toContain("::plugin-card");
    },
  );

  it("rejects arguments other than pluginId", async () => {
    const { host } = createHost();
    await expect(
      host.harness.callAgentTool(TOOL_NAME, {
        pluginId: "browser-automation",
        install: true,
      }),
    ).rejects.toThrow(/install/);
  });
});

describe("getPluginCard rpc", () => {
  it("returns the store card fields with installed state", async () => {
    const { host } = createHost([{ id: "browser-automation", enabled: false }]);
    await expect(
      host.harness.behavior.callRpc("getPluginCard", {
        pluginId: "browser-automation",
      }),
    ).resolves.toEqual({
      kind: "found",
      card: {
        pluginId: "browser-automation",
        displayName: "Browser Automation",
        description: "Browser Automation description",
        icon: "Globe",
        iconUrl: null,
        iconTinted: false,
        author: { name: "BB Official", github: null, official: true },
        installed: true,
        included: false,
        compatible: true,
        incompatibleReason: null,
        installBadge: null,
      },
    });
  });

  it("credits the author and badges installs, new listings, and incompatibility", async () => {
    const { host } = createHost();
    await expect(
      host.harness.behavior.callRpc("getPluginCard", {
        pluginId: "browser-automation-extras",
      }),
    ).resolves.toMatchObject({
      kind: "found",
      card: {
        author: { name: "Ada", github: "ada", official: false },
        installed: false,
        installBadge: { kind: "count", installs: 1234 },
      },
    });
    await expect(
      host.harness.behavior.callRpc("getPluginCard", {
        pluginId: "future-tool",
      }),
    ).resolves.toMatchObject({
      kind: "found",
      card: {
        author: { name: "bb-community", github: null, official: false },
        compatible: false,
        incompatibleReason: "requires bb 9.0.0",
        installBadge: { kind: "new" },
      },
    });
  });

  it("falls back to an installed plugin the store does not list", async () => {
    const { host } = createHost([{ id: "local-tool", enabled: true }]);
    await expect(
      host.harness.behavior.callRpc("getPluginCard", {
        pluginId: "local-tool",
      }),
    ).resolves.toMatchObject({
      kind: "found",
      card: {
        pluginId: "local-tool",
        author: { name: "Local", github: null, official: false },
        installed: true,
        included: false,
        installBadge: null,
      },
    });
  });

  it("reports an unknown id as not found", async () => {
    const { host } = createHost();
    await expect(
      host.harness.behavior.callRpc("getPluginCard", { pluginId: "nope" }),
    ).resolves.toEqual({ kind: "not-found", pluginId: "nope" });
  });
});
