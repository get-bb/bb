import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ExperimentalConversationOutline,
  ExperimentalConversationOutlineItem,
} from "@get-bb/plugin-sdk";
import type {
  ThreadConversationOutlineItem,
  ThreadConversationOutlineResponse,
  ThreadTimelineResponse,
  TimelineConversationAttachments,
  TimelineConversationRow,
  TimelineRow,
} from "@bb/server-contract";
import { parseAgentMessageEnvelope } from "@bb/thread-view";
import {
  threadTimelineQueryOptions,
  useThreadConversationOutline,
} from "@/hooks/queries/thread-panel-queries";
import { useTimelinePaneThreadId } from "@/lib/timeline-viewport";

type OutlineRole = ExperimentalConversationOutlineItem["role"];

const PREVIEW_MAX_LENGTH = 200;
const NO_ITEMS: readonly ExperimentalConversationOutlineItem[] = [];

interface LiveOutline {
  contextBoundarySeq: number | null;
  items: readonly ExperimentalConversationOutlineItem[];
}

function toPreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= PREVIEW_MAX_LENGTH
    ? normalized
    : normalized.slice(0, PREVIEW_MAX_LENGTH).trimEnd();
}

function splitSender(text: string): {
  body: string;
  senderThreadId: string | null;
} {
  const envelope = parseAgentMessageEnvelope(text);
  return envelope === null
    ? { body: text, senderThreadId: null }
    : {
        body: text.slice(envelope.bodyStart),
        senderThreadId: envelope.senderThreadId,
      };
}

function toAttachmentSummary(
  attachments: TimelineConversationAttachments | null,
): ExperimentalConversationOutlineItem["attachmentSummary"] {
  if (attachments === null) return null;
  const imageCount = attachments.webImages + attachments.localImages;
  const fileCount = attachments.localFiles;
  return imageCount === 0 && fileCount === 0 ? null : { imageCount, fileCount };
}

const itemsByRow = new WeakMap<
  TimelineConversationRow,
  ExperimentalConversationOutlineItem
>();

function rowItem(
  row: TimelineConversationRow,
): ExperimentalConversationOutlineItem {
  const cached = itemsByRow.get(row);
  if (cached !== undefined) return cached;
  const { body, senderThreadId } = splitSender(row.text);
  const item: ExperimentalConversationOutlineItem = {
    id: row.id,
    messageSeq: row.messageSeq,
    role: row.role,
    preview: toPreview(body),
    senderThreadId,
    attachmentSummary: toAttachmentSummary(row.attachments),
  };
  itemsByRow.set(row, item);
  return item;
}

const itemsByOutlineItem = new WeakMap<
  ThreadConversationOutlineItem,
  ExperimentalConversationOutlineItem
>();

function outlineItem(
  source: ThreadConversationOutlineItem,
): ExperimentalConversationOutlineItem {
  const cached = itemsByOutlineItem.get(source);
  if (cached !== undefined) return cached;
  const { body, senderThreadId } = splitSender(source.preview);
  const item: ExperimentalConversationOutlineItem = {
    id: source.id,
    messageSeq: source.messageSeq,
    role: source.role,
    preview: senderThreadId === null ? source.preview : toPreview(body),
    senderThreadId,
    attachmentSummary: source.attachmentSummary,
  };
  itemsByOutlineItem.set(source, item);
  return item;
}

export function collectConversationRows(
  rows: readonly TimelineRow[],
  into: TimelineConversationRow[] = [],
): TimelineConversationRow[] {
  for (const row of rows) {
    if (row.kind === "conversation") {
      into.push(row);
    } else if (row.kind === "turn" && row.children !== null) {
      collectConversationRows(row.children, into);
    }
  }
  return into;
}

function selectLiveOutline(
  role: OutlineRole,
): (timeline: ThreadTimelineResponse) => LiveOutline {
  return (timeline) => ({
    contextBoundarySeq: timeline.contextBoundarySeq,
    items: collectConversationRows(timeline.rows)
      .filter((row) => row.role === role)
      .map(rowItem),
  });
}

const SELECT_LIVE_OUTLINE: Record<
  OutlineRole,
  (timeline: ThreadTimelineResponse) => LiveOutline
> = {
  user: selectLiveOutline("user"),
  assistant: selectLiveOutline("assistant"),
};

export function mergeConversationOutline(
  wholeThread: readonly ExperimentalConversationOutlineItem[],
  live: readonly ExperimentalConversationOutlineItem[],
): readonly ExperimentalConversationOutlineItem[] {
  if (live.length === 0) return wholeThread;
  if (wholeThread.length === 0) return live;
  const liveById = new Map(live.map((item) => [item.id, item]));
  const wholeThreadIds = new Set(wholeThread.map((item) => item.id));
  return [
    ...wholeThread.map((item) => liveById.get(item.id) ?? item),
    ...live.filter((item) => !wholeThreadIds.has(item.id)),
  ];
}

function isBeforeContextBoundary(
  data: ThreadConversationOutlineResponse,
  contextBoundarySeq: number | null,
): boolean {
  return contextBoundarySeq !== null && data.maxSeq < contextBoundarySeq;
}

export function useConversationOutline(
  threadId: string,
  role: OutlineRole,
  options?: { enabled?: boolean },
): ExperimentalConversationOutline {
  const queryClient = useQueryClient();
  const liveQuery = useQuery({
    ...threadTimelineQueryOptions(queryClient, threadId, { enabled: false }),
    select: SELECT_LIVE_OUTLINE[role],
  });
  const waitsForPane =
    useTimelinePaneThreadId() === threadId && liveQuery.status === "pending";
  const wholeThreadQuery = useThreadConversationOutline(threadId, role, {
    enabled: (options?.enabled ?? true) && !waitsForPane,
  });
  const live = liveQuery.data;
  const contextBoundarySeq = live?.contextBoundarySeq ?? null;
  const wholeThreadData = wholeThreadQuery.data;
  const wholeThread =
    wholeThreadData === undefined ||
    isBeforeContextBoundary(wholeThreadData, contextBoundarySeq)
      ? undefined
      : wholeThreadData.items;
  const liveItems = live?.items ?? NO_ITEMS;
  const items = useMemo(
    () =>
      mergeConversationOutline(
        wholeThread === undefined ? NO_ITEMS : wholeThread.map(outlineItem),
        liveItems,
      ),
    [liveItems, wholeThread],
  );
  const status: ExperimentalConversationOutline["status"] =
    wholeThread !== undefined
      ? "ready"
      : wholeThreadQuery.status === "error"
        ? "error"
        : "loading";
  return useMemo(() => ({ status, items }), [items, status]);
}
