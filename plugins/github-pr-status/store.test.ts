import { afterEach, describe, expect, it, vi } from "vitest";
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

function available(pr: PullRequest): EnvironmentPullRequest {
  return { outcome: "available", pullRequest: pr };
}

function createHarness(results: EnvironmentPullRequest[]) {
  const load = vi.fn(async (_environmentId: string) => {
    const next = results.length > 1 ? results.shift()! : results[0]!;
    return next;
  });
  const publish = vi.fn();
  const store = createPullRequestStore({ load, publish });
  return { load, publish, store };
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("pull request store", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("checks an active pull request only while watched and publishes only changes", async () => {
    vi.useFakeTimers();
    const { load, publish, store } = createHarness([
      available(pending),
      available(pending),
      available(pullRequest()),
    ]);
    await store.read("env-1", { viewer: true });
    const controller = new AbortController();
    store.watch("env-1", controller.signal);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(ACTIVE_CHECK_MS);
    expect(load).toHaveBeenCalledTimes(2);
    expect(publish).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(ACTIVE_CHECK_MS);
    expect(load).toHaveBeenCalledTimes(3);
    expect(publish).toHaveBeenCalledExactlyOnceWith(["env-1"]);

    await vi.advanceTimersByTimeAsync(ACTIVE_CHECK_MS * 3);
    expect(load).toHaveBeenCalledTimes(3);
    controller.abort();
  });

  it("stops checking when the watch is aborted", async () => {
    vi.useFakeTimers();
    const { load, store } = createHarness([available(pending)]);
    const controller = new AbortController();
    store.watch("env-1", controller.signal);
    await flush();
    controller.abort();
    await vi.advanceTimersByTimeAsync(ACTIVE_CHECK_MS * 3);
    expect(load).toHaveBeenCalledTimes(1);
    expect(store.isWatched("env-1")).toBe(false);
  });

  it("serves reads from a short cache and shares one in-flight load", async () => {
    vi.useFakeTimers();
    const { load, store } = createHarness([available(pullRequest())]);
    const [first, second] = await Promise.all([
      store.read("env-1", { viewer: true }),
      store.read("env-1", { viewer: true }),
    ]);
    expect(first).toEqual(second);
    await store.read("env-1", { viewer: true });
    expect(load).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    await store.read("env-1", { viewer: true });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("makes the next read fresh after a refresh of an unwatched environment", async () => {
    const { load, store } = createHarness([available(pullRequest())]);
    await store.read("env-1", { viewer: true });
    store.refresh("env-1");
    await store.read("env-1", { viewer: true });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("re-checks a watched environment on refresh and publishes the change", async () => {
    vi.useFakeTimers();
    const { publish, store } = createHarness([
      available(pullRequest()),
      { outcome: "absent" },
    ]);
    store.watch("env-1", new AbortController().signal);
    await flush();
    store.refresh("env-1");
    await flush();
    expect(publish).toHaveBeenCalledExactlyOnceWith(["env-1"]);
    await expect(store.read("env-1", { viewer: true })).resolves.toEqual({
      outcome: "absent",
    });
  });

  it("publishes every watched environment that shares the refreshed pull request", async () => {
    vi.useFakeTimers();
    const results = new Map<string, EnvironmentPullRequest[]>([
      ["env-1", [available(pullRequest())]],
      ["env-2", [available(pullRequest()), available(pending)]],
    ]);
    const publish = vi.fn();
    const store = createPullRequestStore({
      load: async (environmentId) => {
        const queue = results.get(environmentId)!;
        return queue.length > 1 ? queue.shift()! : queue[0]!;
      },
      publish,
    });
    store.watch("env-1", new AbortController().signal);
    store.watch("env-2", new AbortController().signal);
    await flush();
    store.refresh("env-2");
    await flush();
    expect(publish).toHaveBeenCalledExactlyOnceWith(["env-1", "env-2"]);
    await expect(store.read("env-1", { viewer: true })).resolves.toEqual(
      available(pending),
    );
  });

  it("does not publish a change the opening viewer's own read is fetching", async () => {
    vi.useFakeTimers();
    const { load, publish, store } = createHarness([
      available(pending),
      available(pullRequest()),
    ]);
    await store.read("env-1", { viewer: true });
    await vi.advanceTimersByTimeAsync(60_000);

    const controller = new AbortController();
    store.watch("env-1", controller.signal);
    const opened = store.read("env-1", { viewer: true });
    await flush();

    await expect(opened).resolves.toEqual(available(pullRequest()));
    expect(load).toHaveBeenCalledTimes(2);
    expect(publish).not.toHaveBeenCalled();
    controller.abort();
  });

  it("publishes a change to a viewer that kept an older row while unwatched", async () => {
    vi.useFakeTimers();
    const { publish, store } = createHarness([
      available(pending),
      available(pullRequest()),
    ]);
    await store.read("env-1", { viewer: true });
    await vi.advanceTimersByTimeAsync(60_000);

    const controller = new AbortController();
    store.watch("env-1", controller.signal);
    await flush();

    expect(publish).toHaveBeenCalledExactlyOnceWith(["env-1"]);
    controller.abort();
  });

  it("resumes checking when a read finds checks pending again", async () => {
    vi.useFakeTimers();
    const { load, store } = createHarness([
      available(pullRequest()),
      available(pending),
    ]);
    store.watch("env-1", new AbortController().signal);
    await flush();
    await vi.advanceTimersByTimeAsync(ACTIVE_CHECK_MS * 2);
    expect(load).toHaveBeenCalledTimes(1);

    await store.read("env-1", { viewer: true });
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(ACTIVE_CHECK_MS);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("rechecks a watched environment through the short cache", async () => {
    vi.useFakeTimers();
    const { load, store } = createHarness([available(pullRequest())]);
    store.watch("env-1", new AbortController().signal);
    await flush();
    store.recheck("env-1");
    await flush();
    expect(load).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    store.recheck("env-1");
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("makes the next check fresh after an invalidation without loading", async () => {
    vi.useFakeTimers();
    const { load, store } = createHarness([available(pullRequest())]);
    store.watch("env-1", new AbortController().signal);
    await flush();
    store.invalidate("env-1");
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    store.recheck("env-1");
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not let a load that started before a refresh overwrite newer data", async () => {
    let resolveStale: (value: EnvironmentPullRequest) => void = () => {};
    const load = vi
      .fn<(environmentId: string) => Promise<EnvironmentPullRequest>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStale = resolve;
          }),
      )
      .mockResolvedValue({ outcome: "absent" });
    const store = createPullRequestStore({ load, publish: vi.fn() });
    const stale = store.read("env-1", { viewer: true });
    store.refresh("env-1");
    await expect(store.read("env-1", { viewer: true })).resolves.toEqual({
      outcome: "absent",
    });
    resolveStale(available(pullRequest()));
    await stale;
    await expect(store.read("env-1", { viewer: true })).resolves.toEqual({
      outcome: "absent",
    });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
