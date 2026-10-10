// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeSidebarThread } from "../model/fixtures.js";
import { createThreadUnreadPredicate } from "../model/read-status-grouping.js";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { useHeldReadStatus } from "./useReadStatusGrouping.js";

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
