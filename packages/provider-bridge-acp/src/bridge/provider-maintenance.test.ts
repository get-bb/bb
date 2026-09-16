import { describe, expect, it } from "vitest";
import {
  CURSOR_ACP_MAINTENANCE,
  GROK_ACP_MAINTENANCE,
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
  it("normalizes Cursor plan and spend limits without reading daemon state", () => {
    expect(
      __testing.normalizeUsage(
        {
          billingCycleEnd: "1767225600000",
          planUsage: { totalPercentUsed: 72.2 },
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
          label: "Plan usage",
          usedPercent: 72,
          resetsAt: "2026-01-01T00:00:00.000Z",
        },
        {
          label: "On-demand spend",
          usedPercent: 25,
          resetsAt: "2026-01-01T00:00:00.000Z",
          cost: { usedUsdCents: 1250, limitUsdCents: 5000 },
        },
      ],
    });
  });

  it("normalizes Grok weekly credits and on-demand spend without reading daemon state", () => {
    expect(
      __testing.normalizeGrokUsage(
        {
          config: {
            currentPeriod: {
              type: "USAGE_PERIOD_TYPE_WEEKLY",
              end: "2026-09-16T14:39:40.999842+00:00",
            },
            creditUsagePercent: 7.4,
            onDemandCap: { val: 5000 },
            onDemandUsed: { val: 1250 },
            billingPeriodEnd: "2026-09-16T14:39:40.999842+00:00",
          },
        },
        { email: "grok@example.com", subscriptionTier: "SuperGrokPro" },
        "fallback@example.com",
      ),
    ).toEqual({
      status: "ok",
      accountEmail: "grok@example.com",
      planLabel: "SuperGrokPro",
      windows: [
        {
          label: "Weekly",
          usedPercent: 7,
          resetsAt: "2026-09-16T14:39:40.999Z",
        },
        {
          label: "On-demand spend",
          usedPercent: 25,
          resetsAt: "2026-09-16T14:39:40.999Z",
        },
      ],
    });
  });

  it("signs Grok usage in with grok login", () => {
    expect(GROK_ACP_MAINTENANCE.loginCommand).toBe("grok login");
  });

  it("treats a Grok billing payload without credits as malformed", () => {
    expect(__testing.normalizeGrokUsage({}, {}, null)).toEqual({
      status: "error",
      message: "Grok usage response was malformed.",
      planLabel: null,
      accountEmail: null,
    });
  });

  it("omits Grok on-demand spend when the cap is disabled", () => {
    expect(
      __testing.normalizeGrokUsage(
        {
          creditUsagePercent: 41,
          currentPeriod: { type: "USAGE_PERIOD_TYPE_MONTHLY" },
          onDemandCap: { val: 0 },
          onDemandUsed: { val: 0 },
        },
        {},
        "grok@example.com",
      ),
    ).toEqual({
      status: "ok",
      accountEmail: "grok@example.com",
      planLabel: null,
      windows: [
        {
          label: "Monthly",
          usedPercent: 41,
          resetsAt: null,
        },
      ],
    });
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
