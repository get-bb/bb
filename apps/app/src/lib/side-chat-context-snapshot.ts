import type {
  TimelineConversationRow,
  TimelineRow,
} from "@bb/server-contract";
import type { PromptInput } from "@bb/domain";

/**
 * Default number of conversation messages preceding the spawning agent message
 * to include in a side chat's context snapshot. Open Question 2 (window size N):
 * a small window keeps token cost low while still grounding the side chat in the
 * immediate exchange the user is asking about. The spawning agent message itself
 * and any messages after it in the captured tail are always included on top of
 * this count.
 */
export const SIDE_CHAT_CONTEXT_WINDOW_SIZE = 3;

const SIDE_CHAT_CONTEXT_HEADER = "[bb side-chat context]";

export interface BuildSideChatContextSnapshotArgs {
  /** The main thread's timeline rows (turn tree), newest turn last. */
  rows: readonly TimelineRow[];
  /**
   * The spawning agent message's visible text. Used to anchor the window on the
   * exact message the side chat was opened from; when it cannot be located the
   * window falls back to the tail of the conversation.
   */
  sourceMessageText: string;
  /** Preceding-message window size; defaults to {@link SIDE_CHAT_CONTEXT_WINDOW_SIZE}. */
  windowSize?: number;
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
 * Locates the spawning agent message in the flattened list. Matches the last
 * assistant message whose text equals the source text (the source is an agent
 * message, and the most recent occurrence is the one just acted on). Returns the
 * index, or the last index when no exact match is found so the window still
 * captures the most recent exchange.
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

/**
 * Builds the one-time `agent-only` context snapshot seeded into a side chat's
 * first turn. The snapshot is a bounded window of the main thread's
 * conversation — the spawning agent message, the {@link windowSize} messages
 * preceding it, and any messages after it (the rest of the current turn) — so
 * the side-chat agent can answer questions about the main conversation without
 * the user seeing the context in the side-chat timeline.
 *
 * It is a snapshot at creation time and does NOT refresh with later main-thread
 * activity (documented spec limitation; live re-seeding is a future
 * enhancement). Returns an empty array when there are no conversation messages
 * to include, so the caller seeds the turn with the visible question alone.
 */
export function buildSideChatContextSnapshot({
  rows,
  sourceMessageText,
  windowSize = SIDE_CHAT_CONTEXT_WINDOW_SIZE,
}: BuildSideChatContextSnapshotArgs): PromptInput[] {
  const messages = flattenConversationMessages(rows);
  if (messages.length === 0) {
    return [];
  }

  const anchorIndex = resolveAnchorIndex(messages, sourceMessageText);
  const windowStart = Math.max(0, anchorIndex - windowSize);
  const windowMessages = messages.slice(windowStart);
  if (windowMessages.length === 0) {
    return [];
  }

  const body = windowMessages.map(formatSnapshotMessage).join("\n\n");
  const text = `${SIDE_CHAT_CONTEXT_HEADER}\nRecent conversation from the main thread this side chat was opened from:\n\n${body}`;

  return [
    {
      type: "text",
      text,
      mentions: [],
      visibility: "agent-only",
    },
  ];
}
