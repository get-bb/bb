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

  it("serves restored snapshots immediately, keeps the due time, and writes nothing for identical content", async () => {
    vi.useFakeTimers();
    const first = setup([available(pending)]);
    await first.store.read("a", { viewer: true });
    const changes = first.owner.bb.storage
      .database()
      .prepare("SELECT total_changes() AS n")
      .get();
    await vi.advanceTimersByTimeAsync(10_000);
    await first.store.read("a", { viewer: true });
    expect(
      first.owner.bb.storage
        .database()
        .prepare("SELECT total_changes() AS n")
        .get(),
    ).toEqual(changes);
    first.store.dispose();
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
