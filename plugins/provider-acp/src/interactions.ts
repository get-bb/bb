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
  /** Absolute paths from the ACP tool call's `locations`. */
  locations?: readonly string[] | undefined;
}

/** ACP tool kinds whose permission is a request to change files on disk. */
const ACP_FILE_CHANGE_TOOL_KINDS: ReadonlySet<string> = new Set([
  "edit",
  "delete",
  "move",
]);

/**
 * True when the permission is about changing files rather than running a
 * shell command: an edit/delete/move tool, or an unclassified tool (ACP kind
 * `other`, or no kind) that names filesystem locations. The latter is what
 * opencode sends for its `external_directory` permission (a write outside the
 * project): kind `other`, title = parent directory, locations = [file, dir].
 * Anything with a shell `command` stays a command approval.
 */
function isAcpFileChangePermission(toolCall: AcpPermissionToolCall): boolean {
  if (toolCall.command !== undefined) {
    return false;
  }
  if (
    toolCall.kind !== undefined &&
    ACP_FILE_CHANGE_TOOL_KINDS.has(toolCall.kind)
  ) {
    return true;
  }
  return (
    (toolCall.kind === undefined || toolCall.kind === "other") &&
    (toolCall.locations?.length ?? 0) > 0
  );
}

/**
 * The directory boundary of a file-change permission: the location that
 * contains every other location (opencode's `external_directory` sends
 * `[file, parentDir]`), else the first location.
 */
function acpFileChangeWriteScope(
  locations: readonly string[] | undefined,
): string | null {
  if (!locations || locations.length === 0) {
    return null;
  }
  const root = locations.find((candidate) =>
    locations.every(
      (other) =>
        other === candidate ||
        other.startsWith(candidate.endsWith("/") ? candidate : `${candidate}/`),
    ),
  );
  return toOptionalString(root ?? locations[0]) ?? null;
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
  const availableDecisions = buildAcpApprovalDecisions(args.options);
  if (toolCall && isAcpFileChangePermission(toolCall)) {
    return {
      kind: "approval",
      subject: {
        kind: "file_change",
        itemId: toolCall.toolCallId,
        writeScope: acpFileChangeWriteScope(toolCall.locations),
        sessionGrant: null,
      },
      reason: null,
      availableDecisions,
    };
  }
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
