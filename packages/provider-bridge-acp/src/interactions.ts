/**
 * ACP permission-request ↔ canonical pending-interaction mapping.
 *
 * Maps the ACP bridge's permission requests onto the canonical
 * `PendingInteractionPayload`/`PendingInteractionResolution` shapes from
 * `@bb/domain`, in both directions. A command asks as a `command` subject, a
 * file change as a `file_change` subject, and everything else — an MCP tool,
 * a read outside the project, a kind with no core shape — as a `tool_use`
 * subject carrying the same presentation its timeline row does.
 */

import { isApprovalPendingInteractionPayload, isApprovalPendingInteractionResolution } from "@bb/domain";
import type { PendingInteractionApprovalDecision, PendingInteractionApprovalSubject, PendingInteractionPayload, PendingInteractionResolution } from "@bb/domain";
import { toolKindPresentation } from "./presentation.js";
import {
  type AcpToolCallOperation,
  type AcpToolCallOperationInput,
  type AcpToolCallPathOptions,
  classifyAcpToolCall as classifyAcpToolCallOperation,
  extractAcpToolCallPaths,
  resolveAcpFileChangeWriteScope,
} from "./tool-call-operation.js";
import {
  classifyAcpToolCall,
  extractAcpToolCallOutputText,
  type AcpInjectedTool,
} from "./tool-classification.js";
import type {
  AcpPermissionOptionKind,
  AcpToolCallUpdateEvent,
  AcpToolKind,
} from "./wire.js";
import type { AcpDialect } from "./dialect.js";

/**
 * The agent's dialect-specific classification, when its vendor side channel
 * says what the protocol fields cannot (a Cursor sub-agent is a `kind:
 * "other"` call whose rawInput names the `task` tool). The permission path
 * consults it the way the timeline does, so the ask and the row read alike.
 */
type AcpDialectToolCallClassifier = NonNullable<AcpDialect["classifyToolCall"]>;

type ToolUseApprovalSubject = Extract<
  PendingInteractionApprovalSubject,
  { kind: "tool_use" }
>;

/**
 * The bridge maps the user's decision back onto the ACP options it kept for
 * the pending permission request.
 */
interface AcpPermissionResponse {
  decision: "allow_once" | "allow_for_session" | "deny";
}

interface AcpPermissionToolCall extends AcpToolCallOperationInput {
  toolCallId: string;
  kind?: AcpToolKind | undefined;
  rawKind?: string | undefined;
  /**
   * The in-flight `tool_call` with the same id, when the agent started one
   * before it asked. opencode's `external_directory` permission (a write
   * outside the project) arrives as the generic kind `other` with a bare
   * directory title; the running `edit` tool call is the write signal.
   */
  startedToolCall?: AcpToolCallUpdateEvent | undefined;
  /** The bb-injected tool the in-flight call is bound to, if any (Q31). */
  injectedTool?: AcpInjectedTool | undefined;
}

/**
 * The operation an ACP permission asks about: the permission's own tool call
 * when it classifies, else the in-flight tool call it belongs to.
 */
function classifyAcpPermission(
  toolCall: AcpPermissionToolCall,
  options: AcpToolCallPathOptions | undefined,
): AcpToolCallOperation {
  const own = classifyAcpToolCallOperation(toolCall, options);
  if (own.kind !== "generic" || !toolCall.startedToolCall) {
    return own;
  }
  return classifyAcpToolCallOperation(toolCall.startedToolCall, options);
}

/** The permission's own tool call as the translator's event shape. */
function permissionToolCallEvent(
  toolCall: AcpPermissionToolCall,
): AcpToolCallUpdateEvent {
  return {
    sessionUpdate: "tool_call",
    toolCallId: toolCall.toolCallId,
    ...(toolCall.title !== undefined ? { title: toolCall.title } : {}),
    ...(toolCall.kind !== undefined ? { kind: toolCall.kind } : {}),
    ...(toolCall.rawKind !== undefined ? { rawKind: toolCall.rawKind } : {}),
    ...(toolCall.content !== undefined
      ? { content: [...toolCall.content] }
      : {}),
    ...(toolCall.locations !== undefined
      ? { locations: [...toolCall.locations] }
      : {}),
    ...(toolCall.rawInput !== undefined ? { rawInput: toolCall.rawInput } : {}),
  };
}

/**
 * The `tool_use` subject for a permission that is neither a command nor a
 * file change: the same classification the timeline row gets, so the banner
 * and the row read alike. The permission's own tool call describes the ask;
 * when it carries no title the in-flight call it belongs to supplies one. A
 * request with no tool call at all still yields a grantable subject.
 */
function buildToolUseSubject(
  toolCall: AcpPermissionToolCall | undefined,
  options: AcpToolCallPathOptions | undefined,
  dialectClassify: AcpDialectToolCallClassifier | undefined,
): ToolUseApprovalSubject {
  if (toolCall === undefined) {
    return {
      kind: "tool_use",
      itemId: "acp-permission",
      tool: "tool",
      presentation: toolKindPresentation({
        kind: undefined,
        title: "ACP permission request",
      }),
    };
  }
  // A call bound to a bb-injected tool reads as that tool; otherwise the
  // dialect speaks first, then the shared classifier (delta-translation's
  // `classifyCall` makes the same choice for the row).
  const classify = (event: AcpToolCallUpdateEvent) =>
    (toolCall.injectedTool === undefined
      ? dialectClassify?.(event)
      : undefined) ?? classifyAcpToolCall(event, toolCall.injectedTool, options);
  const own = classify(permissionToolCallEvent(toolCall));
  const described =
    own.presentation.title === undefined && toolCall.startedToolCall
      ? classify(toolCall.startedToolCall)
      : own;
  return {
    kind: "tool_use",
    itemId: toolCall.toolCallId,
    tool:
      described.item.type === "tool"
        ? described.item.tool
        : (toolCall.kind ??
          toolCall.startedToolCall?.kind ??
          described.item.type),
    // The reason is NOT stamped here. It rides the payload, where every
    // surface reads it as the ask's title (`payload.reason ?? …`), while
    // `presentation.detail` becomes a detail line beneath — so stamping it
    // into both printed the agent's sentence twice on the app, mobile and
    // the CLI. `detail` keeps only what the classification found that the
    // reason does not already say (a delegation's report, say).
    presentation: described.presentation,
  };
}

/**
 * The agent's stated reason for asking: the permission tool call's `content`
 * text (Cursor: "Not in allowlist: node"). It is the ask's explanation, not
 * the call's output.
 */
function permissionReason(
  toolCall: AcpPermissionToolCall | undefined,
): string | undefined {
  if (toolCall === undefined || toolCall.content === undefined) {
    return undefined;
  }
  return extractAcpToolCallOutputText({
    sessionUpdate: "tool_call",
    toolCallId: toolCall.toolCallId,
    content: [...toolCall.content],
  });
}

export function buildAcpApprovalDecisions(
  options: readonly { kind: AcpPermissionOptionKind }[],
): PendingInteractionApprovalDecision[] {
  const kinds = new Set(options.map((option) => option.kind));
  const decisions: PendingInteractionApprovalDecision[] = [];
  if (kinds.has("allow_once")) {
    decisions.push("allow_once");
  }
  if (kinds.has("allow_always")) {
    decisions.push("allow_for_session");
  }
  if (kinds.has("reject_once") || kinds.has("reject_always")) {
    decisions.push("deny");
  }
  // An options list with a single odd kind still needs one decision; fall back
  // to deny so the runtime's auto-deny policy can always settle the request.
  return decisions.length > 0 ? decisions : ["deny"];
}

/** The canonical approval payload for an ACP `session/request_permission`. */
export function buildAcpPermissionInteractionPayload(args: {
  toolCall: AcpPermissionToolCall | undefined;
  options: readonly { kind: AcpPermissionOptionKind }[];
  /** The session cwd relative tool-call paths resolve against. */
  cwd?: string | undefined;
  /** The agent dialect's own tool-call classification, if it has one. */
  classifyToolCall?: AcpDialectToolCallClassifier | undefined;
}): PendingInteractionPayload {
  const toolCall = args.toolCall;
  const pathOptions = { cwd: args.cwd };
  const availableDecisions = buildAcpApprovalDecisions(args.options);
  const reason = permissionReason(toolCall) ?? null;
  const operation = toolCall
    ? classifyAcpPermission(toolCall, pathOptions)
    : undefined;
  if (toolCall && operation?.kind === "file_change") {
    const ownPaths = extractAcpToolCallPaths(toolCall, pathOptions);
    return {
      kind: "approval",
      subject: {
        kind: "file_change",
        itemId: toolCall.toolCallId,
        // The permission's own locations bound the write (opencode's
        // external_directory names [file, parentDir]); the in-flight tool
        // call's paths are the fallback.
        writeScope: resolveAcpFileChangeWriteScope(
          ownPaths.length > 0 ? ownPaths : operation.paths,
        ),
        sessionGrant: null,
      },
      reason,
      availableDecisions,
    };
  }
  if (toolCall && operation?.kind === "command") {
    return {
      kind: "approval",
      subject: {
        kind: "command",
        itemId: toolCall.toolCallId,
        command: operation.command,
        cwd: null,
        actions: [{ type: "unknown", command: operation.command }],
        sessionGrant: null,
      },
      reason,
      availableDecisions,
    };
  }
  return {
    kind: "approval",
    subject: buildToolUseSubject(toolCall, pathOptions, args.classifyToolCall),
    reason,
    availableDecisions,
  };
}

/**
 * Map a canonical resolution back onto the ACP decision. Null when the
 * resolution kind does not match the approval payload, which the bridge turns
 * into a cancelled permission.
 */
export function resolveAcpPermissionDecision(args: {
  payload: PendingInteractionPayload;
  resolution: PendingInteractionResolution;
}): AcpPermissionResponse | null {
  if (
    !isApprovalPendingInteractionPayload(args.payload) ||
    !isApprovalPendingInteractionResolution(args.resolution)
  ) {
    return null;
  }
  return { decision: args.resolution.decision };
}
