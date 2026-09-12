import { describe, expect, it } from "vitest";
import { threadScope, type ContextSnapshot } from "@bb/domain";
import type { ThreadEventWithMeta } from "../src/build-event-projection.js";
import { extractThreadContextWindowUsage } from "../src/thread-context-window-usage.js";

const snapshot: ContextSnapshot = {
  capturedAt: "2026-09-11T12:00:00.000Z",
  providerSessionId: "session-1",
  providerTurnId: null,
  model: "claude-test",
  usedTokens: 100,
  contextWindowTokens: 1_000,
  autoCompactAtTokens: null,
  estimated: true,
  categories: [
    { id: "custom", label: "Custom", kind: "used", tokens: 100, entries: [] },
  ],
};

function event(
  seq: number,
  usage: {
    usedTokens: number | null;
    modelContextWindow: number | null;
    snapshot?: ContextSnapshot;
  },
): ThreadEventWithMeta {
  return {
    meta: {
      seq,
      id: `event-${seq}`,
      createdAt: Date.parse(snapshot.capturedAt),
    },
    event: {
      type: "thread/contextWindowUsage/updated",
      threadId: "thread-1",
      providerThreadId: "session-1",
      scope: threadScope(),
      contextWindowUsage: { ...usage, estimated: true },
    },
  };
}
const first = event(1, {
  usedTokens: 100,
  modelContextWindow: 1_000,
  snapshot,
});

describe("context snapshot projection", () => {
  it("retains a matching snapshot through event decoding", () => {
    expect(extractThreadContextWindowUsage([first])).toEqual({
      usedTokens: 100,
      modelContextWindow: 1_000,
      estimated: true,
      snapshot,
    });
  });
  it("drops older details even when a newer aggregate has the same totals", () => {
    expect(
      extractThreadContextWindowUsage([
        event(2, { usedTokens: 100, modelContextWindow: null }),
        first,
      ]),
    ).toEqual({ usedTokens: 100, modelContextWindow: 1_000, estimated: true });
  });
  it("invalidates prior usage on reset and restores only the new measurement", () => {
    const reset = event(2, { usedTokens: null, modelContextWindow: null });
    expect(extractThreadContextWindowUsage([first, reset])).toBeNull();
    expect(
      extractThreadContextWindowUsage([
        first,
        reset,
        event(3, { usedTokens: 200, modelContextWindow: 1_000 }),
      ]),
    ).toEqual({ usedTokens: 200, modelContextWindow: 1_000, estimated: true });
  });
  it("does not attach a snapshot to mismatched aggregate metrics", () => {
    expect(
      extractThreadContextWindowUsage([
        event(2, { usedTokens: 200, modelContextWindow: 1_000, snapshot }),
      ]),
    ).not.toHaveProperty("snapshot");
  });
});
