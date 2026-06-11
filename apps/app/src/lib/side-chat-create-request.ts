import type { Environment, PermissionMode, PromptInput } from "@bb/domain";
import type { AppCreateThreadRequest } from "@/lib/api";
import { resolveChildThreadEnvironment } from "@/lib/child-thread-environment";

/**
 * Side chats always run read-only — they observe a conversation and never mutate
 * the workspace. The composer's displayed permission label and the create
 * request both source this single constant, so the displayed label cannot drift
 * from the permission the thread is actually created with.
 */
export const SIDE_CHAT_PERMISSION_MODE: PermissionMode = "readonly";

/**
 * Inputs for building a side chat's create-thread request. A side chat is a
 * child thread of the main thread, created lazily on the user's first submit.
 */
export interface BuildSideChatCreateRequestArgs {
  /** Project the main thread belongs to (the side chat shares it). */
  projectId: string;
  /** Main thread the side chat is anchored to; becomes its parent. */
  sourceThreadId: string;
  /**
   * The main thread's environment (host + branch), or null when not yet loaded
   * / for a personal-project source. Resolves the side chat's own workspace.
   */
  sourceEnvironment: Environment | null;
  /** The user's visible question (the first executed turn's prompt). */
  question: string;
  /**
   * The `agent-only` main-thread context snapshot, prepended to the runtime
   * input but not rendered in the side-chat timeline. May be empty.
   */
  contextSnapshot: readonly PromptInput[];
  /** Provider the side chat inherits from the main thread. */
  providerId: string;
  /** Resolved model the side chat inherits from the main thread. */
  model: string;
  /** Title derived from the source message (the side-chat tab's title). */
  title: string;
}

/**
 * Builds the create-thread request for a message-anchored side chat. The first
 * turn carries the visible question followed by the `agent-only` context
 * snapshot; the thread is a child of the main thread (`childOrigin: "side-chat"`,
 * `parentThreadId = sourceThreadId`) running with read-only reach.
 *
 * The side chat runs in the **same project** as its source — a fresh managed
 * worktree branched off the source's host + branch (its own checkout), via the
 * shared {@link resolveChildThreadEnvironment} resolver also used by forks. It
 * falls back to the personal workspace only when the source has no host (a
 * personal-project source); routing a standard-project side chat into the
 * personal project is not viable (it would break the same-project
 * `parentThreadId` guard and the cross-project send-back).
 *
 * `startedOnBehalfOf` is null: unlike a fork, a side chat's first turn is the
 * user's question (a normal user-initiated start), not a seed-without-run agent
 * anchor. The side-chat ↔ main-thread link is `childOrigin` + `parentThreadId`,
 * which satisfies the create boundary (`childOrigin != null` requires
 * `parentThreadId`).
 */
export function buildSideChatCreateRequest({
  projectId,
  sourceThreadId,
  sourceEnvironment,
  question,
  contextSnapshot,
  providerId,
  model,
  title,
}: BuildSideChatCreateRequestArgs): AppCreateThreadRequest {
  const permissionMode = SIDE_CHAT_PERMISSION_MODE;
  return {
    projectId,
    providerId,
    model,
    permissionMode,
    title,
    input: [
      { type: "text", text: question, mentions: [] },
      ...contextSnapshot,
    ],
    environment: resolveChildThreadEnvironment(sourceEnvironment),
    parentThreadId: sourceThreadId,
    startedOnBehalfOf: null,
    childOrigin: "side-chat",
  };
}
