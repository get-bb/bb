import { describe, expect, it } from "vitest";
import { __testing } from "./provider-maintenance.js";

function installationStatus() {
  return {
    executableName: "codex",
    executablePath: "/usr/local/bin/codex",
    installed: true,
    installSource: "npmGlobal" as const,
    currentVersion: "1.0.0",
    latestVersion: "1.1.0",
    minimumSupportedVersion: "0.136.0",
    npmPackageName: "@openai/codex",
    npmGlobalPackageVersion: "1.0.0",
    installAction: {
      kind: "update" as const,
      label: "Update" as const,
      command: "codex update",
    },
    needsUpdate: true,
    versionUnsupported: false,
  };
}

describe("Codex provider maintenance", () => {
  it("normalizes subscription windows and plan labels at the plugin boundary", () => {
    expect(
      __testing.normalizeUsage(
        {
          plan_type: "plus",
          rate_limit: {
            primary_window: {
              used_percent: 42.4,
              reset_at: 1_750_000_000,
              limit_window_seconds: 18_000,
            },
            secondary_window: {
              used_percent: 120,
              reset_at: null,
              limit_window_seconds: 604_800,
            },
          },
        },
        "codex@example.com",
      ),
    ).toEqual({
      status: "ok",
      accountEmail: "codex@example.com",
      planLabel: "Plus",
      windows: [
        {
          label: "Current session",
          usedPercent: 42,
          resetsAt: "2025-06-15T15:06:40.000Z",
        },
        { label: "Weekly limit", usedPercent: 100, resetsAt: null },
      ],
    });
  });

  it("compares the numeric core of CLI versions", () => {
    expect(__testing.compareVersions("0.135.9", "0.136.0")).toBeLessThan(0);
    expect(__testing.compareVersions("0.136.0-beta.1", "0.136.0")).toBeLessThan(
      0,
    );
    expect(__testing.compareVersions("1.0.0", "0.136.0")).toBeGreaterThan(0);
  });

  it("resolves a fresh typed update plan and rejects a stale action", () => {
    expect(
      __testing.buildProviderInstallationRun(installationStatus(), "update"),
    ).toEqual({
      available: true,
      command: {
        command: "codex",
        args: ["update"],
        displayCommand: "codex update",
      },
      verification: { kind: "version_at_least", version: "1.1.0" },
    });
    expect(
      __testing.buildProviderInstallationRun(installationStatus(), "install"),
    ).toEqual({
      available: false,
      message: "Codex install is no longer available on this host.",
    });
  });
});
