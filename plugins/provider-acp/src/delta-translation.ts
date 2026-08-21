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
  jsonRpcEnvelopeSchema,
  providerRawEventSchema,
  type JsonRpcMessage,
  type ProviderRawEvent,
  type ProviderRuntimeEvent,
} from "@get-bb/plugin-sdk/provider-bridge";
import type {
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
  COMPACTION_PRESENTATION,
  fileChangePresentation,
  planStepsPresentation,
} from "./presentation.js";
import {
  classifyAcpToolCall,
  extractAcpToolCallOutputText,
  isInjectedToolCandidate,
  type AcpClassifiedToolCall,
  type AcpInjectedTool,
} from "./tool-classification.js";
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
 * bb thread id).
 */
interface AcpDeltaTranslationContext {
  threadId?: string;
}

const ASSISTANT_STREAM_KEY = "assistant";
const THOUGHT_STREAM_KEY = "thought";
const ACP_PLAN_STEP_STATUS_BY_ENTRY_STATUS = {
  pending: "pending",
  in_progress: "active",
  completed: "completed",
} as const;

/** Each ACP plan snapshot is its own settled item; the latest supersedes. */
const PLAN_STEPS_CHANNEL = "planSteps";

// ---------------------------------------------------------------------------
// Pure ACP parsing helpers
// ---------------------------------------------------------------------------

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

  /**
   * The bb-injected tools of the session, by name. One translator lives per
   * session, so the set is session-wide.
   */
  let injectedToolsByName = new Map<string, AcpInjectedTool>();
  /** The bb tool each unsettled call is bound to, by call key. */
  const injectedToolBindings = new Map<string, AcpInjectedTool>();
  /**
   * bb tool calls the MCP proxy forwarded before the agent announced a
   * matching tool_call, per thread, oldest first.
   */
  const pendingInjectedCalls = new Map<string, AcpInjectedTool[]>();

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
      injectedToolBindings.delete(key);
    }
    pendingInjectedCalls.delete(context?.threadId ?? "");
  }

  // -------------------------------------------------------------------------
  // bb-injected tools (Q31)
  // -------------------------------------------------------------------------

  function configureInjectedTools(tools: readonly AcpInjectedTool[]): void {
    injectedToolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  }

  /** The injected tool a call's title names outright, if any. */
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

  /**
   * Bind a freshly announced tool_call to a bb tool: the one its title names,
   * else the oldest proxied call still waiting for its announcement.
   */
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

  /**
   * The MCP proxy forwarded a call to bb tool `tool` for this thread. ACP
   * gives the bridge no id that links the proxied call to the agent's own
   * tool_call (Cursor announces every MCP call as "MCP: tool", kind `other`),
   * so the binding is positional: the unbound candidate whose title names the
   * tool, else the unbound candidate that mentions MCP, else the oldest
   * unbound candidate — agents announce parallel calls in the order they run
   * them. With no candidate open, the call waits for the next announcement.
   */
  function noteInjectedToolCall(threadId: string, toolName: string): void {
    const tool = injectedToolsByName.get(toolName) ?? { name: toolName };
    const candidates = threadCallEntries({ threadId }).filter(
      ([key, event]) =>
        !injectedToolBindings.has(key) && isInjectedToolCandidate(event),
    );
    const chosen =
      candidates.find(([, event]) => event.title?.includes(tool.name)) ??
      candidates.find(([, event]) => /\bmcp\b/i.test(event.title ?? "")) ??
      candidates[0];
    if (chosen !== undefined) {
      injectedToolBindings.set(chosen[0], tool);
      return;
    }
    const queue = pendingInjectedCalls.get(threadId) ?? [];
    queue.push(tool);
    pendingInjectedCalls.set(threadId, queue);
  }

  /** Classify a call with its bb-tool binding, if it has one. */
  function classifyCall(
    context: AcpDeltaTranslationContext | undefined,
    event: AcpToolCallUpdateEvent,
  ): AcpClassifiedToolCall {
    return classifyAcpToolCall(
      event,
      injectedToolBindings.get(callKey(context, event.toolCallId)),
    );
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

  /** Visibility classification: only unknown coverage becomes an `unhandled`. */
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

  // -------------------------------------------------------------------------
  // Flush triggers (provider policy: thought/message streams settle when the
  // next message chunk / tool call / turn end arrives)
  // -------------------------------------------------------------------------

  function closeThoughtStream(): ThreadDelta {
    return {
      kind: "item.textClose",
      key: { channel: THOUGHT_STREAM_KEY },
      channel: "reasoningText",
    };
  }

  function closeAssistantStream(): ThreadDelta {
    return {
      kind: "item.textClose",
      key: { channel: ASSISTANT_STREAM_KEY },
      channel: "agentMessage",
    };
  }

  // -------------------------------------------------------------------------
  // Tool-call closes
  // -------------------------------------------------------------------------

  interface AcpCloseArgs {
    context: AcpDeltaTranslationContext | undefined;
    event: AcpToolCallUpdateEvent;
    status: ThreadEventItemStatus;
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
    const classified = classifyCall(args.context, args.event);
    injectedToolBindings.delete(callKey(args.context, args.event.toolCallId));
    return {
      kind: "item.close",
      key: {
        providerItemId: args.event.toolCallId,
      },
      status: args.status,
      ...(outputText === undefined
        ? {}
        : { resultText: outputText, aggregatedOutput: outputText }),
      ...(terminal ? { exitCode: args.status === "failed" ? 1 : 0 } : {}),
      item: classified.item,
      presentation: classified.presentation,
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
          context,
          event,
          status,
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
    return [
      closeThoughtStream(),
      closeAssistantStream(),
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
    const rawEvent = updateEnvelope(context, update);

    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const parsed = acpAgentMessageChunkUpdateSchema.safeParse(update);
        const text = parsed.success
          ? extractAcpContentText(parsed.data.content)
          : undefined;
        if (text === undefined) {
          return suppressedUnhandled(rawEvent);
        }
        // A message chunk flushes the open thought stream first.
        return [
          closeThoughtStream(),
          {
            kind: "item.textDelta",
            key: { channel: ASSISTANT_STREAM_KEY },
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
            key: { channel: THOUGHT_STREAM_KEY },
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
        // A tool call flushes both open streams before its item.
        const flush = [closeThoughtStream(), closeAssistantStream()];
        const announcedKey = callKey(context, parsed.data.toolCallId);
        const bound = bindAnnouncedCall(context, parsed.data);
        if (bound !== undefined) {
          injectedToolBindings.set(announcedKey, bound);
        }
        if (isTerminalAcpStatus(parsed.data.status)) {
          // Arrived already settled: close-without-open, no cache entry.
          return [
            ...flush,
            toolCallClose({
              context,
              event: parsed.data,
              status: mapAcpToolCallStatus(parsed.data.status),
              noTurnFallback: noTurnFallbackFor(rawEvent),
            }),
          ];
        }
        mergedToolCalls.set(announcedKey, parsed.data);
        const classified = classifyCall(context, parsed.data);
        return [
          ...flush,
          {
            kind: "item.open",
            key: {
              providerItemId: parsed.data.toolCallId,
            },
            item: classified.item,
            presentation: classified.presentation,
            noTurnFallback: noTurnFallbackFor(rawEvent),
          },
        ];
      }

      case "tool_call_update": {
        const parsed = acpToolCallUpdateEventSchema.safeParse(update);
        if (!parsed.success) {
          return suppressedUnhandled(rawEvent);
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
              context,
              event: merged,
              status: mapAcpToolCallStatus(merged.status),
              noTurnFallback: noTurnFallbackFor(rawEvent),
            }),
          ];
        }
        mergedToolCalls.set(key, merged);
        const progressText = extractAcpToolCallOutputText(parsed.data);
        // Commands and file changes settle with their output at the close;
        // every other item streams its progress text.
        const progressItemType = classifyCall(context, merged).item.type;
        if (
          progressText &&
          progressItemType !== "command" &&
          progressItemType !== "fileChange"
        ) {
          return [
            {
              kind: "item.progress",
              key: {
                providerItemId: parsed.data.toolCallId,
              },
              message: progressText,
              noTurnFallback: noTurnFallbackFor(rawEvent),
            },
          ];
        }
        return suppressedUnhandled(rawEvent);
      }

      case "plan": {
        const parsed = acpPlanUpdateSchema.safeParse(update);
        if (!parsed.success) {
          return suppressedUnhandled(rawEvent);
        }
        // An ACP plan update carries the whole entry list, so each one is a
        // settled `planSteps` snapshot (grammar v3): a channel-keyed close
        // mints a fresh item per snapshot and the latest supersedes the rest.
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
            key: { channel: PLAN_STEPS_CHANNEL },
            status: "completed",
            item: { type: "planSteps", steps },
            presentation: planStepsPresentation(steps),
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
        return unhandledDeltas(rawEvent);
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

  /** The bb tool an unsettled call is bound to (Q31), for its permission. */
  function getInjectedToolBinding(
    threadId: string,
    toolCallId: string,
  ): AcpInjectedTool | undefined {
    return injectedToolBindings.get(callKey({ threadId }, toolCallId));
  }

  return {
    configureInjectedTools,
    getInjectedToolBinding,
    getMergedToolCall,
    noteInjectedToolCall,
    translateAcpEvent,
  };
}

export type AcpDeltaTranslator = ReturnType<typeof createAcpDeltaTranslator>;
