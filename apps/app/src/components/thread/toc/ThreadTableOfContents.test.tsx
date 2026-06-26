// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ThreadConversationOutlineItem,
  ThreadConversationOutlineResponse,
  TimelineRow,
} from "@bb/server-contract";

// The minimap now sources items from the conversation-outline query, so the
// component needs a QueryClient unless we mock the hook. Mocking also lets us
// drive the outline (and the scroll surface) directly without a provider tree.
vi.mock("@/components/ui/bottom-anchored-scroll-body.js", () => ({
  useBottomAnchoredScroll: vi.fn(),
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  useThreadConversationOutline: vi.fn(),
}));

import { useBottomAnchoredScroll } from "@/components/ui/bottom-anchored-scroll-body.js";
import { useThreadConversationOutline } from "@/hooks/queries/thread-queries";
import {
  findActiveItemIds,
  selectTocRailItems,
  ThreadTableOfContents,
  type TocItem,
} from "./ThreadTableOfContents";

class ResizeObserverMock implements ResizeObserver {
  observe: ResizeObserver["observe"] = vi.fn();
  unobserve: ResizeObserver["unobserve"] = vi.fn();
  disconnect: ResizeObserver["disconnect"] = vi.fn();
}

function userConversationRow(index = 1): TimelineRow {
  return {
    id: `row_user_${index}`,
    threadId: "thr_toc_test",
    turnId: `turn_${index}`,
    sourceSeqStart: index,
    sourceSeqEnd: index,
    startedAt: index,
    createdAt: index,
    kind: "conversation",
    role: "user",
    text: `Loaded after client-side navigation ${index}`,
    attachments: null,
    initiator: "user",
    senderThreadId: null,
    systemMessageKind: "unlabeled",
    systemMessageSubject: null,
    turnRequest: {
      kind: "message",
      status: "accepted",
    },
    mentions: [],
  };
}

function TocHost({
  hasOlderTimelineRows = false,
  loadOlderTimelineRows = () => {},
  threadId = "thr_toc_test",
  timelineRows,
}: {
  hasOlderTimelineRows?: boolean;
  loadOlderTimelineRows?: () => void | Promise<void>;
  threadId?: string;
  timelineRows: readonly TimelineRow[];
}) {
  return (
    <div
      ref={(node) => {
        if (!node) return;
        Object.defineProperty(node, "clientWidth", {
          configurable: true,
          value: 1_200,
        });
      }}
      data-scroll-overlay=""
    >
      <ThreadTableOfContents
        threadId={threadId}
        timelineRows={timelineRows}
        hasOlderTimelineRows={hasOlderTimelineRows}
        loadOlderTimelineRows={loadOlderTimelineRows}
      />
    </div>
  );
}

function rect({ bottom, top }: { bottom: number; top: number }): DOMRect {
  return {
    bottom,
    height: bottom - top,
    left: 0,
    right: 100,
    toJSON: () => ({}),
    top,
    width: 100,
    x: 0,
    y: top,
  };
}

function createScrollElement({
  clientHeight,
  rows,
  scrollHeight,
  scrollTop,
}: {
  clientHeight: number;
  rows: ReadonlyArray<{ id: string; bottom: number; top: number }>;
  scrollHeight: number;
  scrollTop: number;
}): HTMLElement {
  const scrollElement = document.createElement("div");
  Object.defineProperty(scrollElement, "clientHeight", {
    configurable: true,
    value: clientHeight,
  });
  Object.defineProperty(scrollElement, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(scrollElement, "scrollTop", {
    configurable: true,
    value: scrollTop,
  });
  scrollElement.getBoundingClientRect = () =>
    rect({ bottom: clientHeight, top: 0 });

  for (const row of rows) {
    const rowElement = document.createElement("div");
    rowElement.dataset.timelineRowId = row.id;
    rowElement.getBoundingClientRect = () =>
      rect({ bottom: row.bottom, top: row.top });
    scrollElement.append(rowElement);
  }

  return scrollElement;
}

function outlineResponse(
  items: ThreadConversationOutlineItem[],
): ThreadConversationOutlineResponse {
  return { items, maxSeq: items.length };
}

function setOutline(items: ThreadConversationOutlineItem[] | undefined): void {
  vi.mocked(useThreadConversationOutline).mockReturnValue({
    data: items === undefined ? undefined : outlineResponse(items),
  } as ReturnType<typeof useThreadConversationOutline>);
}

function timelineRowElement(id: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-timeline-row-id", id);
  return el;
}

const userItems: TocItem[] = [
  { id: "user-1", label: "First prompt", role: "user" },
  { id: "user-2", label: "Second prompt", role: "user" },
];

const agentItems: TocItem[] = [
  { id: "agent-1", label: "First response", role: "assistant" },
  { id: "agent-2", label: "Second response", role: "assistant" },
];

function manyUserItems(count: number): TocItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `user-${index + 1}`,
    label: `Question ${index + 1}`,
    role: "user",
  }));
}

let scrollElement: HTMLElement;
let scrollElementIntoView: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());

  scrollElement = document.createElement("div");
  scrollElementIntoView = vi.fn();
  vi.mocked(useBottomAnchoredScroll).mockReturnValue({
    getScrollElement: () => scrollElement,
    isAtBottom: false,
    scrollToBottom: vi.fn(),
    scrollElementIntoView,
    scrollElementIntoViewClampedToMaxScroll: vi.fn(),
    captureScrollAnchor: vi.fn(),
  } as unknown as ReturnType<typeof useBottomAnchoredScroll>);

  // Default: outline not loaded, so the minimap falls back to timelineRows.
  setOutline(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("selectTocRailItems", () => {
  it("caps long thread rails to evenly sampled markers", () => {
    const items = manyUserItems(50);

    const railItems = selectTocRailItems({ activeId: null, items });

    expect(railItems).toHaveLength(20);
    expect(railItems.at(0)?.id).toBe("user-1");
    expect(railItems.at(-1)?.id).toBe("user-50");
    expect(railItems.map((item) => item.id)).not.toEqual(
      items.slice(0, 20).map((item) => item.id),
    );
  });

  it("keeps the active marker when the rail is capped", () => {
    const items = manyUserItems(50);

    const railItems = selectTocRailItems({
      activeId: "user-20",
      items,
    });

    expect(railItems).toHaveLength(20);
    expect(railItems.map((item) => item.id)).toContain("user-20");
  });
});

describe("ThreadTableOfContents", () => {
  it("shows after timeline rows arrive following an empty initial render", async () => {
    const view = render(<TocHost timelineRows={[]} />);

    expect(screen.queryByText("Your messages")).toBeNull();

    view.rerender(
      <TocHost
        timelineRows={[
          userConversationRow(1),
          userConversationRow(2),
          userConversationRow(3),
        ]}
      />,
    );

    expect(await screen.findByText("Your messages")).not.toBeNull();
    expect(
      screen.getByText("Loaded after client-side navigation 1"),
    ).not.toBeNull();
  });

  it("stays hidden until there are at least three user messages", () => {
    const view = render(
      <TocHost
        timelineRows={[userConversationRow(1), userConversationRow(2)]}
      />,
    );

    expect(screen.queryByText("Your messages")).toBeNull();

    view.rerender(
      <TocHost
        timelineRows={[
          userConversationRow(1),
          userConversationRow(2),
          userConversationRow(3),
        ]}
      />,
    );

    expect(screen.queryByText("Your messages")).not.toBeNull();
  });

  it("renders the full conversation outline, including attachment-only labels", async () => {
    setOutline([
      {
        id: "u1",
        role: "user",
        preview: "First question",
        attachmentSummary: null,
      },
      {
        id: "a1",
        role: "assistant",
        preview: "First answer",
        attachmentSummary: null,
      },
      {
        id: "u2",
        role: "user",
        preview: "Second question",
        attachmentSummary: null,
      },
      {
        id: "u3",
        role: "user",
        preview: "",
        attachmentSummary: { imageCount: 1, fileCount: 0 },
      },
    ]);

    // timelineRows is empty: the minimap lists the full thread from the outline,
    // not just the loaded window.
    render(<TocHost timelineRows={[]} />);

    expect(await screen.findByText("First question")).not.toBeNull();
    expect(screen.getByText("Second question")).not.toBeNull();
    expect(screen.getByText("Image attachment")).not.toBeNull();
    // The agent tab is offered because the outline has assistant messages.
    expect(screen.getByText("Agent messages")).not.toBeNull();
  });

  it("scrolls straight to a message already loaded in the window", async () => {
    scrollElement.appendChild(timelineRowElement("u2"));
    const loadOlder = vi.fn();
    setOutline([
      {
        id: "u1",
        role: "user",
        preview: "First question",
        attachmentSummary: null,
      },
      {
        id: "u2",
        role: "user",
        preview: "Loaded question",
        attachmentSummary: null,
      },
      {
        id: "u3",
        role: "user",
        preview: "Third question",
        attachmentSummary: null,
      },
    ]);

    render(
      <TocHost
        timelineRows={[]}
        hasOlderTimelineRows
        loadOlderTimelineRows={loadOlder}
      />,
    );
    fireEvent.click(await screen.findByText("Loaded question"));

    await waitFor(() => expect(scrollElementIntoView).toHaveBeenCalledTimes(1));
    expect(loadOlder).not.toHaveBeenCalled();
  });

  it("auto-paginates older pages to reach an unloaded message, then scrolls to it", async () => {
    // The target isn't in the loaded window; loadOlder simulates it paginating
    // in, mirroring the real controller prepending older rows to the DOM.
    const loadOlder = vi.fn(() => {
      scrollElement.appendChild(timelineRowElement("u_old"));
    });
    setOutline([
      {
        id: "u_old",
        role: "user",
        preview: "Ancient question",
        attachmentSummary: null,
      },
      {
        id: "u2",
        role: "user",
        preview: "Second question",
        attachmentSummary: null,
      },
      {
        id: "u3",
        role: "user",
        preview: "Third question",
        attachmentSummary: null,
      },
    ]);

    render(
      <TocHost
        timelineRows={[]}
        hasOlderTimelineRows
        loadOlderTimelineRows={loadOlder}
      />,
    );
    fireEvent.click(await screen.findByText("Ancient question"));

    await waitFor(() => expect(loadOlder).toHaveBeenCalled());
    await waitFor(() => expect(scrollElementIntoView).toHaveBeenCalled());
  });

  it("does not paginate when there are no older pages to load", async () => {
    const loadOlder = vi.fn();
    setOutline([
      {
        id: "missing",
        role: "user",
        preview: "Unreachable",
        attachmentSummary: null,
      },
      {
        id: "u2",
        role: "user",
        preview: "Second question",
        attachmentSummary: null,
      },
      {
        id: "u3",
        role: "user",
        preview: "Third question",
        attachmentSummary: null,
      },
    ]);

    render(
      <TocHost
        timelineRows={[]}
        hasOlderTimelineRows={false}
        loadOlderTimelineRows={loadOlder}
      />,
    );
    fireEvent.click(await screen.findByText("Unreachable"));

    // hasOlder is false, so the loop body never runs; no scroll, no pagination.
    await waitFor(() => expect(loadOlder).not.toHaveBeenCalled());
    expect(scrollElementIntoView).not.toHaveBeenCalled();
  });

  it("tracks the conversation item nearest the viewport top away from bottom", () => {
    const scrollElement = createScrollElement({
      clientHeight: 100,
      scrollHeight: 1_000,
      scrollTop: 400,
      rows: [
        { id: "user-1", top: 10, bottom: 30 },
        { id: "agent-1", top: 35, bottom: 55 },
        { id: "user-2", top: 80, bottom: 100 },
        { id: "agent-2", top: 105, bottom: 125 },
      ],
    });

    expect(findActiveItemIds({ agentItems, scrollElement, userItems })).toEqual(
      {
        agent: "agent-1",
        user: "user-1",
      },
    );
  });

  it("ignores conversation items above the viewport", () => {
    const scrollElement = createScrollElement({
      clientHeight: 100,
      scrollHeight: 1_000,
      scrollTop: 400,
      rows: [
        { id: "user-1", top: -30, bottom: -10 },
        { id: "agent-1", top: -8, bottom: -1 },
        { id: "user-2", top: 30, bottom: 50 },
        { id: "agent-2", top: 60, bottom: 80 },
      ],
    });

    expect(findActiveItemIds({ agentItems, scrollElement, userItems })).toEqual(
      {
        agent: "agent-2",
        user: "user-2",
      },
    );
  });

  it("tracks the latest visible conversation item at the bottom", () => {
    const scrollElement = createScrollElement({
      clientHeight: 100,
      scrollHeight: 1_000,
      scrollTop: 900,
      rows: [
        { id: "user-1", top: 10, bottom: 30 },
        { id: "agent-1", top: 35, bottom: 55 },
        { id: "user-2", top: 80, bottom: 100 },
        { id: "agent-2", top: 90, bottom: 110 },
      ],
    });

    expect(findActiveItemIds({ agentItems, scrollElement, userItems })).toEqual(
      {
        agent: "agent-2",
        user: "user-2",
      },
    );
  });

  it("does not mark a role active at the bottom when that role is offscreen", () => {
    const scrollElement = createScrollElement({
      clientHeight: 100,
      scrollHeight: 1_000,
      scrollTop: 900,
      rows: [
        { id: "user-1", top: -120, bottom: -80 },
        { id: "user-2", top: -60, bottom: -20 },
        { id: "agent-2", top: 20, bottom: 90 },
      ],
    });

    expect(findActiveItemIds({ agentItems, scrollElement, userItems })).toEqual(
      {
        agent: "agent-2",
        user: null,
      },
    );
  });
});
