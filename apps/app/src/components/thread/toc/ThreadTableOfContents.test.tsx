// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import {
  findActiveItemIds,
  ThreadTableOfContents,
  type TocItem,
} from "./ThreadTableOfContents";

class ResizeObserverMock implements ResizeObserver {
  observe: ResizeObserver["observe"] = vi.fn();
  unobserve: ResizeObserver["unobserve"] = vi.fn();
  disconnect: ResizeObserver["disconnect"] = vi.fn();
}

function userConversationRow(): TimelineRow {
  return {
    id: "row_user_1",
    threadId: "thr_toc_test",
    turnId: "turn_1",
    sourceSeqStart: 1,
    sourceSeqEnd: 1,
    startedAt: 1,
    createdAt: 1,
    kind: "conversation",
    role: "user",
    text: "Loaded after client-side navigation",
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

function TocHost({ timelineRows }: { timelineRows: readonly TimelineRow[] }) {
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
      <ThreadTableOfContents timelineRows={timelineRows} />
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

const userItems: TocItem[] = [
  { id: "user-1", label: "First prompt", role: "user" },
  { id: "user-2", label: "Second prompt", role: "user" },
];

const agentItems: TocItem[] = [
  { id: "agent-1", label: "First response", role: "assistant" },
  { id: "agent-2", label: "Second response", role: "assistant" },
];

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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ThreadTableOfContents", () => {
  it("shows after timeline rows arrive following an empty initial render", async () => {
    const view = render(<TocHost timelineRows={[]} />);

    expect(screen.queryByText("Your messages")).toBeNull();

    view.rerender(<TocHost timelineRows={[userConversationRow()]} />);

    expect(await screen.findByText("Your messages")).not.toBeNull();
    expect(
      screen.getByText("Loaded after client-side navigation"),
    ).not.toBeNull();
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
