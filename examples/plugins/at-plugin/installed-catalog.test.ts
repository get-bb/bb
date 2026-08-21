import { describe, expect, it } from "vitest";

import {
  type InstalledPluginRecord,
  hasAgentFacingInterface,
  isUsableInstalledTarget,
  searchInstalledPlugins,
} from "./installed-catalog";
import { decodeInstalledItemId, utf8ByteLength } from "./mention-context";

function installed(
  overrides: Partial<InstalledPluginRecord> = {},
): InstalledPluginRecord {
  return {
    app: { bundle: null, hasApp: false },
    capabilities: [],
    cliCommand: null,
    description: "Plugin description",
    enabled: true,
    handlerStats: { count: 0, errorCount: 0, maxMs: 0, totalMs: 0 },
    hasSettings: false,
    icon: null,
    iconUrl: null,
    id: "example",
    isOrphanedBuiltin: false,
    logoDarkUrl: null,
    logoUrl: null,
    name: "Example",
    provenance: "direct",
    publisherLabel: null,
    rootDir: "/plugins/example",
    schedules: [],
    services: [],
    source: "path:/plugins/example",
    sourceDisplay: "/plugins/example",
    status: "running",
    statusDetail: null,
    updateState: {},
    version: "1.0.0",
    ...overrides,
  };
}

function capability(
  kind: InstalledPluginRecord["capabilities"][number]["kind"],
): InstalledPluginRecord["capabilities"][number] {
  return { detail: null, id: `${kind}-id`, kind, label: kind };
}

describe("Installed eligibility", () => {
  it("accepts running CLI, skill, and agent-tool plugins", () => {
    const cli = installed({
      cliCommand: { name: "example", summary: "Run it" },
    });
    const skill = installed({ capabilities: [capability("skill")] });
    const tool = installed({ capabilities: [capability("agent-tool")] });

    expect([cli, skill, tool].every(hasAgentFacingInterface)).toBe(true);
    expect(
      [cli, skill, tool].every((plugin) =>
        isUsableInstalledTarget(plugin, "at-plugin"),
      ),
    ).toBe(true);
  });

  it("rejects every non-running status", () => {
    const statuses: InstalledPluginRecord["status"][] = [
      "needs-configuration",
      "degraded",
      "disabled",
      "error",
      "incompatible",
      "missing",
    ];
    const plugins = statuses.map((status) =>
      installed({
        id: status,
        name: status,
        status,
        capabilities: [capability("skill")],
      }),
    );

    expect(searchInstalledPlugins(plugins, "", "at-plugin")).toEqual([]);
  });

  it("rejects self and UI, theme, thread-integration, or unavailable targets", () => {
    const plugins = [
      installed({ id: "at-plugin", capabilities: [capability("skill")] }),
      installed({ id: "ui-only", app: { bundle: null, hasApp: true } }),
      installed({ id: "theme-only", capabilities: [capability("theme")] }),
      installed({
        id: "mention-only",
        capabilities: [capability("thread-integration")],
      }),
      installed({ id: "nothing" }),
    ];

    expect(searchInstalledPlugins(plugins, "", "at-plugin")).toEqual([]);
  });
});

describe("Installed discovery", () => {
  it("matches name, id, and description case-insensitively after normalization", () => {
    const plugins = [
      installed({
        id: "alpha-id",
        name: " Alpha\tPlugin ",
        capabilities: [capability("skill")],
      }),
      installed({
        id: "beta-id",
        name: "Beta",
        description: "Works with\nFROBNICATORS",
        capabilities: [capability("agent-tool")],
      }),
    ];

    expect(
      searchInstalledPlugins(plugins, "alpha plugin", "at-plugin").map(
        (item) => item.title,
      ),
    ).toEqual(["Alpha Plugin"]);
    expect(
      searchInstalledPlugins(plugins, "BETA-ID", "at-plugin").map(
        (item) => item.title,
      ),
    ).toEqual(["Beta"]);
    expect(
      searchInstalledPlugins(plugins, "frob", "at-plugin").map(
        (item) => item.title,
      ),
    ).toEqual(["Beta"]);
  });

  it("ranks exact name/id, then prefix, then substring with deterministic ties", () => {
    const plugins = [
      installed({
        id: "z-substring",
        name: "The Git Helper",
        capabilities: [capability("skill")],
      }),
      installed({
        id: "git",
        name: "Zulu",
        capabilities: [capability("skill")],
      }),
      installed({
        id: "prefix",
        name: "Git Alpha",
        capabilities: [capability("skill")],
      }),
      installed({
        id: "exact-name",
        name: "Git",
        capabilities: [capability("skill")],
      }),
      installed({
        id: "prefix-two",
        name: "Git Beta",
        capabilities: [capability("skill")],
      }),
    ];

    expect(
      searchInstalledPlugins(plugins, "git", "at-plugin").map(
        (item) => item.title,
      ),
    ).toEqual(["Git", "Zulu", "Git Alpha", "Git Beta", "The Git Helper"]);
  });

  it("disambiguates duplicate normalized names with stable ids", () => {
    const plugins = [
      installed({
        id: "github-one",
        name: "Git   Hub",
        description: "First",
        capabilities: [capability("skill")],
      }),
      installed({
        id: "github-two",
        name: "git hub",
        description: "Second",
        capabilities: [capability("skill")],
      }),
    ];

    const items = searchInstalledPlugins(plugins, "", "at-plugin");
    expect(items).toHaveLength(2);
    expect(items[0]?.subtitle).toMatch(/^github-one · First$/);
    expect(items[1]?.subtitle).toMatch(/^github-two · Second$/);
  });

  it("sanitizes and bounds host-visible fields and preserves stable identity", () => {
    const plugin = installed({
      id: "safe:id%一",
      name: `\u0000  Name\n${"😀".repeat(100)}`,
      description: `\u0085Description\t${"界".repeat(200)}`,
      capabilities: [capability("skill")],
    });
    const [item] = searchInstalledPlugins([plugin], "", "at-plugin");

    expect(item?.title).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
    expect(item?.subtitle).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
    expect(utf8ByteLength(item?.title ?? "")).toBeLessThanOrEqual(120);
    expect(utf8ByteLength(item?.subtitle ?? "")).toBeLessThanOrEqual(240);
    expect(decodeInstalledItemId(item?.id ?? "")).toEqual({
      pluginId: "safe:id%一",
    });
  });

  it("returns at most six rows", () => {
    const plugins = Array.from({ length: 9 }, (_, index) =>
      installed({
        id: `plugin-${index}`,
        name: `Plugin ${index}`,
        capabilities: [capability("skill")],
      }),
    );

    expect(searchInstalledPlugins(plugins, "", "at-plugin")).toHaveLength(6);
  });
});
