import type { EnvironmentPullRequest, PullRequest } from "./contract.js";
import type { PullRequestPersistence } from "./persistence.js";

const READ_FRESH_MS = 10_000;
const OPEN_STALE_MS = 30_000;
const SETTLED_STALE_MS = 60 * 60_000;
const ABSENT_STALE_MS = 5 * 60_000;
const ACTIVE_CHECK_MS = 30_000;
const QUIET_CHECK_MS = 5 * 60_000;
const WATCH_READ_WINDOW_MS = 10;

type Snapshot = { pullRequest: PullRequest; fetchedAt: number };
type Lookup =
  | { outcome: "available"; url: string }
  | { outcome: "absent" }
  | { outcome: "unavailable"; message: string };
type Entry = { lookup: Lookup; fetchedAt: number };
type Check = { environmentId: string; interval: number; dueAt: number };

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
    environmentId: string,
    url: string | null,
    refresh: boolean,
  ): Promise<EnvironmentPullRequest>;
  branch(environmentId: string): string | null;
  persistence: PullRequestPersistence;
  publish(environmentIds: readonly string[]): void;
  onCheckFailed(environmentId: string, error: unknown): void;
}) {
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
  for (const snapshot of options.persistence.snapshots())
    snapshots.set(snapshot.pullRequest.url, snapshot);
  for (const link of options.persistence.links()) {
    const snapshot = link.url === null ? undefined : snapshots.get(link.url);
    if (link.url !== null && snapshot === undefined) continue;
    lookups.set(link.environmentId, {
      lookup:
        link.url === null
          ? { outcome: "absent" }
          : { outcome: "available", url: link.url },
      fetchedAt: snapshot?.fetchedAt ?? link.discoveredAt,
    });
  }

  function currentUrl(environmentId: string): string | null {
    const lookup = lookups.get(environmentId)?.lookup;
    return lookup?.outcome === "available" ? lookup.url : null;
  }

  function resultFor(environmentId: string): EnvironmentPullRequest {
    const lookup = lookups.get(environmentId)?.lookup;
    if (lookup === undefined) return { outcome: "absent" };
    if (lookup.outcome !== "available") return lookup;
    const snapshot = snapshots.get(lookup.url);
    return snapshot
      ? { outcome: "available", pullRequest: snapshot.pullRequest }
      : { outcome: "absent" };
  }

  function dropOrphanSnapshots() {
    const referenced = new Set<string>();
    for (const environmentId of lookups.keys()) {
      const url = currentUrl(environmentId);
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
    for (const environmentId of watches.keys()) {
      const content = JSON.stringify(resultFor(environmentId));
      const previous = served.get(environmentId);
      if (previous !== undefined && previous !== content)
        changed.push(environmentId);
      served.set(environmentId, content);
    }
    if (changed.length === 0) return;
    if (unpublished.size === 0)
      queueMicrotask(() => {
        const environmentIds = [...unpublished];
        unpublished.clear();
        if (!disposed && environmentIds.length > 0)
          options.publish(environmentIds);
      });
    for (const environmentId of changed) unpublished.add(environmentId);
  }

  function checks(): Map<string, Check> {
    const due = new Map<string, Check>();
    for (const environmentId of watches.keys()) {
      const url = currentUrl(environmentId);
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
          environmentId,
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
            void load(check.environmentId, url);
        }
        schedule();
      },
      Math.max(0, next - Date.now()),
    );
  }

  async function load(
    environmentId: string,
    url: string | null,
    refresh = false,
  ): Promise<void> {
    const key = url ?? `environment:${environmentId}`;
    const pending = inflight.get(key);
    if (pending !== undefined) return pending;
    const generation = generations.get(environmentId) ?? 0;
    const task = Promise.resolve()
      .then(async () => {
        let result = await options.load(environmentId, url, refresh);
        if (url !== null && result.outcome === "unavailable") {
          for (const candidate of watches.keys()) {
            if (candidate === environmentId || currentUrl(candidate) !== url)
              continue;
            const alternative = await options.load(candidate, url, false);
            if (
              alternative.outcome === "available" &&
              alternative.pullRequest.url === url
            ) {
              result = alternative;
              break;
            }
          }
        }
        if (disposed || (generations.get(environmentId) ?? 0) !== generation)
          return;
        const fetchedAt = Date.now();
        if (result.outcome === "available") {
          const pr = result.pullRequest;
          snapshots.set(pr.url, { pullRequest: pr, fetchedAt });
          options.persistence.saveSnapshot(pr, fetchedAt);
          for (const [id, entry] of lookups) {
            if (currentUrl(id) === pr.url)
              lookups.set(id, { ...entry, fetchedAt });
          }
        } else if (url !== null) {
          const snapshot = snapshots.get(url);
          if (snapshot !== undefined) snapshot.fetchedAt = fetchedAt;
        }
        if (url === null || currentUrl(environmentId) === url) {
          lookups.set(environmentId, {
            lookup:
              result.outcome === "available"
                ? { outcome: "available", url: result.pullRequest.url }
                : result,
            fetchedAt,
          });
          if (result.outcome !== "unavailable")
            options.persistence.link(
              environmentId,
              result.outcome === "available" ? result.pullRequest.url : null,
              options.branch(environmentId),
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
        options.onCheckFailed(environmentId, error);
      })
      .finally(() => {
        if (inflight.get(key) === task) inflight.delete(key);
        schedule();
      });
    inflight.set(key, task);
    return task;
  }

  function staleAfterMs(environmentId: string, entry: Entry): number {
    if (entry.lookup.outcome === "absent") return ABSENT_STALE_MS;
    const url = currentUrl(environmentId);
    const state = url === null ? null : snapshots.get(url)?.pullRequest.state;
    return state === "merged" || state === "closed"
      ? SETTLED_STALE_MS
      : OPEN_STALE_MS;
  }

  async function read(
    environmentId: string,
    { viewer }: { viewer: boolean },
  ): Promise<EnvironmentPullRequest> {
    const cached = lookups.get(environmentId);
    const age =
      cached === undefined
        ? Number.POSITIVE_INFINITY
        : Date.now() - cached.fetchedAt;
    const stale =
      cached === undefined ||
      age >= (viewer ? staleAfterMs(environmentId, cached) : READ_FRESH_MS);
    if (stale) {
      const loading = load(environmentId, currentUrl(environmentId));
      if (cached === undefined || !viewer) await loading;
    }
    const result = resultFor(environmentId);
    if (viewer) served.set(environmentId, JSON.stringify(result));
    schedule();
    return result;
  }

  return {
    read,
    currentUrl,
    hasPullRequest(environmentId: string) {
      return currentUrl(environmentId) !== null;
    },
    isWatched(environmentId: string) {
      return watches.has(environmentId);
    },
    refresh(environmentId: string, discover = false) {
      if (discover) {
        generations.set(
          environmentId,
          (generations.get(environmentId) ?? 0) + 1,
        );
        lookups.delete(environmentId);
      } else {
        const cached = lookups.get(environmentId);
        if (cached) cached.fetchedAt = Number.NEGATIVE_INFINITY;
      }
      if (watches.has(environmentId)) {
        const url = discover ? null : currentUrl(environmentId);
        const pending = inflight.get(url ?? `environment:${environmentId}`);
        if (pending)
          void pending.then(() => load(environmentId, url, discover));
        else void load(environmentId, url, discover);
      }
    },
    async reread(environmentId: string) {
      const cached = lookups.get(environmentId);
      if (cached) cached.fetchedAt = Number.NEGATIVE_INFINITY;
      await read(environmentId, { viewer: false });
    },
    pushed(environmentId: string) {
      const url = currentUrl(environmentId);
      if (url === null) return;
      settling.set(url, Date.now() + ACTIVE_CHECK_MS);
      const cached = lookups.get(environmentId);
      if (cached) cached.fetchedAt = Number.NEGATIVE_INFINITY;
      if (watches.has(environmentId)) void load(environmentId, url);
    },
    recheck(environmentId: string) {
      if (watches.has(environmentId))
        void read(environmentId, { viewer: false });
    },
    remove(environmentId: string) {
      const previous = JSON.stringify(resultFor(environmentId));
      generations.set(environmentId, (generations.get(environmentId) ?? 0) + 1);
      lookups.delete(environmentId);
      served.delete(environmentId);
      options.persistence.removeEnvironment(environmentId);
      if (
        watches.has(environmentId) &&
        previous !== JSON.stringify(resultFor(environmentId))
      )
        options.publish([environmentId]);
      dropOrphanSnapshots();
      schedule();
    },
    watch(environmentId: string, signal: AbortSignal) {
      if (signal.aborted || disposed) return;
      const signals = watches.get(environmentId) ?? new Set<AbortSignal>();
      signals.add(signal);
      watches.set(environmentId, signals);
      signal.addEventListener(
        "abort",
        () => {
          signals.delete(signal);
          if (signals.size === 0) watches.delete(environmentId);
          schedule();
        },
        { once: true },
      );
      watchReads.add(environmentId);
      watchReadTimer ??= setTimeout(() => {
        watchReadTimer = undefined;
        const environmentIds = [...watchReads];
        watchReads.clear();
        for (const id of environmentIds)
          if (watches.has(id)) void read(id, { viewer: true });
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
