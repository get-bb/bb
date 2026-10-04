// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeSidebarThread } from "../model/fixtures.js";
import type { SidebarThread } from "../model/sidebar-thread.js";
import {
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
          threads,
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
    const holdStatus = (threads: SidebarThread[]) =>
      createThreadUnreadPredicate(
        threads,
        useHeldReadStatus(threads, "remounted"),
      );
    const first = renderHook(() => holdStatus([opened]));
    expect(first.result.current(opened)).toBe(true);
    first.unmount();

    const markedRead = makeSidebarThread({
      id: "remounted",
      latestAttentionAt: 5,
      lastReadAt: 10,
    });
    const second = renderHook(() => holdStatus([markedRead]));
    expect(second.result.current(markedRead)).toBe(true);
  });
});

describe("createThreadUnreadPredicate", () => {
  it("counts a parent as unread when any descendant is unread", () => {
    const parent = makeSidebarThread({ id: "parent", lastReadAt: 10 });
    const child = makeSidebarThread({
      id: "child",
      parentThreadId: "parent",
      lastReadAt: 10,
    });
    const grandchild = makeSidebarThread({
      id: "grandchild",
      parentThreadId: "child",
      latestAttentionAt: 5,
    });
    const sibling = makeSidebarThread({ id: "sibling", lastReadAt: 10 });
    const isUnread = createThreadUnreadPredicate(
      [parent, child, grandchild, sibling],
      null,
    );

    expect(isUnread(parent)).toBe(true);
    expect(isUnread(child)).toBe(true);
    expect(isUnread(grandchild)).toBe(true);
    expect(isUnread(sibling)).toBe(false);
  });

  it("keeps a parent unread while its held child stays open", () => {
    const parent = makeSidebarThread({ id: "held-parent", lastReadAt: 10 });
    const child = makeSidebarThread({
      id: "held-child",
      parentThreadId: "held-parent",
      latestAttentionAt: 5,
      lastReadAt: 10,
    });
    const isUnread = createThreadUnreadPredicate([parent, child], {
      threadId: "held-child",
      isUnread: true,
    });

    expect(isUnread(parent)).toBe(true);
  });
});
