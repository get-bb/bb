// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useThreadUnreadDividerState } from "./useThreadUnreadDividerState";

interface DividerThread {
  id: string;
  lastReadAt: number | null;
  latestAttentionAt: number;
}

interface DividerProps {
  hasFreshThread: boolean;
  thread: DividerThread;
}

function renderDividerState(
  initialThread: DividerThread,
  initialHasFreshThread = true,
) {
  const renders: ReturnType<typeof useThreadUnreadDividerState>[] = [];
  const view = renderHook(
    ({ hasFreshThread, thread }: DividerProps) => {
      const state = useThreadUnreadDividerState({
        anchor: "first-unread-row",
        hasFreshThread,
        routeThreadId: thread.id,
        thread,
      });
      renders.push(state);
      return state;
    },
    {
      initialProps: {
        hasFreshThread: initialHasFreshThread,
        thread: initialThread,
      },
    },
  );
  return {
    renders,
    result: view.result,
    show: (thread: DividerThread, hasFreshThread = true) => {
      renders.length = 0;
      view.rerender({ hasFreshThread, thread });
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
      ready: true,
      autoScroll: true,
      placement: { anchor: "first-unread-row", cutoffAt: 100 },
    });
  });

  it("places the next thread's divider on the first render after a switch", () => {
    const { renders, show } = renderDividerState({
      id: "thr_a",
      lastReadAt: 100,
      latestAttentionAt: 200,
    });

    show({ id: "thr_b", lastReadAt: 250, latestAttentionAt: 300 });

    expect(renders[0]).toEqual({
      ready: true,
      autoScroll: true,
      placement: { anchor: "first-unread-row", cutoffAt: 250 },
    });
  });

  it("opens a thread marked unread without a divider, and adds none when marked unread while open", () => {
    const { result, show } = renderDividerState({
      id: "thr_a",
      lastReadAt: null,
      latestAttentionAt: 200,
    });
    expect(result.current).toEqual({
      ready: true,
      autoScroll: false,
      placement: null,
    });

    show({ id: "thr_b", lastReadAt: 300, latestAttentionAt: 200 });
    show({ id: "thr_b", lastReadAt: null, latestAttentionAt: 200 });
    expect(result.current).toEqual({
      ready: true,
      autoScroll: false,
      placement: null,
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
      ready: true,
      autoScroll: true,
      placement: { anchor: "first-unread-row", cutoffAt: 100 },
    });

    show({ id: "thr_a", lastReadAt: 400, latestAttentionAt: 300 });
    expect(result.current).toEqual({
      ready: true,
      autoScroll: false,
      placement: null,
    });
  });

  it("opens a read thread without a divider", () => {
    const { renders } = renderDividerState({
      id: "thr_a",
      lastReadAt: 300,
      latestAttentionAt: 200,
    });

    expect(renders[0]).toEqual({
      ready: true,
      autoScroll: false,
      placement: null,
    });
  });

  it("auto-scrolls to a divider that arrives with the fresh fetch after reopening on cached read state", () => {
    const { result, show } = renderDividerState(
      { id: "thr_a", lastReadAt: 300, latestAttentionAt: 200 },
      false,
    );
    expect(result.current).toEqual({
      ready: false,
      autoScroll: false,
      placement: null,
    });

    show({ id: "thr_a", lastReadAt: 300, latestAttentionAt: 400 });
    expect(result.current).toEqual({
      ready: true,
      autoScroll: true,
      placement: { anchor: "first-unread-row", cutoffAt: 300 },
    });
  });

  it("does not auto-scroll to a divider from a reply that lands after the thread settled", () => {
    const { result, show } = renderDividerState(
      { id: "thr_a", lastReadAt: 300, latestAttentionAt: 200 },
      false,
    );
    show({ id: "thr_a", lastReadAt: 300, latestAttentionAt: 200 });

    show({ id: "thr_a", lastReadAt: 300, latestAttentionAt: 400 });
    expect(result.current).toEqual({
      ready: true,
      autoScroll: false,
      placement: { anchor: "first-unread-row", cutoffAt: 300 },
    });
  });
});
