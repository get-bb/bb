import type { ThreadTimelineResponse } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { createAppQueryClient } from "@/lib/query-client";
import { threadTimelineQueryKey } from "../queries/query-keys";
import { beginSendThreadMessageTransaction } from "./thread-runtime-cache-owner";

function makeTimelineResponse(): ThreadTimelineResponse {
  return {
    rows: [],
    activeThinking: null,
    pendingTodos: null,
    goal: null,
    timelinePage: {
      kind: "latest",
      segmentLimit: 20,
      returnedSegmentCount: 0,
      hasOlderRows: false,
      olderCursor: null,
    },
  };
}

describe("thread runtime cache owner", () => {
  it("omits agent-only text from optimistic user messages", async () => {
    const queryClient = createAppQueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
      showMutationErrorToasts: false,
    });
    queryClient.setQueryData(
      threadTimelineQueryKey("thread-1"),
      makeTimelineResponse(),
    );

    await beginSendThreadMessageTransaction({
      queryClient,
      request: {
        id: "thread-1",
        mode: "auto",
        input: [
          {
            type: "text",
            text: "Hidden source context",
            mentions: [],
            visibility: "agent-only",
          },
          {
            type: "text",
            text: "Visible question",
            mentions: [],
          },
        ],
      },
    });

    const timeline = queryClient.getQueryData<ThreadTimelineResponse>(
      threadTimelineQueryKey("thread-1"),
    );
    expect(timeline?.rows).toHaveLength(1);
    expect(timeline?.rows[0]).toMatchObject({
      kind: "conversation",
      role: "user",
      text: "Visible question",
    });
  });
});
