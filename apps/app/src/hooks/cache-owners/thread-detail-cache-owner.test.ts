import { QueryClient } from "@tanstack/react-query";
import type {
  ThreadTimelineResponse,
  ThreadWithIncludesResponse,
} from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { ingestThreadDetailBootstrap } from "./thread-detail-cache-owner";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    threads: {
      timeline: vi.fn(),
    },
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("ingestThreadDetailBootstrap", () => {
  it("prefetches the bounded app timeline window", async () => {
    vi.mocked(sdk.threads.timeline).mockResolvedValue(
      {} as ThreadTimelineResponse,
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const thread = {
      environment: null,
      host: null,
      id: "thread-1",
    } as ThreadWithIncludesResponse;

    ingestThreadDetailBootstrap({
      queryClient,
      thread,
      timelinePrefetch: true,
    });

    await vi.waitFor(() => {
      expect(sdk.threads.timeline).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(sdk.threads.timeline).mock.calls[0]?.[0]).toEqual({
      segmentLimit: "8",
      signal: expect.any(AbortSignal),
      threadId: "thread-1",
    });

    queryClient.clear();
  });
});
