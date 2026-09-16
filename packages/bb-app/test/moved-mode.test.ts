import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ServerImportFile,
  type ServerMovedFile,
  writeServerImportFile,
  writeServerMovedFile,
} from "@bb/server-archive";
import {
  parseLauncherArgs,
  readServerMoveMarkers,
  resolveMovedDaemonLaunch,
  runBbServer,
  runMovedMode,
  superviseBbAppStart,
  superviseFullStackProcesses,
  terminateManagedFullStackProcesses,
} from "../src/launcher.js";
import type {
  BbAppStartContext,
  DelayMillisecondsArgs,
  FullStackEntry,
  FullStackSupervisionResult,
  ManagedFullStackProcesses,
  ManagedProcessName,
  ManagedProcessRun,
  MovedModeResult,
  NamedProcessExitResult,
  ProcessExitResult,
  ServerMoveMarkers,
} from "../src/launcher.js";
import {
  startMovedResponder,
  type MovedResponder,
  type StartMovedResponderArgs,
} from "../src/moved-responder.js";

interface ControlledDelayCall {
  ms: number;
  resolve(): void;
}

interface FakeResponders {
  closes: number;
  opens: StartMovedResponderArgs[];
  start(args: StartMovedResponderArgs): Promise<MovedResponder | null>;
}

type ResolveExit = (result: NamedProcessExitResult) => void;

const MOVED_NOTICE =
  "This bb server moved to desk (https://desk.example.com). This computer now runs as a regular machine.";

const scratchDirs: string[] = [];

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

class FakeManagedProcessRun implements ManagedProcessRun {
  readonly exit: Promise<NamedProcessExitResult>;
  readonly terminationSignals: NodeJS.Signals[] = [];
  running = true;
  private resolveExit: ResolveExit = () => undefined;

  constructor(readonly processName: ManagedProcessName) {
    this.exit = new Promise<NamedProcessExitResult>((resolvePromise) => {
      this.resolveExit = resolvePromise;
    });
  }

  exitWith(result: ProcessExitResult): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.resolveExit({ processName: this.processName, result });
  }

  async terminate(signal: NodeJS.Signals): Promise<void> {
    this.terminationSignals.push(signal);
    this.exitWith({ code: null, signal });
  }
}

class ControlledDelay {
  readonly calls: ControlledDelayCall[] = [];

  delayMilliseconds(args: DelayMillisecondsArgs): Promise<void> {
    return new Promise<void>((resolvePromise) => {
      this.calls.push({ ms: args.ms, resolve: resolvePromise });
    });
  }
}

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bb-app-moved-"));
  scratchDirs.push(dir);
  return dir;
}

function createMovedFile(overrides: Partial<ServerMovedFile>): ServerMovedFile {
  return {
    version: 1,
    moveId: "move-1",
    movedAt: 1_757_000_000_000,
    fromHostId: "host-laptop",
    toHostId: "host-desk",
    toHostName: "desk",
    serverUrl: "https://desk.example.com",
    mode: "direct",
    connectHandle: null,
    oldCopyEntries: ["bb.db"],
    ...overrides,
  };
}

function createTestStartContext(): BbAppStartContext {
  return {
    appDistDir: "/tmp/bb-app-moved-test/app/dist",
    appVersion: "0.0.0-test",
    configFile: "/tmp/bb-app-moved-test/config.json",
    daemonBundleDir: "/tmp/bb-app-moved-test/host-daemon/dist",
    daemonEntry: "/tmp/bb-app-moved-test/host-daemon/dist/daemon-bundle.mjs",
    daemonLockDir: "/tmp/bb-app-moved-test/daemon.lock.lock",
    daemonLockFile: "/tmp/bb-app-moved-test/daemon.lock",
    daemonPort: 39887,
    dataDir: "/tmp/bb-app-moved-test",
    dbPath: "/tmp/bb-app-moved-test/bb.db",
    envFile: "/tmp/bb-app-moved-test/env.json",
    logDir: "/tmp/bb-app-moved-test/logs",
    packageRoot: "/tmp/bb-app-moved-test/package",
    serverEntry: "/tmp/bb-app-moved-test/server/dist/index.js",
    serverPort: 39886,
    serverUrl: "http://127.0.0.1:39886",
  };
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise<void>((resolvePromise) => {
      setTimeout(resolvePromise, 1);
    });
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForDelayCall(
  delay: ControlledDelay,
  index: number,
): Promise<ControlledDelayCall> {
  await waitFor(() => delay.calls[index] !== undefined, `delay call ${index}`);
  const call = delay.calls[index];
  if (call === undefined) {
    throw new Error(`Missing delay call ${index}`);
  }
  return call;
}

async function captureOutput(
  stream: NodeJS.WriteStream,
  run: () => Promise<void>,
): Promise<string> {
  const chunks: string[] = [];
  const write = vi.spyOn(stream, "write").mockImplementation((chunk) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  });
  try {
    await run();
  } finally {
    write.mockRestore();
  }
  return chunks.join("");
}

async function reserveFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  await new Promise<void>((resolvePromise) => {
    server.close(() => {
      resolvePromise();
    });
  });
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP address");
  }
  return address.port;
}

async function unexpectedStart(): Promise<ManagedProcessRun> {
  throw new Error("Unexpected process start");
}

class MarkerPolls {
  private readonly waiters: (() => void)[] = [];

  wait(): Promise<void> {
    return new Promise<void>((resolvePromise) => {
      this.waiters.push(resolvePromise);
    });
  }

  async settle(): Promise<void> {
    await waitFor(() => this.waiters.length > 0, "the next marker poll");
  }

  async tick(): Promise<void> {
    await this.settle();
    this.waiters.shift()?.();
  }

  async tickAndSettle(): Promise<void> {
    await this.tick();
    await this.settle();
  }
}

function createFakeResponders(): FakeResponders {
  const responders: FakeResponders = {
    closes: 0,
    opens: [],
    start: async (args) => {
      responders.opens.push(args);
      return {
        close: async () => {
          responders.closes += 1;
        },
        port: args.port,
      };
    },
  };
  return responders;
}

async function canListenOn(port: number): Promise<boolean> {
  const server = createServer();
  const listening = await new Promise<boolean>((resolvePromise) => {
    server.once("error", () => {
      resolvePromise(false);
    });
    server.listen(port, "127.0.0.1", () => {
      resolvePromise(true);
    });
  });
  if (listening) {
    await new Promise<void>((resolvePromise) => {
      server.close(() => {
        resolvePromise();
      });
    });
  }
  return listening;
}

function createImportFile(kind: ServerImportFile["kind"]): ServerImportFile {
  return {
    version: 1,
    kind,
    moveId: kind === "move" ? "move-back" : null,
    activationToken: kind === "move" ? "activation-token-0123456789" : null,
    sourceDataDir: "/home/desk/.bb-machines/laptop",
    sourceServerHostId: "host-desk",
    targetHostId: "host-laptop",
    serverUrl: "https://laptop.example.com",
    importedEntries: ["bb.db"],
    createdAt: 1_757_000_100_000,
    fixupsAppliedAt: null,
  };
}

describe("bb-app start after the server moved", () => {
  it("runs only the managed daemon and the moved responder when the lock exists at start", async () => {
    const movedFile = createMovedFile({});
    const processes: ManagedFullStackProcesses = {
      daemonRun: null,
      serverRun: null,
    };
    const daemonRuns: FakeManagedProcessRun[] = [];
    const movedDaemonFiles: ServerMovedFile[] = [];
    const responders = createFakeResponders();
    const fullStackEntries: FullStackEntry[] = [];
    let shutdownRequested = false;
    let supervisionResult: FullStackSupervisionResult | null = null;

    const output = await captureOutput(process.stdout, async () => {
      const supervision = superviseBbAppStart({
        context: createTestStartContext(),
        delayMilliseconds: async () => undefined,
        isShutdownRequested: () => shutdownRequested,
        prepareFullStack: async (entry) => {
          fullStackEntries.push(entry);
          return {
            prepareDaemon: async () => unexpectedStart,
            startServer: unexpectedStart,
          };
        },
        processes,
        readServerMoveMarkers: async () => ({
          movedFile,
          pendingMoveImport: false,
        }),
        readServerMovedFile: async () => movedFile,
        serverBindHost: "0.0.0.0",
        serverListenerUrl: "http://0.0.0.0:39886",
        shutdown: async () => {
          throw new Error("Unexpected startup failure");
        },
        startMovedDaemon: async (file) => {
          movedDaemonFiles.push(file);
          const run = new FakeManagedProcessRun("daemon");
          daemonRuns.push(run);
          processes.daemonRun = run;
          return run;
        },
        startMovedResponder: responders.start,
        waitForMarkerPoll: () => new Promise<void>(() => undefined),
      });

      await waitFor(() => daemonRuns.length === 1, "the managed daemon");
      daemonRuns[0]?.exitWith({ code: 0, signal: null });
      await waitFor(() => daemonRuns.length === 2, "the daemon restart");
      shutdownRequested = true;
      await terminateManagedFullStackProcesses({
        processes,
        signal: "SIGINT",
      });
      supervisionResult = await supervision;
    });

    expect(supervisionResult).toBe("shutdown");
    expect(fullStackEntries).toEqual([]);
    expect(movedDaemonFiles).toEqual([movedFile, movedFile]);
    expect(responders.opens).toHaveLength(1);
    expect(responders.opens[0]).toMatchObject({
      bindHost: "0.0.0.0",
      movedFile,
      port: 39886,
    });
    expect(responders.closes).toBe(1);
    expect(output.split(MOVED_NOTICE)).toHaveLength(2);
    expect(daemonRuns[1]?.terminationSignals).toEqual(["SIGINT"]);
  });

  it("releases the old server port while a move to this computer is pending and answers again after an abort", async () => {
    const lock = createMovedFile({});
    const port = await reserveFreePort();
    const processes: ManagedFullStackProcesses = {
      daemonRun: null,
      serverRun: null,
    };
    const daemonRun = new FakeManagedProcessRun("daemon");
    const polls = new MarkerPolls();
    let markers: ServerMoveMarkers = {
      movedFile: lock,
      pendingMoveImport: false,
    };
    let daemonStarts = 0;
    let shutdownRequested = false;
    let movedModeResult: MovedModeResult | null = null;

    const output = await captureOutput(process.stdout, async () => {
      const movedMode = runMovedMode({
        bindHost: "127.0.0.1",
        context: { ...createTestStartContext(), serverPort: port },
        delayMilliseconds: async () => {
          throw new Error("Unexpected daemon restart");
        },
        isShutdownRequested: () => shutdownRequested,
        movedFile: lock,
        processes,
        readServerMoveMarkers: async () => markers,
        startDaemon: async () => {
          daemonStarts += 1;
          processes.daemonRun = daemonRun;
          return daemonRun;
        },
        startResponder: startMovedResponder,
        waitForMarkerPoll: () => polls.wait(),
      });

      await polls.settle();
      expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(410);

      markers = { movedFile: lock, pendingMoveImport: true };
      await polls.tickAndSettle();
      expect(await canListenOn(port)).toBe(true);
      await polls.tickAndSettle();
      expect(await canListenOn(port)).toBe(true);

      markers = { movedFile: lock, pendingMoveImport: false };
      await polls.tickAndSettle();
      expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(410);
      expect(await canListenOn(port)).toBe(false);

      shutdownRequested = true;
      await terminateManagedFullStackProcesses({
        processes,
        signal: "SIGTERM",
      });
      movedModeResult = await movedMode;
    });

    expect(movedModeResult).toBe("shutdown");
    expect(daemonStarts).toBe(1);
    expect(daemonRun.terminationSignals).toEqual(["SIGTERM"]);
    expect(await canListenOn(port)).toBe(true);
    expect(output).toContain(
      `Released http://127.0.0.1:${port} for the server moving to this computer`,
    );
    expect(output.split("Answering at ")).toHaveLength(3);
  });

  it("leaves moved mode after activation without restarting the daemon against the old address", async () => {
    const lock = createMovedFile({});
    const processes: ManagedFullStackProcesses = {
      daemonRun: null,
      serverRun: null,
    };
    const polls = new MarkerPolls();
    const responders = createFakeResponders();
    const daemonRuns: FakeManagedProcessRun[] = [];
    const restartDelays: number[] = [];
    let markers: ServerMoveMarkers = {
      movedFile: lock,
      pendingMoveImport: false,
    };
    let movedModeResult: MovedModeResult | null = null;

    await captureOutput(process.stdout, async () => {
      const movedMode = runMovedMode({
        bindHost: "127.0.0.1",
        context: createTestStartContext(),
        delayMilliseconds: async (args) => {
          restartDelays.push(args.ms);
        },
        isShutdownRequested: () => false,
        movedFile: lock,
        processes,
        readServerMoveMarkers: async () => markers,
        startDaemon: async () => {
          const run = new FakeManagedProcessRun("daemon");
          daemonRuns.push(run);
          processes.daemonRun = run;
          return run;
        },
        startResponder: responders.start,
        waitForMarkerPoll: () => polls.wait(),
      });

      await polls.settle();
      markers = { movedFile: lock, pendingMoveImport: true };
      await polls.tickAndSettle();
      expect(responders.closes).toBe(1);

      markers = { movedFile: null, pendingMoveImport: false };
      daemonRuns[0]?.exitWith({ code: 0, signal: null });
      movedModeResult = await movedMode;
    });

    expect(movedModeResult).toBe("unlocked");
    expect(daemonRuns).toHaveLength(1);
    expect(restartDelays).toEqual([]);
    expect(responders.opens).toHaveLength(1);
    expect(responders.closes).toBe(1);
    expect(processes.daemonRun).toBeNull();
  });

  it("switches to the normal server flow when the lock is removed while the moved daemon runs", async () => {
    const lock = createMovedFile({});
    const processes: ManagedFullStackProcesses = {
      daemonRun: null,
      serverRun: null,
    };
    const polls = new MarkerPolls();
    const responders = createFakeResponders();
    const movedDaemons: FakeManagedProcessRun[] = [];
    const colocatedDaemons: FakeManagedProcessRun[] = [];
    const servers: FakeManagedProcessRun[] = [];
    const fullStackEntries: FullStackEntry[] = [];
    let markers: ServerMoveMarkers = {
      movedFile: lock,
      pendingMoveImport: false,
    };
    let shutdownRequested = false;
    let supervisionResult: FullStackSupervisionResult | null = null;

    const output = await captureOutput(process.stdout, async () => {
      const supervision = superviseBbAppStart({
        context: createTestStartContext(),
        delayMilliseconds: async () => undefined,
        isShutdownRequested: () => shutdownRequested,
        prepareFullStack: async (entry) => {
          fullStackEntries.push(entry);
          return {
            prepareDaemon: async () => async () => {
              const run = new FakeManagedProcessRun("daemon");
              colocatedDaemons.push(run);
              processes.daemonRun = run;
              return run;
            },
            startServer: async () => {
              const run = new FakeManagedProcessRun("server");
              servers.push(run);
              processes.serverRun = run;
              return run;
            },
          };
        },
        processes,
        readServerMoveMarkers: async () => markers,
        readServerMovedFile: async () => markers.movedFile,
        serverBindHost: "127.0.0.1",
        serverListenerUrl: "http://127.0.0.1:39886",
        shutdown: async () => {
          throw new Error("Unexpected startup failure");
        },
        startMovedDaemon: async () => {
          const run = new FakeManagedProcessRun("daemon");
          movedDaemons.push(run);
          processes.daemonRun = run;
          return run;
        },
        startMovedResponder: responders.start,
        waitForMarkerPoll: () => polls.wait(),
      });

      await waitFor(() => movedDaemons.length === 1, "the moved daemon");
      markers = { movedFile: null, pendingMoveImport: false };
      await polls.tick();
      await waitFor(
        () => colocatedDaemons.length === 1,
        "the co-located daemon",
      );
      shutdownRequested = true;
      await terminateManagedFullStackProcesses({
        processes,
        signal: "SIGTERM",
      });
      supervisionResult = await supervision;
    });

    expect(supervisionResult).toBe("shutdown");
    expect(movedDaemons).toHaveLength(1);
    expect(movedDaemons[0]?.terminationSignals).toEqual(["SIGTERM"]);
    expect(fullStackEntries).toEqual(["unlocked"]);
    expect(servers).toHaveLength(1);
    expect(responders.opens).toHaveLength(1);
    expect(responders.closes).toBe(1);
    expect(output).toContain(
      "The server lock was removed - starting the bb server on this computer",
    );
    expect(output).toContain("bb is ready");
  });

  it("treats only a move import as a pending move to this computer", async () => {
    const dataDir = scratchDir();
    expect(await readServerMoveMarkers({ dataDir })).toEqual({
      movedFile: null,
      pendingMoveImport: false,
    });

    const lock = createMovedFile({});
    await writeServerMovedFile(dataDir, lock);
    await writeServerImportFile(dataDir, createImportFile("manual"));
    expect(await readServerMoveMarkers({ dataDir })).toEqual({
      movedFile: lock,
      pendingMoveImport: false,
    });

    await writeServerImportFile(dataDir, createImportFile("move"));
    expect(await readServerMoveMarkers({ dataDir })).toEqual({
      movedFile: lock,
      pendingMoveImport: true,
    });
  });

  it("builds the managed daemon env from the rewritten config on every start", async () => {
    const dataDir = scratchDir();
    const movedFile = createMovedFile({
      connectHandle: "desk-handle",
      mode: "connect",
      serverUrl: "https://bb.example.com/desk",
    });
    const options = parseLauncherArgs([
      "--data-dir",
      dataDir,
      "--server-url",
      "http://127.0.0.1:39886",
      "--host-daemon-port",
      "39911",
    ]).options;
    const resolveLaunch = () =>
      resolveMovedDaemonLaunch({
        entrypointUrl: pathToFileURL("/repo/packages/bb-app/dist/bb-app.js")
          .href,
        env: {
          BB_SERVER_HEADERS: '{"x-stale":"1"}',
          BB_SERVER_URL: "http://127.0.0.1:39886",
          BB_THREAD_ID: "thr-parent",
        },
        homeDir: "/home/tester",
        movedFile,
        options,
        worktreePolicy: null,
      });

    writeFileSync(
      join(dataDir, "config.json"),
      JSON.stringify({
        serverHeaders: { "x-bb-connect-machine": "bbcm_laptop" },
        serverUrl: "https://bb.example.com/desk",
      }),
    );
    const connectLaunch = await resolveLaunch();

    expect(connectLaunch.serverUrl).toBe("https://bb.example.com/desk");
    expect(connectLaunch.context.serverUrl).toBe("https://bb.example.com/desk");
    expect(connectLaunch.context.dataDir).toBe(dataDir);
    expect(connectLaunch.context.daemonPort).toBe(39911);
    expect(connectLaunch.env).toMatchObject({
      BB_DATA_DIR: dataDir,
      BB_HOST_DAEMON_PORT: "39911",
      BB_SERVER_URL: "https://bb.example.com/desk",
    });
    expect(JSON.parse(connectLaunch.env.BB_SERVER_HEADERS ?? "null")).toEqual({
      "x-bb-connect-machine": "bbcm_laptop",
    });
    expect(connectLaunch.env.BB_THREAD_ID).toBeUndefined();

    writeFileSync(
      join(dataDir, "config.json"),
      JSON.stringify({
        serverHeaders: { "x-bb-connect-machine": "bbcm_rotated" },
        serverUrl: "https://desk.tailnet.example",
      }),
    );
    const rewrittenLaunch = await resolveLaunch();

    expect(rewrittenLaunch.serverUrl).toBe("https://desk.tailnet.example");
    expect(rewrittenLaunch.env.BB_SERVER_URL).toBe(
      "https://desk.tailnet.example",
    );
    expect(JSON.parse(rewrittenLaunch.env.BB_SERVER_HEADERS ?? "null")).toEqual(
      { "x-bb-connect-machine": "bbcm_rotated" },
    );

    writeFileSync(join(dataDir, "config.json"), JSON.stringify({}));
    const fallbackLaunch = await resolveLaunch();

    expect(fallbackLaunch.serverUrl).toBe("https://bb.example.com/desk");
    expect(fallbackLaunch.env.BB_SERVER_URL).toBe(
      "https://bb.example.com/desk",
    );
  });

  it("hands over to moved mode instead of restarting the server when the lock appears", async () => {
    let movedFile: ServerMovedFile | null = null;
    const serverRun = new FakeManagedProcessRun("server");
    const daemonRun = new FakeManagedProcessRun("daemon");
    const processes: ManagedFullStackProcesses = { daemonRun, serverRun };
    const delays: number[] = [];
    const handedOver: ServerMovedFile[] = [];

    const supervision = superviseFullStackProcesses({
      context: createTestStartContext(),
      delayMilliseconds: async (args) => {
        delays.push(args.ms);
      },
      isHealthyServerAnswering: async () => {
        throw new Error("Unexpected health probe");
      },
      isShutdownRequested: () => false,
      onServerMoved: async (file) => {
        handedOver.push(file);
        return "shutdown";
      },
      processes,
      readServerMovedFile: async () => movedFile,
      startDaemon: unexpectedStart,
      startServer: unexpectedStart,
    });

    const lock = createMovedFile({});
    movedFile = lock;
    serverRun.exitWith({ code: 0, signal: null });

    await expect(supervision).resolves.toBe("shutdown");
    expect(handedOver).toEqual([lock]);
    expect(delays).toEqual([]);
    expect(processes.serverRun).toBeNull();
  });

  it("does not restart a daemon that exited for the move before the server stops", async () => {
    const lock = createMovedFile({});
    const serverRun = new FakeManagedProcessRun("server");
    const daemonRun = new FakeManagedProcessRun("daemon");
    const processes: ManagedFullStackProcesses = { daemonRun, serverRun };
    const delay = new ControlledDelay();
    const handedOver: ServerMovedFile[] = [];

    const supervision = superviseFullStackProcesses({
      context: createTestStartContext(),
      delayMilliseconds: (args) => delay.delayMilliseconds(args),
      isHealthyServerAnswering: async () => {
        throw new Error("Unexpected health probe");
      },
      isShutdownRequested: () => false,
      onServerMoved: async (file) => {
        handedOver.push(file);
        return "shutdown";
      },
      processes,
      readServerMovedFile: async () => lock,
      startDaemon: unexpectedStart,
      startServer: unexpectedStart,
    });

    daemonRun.exitWith({ code: 0, signal: null });
    const poll = await waitForDelayCall(delay, 0);
    expect(poll.ms).toBe(1_000);
    expect(processes.daemonRun).toBeNull();
    expect(handedOver).toEqual([]);

    poll.resolve();
    await waitForDelayCall(delay, 1);
    serverRun.exitWith({ code: 0, signal: null });

    await expect(supervision).resolves.toBe("shutdown");
    expect(handedOver).toEqual([lock]);
    expect(processes.serverRun).toBeNull();
  });

  it("stops a retiring server that hangs after the move and continues into moved mode", async () => {
    const lock = createMovedFile({});
    const serverRun = new FakeManagedProcessRun("server");
    const daemonRun = new FakeManagedProcessRun("daemon");
    const processes: ManagedFullStackProcesses = { daemonRun, serverRun };
    const pollDelays: number[] = [];
    const terminationsDuringPolls: number[] = [];
    const handedOver: ServerMovedFile[] = [];
    let supervisionResult: FullStackSupervisionResult | null = null;

    const output = await captureOutput(process.stdout, async () => {
      const supervision = superviseFullStackProcesses({
        context: createTestStartContext(),
        delayMilliseconds: async (args) => {
          pollDelays.push(args.ms);
          terminationsDuringPolls.push(serverRun.terminationSignals.length);
        },
        isHealthyServerAnswering: async () => {
          throw new Error("Unexpected health probe");
        },
        isShutdownRequested: () => false,
        onServerMoved: async (file) => {
          handedOver.push(file);
          return "shutdown";
        },
        processes,
        readServerMovedFile: async () => lock,
        startDaemon: unexpectedStart,
        startServer: unexpectedStart,
      });

      daemonRun.exitWith({ code: 0, signal: null });
      supervisionResult = await supervision;
    });

    expect(supervisionResult).toBe("shutdown");
    expect(pollDelays).toEqual(Array.from({ length: 20 }, () => 1_000));
    expect(terminationsDuringPolls.every((count) => count === 0)).toBe(true);
    expect(serverRun.terminationSignals).toEqual(["SIGTERM"]);
    expect(handedOver).toEqual([lock]);
    expect(output).toContain(
      "server did not stop within 20s after the move - stopping it",
    );
  });

  it("restarts the co-located daemon when the move rolls back the lock", async () => {
    let movedFile: ServerMovedFile | null = createMovedFile({});
    const serverRun = new FakeManagedProcessRun("server");
    const daemonRun = new FakeManagedProcessRun("daemon");
    const processes: ManagedFullStackProcesses = { daemonRun, serverRun };
    const delay = new ControlledDelay();
    const restartedDaemons: FakeManagedProcessRun[] = [];
    let shutdownRequested = false;

    const supervision = superviseFullStackProcesses({
      context: createTestStartContext(),
      delayMilliseconds: (args) => delay.delayMilliseconds(args),
      isHealthyServerAnswering: async () => false,
      isShutdownRequested: () => shutdownRequested,
      onServerMoved: async () => {
        throw new Error("Unexpected server move");
      },
      processes,
      readServerMovedFile: async () => movedFile,
      startDaemon: async () => {
        const run = new FakeManagedProcessRun("daemon");
        restartedDaemons.push(run);
        processes.daemonRun = run;
        return run;
      },
      startServer: unexpectedStart,
    });

    daemonRun.exitWith({ code: 1, signal: null });
    const poll = await waitForDelayCall(delay, 0);
    expect(restartedDaemons).toHaveLength(0);
    movedFile = null;
    poll.resolve();

    await waitFor(() => restartedDaemons.length === 1, "the daemon restart");
    expect(processes.daemonRun).toBe(restartedDaemons[0]);
    expect(serverRun.running).toBe(true);

    shutdownRequested = true;
    await terminateManagedFullStackProcesses({ processes, signal: "SIGTERM" });
    await expect(supervision).resolves.toBe("shutdown");
  });

  it("replaces the loopback daemon and keeps retrying while the new server is unreachable", async () => {
    const movedFile = createMovedFile({});
    const loopbackDaemon = new FakeManagedProcessRun("daemon");
    const processes: ManagedFullStackProcesses = {
      daemonRun: loopbackDaemon,
      serverRun: null,
    };
    const delay = new ControlledDelay();
    const events: string[] = [];
    let shutdownRequested = false;
    let supervisionResult: MovedModeResult | null = null;

    const output = await captureOutput(process.stdout, async () => {
      const supervision = runMovedMode({
        bindHost: "127.0.0.1",
        context: createTestStartContext(),
        delayMilliseconds: (args) => delay.delayMilliseconds(args),
        isShutdownRequested: () => shutdownRequested,
        movedFile,
        processes,
        readServerMoveMarkers: async () => ({
          movedFile,
          pendingMoveImport: false,
        }),
        waitForMarkerPoll: () => new Promise<void>(() => undefined),
        startDaemon: async () => {
          events.push(
            `start loopback-running=${String(loopbackDaemon.running)}`,
          );
          if (events.length < 4) {
            throw new Error("The new server is unreachable");
          }
          const run = new FakeManagedProcessRun("daemon");
          processes.daemonRun = run;
          return run;
        },
        startResponder: async (args) => {
          events.push("responder");
          args.onError(new Error("listen EADDRINUSE: address already in use"));
          return null;
        },
      });

      const retryDelay = await waitForDelayCall(delay, 0);
      expect(retryDelay.ms).toBe(1_000);
      retryDelay.resolve();
      await waitFor(() => processes.daemonRun !== null, "the managed daemon");
      shutdownRequested = true;
      await terminateManagedFullStackProcesses({
        processes,
        signal: "SIGTERM",
      });
      supervisionResult = await supervision;
    });

    expect(supervisionResult).toBe("shutdown");
    expect(loopbackDaemon.terminationSignals).toEqual(["SIGTERM"]);
    expect(events).toEqual([
      "responder",
      "start loopback-running=false",
      "start loopback-running=false",
      "start loopback-running=false",
    ]);
    expect(output).toContain(
      "Could not answer at http://127.0.0.1:39886 with the new server address: listen EADDRINUSE",
    );
    expect(output).toContain("Host daemon failed to start");
    expect(output).toContain("Host daemon restarted");
  });
});

describe("bb-server after the server moved", () => {
  async function bbServerArgs(dataDir: string): Promise<string[]> {
    return [
      "--data-dir",
      dataDir,
      "--server-port",
      String(await reserveFreePort()),
      "--host-daemon-port",
      String(await reserveFreePort()),
      "--server-bind-host",
      "192.0.2.1",
    ];
  }

  it.each([{ importKind: null }, { importKind: "manual" as const }])(
    "refuses to start with exit code 3 when the import marker is $importKind",
    async ({ importKind }) => {
      const dataDir = scratchDir();
      await writeServerMovedFile(dataDir, createMovedFile({}));
      if (importKind !== null) {
        await writeServerImportFile(dataDir, createImportFile(importKind));
      }
      const args = await bbServerArgs(dataDir);
      const previousExitCode = process.exitCode;

      try {
        const stderr = await captureOutput(process.stderr, () =>
          runBbServer(args),
        );

        expect(process.exitCode).toBe(3);
        expect(stderr).toBe(`${MOVED_NOTICE}\n`);
      } finally {
        process.exitCode = previousExitCode;
      }
    },
  );

  it("lets the pending server of a move back to this computer start", async () => {
    const dataDir = scratchDir();
    await writeServerMovedFile(dataDir, createMovedFile({}));
    await writeServerImportFile(dataDir, createImportFile("move"));
    const args = await bbServerArgs(dataDir);
    const previousExitCode = process.exitCode;

    try {
      await expect(runBbServer(args)).rejects.toThrow(
        'BB_SERVER_BIND_HOST must be "127.0.0.1" or "0.0.0.0"',
      );
      expect(process.exitCode).toBe(previousExitCode);
    } finally {
      process.exitCode = previousExitCode;
    }
  });
});
