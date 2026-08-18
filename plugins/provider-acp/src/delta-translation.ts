/**
 * ACP dialect parsing → narrow-grammar deltas.
 *
 * Translates the ACP bridge's internal envelopes (`acp/turn/started`,
 * `acp/update`, `acp/fs/write`, …) into `thread/delta` semantic deltas.
 * Everything timeline-shaped — turn/item ids, accepted-input correlation,
 * pairing, settlement, text accumulation — is the runtime delta assembler's
 * job; this module owns the ACP dialect: session-update classification, the
 * tool-call merge cache (updates carry only changed fields, so absent fields
 * inherit the started event's values — provider knowledge the assembler must
 * never guess), the thought/message flush triggers, and the stop-reason
 * mappings.
 *
 * The one dialect state is the merge cache. Ids, turns, and open items live
 * in the assembler.
 */

import {
  errorEnvelopeSchema,
  extractResultText,
  jsonRpcEnvelopeSchema,
  providerRawEventSchema,
  toOptionalString,
  type JsonRpcMessage,
  type ProviderRawEvent,
  type ProviderRuntimeEvent,
} from "@get-bb/plugin-sdk/provider-bridge";
import type {
  DeltaFileChange,
  DeltaItemShape,
  DeltaNoTurnFallback,
  ThreadDelta,
  ThreadEventItemStatus,
  ThreadEventPlanStep,
  ThreadEventTurnStatus,
} from "@get-bb/plugin-sdk/provider-bridge";
import {
  ACP_COMPACTION_COMPLETED_METHOD,
  ACP_COMPACTION_STARTED_METHOD,
  ACP_FS_WRITE_METHOD,
  ACP_TURN_COMPLETED_METHOD,
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
  classifyAcpToolCall as classifyAcpToolCallOperation,
  type AcpToolCallOperation,
} from "./tool-call-operation.js";
import { acpVisibilityMetadata } from "./visibility.js";
import {
  acpAgentMessageChunkUpdateSchema,
  acpAgentThoughtChunkUpdateSchema,
  acpPlanUpdateSchema,
  acpToolCallUpdateEventSchema,
  acpUsageUpdateSchema,
  extractAcpContentText,
  type AcpSessionUpdate,
  type AcpStopReason,
  type AcpToolCallUpdateEvent,
} from "./wire.js";

/**
 * The per-event translation scope the caller passes in (the bridge stamps the
 * bb thread id; a parent tool-call id would arrive from nested traffic).
 */
export interface AcpDeltaTranslationContext {
  threadId?: string;
  parentToolCallId?: string;
}

const ASSISTANT_STREAM_KEY = "assistant";
const THOUGHT_STREAM_KEY = "thought";

const ACP_PLAN_STEP_STATUS_BY_ENTRY_STATUS = {
  pending: "pending",
  in_progress: "active",
  completed: "completed",
} as const;

// ---------------------------------------------------------------------------
// Pure ACP parsing helpers
// ---------------------------------------------------------------------------

function extractAcpToolCallOutputText(
  event: AcpToolCallUpdateEvent,
): string | undefined {
  const chunks: string[] = [];
  for (const entry of event.content ?? []) {
    if (entry.type !== "content") {
      continue;
    }
    const text = extractAcpContentText(entry.content);
    if (text) {
      chunks.push(text);
    }
  }
  if (chunks.length > 0) {
    return chunks.join("\n");
  }
  if (event.rawOutput === undefined) {
    return undefined;
  }
  const rawOutputText = extractResultText(event.rawOutput).trim();
  return rawOutputText.length > 0 ? rawOutputText : undefined;
}

function buildAcpFileChanges(
  event: AcpToolCallUpdateEvent,
  operation: Extract<AcpToolCallOperation, { kind: "file_change" }>,
): DeltaFileChange[] {
  const changes: DeltaFileChange[] = [];
  for (const entry of event.content ?? []) {
    if (entry.type !== "diff") {
      continue;
    }
    const oldText = entry.oldText ?? undefined;
    changes.push({
      path: entry.path,
      kind: oldText === undefined ? "add" : "update",
      ...(oldText === undefined ? {} : { oldText }),
      newText: entry.newText,
    });
  }
  if (changes.length > 0) {
    return changes;
  }
  const [path] = operation.paths;
  return path === undefined ? [] : [{ path, kind: operation.changeKind }];
}

/**
 * Classify a (merged) tool_call event into its parsed item shape. The
 * command/file-change/generic decision is the shared classifier's — the
 * permission mapping (`interactions.ts`) uses the same one, so an approval
 * row and its timeline item can never disagree (#1803).
 */
function classifyAcpToolCall(event: AcpToolCallUpdateEvent): DeltaItemShape {
  const operation = classifyAcpToolCallOperation(event);
  if (operation.kind === "command") {
    return { type: "command", command: operation.command, cwd: "" };
  }
  if (operation.kind === "file_change") {
    const changes = buildAcpFileChanges(event, operation);
    if (changes.length > 0) {
      return { type: "fileChange", changes };
    }
  }
  return {
    type: "tool",
    tool: toOptionalString(event.title) ?? event.kind ?? "tool",
  };
}

function isTerminalAcpStatus(
  status: AcpToolCallUpdateEvent["status"],
): boolean {
  return status === "completed" || status === "failed";
}

function mapAcpToolCallStatus(
  status: AcpToolCallUpdateEvent["status"],
): ThreadEventItemStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "pending";
  }
}

/**
 * Merge a tool_call_update into the started tool_call event: updates carry
 * only changed fields, so absent fields keep the started event's values and
 * the merged event re-classifies with the original knowledge intact.
 */
function mergeAcpToolCallEvents(
  started: AcpToolCallUpdateEvent | undefined,
  update: AcpToolCallUpdateEvent,
): AcpToolCallUpdateEvent {
  if (!started) {
    return update;
  }
  return {
    ...started,
    ...(update.title !== undefined ? { title: update.title } : {}),
    ...(update.kind !== undefined ? { kind: update.kind } : {}),
    ...(update.status !== undefined ? { status: update.status } : {}),
    ...(update.content !== undefined ? { content: update.content } : {}),
    ...(update.locations !== undefined ? { locations: update.locations } : {}),
    ...(update.rawInput !== undefined ? { rawInput: update.rawInput } : {}),
    ...(update.rawOutput !== undefined ? { rawOutput: update.rawOutput } : {}),
  };
}

// ---------------------------------------------------------------------------
// Translator factory
// ---------------------------------------------------------------------------

export function createAcpDeltaTranslator() {
  /**
   * The merge cache: latest merged tool_call event per unsettled call, in
   * insertion order (which decides turn-end settlement order), keyed
   * `${threadId} ${toolCallId}`.
   */
  const mergedToolCalls = new Map<string, AcpToolCallUpdateEvent>();

  function callKey(
    context: AcpDeltaTranslationContext | undefined,
    toolCallId: string,
  ): string {
    return `${context?.threadId ?? ""} ${toolCallId}`;
  }

  function threadCallEntries(
    context: AcpDeltaTranslationContext | undefined,
  ): [string, AcpToolCallUpdateEvent][] {
    const prefix = `${context?.threadId ?? ""} `;
    return [...mergedToolCalls.entries()].filter(([key]) =>
      key.startsWith(prefix),
    );
  }

  function clearThreadCalls(
    context: AcpDeltaTranslationContext | undefined,
  ): void {
    for (const [key] of threadCallEntries(context)) {
      mergedToolCalls.delete(key);
    }
  }

  // -------------------------------------------------------------------------
  // Fallback payloads (the old "no active turn" visibility guard)
  // -------------------------------------------------------------------------

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

  /**
   * A guard-listed update whose translation is empty: with a turn open the
   * old translator emitted nothing, without one it surfaced the raw envelope
   * as provider/unhandled (includeKnown). `onlyIfNoTurn` reproduces exactly
   * that split assembler-side.
   */
  function suppressedUnhandled(
    rawEvent: JsonRpcMessage,
    parentRef: string | undefined,
  ): ThreadDelta[] {
    const fallback = noTurnFallbackFor(rawEvent);
    return [
      {
        kind: "unhandled",
        raw: fallback.raw,
        rawType: fallback.rawType,
        vouchedTurn: false,
        onlyIfNoTurn: true,
        ...(parentRef ? { parentRef } : {}),
      },
    ];
  }

  /** Visibility classification: only unknown coverage becomes an `unhandled`. */
  function unhandledDeltas(
    rawEvent: JsonRpcMessage,
    parentRef: string | undefined,
  ): ThreadDelta[] {
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
        ...(parentRef ? { parentRef } : {}),
      },
    ];
  }

  // -------------------------------------------------------------------------
  // Flush triggers (provider policy: thought/message streams settle when the
  // next message chunk / tool call / turn end arrives)
  // -------------------------------------------------------------------------

  function closeThoughtStream(parentRef: string | undefined): ThreadDelta {
    return {
      kind: "message.close",
      channel: "reasoning",
      streamKey: THOUGHT_STREAM_KEY,
      ...(parentRef ? { parentRef } : {}),
    };
  }

  function closeAssistantStream(parentRef: string | undefined): ThreadDelta {
    return {
      kind: "message.close",
      channel: "assistant",
      streamKey: ASSISTANT_STREAM_KEY,
      ...(parentRef ? { parentRef } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Tool-call closes
  // -------------------------------------------------------------------------

  interface AcpCloseArgs {
    event: AcpToolCallUpdateEvent;
    status: ThreadEventItemStatus;
    parentRef: string | undefined;
    noTurnFallback?: DeltaNoTurnFallback;
  }

  /**
   * The terminal close for a (merged) tool_call event: carries the full
   * terminal shape plus the generic close fields; the assembler applies them
   * per item type (aggregatedOutput/exitCode to commands, result to tool
   * calls) exactly as the old per-type completion helpers did.
   */
  function toolCallClose(args: AcpCloseArgs): ThreadDelta {
    const outputText = extractAcpToolCallOutputText(args.event);
    const terminal = args.status === "completed" || args.status === "failed";
    return {
      kind: "item.close",
      key: {
        providerItemId: args.event.toolCallId,
        ...(args.parentRef ? { parentRef: args.parentRef } : {}),
      },
      status: args.status,
      ...(outputText === undefined
        ? {}
        : { resultText: outputText, aggregatedOutput: outputText }),
      ...(terminal ? { exitCode: args.status === "failed" ? 1 : 0 } : {}),
      item: classifyAcpToolCall(args.event),
      ...(args.noTurnFallback ? { noTurnFallback: args.noTurnFallback } : {}),
    };
  }

  /** Settle every unsettled cached call (turn/compaction end), oldest first. */
  function drainOpenToolCalls(
    context: AcpDeltaTranslationContext | undefined,
    status: ThreadEventItemStatus,
  ): ThreadDelta[] {
    const deltas: ThreadDelta[] = [];
    for (const [key, event] of threadCallEntries(context)) {
      mergedToolCalls.delete(key);
      deltas.push(
        toolCallClose({
          event,
          status,
          parentRef: context?.parentToolCallId,
        }),
      );
    }
    return deltas;
  }

  /** Turn-end flush: streams settle first, then the unsettled tool calls. */
  function flushOpenTurnWork(
    context: AcpDeltaTranslationContext | undefined,
    status: ThreadEventItemStatus,
  ): ThreadDelta[] {
    const parentRef = context?.parentToolCallId;
    return [
      closeThoughtStream(parentRef),
      closeAssistantStream(parentRef),
      ...drainOpenToolCalls(context, status),
    ];
  }

  // -------------------------------------------------------------------------
  // Session updates
  // -------------------------------------------------------------------------

  function translateUpdate(
    update: AcpSessionUpdate,
    context: AcpDeltaTranslationContext | undefined,
  ): ThreadDelta[] {
    const parentRef = context?.parentToolCallId;
    const parentRefField = parentRef ? { parentRef } : {};
    const rawEvent = updateEnvelope(context, update);

    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const parsed = acpAgentMessageChunkUpdateSchema.safeParse(update);
        const text = parsed.success
          ? extractAcpContentText(parsed.data.content)
          : undefined;
        if (text === undefined) {
          return suppressedUnhandled(rawEvent, parentRef);
        }
        // A message chunk flushes the open thought stream first.
        return [
          closeThoughtStream(parentRef),
          {
            kind: "message.delta",
            channel: "assistant",
            streamKey: ASSISTANT_STREAM_KEY,
            text,
            ...parentRefField,
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
          return suppressedUnhandled(rawEvent, parentRef);
        }
        return [
          {
            kind: "message.delta",
            channel: "reasoning",
            streamKey: THOUGHT_STREAM_KEY,
            text,
            ...parentRefField,
            noTurnFallback: noTurnFallbackFor(rawEvent),
          },
        ];
      }

      case "tool_call": {
        const parsed = acpToolCallUpdateEventSchema.safeParse(update);
        if (!parsed.success) {
          return suppressedUnhandled(rawEvent, parentRef);
        }
        // A tool call flushes both open streams before its item.
        const flush = [
          closeThoughtStream(parentRef),
          closeAssistantStream(parentRef),
        ];
        if (isTerminalAcpStatus(parsed.data.status)) {
          // Arrived already settled: close-without-open, no cache entry.
          return [
            ...flush,
            toolCallClose({
              event: parsed.data,
              status: mapAcpToolCallStatus(parsed.data.status),
              parentRef,
              noTurnFallback: noTurnFallbackFor(rawEvent),
            }),
          ];
        }
        mergedToolCalls.set(
          callKey(context, parsed.data.toolCallId),
          parsed.data,
        );
        return [
          ...flush,
          {
            kind: "item.open",
            key: {
              providerItemId: parsed.data.toolCallId,
              ...parentRefField,
            },
            item: classifyAcpToolCall(parsed.data),
            noTurnFallback: noTurnFallbackFor(rawEvent),
          },
        ];
      }

      case "tool_call_update": {
        const parsed = acpToolCallUpdateEventSchema.safeParse(update);
        if (!parsed.success) {
          return suppressedUnhandled(rawEvent, parentRef);
        }
        const key = callKey(context, parsed.data.toolCallId);
        const merged = mergeAcpToolCallEvents(
          mergedToolCalls.get(key),
          parsed.data,
        );
        if (isTerminalAcpStatus(merged.status)) {
          mergedToolCalls.delete(key);
          return [
            toolCallClose({
              event: merged,
              status: mapAcpToolCallStatus(merged.status),
              parentRef,
              noTurnFallback: noTurnFallbackFor(rawEvent),
            }),
          ];
        }
        mergedToolCalls.set(key, merged);
        const progressText = extractAcpToolCallOutputText(parsed.data);
        if (progressText && classifyAcpToolCall(merged).type === "tool") {
          return [
            {
              kind: "item.progress",
              key: {
                providerItemId: parsed.data.toolCallId,
                ...parentRefField,
              },
              message: progressText,
              noTurnFallback: noTurnFallbackFor(rawEvent),
            },
          ];
        }
        return suppressedUnhandled(rawEvent, parentRef);
      }

      case "plan": {
        const parsed = acpPlanUpdateSchema.safeParse(update);
        if (!parsed.success) {
          return suppressedUnhandled(rawEvent, parentRef);
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
            kind: "turn.plan",
            steps,
            noTurnFallback: noTurnFallbackFor(rawEvent),
          },
        ];
      }

      case "usage_update": {
        const parsed = acpUsageUpdateSchema.safeParse(update);
        if (!parsed.success) {
          return [];
        }
        return [
          {
            kind: "contextWindow",
            used: parsed.data.used,
            size: parsed.data.size,
            estimated: false,
            attach: "open",
          },
        ];
      }

      default:
        return unhandledDeltas(rawEvent, parentRef);
    }
  }

  // -------------------------------------------------------------------------
  // Turn lifecycle
  // -------------------------------------------------------------------------

  function turnStatusForStopReason(
    stopReason: AcpStopReason,
  ): ThreadEventTurnStatus {
    return stopReason === "end_turn"
      ? "completed"
      : stopReason === "cancelled"
        ? "interrupted"
        : "failed";
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
    return [
      ...flushOpenTurnWork(context, itemStatusForTurnStatus(status)),
      {
        kind: "turn.boundary",
        status,
        ...(status === "failed"
          ? { error: { message: `Agent stopped the turn: ${stopReason}` } }
          : {}),
        claimIfIdle: true,
      },
    ];
  }

  // -------------------------------------------------------------------------
  // Envelope dispatch
  // -------------------------------------------------------------------------

  function translateAcpEvent(
    event: ProviderRuntimeEvent,
    context?: AcpDeltaTranslationContext,
  ): ThreadDelta[] {
    const errorEnvelope = errorEnvelopeSchema.safeParse(event);
    if (errorEnvelope.success) {
      // A settling error abandons the unsettled calls with the failed turn.
      clearThreadCalls(context);
      return [
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
        clearThreadCalls(context);
        return [{ kind: "turn.open" }];
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
        clearThreadCalls(context);
        return [
          { kind: "turn.open" },
          {
            kind: "item.open",
            key: { channel: "compaction" },
            item: { type: "compaction" },
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
        return [
          ...flushOpenTurnWork(context, status),
          // Only a completed maintenance prompt actually shrank the context; a
          // failed or interrupted one must never report `thread/compacted`.
          ...(status === "completed"
            ? ([{ kind: "context.compacted" }] as ThreadDelta[])
            : []),
          {
            kind: "turn.boundary",
            status,
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
        return translateUpdate(params.data.update, context);
      }

      case ACP_FS_WRITE_METHOD: {
        const params = acpFsWriteNotificationParamsSchema.safeParse(
          envelope.data.params,
        );
        if (!params.success) {
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
        return unhandledDeltas(
          {
            jsonrpc: "2.0",
            method: envelope.data.method,
            ...(envelope.data.params ? { params: envelope.data.params } : {}),
          },
          context?.parentToolCallId,
        );
    }
  }

  /**
   * The latest merged tool_call event for an unsettled call. The permission
   * plane reads the in-flight `edit` call with the requested id as the
   * positive write signal for OpenCode's `external_directory` request, whose
   * own kind is the generic `other` (#1803).
   */
  function getMergedToolCall(
    threadId: string,
    toolCallId: string,
  ): AcpToolCallUpdateEvent | undefined {
    return mergedToolCalls.get(callKey({ threadId }, toolCallId));
  }

  return { getMergedToolCall, translateAcpEvent };
}

export type AcpDeltaTranslator = ReturnType<typeof createAcpDeltaTranslator>;
