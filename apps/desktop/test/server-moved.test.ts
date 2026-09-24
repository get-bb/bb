import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeBbAppRuntimeFile } from "@bb/config/app-runtime-file";
import {
  SERVER_MOVED_FILE_NAME,
  writeServerMovedFile,
  type ServerMovedFile,
} from "@bb/server-archive";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyServerMove,
  createServerMovedWatcher,
  createServerMoveNoticeStore,
  ensureServerMovedRuntime,
  hasLiveBbAppLauncher,
  probeLocalServerMove,
  readServerMovedConnectCredential,
  readServerMovedLock,
  waitForCommittedServerMove,
  waitForServerMoveDestination,
  type DesktopServerMove,
  type LocalServerMoveProbe,
  type ServerMovedNotice,
} from "../src/server-moved.js";
import {
  createServerTargetStore,
  type ServerTargetFs,
} from "../src/server-target.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bb-desktop-server-moved-"));
  tempDirs.push(dir);
  return dir;
}

function movedFile(overrides: Partial<ServerMovedFile> = {}): ServerMovedFile {
  return {
    connectHandle: "laptop",
    fromHostId: "host-laptop",
    mode: "connect",
    moveId: "move-1",
    movedAt: 1_750_000_000_000,
    oldCopyEntries: ["bb.db", "attachments"],
    serverUrl: "https://laptop.getbb.app/",
    toHostId: "host-desktop",
    toHostName: "Studio desktop",
    version: 1,
    ...overrides,
  };
}

function createMemoryFs(): { files: Map<string, string>; fs: ServerTargetFs } {
  const files = new Map<string, string>();
  return {
    files,
    fs: {
      async mkdir() {
        return undefined;
      },
      async readFile(path) {
        const content = files.get(path);
        if (content === undefined) {
          throw new Error(`ENOENT: ${path}`);
        }
        return content;
      },
      async writeFile(path, data) {
        files.set(path, data);
      },
    },
  };
}

async function createStores() {
  const { files, fs } = createMemoryFs();
  const targetStore = createServerTargetStore({
    fs,
    storagePath: "/user-data/server-target.json",
  });
  await targetStore.load();
  const noticeStore = createServerMoveNoticeStore({
    fs,
    storagePath: "/user-data/server-move-notice.json",
  });
  const notices: ServerMovedNotice[] = [];
  return {
    files,
    fs,
    noticeStore,
    notices,
    showNotice(notice: ServerMovedNotice) {
      notices.push(notice);
    },
    targetStore,
  };
}

const CONNECT_MOVE: DesktopServerMove = {
  moveId: "move-1",
  target: {
    kind: "connect",
    server: {
      handle: "laptop",
      name: "Studio desktop",
      url: "https://laptop.getbb.app",
    },
  },
  toHostName: "Studio desktop",
};

const DIRECT_MOVE: DesktopServerMove = {
  moveId: "move-2",
  target: { kind: "custom", url: "https://studio.tailnet.ts.net:38886" },
  toHostName: "Studio desktop",
};

describe("readServerMovedLock", () => {
  it("returns null without a warning when the data dir has no lock", async () => {
    const dataDir = await createTempDir();
    const logWarning = vi.fn();

    await expect(readServerMovedLock({ dataDir, logWarning })).resolves.toBe(
      null,
    );
    expect(logWarning).not.toHaveBeenCalled();
  });

  it("selects the bb Connect handle for a connect move", async () => {
    const dataDir = await createTempDir();
    await writeServerMovedFile(dataDir, movedFile());

    await expect(
      readServerMovedLock({ dataDir, logWarning: vi.fn() }),
    ).resolves.toEqual({
      moveId: "move-1",
      target: {
        kind: "connect",
        server: {
          handle: "laptop",
          name: "Studio desktop",
          url: "https://laptop.getbb.app",
        },
      },
      toHostName: "Studio desktop",
    });
  });

  it("selects a custom URL for a direct move", async () => {
    const dataDir = await createTempDir();
    await writeServerMovedFile(
      dataDir,
      movedFile({
        connectHandle: null,
        mode: "direct",
        moveId: "move-2",
        serverUrl: "https://studio.tailnet.ts.net:38886/#stale",
      }),
    );

    await expect(
      readServerMovedLock({ dataDir, logWarning: vi.fn() }),
    ).resolves.toEqual(DIRECT_MOVE);
  });

  it("ignores a lock with invalid JSON and logs a warning", async () => {
    const dataDir = await createTempDir();
    await writeFile(join(dataDir, SERVER_MOVED_FILE_NAME), "{not json");
    const logWarning = vi.fn();

    await expect(readServerMovedLock({ dataDir, logWarning })).resolves.toBe(
      null,
    );
    expect(logWarning).toHaveBeenCalledOnce();
    expect(logWarning.mock.calls[0]?.[0]).toContain(
      join(dataDir, SERVER_MOVED_FILE_NAME),
    );
  });

  it("ignores a lock that does not match the contract", async () => {
    const dataDir = await createTempDir();
    const { toHostName: _toHostName, ...incomplete } = movedFile();
    await writeFile(
      join(dataDir, SERVER_MOVED_FILE_NAME),
      JSON.stringify(incomplete),
    );
    const logWarning = vi.fn();

    await expect(readServerMovedLock({ dataDir, logWarning })).resolves.toBe(
      null,
    );
    expect(logWarning).toHaveBeenCalledOnce();
  });

  it("ignores a connect move without a handle", async () => {
    const dataDir = await createTempDir();
    await writeServerMovedFile(dataDir, movedFile({ connectHandle: null }));
    const logWarning = vi.fn();

    await expect(readServerMovedLock({ dataDir, logWarning })).resolves.toBe(
      null,
    );
    expect(logWarning.mock.calls[0]?.[0]).toContain("no connectHandle");
  });

  it("ignores a direct move whose address is not http(s)", async () => {
    const dataDir = await createTempDir();
    await writeServerMovedFile(
      dataDir,
      movedFile({
        connectHandle: null,
        mode: "direct",
        serverUrl: "file:///etc/passwd",
      }),
    );
    const logWarning = vi.fn();

    await expect(readServerMovedLock({ dataDir, logWarning })).resolves.toBe(
      null,
    );
    expect(logWarning.mock.calls[0]?.[0]).toContain("not an http(s) URL");
  });
});

describe("applyServerMove", () => {
  it("switches a builtin target to the connect server and shows the notice once", async () => {
    const stores = await createStores();

    await expect(
      applyServerMove({ move: CONNECT_MOVE, ...stores }),
    ).resolves.toEqual({ noticeShown: true, switched: true });
    expect(stores.targetStore.getTarget()).toEqual({
      kind: "connect",
      server: {
        handle: "laptop",
        name: "Studio desktop",
        url: "https://laptop.getbb.app",
      },
    });
    expect(stores.notices).toEqual([
      {
        detail:
          "bb now opens the server on Studio desktop. This computer stays connected to it as a regular machine.",
        message: "Your bb server moved to Studio desktop",
      },
    ]);

    await expect(
      applyServerMove({ move: CONNECT_MOVE, ...stores }),
    ).resolves.toEqual({ noticeShown: false, switched: false });
    expect(stores.notices).toHaveLength(1);
  });

  it("switches to a custom URL for a direct move", async () => {
    const stores = await createStores();

    await applyServerMove({ move: DIRECT_MOVE, ...stores });

    expect(stores.targetStore.getTarget()).toEqual({
      kind: "custom",
      url: "https://studio.tailnet.ts.net:38886",
    });
  });

  it("remembers the shown move across app restarts", async () => {
    const stores = await createStores();
    await applyServerMove({ move: CONNECT_MOVE, ...stores });

    const restartedTargetStore = createServerTargetStore({
      fs: stores.fs,
      storagePath: "/user-data/server-target.json",
    });
    await restartedTargetStore.load();
    const restartedNotices: ServerMovedNotice[] = [];
    await applyServerMove({
      move: CONNECT_MOVE,
      noticeStore: createServerMoveNoticeStore({
        fs: stores.fs,
        storagePath: "/user-data/server-move-notice.json",
      }),
      showNotice(notice) {
        restartedNotices.push(notice);
      },
      targetStore: restartedTargetStore,
    });

    expect(restartedNotices).toEqual([]);
    expect(restartedTargetStore.getTarget().kind).toBe("connect");
  });

  it("keeps a target the user chose after the notice", async () => {
    const stores = await createStores();
    await applyServerMove({ move: CONNECT_MOVE, ...stores });
    await stores.targetStore.setCustomServerUrl("https://work.example.com");

    await expect(
      applyServerMove({ move: CONNECT_MOVE, ...stores }),
    ).resolves.toEqual({ noticeShown: false, switched: false });
    expect(stores.targetStore.getTarget()).toEqual({
      kind: "custom",
      url: "https://work.example.com",
    });
  });

  it("leaves the locked builtin server again without a second notice", async () => {
    const stores = await createStores();
    await applyServerMove({ move: CONNECT_MOVE, ...stores });
    await stores.targetStore.setTarget("builtin");

    await expect(
      applyServerMove({ move: CONNECT_MOVE, ...stores }),
    ).resolves.toEqual({ noticeShown: false, switched: true });
    expect(stores.targetStore.getTarget().kind).toBe("connect");
    expect(stores.notices).toHaveLength(1);
  });

  it("switches and notifies again for a later move", async () => {
    const stores = await createStores();
    await applyServerMove({ move: CONNECT_MOVE, ...stores });
    await stores.targetStore.setCustomServerUrl("https://work.example.com");

    await expect(
      applyServerMove({ move: DIRECT_MOVE, ...stores }),
    ).resolves.toEqual({ noticeShown: true, switched: true });
    expect(stores.targetStore.getTarget()).toEqual({
      kind: "custom",
      url: "https://studio.tailnet.ts.net:38886",
    });
    expect(stores.notices).toHaveLength(2);
  });

  it("treats an unreadable notice record as not shown", async () => {
    const stores = await createStores();
    stores.files.set("/user-data/server-move-notice.json", "{broken");

    await expect(
      applyServerMove({ move: CONNECT_MOVE, ...stores }),
    ).resolves.toEqual({ noticeShown: true, switched: true });
    expect(
      JSON.parse(stores.files.get("/user-data/server-move-notice.json") ?? ""),
    ).toEqual({ moveId: "move-1" });
  });
});

describe("ensureServerMovedRuntime", () => {
  function runtimeArgs(overrides: {
    hasLocalRuntime?: boolean;
    isLocalAddressFree?: boolean;
  }) {
    const startLocalRuntime = vi.fn(async () => undefined);
    const isLocalAddressFree = vi.fn(
      async () => overrides.isLocalAddressFree ?? true,
    );
    const logInfo = vi.fn();
    return {
      args: {
        hasLocalRuntime: () => overrides.hasLocalRuntime ?? false,
        isLocalAddressFree,
        localServerUrl: "http://127.0.0.1:38886",
        logInfo,
        startLocalRuntime,
      },
      isLocalAddressFree,
      logInfo,
      startLocalRuntime,
    };
  }

  it("starts the owned runtime when nothing runs this computer yet", async () => {
    const { args, startLocalRuntime } = runtimeArgs({});

    await expect(ensureServerMovedRuntime(args)).resolves.toBe("started");
    expect(startLocalRuntime).toHaveBeenCalledOnce();
  });

  it("keeps the runtime the app already owns or attached to", async () => {
    const { args, isLocalAddressFree, startLocalRuntime } = runtimeArgs({
      hasLocalRuntime: true,
    });

    await expect(ensureServerMovedRuntime(args)).resolves.toBe("kept");
    expect(isLocalAddressFree).not.toHaveBeenCalled();
    expect(startLocalRuntime).not.toHaveBeenCalled();
  });

  it("does not start a second launcher when another bb answers the address", async () => {
    const { args, logInfo, startLocalRuntime } = runtimeArgs({
      isLocalAddressFree: false,
    });

    await expect(ensureServerMovedRuntime(args)).resolves.toBe("external");
    expect(startLocalRuntime).not.toHaveBeenCalled();
    expect(logInfo.mock.calls[0]?.[0]).toContain("http://127.0.0.1:38886");
  });
});

describe("createServerMovedWatcher", () => {
  function createFakeWatch() {
    const listeners: Array<
      (eventType: string, filename: string | null) => void
    > = [];
    const errorListeners: Array<(error: Error) => void> = [];
    const close = vi.fn();
    const watch = vi.fn(
      (
        _dataDir: string,
        listener: (eventType: string, filename: string | null) => void,
      ) => {
        listeners.push(listener);
        return {
          close,
          on(_event: "error", errorListener: (error: Error) => void) {
            errorListeners.push(errorListener);
          },
        };
      },
    );
    return {
      close,
      emit(filename: string | null) {
        for (const listener of listeners) {
          listener("rename", filename);
        }
      },
      emitError(error: Error) {
        for (const listener of errorListeners) {
          listener(error);
        }
      },
      watch,
    };
  }

  function createManualSchedule() {
    const pending = new Set<() => void>();
    return {
      async flush() {
        const callbacks = [...pending];
        pending.clear();
        for (const callback of callbacks) {
          callback();
        }
        await settle();
      },
      pendingCount: () => pending.size,
      schedule(callback: () => void) {
        const entry = () => {
          callback();
        };
        pending.add(entry);
        return () => {
          pending.delete(entry);
        };
      },
    };
  }

  async function settle(): Promise<void> {
    await new Promise<void>((resolvePromise) => {
      setTimeout(resolvePromise, 20);
    });
  }

  function createDeferred<T>() {
    let resolveDeferred: (value: T) => void = () => undefined;
    const promise = new Promise<T>((resolvePromise) => {
      resolveDeferred = resolvePromise;
    });
    return { promise, resolve: resolveDeferred };
  }

  type ConfirmMove = (
    move: DesktopServerMove,
    isCancelled: () => boolean,
  ) => Promise<boolean>;

  async function createHarness(
    overrides: {
      confirmMove?: ConfirmMove;
      watch?: Parameters<typeof createServerMovedWatcher>[0]["watch"];
    } = {},
  ) {
    const dataDir = await createTempDir();
    const fakeWatch = createFakeWatch();
    const timers = createManualSchedule();
    const onMove = vi.fn();
    const logWarning = vi.fn();
    const confirmMove = vi.fn<ConfirmMove>(
      overrides.confirmMove ?? (async () => true),
    );
    const watcher = createServerMovedWatcher({
      confirmMove,
      dataDir,
      debounceMs: 500,
      logWarning,
      onMove,
      pollIntervalMs: 2_000,
      schedule: timers.schedule,
      watch: overrides.watch ?? fakeWatch.watch,
    });
    return {
      confirmMove,
      dataDir,
      fakeWatch,
      logWarning,
      onMove,
      timers,
      watcher,
    };
  }

  it("checks a lock that already exists when it starts", async () => {
    const harness = await createHarness();
    await writeServerMovedFile(harness.dataDir, movedFile());

    harness.watcher.start();
    await harness.timers.flush();

    expect(harness.confirmMove).toHaveBeenCalledOnce();
    expect(harness.onMove).toHaveBeenCalledExactlyOnceWith(CONNECT_MOVE);
    harness.watcher.stop();
  });

  it("debounces lock events into one committed move", async () => {
    const harness = await createHarness();
    harness.watcher.start();
    await harness.timers.flush();

    harness.fakeWatch.emit("bb.db-wal");
    expect(harness.timers.pendingCount()).toBe(0);
    await writeServerMovedFile(harness.dataDir, movedFile());
    harness.fakeWatch.emit(`${SERVER_MOVED_FILE_NAME}.abc123.tmp`);
    harness.fakeWatch.emit(SERVER_MOVED_FILE_NAME);
    harness.fakeWatch.emit(null);
    expect(harness.timers.pendingCount()).toBe(1);
    await harness.timers.flush();

    expect(harness.confirmMove).toHaveBeenCalledExactlyOnceWith(
      CONNECT_MOVE,
      expect.any(Function),
    );
    expect(harness.onMove).toHaveBeenCalledExactlyOnceWith(CONNECT_MOVE);

    harness.fakeWatch.emit(SERVER_MOVED_FILE_NAME);
    await harness.timers.flush();
    expect(harness.confirmMove).toHaveBeenCalledOnce();
    expect(harness.onMove).toHaveBeenCalledOnce();
    harness.watcher.stop();
  });

  it("does not act on a lock whose move is not committed", async () => {
    const harness = await createHarness({ confirmMove: async () => false });
    await writeServerMovedFile(harness.dataDir, movedFile());
    harness.watcher.start();
    await harness.timers.flush();

    expect(harness.confirmMove).toHaveBeenCalledOnce();
    expect(harness.onMove).not.toHaveBeenCalled();

    harness.confirmMove.mockImplementation(async () => true);
    harness.fakeWatch.emit(SERVER_MOVED_FILE_NAME);
    await harness.timers.flush();
    expect(harness.onMove).toHaveBeenCalledExactlyOnceWith(CONNECT_MOVE);
    harness.watcher.stop();
  });

  it("checks again when the lock changes during a confirmation", async () => {
    const first = createDeferred<boolean>();
    const harness = await createHarness({ confirmMove: () => first.promise });
    await writeServerMovedFile(harness.dataDir, movedFile());
    harness.watcher.start();
    await harness.timers.flush();
    await vi.waitFor(() => {
      expect(harness.confirmMove).toHaveBeenCalledOnce();
    });

    await writeServerMovedFile(
      harness.dataDir,
      movedFile({ moveId: "move-3" }),
    );
    harness.fakeWatch.emit(SERVER_MOVED_FILE_NAME);
    await harness.timers.flush();
    expect(harness.confirmMove).toHaveBeenCalledOnce();

    harness.confirmMove.mockImplementation(async () => true);
    first.resolve(false);
    await settle();
    expect(harness.onMove).not.toHaveBeenCalled();
    expect(harness.timers.pendingCount()).toBe(1);
    await harness.timers.flush();

    await vi.waitFor(() => {
      expect(harness.onMove).toHaveBeenCalledExactlyOnceWith({
        ...CONNECT_MOVE,
        moveId: "move-3",
      });
    });
    expect(harness.confirmMove).toHaveBeenCalledTimes(2);
    harness.watcher.stop();
  });

  it("logs and skips an invalid lock, then delivers the corrected one", async () => {
    const harness = await createHarness();
    harness.watcher.start();
    await harness.timers.flush();

    await writeFile(join(harness.dataDir, SERVER_MOVED_FILE_NAME), "{partial");
    harness.fakeWatch.emit(SERVER_MOVED_FILE_NAME);
    await harness.timers.flush();
    expect(harness.confirmMove).not.toHaveBeenCalled();
    expect(harness.onMove).not.toHaveBeenCalled();
    expect(harness.logWarning).toHaveBeenCalledOnce();

    await writeServerMovedFile(harness.dataDir, movedFile());
    harness.fakeWatch.emit(SERVER_MOVED_FILE_NAME);
    await harness.timers.flush();
    expect(harness.onMove).toHaveBeenCalledExactlyOnceWith(CONNECT_MOVE);
    harness.watcher.stop();
  });

  it("cancels pending checks when stopped", async () => {
    const harness = await createHarness();
    await writeServerMovedFile(harness.dataDir, movedFile());
    harness.watcher.start();

    harness.fakeWatch.emit(SERVER_MOVED_FILE_NAME);
    harness.watcher.stop();
    await harness.timers.flush();

    expect(harness.fakeWatch.close).toHaveBeenCalledOnce();
    expect(harness.confirmMove).not.toHaveBeenCalled();
    expect(harness.onMove).not.toHaveBeenCalled();
  });

  it("cancels a confirmation that is still running when stopped", async () => {
    const confirmation = createDeferred<boolean>();
    const cancellationChecks: Array<() => boolean> = [];
    const harness = await createHarness({
      confirmMove: (_move, isCancelled) => {
        cancellationChecks.push(isCancelled);
        return confirmation.promise;
      },
    });
    await writeServerMovedFile(harness.dataDir, movedFile());
    harness.watcher.start();
    await harness.timers.flush();
    expect(cancellationChecks.map((isCancelled) => isCancelled())).toEqual([
      false,
    ]);

    harness.watcher.stop();
    expect(cancellationChecks[0]?.()).toBe(true);
    confirmation.resolve(true);
    await settle();

    expect(harness.onMove).not.toHaveBeenCalled();
  });

  it("polls when the data dir cannot be watched", async () => {
    const harness = await createHarness({
      watch() {
        throw new Error(
          "ENOSPC: System limit for number of file watchers reached",
        );
      },
    });

    expect(() => harness.watcher.start()).not.toThrow();
    expect(harness.logWarning.mock.calls[0]?.[0]).toContain("ENOSPC");
    await harness.timers.flush();
    expect(harness.onMove).not.toHaveBeenCalled();

    await writeServerMovedFile(harness.dataDir, movedFile());
    await harness.timers.flush();
    await harness.timers.flush();
    expect(harness.onMove).toHaveBeenCalledExactlyOnceWith(CONNECT_MOVE);

    harness.watcher.stop();
    expect(harness.timers.pendingCount()).toBe(0);
  });

  it("closes the watcher and polls after a watch error", async () => {
    const harness = await createHarness();
    harness.watcher.start();
    await harness.timers.flush();

    harness.fakeWatch.emitError(new Error("EMFILE"));

    expect(harness.fakeWatch.close).toHaveBeenCalledOnce();
    expect(harness.logWarning.mock.calls[0]?.[0]).toContain("EMFILE");
    await writeServerMovedFile(harness.dataDir, movedFile());
    await harness.timers.flush();
    expect(harness.onMove).toHaveBeenCalledExactlyOnceWith(CONNECT_MOVE);
    harness.watcher.stop();
  });

  it("notices a lock written atomically into a real data dir", async () => {
    const dataDir = await createTempDir();
    const onMove = vi.fn();
    const watcher = createServerMovedWatcher({
      confirmMove: async () => true,
      dataDir,
      debounceMs: 50,
      logWarning: vi.fn(),
      onMove,
      pollIntervalMs: 100,
    });
    watcher.start();

    await writeFile(join(dataDir, "bb.db-wal"), "noise");
    await writeServerMovedFile(
      dataDir,
      movedFile({
        connectHandle: null,
        mode: "direct",
        moveId: "move-2",
        serverUrl: "https://studio.tailnet.ts.net:38886",
      }),
    );

    await vi.waitFor(
      () => {
        expect(onMove).toHaveBeenCalledExactlyOnceWith(DIRECT_MOVE);
      },
      { interval: 50, timeout: 8_000 },
    );
    watcher.stop();
  }, 10_000);
});

describe("waitForCommittedServerMove", () => {
  async function createCommitHarness(args: {
    live?: boolean;
    probes: LocalServerMoveProbe[];
  }) {
    const dataDir = await createTempDir();
    await writeServerMovedFile(dataDir, movedFile());
    let nowMs = 0;
    const probes = [...args.probes];
    const probeLocalServer = vi.fn(async (): Promise<LocalServerMoveProbe> =>
      probes.length > 1
        ? (probes.shift() ?? "answered")
        : (probes[0] ?? "answered"),
    );
    const hasLiveLocalLauncher = vi.fn(async () => args.live ?? false);
    const sleep = vi.fn(async (delayMs: number) => {
      nowMs += delayMs;
    });
    return {
      args: {
        dataDir,
        hasLiveLocalLauncher,
        intervalMs: 1_000,
        isCancelled: () => false,
        logWarning: vi.fn(),
        move: CONNECT_MOVE,
        now: () => nowMs,
        probeLocalServer,
        sleep,
        timeoutMs: 120_000,
      },
      dataDir,
      hasLiveLocalLauncher,
      probeLocalServer,
      sleep,
    };
  }

  it("commits once the local address answers with the moved responder", async () => {
    const harness = await createCommitHarness({
      probes: ["answered", "unanswered", "moved"],
    });

    await expect(waitForCommittedServerMove(harness.args)).resolves.toBe(
      "committed",
    );
    expect(harness.probeLocalServer).toHaveBeenCalledTimes(3);
    expect(harness.sleep).toHaveBeenCalledTimes(2);
    expect(harness.sleep).toHaveBeenCalledWith(1_000);
  });

  it("treats a lock as committed when nothing listens and no launcher runs", async () => {
    const harness = await createCommitHarness({ probes: ["refused"] });

    await expect(waitForCommittedServerMove(harness.args)).resolves.toBe(
      "committed",
    );
    expect(harness.probeLocalServer).toHaveBeenCalledOnce();
    expect(harness.hasLiveLocalLauncher).toHaveBeenCalledOnce();
  });

  it("keeps waiting while a live launcher switches to the moved responder", async () => {
    const harness = await createCommitHarness({
      live: true,
      probes: ["refused", "refused", "moved"],
    });

    await expect(waitForCommittedServerMove(harness.args)).resolves.toBe(
      "committed",
    );
    expect(harness.probeLocalServer).toHaveBeenCalledTimes(3);
  });

  it("does nothing when a refused move removes the lock", async () => {
    const harness = await createCommitHarness({
      probes: ["answered", "refused"],
    });
    harness.probeLocalServer.mockImplementationOnce(async () => {
      await rm(join(harness.dataDir, SERVER_MOVED_FILE_NAME));
      return "answered";
    });

    await expect(waitForCommittedServerMove(harness.args)).resolves.toBe(
      "withdrawn",
    );
    expect(harness.probeLocalServer).toHaveBeenCalledOnce();
    expect(harness.hasLiveLocalLauncher).not.toHaveBeenCalled();
  });

  it("does not confirm a different move that replaced the lock", async () => {
    const harness = await createCommitHarness({ probes: ["moved"] });
    await writeServerMovedFile(
      harness.dataDir,
      movedFile({ moveId: "move-3" }),
    );

    await expect(waitForCommittedServerMove(harness.args)).resolves.toBe(
      "withdrawn",
    );
    expect(harness.probeLocalServer).not.toHaveBeenCalled();
  });

  it("gives up after the commit timeout while the old server still answers", async () => {
    const harness = await createCommitHarness({ probes: ["answered"] });

    await expect(waitForCommittedServerMove(harness.args)).resolves.toBe(
      "timed-out",
    );
    expect(harness.probeLocalServer).toHaveBeenCalledTimes(121);
  });

  it("checks once when the timeout is zero", async () => {
    const harness = await createCommitHarness({ probes: ["answered"] });

    await expect(
      waitForCommittedServerMove({ ...harness.args, timeoutMs: 0 }),
    ).resolves.toBe("timed-out");
    expect(harness.probeLocalServer).toHaveBeenCalledOnce();
    expect(harness.sleep).not.toHaveBeenCalled();
  });

  it("stops when cancelled", async () => {
    const harness = await createCommitHarness({ probes: ["answered"] });
    let cancelled = false;
    harness.sleep.mockImplementation(async () => {
      cancelled = true;
    });

    await expect(
      waitForCommittedServerMove({
        ...harness.args,
        isCancelled: () => cancelled,
      }),
    ).resolves.toBe("cancelled");
    expect(harness.probeLocalServer).toHaveBeenCalledOnce();
  });
});

describe("probeLocalServerMove", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolvePromise) => {
            server.close(() => {
              resolvePromise();
            });
          }),
      ),
    );
  });

  async function listen(
    handler: (response: ServerResponse) => void,
  ): Promise<string> {
    const server = createServer((_request, response) => {
      handler(response);
    });
    servers.push(server);
    await new Promise<void>((resolvePromise) => {
      server.listen(0, "127.0.0.1", () => {
        resolvePromise();
      });
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("server has no TCP address");
    }
    return `http://127.0.0.1:${address.port}`;
  }

  function sendJson(response: ServerResponse, status: number, body: unknown) {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  }

  it("recognizes the moved responder", async () => {
    const serverUrl = await listen((response) => {
      sendJson(response, 410, {
        code: "server_moved",
        details: {
          movedAt: 1,
          serverUrl: "https://laptop.getbb.app",
          toHostName: "Studio desktop",
        },
        message: "This bb server moved",
      });
    });

    await expect(
      probeLocalServerMove({ serverUrl, timeoutMs: 1_500 }),
    ).resolves.toBe("moved");
  });

  it.each([
    ["the old server", 200, { ok: true }],
    ["another 410 response", 410, { code: "gone" }],
  ])("reports %s as answered", async (_label, status, body) => {
    const serverUrl = await listen((response) => {
      sendJson(response, status, body);
    });

    await expect(
      probeLocalServerMove({ serverUrl, timeoutMs: 1_500 }),
    ).resolves.toBe("answered");
  });

  it("reports a closed port as refused", async () => {
    const serverUrl = await listen((response) => {
      sendJson(response, 200, { ok: true });
    });
    const server = servers.pop();
    await new Promise<void>((resolvePromise) => {
      server?.close(() => {
        resolvePromise();
      });
    });

    await expect(
      probeLocalServerMove({ serverUrl, timeoutMs: 1_500 }),
    ).resolves.toBe("refused");
  });

  it.each([
    [
      "an Electron refusal",
      new Error("net::ERR_CONNECTION_REFUSED"),
      "refused",
    ],
    [
      "a reset connection",
      new TypeError("fetch failed", { cause: { code: "ECONNRESET" } }),
      "unanswered",
    ],
    [
      "a timeout",
      new DOMException("The operation timed out", "TimeoutError"),
      "unanswered",
    ],
  ])("classifies %s", async (_label, error, expected) => {
    await expect(
      probeLocalServerMove({
        fetchImpl: async () => {
          throw error;
        },
        serverUrl: "http://127.0.0.1:38886",
        timeoutMs: 1_500,
      }),
    ).resolves.toBe(expected);
  });
});

describe("hasLiveBbAppLauncher", () => {
  async function writeRuntimeFile(dataDir: string, pid: number) {
    await writeBbAppRuntimeFile({
      dataDir,
      entryPath: "/opt/bb/bb-app.js",
      pid,
      serverUrl: "http://127.0.0.1:38886",
      startedAt: new Date().toISOString(),
      surface: "desktop",
      version: "0.43.1",
    });
  }

  it("is false without a runtime file", async () => {
    await expect(
      hasLiveBbAppLauncher({ dataDir: await createTempDir() }),
    ).resolves.toBe(false);
  });

  it("follows the recorded launcher process", async () => {
    const dataDir = await createTempDir();
    await writeRuntimeFile(dataDir, process.pid);

    await expect(hasLiveBbAppLauncher({ dataDir })).resolves.toBe(true);
    await expect(
      hasLiveBbAppLauncher({ dataDir, isRunning: () => false }),
    ).resolves.toBe(false);
  });
});

describe("readServerMovedConnectCredential", () => {
  async function writeConfig(dataDir: string, config: unknown): Promise<void> {
    await writeFile(join(dataDir, "config.json"), JSON.stringify(config));
  }

  it("reads the machine credential the move wrote for this computer", async () => {
    const dataDir = await createTempDir();
    await writeConfig(dataDir, {
      serverHeaders: { "x-bb-connect-machine": "bbcm_laptop" },
      serverUrl: "https://laptop.getbb.app/",
    });

    await expect(
      readServerMovedConnectCredential({
        dataDir,
        logWarning: vi.fn(),
        move: CONNECT_MOVE,
        remoteServerUrl: "https://laptop.getbb.app",
      }),
    ).resolves.toEqual({
      credential: "bbcm_laptop",
      handle: "laptop",
      serverUrl: "https://laptop.getbb.app",
    });
  });

  it("does not use the credential for a different server", async () => {
    const dataDir = await createTempDir();
    await writeConfig(dataDir, {
      serverHeaders: { "x-bb-connect-machine": "bbcm_laptop" },
      serverUrl: "https://laptop.getbb.app",
    });

    await expect(
      readServerMovedConnectCredential({
        dataDir,
        logWarning: vi.fn(),
        move: CONNECT_MOVE,
        remoteServerUrl: "https://work.getbb.app",
      }),
    ).resolves.toBeNull();
  });

  it("does not use a credential that config.json pins to another address", async () => {
    const dataDir = await createTempDir();
    await writeConfig(dataDir, {
      serverHeaders: { "x-bb-connect-machine": "bbcm_old" },
      serverUrl: "http://127.0.0.1:38886",
    });

    await expect(
      readServerMovedConnectCredential({
        dataDir,
        logWarning: vi.fn(),
        move: CONNECT_MOVE,
        remoteServerUrl: "https://laptop.getbb.app",
      }),
    ).resolves.toBeNull();
  });

  it("returns null for direct moves and missing headers", async () => {
    const dataDir = await createTempDir();
    await writeConfig(dataDir, { serverUrl: "https://laptop.getbb.app" });

    await expect(
      readServerMovedConnectCredential({
        dataDir,
        logWarning: vi.fn(),
        move: CONNECT_MOVE,
        remoteServerUrl: "https://laptop.getbb.app",
      }),
    ).resolves.toBeNull();
    await expect(
      readServerMovedConnectCredential({
        dataDir,
        logWarning: vi.fn(),
        move: DIRECT_MOVE,
        remoteServerUrl: "https://studio.tailnet.ts.net:38886",
      }),
    ).resolves.toBeNull();
  });

  it("logs and returns null for a missing or invalid config.json", async () => {
    const dataDir = await createTempDir();
    const logWarning = vi.fn();
    const args = {
      dataDir,
      logWarning,
      move: CONNECT_MOVE,
      remoteServerUrl: "https://laptop.getbb.app",
    };

    await expect(readServerMovedConnectCredential(args)).resolves.toBeNull();
    await writeFile(join(dataDir, "config.json"), "{broken");
    await expect(readServerMovedConnectCredential(args)).resolves.toBeNull();
    expect(logWarning).toHaveBeenCalledTimes(2);
  });
});

describe("waitForServerMoveDestination", () => {
  function createClock() {
    let nowMs = 0;
    return {
      now: () => nowMs,
      async sleep(delayMs: number) {
        nowMs += delayMs;
      },
    };
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
      status,
    });
  }

  it("waits until the new server answers outside pending mode", async () => {
    const clock = createClock();
    const fetchImpl = vi
      .fn<(input: string) => Promise<Response>>()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          serverMove: { moveId: "m", state: "pending" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: false }, 503))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await expect(
      waitForServerMoveDestination({
        fetchImpl,
        intervalMs: 1_000,
        isCancelled: () => false,
        now: clock.now,
        serverUrl: "https://studio.tailnet.ts.net:38886",
        sleep: clock.sleep,
        timeoutMs: 60_000,
      }),
    ).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://studio.tailnet.ts.net:38886/health",
    );
  });

  it("gives up after the timeout", async () => {
    const clock = createClock();
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });

    await expect(
      waitForServerMoveDestination({
        fetchImpl,
        intervalMs: 1_000,
        isCancelled: () => false,
        now: clock.now,
        serverUrl: "https://studio.tailnet.ts.net:38886",
        sleep: clock.sleep,
        timeoutMs: 5_000,
      }),
    ).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("stops polling once cancelled", async () => {
    const clock = createClock();
    let cancelled = false;
    const fetchImpl = vi.fn(async () => {
      cancelled = true;
      throw new Error("ECONNREFUSED");
    });

    await expect(
      waitForServerMoveDestination({
        fetchImpl,
        intervalMs: 1_000,
        isCancelled: () => cancelled,
        now: clock.now,
        serverUrl: "https://studio.tailnet.ts.net:38886",
        sleep: clock.sleep,
        timeoutMs: 60_000,
      }),
    ).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
