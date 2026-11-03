// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScrollPositionKeeper } from "@/components/ui/scroll-position-keeper";
import { installFakeFlowLayout } from "@/test/fake-flow-layout";
import { TimelineWindowedItems } from "./TimelineWindowedItems.js";

const VIEWPORT_HEIGHT = 600;
const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const run of cleanups.splice(0).reverse()) run();
  document.body.replaceChildren();
});

function keys(count: number, prefix = "row"): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
}

function setup({
  attached,
  heightOf = (key: string) => 40 + ((key.length * 7) % 90),
  viewportHeight = VIEWPORT_HEIGHT,
  rootPending = false,
}: {
  attached: boolean;
  heightOf?: (key: string) => number;
  viewportHeight?: number;
  rootPending?: boolean;
}) {
  const scrollElement = document.createElement("div");
  const content = document.createElement("div");
  const list = document.createElement("div");
  list.setAttribute("data-timeline-row-list", "top-level");
  content.append(list);
  scrollElement.append(content);
  document.body.append(scrollElement);
  const layout = installFakeFlowLayout({ scrollElement, viewportHeight });
  let rootReady = !rootPending;
  const keeper = new ScrollPositionKeeper({
    bottomThresholdPx: 4,
    deferWritesWhileScrolling: false,
    getContentElement: () => content,
    getFloorElement: () => null,
    getFooterElement: () => null,
    getScrollElement: () => (rootReady ? scrollElement : null),
    getTopLevelRows: () =>
      list.querySelectorAll<HTMLElement>(
        ":scope > [data-timeline-items] > [data-timeline-row-id]",
      ),
    initiallyAttached: attached,
  });
  let disconnect = rootPending
    ? () => undefined
    : keeper.connect(scrollElement);
  cleanups.push(layout.restore, () => disconnect());
  const connectRoot = () => {
    rootReady = true;
    disconnect = keeper.connect(scrollElement);
  };
  const measurements = new Map<string, number>();
  const view = (
    itemKeys: string[],
    {
      alwaysMountedKeys,
      pinnedToEnd = attached,
    }: { alwaysMountedKeys?: ReadonlySet<string>; pinnedToEnd?: boolean } = {},
  ) => (
    <TimelineWindowedItems
      alwaysMountedKeys={alwaysMountedKeys}
      estimateItemHeight={() => 60}
      gap={8}
      itemKeys={itemKeys}
      measurements={measurements}
      positionKeeper={keeper}
      pinnedToEnd={pinnedToEnd}
      renderItem={(index, state) => {
        const key = itemKeys[index] ?? "";
        return (
          <div
            key={key}
            ref={state.itemRef}
            data-timeline-row-id={key}
            data-timeline-window-key={key}
            data-fake-height={heightOf(key)}
          >
            <button type="button">{key}</button>
          </div>
        );
      }}
    />
  );
  const mounted = () =>
    [...list.querySelectorAll<HTMLElement>("[data-timeline-row-id]")].map(
      (row) => row.dataset.timelineRowId ?? "",
    );
  const topOf = (key: string) => {
    const row = list.querySelector(`[data-timeline-row-id="${key}"]`);
    if (row === null) throw new Error(`${key} is not mounted`);
    return row.getBoundingClientRect().top;
  };
  const visibleKeys = () =>
    mounted().filter((key) => {
      const top = topOf(key);
      return top < VIEWPORT_HEIGHT && top + heightOf(key) > 0;
    });
  const extent = () => layout.maxScrollTop() + VIEWPORT_HEIGHT;
  const totalHeight = (itemKeys: string[]) =>
    itemKeys.reduce((sum, key) => sum + heightOf(key), 0) +
    8 * (itemKeys.length - 1);
  return {
    connectRoot,
    extent,
    heightOf,
    keeper,
    layout,
    list,
    measurements,
    mounted,
    topOf,
    totalHeight,
    view,
    visibleKeys,
  };
}

describe("TimelineWindowedItems", () => {
  it("keeps the reader's rows mounted and in place when an older page turns windowing on", () => {
    const harness = setup({ attached: false });
    const latest = keys(15);
    const { rerender } = render(harness.view(latest), {
      container: harness.list,
    });
    act(() => harness.layout.userScrollTo(250));
    const anchor = harness.visibleKeys()[1] ?? "";
    const before = harness.topOf(anchor);

    act(() => rerender(harness.view([...keys(40, "older"), ...latest])));

    expect(harness.mounted()).toContain(anchor);
    expect(harness.topOf(anchor)).toBe(before);
    expect(harness.mounted().length).toBeLessThan(55);
  });

  it("renders the rows under a scroll jump before the scroll handler returns", () => {
    const harness = setup({ attached: true });
    const itemKeys = keys(400);
    render(harness.view(itemKeys), { container: harness.list });
    expect(harness.mounted()).not.toContain("row-0");

    harness.layout.userScrollTo(0);

    expect(harness.visibleKeys()).toContain("row-0");
    expect(harness.visibleKeys().length).toBeGreaterThan(3);
  });

  it("jumps far away from a detached reading row without a render loop", () => {
    const harness = setup({ attached: true });
    render(harness.view(keys(400)), { container: harness.list });
    act(() => harness.layout.userScrollTo(harness.layout.maxScrollTop() - 900));
    expect(harness.keeper.isAttached()).toBe(false);

    harness.layout.userScrollTo(0);

    expect(harness.visibleKeys()).toContain("row-0");
  });

  it("sizes spacers from retained measurements, so rows unmounting around the reader never shift it", () => {
    const harness = setup({ attached: true });
    const itemKeys = keys(200);
    for (const key of itemKeys)
      harness.measurements.set(key, harness.heightOf(key));
    render(harness.view(itemKeys), { container: harness.list });
    const extent = harness.layout.maxScrollTop();

    act(() => harness.layout.userScrollTo(extent - 3_000));
    const reader = harness.visibleKeys()[0] ?? "";
    const before = harness.topOf(reader);
    act(() => harness.layout.userScrollTo(extent - 2_400));
    act(() => harness.layout.userScrollTo(extent - 3_600));
    act(() => harness.layout.userScrollTo(extent - 3_000));

    expect(harness.layout.maxScrollTop()).toBe(extent);
    expect(harness.layout.scrollTop).toBe(extent - 3_000);
    expect(harness.topOf(reader)).toBe(before);
  });

  it("keeps the viewport covered after retained measurements for rows above the window are evicted", () => {
    const harness = setup({
      attached: true,
      heightOf: (key) => (Number(key.split("-")[1]) < 250 ? 300 : 80),
    });
    const itemKeys = keys(300);
    for (const key of itemKeys)
      harness.measurements.set(key, harness.heightOf(key));
    render(harness.view(itemKeys), { container: harness.list });
    const firstMounted = harness.mounted()[0] ?? "";
    for (const key of itemKeys.slice(0, 250)) harness.measurements.delete(key);
    const mountedRow = harness.list.querySelector(
      `[data-timeline-row-id="${harness.mounted().at(-1) ?? ""}"]`,
    );
    mountedRow?.setAttribute("data-fake-height", "81");
    act(() => harness.layout.flushResizeObservers());

    act(() =>
      harness.layout.userScrollTo(
        harness.layout.scrollTop + harness.topOf(firstMounted) - 900,
      ),
    );

    expect(harness.visibleKeys().length).toBeGreaterThan(0);
  });

  it("never mounts the full history while the scroll root is still pending", () => {
    const harness = setup({ attached: false, rootPending: true });
    const { rerender } = render(harness.view(keys(400)), {
      container: harness.list,
    });
    expect(harness.mounted().length).toBeLessThan(50);

    act(() => harness.connectRoot());
    act(() => harness.layout.userScrollTo(6_000));
    act(() => rerender(harness.view(keys(400))));

    expect(harness.mounted().length).toBeLessThan(50);
    expect(harness.visibleKeys().length).toBeGreaterThan(3);
  });

  it("renders every row while the scrollport has no usable geometry, then windows once it does with spacers sized from the heights it measured", () => {
    const harness = setup({ attached: false, viewportHeight: 0 });
    const itemKeys = keys(300);
    render(harness.view(itemKeys), { container: harness.list });
    expect(harness.mounted().length).toBe(300);

    harness.layout.setViewportHeight(VIEWPORT_HEIGHT);
    act(() => harness.keeper.reconcile());
    act(() => harness.layout.flushResizeObservers());

    expect(harness.mounted().length).toBeLessThan(50);
    expect(harness.visibleKeys().length).toBeGreaterThan(3);
    expect(harness.extent()).toBe(harness.totalHeight(itemKeys));
    for (let step = 0; step < 11; step += 1) {
      act(() => harness.layout.userScrollTo(harness.layout.scrollTop + 200));
    }
    expect(harness.extent()).toBe(harness.totalHeight(itemKeys));
  });

  it("starts at the end of the list when pinned to the bottom", () => {
    const harness = setup({ attached: true });
    const itemKeys = keys(500);
    render(harness.view(itemKeys), { container: harness.list });
    const last = itemKeys.at(-1) ?? "";

    expect(harness.mounted()).toContain(last);
    expect(harness.mounted()).not.toContain("row-0");
    expect(harness.topOf(last) + harness.heightOf(last)).toBe(VIEWPORT_HEIGHT);
  });

  it("keeps the reader in place when a nested windowed list mounts above it", () => {
    const harness = setup({ attached: false });
    const outerKeys = keys(60);
    const nestedKeys = keys(200, "nested");
    const nestedMeasurements = new Map<string, number>();
    function Outer({ showNested }: { showNested: boolean }) {
      return (
        <TimelineWindowedItems
          estimateItemHeight={() => 60}
          gap={8}
          itemKeys={outerKeys}
          measurements={harness.measurements}
          positionKeeper={harness.keeper}
          pinnedToEnd={false}
          renderItem={(index, state) => {
            const key = outerKeys[index] ?? "";
            const nested = showNested && key === "row-5";
            return (
              <div
                key={key}
                ref={state.itemRef}
                data-timeline-row-id={key}
                data-timeline-window-key={key}
                data-fake-height={nested ? undefined : harness.heightOf(key)}
              >
                {nested ? (
                  <TimelineWindowedItems
                    estimateItemHeight={() => 30}
                    gap={4}
                    itemKeys={nestedKeys}
                    measurements={nestedMeasurements}
                    positionKeeper={harness.keeper}
                    pinnedToEnd={false}
                    renderItem={(nestedIndex, nestedState) => {
                      const nestedKey = nestedKeys[nestedIndex] ?? "";
                      return (
                        <div
                          key={nestedKey}
                          ref={nestedState.itemRef}
                          data-timeline-row-id={nestedKey}
                          data-timeline-window-key={nestedKey}
                          data-fake-height={50}
                        />
                      );
                    }}
                  />
                ) : (
                  key
                )}
              </div>
            );
          }}
        />
      );
    }
    const { rerender } = render(<Outer showNested={false} />, {
      container: harness.list,
    });
    act(() => harness.layout.userScrollTo(1_500));
    const reader = harness.visibleKeys()[0] ?? "";
    const before = harness.topOf(reader);

    act(() => rerender(<Outer showNested />));
    act(() => harness.layout.flushResizeObservers());

    expect(harness.topOf(reader)).toBe(before);
    expect(harness.keeper.isAttached()).toBe(false);
  });

  it("keeps every row mounted on iOS WebKit", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1",
    );
    const harness = setup({ attached: true });
    render(harness.view(keys(300)), { container: harness.list });

    expect(harness.mounted().length).toBe(300);
  });

  it("mounts a bounded window of a long history and replaces it when the reader scrolls away", () => {
    const harness = setup({ attached: true });
    const itemKeys = keys(1_000);
    render(harness.view(itemKeys), { container: harness.list });

    expect(harness.mounted().length).toBeLessThan(40);
    expect(harness.layout.scrollTop).toBe(harness.layout.maxScrollTop());

    act(() => harness.layout.userScrollTo(6_000));

    expect(harness.mounted()).not.toContain(itemKeys.at(-1));
    expect(harness.mounted().length).toBeLessThan(40);
    expect(harness.visibleKeys().length).toBeGreaterThan(3);
  });

  it("shows the rows at a target the keeper scrolls to before any scroll event arrives", () => {
    const harness = setup({ attached: true });
    render(harness.view(keys(400)), { container: harness.list });
    expect(harness.mounted()).not.toContain("row-0");

    act(() => harness.keeper.scrollTo(0, "instant"));

    expect(harness.layout.scrollTop).toBe(0);
    expect(harness.topOf("row-0")).toBe(0);
    const visible = harness.visibleKeys();
    const last = visible.at(-1) ?? "";
    expect(harness.topOf(last) + harness.heightOf(last)).toBeGreaterThanOrEqual(
      VIEWPORT_HEIGHT,
    );
  });

  it("re-measures a row that remounts taller than the thread remembered, so the scroll extent stays exact after it unmounts again", () => {
    const harness = setup({ attached: true });
    const itemKeys = keys(200);
    for (const key of itemKeys)
      harness.measurements.set(key, harness.heightOf(key));
    harness.measurements.set("row-100", harness.heightOf("row-100") - 30);
    render(harness.view(itemKeys), { container: harness.list });
    expect(harness.mounted()).not.toContain("row-100");

    act(() =>
      harness.layout.userScrollTo(harness.totalHeight(itemKeys.slice(0, 100))),
    );
    act(() => harness.layout.flushResizeObservers());
    expect(harness.visibleKeys()).toContain("row-100");
    act(() => harness.layout.userScrollTo(harness.layout.maxScrollTop()));

    expect(harness.mounted()).not.toContain("row-100");
    expect(harness.extent()).toBe(harness.totalHeight(itemKeys));
  });

  it("keeps forced and interacted rows mounted outside the window", () => {
    const harness = setup({ attached: true });
    const itemKeys = keys(300);
    const forced = new Set(["row-3"]);
    render(harness.view(itemKeys, { alwaysMountedKeys: forced }), {
      container: harness.list,
    });
    const interacted = harness.visibleKeys()[0] ?? "";
    fireEvent.click(screen.getByRole("button", { name: interacted }));

    act(() => harness.layout.userScrollTo(4_000));
    act(() => harness.layout.userScrollTo(2_000));

    expect(harness.mounted()).toContain("row-3");
    expect(harness.mounted()).toContain(interacted);
  });

  it("keeps mounted row elements when crossing the windowing threshold in either direction", () => {
    const harness = setup({ attached: true });
    const { rerender } = render(harness.view(keys(19)), {
      container: harness.list,
    });
    const element = harness.list.querySelector(
      '[data-timeline-row-id="row-18"]',
    );

    act(() => rerender(harness.view(keys(20))));
    expect(harness.list.querySelector('[data-timeline-row-id="row-18"]')).toBe(
      element,
    );
    act(() => rerender(harness.view(keys(19))));
    expect(harness.list.querySelector('[data-timeline-row-id="row-18"]')).toBe(
      element,
    );
  });
});
