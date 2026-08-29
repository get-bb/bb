import { eq } from "drizzle-orm";
import {
  createConnection,
  createProject,
  createThread,
  migrate,
  noopNotifier,
  threads,
  upsertHost,
  type DbConnection,
} from "@bb/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ThreadWaitCoordinator,
  ThreadWaitCoordinatorLimitError,
} from "../../../src/services/threads/wait-coordinator.js";
import { NotificationHub } from "../../../src/ws/hub.js";

interface SetupResult {
  coordinator: ThreadWaitCoordinator;
  db: DbConnection;
  hub: NotificationHub;
  threadId: string;
  warn: ReturnType<typeof vi.fn>;
}

function setup(
  args: {
    maxCallers?: number;
    maxEntries?: number;
    status?: "active" | "error";
  } = {},
): SetupResult {
  const db = createConnection(":memory:");
  migrate(db);
  const hub = new NotificationHub();
  const host = upsertHost(db, noopNotifier, {
    name: "wait-test-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "wait-test-project",
    source: {
      hostId: host.id,
      path: "/tmp/wait-test",
      type: "local_path",
    },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
    status: args.status ?? "active",
  });
  const warn = vi.fn();
  const coordinator = new ThreadWaitCoordinator({
    db,
    hub,
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn,
    },
    maxCallers: args.maxCallers,
    maxEntries: args.maxEntries,
  });
  return { coordinator, db, hub, threadId: thread.id, warn };
}

function setThreadStatus(
  db: DbConnection,
  threadId: string,
  status: "active" | "idle",
): void {
  db.update(threads)
    .set({ status, updatedAt: Date.now() })
    .where(eq(threads.id, threadId))
    .run();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ThreadWaitCoordinator", () => {
  it("shares one active entry and one watcher across 100 identical waits", async () => {
    const { coordinator, db, hub, threadId } = setup();
    const registerWatcher = vi.spyOn(hub, "registerThreadEventWaiter");
    const waits = Array.from({ length: 100 }, () =>
      coordinator.wait({
        target: { kind: "status", status: "idle" },
        threadId,
        timeoutMs: 10_000,
      }),
    );

    await vi.waitFor(() => {
      expect(coordinator.getStats()).toMatchObject({
        activeCallers: 100,
        activeEntries: 1,
        checkCount: 1,
        deduplicatedJoinCount: 99,
        entryCreateCount: 1,
        joinCount: 100,
      });
      expect(registerWatcher).toHaveBeenCalledTimes(1);
    });

    hub.notifyThread(threadId, ["title-changed"]);
    await vi.waitFor(() => {
      expect(coordinator.getStats().checkCount).toBe(2);
    });
    setThreadStatus(db, threadId, "idle");
    hub.notifyThread(threadId, ["status-changed"]);

    const results = await Promise.all(waits);
    expect(results).toHaveLength(100);
    expect(results.every((result) => result.kind === "status")).toBe(true);
    expect(coordinator.getStats()).toMatchObject({
      activeCallers: 0,
      activeEntries: 0,
      checkCount: 3,
    });
    db.$client.close();
  });

  it("keeps different threads, targets, and cursors in separate entries", async () => {
    const { coordinator, db, hub, threadId } = setup();
    const secondThread = createThread(db, noopNotifier, {
      projectId: db.select().from(threads).get()?.projectId ?? "",
      providerId: "codex",
      status: "active",
    });
    const controllers = Array.from({ length: 5 }, () => new AbortController());
    const waits = [
      coordinator.wait({
        signal: controllers[0]?.signal,
        target: { kind: "status", status: "idle" },
        threadId,
        timeoutMs: 10_000,
      }),
      coordinator.wait({
        signal: controllers[1]?.signal,
        target: { kind: "status", status: "idle" },
        threadId: secondThread.id,
        timeoutMs: 10_000,
      }),
      coordinator.wait({
        signal: controllers[2]?.signal,
        target: { kind: "status", status: "error" },
        threadId,
        timeoutMs: 10_000,
      }),
      coordinator.wait({
        signal: controllers[3]?.signal,
        target: {
          afterSeq: 0,
          eventType: "turn/completed",
          kind: "event",
        },
        threadId,
        timeoutMs: 10_000,
      }),
      coordinator.wait({
        signal: controllers[4]?.signal,
        target: {
          afterSeq: 1,
          eventType: "turn/completed",
          kind: "event",
        },
        threadId,
        timeoutMs: 10_000,
      }),
    ];

    await vi.waitFor(() => {
      expect(coordinator.getStats().activeEntries).toBe(5);
    });
    for (const controller of controllers) controller.abort();
    await Promise.allSettled(waits);
    expect(coordinator.getStats()).toMatchObject({
      activeCallers: 0,
      activeEntries: 0,
    });
    coordinator.close();
    hub.notifyThread(threadId, ["status-changed"]);
    db.$client.close();
  });

  it("keeps remaining callers after one abort and cancels after the final abort", async () => {
    const { coordinator, db, threadId } = setup();
    const controllers = Array.from({ length: 3 }, () => new AbortController());
    const waits = controllers.map((controller) =>
      coordinator.wait({
        signal: controller.signal,
        target: { kind: "status", status: "idle" },
        threadId,
        timeoutMs: 10_000,
      }),
    );

    controllers[0]?.abort();
    await expect(waits[0]).rejects.toMatchObject({ name: "AbortError" });
    expect(coordinator.getStats()).toMatchObject({
      activeCallers: 2,
      activeEntries: 1,
    });

    controllers[1]?.abort();
    controllers[2]?.abort();
    await Promise.allSettled(waits.slice(1));
    expect(coordinator.getStats()).toMatchObject({
      activeCallers: 0,
      activeEntries: 0,
    });
    db.$client.close();
  });

  it("cleans timeout, reached, unreachable, and close outcomes", async () => {
    const timeoutSetup = setup();
    await expect(
      timeoutSetup.coordinator.wait({
        target: { kind: "status", status: "idle" },
        threadId: timeoutSetup.threadId,
        timeoutMs: 0,
      }),
    ).resolves.toEqual({ kind: "timeout" });
    expect(timeoutSetup.coordinator.getStats()).toMatchObject({
      activeCallers: 0,
      activeEntries: 0,
      timeoutCount: 1,
    });
    timeoutSetup.db.$client.close();

    const reachedSetup = setup();
    const reached = reachedSetup.coordinator.wait({
      target: { kind: "status", status: "idle" },
      threadId: reachedSetup.threadId,
      timeoutMs: 10_000,
    });
    setThreadStatus(reachedSetup.db, reachedSetup.threadId, "idle");
    reachedSetup.hub.notifyThread(reachedSetup.threadId, ["status-changed"]);
    await expect(reached).resolves.toMatchObject({ kind: "status" });
    expect(reachedSetup.coordinator.getStats().activeEntries).toBe(0);
    reachedSetup.db.$client.close();

    const unreachableSetup = setup({ status: "error" });
    await expect(
      unreachableSetup.coordinator.wait({
        target: { kind: "status", status: "idle" },
        threadId: unreachableSetup.threadId,
        timeoutMs: 10_000,
      }),
    ).resolves.toMatchObject({ kind: "status", unreachable: true });
    expect(unreachableSetup.coordinator.getStats()).toMatchObject({
      activeEntries: 0,
      unreachableCount: 1,
    });
    unreachableSetup.db.$client.close();

    const closeSetup = setup();
    const closed = closeSetup.coordinator.wait({
      target: { kind: "status", status: "idle" },
      threadId: closeSetup.threadId,
      timeoutMs: 10_000,
    });
    closeSetup.coordinator.close();
    await expect(closed).resolves.toEqual({ kind: "closed" });
    expect(closeSetup.coordinator.getStats()).toMatchObject({
      activeCallers: 0,
      activeEntries: 0,
    });
    closeSetup.db.$client.close();
  });

  it("rejects caller and entry limits without leaking state", async () => {
    const callerSetup = setup({ maxCallers: 1, maxEntries: 10 });
    const controller = new AbortController();
    const first = callerSetup.coordinator.wait({
      signal: controller.signal,
      target: { kind: "status", status: "idle" },
      threadId: callerSetup.threadId,
      timeoutMs: 10_000,
    });
    await expect(
      callerSetup.coordinator.wait({
        target: { kind: "status", status: "idle" },
        threadId: callerSetup.threadId,
        timeoutMs: 10_000,
      }),
    ).rejects.toBeInstanceOf(ThreadWaitCoordinatorLimitError);
    controller.abort();
    await Promise.allSettled([first]);
    expect(callerSetup.coordinator.getStats()).toMatchObject({
      activeCallers: 0,
      activeEntries: 0,
      limitRejectionCount: 1,
    });
    callerSetup.db.$client.close();

    const entrySetup = setup({ maxCallers: 10, maxEntries: 1 });
    const entryController = new AbortController();
    const entryFirst = entrySetup.coordinator.wait({
      signal: entryController.signal,
      target: { kind: "status", status: "idle" },
      threadId: entrySetup.threadId,
      timeoutMs: 10_000,
    });
    await expect(
      entrySetup.coordinator.wait({
        target: { kind: "status", status: "error" },
        threadId: entrySetup.threadId,
        timeoutMs: 10_000,
      }),
    ).rejects.toBeInstanceOf(ThreadWaitCoordinatorLimitError);
    entryController.abort();
    await Promise.allSettled([entryFirst]);
    expect(entrySetup.coordinator.getStats()).toMatchObject({
      activeCallers: 0,
      activeEntries: 0,
      limitRejectionCount: 1,
    });
    entrySetup.db.$client.close();
  });

  it("counts and logs watcher cleanup failures", async () => {
    const { coordinator, db, hub, threadId, warn } = setup();
    const registerWatcher = hub.registerThreadEventWaiter.bind(hub);
    vi.spyOn(hub, "registerThreadEventWaiter").mockImplementation(
      (registeredThreadId, timeoutMs) => {
        const watcher = registerWatcher(registeredThreadId, timeoutMs);
        return {
          promise: watcher.promise,
          cancel: () => {
            watcher.cancel();
            throw new Error("cancel failed");
          },
        };
      },
    );

    await expect(
      coordinator.wait({
        target: { kind: "status", status: "idle" },
        threadId,
        timeoutMs: 0,
      }),
    ).resolves.toEqual({ kind: "timeout" });
    expect(coordinator.getStats()).toMatchObject({
      activeCallers: 0,
      activeEntries: 0,
      cleanupFailureCount: 1,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ threadId }),
      "Thread wait coordinator cleanup failed",
    );
    db.$client.close();
  });
});
