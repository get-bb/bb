// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import type { ThreadQueuedMessage } from "@bb/domain";
import { makeThreadQueuedMessage } from "@bb/test-helpers/domain-fixtures";
import { afterEach, describe, expect, it } from "vitest";
import { useQueuedMessagesExpanded } from "./queued-messages-expanded";

afterEach(() => {
  cleanup();
});

interface ExpandedProps {
  threadId: string;
  queuedMessages: readonly ThreadQueuedMessage[] | null;
}

const firstMessage = makeThreadQueuedMessage({ id: "q_first" });
const secondMessage = makeThreadQueuedMessage({ id: "q_second" });

function renderExpanded(initialProps: ExpandedProps, store = createStore()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return renderHook(
    (props: ExpandedProps) => useQueuedMessagesExpanded(props),
    { initialProps, wrapper },
  );
}

describe("useQueuedMessagesExpanded", () => {
  it("opens each thread's queue until that thread's queue is closed", () => {
    const view = renderExpanded({
      threadId: "thr_a",
      queuedMessages: [firstMessage],
    });
    expect(view.result.current[0]).toBe(true);

    act(() => view.result.current[1](false));
    expect(view.result.current[0]).toBe(false);

    view.rerender({ threadId: "thr_b", queuedMessages: [secondMessage] });
    expect(view.result.current[0]).toBe(true);

    view.rerender({ threadId: "thr_a", queuedMessages: [firstMessage] });
    expect(view.result.current[0]).toBe(false);
  });

  it("keeps a closed queue closed while any message it has held remains", () => {
    const view = renderExpanded({
      threadId: "thr_a",
      queuedMessages: [firstMessage],
    });
    act(() => view.result.current[1](false));

    view.rerender({
      threadId: "thr_a",
      queuedMessages: [firstMessage, secondMessage],
    });
    view.rerender({ threadId: "thr_a", queuedMessages: [secondMessage] });
    expect(view.result.current[0]).toBe(false);

    view.rerender({ threadId: "thr_a", queuedMessages: null });
    expect(view.result.current[0]).toBe(false);
  });

  it("reopens a closed queue once it empties", () => {
    const view = renderExpanded({
      threadId: "thr_a",
      queuedMessages: [firstMessage],
    });
    act(() => view.result.current[1](false));

    view.rerender({ threadId: "thr_a", queuedMessages: [] });
    view.rerender({ threadId: "thr_a", queuedMessages: [secondMessage] });
    expect(view.result.current[0]).toBe(true);
  });

  it("reopens a queue that emptied and refilled while its thread was away", () => {
    const store = createStore();
    const view = renderExpanded(
      { threadId: "thr_a", queuedMessages: [firstMessage] },
      store,
    );
    act(() => view.result.current[1](false));
    view.unmount();

    const returned = renderExpanded(
      { threadId: "thr_a", queuedMessages: [secondMessage] },
      store,
    );
    expect(returned.result.current[0]).toBe(true);
  });
});
