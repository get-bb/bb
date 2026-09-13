import { z } from "zod";
import { threadStatusSchema, type Thread } from "@bb/domain";
import { getLatestThreadSequence, type DbConnection } from "@bb/db";
import type { TimelinePaginationCursor } from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { ThreadTimelinePageRequest } from "./timeline-pagination.js";

const snapshotSchema = z.object({
  version: z.literal(1),
  threadId: z.string(),
  maxSeq: z.number().int().nonnegative(),
  status: threadStatusSchema,
  surface: z.string(),
});
export const timelineContentCursorSchema = z.object({
  beforeSequence: z.number().int().positive(),
  beforeLeaf: z.number().int().positive(),
});
export type TimelineContentCursor = z.infer<typeof timelineContentCursorSchema>;
const cursorSchema = z.object({
  snapshot: snapshotSchema,
  anchorSeq: z.number().int().positive(),
  anchorId: z.string().min(1),
  content: timelineContentCursorSchema.optional(),
});
export type TimelineSnapshot = z.infer<typeof snapshotSchema>;
const PREFIX = "timeline-v1:";

function decodeTimelineCursor(anchorId: string): z.infer<typeof cursorSchema> {
  return cursorSchema.parse(
    JSON.parse(
      Buffer.from(anchorId.slice(PREFIX.length), "base64url").toString("utf8"),
    ),
  );
}

export function resolveTimelineSnapshot(
  db: DbConnection,
  thread: Thread,
  page: ThreadTimelinePageRequest,
  surface: string,
  requestedMaxSeq?: number,
): TimelineSnapshot {
  if (page.kind === "latest") {
    const maxSeq = getLatestThreadSequence(db, { threadId: thread.id });
    return {
      version: 1,
      threadId: thread.id,
      maxSeq: Math.min(requestedMaxSeq ?? maxSeq, maxSeq),
      status: thread.status,
      surface,
    };
  }
  try {
    if (!page.beforeCursor.anchorId.startsWith(PREFIX))
      throw new Error("Legacy cursor");
    const decoded = decodeTimelineCursor(page.beforeCursor.anchorId);
    const { snapshot } = decoded;
    if (
      decoded.anchorSeq !== page.beforeCursor.anchorSeq ||
      decoded.anchorSeq > snapshot.maxSeq ||
      (decoded.content !== undefined &&
        (decoded.content.beforeSequence > snapshot.maxSeq + 1 ||
          decoded.content.beforeSequence <= decoded.anchorSeq))
    )
      throw new Error("Cursor sequence mismatch");
    if (snapshot.threadId !== thread.id || snapshot.surface !== surface) {
      throw new Error("Stale snapshot");
    }
    return snapshot;
  } catch {
    throw new ApiError(
      400,
      "invalid_request",
      "Timeline pagination cursor is no longer available; reload the latest page",
    );
  }
}

export function timelineSnapshotKey(snapshot: TimelineSnapshot): string {
  return JSON.stringify(snapshot);
}

export function readTimelineContentCursor(
  page: ThreadTimelinePageRequest,
): TimelineContentCursor | undefined {
  if (page.kind === "latest") return undefined;
  return decodeTimelineCursor(page.beforeCursor.anchorId).content;
}

export function bindTimelineCursor(
  cursor: TimelinePaginationCursor | null,
  snapshot: TimelineSnapshot,
  content?: TimelineContentCursor,
): TimelinePaginationCursor | null {
  return cursor === null
    ? null
    : {
        anchorSeq: cursor.anchorSeq,
        anchorId:
          PREFIX +
          Buffer.from(
            JSON.stringify({
              snapshot,
              anchorSeq: cursor.anchorSeq,
              anchorId: cursor.anchorId,
              content,
            }),
          ).toString("base64url"),
      };
}
