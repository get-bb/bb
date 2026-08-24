import { describe, expect, it } from "vitest";
import { threadListEntry } from "../test/fixtures";
import {
  hasThreadSearchableQuery,
  selectRecentThreads,
} from "./thread-search-query";

describe("hasThreadSearchableQuery", () => {
  it("needs two non-whitespace characters, matching the server's min(2) after trim", () => {
    expect(hasThreadSearchableQuery("")).toBe(false);
    expect(hasThreadSearchableQuery(" a ")).toBe(false);
    expect(hasThreadSearchableQuery("a b")).toBe(true);
    expect(hasThreadSearchableQuery("ab")).toBe(true);
  });
});

describe("selectRecentThreads", () => {
  it("drops hidden threads, puts running threads first, then attention recency, and honours the limit", () => {
    const threads = [
      threadListEntry({ id: "old", latestAttentionAt: 1 }),
      threadListEntry({
        id: "hidden",
        visibility: "hidden",
        latestAttentionAt: 99,
      }),
      threadListEntry({ id: "new", latestAttentionAt: 50 }),
      threadListEntry({
        id: "running",
        status: "active",
        latestAttentionAt: 2,
      }),
    ];
    expect(selectRecentThreads(threads, 10).map((t) => t.id)).toEqual([
      "running",
      "new",
      "old",
    ]);
    expect(selectRecentThreads(threads, 2).map((t) => t.id)).toEqual([
      "running",
      "new",
    ]);
    expect(selectRecentThreads(threads, 0)).toEqual([]);
  });
});
