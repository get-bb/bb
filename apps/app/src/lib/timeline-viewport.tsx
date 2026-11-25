import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { ExperimentalTimelineViewport } from "@get-bb/plugin-sdk";
import { observeSharedResize } from "@bb/shared-ui/lib/shared-resize-observer";
import { useBottomAnchoredScroll } from "@/components/ui/bottom-anchored-scroll-body.js";

export const TIMELINE_VIEWPORT_SETTLE_MS = 120;
const AT_LATEST_THRESHOLD_PX = 4;
const EMPTY_VIEWPORT: ExperimentalTimelineViewport = {
  visibleMessageIds: [],
  atLatest: false,
};

function isAtLatest(scrollElement: HTMLElement): boolean {
  return (
    scrollElement.scrollHeight -
      scrollElement.clientHeight -
      scrollElement.scrollTop <=
    AT_LATEST_THRESHOLD_PX
  );
}

export function readTimelineViewport(
  scrollElement: HTMLElement,
  messageIds: ReadonlySet<string>,
): ExperimentalTimelineViewport {
  const rows: HTMLElement[] = [];
  for (const row of scrollElement.querySelectorAll<HTMLElement>(
    "[data-timeline-row-id]",
  )) {
    const id = row.dataset.timelineRowId;
    if (id !== undefined && messageIds.has(id)) rows.push(row);
  }
  const { top, bottom } = scrollElement.getBoundingClientRect();
  let low = 0;
  let high = rows.length - 1;
  let first = rows.length;
  while (low <= high) {
    const index = low + Math.floor((high - low) / 2);
    if (rows[index].getBoundingClientRect().bottom <= top) {
      low = index + 1;
    } else {
      first = index;
      high = index - 1;
    }
  }
  const visibleMessageIds: string[] = [];
  for (let index = first; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.getBoundingClientRect().top >= bottom) break;
    visibleMessageIds.push(row.dataset.timelineRowId ?? "");
  }
  return { visibleMessageIds, atLatest: isAtLatest(scrollElement) };
}

function sameViewport(
  left: ExperimentalTimelineViewport,
  right: ExperimentalTimelineViewport,
): boolean {
  if (left.atLatest !== right.atLatest) return false;
  if (left.visibleMessageIds.length !== right.visibleMessageIds.length) {
    return false;
  }
  return left.visibleMessageIds.every(
    (id, index) => id === right.visibleMessageIds[index],
  );
}

export interface TimelineViewportStore {
  get(): ExperimentalTimelineViewport;
  setMessageIds(messageIds: ReadonlySet<string>): void;
  setScrollSource(getScrollElement: (() => HTMLElement | null) | null): void;
  subscribe(listener: () => void): () => void;
}

export function createTimelineViewportStore(): TimelineViewportStore {
  let viewport = EMPTY_VIEWPORT;
  let messageIds: ReadonlySet<string> = new Set();
  const listeners = new Set<() => void>();
  let getScrollElement: () => HTMLElement | null = () => null;
  let attached: { element: HTMLElement; detach: () => void } | null = null;
  let timeout: number | null = null;

  const update = () => {
    timeout = null;
    const scrollElement = getScrollElement();
    if (scrollElement === null) return;
    const next = readTimelineViewport(scrollElement, messageIds);
    if (sameViewport(viewport, next)) return;
    viewport = next;
    for (const listener of listeners) listener();
  };
  const schedule = () => {
    if (listeners.size === 0) return;
    if (timeout !== null) window.clearTimeout(timeout);
    timeout = window.setTimeout(update, TIMELINE_VIEWPORT_SETTLE_MS);
  };
  const detach = () => {
    attached?.detach();
    attached = null;
  };
  const attach = () => {
    const element = listeners.size === 0 ? null : getScrollElement();
    if (element === attached?.element) return;
    detach();
    if (element === null) return;
    element.addEventListener("scroll", schedule, { passive: true });
    const unobserveResize =
      typeof ResizeObserver === "undefined"
        ? null
        : observeSharedResize(element, {
            read: () => undefined,
            write: schedule,
          });
    attached = {
      element,
      detach: () => {
        element.removeEventListener("scroll", schedule);
        unobserveResize?.();
      },
    };
    schedule();
  };

  return {
    get: () => viewport,
    setMessageIds(next) {
      messageIds = next;
      schedule();
    },
    setScrollSource(next) {
      getScrollElement = next ?? (() => null);
      attach();
    },
    subscribe(listener) {
      listeners.add(listener);
      attach();
      schedule();
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        detach();
        if (timeout !== null) window.clearTimeout(timeout);
        timeout = null;
      };
    },
  };
}

interface TimelineViewportPane {
  threadId: string;
  store: TimelineViewportStore;
}

const TimelineViewportContext = createContext<TimelineViewportPane | null>(
  null,
);

export function TimelineViewportProvider({
  children,
  messageIds,
  threadId,
}: {
  children: ReactNode;
  messageIds: ReadonlySet<string>;
  threadId: string;
}) {
  const [store] = useState(createTimelineViewportStore);
  useEffect(() => {
    store.setMessageIds(messageIds);
  }, [messageIds, store]);
  const pane = useMemo(() => ({ threadId, store }), [store, threadId]);
  return (
    <TimelineViewportContext.Provider value={pane}>
      {children}
    </TimelineViewportContext.Provider>
  );
}

export function useTimelinePaneThreadId(): string | null {
  return useContext(TimelineViewportContext)?.threadId ?? null;
}

export function TimelineViewportScrollSource(): null {
  const store = useContext(TimelineViewportContext)?.store ?? null;
  const getScrollElement = useBottomAnchoredScroll()?.getScrollElement ?? null;
  useEffect(() => {
    if (store === null) return;
    store.setScrollSource(getScrollElement);
    return () => store.setScrollSource(null);
  }, [getScrollElement, store]);
  return null;
}

const NO_SUBSCRIPTION = () => () => {};
const NO_VIEWPORT = () => null;

export function useTimelineViewport(): ExperimentalTimelineViewport | null {
  const store = useContext(TimelineViewportContext)?.store ?? null;
  return useSyncExternalStore(
    store === null ? NO_SUBSCRIPTION : store.subscribe,
    store === null ? NO_VIEWPORT : store.get,
  );
}
