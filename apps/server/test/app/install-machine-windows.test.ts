import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INSTALL_MACHINE_WINDOWS_SCRIPT_PATH } from "../../src/install-machine-asset.js";
import { withTestHarness } from "../helpers/test-app.js";

interface WindowsInstallerOptions {
  action: "start" | "stop" | "uninstall" | null;
  bootstrapEnv: string | null;
  dataDir: string | null;
  hostDaemonPort: string | null;
  hostId: string | null;
}

interface WindowsInstallerBootstrap {
  dataDir: string | null;
  headers: Record<string, string>;
  hostId: string;
  reconnect: boolean;
  serverUrl: string;
}

interface WindowsInstallerModule {
  packageRoot(npmPrefix: string): string;
  parseArguments(argv: string[]): WindowsInstallerOptions;
  parseBootstrap(raw: string): WindowsInstallerBootstrap;
  serviceName(serverUrl: string, hostId: string): string;
  startupCommand(args: {
    dataDir: string;
    hostId: string;
    nodePath: string;
  }): string;
}

async function loadInstaller(): Promise<WindowsInstallerModule> {
  const module: WindowsInstallerModule = await import(
    new URL("../../src/assets/install-machine-windows.mjs", import.meta.url)
      .href
  );
  return module;
}

describe("Windows machine installer", () => {
  it("contains no line that would end the PowerShell here-string it is served in", () => {
    const source = readFileSync(INSTALL_MACHINE_WINDOWS_SCRIPT_PATH, "utf8");
    expect(/^'@/mu.test(source)).toBe(false);
  });

  it("accepts an install or one lifecycle action and refuses mixed arguments", async () => {
    const { parseArguments } = await loadInstaller();
    expect(parseArguments(["--bootstrap-env", "BB_ENROLLMENT"])).toMatchObject({
      action: null,
      bootstrapEnv: "BB_ENROLLMENT",
    });
    expect(
      parseArguments(["--uninstall", "--host-id", "host_1"]),
    ).toMatchObject({ action: "uninstall", hostId: "host_1" });
    expect(() => parseArguments([])).toThrow("Usage:");
    expect(() => parseArguments(["--start"])).toThrow("Usage:");
    expect(() =>
      parseArguments(["--start", "--stop", "--host-id", "host_1"]),
    ).toThrow("Usage:");
    expect(() =>
      parseArguments(["--bootstrap-env", "BB_ENROLLMENT", "--host-id", "x"]),
    ).toThrow("Usage:");
  });

  it("reads the enrollment bundle and refuses a server URL with credentials", async () => {
    const { parseBootstrap } = await loadInstaller();
    expect(
      parseBootstrap(
        JSON.stringify({
          hostId: "host_1",
          serverUrl: "https://bb.example.com/",
          headers: { "x-access": "token", ignored: 1 },
          reconnect: true,
          dataDir: "C:\\Users\\me\\.bb-machines\\bb.example.com",
        }),
      ),
    ).toEqual({
      dataDir: "C:\\Users\\me\\.bb-machines\\bb.example.com",
      headers: { "x-access": "token" },
      hostId: "host_1",
      reconnect: true,
      serverUrl: "https://bb.example.com",
    });
    expect(() =>
      parseBootstrap(
        JSON.stringify({
          hostId: "host_1",
          serverUrl: "https://user:secret@bb.example.com",
        }),
      ),
    ).toThrow("invalid server URL");
    expect(() => parseBootstrap("{")).toThrow("not valid JSON");
  });

  it("names the startup entry after the server and machine", async () => {
    const { serviceName } = await loadInstaller();
    expect(serviceName("http://127.0.0.1:38886", "host_a/b")).toBe(
      "bb-host-daemon-127-0-0-1-38886-host_a-b",
    );
  });

  it("starts the daemon at sign-in through a hidden PowerShell with quoted paths", async () => {
    const { startupCommand } = await loadInstaller();
    const command = startupCommand({
      dataDir: "C:\\Users\\O'Brien\\.bb-machines\\bb",
      hostId: "host_1",
      nodePath: "C:\\Program Files\\nodejs\\node.exe",
    });
    expect(
      command.startsWith(
        'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "& ',
      ),
    ).toBe(true);
    expect(command).toContain("'C:\\Program Files\\nodejs\\node.exe'");
    expect(command).toContain("O''Brien");
    expect(command).toContain("--start --host-id 'host_1' --data-dir");
  });

  it("serves a PowerShell error when the request carries no usable enrollment", async () => {
    await withTestHarness(async (harness) => {
      const anonymous = await harness.app.request("/install.ps1");
      expect(anonymous.status).toBe(200);
      expect(anonymous.headers.get("cache-control")).toBe("no-store");
      expect(await anonymous.text()).toMatch(/^throw 'This installer needs/u);

      const unknown = await harness.app.request("/install.ps1", {
        headers: { "X-BB-Enrollment": "bbde_unknown" },
      });
      expect(unknown.status).toBe(200);
      expect(await unknown.text()).toMatch(
        /^throw 'This enrollment command has already been used/u,
      );
    });
  });
});
