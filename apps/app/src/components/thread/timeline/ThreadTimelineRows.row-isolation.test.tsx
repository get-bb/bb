// @vitest-environment jsdom

import type { ExperimentalMessageMetadataProps } from "@get-bb/plugin-sdk";
import { createElement, useState, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "./ThreadTimelineRows";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

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

function assistantRow(index: number) {
  return conversationRow({
    id: `assistant_message_${index}`,
    role: "assistant",
    text: `Assistant answer number ${index}.`,
    sourceSeqStart: 10 + index,
    sourceSeqEnd: 10 + index,
    threadId: "thr_main",
  });
}

afterEach(() => {
  cleanup();
  renderedMessageTexts.length = 0;
  resetPluginSlotStoreForTest();
});

describe("ThreadTimelineRows row isolation", () => {
  it.each(["user", "assistant"] as const)(
    "places metadata on either side of a %s message without duplicating contributions",
    (role) => {
      setPluginSlotRegistrations(
        "fixture",
        makePluginRegistrationSet({
          messageMetadata: [
            {
              id: "time",
              placement: "above",
              component: () => <span>Timestamp</span>,
            },
            { id: "status", component: () => <span>Status</span> },
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
              workspaceRootPath={undefined}
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
      expect(screen.getAllByText("Timestamp")).toHaveLength(1);
      expect(screen.getAllByText("Status")).toHaveLength(1);
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
    const renderTimeline = (text: string) => (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <ThreadTimelineRows
            threadId="thr_main"
            timelineRows={[
              conversationRow({
                id: "streaming_message",
                role: "assistant",
                text,
                createdAt: 1_700_000_000_123,
                threadId: "thr_main",
              }),
            ]}
            threadRuntimeDisplayStatus="active"
            workspaceRootPath={undefined}
          />
        </QueryClientProvider>
      </MemoryRouter>
    );
    const view = render(renderTimeline("first"));
    expect(component).toHaveBeenCalledTimes(1);
    view.rerender(renderTimeline("first second"));
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
            workspaceRootPath={undefined}
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
});
