import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CURSOR_ACP_MAINTENANCE,
  __testing,
  cursorAuthFilePath,
  cursorStateDatabasePath,
  getAcpProviderHealth,
  getAcpProviderInstallationRun,
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
          probeDeps: { platform: "linux" },
        },
      ),
    ).toMatchObject({
      available: true,
      command: { command: "sh" },
      verification: { kind: "installed" },
    });
    expect(
      __testing.buildProviderInstallationRun(
        cursorMissingInstallationStatus(),
        {
          maintenance: CURSOR_ACP_MAINTENANCE,
          command: "cursor-agent",
          action: "install",
          probeDeps: { platform: "win32" },
        },
      ),
    ).toMatchObject({
      available: true,
      command: { command: "powershell.exe" },
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

describe("Windows provider discovery through injected probes", () => {
  it("resolves health through where.exe and the exact --version argv", async () => {
    const lookups: { file: string; args: string[] }[] = [];
    const commands: { command: string; args: readonly string[] }[] = [];
    const health = await getAcpProviderHealth({
      maintenance: undefined,
      command: "codex",
      probeDeps: {
        platform: "win32",
        runLookup: async (file, args) => {
          lookups.push({ file, args });
          return { stdout: "C:\\tools\\codex.cmd\r\nC:\\tools\\codex.exe\r\n" };
        },
        runCommand: async (command, args) => {
          commands.push({ command, args });
          return { stdout: "codex-cli 0.150.0\r\n", stderr: "" };
        },
      },
    });
    expect(lookups).toEqual([{ file: "where.exe", args: ["codex"] }]);
    expect(commands).toEqual([{ command: "codex", args: ["--version"] }]);
    expect(health).toMatchObject({
      supported: true,
      health: { status: "ready", installedVersion: "0.150.0" },
    });
  });

  it("reports not_installed when where.exe exits 1", async () => {
    const health = await getAcpProviderHealth({
      maintenance: undefined,
      command: "codex",
      probeDeps: {
        platform: "win32",
        runLookup: async () => {
          throw Object.assign(new Error("Command failed: where.exe codex"), {
            code: 1,
          });
        },
      },
    });
    expect(health).toMatchObject({
      supported: true,
      health: { status: "not_installed" },
    });
  });

  it("keeps a hostile command inside one lookup argv element", async () => {
    const lookups: { file: string; args: string[] }[] = [];
    await getAcpProviderHealth({
      maintenance: undefined,
      command: "codex & del C:\\temp",
      probeDeps: {
        platform: "win32",
        runLookup: async (file, args) => {
          lookups.push({ file, args });
          throw Object.assign(new Error("not found"), { code: 1 });
        },
      },
    });
    expect(lookups).toEqual([
      { file: "where.exe", args: ["codex & del C:\\temp"] },
    ]);
  });

  it("runs the win32 installer through powershell.exe, never sh", async () => {
    const run = await getAcpProviderInstallationRun({
      maintenance: CURSOR_ACP_MAINTENANCE,
      command: "cursor-agent",
      action: "install",
      probeDeps: {
        platform: "win32",
        runLookup: async () => {
          throw Object.assign(new Error("not found"), { code: 1 });
        },
      },
    });
    expect(run.available).toBe(true);
    expect(run).toMatchObject({
      command: { command: "powershell.exe" },
      verification: { kind: "installed" },
    });
    if (run.available) {
      expect(run.command.args[0]).toBe("-NoLogo");
      expect(run.command.displayCommand).toContain("powershell.exe");
    }
  });
});
