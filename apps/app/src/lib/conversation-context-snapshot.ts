import type {
  TimelineConversationRow,
  TimelineRow,
} from "@bb/server-contract";
import type { PromptInput } from "@bb/domain";

/**
 * Default verbatim-window sizes (conversation messages preceding the anchor).
 * Forks carry a wider window than side chats because a fork continues the real
 * work and benefits from more of the lead-up; both rely on the `bb thread show`
 * pointer in the header for anything beyond the window.
 */
export const SIDE_CHAT_CONTEXT_WINDOW_SIZE = 6;
export const FORK_CONTEXT_WINDOW_SIZE = 10;

const CONTEXT_HEADERS: Record<ConversationContextScope, string> = {
  "side-chat": "[bb side-chat context]",
  fork: "[bb fork context]",
};

export type ConversationContextScope = "side-chat" | "fork";

export interface BuildConversationContextSnapshotArgs {
  /** The parent thread's timeline rows (turn tree), newest turn last. */
  rows: readonly TimelineRow[];
  /**
   * The anchor agent message's visible text — the message the child was opened
   * from (side chat) or forked from. Anchors the window; when it cannot be
   * located the window falls back to the tail of the conversation.
   */
  sourceMessageText: string;
  /**
   * The parent (source) thread id, surfaced in the header so the child agent can
   * fetch the full conversation with `bb thread show <id>` when the bounded
   * window isn't enough.
   */
  parentThreadId: string;
  /**
   * `"side-chat"` includes the anchor and anything after it (the side chat has no
   * visible anchor of its own). `"fork"` is the lead-up *before* the anchor only,
   * since the fork renders the anchor as its visible seed-without-run row.
   */
  scope: ConversationContextScope;
}

interface SnapshotMessage {
  role: TimelineConversationRow["role"];
  text: string;
}

/**
 * Flattens the timeline turn tree into an ordered list of conversation messages
 * (user + assistant), recursing into turn children. Work rows and system rows
 * are dropped — the snapshot is a conversation excerpt, not a tool trace.
 */
function flattenConversationMessages(
  rows: readonly TimelineRow[],
): SnapshotMessage[] {
  const messages: SnapshotMessage[] = [];
  const visit = (row: TimelineRow): void => {
    if (row.kind === "conversation") {
      const text = row.text.trim();
      if (text.length > 0) {
        messages.push({ role: row.role, text });
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
  return messages;
}

/**
 * Locates the anchor agent message in the flattened list. Matches the LAST
 * assistant message whose text equals the source text — the source is an agent
 * message and, when its text recurs, the most recent occurrence is the one just
 * acted on. Returns that index, or the last index when no exact match is found
 * so the window still captures the most recent exchange.
 *
 * Two consequences worth knowing: for `fork` scope this fallback treats the tail
 * as the anchor, so the lead-up window excludes the genuinely-last message; and
 * if the forked text happens to recur, the window anchors on the newest
 * occurrence rather than the exact one forked from. Both are acceptable here —
 * the visible seed still carries the exact forked text, and the `bb thread show`
 * pointer in the header lets the agent pull the full parent when the bounded
 * window misrepresents the lead-up. (Text is the only anchor signal threaded
 * through today; switch to row-id matching if this ever becomes a real problem.)
 */
function resolveAnchorIndex(
  messages: readonly SnapshotMessage[],
  sourceMessageText: string,
): number {
  const target = sourceMessageText.trim();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && message.role === "assistant" && message.text === target) {
      return index;
    }
  }
  return messages.length - 1;
}

function formatSnapshotMessage(message: SnapshotMessage): string {
  const label = message.role === "assistant" ? "Assistant" : "User";
  return `${label}: ${message.text}`;
}

function defaultWindowSize(scope: ConversationContextScope): number {
  return scope === "fork"
    ? FORK_CONTEXT_WINDOW_SIZE
    : SIDE_CHAT_CONTEXT_WINDOW_SIZE;
}

function buildSnapshotHeader(args: {
  scope: ConversationContextScope;
  parentThreadId: string;
  totalCount: number;
}): string {
  const origin =
    args.scope === "fork"
      ? "you were forked from"
      : "this side chat was opened from";
  return (
    `${CONTEXT_HEADERS[args.scope]}\n` +
    `This is a recent excerpt of the parent thread ${origin} ` +
    `(${args.parentThreadId}, ${args.totalCount} messages total). For earlier ` +
    `context or the full conversation, run: bb thread show ${args.parentThreadId}`
  );
}

/**
 * Builds the one-time `agent-only` context snapshot seeded into a fork's or side
 * chat's first turn: a bounded verbatim window of the parent conversation plus a
 * header pointing the agent at the full parent thread (`bb thread show <id>`) for
 * anything beyond the window.
 *
 * It is a snapshot at creation time and does NOT refresh with later parent-thread
 * activity. Returns an empty array when the parent has no conversation messages,
 * so the caller seeds the turn without it.
 */
export function buildConversationContextSnapshot({
  rows,
  sourceMessageText,
  parentThreadId,
  scope,
}: BuildConversationContextSnapshotArgs): PromptInput[] {
  const messages = flattenConversationMessages(rows);
  if (messages.length === 0) {
    return [];
  }

  const size = defaultWindowSize(scope);
  const anchorIndex = resolveAnchorIndex(messages, sourceMessageText);
  const windowStart = Math.max(0, anchorIndex - size);
  const windowMessages =
    scope === "fork"
      ? messages.slice(windowStart, anchorIndex)
      : messages.slice(windowStart);

  const header = buildSnapshotHeader({
    scope,
    parentThreadId,
    totalCount: messages.length,
  });
  const text =
    windowMessages.length > 0
      ? `${header}\n\n${windowMessages.map(formatSnapshotMessage).join("\n\n")}`
      : header;

  return [{ type: "text", text, mentions: [], visibility: "agent-only" }];
}
