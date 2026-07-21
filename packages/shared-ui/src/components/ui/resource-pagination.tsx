import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Button } from "./button";
import { Icon } from "./icon";

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

/**
 * Client-side pagination for the bounded arrays returned by resource APIs.
 * The selected page resets with the projection and clamps when live data
 * shrinks, while retaining the current page across ordinary data refreshes.
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
  const [pageState, setPageState] = useState({ resetKey, page: 0 });
  const requestedPage = pageState.resetKey === resetKey ? pageState.page : 0;
  const page = Math.min(requestedPage, pageCount - 1);

  useEffect(() => {
    setPageState((current) => {
      if (current.resetKey === resetKey && current.page === page) {
        return current;
      }
      return { resetKey, page };
    });
  }, [page, resetKey]);

  const setPage = useCallback(
    (nextPage: number) => {
      setPageState({
        resetKey,
        page: Math.max(0, Math.min(Math.floor(nextPage), pageCount - 1)),
      });
    },
    [pageCount, resetKey],
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
}: {
  page: number;
  pageSize: number;
  total: number;
  visibleCount: number;
  onPageChange: (page: number) => void;
  scrollTargetId?: string;
  summary?: ReactNode;
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
      aria-label="Results pagination"
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
