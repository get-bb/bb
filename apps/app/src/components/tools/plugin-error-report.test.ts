import { describe, expect, it } from "vitest";
import { makePluginListItem } from "@/test/fixtures/plugins";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import {
  pluginErrorReportPrompt,
  pluginErrorReportRepository,
  pluginIssueRepository,
  sanitizePluginFailure,
} from "./plugin-error-report";

describe("plugin error report preparation", () => {
  it("prepares the actual repository and failure without submitting a report", () => {
    const prompt = pluginErrorReportPrompt({
      plugin: makePluginListItem({
        id: "traces",
        name: "Traces",
        source:
          "git:https://github.com/patleeman/bb-plugins.git@^0.1.0#packages/bb-plugin-traces (tags traces/vX.Y.Z)",
        version: "0.1.4",
        status: "error",
        statusDetail:
          "Startup failed: the configured session directory does not exist.",
      }),
    });
    expect(prompt).toContain(
      "Source repository: https://github.com/patleeman/bb-plugins",
    );
    expect(prompt).toContain("Version: 0.1.4");
    expect(prompt).toContain(
      "Startup failed: the configured session directory does not exist.",
    );
    expect(prompt).toContain("check existing issues for duplicates");
    expect(prompt).toContain(
      "Do not create an issue, comment, or send anything to the author without my explicit approval of that draft.",
    );
  });

  it("uses the installed repository even when a catalog entry with the same ID points elsewhere", () => {
    const catalogEntry: PluginCatalogSearchEntry = {
      entryId: "traces",
      pluginId: "traces",
      displayName: "Traces",
      description: "Plugin fixture",
      icon: null,
      iconUrl: null,
      iconTinted: false,
      screenshots: [],
      collections: [],
      source: "git:https://github.com/another-author/traces.git",
      repositoryUrl: "https://github.com/another-author/traces",
      marketplace: "community",
      marketplaceDisplayName: "Community",
      publisherKey: "community",
      publisherLabel: "Community",
      official: false,
      author: null,
      installed: true,
      installs: null,
      compatible: true,
      incompatibleReason: null,
    };
    expect(
      pluginErrorReportRepository({
        plugin: makePluginListItem({
          id: "traces",
          catalogEntryId: "traces",
          source: "git:https://github.com/patleeman/bb-plugins.git@main",
        }),
        catalogEntry,
      }),
    ).toBe("https://github.com/patleeman/bb-plugins");
    expect(
      pluginErrorReportRepository({
        plugin: makePluginListItem({
          id: "traces",
          catalogEntryId: "traces",
          source: "git:https://gitlab.com/local-author/traces.git",
        }),
        catalogEntry,
      }),
    ).toBeNull();
  });

  it("prepares bundled plugin reports for bb and retains a failed reload reason", () => {
    const prompt = pluginErrorReportPrompt({
      plugin: makePluginListItem({
        source: "builtin:connect",
        provenance: "builtin",
        statusDetail: "reload failed: missing app bundle",
      }),
    });
    expect(prompt).toContain("Source repository: https://github.com/get-bb/bb");
    expect(prompt).toContain("reload failed: missing app bundle");
    expect(prompt).toContain("complete issue title and body for review");
  });

  it.each([
    "https://github.com.evil.test/acme/plugin",
    "https://user:secret@github.com/acme/plugin",
    "http://github.com/acme/plugin",
    "https://github.com:444/acme/plugin",
    "https://github.com/acme",
    "https://gitlab.com/acme/plugin",
  ])("rejects an unverified issue repository: %s", (url) => {
    expect(pluginIssueRepository(url)).toBeNull();
  });

  it("resolves a GitHub source subdirectory without forwarding its query", () => {
    expect(
      pluginIssueRepository(
        "https://github.com/acme/plugin/tree/HEAD/packages/tool?token=private#readme",
      ),
    ).toBe("https://github.com/acme/plugin");
  });

  it.each([
    { source: "path:/home/private/plugin", status: "error", enabled: true },
    { source: "npm:@acme/plugin", status: "error", enabled: true },
    {
      source: "git:https://github.com/acme/plugin.git@main",
      status: "running",
      enabled: true,
    },
    {
      source: "git:https://github.com/acme/plugin.git@main",
      status: "error",
      enabled: false,
    },
  ] as const)(
    "omits an ineligible report action for $source / $status",
    (overrides) => {
      expect(
        pluginErrorReportPrompt({ plugin: makePluginListItem(overrides) }),
      ).toBeNull();
    },
  );

  it("removes credentials and private paths while retaining useful failure context", () => {
    expect(
      sanitizePluginFailure(
        "Request failed at https://service.test?secret=fixture-query",
      ),
    ).toBe("Request failed at [redacted URL]");
    const detail = sanitizePluginFailure(
      'Startup failed in "/Users/private-user/Private Project/data"; API_TOKEN=fixture-secret password="fixture password" Bearer fixture-bearer at C:\\Users\\private-windows\\data https://service.test?key=fixture-url ghp_fixturetoken',
    );
    expect(detail).toContain("Startup failed");
    expect(detail).toContain("[private path]");
    expect(detail).toContain("[redacted credential]");
    for (const marker of [
      "private-user",
      "Private Project",
      "private-windows",
      "fixture-secret",
      "fixture password",
      "fixture-bearer",
      "fixture-url",
      "ghp_fixturetoken",
    ]) {
      expect(detail).not.toContain(marker);
    }
  });
});
