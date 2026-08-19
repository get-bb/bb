import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ThreadConversationOutlineItem,
  TimelineConversationAttachments,
  TimelineRow,
} from "@bb/server-contract";
import { useScrollOverflowState } from "@/components/thread/timeline/useScrollOverflowState";
import { useBottomAnchoredScroll } from "@/components/ui/bottom-anchored-scroll-body.js";
import { useThreadConversationOutline } from "@/hooks/queries/thread-queries";
import { useSenderThreadMetadataById } from "@/hooks/useSenderThreadMetadataById";
import { PromptMentionIcon } from "@/components/promptbox/mentions/PromptMentionIcon";
import { PROMPT_MENTION_PILL_CLASS } from "@/components/promptbox/mentions/prompt-mention-display";
import { cn } from "@bb/shared-ui/lib/utils";
import { parseAgentMessageEnvelope } from "@bb/thread-view";
import { useThreadTitleDisplayText } from "@/components/thread/ThreadTitleMentions";

export interface TocItem {
  id: string;
  label: string;
  role: "user" | "assistant";
}

type TocTab = "user" | "agent";

interface ActiveItemIds {
  agent: string | null;
  user: string | null;
}

interface ThreadTableOfContentsProps {
  threadId: string;
  /**
   * The currently-loaded timeline window. Used for scroll-spy (which loaded row
   * is in view) and as a fallback item source until the full outline loads — the
   * minimap itself renders the full thread via {@link useThreadConversationOutline}.
   */
  timelineRows: readonly TimelineRow[];
  hasOlderTimelineRows: boolean;
  /** Loads the next older timeline page; awaited while jumping to an unloaded row. */
  loadOlderTimelineRows: () => void | Promise<void>;
}

// Matches `@container scroll-overlay (min-width: 56rem)` in app.css.
const TOC_MIN_VISIBLE_WIDTH_PX = 56 * 16;
const TOC_BOTTOM_ACTIVE_THRESHOLD_PX = 4;
// Only worth showing once the conversation has enough user turns to navigate.
const TOC_MIN_USER_MESSAGES = 3;
const TOC_MAX_RAIL_TICKS = 20;
// Updating the active rail tick changes overlay DOM and invalidates layout.
// Wait for a scroll burst to settle instead of doing that work in the same
// animation frames the timeline is trying to paint.
const TOC_ACTIVE_UPDATE_IDLE_MS = 120;
// Hard stop so a pagination bug can never spin the jump loop forever.
const TOC_JUMP_MAX_PAGE_LOADS = 1000;
// Frames to wait for prepended rows to commit before paginating again.
const TOC_JUMP_RENDER_FRAMES = 6;
function toPreviewLabel(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function toAttachmentPreviewLabel(
  attachments: TimelineConversationAttachments | null,
): string {
  if (!attachments) return "Message";
  const imageCount = attachments.webImages + attachments.localImages;
  const totalCount = imageCount + attachments.localFiles;
  if (totalCount === 0) return "Message";
  if (totalCount === 1) {
    return imageCount === 1 ? "Image attachment" : "File attachment";
  }
  return `${totalCount} attachments`;
}

function toTocLabel({
  attachments,
  text,
}: {
  attachments: TimelineConversationAttachments | null;
  text: string;
}): string {
  const textLabel = toPreviewLabel(text);
  return textLabel || toAttachmentPreviewLabel(attachments);
}

function toAttachmentSummaryLabel(
  summary: ThreadConversationOutlineItem["attachmentSummary"],
): string {
  if (!summary) return "Message";
  const totalCount = summary.imageCount + summary.fileCount;
  if (totalCount === 0) return "Message";
  if (totalCount === 1) {
    return summary.imageCount === 1 ? "Image attachment" : "File attachment";
  }
  return `${totalCount} attachments`;
}

function outlineItemToTocItem(item: ThreadConversationOutlineItem): TocItem {
  return {
    id: item.id,
    label: item.preview || toAttachmentSummaryLabel(item.attachmentSummary),
    role: item.role,
  };
}

export function selectTocRailItems({
  activeId,
  items,
}: {
  activeId: string | null;
  items: readonly TocItem[];
}): readonly TocItem[] {
  if (items.length <= TOC_MAX_RAIL_TICKS) return items;

  const maxIndex = items.length - 1;
  const activeIndex =
    activeId === null ? -1 : items.findIndex((item) => item.id === activeId);
  const sampledIndices = new Set<number>();
  for (let slot = 0; slot < TOC_MAX_RAIL_TICKS; slot += 1) {
    sampledIndices.add(
      Math.round((slot * maxIndex) / (TOC_MAX_RAIL_TICKS - 1)),
    );
  }

  if (activeIndex >= 0) {
    sampledIndices.add(activeIndex);
    if (sampledIndices.size > TOC_MAX_RAIL_TICKS) {
      let removableIndex: number | null = null;
      let removableDistance = Number.POSITIVE_INFINITY;
      for (const index of sampledIndices) {
        if (index === activeIndex || index === 0 || index === maxIndex) {
          continue;
        }
        const distance = Math.abs(index - activeIndex);
        if (distance < removableDistance) {
          removableIndex = index;
          removableDistance = distance;
        }
      }
      if (removableIndex !== null) sampledIndices.delete(removableIndex);
    }
  }

  return Array.from(sampledIndices)
    .sort((a, b) => a - b)
    .map((index) => items[index]);
}

function TocPanelTab({
  label,
  active,
  onSelect,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "flex h-7 flex-1 cursor-pointer items-center justify-center rounded-md text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active
          ? "bg-state-hover text-foreground"
          : "text-muted-foreground hover:bg-state-hover",
      )}
    >
      {label}
    </button>
  );
}

function TocThreadMention({
  threadId,
  threadTitle,
}: {
  threadId: string;
  threadTitle: string | null;
}) {
  const label = useThreadTitleDisplayText(threadTitle ?? "Agent");
  return (
    <span
      className={cn(
        PROMPT_MENTION_PILL_CLASS,
        "max-w-32 shrink-0 bg-surface-raised/50 text-foreground",
      )}
      title={`Thread: ${label}`}
    >
      <PromptMentionIcon
        resource={{ kind: "thread", threadId, label }}
        className="size-3 shrink-0 self-center text-muted-foreground"
      />
      <span className="truncate">{label}</span>
    </span>
  );
}

function TocItemPreview({
  item,
  senderThreadMetadataById,
}: {
  item: TocItem;
  senderThreadMetadataById: ReadonlyMap<string, { title: string | null }>;
}) {
  const source = parseAgentMessageEnvelope(item.label);
  if (source === null) {
    return <span className="line-clamp-2">{item.label}</span>;
  }

  const body = item.label.slice(source.bodyStart);
  return (
    <span className="flex min-w-0 items-start gap-1">
      <TocThreadMention
        threadId={source.senderThreadId}
        threadTitle={
          senderThreadMetadataById.get(source.senderThreadId)?.title ?? null
        }
      />
      <span className="line-clamp-2 min-w-0">{body || "Message"}</span>
    </span>
  );
}

/**
 * Builds the user/agent item lists for the minimap. Prefers the full
 * conversation outline (the whole thread, independent of pagination); falls
 * back to the loaded timeline window so the minimap still renders on first
 * paint and in environments without the outline endpoint (e.g. stories).
 */
function useConversationTocItems({
  outlineItems,
  timelineRows,
}: {
  outlineItems: readonly ThreadConversationOutlineItem[] | undefined;
  timelineRows: readonly TimelineRow[];
}) {
  const outlineTocItems = useMemo(() => {
    if (!outlineItems || outlineItems.length === 0) return null;
    const userItems: TocItem[] = [];
    const agentItems: TocItem[] = [];
    for (const item of outlineItems) {
      const tocItem = outlineItemToTocItem(item);
      if (tocItem.role === "user") {
        userItems.push(tocItem);
      } else {
        agentItems.push(tocItem);
      }
    }
    return { agentItems, userItems };
  }, [outlineItems]);

  const timelineTocItems = useMemo(() => {
    const userItems: TocItem[] = [];
    const agentItems: TocItem[] = [];
    for (const row of timelineRows) {
      if (row.kind !== "conversation") continue;
      const item: TocItem = {
        id: row.id,
        label: toTocLabel({ attachments: row.attachments, text: row.text }),
        role: row.role,
      };
      if (row.role === "user") {
        userItems.push(item);
      } else {
        agentItems.push(item);
      }
    }

    return { agentItems, userItems };
  }, [timelineRows]);

  return outlineTocItems ?? timelineTocItems;
}

/**
 * Whether the scroll overlay is wide enough for the TOC, tracked against the
 * same width the `@container` rule sees.
 *
 * The width comes off the ResizeObserver entry's content box, which is exactly
 * what an inline-size container query resolves against — padding excluded, so
 * this boundary and the CSS breakpoint agree. (`clientWidth` counts the
 * overlay's own horizontal padding, and would report the TOC visible for a
 * padding-wide band below the breakpoint.)
 *
 * Reading the entry rather than measuring the element is the point. The
 * previous `getComputedStyle(host)` + `clientWidth` pair forced a synchronous
 * style recalculation, and it ran inside a `requestAnimationFrame` callback —
 * which fires before the frame's style and layout phase, so the recalculation
 * was unavoidable and full-document. In Safari that single call cost 750ms on
 * one profiled thread and 67% of all script time on another, and the resulting
 * `setVisible` re-triggered the observer ("ResizeObserver loop completed with
 * undelivered notifications"). ResizeObserver callbacks already run after
 * layout, so the entry is free and the animation-frame hop is unnecessary.
 */
function useThreadTocVisible(rootElement: HTMLElement | null): boolean {
  const [visible, setVisible] = useState(
    () => typeof ResizeObserver === "undefined",
  );

  useEffect(() => {
    const host =
      rootElement?.closest<HTMLElement>("[data-scroll-overlay]") ?? null;
    if (typeof ResizeObserver === "undefined") {
      setVisible(true);
      return;
    }
    if (!host) {
      setVisible(false);
      return;
    }

    // `observe` delivers the current content box straight away, so there is no
    // separate initial measurement to make.
    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const inlineSize =
        entry.contentBoxSize[0]?.inlineSize ?? entry.contentRect.width;
      setVisible(inlineSize >= TOC_MIN_VISIBLE_WIDTH_PX);
    });
    resizeObserver.observe(host, { box: "content-box" });
    return () => resizeObserver.disconnect();
  }, [rootElement]);

  return visible;
}

function findTimelineRowElements(
  scrollElement: HTMLElement | null,
): HTMLElement[] {
  return scrollElement
    ? Array.from(
        scrollElement.querySelectorAll<HTMLElement>("[data-timeline-row-id]"),
      )
    : [];
}

function findTimelineRowElement(
  scrollElement: HTMLElement | null,
  rowId: string,
): HTMLElement | null {
  return (
    findTimelineRowElements(scrollElement).find(
      (row) => row.dataset.timelineRowId === rowId,
    ) ?? null
  );
}

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve();
      return;
    }
    window.requestAnimationFrame(() => resolve());
  });
}

function isScrollElementNearBottom(scrollElement: HTMLElement): boolean {
  return (
    scrollElement.scrollHeight -
      scrollElement.clientHeight -
      scrollElement.scrollTop <=
    TOC_BOTTOM_ACTIVE_THRESHOLD_PX
  );
}

function findFirstVisibleItemId({
  rows,
  scrollBottom,
  scrollTop,
}: {
  rows: readonly HTMLElement[];
  scrollBottom: number;
  scrollTop: number;
}): string | null {
  let low = 0;
  let high = rows.length - 1;
  let visibleRow: HTMLElement | null = null;
  let visibleRect: DOMRect | null = null;

  while (low <= high) {
    const index = low + Math.floor((high - low) / 2);
    const row = rows[index];
    if (!row) break;
    const rect = row.getBoundingClientRect();
    if (rect.bottom <= scrollTop) {
      low = index + 1;
      continue;
    }
    visibleRow = row;
    visibleRect = rect;
    high = index - 1;
  }

  if (!visibleRow || !visibleRect || visibleRect.top >= scrollBottom) {
    return null;
  }
  return visibleRow.dataset.timelineRowId ?? null;
}

function findLastVisibleItemId({
  rows,
  scrollBottom,
  scrollTop,
}: {
  rows: readonly HTMLElement[];
  scrollBottom: number;
  scrollTop: number;
}): string | null {
  let low = 0;
  let high = rows.length - 1;
  let visibleRow: HTMLElement | null = null;
  let visibleRect: DOMRect | null = null;

  while (low <= high) {
    const index = low + Math.floor((high - low) / 2);
    const row = rows[index];
    if (!row) break;
    const rect = row.getBoundingClientRect();
    if (rect.top >= scrollBottom) {
      high = index - 1;
      continue;
    }
    visibleRow = row;
    visibleRect = rect;
    low = index + 1;
  }

  if (!visibleRow || !visibleRect || visibleRect.bottom <= scrollTop) {
    return null;
  }
  return visibleRow.dataset.timelineRowId ?? null;
}

export function findActiveItemIds({
  agentItems,
  scrollElement,
  userItems,
}: {
  agentItems: readonly TocItem[];
  scrollElement: HTMLElement | null;
  userItems: readonly TocItem[];
}): ActiveItemIds {
  if (!scrollElement || (userItems.length === 0 && agentItems.length === 0)) {
    return { agent: null, user: null };
  }
  const scrollRect = scrollElement.getBoundingClientRect();
  const scrollTop = scrollRect.top;
  const scrollBottom = scrollRect.bottom;
  const isNearBottom = isScrollElementNearBottom(scrollElement);
  const rolesById = new Map<string, TocTab>();
  for (const item of userItems) rolesById.set(item.id, "user");
  for (const item of agentItems) rolesById.set(item.id, "agent");
  const userRows: HTMLElement[] = [];
  const agentRows: HTMLElement[] = [];

  for (const row of findTimelineRowElements(scrollElement)) {
    const rowId = row.dataset.timelineRowId;
    if (!rowId) continue;
    const role = rolesById.get(rowId);
    if (role === "user") {
      userRows.push(row);
    } else if (role === "agent") {
      agentRows.push(row);
    }
  }

  // Conversation rows are non-overlapping and retain document order, so their
  // top/bottom edges are monotonic within each role. The former full scan
  // measured every loaded conversation row on every animation-frame scroll
  // update; binary search keeps the same nearest/last-visible semantics with
  // logarithmic layout reads.
  if (isNearBottom) {
    return {
      agent: findLastVisibleItemId({
        rows: agentRows,
        scrollBottom,
        scrollTop,
      }),
      user: findLastVisibleItemId({
        rows: userRows,
        scrollBottom,
        scrollTop,
      }),
    };
  }

  return {
    agent: findFirstVisibleItemId({
      rows: agentRows,
      scrollBottom,
      scrollTop,
    }),
    user: findFirstVisibleItemId({
      rows: userRows,
      scrollBottom,
      scrollTop,
    }),
  };
}

export function ThreadTableOfContents({
  threadId,
  timelineRows,
  hasOlderTimelineRows,
  loadOlderTimelineRows,
}: ThreadTableOfContentsProps) {
  const bottomAnchor = useBottomAnchoredScroll();
  const [rootElement, setRootElement] = useState<HTMLElement | null>(null);
  const tocVisible = useThreadTocVisible(rootElement);
  // The full-thread outline exists only for the wide-layout TOC. Waiting for
  // both its visible container and the first timeline window keeps compact
  // clients from rebuilding an invisible outline on every appended-event batch.
  const outlineQuery = useThreadConversationOutline(threadId, {
    enabled: tocVisible && timelineRows.length > 0,
  });
  const senderThreadMetadataById = useSenderThreadMetadataById();
  const { agentItems, userItems } = useConversationTocItems({
    outlineItems: outlineQuery.data?.items,
    timelineRows,
  });
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TocTab>("user");
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [pendingJumpId, setPendingJumpId] = useState<string | null>(null);
  const {
    aboveOverflow,
    belowOverflow,
    bottomSentinelRef,
    scrollRef,
    topSentinelRef,
  } = useScrollOverflowState<HTMLDivElement>({
    enabled: open,
    measureOverflow: true,
  });
  const itemEls = useRef(new Map<string, HTMLElement>());
  const activeIdsRef = useRef<ActiveItemIds>({ agent: null, user: null });
  const hasAgentMessages = agentItems.length > 0;
  const activeTab = tab === "agent" && hasAgentMessages ? "agent" : "user";
  const items = activeTab === "user" ? userItems : agentItems;
  const activeId = activeTab === "user" ? activeUserId : activeAgentId;
  const railItems = useMemo(
    () => selectTocRailItems({ activeId: activeUserId, items: userItems }),
    [activeUserId, userItems],
  );

  // Mirror the latest pagination props into refs so the async jump loop always
  // reads current values rather than the ones captured when the click fired.
  const hasOlderRef = useRef(hasOlderTimelineRows);
  hasOlderRef.current = hasOlderTimelineRows;
  const loadOlderRef = useRef(loadOlderTimelineRows);
  loadOlderRef.current = loadOlderTimelineRows;
  const jumpInProgressRef = useRef(false);
  // Switching threads remounts this component (PageShell is keyed by threadId).
  // The jump loop checks this after each await so it stops paginating a thread
  // the user has already left instead of firing requests against a stale closure.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!tocVisible) return;
    const scrollElement = bottomAnchor?.getScrollElement();
    if (!scrollElement) return;
    const publishActiveItems = (nextActiveIds: ActiveItemIds) => {
      const currentActiveIds = activeIdsRef.current;
      if (nextActiveIds.user !== currentActiveIds.user) {
        setActiveUserId(nextActiveIds.user);
      }
      if (nextActiveIds.agent !== currentActiveIds.agent) {
        setActiveAgentId(nextActiveIds.agent);
      }
      activeIdsRef.current = nextActiveIds;
    };
    const updateActiveItems = () => {
      publishActiveItems(
        findActiveItemIds({ agentItems, scrollElement, userItems }),
      );
    };
    let updateTimeout: number | null = null;
    const scheduleActiveItemsUpdate = () => {
      if (updateTimeout !== null) {
        window.clearTimeout(updateTimeout);
      }
      updateTimeout = window.setTimeout(() => {
        updateTimeout = null;
        updateActiveItems();
      }, TOC_ACTIVE_UPDATE_IDLE_MS);
    };
    scheduleActiveItemsUpdate();
    scrollElement.addEventListener("scroll", scheduleActiveItemsUpdate, {
      passive: true,
    });
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleActiveItemsUpdate);
    resizeObserver?.observe(scrollElement);

    return () => {
      scrollElement.removeEventListener("scroll", scheduleActiveItemsUpdate);
      resizeObserver?.disconnect();
      if (updateTimeout !== null) {
        window.clearTimeout(updateTimeout);
      }
    };
  }, [agentItems, bottomAnchor, tocVisible, userItems]);

  useEffect(() => {
    if (!tocVisible || !open) return;
    const container = scrollRef.current;
    const el = activeId ? itemEls.current.get(activeId) : null;
    if (!container || !el) return;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const pad = 8;
    if (elRect.top < containerRect.top + pad) {
      container.scrollTo({
        top: container.scrollTop - (containerRect.top + pad - elRect.top),
      });
    } else if (elRect.bottom > containerRect.bottom - pad) {
      container.scrollTo({
        top:
          container.scrollTop + (elRect.bottom - (containerRect.bottom - pad)),
      });
    }
  }, [activeId, open, scrollRef, tocVisible]);

  const handleSelect = useCallback(
    async (id: string) => {
      const getScrollElement = () => bottomAnchor?.getScrollElement() ?? null;
      const scrollToRow = (element: HTMLElement) => {
        bottomAnchor?.scrollElementIntoView({
          element,
          options: { block: "start", inline: "nearest" },
        });
      };

      let row = findTimelineRowElement(getScrollElement(), id);
      if (row) {
        scrollToRow(row);
        return;
      }
      // The target message hasn't been paginated into the loaded window yet.
      // Page older windows in until it appears (or history is exhausted), then
      // scroll to it.
      if (jumpInProgressRef.current) return;
      jumpInProgressRef.current = true;
      setPendingJumpId(id);
      try {
        let loads = 0;
        while (!row && hasOlderRef.current && loads < TOC_JUMP_MAX_PAGE_LOADS) {
          loads += 1;
          try {
            await Promise.resolve(loadOlderRef.current());
          } catch {
            // Pagination failed (offline / server error). History can't
            // advance, so stop looping; the post-loop lookup below still
            // scrolls if enough was already loaded. Catching here keeps the
            // rejection from escaping the fire-and-forget `void handleSelect`
            // call as an unhandled rejection.
            break;
          }
          if (!mountedRef.current) return;
          // Wait for the prepended rows to commit, retrying across a few frames
          // before deciding the row is in an even older page.
          for (let frame = 0; frame < TOC_JUMP_RENDER_FRAMES && !row; frame++) {
            await waitForAnimationFrame();
            if (!mountedRef.current) return;
            row = findTimelineRowElement(getScrollElement(), id);
          }
        }
        // If the row still isn't loaded after exhausting older pages the jump is
        // a no-op. Outline ids are projected by the same builder as timeline
        // rows, so a visible-but-unreachable entry is effectively impossible; we
        // fail silently rather than surface an error for a row the user sees.
        if (!row) row = findTimelineRowElement(getScrollElement(), id);
        if (row) scrollToRow(row);
      } finally {
        jumpInProgressRef.current = false;
        setPendingJumpId(null);
      }
    },
    [bottomAnchor],
  );

  if (userItems.length < TOC_MIN_USER_MESSAGES) {
    return <span ref={setRootElement} aria-hidden className="hidden" />;
  }

  return (
    <div
      ref={setRootElement}
      data-thread-toc=""
      className="group/toc relative w-8"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={(event) => {
        if (event.currentTarget.contains(document.activeElement)) return;
        setOpen(false);
      }}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setOpen(false);
        }
      }}
    >
      {tocVisible ? (
        <div className="relative">
          <button
            type="button"
            aria-label="Thread table of contents"
            aria-expanded={open}
            aria-controls={`thread-toc-panel-${threadId}`}
            onClick={() => setOpen(true)}
            className="no-scrollbar flex max-h-[calc(100vh-7rem)] w-8 cursor-pointer flex-col items-center gap-2 overflow-y-auto py-2"
          >
            <span
              aria-hidden
              className="flex w-full flex-col items-center gap-2"
            >
              {railItems.map((item) => (
                <span
                  key={item.id}
                  className={cn(
                    "h-[3px] shrink-0 rounded-full transition-all duration-150",
                    item.id === activeUserId
                      ? "w-5 bg-foreground/30 group-hover/toc:bg-foreground/70"
                      : "w-3 bg-foreground/5 group-hover/toc:bg-foreground/20",
                  )}
                />
              ))}
            </span>
          </button>

          {open ? (
            <div
              id={`thread-toc-panel-${threadId}`}
              className="pointer-events-auto absolute right-full top-0 w-[18.25rem] max-w-[calc(100vw-3rem)] pr-1"
            >
              <div className="rounded-lg border border-border bg-popover p-1 shadow-lg">
                <div className="flex items-center gap-1 pb-1">
                  {hasAgentMessages ? (
                    <TocPanelTab
                      label="Agent messages"
                      active={activeTab === "agent"}
                      onSelect={() => setTab("agent")}
                    />
                  ) : null}
                  <TocPanelTab
                    label="Your messages"
                    active={activeTab === "user"}
                    onSelect={() => setTab("user")}
                  />
                </div>
                <div className="relative isolate">
                  <div
                    ref={scrollRef}
                    className="max-h-64 overflow-y-auto overflow-x-hidden"
                  >
                    <div
                      ref={topSentinelRef}
                      aria-hidden
                      className="h-px w-full"
                    />
                    <ul className="flex flex-col">
                      {items.map((item) => {
                        const active = item.id === activeId;
                        const pending = item.id === pendingJumpId;
                        return (
                          <li key={item.id}>
                            <button
                              ref={(node) => {
                                if (node) itemEls.current.set(item.id, node);
                                else itemEls.current.delete(item.id);
                              }}
                              type="button"
                              aria-busy={pending}
                              onClick={() => {
                                void handleSelect(item.id);
                              }}
                              className={cn(
                                "flex w-full cursor-pointer rounded-md px-2 py-1.5 text-left transition-colors",
                                active
                                  ? "bg-state-hover"
                                  : "hover:bg-state-hover",
                              )}
                            >
                              <span
                                className={cn(
                                  "text-xs leading-snug",
                                  active
                                    ? "text-foreground"
                                    : "text-muted-foreground",
                                  pending && "animate-pulse",
                                )}
                              >
                                <TocItemPreview
                                  item={item}
                                  senderThreadMetadataById={
                                    senderThreadMetadataById
                                  }
                                />
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    <div
                      ref={bottomSentinelRef}
                      aria-hidden
                      className="h-px w-full"
                    />
                  </div>
                  {aboveOverflow ? (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-popover/90 via-popover/60 to-transparent"
                    />
                  ) : null}
                  {belowOverflow ? (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-popover/90 via-popover/60 to-transparent"
                    />
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
