// bb-plugin-side-chat — the plugin-owned side chat (BB-70 phase 5, behind the
// `sideChatPlugin` experiment). Side chats are plain hidden thread forks
// (`originKind: "fork"`, `originPluginId: "side-chat"`, `visibility:
// "hidden"`) created idle at panel-open time; the frontend renders them with
// the host-owned `ThreadChat` component.
//
// Server-owned policy lives here: the reply-anchor seed rule (replicating the
// legacy `resolveSideChatReplyReference` semantics from
// apps/app/src/lib/side-chat-create-request.ts), the archive cascade for this
// plugin's forks, and the empty-fork cleanup sweep.
import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import { z } from "zod";

export const REPLY_SEED_PREFIX =
  "Replying to this earlier message in the conversation:\n\n";

/** Archive-eligible age for an empty (never-replied-to) hidden fork. */
export const EMPTY_FORK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Structural view of the timeline rows the seed policy and sweep walk —
 * conversation rows carry `text`/`role`, turn rows nest `children`. The SDK's
 * `TimelineRow` union satisfies this shape.
 */
export interface SideChatTimelineRowLike {
  kind: string;
  text?: string;
  role?: string;
  children?: readonly SideChatTimelineRowLike[] | null;
}

/**
 * Last conversation message's trimmed text in the timeline, or null when
 * there is none. Recurses into the turn tree because conversation rows hang
 * off turn rows; work and system rows are ignored. Mirrors the legacy
 * side-chat-create-request implementation.
 */
export function lastConversationMessageText(
  rows: readonly SideChatTimelineRowLike[],
): string | null {
  let last: string | null = null;
  const visit = (row: SideChatTimelineRowLike): void => {
    if (row.kind === "conversation") {
      const text = row.text?.trim() ?? "";
      if (text.length > 0) {
        last = text;
      }
      return;
    }
    if (row.kind === "turn" && row.children != null) {
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
 * The reply-anchor seed policy (legacy `resolveSideChatReplyReference`):
 * null when the anchor is empty or IS the source's last conversation message
 * (the most recent exchange is the obvious referent — the fork already
 * carries full history); the trimmed anchor otherwise, where an explicit
 * pointer matters. Selection-invoked replies pass the selection as the
 * anchor, so the selected text rides the same rule.
 */
export function resolveReplySeedText(args: {
  anchorText: string;
  sourceTimelineRows: readonly SideChatTimelineRowLike[];
}): string | null {
  const anchor = args.anchorText.trim();
  if (anchor.length === 0) {
    return null;
  }
  const last = lastConversationMessageText(args.sourceTimelineRows);
  if (last !== null && last === anchor) {
    return null;
  }
  return anchor;
}

/** Whether the fork's timeline contains a real user message. */
export function timelineRowsContainUserMessage(
  rows: readonly SideChatTimelineRowLike[],
): boolean {
  const visit = (row: SideChatTimelineRowLike): boolean => {
    if (row.kind === "conversation") {
      return row.role === "user";
    }
    return row.kind === "turn" && row.children != null
      ? row.children.some(visit)
      : false;
  };
  return rows.some(visit);
}

/** The thread fields the cascade / sweep predicates read. */
export interface SideChatForkCandidate {
  originKind: string | null;
  originPluginId: string | null;
  visibility: string;
  archivedAt: number | null;
  createdAt: number;
}

/**
 * Whether a fork failure is the server's machine-readable
 * `fork_source_session_unavailable` (no provider session snapshot at or
 * before the requested fork point) — the only failure the tip-fork fallback
 * may swallow. Narrows on the structured `code` the SDK's HTTP error
 * carries, never on message text.
 */
export function isSessionUnavailableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "fork_source_session_unavailable"
  );
}

/** Whether a thread is one of this plugin's live hidden side-chat forks. */
export function isOwnLiveHiddenFork(
  thread: SideChatForkCandidate,
  pluginId: string,
): boolean {
  return (
    thread.originKind === "fork" &&
    thread.originPluginId === pluginId &&
    thread.visibility === "hidden" &&
    thread.archivedAt === null
  );
}

export const sideChatRpcContract = defineRpcContract({
  /**
   * Create the idle hidden fork a side-chat panel renders. `anchorText` is
   * the message (or selection) the side chat replies to — empty for tip
   * forks started from the panel launcher. The reply-anchor seed is decided
   * server-side against the source thread's current timeline.
   */
  createSideChat: {
    input: z
      .object({
        sourceThreadId: z.string().trim().min(1),
        sourceSeqEnd: z.number().int().nonnegative().optional(),
        anchorText: z.string(),
      })
      .strict(),
    output: z.object({ threadId: z.string() }).strict(),
  },
  /** Queue an assistant message's text on the source thread ("send to main"). */
  sendToMain: {
    input: z
      .object({
        sourceThreadId: z.string().trim().min(1),
        senderThreadId: z.string().trim().min(1),
        text: z.string().trim().min(1),
      })
      .strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
});

export default async function plugin(bb: BbPluginApi) {
  bb.rpc.register(sideChatRpcContract, {
    async createSideChat({ sourceThreadId, sourceSeqEnd, anchorText }) {
      const timeline = await bb.sdk.threads.timeline({
        threadId: sourceThreadId,
        includeNestedRows: "true",
      });
      const seedText = resolveReplySeedText({
        anchorText,
        sourceTimelineRows: timeline.rows,
      });
      const forkArgs = {
        sourceThreadId,
        visibility: "hidden" as const,
        workspace: "isolated" as const,
        ...(seedText !== null
          ? {
              agentContextSeed: [
                {
                  type: "text" as const,
                  text: `${REPLY_SEED_PREFIX}${seedText}`,
                  mentions: [],
                  visibility: "agent-only" as const,
                },
              ],
            }
          : {}),
      };
      try {
        const fork = await bb.sdk.threads.fork({
          ...forkArgs,
          ...(sourceSeqEnd !== undefined ? { sourceSeqEnd } : {}),
        });
        return { threadId: fork.id };
      } catch (error) {
        // Messages earlier than the source's first provider session (e.g. the
        // opening user message) have no point-in-time session to clone. The
        // legacy side chat always forked from the tip; fall back to that so
        // those anchors keep working — the reply seed still marks the anchor.
        if (sourceSeqEnd === undefined || !isSessionUnavailableError(error)) {
          throw error;
        }
        const fork = await bb.sdk.threads.fork(forkArgs);
        return { threadId: fork.id };
      }
    },
    async sendToMain({ sourceThreadId, senderThreadId, text }) {
      await bb.sdk.threads.queuedMessages.create({
        threadId: sourceThreadId,
        input: [{ type: "text", text, mentions: [] }],
        senderThreadId,
      });
      return { ok: true as const };
    },
  });

  // Archive cascade: archiving a source thread archives this plugin's hidden
  // forks of it. Plugin-owned by design (BB-70 decisions log) — the core
  // `originKind: "side-chat"` cascade stays server-side for legacy rows only.
  bb.events.on("thread.archived", async ({ thread }) => {
    const candidates = await bb.sdk.threads.list({
      sourceThreadId: thread.id,
      includeHidden: true,
    });
    for (const candidate of candidates) {
      if (!isOwnLiveHiddenFork(candidate, bb.pluginId)) continue;
      try {
        await bb.sdk.threads.archive({ threadId: candidate.id });
        bb.log.info(
          `archived side-chat fork ${candidate.id} (source ${thread.id} archived)`,
        );
      } catch (error) {
        bb.log.warn(
          `failed to archive side-chat fork ${candidate.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  });

  // Empty-fork cleanup: hourly sweep archiving this plugin's hidden forks
  // that never received a user message and are older than 24h. Queued-but-
  // unsent input is user work too and never appears in timeline rows, so a
  // fork with pending queued messages is not empty. Both reads fail closed:
  // when either fails the fork is skipped rather than risked.
  bb.background.schedule("empty-fork-cleanup", "13 * * * *", async () => {
    const now = Date.now();
    const threads = await bb.sdk.threads.list({
      includeHidden: true,
      originKind: "fork",
    });
    for (const thread of threads) {
      if (!isOwnLiveHiddenFork(thread, bb.pluginId)) continue;
      if (now - thread.createdAt <= EMPTY_FORK_MAX_AGE_MS) continue;
      try {
        const timeline = await bb.sdk.threads.timeline({
          threadId: thread.id,
          includeNestedRows: "true",
        });
        if (timelineRowsContainUserMessage(timeline.rows)) continue;
      } catch (error) {
        bb.log.warn(
          `empty-fork sweep skipped ${thread.id} (timeline read failed: ${
            error instanceof Error ? error.message : String(error)
          })`,
        );
        continue;
      }
      try {
        const queued = await bb.sdk.threads.queuedMessages.list({
          threadId: thread.id,
        });
        if (queued.length > 0) continue;
      } catch (error) {
        bb.log.warn(
          `empty-fork sweep skipped ${thread.id} (queued-message read failed: ${
            error instanceof Error ? error.message : String(error)
          })`,
        );
        continue;
      }
      try {
        await bb.sdk.threads.archive({ threadId: thread.id });
        bb.log.info(
          `empty-fork sweep archived ${thread.id} (no user messages, ` +
            `created ${new Date(thread.createdAt).toISOString()})`,
        );
      } catch (error) {
        bb.log.warn(
          `empty-fork sweep failed to archive ${thread.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  });
}
