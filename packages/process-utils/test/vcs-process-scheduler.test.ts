import { afterEach, expect, it, vi } from "vitest";
import {
  isNetworkGitCommand,
  localProcessCapacities,
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

vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  availableParallelism: () => 16,
}));

afterEach(() => vi.useRealTimers());

type Priority = "background" | "status" | "interactive";

function holdAll(release: Promise<void>, started: string[]) {
  return (
    command: "git" | "gh",
    args: string[],
    label: string,
    priority: Priority,
  ) =>
    runVcsProcess(
      command,
      args,
      async () => {
        started.push(label);
        await release;
      },
      { priority },
    );
}

it("bounds local git, reserves foreground capacity, and keeps gh out of the local pool", async () => {
  const release = deferred();
  const started: string[] = [];
  const hold = holdAll(release.promise, started);
  const tasks = [
    hold("gh", ["api"], "gh1", "background"),
    hold("gh", ["api"], "gh2", "background"),
    hold("gh", ["api"], "gh3", "background"),
    ...Array.from({ length: 10 }, (_, i) =>
      hold("git", ["status"], `git${i}`, "background"),
    ),
  ];
  try {
    await Promise.resolve();
    expect(started).toEqual(["gh1", "gh2", "git0", "git1", "git2", "git3"]);
    tasks.push(
      hold("git", ["status"], "status1", "status"),
      hold("git", ["status"], "status2", "status"),
    );
    await Promise.resolve();
    expect(started.slice(6)).toEqual(["status1"]);
    tasks.push(
      hold("git", ["diff"], "interactive", "interactive"),
      hold("git", ["diff"], "overflow", "interactive"),
    );
    await Promise.resolve();
    expect(started.slice(6)).toEqual(["status1", "interactive"]);
  } finally {
    release.resolve();
    await Promise.all(tasks);
  }
  expect(started).toHaveLength(17);
});

it("keeps network git in its own pool so slow fetches cannot fill local background capacity", async () => {
  const release = deferred();
  const started: string[] = [];
  const hold = holdAll(release.promise, started);
  const tasks = [
    ...Array.from({ length: 4 }, (_, i) =>
      hold("git", ["fetch", "--all", "--prune"], `fetch${i}`, "background"),
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      hold("git", ["status"], `status${i}`, "background"),
    ),
  ];
  try {
    await Promise.resolve();
    expect(started).toEqual([
      "fetch0",
      "fetch1",
      "status0",
      "status1",
      "status2",
      "status3",
    ]);
    tasks.push(hold("git", ["push"], "push", "interactive"));
    await Promise.resolve();
    expect(started.at(-1)).toBe("push");
  } finally {
    release.resolve();
    await Promise.all(tasks);
  }
  expect(started).toHaveLength(9);
});

it("skips a saturated gh lane without blocking network git behind it", async () => {
  const release = deferred();
  const started: string[] = [];
  const hold = holdAll(release.promise, started);
  const tasks = [
    hold("gh", ["pr", "view"], "gh1", "interactive"),
    hold("gh", ["pr", "view"], "gh2", "interactive"),
    hold("gh", ["pr", "view"], "gh3", "interactive"),
    hold("git", ["fetch"], "fetch", "interactive"),
  ];
  try {
    await Promise.resolve();
    expect(started).toEqual(["gh1", "gh2", "fetch"]);
  } finally {
    release.resolve();
    await Promise.all(tasks);
  }
  expect(started).toHaveLength(4);
});

it.each([
  [["fetch", "--all", "--prune", "--quiet"], true],
  [["-C", "/repo", "push", "origin", "HEAD"], true],
  [["-c", "core.askPass=", "pull"], true],
  [["--git-dir", "/repo/.git", "ls-remote"], true],
  [["clone", "--progress", "https://example.com/r.git", "r"], true],
  [["submodule", "--quiet", "update", "--init"], true],
  [["remote", "update"], true],
  [["remote", "get-url", "origin"], false],
  [["--no-optional-locks", "status", "--porcelain=v1"], false],
  [["-C", "fetch", "status"], false],
  [["log", "fetch"], false],
  [[], false],
])("classifies git %j as network work: %s", (args, network) => {
  expect(isNetworkGitCommand(args)).toBe(network);
});

it("prioritizes queued foreground work, keeps FIFO within a tier, and isolates concurrent priority contexts", async () => {
  const release = deferred();
  const holders = Array.from({ length: 6 }, () =>
    runVcsProcess("git", ["status"], () => release.promise, {
      priority: "interactive",
    }),
  );
  const order: string[] = [];
  const enqueue = (
    priority: "background" | "status" | "interactive",
    label: string,
  ) =>
    withVcsProcessPriority(priority, async () => {
      await Promise.resolve();
      await runVcsProcess("git", ["status"], async () => {
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
    runVcsProcess("git", ["status"], () => release.promise, {
      priority: "interactive",
    }),
  );
  const controller = new AbortController();
  const operation = vi.fn(async () => undefined);
  const canceled = runVcsProcess("git", ["status"], operation, {
    signal: controller.signal,
  });
  const rejected = expect(canceled).rejects.toMatchObject({
    name: "AbortError",
    code: "ABORT_ERR",
  });
  controller.abort();
  await rejected;
  await expect(
    runVcsProcess("git", ["status"], operation, { signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(operation).not.toHaveBeenCalled();
  release.resolve();
  await Promise.all(holders);
  await expect(
    runVcsProcess("gh", ["api"], () => {
      throw new Error("spawn failed");
    }),
  ).rejects.toThrow("spawn failed");
  await expect(
    runVcsProcess("gh", ["api"], async () => {
      throw new Error("exit failed");
    }),
  ).rejects.toThrow("exit failed");
  const next = deferred();
  let active = 0;
  const tasks = Array.from({ length: 6 }, () =>
    runVcsProcess(
      "git",
      ["status"],
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
    runVcsProcess("git", ["status"], () => release.promise, {
      priority: "status",
    }),
  );
  const started: string[] = [];
  const old = runVcsProcess(
    "git",
    ["status"],
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
      ["status"],
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
      task: runVcsProcess("git", ["status"], () => release.promise, {
        priority: "interactive",
      }),
    };
  });
  const started: string[] = [];
  const pipelineRelease = deferred();
  const pipeline = runVcsProcess(
    "git",
    ["status"],
    async () => {
      started.push("pipeline");
      await pipelineRelease.promise;
    },
    { priority: "interactive", slots: 2 },
  );
  const later = runVcsProcess(
    "git",
    ["status"],
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
      ["status"],
      async () => {
        await runVcsProcess("gh", ["api"], async () => {
          inner++;
        });
        await release.promise;
      },
      { priority: "interactive" },
    ),
  );
  const queued = vi.fn(async () => undefined);
  const outside = runVcsProcess("git", ["status"], queued, {
    priority: "interactive",
  });
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

it.each([
  [1, [4, 3, 2]],
  [4, [4, 3, 2]],
  [6, [4, 3, 2]],
  [7, [5, 4, 3]],
  [8, [6, 5, 4]],
  [64, [6, 5, 4]],
])(
  "scales local capacity to %i available cores as %j",
  (parallelism, expected) => {
    expect(localProcessCapacities(parallelism)).toEqual(expected);
  },
);

it.each([0, 1.5, 5, NaN, Infinity])(
  "rejects invalid slot counts (%s) without occupying capacity",
  async (slots) => {
    await expect(
      runVcsProcess("git", ["status"], async () => undefined, { slots }),
    ).rejects.toThrow("Invalid VCS process slot count");
  },
);

it("rejects gh requests larger than the GitHub budget instead of waiting forever", async () => {
  await expect(
    runVcsProcess("gh", ["api"], async () => undefined, { slots: 3 }),
  ).rejects.toThrow("Invalid VCS process slot count");
});

it("shares admission across separately loaded module copies", async () => {
  const modulePath = "../src/vcs-process-scheduler.js?separate-bundle";
  const copy: typeof import("../src/vcs-process-scheduler.js") = await import(
    modulePath
  );
  const release = deferred();
  const holders = Array.from({ length: 6 }, () =>
    runVcsProcess("git", ["status"], () => release.promise, {
      priority: "interactive",
    }),
  );
  const operation = vi.fn(async () => undefined);
  const queued = copy.runVcsProcess("git", ["status"], operation);
  try {
    await Promise.resolve();
    expect(operation).not.toHaveBeenCalled();
  } finally {
    release.resolve();
    await Promise.all([...holders, queued]);
  }
  expect(operation).toHaveBeenCalledOnce();
});
