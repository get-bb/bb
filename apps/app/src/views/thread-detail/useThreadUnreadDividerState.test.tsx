// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import { ThreadTimelineRows } from "@/components/thread/timeline";
import { BottomAnchoredScrollBody } from "@/components/ui/bottom-anchored-scroll-body";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import {
  useThreadUnreadDividerState,
  type UseThreadUnreadDividerStateArgs,
} from "./useThreadUnreadDividerState";

type UnreadDividerThreadState = NonNullable<
  UseThreadUnreadDividerStateArgs["thread"]
>;

interface ThreadUnreadTimelineHarnessProps {
  thread: UnreadDividerThreadState;
  timelineRows: TimelineRow[];
}

interface ScrollMetrics {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}

interface TestRect {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

function expectElementBefore(firstElement: Element, secondElement: Element) {
  expect(
    firstElement.compareDocumentPosition(secondElement) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).not.toBe(0);
}

function buildDomRect(rect: TestRect): DOMRect {
  return new DOMRect(rect.left, rect.top, rect.width, rect.height);
}

function setScrollMetrics(element: HTMLElement, metrics: ScrollMetrics) {
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: metrics.clientHeight,
  });
  element.scrollTop = metrics.scrollTop;
}

function requireHTMLElement(element: Element | null): HTMLElement {
  if (!(element instanceof HTMLElement)) {
    throw new Error("Expected HTMLElement.");
  }
  return element;
}

function ThreadUnreadTimelineHarness({
  thread,
  timelineRows,
}: ThreadUnreadTimelineHarnessProps) {
  const unreadDividerState = useThreadUnreadDividerState({
    routeThreadId: thread?.id,
    thread,
  });

  return (
    <ThreadTimelineRows
      threadId={thread?.id}
      threadRuntimeDisplayStatus="idle"
      timelineRows={timelineRows}
      unreadDividerAutoScroll={unreadDividerState.autoScroll}
      unreadDividerPlacement={unreadDividerState.placement}
      workspaceRootPath={undefined}
    />
  );
}

function ThreadUnreadScrollTimelineHarness(
  props: ThreadUnreadTimelineHarnessProps,
) {
  return (
    <BottomAnchoredScrollBody
      footer={<div />}
      maxWidthClassName="max-w-none"
      scrollAreaClassName="scroll-area"
    >
      <ThreadUnreadTimelineHarness {...props} />
    </BottomAnchoredScrollBody>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useThreadUnreadDividerState", () => {
  it("re-arms when a mounted read thread gets a new attention epoch", async () => {
    const readThread: UnreadDividerThreadState = {
      id: "thread-1",
      lastReadAt: 1_000,
      latestAttentionAt: 1_000,
    };
    const unreadThread: UnreadDividerThreadState = {
      ...readThread,
      latestAttentionAt: 2_000,
    };
    const markedReadThread: UnreadDividerThreadState = {
      ...unreadThread,
      lastReadAt: 2_500,
    };
    const timelineRows = [
      conversationRow({
        id: "already-read-row",
        sourceSeqStart: 1_000,
        text: "Already-read thread context",
      }),
      conversationRow({
        id: "new-attention-row",
        sourceSeqStart: 2_000,
        text: "Thread update requiring attention",
      }),
    ];
    const view = render(
      <ThreadUnreadTimelineHarness
        thread={readThread}
        timelineRows={timelineRows}
      />,
    );
    expect(
      screen.queryByRole("separator", { name: "New messages" }),
    ).toBeNull();

    view.rerender(
      <ThreadUnreadTimelineHarness
        thread={unreadThread}
        timelineRows={timelineRows}
      />,
    );

    const divider = await screen.findByRole("separator", {
      name: "New messages",
    });
    expectElementBefore(
      screen.getByText("Already-read thread context"),
      divider,
    );
    expectElementBefore(
      divider,
      screen.getByText("Thread update requiring attention"),
    );

    view.rerender(
      <ThreadUnreadTimelineHarness
        thread={markedReadThread}
        timelineRows={timelineRows}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("separator", { name: "New messages" }),
      ).not.toBeNull(),
    );
  });

  it("scrolls to the timeline bottom when the unread divider stays visible there", async () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.useFakeTimers();

    try {
      const unreadThread: UnreadDividerThreadState = {
        id: "thread-1",
        lastReadAt: 1_000,
        latestAttentionAt: 2_000,
      };
      const timelineRows = [
        conversationRow({
          id: "already-read-row",
          sourceSeqStart: 1_000,
          text: "Already-read thread context",
        }),
        conversationRow({
          id: "first-new-row",
          sourceSeqStart: 2_000,
          text: "First update requiring attention",
        }),
      ];

      const view = render(
        <ThreadUnreadScrollTimelineHarness
          thread={unreadThread}
          timelineRows={timelineRows}
        />,
      );
      const scrollArea = requireHTMLElement(
        view.container.querySelector(".scroll-area"),
      );
      const divider = screen.getByRole("separator", {
        name: "New messages",
      });
      setScrollMetrics(scrollArea, {
        clientHeight: 100,
        scrollHeight: 1_000,
        scrollTop: 400,
      });
      vi.spyOn(scrollArea, "getBoundingClientRect").mockReturnValue(
        buildDomRect({
          bottom: 100,
          height: 100,
          left: 0,
          right: 100,
          top: 0,
          width: 100,
        }),
      );
      vi.spyOn(divider, "getBoundingClientRect").mockReturnValue(
        buildDomRect({
          bottom: 540,
          height: 20,
          left: 0,
          right: 100,
          top: 520,
          width: 100,
        }),
      );

      await vi.runOnlyPendingTimersAsync();

      expect(scrollArea.scrollTop).toBe(900);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not scroll to the divider for a live attention epoch on a mounted read thread", async () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.useFakeTimers();

    try {
      const readThread: UnreadDividerThreadState = {
        id: "thread-1",
        lastReadAt: 1_000,
        latestAttentionAt: 1_000,
      };
      const unreadThread: UnreadDividerThreadState = {
        ...readThread,
        latestAttentionAt: 2_000,
      };
      const timelineRows = [
        conversationRow({
          id: "already-read-row",
          sourceSeqStart: 1_000,
          text: "Already-read thread context",
        }),
        conversationRow({
          id: "live-update-row",
          sourceSeqStart: 2_000,
          text: "Live update requiring attention",
        }),
      ];

      const view = render(
        <ThreadUnreadScrollTimelineHarness
          thread={readThread}
          timelineRows={timelineRows}
        />,
      );
      const scrollArea = requireHTMLElement(
        view.container.querySelector(".scroll-area"),
      );
      setScrollMetrics(scrollArea, {
        clientHeight: 100,
        scrollHeight: 1_000,
        scrollTop: 900,
      });
      vi.spyOn(scrollArea, "getBoundingClientRect").mockReturnValue(
        buildDomRect({
          bottom: 100,
          height: 100,
          left: 0,
          right: 100,
          top: 0,
          width: 100,
        }),
      );

      view.rerender(
        <ThreadUnreadScrollTimelineHarness
          thread={unreadThread}
          timelineRows={timelineRows}
        />,
      );

      const divider = screen.getByRole("separator", {
        name: "New messages",
      });
      vi.spyOn(divider, "getBoundingClientRect").mockReturnValue(
        buildDomRect({
          bottom: -380,
          height: 20,
          left: 0,
          right: 100,
          top: -400,
          width: 100,
        }),
      );

      await vi.runOnlyPendingTimersAsync();

      expect(scrollArea.scrollTop).toBe(900);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not remount or rescroll an existing divider during a sequential attention bump", async () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.useFakeTimers();

    try {
      const unreadThread: UnreadDividerThreadState = {
        id: "thread-1",
        lastReadAt: 1_000,
        latestAttentionAt: 2_000,
      };
      const bumpedUnreadThread: UnreadDividerThreadState = {
        ...unreadThread,
        latestAttentionAt: 3_000,
      };
      const timelineRows = [
        conversationRow({
          id: "already-read-row",
          sourceSeqStart: 1_000,
          text: "Already-read thread context",
        }),
        conversationRow({
          id: "first-new-row",
          sourceSeqStart: 2_000,
          text: "First update requiring attention",
        }),
        conversationRow({
          id: "second-new-row",
          sourceSeqStart: 3_000,
          text: "Second update requiring attention",
        }),
      ];

      const view = render(
        <ThreadUnreadScrollTimelineHarness
          thread={unreadThread}
          timelineRows={timelineRows}
        />,
      );
      const scrollArea = requireHTMLElement(
        view.container.querySelector(".scroll-area"),
      );
      const divider = screen.getByRole("separator", {
        name: "New messages",
      });
      setScrollMetrics(scrollArea, {
        clientHeight: 100,
        scrollHeight: 1_000,
        scrollTop: 0,
      });
      vi.spyOn(scrollArea, "getBoundingClientRect").mockReturnValue(
        buildDomRect({
          bottom: 100,
          height: 100,
          left: 0,
          right: 100,
          top: 0,
          width: 100,
        }),
      );
      vi.spyOn(divider, "getBoundingClientRect").mockReturnValue(
        buildDomRect({
          bottom: 320,
          height: 20,
          left: 0,
          right: 100,
          top: 300,
          width: 100,
        }),
      );

      await vi.runOnlyPendingTimersAsync();
      expect(scrollArea.scrollTop).toBe(300);

      view.rerender(
        <ThreadUnreadScrollTimelineHarness
          thread={bumpedUnreadThread}
          timelineRows={timelineRows}
        />,
      );

      expect(screen.getByRole("separator", { name: "New messages" })).toBe(
        divider,
      );

      await vi.runOnlyPendingTimersAsync();
      expect(scrollArea.scrollTop).toBe(300);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not place the divider above a user-authored accepted steer", async () => {
    const unreadThread: UnreadDividerThreadState = {
      id: "thread-1",
      lastReadAt: 1_500,
      latestAttentionAt: 3_000,
    };
    const timelineRows = [
      conversationRow({
        id: "already-read-row",
        sourceSeqStart: 1_000,
        text: "Already-read context",
      }),
      conversationRow({
        id: "accepted-steer-row",
        role: "user",
        sourceSeqStart: 2_000,
        text: "My steer",
        turnRequest: { kind: "steer", status: "accepted" },
      }),
      conversationRow({
        id: "new-assistant-row",
        sourceSeqStart: 3_000,
        text: "Incoming update",
      }),
    ];

    render(
      <ThreadUnreadTimelineHarness
        thread={unreadThread}
        timelineRows={timelineRows}
      />,
    );

    const divider = await screen.findByRole("separator", {
      name: "New messages",
    });
    expectElementBefore(screen.getByText("My steer"), divider);
    expectElementBefore(divider, screen.getByText("Incoming update"));
  });

  it("places the divider above an agent-initiated user row", async () => {
    const agentHandoffText =
      "Agent handoff with enough additional detail to render the generated message row as an expandable button in jsdom.";
    const unreadThread: UnreadDividerThreadState = {
      id: "thread-1",
      lastReadAt: 1_500,
      latestAttentionAt: 2_000,
    };
    const timelineRows = [
      conversationRow({
        id: "already-read-row",
        sourceSeqStart: 1_000,
        text: "Already-read context",
      }),
      conversationRow({
        id: "agent-initiated-user-row",
        initiator: "agent",
        role: "user",
        sourceSeqStart: 2_000,
        text: agentHandoffText,
        turnRequest: { kind: "message", status: "accepted" },
      }),
    ];

    render(
      <ThreadUnreadTimelineHarness
        thread={unreadThread}
        timelineRows={timelineRows}
      />,
    );

    const divider = await screen.findByRole("separator", {
      name: "New messages",
    });
    expectElementBefore(
      divider,
      screen.getByTitle("Message from Agent"),
    );
  });

  it("places the divider for parent threads", async () => {
    const unreadParentThread: UnreadDividerThreadState = {
      id: "thread-1",
      lastReadAt: 1_000,
      latestAttentionAt: 2_000,
    };
    render(
      <ThreadUnreadTimelineHarness
        thread={unreadParentThread}
        timelineRows={[
          conversationRow({
            id: "new-parent-row",
            sourceSeqStart: 2_000,
            text: "Parent timeline row",
          }),
        ]}
      />,
    );

    const divider = await screen.findByRole("separator", {
      name: "New messages",
    });
    expectElementBefore(divider, screen.getByText("Parent timeline row"));
  });
});
