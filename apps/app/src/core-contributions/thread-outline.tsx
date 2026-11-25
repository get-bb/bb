import { useEffect, useRef, useState } from "react";
import type {
  ExperimentalConversationOutlineItem,
  ExperimentalThreadRailOutlineProps,
  ExperimentalTimelineViewport,
} from "@get-bb/plugin-sdk";
import {
  definePluginApp,
  experimental_describePromptMention,
  experimental_PromptMentionIcon as PromptMentionIcon,
  experimental_useConversationOutline as useConversationOutline,
  experimental_useThread as useThread,
  experimental_useThreadTitleDisplayText as useThreadTitleDisplayText,
  experimental_useTimelineViewport as useTimelineViewport,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { cn } from "@bb/shared-ui/lib/utils";
import { useScrollOverflowState } from "@bb/shared-ui/use-scroll-overflow-state";

type OutlineTab = "user" | "agent";

const MIN_USER_MESSAGES = 3;
const MAX_RAIL_TICKS = 20;

function attachmentLabel(
  summary: ExperimentalConversationOutlineItem["attachmentSummary"],
): string {
  if (summary === null) return "Message";
  const { imageCount, fileCount } = summary;
  const total = imageCount + fileCount;
  if (total === 1) {
    return imageCount === 1 ? "Image attachment" : "File attachment";
  }
  return `${total} attachments`;
}

function itemLabel(item: ExperimentalConversationOutlineItem): string {
  if (item.preview) return item.preview;
  return item.senderThreadId === null
    ? attachmentLabel(item.attachmentSummary)
    : "Message";
}

function selectRailItems(
  items: readonly ExperimentalConversationOutlineItem[],
  activeId: string | null,
): readonly ExperimentalConversationOutlineItem[] {
  if (items.length <= MAX_RAIL_TICKS) return items;
  const maxIndex = items.length - 1;
  const activeIndex =
    activeId === null ? -1 : items.findIndex((item) => item.id === activeId);
  const sampled = new Set<number>();
  for (let slot = 0; slot < MAX_RAIL_TICKS; slot += 1) {
    sampled.add(Math.round((slot * maxIndex) / (MAX_RAIL_TICKS - 1)));
  }
  if (activeIndex >= 0) {
    sampled.add(activeIndex);
    if (sampled.size > MAX_RAIL_TICKS) {
      let removable: number | null = null;
      let removableDistance = Number.POSITIVE_INFINITY;
      for (const index of sampled) {
        if (index === activeIndex || index === 0 || index === maxIndex) {
          continue;
        }
        const distance = Math.abs(index - activeIndex);
        if (distance < removableDistance) {
          removable = index;
          removableDistance = distance;
        }
      }
      if (removable !== null) sampled.delete(removable);
    }
  }
  return Array.from(sampled)
    .sort((left, right) => left - right)
    .map((index) => items[index]);
}

function activeItemId(
  items: readonly ExperimentalConversationOutlineItem[],
  viewport: ExperimentalTimelineViewport | null,
): string | null {
  if (viewport === null || items.length === 0) return null;
  const ids = new Set(items.map((item) => item.id));
  const visible = viewport.visibleMessageIds.filter((id) => ids.has(id));
  return (viewport.atLatest ? visible.at(-1) : visible[0]) ?? null;
}

function senderTitle(state: ReturnType<typeof useThread>): string | null {
  if (state.status !== "ready") return null;
  return (
    state.thread.title?.trim() || state.thread.titleFallback?.trim() || null
  );
}

function SenderMention({ threadId }: { threadId: string }) {
  const label = useThreadTitleDisplayText(
    senderTitle(useThread(threadId)) ?? "Agent",
  );
  const mention = { kind: "thread", threadId, label } as const;
  return (
    <span
      className={cn(
        experimental_describePromptMention(mention).className,
        "max-w-32 shrink-0 bg-surface-raised/50 text-foreground",
      )}
      title={`Thread: ${label}`}
    >
      <PromptMentionIcon
        mention={mention}
        className="size-3 shrink-0 self-center text-muted-foreground"
      />
      <span className="truncate">{label}</span>
    </span>
  );
}

function ItemPreview({ item }: { item: ExperimentalConversationOutlineItem }) {
  if (item.senderThreadId === null) {
    return <span className="line-clamp-2">{itemLabel(item)}</span>;
  }
  return (
    <span className="flex min-w-0 items-start gap-1">
      <SenderMention threadId={item.senderThreadId} />
      <span className="line-clamp-2 min-w-0">{itemLabel(item)}</span>
    </span>
  );
}

function OutlineTabButton({
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

interface OutlinePanelProps {
  threadId: string;
  visible: boolean;
  tab: OutlineTab;
  onTabChange: (tab: OutlineTab) => void;
  userItems: readonly ExperimentalConversationOutlineItem[];
  activeUserId: string | null;
  viewport: ExperimentalTimelineViewport | null;
}

function OutlinePanel({
  threadId,
  visible,
  tab,
  onTabChange,
  userItems,
  activeUserId,
  viewport,
}: OutlinePanelProps) {
  const navigate = useBbNavigate();
  const agentItems = useConversationOutline(threadId, "assistant", {
    enabled: visible && tab === "agent",
  }).items;
  const activeAgentId = activeItemId(agentItems, viewport);
  const {
    aboveOverflow,
    belowOverflow,
    bottomSentinelRef,
    scrollRef,
    topSentinelRef,
  } = useScrollOverflowState<HTMLDivElement>({ measureOverflow: true });
  const itemElements = useRef(new Map<string, HTMLElement>());
  const hasAgentMessages = agentItems.length > 0;
  const activeTab = tab === "agent" && hasAgentMessages ? "agent" : "user";
  const items = activeTab === "user" ? userItems : agentItems;
  const activeId = activeTab === "user" ? activeUserId : activeAgentId;

  useEffect(() => {
    if (!visible) return;
    const container = scrollRef.current;
    const element = activeId ? itemElements.current.get(activeId) : null;
    if (!container || !element) return;
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const pad = 8;
    if (elementRect.top < containerRect.top + pad) {
      container.scrollTo({
        top: container.scrollTop - (containerRect.top + pad - elementRect.top),
      });
    } else if (elementRect.bottom > containerRect.bottom - pad) {
      container.scrollTo({
        top:
          container.scrollTop +
          (elementRect.bottom - (containerRect.bottom - pad)),
      });
    }
  }, [activeId, items, scrollRef, visible]);

  return (
    <div
      id={`thread-toc-panel-${threadId}`}
      className="pointer-events-auto absolute right-full top-0 w-[18.25rem] max-w-[calc(100vw-3rem)] pr-1"
    >
      <div className="rounded-lg border border-border bg-popover p-1 shadow-lg">
        <div className="flex items-center gap-1 pb-1">
          {hasAgentMessages ? (
            <OutlineTabButton
              label="Agent messages"
              active={activeTab === "agent"}
              onSelect={() => onTabChange("agent")}
            />
          ) : null}
          <OutlineTabButton
            label="Your messages"
            active={activeTab === "user"}
            onSelect={() => onTabChange("user")}
          />
        </div>
        <div className="relative isolate">
          <div
            ref={scrollRef}
            className="max-h-64 overflow-y-auto overflow-x-hidden"
          >
            <div ref={topSentinelRef} aria-hidden className="h-px w-full" />
            <ul className="flex flex-col">
              {items.map((item) => {
                const active = item.id === activeId;
                return (
                  <li key={item.id}>
                    <button
                      ref={(node) => {
                        if (node) itemElements.current.set(item.id, node);
                        else itemElements.current.delete(item.id);
                      }}
                      type="button"
                      onClick={() =>
                        navigate.toThread(threadId, {
                          messageSeq: item.messageSeq,
                        })
                      }
                      className={cn(
                        "flex w-full cursor-pointer rounded-md px-2 py-1.5 text-left transition-colors",
                        active ? "bg-state-hover" : "hover:bg-state-hover",
                      )}
                    >
                      <span
                        className={cn(
                          "text-xs leading-snug",
                          active ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        <ItemPreview item={item} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div ref={bottomSentinelRef} aria-hidden className="h-px w-full" />
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
  );
}

function ThreadOutline({
  threadId,
  visible,
}: ExperimentalThreadRailOutlineProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<OutlineTab>("user");
  const userItems = useConversationOutline(threadId, "user", {
    enabled: visible,
  }).items;
  const viewport = useTimelineViewport();
  const activeUserId = activeItemId(userItems, viewport);
  const railItems = selectRailItems(userItems, activeUserId);

  if (userItems.length < MIN_USER_MESSAGES) return null;

  return (
    <div
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
      <div className="relative">
        <button
          type="button"
          aria-label="Thread table of contents"
          aria-expanded={open}
          aria-controls={`thread-toc-panel-${threadId}`}
          onClick={() => setOpen(true)}
          className="no-scrollbar flex max-h-[calc(100vh-7rem)] w-8 cursor-pointer flex-col items-center gap-2 overflow-y-auto py-2"
        >
          <span aria-hidden className="flex w-full flex-col items-center gap-2">
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
          <OutlinePanel
            threadId={threadId}
            visible={visible}
            tab={tab}
            onTabChange={setTab}
            userItems={userItems}
            activeUserId={activeUserId}
            viewport={viewport}
          />
        ) : null}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadRailOutline({
    id: "outline",
    component: ThreadOutline,
  });
});
