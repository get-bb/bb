import { providerRawEventSchema, threadUsageCostSchema } from "@bb/domain";
import type { ProviderRawEvent, ThreadUsageCost } from "@bb/domain";
import {
  COMPACTION_PRESENTATION,
  errorEnvelopeSchema,
  jsonRpcEnvelopeSchema,
  planStepsPresentation,
  presentationTitle,
} from "@bb/provider-bridge-protocol/bridge-kit";
import type {
  JsonRpcMessage,
  ProviderRuntimeEvent,
} from "@bb/provider-bridge-protocol/bridge-kit";
import type {
  ThreadEventItemStatus,
  ThreadEventPlanStep,
  ThreadEventTurnStatus,
} from "@bb/domain";
import type {
  DeltaItemKey,
  DeltaItemShape,
  DeltaNoTurnFallback,
  ThreadDelta,
} from "@bb/provider-bridge-protocol";
import {
  ACP_COMPACTION_COMPLETED_METHOD,
  ACP_COMPACTION_STARTED_METHOD,
  ACP_FS_WRITE_METHOD,
  ACP_TURN_COMPLETED_METHOD,
  ACP_PROMPT_INTERRUPTED_METHOD,
  ACP_TURN_STARTED_METHOD,
  ACP_UPDATE_METHOD,
  ACP_WARNING_METHOD,
  acpCompactionCompletedNotificationParamsSchema,
  acpFsWriteNotificationParamsSchema,
  acpTurnCompletedNotificationParamsSchema,
  acpTurnStartedNotificationParamsSchema,
  acpUpdateNotificationParamsSchema,
  acpWarningNotificationParamsSchema,
} from "./bridge-protocol.js";
import {
  GENERIC_ACP_DIALECT,
  type AcpDelegationReport,
  type AcpDialect,
} from "./dialect.js";
import {
  delegationPresentation,
  fileChangePresentation,
} from "./presentation.js";
import {
  classifyAcpToolCall,
  extractAcpCommandResult,
  extractAcpStreamedCommandOutput,
  extractAcpToolCallOutputText,
  isInjectedToolCandidate,
  type AcpClassifiedToolCall,
  type AcpInjectedTool,
} from "./tool-classification.js";
import { resolveAcpToolCallPath } from "./tool-call-operation.js";
import { isJsonObject } from "./session/decode.js";
import { acpVisibilityMetadata } from "./visibility.js";
import {
  acpAgentMessageChunkUpdateSchema,
  acpAgentThoughtChunkUpdateSchema,
  acpCompactionUpdateSchema,
  acpPlanUpdateSchema,
  acpSubagentSpawnedUpdateSchema,
  acpSubagentStateUpdateSchema,
  acpToolCallUpdateEventSchema,
  acpUsageUpdateSchema,
  extractAcpContentText,
  type AcpSessionUpdate,
  type AcpStopReason,
  type AcpToolCallContent,
  type AcpToolCallUpdateEvent,
} from "./wire.js";

interface AcpDeltaTranslationContext {
  threadId?: string;
}

export interface AcpDeltaTranslatorOptions {
  cwd?: string | undefined;
  dialect?: AcpDialect | undefined;
  fileCreatedThisTurn?: ((path: string) => boolean | undefined) | undefined;
}

export interface AcpPermissionToolCallInput {
  toolCallId: string;
  title?: string | undefined;
  kind?: AcpToolCallUpdateEvent["kind"];
  rawKind?: string | undefined;
  content?: AcpToolCallUpdateEvent["content"];
  locations?: AcpToolCallUpdateEvent["locations"];
  rawInput?: unknown;
  rawOutput?: unknown;
}

export interface AcpBoundPermissionToolCall {
  toolCallId: string;
  event: AcpToolCallUpdateEvent | undefined;
}

export const SYSTEM_INSTRUCTIONS_OPEN_TAG = "<system_instructions>";
const ASSISTANT_STREAM_KEY = "assistant";
const THOUGHT_STREAM_KEY = "thought";
const ACP_PLAN_STEP_STATUS_BY_ENTRY_STATUS = {
  pending: "pending",
  in_progress: "active",
  completed: "completed",
} as const;

const PLAN_STEPS_CHANNEL = "planSteps";

function isTerminalAcpStatus(
  status: AcpToolCallUpdateEvent["status"],
): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

function mapAcpToolCallStatus(
  status: AcpToolCallUpdateEvent["status"],
): ThreadEventItemStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "interrupted";
    default:
      return "pending";
  }
}

function mergeAcpToolCallEvents(
  started: AcpToolCallUpdateEvent | undefined,
  update: AcpToolCallUpdateEvent,
): AcpToolCallUpdateEvent {
  if (!started) {
    return update;
  }
  const { rawKind: startedRawKind, ...startedRest } = started;
  const kindFields =
    update.kind !== undefined
      ? {
          kind: update.kind,
          ...(update.rawKind !== undefined ? { rawKind: update.rawKind } : {}),
        }
      : startedRawKind !== undefined
        ? { rawKind: startedRawKind }
        : {};
  return {
    ...startedRest,
    ...kindFields,
    ...(update.title !== undefined ? { title: update.title } : {}),
    ...(update.name !== undefined ? { name: update.name } : {}),
    ...(update.status !== undefined ? { status: update.status } : {}),
    ...(update.content !== undefined ? { content: update.content } : {}),
    ...(update.locations !== undefined ? { locations: update.locations } : {}),
    ...(update.rawInput !== undefined ? { rawInput: update.rawInput } : {}),
    ...(update.rawOutput !== undefined ? { rawOutput: update.rawOutput } : {}),
  };
}

function withParentRef(
  key: DeltaItemKey,
  parentRef: string | undefined,
): DeltaItemKey {
  return parentRef === undefined ? key : { ...key, parentRef };
}

interface AcpSubagentCursorMeta {
  toolCallId?: string;
  agentId?: string;
  model?: string;
}

function readSubagentCursorMeta(meta: unknown): AcpSubagentCursorMeta {
  if (!isJsonObject(meta)) {
    return {};
  }
  const cursor = meta["cursor"];
  if (!isJsonObject(cursor)) {
    return {};
  }
  const toolCallId =
    typeof cursor["toolCallId"] === "string" && cursor["toolCallId"].length > 0
      ? cursor["toolCallId"]
      : undefined;
  const agentId =
    typeof cursor["agentId"] === "string" && cursor["agentId"].length > 0
      ? cursor["agentId"]
      : undefined;
  const model =
    typeof cursor["model"] === "string" && cursor["model"].length > 0
      ? cursor["model"]
      : undefined;
  return {
    ...(toolCallId === undefined ? {} : { toolCallId }),
    ...(agentId === undefined ? {} : { agentId }),
    ...(model === undefined ? {} : { model }),
  };
}

function firstNonEmptyLine(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  for (const line of value.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}

function cleanTaskToolTitle(title: string | undefined): string | undefined {
  if (title === undefined) {
    return undefined;
  }
  const stripped = title
    .trim()
    .replace(/^Task:\s*/iu, "")
    .trim();
  if (
    stripped.length === 0 ||
    stripped.toLowerCase() === "task" ||
    stripped.toLowerCase() === "subagent task"
  ) {
    return undefined;
  }
  return stripped;
}

function buildSubagentDetail(
  name: string | undefined,
  model: string | undefined,
): string | undefined {
  const parts: string[] = [];
  if (name !== undefined && name.trim().length > 0) {
    parts.push(name.trim());
  }
  if (model !== undefined && model.trim().length > 0) {
    parts.push(`model ${model.trim()}`);
  }
  return parts.length === 0 ? undefined : parts.join(" · ");
}

function mapSubagentTerminalState(
  state: string,
): ThreadEventItemStatus | undefined {
  switch (state) {
    case "completed":
      return "completed";
    case "cancelled":
      return "interrupted";
    case "failed":
    case "disconnected":
      return "failed";
    default:
      return undefined;
  }
}

function isBackgroundTaskToolResult(event: AcpToolCallUpdateEvent): boolean {
  if (isJsonObject(event.rawOutput)) {
    if (event.rawOutput["isBackground"] === true) {
      return true;
    }
    if (event.rawOutput["isBackground"] === false) {
      return false;
    }
  }
  if (isJsonObject(event.rawInput)) {
    return (
      event.rawInput["run_in_background"] === true ||
      event.rawInput["runInBackground"] === true
    );
  }
  return false;
}

interface AcpOpenToolCall {
  event: AcpToolCallUpdateEvent;
  clientFileWrites?: Extract<AcpToolCallContent, { type: "diff" }>[];
  openedType: DeltaItemShape["type"];
  permissionTitle?: string;
  delegation?: AcpDelegationReport;
  parentRef?: string;
}

interface AcpTrackedSubagent {
  threadId: string;
  subagentSessionId: string;
  callId: string;
  parentRef?: string;
  childRef: string;
  label: string;
  name?: string;
  model?: string;
  detail?: string;
  terminal: boolean;
  closed: boolean;
  deferredToolClose?: {
    event: AcpToolCallUpdateEvent;
    status: ThreadEventItemStatus;
    permissionTitle?: string;
    delegation?: AcpDelegationReport;
  };
}

export function createAcpDeltaTranslator(
  options: AcpDeltaTranslatorOptions = {},
) {
  const dialect = options.dialect ?? GENERIC_ACP_DIALECT;
  const pathOptions = { cwd: options.cwd };
  const mergedToolCalls = new Map<string, AcpOpenToolCall>();
  const subagentsBySession = new Map<string, AcpTrackedSubagent>();
  const subagentsByCall = new Map<string, AcpTrackedSubagent>();
  const fileExistence = new Map<string, Map<string, boolean | undefined>>();
  const filesAddedThisTurn = new Set<string>();

  function noteEditedPaths(key: string, event: AcpToolCallUpdateEvent): void {
    const fileCreatedThisTurn = options.fileCreatedThisTurn;
    if (fileCreatedThisTurn === undefined || event.kind !== "edit") {
      return;
    }
    const seen =
      fileExistence.get(key) ?? new Map<string, boolean | undefined>();
    for (const location of event.locations ?? []) {
      const resolved = resolveAcpToolCallPath(location.path, pathOptions);
      if (seen.has(resolved)) {
        continue;
      }
      const created = fileCreatedThisTurn(resolved);
      if (created === undefined) {
        seen.set(resolved, undefined);
        continue;
      }
      const added = created && !filesAddedThisTurn.has(resolved);
      if (added) {
        filesAddedThisTurn.add(resolved);
      }
      seen.set(resolved, !added);
    }
    if (seen.size > 0) {
      fileExistence.set(key, seen);
    }
  }

  let lastUsageCost: ThreadUsageCost | undefined;
  let lastAgentTitle: string | undefined;

  const openAgentCompactions = new Set<string>();
  const finishedAgentCompactions = new Set<string>();

  let injectedToolsByName = new Map<string, AcpInjectedTool>();
  const injectedToolBindings = new Map<string, AcpInjectedTool>();
  const pendingInjectedCalls = new Map<string, AcpInjectedTool[]>();

  function callKey(
    context: AcpDeltaTranslationContext | undefined,
    toolCallId: string,
  ): string {
    return `${context?.threadId ?? ""} ${toolCallId}`;
  }

  function threadCallEntries(
    context: AcpDeltaTranslationContext | undefined,
  ): [string, AcpOpenToolCall][] {
    const prefix = `${context?.threadId ?? ""} `;
    return [...mergedToolCalls.entries()].filter(([key]) =>
      key.startsWith(prefix),
    );
  }

  function withDialectIdentity(
    event: AcpToolCallUpdateEvent,
  ): AcpToolCallUpdateEvent {
    if (dialect.toolIdentity === undefined) {
      return event;
    }
    const identity = dialect.toolIdentity(event);
    if (identity === undefined) {
      return event;
    }
    return {
      ...event,
      ...(event.kind === undefined && identity.kind !== undefined
        ? { kind: identity.kind }
        : {}),
      ...(event.name === undefined && identity.name !== undefined
        ? { name: identity.name }
        : {}),
    };
  }

  function sessionKey(
    context: AcpDeltaTranslationContext | undefined,
    sessionId: string,
  ): string {
    return `${context?.threadId ?? ""} ${sessionId}`;
  }

  function threadSubagentEntries(
    context: AcpDeltaTranslationContext | undefined,
  ): [string, AcpTrackedSubagent][] {
    const prefix = `${context?.threadId ?? ""} `;
    return [...subagentsBySession.entries()].filter(([key]) =>
      key.startsWith(prefix),
    );
  }

  function clearThreadCalls(
    context: AcpDeltaTranslationContext | undefined,
  ): void {
    for (const [key] of threadCallEntries(context)) {
      mergedToolCalls.delete(key);
      injectedToolBindings.delete(key);
    }
    for (const [key, tracked] of threadSubagentEntries(context)) {
      subagentsBySession.delete(key);
      subagentsByCall.delete(callKey(context, tracked.callId));
    }
    pendingInjectedCalls.delete(context?.threadId ?? "");
  }

  function configureInjectedTools(tools: readonly AcpInjectedTool[]): void {
    injectedToolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  }

  function injectedToolNamedBy(
    event: AcpToolCallUpdateEvent,
  ): AcpInjectedTool | undefined {
    const title = event.title;
    if (title === undefined || injectedToolsByName.size === 0) {
      return undefined;
    }
    for (const tool of injectedToolsByName.values()) {
      if (title.includes(tool.name)) {
        return tool;
      }
    }
    return undefined;
  }

  function bindAnnouncedCall(
    context: AcpDeltaTranslationContext | undefined,
    event: AcpToolCallUpdateEvent,
  ): AcpInjectedTool | undefined {
    if (!isInjectedToolCandidate(event)) {
      return undefined;
    }
    const named = injectedToolNamedBy(event);
    if (named !== undefined) {
      return named;
    }
    return pendingInjectedCalls.get(context?.threadId ?? "")?.shift();
  }

  function noteInjectedToolCall(threadId: string, toolName: string): void {
    const tool = injectedToolsByName.get(toolName) ?? { name: toolName };
    const candidates = threadCallEntries({ threadId }).filter(
      ([key, open]) =>
        !injectedToolBindings.has(key) && isInjectedToolCandidate(open.event),
    );
    const chosen =
      candidates.find(([, open]) => open.event.title?.includes(tool.name)) ??
      candidates.find(([, open]) => /\bmcp\b/i.test(open.event.title ?? "")) ??
      candidates[0];
    if (chosen !== undefined) {
      injectedToolBindings.set(chosen[0], tool);
      return;
    }
    const queue = pendingInjectedCalls.get(threadId) ?? [];
    queue.push(tool);
    pendingInjectedCalls.set(threadId, queue);
  }

  function classifyCall(
    context: AcpDeltaTranslationContext | undefined,
    event: AcpToolCallUpdateEvent,
  ): AcpClassifiedToolCall {
    const injected = injectedToolBindings.get(
      callKey(context, event.toolCallId),
    );
    if (injected === undefined) {
      const dialectShape = dialect.classifyToolCall?.(event);
      if (dialectShape !== undefined) {
        return dialectShape;
      }
    }
    return classifyAcpToolCall(event, injected, {
      ...pathOptions,
      existedBefore: fileExistence.get(callKey(context, event.toolCallId)),
    });
  }

  interface AcpFsWriteSnapshot {
    path: string;
    oldText?: string;
    content: string;
  }

  function withClientFileWrites(
    event: AcpToolCallUpdateEvent,
    writes: readonly Extract<AcpToolCallContent, { type: "diff" }>[],
  ): AcpToolCallUpdateEvent {
    if (writes.length === 0) {
      return event;
    }
    const paths = new Set(
      writes.map((write) => resolveAcpToolCallPath(write.path, pathOptions)),
    );
    return {
      ...event,
      content: [
        ...(event.content ?? []).filter(
          (entry) =>
            entry.type !== "diff" ||
            !paths.has(resolveAcpToolCallPath(entry.path, pathOptions)),
        ),
        ...writes,
      ],
    };
  }

  function mergeFsWriteIntoOpenToolCall(
    context: AcpDeltaTranslationContext | undefined,
    write: AcpFsWriteSnapshot,
  ): boolean {
    const writePath = resolveAcpToolCallPath(write.path, pathOptions);
    const fileChangeCalls = threadCallEntries(context).flatMap(
      ([key, open]) => {
        if (open.openedType !== "fileChange") {
          return [];
        }
        const classified = classifyCall(context, open.event);
        return classified.item.type === "fileChange"
          ? [
              {
                key,
                open,
                paths: classified.item.changes.map((change) => change.path),
              },
            ]
          : [];
      },
    );
    const exactMatches = fileChangeCalls.filter(({ paths }) =>
      paths.includes(writePath),
    );
    const pathPendingMatches = fileChangeCalls.filter(
      ({ paths }) => paths.length === 0,
    );
    const matching =
      exactMatches.length === 1
        ? exactMatches[0]
        : exactMatches.length === 0 && pathPendingMatches.length === 1
          ? pathPendingMatches[0]
          : undefined;
    if (matching === undefined) {
      return false;
    }

    const previous = matching.open.clientFileWrites?.find(
      (entry) => resolveAcpToolCallPath(entry.path, pathOptions) === writePath,
    );
    const oldText = previous === undefined ? write.oldText : previous.oldText;
    const diff: Extract<AcpToolCallContent, { type: "diff" }> = {
      type: "diff",
      path: write.path,
      ...(oldText === undefined ? {} : { oldText }),
      newText: write.content,
    };
    const clientFileWrites = [
      ...(matching.open.clientFileWrites ?? []).filter(
        (entry) =>
          resolveAcpToolCallPath(entry.path, pathOptions) !== writePath,
      ),
      diff,
    ];
    mergedToolCalls.set(matching.key, {
      ...matching.open,
      clientFileWrites,
      event: withClientFileWrites(matching.open.event, clientFileWrites),
    });
    return true;
  }

  function toRawEvent(rawEvent: JsonRpcMessage): ProviderRawEvent {
    const parsed = providerRawEventSchema.safeParse(rawEvent);
    if (parsed.success) {
      return parsed.data;
    }
    return {
      jsonrpc: "2.0",
      ...(rawEvent.id !== undefined ? { id: rawEvent.id } : {}),
      method: rawEvent.method,
      params: {
        serializationError:
          "Provider raw event params were not JSON-serializable.",
      },
    };
  }

  function noTurnFallbackFor(rawEvent: JsonRpcMessage): DeltaNoTurnFallback {
    return {
      raw: toRawEvent(rawEvent),
      rawType: acpVisibilityMetadata.describeRawEvent(rawEvent).kind,
    };
  }

  function updateEnvelope(
    context: AcpDeltaTranslationContext | undefined,
    update: AcpSessionUpdate,
  ): JsonRpcMessage {
    return {
      jsonrpc: "2.0",
      method: ACP_UPDATE_METHOD,
      params: {
        ...(context?.threadId ? { threadId: context.threadId } : {}),
        update,
      },
    };
  }

  function suppressedUnhandled(rawEvent: JsonRpcMessage): ThreadDelta[] {
    const fallback = noTurnFallbackFor(rawEvent);
    return [
      {
        kind: "unhandled",
        raw: fallback.raw,
        rawType: fallback.rawType,
        vouchedTurn: false,
        onlyIfNoTurn: true,
      },
    ];
  }

  function unhandledDeltas(rawEvent: JsonRpcMessage): ThreadDelta[] {
    const description = acpVisibilityMetadata.describeRawEvent(rawEvent);
    if (description.coverage !== "unknown") {
      return [];
    }
    return [
      {
        kind: "unhandled",
        raw: toRawEvent(rawEvent),
        rawType: description.kind,
        vouchedTurn: true,
      },
    ];
  }

  function closeThoughtStream(parentRef?: string): ThreadDelta {
    return {
      kind: "item.textClose",
      key: withParentRef({ channel: THOUGHT_STREAM_KEY }, parentRef),
      channel: "reasoningText",
    };
  }

  function closeAssistantStream(parentRef?: string): ThreadDelta {
    return {
      kind: "item.textClose",
      key: withParentRef({ channel: ASSISTANT_STREAM_KEY }, parentRef),
      channel: "agentMessage",
    };
  }

  interface AcpCloseArgs {
    context: AcpDeltaTranslationContext | undefined;
    event: AcpToolCallUpdateEvent;
    status: ThreadEventItemStatus;
    permissionTitle?: string | undefined;
    delegation?: AcpDelegationReport | undefined;
    parentRef?: string | undefined;
    noTurnFallback?: DeltaNoTurnFallback;
  }

  function withDelegationReport(
    classified: AcpClassifiedToolCall,
    report: AcpDelegationReport | undefined,
  ): AcpClassifiedToolCall {
    if (report === undefined || classified.item.type !== "delegation") {
      return classified;
    }
    return {
      item: {
        ...classified.item,
        childRef: report.childRef,
        label: report.label,
      },
      presentation: delegationPresentation({
        label: report.label,
        ...(report.detail === undefined ? {} : { detail: report.detail }),
      }),
    };
  }

  function withPermissionTitle(
    classified: AcpClassifiedToolCall,
    permissionTitle: string | undefined,
  ): AcpClassifiedToolCall {
    const title =
      permissionTitle === undefined
        ? undefined
        : presentationTitle(permissionTitle);
    return title === undefined || classified.presentation === undefined
      ? classified
      : {
          item: classified.item,
          presentation: { ...classified.presentation, title },
        };
  }

  function toolCallClose(args: AcpCloseArgs): ThreadDelta {
    const classified = withPermissionTitle(
      withDelegationReport(
        classifyCall(args.context, args.event),
        args.delegation,
      ),
      args.permissionTitle,
    );
    injectedToolBindings.delete(callKey(args.context, args.event.toolCallId));
    fileExistence.delete(callKey(args.context, args.event.toolCallId));
    const closeFields =
      classified.item.type === "command"
        ? commandCloseFields(args.event, args.status)
        : genericCloseFields(args.event);
    return {
      kind: "item.close",
      key: withParentRef(
        {
          providerItemId: args.event.toolCallId,
        },
        args.parentRef,
      ),
      status: args.status,
      ...closeFields,
      item: classified.item,
      presentation: classified.presentation,
      ...(args.noTurnFallback ? { noTurnFallback: args.noTurnFallback } : {}),
    };
  }

  function commandCloseFields(
    event: AcpToolCallUpdateEvent,
    status: ThreadEventItemStatus,
  ): Pick<
    Extract<ThreadDelta, { kind: "item.close" }>,
    "aggregatedOutput" | "exitCode" | "resultText"
  > {
    const normalizedEvent =
      dialect.normalizeCommandEvent?.(event, event) ?? event;
    const result =
      dialect.commandResult?.(normalizedEvent) ??
      extractAcpCommandResult(normalizedEvent);
    const exitCode = result.exitCode ?? (status === "failed" ? 1 : undefined);
    return {
      ...(result.output === undefined
        ? {}
        : { aggregatedOutput: result.output, resultText: result.output }),
      ...(exitCode === undefined ? {} : { exitCode }),
    };
  }

  function genericCloseFields(
    event: AcpToolCallUpdateEvent,
  ): Pick<Extract<ThreadDelta, { kind: "item.close" }>, "resultText"> {
    const normalizedEvent =
      dialect.normalizeToolCallEvent?.(event, event) ?? event;
    const outputText = extractAcpToolCallOutputText(normalizedEvent);
    return outputText === undefined ? {} : { resultText: outputText };
  }

  function delegationReportForSubagent(
    tracked: AcpTrackedSubagent,
  ): AcpDelegationReport {
    return {
      toolCallId: tracked.callId,
      childRef: tracked.childRef,
      label: tracked.label,
      ...(tracked.detail === undefined ? {} : { detail: tracked.detail }),
    };
  }

  function closeTrackedSubagentDelegation(
    context: AcpDeltaTranslationContext | undefined,
    tracked: AcpTrackedSubagent,
    status: ThreadEventItemStatus,
    noTurnFallback?: DeltaNoTurnFallback,
  ): ThreadDelta[] {
    if (tracked.closed) {
      return [];
    }
    tracked.closed = true;
    const key = callKey(context, tracked.callId);
    const open = mergedToolCalls.get(key);
    if (open !== undefined) {
      mergedToolCalls.delete(key);
    }
    const deferred = tracked.deferredToolClose;
    tracked.deferredToolClose = undefined;
    const report = delegationReportForSubagent(tracked);
    const event = deferred?.event ?? open?.event;
    if (event !== undefined) {
      return [
        toolCallClose({
          context,
          event,
          status,
          permissionTitle: deferred?.permissionTitle ?? open?.permissionTitle,
          delegation: report,
          parentRef: open?.parentRef ?? tracked.parentRef,
          ...(noTurnFallback === undefined ? {} : { noTurnFallback }),
        }),
      ];
    }
    return [
      {
        kind: "item.close",
        key: withParentRef(
          { providerItemId: tracked.callId },
          tracked.parentRef,
        ),
        status,
        item: {
          type: "delegation",
          childRef: tracked.childRef,
          label: tracked.label,
          background: false,
        },
        presentation: delegationPresentation({
          label: tracked.label,
          ...(tracked.detail === undefined ? {} : { detail: tracked.detail }),
        }),
        ...(noTurnFallback === undefined ? {} : { noTurnFallback }),
      },
    ];
  }

  function flushSubagentChildWork(
    context: AcpDeltaTranslationContext | undefined,
    parentCallId: string,
    status: ThreadEventItemStatus,
    visited = new Set<string>(),
  ): ThreadDelta[] {
    if (visited.has(parentCallId)) {
      return [];
    }
    visited.add(parentCallId);
    const deltas: ThreadDelta[] = [];
    for (const [, nested] of threadSubagentEntries(context)) {
      if (nested.parentRef === parentCallId && !nested.closed) {
        deltas.push(
          ...flushSubagentChildWork(context, nested.callId, status, visited),
          ...closeTrackedSubagentDelegation(context, nested, status),
        );
      }
    }
    deltas.push(
      closeThoughtStream(parentCallId),
      closeAssistantStream(parentCallId),
    );
    for (const [key, open] of threadCallEntries(context)) {
      if (open.parentRef !== parentCallId) {
        continue;
      }
      mergedToolCalls.delete(key);
      const tracked = subagentsByCall.get(key);
      if (tracked !== undefined) {
        tracked.closed = true;
      }
      deltas.push(
        toolCallClose({
          context,
          event: open.event,
          status,
          permissionTitle: open.permissionTitle,
          delegation: open.delegation,
          parentRef: open.parentRef,
        }),
      );
    }
    return deltas;
  }

  function drainOpenToolCalls(
    context: AcpDeltaTranslationContext | undefined,
    status: ThreadEventItemStatus,
  ): ThreadDelta[] {
    const deltas: ThreadDelta[] = [];
    const entries = threadCallEntries(context);
    const ordered = [
      ...entries.filter(([, open]) => open.parentRef !== undefined),
      ...entries.filter(([, open]) => open.parentRef === undefined),
    ];
    for (const [key, open] of ordered) {
      if (!mergedToolCalls.has(key)) {
        continue;
      }
      mergedToolCalls.delete(key);
      const tracked = subagentsByCall.get(key);
      if (tracked !== undefined && !tracked.closed) {
        deltas.push(...flushSubagentChildWork(context, tracked.callId, status));
        tracked.closed = true;
      }
      deltas.push(
        toolCallClose({
          context,
          event: open.event,
          status,
          permissionTitle: open.permissionTitle,
          delegation:
            tracked !== undefined
              ? delegationReportForSubagent(tracked)
              : open.delegation,
          parentRef: open.parentRef,
        }),
      );
    }
    for (const [, tracked] of threadSubagentEntries(context)) {
      if (!tracked.closed) {
        deltas.push(
          ...flushSubagentChildWork(context, tracked.callId, status),
          ...closeTrackedSubagentDelegation(context, tracked, status),
        );
      }
    }
    return deltas;
  }

  function flushOpenTurnWork(
    context: AcpDeltaTranslationContext | undefined,
    status: ThreadEventItemStatus,
  ): ThreadDelta[] {
    const subagentStreamCloses: ThreadDelta[] = [];
    const closedParents = new Set<string>();
    for (const [, tracked] of threadSubagentEntries(context)) {
      if (closedParents.has(tracked.callId)) {
        continue;
      }
      closedParents.add(tracked.callId);
      subagentStreamCloses.push(
        closeThoughtStream(tracked.callId),
        closeAssistantStream(tracked.callId),
      );
    }
    return [
      ...subagentStreamCloses,
      closeThoughtStream(),
      closeAssistantStream(),
      ...drainOpenToolCalls(context, status),
    ];
  }

  function agentCompactionKey(compactionId: string): DeltaItemKey {
    return {
      channel: "compaction",
      providerItemId: `compaction:${compactionId}`,
    };
  }

  function agentCompactionFailure(
    status: string,
    error: string | undefined,
  ): ThreadDelta | undefined {
    switch (status) {
      case "failed":
        return {
          kind: "provider.error",
          message: "Context compaction failed",
          detail: error ?? "The agent reported that context compaction failed",
        };
      case "cancelled":
        return {
          kind: "provider.error",
          message: "Context compaction interrupted",
          detail: error ?? "The agent cancelled context compaction",
        };
      default:
        return undefined;
    }
  }

  function translateCompactionUpdate(
    update: AcpSessionUpdate,
    context: AcpDeltaTranslationContext | undefined,
    rawEvent: JsonRpcMessage,
  ): ThreadDelta[] {
    const parsed = acpCompactionUpdateSchema.safeParse(update);
    if (!parsed.success) {
      return suppressedUnhandled(rawEvent);
    }
    const { compactionId, status, error } = parsed.data;
    const compactionKey = callKey(context, compactionId);
    if (finishedAgentCompactions.has(compactionKey)) {
      return [];
    }
    const deltas: ThreadDelta[] = [];
    if (!openAgentCompactions.has(compactionKey)) {
      openAgentCompactions.add(compactionKey);
      deltas.push(closeThoughtStream(), closeAssistantStream(), {
        kind: "item.open",
        key: agentCompactionKey(compactionId),
        item: { type: "compaction" },
        presentation: COMPACTION_PRESENTATION,
        noTurnFallback: noTurnFallbackFor(rawEvent),
      });
    }
    const failure = agentCompactionFailure(status, error || undefined);
    if (status !== "completed" && failure === undefined) {
      return deltas;
    }
    openAgentCompactions.delete(compactionKey);
    finishedAgentCompactions.add(compactionKey);
    if (failure !== undefined) {
      return [...deltas, failure];
    }
    return [
      ...deltas,
      {
        kind: "item.close",
        key: agentCompactionKey(compactionId),
        status: "completed",
        item: { type: "compaction" },
        presentation: COMPACTION_PRESENTATION,
      },
      {
        kind: "context.compacted",
        noTurnFallback: noTurnFallbackFor(rawEvent),
      },
    ];
  }

  function translateUpdate(
    update: AcpSessionUpdate,
    context: AcpDeltaTranslationContext | undefined,
    sessionId?: string,
  ): ThreadDelta[] {
    const rawEvent = updateEnvelope(context, update);
    const parentRef =
      sessionId === undefined
        ? undefined
        : subagentsBySession.get(sessionKey(context, sessionId))?.callId;

    switch (update.sessionUpdate) {
      case "subagent_spawned": {
        const parsed = acpSubagentSpawnedUpdateSchema.safeParse(update);
        if (!parsed.success) {
          return suppressedUnhandled(rawEvent);
        }
        const { subagentSessionId, name, task, _meta } = parsed.data;
        const meta = readSubagentCursorMeta(_meta);
        const callId = meta.toolCallId ?? `subagent:${subagentSessionId}`;
        const key = callKey(context, callId);
        const open = mergedToolCalls.get(key);
        const childRef =
          meta.agentId ?? open?.delegation?.childRef ?? subagentSessionId;
        const label =
          open?.delegation?.label ??
          cleanTaskToolTitle(open?.event.title) ??
          firstNonEmptyLine(task) ??
          name ??
          "Subagent task";
        const detail =
          buildSubagentDetail(name, meta.model) ?? open?.delegation?.detail;
        const effectiveParentRef = open?.parentRef ?? parentRef;
        const tracked: AcpTrackedSubagent = {
          threadId: context?.threadId ?? "",
          subagentSessionId,
          callId,
          ...(effectiveParentRef === undefined
            ? {}
            : { parentRef: effectiveParentRef }),
          childRef,
          label,
          ...(name === undefined ? {} : { name }),
          ...(meta.model === undefined ? {} : { model: meta.model }),
          ...(detail === undefined ? {} : { detail }),
          terminal: false,
          closed: false,
        };
        subagentsBySession.set(sessionKey(context, subagentSessionId), tracked);
        subagentsByCall.set(key, tracked);
        const report = delegationReportForSubagent(tracked);
        if (open !== undefined) {
          mergedToolCalls.set(key, {
            ...open,
            delegation: report,
            ...(effectiveParentRef === undefined
              ? {}
              : { parentRef: effectiveParentRef }),
          });
        }
        const flush =
          open === undefined
            ? [
                closeThoughtStream(effectiveParentRef),
                closeAssistantStream(effectiveParentRef),
              ]
            : [];
        return [
          ...flush,
          {
            kind: "item.open",
            key: withParentRef({ providerItemId: callId }, effectiveParentRef),
            item: {
              type: "delegation",
              childRef,
              label,
              background: false,
            },
            presentation: delegationPresentation({
              label,
              ...(detail === undefined ? {} : { detail }),
            }),
            noTurnFallback: noTurnFallbackFor(rawEvent),
          },
        ];
      }

      case "subagent_state_update": {
        const parsed = acpSubagentStateUpdateSchema.safeParse(update);
        if (!parsed.success) {
          return suppressedUnhandled(rawEvent);
        }
        const tracked = subagentsBySession.get(
          sessionKey(context, parsed.data.subagentSessionId),
        );
        if (tracked === undefined) {
          return [];
        }
        const status = mapSubagentTerminalState(parsed.data.state);
        if (status === undefined) {
          return [];
        }
        tracked.terminal = true;
        return [
          ...flushSubagentChildWork(context, tracked.callId, status),
          ...closeTrackedSubagentDelegation(
            context,
            tracked,
            status,
            noTurnFallbackFor(rawEvent),
          ),
        ];
      }

      case "agent_message_chunk": {
        const parsed = acpAgentMessageChunkUpdateSchema.safeParse(update);
        const text = parsed.success
          ? extractAcpContentText(parsed.data.content)
          : undefined;
        if (text === undefined) {
          return suppressedUnhandled(rawEvent);
        }
        return [
          closeThoughtStream(parentRef),
          {
            kind: "item.textDelta",
            key: withParentRef({ channel: ASSISTANT_STREAM_KEY }, parentRef),
            channel: "agentMessage",
            text,
            noTurnFallback: noTurnFallbackFor(rawEvent),
          },
        ];
      }

      case "agent_thought_chunk": {
        const parsed = acpAgentThoughtChunkUpdateSchema.safeParse(update);
        const text = parsed.success
          ? extractAcpContentText(parsed.data.content)
          : undefined;
        if (text === undefined) {
          return suppressedUnhandled(rawEvent);
        }
        return [
          {
            kind: "item.textDelta",
            key: withParentRef({ channel: THOUGHT_STREAM_KEY }, parentRef),
            channel: "reasoningText",
            text,
            noTurnFallback: noTurnFallbackFor(rawEvent),
          },
        ];
      }

      case "tool_call": {
        const parsed = acpToolCallUpdateEventSchema.safeParse(update);
        if (!parsed.success) {
          return suppressedUnhandled(rawEvent);
        }
        const event = withDialectIdentity(parsed.data);
        const flush = [
          closeThoughtStream(parentRef),
          closeAssistantStream(parentRef),
        ];
        const announcedKey = callKey(context, event.toolCallId);
        const bound = bindAnnouncedCall(context, event);
        if (bound !== undefined) {
          injectedToolBindings.set(announcedKey, bound);
        }
        noteEditedPaths(announcedKey, event);
        if (isTerminalAcpStatus(event.status)) {
          return [
            ...flush,
            toolCallClose({
              context,
              event,
              status: mapAcpToolCallStatus(event.status),
              parentRef,
              noTurnFallback: noTurnFallbackFor(rawEvent),
            }),
          ];
        }
        const classified = classifyCall(context, event);
        const existingTracked = subagentsByCall.get(announcedKey);
        const delegation =
          existingTracked !== undefined
            ? delegationReportForSubagent(existingTracked)
            : undefined;
        const finalClassified = withDelegationReport(classified, delegation);
        mergedToolCalls.set(announcedKey, {
          event,
          openedType: finalClassified.item.type,
          ...(delegation === undefined ? {} : { delegation }),
          ...(parentRef === undefined ? {} : { parentRef }),
        });
        return [
          ...flush,
          {
            kind: "item.open",
            key: withParentRef({ providerItemId: event.toolCallId }, parentRef),
            item: finalClassified.item,
            presentation: finalClassified.presentation,
            noTurnFallback: noTurnFallbackFor(rawEvent),
          },
        ];
      }

      case "tool_call_update": {
        const parsed = acpToolCallUpdateEventSchema.safeParse(update);
        if (!parsed.success) {
          return suppressedUnhandled(rawEvent);
        }
        const event = withDialectIdentity(parsed.data);
        const key = callKey(context, event.toolCallId);
        const open = mergedToolCalls.get(key);
        const effectiveParentRef = open?.parentRef ?? parentRef;
        const merged = withClientFileWrites(
          mergeAcpToolCallEvents(open?.event, event),
          open?.clientFileWrites ?? [],
        );
        noteEditedPaths(key, merged);
        if (isTerminalAcpStatus(merged.status)) {
          const tracked = subagentsByCall.get(key);
          if (tracked !== undefined) {
            if (tracked.closed) {
              mergedToolCalls.delete(key);
              return [];
            }
            if (!tracked.terminal && isBackgroundTaskToolResult(merged)) {
              tracked.deferredToolClose = {
                event: merged,
                status: mapAcpToolCallStatus(merged.status),
                ...(open?.permissionTitle === undefined
                  ? {}
                  : { permissionTitle: open.permissionTitle }),
                ...(open?.delegation === undefined
                  ? {}
                  : { delegation: open.delegation }),
              };
              mergedToolCalls.set(key, {
                event: merged,
                openedType: open?.openedType ?? "delegation",
                ...(open?.permissionTitle === undefined
                  ? {}
                  : { permissionTitle: open.permissionTitle }),
                delegation: delegationReportForSubagent(tracked),
                ...(open?.clientFileWrites === undefined
                  ? {}
                  : { clientFileWrites: open.clientFileWrites }),
                ...(effectiveParentRef === undefined
                  ? {}
                  : { parentRef: effectiveParentRef }),
              });
              return [];
            }
            const status = mapAcpToolCallStatus(merged.status);
            const flushed = flushSubagentChildWork(
              context,
              tracked.callId,
              status,
            );
            tracked.closed = true;
            mergedToolCalls.delete(key);
            return [
              ...flushed,
              toolCallClose({
                context,
                event: merged,
                status,
                permissionTitle: open?.permissionTitle,
                delegation: delegationReportForSubagent(tracked),
                parentRef: effectiveParentRef,
                noTurnFallback: noTurnFallbackFor(rawEvent),
              }),
            ];
          }
          mergedToolCalls.delete(key);
          return [
            toolCallClose({
              context,
              event: merged,
              status: mapAcpToolCallStatus(merged.status),
              permissionTitle: open?.permissionTitle,
              delegation: open?.delegation,
              parentRef: effectiveParentRef,
              noTurnFallback: noTurnFallbackFor(rawEvent),
            }),
          ];
        }
        const classified = classifyCall(context, merged);
        const mergedType = classified.item.type;
        const previous =
          open === undefined ? undefined : classifyCall(context, open.event);
        const refreshed: ThreadDelta[] = [];
        if (
          previous?.item.type === "command" &&
          classified.item.type === "command" &&
          (previous.item.command !== classified.item.command ||
            previous.presentation?.title !== classified.presentation?.title)
        ) {
          refreshed.push({
            kind: "item.open",
            key: withParentRef(
              { providerItemId: event.toolCallId },
              effectiveParentRef,
            ),
            item: classified.item,
            presentation: classified.presentation,
            noTurnFallback: noTurnFallbackFor(rawEvent),
          });
        }
        mergedToolCalls.set(key, {
          event: merged,
          openedType: open?.openedType ?? mergedType,
          ...(open?.permissionTitle === undefined
            ? {}
            : { permissionTitle: open.permissionTitle }),
          ...(open?.delegation === undefined
            ? {}
            : { delegation: open.delegation }),
          ...(open?.clientFileWrites === undefined
            ? {}
            : { clientFileWrites: open.clientFileWrites }),
          ...(effectiveParentRef === undefined
            ? {}
            : { parentRef: effectiveParentRef }),
        });
        if (
          event.status === "in_progress" &&
          mergedType === "command" &&
          open?.openedType === "command"
        ) {
          const normalizedEvent =
            dialect.normalizeCommandEvent?.(event, merged) ?? event;
          const streamed = extractAcpStreamedCommandOutput(normalizedEvent);
          if (streamed === undefined) {
            return refreshed.length === 0
              ? suppressedUnhandled(rawEvent)
              : refreshed;
          }
          return [
            ...refreshed,
            {
              kind: "command.outputSnapshot",
              key: withParentRef(
                { providerItemId: event.toolCallId },
                effectiveParentRef,
              ),
              text: streamed,
            },
          ];
        }
        const progressEvent =
          dialect.normalizeToolCallEvent?.(event, merged) ?? event;
        const progressText = extractAcpToolCallOutputText(progressEvent);
        if (progressText === undefined) {
          return refreshed.length === 0
            ? suppressedUnhandled(rawEvent)
            : refreshed;
        }
        if (mergedType !== "command" && mergedType !== "fileChange") {
          return [
            {
              kind: "item.progress",
              key: withParentRef(
                {
                  providerItemId: event.toolCallId,
                },
                effectiveParentRef,
              ),
              message: progressText,
              noTurnFallback: noTurnFallbackFor(rawEvent),
            },
          ];
        }
        return refreshed.length === 0
          ? suppressedUnhandled(rawEvent)
          : refreshed;
      }

      case "plan": {
        const parsed = acpPlanUpdateSchema.safeParse(update);
        if (!parsed.success) {
          return suppressedUnhandled(rawEvent);
        }
        const steps: ThreadEventPlanStep[] = parsed.data.entries.map(
          (entry) => ({
            step: entry.content,
            ...(entry.status
              ? { status: ACP_PLAN_STEP_STATUS_BY_ENTRY_STATUS[entry.status] }
              : {}),
          }),
        );
        return [
          {
            kind: "item.close",
            key: withParentRef({ channel: PLAN_STEPS_CHANNEL }, parentRef),
            status: "completed",
            item: { type: "planSteps", steps },
            presentation: planStepsPresentation(steps),
            noTurnFallback: noTurnFallbackFor(rawEvent),
          },
        ];
      }

      case "usage_update": {
        if (parentRef !== undefined) {
          return [];
        }
        const parsed = acpUsageUpdateSchema.safeParse(update);
        if (!parsed.success) {
          return [];
        }
        const cost = threadUsageCostSchema.safeParse(parsed.data["cost"]);
        if (cost.success) {
          lastUsageCost = cost.data;
        }
        return [
          {
            kind: "contextWindow",
            used: parsed.data.used,
            size: parsed.data.size,
            estimated: false,
            attach: "open",
            ...(lastUsageCost === undefined ? {} : { cost: lastUsageCost }),
          },
        ];
      }

      case "compaction_update":
        if (parentRef !== undefined) {
          return [];
        }
        return translateCompactionUpdate(update, context, rawEvent);

      case "session_info_update": {
        if (parentRef !== undefined) {
          return [];
        }
        const title = isJsonObject(update) ? update["title"] : undefined;
        if (
          typeof title !== "string" ||
          title.trim() === "" ||
          title.trimStart().startsWith(SYSTEM_INSTRUCTIONS_OPEN_TAG) ||
          title === lastAgentTitle
        ) {
          return [];
        }
        lastAgentTitle = title;
        return [{ kind: "thread.name", name: title, source: "agent" }];
      }

      default:
        return unhandledDeltas(rawEvent);
    }
  }

  function turnStatusForStopReason(
    stopReason: AcpStopReason,
  ): ThreadEventTurnStatus {
    return stopReason === "cancelled" ? "interrupted" : "completed";
  }

  function stopReasonNotice(
    stopReason: AcpStopReason,
  ): { summary: string; details?: string } | undefined {
    switch (stopReason) {
      case "end_turn":
      case "cancelled":
        return undefined;
      case "max_tokens":
        return {
          summary: "The agent stopped at its output limit",
          details:
            "The model reached its maximum output length before finishing this turn.",
        };
      case "max_turn_requests":
        return {
          summary: "The agent stopped at its request limit",
          details:
            "The agent reached its limit of model requests for a single turn.",
        };
      case "refusal":
        return { summary: "The agent declined to continue" };
      default:
        return {
          summary: "The agent stopped the turn",
          details: `Stop reason: ${stopReason}`,
        };
    }
  }

  function itemStatusForTurnStatus(
    status: ThreadEventTurnStatus,
  ): ThreadEventItemStatus {
    return status === "completed"
      ? "completed"
      : status === "interrupted"
        ? "interrupted"
        : "failed";
  }

  function translateTurnCompleted(
    stopReason: AcpStopReason,
    context: AcpDeltaTranslationContext | undefined,
  ): ThreadDelta[] {
    const status = turnStatusForStopReason(stopReason);
    const notice = stopReasonNotice(stopReason);
    return [
      ...flushOpenTurnWork(context, itemStatusForTurnStatus(status)),
      ...(notice === undefined
        ? []
        : ([
            {
              kind: "provider.warning",
              summary: notice.summary,
              ...(notice.details === undefined
                ? {}
                : { details: notice.details }),
              vouchedTurn: true,
            },
          ] satisfies ThreadDelta[])),
      { kind: "turn.boundary", status, claimIfIdle: true },
    ];
  }

  function translateAcpEvent(
    event: ProviderRuntimeEvent,
    context?: AcpDeltaTranslationContext,
  ): ThreadDelta[] {
    const errorEnvelope = errorEnvelopeSchema.safeParse(event);
    if (errorEnvelope.success) {
      const closed = flushOpenTurnWork(context, "failed");
      clearThreadCalls(context);
      return [
        ...closed,
        {
          kind: "provider.error",
          message: "Provider error",
          detail: errorEnvelope.data.params?.message ?? "unknown error",
          settlesTurn: true,
        },
      ];
    }

    const envelope = jsonRpcEnvelopeSchema.safeParse(event);
    if (!envelope.success) {
      return [];
    }

    switch (envelope.data.method) {
      case ACP_TURN_STARTED_METHOD: {
        const params = acpTurnStartedNotificationParamsSchema.safeParse(
          envelope.data.params,
        );
        if (!params.success) {
          return [];
        }
        const closed = flushOpenTurnWork(context, "interrupted");
        clearThreadCalls(context);
        filesAddedThisTurn.clear();
        return [...closed, { kind: "turn.open" }];
      }

      case ACP_PROMPT_INTERRUPTED_METHOD: {
        const params = acpTurnStartedNotificationParamsSchema.safeParse(
          envelope.data.params,
        );
        if (!params.success) {
          return [];
        }
        return drainOpenToolCalls(context, "interrupted");
      }

      case ACP_TURN_COMPLETED_METHOD: {
        const params = acpTurnCompletedNotificationParamsSchema.safeParse(
          envelope.data.params,
        );
        if (!params.success) {
          return [];
        }
        return translateTurnCompleted(params.data.stopReason, context);
      }

      case ACP_COMPACTION_STARTED_METHOD: {
        const params = acpTurnStartedNotificationParamsSchema.safeParse(
          envelope.data.params,
        );
        if (!params.success) {
          return [];
        }
        const closed = flushOpenTurnWork(context, "interrupted");
        clearThreadCalls(context);
        return [
          ...closed,
          { kind: "turn.open" },
          {
            kind: "item.open",
            key: { channel: "compaction" },
            item: { type: "compaction" },
            presentation: COMPACTION_PRESENTATION,
          },
        ];
      }

      case ACP_COMPACTION_COMPLETED_METHOD: {
        const params = acpCompactionCompletedNotificationParamsSchema.safeParse(
          envelope.data.params,
        );
        if (!params.success) {
          return [];
        }
        const status = params.data.status;
        const turnStatus: ThreadEventTurnStatus =
          status === "skipped" ? "completed" : status;
        return [
          ...flushOpenTurnWork(context, itemStatusForTurnStatus(turnStatus)),
          ...(status === "completed"
            ? ([{ kind: "context.compacted" }] as ThreadDelta[])
            : []),
          ...(status === "skipped"
            ? ([
                {
                  kind: "provider.warning",
                  category: "compaction-skipped",
                  summary: "Context compaction skipped",
                  details: params.data.detail,
                  vouchedTurn: true,
                },
              ] as ThreadDelta[])
            : []),
          {
            kind: "turn.boundary",
            status: turnStatus,
            ...(status === "failed"
              ? { error: { message: params.data.error } }
              : {}),
          },
        ];
      }

      case ACP_UPDATE_METHOD: {
        const params = acpUpdateNotificationParamsSchema.safeParse(
          envelope.data.params,
        );
        if (!params.success) {
          return [];
        }
        return translateUpdate(
          params.data.update,
          context,
          params.data.sessionId,
        );
      }

      case ACP_FS_WRITE_METHOD: {
        const params = acpFsWriteNotificationParamsSchema.safeParse(
          envelope.data.params,
        );
        if (!params.success) {
          return [];
        }
        if (mergeFsWriteIntoOpenToolCall(context, params.data)) {
          return [];
        }
        const rawEvent: JsonRpcMessage = {
          jsonrpc: "2.0",
          method: ACP_FS_WRITE_METHOD,
          params: params.data,
        };
        return [
          {
            kind: "item.close",
            key: { channel: "fs-write" },
            status: "completed",
            item: {
              type: "fileChange",
              changes: [
                {
                  path: params.data.path,
                  kind: params.data.kind,
                  ...(params.data.oldText === undefined
                    ? {}
                    : { oldText: params.data.oldText }),
                  newText: params.data.content,
                },
              ],
            },
            presentation: fileChangePresentation({
              verb: params.data.kind,
              paths: [params.data.path],
            }),
            noTurnFallback: noTurnFallbackFor(rawEvent),
          },
        ];
      }

      case ACP_WARNING_METHOD: {
        const params = acpWarningNotificationParamsSchema.safeParse(
          envelope.data.params,
        );
        if (!params.success) {
          return [];
        }
        return [
          {
            kind: "provider.warning",
            summary: params.data.summary,
            ...(params.data.details ? { details: params.data.details } : {}),
            vouchedTurn: true,
          },
        ];
      }

      default:
        return unhandledDeltas({
          jsonrpc: "2.0",
          method: envelope.data.method,
          ...(envelope.data.params ? { params: envelope.data.params } : {}),
        });
    }
  }

  function notePermissionToolCall(
    threadId: string,
    toolCall: AcpPermissionToolCallInput,
  ): AcpBoundPermissionToolCall {
    const context = { threadId };
    const ownKey = callKey(context, toolCall.toolCallId);
    let boundKey: string | undefined = mergedToolCalls.has(ownKey)
      ? ownKey
      : undefined;
    if (boundKey === undefined) {
      const sameKind = threadCallEntries(context).filter(
        ([, open]) =>
          toolCall.kind !== undefined && open.event.kind === toolCall.kind,
      );
      boundKey = sameKind.length === 1 ? sameKind[0]?.[0] : undefined;
    }
    const open =
      boundKey === undefined ? undefined : mergedToolCalls.get(boundKey);
    if (boundKey === undefined || open === undefined) {
      return { toolCallId: toolCall.toolCallId, event: undefined };
    }
    if (classifyCall(context, open.event).item.type !== "tool") {
      return { toolCallId: open.event.toolCallId, event: open.event };
    }
    const kind =
      toolCall.kind !== undefined &&
      (toolCall.kind !== "other" || open.event.kind === undefined)
        ? toolCall.kind
        : undefined;
    const merged = mergeAcpToolCallEvents(open.event, {
      sessionUpdate: "tool_call_update",
      toolCallId: open.event.toolCallId,
      ...(toolCall.title !== undefined ? { title: toolCall.title } : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(kind === "other" && toolCall.rawKind !== undefined
        ? { rawKind: toolCall.rawKind }
        : {}),
      ...(toolCall.locations !== undefined
        ? { locations: toolCall.locations }
        : {}),
      ...(toolCall.rawInput !== undefined
        ? { rawInput: toolCall.rawInput }
        : {}),
      ...(toolCall.rawOutput !== undefined
        ? { rawOutput: toolCall.rawOutput }
        : {}),
    });
    if (classifyCall(context, merged).item.type === open.openedType) {
      mergedToolCalls.set(boundKey, { ...open, event: merged });
      return { toolCallId: merged.toolCallId, event: merged };
    }
    mergedToolCalls.set(boundKey, {
      ...open,
      ...(toolCall.title === undefined
        ? {}
        : { permissionTitle: toolCall.title }),
    });
    return { toolCallId: open.event.toolCallId, event: merged };
  }

  function noteDelegationReport(
    threadId: string,
    report: AcpDelegationReport,
  ): ThreadDelta[] {
    const context = { threadId };
    const key = callKey(context, report.toolCallId);
    const open = mergedToolCalls.get(key);
    const tracked = subagentsByCall.get(key);
    if (open === undefined && (tracked === undefined || tracked.closed)) {
      return [];
    }
    const mergedDetail =
      tracked?.name !== undefined
        ? buildSubagentDetail(
            tracked.name,
            report.detail?.replace(/^model\s+/u, "") ?? tracked.model,
          )
        : (report.detail ?? tracked?.detail);
    const mergedReport: AcpDelegationReport = {
      toolCallId: report.toolCallId,
      childRef: report.childRef,
      label: report.label,
      ...(mergedDetail === undefined ? {} : { detail: mergedDetail }),
    };
    if (tracked !== undefined) {
      tracked.childRef = mergedReport.childRef;
      tracked.label = mergedReport.label;
      if (mergedDetail !== undefined) {
        tracked.detail = mergedDetail;
      }
    }
    if (open !== undefined) {
      const classified = classifyCall(context, open.event);
      if (classified.item.type !== "delegation") {
        return [];
      }
      const item: DeltaItemShape = {
        ...classified.item,
        childRef: mergedReport.childRef,
        label: mergedReport.label,
      };
      mergedToolCalls.set(key, { ...open, delegation: mergedReport });
      return [
        {
          kind: "item.open",
          key: withParentRef(
            { providerItemId: report.toolCallId },
            open.parentRef,
          ),
          item,
          presentation: delegationPresentation({
            label: mergedReport.label,
            ...(mergedReport.detail === undefined
              ? {}
              : { detail: mergedReport.detail }),
          }),
        },
      ];
    }
    if (tracked === undefined) {
      return [];
    }
    return [
      {
        kind: "item.open",
        key: withParentRef(
          { providerItemId: tracked.callId },
          tracked.parentRef,
        ),
        item: {
          type: "delegation",
          childRef: tracked.childRef,
          label: tracked.label,
          background: false,
        },
        presentation: delegationPresentation({
          label: tracked.label,
          ...(tracked.detail === undefined ? {} : { detail: tracked.detail }),
        }),
      },
    ];
  }

  function getInjectedToolBinding(
    threadId: string,
    toolCallId: string,
  ): AcpInjectedTool | undefined {
    return injectedToolBindings.get(callKey({ threadId }, toolCallId));
  }

  return {
    configureInjectedTools,
    getInjectedToolBinding,
    noteDelegationReport,
    noteInjectedToolCall,
    notePermissionToolCall,
    translateAcpEvent,
  };
}

export type AcpDeltaTranslator = ReturnType<typeof createAcpDeltaTranslator>;
