import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
interface ProcessKillError extends Error {
  code: string;
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

const tempDirs: string[] = [];

function createProcessKillError(code: string): ProcessKillError {
  return Object.assign(new Error(`kill ${code}`), { code });
}

function useIsolatedStandaloneTmpDir(): string {
  const tempDir = mkdtempSync(path.join(tmpdir(), "standalone-cleanup-test-"));
  tempDirs.push(tempDir);
  vi.stubEnv("TMPDIR", tempDir);
  return tempDir;
}

function useProcessScanFixture(tempDir: string, source: string): void {
  const psPath = path.join(tempDir, "ps");
  writeFileSync(psPath, `#!${process.execPath}\n${source}\n`, "utf8");
  chmodSync(psPath, 0o755);
  vi.stubEnv("PATH", tempDir);
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

const {
  buildStandaloneRuntimeEnv,
  cleanupStandaloneOrphans,
  createHostEnrollKey,
  spawnLoggedProcess,
  startQaServer,
} = await import("../src/shared.js");

const spawnedChildren: ReturnType<typeof spawnLoggedProcess>[] = [];
let originalExecPath: string | null = null;

function useFakeQaServerProcess(tempDir: string): void {
  originalExecPath = process.execPath;
  const serverPath = path.join(tempDir, "qa-server.mjs");
  const runnerPath = path.join(tempDir, "node");
  writeFileSync(
    serverPath,
    [
      'import { createServer } from "node:http";',
      "process.stdout.write(JSON.stringify({ appUrl: process.env.BB_APP_URL ?? null, dataDir: process.env.BB_DATA_DIR ?? null, externalUrl: process.env.BB_EXTERNAL_URL ?? null, openAi: process.env.OPENAI_API_KEY ?? null, port: process.env.BB_SERVER_PORT ?? null }));",
      'createServer((request, response) => { response.writeHead(request.url === "/api/v1/system/config" ? 200 : 404); response.end("{}"); }).listen(Number(process.env.BB_SERVER_PORT), "127.0.0.1");',
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    runnerPath,
    `#!/bin/sh\nexec ${JSON.stringify(originalExecPath)} ${JSON.stringify(serverPath)} "$@"\n`,
    "utf8",
  );
  chmodSync(runnerPath, 0o755);
  process.execPath = runnerPath;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of spawnedChildren) {
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.kill();
      });
    }
  }
  spawnedChildren.length = 0;
  if (originalExecPath !== null) {
    process.execPath = originalExecPath;
    originalExecPath = null;
  }
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();

  for (const tempDir of tempDirs) {
    rmSync(tempDir, { force: true, recursive: true });
  }
  tempDirs.length = 0;
});

describe("spawnLoggedProcess", () => {
  it("starts the requested process with the requested working directory", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "spawn-logged-process-"));
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "process.log");
    const scriptPath = path.join(tempDir, "child.mjs");
    writeFileSync(
      scriptPath,
      "process.stdout.write(JSON.stringify({ argv: process.argv.slice(1), cwd: process.cwd() }));\n",
      "utf8",
    );

    const child = spawnLoggedProcess({
      args: [scriptPath],
      command: process.execPath,
      cwd: tempDir,
      env: {
        PATH: process.env.PATH ?? "",
      },
      logPath,
    });
    spawnedChildren.push(child);
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));

    expect(child.pid).toBeGreaterThan(0);
    expect(readFileSync(logPath, "utf8")).toBe(
      JSON.stringify({ argv: [scriptPath], cwd: tempDir }),
    );
  });

  it("passes an isolated runtime environment to the standalone server", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "start-qa-server-"));
    tempDirs.push(tempDir);
    useFakeQaServerProcess(tempDir);
    vi.stubEnv("BB_APP_URL", "https://inherited-app.example.test");
    vi.stubEnv("BB_DATA_DIR", "/Users/example/.bb-dev");
    vi.stubEnv("BB_SERVER_PORT", "3334");
    vi.stubEnv("OPENAI_API_KEY", "ambient-openai-key");

    const result = await startQaServer({
      dataDir: path.join(tempDir, "server-data"),
      env: buildStandaloneRuntimeEnv({
        baseEnv: process.env,
        overrides: {
          BB_DATA_DIR: "/tmp/leaked-data-dir",
          BB_SERVER_PORT: "9999",
        },
      }),
      logPath: path.join(tempDir, "server.log"),
      port: 4567,
    });
    spawnedChildren.push(result.process);

    expect(readFileSync(path.join(tempDir, "server.log"), "utf8")).toContain(
      JSON.stringify({
        appUrl: null,
        dataDir: path.join(tempDir, "server-data"),
        externalUrl: null,
        openAi: null,
        port: "4567",
      }),
    );
  });

  it("passes the public URL to the standalone server", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "start-qa-server-"));
    tempDirs.push(tempDir);
    useFakeQaServerProcess(tempDir);

    const result = await startQaServer({
      dataDir: path.join(tempDir, "server-data"),
      logPath: path.join(tempDir, "server.log"),
      port: 4567,
      publicUrl: "https://standalone-public.example.test",
    });
    spawnedChildren.push(result.process);

    expect(readFileSync(path.join(tempDir, "server.log"), "utf8")).toContain(
      JSON.stringify({
        appUrl: "https://standalone-public.example.test",
        dataDir: path.join(tempDir, "server-data"),
        externalUrl: "https://standalone-public.example.test",
        openAi: null,
        port: "4567",
      }),
    );
  });

  it("requests a local host enroll key for standalone host bootstrap", async () => {
    let capturedBody: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = init?.body === undefined ? null : String(init.body);
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
  const processScanErrorCodes = [1];

  it.each(processScanErrorCodes)(
    "warns and continues when process enumeration is blocked with %s",
    async (errorCode) => {
      const tmpDir = useIsolatedStandaloneTmpDir();
      useProcessScanFixture(tmpDir, `process.exit(${String(errorCode)});`);
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);

      await expect(cleanupStandaloneOrphans()).resolves.toMatchObject({
        killedPids: [],
        removedRoots: [],
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
    useProcessScanFixture(tmpDir, "");
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
    useProcessScanFixture(tmpDir, "");
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
