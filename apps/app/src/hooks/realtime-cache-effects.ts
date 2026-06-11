import type { QueryClient } from "@tanstack/react-query";
import { assertNever } from "@bb/core-ui";
import {
  createDebouncedCallbackScheduler,
  type ChangedMessage,
  type EnvironmentChangeKind,
  type ThreadEventType,
  type ThreadChangeMetadata,
  type ThreadChangeKind,
  type WorkflowRunChangeKind,
} from "@bb/domain";
import {
  invalidateRealtimeQueriesAfterServerReconnect,
  refetchErroredRealtimeQueriesOnInitialConnect,
} from "./cache-owners/system-cache-effects";
import { createBufferedEnvironmentInvalidator } from "./buffered-environment-invalidator";
import {
  collectCachedThreadIdsForEnvironment,
  executeRealtimeDirtyHandlers,
  REALTIME_ENVIRONMENT_CHANGE_REGISTRY,
  REALTIME_HOST_CHANGE_REGISTRY,
  REALTIME_PROJECT_CHANGE_REGISTRY,
  REALTIME_SYSTEM_CHANGE_REGISTRY,
  REALTIME_THREAD_CHANGE_REGISTRY,
  REALTIME_WORKFLOW_RUN_CHANGE_REGISTRY,
  shouldFlushThreadChangesImmediately,
} from "./cache-owners/realtime-cache-registry";

export { shouldFlushThreadChangesImmediately } from "./cache-owners/realtime-cache-registry";

const INVALIDATION_DEBOUNCE_MS = 50;
const INVALIDATION_MAX_WAIT_MS = 200;
const ENVIRONMENT_INVALIDATION_DEBOUNCE_MS = 250;
const ENVIRONMENT_INVALIDATION_MAX_WAIT_MS = 500;

export interface RealtimeConnectedEvent {
  reconnected: boolean;
}

export interface RealtimeCacheEffects {
  dispose: () => void;
  handleChanged: (message: ChangedMessage) => void;
  handleConnected: (event: RealtimeConnectedEvent) => void;
}

export interface RealtimeCacheEffectsOptions {
  queryClient: QueryClient;
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
  const hasPendingInteraction =
    next.hasPendingInteraction ?? current?.hasPendingInteraction;
  const projectId = next.projectId ?? current?.projectId;
  const metadata: ThreadChangeMetadata = {};
  if (eventTypes) {
    metadata.eventTypes = eventTypes;
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
  for (const changeKind of state.globalChangeKinds) {
    executeRealtimeDirtyHandlers({
      context: {
        eventTypes: undefined,
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
          hasPendingInteraction: metadata?.hasPendingInteraction,
          eventTypes: metadata?.eventTypes,
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

interface WorkflowRunChangeState {
  changedRunKinds: Map<string, Set<WorkflowRunChangeKind>>;
  globalChangeKinds: Set<WorkflowRunChangeKind>;
}

function createWorkflowRunChangeState(): WorkflowRunChangeState {
  return {
    changedRunKinds: new Map<string, Set<WorkflowRunChangeKind>>(),
    globalChangeKinds: new Set<WorkflowRunChangeKind>(),
  };
}

function resetWorkflowRunChangeState(state: WorkflowRunChangeState): void {
  state.changedRunKinds.clear();
  state.globalChangeKinds.clear();
}

/**
 * Workflow-run change notifications fire per ingested daemon batch with no
 * server-side throttle, so a wide fan-out can deliver many messages per
 * second. Changes accumulate per run and flush on the shared debounce window.
 */
function recordWorkflowRunChange(
  state: WorkflowRunChangeState,
  message: ChangedMessage,
): void {
  if (message.entity !== "workflow-run") {
    return;
  }

  if (message.id) {
    let entry = state.changedRunKinds.get(message.id);
    if (!entry) {
      entry = new Set<WorkflowRunChangeKind>();
      state.changedRunKinds.set(message.id, entry);
    }
    for (const change of message.changes) {
      entry.add(change);
    }
    return;
  }

  for (const change of message.changes) {
    state.globalChangeKinds.add(change);
  }
}

function flushWorkflowRunInvalidations(
  queryClient: QueryClient,
  state: WorkflowRunChangeState,
): void {
  for (const changeKind of state.globalChangeKinds) {
    executeRealtimeDirtyHandlers({
      context: { queryClient, workflowRunId: undefined },
      handlers: REALTIME_WORKFLOW_RUN_CHANGE_REGISTRY[changeKind].dirty,
    });
  }

  for (const [workflowRunId, changeKinds] of state.changedRunKinds) {
    for (const changeKind of changeKinds) {
      executeRealtimeDirtyHandlers({
        context: { queryClient, workflowRunId },
        handlers: REALTIME_WORKFLOW_RUN_CHANGE_REGISTRY[changeKind].dirty,
      });
    }
  }

  resetWorkflowRunChangeState(state);
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

export function createRealtimeCacheEffects({
  queryClient,
}: RealtimeCacheEffectsOptions): RealtimeCacheEffects {
  const threadChangeState = createThreadChangeState();
  const invalidationScheduler = createDebouncedCallbackScheduler({
    debounceMs: INVALIDATION_DEBOUNCE_MS,
    maxWaitMs: INVALIDATION_MAX_WAIT_MS,
    onFlush: () => flushThreadInvalidations(queryClient, threadChangeState),
  });
  const workflowRunChangeState = createWorkflowRunChangeState();
  const workflowRunInvalidationScheduler = createDebouncedCallbackScheduler({
    debounceMs: INVALIDATION_DEBOUNCE_MS,
    maxWaitMs: INVALIDATION_MAX_WAIT_MS,
    onFlush: () =>
      flushWorkflowRunInvalidations(queryClient, workflowRunChangeState),
  });
  const environmentInvalidator = createBufferedEnvironmentInvalidator({
    debounceMs: ENVIRONMENT_INVALIDATION_DEBOUNCE_MS,
    flushChangedEnvironmentIds: (changedEnvironments) => {
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

  return {
    dispose: () => {
      invalidationScheduler.dispose();
      workflowRunInvalidationScheduler.dispose();
      environmentInvalidator.dispose();
      resetThreadChangeState(threadChangeState);
      resetWorkflowRunChangeState(workflowRunChangeState);
    },
    handleChanged: (message) => {
      switch (message.entity) {
        case "thread":
          recordThreadChange(threadChangeState, message);
          if (shouldFlushThreadChangesImmediately(message.changes)) {
            invalidationScheduler.flush();
          } else {
            invalidationScheduler.schedule();
          }
          break;
        case "environment":
          if (message.id) {
            environmentInvalidator.markChanged(message.id, message.changes);
          }
          break;
        case "host":
          for (const changeKind of message.changes) {
            executeRealtimeDirtyHandlers({
              context: { queryClient },
              handlers: REALTIME_HOST_CHANGE_REGISTRY[changeKind].dirty,
            });
          }
          break;
        case "project":
          for (const changeKind of message.changes) {
            executeRealtimeDirtyHandlers({
              context: {
                projectId: message.id,
                queryClient,
              },
              handlers: REALTIME_PROJECT_CHANGE_REGISTRY[changeKind].dirty,
            });
          }
          break;
        case "system":
          for (const changeKind of message.changes) {
            const rule = REALTIME_SYSTEM_CHANGE_REGISTRY[changeKind];
            if (!rule) {
              continue;
            }
            executeRealtimeDirtyHandlers({
              context: { queryClient },
              handlers: rule.dirty,
            });
          }
          break;
        case "workflow-run":
          recordWorkflowRunChange(workflowRunChangeState, message);
          workflowRunInvalidationScheduler.schedule();
          break;
        default:
          assertNever(message);
      }
    },
    handleConnected: ({ reconnected }) => {
      if (reconnected) {
        invalidateRealtimeQueriesAfterServerReconnect({ queryClient });
        return;
      }
      refetchErroredRealtimeQueriesOnInitialConnect({ queryClient });
    },
  };
}
