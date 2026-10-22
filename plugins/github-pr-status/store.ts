import type { EnvironmentPullRequest, PullRequest } from "./contract.js";

const CACHE_TTL_MS = 10_000;
const ACTIVE_CHECK_MS = 30_000;

type EnvironmentLookup =
  | { outcome: "available"; url: string }
  | { outcome: "absent" }
  | { outcome: "unavailable"; message: string };

interface CachedLookup {
  lookup: EnvironmentLookup;
  fetchedAt: number;
}

interface Watch {
  fingerprint: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  checking: boolean;
  recheck: boolean;
}

export interface PullRequestStore {
  read(
    environmentId: string,
    options: { viewer: boolean },
  ): Promise<EnvironmentPullRequest>;
  refresh(environmentId: string): void;
  recheck(environmentId: string): void;
  invalidate(environmentId: string): void;
  watch(environmentId: string, signal: AbortSignal): void;
  isWatched(environmentId: string): boolean;
}

function needsActiveChecks(result: EnvironmentPullRequest): boolean {
  if (result.outcome !== "available") return false;
  const { pullRequest } = result;
  return (
    pullRequest.state === "open" &&
    (pullRequest.autoMerge ||
      pullRequest.inMergeQueue === true ||
      pullRequest.checks.state === "pending" ||
      pullRequest.mergeability.state === "unknown")
  );
}

export function createPullRequestStore(options: {
  load(environmentId: string): Promise<EnvironmentPullRequest>;
  publish(environmentIds: readonly string[]): void;
  onCheckFailed?(environmentId: string, error: unknown): void;
  now?(): number;
}): PullRequestStore {
  const now = options.now ?? Date.now;
  const lookups = new Map<string, CachedLookup>();
  const pullRequests = new Map<string, PullRequest>();
  const inflight = new Map<
    string,
    { load: Promise<EnvironmentPullRequest>; toReader: boolean }
  >();
  const served = new Map<string, string>();
  const generations = new Map<string, number>();
  const watches = new Map<string, Watch>();

  function resolve(lookup: EnvironmentLookup): EnvironmentPullRequest {
    if (lookup.outcome !== "available") return lookup;
    const pullRequest = pullRequests.get(lookup.url);
    return pullRequest === undefined
      ? { outcome: "absent" }
      : { outcome: "available", pullRequest };
  }

  function fingerprintOf(environmentId: string): string | null {
    const cached = lookups.get(environmentId);
    return cached === undefined ? null : JSON.stringify(resolve(cached.lookup));
  }

  function urlOf(environmentId: string): string | null {
    const lookup = lookups.get(environmentId)?.lookup;
    return lookup?.outcome === "available" ? lookup.url : null;
  }

  function markServed(environmentId: string): void {
    const fingerprint = fingerprintOf(environmentId);
    if (fingerprint === null) return;
    served.set(environmentId, fingerprint);
    const watch = watches.get(environmentId);
    if (watch === undefined) return;
    watch.fingerprint = fingerprint;
    if (!watch.checking) schedule(environmentId, watch);
  }

  function record(
    environmentId: string,
    result: EnvironmentPullRequest,
    toReader: boolean,
  ) {
    const lookup: EnvironmentLookup =
      result.outcome === "available"
        ? { outcome: "available", url: result.pullRequest.url }
        : result;
    if (result.outcome === "available")
      pullRequests.set(result.pullRequest.url, result.pullRequest);
    lookups.set(environmentId, { lookup, fetchedAt: now() });
    const changed: string[] = [];
    for (const [watchedId, watch] of watches) {
      const affected =
        watchedId === environmentId ||
        (lookup.outcome === "available" && urlOf(watchedId) === lookup.url);
      if (!affected) continue;
      const fingerprint = fingerprintOf(watchedId);
      if (
        watch.fingerprint !== null &&
        watch.fingerprint !== fingerprint &&
        !(toReader && watchedId === environmentId)
      )
        changed.push(watchedId);
      watch.fingerprint = fingerprint;
      if (!watch.checking) schedule(watchedId, watch);
    }
    if (toReader) markServed(environmentId);
    if (changed.length > 0) options.publish(changed);
  }

  function forget(environmentId: string): void {
    generations.set(environmentId, (generations.get(environmentId) ?? 0) + 1);
    lookups.delete(environmentId);
    inflight.delete(environmentId);
  }

  function read(
    environmentId: string,
    toReader: boolean,
  ): Promise<EnvironmentPullRequest> {
    const cached = lookups.get(environmentId);
    if (cached !== undefined && now() - cached.fetchedAt < CACHE_TTL_MS) {
      if (toReader) markServed(environmentId);
      return Promise.resolve(resolve(cached.lookup));
    }
    const pending = inflight.get(environmentId);
    if (pending !== undefined) {
      pending.toReader ||= toReader;
      return pending.load;
    }
    const generation = generations.get(environmentId) ?? 0;
    const entry = {
      toReader,
      load: options.load(environmentId).then((result) => {
        if ((generations.get(environmentId) ?? 0) === generation) {
          inflight.delete(environmentId);
          record(environmentId, result, entry.toReader);
        }
        return result;
      }),
    };
    inflight.set(environmentId, entry);
    entry.load.catch(() => {
      if (inflight.get(environmentId) === entry) inflight.delete(environmentId);
    });
    return entry.load;
  }

  function schedule(environmentId: string, watch: Watch): void {
    if (watch.timer !== null) clearTimeout(watch.timer);
    watch.timer = null;
    const cached = lookups.get(environmentId);
    if (cached === undefined || !needsActiveChecks(resolve(cached.lookup)))
      return;
    watch.timer = setTimeout(() => {
      watch.timer = null;
      void check(environmentId, true);
    }, ACTIVE_CHECK_MS);
  }

  async function check(environmentId: string, fresh: boolean): Promise<void> {
    const watch = watches.get(environmentId);
    if (watch === undefined) return;
    if (watch.checking) {
      watch.recheck ||= fresh;
      return;
    }
    watch.checking = true;
    if (fresh) forget(environmentId);
    try {
      await read(environmentId, false);
    } catch (error) {
      options.onCheckFailed?.(environmentId, error);
    } finally {
      watch.checking = false;
    }
    if (watches.get(environmentId) !== watch) return;
    if (watch.recheck) {
      watch.recheck = false;
      void check(environmentId, true);
      return;
    }
    schedule(environmentId, watch);
  }

  return {
    read: (environmentId, { viewer }) => read(environmentId, viewer),
    refresh(environmentId) {
      if (watches.has(environmentId)) void check(environmentId, true);
      else forget(environmentId);
    },
    recheck(environmentId) {
      if (watches.has(environmentId)) void check(environmentId, false);
    },
    invalidate(environmentId) {
      const cached = lookups.get(environmentId);
      if (cached !== undefined) cached.fetchedAt = Number.NEGATIVE_INFINITY;
    },
    watch(environmentId, signal) {
      if (signal.aborted) return;
      const watch: Watch = {
        fingerprint: served.get(environmentId) ?? null,
        timer: null,
        checking: false,
        recheck: false,
      };
      watches.set(environmentId, watch);
      signal.addEventListener(
        "abort",
        () => {
          if (watch.timer !== null) clearTimeout(watch.timer);
          if (watches.get(environmentId) === watch)
            watches.delete(environmentId);
        },
        { once: true },
      );
      void check(environmentId, false);
    },
    isWatched(environmentId) {
      return watches.has(environmentId);
    },
  };
}
