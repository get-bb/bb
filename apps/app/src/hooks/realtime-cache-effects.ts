import type { QueryClient } from "@tanstack/react-query";
import { assertNever } from "@bb/core-ui";
import {
  createDebouncedCallbackScheduler,
  type ChangedMessage,
  type EnvironmentChangeKind,
  type HostChangeKind,
  type ProjectChangeKind,
  type SystemChangeKind,
  type ThreadEventType,
  type ThreadChangeMetadata,
  type ThreadChangeKind,
} from "@bb/domain";
import {
  invalidateRealtimeQueriesAfterServerReconnect,
  invalidateRealtimeQueriesFetchedBeforeInitialConnect,
  refetchErroredRealtimeQueriesOnInitialConnect,
} from "./cache-owners/system-cache-effects";
import { createBufferedEnvironmentInvalidator } from "./buffered-environment-invalidator";
import {
  isDocumentVisible,
  subscribeToDocumentVisibility,
} from "@/lib/document-visibility";
import {
  collectCachedThreadIdsForEnvironment,
  createFlushOncePredicate,
  disposeTrailingActiveRefetches,
  executeRealtimeDirtyHandlers,
  REALTIME_ENVIRONMENT_CHANGE_REGISTRY,
  REALTIME_HOST_CHANGE_REGISTRY,
  REALTIME_PROJECT_CHANGE_REGISTRY,
  REALTIME_SYSTEM_CHANGE_REGISTRY,
  REALTIME_THREAD_CHANGE_REGISTRY,
  shouldFlushThreadChangesImmediately,
} from "./cache-owners/realtime-cache-registry";

const INVALIDATION_DEBOUNCE_MS = 50;
const INVALIDATION_MAX_WAIT_MS = 200;
const ENVIRONMENT_INVALIDATION_DEBOUNCE_MS = 250;
const ENVIRONMENT_INVALIDATION_MAX_WAIT_MS = 500;

export type RealtimeConnectedEvent =
  | { reconnected: false }
  | { reconnected: true; disconnectedAt: number };

export interface RealtimeCacheEffects {
  dispose: () => void;
  handleChanged: (message: ChangedMessage) => void;
  handleConnected: (event: RealtimeConnectedEvent) => void;
}

/**
 * Document visibility source. Defaults to the real document; tests inject a
 * fake so the hidden/visible gating can be driven without a DOM.
 */
export interface RealtimeCacheEffectsVisibility {
  isDocumentVisible: () => boolean;
  subscribe: (listener: () => void) => () => void;
}

export interface RealtimeCacheEffectsOptions {
  queryClient: QueryClient;
  visibility?: RealtimeCacheEffectsVisibility;
}

/**
 * Non-thread changes that arrived while the document was hidden. Thread
 * changes already merge into {@link ThreadChangeState}; environment changes
 * merge into the buffered invalidator. Host, project and system changes are
 * normally applied on arrival, so while hidden they are merged here (one entry
 * per entity/id, kinds deduplicated) and replayed once on the next visible.
 */
interface DeferredNonThreadChanges {
  environmentKindsById: Map<string, Set<EnvironmentChangeKind>>;
  hostKinds: Set<HostChangeKind>;
  projectKindsById: Map<string | undefined, Set<ProjectChangeKind>>;
  systemKinds: Set<SystemChangeKind>;
}

interface ThreadChangeState {
  changedThreadKinds: Map<string, Set<ThreadChangeKind>>;
  globalChangeKinds: Set<ThreadChangeKind>;
  metadataByThreadId: Map<string, ThreadChangeMetadata>;
}

interface MergeThreadChangesArg {
  changes: readonly ThreadChangeKind[];
  state: ThreadChangeState;
  threadId: string;
}

interface EnvironmentArg {
  environmentId: string;
  queryClient: QueryClient;
}

interface RealtimeEnvironmentChangedArg extends EnvironmentArg {
  changeKinds: readonly EnvironmentChangeKind[];
}

function mergeEventTypes(
  current: readonly ThreadEventType[] | undefined,
  next: readonly ThreadEventType[] | undefined,
): readonly ThreadEventType[] | undefined {
  if (!current) {
    return next;
  }
  if (!next) {
    return current;
  }
  return Array.from(new Set([...current, ...next]));
}

function mergeThreadChangeMetadata(
  current: ThreadChangeMetadata | undefined,
  next: ThreadChangeMetadata,
): ThreadChangeMetadata {
  const eventTypes = mergeEventTypes(current?.eventTypes, next.eventTypes);
  const backgroundActivityChanged =
    next.backgroundActivityChanged ?? current?.backgroundActivityChanged;
  const hasPendingInteraction =
    next.hasPendingInteraction ?? current?.hasPendingInteraction;
  const projectId = next.projectId ?? current?.projectId;
  const metadata: ThreadChangeMetadata = {};
  if (eventTypes) {
    metadata.eventTypes = eventTypes;
  }
  if (backgroundActivityChanged !== undefined) {
    metadata.backgroundActivityChanged = backgroundActivityChanged;
  }
  if (hasPendingInteraction !== undefined) {
    metadata.hasPendingInteraction = hasPendingInteraction;
  }
  if (projectId !== undefined) {
    metadata.projectId = projectId;
  }
  return metadata;
}

function createThreadChangeState(): ThreadChangeState {
  return {
    changedThreadKinds: new Map<string, Set<ThreadChangeKind>>(),
    globalChangeKinds: new Set<ThreadChangeKind>(),
    metadataByThreadId: new Map<string, ThreadChangeMetadata>(),
  };
}

function resetThreadChangeState(state: ThreadChangeState): void {
  state.changedThreadKinds.clear();
  state.globalChangeKinds.clear();
  state.metadataByThreadId.clear();
}

function mergeThreadChanges({
  changes,
  state,
  threadId,
}: MergeThreadChangesArg): void {
  let entry = state.changedThreadKinds.get(threadId);
  if (!entry) {
    entry = new Set<ThreadChangeKind>();
    state.changedThreadKinds.set(threadId, entry);
  }
  for (const change of changes) {
    entry.add(change);
  }
}

function flushThreadInvalidations(
  queryClient: QueryClient,
  state: ThreadChangeState,
): void {
  const flushOnce = createFlushOncePredicate();
  for (const changeKind of state.globalChangeKinds) {
    executeRealtimeDirtyHandlers({
      context: {
        backgroundActivityChanged: undefined,
        eventTypes: undefined,
        flushOnce,
        hasPendingInteraction: undefined,
        projectId: undefined,
        queryClient,
        threadId: undefined,
      },
      handlers: REALTIME_THREAD_CHANGE_REGISTRY[changeKind].dirty,
    });
  }

  for (const [threadId, changeKinds] of state.changedThreadKinds) {
    const metadata = state.metadataByThreadId.get(threadId);
    for (const changeKind of changeKinds) {
      executeRealtimeDirtyHandlers({
        context: {
          backgroundActivityChanged: metadata?.backgroundActivityChanged,
          eventTypes: metadata?.eventTypes,
          flushOnce,
          hasPendingInteraction: metadata?.hasPendingInteraction,
          projectId: metadata?.projectId,
          queryClient,
          threadId,
        },
        handlers: REALTIME_THREAD_CHANGE_REGISTRY[changeKind].dirty,
      });
    }
  }

  resetThreadChangeState(state);
}

function recordThreadChange(
  state: ThreadChangeState,
  message: ChangedMessage,
): void {
  if (message.entity !== "thread") {
    return;
  }

  if (message.id) {
    mergeThreadChanges({
      changes: message.changes,
      state,
      threadId: message.id,
    });
    if (message.metadata) {
      state.metadataByThreadId.set(
        message.id,
        mergeThreadChangeMetadata(
          state.metadataByThreadId.get(message.id),
          message.metadata,
        ),
      );
    }
    return;
  }

  for (const change of message.changes) {
    state.globalChangeKinds.add(change);
  }
}

function invalidateRealtimeEnvironmentChange({
  changeKinds,
  environmentId,
  queryClient,
}: RealtimeEnvironmentChangedArg): void {
  for (const changeKind of changeKinds) {
    executeRealtimeDirtyHandlers({
      context: {
        environmentId,
        getCachedThreadIdsForEnvironment: () =>
          collectCachedThreadIdsForEnvironment({ environmentId, queryClient }),
        queryClient,
      },
      handlers: REALTIME_ENVIRONMENT_CHANGE_REGISTRY[changeKind].dirty,
    });
  }
}

function createDeferredNonThreadChanges(): DeferredNonThreadChanges {
  return {
    environmentKindsById: new Map(),
    hostKinds: new Set(),
    projectKindsById: new Map(),
    systemKinds: new Set(),
  };
}

function addAll<T>(target: Set<T>, values: readonly T[]): void {
  for (const value of values) {
    target.add(value);
  }
}

function mergeInto<K, V>(
  target: Map<K, Set<V>>,
  key: K,
  values: readonly V[],
): void {
  let entry = target.get(key);
  if (!entry) {
    entry = new Set<V>();
    target.set(key, entry);
  }
  addAll(entry, values);
}

function hasDeferredNonThreadChanges(
  deferred: DeferredNonThreadChanges,
): boolean {
  return (
    deferred.environmentKindsById.size > 0 ||
    deferred.hostKinds.size > 0 ||
    deferred.projectKindsById.size > 0 ||
    deferred.systemKinds.size > 0
  );
}

const DEFAULT_VISIBILITY: RealtimeCacheEffectsVisibility = {
  isDocumentVisible,
  subscribe: subscribeToDocumentVisibility,
};

export function createRealtimeCacheEffects({
  queryClient,
  visibility = DEFAULT_VISIBILITY,
}: RealtimeCacheEffectsOptions): RealtimeCacheEffects {
  const threadChangeState = createThreadChangeState();
  // Hidden documents merge changes but never invalidate: `invalidateQueries`
  // refetches every active observer even when nothing can be seen, and iOS
  // suspends the tab anyway, so the fetches only queue up to fire (and be
  // partially aborted) on resume. Everything merged while hidden is applied
  // once, as one wave, on the next visible.
  let hasDeferredThreadChanges = false;
  const deferredNonThreadChanges = createDeferredNonThreadChanges();
  const invalidationScheduler = createDebouncedCallbackScheduler({
    debounceMs: INVALIDATION_DEBOUNCE_MS,
    maxWaitMs: INVALIDATION_MAX_WAIT_MS,
    onFlush: () => {
      if (!visibility.isDocumentVisible()) {
        // Keep the merged state; the visibility listener flushes it.
        hasDeferredThreadChanges = true;
        return;
      }
      hasDeferredThreadChanges = false;
      flushThreadInvalidations(queryClient, threadChangeState);
    },
  });
  const environmentInvalidator = createBufferedEnvironmentInvalidator({
    debounceMs: ENVIRONMENT_INVALIDATION_DEBOUNCE_MS,
    flushChangedEnvironmentIds: (changedEnvironments) => {
      if (!visibility.isDocumentVisible()) {
        // Marked while visible, debounce elapsed hidden: hold for the resume.
        for (const { changeKinds, environmentId } of changedEnvironments) {
          mergeInto(
            deferredNonThreadChanges.environmentKindsById,
            environmentId,
            changeKinds,
          );
        }
        return;
      }
      for (const { changeKinds, environmentId } of changedEnvironments) {
        invalidateRealtimeEnvironmentChange({
          changeKinds,
          environmentId,
          queryClient,
        });
      }
    },
    maxWaitMs: ENVIRONMENT_INVALIDATION_MAX_WAIT_MS,
  });

  const applyHostChanges = (changeKinds: Iterable<HostChangeKind>): void => {
    for (const changeKind of changeKinds) {
      executeRealtimeDirtyHandlers({
        context: { queryClient },
        handlers: REALTIME_HOST_CHANGE_REGISTRY[changeKind].dirty,
      });
    }
  };
  const applyProjectChanges = (
    projectId: string | undefined,
    changeKinds: Iterable<ProjectChangeKind>,
  ): void => {
    for (const changeKind of changeKinds) {
      executeRealtimeDirtyHandlers({
        context: { projectId, queryClient },
        handlers: REALTIME_PROJECT_CHANGE_REGISTRY[changeKind].dirty,
      });
    }
  };
  const applySystemChanges = (
    changeKinds: Iterable<SystemChangeKind>,
  ): void => {
    for (const changeKind of changeKinds) {
      const rule = REALTIME_SYSTEM_CHANGE_REGISTRY[changeKind];
      if (!rule) {
        continue;
      }
      executeRealtimeDirtyHandlers({
        context: { queryClient },
        handlers: rule.dirty,
      });
    }
  };

  const flushDeferredChanges = (): void => {
    if (hasDeferredNonThreadChanges(deferredNonThreadChanges)) {
      const { environmentKindsById, hostKinds, projectKindsById, systemKinds } =
        deferredNonThreadChanges;
      for (const [environmentId, changeKinds] of environmentKindsById) {
        environmentInvalidator.markChanged(
          environmentId,
          Array.from(changeKinds),
        );
      }
      applyHostChanges(hostKinds);
      for (const [projectId, changeKinds] of projectKindsById) {
        applyProjectChanges(projectId, changeKinds);
      }
      applySystemChanges(systemKinds);
      environmentKindsById.clear();
      hostKinds.clear();
      projectKindsById.clear();
      systemKinds.clear();
    }
    if (hasDeferredThreadChanges) {
      invalidationScheduler.flush();
    }
  };

  const unsubscribeVisibility = visibility.subscribe(() => {
    if (visibility.isDocumentVisible()) {
      flushDeferredChanges();
    }
  });

  return {
    dispose: () => {
      unsubscribeVisibility();
      invalidationScheduler.dispose();
      environmentInvalidator.dispose();
      disposeTrailingActiveRefetches(queryClient);
      resetThreadChangeState(threadChangeState);
    },
    handleChanged: (message) => {
      const documentVisible = visibility.isDocumentVisible();
      switch (message.entity) {
        case "thread":
          recordThreadChange(threadChangeState, message);
          if (!documentVisible) {
            hasDeferredThreadChanges = true;
          } else if (shouldFlushThreadChangesImmediately(message.changes)) {
            invalidationScheduler.flush();
          } else {
            invalidationScheduler.schedule();
          }
          break;
        case "environment":
          if (!message.id) {
            break;
          }
          if (!documentVisible) {
            mergeInto(
              deferredNonThreadChanges.environmentKindsById,
              message.id,
              message.changes,
            );
            break;
          }
          environmentInvalidator.markChanged(message.id, message.changes);
          break;
        case "host":
          if (!documentVisible) {
            addAll(deferredNonThreadChanges.hostKinds, message.changes);
            break;
          }
          applyHostChanges(message.changes);
          break;
        case "project":
          if (!documentVisible) {
            mergeInto(
              deferredNonThreadChanges.projectKindsById,
              message.id,
              message.changes,
            );
            break;
          }
          applyProjectChanges(message.id, message.changes);
          break;
        case "system":
          if (!documentVisible) {
            addAll(deferredNonThreadChanges.systemKinds, message.changes);
            break;
          }
          applySystemChanges(message.changes);
          break;
        default:
          assertNever(message);
      }
    },
    handleConnected: (event) => {
      if (event.reconnected) {
        invalidateRealtimeQueriesAfterServerReconnect({
          disconnectedAt: event.disconnectedAt,
          queryClient,
        });
        return;
      }
      refetchErroredRealtimeQueriesOnInitialConnect({ queryClient });
      // The ws manager flushes subscribe messages before this callback runs,
      // so "now" is the watermark after which change events are delivered.
      invalidateRealtimeQueriesFetchedBeforeInitialConnect({
        connectedAt: Date.now(),
        queryClient,
      });
    },
  };
}
