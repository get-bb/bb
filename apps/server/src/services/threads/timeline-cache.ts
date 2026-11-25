import type { ThreadTimelineResponse } from "@bb/server-contract";
import type { ThreadStatus } from "@bb/domain";
import type { ThreadTimelinePageRequest } from "./timeline-pagination.js";
import {
  createThreadDerivedCache,
  type ThreadDerivedCache,
} from "./thread-derived-cache.js";
import { timelineWindowJsonLength } from "./timeline-window-tag.js";

const MAX_ENTRIES = 512;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;

export function createThreadTimelineWindowCache(): ThreadDerivedCache<ThreadTimelineResponse> {
  return createThreadDerivedCache<ThreadTimelineResponse>({
    maxEntries: MAX_ENTRIES,
    bytes: {
      maxBytes: MAX_BYTES,
      maxEntryBytes: MAX_ENTRY_BYTES,
      measure: timelineWindowJsonLength,
    },
  });
}

export interface ThreadTimelineCacheKeyArgs {
  threadId: string;
  page: ThreadTimelinePageRequest;
  deferContent: boolean;
  includeNestedRows: boolean;
}

export interface ThreadTimelineCacheRevisionArgs {
  maxSeq: number;
  page: ThreadTimelinePageRequest;
  rewriteGeneration: number;
  status: ThreadStatus;
  surface: string;
}

function pageKeyPart(page: ThreadTimelinePageRequest): string {
  return page.kind === "older"
    ? `older:${page.segmentLimit}:${page.beforeCursor.anchorSeq}:${page.beforeCursor.anchorId}`
    : `latest:${page.segmentLimit}`;
}

export function buildThreadTimelineCacheKey(
  args: ThreadTimelineCacheKeyArgs,
): string {
  return [
    args.threadId,
    pageKeyPart(args.page),
    args.deferContent ? "1" : "0",
    args.includeNestedRows ? "1" : "0",
  ].join("|");
}

export function buildThreadTimelineCacheRevision(
  args: ThreadTimelineCacheRevisionArgs,
): string {
  return JSON.stringify(
    args.page.kind === "older"
      ? [args.rewriteGeneration, args.surface]
      : [args.rewriteGeneration, args.maxSeq, args.status, args.surface],
  );
}
