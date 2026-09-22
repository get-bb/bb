// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { conversationRow, turnRow } from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "./ThreadTimelineRows";

class ResizeObserverStub implements ResizeObserver {
  constructor(readonly callback: ResizeObserverCallback) {}

  observe: ResizeObserver["observe"] = vi.fn();
  unobserve: ResizeObserver["unobserve"] = vi.fn();
  disconnect: ResizeObserver["disconnect"] = vi.fn();
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("snap-syncs the timeline height when older rows are prepended", () => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return (
        this.querySelectorAll(
          '[data-timeline-row-list="top-level"] > [data-timeline-row-id]',
        ).length * 100
      );
    },
  );

  const latestRows = [
    conversationRow({
      id: "newer_user",
      role: "user",
      seq: 20,
      text: "Newest request",
    }),
    turnRow({ id: "newest_turn", seq: 21, status: "completed" }),
  ];
  const olderRows = [
    conversationRow({
      id: "older_user",
      role: "user",
      seq: 10,
      text: "Older request",
    }),
    turnRow({ id: "older_turn", seq: 11, status: "completed" }),
  ];
  const queryClient = new QueryClient();
  const timeline = (rows: typeof latestRows) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ThreadTimelineRows
          threadId="thr_main"
          timelineRows={rows}
          threadRuntimeDisplayStatus="idle"
          workspaceRootPath={undefined}
        />
      </QueryClientProvider>
    </MemoryRouter>
  );
  const view = render(timeline(latestRows));
  const rowList = view.container.querySelector<HTMLElement>(
    '[data-timeline-row-list="top-level"]',
  );
  const heightWrapper = rowList?.parentElement?.parentElement;

  expect(heightWrapper?.style.height).toBe("200px");

  view.rerender(timeline([...olderRows, ...latestRows]));

  expect(heightWrapper?.style.height).toBe("400px");
  expect(heightWrapper?.style.transitionDuration).toBe("0s");
});

it("snaps active timeline growth on fine-pointer browsers", () => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("CSS", {
    supports: (property: string) => property === "overflow-anchor",
  });
  const queryClient = new QueryClient();
  const rows = [turnRow({ id: "active_turn", seq: 1, status: "pending" })];
  const timeline = (active: boolean) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ThreadTimelineRows
          threadId="thr_main"
          timelineRows={rows}
          threadRuntimeDisplayStatus={active ? "active" : "idle"}
          workspaceRootPath={undefined}
        />
      </QueryClientProvider>
    </MemoryRouter>
  );
  const view = render(timeline(false));
  const rowList = view.container.querySelector<HTMLElement>(
    '[data-timeline-row-list="top-level"]',
  );
  const wrapper = rowList?.parentElement?.parentElement;
  expect(wrapper?.style.transition).toContain("height 180ms");
  view.rerender(timeline(true));
  expect(wrapper?.style.transition).toContain("height 0ms");
  view.rerender(timeline(false));
  expect(wrapper?.style.transition).toContain("height 180ms");
});

function stubFullContainmentSupport(): void {
  vi.stubGlobal("CSS", {
    supports: (property: string) =>
      property === "overflow-anchor" ||
      property === "content-visibility" ||
      property === "contain-intrinsic-block-size",
  });
}

function renderTimelineWithContainmentSupport(
  timelineWindowingEnabled: boolean,
): HTMLElement {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  stubFullContainmentSupport();
  const rows = [turnRow({ id: "idle_turn", seq: 1, status: "completed" })];
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <ThreadTimelineRows
          threadId="thr_main"
          timelineRows={rows}
          threadRuntimeDisplayStatus="idle"
          workspaceRootPath={undefined}
          timelineWindowingEnabled={timelineWindowingEnabled}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const rowList = view.container.querySelector<HTMLElement>(
    '[data-timeline-row-list="top-level"]',
  );
  const wrapper = rowList?.parentElement?.parentElement;
  if (!wrapper) {
    throw new Error("Timeline height wrapper was not rendered");
  }
  return wrapper;
}

it("snaps idle timeline growth once row containment is armed", () => {
  expect(
    renderTimelineWithContainmentSupport(false).style.transition,
  ).toContain("height 0ms");
});

it("keeps idle growth animated when timeline windowing disables containment", () => {
  expect(
    renderTimelineWithContainmentSupport(true).style.transition,
  ).toContain("height 180ms");
});
