import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDevInstanceConfig } from "@bb/config/runtime";
import {
  createDesktopPackageCommand,
  createDesktopRunCommand,
  resolveDesktopLaunchMode,
  resolveDesktopPackageTask,
  toDesktopLaunchProcessEnv,
} from "../src/commands/run-desktop.js";

const config = resolveDevInstanceConfig({
  homeDir: "/Users/tester",
  repoRoot: "/Users/tester/checkouts/bb",
});

describe("desktop launch mode", () => {
  it("defaults to the installed data directory and rejects unknown arguments", () => {
    expect(resolveDesktopLaunchMode([])).toBe("prod");
    expect(resolveDesktopLaunchMode(["--worktree"])).toBe("worktree");
    expect(() => resolveDesktopLaunchMode(["--worktre"])).toThrow(
      /Unknown arguments: --worktre/u,
    );
    expect(() => resolveDesktopLaunchMode(["--worktree", "--extra"])).toThrow(
      /Unknown arguments/u,
    );
  });
});

describe("desktop packaging task", () => {
  it("selects the platform packaging task and refuses unsupported platforms", () => {
    expect(resolveDesktopPackageTask("darwin")).toBe("package");
    expect(resolveDesktopPackageTask("linux")).toBe("package:linux");
    expect(() => resolveDesktopPackageTask("win32")).toThrow(
      /supported on macOS and Linux/u,
    );
    expect(createDesktopPackageCommand("darwin").args).toEqual(
      expect.arrayContaining(["run", "package", "--filter=@bb/desktop"]),
    );
  });

  it("runs the packaged app from the desktop package directory", () => {
    const command = createDesktopRunCommand();
    expect(command.cwd.endsWith("/apps/desktop")).toBe(true);
    expect(command.args[0]?.endsWith("/scripts/run-packaged-app.mjs")).toBe(
      true,
    );
  });
});

describe("desktop launch environment", () => {
  it("isolates the worktree launch onto this checkout's data directory and ports", () => {
    const env = toDesktopLaunchProcessEnv({
      baseEnv: {
        BB_DATA_DIR: "/Users/tester/.bb",
        BB_DEV_APP_PORT: "5173",
        BB_TELEMETRY: "true",
        NODE_ENV: "development",
        OPENAI_API_KEY: "test-key",
      },
      config,
      mode: "worktree",
    });

    expect(env).toMatchObject({
      BB_DATA_DIR: config.dataDir,
      BB_DESKTOP_OPEN_DEVTOOLS: "0",
      BB_DESKTOP_USER_DATA_DIR: join(config.dataDir, "desktop"),
      BB_HOST_DAEMON_PORT: String(config.ports.hostDaemonPort),
      BB_SERVER_PORT: String(config.ports.serverPort),
      BB_TELEMETRY: "false",
      NODE_ENV: "production",
      OPENAI_API_KEY: "test-key",
    });
    expect(env.BB_DATA_DIR).not.toBe("/Users/tester/.bb");
    expect(env.BB_SERVER_PORT).not.toBe("38886");
    expect(env.BB_DEV_APP_PORT).toBeUndefined();
  });

  it("keeps the worktree build off the installed Electron user data directory", () => {
    const env = toDesktopLaunchProcessEnv({
      baseEnv: {},
      config,
      mode: "worktree",
    });

    expect(env.BB_DESKTOP_USER_DATA_DIR?.startsWith(config.dataDir)).toBe(true);
    expect(env.BB_DESKTOP_USER_DATA_DIR).not.toContain("Application Support");
  });

  it("lets an explicit devtools choice survive the worktree default", () => {
    const env = toDesktopLaunchProcessEnv({
      baseEnv: { BB_DESKTOP_OPEN_DEVTOOLS: "1" },
      config,
      mode: "worktree",
    });

    expect(env.BB_DESKTOP_OPEN_DEVTOOLS).toBe("1");
  });

  it("leaves the installed data directory and ports alone without --worktree", () => {
    const env = toDesktopLaunchProcessEnv({
      baseEnv: { NODE_ENV: "development", OPENAI_API_KEY: "test-key" },
      config,
      mode: "prod",
    });

    expect(env.BB_DATA_DIR).toBeUndefined();
    expect(env.BB_SERVER_PORT).toBeUndefined();
    expect(env.BB_HOST_DAEMON_PORT).toBeUndefined();
    expect(env.BB_DESKTOP_USER_DATA_DIR).toBeUndefined();
    expect(env).toMatchObject({
      BB_DESKTOP_OPEN_DEVTOOLS: "0",
      NODE_ENV: "production",
      OPENAI_API_KEY: "test-key",
    });
  });
});
