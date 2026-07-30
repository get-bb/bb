import { describe, expect, it, vi } from "vitest";
import type { ThreadConversationOutlineResponse } from "@bb/server-contract";
import { createThreadConversationOutlineCache } from "../../../src/services/threads/conversation-outline-cache.js";

function makeResponse(maxSeq: number): ThreadConversationOutlineResponse {
  return {
    items: [
      {
        id: `row-${maxSeq}`,
        role: "assistant",
        preview: `Answer at ${maxSeq}`,
        attachmentSummary: null,
      },
    ],
    maxSeq,
  };
}

describe("createThreadConversationOutlineCache", () => {
  it("builds once for the same thread revision", () => {
    const cache = createThreadConversationOutlineCache();
    const build = vi.fn(() => makeResponse(10));

    const first = cache.getOrBuild({ threadId: "thr_a", maxSeq: 10 }, build);
    const second = cache.getOrBuild({ threadId: "thr_a", maxSeq: 10 }, build);

    expect(build).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(cache.size).toBe(1);
  });

  it("retains only the newest revision for each thread", () => {
    const cache = createThreadConversationOutlineCache();
    const build = vi.fn((maxSeq: number) => makeResponse(maxSeq));

    for (let maxSeq = 1; maxSeq <= 128; maxSeq += 1) {
      cache.getOrBuild({ threadId: "thr_a", maxSeq }, () => build(maxSeq));
    }

    expect(build).toHaveBeenCalledTimes(128);
    expect(cache.size).toBe(1);
    expect(
      cache.getOrBuild({ threadId: "thr_a", maxSeq: 128 }, () =>
        makeResponse(999),
      ).maxSeq,
    ).toBe(128);
  });

  it("preserves the prior revision when a replacement build fails", () => {
    const cache = createThreadConversationOutlineCache();
    const first = cache.getOrBuild({ threadId: "thr_a", maxSeq: 10 }, () =>
      makeResponse(10),
    );

    expect(() =>
      cache.getOrBuild({ threadId: "thr_a", maxSeq: 11 }, () => {
        throw new Error("build failed");
      }),
    ).toThrow("build failed");

    expect(
      cache.getOrBuild({ threadId: "thr_a", maxSeq: 10 }, () =>
        makeResponse(999),
      ),
    ).toBe(first);
    expect(cache.size).toBe(1);
  });

  it("evicts the least-recently-used thread beyond capacity", () => {
    const cache = createThreadConversationOutlineCache({ maxEntries: 2 });
    const build = vi.fn((maxSeq: number) => makeResponse(maxSeq));

    cache.getOrBuild({ threadId: "thr_a", maxSeq: 1 }, () => build(1));
    cache.getOrBuild({ threadId: "thr_b", maxSeq: 2 }, () => build(2));
    cache.getOrBuild({ threadId: "thr_a", maxSeq: 1 }, () => build(1));
    cache.getOrBuild({ threadId: "thr_c", maxSeq: 3 }, () => build(3));

    const buildAgain = vi.fn(() => makeResponse(4));
    cache.getOrBuild({ threadId: "thr_a", maxSeq: 1 }, buildAgain);
    cache.getOrBuild({ threadId: "thr_b", maxSeq: 2 }, buildAgain);

    expect(buildAgain).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(2);
  });
});
