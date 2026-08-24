import type {
  ChildProcess,
  ExecFileException,
  ExecFileOptionsWithStringEncoding,
  SpawnOptions,
} from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

interface SpawnInvocation {
  args: readonly string[];
  command: string;
  options: SpawnOptions;
}

interface ExecFileInvocation {
  args: readonly string[] | null;
  command: string;
}

type ExecFileCallback = (
  error: ExecFileException | null,
  stdout: string,
  stderr: string,
) => void;

type ExecFileOptions = ExecFileOptionsWithStringEncoding;
type ExecFileSecondArg = readonly string[] | ExecFileOptions | null;
type ExecFileThirdArg = ExecFileOptions | ExecFileCallback | null;
type ProcessScanErrorCode = string | number;

interface ExecFilePromiseResult {
  stderr: string;
  stdout: string;
}

interface ProcessKillError extends Error {
  code: string;
}

interface SpawnMockState {
  children: ChildProcess[];
  execFileInvocations: ExecFileInvocation[];
  processScanErrorCode: ProcessScanErrorCode | null;
  invocations: SpawnInvocation[];
  tempDirs: string[];
}

interface StandaloneStateFixture {
  daemon?: {
    pid?: number | null;
  };
  instanceId?: string | null;
  parentPid?: number | null;
  paths?: {
    tmpRoot?: string | null;
  };
  server?: {
    pid?: number | null;
  };
}

interface CreateStandaloneRootArgs {
  name: string;
  state: StandaloneStateFixture;
  tmpDir: string;
}

function createSpawnMockState(): SpawnMockState {
  return {
    children: [],
    execFileInvocations: [],
    processScanErrorCode: null,
    invocations: [],
    tempDirs: [],
  };
}

const spawnMockState = vi.hoisted(createSpawnMockState);

function createProcessKillError(code: string): ProcessKillError {
  return Object.assign(new Error(`kill ${code}`), { code });
}

function useIsolatedStandaloneTmpDir(): string {
  const tempDir = mkdtempSync(path.join(tmpdir(), "standalone-cleanup-test-"));
  spawnMockState.tempDirs.push(tempDir);
  vi.stubEnv("TMPDIR", tempDir);
  return tempDir;
}

function createStandaloneRoot(args: CreateStandaloneRootArgs): string {
  const tmpRoot = path.join(args.tmpDir, args.name);
  mkdirSync(tmpRoot, { recursive: true });
  writeFileSync(
    path.join(tmpRoot, "standalone-state.json"),
    JSON.stringify(args.state),
    "utf8",
  );
  return tmpRoot;
}

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();

  function execFileMock(
    command: string,
    args?: ExecFileSecondArg,
    options?: ExecFileThirdArg,
    callback?: ExecFileCallback,
  ): ChildProcess {
    const callbackArg = typeof options === "function" ? options : callback;
    const commandArgs = Array.isArray(args) ? args : null;

    spawnMockState.execFileInvocations.push({
      args: commandArgs,
      command,
    });

    const child = actual.spawn(process.execPath, ["-e", ""], {
      stdio: "ignore",
    });
    spawnMockState.children.push(child);

    const processScanErrorCode = spawnMockState.processScanErrorCode;
    if (command === "ps" && processScanErrorCode) {
      const error = Object.assign(
        new Error(`spawn ${String(processScanErrorCode)}`),
        {
          code: processScanErrorCode,
        },
      );
      queueMicrotask(() => callbackArg?.(error, "", ""));
      return child;
    }

    queueMicrotask(() => callbackArg?.(null, "", ""));
    return child;
  }

  function promisifiedExecFileMock(
    command: string,
    args?: ExecFileSecondArg,
    options?: ExecFileOptions,
  ): Promise<ExecFilePromiseResult> {
    return new Promise((resolve, reject) => {
      execFileMock(command, args, options, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stderr, stdout });
      });
    });
  }

  Object.defineProperty(execFileMock, promisify.custom, {
    value: promisifiedExecFileMock,
  });

  return {
    ...actual,
    spawn(
      command: string,
      args: readonly string[],
      options?: SpawnOptions,
    ): ChildProcess {
      spawnMockState.invocations.push({
        args,
        command,
        options: options ?? {},
      });

      const child = actual.spawn(
        process.execPath,
        ["-e", "setTimeout(() => {}, 60_000)"],
        {
          stdio: "ignore",
        },
      );
      spawnMockState.children.push(child);
      return child;
    },
    execFile: execFileMock,
  };
});

import {
  buildStandaloneRuntimeEnv,
  cleanupStandaloneOrphans,
  createHostEnrollKey,
  spawnLoggedProcess,
  startQaServer,
} from "../src/shared.js";

afterEach(() => {
  vi.restoreAllMocks();

  for (const child of spawnMockState.children) {
    child.kill();
  }
  spawnMockState.children.length = 0;
  spawnMockState.execFileInvocations.length = 0;
  spawnMockState.processScanErrorCode = null;
  spawnMockState.invocations.length = 0;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();

  for (const tempDir of spawnMockState.tempDirs) {
    rmSync(tempDir, { force: true, recursive: true });
  }
  spawnMockState.tempDirs.length = 0;
});

describe("spawnLoggedProcess", () => {
  it("detaches standalone processes from the wrapper lifecycle", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "spawn-logged-process-"));
    spawnMockState.tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "process.log");

    const child = spawnLoggedProcess({
      args: ["apps/server/dist/index.js"],
      command: process.execPath,
      cwd: "/repo",
      env: {
        PATH: process.env.PATH ?? "",
      },
      logPath,
    });

    expect(child.pid).toBeGreaterThan(0);
    expect(spawnMockState.invocations).toHaveLength(1);
    expect(spawnMockState.invocations[0]?.command).toBe(process.execPath);
    expect(spawnMockState.invocations[0]?.args).toEqual([
      "apps/server/dist/index.js",
    ]);
    expect(spawnMockState.invocations[0]?.options.cwd).toBe("/repo");
    expect(spawnMockState.invocations[0]?.options.detached).toBe(true);
  });

  it("keeps standalone server runtime env isolated from inherited bb and ambient OpenAI env", async () => {
    vi.stubEnv("BB_APP_URL", "https://inherited-app.example.test");
    vi.stubEnv("BB_DATA_DIR", "/Users/example/.bb-dev");
    vi.stubEnv("BB_SERVER_PORT", "3334");
    vi.stubEnv("OPENAI_API_KEY", "ambient-openai-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );

    await startQaServer({
      dataDir: "/tmp/standalone-server-data",
      env: buildStandaloneRuntimeEnv({
        baseEnv: process.env,
        overrides: {
          BB_DATA_DIR: "/tmp/leaked-data-dir",
          BB_SERVER_PORT: "9999",
        },
      }),
      logPath: "/tmp/standalone-server.log",
      port: 4567,
    });

    expect(spawnMockState.invocations[0]?.options.env).toMatchObject({
      BB_DATA_DIR: "/tmp/standalone-server-data",
      BB_SERVER_PORT: "4567",
    });
    expect(
      spawnMockState.invocations[0]?.options.env?.OPENAI_API_KEY,
    ).toBeUndefined();
    expect(
      spawnMockState.invocations[0]?.options.env?.BB_APP_URL,
    ).toBeUndefined();
    expect(
      spawnMockState.invocations[0]?.options.env?.BB_EXTERNAL_URL,
    ).toBeUndefined();
  });

  it("uses the public tunnel URL as app and external URL when provided", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );

    await startQaServer({
      dataDir: "/tmp/standalone-server-data",
      logPath: "/tmp/standalone-server.log",
      port: 4567,
      publicUrl: "https://standalone-public.example.test",
    });

    expect(spawnMockState.invocations[0]?.options.env).toMatchObject({
      BB_APP_URL: "https://standalone-public.example.test",
      BB_EXTERNAL_URL: "https://standalone-public.example.test",
    });
  });

  it("requests a local host enroll key for standalone host bootstrap", async () => {
    let capturedBody: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = typeof init?.body === "string" ? init.body : null;
        return new Response(
          JSON.stringify({
            enrollKey: "bbde_standalone",
            expiresAt: Date.now() + 60_000,
            hostId: "host_standalone",
          }),
          {
            headers: {
              "content-type": "application/json",
            },
            status: 201,
          },
        );
      }),
    );

    await expect(
      createHostEnrollKey("http://127.0.0.1:4567"),
    ).resolves.toMatchObject({
      enrollKey: "bbde_standalone",
      hostId: "host_standalone",
    });
    expect(capturedBody).toBe(JSON.stringify({}));
  });
});

describe("cleanupStandaloneOrphans", () => {
  const processScanErrorCodes: readonly ProcessScanErrorCode[] = [
    "EPERM",
    "EACCES",
    1,
  ];

  it.each(processScanErrorCodes)(
    "warns and continues when process enumeration is blocked with %s",
    async (errorCode) => {
      useIsolatedStandaloneTmpDir();
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      spawnMockState.processScanErrorCode = errorCode;

      await expect(cleanupStandaloneOrphans()).resolves.toMatchObject({
        killedPids: [],
        removedRoots: [],
      });
      expect(spawnMockState.execFileInvocations).toContainEqual({
        args: ["eww", "-Ao", "pid=,command="],
        command: "ps",
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          `skipped standalone QA process enumeration (code ${String(errorCode)})`,
        ),
      );
    },
  );

  it("skips a standalone root whose parent process exists but is not signalable", async () => {
    const tmpDir = useIsolatedStandaloneTmpDir();
    const tmpRoot = createStandaloneRoot({
      name: "bb-standalone-unowned",
      state: {
        daemon: { pid: 1111 },
        parentPid: 1,
        server: { pid: 2222 },
      },
      tmpDir,
    });
    const killedSignals: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === 1 && signal === 0) {
        throw createProcessKillError("EPERM");
      }
      killedSignals.push(`${String(pid)}:${String(signal)}`);
      return true;
    });

    await expect(cleanupStandaloneOrphans()).resolves.toMatchObject({
      killedPids: [],
      removedRoots: [],
    });
    expect(existsSync(tmpRoot)).toBe(true);
    expect(killedSignals).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("parent process 1 is not signalable"),
    );
  });

  it("removes stale standalone roots whose parent process is gone", async () => {
    const tmpDir = useIsolatedStandaloneTmpDir();
    const tmpRoot = createStandaloneRoot({
      name: "bb-standalone-owned-stale",
      state: {
        daemon: { pid: 1111 },
        parentPid: 4242,
        server: { pid: 2222 },
      },
      tmpDir,
    });
    const runningPids = new Set([1111, 2222]);
    vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === 4242 && signal === 0) {
        throw createProcessKillError("ESRCH");
      }
      if (signal === 0) {
        if (runningPids.has(pid)) {
          return true;
        }
        throw createProcessKillError("ESRCH");
      }
      runningPids.delete(pid);
      return true;
    });

    await expect(cleanupStandaloneOrphans()).resolves.toMatchObject({
      killedPids: [1111, 2222],
      removedRoots: [tmpRoot],
    });
    expect(existsSync(tmpRoot)).toBe(false);
  });
});
