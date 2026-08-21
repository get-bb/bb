import type { Host, ProviderInfo } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  buildPaletteOptions,
  CUSTOM_PALETTE_MOBILE_NOTE,
  FAVICON_COLOR_OPTIONS,
  faviconColorLabel,
  paletteLabel,
} from "./appearance-model";
import {
  cliSkillsMachineStatusLabel,
  cliSkillsStatusByHostId,
  describeCliSkillsInstallResults,
  summarizeMachineStatuses,
} from "./cli-skills-model";
import {
  createLocalPreferencesStore,
  LOCAL_PREFERENCE_KEYS,
  parseStoredBoolean,
  type LocalPreferencesStorage,
} from "./local-preferences";
import {
  describeUsageBody,
  formatUsageReset,
  usageBarTone,
  usageHeading,
  usageWindowValue,
  usageProviderConfigs,
  visibleUsageProviders,
} from "./usage-limits-model";

describe("appearance model", () => {
  it("lists built-ins natively and custom/plugin palettes as default-on-mobile", () => {
    const options = buildPaletteOptions({
      customThemes: ["ocean"],
      pluginThemes: [
        {
          id: "plugin:themes:sunset",
          pluginId: "themes",
          name: "Sunset",
          description: null,
        },
      ],
    });
    expect(options.slice(0, 6).map((o) => o.id)).toEqual([
      "default",
      "nord",
      "dracula",
      "solarized",
      "gruvbox",
      "catppuccin",
    ]);
    expect(options.find((o) => o.id === "nord")?.nativePalette).toBe("nord");
    const custom = options.find((o) => o.id === "ocean");
    expect(custom).toMatchObject({
      kind: "custom",
      nativePalette: "default",
      description: CUSTOM_PALETTE_MOBILE_NOTE,
    });
    const plugin = options.find((o) => o.id === "plugin:themes:sunset");
    expect(plugin?.label).toBe("Sunset");
    expect(plugin?.description).toContain("themes");
  });

  it("labels the active palette by built-in name, plugin name, or raw id", () => {
    const plugins = [
      { id: "plugin:t:x", pluginId: "t", name: "X Theme", description: null },
    ];
    expect(paletteLabel({ themeId: "nord" }, plugins)).toBe("Nord");
    expect(paletteLabel({ themeId: "plugin:t:x" }, plugins)).toBe("X Theme");
    expect(paletteLabel({ themeId: "ocean" }, plugins)).toBe("ocean");
  });

  it("offers every favicon tint plus default", () => {
    expect(FAVICON_COLOR_OPTIONS.map((o) => o.value)).toEqual([
      "default",
      "red",
      "orange",
      "yellow",
      "green",
      "teal",
      "blue",
      "purple",
      "pink",
    ]);
    expect(FAVICON_COLOR_OPTIONS[0]?.hex).toBeNull();
    expect(faviconColorLabel("teal")).toBe("Teal");
    expect(faviconColorLabel("default")).toBe("Default");
  });
});

describe("cli skills model", () => {
  it("summarises a fleet without overclaiming", () => {
    expect(summarizeMachineStatuses([])).toBeNull();
    expect(summarizeMachineStatuses(["unknown"])).toBeNull();
    expect(summarizeMachineStatuses(["installed"])).toBe("Installed");
    expect(summarizeMachineStatuses(["installed", "installed"])).toBe(
      "Installed on 2 machines",
    );
    expect(summarizeMachineStatuses(["installed", "missing", "unknown"])).toBe(
      "Installed on 1 of 2 machines",
    );
    expect(summarizeMachineStatuses(["outdated", "missing"])).toBe(
      "Out of date",
    );
    expect(summarizeMachineStatuses(["missing"])).toBe("Not installed");
  });

  it("maps statuses by host and labels offline machines", () => {
    const statuses = cliSkillsStatusByHostId({
      machines: [
        { hostId: "a", hostName: "A", status: "installed" },
        { hostId: "b", hostName: "B", status: "missing" },
      ],
    });
    expect(statuses.get("a")).toBe("installed");
    const online = { status: "connected" } as Host;
    const offline = { status: "disconnected" } as Host;
    expect(
      cliSkillsMachineStatusLabel({ host: online, status: "missing" }),
    ).toBe("Not installed");
    expect(
      cliSkillsMachineStatusLabel({ host: offline, status: "installed" }),
    ).toBe("Disconnected");
    expect(
      cliSkillsMachineStatusLabel({ host: online, status: undefined }),
    ).toBeNull();
  });

  it("reports partial installs as both a success and failures", () => {
    const report = describeCliSkillsInstallResults({
      results: [
        { ok: true, hostId: "a", hostName: "A", installations: [] },
        { ok: false, hostId: "b", hostName: "B", errorMessage: "offline" },
      ],
    });
    expect(report.successMessage).toBe("Installed the bb CLI skills on A");
    expect(report.failureMessages).toEqual(["B: offline"]);
    expect(
      describeCliSkillsInstallResults({ results: [] }).successMessage,
    ).toBeNull();
  });
});

describe("local preferences", () => {
  function memoryStorage(): LocalPreferencesStorage & {
    dump(): Record<string, string>;
  } {
    const map = new Map<string, string>();
    return {
      getString: (key) => map.get(key),
      set: (key, value) => map.set(key, value),
      remove: (key) => {
        map.delete(key);
      },
      dump: () => Object.fromEntries(map),
    };
  }

  it("reads the web JSON spelling and defaults the rewrite on", () => {
    expect(parseStoredBoolean(undefined, true)).toBe(true);
    expect(parseStoredBoolean("false", true)).toBe(false);
    expect(parseStoredBoolean("garbage", false)).toBe(false);
    const storage = memoryStorage();
    const store = createLocalPreferencesStore(storage);
    expect(store.getSnapshot().rewriteLocalhostLinks).toBe(true);
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    store.setRewriteLocalhostLinks(false);
    expect(store.getSnapshot().rewriteLocalhostLinks).toBe(false);
    expect(storage.dump()).toEqual({
      [LOCAL_PREFERENCE_KEYS.rewriteLocalhostLinks]: "false",
    });
    expect(LOCAL_PREFERENCE_KEYS.rewriteLocalhostLinks).toBe(
      "bb.rewriteLocalhostLinks",
    );
    expect(notified).toBe(1);
  });
});

describe("usage limits model", () => {
  const NOW = Date.UTC(2026, 7, 19, 12, 0, 0);

  const USAGE_PROVIDER_INFOS: ProviderInfo[] = [
    {
      id: "agent-a",
      displayName: "Agent A",
      logoUrl: null,
      available: true,
      experimental_providerHealth: true,
      experimental_providerUsage: true,
      experimental_providerInstallation: false,
      capabilities: {
        supportsThreadArchive: false,
        supportsThreadRename: false,
        supportsServiceTier: false,
        supportsNativeUserQuestion: false,
        supportsFork: false,
        supportsSessionRewind: false,
        permissionModes: ["full"],
      },
      composerActions: [],
      strings: {
        signInHint: "Run `agent-a login`.",
        expiredHint: "Agent A expired.",
        installUrl: "https://example.com/a",
      },
    },
    {
      id: "agent-b",
      displayName: "Agent B",
      logoUrl: null,
      available: true,
      experimental_providerHealth: true,
      experimental_providerUsage: true,
      experimental_providerInstallation: false,
      capabilities: {
        supportsThreadArchive: false,
        supportsThreadRename: false,
        supportsServiceTier: false,
        supportsNativeUserQuestion: false,
        supportsFork: false,
        supportsSessionRewind: false,
        permissionModes: ["full"],
      },
      composerActions: [],
    },
    {
      id: "no-usage",
      displayName: "No Usage",
      logoUrl: null,
      available: true,
      experimental_providerHealth: true,
      experimental_providerUsage: false,
      experimental_providerInstallation: false,
      capabilities: {
        supportsThreadArchive: false,
        supportsThreadRename: false,
        supportsServiceTier: false,
        supportsNativeUserQuestion: false,
        supportsFork: false,
        supportsSessionRewind: false,
        permissionModes: ["full"],
      },
      composerActions: [],
    },
  ];

  it("builds usage rows from the provider list, keyed by provider id", () => {
    const configs = usageProviderConfigs(USAGE_PROVIDER_INFOS);
    expect(configs.map((config) => config.providerId)).toEqual([
      "agent-a",
      "agent-b",
    ]);
    // Declared strings win; a provider without them gets generic copy.
    expect(configs[0]?.signInHint).toBe("Run `agent-a login`.");
    expect(configs[1]?.signInHint).toContain("Agent B");
  });

  it("hides providers whose CLI is not installed", () => {
    const configs = usageProviderConfigs(USAGE_PROVIDER_INFOS);
    expect(
      visibleUsageProviders(configs, {
        "agent-a": { status: "not_installed" },
        "agent-b": { status: "unauthenticated" },
      }).map((config) => config.providerId),
    ).toEqual(["agent-b"]);
    expect(visibleUsageProviders(configs, {})).toHaveLength(configs.length);
  });

  it("tones the bar at 80 / 95 percent", () => {
    expect(usageBarTone(10)).toBe("default");
    expect(usageBarTone(80)).toBe("warning");
    expect(usageBarTone(95)).toBe("destructive");
  });

  it("formats resets relative to now", () => {
    expect(formatUsageReset(null, NOW)).toBeNull();
    expect(formatUsageReset("not a date", NOW)).toBeNull();
    expect(formatUsageReset(new Date(NOW - 1).toISOString(), NOW)).toBe(
      "Resetting now",
    );
    expect(
      formatUsageReset(new Date(NOW + 25 * 60_000).toISOString(), NOW),
    ).toBe("Resets in 25 min");
    expect(
      formatUsageReset(
        new Date(NOW + (3 * 60 + 5) * 60_000).toISOString(),
        NOW,
      ),
    ).toBe("Resets in 3 hr 5 min");
    expect(
      formatUsageReset(new Date(NOW + 2 * 60 * 60_000).toISOString(), NOW),
    ).toBe("Resets in 2 hr");
    expect(
      formatUsageReset(new Date(NOW + 3 * 24 * 60 * 60_000).toISOString(), NOW),
    ).toMatch(/^Resets /u);
  });

  it("formats window values as percent or cost", () => {
    expect(
      usageWindowValue({ label: "5h", usedPercent: 42, resetsAt: null }),
    ).toBe("42% used");
    expect(
      usageWindowValue({
        label: "On-demand",
        usedPercent: 10,
        resetsAt: null,
        cost: { usedUsdCents: 150, limitUsdCents: 2_000 },
      }),
    ).toBe("$1.50 / $20");
  });

  it("picks the body per status", () => {
    const config = usageProviderConfigs(USAGE_PROVIDER_INFOS)[0]!;
    expect(
      describeUsageBody({
        config,
        usage: undefined,
        isLoading: true,
        isError: false,
      }),
    ).toEqual({ kind: "message", text: "Loading usage…" });
    expect(
      describeUsageBody({
        config,
        usage: undefined,
        isLoading: false,
        isError: true,
      }).kind,
    ).toBe("message");
    expect(
      describeUsageBody({
        config,
        usage: {
          status: "ok",
          accountEmail: null,
          planLabel: "Pro",
          windows: [],
        },
        isLoading: false,
        isError: false,
      }),
    ).toEqual({
      kind: "message",
      text: "No usage limits reported for this plan.",
    });
    const windows = [{ label: "5h", usedPercent: 1, resetsAt: null }];
    expect(
      describeUsageBody({
        config,
        usage: {
          status: "ok",
          accountEmail: "a@b.c",
          planLabel: "Pro",
          windows,
        },
        isLoading: false,
        isError: false,
      }),
    ).toEqual({ kind: "windows", windows });
    expect(
      describeUsageBody({
        config,
        usage: { status: "unauthenticated" },
        isLoading: false,
        isError: false,
      }),
    ).toEqual({ kind: "message", text: config.signInHint });
    expect(
      describeUsageBody({
        config,
        usage: {
          status: "error",
          message: "rate limited",
          planLabel: "Pro",
          accountEmail: null,
        },
        isLoading: false,
        isError: false,
      }),
    ).toEqual({ kind: "message", text: "rate limited" });
    expect(
      describeUsageBody({
        config,
        usage: { status: "not_installed" },
        isLoading: false,
        isError: false,
      }),
    ).toEqual({ kind: "none" });
  });

  it("keeps the plan and account known before an error", () => {
    expect(
      usageHeading({
        status: "error",
        message: "x",
        planLabel: "Max",
        accountEmail: "me@x",
      }),
    ).toEqual({ planLabel: "Max", accountEmail: "me@x" });
    expect(usageHeading({ status: "expired" })).toEqual({
      planLabel: null,
      accountEmail: null,
    });
  });
});
