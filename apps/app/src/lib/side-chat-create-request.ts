import type {
  Environment,
  PermissionMode,
  ReasoningLevel,
  ServiceTier,
} from "@bb/domain";
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

interface BuildSideChatBaseRequestArgs {
  model: string;
  projectId: string;
  providerId: string;
  reasoningLevel: ReasoningLevel;
  serviceTier: ServiceTier | undefined;
  sourceSeqEnd?: number;
  sourceEnvironment: Environment | null;
  sourceThreadId: string;
  title: string;
}

interface BuildSideChatCreateRequestArgs extends BuildSideChatBaseRequestArgs {
  input: AppCreateThreadRequest["input"];
}

function buildSideChatBaseRequest({
  model,
  projectId,
  providerId,
  reasoningLevel,
  serviceTier,
  sourceSeqEnd,
  sourceEnvironment,
  sourceThreadId,
  title,
}: BuildSideChatBaseRequestArgs): Omit<AppCreateThreadRequest, "input"> {
  return {
    projectId,
    providerId,
    model,
    reasoningLevel,
    ...(serviceTier ? { serviceTier } : {}),
    permissionMode: SIDE_CHAT_PERMISSION_MODE,
    title,
    environment: resolveChildThreadEnvironment(sourceEnvironment),
    ...(sourceSeqEnd !== undefined ? { sourceSeqEnd } : {}),
    sourceThreadId,
    startedOnBehalfOf: null,
    originKind: "side-chat",
  };
}

export interface BuildSideChatMessageInputArgs {
  /** True only for the first user-visible side-chat turn. */
  includeReplyReference: boolean;
  /** The user's visible prompt input. */
  visibleInput: AppCreateThreadRequest["input"];
  /**
   * The anchored-message reply reference (see {@link resolveSideChatReplyReference}),
   * or null when the anchor is the parent's last message. When included, it is
   * prepended as agent-only context so the model knows which earlier message
   * the visible question replies to.
   */
  replyReference: string | null;
}

export function buildSideChatMessageInput({
  includeReplyReference,
  visibleInput,
  replyReference,
}: BuildSideChatMessageInputArgs): AppCreateThreadRequest["input"] {
  if (!includeReplyReference || replyReference === null) {
    return visibleInput;
  }
  return [
    {
      type: "text",
      text: `Replying to this earlier message in the conversation:\n\n${replyReference}`,
      mentions: [],
      visibility: "agent-only",
    },
    ...visibleInput,
  ];
}

export function buildSideChatCreateRequest(
  args: BuildSideChatCreateRequestArgs,
): AppCreateThreadRequest {
  return {
    ...buildSideChatBaseRequest(args),
    input: args.input,
  };
}
