// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  defaultScheduler,
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { threadsQueryKey } from "@/hooks/queries/query-keys";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "./ThreadTimelineRows";
import { settleLazyModules } from "@/test/lazy-modules";

const renderRecorder = await vi.hoisted(async () => {
  const { installRenderRecorder } = await import("@/test/render-recorder");
  return installRenderRecorder();
});

const SENDERS = ["thr_sender_a", "thr_sender_b", "thr_sender_c"];

function senderRow(senderThreadId: string, index: number) {
  return conversationRow({
    id: `message_from_${senderThreadId}`,
    role: "user",
    initiator: "agent",
    senderThreadId,
    text: `Report number ${index}.`,
    sourceSeqStart: index + 1,
    sourceSeqEnd: index + 1,
    threadId: "thr_main",
  });
}

function threadList(titles: Record<string, string>) {
  return [...SENDERS, "thr_unrelated"].map((id) =>
    makeThreadListEntry({ id, title: titles[id] ?? `Title of ${id}` }),
  );
}

function renderedRowIds(componentName: string): string[] {
  return renderRecorder
    .propsOf(componentName)
    .map((props) => (props as { row: { id: string } }).row.id)
    .sort();
}

beforeEach(() => {
  notifyManager.setScheduler((notify) => notify());
});

afterEach(() => {
  cleanup();
  notifyManager.setScheduler(defaultScheduler);
  renderRecorder.reset();
});

afterAll(() => {
  renderRecorder.uninstall();
});

describe("ThreadTimelineRows sender thread titles", () => {
  it("re-renders only the rows sent by a renamed thread", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(threadsQueryKey(), threadList({}));
    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <ThreadTimelineRows
            threadId="thr_main"
            timelineRows={SENDERS.map(senderRow)}
            threadRuntimeDisplayStatus="idle"
          />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("Title of thr_sender_b")).toBeDefined();
    await settleLazyModules();

    renderRecorder.reset();
    act(() => {
      queryClient.setQueryData(
        threadsQueryKey(),
        threadList({ thr_unrelated: "Renamed elsewhere" }),
      );
    });
    expect(renderedRowIds("ConversationRowContent")).toEqual([]);

    act(() => {
      queryClient.setQueryData(
        threadsQueryKey(),
        threadList({ thr_sender_b: "Renamed sender" }),
      );
    });
    expect(screen.getByText("Renamed sender")).toBeDefined();
    expect(renderedRowIds("ConversationRowContent")).toEqual([
      "message_from_thr_sender_b",
    ]);
  });
});
