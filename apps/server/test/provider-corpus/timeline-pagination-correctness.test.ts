import { clearTimelineOrderingContextCache } from "../../src/services/threads/timeline-context-order.js";
import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { corpusAvailable, loadCorpusThread } from "@bb/test-helpers";
import {
  getLatestThreadSequence,
  listStoredTimelineWindowEventRows,
} from "@bb/db";
import {
  buildThreadTimelineFromEvents,
  compactThreadTimelineSummaryEvents,
  THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
} from "@bb/thread-view";
import {
  threadTimelineResponseSchema,
  type TimelineRow,
} from "@bb/server-contract";
import { prependOlderTimelineRows } from "@bb/client-core";
import {
  prepareCompletedEventOutputData,
  insertPreparedRetainedEventOutput,
  RETAINED_EVENT_OUTPUT_TARGETS,
} from "@bb/db";
import { createTestAppHarness } from "../helpers/test-app.js";
import { loadCorpusThreadIntoDb } from "./corpus-harness.js";
import {
  applyRetainedOutputPreviews,
  buildThreadTimelineWithProfile,
  toThreadEventWithMeta,
} from "../../src/services/threads/timeline.js";
import { truncateTimelineResponseOutputs } from "../../src/services/threads/timeline-output-truncation.js";
import { previewTimelineResponseOutputs } from "../../src/services/threads/timeline-output-preview.js";

const threadIds = [
  "thr_cdfq9maj8q",
  "thr_gcuc46ug4j",
  "thr_m9gz6riv9t",
  "thr_kbjzy5zdu7",
];

describe.skipIf(!corpusAvailable())(
  "timeline endpoint and client corpus pagination",
  () => {
    it("walks canonical content without duplicate or missing rows", async () => {
      const results = [];
      for (const threadId of threadIds.filter(
        (id) =>
          !process.env.BB_TIMELINE_PAGINATION_THREAD ||
          id === process.env.BB_TIMELINE_PAGINATION_THREAD,
      )) {
        const harness = await createTestAppHarness();
        try {
          const corpus = loadCorpusThread(threadId);
          const { db, thread } = loadCorpusThreadIntoDb(corpus, harness.db);
          db.transaction(() => {
            const update = db.$client.prepare(
              "UPDATE events SET data = ? WHERE id = ?",
            );
            for (const event of corpus.eventRows) {
              const prepared = prepareCompletedEventOutputData({
                ...event,
                itemKind:
                  RETAINED_EVENT_OUTPUT_TARGETS.find(
                    (target) => target.itemKind === event.itemKind,
                  )?.itemKind ?? null,
              });
              if (prepared.retainedOutput !== null) {
                update.run(prepared.data, event.id);
                insertPreparedRetainedEventOutput(db, {
                  eventId: event.id,
                  output: prepared.retainedOutput,
                });
              }
            }
          });
          const canonicalStart = performance.now();
          const events = listStoredTimelineWindowEventRows(db, {
            threadId,
            sequenceStart: 0,
            maxInlineOutputChars: 32_000,
            excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
            excludeDiagnosticEvents: true,
          }).map(toThreadEventWithMeta);
          const canonical = buildThreadTimelineFromEvents({
            events: compactThreadTimelineSummaryEvents(events),
            contextWindowEvents: [],
            acceptedClientRequestContext: {
              acceptedClientRequestEvents: [],
              rejectedClientRequestEvents: [],
            },
            options: {
              includeDiagnosticOperations: false,
              includeNestedRows: false,
              isLatestPage: true,
              providerId: thread.providerId,
              providerDisplayName: harness.deps.providerRegistry.get(
                thread.providerId,
              )?.info.displayName,
              threadName: thread.title ?? "",
              threadStatus: thread.status,
              turnMessageDetail: "summary",
              workspaceRoot: null,
            },
          });
          const canonicalMs = performance.now() - canonicalStart;
          let rows: TimelineRow[] = [];
          let query = "segmentLimit=20";
          const durations = [];
          let expected: TimelineRow[] = [];
          let responseBytes = 0;
          for (let page = 0; page < 2_000; page += 1) {
            const start = performance.now();
            const response = await harness.app.request(
              `/api/v1/threads/${threadId}/timeline?${query}`,
            );
            if (response.status !== 200)
              throw new Error(
                `${threadId}: ${response.status} ${await response.text()}`,
              );
            const body = await response.text();
            responseBytes += Buffer.byteLength(body);
            const timeline = threadTimelineResponseSchema.parse(
              JSON.parse(body),
            );
            rows = prependOlderTimelineRows({
              loadedRows: rows,
              olderRows: timeline.rows,
            });
            durations.push(performance.now() - start);
            if (page === 0) {
              expected = previewTimelineResponseOutputs(
                truncateTimelineResponseOutputs(
                  {
                    ...timeline,
                    rows: applyRetainedOutputPreviews(
                      canonical.rows,
                      events,
                      "available",
                    ),
                  },
                  32_000,
                ),
              ).rows;
            }
            const cursor = timeline.timelinePage.olderCursor;
            if (cursor === null) break;
            query = new URLSearchParams({
              segmentLimit: "20",
              beforeAnchorSeq: String(cursor.anchorSeq),
              beforeAnchorId: cursor.anchorId,
            }).toString();
          }
          expected = expected.filter(
            (row, index) =>
              expected.findIndex((other) => isDeepStrictEqual(other, row)) ===
              index,
          );
          const same = isDeepStrictEqual(rows, expected);
          if (process.env.BB_TIMELINE_PAGINATION_REPORT)
            fs.writeFileSync(
              `/tmp/timeline-diff-${threadId}.json`,
              JSON.stringify({ expected, rows }, null, 2),
            );
          const expectedIds = new Set(expected.map((row) => row.id));
          const actualIds = new Set(rows.map((row) => row.id));
          clearTimelineOrderingContextCache(db);
          const { profile } = buildThreadTimelineWithProfile(db, thread, {
            eventBudget: 1_500,
            includeDiagnosticOperations: false,
            maxInlineOutputChars: 32_000,
            maxSeq: getLatestThreadSequence(db, { threadId }),
            page: { kind: "latest", segmentLimit: 20 },
          });
          results.push({
            profile,
            threadId,
            events: corpus.eventRows.length,
            maxSeq: getLatestThreadSequence(db, { threadId }),
            canonicalMs,
            pages: durations.length,
            latestMs: durations[0],
            walkMs: durations.reduce((a, b) => a + b, 0),
            responseBytes,
            pageP95Ms: [...durations].sort((a, b) => a - b)[
              Math.floor(durations.length * 0.95)
            ],
            pageMaxMs: Math.max(...durations),
            canonicalRows: expected.length,
            mergedRows: rows.length,
            same,
            missing: [...expectedIds].filter((id) => !actualIds.has(id)).length,
            extra: [...actualIds].filter((id) => !expectedIds.has(id)).length,
          });
        } finally {
          await harness.cleanup();
        }
      }
      const output = process.env.BB_TIMELINE_PAGINATION_REPORT;
      if (output) fs.writeFileSync(output, JSON.stringify(results, null, 2));
      expect(results.filter((result) => !result.same)).toEqual([]);
    }, 300_000);
  },
);
