import { describe, expect, it } from "vitest";
import { __testing } from "./provider-maintenance.js";

function missingInstallationStatus() {
  return {
    executableName: "claude",
    executablePath: null,
    installed: false,
    installSource: "notInstalled" as const,
    currentVersion: null,
    latestVersion: "2.1.0",
    minimumSupportedVersion: null,
    npmPackageName: "@anthropic-ai/claude-code",
    npmGlobalPackageVersion: null,
    installAction: {
      kind: "install" as const,
      label: "Install" as const,
      command: "install Claude Code",
    },
    needsUpdate: false,
    versionUnsupported: false,
  };
}

describe("Claude Code provider maintenance", () => {
  it("normalizes aggregate and unique model-scoped usage windows", () => {
    const account = {
      email: "claude@example.com",
      subscriptionType: "Claude Max",
      apiProvider: "firstParty" as const,
    };
    expect(
      __testing.normalizeUsage(
        {
          five_hour: { utilization: 12.4, resets_at: "2026-01-02T03:04:05Z" },
          seven_day: { utilization: 55, resets_at: null },
          limits: [
            {
              kind: "weekly_scoped",
              scope: { model: { display_name: "Sonnet" } },
              percent: 30,
              resets_at: "2026-01-03T00:00:00Z",
            },
            {
              kind: "weekly_scoped",
              scope: { model: { display_name: "sonnet" } },
              percent: 80,
              resets_at: null,
            },
          ],
          model_scoped: [
            { display_name: "Sonnet", utilization: 90, resets_at: null },
            { display_name: "Opus", utilization: 40, resets_at: null },
          ],
        },
        account,
      ),
    ).toMatchObject({
      status: "ok",
      accountEmail: "claude@example.com",
      planLabel: "Max",
      plan: { id: "max", multiplier: null },
      windows: [
        { label: "Current session", usedPercent: 12 },
        { label: "Weekly limit", usedPercent: 55 },
        { label: "Sonnet", usedPercent: 30 },
      ],
    });
  });

  it.each([
    ["absent", undefined],
    ["empty", []],
    ["aggregate-only", [{ kind: "weekly_all", percent: 55 }]],
  ])("keeps per-model weekly usage when limits are %s", (_case, limits) => {
    expect(
      __testing.normalizeUsage(
        {
          five_hour: { utilization: 12, resets_at: null },
          seven_day: { utilization: 55, resets_at: null },
          limits,
          model_scoped: [
            {
              display_name: " Sonnet ",
              utilization: 23.7,
              resets_at: "2026-12-01T12:00:00Z",
            },
            { display_name: "sonnet", utilization: 80, resets_at: null },
            { display_name: "Opus", utilization: 140, resets_at: "invalid" },
            { display_name: "", utilization: 20, resets_at: null },
            { display_name: "Unknown", utilization: null, resets_at: null },
            { display_name: "Malformed", utilization: "20", resets_at: null },
            null,
          ],
        },
        { apiProvider: "firstParty" },
      ),
    ).toMatchObject({
      status: "ok",
      windows: [
        { label: "Current session", usedPercent: 12 },
        { label: "Weekly limit", usedPercent: 55 },
        {
          kind: "weekly",
          model: "sonnet",
          label: "Sonnet",
          usedPercent: 24,
          resetsAt: "2026-12-01T12:00:00.000Z",
        },
        {
          kind: "weekly",
          model: "opus",
          label: "Opus",
          usedPercent: 100,
          resetsAt: null,
        },
      ],
    });
  });

  it("keeps the native installer plan private behind the run method", () => {
    const run = __testing.buildProviderInstallationRun(
      missingInstallationStatus(),
      "install",
    );
    if (process.platform === "win32") {
      expect(run).toMatchObject({
        available: true,
        command: { command: "powershell.exe" },
        verification: { kind: "installed" },
      });
      expect(run.available && run.command.args.at(-1)).toContain(
        "https://claude.ai/install.ps1",
      );
      return;
    }
    expect(run).toMatchObject({
      available: true,
      command: { command: "sh" },
      verification: { kind: "installed" },
    });
    expect(run.available && run.command.args).toHaveLength(2);
    expect(run.available && run.command.args[1]).toContain(
      "https://claude.ai/install.sh",
    );
  });
});
