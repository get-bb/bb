// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useThreadUnreadDividerState } from "./useThreadUnreadDividerState";

interface DividerThread {
  id: string;
  lastReadAt: number | null;
  latestAttentionAt: number;
}

function renderDividerState(initialThread: DividerThread) {
  const renders: ReturnType<typeof useThreadUnreadDividerState>[] = [];
  const view = renderHook(
    ({ thread }: { thread: DividerThread }) => {
      const state = useThreadUnreadDividerState({
        routeThreadId: thread.id,
        thread,
      });
      renders.push(state);
      return state;
    },
    { initialProps: { thread: initialThread } },
  );
  return {
    renders,
    result: view.result,
    show: (thread: DividerThread) => {
      renders.length = 0;
      view.rerender({ thread });
    },
  };
}

afterEach(() => {
  cleanup();
});

describe("useThreadUnreadDividerState", () => {
  it("places and auto-scrolls the divider on the first render of an unread thread", () => {
    const { renders } = renderDividerState({
      id: "thr_a",
      lastReadAt: 100,
      latestAttentionAt: 200,
    });

    expect(renders[0]).toEqual({
      autoScroll: true,
      placement: { kind: "after-cutoff", cutoffAt: 100 },
    });
  });

  it("places the next thread's divider on the first render after a switch", () => {
    const { renders, show } = renderDividerState({
      id: "thr_a",
      lastReadAt: 100,
      latestAttentionAt: 200,
    });

    show({ id: "thr_b", lastReadAt: null, latestAttentionAt: 300 });

    expect(renders[0]).toEqual({
      autoScroll: true,
      placement: { kind: "before-first" },
    });
  });

  it("keeps the opening divider when the thread is marked read, and drops it after a watched reply", () => {
    const { result, show } = renderDividerState({
      id: "thr_a",
      lastReadAt: 100,
      latestAttentionAt: 200,
    });

    show({ id: "thr_a", lastReadAt: 250, latestAttentionAt: 200 });
    expect(result.current).toEqual({
      autoScroll: true,
      placement: { kind: "after-cutoff", cutoffAt: 100 },
    });

    show({ id: "thr_a", lastReadAt: 400, latestAttentionAt: 300 });
    expect(result.current).toEqual({ autoScroll: false, placement: null });
  });

  it("opens a read thread without a divider", () => {
    const { renders } = renderDividerState({
      id: "thr_a",
      lastReadAt: 300,
      latestAttentionAt: 200,
    });

    expect(renders[0]).toEqual({ autoScroll: false, placement: null });
  });
});
