import { describe, expect, it } from "vitest";
import {
  CURSOR_ACP_MAINTENANCE,
  GROK_ACP_MAINTENANCE,
  OPENCODE_ACP_MAINTENANCE,
  __testing,
} from "./provider-maintenance.js";

function cursorMissingInstallationStatus() {
  return {
    executableName: "cursor-agent",
    executablePath: null,
    installed: false,
    installSource: "notInstalled" as const,
    currentVersion: null,
    latestVersion: null,
    minimumSupportedVersion: null,
    npmPackageName: null,
    npmGlobalPackageVersion: null,
    installAction: {
      kind: "install" as const,
      label: "Install" as const,
      command: "install Cursor",
    },
    needsUpdate: false,
    versionUnsupported: false,
  };
}

describe("ACP provider maintenance", () => {
  it("normalizes the shared OpenCode Go allowance with the five-hour window first", () => {
    expect(
      __testing.normalizeOpenCodeUsage({
        usage: {
          rolling: { percent: 23, resetsAt: "2026-09-01T01:00:00Z" },
          weekly: { percent: 41, resetsAt: "2026-09-07T00:00:00Z" },
        },
      }),
    ).toEqual({
      status: "ok",
      accountEmail: null,
      planLabel: "Go · shared",
      windows: [
        {
          label: "Rolling (5h)",
          usedPercent: 23,
          resetsAt: "2026-09-01T01:00:00Z",
        },
        {
          label: "Weekly",
          usedPercent: 41,
          resetsAt: "2026-09-07T00:00:00Z",
        },
      ],
    });
  });

  it("normalizes Grok quota for native and remote usage clients", () => {
    expect(
      __testing.normalizeGrokUsage(
        {
          config: {
            creditUsagePercent: 12,
            currentPeriod: {
              type: "USAGE_PERIOD_TYPE_WEEKLY",
              end: "2026-09-06T00:00:00Z",
            },
          },
        },
        { subscription_tier_display: "X Premium+" },
      ),
    ).toEqual({
      status: "ok",
      accountEmail: null,
      planLabel: "X Premium+",
      windows: [
        {
          label: "Weekly limit",
          usedPercent: 12,
          resetsAt: "2026-09-06T00:00:00Z",
        },
      ],
    });
  });

  it("keeps usage-only dialects separate from installation support", () => {
    expect(OPENCODE_ACP_MAINTENANCE.readUsage).toBeTypeOf("function");
    expect(GROK_ACP_MAINTENANCE.readUsage).toBeTypeOf("function");
    expect(OPENCODE_ACP_MAINTENANCE.installer).toBeUndefined();
    expect(GROK_ACP_MAINTENANCE.installer).toBeUndefined();
  });

  it("shows Cursor included-model and other-model usage separately", () => {
    expect(
      __testing.normalizeUsage(
        {
          billingCycleEnd: "1767225600000",
          planUsage: {
            autoPercentUsed: 40.8,
            apiPercentUsed: 71.4,
            totalPercentUsed: 72.2,
            totalSpend: 17794,
            includedSpend: 7000,
            bonusSpend: 10794,
            limit: 7000,
          },
          spendLimitUsage: {
            overallUsed: "1250",
            overallLimit: "5000",
          },
        },
        { planInfo: { planName: "Pro" } },
        "cursor@example.com",
      ),
    ).toEqual({
      status: "ok",
      accountEmail: "cursor@example.com",
      planLabel: "Pro",
      windows: [
        {
          label: "Included models",
          usedPercent: 41,
          resetsAt: "2026-01-01T00:00:00.000Z",
        },
        {
          label: "Other models",
          usedPercent: 71,
          resetsAt: "2026-01-01T00:00:00.000Z",
        },
        {
          label: "Total usage",
          usedPercent: 72,
          resetsAt: "2026-01-01T00:00:00.000Z",
        },
        {
          label: "On-demand spend",
          usedPercent: 25,
          resetsAt: "2026-01-01T00:00:00.000Z",
          cost: { usedUsdCents: 1250, limitUsdCents: 5000 },
        },
        {
          label: "Bonus spend",
          usedPercent: 61,
          resetsAt: "2026-01-01T00:00:00.000Z",
          cost: { usedUsdCents: 10794, limitUsdCents: 17794 },
        },
      ],
    });
  });

  it("omits Cursor total and bonus windows when the dashboard omits them", () => {
    expect(
      __testing.normalizeUsage(
        {
          planUsage: {
            autoPercentUsed: 10,
            apiPercentUsed: 20,
          },
        },
        {},
      ).windows,
    ).toEqual([
      { label: "Included models", usedPercent: 10, resetsAt: null },
      { label: "Other models", usedPercent: 20, resetsAt: null },
    ]);
  });

  it("accepts string-encoded Cursor percentages", () => {
    expect(
      __testing.normalizeUsage(
        {
          planUsage: {
            autoPercentUsed: "10.2",
            apiPercentUsed: "100",
            totalPercentUsed: "14.2",
          },
        },
        {},
      ).windows,
    ).toEqual([
      { label: "Included models", usedPercent: 10, resetsAt: null },
      { label: "Other models", usedPercent: 100, resetsAt: null },
      { label: "Total usage", usedPercent: 14, resetsAt: null },
    ]);
  });

  it("keeps Cursor's aggregate plan usage as a legacy fallback", () => {
    expect(
      __testing.normalizeUsage(
        { planUsage: { totalPercentUsed: 72.2 } },
        { planInfo: { planName: "Pro" } },
      ).windows,
    ).toEqual([
      { label: "Plan usage", usedPercent: 72, resetsAt: null },
    ]);
  });

  it("offers the installer only through a fresh matching action", () => {
    expect(
      __testing.buildProviderInstallationRun(
        cursorMissingInstallationStatus(),
        {
          maintenance: CURSOR_ACP_MAINTENANCE,
          command: "cursor-agent",
          action: "install",
        },
      ),
    ).toMatchObject({
      available: true,
      command: { command: "sh" },
      verification: { kind: "installed" },
    });
    expect(
      __testing.buildProviderInstallationRun(
        { ...cursorMissingInstallationStatus(), installAction: null },
        { maintenance: undefined, command: "opencode", action: "install" },
      ),
    ).toEqual({
      available: false,
      message: "opencode install is not available on this host.",
    });
    expect(
      __testing.buildProviderInstallationRun(
        cursorMissingInstallationStatus(),
        {
          maintenance: undefined,
          command: "opencode",
          action: "install",
        },
      ),
    ).toEqual({
      available: false,
      message: "opencode install is not available on this host.",
    });
  });
});
