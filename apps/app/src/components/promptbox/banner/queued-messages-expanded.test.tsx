// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useQueuedMessagesExpanded } from "./queued-messages-expanded";

afterEach(() => {
  cleanup();
});

function renderExpanded(initialProps: {
  threadId: string;
  queueIsEmpty: boolean;
}) {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return renderHook((props) => useQueuedMessagesExpanded(props), {
    initialProps,
    wrapper,
  });
}

describe("useQueuedMessagesExpanded", () => {
  it("opens each thread's queue until that thread's queue is closed", () => {
    const view = renderExpanded({ threadId: "thr_a", queueIsEmpty: false });
    expect(view.result.current[0]).toBe(true);

    act(() => view.result.current[1](false));
    expect(view.result.current[0]).toBe(false);

    view.rerender({ threadId: "thr_b", queueIsEmpty: false });
    expect(view.result.current[0]).toBe(true);

    view.rerender({ threadId: "thr_a", queueIsEmpty: false });
    expect(view.result.current[0]).toBe(false);
  });

  it("reopens a closed queue once it empties", () => {
    const view = renderExpanded({ threadId: "thr_a", queueIsEmpty: false });
    act(() => view.result.current[1](false));

    view.rerender({ threadId: "thr_a", queueIsEmpty: true });
    view.rerender({ threadId: "thr_a", queueIsEmpty: false });
    expect(view.result.current[0]).toBe(true);
  });
});
