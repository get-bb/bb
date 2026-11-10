import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { hosts, type DbConnection } from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import {
  recordCompletedEventLoopWork,
  resetEventLoopWorkForTests,
  runEventLoopWork,
  runEventLoopWorkSync,
  takeEventLoopWorkWindowSnapshot,
} from "../../src/services/system/event-loop-work.js";

const BLOCK_MS = 60;
const blocker = new Int32Array(new SharedArrayBuffer(4));

function blockMainThread(ms: number): void {
  Atomics.wait(blocker, 0, 0, ms);
}

function connectWithWorkTracking(): DbConnection {
  const db = createMigratedConnection({
    synchronousWorkTracker: {
      run: runEventLoopWorkSync,
      record: recordCompletedEventLoopWork,
    },
  });
  db.$client.function("block_main_thread", () => {
    blockMainThread(BLOCK_MS);
    return 0;
  });
  return db;
}

function slowHostRename(db: DbConnection): void {
  db.transaction(
    (tx) => {
      tx.update(hosts)
        .set({ name: "renamed" })
        .where(eq(hosts.id, "missing"))
        .run();
      db.$client.prepare("SELECT block_main_thread()").get();
    },
    { behavior: "immediate" },
  );
}

function stubThreadCpuClock(): {
  advance: (usage: NodeJS.CpuUsage) => void;
  restore: () => void;
} {
  const elapsed: NodeJS.CpuUsage = { user: 0, system: 0 };
  const spy = vi
    .spyOn(process, "threadCpuUsage")
    .mockImplementation((previous?: NodeJS.CpuUsage) => ({
      user: elapsed.user - (previous?.user ?? 0),
      system: elapsed.system - (previous?.system ?? 0),
    }));
  return {
    advance(usage) {
      elapsed.user += usage.user;
      elapsed.system += usage.system;
    },
    restore() {
      spy.mockRestore();
    },
  };
}

describe("event loop work attribution", () => {
  let db: DbConnection;

  beforeEach(() => {
    resetEventLoopWorkForTests();
    db = connectWithWorkTracking();
    takeEventLoopWorkWindowSnapshot();
  });

  afterEach(() => {
    db.$client.close();
    resetEventLoopWorkForTests();
  });

  it("names the slow transaction inside a trivial daemon message by its first write", () => {
    const threadCpuClock = stubThreadCpuClock();
    try {
      runEventLoopWorkSync("ws:daemon heartbeat", () => {
        threadCpuClock.advance({ user: 3_000, system: 1_000 });
        slowHostRename(db);
      });
    } finally {
      threadCpuClock.restore();
    }

    const snapshot = takeEventLoopWorkWindowSnapshot();

    expect(snapshot.longestSynchronousWork).toBe(
      'ws:daemon heartbeat > db:transaction immediate: update "hosts" set "name" = ? where "hosts"."id" = ? > db:get SELECT block_main_thread()',
    );
    expect(snapshot.longestSynchronousWorkCaller).toBeNull();
    expect(snapshot.longestSynchronousWorkWallMs).toBeGreaterThanOrEqual(
      BLOCK_MS - 5,
    );
    expect(snapshot.longestSynchronousWorkCpuMs).toBe(4);
    expect(snapshot.longestSynchronousWorkVoluntaryContextSwitches).toEqual(
      expect.any(Number),
    );
    expect(snapshot.longestSynchronousWorkInvoluntaryContextSwitches).toEqual(
      expect.any(Number),
    );
  });

  it("does not credit a parent's time to a short child", () => {
    runEventLoopWorkSync("ws:daemon terminal.exited", () => {
      db.$client.prepare("SELECT 1").get();
      blockMainThread(BLOCK_MS);
    });

    expect(takeEventLoopWorkWindowSnapshot().longestSynchronousWork).toBe(
      "ws:daemon terminal.exited",
    );
  });

  it("attributes a slow transaction after an await to the plugin RPC and request that ran it", async () => {
    await runEventLoopWork(
      "POST /api/v1/plugins/usage/rpc/usage.v1.refresh",
      async () => {
        await delay(0);
        await runEventLoopWork(
          "plugin:usage rpc usage.v1.refresh",
          async () => {
            await delay(0);
            slowHostRename(db);
          },
        );
      },
    );

    const snapshot = takeEventLoopWorkWindowSnapshot();

    expect(snapshot.longestSynchronousWork).toMatch(
      /^db:transaction immediate: update "hosts"/u,
    );
    expect(snapshot.longestSynchronousWorkCaller).toBe(
      "POST /api/v1/plugins/usage/rpc/usage.v1.refresh > plugin:usage rpc usage.v1.refresh",
    );
  });

  it("measures a plugin handler's synchronous work before its first await", async () => {
    await runEventLoopWork(
      "POST /api/v1/plugins/usage/rpc/usage.v1.refresh",
      async () => {
        await delay(0);
        await runEventLoopWork("plugin:usage rpc usage.v1.refresh", () => {
          blockMainThread(BLOCK_MS);
          return delay(0);
        });
      },
    );

    const snapshot = takeEventLoopWorkWindowSnapshot();

    expect(snapshot.longestSynchronousWork).toBe(
      "plugin:usage rpc usage.v1.refresh (until first await)",
    );
    expect(snapshot.longestSynchronousWorkCaller).toBe(
      "POST /api/v1/plugins/usage/rpc/usage.v1.refresh",
    );
    expect(snapshot.longestSynchronousWorkWallMs).toBeGreaterThanOrEqual(
      BLOCK_MS - 5,
    );
  });

  it("keeps plugin attribution for background work scheduled while the plugin loaded", async () => {
    let backgroundTick!: Promise<void>;
    await runEventLoopWork("plugin:usage load", () => {
      backgroundTick = delay(5).then(() => slowHostRename(db));
    });
    await backgroundTick;

    const snapshot = takeEventLoopWorkWindowSnapshot();

    expect(snapshot.longestSynchronousWork).toMatch(
      /^db:transaction immediate: /u,
    );
    expect(snapshot.longestSynchronousWorkCaller).toBe("plugin:usage load");
    expect(snapshot.inFlightWorkAtObservation).toBeNull();
  });

  it("nests a plugin event handler started by a daemon message under that message", () => {
    runEventLoopWorkSync("ws:daemon terminal.exited", () => {
      void runEventLoopWork("plugin:usage terminal.exited handler", () => {
        blockMainThread(BLOCK_MS);
      });
    });

    expect(takeEventLoopWorkWindowSnapshot().longestSynchronousWork).toBe(
      "ws:daemon terminal.exited > plugin:usage terminal.exited handler (until first await)",
    );
  });

  it("does not grow a caller chain across repeated self-scheduling work", async () => {
    let finalCaller: string | null = null;
    async function tick(remaining: number): Promise<void> {
      await runEventLoopWork("sweep:loop", async () => {
        await delay(0);
        if (remaining === 0) {
          recordCompletedEventLoopWork("leaf", 1_000, 1);
          finalCaller =
            takeEventLoopWorkWindowSnapshot().longestSynchronousWorkCaller;
          return;
        }
        void tick(remaining - 1);
      });
    }
    await tick(20);
    for (let attempt = 0; attempt < 50 && finalCaller === null; attempt += 1) {
      await delay(1);
    }

    expect(finalCaller).toBe("sweep:loop > sweep:loop");
  });

  it("starts each window empty", () => {
    runEventLoopWorkSync("ws:daemon heartbeat", () => slowHostRename(db));
    takeEventLoopWorkWindowSnapshot();

    expect(takeEventLoopWorkWindowSnapshot()).toMatchObject({
      longestSynchronousWork: null,
      longestSynchronousWorkCaller: null,
      longestSynchronousWorkWallMs: null,
    });
  });
});
