// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadQueuedMessage } from "@bb/domain";
import {
  QueuedMessagesList,
  clampQueuedMessageDragTransform,
  resolveQueuedMessageDrag,
} from "./QueuedMessagesList";

const noop = () => {};

function makeQueuedMessage(id: string, text: string): ThreadQueuedMessage {
  return {
    id,
    content: [{ type: "text", text, mentions: [] }],
    model: "gpt-5.5",
    reasoningLevel: "medium",
    permissionMode: "workspace-write",
    serviceTier: "default",
    groupWithNext: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeGroupedQueuedMessages(): ThreadQueuedMessage[] {
  return [
    {
      ...makeQueuedMessage("q_one", "First queued message"),
      groupWithNext: true,
    },
    makeQueuedMessage("q_two", "Second queued message"),
    makeQueuedMessage("q_three", "Third queued message"),
  ];
}

function rect({ top, bottom }: { top: number; bottom: number }) {
  return {
    top,
    bottom,
    height: bottom - top,
    left: 0,
    right: 100,
    width: 100,
  };
}

function renderQueuedMessages(queuedMessages: readonly ThreadQueuedMessage[]) {
  return render(
    <QueuedMessagesList
      queuedMessages={queuedMessages}
      sendDisabled={false}
      actionDisabled={false}
      processingMessageId={null}
      processingAction={null}
      onSendImmediately={noop}
      onReorder={noop}
      onSetGroupBoundary={noop}
      onEdit={noop}
      onDelete={noop}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("QueuedMessagesList", () => {
  it("renders queued blockquote markdown as a compact quote preview", () => {
    const { container } = renderQueuedMessages([
      makeQueuedMessage(
        "q_quote",
        "> first quoted line\n> second quoted line\nreply underneath",
      ),
    ]);

    const quote = container.querySelector("blockquote");
    expect(quote?.textContent).toBe("first quoted line second quoted line");
    expect(container.textContent).toContain("reply underneath");
    expect(container.textContent).not.toContain("> first quoted line");
  });

  it("shows a bottom fade when the expanded queue overflows", async () => {
    const { container } = renderQueuedMessages(
      Array.from({ length: 8 }, (_, index) =>
        makeQueuedMessage(
          `q_${index}`,
          `Queued follow-up ${index}: check the compact scroll fade.`,
        ),
      ),
    );
    const scroll = container.querySelector<HTMLDivElement>(
      "[data-queued-messages-scroll]",
    );
    expect(scroll).not.toBeNull();
    if (!scroll) return;

    Object.defineProperty(scroll, "clientHeight", {
      configurable: true,
      value: 96,
    });
    Object.defineProperty(scroll, "scrollHeight", {
      configurable: true,
      value: 240,
    });
    Object.defineProperty(scroll, "scrollTop", {
      configurable: true,
      value: 0,
      writable: true,
    });

    fireEvent.scroll(scroll);

    await waitFor(() => {
      expect(
        container.querySelector('[data-queued-messages-fade="below"]'),
      ).not.toBeNull();
    });
  });

  it("renders the draggable group divider without filling grouped rows", () => {
    const { container, getByLabelText } = renderQueuedMessages(
      makeGroupedQueuedMessages(),
    );

    expect(getByLabelText("Messages above send together")).not.toBeNull();
    expect(
      container.querySelectorAll("[data-queued-message-row]"),
    ).toHaveLength(3);
    expect(
      container.querySelector("[data-queued-message-group-fill]"),
    ).toBeNull();
  });

  it("makes the group divider handle visible on focus and non-hover devices", () => {
    const { getByLabelText } = renderQueuedMessages(
      makeGroupedQueuedMessages(),
    );

    expect(getByLabelText("Messages above send together").className).toContain(
      "focus-visible:opacity-100",
    );
    expect(getByLabelText("Messages above send together").className).toContain(
      "[@media(hover:none)]:opacity-100",
    );
  });

  it("preserves grouping when reordering a row across the divider", () => {
    const queuedMessages = [
      makeQueuedMessage("q_one", "First queued message"),
      makeQueuedMessage("q_two", "Second queued message"),
      makeQueuedMessage("q_three", "Third queued message"),
    ];

    const result = resolveQueuedMessageDrag({
      activeId: "q_three",
      overId: "q_one",
      combinedIds: [
        "q_one",
        "__queued_message_group_divider__",
        "q_two",
        "q_three",
      ],
      orderedMessages: queuedMessages,
    });

    expect(result).toMatchObject({
      kind: "row",
      request: {
        queuedMessageId: "q_three",
        previousQueuedMessageId: null,
        nextQueuedMessageId: "q_one",
      },
      orderedMessages: [
        { id: "q_three", groupWithNext: false },
        { id: "q_one", groupWithNext: false },
        { id: "q_two", groupWithNext: false },
      ],
    });
    if (result?.kind !== "row") {
      throw new Error("Expected row drag result");
    }
    expect(result.request.groupBoundaryQueuedMessageId).toBeUndefined();
  });

  it("updates grouping when dragging the divider", () => {
    const queuedMessages = [
      makeQueuedMessage("q_one", "First queued message"),
      makeQueuedMessage("q_two", "Second queued message"),
      makeQueuedMessage("q_three", "Third queued message"),
    ];

    expect(
      resolveQueuedMessageDrag({
        activeId: "__queued_message_group_divider__",
        overId: "q_three",
        combinedIds: [
          "q_one",
          "__queued_message_group_divider__",
          "q_two",
          "q_three",
        ],
        orderedMessages: queuedMessages,
      }),
    ).toMatchObject({
      kind: "divider",
      request: {
        expectedGroupedPrefixQueuedMessageIds: ["q_one", "q_two", "q_three"],
        groupBoundaryQueuedMessageId: "q_three",
      },
      orderedMessages: [
        { id: "q_one", groupWithNext: true },
        { id: "q_two", groupWithNext: true },
        { id: "q_three", groupWithNext: false },
      ],
    });
  });

  it("clamps queued-message drags to the rendered list bottom", () => {
    expect(
      clampQueuedMessageDragTransform({
        draggingNodeRect: rect({ top: 24, bottom: 40 }),
        listRect: rect({ top: 0, bottom: 72 }),
        scrollRect: rect({ top: 0, bottom: 128 }),
        transform: { x: 12, y: 96, scaleX: 1, scaleY: 1 },
      }),
    ).toEqual({ x: 0, y: 32, scaleX: 1, scaleY: 1 });
  });

  it("re-adopts queued-message order from props when the same rows are restored", () => {
    const originalMessages = [
      makeQueuedMessage("q_one", "First queued message"),
      makeQueuedMessage("q_two", "Second queued message"),
      makeQueuedMessage("q_three", "Third queued message"),
    ];
    const { container, rerender } = renderQueuedMessages(originalMessages);

    rerender(
      <QueuedMessagesList
        queuedMessages={[
          originalMessages[1]!,
          originalMessages[0]!,
          originalMessages[2]!,
        ]}
        sendDisabled={false}
        actionDisabled={false}
        processingMessageId={null}
        processingAction={null}
        onSendImmediately={noop}
        onReorder={noop}
        onSetGroupBoundary={noop}
        onEdit={noop}
        onDelete={noop}
      />,
    );
    expect(
      Array.from(container.querySelectorAll("[data-queued-message-row]")).map(
        (row) => row.textContent,
      ),
    ).toEqual([
      expect.stringContaining("Second queued message"),
      expect.stringContaining("First queued message"),
      expect.stringContaining("Third queued message"),
    ]);

    rerender(
      <QueuedMessagesList
        queuedMessages={originalMessages}
        sendDisabled={false}
        actionDisabled={false}
        processingMessageId={null}
        processingAction={null}
        onSendImmediately={noop}
        onReorder={noop}
        onSetGroupBoundary={noop}
        onEdit={noop}
        onDelete={noop}
      />,
    );

    expect(
      Array.from(container.querySelectorAll("[data-queued-message-row]")).map(
        (row) => row.textContent,
      ),
    ).toEqual([
      expect.stringContaining("First queued message"),
      expect.stringContaining("Second queued message"),
      expect.stringContaining("Third queued message"),
    ]);
  });

  it("does not show a fade when stale observer entries report hidden sentinels without overflow", async () => {
    interface ObserverControl {
      targets: Element[];
      trigger(entries: readonly Partial<IntersectionObserverEntry>[]): void;
    }

    const observers: ObserverControl[] = [];

    class IntersectionObserverMock implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "";
      readonly thresholds = [0];
      readonly targets: Element[] = [];

      constructor(private readonly callback: IntersectionObserverCallback) {
        observers.push(this);
      }

      disconnect() {}

      observe(target: Element) {
        this.targets.push(target);
      }

      takeRecords() {
        return [];
      }

      trigger(entries: readonly Partial<IntersectionObserverEntry>[]) {
        this.callback(entries as IntersectionObserverEntry[], this);
      }

      unobserve() {}
    }

    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const { container } = renderQueuedMessages([
      makeQueuedMessage("q_one", "single queued message"),
    ]);
    const scroll = container.querySelector<HTMLDivElement>(
      "[data-queued-messages-scroll]",
    );
    expect(scroll).not.toBeNull();
    if (!scroll) return;

    Object.defineProperty(scroll, "clientHeight", {
      configurable: true,
      value: 48,
    });
    Object.defineProperty(scroll, "scrollHeight", {
      configurable: true,
      value: 48,
    });

    await waitFor(() => {
      expect(observers[0]?.targets).toHaveLength(2);
    });

    const currentObserver = observers[0];
    expect(currentObserver).toBeDefined();
    if (!currentObserver) return;

    const [topSentinel, bottomSentinel] = currentObserver.targets;
    expect(topSentinel).toBeDefined();
    expect(bottomSentinel).toBeDefined();
    if (!topSentinel || !bottomSentinel) return;

    act(() => {
      currentObserver.trigger([
        { target: topSentinel, isIntersecting: false },
        { target: bottomSentinel, isIntersecting: false },
      ]);
    });

    expect(
      container.querySelector('[data-queued-messages-fade="above"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-queued-messages-fade="below"]'),
    ).toBeNull();
  });
});
