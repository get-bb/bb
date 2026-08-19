import type { ChangedMessage, EnvironmentChangeKind } from "@bb/domain";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";

/**
 * Per-environment in-flight dedupe plus a short TTL cache for read-only
 * workspace probes (`workspace.status`, `workspace.pull_request`).
 *
 * Every probe spawns git/gh subprocesses on the host. Several clients (a
 * thread view, sidebar rows, a phone that just came back to the foreground)
 * ask for the same environment within the same second, so identical reads
 * that overlap share one daemon RPC and repeated reads inside the TTL are
 * served from memory.
 *
 * Freshness is driven by two sources. Server-side workspace mutations
 * (the environment action route, host file writes) call
 * `invalidateEnvironment` / `invalidateHost` before they respond, because
 * the client refetches on mutation success and the daemon's watcher event
 * for that write arrives asynchronously, often after the response. The
 * environment change events the web client already refetches on
 * (`work-status-changed`, `git-refs-changed`, ...) cover writes the server
 * does not perform itself (agent edits, the user's shell). Either source
 * drops the cached value AND detaches any in-flight probe for that
 * environment, because a probe that started before the change may have
 * observed the pre-change tree. Later readers then start a fresh probe. The
 * TTL only bounds staleness for the case where nobody is subscribed to the
 * environment, so no daemon events arrive.
 */

/**
 * Environment change kinds that leave workspace reads untouched.
 *
 * `metadata-changed` is record-only (name, recorded branch, ...). The status
 * probe itself records the observed branch, so treating it as a tree change
 * would detach every probe that follows a branch switch. A workspace move
 * changes the read key (the workspace context is part of it), so it never
 * reads a probe of the previous checkout.
 */
const IGNORED_ENVIRONMENT_CHANGES: ReadonlySet<EnvironmentChangeKind> = new Set(
  ["metadata-changed", "thread-storage-changed"],
);

interface CacheEntry<TValue> {
  expiresAt: number;
  hostId: string;
  value: TValue;
}

interface InFlightEntry<TValue> {
  hostId: string;
  promise: Promise<TValue>;
}

export interface EnvironmentReadCacheReadArgs<TValue> {
  environmentId: string;
  hostId: string;
  /** Distinguishes reads of the same environment with different inputs. */
  key: string;
  load: () => Promise<TValue>;
}

interface EnvironmentReadCacheOptions {
  now: () => number;
  ttlMs: number;
}

interface EnvironmentReadCacheInvalidation {
  invalidateAll(): void;
  invalidateEnvironment(environmentId: string): void;
  invalidateHost(hostId: string): void;
}

export class EnvironmentReadCache<
  TValue,
> implements EnvironmentReadCacheInvalidation {
  private readonly entries = new Map<string, CacheEntry<TValue>>();
  private readonly inFlight = new Map<string, InFlightEntry<TValue>>();

  constructor(private readonly options: EnvironmentReadCacheOptions) {}

  read(args: EnvironmentReadCacheReadArgs<TValue>): Promise<TValue> {
    const cacheKey = `${args.environmentId} ${args.key}`;
    const cached = this.entries.get(cacheKey);
    if (cached && cached.expiresAt > this.options.now()) {
      return Promise.resolve(cached.value);
    }
    if (cached) {
      this.entries.delete(cacheKey);
    }

    const pending = this.inFlight.get(cacheKey);
    if (pending) {
      return pending.promise;
    }

    const promise = args.load().then(
      (value) => {
        // Only publish the value when this probe is still the current one.
        // An invalidation that arrived mid-flight detached it, and the value
        // may describe the pre-change tree.
        if (this.inFlight.get(cacheKey)?.promise === promise) {
          this.inFlight.delete(cacheKey);
          this.entries.set(cacheKey, {
            expiresAt: this.options.now() + this.options.ttlMs,
            hostId: args.hostId,
            value,
          });
        }
        return value;
      },
      (error: unknown) => {
        if (this.inFlight.get(cacheKey)?.promise === promise) {
          this.inFlight.delete(cacheKey);
        }
        throw error;
      },
    );
    this.inFlight.set(cacheKey, { hostId: args.hostId, promise });
    return promise;
  }

  invalidateEnvironment(environmentId: string): void {
    const prefix = `${environmentId} `;
    this.dropWhere((cacheKey) => cacheKey.startsWith(prefix));
  }

  invalidateHost(hostId: string): void {
    this.dropWhere((_cacheKey, entryHostId) => entryHostId === hostId);
  }

  invalidateAll(): void {
    this.entries.clear();
    this.inFlight.clear();
  }

  private dropWhere(
    predicate: (cacheKey: string, hostId: string) => boolean,
  ): void {
    for (const [cacheKey, entry] of this.entries) {
      if (predicate(cacheKey, entry.hostId)) {
        this.entries.delete(cacheKey);
      }
    }
    for (const [cacheKey, entry] of this.inFlight) {
      if (predicate(cacheKey, entry.hostId)) {
        this.inFlight.delete(cacheKey);
      }
    }
  }
}

/**
 * How long a `workspace.status` result may be reused without a daemon
 * event. Long enough to fold the burst of reads a thread open or a phone
 * foreground produces; short enough that an unsubscribed environment (no
 * events) never shows a stale tree for long.
 */
export const WORKSPACE_STATUS_CACHE_TTL_MS = 3_000;
/**
 * How long a `workspace.pull_request` result may be reused without a daemon
 * event. Remote check runs change without any local event, so this bounds
 * how stale a check status can be between polls.
 */
export const WORKSPACE_PULL_REQUEST_CACHE_TTL_MS = 10_000;

interface WorkspaceReadCachesDeps {
  hub: {
    onChangedMessage(listener: (message: ChangedMessage) => void): () => void;
  };
  now?: () => number;
  pullRequestTtlMs?: number;
  statusTtlMs?: number;
}

export class WorkspaceReadCaches {
  readonly status: EnvironmentReadCache<
    HostDaemonOnlineRpcResult<"workspace.status">
  >;
  readonly pullRequest: EnvironmentReadCache<
    HostDaemonOnlineRpcResult<"workspace.pull_request">
  >;

  constructor(deps: WorkspaceReadCachesDeps) {
    const now = deps.now ?? Date.now;
    this.status = new EnvironmentReadCache({
      now,
      ttlMs: deps.statusTtlMs ?? WORKSPACE_STATUS_CACHE_TTL_MS,
    });
    this.pullRequest = new EnvironmentReadCache({
      now,
      ttlMs: deps.pullRequestTtlMs ?? WORKSPACE_PULL_REQUEST_CACHE_TTL_MS,
    });
    deps.hub.onChangedMessage((message) => {
      this.handleChangedMessage(message);
    });
  }

  private get caches(): EnvironmentReadCacheInvalidation[] {
    return [this.status, this.pullRequest];
  }

  /**
   * Drop every cached and in-flight read of one environment. Call this after
   * any server-side workspace mutation for the environment (commit, squash
   * merge, pull request action, ...) whether it succeeded or failed midway:
   * the tree may have changed and the daemon's watcher event, if any, only
   * arrives later. Over-invalidating costs one extra probe.
   */
  invalidateEnvironment(environmentId: string): void {
    for (const cache of this.caches) {
      cache.invalidateEnvironment(environmentId);
    }
  }

  /** Drop every cached and in-flight read of every environment on a host. */
  invalidateHost(hostId: string): void {
    for (const cache of this.caches) {
      cache.invalidateHost(hostId);
    }
  }

  private invalidateAll(): void {
    for (const cache of this.caches) {
      cache.invalidateAll();
    }
  }

  private handleChangedMessage(message: ChangedMessage): void {
    if (message.entity === "environment") {
      const relevant = message.changes.some(
        (change) => !IGNORED_ENVIRONMENT_CHANGES.has(change),
      );
      if (!relevant) {
        return;
      }
      if (message.id === undefined) {
        this.invalidateAll();
      } else {
        this.invalidateEnvironment(message.id);
      }
      return;
    }
    if (message.entity === "host") {
      // A daemon that reconnects may be looking at a different tree than
      // the one it reported before it dropped; the client refetches on
      // host changes too, so serve those refetches a fresh probe.
      if (message.id === undefined) {
        this.invalidateAll();
      } else {
        this.invalidateHost(message.id);
      }
    }
  }
}
