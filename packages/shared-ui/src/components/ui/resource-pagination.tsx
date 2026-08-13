import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "./button";
import { Icon } from "./icon";
import { cn } from "../../lib/utils";

export const RESOURCE_LIST_PAGE_SIZE = 10;
export const RESOURCE_GRID_PAGE_SIZE = 12;

interface ResourcePaginationOptions {
  pageSize?: number;
  /** Changes when search, filters, or sorting define a new projection. */
  resetKey?: string;
}

interface ResourcePaginationResult<Item> {
  items: readonly Item[];
  page: number;
  pageSize: number;
  total: number;
  visibleCount: number;
  setPage: (page: number) => void;
}

interface ResourceViewportPageSizeOptions {
  fallbackPageSize?: number;
}

function cssPixelValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function measureResourceViewportPageSize(
  viewport: HTMLElement,
  fallbackPageSize: number,
): number {
  const availableHeight = viewport.clientHeight;
  const panel = viewport.querySelector<HTMLElement>(
    "[data-resource-list-panel]",
  );
  if (availableHeight <= 0 || panel === null) return fallbackPageSize;

  const rowHeights = Array.from(
    panel.querySelectorAll<HTMLElement>("[data-resource-row]"),
    (row) => row.getBoundingClientRect().height,
  ).filter((height) => Number.isFinite(height) && height > 0);
  if (rowHeights.length === 0) return fallbackPageSize;

  const panelStyle = panel.ownerDocument.defaultView?.getComputedStyle(panel);
  const panelChromeHeight = panelStyle
    ? cssPixelValue(panelStyle.paddingTop) +
      cssPixelValue(panelStyle.paddingBottom) +
      cssPixelValue(panelStyle.borderTopWidth) +
      cssPixelValue(panelStyle.borderBottomWidth)
    : 0;
  const rowHeight = Math.max(...rowHeights);
  return Math.max(
    1,
    Math.floor((availableHeight - panelChromeHeight) / rowHeight),
  );
}

/** Fits complete resource rows into a measured collection scroll viewport. */
export function useResourceViewportPageSize(
  viewport: HTMLElement | null,
  options: ResourceViewportPageSizeOptions = {},
): number {
  const fallbackPageSize = Math.max(
    1,
    Math.floor(options.fallbackPageSize ?? RESOURCE_LIST_PAGE_SIZE),
  );
  const [pageSize, setPageSize] = useState(fallbackPageSize);

  useEffect(() => {
    if (viewport === null) return;
    const viewportElement = viewport;

    let observedPanel: HTMLElement | null = null;
    let resizeObserver: ResizeObserver | null = null;

    function observeCurrentPanel() {
      const panel = viewportElement.querySelector<HTMLElement>(
        "[data-resource-list-panel]",
      );
      if (panel === observedPanel) return;
      if (observedPanel !== null) resizeObserver?.unobserve(observedPanel);
      observedPanel = panel;
      if (observedPanel !== null) resizeObserver?.observe(observedPanel);
    }

    function measure() {
      observeCurrentPanel();
      const nextPageSize = measureResourceViewportPageSize(
        viewportElement,
        fallbackPageSize,
      );
      setPageSize((current) =>
        current === nextPageSize ? current : nextPageSize,
      );
    }

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(viewportElement);
    }
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(measure);
    mutationObserver?.observe(viewportElement, {
      childList: true,
      subtree: true,
    });
    measure();

    return () => {
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
    };
  }, [fallbackPageSize, viewport]);

  return viewport === null ? fallbackPageSize : pageSize;
}

/**
 * Client-side pagination for the bounded arrays returned by resource APIs.
 * The selected page resets with the projection and clamps when live data
 * shrinks, while retaining the current page across ordinary data refreshes.
 * A changing page size rescales the selection to keep the same rows in view
 * rather than resetting it.
 */
export function useResourcePagination<Item>(
  items: readonly Item[],
  options: ResourcePaginationOptions = {},
): ResourcePaginationResult<Item> {
  const pageSize = Math.max(
    1,
    Math.floor(options.pageSize ?? RESOURCE_LIST_PAGE_SIZE),
  );
  const resetKey = options.resetKey ?? "";
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  // Anchors the selected page to the page size it was selected under. Only an
  // explicit setPage or a new projection writes it; the rendered page is derived
  // from it. Mirroring the derived page back from an effect used to drop clicks:
  // a viewport measurement that changed pageSize left a queued write-back
  // holding the pre-click page, which then overwrote the interaction.
  const [anchor, setAnchor] = useState({ resetKey, page: 0, pageSize });

  // A new projection starts at its first page. This adjusts state during render
  // rather than from an effect so the reset cannot land after an interaction.
  if (anchor.resetKey !== resetKey) {
    setAnchor({ resetKey, page: 0, pageSize });
  }

  const requestedPage =
    anchor.resetKey !== resetKey
      ? 0
      : anchor.pageSize === pageSize
        ? anchor.page
        : Math.floor((anchor.page * anchor.pageSize) / pageSize);
  const page = Math.min(requestedPage, pageCount - 1);

  const setPage = useCallback(
    (nextPage: number) => {
      setAnchor({
        resetKey,
        page: Math.max(0, Math.min(Math.floor(nextPage), pageCount - 1)),
        pageSize,
      });
    },
    [pageCount, pageSize, resetKey],
  );
  const paginatedItems = useMemo(() => {
    const start = page * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  return {
    items: paginatedItems,
    page,
    pageSize,
    total: items.length,
    visibleCount: paginatedItems.length,
    setPage,
  };
}

interface ResourceInfiniteItemsResult<Item> {
  /** Every loaded page's rows, in order. */
  items: readonly Item[];
  total: number;
  hasMore: boolean;
  loadMore: () => void;
}

/**
 * The infinite-scroll projection of {@link useResourcePagination}: the same
 * page machinery (page size, projection reset keys), but pages accumulate as
 * the user scrolls instead of replacing each other. Pair with
 * {@link ResourceInfiniteScrollSentinel} at the end of the list.
 */
export function useResourceInfiniteItems<Item>(
  items: readonly Item[],
  options: ResourcePaginationOptions = {},
): ResourceInfiniteItemsResult<Item> {
  const pageSize = Math.max(
    1,
    Math.floor(options.pageSize ?? RESOURCE_LIST_PAGE_SIZE),
  );
  const resetKey = options.resetKey ?? "";
  // Render-phase reset, mirroring useResourcePagination's anchor: a new
  // projection (search, filter, sort) starts back at one page's worth. The
  // anchor holds the item count reached through loadMore rather than a page
  // count so a viewport remeasure that shrinks the page size never hides rows
  // the user already scrolled through; zero means "one page's worth at the
  // current page size", which tracks remeasures until the first loadMore.
  const [anchor, setAnchor] = useState({ resetKey, loadedCount: 0 });
  if (anchor.resetKey !== resetKey) {
    setAnchor({ resetKey, loadedCount: 0 });
  }
  const loadedCount = anchor.resetKey === resetKey ? anchor.loadedCount : 0;
  const visibleCount = Math.max(pageSize, loadedCount);
  const visibleItems = useMemo(
    () => items.slice(0, visibleCount),
    [items, visibleCount],
  );
  const hasMore = items.length > visibleItems.length;
  const loadMore = useCallback(() => {
    setAnchor((current) => ({
      resetKey,
      loadedCount:
        (current.resetKey === resetKey
          ? Math.max(pageSize, current.loadedCount)
          : pageSize) + pageSize,
    }));
  }, [pageSize, resetKey]);
  return { items: visibleItems, total: items.length, hasMore, loadMore };
}

/**
 * Fires `onLoadMore` when scrolled into view inside the nearest resource
 * collection scroll viewport. Renders a small status row while more rows are
 * loading so the list visibly grows rather than silently stalling.
 */
export function ResourceInfiniteScrollSentinel({
  hasMore,
  loading = false,
  onLoadMore,
  className,
}: {
  hasMore: boolean;
  /** Shows the loading row and pauses further loadMore calls. */
  loading?: boolean;
  onLoadMore: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The latest callback without re-observing per render.
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    const element = ref.current;
    if (
      element === null ||
      !hasMore ||
      loading ||
      // jsdom has no IntersectionObserver; tests drive loadMore directly.
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    // The observer roots at the nearest scroll container that owns the
    // list: collection viewports tag themselves, and other scrollers (e.g.
    // the skill-detail content panel) opt in with data-infinite-scroll-root.
    const root = element.closest(
      "[data-resource-collection-scroll], [data-infinite-scroll-root]",
    );
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMoreRef.current();
        }
      },
      {
        root: root instanceof HTMLElement ? root : null,
        // Start the next page before the user actually hits the end.
        rootMargin: "240px 0px",
      },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasMore, loading]);

  if (!hasMore && !loading) return null;
  return (
    <div
      ref={ref}
      data-resource-infinite-sentinel
      className={cn("flex items-center justify-center py-3", className)}
    >
      {loading ? (
        <span
          className="text-xs text-subtle-foreground"
          role="status"
          aria-live="polite"
        >
          Loading more…
        </span>
      ) : null}
    </div>
  );
}

function scrollToResults(scrollTargetId: string | undefined): void {
  if (
    scrollTargetId === undefined ||
    typeof requestAnimationFrame !== "function"
  ) {
    return;
  }
  requestAnimationFrame(() => {
    const target = document.getElementById(scrollTargetId);
    if (target === null) return;
    target.scrollTo?.({ top: 0, behavior: "instant" });
  });
}

/** Shared footer for both client- and server-paginated resource collections. */
export function ResourcePagination({
  page,
  pageSize,
  total,
  visibleCount,
  onPageChange,
  scrollTargetId,
  summary,
  ariaLabel = "Results pagination",
}: {
  page: number;
  pageSize: number;
  total: number;
  visibleCount: number;
  onPageChange: (page: number) => void;
  scrollTargetId?: string;
  summary?: ReactNode;
  ariaLabel?: string;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const firstItem = safePage * pageSize + 1;
  const lastItem = Math.min(firstItem + visibleCount - 1, total);
  const changePage = (nextPage: number) => {
    onPageChange(nextPage);
    scrollToResults(scrollTargetId);
  };

  return (
    <nav
      aria-label={ariaLabel}
      className="flex flex-wrap items-center justify-between gap-2 px-1"
    >
      <span className="text-xs text-subtle-foreground">
        {summary ?? `${firstItem}–${lastItem} of ${total}`}
      </span>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={safePage === 0}
          onClick={() => changePage(safePage - 1)}
        >
          <Icon name="ChevronLeft" aria-hidden />
          Previous
        </Button>
        <span className="min-w-24 text-center text-xs text-muted-foreground">
          Page {safePage + 1} of {pageCount}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={safePage >= pageCount - 1}
          onClick={() => changePage(safePage + 1)}
        >
          Next
          <Icon name="ChevronRight" aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
