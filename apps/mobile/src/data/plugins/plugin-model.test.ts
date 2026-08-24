import type {
  InstalledPlugin,
  PluginCatalogSearchResult,
  PluginSettingDescriptor,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  groupCatalogEntries,
  normalizeMarketplaceSourceInput,
  normalizePluginSourceInput,
  pluginRemovalDescription,
  pluginRowSignal,
  pluginSettingFieldValue,
  pluginSettingsAvailability,
  pluginSettingsChanges,
  summarizePluginUpdate,
} from "./plugin-model";

function plugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    id: "github",
    source: "builtin:github",
    rootDir: "/plugins/github",
    version: "0.1.0",
    provenance: "builtin",
    isOrphanedBuiltin: false,
    publisherLabel: "BB Official",
    sourceDisplay: "builtin · github",
    updateState: {},
    enabled: true,
    description: null,
    name: "GitHub",
    icon: null,
    iconUrl: null,
    status: "running",
    statusDetail: null,
    handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
    services: [],
    schedules: [],
    cliCommand: null,
    capabilities: [],
    hasSettings: true,
    app: { hasApp: false, bundle: null },
    logoUrl: null,
    logoDarkUrl: null,
    providerIds: [],
    icons: {},
    ...overrides,
  };
}

describe("pluginRowSignal", () => {
  it("ranks a rolled-back update above runtime health above an update", () => {
    expect(
      pluginRowSignal(
        plugin({
          status: "error",
          updateState: {
            availableVersion: "2.0.0",
            lastFailure: { version: "1.9.0", at: 1, detail: "" },
          },
        }),
      ),
    ).toMatchObject({ kind: "status", label: "Update failed", tone: "error" });
    expect(
      pluginRowSignal(
        plugin({ status: "error", updateState: { availableVersion: "2.0.0" } }),
      ),
    ).toMatchObject({ kind: "status", label: "Failed" });
    expect(
      pluginRowSignal(plugin({ updateState: { availableVersion: "2.0.0" } })),
    ).toEqual({ kind: "update", version: "2.0.0" });
    expect(
      pluginRowSignal(
        plugin({ updateState: { outcome: "unavailable", detail: "no tags" } }),
      ),
    ).toMatchObject({
      kind: "status",
      label: "Needs attention",
      detail: "no tags",
    });
    expect(pluginRowSignal(plugin())).toBeNull();
  });
});

describe("pluginSettingsAvailability", () => {
  it("gates the form on enabled, then hasSettings, then a loaded factory", () => {
    expect(pluginSettingsAvailability(plugin({ hasSettings: false }))).toEqual({
      kind: "none",
    });
    // A disabled plugin reports hasSettings: false (no factory ran); that must
    // read as "enable to see", never as "no settings".
    expect(
      pluginSettingsAvailability(
        plugin({ enabled: false, status: "disabled", hasSettings: false }),
      ),
    ).toEqual({
      kind: "disabled",
    });
    expect(pluginSettingsAvailability(plugin({ status: "error" }))).toEqual({
      kind: "unavailable",
      status: "error",
    });
    expect(
      pluginSettingsAvailability(plugin({ status: "needs-configuration" })),
    ).toEqual({
      kind: "available",
    });
  });
});

const SCHEMA: Record<string, PluginSettingDescriptor> = {
  token: { type: "string", label: "Token", secret: true },
  repos: { type: "string", label: "Repos", default: "" },
  verbose: { type: "boolean", label: "Verbose", default: true },
  wait: { type: "select", label: "Wait", options: ["1h", "6h"], default: "6h" },
  project: { type: "project", label: "Project" },
};

describe("pluginSettingsChanges", () => {
  it("sends only changed keys and never an untouched or emptied secret", () => {
    const values = {
      token: { set: true },
      repos: "a/b",
      verbose: false,
      wait: "1h",
    };
    expect(
      pluginSettingsChanges(SCHEMA, values, {
        token: "",
        repos: "a/b",
        verbose: true,
        wait: "1h",
        unknown: "x",
      }),
    ).toEqual({ verbose: true });
    expect(pluginSettingsChanges(SCHEMA, values, { token: "sk-new" })).toEqual({
      token: "sk-new",
    });
  });
});

describe("pluginSettingFieldValue", () => {
  it("prefers the draft, then the typed stored value, then the default; secrets start empty", () => {
    expect(pluginSettingFieldValue(SCHEMA.verbose!, undefined, undefined)).toBe(
      true,
    );
    expect(pluginSettingFieldValue(SCHEMA.verbose!, false, undefined)).toBe(
      false,
    );
    expect(pluginSettingFieldValue(SCHEMA.verbose!, false, true)).toBe(true);
    expect(pluginSettingFieldValue(SCHEMA.wait!, undefined, undefined)).toBe(
      "6h",
    );
    expect(pluginSettingFieldValue(SCHEMA.wait!, 42, undefined)).toBe("6h");
    expect(
      pluginSettingFieldValue(SCHEMA.token!, { set: true }, undefined),
    ).toBe("");
    expect(pluginSettingFieldValue(SCHEMA.project!, "proj_1", undefined)).toBe(
      "proj_1",
    );
  });
});

describe("summarizePluginUpdate", () => {
  it("offers Apply only for an available, non-dev update", () => {
    const installed = { version: "1.0.0", display: "1.0.0" };
    expect(
      summarizePluginUpdate({
        id: "x",
        outcome: "update-available",
        installed,
        candidate: { version: "1.1.0", display: "1.1.0" },
      }),
    ).toMatchObject({ canApply: true, title: "Update available: 1.1.0" });
    expect(
      summarizePluginUpdate({
        id: "x",
        outcome: "update-available",
        devMode: true,
        installed,
        candidate: { version: "1.1.0", display: "1.1.0" },
      }),
    ).toMatchObject({ canApply: false });
    expect(
      summarizePluginUpdate({
        id: "x",
        outcome: "incompatible",
        installed,
        blocked: { version: "2.0.0", reasons: ["needs bb 1.0"] },
      }),
    ).toMatchObject({
      canApply: false,
      title: "2.0.0 needs a newer bb",
      detail: "needs bb 1.0",
    });
    expect(summarizePluginUpdate(undefined)).toBeNull();
  });
});

describe("groupCatalogEntries", () => {
  it("puts BB Official first, then marketplaces by label, keeping server order inside", () => {
    const entry = (
      overrides: Partial<PluginCatalogSearchResult>,
    ): PluginCatalogSearchResult => ({
      entryId: "e",
      pluginId: "e",
      displayName: "E",
      description: "",
      icon: null,
      iconUrl: null,
      iconTinted: false,
      category: "Misc",
      source: "npm:e",
      repositoryUrl: null,
      marketplace: "zeta",
      marketplaceDisplayName: "Zeta",
      publisherKey: "zeta",
      publisherLabel: "Zeta",
      official: false,
      author: null,
      installed: false,
      compatible: true,
      incompatibleReason: null,
      ...overrides,
    });
    const groups = groupCatalogEntries([
      entry({ entryId: "z1" }),
      entry({
        entryId: "a1",
        marketplace: "alpha",
        publisherKey: "alpha",
        publisherLabel: "Alpha",
      }),
      entry({
        entryId: "b1",
        publisherKey: "builtin",
        publisherLabel: "BB Official",
      }),
      entry({ entryId: "z2" }),
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      "BB Official",
      "Alpha",
      "Zeta",
    ]);
    expect(groups[2]?.entries.map((e) => e.entryId)).toEqual(["z1", "z2"]);
  });
});

describe("source input normalization", () => {
  it("keeps explicit plugin specs and infers npm / git / path for bare input", () => {
    expect(normalizePluginSourceInput("  git:https://x/y@v1 ")).toBe(
      "git:https://x/y@v1",
    );
    expect(normalizePluginSourceInput("https://github.com/a/b")).toBe(
      "git:https://github.com/a/b",
    );
    expect(normalizePluginSourceInput("/Users/me/plugin")).toBe(
      "path:/Users/me/plugin",
    );
    expect(normalizePluginSourceInput("@scope/bb-plugin")).toBe(
      "npm:@scope/bb-plugin",
    );
    expect(normalizePluginSourceInput("   ")).toBeNull();
  });

  it("accepts only https manifests, git and path marketplace sources", () => {
    expect(normalizeMarketplaceSourceInput("https://x/marketplace.json")).toBe(
      "https://x/marketplace.json",
    );
    expect(normalizeMarketplaceSourceInput("~/market")).toBe("path:~/market");
    expect(
      normalizeMarketplaceSourceInput("http://insecure/m.json"),
    ).toBeNull();
    expect(normalizeMarketplaceSourceInput("some words")).toBeNull();
  });
});

describe("pluginRemovalDescription", () => {
  it("states the server's deletion policy for every source kind", () => {
    // remove() deletes settings, secrets, and schedules regardless of source;
    // a local plugin's files stay, and a move (install the new path) keeps
    // its configuration.
    const local = pluginRemovalDescription(
      plugin({ source: "path:/Users/you/bb-plugin-github" }),
    );
    expect(local).toMatch(/settings, secrets, and schedules/);
    expect(local).toMatch(/files stay/);
    expect(local).toMatch(/install the new path/);
    expect(local).not.toMatch(/kept for a reinstall/);
    const managed = pluginRemovalDescription(
      plugin({ source: "npm:@example/github@^1" }),
    );
    expect(managed).toMatch(
      /installed files, settings, secrets, and schedules/,
    );
    expect(managed).not.toMatch(/kept/);
  });
});
