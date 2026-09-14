// bb-fork(windows): covers the file-based dev supervisor control transport on Windows.
import fs from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeDevSupervisorRequest,
  installDevRestartWatcher,
  installDevStopWatcher,
  requestDevSupervisorRestart,
  requestDevSupervisorStop,
  resolveDevRestartPath,
  resolveDevStopPath,
} from "../src/lib/dev-supervisor-windows.js";

const tempDirs: string[] = [];

async function makeRequestPath(
  serviceName = "server",
  suffix = ".restart",
): Promise<string> {
  const dir = await fs.mkdtemp(join(os.tmpdir(), "bb-dev-supervisor-windows-"));
  tempDirs.push(dir);
  return join(dir, "dev-supervisors", `${serviceName}${suffix}`);
}

async function writeRequestFile(path: string): Promise<void> {
  await fs.mkdir(join(path, ".."), { recursive: true });
  await fs.writeFile(path, "request", "utf8");
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

describe("dev supervisor restart transport on Windows", () => {
  it("writes a restart request file instead of sending SIGUSR1", async () => {
    const restartPath = await makeRequestPath();
    const kill = vi.spyOn(process, "kill");

    const transport = requestDevSupervisorRestart({
      pid: process.pid,
      platform: "win32",
      restartPath,
      serviceName: "server",
    });

    expect(transport).toBe("file");
    expect(kill).not.toHaveBeenCalled();
    await expect(fs.readFile(restartPath, "utf8")).resolves.toBe("request");
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
    const restartPath = await makeRequestPath();

    expect(consumeDevSupervisorRequest(restartPath)).toBe(false);

    await writeRequestFile(restartPath);

    expect(consumeDevSupervisorRequest(restartPath)).toBe(true);
    expect(consumeDevSupervisorRequest(restartPath)).toBe(false);
    await expect(fs.stat(restartPath)).rejects.toThrow();
  });

  it("restarts when a request appears and stops polling after cleanup", async () => {
    vi.useFakeTimers();
    const restartPath = await makeRequestPath();
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

    await writeRequestFile(restartPath);

    vi.advanceTimersByTime(10);
    expect(onRestart).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    expect(onRestart).toHaveBeenCalledTimes(1);

    stopWatching();
    await writeRequestFile(restartPath);
    vi.advanceTimersByTime(100);
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("ignores a stale request file written before the supervisor started", async () => {
    vi.useFakeTimers();
    const restartPath = await makeRequestPath();
    await writeRequestFile(restartPath);
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
    const restartPath = await makeRequestPath();
    const onRestart = vi.fn();

    const stopWatching = installDevRestartWatcher({
      onRestart,
      platform: "darwin",
      pollIntervalMs: 10,
      restartPath,
      serviceName: "server",
    });
    await writeRequestFile(restartPath);
    vi.advanceTimersByTime(100);

    expect(onRestart).not.toHaveBeenCalled();
    stopWatching();
  });

  it("ignores restart requests for an unnamed service", async () => {
    vi.useFakeTimers();
    const onRestart = vi.fn();

    const stopWatching = installDevRestartWatcher({
      onRestart,
      platform: "win32",
      pollIntervalMs: 10,
      serviceName: "",
    });

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

describe("dev supervisor stop transport on Windows", () => {
  it("writes a stop request file", async () => {
    const stopPath = await makeRequestPath("host-daemon", ".stop");

    requestDevSupervisorStop({ serviceName: "host-daemon", stopPath });

    await expect(fs.readFile(stopPath, "utf8")).resolves.toBe("request");
  });

  it("stops the supervisor when a stop request appears", async () => {
    vi.useFakeTimers();
    const stopPath = await makeRequestPath("server", ".stop");
    const onStop = vi.fn();
    const stopWatching = installDevStopWatcher({
      onStop,
      platform: "win32",
      pollIntervalMs: 10,
      serviceName: "server",
      stopPath,
    });

    vi.advanceTimersByTime(50);
    expect(onStop).not.toHaveBeenCalled();

    await writeRequestFile(stopPath);

    vi.advanceTimersByTime(10);
    expect(onStop).toHaveBeenCalledTimes(1);

    stopWatching();
  });

  it("consumes a stop request written before the supervisor started", async () => {
    vi.useFakeTimers();
    const stopPath = await makeRequestPath("server", ".stop");
    await writeRequestFile(stopPath);
    const onStop = vi.fn();

    const stopWatching = installDevStopWatcher({
      onStop,
      platform: "win32",
      pollIntervalMs: 10,
      serviceName: "server",
      stopPath,
    });

    vi.advanceTimersByTime(100);
    expect(onStop).not.toHaveBeenCalled();
    await expect(fs.stat(stopPath)).rejects.toThrow();
    stopWatching();
  });

  it("does not poll on platforms that use signals", async () => {
    vi.useFakeTimers();
    const stopPath = await makeRequestPath("server", ".stop");
    const onStop = vi.fn();

    const stopWatching = installDevStopWatcher({
      onStop,
      platform: "linux",
      pollIntervalMs: 10,
      serviceName: "server",
      stopPath,
    });
    await writeRequestFile(stopPath);
    vi.advanceTimersByTime(100);

    expect(onStop).not.toHaveBeenCalled();
    stopWatching();
  });

  it("resolves stop paths under the checkout dev data dir", async () => {
    const { resolveDevDataDir } =
      await import("../src/lib/dev-restart-utils.js");

    expect(resolveDevStopPath({ serviceName: "server" })).toBe(
      join(resolveDevDataDir(), "dev-supervisors", "server.stop"),
    );
  });
});
