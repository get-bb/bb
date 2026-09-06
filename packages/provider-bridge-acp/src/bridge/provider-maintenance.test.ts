import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CURSOR_ACP_MAINTENANCE,
  __testing,
  cursorAuthFilePath,
  cursorStateDatabasePath,
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

describe("Cursor auth and state paths", () => {
  const appData = "C:\\Users\\u\\AppData\\Roaming";

  it("reads auth.json from APPDATA on win32", () => {
    let homedirCalls = 0;
    expect(
      cursorAuthFilePath({
        platform: "win32",
        env: { APPDATA: appData },
        homedir: () => {
          homedirCalls += 1;
          return "/home/u";
        },
      }),
    ).toBe(path.join(appData, "Cursor", "auth.json"));
    expect(homedirCalls).toBe(0);
  });

  it("falls back to the roaming profile under the home directory on win32", () => {
    expect(
      cursorAuthFilePath({
        platform: "win32",
        env: {},
        homedir: () => "C:\\Users\\u",
      }),
    ).toBe(path.join("C:\\Users\\u", "AppData", "Roaming", "Cursor", "auth.json"));
  });

  it("reads the state database from APPDATA on win32", () => {
    expect(
      cursorStateDatabasePath({
        platform: "win32",
        env: { APPDATA: appData },
        homedir: () => "/home/u",
      }),
    ).toBe(
      path.join(appData, "Cursor", "User", "globalStorage", "state.vscdb"),
    );
  });

  it("keeps macOS auth under the home .cursor directory", () => {
    expect(
      cursorAuthFilePath({
        platform: "darwin",
        env: { XDG_CONFIG_HOME: "/xdg" },
        homedir: () => "/Users/u",
      }),
    ).toBe(path.join("/Users/u", ".cursor", "auth.json"));
  });

  it("honours XDG_CONFIG_HOME on linux and falls back to ~/.config", () => {
    expect(
      cursorAuthFilePath({
        platform: "linux",
        env: { XDG_CONFIG_HOME: "/xdg" },
        homedir: () => "/home/u",
      }),
    ).toBe(path.join("/xdg", "cursor", "auth.json"));
    expect(
      cursorAuthFilePath({
        platform: "linux",
        env: {},
        homedir: () => "/home/u",
      }),
    ).toBe(path.join("/home/u", ".config", "cursor", "auth.json"));
    expect(
      cursorStateDatabasePath({
        platform: "linux",
        env: {},
        homedir: () => "/home/u",
      }),
    ).toBe(
      path.join("/home/u", ".config", "Cursor", "User", "globalStorage", "state.vscdb"),
    );
  });
});
