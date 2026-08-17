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
  toOptionalString,
} from "@get-bb/plugin-sdk/provider-bridge";
import type { AcpPermissionOptionKind } from "./wire.js";

/**
 * The bridge maps the user's decision back onto the ACP options it kept for
 * the pending permission request.
 */
export interface AcpPermissionResponse {
  decision: "allow_once" | "allow_for_session" | "deny";
}

export interface AcpPermissionToolCall {
  toolCallId: string;
  title?: string | undefined;
  kind?: string | undefined;
  command?: string | undefined;
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

function buildOpaqueAcpPermissionCommand(toolCall: {
  command?: string | undefined;
  title?: string | undefined;
  kind?: string | undefined;
}): string {
  return (
    toOptionalString(toolCall.command) ??
    toOptionalString(toolCall.title) ??
    toolCall.kind ??
    "ACP permission request"
  );
}

/** The canonical approval payload for an ACP `session/request_permission`. */
export function buildAcpPermissionInteractionPayload(args: {
  toolCall: AcpPermissionToolCall | undefined;
  options: readonly { kind: AcpPermissionOptionKind }[];
}): PendingInteractionPayload {
  const toolCall = args.toolCall;
  const command = toolCall
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
    availableDecisions: buildAcpApprovalDecisions(args.options),
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
