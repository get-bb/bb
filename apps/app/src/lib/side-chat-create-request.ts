import type { Environment, PermissionMode } from "@bb/domain";
import type { TimelineRow } from "@bb/server-contract";
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
 * Returns the last conversation message's text in the parent timeline, or null
 * when the parent has no conversation messages. Recurses into the turn tree
 * (turn children) because conversation rows hang off turn rows; work and system
 * rows are ignored — only user/assistant messages anchor the comparison.
 */
function lastConversationMessageText(
  rows: readonly TimelineRow[],
): string | null {
  let last: string | null = null;
  const visit = (row: TimelineRow): void => {
    if (row.kind === "conversation") {
      const text = row.text.trim();
      if (text.length > 0) {
        last = text;
      }
      return;
    }
    if (row.kind === "turn" && row.children !== null) {
      for (const child of row.children) {
        visit(child);
      }
    }
  };
  for (const row of rows) {
    visit(row);
  }
  return last;
}

/**
 * Resolves the side chat's "anchored-message reply reference": the text of the
 * parent message the side chat replies to, surfaced both in the side-chat UI
 * (a "Replying to" quote) and as context in the first turn so the agent knows
 * which message is being discussed.
 *
 * Returns null when the anchor IS the last conversation message in the parent —
 * the most recent exchange is the obvious referent, so no explicit reference is
 * needed (the native fork already carries the full history). Returns the anchor
 * text only when it is an earlier message, where an explicit pointer matters.
 */
export function resolveSideChatReplyReference(args: {
  /** The anchored agent message's full text (the message replied to). */
  anchorMessageText: string;
  /** The parent thread's timeline rows. */
  sourceTimelineRows: readonly TimelineRow[];
}): string | null {
  const anchor = args.anchorMessageText.trim();
  if (anchor.length === 0) {
    return null;
  }
  const last = lastConversationMessageText(args.sourceTimelineRows);
  if (last !== null && last === anchor) {
    return null;
  }
  return anchor;
}

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
   * The anchored-message reply reference (see {@link resolveSideChatReplyReference}),
   * or null when the anchor is the parent's last message. When present it is
   * prepended to the runtime input as agent-only context (not rendered in the
   * side-chat timeline) so the agent knows which message the question replies to.
   */
  replyReference: string | null;
  /** Provider the side chat inherits from the main thread. */
  providerId: string;
  /** Resolved model the side chat inherits from the main thread. */
  model: string;
  /** Title derived from the source message (the side-chat tab's title). */
  title: string;
}

/**
 * Builds the create-thread request for a message-anchored side chat. The side
 * chat is a native fork of the main thread (`childOrigin: "side-chat"` +
 * `parentThreadId` ⇒ the server clones the parent's provider session, so the
 * full conversation history is behind it) that runs the user's question
 * immediately with read-only reach. When the anchor is not the parent's last
 * message, an agent-only reply reference precedes the visible question so the
 * agent knows which earlier message is being discussed.
 *
 * The side chat runs in the **same project** as its source — a fresh managed
 * worktree branched off the source's host + branch (its own checkout), via the
 * shared {@link resolveChildThreadEnvironment} resolver also used by forks. It
 * falls back to the personal workspace only when the source has no host (a
 * personal-project source); routing a standard-project side chat into the
 * personal project is not viable (it would break the same-project
 * `parentThreadId` guard and the cross-project send-back).
 *
 * `startedOnBehalfOf` is null: unlike a fork's idle establish, a side chat's
 * first turn is the user's question (a normal user-initiated start). The
 * side-chat ↔ main-thread link is `childOrigin` + `parentThreadId`, which
 * satisfies the create boundary (`childOrigin != null` requires `parentThreadId`).
 */
export function buildSideChatCreateRequest({
  projectId,
  sourceThreadId,
  sourceEnvironment,
  question,
  replyReference,
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
    input:
      replyReference === null
        ? [{ type: "text", text: question, mentions: [] }]
        : [
            {
              type: "text",
              text: `Replying to this earlier message in the conversation:\n\n${replyReference}`,
              mentions: [],
              visibility: "agent-only",
            },
            { type: "text", text: question, mentions: [] },
          ],
    environment: resolveChildThreadEnvironment(sourceEnvironment),
    parentThreadId: sourceThreadId,
    startedOnBehalfOf: null,
    childOrigin: "side-chat",
  };
}
