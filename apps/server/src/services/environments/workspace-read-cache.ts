import { createAsyncTtlMemo, type AsyncTtlMemo } from "@bb/async-cache";
import type { EnvironmentChangeKind } from "@bb/domain";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import type { ServerChangedMessage } from "../../ws/hub.js";

const IGNORED_ENVIRONMENT_CHANGES: ReadonlySet<EnvironmentChangeKind> = new Set(
  ["metadata-changed", "thread-storage-changed", "diff-viewed-changed"],
);

interface EnvironmentReadCacheReadArgs<TValue> {
  environmentId: string;
  hostId: string;
  key: string;
  load: () => Promise<TValue>;
}

interface EnvironmentReadCacheOptions {
  now: () => number;
  ttlMs: number;
}

interface EnvironmentReadCacheInvalidation {
  invalidateEnvironment(environmentId: string): void;
  invalidateHost(hostId: string): void;
}

export class EnvironmentReadCache<
  TValue,
> implements EnvironmentReadCacheInvalidation {
  private readonly cache: AsyncTtlMemo<string, TValue>;

  constructor(options: EnvironmentReadCacheOptions) {
    this.cache = createAsyncTtlMemo({ ...options, maxEntries: 1_024 });
  }

  read(args: EnvironmentReadCacheReadArgs<TValue>): Promise<TValue> {
    return this.cache.run(
      `${args.environmentId} ${args.hostId} ${args.key}`,
      args.load,
    );
  }

  invalidateEnvironment(environmentId: string): void {
    this.cache.invalidateWhere((key) => key.startsWith(`${environmentId} `));
  }

  invalidateHost(hostId: string): void {
    this.cache.invalidateWhere((key) => key.split(" ")[1] === hostId);
  }
}

const WORKSPACE_STATUS_CACHE_TTL_MS = 3_000;

interface WorkspaceReadCachesDeps {
  hub: {
    onChangedMessage(
      listener: (message: ServerChangedMessage) => void,
    ): () => void;
  };
  now?: () => number;
}

export class WorkspaceReadCaches {
  readonly diffFiles: EnvironmentReadCache<
    HostDaemonOnlineRpcResult<"workspace.diffFiles">
  >;
  readonly status: EnvironmentReadCache<
    HostDaemonOnlineRpcResult<"workspace.status">
  >;

  constructor(deps: WorkspaceReadCachesDeps) {
    const now = deps.now ?? Date.now;
    this.diffFiles = new EnvironmentReadCache({ now, ttlMs: 0 });
    this.status = new EnvironmentReadCache({
      now,
      ttlMs: WORKSPACE_STATUS_CACHE_TTL_MS,
    });
    deps.hub.onChangedMessage((message) => {
      this.handleChangedMessage(message);
    });
  }

  private get caches(): EnvironmentReadCacheInvalidation[] {
    return [this.status, this.diffFiles];
  }

  invalidateEnvironment(environmentId: string): void {
    for (const cache of this.caches) {
      cache.invalidateEnvironment(environmentId);
    }
  }

  invalidateHost(hostId: string): void {
    for (const cache of this.caches) {
      cache.invalidateHost(hostId);
    }
  }

  private handleChangedMessage(message: ServerChangedMessage): void {
    if (message.entity === "environment") {
      const relevantChanges = message.changes.filter(
        (change) => !IGNORED_ENVIRONMENT_CHANGES.has(change),
      );
      if (relevantChanges.length === 0) {
        return;
      }
      this.diffFiles.invalidateEnvironment(message.id);
      this.status.invalidateEnvironment(message.id);
      return;
    }
    if (
      message.entity === "host" &&
      message.changes.some(
        (change) =>
          change === "host-connected" || change === "host-disconnected",
      )
    ) {
      this.invalidateHost(message.id);
    }
  }
}
