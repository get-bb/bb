import type { ThreadTimelineResponse } from "@bb/server-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getThreadTimeline } from "./api";

const mocks = vi.hoisted(() => ({
  timelineGet: vi.fn(),
}));

vi.mock("./api-server", () => ({
  apiClient: {
    threads: {
      ":id": {
        timeline: {
          $get: mocks.timelineGet,
        },
      },
    },
  },
  toRelativeUrl: (url: URL) => `${url.pathname}${url.search}`,
}));

function makeTimelineResponse(): ThreadTimelineResponse {
  return {
    rows: [],
    activeThinking: null,
    activeWorkflow: null,
    pendingTodos: null,
    goal: null,
    maxSeq: 0,
    timelinePage: {
      kind: "latest",
      segmentLimit: 20,
      returnedSegmentCount: 0,
      hasOlderRows: false,
      olderCursor: null,
    },
  };
}

describe("api timeline requests", () => {
  beforeEach(() => {
    mocks.timelineGet.mockReset();
    mocks.timelineGet.mockResolvedValue(
      new Response(JSON.stringify(makeTimelineResponse()), { status: 200 }),
    );
  });

  it("passes abort signals to the generated client", async () => {
    const controller = new AbortController();

    await getThreadTimeline({
      id: "thr_1",
      signal: controller.signal,
    });

    expect(mocks.timelineGet).toHaveBeenCalledWith(
      {
        param: { id: "thr_1" },
        query: {},
      },
      {
        init: {
          signal: controller.signal,
        },
      },
    );
  });
});
