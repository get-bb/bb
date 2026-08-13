// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useCallback, useState } from "react";
import {
  useResourcePagination,
  useResourceViewportPageSize,
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

const VIEWPORT_HEIGHT = 220;
const SHORT_ROW_HEIGHT = 40;
const TALL_ROW_HEIGHT = 110;
const TALL_ROW_INDEX = 3;
/** Bounds a regression so it fails an assertion instead of hanging the run. */
const MEASUREMENT_LIMIT = 12;

function stubHeight(node: HTMLElement, height: number): void {
  Object.defineProperty(node, "clientHeight", {
    configurable: true,
    value: height,
  });
  node.getBoundingClientRect = () =>
    ({
      height,
      width: 0,
      top: 0,
      bottom: height,
      left: 0,
      right: 0,
    }) as DOMRect;
}

/**
 * A collection whose fourth row is taller than the rest — a wrapped
 * description, a badge that adds a line. Which rows render is decided by the
 * measured page size, so the tall row is only measurable while the page size
 * is large enough to show it.
 */
function ViewportProbe({ measured }: { measured: number[] }) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const pageSize = useResourceViewportPageSize(viewport, {
    fallbackPageSize: 5,
  });
  measured.push(pageSize);
  const attachViewport = useCallback((node: HTMLDivElement | null) => {
    if (node !== null) stubHeight(node, VIEWPORT_HEIGHT);
    setViewport(node);
  }, []);
  const rowCount = measured.length > MEASUREMENT_LIMIT ? 1 : pageSize;

  return (
    <div ref={attachViewport}>
      <div data-resource-list-panel="">
        {Array.from({ length: rowCount }, (_, index) => (
          <div
            key={index}
            data-resource-row=""
            ref={(node) => {
              if (node === null) return;
              stubHeight(
                node,
                index === TALL_ROW_INDEX ? TALL_ROW_HEIGHT : SHORT_ROW_HEIGHT,
              );
            }}
          />
        ))}
      </div>
    </div>
  );
}

async function settle(): Promise<void> {
  for (let frame = 0; frame < 6; frame += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

describe("useResourceViewportPageSize", () => {
  /**
   * The measurement reads back its own output: it can only see the rows the
   * page size selected. A page size of 5 shows the tall row and measures 2, a
   * page size of 2 hides it and measures 5, and the two trade places forever —
   * a render loop that re-measures on every mutation and locks the tab up.
   * Changing pages is what used to start it, by swapping in rows of a
   * different height.
   */
  it("settles instead of trading page sizes with the rows it measures", async () => {
    const measured: number[] = [];
    render(<ViewportProbe measured={measured} />);
    await settle();

    const changes = measured.filter(
      (value, index) => index > 0 && value !== measured[index - 1],
    );
    expect(changes.length).toBeLessThanOrEqual(1);
    expect(measured.at(-1)).toBe(Math.floor(VIEWPORT_HEIGHT / TALL_ROW_HEIGHT));
  });
});
