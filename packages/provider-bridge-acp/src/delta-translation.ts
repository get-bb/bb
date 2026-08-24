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

import { providerRawEventSchema } from "@bb/domain";
import type { ProviderRawEvent } from "@bb/domain";
import { COMPACTION_PRESENTATION, errorEnvelopeSchema, jsonRpcEnvelopeSchema, planStepsPresentation, presentationTitle } from "@bb/provider-bridge-protocol/bridge-kit";
import type { JsonRpcMessage, ProviderRuntimeEvent } from "@bb/provider-bridge-protocol/bridge-kit";
import type { ThreadEventItemStatus, ThreadEventPlanStep, ThreadEventTurnStatus } from "@bb/domain";
import type { DeltaItemShape, DeltaNoTurnFallback, ThreadDelta } from "@bb/provider-bridge-protocol";
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

/** Per-session translator configuration. */
export interface AcpDeltaTranslatorOptions {
  /**
   * The session's working directory: relative tool-call paths (grok's
   * `locations: [{path: "README.md"}]`) resolve against it, and it is the
   * `cwd` of every command item.
   */
  cwd?: string | undefined;
  /** The agent's dialect; generic when absent. */
  dialect?: AcpDialect | undefined;
}

/**
 * A permission request's `toolCall` as the bridge hands it to the translator
 * (`session/request_permission` carries a full ToolCallUpdate).
 */
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

/** The in-flight call a permission request was bound to. */
export interface AcpBoundPermissionToolCall {
  /** The id the approval subject joins: the in-flight call's, else its own. */
  toolCallId: string;
  /** The in-flight call after the permission's fields merged in, if bound. */
  event: AcpToolCallUpdateEvent | undefined;
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
  // A kind on the update replaces the started kind together with its raw
  // form: a known kind clears a stale `rawKind`, an unknown one carries its
  // own.
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

// ---------------------------------------------------------------------------
// Translator factory
// ---------------------------------------------------------------------------

/** An unsettled call in the merge cache. */
interface AcpOpenToolCall {
  /** The latest merged tool_call event. */
  event: AcpToolCallUpdateEvent;
  /**
   * The item type the call opened as. An update can re-classify the merged
   * event (grok's first update adds the kind), and only a call that opened
   * as a command streams output onto its row.
   */
  openedType: DeltaItemShape["type"];
  /**
   * A better headline a permission request revealed for a row that is
   * already open (see `notePermissionToolCall`).
   */
  permissionTitle?: string;
  /** What the agent's dialect reported about a delegated sub-agent. */
  delegation?: AcpDelegationReport;
}

export function createAcpDeltaTranslator(
  options: AcpDeltaTranslatorOptions = {},
) {
  const dialect = options.dialect ?? GENERIC_ACP_DIALECT;
  const pathOptions = { cwd: options.cwd };
  /**
   * The merge cache: latest merged tool_call event per unsettled call, in
   * insertion order (which decides turn-end settlement order), keyed
   * `${threadId} ${toolCallId}`.
   */
  const mergedToolCalls = new Map<string, AcpOpenToolCall>();

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
  ): [string, AcpOpenToolCall][] {
    const prefix = `${context?.threadId ?? ""} `;
    return [...mergedToolCalls.entries()].filter(([key]) =>
      key.startsWith(prefix),
    );
  }

  /**
   * A tool event with the dialect's identity folded in: an absent protocol
   * `kind` or `name` takes the dialect's answer (grok names and kinds every
   * call in `_meta` from the `tool_call` on), so the call opens as what it
   * is. A protocol value always wins.
   */
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

  /** Classify a call with its bb-tool binding, if it has one. */
  /**
   * Classify a call with its bb-tool binding, if it has one. The agent's own
   * dialect gets the first word — only it can know that a tool call is a
   * sub-agent, which version 1 of the protocol cannot express — and the
   * shared classifier decides everything else.
   */
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
    return classifyAcpToolCall(event, injected, pathOptions);
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
    /** A headline a permission revealed while the row was open. */
    permissionTitle?: string | undefined;
    /** A sub-agent report the dialect took off a vendor request. */
    delegation?: AcpDelegationReport | undefined;
    noTurnFallback?: DeltaNoTurnFallback;
  }

  /** The classified call with what a later report revealed, if anything. */
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

  /** The classified call with a permission's headline, when it had one. */
  function withPermissionTitle(
    classified: AcpClassifiedToolCall,
    permissionTitle: string | undefined,
  ): AcpClassifiedToolCall {
    const title =
      permissionTitle === undefined
        ? undefined
        : presentationTitle(permissionTitle);
    return title === undefined
      ? classified
      : {
          item: classified.item,
          presentation: { ...classified.presentation, title },
        };
  }

  /**
   * The terminal close for a (merged) tool_call event: carries the full
   * terminal shape plus the generic close fields; the assembler applies them
   * per item type. A command closes with the exit code and output the agent
   * reported in `rawOutput`; only a failed command that reported none falls
   * back to exit code 1 (see `commandCloseFields`), a completed one is never
   * given a fabricated `0`. Every other item closes with its output text as
   * `resultText`.
   */
  function toolCallClose(args: AcpCloseArgs): ThreadDelta {
    const classified = withPermissionTitle(
      withDelegationReport(
        classifyCall(args.context, args.event),
        args.delegation,
      ),
      args.permissionTitle,
    );
    injectedToolBindings.delete(callKey(args.context, args.event.toolCallId));
    const closeFields =
      classified.item.type === "command"
        ? commandCloseFields(args.event, args.status)
        : genericCloseFields(args.event);
    return {
      kind: "item.close",
      key: {
        providerItemId: args.event.toolCallId,
      },
      status: args.status,
      ...closeFields,
      item: classified.item,
      presentation: classified.presentation,
      ...(args.noTurnFallback ? { noTurnFallback: args.noTurnFallback } : {}),
    };
  }

  /**
   * ACP's status cannot stand in for an exit code: Cursor reports a command
   * that exited 1 AND a command that never spawned (its persistent shell's
   * cwd was deleted, #1529) as `status: "completed"`, so a completed command
   * that reported none closes without one rather than with a fabricated `0`.
   * A failed command that reported none is still non-zero (1).
   */
  function commandCloseFields(
    event: AcpToolCallUpdateEvent,
    status: ThreadEventItemStatus,
  ): Pick<
    Extract<ThreadDelta, { kind: "item.close" }>,
    "aggregatedOutput" | "exitCode" | "resultText"
  > {
    const result = extractAcpCommandResult(event);
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
    const outputText = extractAcpToolCallOutputText(event);
    return outputText === undefined ? {} : { resultText: outputText };
  }

  /** Settle every unsettled cached call (turn/compaction end), oldest first. */
  function drainOpenToolCalls(
    context: AcpDeltaTranslationContext | undefined,
    status: ThreadEventItemStatus,
  ): ThreadDelta[] {
    const deltas: ThreadDelta[] = [];
    for (const [key, open] of threadCallEntries(context)) {
      mergedToolCalls.delete(key);
      deltas.push(
        toolCallClose({
          context,
          event: open.event,
          status,
          permissionTitle: open.permissionTitle,
          delegation: open.delegation,
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
        const event = withDialectIdentity(parsed.data);
        // A tool call flushes both open streams before its item.
        const flush = [closeThoughtStream(), closeAssistantStream()];
        const announcedKey = callKey(context, event.toolCallId);
        const bound = bindAnnouncedCall(context, event);
        if (bound !== undefined) {
          injectedToolBindings.set(announcedKey, bound);
        }
        if (isTerminalAcpStatus(event.status)) {
          // Arrived already settled: close-without-open, no cache entry.
          return [
            ...flush,
            toolCallClose({
              context,
              event,
              status: mapAcpToolCallStatus(event.status),
              noTurnFallback: noTurnFallbackFor(rawEvent),
            }),
          ];
        }
        const classified = classifyCall(context, event);
        mergedToolCalls.set(announcedKey, {
          event,
          openedType: classified.item.type,
        });
        return [
          ...flush,
          {
            kind: "item.open",
            key: {
              providerItemId: event.toolCallId,
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
        const event = withDialectIdentity(parsed.data);
        const key = callKey(context, event.toolCallId);
        const open = mergedToolCalls.get(key);
        const merged = mergeAcpToolCallEvents(open?.event, event);
        if (isTerminalAcpStatus(merged.status)) {
          mergedToolCalls.delete(key);
          return [
            toolCallClose({
              context,
              event: merged,
              status: mapAcpToolCallStatus(merged.status),
              permissionTitle: open?.permissionTitle,
              delegation: open?.delegation,
              noTurnFallback: noTurnFallbackFor(rawEvent),
            }),
          ];
        }
        const mergedType = classifyCall(context, merged).item.type;
        mergedToolCalls.set(key, {
          event: merged,
          openedType: open?.openedType ?? mergedType,
          ...(open?.permissionTitle === undefined
            ? {}
            : { permissionTitle: open.permissionTitle }),
          ...(open?.delegation === undefined
            ? {}
            : { delegation: open.delegation }),
        });
        // An in-progress update on a running command carries the output so
        // far (grok streams cumulative stdout, with tail-window resets): a
        // cumulative snapshot the assembler diffs onto the row. It is the
        // command's own output: its `content` text or the streams the agent
        // reported, never the rawOutput envelope rendered as JSON, which
        // mid-flight also carries an exit code the command has not reached. Output that
        // arrives with no turn open belongs to a command the turn end
        // already settled, so it has no row to land on and is dropped.
        if (
          event.status === "in_progress" &&
          mergedType === "command" &&
          open?.openedType === "command"
        ) {
          const streamed = extractAcpStreamedCommandOutput(event);
          return streamed === undefined
            ? suppressedUnhandled(rawEvent)
            : [
                {
                  kind: "command.outputSnapshot",
                  key: { providerItemId: event.toolCallId },
                  text: streamed,
                },
              ];
        }
        const progressText = extractAcpToolCallOutputText(event);
        if (progressText === undefined) {
          return suppressedUnhandled(rawEvent);
        }
        // Commands and file changes settle with their output at the close;
        // every other item streams its progress text.
        if (mergedType !== "command" && mergedType !== "fileChange") {
          return [
            {
              kind: "item.progress",
              key: {
                providerItemId: event.toolCallId,
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
   * A `session/request_permission` carries a full ToolCallUpdate, and it is
   * sometimes the richest description of the call the agent ever sends
   * (Cursor titles its fetch permission "Fetch https://…" while the
   * tool_call said "Web Fetch" with an empty rawInput). Bind it to the
   * in-flight call it describes: the call with the same id, else — Cursor
   * asks under its own id (`web_fetch_0`) — the single in-flight call of the
   * same kind, the positional rule bb-injected tools already use.
   *
   * The merge is additive and never re-shapes an open row. A call that
   * already has a core shape keeps its own description (opencode's
   * `external_directory` ask rides the running `edit` call's id with kind
   * `other` and a bare directory title, #1719). A generic row takes the
   * permission's fields, but if they would classify it as another shape the
   * row keeps the shape it opened with and takes only the headline: a row
   * that opens as one kind and settles as another is two rows in the
   * timeline, which is worse than a generic row that names its URL.
   */
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
    // The approval still describes what the permission asked about.
    return { toolCallId: open.event.toolCallId, event: merged };
  }

  /**
   * A sub-agent the agent's dialect reported (Cursor's `cursor/task`). It
   * arrives on a vendor request rather than a session update, and Cursor
   * sends it once the sub-agent has already finished, so it enriches the
   * delegation row while the row is still open and is otherwise a no-op:
   * re-opening a settled row would show the same work twice.
   */
  function noteDelegationReport(
    threadId: string,
    report: AcpDelegationReport,
  ): ThreadDelta[] {
    const context = { threadId };
    const key = callKey(context, report.toolCallId);
    const open = mergedToolCalls.get(key);
    if (open === undefined) {
      return [];
    }
    const classified = classifyCall(context, open.event);
    if (classified.item.type !== "delegation") {
      return [];
    }
    const item: DeltaItemShape = {
      ...classified.item,
      childRef: report.childRef,
      label: report.label,
    };
    mergedToolCalls.set(key, { ...open, delegation: report });
    return [
      {
        kind: "item.open",
        key: { providerItemId: report.toolCallId },
        item,
        presentation: delegationPresentation({
          label: report.label,
          ...(report.detail === undefined ? {} : { detail: report.detail }),
        }),
      },
    ];
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
    noteDelegationReport,
    noteInjectedToolCall,
    notePermissionToolCall,
    translateAcpEvent,
  };
}

export type AcpDeltaTranslator = ReturnType<typeof createAcpDeltaTranslator>;
