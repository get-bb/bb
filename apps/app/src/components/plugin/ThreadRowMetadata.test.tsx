// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalThreadRowMetadataProps } from "@get-bb/plugin-sdk";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { toPluginSidebarThread } from "@/lib/plugin-sidebar-threads";
import { THREAD_ROW_SETTLE_MS } from "@/lib/thread-row-visibility";
import { applyPluginCss, resetPluginCssForTest } from "@/lib/plugin-css";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { ThreadRowMetadata, resetThreadRowMetadataForTest } from "./ThreadRowMetadata";

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly targets = new Set<Element>();
  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit = {},
  ) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
  }
  takeRecords() {
    return [];
  }
  fire(target: Element, isIntersecting: boolean) {
    if (!this.targets.has(target)) return;
    this.callback(
      [{ target, isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

function intersect(target: Element, isIntersecting: boolean) {
  act(() => {
    for (const observer of FakeIntersectionObserver.instances)
      observer.fire(target, isIntersecting);
  });
}

const thread = toPluginSidebarThread(makeThreadListEntry({ id: "thr_row" }));
const otherThread = toPluginSidebarThread(
  makeThreadListEntry({ id: "thr_other" }),
);
const seen: { id: string; threadId: string; isLive: boolean }[] = [];

function item(label: string) {
  return function Item({ thread, isLive }: ExperimentalThreadRowMetadataProps) {
    seen.push({ id: label, threadId: thread.id, isLive });
    return (
      <span data-testid={label} data-live={isLive ? "" : undefined}>
        {thread.id}
      </span>
    );
  };
}

function Crashes(): never {
  throw new Error("row metadata crashed");
}

function renderRow() {
  const view = render(
    <div data-testid="row">
      <ThreadRowMetadata thread={thread} />
    </div>,
  );
  return { ...view, row: screen.getByTestId("row") };
}

function renderTwoRows() {
  render(
    <>
      <div data-testid="row">
        <ThreadRowMetadata thread={thread} />
      </div>
      <div data-testid="other">
        <ThreadRowMetadata thread={otherThread} />
      </div>
    </>,
  );
  return {
    row: screen.getByTestId("row"),
    other: screen.getByTestId("other"),
    badge: (row: HTMLElement) =>
      row.querySelector<HTMLElement>("[data-testid=badge]"),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});

afterEach(() => {
  cleanup();
  removePluginSlotRegistrations("demo");
  resetAllCrashedPluginSlotsForTest();
  resetThreadRowMetadataForTest();
  resetPluginCssForTest();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Reflect.deleteProperty(document, "visibilityState");
  seen.length = 0;
});

describe("thread row metadata", () => {
  function goLive(row: HTMLElement) {
    intersect(row, true);
    act(() => vi.advanceTimersByTime(THREAD_ROW_SETTLE_MS));
  }

  it("mounts items at once for a row that appears while the list is still, and turns them off while the page is hidden", () => {
    setPluginSlotRegistrations(
      "demo",
      makePluginRegistrationSet({
        threadRowMetadata: [{ id: "badge", component: item("badge") }],
      }),
    );
    const { row } = renderRow();
    expect(screen.queryByTestId("badge")).toBeNull();

    intersect(row, true);
    expect(screen.getByTestId("badge").dataset.live).toBe("");

    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByTestId("badge").dataset.live).toBeUndefined();
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(THREAD_ROW_SETTLE_MS);
    });
    expect(screen.getByTestId("badge").dataset.live).toBe("");
  });

  it("while rows keep entering and leaving, changes rows' live state only at the next pause", () => {
    setPluginSlotRegistrations(
      "demo",
      makePluginRegistrationSet({
        threadRowMetadata: [{ id: "badge", component: item("badge") }],
      }),
    );
    const { row, other, badge } = renderTwoRows();
    intersect(row, true);
    expect(badge(row)?.dataset.live).toBe("");

    act(() => vi.advanceTimersByTime(50));
    intersect(other, true);
    expect(badge(other)).toBeNull();
    act(() => vi.advanceTimersByTime(THREAD_ROW_SETTLE_MS - 1));
    expect(badge(other)).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(badge(other)?.dataset.live).toBe("");

    act(() => vi.advanceTimersByTime(THREAD_ROW_SETTLE_MS));
    intersect(row, false);
    expect(badge(row)?.dataset.live).toBeUndefined();
    act(() => vi.advanceTimersByTime(50));
    intersect(other, false);
    expect(badge(other)?.dataset.live).toBe("");
    act(() => vi.advanceTimersByTime(THREAD_ROW_SETTLE_MS));
    expect(badge(other)?.dataset.live).toBeUndefined();
  });

  it("draws an item that showed something in the row's first frame when the row mounts again", () => {
    setPluginSlotRegistrations(
      "demo",
      makePluginRegistrationSet({
        threadRowMetadata: [{ id: "badge", component: item("badge") }],
      }),
    );
    const first = renderRow();
    goLive(first.row);
    first.unmount();
    renderRow();
    expect(screen.getByTestId("badge").dataset.live).toBeUndefined();
  });

  it("shows the metadata line only while one of them draws something, including updates the item makes itself", async () => {
    function Late() {
      const [ready, setReady] = useState(false);
      useEffect(() => {
        const timer = setTimeout(() => setReady(true), 50);
        return () => clearTimeout(timer);
      }, []);
      return ready ? <span data-testid="late">late</span> : null;
    }
    setPluginSlotRegistrations(
      "demo",
      makePluginRegistrationSet({
        threadRowMetadata: [{ id: "late", component: Late }],
      }),
    );
    const { row } = renderRow();
    goLive(row);
    const container = row.querySelector("[data-thread-row-metadata]")!;
    expect(container.hasAttribute("data-has-items")).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.getByTestId("late")).toBeTruthy();
    expect(container.hasAttribute("data-has-items")).toBe(true);
  });

  it("keeps a plugin's stylesheet loaded while its line is on a row, with no item mounted", () => {
    setPluginSlotRegistrations(
      "demo",
      makePluginRegistrationSet({
        threadRowMetadata: [{ id: "badge", component: item("badge") }],
      }),
    );
    applyPluginCss("demo", "/demo.css");
    const stylesheet = () =>
      document.head.querySelector('link[rel="stylesheet"][data-bb-plugin-css="demo"]');
    const { unmount } = renderRow();
    expect(seen).toEqual([]);
    expect(stylesheet()).not.toBeNull();

    unmount();
    act(() => vi.advanceTimersByTime(2_000));
    expect(stylesheet()).toBeNull();
  });

  it("mounts nothing for rows that scroll past without a pause", () => {
    setPluginSlotRegistrations(
      "demo",
      makePluginRegistrationSet({
        threadRowMetadata: [{ id: "badge", component: item("badge") }],
      }),
    );
    const { row, other } = renderTwoRows();
    intersect(row, true);
    act(() => vi.advanceTimersByTime(THREAD_ROW_SETTLE_MS / 4));
    intersect(other, true);
    act(() => vi.advanceTimersByTime(THREAD_ROW_SETTLE_MS / 2));
    intersect(other, false);
    act(() => vi.advanceTimersByTime(THREAD_ROW_SETTLE_MS * 5));
    expect(seen.filter((entry) => entry.threadId === otherThread.id)).toEqual(
      [],
    );
  });

  it("orders items, renders nothing without contributions, and drops only a crashing item", () => {
    const empty = renderRow();
    expect(empty.row.querySelector("[data-thread-row-metadata]")).toBeNull();
    empty.unmount();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    setPluginSlotRegistrations(
      "demo",
      makePluginRegistrationSet({
        threadRowMetadata: [
          { id: "unordered", component: item("unordered") },
          { id: "crash", order: 1, component: Crashes },
          { id: "second", order: 2, component: item("second") },
          { id: "first", order: 0, component: item("first") },
        ],
      }),
    );
    const { row } = renderRow();
    goLive(row);
    expect(
      [...row.querySelectorAll("[data-testid]")].map((element) =>
        element.getAttribute("data-testid"),
      ),
    ).toEqual(["first", "second", "unordered"]);
  });
});
