import {
  getEnvironment,
  getThread,
  requireThreadLifecycleEventApplied,
  type DispatchHoldRow,
} from "@bb/db";
import type { DbConnection, DbTransaction } from "@bb/db";
import type {
  ClientTurnRequestId,
  Environment,
  PromptInput,
  ResolvedThreadExecutionOptions,
  Thread,
  ThreadTurnInitiator,
  TurnRequestTarget,
} from "@bb/domain";
import type { SendMessageRequest } from "@bb/server-contract";
import { renderTemplate } from "@bb/templates";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../../types.js";
import { ApiError } from "../../errors.js";
import {
  addRequestIdToTurnSubmitCommandPayload,
  buildExecutionOptions,
  buildThreadStartCommand,
  prepareTurnSubmitCommandPayload,
} from "./thread-commands.js";
import {
  appendPreparedClientTurnRequestedEventWithNotificationInTransaction,
  type AppendedClientTurnRequestWithNotification,
  createClientTurnRequestId,
  getActiveTurnId,
  type TurnRequestRetryMarker,
} from "./thread-events.js";
import { recoverThreadModelOverride } from "./thread-execution-override.js";
import {
  ensureThreadCanStartRequest,
  prepareReadyThreadTurnCommand,
} from "./thread-lifecycle.js";
import { applyLoggedThreadLifecycleEventInTransaction } from "./lifecycle-outcome.js";
import {
  dispatchTurnDuringReprovision,
  requireReadyThreadEnvironment,
} from "./thread-turn-dispatch.js";
import { resolvePermissionEscalation } from "./thread-runtime-config.js";
import {
  buildThreadStatusChangeMetadata,
  resolveThreadRuntimeState,
} from "./thread-runtime-display.js";
import { recordAcceptedPromptHistoryEntry } from "../prompt-history.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";
import {
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  startLiveHostCommand,
} from "../hosts/live-command.js";
import {
  disconnectedHostUnavailableDetails,
  threadNotWritableReasonForStatus,
  throwHostUnavailable,
  throwSenderThreadInvalid,
  throwThreadNotWritable,
} from "../lib/lifecycle-api-errors.js";
import { validatePromptAttachmentReferences } from "../projects/attachments.js";
import { resolvePluginMentionContextInputs } from "../plugins/plugin-mentions.js";
import {
  prependDeferredFirstTurnContext,
  requireDeferredFirstTurnContextCurrent,
  resolveDeferredFirstTurnContext,
} from "./deferred-first-turn-context.js";
import { requirePublicProject } from "../lib/entity-lookup.js";
import { toThreadResponseFromThread } from "./thread-runtime-display.js";
import { createThreadDispatchHold } from "./dispatch-holds.js";
import {
  amendingPluginId,
  dispatchExecutionSources,
  dispatchGateHolder,
  dispatchHoldReasonForPass,
  hasDispatchAmendments,
  hasDispatchGates,
  runDispatchGatePass,
  type DispatchGatePassOutcome,
} from "./dispatch-gates.js";

type SendThreadMessageMode = SendMessageRequest["mode"];
type TextPromptInput = Extract<PromptInput, { type: "text" }>;
type SendThreadMessageTrigger = "auto-dispatch" | "user";

type SendThreadMessagePayload = SendMessageRequest & {
  inputGroups?: PromptInput[][];
};

/**
 * Set when this send is re-running the pipeline for a hold being released, so
 * the pass can tell a fresh dispatch from a re-decision and skip the gate a
 * user "Release now" overrode.
 */
export interface SendThreadMessageGateRelease {
  hold: DispatchHoldRow;
  skipPluginId: string | null;
}

interface SendThreadMessageArgs {
  beforeAppendInTransaction?: SendThreadMessageTransactionPreflight;
  /** Present only when a released hold is re-entering the send path. */
  gateRelease?: SendThreadMessageGateRelease;
  /**
   * Present only when a released retry hold is re-submitting a failed turn.
   * Marks the turn event as attempt N of an earlier request, which is what
   * makes the next failure's attempt number correct without a separate tally.
   */
  retryOf?: TurnRequestRetryMarker;
  environment: Environment;
  historyReplacement?: {
    forkSourceProviderThreadId: string | null;
    onCommandSettled?: () => void | Promise<void>;
  };
  payload: SendThreadMessagePayload;
  thread: Thread;
  trigger: SendThreadMessageTrigger;
}

interface ResolveMessageSenderArgs {
  senderThreadId?: string;
  targetThread: Thread;
}

interface FormatAgentThreadInputArgs {
  input: PromptInput[];
  senderThreadId: string;
}

interface BuildAgentThreadMessageTextArgs {
  messageText: string;
  senderThreadId: string;
}

interface SendThreadMessageTransactionPreflightArgs {
  tx: DbTransaction;
}

interface SendThreadMessageQueueRequestArgs {
  requestEventSequence: number;
  tx: DbTransaction;
}

interface SendThreadMessageQueueRequestResult {
  activeThread: Thread | null;
}

interface SendThreadMessageTransactionPreflight {
  (args: SendThreadMessageTransactionPreflightArgs): void;
}

interface SendThreadMessageQueueRequest {
  (
    args: SendThreadMessageQueueRequestArgs,
  ): SendThreadMessageQueueRequestResult;
}

interface AppendAndQueueSendThreadMessageArgs {
  /** Gate provenance; absent when no gate amended this turn. */
  amendment?: { pluginId: string; originalInput?: PromptInput[] };
  /** Retry provenance; absent for an original dispatch. */
  retryOf?: TurnRequestRetryMarker;
  beforeAppendInTransaction?: SendThreadMessageTransactionPreflight;
  db: DbConnection;
  environmentId: string | null;
  execution: ResolvedThreadExecutionOptions;
  initiator: ThreadTurnInitiator;
  input: PromptInput[];
  inputGroups?: PromptInput[][];
  queueInTransaction: SendThreadMessageQueueRequest;
  requestId: ClientTurnRequestId;
  senderThreadId: string | null;
  target: TurnRequestTarget;
  thread: Thread;
}

interface AppendAndQueueSendThreadMessageResult {
  activeThread: Thread | null;
  request: AppendedClientTurnRequestWithNotification;
}

export function ensureThreadIsNotAwaitingUserInteraction(
  deps: Pick<AppDeps, "pendingInteractions">,
  threadId: string,
): void {
  if (!deps.pendingInteractions.hasPendingThreadInteraction(threadId)) {
    return;
  }

  throw new ApiError(
    409,
    "awaiting_user_interaction",
    "Thread is awaiting user interaction. Resolve the pending interaction before sending another prompt.",
  );
}

export function ensureThreadIsWritable(thread: Thread): void {
  if (thread.archivedAt) {
    throwThreadNotWritable(thread, "archived", "Thread is archived");
  }
  if (thread.status === "stopping") {
    throwThreadNotWritable(thread, "stopping", "Thread is stopping");
  }
  if (thread.deletedAt !== null) {
    throwThreadNotWritable(thread, "deleted", "Thread is deleted");
  }
}

function resolveSendMode(
  thread: Thread,
  requestedMode: SendThreadMessageMode,
): "start" | "auto" | "steer" {
  if (requestedMode === "start") {
    if (thread.status === "active") {
      throwThreadNotWritable(
        thread,
        "already_active",
        "Thread is already active",
      );
    }
    return "start";
  }
  if (requestedMode === "steer" || requestedMode === "steer-if-active") {
    if (thread.status === "active") {
      return "steer";
    }
    if (
      thread.status === "idle" ||
      (requestedMode === "steer-if-active" && thread.status === "error")
    ) {
      return "start";
    }
    throwThreadNotWritable(
      thread,
      threadNotWritableReasonForStatus(thread.status),
      "Thread is not active",
    );
  }
  if (requestedMode === "queue-if-active") {
    if (thread.status === "active") {
      throwThreadNotWritable(
        thread,
        "already_active",
        "Thread is already active",
      );
    }
    return "start";
  }
  if (thread.status === "active") {
    return "auto";
  }
  return "start";
}

function ensureRuntimeCanAcceptActiveSend(
  deps: Pick<AppDeps, "db" | "hub">,
  args: Pick<SendThreadMessageArgs, "environment" | "thread">,
): void {
  if (args.thread.status !== "active") {
    return;
  }

  const runtime = resolveThreadRuntimeState(deps, {
    threadId: args.thread.id,
    environmentHostId: args.environment.hostId,
    status: args.thread.status,
  });
  if (runtime.displayStatus === "active") {
    return;
  }

  throwHostUnavailable(
    502,
    "Host daemon is not connected",
    disconnectedHostUnavailableDetails(),
  );
}

export function resolveMessageSenderThreadId(
  deps: Pick<AppDeps, "db">,
  args: ResolveMessageSenderArgs,
): string | null {
  if (!args.senderThreadId || args.senderThreadId === args.targetThread.id) {
    return null;
  }

  const senderThread = getThread(deps.db, args.senderThreadId);
  if (!senderThread) {
    throwSenderThreadInvalid("not_found");
  }
  if (senderThread.deletedAt !== null) {
    throwSenderThreadInvalid("deleted");
  }

  return senderThread.id;
}

function buildAgentThreadMessageText(
  args: BuildAgentThreadMessageTextArgs,
): string {
  return renderTemplate("agentThreadMessage", {
    messageText: args.messageText,
    senderThreadId: args.senderThreadId,
  });
}

export function formatAgentThreadInput(
  args: FormatAgentThreadInputArgs,
): PromptInput[] {
  const firstTextIndex = args.input.findIndex((item) => item.type === "text");
  if (firstTextIndex === -1) {
    const textItem: TextPromptInput = {
      type: "text",
      text: buildAgentThreadMessageText({
        messageText: "",
        senderThreadId: args.senderThreadId,
      }),
      mentions: [],
    };
    return [textItem, ...args.input];
  }

  return args.input.map((item, index) => {
    if (index !== firstTextIndex || item.type !== "text") {
      return item;
    }
    return {
      ...item,
      text: buildAgentThreadMessageText({
        messageText: item.text,
        senderThreadId: args.senderThreadId,
      }),
    };
  });
}

export function groupedInputForRuntime(
  inputGroups: readonly PromptInput[][],
): PromptInput[] {
  return inputGroups.flatMap((input, index) =>
    index === 0
      ? input
      : [{ type: "text" as const, text: "\n\n", mentions: [] }, ...input],
  );
}

function captureUserMessageSentTelemetry(
  deps: Pick<LoggedPendingInteractionWorkSessionDeps, "telemetry">,
  thread: Thread,
): void {
  deps.telemetry.capture({
    name: "user_message_sent",
    properties: {
      is_child_thread: thread.parentThreadId !== null,
      message_source: "thread_send",
      provider: thread.providerId,
    },
  });
}

function appendAndQueueSendThreadMessageInTransaction({
  amendment,
  retryOf,
  beforeAppendInTransaction,
  db,
  environmentId,
  execution,
  initiator,
  input,
  inputGroups,
  queueInTransaction,
  requestId,
  senderThreadId,
  target,
  thread,
}: AppendAndQueueSendThreadMessageArgs): AppendAndQueueSendThreadMessageResult {
  let activeThread: Thread | null = null;
  const request = db.transaction(
    (tx) => {
      beforeAppendInTransaction?.({ tx });
      const appended =
        appendPreparedClientTurnRequestedEventWithNotificationInTransaction(
          tx,
          {
            threadId: thread.id,
            environmentId,
            type: "client/turn/requested",
            ...(amendment !== undefined ? { amendment } : {}),
            ...(retryOf !== undefined ? { retryOf } : {}),
            input,
            ...(inputGroups !== undefined ? { inputGroups } : {}),
            execution,
            initiator,
            senderThreadId,
            requestMethod: "turn/start",
            source: "tell",
            target,
            requestId,
          },
        );
      recordAcceptedPromptHistoryEntry(
        { db: tx },
        {
          thread,
          input,
          initiator,
          target,
          requestSequence: appended.sequence,
        },
      );
      const queueResult = queueInTransaction({
        requestEventSequence: appended.sequence,
        tx,
      });
      activeThread = queueResult.activeThread;
      return appended;
    },
    { behavior: "immediate" },
  );
  return {
    activeThread,
    request,
  };
}

/**
 * Converts a gated dispatch into a hold instead of sending it.
 *
 * The execution tuple frozen here is the one the whole pass agreed on, which
 * is why holds are collected across a full pass rather than short-circuiting:
 * a limiter that parked the turn must not also freeze a stale model.
 *
 * `beforeCreateInTransaction` carries the drain's queued-message consumption
 * into the hold's own insert transaction, so a drain that hits a hold consumes
 * its message exactly once — the same "consume it as a successful send would"
 * contract the normal drain path has.
 */
function holdGatedThreadSend(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: {
    beforeCreateInTransaction?: SendThreadMessageTransactionPreflight;
    execution: ResolvedThreadExecutionOptions;
    input: PromptInput[];
    outcome: Extract<DispatchGatePassOutcome, { kind: "hold" }>;
    payload: SendThreadMessagePayload;
    thread: Thread;
  },
): void {
  createThreadDispatchHold(deps, {
    threadId: args.thread.id,
    environmentId: args.thread.environmentId,
    holder: dispatchGateHolder(args.outcome.holder.pluginId),
    payload: {
      kind: "inline",
      input: args.input,
      execution: args.execution,
      pluginInputs: args.payload.pluginInputs ?? {},
    },
    reason: dispatchHoldReasonForPass(args.outcome),
    resumeAt: args.outcome.holder.resumeAt,
    userReleasable: true,
    ...(hasDispatchAmendments(args.outcome.amendments)
      ? {
          effectiveRequest: {
            amendedBy: args.outcome.amendments.amendedBy,
            originalInput: args.outcome.amendments.originalInput,
          },
        }
      : {}),
    ...(args.beforeCreateInTransaction !== undefined
      ? { beforeCreateInTransaction: args.beforeCreateInTransaction }
      : {}),
  });
  deps.hub.notifyThread(args.thread.id, ["queue-changed"]);
}

export async function sendThreadMessage(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: SendThreadMessageArgs,
): Promise<void> {
  const { environment, payload, thread } = args;
  ensureThreadIsWritable(thread);
  if (args.trigger === "user") {
    ensureThreadIsNotAwaitingUserInteraction(deps, thread.id);
  }
  const mode = resolveSendMode(thread, payload.mode);
  ensureRuntimeCanAcceptActiveSend(deps, args);
  if (mode === "start") {
    ensureThreadCanStartRequest(thread);
  }
  const senderThreadId = resolveMessageSenderThreadId(deps, {
    senderThreadId: payload.senderThreadId,
    targetThread: thread,
  });
  let inputGroups = payload.inputGroups
    ? payload.inputGroups.map((inputGroup) =>
        senderThreadId
          ? formatAgentThreadInput({
              input: inputGroup,
              senderThreadId,
            })
          : inputGroup,
      )
    : undefined;
  let input =
    inputGroups !== undefined
      ? groupedInputForRuntime(inputGroups)
      : senderThreadId
        ? formatAgentThreadInput({
            input: payload.input,
            senderThreadId,
          })
        : payload.input;
  const pluginMentionContext = await resolvePluginMentionContextInputs(input);
  if (pluginMentionContext.length > 0) {
    input = [...input, ...pluginMentionContext];
    if (inputGroups !== undefined && inputGroups.length > 0) {
      const lastGroup = inputGroups[inputGroups.length - 1]!;
      inputGroups = [
        ...inputGroups.slice(0, -1),
        [...lastGroup, ...pluginMentionContext],
      ];
    }
  }
  const deferredFirstTurnContext = resolveDeferredFirstTurnContext(
    deps.db,
    thread.id,
  );
  ({ input, inputGroups } = prependDeferredFirstTurnContext(
    { input, ...(inputGroups !== undefined ? { inputGroups } : {}) },
    deferredFirstTurnContext,
  ));
  const beforeAppendInTransaction: SendThreadMessageTransactionPreflight = ({
    tx,
  }) => {
    args.beforeAppendInTransaction?.({ tx });
    if (deferredFirstTurnContext) {
      requireDeferredFirstTurnContextCurrent(tx, {
        requestSequence: deferredFirstTurnContext.requestSequence,
        threadId: thread.id,
      });
    }
  };
  await validatePromptAttachmentReferences({
    dataDir: deps.config.dataDir,
    input,
    projectId: thread.projectId,
  });
  // Agent-originated CLI sends still appear as normal turn requests in the
  // timeline, while initiator lets policy distinguish the source. A retry is
  // `system` whatever the original was: nobody asked for it a second time, and
  // counting it as a user message would inflate every "messages sent" figure by
  // however many times the provider happened to be rate limited.
  const initiator: ThreadTurnInitiator =
    args.retryOf !== undefined ? "system" : senderThreadId ? "agent" : "user";
  const shouldCaptureUserMessageSent =
    args.trigger === "user" && initiator === "user" && input.length > 0;
  const expectedSteerTurnId =
    mode === "auto" || mode === "steer"
      ? getActiveTurnId(deps, thread.id)
      : null;
  if (senderThreadId === null) {
    await recoverThreadModelOverride(deps, {
      model: payload.model,
      modelSource:
        payload.executionInputSources === undefined
          ? "explicit"
          : payload.executionInputSources.model,
      thread,
    });
  }
  let execution = await buildExecutionOptions(deps, payload, {
    threadId: thread.id,
  });
  // The `turn.submit` gate pass, at the dispatch choke point. Steers are
  // exempt: a steer joins the turn that is already running, so there is no
  // dispatch decision left to make and holding one would strand the user
  // mid-turn.
  let amendment: { pluginId: string; originalInput?: PromptInput[] } | undefined;
  if (mode !== "steer" && hasDispatchGates("turn.submit")) {
    const outcome = await runDispatchGatePass(deps, {
      stage: "turn.submit",
      thread,
      threadResponse: toThreadResponseFromThread(deps, { thread }),
      project: requirePublicProject(deps.db, thread.projectId),
      environmentId: thread.environmentId,
      input,
      requestedExecution: {
        providerId: thread.providerId,
        model: execution.model,
        reasoningLevel: execution.reasoningLevel,
        serviceTier: execution.serviceTier,
        permissionMode: execution.permissionMode,
      },
      executionSources: dispatchExecutionSources(
        payload.executionInputSources ?? {},
      ),
      origin: null,
      originPluginId: null,
      startedOnBehalfOf: null,
      parentThreadId: thread.parentThreadId,
      pluginInputs: payload.pluginInputs ?? {},
      release:
        args.gateRelease === undefined
          ? null
          : {
              hold: args.gateRelease.hold,
              skipPluginId: args.gateRelease.skipPluginId,
            },
    });
    if (outcome.kind === "hold") {
      holdGatedThreadSend(deps, {
        beforeCreateInTransaction: args.beforeAppendInTransaction,
        execution,
        input,
        outcome,
        payload,
        thread,
      });
      return;
    }
    if (hasDispatchAmendments(outcome.amendments)) {
      if (outcome.amendments.input !== null) {
        input = outcome.amendments.input;
        // The grouped view is a presentation of the same blocks; a wholesale
        // replacement has no groups to preserve.
        inputGroups = undefined;
      }
      execution = await buildExecutionOptions(
        deps,
        {
          ...payload,
          ...(outcome.amendments.model !== null
            ? { model: outcome.amendments.model }
            : {}),
          ...(outcome.amendments.reasoningLevel !== null
            ? { reasoningLevel: outcome.amendments.reasoningLevel }
            : {}),
          ...(outcome.amendments.serviceTier !== null
            ? { serviceTier: outcome.amendments.serviceTier }
            : {}),
          ...(outcome.amendments.permissionMode !== null
            ? { permissionMode: outcome.amendments.permissionMode }
            : {}),
        },
        { threadId: thread.id },
      );
      const pluginId = amendingPluginId(outcome.amendments);
      if (pluginId !== null) {
        amendment = {
          pluginId,
          ...(outcome.amendments.originalInput !== null
            ? { originalInput: outcome.amendments.originalInput }
            : {}),
        };
      }
    }
  }
  const permissionEscalation = resolvePermissionEscalation({
    initiator,
  });

  if (
    await dispatchTurnDuringReprovision({
      beforeRequestAppendInTransaction: beforeAppendInTransaction,
      deps,
      environment,
      execution,
      initiator,
      input,
      inputGroups,
      senderThreadId,
      thread,
    })
  ) {
    if (shouldCaptureUserMessageSent) {
      captureUserMessageSentTelemetry(deps, thread);
    }
    return;
  }
  const readyEnvironment = requireReadyThreadEnvironment(
    getEnvironment(deps.db, environment.id) ?? environment,
  );
  let target: TurnRequestTarget;
  if (mode === "start") {
    target = {
      kind:
        args.historyReplacement !== undefined &&
        args.historyReplacement.forkSourceProviderThreadId === null
          ? "thread-start"
          : "new-turn",
    };
  } else {
    target = {
      kind: mode,
      expectedTurnId: expectedSteerTurnId,
    };
  }

  const requestId = createClientTurnRequestId();

  if (mode === "start") {
    const commandArgs = {
      thread,
      fork: null,
      input,
      ...(inputGroups !== undefined ? { inputGroups } : {}),
      requestId,
      execution,
      permissionEscalation,
      environment: {
        id: readyEnvironment.id,
        hostId: readyEnvironment.hostId,
        path: readyEnvironment.path,
        status: readyEnvironment.status,
        workspaceProvisionType: readyEnvironment.workspaceProvisionType,
      },
      projectId: thread.projectId,
      providerId: thread.providerId,
      syncGeneratedTitle: false,
    };
    const command = args.historyReplacement
      ? {
          command: await buildThreadStartCommand(deps, {
            ...commandArgs,
            fork:
              args.historyReplacement.forkSourceProviderThreadId === null
                ? null
                : {
                    sourceProviderThreadId:
                      args.historyReplacement.forkSourceProviderThreadId,
                  },
          }),
          mode: "thread.start" as const,
        }
      : await prepareReadyThreadTurnCommand(deps, commandArgs);
    const queuedRequest = appendAndQueueSendThreadMessageInTransaction({
      ...(amendment !== undefined ? { amendment } : {}),
      ...(args.retryOf !== undefined ? { retryOf: args.retryOf } : {}),
      beforeAppendInTransaction: ({ tx }) => {
        beforeAppendInTransaction({ tx });
        ensureThreadCanStartRequest(thread);
      },
      db: deps.db,
      environmentId: thread.environmentId,
      execution,
      initiator,
      input,
      inputGroups,
      queueInTransaction: ({ tx }) => {
        const dispatchKind = command.mode;
        const currentThread = getThread(tx, thread.id);
        if (
          dispatchKind === "turn.submit" ||
          currentThread?.status === "error" ||
          currentThread?.status === "idle"
        ) {
          return {
            activeThread: requireThreadLifecycleEventApplied(
              applyLoggedThreadLifecycleEventInTransaction(
                { db: tx, logger: deps.logger },
                { event: { type: "run.started" }, threadId: thread.id },
              ),
            ),
          };
        }
        return { activeThread: null };
      },
      requestId,
      senderThreadId,
      target,
      thread,
    });
    deps.hub.notifyThread(
      thread.id,
      queuedRequest.request.notificationChanges,
      queuedRequest.request.notificationMetadata,
    );
    startLiveHostCommand(deps, {
      command: command.command,
      hostId: readyEnvironment.hostId,
      timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
      ...(args.historyReplacement?.onCommandSettled !== undefined
        ? { onSettled: args.historyReplacement.onCommandSettled }
        : {}),
      onError: ({ error }) => {
        deps.logger.warn(
          { err: error, threadId: thread.id },
          "Live ready turn command failed",
        );
      },
    });
    if (queuedRequest.activeThread) {
      deps.hub.notifyThread(
        thread.id,
        ["status-changed"],
        buildThreadStatusChangeMetadata(deps, queuedRequest.activeThread),
      );
    }
    if (shouldCaptureUserMessageSent) {
      captureUserMessageSentTelemetry(deps, thread);
    }
    return;
  }

  await ensureHostSessionReadyForWork(deps, {
    hostId: readyEnvironment.hostId,
  });
  const preparedCommand = await prepareTurnSubmitCommandPayload(deps, {
    thread,
    input,
    ...(inputGroups !== undefined ? { inputGroups } : {}),
    execution,
    permissionEscalation,
    target: {
      mode,
      expectedTurnId: expectedSteerTurnId,
    },
    environment: {
      id: readyEnvironment.id,
      hostId: readyEnvironment.hostId,
      path: readyEnvironment.path,
      status: readyEnvironment.status,
      workspaceProvisionType: readyEnvironment.workspaceProvisionType,
    },
  });
  const command = addRequestIdToTurnSubmitCommandPayload({
    preparedCommand,
    requestId,
  });
  const queuedRequest = appendAndQueueSendThreadMessageInTransaction({
    ...(amendment !== undefined ? { amendment } : {}),
    ...(args.retryOf !== undefined ? { retryOf: args.retryOf } : {}),
    beforeAppendInTransaction,
    db: deps.db,
    environmentId: thread.environmentId,
    execution,
    initiator,
    input,
    inputGroups,
    queueInTransaction: () => {
      return { activeThread: null };
    },
    requestId,
    senderThreadId,
    target,
    thread,
  });
  deps.hub.notifyThread(
    thread.id,
    queuedRequest.request.notificationChanges,
    queuedRequest.request.notificationMetadata,
  );
  startLiveHostCommand(deps, {
    command,
    hostId: readyEnvironment.hostId,
    timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
    onError: ({ error }) => {
      deps.logger.warn(
        { err: error, threadId: thread.id },
        "Live turn submit command failed",
      );
    },
  });
  if (shouldCaptureUserMessageSent) {
    captureUserMessageSentTelemetry(deps, thread);
  }
}
