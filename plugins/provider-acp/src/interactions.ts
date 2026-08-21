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

import {
  type PendingInteractionApprovalDecision,
  type PendingInteractionApprovalSubject,
  type PendingInteractionPayload,
  type PendingInteractionResolution,
  isApprovalPendingInteractionPayload,
  isApprovalPendingInteractionResolution,
} from "@get-bb/plugin-sdk/provider-bridge";
import { toolKindPresentation } from "./presentation.js";
import {
  type AcpToolCallOperation,
  type AcpToolCallOperationInput,
  classifyAcpToolCall as classifyAcpToolCallOperation,
  extractAcpToolCallPaths,
  resolveAcpFileChangeWriteScope,
} from "./tool-call-operation.js";
import {
  classifyAcpToolCall,
  type AcpInjectedTool,
} from "./tool-classification.js";
import type {
  AcpPermissionOptionKind,
  AcpToolCallUpdateEvent,
  AcpToolKind,
} from "./wire.js";

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
): AcpToolCallOperation {
  const own = classifyAcpToolCallOperation(toolCall);
  if (own.kind !== "generic" || !toolCall.startedToolCall) {
    return own;
  }
  return classifyAcpToolCallOperation(toolCall.startedToolCall);
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
  const own = classifyAcpToolCall(
    permissionToolCallEvent(toolCall),
    toolCall.injectedTool,
  );
  const described =
    own.presentation.title === undefined && toolCall.startedToolCall
      ? classifyAcpToolCall(toolCall.startedToolCall, toolCall.injectedTool)
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
    presentation: described.presentation,
  };
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
}): PendingInteractionPayload {
  const toolCall = args.toolCall;
  const availableDecisions = buildAcpApprovalDecisions(args.options);
  const operation = toolCall ? classifyAcpPermission(toolCall) : undefined;
  if (toolCall && operation?.kind === "file_change") {
    const ownPaths = extractAcpToolCallPaths(toolCall);
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
      reason: null,
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
      reason: null,
      availableDecisions,
    };
  }
  return {
    kind: "approval",
    subject: buildToolUseSubject(toolCall),
    reason: null,
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
