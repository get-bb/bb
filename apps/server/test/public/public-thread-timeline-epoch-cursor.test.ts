import { describe, expect, it } from "vitest";
import { defaultFeatureFlags, turnScope } from "@bb/domain";
import { prependOlderTimelineRows } from "@bb/client-core";
import {
  threadTimelineResponseSchema,
  type TimelinePaginationCursor,
  type TimelineRow,
} from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { seedEvent, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("timeline content continuation at the history epoch", () => {
  it("accepts every cursor it returns while paging the oldest nested turn", async () => {
    await withTestHarness(
      {
        featureFlags: { ...defaultFeatureFlags, timelineWindowEventBudget: 2 },
      },
      async (harness) => {
        const { thread, environment } = seedThreadFixture(harness, {
          thread: { providerId: "codex" },
        });
        const scope = {
          threadId: thread.id,
          environmentId: environment.id,
          providerThreadId: "provider-thread",
          scope: turnScope("turn-1"),
        };
        seedEvent(harness.deps, {
          ...scope,
          sequence: 1,
          type: "turn/started",
          data: {},
        });
        for (let index = 0; index < 3; index += 1) {
          seedEvent(harness.deps, {
            ...scope,
            sequence: index + 2,
            type: "item/completed",
            data: {
              item: {
                type: "commandExecution",
                id: `command-${index}`,
                command: `echo ${index}`,
                cwd: "/tmp",
                status: "completed",
                approvalStatus: null,
                aggregatedOutput: `${index}\n`,
                exitCode: 0,
                durationMs: 1,
              },
            },
          });
        }
        seedEvent(harness.deps, {
          ...scope,
          sequence: 5,
          type: "turn/completed",
          data: { status: "completed" },
        });
        let cursor: TimelinePaginationCursor | null = null;
        let rows: TimelineRow[] = [];
        let sawEpochCursor = false;
        let pages = 0;
        do {
          const query = new URLSearchParams({ includeNestedRows: "true" });
          if (cursor !== null) {
            query.set("beforeAnchorId", cursor.anchorId);
            query.set("beforeAnchorSeq", String(cursor.anchorSeq));
          }
          const response = await harness.app.request(
            `/api/v1/threads/${thread.id}/timeline?${query}`,
          );
          expect(response.status).toBe(200);
          const page = threadTimelineResponseSchema.parse(
            await readJson(response),
          );
          rows = prependOlderTimelineRows({
            loadedRows: rows,
            olderRows: page.rows,
          });
          cursor = page.timelinePage.olderCursor;
          sawEpochCursor ||= cursor?.anchorSeq === 0;
          expect(page.timelinePage.hasOlderRows).toBe(cursor !== null);
          expect(++pages).toBeLessThan(5);
        } while (cursor !== null);
        expect(sawEpochCursor).toBe(true);
        expect(rows).toHaveLength(1);
        const summary = rows[0];
        expect(summary?.kind).toBe("turn");
        if (summary?.kind !== "turn") throw new Error("Missing summary");
        expect(summary.children?.map((row) => row.id)).toHaveLength(3);
        expect(new Set(summary.children?.map((row) => row.id)).size).toBe(3);
      },
    );
  });
});
