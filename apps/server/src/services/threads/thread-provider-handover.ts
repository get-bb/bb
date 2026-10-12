import {
  getThread,
  getLatestThreadSequence,
  getStoredProviderSession,
  getStoredProviderHandoverEvent,
  listQueuedThreadMessageCountsByThreadIds,
  noopNotifier,
  updateThread,
  setThreadExecutionOverride,
} from "@bb/db";
import {
  THREAD_PROVIDER_HANDOVER_OPERATION,
  threadScope,
  type Thread,
} from "@bb/domain";
import type {
  ExperimentalThreadProviderHandoverRequest,
  ExperimentalThreadProviderHandoverState,
  ExperimentalThreadProviderHandoverResponse,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import { withThreadContextClearGuard } from "./thread-context-mutation-guard.js";
import {
  appendThreadEventsInTransaction,
  getActiveTurnId,
  getLastExecutionOptions,
} from "./thread-events.js";
import { parseStoredEventPayload } from "./thread-data.js";
import { requireThreadCommandEnvironment } from "./thread-command-environment.js";
import {
  prepareTurnSubmitCommandPayload,
  buildExecutionOptions,
} from "./thread-commands.js";
import { resolveSystemExecutionOptionsForValidation } from "../system/execution-options.js";
import { clampPermissionModeToHost } from "../hosts/permission-ceiling.js";
import {
  runLiveHostCommand,
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
} from "../hosts/live-command.js";

function requireThread(deps: Pick<AppDeps, "db">, threadId: string): Thread {
  const thread = getThread(deps.db, threadId);
  if (!thread || thread.deletedAt !== null)
    throw new ApiError(404, "invalid_request", "Thread not found");
  return thread;
}

export function providerHandoverState(
  deps: AppDeps,
  threadId: string,
): ExperimentalThreadProviderHandoverState {
  const thread = requireThread(deps, threadId),
    session = getStoredProviderSession(deps.db, threadId);
  let blockedReason: string | null = null;
  if (thread.archivedAt !== null)
    blockedReason = "Unarchive this conversation before switching providers.";
  else if (thread.status !== "idle" || getActiveTurnId(deps, threadId) !== null)
    blockedReason =
      "Wait for the current response to finish before switching providers.";
  else if (
    deps.pendingInteractions.hasTurnBoundPendingThreadInteraction(threadId)
  )
    blockedReason =
      "Resolve the open questions or approvals before switching providers.";
  else if (
    (listQueuedThreadMessageCountsByThreadIds(deps.db, {
      threadIds: [threadId],
    })[0]?.queuedMessageCount ?? 0) > 0
  )
    blockedReason = "Resolve queued messages before switching providers.";
  else if (session.kind !== "owned" && session.kind !== "none")
    blockedReason = "The current provider session ownership is not confirmed.";
  return {
    version: 1,
    threadId,
    providerId: thread.providerId,
    providerThreadId:
      session.kind === "owned" ? session.providerThreadId : null,
    latestSeq: getLatestThreadSequence(deps.db, { threadId }),
    blockedReason,
  };
}

function assertSource(
  deps: AppDeps,
  threadId: string,
  args: ExperimentalThreadProviderHandoverRequest,
): Thread {
  const state = providerHandoverState(deps, threadId);
  if (state.blockedReason)
    throw new ApiError(409, "provider_handover_blocked", state.blockedReason);
  if (
    state.providerId !== args.expectedProviderId ||
    state.providerThreadId !== args.expectedProviderThreadId ||
    state.latestSeq !== args.expectedLatestSeq
  )
    throw new ApiError(
      409,
      "provider_handover_changed",
      "The conversation changed. Review the current history before switching providers.",
    );
  return requireThread(deps, threadId);
}

async function loadProviderRuntime(
  deps: AppDeps,
  threadId: string,
): Promise<string> {
  const thread = requireThread(deps, threadId);
  if (thread.archivedAt !== null)
    throw new ApiError(409, "invalid_request", "Thread is archived");
  const session = getStoredProviderSession(deps.db, threadId);
  if (session.kind !== "owned" || !getLastExecutionOptions(deps, threadId))
    throw new ApiError(
      409,
      "provider_session_unavailable",
      "No saved provider session and execution settings are available to resume.",
    );
  const environment = await requireThreadCommandEnvironment(deps, { thread });
  const execution = await buildExecutionOptions(
    deps,
    {},
    { threadId, hostId: environment.hostId },
  );
  const payload = await prepareTurnSubmitCommandPayload(deps, {
    thread,
    environment,
    execution,
    permissionEscalation: "deny",
    input: [],
    target: { mode: "start" },
    providerThreadId: session.providerThreadId,
  });
  const result = await runLiveHostCommand(deps, {
    hostId: environment.hostId,
    timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
    command: {
      type: "thread.resume",
      environmentId: environment.id,
      threadId,
      options: payload.options,
      bridgeLaunch: payload.bridgeLaunch,
      resumeContext: payload.resumeContext,
    },
  });
  if (result.providerThreadId !== session.providerThreadId)
    throw new ApiError(
      409,
      "provider_session_changed",
      "The provider resumed a different conversation.",
    );
  return result.providerThreadId;
}

export async function resumeProviderRuntime(
  deps: AppDeps,
  threadId: string,
): Promise<{ ok: true; providerThreadId: string }> {
  return withThreadContextClearGuard(threadId, async () => ({
    ok: true,
    providerThreadId: await loadProviderRuntime(deps, threadId),
  }));
}

export async function handoffThreadProvider(
  deps: AppDeps,
  threadId: string,
  args: ExperimentalThreadProviderHandoverRequest,
): Promise<ExperimentalThreadProviderHandoverResponse> {
  return withThreadContextClearGuard(threadId, async () => {
    const prior = getStoredProviderHandoverEvent(
      deps.db,
      threadId,
      args.operationId,
    );
    let reused = false;
    if (prior) {
      const request = parseStoredEventPayload(prior).metadata;
      if (JSON.stringify(request) !== JSON.stringify(args))
        throw new ApiError(
          409,
          "provider_handover_conflict",
          "This handover identifier belongs to a different request.",
        );
      const current = requireThread(deps, threadId),
        session = getStoredProviderSession(deps.db, threadId);
      if (
        current.providerId !== args.providerId ||
        session.kind !== "owned" ||
        session.providerThreadId !== args.providerThreadId
      )
        throw new ApiError(
          409,
          "provider_handover_changed",
          "The conversation has changed since this handover.",
        );
      reused = true;
    } else {
      const source = assertSource(deps, threadId, args);
      if (source.providerId === args.providerId)
        throw new ApiError(
          400,
          "invalid_request",
          "Choose a different provider for handover.",
        );
      const environment = await requireThreadCommandEnvironment(deps, {
        thread: source,
      });
      const catalog = await resolveSystemExecutionOptionsForValidation(
        deps,
        { providerId: args.providerId, environmentId: environment.id },
        args.model,
      );
      const model = [...catalog.models, ...catalog.selectedOnlyModels].find(
        (row) => row.model === args.model,
      );
      if (catalog.modelLoadError || !model)
        throw new ApiError(
          503,
          "model_catalog_unavailable",
          "The target provider model could not be confirmed.",
        );
      if (
        !model.supportedReasoningEfforts.some(
          (row) => row.reasoningEffort === args.reasoningLevel,
        )
      )
        throw new ApiError(
          400,
          "invalid_request",
          "The target model does not support this reasoning level.",
        );
      const permissionMode = clampPermissionModeToHost(deps, {
        hostId: environment.hostId,
        providerId: args.providerId,
        permissionMode: args.permissionMode,
      });
      if (permissionMode !== args.permissionMode)
        throw new ApiError(
          400,
          "host_permission_ceiling_conflict",
          "The requested handover permissions exceed this machine's limit.",
        );
      assertSource(deps, threadId, args);
      const released = await runLiveHostCommand(deps, {
        hostId: environment.hostId,
        timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
        command: {
          type: "thread.stop",
          threadId,
          environmentId: environment.id,
          intent: "release",
        },
      });
      if (released.activeTurnRetained)
        throw new ApiError(
          409,
          "provider_handover_blocked",
          "The local provider is still running. Wait for it to finish before switching.",
        );
      assertSource(deps, threadId, args);
      deps.db.transaction(
        (tx) => {
          updateThread(tx, noopNotifier, threadId, {
            providerId: args.providerId,
          });
          setThreadExecutionOverride(tx, {
            threadId,
            modelOverride: args.model,
            reasoningLevelOverride: args.reasoningLevel,
          });
          appendThreadEventsInTransaction(tx, [
            {
              threadId,
              environmentId: environment.id,
              type: "system/operation",
              scope: threadScope(),
              data: {
                operation: THREAD_PROVIDER_HANDOVER_OPERATION,
                operationId: args.operationId,
                status: "completed",
                message:
                  "Connected to the selected agent session. Earlier history stays here; new messages use that session.",
                metadata: { ...args },
              },
            },
            {
              threadId,
              environmentId: environment.id,
              providerThreadId: args.providerThreadId,
              type: "thread/identity",
              scope: threadScope(),
              data: { providerThreadId: args.providerThreadId },
            },
          ]);
          const session = getStoredProviderSession(tx, threadId);
          if (
            session.kind !== "owned" ||
            session.providerThreadId !== args.providerThreadId
          )
            throw new ApiError(
              409,
              "provider_session_unavailable",
              "The target provider session is already owned by another thread.",
            );
        },
        { behavior: "immediate" },
      );
      deps.hub.notifyThread(threadId, ["status-changed", "events-appended"], {
        projectId: source.projectId,
      });
    }
    let resumeError: string | null = null;
    try {
      await loadProviderRuntime(deps, threadId);
    } catch (error) {
      resumeError =
        error instanceof Error
          ? error.message
          : "The provider runtime could not be loaded. Retry resume without sending a message.";
    }
    return {
      threadId,
      providerId: args.providerId,
      providerThreadId: args.providerThreadId,
      operationId: args.operationId,
      reused,
      runtimeLoaded: resumeError === null,
      resumeError,
    };
  });
}
