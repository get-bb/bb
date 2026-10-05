// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeSidebarThread } from "../model/fixtures.js";
import { createThreadUnreadPredicate } from "../model/read-status-grouping.js";
import type { SidebarThread } from "../model/sidebar-thread.js";
import {
  useHeldReadStatus,
  useReadThreadFold,
  ReadStatusGroupingContext,
} from "./useReadStatusGrouping.js";
import { Provider, createStore } from "jotai";
import type { ReactNode } from "react";
import {
  buildSectionThreadList,
  compareStandardThreads,
} from "../model/project-thread-groups.js";

function useHeldUnreadPredicate(
  threads: SidebarThread[],
  selectedThreadId: string | undefined,
) {
  return createThreadUnreadPredicate(
    useHeldReadStatus(threads, selectedThreadId),
  );
}

const unread = (id: string) => makeSidebarThread({ id, latestAttentionAt: 5 });
const read = (id: string) =>
  makeSidebarThread({ id, latestAttentionAt: 5, lastReadAt: 10 });

describe("useHeldReadStatus", () => {
  it("keeps the open thread unread until another thread opens", () => {
    const { result, rerender } = renderHook(
      ({ threads, selectedThreadId }) =>
        useHeldUnreadPredicate(threads, selectedThreadId),
      {
        initialProps: {
          threads: [unread("opened"), read("other")],
          selectedThreadId: "opened" as string | undefined,
        },
      },
    );

    rerender({
      threads: [read("opened"), read("other")],
      selectedThreadId: "opened",
    });
    expect(result.current(read("opened"))).toBe(true);

    rerender({
      threads: [read("opened"), read("other")],
      selectedThreadId: "other",
    });
    expect(result.current(read("opened"))).toBe(false);
  });

  it("keeps the held status when the sidebar remounts", () => {
    const first = renderHook(() =>
      useHeldUnreadPredicate([unread("remounted")], "remounted"),
    );
    first.unmount();

    const second = renderHook(() =>
      useHeldUnreadPredicate([read("remounted")], "remounted"),
    );
    expect(second.result.current(read("remounted"))).toBe(true);
  });
});

describe("useReadThreadFold", () => {
  it("adds the last unread thread to its rollup and keeps it folded across remounts", () => {
    const store = createStore();
    const isUnread = createThreadUnreadPredicate(null);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>
        <ReadStatusGroupingContext.Provider value={isUnread}>
          {children}
        </ReadStatusGroupingContext.Provider>
      </Provider>
    );
    const allRead = buildSectionThreadList(
      [read("newly-read"), read("already-read")],
      compareStandardThreads,
    );
    const first = renderHook(
      ({ items, section }) => useReadThreadFold(items, undefined, section),
      {
        wrapper,
        initialProps: {
          items: buildSectionThreadList(
            [unread("newly-read"), read("already-read")],
            compareStandardThreads,
          ),
          section: "inbox",
        },
      },
    );
    expect(first.result.current.hiddenCount).toBe(1);
    first.rerender({ items: allRead, section: "inbox" });
    expect(first.result.current.hiddenCount).toBe(2);
    expect(first.result.current.items).toEqual([]);
    first.rerender({ items: allRead, section: "quiet" });
    expect(first.result.current.hiddenCount).toBe(0);
    expect(first.result.current.items).toEqual(allRead);
    first.unmount();
    const remounted = renderHook(
      () => useReadThreadFold(allRead, undefined, "inbox"),
      { wrapper },
    );
    expect(remounted.result.current.hiddenCount).toBe(2);
    act(() => remounted.result.current.revealReadThreads());
    expect(remounted.result.current.items).toEqual(allRead);
  });

  it("reveals only its section across remounts, without persisting to a new session", () => {
    const store = createStore();
    const items = buildSectionThreadList(
      [unread("unread"), read("read")],
      compareStandardThreads,
    );
    const isUnread = createThreadUnreadPredicate(null);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>
        <ReadStatusGroupingContext.Provider value={isUnread}>
          {children}
        </ReadStatusGroupingContext.Provider>
      </Provider>
    );
    const first = renderHook(
      ({ section }) => useReadThreadFold(items, undefined, section),
      { wrapper, initialProps: { section: "inbox" } },
    );
    expect(first.result.current.hiddenCount).toBe(1);
    act(() => first.result.current.revealReadThreads());
    expect(first.result.current.hiddenCount).toBe(0);
    first.rerender({ section: "other" });
    expect(first.result.current.hiddenCount).toBe(1);
    first.unmount();
    const remounted = renderHook(
      () => useReadThreadFold(items, undefined, "inbox"),
      { wrapper },
    );
    expect(remounted.result.current.hiddenCount).toBe(0);
    remounted.unmount();
    const fresh = renderHook(
      () => useReadThreadFold(items, undefined, "inbox"),
      {
        wrapper: ({ children }) => (
          <Provider>
            <ReadStatusGroupingContext.Provider value={isUnread}>
              {children}
            </ReadStatusGroupingContext.Provider>
          </Provider>
        ),
      },
    );
    expect(fresh.result.current.hiddenCount).toBe(1);
  });
});
