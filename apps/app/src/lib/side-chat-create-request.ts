import type { PermissionMode, PromptInput } from "@bb/domain";
import type { AppCreateThreadRequest } from "@/lib/api";

/**
 * Inputs for building a side chat's create-thread request. A side chat is a
 * child thread of the main thread, created lazily on the user's first submit.
 */
export interface BuildSideChatCreateRequestArgs {
  /** Project the main thread belongs to (the side chat shares it). */
  projectId: string;
  /** Main thread the side chat is anchored to; becomes its parent. */
  sourceThreadId: string;
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
 * `parentThreadId = sourceThreadId`) running in the personal workspace with
 * read-only reach (v1 conversation-only — no worktree files).
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
  question,
  contextSnapshot,
  providerId,
  model,
  title,
}: BuildSideChatCreateRequestArgs): AppCreateThreadRequest {
  const permissionMode: PermissionMode = "readonly";
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
    environment: {
      type: "host",
      workspace: { type: "personal" },
    },
    parentThreadId: sourceThreadId,
    startedOnBehalfOf: null,
    childOrigin: "side-chat",
  };
}
