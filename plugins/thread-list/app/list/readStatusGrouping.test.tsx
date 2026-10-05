// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeSidebarThread } from "../model/fixtures.js";
import type { SidebarThread } from "../model/sidebar-thread.js";
import {
  collapseParentThreads,
  createThreadUnreadPredicate,
  useHeldReadStatus,
} from "./readStatusGrouping.js";

describe("useHeldReadStatus", () => {
  it("keeps the open thread unread for grouping until another thread opens", () => {
    const opened = makeSidebarThread({ id: "opened", latestAttentionAt: 5 });
    const other = makeSidebarThread({
      id: "other",
      latestAttentionAt: 5,
      lastReadAt: 10,
    });
    const { result, rerender } = renderHook(
      ({
        threads,
        selectedThreadId,
      }: {
        threads: SidebarThread[];
        selectedThreadId: string | undefined;
      }) =>
        createThreadUnreadPredicate(
          useHeldReadStatus(threads, selectedThreadId),
        ),
      {
        initialProps: { threads: [opened, other], selectedThreadId: "opened" },
      },
    );

    const markedRead = makeSidebarThread({
      id: "opened",
      latestAttentionAt: 5,
      lastReadAt: 10,
    });
    rerender({ threads: [markedRead, other], selectedThreadId: "opened" });
    expect(result.current(markedRead)).toBe(true);

    rerender({ threads: [markedRead, other], selectedThreadId: "other" });
    expect(result.current(markedRead)).toBe(false);
    expect(result.current(other)).toBe(false);
  });

  it("keeps the held status when the sidebar remounts", () => {
    const opened = makeSidebarThread({ id: "remounted", latestAttentionAt: 5 });
    const useHeldUnreadPredicate = (threads: SidebarThread[]) =>
      createThreadUnreadPredicate(useHeldReadStatus(threads, "remounted"));
    const first = renderHook(() => useHeldUnreadPredicate([opened]));
    expect(first.result.current(opened)).toBe(true);
    first.unmount();

    const markedRead = makeSidebarThread({
      id: "remounted",
      latestAttentionAt: 5,
      lastReadAt: 10,
    });
    const second = renderHook(() => useHeldUnreadPredicate([markedRead]));
    expect(second.result.current(markedRead)).toBe(true);
  });
});

describe("createThreadUnreadPredicate", () => {
  it("counts only threads that show an unread dot", () => {
    const parent = makeSidebarThread({ id: "parent", lastReadAt: 10 });
    const unreadChild = makeSidebarThread({
      id: "child",
      parentThreadId: "parent",
      latestAttentionAt: 5,
    });
    const unreadRoot = makeSidebarThread({ id: "root", latestAttentionAt: 5 });
    const unreadError = makeSidebarThread({
      id: "error",
      status: "error",
      latestAttentionAt: 5,
    });
    const unreadRunning = makeSidebarThread({
      id: "running",
      status: "active",
      latestAttentionAt: 5,
    });
    const isUnread = createThreadUnreadPredicate(null);

    expect(isUnread(unreadRoot)).toBe(true);
    expect(isUnread(unreadError)).toBe(true);
    expect(isUnread(parent)).toBe(false);
    expect(isUnread(unreadChild)).toBe(false);
    expect(isUnread(unreadRunning)).toBe(false);
  });

  it("uses the held status for the open thread", () => {
    const markedRead = makeSidebarThread({
      id: "held",
      latestAttentionAt: 5,
      lastReadAt: 10,
    });
    const isUnread = createThreadUnreadPredicate({
      threadId: "held",
      isUnread: true,
    });

    expect(isUnread(markedRead)).toBe(true);
  });
});

describe("collapseParentThreads", () => {
  it("collapses every parent except the ones expanded while grouped", () => {
    const threads = [
      makeSidebarThread({ id: "parent" }),
      makeSidebarThread({ id: "child", parentThreadId: "parent" }),
      makeSidebarThread({ id: "grandchild", parentThreadId: "child" }),
      makeSidebarThread({ id: "other-parent" }),
      makeSidebarThread({ id: "other-child", parentThreadId: "other-parent" }),
      makeSidebarThread({ id: "leaf" }),
    ];

    expect(
      [...collapseParentThreads(threads, ["other-parent"])].sort(),
    ).toEqual(["child", "parent"]);
  });
});
