// @vitest-environment jsdom

import type { ExperimentalMessageMetadataProps } from "@get-bb/plugin-sdk";
import { createElement, useState, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "./ThreadTimelineRows";
import { formatShortMessageTime } from "./message-time";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { settleLazyModules } from "@/test/lazy-modules";

const renderRecorder = await vi.hoisted(async () => {
  const { installRenderRecorder } = await import("@/test/render-recorder");
  return installRenderRecorder();
});
const renderedMessageTexts = vi.hoisted(() => [] as string[]);

vi.mock("./ConversationMessageContent.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./ConversationMessageContent.js")>();
  const Actual = actual.ConversationMessageContent;
  return {
    ...actual,
    ConversationMessageContent: (props: ComponentProps<typeof Actual>) => {
      renderedMessageTexts.push(props.text);
      return createElement(Actual, props);
    },
  };
});

function assistantRow(
  index: number,
  streamed?: { text: string; sourceSeqEnd: number },
) {
  return conversationRow({
    id: `assistant_message_${index}`,
    role: "assistant",
    text: streamed?.text ?? `Assistant answer number ${index}.`,
    sourceSeqStart: 10 + index,
    sourceSeqEnd: streamed?.sourceSeqEnd ?? 10 + index,
    threadId: "thr_main",
  });
}

afterEach(() => {
  cleanup();
  renderedMessageTexts.length = 0;
  renderRecorder.reset();
  resetPluginSlotStoreForTest();
});

afterAll(() => {
  renderRecorder.uninstall();
});

function renderedRowIds(componentName: string): string[] {
  return renderRecorder
    .propsOf(componentName)
    .map((props) => (props as { row: { id: string } }).row.id)
    .sort();
}

describe("ThreadTimelineRows row isolation", () => {
  it.each(["user", "assistant"] as const)(
    "places metadata above a %s message and in its action row without duplicating contributions",
    (role) => {
      setPluginSlotRegistrations(
        "fixture",
        makePluginRegistrationSet({
          messageMetadata: [
            { id: "time", component: () => <span>Timestamp</span> },
            {
              id: "status",
              placement: "actionRow",
              component: () => <span>Status</span>,
            },
          ],
        }),
      );
      render(
        <MemoryRouter>
          <QueryClientProvider client={new QueryClient()}>
            <ThreadTimelineRows
              threadId="thr_main"
              timelineRows={[
                conversationRow({
                  id: "placed",
                  role,
                  text: "Message body",
                  threadId: "thr_main",
                }),
              ]}
              threadRuntimeDisplayStatus="idle"
            />
          </QueryClientProvider>
        </MemoryRouter>,
      );
      const body = screen.getByText("Message body");
      const timestamp = screen.getByText("Timestamp");
      const status = screen.getByText("Status");
      expect(
        timestamp.compareDocumentPosition(body) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        body.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        screen
          .getByRole("button", { name: "Message actions" })
          .parentElement?.parentElement?.contains(status),
      ).toBe(true);
      expect(screen.getAllByText("Timestamp")).toHaveLength(1);
      expect(screen.getAllByText("Status")).toHaveLength(1);
    },
  );

  it.each([
    { role: "user" as const, timeFollowsMenu: false },
    { role: "assistant" as const, timeFollowsMenu: true },
  ])(
    "shows the $role message time in its action row without opening the menu",
    ({ role, timeFollowsMenu }) => {
      const startedAt = 1_700_000_000_123;
      render(
        <MemoryRouter>
          <QueryClientProvider client={new QueryClient()}>
            <ThreadTimelineRows
              threadId="thr_main"
              timelineRows={[
                conversationRow({
                  id: "timed",
                  role,
                  text: "Message body",
                  startedAt,
                  threadId: "thr_main",
                }),
              ]}
              threadRuntimeDisplayStatus="idle"
            />
          </QueryClientProvider>
        </MemoryRouter>,
      );
      const time = screen.getByText(
        formatShortMessageTime(startedAt, new Date()),
      );
      const menu = screen.getByRole("button", { name: "Message actions" });
      expect(time.tagName).toBe("TIME");
      expect(time.getAttribute("dateTime")).toBe(
        new Date(startedAt).toISOString(),
      );
      expect(menu.parentElement?.parentElement?.contains(time)).toBe(true);
      expect(
        Boolean(
          menu.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ).toBe(timeFollowsMenu);
    },
  );

  it("does not rerender metadata when assistant text streams", () => {
    const component = vi.fn((_: ExperimentalMessageMetadataProps) => {
      const [label, setLabel] = useState("Stable");
      return (
        <button onClick={() => setLabel("Updated metadata")}>{label}</button>
      );
    });
    setPluginSlotRegistrations(
      "fixture",
      makePluginRegistrationSet({
        messageMetadata: [{ id: "stable", component }],
      }),
    );
    const queryClient = new QueryClient();
    const renderTimeline = (text: string, createdAt: number) => (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <ThreadTimelineRows
            threadId="thr_main"
            timelineRows={[
              conversationRow({
                id: "streaming_message",
                role: "assistant",
                text,
                startedAt: 1_700_000_000_123,
                createdAt,
                threadId: "thr_main",
              }),
            ]}
            threadRuntimeDisplayStatus="active"
          />
        </QueryClientProvider>
      </MemoryRouter>
    );
    const view = render(renderTimeline("first", 1_700_000_000_123));
    expect(component).toHaveBeenCalledTimes(1);
    view.rerender(renderTimeline("first second", 1_700_000_000_456));
    expect(component).toHaveBeenCalledTimes(1);
    renderedMessageTexts.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Stable" }));
    expect(screen.getByText("Updated metadata")).toBeDefined();
    expect(renderedMessageTexts).toHaveLength(0);
  });

  it("re-renders only the rows whose mobile action display flips when a message is appended", () => {
    const queryClient = new QueryClient();
    const rows = Array.from({ length: 12 }, (_, index) => assistantRow(index));
    const renderTimeline = (timelineRows: typeof rows) => (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <ThreadTimelineRows
            threadId="thr_main"
            timelineRows={timelineRows}
            threadRuntimeDisplayStatus="idle"
          />
        </QueryClientProvider>
      </MemoryRouter>
    );
    const view = render(renderTimeline(rows));
    expect(renderedMessageTexts).toHaveLength(12);
    renderedMessageTexts.length = 0;

    view.rerender(renderTimeline([...rows, assistantRow(12)]));
    expect([...renderedMessageTexts].sort()).toEqual([
      "Assistant answer number 11.",
      "Assistant answer number 12.",
    ]);
  });

  it("re-renders only the streaming row when its text grows", async () => {
    const queryClient = new QueryClient();
    const rows = Array.from({ length: 12 }, (_, index) => assistantRow(index));
    const renderTimeline = (timelineRows: typeof rows) => (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <ThreadTimelineRows
            threadId="thr_main"
            timelineRows={timelineRows}
            threadRuntimeDisplayStatus="active"
          />
        </QueryClientProvider>
      </MemoryRouter>
    );
    const view = render(renderTimeline(rows));
    await settleLazyModules();
    renderRecorder.reset();

    view.rerender(
      renderTimeline([
        ...rows.slice(0, 11),
        assistantRow(11, {
          text: "Assistant answer number 11, continued.",
          sourceSeqEnd: 30,
        }),
      ]),
    );
    expect(
      screen.getByText("Assistant answer number 11, continued."),
    ).toBeDefined();
    expect(renderedRowIds("TimelineRowItem")).toEqual(["assistant_message_11"]);
    expect(renderedRowIds("ConversationRow")).toEqual(["assistant_message_11"]);
  });

  it("re-renders only the appended row and the rows whose state it moves", async () => {
    const queryClient = new QueryClient();
    const rows = Array.from({ length: 12 }, (_, index) => assistantRow(index));
    const renderTimeline = (timelineRows: typeof rows) => (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <ThreadTimelineRows
            threadId="thr_main"
            timelineRows={timelineRows}
            threadRuntimeDisplayStatus="active"
          />
        </QueryClientProvider>
      </MemoryRouter>
    );
    const view = render(renderTimeline(rows));
    await settleLazyModules();
    renderRecorder.reset();

    view.rerender(renderTimeline([...rows, assistantRow(12)]));
    expect(renderedRowIds("TimelineRowItem")).toEqual([
      "assistant_message_11",
      "assistant_message_12",
    ]);
    expect(renderedRowIds("ConversationRow")).toEqual([
      "assistant_message_11",
      "assistant_message_12",
    ]);
  });
});
