// bb-plugin-side-chat — the plugin-owned side chat (BB-70 phase 5). Side chats
// are plain hidden thread forks
// (`originKind: "fork"`, `originPluginId: "side-chat"`, `visibility:
// "hidden"`) created idle at panel-open time; the frontend renders them with
// the host-owned `ThreadChat` component.
//
// Server-owned policy lives here: the reply-anchor seed rule and the
// empty-fork cleanup sweep. The archive cascade is BB's own: a hidden fork
// retires with its source thread whether or not this plugin is enabled.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const REPLY_SEED_PREFIX =
  "Replying to this earlier message in the conversation:\n\n";

/** Archive-eligible age for an empty (never-replied-to) hidden fork. */
export const EMPTY_FORK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Rows the cleanup sweep reads per query, so its memory stays flat. */
export const EMPTY_FORK_SWEEP_PAGE_SIZE = 100;

/**
 * KV prefix marking a fork the sweep already found user work in. Messages never
 * disappear, so that verdict is permanent — without it every hour re-reads the
 * full timeline of every side chat anyone has actually used.
 */
export const KEPT_FORK_KEY_PREFIX = "kept-fork:";

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
 * off turn rows; work and system rows are ignored.
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
 * The reply-anchor seed policy:
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
      // The seed rule reads only the source's *last* conversation message, and
      // every timeline segment is anchored at a user message — so the newest
      // segment always holds it. Without this the lookup projects the default
      // 20 segments of nested rows on the activation path.
      const timeline = await bb.sdk.threads.timeline({
        threadId: sourceThreadId,
        includeNestedRows: "true",
        segmentLimit: "1",
      });
      const seedText = resolveReplySeedText({
        anchorText,
        sourceTimelineRows: timeline.rows,
      });
      const forkArgs = {
        sourceThreadId,
        visibility: "hidden" as const,
        // A side chat is an aside about the work the source thread is doing,
        // so it runs in that thread's environment rather than provisioning a
        // worktree of its own. "isolated" would branch a fresh checkout per
        // side chat, where the files under discussion are a copy that never
        // reflects what the source thread has since changed.
        workspace: "reuse" as const,
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

  // Empty-fork cleanup: hourly sweep archiving this plugin's hidden forks
  // that never received a user message and are older than 24h. Queued-but-
  // unsent input is user work too and never appears in timeline rows, so a
  // fork with pending queued messages is not empty. Both reads fail closed:
  // when either fails the fork is skipped rather than risked.
  bb.background.schedule("empty-fork-cleanup", "13 * * * *", async () => {
    const now = Date.now();
    const keptKeys = new Set(await bb.storage.kv.list(KEPT_FORK_KEY_PREFIX));
    const stillLive = new Set<string>();
    let offset = 0;
    for (;;) {
      const page = await bb.sdk.threads.list({
        includeHidden: true,
        originKind: "fork",
        originPluginId: bb.pluginId,
        archived: false,
        limit: EMPTY_FORK_SWEEP_PAGE_SIZE,
        offset,
      });
      if (page.length === 0) break;
      // Archiving removes a row from this `archived: false` result set, so the
      // next page starts after the rows this one left behind — advancing by a
      // full page instead would skip that many unswept forks.
      let retained = 0;
      for (const thread of page) {
        if (!isOwnLiveHiddenFork(thread, bb.pluginId)) {
          retained += 1;
          continue;
        }
        if (now - thread.createdAt <= EMPTY_FORK_MAX_AGE_MS) {
          retained += 1;
          continue;
        }
        const keptKey = `${KEPT_FORK_KEY_PREFIX}${thread.id}`;
        if (keptKeys.has(keptKey)) {
          // Already known to hold user work: never archivable, never re-read.
          stillLive.add(keptKey);
          retained += 1;
          continue;
        }
        const outcome = await sweepEmptyFork(thread.id, thread.createdAt);
        if (outcome === "archived") continue;
        if (outcome === "kept") {
          await bb.storage.kv.set(keptKey, true);
          stillLive.add(keptKey);
        }
        // A skipped fork (a read failed) records nothing, so the next sweep
        // retries it.
        retained += 1;
      }
      if (page.length < EMPTY_FORK_SWEEP_PAGE_SIZE) break;
      offset += retained;
    }
    // Every live fork of this plugin passes through the pages above, so a kept
    // key nothing matched belongs to a thread that has since been archived or
    // deleted. Drop it rather than grow the store forever.
    for (const key of keptKeys) {
      if (!stillLive.has(key)) await bb.storage.kv.delete(key);
    }
  });

  /**
   * Archive one candidate fork when it holds no user work. `kept` means the
   * fork holds work and can never become empty; `skipped` means a read failed,
   * so the caller must not remember the verdict. Both reads fail closed: a
   * failure keeps the fork rather than risking it.
   */
  async function sweepEmptyFork(
    threadId: string,
    createdAt: number,
  ): Promise<"archived" | "kept" | "skipped"> {
    try {
      const timeline = await bb.sdk.threads.timeline({
        threadId,
        includeNestedRows: "true",
      });
      if (timelineRowsContainUserMessage(timeline.rows)) return "kept";
    } catch (error) {
      bb.log.warn(
        `empty-fork sweep skipped ${threadId} (timeline read failed: ${
          error instanceof Error ? error.message : String(error)
        })`,
      );
      return "skipped";
    }
    try {
      const queued = await bb.sdk.threads.queuedMessages.list({ threadId });
      if (queued.length > 0) return "kept";
    } catch (error) {
      bb.log.warn(
        `empty-fork sweep skipped ${threadId} (queued-message read failed: ${
          error instanceof Error ? error.message : String(error)
        })`,
      );
      return "skipped";
    }
    try {
      await bb.sdk.threads.archive({ threadId });
      bb.log.info(
        `empty-fork sweep archived ${threadId} (no user messages, ` +
          `created ${new Date(createdAt).toISOString()})`,
      );
      return "archived";
    } catch (error) {
      bb.log.warn(
        `empty-fork sweep failed to archive ${threadId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return "skipped";
    }
  }
}
