import { readFile } from "node:fs/promises";

import type { PluginMentionSearchContext } from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  type FakeMentionProviderRecord,
  type FakePluginHarness,
} from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CommunityCatalogRecord } from "./community-catalog";
import type { InstalledPluginRecord } from "./installed-catalog";
import {
  buildCommunityPluginContext,
  buildInstalledPluginContext,
  encodeCommunityItemId,
  encodeInstalledItemId,
} from "./mention-context";
import plugin, { SDK_READ_TIMEOUT_MS } from "./server";

const MENTION_CONTEXT: PluginMentionSearchContext = {
  trigger: "@",
  query: "git",
  projectId: null,
  threadId: null,
};

function capability(
  kind: InstalledPluginRecord["capabilities"][number]["kind"],
): InstalledPluginRecord["capabilities"][number] {
  return { detail: null, id: `${kind}-id`, kind, label: kind };
}

function installed(
  overrides: Partial<InstalledPluginRecord> = {},
): InstalledPluginRecord {
  return {
    app: { bundle: null, hasApp: false },
    capabilities: [capability("skill")],
    cliCommand: null,
    description: "Plugin description",
    enabled: true,
    handlerStats: { count: 0, errorCount: 0, maxMs: 0, totalMs: 0 },
    hasSettings: false,
    icon: null,
    iconUrl: null,
    id: "github",
    isOrphanedBuiltin: false,
    logoDarkUrl: null,
    logoUrl: null,
    name: "GitHub",
    provenance: "direct",
    publisherLabel: null,
    rootDir: "/plugins/github",
    schedules: [],
    services: [],
    source: "path:/plugins/github",
    sourceDisplay: "/plugins/github",
    status: "running",
    statusDetail: null,
    updateState: {},
    version: "1.0.0",
    ...overrides,
  };
}

function community(
  overrides: Partial<CommunityCatalogRecord> = {},
): CommunityCatalogRecord {
  return {
    author: { name: "Publisher", url: null },
    category: "Developer tools",
    compatible: true,
    description: "Catalog description",
    displayName: "Noema",
    entryId: "noema-entry",
    icon: null,
    iconTinted: false,
    iconUrl: null,
    incompatibleReason: null,
    installed: false,
    marketplace: "bb-community",
    marketplaceDisplayName: "BB Community",
    official: false,
    pluginId: "noema",
    publisherKey: "publisher",
    publisherLabel: "Publisher",
    repositoryUrl: null,
    source: "git:https://example.test/noema.git",
    ...overrides,
  };
}

function mentionProvider(
  harness: FakePluginHarness,
  id: string,
): FakeMentionProviderRecord {
  const provider = harness.inspection.registrations.mentionProviders.find(
    (candidate) => candidate.id === id,
  );
  if (provider === undefined) throw new Error(`Missing ${id} mention provider`);
  return provider;
}

function sdkSignal(args: unknown[]): AbortSignal {
  const options = args[0];
  if (
    typeof options !== "object" ||
    options === null ||
    !("signal" in options) ||
    !(options.signal instanceof AbortSignal)
  ) {
    throw new Error("SDK call did not receive an AbortSignal");
  }
  return options.signal;
}

function neverSettling<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("provider registration and package shape", () => {
  it("registers only Installed then Community with the default @ trigger", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "at-plugin" });
    await plugin(bb);

    const registrations = harness.inspection.registrations;
    expect(
      registrations.mentionProviders.map(({ id, label, triggers }) => ({
        id,
        label,
        triggers,
      })),
    ).toEqual([
      { id: "installed", label: "Installed", triggers: ["@"] },
      { id: "community", label: "Community", triggers: ["@"] },
    ]);
    expect(registrations).toMatchObject({
      settingsDescriptors: {},
      httpRoutes: [],
      rpcMethods: [],
      services: [],
      schedules: [],
      cli: null,
      agentTools: [],
      agentConfigurationProvider: null,
      instructionProvider: null,
      providerRegistrations: [],
    });
    expect(
      Object.values(registrations.threadEventHandlers).every(
        (count) => count === 0,
      ),
    ).toBe(true);
  });

  it("uses the workspace SDK and ships only the faithful AtIcon backend branding", async () => {
    const packageText = await readFile(
      new URL("./package.json", import.meta.url),
      "utf8",
    );
    const packageJson: unknown = JSON.parse(packageText);
    const icon = (
      await readFile(new URL("./assets/at.svg", import.meta.url), "utf8")
    ).trim();

    expect(packageJson).toMatchObject({
      name: "bb-plugin-at-plugin",
      engines: { bbPluginSdk: ">=0.4.8" },
      bb: {
        name: "@Plugin",
        branding: { icon: "./assets/at.svg" },
        server: "./server.ts",
        skills: [],
      },
      devDependencies: {
        "@get-bb/plugin-sdk": "workspace:*",
      },
    });
    expect(packageJson).not.toHaveProperty("dependencies");
    expect(packageJson).not.toHaveProperty("bb.app");
    expect(packageJson).not.toHaveProperty("bb.host");
    expect(icon).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M15.6 8.40033V12.9003C15.6 14.3915 16.8088 15.6003 18.3 15.6003C19.7912 15.6003 21 14.3915 21 12.9003V12C21 7.02944 16.9706 3 12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21C14.0265 21 15.8965 20.3302 17.4009 19.2M15.6 12.0003C15.6 13.9886 13.9882 15.6003 12 15.6003C10.0118 15.6003 8.4 13.9886 8.4 12.0003C8.4 10.0121 10.0118 8.40033 12 8.40033C13.9882 8.40033 15.6 10.0121 15.6 12.0003Z"/></svg>',
    );
  });
});

describe("provider searches", () => {
  it("uses only each provider's SDK read and returns its host row", async () => {
    const inventory = [installed()];
    const catalog = [
      community({ displayName: "Git Memory", pluginId: "git-memory" }),
    ];
    const { bb, harness } = createFakePluginHost({
      pluginId: "at-plugin",
      sdk: {
        plugins: {
          list: async () => ({ plugins: inventory }),
          catalog: { search: async () => catalog },
        },
      },
    });
    await plugin(bb);

    const installedRows = await mentionProvider(harness, "installed").search(
      MENTION_CONTEXT,
    );
    expect(installedRows).toEqual([
      {
        id: encodeInstalledItemId("github"),
        title: "GitHub",
        subtitle: "Plugin description",
      },
    ]);
    expect(harness.inspection.sdk.calls.map((call) => call.path)).toEqual([
      "plugins.list",
    ]);
    expect(sdkSignal(harness.inspection.sdk.calls[0]!.args).aborted).toBe(
      false,
    );

    const communityRows = await mentionProvider(harness, "community").search(
      MENTION_CONTEXT,
    );
    expect(communityRows).toEqual([
      {
        id: encodeCommunityItemId({
          pluginId: "git-memory",
          marketplace: "bb-community",
          entryId: "noema-entry",
        }),
        title: "Git Memory",
        subtitle: "Not installed · Catalog description",
      },
    ]);
    expect(harness.inspection.sdk.calls.map((call) => call.path)).toEqual([
      "plugins.list",
      "plugins.catalog.search",
    ]);
    expect(sdkSignal(harness.inspection.sdk.calls[1]!.args).aborted).toBe(
      false,
    );
  });

  it("isolates Installed and Community SDK rejections without leaking diagnostics", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "at-plugin",
      sdk: {
        plugins: {
          list: async () => {
            throw new Error("inventory /private/secret");
          },
          catalog: {
            search: async () => {
              throw new Error("catalog internal diagnostic");
            },
          },
        },
      },
    });
    await plugin(bb);

    await expect(
      mentionProvider(harness, "installed").search(MENTION_CONTEXT),
    ).resolves.toEqual([]);
    await expect(
      mentionProvider(harness, "community").search(MENTION_CONTEXT),
    ).resolves.toEqual([]);
    expect(harness.inspection.sdk.calls.map((call) => call.path)).toEqual([
      "plugins.list",
      "plugins.catalog.search",
    ]);
  });
});

describe("Installed resolution", () => {
  it("re-reads live inventory and returns the exact bounded Installed pointer", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "at-plugin",
      sdk: { plugins: { list: async () => ({ plugins: [installed()] }) } },
    });
    await plugin(bb);

    await expect(
      mentionProvider(harness, "installed").resolve(
        encodeInstalledItemId("github"),
      ),
    ).resolves.toEqual({
      context: buildInstalledPluginContext({
        name: "GitHub",
        pluginId: "github",
      }),
    });
    expect(harness.inspection.sdk.callsTo("plugins.list")).toHaveLength(1);
  });

  it.each([
    {
      label: "missing",
      plugins: [],
      message:
        "github is no longer installed. Reinstall it in Plugins settings or remove @github, then retry.",
    },
    {
      label: "non-running",
      plugins: [installed({ status: "disabled" })],
      message:
        "GitHub is not currently usable. Restore it in Plugins settings or remove @GitHub, then retry.",
    },
    {
      label: "no-interface",
      plugins: [installed({ capabilities: [], cliCommand: null })],
      message:
        "GitHub no longer exposes an agent capability. Reload or update it, or remove @GitHub, then retry.",
    },
  ])("uses the curated $label error", async ({ plugins, message }) => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "at-plugin",
      sdk: { plugins: { list: async () => ({ plugins }) } },
    });
    await plugin(bb);

    await expect(
      mentionProvider(harness, "installed").resolve(
        encodeInstalledItemId("github"),
      ),
    ).rejects.toThrow(message);
  });

  it("rejects malformed ids without reading inventory or exposing decode details", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "at-plugin" });
    await plugin(bb);

    await expect(
      mentionProvider(harness, "installed").resolve("%2f"),
    ).rejects.toThrow(
      "This Installed plugin reference is invalid. Remove the mention and choose the plugin again.",
    );
    expect(harness.inspection.sdk.calls).toEqual([]);
  });

  it("replaces inventory rejection details with a stable verification error", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "at-plugin",
      sdk: {
        plugins: {
          list: async () => {
            throw new Error("loopback failed at /Users/private/plugin.ts");
          },
        },
      },
    });
    await plugin(bb);

    await expect(
      mentionProvider(harness, "installed").resolve(
        encodeInstalledItemId("github"),
      ),
    ).rejects.toThrow(
      "github could not be verified right now. Retry, or remove @github to send without it.",
    );
  });
});

describe("Community resolution", () => {
  const identity = {
    pluginId: "noema",
    marketplace: "bb-community",
    entryId: "noema-entry",
  };
  const itemId = encodeCommunityItemId(identity);

  it("requires the exact live catalog identity and returns the Community pointer", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "at-plugin",
      sdk: {
        plugins: {
          list: async () => ({ plugins: [] }),
          catalog: { search: async () => [community()] },
        },
      },
    });
    await plugin(bb);

    await expect(
      mentionProvider(harness, "community").resolve(itemId),
    ).resolves.toEqual({
      context: buildCommunityPluginContext({ name: "Noema", ...identity }),
    });
    expect(harness.inspection.sdk.calls.map((call) => call.path)).toEqual([
      "plugins.list",
      "plugins.catalog.search",
    ]);
    expect(
      harness.inspection.sdk.callsTo("plugins.catalog.search")[0]?.[0],
    ).toMatchObject({
      query: "noema",
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    {
      label: "missing exact entry",
      entry: community({ entryId: "replacement" }),
      message:
        "noema is no longer available in bb Community. Remove @noema or choose a current result, then retry.",
    },
    {
      label: "mismatched stable plugin id",
      entry: community({ pluginId: "replacement" }),
      message:
        "noema is no longer available in bb Community. Remove @noema or choose a current result, then retry.",
    },
    {
      label: "mismatched marketplace",
      entry: community({ marketplace: "other-marketplace" }),
      message:
        "noema is no longer available in bb Community. Remove @noema or choose a current result, then retry.",
    },
    {
      label: "missing live display name",
      entry: community({ displayName: " \t" }),
      message:
        "noema is no longer available in bb Community. Remove @noema or choose a current result, then retry.",
    },
    {
      label: "catalog-incompatible",
      entry: community({ compatible: false }),
      message:
        "Noema is no longer listed for this version of bb. Remove @Noema or choose a current result, then retry.",
    },
    {
      label: "already installed but missing from inventory",
      entry: community({ installed: true }),
      message:
        "Noema is no longer available in bb Community. Remove @Noema or choose a current result, then retry.",
    },
  ])("uses the curated $label error", async ({ entry, message }) => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "at-plugin",
      sdk: {
        plugins: {
          list: async () => ({ plugins: [] }),
          catalog: { search: async () => [entry] },
        },
      },
    });
    await plugin(bb);

    await expect(
      mentionProvider(harness, "community").resolve(itemId),
    ).rejects.toThrow(message);
  });

  it("upgrades a newly installed usable target before catalog lookup", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "at-plugin",
      sdk: {
        plugins: {
          list: async () => ({
            plugins: [installed({ id: "noema", name: "Noema Live" })],
          }),
          catalog: {
            search: async () => {
              throw new Error("catalog disappeared");
            },
          },
        },
      },
    });
    await plugin(bb);

    await expect(
      mentionProvider(harness, "community").resolve(itemId),
    ).resolves.toEqual({
      context: buildInstalledPluginContext({
        name: "Noema Live",
        pluginId: "noema",
      }),
    });
    expect(harness.inspection.sdk.calls.map((call) => call.path)).toEqual([
      "plugins.list",
    ]);
    expect(harness.inspection.sdk.callsTo("plugins.catalog.search")).toEqual(
      [],
    );
  });

  it.each([
    {
      installedTarget: installed({
        id: "noema",
        name: "Noema",
        status: "needs-configuration",
      }),
      message:
        "Noema is not currently usable. Restore it in Plugins settings or remove @Noema, then retry.",
    },
    {
      installedTarget: installed({
        id: "noema",
        name: "Noema",
        capabilities: [],
      }),
      message:
        "Noema no longer exposes an agent capability. Reload or update it, or remove @Noema, then retry.",
    },
  ])(
    "blocks an installed-but-unusable target without catalog access",
    async ({ installedTarget, message }) => {
      const { bb, harness } = createFakePluginHost({
        pluginId: "at-plugin",
        sdk: {
          plugins: { list: async () => ({ plugins: [installedTarget] }) },
        },
      });
      await plugin(bb);

      await expect(
        mentionProvider(harness, "community").resolve(itemId),
      ).rejects.toThrow(message);
      expect(harness.inspection.sdk.calls.map((call) => call.path)).toEqual([
        "plugins.list",
      ]);
    },
  );

  it("curates catalog rejection and malformed-reference errors", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "at-plugin",
      sdk: {
        plugins: {
          list: async () => ({ plugins: [] }),
          catalog: {
            search: async () => {
              throw new Error("catalog /private/path diagnostic");
            },
          },
        },
      },
    });
    await plugin(bb);
    const provider = mentionProvider(harness, "community");

    await expect(provider.resolve(itemId)).rejects.toThrow(
      "noema could not be verified in bb Community right now. Retry, or remove @noema to send without it.",
    );
    await expect(provider.resolve("invalid")).rejects.toThrow(
      "This Community plugin reference is invalid. Remove the mention and choose the plugin again.",
    );
  });

  it("curates inventory rejection before Community catalog access", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "at-plugin",
      sdk: {
        plugins: {
          list: async () => {
            throw new Error("inventory socket and private path diagnostic");
          },
        },
      },
    });
    await plugin(bb);

    await expect(
      mentionProvider(harness, "community").resolve(itemId),
    ).rejects.toThrow(
      "noema could not be verified right now. Retry, or remove @noema to send without it.",
    );
    expect(harness.inspection.sdk.calls.map((call) => call.path)).toEqual([
      "plugins.list",
    ]);
  });
});

describe("hard SDK read timeouts", () => {
  it("aborts a never-settling Installed search and returns no rows", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const { bb, harness } = createFakePluginHost({
      pluginId: "at-plugin",
      sdk: {
        plugins: {
          list: async (args) => {
            signal = args?.signal;
            return neverSettling();
          },
        },
      },
    });
    await plugin(bb);
    const pending = mentionProvider(harness, "installed").search(
      MENTION_CONTEXT,
    );

    await vi.advanceTimersByTimeAsync(SDK_READ_TIMEOUT_MS);
    await expect(pending).resolves.toEqual([]);
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a never-settling Community search and returns no rows", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const { bb, harness } = createFakePluginHost({
      pluginId: "at-plugin",
      sdk: {
        plugins: {
          catalog: {
            search: async (args) => {
              signal = args.signal;
              return neverSettling();
            },
          },
        },
      },
    });
    await plugin(bb);
    const pending = mentionProvider(harness, "community").search(
      MENTION_CONTEXT,
    );

    await vi.advanceTimersByTimeAsync(SDK_READ_TIMEOUT_MS);
    await expect(pending).resolves.toEqual([]);
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a never-settling Installed resolver with its curated verification error", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const { bb, harness } = createFakePluginHost({
      pluginId: "at-plugin",
      sdk: {
        plugins: {
          list: async (args) => {
            signal = args?.signal;
            return neverSettling();
          },
        },
      },
    });
    await plugin(bb);
    const pending = mentionProvider(harness, "installed").resolve(
      encodeInstalledItemId("github"),
    );
    const rejection = expect(pending).rejects.toThrow(
      "github could not be verified right now. Retry, or remove @github to send without it.",
    );

    await vi.advanceTimersByTimeAsync(SDK_READ_TIMEOUT_MS);
    await rejection;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a never-settling Community catalog resolver with its curated error", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const { bb, harness } = createFakePluginHost({
      pluginId: "at-plugin",
      sdk: {
        plugins: {
          list: async () => ({ plugins: [] }),
          catalog: {
            search: async (args) => {
              signal = args.signal;
              return neverSettling();
            },
          },
        },
      },
    });
    await plugin(bb);
    const pending = mentionProvider(harness, "community").resolve(
      encodeCommunityItemId({
        pluginId: "noema",
        marketplace: "bb-community",
        entryId: "noema-entry",
      }),
    );
    const rejection = expect(pending).rejects.toThrow(
      "noema could not be verified in bb Community right now. Retry, or remove @noema to send without it.",
    );

    await vi.advanceTimersByTimeAsync(SDK_READ_TIMEOUT_MS);
    await rejection;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("resolver independence and SDK safety", () => {
  it("resolves different ids independently and leaves duplicate message dedupe to BB", async () => {
    const plugins = [installed(), installed({ id: "linear", name: "Linear" })];
    const { bb, harness } = createFakePluginHost({
      pluginId: "at-plugin",
      sdk: { plugins: { list: async () => ({ plugins }) } },
    });
    await plugin(bb);
    const provider = mentionProvider(harness, "installed");

    const github = await provider.resolve(encodeInstalledItemId("github"));
    const linear = await provider.resolve(encodeInstalledItemId("linear"));
    const githubAgain = await provider.resolve(encodeInstalledItemId("github"));

    expect(github).toEqual(githubAgain);
    expect(github.context).toContain('Plugin id: "github"');
    expect(linear.context).toContain('Plugin id: "linear"');
    expect(harness.inspection.sdk.callsTo("plugins.list")).toHaveLength(3);
  });

  it("records only the two allowed read-only SDK paths and never calls a target handler", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "at-plugin",
      sdk: {
        plugins: {
          list: async () => ({ plugins: [] }),
          catalog: { search: async () => [community()] },
        },
      },
    });
    await plugin(bb);
    await mentionProvider(harness, "installed").search(MENTION_CONTEXT);
    await mentionProvider(harness, "community").search(MENTION_CONTEXT);
    await mentionProvider(harness, "community").resolve(
      encodeCommunityItemId({
        pluginId: "noema",
        marketplace: "bb-community",
        entryId: "noema-entry",
      }),
    );

    const paths = harness.inspection.sdk.calls.map((call) => call.path);
    expect(new Set(paths)).toEqual(
      new Set(["plugins.list", "plugins.catalog.search"]),
    );
    expect(
      paths.some((path) =>
        /install|refresh|status|rpc|enable|reload|update|remove/i.test(path),
      ),
    ).toBe(false);
  });
});
