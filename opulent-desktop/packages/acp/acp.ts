/**
 * ACP → Opulent event translation.
 *
 * This is the layer that makes "local ACP composability" real: opencode, Devin CLI and
 * Cursor all speak the Agent Client Protocol over stdio JSON-RPC, so one translator
 * covers every current and future ACP agent. It follows bb's doctrine ([S3]): the
 * bridge knows the dialect, the runtime knows the timeline. Nothing here mints ids or
 * decides ordering — it maps one ACP notification to zero or more `AgentEvent`s and
 * lets the journal own `seq`.
 *
 * Types are transcribed from the published v1 schema, not inferred:
 *   - message flow / methods            https://agentclientprotocol.com/protocol/v1/overview
 *   - initialize + capabilities         https://agentclientprotocol.com/protocol/v1/initialization
 *   - session/update + stop reasons     https://agentclientprotocol.com/protocol/v1/prompt-turn
 *   - SessionUpdate, ToolKind, StopReason, ToolCallStatus
 *                                       https://agentclientprotocol.com/protocol/v1/schema
 * See EVIDENCE.md [S29].
 */

import type { AgentEvent, DoneStatus, ToolCall } from "../events/events.ts";

// ---------------------------------------------------------------------------
// Protocol types (subset we consume), verbatim from the v1 schema
// ---------------------------------------------------------------------------

/** ACP `protocolVersion` is a single integer naming a MAJOR version. */
export const ACP_PROTOCOL_VERSION = 1;

/** Union member names of the schema's `ToolKind`. */
export type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

/** Union member names of the schema's `StopReason`. */
export type StopReason =
  | "end_turn"
  | "max_tokens"
  | "max_turn_requests"
  | "refusal"
  | "cancelled";

export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export interface TextContentBlock {
  readonly type: "text";
  readonly text: string;
}

export interface OtherContentBlock {
  readonly type: "image" | "audio" | "resource" | "resource_link";
  readonly [key: string]: unknown;
}

export type ContentBlock = TextContentBlock | OtherContentBlock;

export interface PlanEntry {
  readonly content: string;
  readonly priority?: "high" | "medium" | "low";
  readonly status?: "pending" | "in_progress" | "completed";
}

/**
 * The `update` payload of a `session/update` notification, discriminated on
 * `sessionUpdate`. Only the variants Opulent renders or records are modelled; the
 * catch-all keeps unknown future variants parseable instead of throwing.
 */
export type SessionUpdate =
  | { readonly sessionUpdate: "user_message_chunk"; readonly content: ContentBlock; readonly messageId?: string }
  | { readonly sessionUpdate: "agent_message_chunk"; readonly content: ContentBlock; readonly messageId?: string }
  | { readonly sessionUpdate: "agent_thought_chunk"; readonly content: ContentBlock; readonly messageId?: string }
  | {
      readonly sessionUpdate: "tool_call";
      readonly toolCallId: string;
      readonly title: string;
      readonly kind?: ToolKind;
      readonly status?: ToolCallStatus;
      readonly rawInput?: Record<string, unknown>;
    }
  | {
      readonly sessionUpdate: "tool_call_update";
      readonly toolCallId: string;
      readonly status?: ToolCallStatus;
      readonly title?: string;
      readonly kind?: ToolKind;
      readonly rawOutput?: Record<string, unknown>;
    }
  | { readonly sessionUpdate: "plan"; readonly entries: readonly PlanEntry[] }
  | {
      readonly sessionUpdate: "usage_update";
      readonly used: number;
      readonly size: number;
      readonly cost?: { readonly amount: number; readonly currency: string };
    }
  | { readonly sessionUpdate: "available_commands_update"; readonly availableCommands: readonly unknown[] }
  | { readonly sessionUpdate: "current_mode_update"; readonly currentModeId: string }
  | { readonly sessionUpdate: string };

export interface SessionNotification {
  readonly sessionId: string;
  readonly update: SessionUpdate;
}

// ---------------------------------------------------------------------------
// Tool-call mapping
// ---------------------------------------------------------------------------

/**
 * Best-effort structural decode of an ACP tool call into Opulent's `ToolCall`.
 *
 * ACP deliberately does not standardize tool *names* — only `kind` (a UI hint) and a
 * free-form `rawInput`. So we read `rawInput` when its shape is unambiguous and fall
 * back to `unknown`, which preserves the name and payload rather than guessing. A wrong
 * structural guess would corrupt the transcript and any trajectory derived from it;
 * `unknown` is honest and still renders.
 */
export function decodeToolCall(
  title: string,
  kind: ToolKind | undefined,
  rawInput: Record<string, unknown> | undefined,
): ToolCall {
  const input = rawInput ?? {};
  const str = (key: string): string | undefined =>
    typeof input[key] === "string" ? (input[key] as string) : undefined;

  const path = str("path") ?? str("file_path") ?? str("filePath");
  const command = str("command") ?? str("cmd");
  const pattern = str("pattern") ?? str("query");
  const url = str("url");

  switch (kind) {
    case "execute":
      if (command !== undefined) return { kind: "exec", command };
      break;
    case "read":
      if (path !== undefined) return { kind: "readFile", path };
      break;
    case "edit":
      if (path !== undefined) {
        const oldString = str("old_string") ?? str("oldString");
        const newString = str("new_string") ?? str("newString");
        const content = str("content");
        if (oldString !== undefined || newString !== undefined) {
          return {
            kind: "editFile",
            path,
            ...(oldString === undefined ? {} : { oldString }),
            ...(newString === undefined ? {} : { newString }),
          };
        }
        return { kind: "writeFile", path, ...(content === undefined ? {} : { content }) };
      }
      break;
    case "search":
      if (pattern !== undefined) {
        return { kind: "search", pattern, ...(path === undefined ? {} : { path }) };
      }
      break;
    case "fetch":
      if (url !== undefined) {
        const prompt = str("prompt");
        return { kind: "webFetch", url, ...(prompt === undefined ? {} : { prompt }) };
      }
      break;
    default:
      break;
  }

  return { kind: "unknown", name: title, ...(rawInput === undefined ? {} : { input: rawInput }) };
}

/**
 * Map an ACP `StopReason` onto Opulent's `DoneStatus`.
 *
 * `end_turn` is the only clean success. `cancelled` is the client's own interrupt.
 * `max_tokens`, `max_turn_requests` and `refusal` are all truncated turns: the agent
 * stopped before finishing the work, so they are `errored`, never `completed`. This
 * mirrors the SkyRL recipe's treatment of a length-truncated turn as an incomplete
 * trajectory that must not be rewarded ([S23]).
 */
export function stopReasonToStatus(reason: StopReason): DoneStatus {
  switch (reason) {
    case "end_turn":
      return "completed";
    case "cancelled":
      return "interrupted";
    case "max_tokens":
    case "max_turn_requests":
    case "refusal":
      return "errored";
  }
}

/** True when the stop reason means the turn did not finish its work. */
export function isTruncatedStop(reason: StopReason): boolean {
  return reason === "max_tokens" || reason === "max_turn_requests" || reason === "refusal";
}

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

function textOf(content: ContentBlock): string | null {
  return content.type === "text" ? content.text : null;
}

/**
 * Per-session translation state.
 *
 * ACP reports a tool call and its completion as two independent notifications keyed by
 * `toolCallId`, and reports `pending` → `in_progress` → terminal. We emit exactly one
 * `toolCall` on first sight and exactly one `toolResult` on the terminal status, so an
 * agent that sends a redundant update cannot double-count in the transcript or in the
 * tool metrics a trajectory reports.
 */
export class AcpTranslator {
  readonly #seen = new Set<string>();
  readonly #settled = new Set<string>();

  /** Translate one `session/update` notification into zero or more events. */
  translate(notification: SessionNotification): AgentEvent[] {
    const update = notification.update;

    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const text = textOf((update as { content: ContentBlock }).content);
        return text === null || text === "" ? [] : [{ type: "textDelta", text }];
      }

      case "agent_thought_chunk": {
        const text = textOf((update as { content: ContentBlock }).content);
        return text === null || text === "" ? [] : [{ type: "reasoningDelta", text }];
      }

      case "tool_call": {
        const u = update as Extract<SessionUpdate, { sessionUpdate: "tool_call" }>;
        const events: AgentEvent[] = [];
        if (!this.#seen.has(u.toolCallId)) {
          this.#seen.add(u.toolCallId);
          events.push({
            type: "toolCall",
            id: u.toolCallId,
            call: decodeToolCall(u.title, u.kind, u.rawInput),
          });
        }
        // An agent may open a tool call already in its terminal state.
        events.push(...this.#settle(u.toolCallId, u.status));
        return events;
      }

      case "tool_call_update": {
        const u = update as Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>;
        return this.#settle(u.toolCallId, u.status);
      }

      case "plan": {
        const u = update as Extract<SessionUpdate, { sessionUpdate: "plan" }>;
        return [
          {
            type: "toolCall",
            id: `plan-${this.#seen.size}`,
            call: {
              kind: "todo",
              items: u.entries.map((entry) => ({
                text: entry.content,
                done: entry.status === "completed",
              })),
            },
          },
        ];
      }

      case "usage_update": {
        const u = update as Extract<SessionUpdate, { sessionUpdate: "usage_update" }>;
        // ACP reports context occupancy (`used` of `size`), not the input/output split
        // a billing meter wants. Record `used` as input and leave output at 0 rather
        // than inventing a split the protocol never sent.
        return [{ type: "usage", inputTokens: u.used, outputTokens: 0 }];
      }

      default:
        // user_message_chunk is already in the transcript (we sent it);
        // available_commands_update / current_mode_update / unknown future variants
        // are UI state, not timeline events.
        return [];
    }
  }

  /** Close the turn from the `session/prompt` response. */
  finish(reason: StopReason, sessionId?: string): AgentEvent {
    const status = stopReasonToStatus(reason);
    return {
      type: "done",
      status,
      ...(isTruncatedStop(reason) ? { error: `turn truncated: ${reason}` } : {}),
      ...(sessionId === undefined ? {} : { sessionId }),
    };
  }

  #settle(toolCallId: string, status: ToolCallStatus | undefined): AgentEvent[] {
    if (status !== "completed" && status !== "failed") return [];
    if (this.#settled.has(toolCallId)) return [];
    this.#settled.add(toolCallId);
    return [{ type: "toolResult", id: toolCallId, isError: status === "failed" }];
  }
}
