import { describe, expect, it } from "vitest";
import { threadScope, turnScope } from "@bb/domain";
import {
  applyTimelineDelta,
  threadTimelineResponseSchema,
  type ThreadTimelineResponse,
} from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { seedEvent, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";

async function getTimeline(
  harness: TestAppHarness,
  threadId: string,
  afterSequence?: number,
): Promise<ThreadTimelineResponse> {
  const url =
    afterSequence === undefined
      ? `/api/v1/threads/${threadId}/timeline`
      : `/api/v1/threads/${threadId}/timeline?afterSequence=${afterSequence}`;
  const response = await harness.app.request(url);
  if (response.status !== 200) {
    throw new Error(
      `timeline ${url} -> ${response.status}: ${await response.text()}`,
    );
  }
  return threadTimelineResponseSchema.parse(await readJson(response));
}

describe("GET /threads/:id/timeline?afterSequence (row-patch delta)", () => {
  it("a full fetch carries no delta and echoes maxSeq", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "system/manager/user_message",
        scope: threadScope(),
        data: { text: "hello" },
      });

      const full = await getTimeline(harness, thread.id);
      expect(full.delta).toBeUndefined();
      expect(full.rows.length).toBeGreaterThan(0);
      expect(full.maxSeq).toBe(1);
    });
  });

  it("delta + merge reproduces a fresh full window when rows are appended", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "p1",
        scope: turnScope("turn-1"),
        sequence: 1,
        type: "turn/started",
        data: {},
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "p1",
        scope: turnScope("turn-1"),
        sequence: 2,
        type: "item/completed",
        data: {
          item: {
            type: "toolCall",
            id: "tool-1",
            tool: "exec_command",
            arguments: { cmd: "pnpm test" },
            status: "completed",
          },
        },
      });

      const before = await getTimeline(harness, thread.id);

      // Append another item to the active turn.
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "p1",
        scope: turnScope("turn-1"),
        sequence: 3,
        type: "item/completed",
        data: {
          item: { type: "agentMessage", id: "assistant-1", text: "Done." },
        },
      });

      const delta = await getTimeline(harness, thread.id, before.maxSeq);
      expect(delta.delta).toBeDefined();
      expect(delta.rows).toHaveLength(0);
      expect(delta.maxSeq).toBe(3);
      expect(delta.delta!.upsertRows.length).toBeGreaterThan(0);

      const merged = applyTimelineDelta(before.rows, delta.delta!);
      const fresh = await getTimeline(harness, thread.id);
      expect(merged).toEqual(fresh.rows);
    });
  });

  it("delta + merge reproduces a fresh full window when a turn completes (collapse)", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const turn = {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "p1",
        scope: turnScope("turn-1"),
      } as const;
      seedEvent(harness.deps, {
        ...turn,
        sequence: 1,
        type: "turn/started",
        data: {},
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 2,
        type: "item/completed",
        data: {
          item: {
            type: "toolCall",
            id: "tool-1",
            tool: "exec_command",
            arguments: { cmd: "ls" },
            status: "completed",
          },
        },
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 3,
        type: "item/completed",
        data: {
          item: { type: "agentMessage", id: "assistant-1", text: "First." },
        },
      });

      // Active turn: rows are expanded.
      const before = await getTimeline(harness, thread.id);

      // Complete the turn -> the projection collapses the turn's rows.
      seedEvent(harness.deps, {
        ...turn,
        sequence: 4,
        type: "turn/completed",
        data: { status: "completed" },
      });

      const delta = await getTimeline(harness, thread.id, before.maxSeq);
      expect(delta.delta).toBeDefined();

      const merged = applyTimelineDelta(before.rows, delta.delta!);
      const fresh = await getTimeline(harness, thread.id);
      expect(merged).not.toBeNull();
      expect(merged).toEqual(fresh.rows);
      // The collapse genuinely changed the window (different row ids/content),
      // and a row the client held was dropped — i.e. the delta exercised removal,
      // not just upsert. Otherwise the test proves nothing.
      expect(fresh.rows).not.toEqual(before.rows);
      const beforeIds = new Set(before.rows.map((row) => row.id));
      const freshIds = new Set(fresh.rows.map((row) => row.id));
      expect([...beforeIds].some((id) => !freshIds.has(id))).toBe(true);
    });
  });

  it("two interleaved clients both receive deltas (snapshot ring per params key)", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const turn = {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "p1",
        scope: turnScope("turn-1"),
      } as const;
      let sequence = 0;
      const appendMessage = (text: string): void => {
        sequence += 1;
        seedEvent(harness.deps, {
          ...turn,
          sequence,
          type: "item/completed",
          data: {
            item: { type: "agentMessage", id: `assistant-${sequence}`, text },
          },
        });
      };
      sequence += 1;
      seedEvent(harness.deps, {
        ...turn,
        sequence,
        type: "turn/started",
        data: {},
      });
      appendMessage("one");

      // Desktop and phone both hold revision 2.
      const desktop = await getTimeline(harness, thread.id);
      const phone = desktop;

      // The desktop polls fast: it sees revisions 3 and 4 before the phone
      // gets its next poll in. Each desktop poll advances the server's newest
      // snapshot past the revision the phone still holds.
      appendMessage("two");
      const desktopAt3 = await getTimeline(harness, thread.id, desktop.maxSeq);
      expect(desktopAt3.delta).toBeDefined();
      appendMessage("three");
      const desktopAt4 = await getTimeline(
        harness,
        thread.id,
        desktopAt3.maxSeq,
      );
      expect(desktopAt4.delta).toBeDefined();

      // The phone still asks from revision 2 and must get a delta, not a full
      // window, and merging it must reproduce the current window exactly.
      const phoneAt4 = await getTimeline(harness, thread.id, phone.maxSeq);
      expect(phoneAt4.maxSeq).toBe(4);
      expect(phoneAt4.rows).toHaveLength(0);
      expect(phoneAt4.delta).toBeDefined();
      const merged = applyTimelineDelta(phone.rows, phoneAt4.delta!);
      const fresh = await getTimeline(harness, thread.id);
      expect(merged).toEqual(fresh.rows);

      // A revision that fell out of the ring falls back to a full window:
      // four more polled revisions (5..8) push revision 2 out.
      for (const text of ["four", "five", "six", "seven"]) {
        appendMessage(text);
        const polled = await getTimeline(harness, thread.id, sequence - 1);
        expect(polled.delta).toBeDefined();
      }
      const evicted = await getTimeline(harness, thread.id, 2);
      expect(evicted.delta).toBeUndefined();
      expect(evicted.rows.length).toBeGreaterThan(0);
    });
  });

  it("a no-op delta (no new events) returns an empty patch and merges to the same rows", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "system/manager/user_message",
        scope: threadScope(),
        data: { text: "hello" },
      });

      const before = await getTimeline(harness, thread.id);
      const delta = await getTimeline(harness, thread.id, before.maxSeq);
      expect(delta.delta).toBeDefined();
      expect(delta.delta!.upsertRows).toHaveLength(0);
      expect(delta.delta!.rowOrder).toBeUndefined();
      expect(applyTimelineDelta(before.rows, delta.delta!)).toEqual(
        before.rows,
      );
    });
  });
});
