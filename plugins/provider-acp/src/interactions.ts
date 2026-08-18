/**
 * ACP permission-request ↔ canonical pending-interaction mapping.
 *
 * Maps the ACP bridge's permission requests onto the canonical
 * `PendingInteractionPayload`/`PendingInteractionResolution` shapes from
 * `@bb/domain`. Extracted from the ACP adapter so the adapter (legacy
 * dialect) and the bridge's canonical `interaction/request` path share one
 * mapping in both directions.
 */

import {
  type PendingInteractionApprovalDecision,
  type PendingInteractionPayload,
  type PendingInteractionResolution,
  isApprovalPendingInteractionPayload,
  isApprovalPendingInteractionResolution,
} from "@get-bb/plugin-sdk/provider-bridge";
import {
  type AcpToolCallOperation,
  type AcpToolCallOperationInput,
  classifyAcpToolCall,
  extractAcpCommand,
  extractAcpToolCallPaths,
  resolveAcpFileChangeWriteScope,
} from "./tool-call-operation.js";
import type { AcpPermissionOptionKind } from "./wire.js";

/**
 * The bridge maps the user's decision back onto the ACP options it kept for
 * the pending permission request.
 */
export interface AcpPermissionResponse {
  decision: "allow_once" | "allow_for_session" | "deny";
}

export interface AcpPermissionToolCall extends AcpToolCallOperationInput {
  toolCallId: string;
  /**
   * The in-flight `tool_call` with the same id, when the agent started one
   * before it asked. opencode's `external_directory` permission (a write
   * outside the project) arrives as the generic kind `other` with a bare
   * directory title; the running `edit` tool call is the write signal.
   */
  startedToolCall?: AcpToolCallOperationInput | undefined;
}

/**
 * The operation an ACP permission asks about: the permission's own tool call
 * when it classifies, else the in-flight tool call it belongs to.
 */
function classifyAcpPermission(
  toolCall: AcpPermissionToolCall,
): AcpToolCallOperation {
  const own = classifyAcpToolCall(toolCall);
  if (own.kind !== "generic" || !toolCall.startedToolCall) {
    return own;
  }
  return classifyAcpToolCall(toolCall.startedToolCall);
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

function buildOpaqueAcpPermissionCommand(
  toolCall: AcpPermissionToolCall,
): string {
  return (
    extractAcpCommand(toolCall) ?? toolCall.kind ?? "ACP permission request"
  );
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
  // Commands and generic tools both take the command subject: it is the one
  // canonical subject that carries free text, and the fallback chain
  // command → title → kind → fixed text always yields a grantable subject.
  const command =
    operation?.kind === "command"
      ? operation.command
      : toolCall
        ? buildOpaqueAcpPermissionCommand(toolCall)
        : "ACP permission request";
  return {
    kind: "approval",
    subject: {
      kind: "command",
      itemId: toolCall?.toolCallId ?? "acp-permission",
      command,
      cwd: null,
      actions: [{ type: "unknown", command }],
      sessionGrant: null,
    },
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
