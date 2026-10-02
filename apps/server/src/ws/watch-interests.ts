import { environments, threads, type DbConnection } from "@bb/db";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  realtimeSubscriptionTargetKey,
  type EnvironmentChangeKind,
  type RealtimeSubscriptionTarget,
  type ThreadChangeKind,
  type ThreadEventType,
} from "@bb/domain";
import type {
  HostDaemonWatchSet,
  HostDaemonWatchSetThreadStorageTarget,
  HostDaemonWatchSetWorkspaceTarget,
} from "@bb/host-daemon-contract";
import { workspaceContextFromPath } from "../services/environments/workspace-command-target.js";
import type { NotificationHub, ServerChangedMessage } from "./hub.js";

interface WatchInterestSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

interface WatchInterestCoordinatorDeps {
  db: DbConnection;
  hub: NotificationHub;
}

interface ResolvedWatchInterestTarget {
  hostId: string;
  threadStorageTarget?: HostDaemonWatchSetThreadStorageTarget;
  workspaceTarget?: HostDaemonWatchSetWorkspaceTarget;
}

const WATCH_TARGET_QUERY_BATCH_SIZE = 500;

const WATCH_TARGET_ENVIRONMENT_CHANGE_KINDS = new Set<EnvironmentChangeKind>([
  "environment-created",
  "environment-deleted",
  "metadata-changed",
  "status-changed",
]);
const WATCH_TARGET_THREAD_CHANGE_KINDS = new Set<ThreadChangeKind>([
  "archived-changed",
  "environment-changed",
  "status-changed",
  "thread-created",
  "thread-deleted",
]);
const THREAD_PROVISIONING_EVENT_TYPE =
  "system/thread-provisioning" satisfies ThreadEventType;

function emptyWatchSet(generation: number): HostDaemonWatchSet {
  return {
    generation,
    workspaceTargets: [],
    threadStorageTargets: [],
  };
}

function isWatchableSubscriptionTarget(
  target: RealtimeSubscriptionTarget,
): target is Extract<
  RealtimeSubscriptionTarget,
  { kind: "environment-detail" | "thread-detail" }
> {
  return (
    target.kind === "environment-detail" || target.kind === "thread-detail"
  );
}

export class WatchInterestCoordinator {
  private readonly interestsBySocket = new Map<
    WatchInterestSocket,
    Set<string>
  >();
  private readonly socketsByInterest = new Map<
    string,
    Set<WatchInterestSocket>
  >();
  private readonly targetsByInterest = new Map<
    string,
    RealtimeSubscriptionTarget
  >();
  private readonly generationByHost = new Map<string, number>();
  private readonly lastWatchTargetFingerprintByHost = new Map<string, string>();
  private readonly lastResolvedHostIdsByInterest = new Map<
    string,
    Set<string>
  >();

  constructor(private readonly deps: WatchInterestCoordinatorDeps) {
    this.deps.hub.onChangedMessage((message) => {
      this.refreshWatchSetsForChangedMessage(message);
    });
  }

  subscribe(
    socket: WatchInterestSocket,
    target: RealtimeSubscriptionTarget,
  ): void {
    if (!isWatchableSubscriptionTarget(target)) {
      return;
    }

    const key = realtimeSubscriptionTargetKey(target);
    const socketInterests =
      this.interestsBySocket.get(socket) ?? new Set<string>();
    const wasPresent = socketInterests.has(key);
    socketInterests.add(key);
    this.interestsBySocket.set(socket, socketInterests);

    const sockets =
      this.socketsByInterest.get(key) ?? new Set<WatchInterestSocket>();
    sockets.add(socket);
    this.socketsByInterest.set(key, sockets);
    this.targetsByInterest.set(key, target);

    if (wasPresent) {
      return;
    }
    this.sendSnapshotsForInterestKey(key);
  }

  unsubscribe(
    socket: WatchInterestSocket,
    target: RealtimeSubscriptionTarget,
  ): void {
    if (!isWatchableSubscriptionTarget(target)) {
      return;
    }

    const key = realtimeSubscriptionTargetKey(target);
    const socketInterests = this.interestsBySocket.get(socket);
    if (!socketInterests?.has(key)) {
      return;
    }

    socketInterests.delete(key);
    if (socketInterests.size === 0) {
      this.interestsBySocket.delete(socket);
    }

    const sockets = this.socketsByInterest.get(key);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.socketsByInterest.delete(key);
        this.targetsByInterest.delete(key);
      }
    }

    this.sendSnapshotsForInterestKey(key);
    if (!this.socketsByInterest.has(key)) {
      this.lastResolvedHostIdsByInterest.delete(key);
    }
  }

  releaseSocket(socket: WatchInterestSocket): void {
    const socketInterests = this.interestsBySocket.get(socket);
    if (!socketInterests) {
      return;
    }

    const affectedInterestKeys = [...socketInterests];
    this.interestsBySocket.delete(socket);
    for (const key of affectedInterestKeys) {
      const sockets = this.socketsByInterest.get(key);
      if (!sockets) {
        continue;
      }
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.socketsByInterest.delete(key);
        this.targetsByInterest.delete(key);
      }
    }

    const resolvedTargets = this.resolveTargets();
    const affectedHostIds = new Set<string>();
    for (const key of affectedInterestKeys) {
      for (const hostId of this.hostIdsForInterestKey(key, resolvedTargets)) {
        affectedHostIds.add(hostId);
      }
      if (!this.socketsByInterest.has(key)) {
        this.lastResolvedHostIdsByInterest.delete(key);
      }
    }
    this.sendSnapshotsForHosts(affectedHostIds, resolvedTargets);
  }

  reconcileWatchSetForHost(hostId: string): HostDaemonWatchSet {
    return this.resolveWatchSetForHost({
      generation: this.generationByHost.get(hostId) ?? 0,
      hostId,
      resolvedTargets: this.resolveTargets(),
    });
  }

  refreshWatchSetsForChangedMessage(message: ServerChangedMessage): void {
    const affectedInterestKeys = this.interestKeysForChangedMessage(message);
    if (affectedInterestKeys.size === 0) {
      return;
    }

    const resolvedTargets = this.resolveTargets();
    const affectedHostIds = new Set<string>();
    for (const key of affectedInterestKeys) {
      for (const hostId of this.hostIdsForInterestKey(key, resolvedTargets)) {
        affectedHostIds.add(hostId);
      }
    }
    this.sendSnapshotsForHosts(affectedHostIds, resolvedTargets);
  }

  private sendSnapshotsForInterestKey(key: string): void {
    const resolvedTargets = this.resolveTargets();
    this.sendSnapshotsForHosts(
      this.hostIdsForInterestKey(key, resolvedTargets),
      resolvedTargets,
    );
  }

  private sendSnapshotsForHosts(
    hostIds: ReadonlySet<string>,
    resolvedTargets: ReadonlyMap<string, ResolvedWatchInterestTarget>,
  ): void {
    for (const hostId of hostIds) {
      const generation = (this.generationByHost.get(hostId) ?? 0) + 1;
      const watchSet = this.resolveWatchSetForHost({
        generation,
        hostId,
        resolvedTargets,
      });
      const fingerprint = JSON.stringify({
        workspaceTargets: watchSet.workspaceTargets,
        threadStorageTargets: watchSet.threadStorageTargets,
      });
      if (this.lastWatchTargetFingerprintByHost.get(hostId) === fingerprint) {
        continue;
      }
      this.lastWatchTargetFingerprintByHost.set(hostId, fingerprint);
      this.generationByHost.set(hostId, generation);
      this.deps.hub.sendDaemonMessage(hostId, {
        type: "watch-set.replace",
        ...watchSet,
      });
    }
  }

  private hostIdsForInterestKey(
    key: string,
    resolvedTargets: ReadonlyMap<string, ResolvedWatchInterestTarget>,
  ): Set<string> {
    const hostIds = new Set(this.lastResolvedHostIdsByInterest.get(key) ?? []);
    const target = this.targetsByInterest.get(key);
    if (!target) {
      return hostIds;
    }
    const resolved = resolvedTargets.get(key);
    if (resolved) {
      hostIds.add(resolved.hostId);
      this.lastResolvedHostIdsByInterest.set(key, new Set([resolved.hostId]));
    } else {
      this.lastResolvedHostIdsByInterest.delete(key);
    }
    return hostIds;
  }

  private resolveWatchSetForHost(args: {
    generation: number;
    hostId: string;
    resolvedTargets: ReadonlyMap<string, ResolvedWatchInterestTarget>;
  }): HostDaemonWatchSet {
    if (this.targetsByInterest.size === 0) {
      return emptyWatchSet(args.generation);
    }

    const workspaceTargets = new Map<
      string,
      HostDaemonWatchSetWorkspaceTarget
    >();
    const threadStorageTargets = new Map<
      string,
      HostDaemonWatchSetThreadStorageTarget
    >();

    for (const key of this.targetsByInterest.keys()) {
      const resolved = args.resolvedTargets.get(key);
      if (!resolved) {
        this.lastResolvedHostIdsByInterest.delete(key);
        continue;
      }
      this.lastResolvedHostIdsByInterest.set(key, new Set([resolved.hostId]));
      if (resolved.hostId !== args.hostId) {
        continue;
      }
      if (resolved.workspaceTarget) {
        workspaceTargets.set(
          resolved.workspaceTarget.environmentId,
          resolved.workspaceTarget,
        );
      }
      if (resolved.threadStorageTarget) {
        threadStorageTargets.set(
          resolved.threadStorageTarget.threadId,
          resolved.threadStorageTarget,
        );
      }
    }

    return {
      generation: args.generation,
      workspaceTargets: [...workspaceTargets.values()],
      threadStorageTargets: [...threadStorageTargets.values()],
    };
  }

  private interestKeysForChangedMessage(
    message: ServerChangedMessage,
  ): Set<string> {
    const keys = new Set<string>();
    switch (message.entity) {
      case "environment":
        if (!this.environmentChangeCanAffectWatchTargets(message.changes)) {
          return keys;
        }
        this.addKnownInterestKey(
          keys,
          realtimeSubscriptionTargetKey({
            kind: "environment-detail",
            environmentId: message.id,
          }),
        );
        this.addInterestKeysWithPrefix(keys, "thread-detail:");
        return keys;
      case "thread":
        if (
          !this.threadChangeCanAffectWatchTargets(
            message.changes,
            message.metadata?.eventTypes,
          )
        ) {
          return keys;
        }
        this.addKnownInterestKey(
          keys,
          realtimeSubscriptionTargetKey({
            kind: "thread-detail",
            threadId: message.id,
          }),
        );
        return keys;
      case "project":
      case "host":
      case "system":
        return keys;
    }
  }

  private addKnownInterestKey(keys: Set<string>, key: string): void {
    if (this.targetsByInterest.has(key)) {
      keys.add(key);
    }
  }

  private addInterestKeysWithPrefix(keys: Set<string>, prefix: string): void {
    for (const key of this.targetsByInterest.keys()) {
      if (key.startsWith(prefix)) {
        keys.add(key);
      }
    }
  }

  private environmentChangeCanAffectWatchTargets(
    changes: readonly EnvironmentChangeKind[],
  ): boolean {
    return changes.some((change) =>
      WATCH_TARGET_ENVIRONMENT_CHANGE_KINDS.has(change),
    );
  }

  private threadChangeCanAffectWatchTargets(
    changes: readonly ThreadChangeKind[],
    eventTypes: readonly ThreadEventType[] | undefined,
  ): boolean {
    return (
      changes.some((change) => WATCH_TARGET_THREAD_CHANGE_KINDS.has(change)) ||
      (changes.includes("events-appended") &&
        eventTypes?.includes(THREAD_PROVISIONING_EVENT_TYPE) === true)
    );
  }

  private resolveTargets(): Map<string, ResolvedWatchInterestTarget> {
    const resolved = new Map<string, ResolvedWatchInterestTarget>();
    const environmentIds: string[] = [];
    const threadIds: string[] = [];
    for (const target of this.targetsByInterest.values()) {
      if (target.kind === "environment-detail")
        environmentIds.push(target.environmentId);
      if (target.kind === "thread-detail") threadIds.push(target.threadId);
    }
    for (
      let offset = 0;
      offset < environmentIds.length;
      offset += WATCH_TARGET_QUERY_BATCH_SIZE
    ) {
      const rows = this.deps.db
        .select({
          id: environments.id,
          hostId: environments.hostId,
          path: environments.path,
        })
        .from(environments)
        .where(
          and(
            inArray(
              environments.id,
              environmentIds.slice(
                offset,
                offset + WATCH_TARGET_QUERY_BATCH_SIZE,
              ),
            ),
            eq(environments.status, "ready"),
          ),
        )
        .all();
      for (const environment of rows) {
        if (!environment.path) continue;
        resolved.set(
          realtimeSubscriptionTargetKey({
            kind: "environment-detail",
            environmentId: environment.id,
          }),
          {
            hostId: environment.hostId,
            workspaceTarget: {
              environmentId: environment.id,
              workspaceContext: workspaceContextFromPath({
                path: environment.path,
              }),
            },
          },
        );
      }
    }
    for (
      let offset = 0;
      offset < threadIds.length;
      offset += WATCH_TARGET_QUERY_BATCH_SIZE
    ) {
      const rows = this.deps.db
        .select({
          id: threads.id,
          environmentId: environments.id,
          hostId: environments.hostId,
        })
        .from(threads)
        .innerJoin(environments, eq(threads.environmentId, environments.id))
        .where(
          and(
            inArray(
              threads.id,
              threadIds.slice(offset, offset + WATCH_TARGET_QUERY_BATCH_SIZE),
            ),
            isNull(threads.deletedAt),
            isNull(threads.archivedAt),
            ne(environments.status, "destroyed"),
          ),
        )
        .all();
      for (const thread of rows) {
        resolved.set(
          realtimeSubscriptionTargetKey({
            kind: "thread-detail",
            threadId: thread.id,
          }),
          {
            hostId: thread.hostId,
            threadStorageTarget: {
              environmentId: thread.environmentId,
              threadId: thread.id,
            },
          },
        );
      }
    }
    return resolved;
  }
}
