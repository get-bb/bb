// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  useResourceInfiniteItems,
  useResourcePagination,
} from "@bb/shared-ui/resource-pagination";
import { afterEach, describe, expect, it } from "vitest";

const ROWS = Array.from({ length: 30 }, (_, index) => index + 1);
const SELECTABLE_PAGES = [0, 1, 2];

function Probe({
  pageSize,
  resetKey,
  rowCount = ROWS.length,
}: {
  pageSize: number;
  resetKey?: string;
  rowCount?: number;
}) {
  const pagination = useResourcePagination(ROWS.slice(0, rowCount), {
    pageSize,
    resetKey,
  });
  return (
    <>
      <span data-testid="page">{pagination.page}</span>
      <span data-testid="rows">{pagination.items.join(",")}</span>
      {SELECTABLE_PAGES.map((page) => (
        <button
          key={page}
          type="button"
          onClick={() => pagination.setPage(page)}
        >
          {`go to ${page}`}
        </button>
      ))}
    </>
  );
}

function InfiniteProbe({
  pageSize,
  resetKey,
}: {
  pageSize: number;
  resetKey?: string;
}) {
  const infinite = useResourceInfiniteItems(ROWS, { pageSize, resetKey });
  return (
    <>
      <span data-testid="rows">{infinite.items.join(",")}</span>
      <button type="button" onClick={infinite.loadMore}>
        load more
      </button>
    </>
  );
}

function loadMore(): void {
  fireEvent.click(screen.getByRole("button", { name: "load more" }));
}

function selectedPage(): number {
  return Number(screen.getByTestId("page").textContent);
}

function visibleRows(): number[] {
  const rows = screen.getByTestId("rows").textContent ?? "";
  return rows === "" ? [] : rows.split(",").map(Number);
}

function goToPage(page: number): void {
  fireEvent.click(screen.getByRole("button", { name: `go to ${page}` }));
}

afterEach(() => {
  cleanup();
});

describe("useResourcePagination", () => {
  /**
   * The selected page used to be mirrored back into state from an effect. That
   * discarded the page the user picked as soon as a measured page size changed,
   * and — because the write-back carried a pre-interaction page — a click that
   * beat the effect was silently reverted. Surviving this round trip is the
   * observable proof that nothing but setPage writes the selection.
   */
  it("rescales the selection across page-size changes instead of overwriting it", () => {
    const { rerender } = render(<Probe pageSize={10} />);
    goToPage(1);
    expect(visibleRows()).toEqual(ROWS.slice(10, 20));

    // Row 11 stays in view at the larger page size...
    rerender(<Probe pageSize={15} />);
    expect(selectedPage()).toBe(0);
    expect(visibleRows()).toEqual(ROWS.slice(0, 15));

    // ...and remeasuring back restores the page the user actually chose.
    rerender(<Probe pageSize={10} />);
    expect(selectedPage()).toBe(1);
    expect(visibleRows()).toEqual(ROWS.slice(10, 20));
  });

  it("resets to the first page for each new projection", () => {
    const { rerender } = render(<Probe pageSize={10} resetKey="all" />);
    goToPage(2);
    expect(selectedPage()).toBe(2);

    rerender(<Probe pageSize={10} resetKey="filtered" />);
    expect(selectedPage()).toBe(0);

    // Returning to an earlier projection is still a new projection, not a
    // reason to resurrect the page that was selected under it.
    rerender(<Probe pageSize={10} resetKey="all" />);
    expect(selectedPage()).toBe(0);
  });

  it("clamps the page when live data shrinks past it", () => {
    const { rerender } = render(<Probe pageSize={10} />);
    goToPage(2);
    expect(visibleRows()).toEqual(ROWS.slice(20, 30));

    rerender(<Probe pageSize={10} rowCount={12} />);
    expect(selectedPage()).toBe(1);
    expect(visibleRows()).toEqual(ROWS.slice(10, 12));
  });
});

describe("useResourceInfiniteItems", () => {
  /**
   * The hook used to store a loaded page count and slice by the current
   * measured page size, so a viewport remeasure that shrank the page size
   * (2 pages × 10 rows → page size 5) cut already-loaded rows out of view.
   * The anchor now preserves the loaded item count across page-size changes.
   */
  it("keeps already-loaded rows visible when the measured page size shrinks", () => {
    const { rerender } = render(<InfiniteProbe pageSize={10} />);
    loadMore();
    expect(visibleRows()).toEqual(ROWS.slice(0, 20));

    rerender(<InfiniteProbe pageSize={5} />);
    expect(visibleRows()).toEqual(ROWS.slice(0, 20));

    // Loading more continues from the preserved count at the new page size.
    loadMore();
    expect(visibleRows()).toEqual(ROWS.slice(0, 25));
  });

  it("resets to one page's worth for each new projection", () => {
    const { rerender } = render(<InfiniteProbe pageSize={10} resetKey="all" />);
    loadMore();
    expect(visibleRows()).toEqual(ROWS.slice(0, 20));

    rerender(<InfiniteProbe pageSize={10} resetKey="filtered" />);
    expect(visibleRows()).toEqual(ROWS.slice(0, 10));
  });
});
