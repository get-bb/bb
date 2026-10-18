import { describe, expect, it } from "vitest";
import { insertEvents, setExperiments } from "@bb/db";
import {
  THREAD_CONTEXT_CLEAR_OPERATION,
  threadScope,
  turnScope,
  type ContextSnapshot,
} from "@bb/domain";
import { seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const snapshot: ContextSnapshot = {
  capturedAt: "2026-09-11T12:00:00.000Z",
  providerSessionId: "claude-session",
  providerTurnId: null,
  model: "claude-test",
  usedTokens: 100,
  contextWindowTokens: 1_000,
  autoCompactAtTokens: 900,
  estimated: true,
  categories: [
    { id: "custom", label: "Custom", kind: "used", tokens: 100, entries: [] },
  ],
};

describe("recorded thread context API", () => {
  it("returns the persisted root snapshot, drops superseded details, and respects clear boundaries", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      const endpoint = `/api/v1/threads/${thread.id}/context`;
      const read = async () => {
        const response = await harness.app.request(endpoint);
        expect(response.status, await response.clone().text()).toBe(200);
        return response.json();
      };
      const base = {
        threadId: thread.id,
        providerThreadId: "claude-session",
        scope: threadScope(),
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
      };
      expect(await read()).toEqual({ usage: null });
      insertEvents(harness.db, harness.hub, [
        {
          ...base,
          sequence: 1,
          type: "thread/contextWindowUsage/updated",
          data: JSON.stringify({
            contextWindowUsage: {
              usedTokens: 100,
              modelContextWindow: 1_000,
              estimated: true,
              snapshot,
            },
          }),
        },
        {
          ...base,
          sequence: 2,
          scope: turnScope("nested-turn"),
          parentToolCallId: "nested-tool",
          type: "turn/started",
          data: JSON.stringify({ parentToolCallId: "nested-tool" }),
        },
        {
          ...base,
          sequence: 3,
          scope: turnScope("nested-turn"),
          type: "thread/contextWindowUsage/updated",
          data: JSON.stringify({
            contextWindowUsage: {
              usedTokens: 999,
              modelContextWindow: 1_000,
              estimated: true,
            },
          }),
        },
      ]);
      expect(await read()).toEqual({
        usage: {
          usedTokens: 100,
          modelContextWindow: 1_000,
          estimated: true,
          snapshot,
        },
      });
      const timeline = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline`,
      );
      expect(await timeline.json()).toMatchObject({
        contextWindowUsage: { snapshot },
      });
      insertEvents(harness.db, harness.hub, [
        {
          ...base,
          sequence: 4,
          type: "thread/contextWindowUsage/updated",
          data: JSON.stringify({
            contextWindowUsage: {
              usedTokens: 200,
              modelContextWindow: null,
              estimated: false,
            },
          }),
        },
      ]);
      expect(await read()).toEqual({
        usage: { usedTokens: 200, modelContextWindow: 1_000, estimated: false },
      });
      insertEvents(harness.db, harness.hub, [
        {
          ...base,
          sequence: 5,
          type: "system/operation",
          data: JSON.stringify({
            operation: THREAD_CONTEXT_CLEAR_OPERATION,
            operationId: "clear",
            status: "completed",
            message: "Fresh context",
          }),
        },
      ]);
      expect(await read()).toEqual({ usage: null });
    });
  });

  it("offers compaction once a large context's prompt cache expires", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: { providerId: "pi" },
      });
      const read = async () => {
        const context = await harness.app.request(
          `/api/v1/threads/${thread.id}/context`,
        );
        const timeline = await harness.app.request(
          `/api/v1/threads/${thread.id}/timeline`,
        );
        const contextUsage = (await context.json()).usage;
        const timelineUsage = (await timeline.json()).contextWindowUsage;
        expect(timelineUsage?.compactionOfferAt).toEqual(
          contextUsage?.compactionOfferAt,
        );
        return contextUsage?.compactionOfferAt;
      };
      const base = {
        threadId: thread.id,
        providerThreadId: "pi-session",
        scope: turnScope("turn-1"),
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
      };
      const usage = {
        totalTokens: 150_000,
        inputTokens: 10,
        cachedInputTokens: 149_990,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      };
      const insertUsage = (
        sequence: number,
        usedTokens: number,
        cache: { promptCacheTtlMs?: number },
      ) =>
        insertEvents(harness.db, harness.hub, [
          {
            ...base,
            sequence,
            type: "thread/contextWindowUsage/updated",
            data: JSON.stringify({
              contextWindowUsage: {
                usedTokens,
                modelContextWindow: 200_000,
                estimated: false,
              },
            }),
          },
          {
            ...base,
            sequence: sequence + 1,
            type: "thread/tokenUsage/updated",
            data: JSON.stringify({
              tokenUsage: {
                total: usage,
                last: usage,
                modelContextWindow: 200_000,
                ...cache,
              },
            }),
          },
        ]);

      const before = Date.now();
      insertUsage(1, 150_000, { promptCacheTtlMs: 3_600_000 });
      const after = Date.now();
      expect(await read()).toBeUndefined();

      setExperiments(harness.db, { compactExpiredCache: true });
      const offerAt = Date.parse(await read());
      expect(offerAt).toBeGreaterThanOrEqual(before + 3_600_000);
      expect(offerAt).toBeLessThanOrEqual(after + 3_600_000);

      insertUsage(3, 150_000, {});
      expect(await read()).toBeUndefined();

      insertUsage(5, 99_999, { promptCacheTtlMs: 300_000 });
      expect(await read()).toBeUndefined();
    });
  });

  it("returns 404 for unknown threads", async () => {
    await withTestHarness(async (harness) => {
      expect(
        (await harness.app.request("/api/v1/threads/missing/context")).status,
      ).toBe(404);
    });
  });
});
