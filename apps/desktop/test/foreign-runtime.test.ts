import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeBbAppRuntimeFile } from "@bb/config/app-runtime-file";
import type { VerifiedProcessOps } from "@bb/config/verified-process-stop";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readForeignRuntimeDetails,
  stopForeignRuntime,
} from "../src/foreign-runtime.js";

const tempDirs: string[] = [];

async function createDataDir(): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-foreign-runtime-"));
  tempDirs.push(dataDir);
  return dataDir;
}

function createProcessOps(
  overrides: Partial<VerifiedProcessOps> = {},
): VerifiedProcessOps {
  return {
    isRunning: vi.fn(() => true),
    kill: vi.fn(),
    readCommand: vi.fn(async () => "node /opt/bb/bb-app.js start"),
    waitForExit: vi.fn(async () => true),
    ...overrides,
  };
}

async function writeRuntimeFile(args: {
  dataDir: string;
  entryPath?: string;
  pid?: number;
  serverUrl?: string;
}): Promise<void> {
  await writeBbAppRuntimeFile({
    dataDir: args.dataDir,
    entryPath: args.entryPath ?? "/opt/bb/bb-app.js",
    pid: args.pid ?? 4_242,
    serverUrl: args.serverUrl ?? "http://127.0.0.1:38886",
    startedAt: "2026-08-03T10:00:00.000Z",
    surface: "web",
    version: "0.34.0",
  });
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dataDir = tempDirs.pop();
    if (dataDir !== undefined) {
      await rm(dataDir, { force: true, recursive: true });
    }
  }
});

describe("readForeignRuntimeDetails", () => {
  it("describes the running bb when the runtime file matches the probed server", async () => {
    const dataDir = await createDataDir();
    await writeRuntimeFile({ dataDir });

    await expect(
      readForeignRuntimeDetails({
        dataDir,
        serverUrl: "http://127.0.0.1:38886",
      }),
    ).resolves.toEqual({
      dataDir,
      pid: 4_242,
      startedAt: "2026-08-03T10:00:00.000Z",
      surface: "web",
      version: "0.34.0",
    });
  });

  it("ignores a runtime file left over from a run on a different port", async () => {
    const dataDir = await createDataDir();
    await writeRuntimeFile({ dataDir, serverUrl: "http://127.0.0.1:39999" });

    await expect(
      readForeignRuntimeDetails({
        dataDir,
        serverUrl: "http://127.0.0.1:38886",
      }),
    ).resolves.toBeNull();
  });

  it("returns null for a bb that writes no runtime file", async () => {
    const dataDir = await createDataDir();

    await expect(
      readForeignRuntimeDetails({
        dataDir,
        serverUrl: "http://127.0.0.1:38886",
      }),
    ).resolves.toBeNull();
  });
});

describe("stopForeignRuntime", () => {
  it("signals the recorded process when its command line matches", async () => {
    const dataDir = await createDataDir();
    await writeRuntimeFile({ dataDir });
    const processOps = createProcessOps();

    await expect(
      stopForeignRuntime({ dataDir, processOps, timeoutMs: 1_000 }),
    ).resolves.toEqual({ kind: "stopped" });
    expect(processOps.kill).toHaveBeenCalledWith(4_242, "SIGTERM");
  });

  it("recognises a launcher that was started with a relative path", async () => {
    const dataDir = await createDataDir();
    // Node resolves argv[1] to an absolute path, but ps reports what was typed.
    await writeRuntimeFile({
      dataDir,
      entryPath: "/Users/example/bb/packages/bb-app/dist/bb-app.js",
    });
    const processOps = createProcessOps({
      readCommand: vi.fn(
        async () => "node packages/bb-app/dist/bb-app.js start",
      ),
    });

    await expect(
      stopForeignRuntime({ dataDir, processOps, timeoutMs: 1_000 }),
    ).resolves.toEqual({ kind: "stopped" });
    expect(processOps.kill).toHaveBeenCalledWith(4_242, "SIGTERM");
  });

  it("escalates to SIGKILL when the process outlives SIGTERM", async () => {
    const dataDir = await createDataDir();
    await writeRuntimeFile({ dataDir });
    const processOps = createProcessOps({
      waitForExit: vi.fn(async () => false),
    });

    await expect(
      stopForeignRuntime({ dataDir, processOps, timeoutMs: 1_000 }),
    ).resolves.toEqual({ kind: "stopped" });
    expect(processOps.kill).toHaveBeenNthCalledWith(1, 4_242, "SIGTERM");
    expect(processOps.kill).toHaveBeenNthCalledWith(2, 4_242, "SIGKILL");
  });

  it("refuses to signal a recycled pid that no longer looks like bb", async () => {
    const dataDir = await createDataDir();
    await writeRuntimeFile({ dataDir });
    const processOps = createProcessOps({
      readCommand: vi.fn(
        async () => "/Applications/Mail.app/Contents/MacOS/Mail",
      ),
    });

    await expect(
      stopForeignRuntime({ dataDir, processOps, timeoutMs: 1_000 }),
    ).resolves.toEqual({ kind: "unverified", pid: 4_242 });
    expect(processOps.kill).not.toHaveBeenCalled();
  });

  it("reports a stale record when the recorded process already exited", async () => {
    const dataDir = await createDataDir();
    await writeRuntimeFile({ dataDir });
    const processOps = createProcessOps({ isRunning: vi.fn(() => false) });

    await expect(
      stopForeignRuntime({ dataDir, processOps, timeoutMs: 1_000 }),
    ).resolves.toEqual({ kind: "not-running" });
    expect(processOps.kill).not.toHaveBeenCalled();
  });
});
