// bb-fork(windows): covers the file-based dev restart transport used on Windows.
import fs from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installDevRestartWatcher,
  requestDevSupervisorRestart,
  resolveDevRestartPath,
  takeDevSupervisorRestartRequest,
} from "../src/lib/dev-restart-windows.js";

const tempDirs: string[] = [];

async function makeRestartPath(serviceName = "server"): Promise<string> {
  const dir = await fs.mkdtemp(join(os.tmpdir(), "bb-dev-restart-windows-"));
  tempDirs.push(dir);
  return join(dir, "dev-supervisors", `${serviceName}.restart`);
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("dev restart transport on Windows", () => {
  it("writes a restart request file instead of sending SIGUSR1", async () => {
    const restartPath = await makeRestartPath();
    const kill = vi.spyOn(process, "kill");

    const transport = requestDevSupervisorRestart({
      pid: process.pid,
      platform: "win32",
      restartPath,
      serviceName: "server",
    });

    expect(transport).toBe("file");
    expect(kill).not.toHaveBeenCalled();
    await expect(fs.readFile(restartPath, "utf8")).resolves.toBe("restart");
  });

  it("sends SIGUSR1 on platforms that support it", async () => {
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);

    const transport = requestDevSupervisorRestart({
      pid: 4242,
      platform: "linux",
      serviceName: "server",
    });

    expect(transport).toBe("signal");
    expect(kill).toHaveBeenCalledWith(4242, "SIGUSR1");
  });

  it("consumes a pending request exactly once", async () => {
    const restartPath = await makeRestartPath();

    expect(
      takeDevSupervisorRestartRequest({ restartPath, serviceName: "server" }),
    ).toBe(false);

    await fs.mkdir(join(restartPath, ".."), { recursive: true });
    await fs.writeFile(restartPath, "restart", "utf8");

    expect(
      takeDevSupervisorRestartRequest({ restartPath, serviceName: "server" }),
    ).toBe(true);
    expect(
      takeDevSupervisorRestartRequest({ restartPath, serviceName: "server" }),
    ).toBe(false);
    await expect(fs.stat(restartPath)).rejects.toThrow();
  });

  it("restarts when a request appears and stops polling after cleanup", async () => {
    vi.useFakeTimers();
    const restartPath = await makeRestartPath();
    const onRestart = vi.fn();
    const stopWatching = installDevRestartWatcher({
      onRestart,
      platform: "win32",
      pollIntervalMs: 10,
      restartPath,
      serviceName: "server",
    });

    vi.advanceTimersByTime(50);
    expect(onRestart).not.toHaveBeenCalled();

    await fs.mkdir(join(restartPath, ".."), { recursive: true });
    await fs.writeFile(restartPath, "restart", "utf8");

    vi.advanceTimersByTime(10);
    expect(onRestart).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    expect(onRestart).toHaveBeenCalledTimes(1);

    stopWatching();
    await fs.writeFile(restartPath, "restart", "utf8");
    vi.advanceTimersByTime(100);
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("ignores a stale request file written before the supervisor started", async () => {
    vi.useFakeTimers();
    const restartPath = await makeRestartPath();
    await fs.mkdir(join(restartPath, ".."), { recursive: true });
    await fs.writeFile(restartPath, "restart", "utf8");
    const onRestart = vi.fn();

    const stopWatching = installDevRestartWatcher({
      onRestart,
      platform: "win32",
      pollIntervalMs: 10,
      restartPath,
      serviceName: "server",
    });

    vi.advanceTimersByTime(100);
    expect(onRestart).not.toHaveBeenCalled();
    stopWatching();
  });

  it("does not poll on platforms that use signals", async () => {
    vi.useFakeTimers();
    const restartPath = await makeRestartPath();
    const onRestart = vi.fn();

    const stopWatching = installDevRestartWatcher({
      onRestart,
      platform: "darwin",
      pollIntervalMs: 10,
      restartPath,
      serviceName: "server",
    });
    await fs.mkdir(join(restartPath, ".."), { recursive: true });
    await fs.writeFile(restartPath, "restart", "utf8");
    vi.advanceTimersByTime(100);

    expect(onRestart).not.toHaveBeenCalled();
    stopWatching();
  });

  it("resolves restart paths under the checkout dev data dir", async () => {
    const { resolveDevDataDir } =
      await import("../src/lib/dev-restart-utils.js");

    expect(resolveDevRestartPath({ serviceName: "host-daemon" })).toBe(
      join(resolveDevDataDir(), "dev-supervisors", "host-daemon.restart"),
    );
  });
});
