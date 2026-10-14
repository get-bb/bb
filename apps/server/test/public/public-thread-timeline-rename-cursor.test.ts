import { describe, expect, it } from "vitest";
import { defaultFeatureFlags, turnScope } from "@bb/domain";
import {
  threadTimelineResponseSchema,
  type TimelinePaginationCursor,
} from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { seedEvent, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

async function readTimelinePage(
  harness: TestAppHarness,
  threadId: string,
  cursor: TimelinePaginationCursor | null,
) {
  const query = new URLSearchParams({ segmentLimit: "1" });
  if (cursor !== null) {
    query.set("beforeAnchorSeq", String(cursor.anchorSeq));
    query.set("beforeAnchorId", cursor.anchorId);
  }
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/timeline?${query}`,
  );
  expect(response.status).toBe(200);
  return threadTimelineResponseSchema.parse(await readJson(response));
}

describe("timeline older-page cursors after a rename", () => {
  it("pages older history after the thread is renamed with no new events", async () => {
    await withTestHarness(
      {
        featureFlags: { ...defaultFeatureFlags, timelineWindowEventBudget: 2 },
      },
      async (harness) => {
        const { thread, environment } = seedThreadFixture(harness, {
          thread: { providerId: "codex", title: "Before rename" },
        });
        let sequence = 0;
        for (let turn = 1; turn <= 3; turn += 1) {
          const scope = {
            threadId: thread.id,
            environmentId: environment.id,
            providerThreadId: "provider-thread",
            scope: turnScope(`turn-${turn}`),
          };
          seedEvent(harness.deps, {
            ...scope,
            sequence: ++sequence,
            type: "turn/started",
            data: {},
          });
          seedEvent(harness.deps, {
            ...scope,
            sequence: ++sequence,
            type: "item/completed",
            data: {
              item: {
                type: "agentMessage",
                id: `turn-${turn}-answer`,
                text: `Turn ${turn} is done.`,
              },
            },
          });
          seedEvent(harness.deps, {
            ...scope,
            sequence: ++sequence,
            type: "turn/completed",
            data: { status: "completed" },
          });
        }

        const beforeRename = await readTimelinePage(harness, thread.id, null);
        expect(beforeRename.timelinePage.olderCursor).not.toBeNull();

        const rename = await harness.app.request(
          `/api/v1/threads/${thread.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "After rename" }),
          },
        );
        expect(rename.status).toBe(200);

        const latest = await readTimelinePage(harness, thread.id, null);
        expect(latest.maxSeq).toBe(beforeRename.maxSeq);
        let cursor = latest.timelinePage.olderCursor;
        let pages = 0;
        while (cursor !== null) {
          const older = await readTimelinePage(harness, thread.id, cursor);
          cursor = older.timelinePage.olderCursor;
          pages += 1;
          expect(pages).toBeLessThan(5);
        }
        expect(pages).toBeGreaterThan(0);
      },
    );
  });
});
