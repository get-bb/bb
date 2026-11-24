// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ThreadConversationOutlineItem,
  ThreadConversationOutlineResponse,
  TimelineRow,
} from "@bb/server-contract";
import { threadTimelineQueryKey } from "@/hooks/queries/query-keys";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeThreadTimelineResponse } from "@/test/fixtures/thread-responses";
import { conversationRow, turnRow } from "@/test/fixtures/thread-timeline-rows";

const outlineRequests = vi.hoisted(() => ({
  enabled: [] as boolean[],
  data: undefined as ThreadConversationOutlineResponse | undefined,
}));

vi.mock("@/hooks/queries/thread-panel-queries", async (importActual) => ({
  ...(await importActual<
    typeof import("@/hooks/queries/thread-panel-queries")
  >()),
  useThreadConversationOutline: (
    _threadId: string,
    _role: string,
    options: { enabled: boolean },
  ) => {
    outlineRequests.enabled.push(options.enabled);
    return {
      data: options.enabled ? outlineRequests.data : undefined,
      status: options.enabled && outlineRequests.data ? "success" : "pending",
    };
  },
}));

import { useConversationOutline } from "./conversation-outline";
import { TimelineViewportProvider } from "./timeline-viewport";

const THREAD_ID = "thr_outline";

afterEach(() => {
  cleanup();
  outlineRequests.enabled.length = 0;
  outlineRequests.data = undefined;
});

function outlineItem(
  overrides: Partial<ThreadConversationOutlineItem> & { id: string },
): ThreadConversationOutlineItem {
  return {
    messageSeq: 1,
    role: "user",
    preview: "",
    attachmentSummary: null,
    ...overrides,
  };
}

async function setTimeline(
  queryClient: QueryClient,
  rows: TimelineRow[],
  contextBoundarySeq: number | null = null,
) {
  await act(async () => {
    queryClient.setQueryData(
      threadTimelineQueryKey(THREAD_ID),
      makeThreadTimelineResponse({ rows, contextBoundarySeq }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function renderOutline(
  role: "user" | "assistant",
  options?: { enabled?: boolean },
) {
  const { queryClient, wrapper } = createQueryClientTestHarness();
  const view = renderHook(
    () => useConversationOutline(THREAD_ID, role, options),
    { wrapper },
  );
  return { queryClient, view };
}

describe("useConversationOutline", () => {
  it("lays the open pane's live messages over the whole-thread read and appends new ones", async () => {
    outlineRequests.data = {
      maxSeq: 40,
      items: [
        outlineItem({ id: "u1", messageSeq: 1, preview: "First prompt" }),
        outlineItem({ id: "u2", messageSeq: 20, preview: "Stale preview" }),
        outlineItem({
          id: "u3",
          messageSeq: 30,
          preview: "[bb message from thread:thr_sender] Please review",
        }),
      ],
    };
    const { queryClient, view } = renderOutline("user");
    await setTimeline(queryClient, [
      conversationRow({
        id: "u2",
        role: "user",
        seq: 20,
        text: "Edited   second\nprompt",
      }),
      conversationRow({
        id: "a2",
        role: "assistant",
        seq: 25,
        text: "A reply",
      }),
      conversationRow({
        id: "u4",
        role: "user",
        seq: 50,
        text: "",
        attachments: {
          webImages: 1,
          localImages: 1,
          localFiles: 1,
          imageUrls: [],
          localImagePaths: [],
          localFilePaths: [],
          localFileDetails: [],
        },
      }),
    ]);
    expect(view.result.current.status).toBe("ready");
    expect(view.result.current.items).toEqual([
      expect.objectContaining({ id: "u1", preview: "First prompt" }),
      expect.objectContaining({ id: "u2", preview: "Edited second prompt" }),
      expect.objectContaining({
        id: "u3",
        preview: "Please review",
        senderThreadId: "thr_sender",
      }),
      expect.objectContaining({
        id: "u4",
        messageSeq: 50,
        preview: "",
        attachmentSummary: { imageCount: 2, fileCount: 1 },
      }),
    ]);
  });

  it("counts messages nested under a collapsed turn", async () => {
    const { queryClient, view } = renderOutline("assistant");
    await setTimeline(queryClient, [
      turnRow({
        id: "turn-1",
        children: [
          conversationRow({ id: "a1", role: "assistant", seq: 3, text: "Hi" }),
        ],
      }),
    ]);
    expect(view.result.current.items.map((item) => item.id)).toEqual(["a1"]);
  });

  it("drops a whole-thread read taken before the latest context clear", async () => {
    outlineRequests.data = {
      maxSeq: 10,
      items: [outlineItem({ id: "old", preview: "Before the clear" })],
    };
    const { queryClient, view } = renderOutline("user");
    await setTimeline(
      queryClient,
      [conversationRow({ id: "new", role: "user", seq: 30, text: "After" })],
      20,
    );
    expect(view.result.current.status).toBe("loading");
    expect(view.result.current.items.map((item) => item.id)).toEqual(["new"]);
  });

  it("waits for its own pane's first timeline page before reading the whole thread, and never reads while disabled", () => {
    const { queryClient } = createQueryClientTestHarness();
    renderHook(() => useConversationOutline(THREAD_ID, "user"), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          <TimelineViewportProvider messageIds={new Set()} threadId={THREAD_ID}>
            {children}
          </TimelineViewportProvider>
        </QueryClientProvider>
      ),
    });
    expect(outlineRequests.enabled).not.toContain(true);
    outlineRequests.enabled.length = 0;
    renderOutline("user");
    expect(outlineRequests.enabled).toContain(true);
    outlineRequests.enabled.length = 0;
    renderOutline("user", { enabled: false });
    expect(outlineRequests.enabled).not.toContain(true);
  });

  it("does not re-render while the pane refetches an unchanged timeline", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const timeline = makeThreadTimelineResponse({
      rows: [conversationRow({ id: "u1", role: "user", seq: 1, text: "Go" })],
    });
    queryClient.setQueryData(threadTimelineQueryKey(THREAD_ID), timeline);
    let renders = 0;
    renderHook(
      () => {
        renders += 1;
        return useConversationOutline(THREAD_ID, "user");
      },
      { wrapper },
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const settled = renders;
    for (let index = 0; index < 5; index += 1) {
      await act(async () => {
        await queryClient.fetchQuery({
          queryKey: threadTimelineQueryKey(THREAD_ID),
          queryFn: async () => timeline,
          staleTime: 0,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(renders).toBe(settled);
  });

  it("keeps the user list's identity while a reply streams, and moves the assistant list with it", async () => {
    const user = renderOutline("user");
    const assistant = renderOutline("assistant");
    const prompt = conversationRow({
      id: "u1",
      role: "user",
      seq: 1,
      text: "Go",
    });
    const streaming = (seq: number, text: string) => [
      prompt,
      conversationRow({ id: "a1", role: "assistant", seq, text }),
    ];
    await setTimeline(user.queryClient, streaming(2, "Partial"));
    await setTimeline(assistant.queryClient, streaming(2, "Partial"));
    const userItems = user.view.result.current.items;
    const assistantItems = assistant.view.result.current.items;
    await setTimeline(user.queryClient, streaming(3, "Partial reply"));
    await setTimeline(assistant.queryClient, streaming(3, "Partial reply"));
    expect(user.view.result.current.items).toBe(userItems);
    expect(assistant.view.result.current.items).not.toBe(assistantItems);
    expect(assistant.view.result.current.items[0]?.messageSeq).toBe(3);
  });
});
