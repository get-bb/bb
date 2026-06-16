// Hand-vendored codex `thread/fork` RPC params. The checked-in codex
// app-server schema (src/codex/generated) does not include the fork RPC, so —
// unlike the rest of that generated schema — this type is maintained here as a
// regular source file. Its field types reuse the generated sibling schemas.
import type { JsonValue } from "./generated/codex-app-server/schema/serde_json/JsonValue.js";
import type { ApprovalsReviewer } from "./generated/codex-app-server/schema/v2/ApprovalsReviewer.js";
import type { AskForApproval } from "./generated/codex-app-server/schema/v2/AskForApproval.js";
import type { PermissionProfileSelectionParams } from "./generated/codex-app-server/schema/v2/PermissionProfileSelectionParams.js";
import type { SandboxMode } from "./generated/codex-app-server/schema/v2/SandboxMode.js";
import type { ThreadSource } from "./generated/codex-app-server/schema/v2/ThreadSource.js";

/**
 * There are two ways to fork a thread:
 * 1. By thread_id: load the thread from disk by thread_id and fork it into a new thread.
 * 2. By path: load the thread from disk by path and fork it into a new thread.
 *
 * If using path, the thread_id param will be ignored.
 *
 * Prefer using thread_id whenever possible.
 */
export type ThreadForkParams = {
  threadId: string;
  /**
   * [UNSTABLE] Specify the rollout path to fork from.
   * If specified, the thread_id param will be ignored.
   */
  path?: string | null;
  model?: string | null;
  modelProvider?: string | null;
  serviceTier?: string | null | null;
  cwd?: string | null;
  approvalPolicy?: AskForApproval | null;
  /**
   * Override where approval requests are routed for review on this thread
   * and subsequent turns.
   */
  approvalsReviewer?: ApprovalsReviewer | null;
  sandbox?: SandboxMode | null;
  /**
   * Named profile selection for the forked thread. Cannot be combined with
   * `sandbox`.
   */
  permissions?: PermissionProfileSelectionParams | null;
  config?: { [key in string]?: JsonValue } | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  ephemeral?: boolean;
  /**
   * Optional client-supplied analytics source classification for this forked thread.
   */
  threadSource?: ThreadSource | null;
  /**
   * When true, return only thread metadata and live fork state without
   * populating `thread.turns`.
   */
  excludeTurns?: boolean;
  /**
   * Deprecated and ignored by app-server. Kept only so older clients can
   * continue sending the field.
   */
  persistExtendedHistory: boolean;
};
