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
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  ThreadRowMetadata,
  ThreadRowMetadataPrefetch,
} from "./ThreadRowMetadata";

const thread = toPluginSidebarThread(makeThreadListEntry({ id: "thr_row" }));
const otherThread = toPluginSidebarThread(
  makeThreadListEntry({ id: "thr_other" }),
);

vi.mock("@/lib/plugin-sidebar-hooks", () => ({
  useSidebarThreads: () => ({ threads: [thread, otherThread] }),
}));

function item(label: string) {
  return function Item({ thread }: ExperimentalThreadRowMetadataProps) {
    return <span data-testid={label}>{thread.id}</span>;
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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  removePluginSlotRegistrations("demo");
  resetAllCrashedPluginSlotsForTest();
  vi.useRealTimers();
});

describe("thread row metadata", () => {
  it("mounts every row's items at once, whether or not the row is on screen", () => {
    setPluginSlotRegistrations(
      "demo",
      makePluginRegistrationSet({
        threadRowMetadata: [{ id: "badge", component: item("badge") }],
      }),
    );
    render(
      <>
        <ThreadRowMetadata thread={thread} />
        <ThreadRowMetadata thread={otherThread} />
      </>,
    );
    expect(
      screen.getAllByTestId("badge").map((badge) => badge.textContent),
    ).toEqual([thread.id, otherThread.id]);
  });

  it("mounts every sidebar thread's items, hidden, only while a list draws a metadata line", () => {
    setPluginSlotRegistrations(
      "demo",
      makePluginRegistrationSet({
        threadRowMetadata: [{ id: "badge", component: item("badge") }],
      }),
    );
    const prefetched = () =>
      [
        ...document.querySelectorAll(
          "[data-thread-row-metadata-prefetch] [data-testid=badge]",
        ),
      ].map((badge) => badge.textContent);
    render(<ThreadRowMetadataPrefetch />);
    expect(prefetched()).toEqual([]);

    const line = render(<ThreadRowMetadata thread={thread} />);
    expect(prefetched()).toEqual([thread.id, otherThread.id]);

    line.unmount();
    expect(prefetched()).toEqual([]);
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
    const container = row.querySelector("[data-thread-row-metadata]")!;
    expect(container.hasAttribute("data-has-items")).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.getByTestId("late")).toBeTruthy();
    expect(container.hasAttribute("data-has-items")).toBe(true);
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
    expect(
      [...row.querySelectorAll("[data-testid]")].map((element) =>
        element.getAttribute("data-testid"),
      ),
    ).toEqual(["first", "second", "unordered"]);
  });
});
