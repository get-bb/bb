// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
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

function renderExpanded(
  initialProps: ExpandedProps,
  store = createStore(),
  isCompactViewport = false,
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <CompactViewportOverrideProvider isCompactViewport={isCompactViewport}>
        {children}
      </CompactViewportOverrideProvider>
    </Provider>
  );
  return renderHook(
    (props: ExpandedProps) => useQueuedMessagesExpanded(props),
    { initialProps, wrapper },
  );
}

describe("useQueuedMessagesExpanded", () => {
  it("keeps mobile queues collapsed until opened and resets after draining", () => {
    const view = renderExpanded(
      { threadId: "thr_a", queuedMessages: null },
      createStore(),
      true,
    );
    expect(view.result.current[0]).toBe(false);
    view.rerender({ threadId: "thr_a", queuedMessages: [firstMessage] });
    expect(view.result.current[0]).toBe(false);

    act(() => view.result.current[1](true));
    expect(view.result.current[0]).toBe(true);
    view.rerender({
      threadId: "thr_a",
      queuedMessages: [firstMessage, secondMessage],
    });
    view.rerender({ threadId: "thr_a", queuedMessages: [secondMessage] });
    expect(view.result.current[0]).toBe(true);

    view.rerender({ threadId: "thr_a", queuedMessages: [] });
    view.rerender({ threadId: "thr_a", queuedMessages: [firstMessage] });
    expect(view.result.current[0]).toBe(false);
  });

  it("remembers mobile toggles per thread without changing desktop defaults", () => {
    const store = createStore();
    const props = { threadId: "thr_a", queuedMessages: [firstMessage] };
    const mobile = renderExpanded(props, store, true);
    const desktop = renderExpanded(props, store);
    expect(mobile.result.current[0]).toBe(false);
    expect(desktop.result.current[0]).toBe(true);

    act(() => mobile.result.current[1](true));
    mobile.rerender({ threadId: "thr_b", queuedMessages: [secondMessage] });
    expect(mobile.result.current[0]).toBe(false);
    mobile.rerender(props);
    expect(mobile.result.current[0]).toBe(true);
    act(() => mobile.result.current[1](false));
    mobile.unmount();
    expect(renderExpanded(props, store, true).result.current[0]).toBe(false);
    expect(desktop.result.current[0]).toBe(true);
  });
});
