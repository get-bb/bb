import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ThreadConversationOutlineItem,
  TimelineConversationAttachments,
  TimelineRow,
} from "@bb/server-contract";
import { useScrollOverflowState } from "@/components/thread/timeline/useScrollOverflowState";
import { useBottomAnchoredScroll } from "@/components/ui/bottom-anchored-scroll-body.js";
import { useThreadConversationOutline } from "@/hooks/queries/thread-queries";
import { cn } from "@bb/shared-ui/lib/utils";

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

const TOC_MIN_VISIBLE_WIDTH_PX = 56 * 16;
const TOC_BOTTOM_ACTIVE_THRESHOLD_PX = 4;
// Only worth showing once the conversation has enough user turns to navigate.
const TOC_MIN_USER_MESSAGES = 3;
const TOC_MAX_RAIL_TICKS = 20;
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
  return useMemo(() => {
    const userItems: TocItem[] = [];
    const agentItems: TocItem[] = [];

    if (outlineItems && outlineItems.length > 0) {
      for (const item of outlineItems) {
        const tocItem = outlineItemToTocItem(item);
        if (tocItem.role === "user") {
          userItems.push(tocItem);
        } else {
          agentItems.push(tocItem);
        }
      }
      return { agentItems, userItems };
    }

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
  }, [outlineItems, timelineRows]);
}

function useThreadTocVisible(rootElement: HTMLDivElement | null): boolean {
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

    let frame: number | null = null;
    const measure = () => {
      frame = null;
      setVisible(host.clientWidth >= TOC_MIN_VISIBLE_WIDTH_PX);
    };
    const scheduleMeasure = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(measure);
    };

    scheduleMeasure();
    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(host);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
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
  let nearestUser: { id: string; distance: number } | null = null;
  let nearestAgent: { id: string; distance: number } | null = null;
  let lastVisibleUserId: string | null = null;
  let lastVisibleAgentId: string | null = null;

  for (const row of findTimelineRowElements(scrollElement)) {
    const rowId = row.dataset.timelineRowId;
    if (!rowId) continue;
    const role = rolesById.get(rowId);
    if (!role) continue;
    const rect = row.getBoundingClientRect();
    if (rect.bottom <= scrollTop || rect.top >= scrollBottom) continue;
    if (isNearBottom) {
      if (role === "user") {
        lastVisibleUserId = rowId;
      } else {
        lastVisibleAgentId = rowId;
      }
      continue;
    }
    const distance =
      rect.top <= scrollTop
        ? Math.max(0, scrollTop - rect.bottom)
        : rect.top - scrollTop;
    const nearest = { id: rowId, distance };
    if (role === "user") {
      if (!nearestUser || distance < nearestUser.distance) {
        nearestUser = nearest;
      }
    } else if (!nearestAgent || distance < nearestAgent.distance) {
      nearestAgent = nearest;
    }
  }

  if (isNearBottom) {
    return { agent: lastVisibleAgentId, user: lastVisibleUserId };
  }

  return { agent: nearestAgent?.id ?? null, user: nearestUser?.id ?? null };
}

export function ThreadTableOfContents({
  threadId,
  timelineRows,
  hasOlderTimelineRows,
  loadOlderTimelineRows,
}: ThreadTableOfContentsProps) {
  const bottomAnchor = useBottomAnchoredScroll();
  // Source the minimap from the full thread outline. Enabled whenever the
  // thread id is present (not gated on `tocVisible`): the TOC_MIN_USER_MESSAGES
  // early-return can unmount the root before it is measured, and gating the
  // query on visibility would then deadlock a short loaded window that the full
  // thread would otherwise fill.
  const outlineQuery = useThreadConversationOutline(threadId);
  const { agentItems, userItems } = useConversationTocItems({
    outlineItems: outlineQuery.data?.items,
    timelineRows,
  });
  const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null);
  const tocVisible = useThreadTocVisible(rootElement);
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
    measureOverflow: true,
  });
  const railRef = useRef<HTMLDivElement>(null);
  const tickEls = useRef(new Map<string, HTMLElement>());
  const itemEls = useRef(new Map<string, HTMLElement>());
  const activeIdsRef = useRef<ActiveItemIds>({ agent: null, user: null });
  const activeUpdateFrameRef = useRef<number | null>(null);
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

  const updateActiveItems = useCallback(() => {
    const scrollElement = bottomAnchor?.getScrollElement() ?? null;
    const nextActiveIds = findActiveItemIds({
      agentItems,
      scrollElement,
      userItems,
    });
    const currentActiveIds = activeIdsRef.current;
    if (nextActiveIds.user !== currentActiveIds.user) {
      setActiveUserId(nextActiveIds.user);
    }
    if (nextActiveIds.agent !== currentActiveIds.agent) {
      setActiveAgentId(nextActiveIds.agent);
    }
    activeIdsRef.current = nextActiveIds;
  }, [agentItems, bottomAnchor, userItems]);

  const scheduleActiveItemsUpdate = useCallback(() => {
    if (activeUpdateFrameRef.current !== null) return;
    activeUpdateFrameRef.current = window.requestAnimationFrame(() => {
      activeUpdateFrameRef.current = null;
      updateActiveItems();
    });
  }, [updateActiveItems]);

  useEffect(() => {
    if (!tocVisible) return;
    scheduleActiveItemsUpdate();
    const scrollElement = bottomAnchor?.getScrollElement();
    if (!scrollElement) return;
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
      if (activeUpdateFrameRef.current !== null) {
        window.cancelAnimationFrame(activeUpdateFrameRef.current);
        activeUpdateFrameRef.current = null;
      }
    };
  }, [bottomAnchor, scheduleActiveItemsUpdate, tocVisible]);

  // Keep the active tick visible if the rail overflows in constrained layouts.
  useEffect(() => {
    if (!tocVisible) return;
    const container = railRef.current;
    const el = activeUserId ? tickEls.current.get(activeUserId) : null;
    if (!container || !el) return;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const pad = 12;
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
    // `railItems` is a dep so the active tick re-centers when the rail content
    // swaps (e.g. the full outline replacing the loaded-window fallback).
  }, [activeUserId, railItems, tocVisible]);

  useEffect(() => {
    if (!tocVisible) return;
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

  if (userItems.length < TOC_MIN_USER_MESSAGES) return null;

  return (
    <div
      ref={setRootElement}
      data-thread-toc=""
      className="group/toc relative w-8"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setOpen(false);
        }
      }}
    >
      {tocVisible ? (
        <div className="relative">
          <div
            ref={railRef}
            aria-hidden
            className="no-scrollbar flex max-h-[calc(100vh-7rem)] w-8 cursor-pointer flex-col items-center gap-2 overflow-y-auto py-2"
          >
            {railItems.map((item) => (
              <span
                key={item.id}
                ref={(node) => {
                  if (node) tickEls.current.set(item.id, node);
                  else tickEls.current.delete(item.id);
                }}
                className={cn(
                  "h-[3px] shrink-0 rounded-full transition-all duration-150",
                  item.id === activeUserId
                    ? "w-5 bg-foreground/30 group-hover/toc:bg-foreground/70"
                    : "w-3 bg-foreground/5 group-hover/toc:bg-foreground/20",
                )}
              />
            ))}
          </div>

          <div
            className={cn(
              "absolute right-full top-0 w-[18.25rem] max-w-[calc(100vw-3rem)] pr-1 transition-all duration-150",
              open
                ? "pointer-events-auto translate-x-0 opacity-100"
                : "pointer-events-none translate-x-1 opacity-0",
            )}
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
                                "line-clamp-2 text-xs leading-snug",
                                active
                                  ? "text-foreground"
                                  : "text-muted-foreground",
                                pending && "animate-pulse",
                              )}
                            >
                              {item.label}
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
        </div>
      ) : null}
    </div>
  );
}
