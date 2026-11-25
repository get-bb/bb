import type { EnvironmentPullRequest, PullRequest } from "./contract.js";
import {
  pullRequestTargetKey,
  type PullRequestPersistence,
  type PullRequestTarget,
} from "./persistence.js";

const READ_FRESH_MS = 10_000;
const OPEN_STALE_MS = 30_000;
const SETTLED_STALE_MS = 60 * 60_000;
const ABSENT_STALE_MS = 5 * 60_000;
const ACTIVE_CHECK_MS = 30_000;
const QUIET_CHECK_MS = 5 * 60_000;
const WATCH_READ_WINDOW_MS = 10;

export type TargetPullRequest =
  | { outcome: "available"; pullRequest: PullRequest }
  | { outcome: "absent" }
  | { outcome: "unavailable"; message: string };

type Snapshot = { pullRequest: PullRequest; fetchedAt: number };
type Lookup =
  | { outcome: "available"; url: string }
  | { outcome: "absent" }
  | { outcome: "unavailable"; message: string };
type Entry = { lookup: Lookup; fetchedAt: number };
type Check = { target: PullRequestTarget; interval: number; dueAt: number };

function live(pr: PullRequest): boolean {
  return pr.state === "open" || pr.state === "draft";
}

function active(pr: PullRequest): boolean {
  return (
    live(pr) &&
    (pr.autoMerge ||
      pr.inMergeQueue === true ||
      pr.checks.pendingCount > 0 ||
      pr.mergeability.state === "unknown")
  );
}

export function createPullRequestStore(options: {
  load(
    target: PullRequestTarget,
    url: string | null,
    refresh: boolean,
  ): Promise<TargetPullRequest>;
  branch(target: PullRequestTarget): string | null;
  persistence: PullRequestPersistence;
  publish(targets: readonly PullRequestTarget[]): void;
  onCheckFailed(target: PullRequestTarget, error: unknown): void;
}) {
  const known = new Map<string, PullRequestTarget>();
  const snapshots = new Map<string, Snapshot>();
  const lookups = new Map<string, Entry>();
  const watches = new Map<string, Set<AbortSignal>>();
  const served = new Map<string, string>();
  const inflight = new Map<string, Promise<void>>();
  const settling = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watchReadTimer: ReturnType<typeof setTimeout> | undefined;
  const watchReads = new Set<string>();
  const unpublished = new Set<string>();
  const generations = new Map<string, number>();
  let disposed = false;

  function keyOf(target: PullRequestTarget): string {
    const key = pullRequestTargetKey(target);
    if (!known.has(key)) known.set(key, target);
    return key;
  }

  function targetOf(key: string): PullRequestTarget {
    return known.get(key)!;
  }

  for (const snapshot of options.persistence.snapshots())
    snapshots.set(snapshot.pullRequest.url, snapshot);
  for (const row of options.persistence.targets()) {
    const snapshot = row.url === null ? undefined : snapshots.get(row.url);
    if (row.url !== null && snapshot === undefined) continue;
    lookups.set(keyOf(row.target), {
      lookup:
        row.url === null
          ? { outcome: "absent" }
          : { outcome: "available", url: row.url },
      fetchedAt: snapshot?.fetchedAt ?? row.discoveredAt,
    });
  }

  function urlFor(key: string): string | null {
    const lookup = lookups.get(key)?.lookup;
    return lookup?.outcome === "available" ? lookup.url : null;
  }

  function resultFor(key: string): TargetPullRequest {
    const lookup = lookups.get(key)?.lookup;
    if (lookup === undefined) return { outcome: "absent" };
    if (lookup.outcome !== "available") return lookup;
    const snapshot = snapshots.get(lookup.url);
    return snapshot
      ? { outcome: "available", pullRequest: snapshot.pullRequest }
      : { outcome: "absent" };
  }

  function dropOrphanSnapshots() {
    const referenced = new Set<string>();
    for (const key of lookups.keys()) {
      const url = urlFor(key);
      if (url !== null) referenced.add(url);
    }
    for (const url of snapshots.keys()) {
      if (referenced.has(url)) continue;
      snapshots.delete(url);
      settling.delete(url);
    }
  }

  function publishChanges() {
    if (disposed) return;
    const changed: string[] = [];
    for (const key of watches.keys()) {
      const content = JSON.stringify(resultFor(key));
      const previous = served.get(key);
      if (previous !== undefined && previous !== content) changed.push(key);
      served.set(key, content);
    }
    if (changed.length === 0) return;
    if (unpublished.size === 0)
      queueMicrotask(() => {
        const keys = [...unpublished];
        unpublished.clear();
        if (!disposed && keys.length > 0) options.publish(keys.map(targetOf));
      });
    for (const key of changed) unpublished.add(key);
  }

  function checks(): Map<string, Check> {
    const due = new Map<string, Check>();
    for (const key of watches.keys()) {
      const url = urlFor(key);
      if (url === null || due.has(url) || inflight.has(url)) continue;
      const snapshot = snapshots.get(url);
      if (snapshot === undefined) continue;
      const interval =
        active(snapshot.pullRequest) ||
        (settling.get(url) ?? 0) > snapshot.fetchedAt
          ? ACTIVE_CHECK_MS
          : live(snapshot.pullRequest)
            ? QUIET_CHECK_MS
            : null;
      if (interval !== null)
        due.set(url, {
          target: targetOf(key),
          interval,
          dueAt: snapshot.fetchedAt + interval,
        });
    }
    return due;
  }

  function schedule() {
    clearTimeout(timer);
    timer = undefined;
    if (disposed) return;
    const pending = [...checks().values()];
    if (pending.length === 0) return;
    const next = Math.min(...pending.map((check) => check.dueAt));
    timer = setTimeout(
      () => {
        timer = undefined;
        const now = Date.now();
        for (const [url, check] of checks()) {
          if (check.dueAt - check.interval / 2 <= now)
            void load(check.target, url);
        }
        schedule();
      },
      Math.max(0, next - Date.now()),
    );
  }

  async function load(
    target: PullRequestTarget,
    url: string | null,
    refresh = false,
  ): Promise<void> {
    const key = keyOf(target);
    const flight = url ?? `target:${key}`;
    const pending = inflight.get(flight);
    if (pending !== undefined) return pending;
    const generation = generations.get(key) ?? 0;
    const task = Promise.resolve()
      .then(async () => {
        let result = await options.load(target, url, refresh);
        if (url !== null && result.outcome === "unavailable") {
          for (const candidate of watches.keys()) {
            if (candidate === key || urlFor(candidate) !== url) continue;
            const alternative = await options.load(
              targetOf(candidate),
              url,
              false,
            );
            if (
              alternative.outcome === "available" &&
              alternative.pullRequest.url === url
            ) {
              result = alternative;
              break;
            }
          }
        }
        if (disposed || (generations.get(key) ?? 0) !== generation) return;
        const fetchedAt = Date.now();
        if (result.outcome === "available") {
          const pr = result.pullRequest;
          snapshots.set(pr.url, { pullRequest: pr, fetchedAt });
          options.persistence.saveSnapshot(pr, fetchedAt);
          for (const [id, entry] of lookups) {
            if (urlFor(id) === pr.url) lookups.set(id, { ...entry, fetchedAt });
          }
        } else if (url !== null) {
          const snapshot = snapshots.get(url);
          if (snapshot !== undefined) snapshot.fetchedAt = fetchedAt;
        }
        if (
          url === null ||
          (urlFor(key) === url && result.outcome !== "unavailable")
        ) {
          lookups.set(key, {
            lookup:
              result.outcome === "available"
                ? { outcome: "available", url: result.pullRequest.url }
                : result,
            fetchedAt,
          });
          if (result.outcome !== "unavailable")
            options.persistence.link(
              target,
              result.outcome === "available" ? result.pullRequest.url : null,
              options.branch(target),
              fetchedAt,
            );
          dropOrphanSnapshots();
        }
        publishChanges();
      })
      .catch((error) => {
        if (url !== null) {
          const snapshot = snapshots.get(url);
          if (snapshot) snapshot.fetchedAt = Date.now();
        }
        options.onCheckFailed(target, error);
      })
      .finally(() => {
        if (inflight.get(flight) === task) inflight.delete(flight);
        schedule();
      });
    inflight.set(flight, task);
    return task;
  }

  function isSettled(target: PullRequestTarget): boolean {
    const url = urlFor(keyOf(target));
    const state = url === null ? null : snapshots.get(url)?.pullRequest.state;
    return state === "merged" || state === "closed";
  }

  function staleAfterMs(target: PullRequestTarget, entry: Entry): number {
    if (entry.lookup.outcome === "absent") return ABSENT_STALE_MS;
    return isSettled(target) ? SETTLED_STALE_MS : OPEN_STALE_MS;
  }

  async function read(
    target: PullRequestTarget,
    { viewer }: { viewer: boolean },
  ): Promise<TargetPullRequest> {
    const key = keyOf(target);
    const cached = lookups.get(key);
    const age =
      cached === undefined
        ? Number.POSITIVE_INFINITY
        : Date.now() - cached.fetchedAt;
    const stale =
      cached === undefined ||
      age >= (viewer ? staleAfterMs(target, cached) : READ_FRESH_MS);
    if (stale) {
      const loading = load(target, urlFor(key));
      if (cached === undefined || !viewer) await loading;
    }
    const result = resultFor(key);
    if (viewer) served.set(key, JSON.stringify(result));
    schedule();
    return result;
  }

  function stopWatching(key: string, signal: AbortSignal) {
    const signals = watches.get(key);
    if (signals === undefined || !signals.delete(signal)) return;
    if (signals.size === 0) watches.delete(key);
    schedule();
  }

  return {
    read,
    currentUrl(target: PullRequestTarget): string | null {
      return urlFor(keyOf(target));
    },
    isSettled,
    hasPullRequest(target: PullRequestTarget) {
      return urlFor(keyOf(target)) !== null;
    },
    isWatched(target: PullRequestTarget) {
      return watches.has(keyOf(target));
    },
    refresh(target: PullRequestTarget, discover = false) {
      const key = keyOf(target);
      if (discover) {
        generations.set(key, (generations.get(key) ?? 0) + 1);
        lookups.delete(key);
      } else {
        const cached = lookups.get(key);
        if (cached) cached.fetchedAt = Number.NEGATIVE_INFINITY;
      }
      if (watches.has(key)) {
        const url = discover ? null : urlFor(key);
        const pending = inflight.get(url ?? `target:${key}`);
        if (pending) void pending.then(() => load(target, url, discover));
        else void load(target, url, discover);
      }
    },
    async reread(target: PullRequestTarget) {
      const cached = lookups.get(keyOf(target));
      if (cached) cached.fetchedAt = Number.NEGATIVE_INFINITY;
      await read(target, { viewer: false });
    },
    pushed(target: PullRequestTarget) {
      const key = keyOf(target);
      const url = urlFor(key);
      if (url === null) return;
      settling.set(url, Date.now() + ACTIVE_CHECK_MS);
      const cached = lookups.get(key);
      if (cached) cached.fetchedAt = Number.NEGATIVE_INFINITY;
      if (watches.has(key)) void load(target, url);
    },
    recheck(target: PullRequestTarget) {
      if (watches.has(keyOf(target))) void read(target, { viewer: false });
    },
    remove(target: PullRequestTarget) {
      const key = keyOf(target);
      const previous = JSON.stringify(resultFor(key));
      generations.set(key, (generations.get(key) ?? 0) + 1);
      lookups.delete(key);
      served.delete(key);
      options.persistence.removeTarget(target);
      if (watches.has(key) && previous !== JSON.stringify(resultFor(key)))
        options.publish([target]);
      dropOrphanSnapshots();
      schedule();
    },
    watch(target: PullRequestTarget, signal: AbortSignal) {
      if (signal.aborted || disposed) return;
      const key = keyOf(target);
      const signals = watches.get(key) ?? new Set<AbortSignal>();
      signals.add(signal);
      watches.set(key, signals);
      signal.addEventListener("abort", () => stopWatching(key, signal), {
        once: true,
      });
      watchReads.add(key);
      watchReadTimer ??= setTimeout(() => {
        watchReadTimer = undefined;
        const keys = [...watchReads];
        watchReads.clear();
        for (const id of keys)
          if (watches.has(id)) void read(targetOf(id), { viewer: true });
      }, WATCH_READ_WINDOW_MS);
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      timer = undefined;
      clearTimeout(watchReadTimer);
    },
  };
}
