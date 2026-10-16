import { afterEach, expect, it, vi } from "vitest";
import {
  runVcsProcess,
  withVcsProcessPriority,
} from "../src/vcs-process-scheduler.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function flush() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

afterEach(() => vi.useRealTimers());

it("bounds git and gh together, reserves foreground capacity, and skips a saturated gh lane", async () => {
  const release = deferred();
  const started: string[] = [];
  const hold = (
    command: "git" | "gh",
    label: string,
    priority: "background" | "status" | "interactive",
  ) =>
    runVcsProcess(
      command,
      async () => {
        started.push(label);
        await release.promise;
      },
      { priority },
    );
  const tasks = [
    hold("gh", "gh1", "background"),
    hold("gh", "gh2", "background"),
    hold("gh", "gh3", "background"),
    ...Array.from({ length: 10 }, (_, i) =>
      hold("git", `git${i}`, "background"),
    ),
  ];
  try {
    await Promise.resolve();
    expect(started).toEqual(["gh1", "gh2", "git0", "git1"]);
    tasks.push(
      hold("git", "status1", "status"),
      hold("git", "status2", "status"),
    );
    await Promise.resolve();
    expect(started).toHaveLength(5);
    expect(started.at(-1)).toBe("status1");
    tasks.push(
      hold("git", "interactive", "interactive"),
      hold("git", "overflow", "interactive"),
    );
    await Promise.resolve();
    expect(started).toHaveLength(6);
    expect(started.at(-1)).toBe("interactive");
  } finally {
    release.resolve();
    await Promise.all(tasks);
  }
  expect(started).toHaveLength(17);
});

it("prioritizes queued foreground work, keeps FIFO within a tier, and isolates concurrent priority contexts", async () => {
  const release = deferred();
  const holders = Array.from({ length: 6 }, () =>
    runVcsProcess("git", () => release.promise, { priority: "interactive" }),
  );
  const order: string[] = [];
  const enqueue = (
    priority: "background" | "status" | "interactive",
    label: string,
  ) =>
    withVcsProcessPriority(priority, async () => {
      await Promise.resolve();
      await runVcsProcess("git", async () => {
        order.push(label);
      });
    });
  const tasks = [
    enqueue("background", "background"),
    enqueue("status", "status1"),
    enqueue("interactive", "interactive1"),
    enqueue("interactive", "interactive2"),
    enqueue("status", "status2"),
  ];
  await Promise.resolve();
  await Promise.resolve();
  release.resolve();
  await Promise.all([...holders, ...tasks]);
  expect(order).toEqual([
    "interactive1",
    "interactive2",
    "status1",
    "status2",
    "background",
  ]);
});

it("cancels queued work without executing it and releases permits after synchronous and asynchronous failures", async () => {
  const release = deferred();
  const holders = Array.from({ length: 6 }, () =>
    runVcsProcess("git", () => release.promise, { priority: "interactive" }),
  );
  const controller = new AbortController();
  const operation = vi.fn(async () => undefined);
  const canceled = runVcsProcess("git", operation, {
    signal: controller.signal,
  });
  const rejected = expect(canceled).rejects.toMatchObject({
    name: "AbortError",
    code: "ABORT_ERR",
  });
  controller.abort();
  await rejected;
  await expect(
    runVcsProcess("git", operation, { signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(operation).not.toHaveBeenCalled();
  release.resolve();
  await Promise.all(holders);
  await expect(
    runVcsProcess("gh", () => {
      throw new Error("spawn failed");
    }),
  ).rejects.toThrow("spawn failed");
  await expect(
    runVcsProcess("gh", async () => {
      throw new Error("exit failed");
    }),
  ).rejects.toThrow("exit failed");
  const next = deferred();
  let active = 0;
  const tasks = Array.from({ length: 6 }, () =>
    runVcsProcess(
      "git",
      async () => {
        active++;
        await next.promise;
      },
      { priority: "interactive" },
    ),
  );
  try {
    await Promise.resolve();
    expect(active).toBe(6);
  } finally {
    next.resolve();
    await Promise.all(tasks);
  }
});

it("promotes an old background waiter into reserved capacity under sustained status load", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const release = deferred();
  const holders = Array.from({ length: 5 }, () =>
    runVcsProcess("git", () => release.promise, { priority: "status" }),
  );
  const started: string[] = [];
  const old = runVcsProcess(
    "git",
    async () => {
      started.push("old");
    },
    { priority: "background" },
  );
  try {
    await vi.advanceTimersByTimeAsync(29_999);
    expect(started).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await old;
    expect(started).toEqual(["old"]);
  } finally {
    release.resolve();
    await Promise.all(holders);
  }
});

it("accounts for both children of a git pipeline", async () => {
  const release = deferred();
  let started = 0;
  const tasks = Array.from({ length: 8 }, () =>
    runVcsProcess(
      "git",
      async () => {
        started++;
        await release.promise;
      },
      { priority: "interactive", slots: 2 },
    ),
  );
  try {
    await Promise.resolve();
    expect(started).toBe(3);
  } finally {
    release.resolve();
    await Promise.all(tasks);
  }
});

it("holds freed capacity for an older pipeline instead of admitting newer single-slot work", async () => {
  const holders = Array.from({ length: 6 }, () => {
    const release = deferred();
    return {
      release,
      task: runVcsProcess("git", () => release.promise, {
        priority: "interactive",
      }),
    };
  });
  const started: string[] = [];
  const pipelineRelease = deferred();
  const pipeline = runVcsProcess(
    "git",
    async () => {
      started.push("pipeline");
      await pipelineRelease.promise;
    },
    { priority: "interactive", slots: 2 },
  );
  const later = runVcsProcess(
    "git",
    async () => {
      started.push("later");
    },
    { priority: "interactive" },
  );
  try {
    holders[0]!.release.resolve();
    await flush();
    expect(started).toEqual([]);
    holders[1]!.release.resolve();
    await flush();
    expect(started).toEqual(["pipeline"]);
  } finally {
    for (const holder of holders) holder.release.resolve();
    pipelineRelease.resolve();
    await Promise.all([
      ...holders.map((holder) => holder.task),
      pipeline,
      later,
    ]);
  }
  expect(started).toEqual(["pipeline", "later"]);
});

it("runs nested admission inside the outer permit instead of deadlocking at capacity", async () => {
  const release = deferred();
  let inner = 0;
  const tasks = Array.from({ length: 6 }, () =>
    runVcsProcess(
      "git",
      async () => {
        await runVcsProcess("gh", async () => {
          inner++;
        });
        await release.promise;
      },
      { priority: "interactive" },
    ),
  );
  const queued = vi.fn(async () => undefined);
  const outside = runVcsProcess("git", queued, { priority: "interactive" });
  try {
    await flush();
    expect(inner).toBe(6);
    expect(queued).not.toHaveBeenCalled();
  } finally {
    release.resolve();
    await Promise.all([...tasks, outside]);
  }
  expect(queued).toHaveBeenCalledOnce();
});

it.each([0, 1.5, 5, NaN, Infinity])(
  "rejects invalid slot counts (%s) without occupying capacity",
  async (slots) => {
    await expect(
      runVcsProcess("git", async () => undefined, { slots }),
    ).rejects.toThrow("Invalid VCS process slot count");
  },
);

it("rejects gh requests larger than the GitHub budget instead of waiting forever", async () => {
  await expect(
    runVcsProcess("gh", async () => undefined, { slots: 3 }),
  ).rejects.toThrow("Invalid VCS process slot count");
});

it("shares admission across separately loaded module copies", async () => {
  const modulePath = "../src/vcs-process-scheduler.js?separate-bundle";
  const copy: typeof import("../src/vcs-process-scheduler.js") = await import(
    modulePath
  );
  const release = deferred();
  const holders = Array.from({ length: 6 }, () =>
    runVcsProcess("git", () => release.promise, { priority: "interactive" }),
  );
  const operation = vi.fn(async () => undefined);
  const queued = copy.runVcsProcess("git", operation);
  try {
    await Promise.resolve();
    expect(operation).not.toHaveBeenCalled();
  } finally {
    release.resolve();
    await Promise.all([...holders, queued]);
  }
  expect(operation).toHaveBeenCalledOnce();
});
