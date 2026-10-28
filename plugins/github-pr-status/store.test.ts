import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createPullRequestPersistence } from "./persistence.js";
import type { EnvironmentPullRequest, PullRequest } from "./contract.js";
import { createPullRequestStore } from "./store.js";

const ACTIVE_CHECK_MS = 30_000;

function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 42,
    title: "Watch the PR",
    state: "open",
    url: "https://github.com/acme/bb/pull/42",
    baseRefName: "main",
    headRefName: "bb/pr-watch",
    updatedAt: "2026-06-16T12:30:00Z",
    autoMerge: false,
    inMergeQueue: false,
    checks: {
      state: "passing",
      totalCount: 1,
      passedCount: 1,
      failedCount: 0,
      pendingCount: 0,
    },
    review: { state: "none", reviewRequestCount: 0 },
    mergeability: {
      state: "mergeable",
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
    },
    attention: "ready_to_merge",
    ...overrides,
  };
}

const pending = pullRequest({
  checks: {
    state: "pending",
    totalCount: 1,
    passedCount: 0,
    failedCount: 0,
    pendingCount: 1,
  },
  attention: "checks_pending",
});

const owners: ReturnType<typeof createFakePluginHost>[] = [];
const stores: ReturnType<typeof createPullRequestStore>[] = [];

function setup(
  results: EnvironmentPullRequest[],
  owner = createFakePluginHost({ pluginId: "bb--github-pr-status" }),
) {
  owners.push(owner);
  const persistence = createPullRequestPersistence(owner.bb.storage);
  const load = vi.fn(async (_id: string, _url: string | null) =>
    results.length > 1 ? results.shift()! : results[0]!,
  );
  const publish = vi.fn();
  const store = createPullRequestStore({
    load,
    publish,
    persistence,
    branch: () => "bb/pr-watch",
    onCheckFailed: (id, error) => {
      throw new Error(`${id}: ${error}`);
    },
  });
  stores.push(store);
  return { load, publish, store, persistence, owner };
}
function available(pullRequest: PullRequest): EnvironmentPullRequest {
  return { outcome: "available", pullRequest };
}
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.dispose();
  for (const owner of new Set(owners.splice(0))) await owner.harness.dispose();
  vi.useRealTimers();
});

describe("shared pull request refresh", () => {
  it("uses one timer and load per PR, publishes changes to every link and stops when unwatched", async () => {
    vi.useFakeTimers();
    const { store, load, publish } = setup([available(pending)]);
    for (const id of ["a", "b", "c", "d", "e"])
      await store.read(id, { viewer: true });
    const signals = Array.from({ length: 5 }, () => new AbortController());
    ["a", "b", "c", "d", "e"].forEach((id, index) =>
      store.watch(id, signals[index]!.signal),
    );
    await flush();
    load.mockClear();
    await vi.advanceTimersByTimeAsync(ACTIVE_CHECK_MS);
    expect(load).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
    load.mockResolvedValue(available(pullRequest()));
    await vi.advanceTimersByTimeAsync(ACTIVE_CHECK_MS);
    expect(load).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledExactlyOnceWith(["a", "b", "c", "d", "e"]);
    for (const signal of signals) signal.abort();
    await vi.advanceTimersByTimeAsync(ACTIVE_CHECK_MS * 3);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("publishes a change found by one viewer's background refresh to every viewer of that environment", async () => {
    vi.useFakeTimers();
    const failing = pullRequest({
      checks: {
        state: "failing",
        totalCount: 2,
        passedCount: 1,
        failedCount: 1,
        pendingCount: 0,
      },
      attention: "checks_failed",
    });
    const { store, load, publish } = setup([available(failing)]);
    await store.read("a", { viewer: true });
    store.watch("a", new AbortController().signal);
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    load.mockResolvedValue(available(pullRequest()));
    await expect(store.read("a", { viewer: true })).resolves.toEqual(
      available(failing),
    );
    await flush();
    expect(publish).toHaveBeenCalledExactlyOnceWith(["a"]);
    await expect(store.read("a", { viewer: true })).resolves.toEqual(
      available(pullRequest()),
    );
    expect(load).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledOnce();
  });

  it("serves restored snapshots immediately, keeps the due time, and writes nothing for identical content", async () => {
    vi.useFakeTimers();
    const first = setup([available(pending)]);
    await first.store.read("a", { viewer: true });
    const changes = first.owner.bb.storage
      .database()
      .prepare("SELECT total_changes() AS n")
      .get();
    await vi.advanceTimersByTimeAsync(ACTIVE_CHECK_MS);
    await first.store.read("a", { viewer: true });
    await flush();
    expect(first.load).toHaveBeenCalledTimes(2);
    expect(
      first.owner.bb.storage
        .database()
        .prepare("SELECT total_changes() AS n")
        .get(),
    ).toEqual(changes);
    first.store.dispose();
    await vi.advanceTimersByTimeAsync(ACTIVE_CHECK_MS);
    const restored = setup([available(pending)], first.owner);
    let finish!: (value: EnvironmentPullRequest) => void;
    restored.load.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    restored.store.watch("a", new AbortController().signal);
    await expect(restored.store.read("a", { viewer: true })).resolves.toEqual(
      available(pending),
    );
    await flush();
    expect(restored.load).toHaveBeenCalledTimes(1);
    finish(available({ ...pending, title: "Updated" }));
    await flush();
    expect(restored.publish).toHaveBeenCalledExactlyOnceWith(["a"]);
    await vi.advanceTimersByTimeAsync(ACTIVE_CHECK_MS - 1);
    expect(restored.load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(restored.load).toHaveBeenCalledTimes(2);
  });

  it("makes non-viewer reads after a restart wait for stale data", async () => {
    vi.useFakeTimers();
    const first = setup([available(pending)]);
    await first.store.read("a", { viewer: true });
    first.store.dispose();
    const merged = pullRequest({ state: "merged" });
    const restored = setup([available(merged)], first.owner);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(restored.store.read("a", { viewer: false })).resolves.toEqual(
      available(merged),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    const renamed = { ...merged, title: "Renamed" };
    restored.load.mockResolvedValue(available(renamed));
    await expect(restored.store.read("a", { viewer: false })).resolves.toEqual(
      available(renamed),
    );
  });

  it("replaces an environment's link on a branch change and deletes orphan snapshots", async () => {
    vi.useFakeTimers();
    const next = pullRequest({
      number: 43,
      url: "https://github.com/acme/bb/pull/43",
      headRefName: "next",
    });
    const { store, persistence, publish } = setup([
      available(pullRequest()),
      available(next),
    ]);
    await store.read("a", { viewer: true });
    store.refresh("a", true);
    await expect(store.read("a", { viewer: true })).resolves.toEqual(
      available(next),
    );
    expect(persistence.links()).toMatchObject([
      { environmentId: "a", url: next.url },
    ]);
    expect(
      persistence.snapshots().map((snapshot) => snapshot.pullRequest.url),
    ).toEqual([next.url]);
    store.watch("a", new AbortController().signal);
    await flush();
    publish.mockClear();
    store.remove("a");
    store.remove("a");
    expect(publish).toHaveBeenCalledExactlyOnceWith(["a"]);
    expect(persistence.links()).toEqual([]);
    expect(persistence.snapshots()).toEqual([]);
  });

  it("discards rows saved by another persistence version", async () => {
    const { store, owner } = setup([available(pullRequest())]);
    await store.read("a", { viewer: true });
    owner.bb.storage.database().pragma("user_version = 0");
    const reopened = createPullRequestPersistence(owner.bb.storage);
    expect(reopened.snapshots()).toEqual([]);
    expect(reopened.links()).toEqual([]);
  });

  it("persists absence and rediscovers after an unwatched branch refresh", async () => {
    const { store, persistence } = setup([
      { outcome: "absent" },
      available(pullRequest()),
    ]);
    await expect(store.read("a", { viewer: true })).resolves.toEqual({
      outcome: "absent",
    });
    expect(persistence.links()).toMatchObject([
      { environmentId: "a", url: null },
    ]);
    store.refresh("a", true);
    await expect(store.read("a", { viewer: true })).resolves.toEqual(
      available(pullRequest()),
    );
    expect(persistence.links()).toHaveLength(1);
  });

  it("rechecks quiet open PRs together every five minutes and leaves settled PRs alone", async () => {
    vi.useFakeTimers();
    const { store, load } = setup([]);
    const byEnvironment: Record<string, PullRequest> = {
      a: pullRequest({ url: "https://github.com/acme/bb/pull/1" }),
      b: pullRequest({ url: "https://github.com/acme/bb/pull/2" }),
      c: pullRequest({
        url: "https://github.com/acme/bb/pull/3",
        state: "merged",
      }),
    };
    load.mockImplementation(async (id) => available(byEnvironment[id]!));
    await store.read("a", { viewer: true });
    store.watch("a", new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    for (const id of ["b", "c"]) {
      await store.read(id, { viewer: true });
      store.watch(id, new AbortController().signal);
    }
    await flush();
    load.mockClear();
    await vi.advanceTimersByTimeAsync(3 * 60_000 - 1);
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(load.mock.calls.map(([id]) => id).sort()).toEqual(["a", "b"]);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(load.mock.calls.map(([id]) => id).sort()).toEqual([
      "a",
      "a",
      "b",
      "b",
    ]);
  });

  it("polls a watched draft PR with pending checks every 30 seconds and publishes when they pass", async () => {
    vi.useFakeTimers();
    const { store, load, publish } = setup([
      available({ ...pending, state: "draft" }),
    ]);
    await store.read("a", { viewer: true });
    store.watch("a", new AbortController().signal);
    await flush();
    load.mockClear();
    load.mockResolvedValue(available(pullRequest({ state: "draft" })));
    await vi.advanceTimersByTimeAsync(ACTIVE_CHECK_MS - 1);
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledExactlyOnceWith(["a"]);
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("rechecks a quiet failing draft PR and polls actively while a rerun is pending beside a failure", async () => {
    vi.useFakeTimers();
    const checks = (failedCount: number, pendingCount: number) => ({
      state: failedCount > 0 ? ("failing" as const) : ("passing" as const),
      totalCount: 2,
      passedCount: 2 - failedCount - pendingCount,
      failedCount,
      pendingCount,
    });
    const { store, load, publish } = setup([
      available(pullRequest({ state: "draft", checks: checks(2, 0) })),
    ]);
    await store.read("a", { viewer: true });
    store.watch("a", new AbortController().signal);
    await flush();
    load.mockClear();
    load.mockResolvedValue(
      available(pullRequest({ state: "draft", checks: checks(1, 1) })),
    );
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledExactlyOnceWith(["a"]);
    load.mockResolvedValue(
      available(pullRequest({ state: "draft", checks: checks(0, 0) })),
    );
    await vi.advanceTimersByTimeAsync(ACTIVE_CHECK_MS);
    expect(load).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith(["a"]);
    await expect(store.read("a", { viewer: true })).resolves.toEqual(
      available(pullRequest({ state: "draft", checks: checks(0, 0) })),
    );
  });

  it("keeps a missing PR for five minutes for viewers unless discovery is forced", async () => {
    vi.useFakeTimers();
    const { store, load } = setup([{ outcome: "absent" }]);
    await store.read("a", { viewer: true });
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    await store.read("a", { viewer: true });
    expect(load).toHaveBeenCalledTimes(1);
    store.refresh("a", true);
    await store.read("a", { viewer: true });
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await store.read("a", { viewer: true });
    expect(load).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10_000);
    await store.read("a", { viewer: false });
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("rechecks a pushed PR once when GitHub initially returns its previous quiet head", async () => {
    vi.useFakeTimers();
    const { store, load, publish } = setup([available(pullRequest())]);
    await store.read("a", { viewer: true });
    store.watch("a", new AbortController().signal);
    await flush();
    store.pushed("a");
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(publish).not.toHaveBeenCalled();
    load.mockResolvedValue(available(pending));
    await vi.advanceTimersByTimeAsync(ACTIVE_CHECK_MS);
    expect(load).toHaveBeenCalledTimes(3);
    expect(publish).toHaveBeenCalledExactlyOnceWith(["a"]);
  });

  it("fetches again after an action that completed during an in-flight poll", async () => {
    vi.useFakeTimers();
    const { store, load } = setup([available(pending)]);
    await store.read("a", { viewer: true });
    store.watch("a", new AbortController().signal);
    await flush();
    let finish!: (result: EnvironmentPullRequest) => void;
    load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await vi.advanceTimersByTimeAsync(ACTIVE_CHECK_MS);
    store.refresh("a");
    load.mockResolvedValue(available(pullRequest({ state: "merged" })));
    finish(available(pending));
    await flush();
    await expect(store.read("a", { viewer: true })).resolves.toEqual(
      available(pullRequest({ state: "merged" })),
    );
    expect(load).toHaveBeenCalledTimes(3);
  });
});

describe("aligned refresh ticks", () => {
  function pendingAt(number: number): PullRequest {
    return {
      ...pending,
      number,
      url: `https://github.com/acme/bb/pull/${number}`,
    };
  }

  it("refreshes every watched pending PR in the same tick once they are due within half an interval", async () => {
    vi.useFakeTimers();
    const prs = new Map([
      ["a", pendingAt(1)],
      ["b", pendingAt(2)],
      ["c", pendingAt(3)],
    ]);
    const { store, load } = setup([]);
    load.mockImplementation(async (id: string) => available(prs.get(id)!));
    const signals = [...prs.keys()].map(() => new AbortController());
    await store.read("a", { viewer: true });
    store.watch("a", signals[0]!.signal);
    await vi.advanceTimersByTimeAsync(10_000);
    await store.read("b", { viewer: true });
    store.watch("b", signals[1]!.signal);
    await vi.advanceTimersByTimeAsync(10_000);
    await store.read("c", { viewer: true });
    store.watch("c", signals[2]!.signal);
    await flush();
    load.mockClear();
    const ticks = new Map<number, string[]>();
    load.mockImplementation(async (id: string) => {
      ticks.set(Date.now(), [...(ticks.get(Date.now()) ?? []), id].sort());
      return available(prs.get(id)!);
    });
    await vi.advanceTimersByTimeAsync(ACTIVE_CHECK_MS * 4);
    expect([...ticks.values()].slice(-3)).toEqual([
      ["a", "b", "c"],
      ["a", "b", "c"],
      ["a", "b", "c"],
    ]);
    for (const signal of signals) signal.abort();
  });

  it("publishes PRs that change in the same tick together", async () => {
    vi.useFakeTimers();
    const prs = new Map([
      ["a", pendingAt(1)],
      ["b", pendingAt(2)],
    ]);
    const { store, load, publish } = setup([]);
    load.mockImplementation(async (id: string) => available(prs.get(id)!));
    const signals = [new AbortController(), new AbortController()];
    for (const [index, id] of ["a", "b"].entries()) {
      await store.read(id, { viewer: true });
      store.watch(id, signals[index]!.signal);
    }
    await flush();
    prs.set("a", { ...pendingAt(1), checks: { ...pullRequest().checks } });
    prs.set("b", { ...pendingAt(2), checks: { ...pullRequest().checks } });
    await vi.advanceTimersByTimeAsync(ACTIVE_CHECK_MS);
    expect(publish).toHaveBeenCalledExactlyOnceWith(["a", "b"]);
    for (const signal of signals) signal.abort();
  });

  it.each([
    ["open", 20_000, pullRequest(), 0],
    ["open", 31_000, pullRequest(), 1],
    [
      "merged",
      50 * 60_000,
      pullRequest({ state: "merged", attention: "merged" }),
      0,
    ],
    [
      "merged",
      61 * 60_000,
      pullRequest({ state: "merged", attention: "merged" }),
      1,
    ],
  ])(
    "re-reads a %s PR that comes back into view only when it is stale (%i ms old)",
    async (_state, age, pr, loads) => {
      vi.useFakeTimers();
      const { store, load } = setup([available(pr)]);
      await store.read("a", { viewer: true });
      await vi.advanceTimersByTimeAsync(age);
      load.mockClear();
      const signal = new AbortController();
      store.watch("a", signal.signal);
      await vi.advanceTimersByTimeAsync(20);
      expect(load).toHaveBeenCalledTimes(loads);
      signal.abort();
    },
  );
});

describe("read freshness", () => {
  it("answers an app read from memory at once and refreshes a stale row in the background", async () => {
    vi.useFakeTimers();
    const { store, load, publish } = setup([available(pullRequest())]);
    await store.read("a", { viewer: true });
    const signal = new AbortController();
    store.watch("a", signal.signal);
    await vi.advanceTimersByTimeAsync(60_000);
    load.mockClear();
    let release!: () => void;
    load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(available(pullRequest({ title: "Renamed" })));
        }),
    );
    await expect(store.read("a", { viewer: true })).resolves.toMatchObject({
      pullRequest: { title: "Watch the PR" },
    });
    expect(load).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(publish).toHaveBeenCalledWith(["a"]);
    signal.abort();
  });

  it.each([
    ["an open", pullRequest(), 29_000, 31_000],
    ["a merged", pullRequest({ state: "merged" }), 59 * 60_000, 61 * 60_000],
    ["a closed", pullRequest({ state: "closed" }), 59 * 60_000, 61 * 60_000],
  ])(
    "lets app reads reuse %s PR until it is stale",
    async (_, value, fresh, stale) => {
      vi.useFakeTimers();
      const { store, load } = setup([available(value)]);
      await store.read("a", { viewer: true });
      load.mockClear();
      await vi.advanceTimersByTimeAsync(fresh);
      await store.read("a", { viewer: true });
      expect(load).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(stale - fresh);
      await store.read("a", { viewer: true });
      expect(load).toHaveBeenCalledTimes(1);
    },
  );

  it("makes an app read wait when there is no row yet", async () => {
    vi.useFakeTimers();
    const { store, load } = setup([available(pullRequest())]);
    await expect(store.read("a", { viewer: true })).resolves.toMatchObject({
      outcome: "available",
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("re-reads a fresh row from GitHub on request and resolves once it is current", async () => {
    vi.useFakeTimers();
    const { store, load } = setup([available(pullRequest())]);
    await store.read("a", { viewer: true });
    load.mockResolvedValue(available(pullRequest({ title: "Renamed" })));
    await store.reread("a");
    expect(load).toHaveBeenCalledTimes(2);
    await expect(store.read("a", { viewer: true })).resolves.toMatchObject({
      pullRequest: { title: "Renamed" },
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("makes a one-shot read wait for a row older than ten seconds", async () => {
    vi.useFakeTimers();
    const { store, load } = setup([available(pullRequest())]);
    await store.read("a", { viewer: true });
    load.mockClear();
    await vi.advanceTimersByTimeAsync(9_000);
    await store.read("a", { viewer: false });
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    load.mockResolvedValue(available(pullRequest({ title: "Renamed" })));
    await expect(store.read("a", { viewer: false })).resolves.toMatchObject({
      pullRequest: { title: "Renamed" },
    });
  });
});
