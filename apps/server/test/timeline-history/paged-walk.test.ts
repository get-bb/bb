import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { prependOlderTimelineRows } from "@bb/client-core";
import {
  createConnection,
  events,
  getAppSettings,
  getLatestThreadSequence,
  getThread,
  migrate,
  type DbConnection,
} from "@bb/db";
import { defaultFeatureFlags } from "@bb/domain";
import {
  threadTimelineResponseSchema,
  type ThreadTimelineResponse,
  type TimelineRow,
} from "@bb/server-contract";
import { createTestAppHarness } from "../helpers/test-app.js";
import { resolveThreadHeadStateOptions } from "../../src/services/threads/thread-head-state.js";
import {
  resolveThreadCompletedTurnDisplay,
  resolveThreadProviderDisplayName,
} from "../../src/services/threads/thread-timeline-windows.js";
import {
  buildThreadTimelineWithProfile,
  THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT,
} from "../../src/services/threads/timeline.js";
import type { ThreadTimelinePageRequest } from "../../src/services/threads/timeline-pagination.js";
import {
  DEFAULT_MAX_INLINE_OUTPUT_CHARS,
  shortenTimelineResponseOutputs,
} from "../../src/services/threads/timeline-output-shortening.js";
import { describeRowDifference } from "../services/threads/timeline-guard-harness.js";

const SOURCE_DB = process.env.BB_TIMELINE_HISTORY_DB;
const THREAD_FILTER = process.env.BB_TIMELINE_HISTORY_THREADS?.split(",");
const BUDGETS = [defaultFeatureFlags.timelineWindowEventBudget, 120];
const UNBOUNDED = 1_000_000_000;
const MAX_WALK_PAGES = 5_000;

function copyDatabase(source: string, directory: string): string {
  const target = join(directory, "bb.db");
  const sourceDb = new Database(source, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    sourceDb.prepare("VACUUM INTO ?").run(target);
  } finally {
    sourceDb.close();
  }
  return target;
}

describe.skipIf(SOURCE_DB === undefined)(
  "paged timeline walks over real history",
  () => {
    it("matches one full build for every thread", async () => {
      const directory = mkdtempSync(join(tmpdir(), "bb-timeline-history-"));
      const harness = await createTestAppHarness();
      const db: DbConnection = createConnection(
        copyDatabase(SOURCE_DB!, directory),
      );
      try {
        migrate(db);
        const deps = { ...harness.deps, db };
        const settings = getAppSettings(db);

        const build = (
          threadId: string,
          eventBudget: number,
          page: ThreadTimelinePageRequest,
          responseByteBudget?: number,
        ): ThreadTimelineResponse => {
          const thread = getThread(db, threadId);
          if (thread === null) throw new Error(`missing thread ${threadId}`);
          const { response } = buildThreadTimelineWithProfile(db, thread, {
            ...resolveThreadHeadStateOptions(deps, thread.providerId),
            completedTurnDisplay: resolveThreadCompletedTurnDisplay(
              deps,
              settings,
              thread.providerId,
            ),
            deferContent: true,
            includeClearedContextHistory: settings.keepHistoryAfterContextClear,
            includeDiagnosticOperations: settings.showDiagnosticEvents,
            includeNestedRows: false,
            maxInlineOutputChars: DEFAULT_MAX_INLINE_OUTPUT_CHARS,
            providerDisplayName: resolveThreadProviderDisplayName(
              deps,
              thread.providerId,
            ),
            summarizeShellCommands: settings.summarizeShellCommands,
            eventBudget,
            ...(responseByteBudget === undefined ? {} : { responseByteBudget }),
            maxSeq: getLatestThreadSequence(db, { threadId }),
            page,
          });
          return threadTimelineResponseSchema.parse(
            JSON.parse(
              JSON.stringify({
                ...shortenTimelineResponseOutputs(response, {
                  maxInlineOutputChars: DEFAULT_MAX_INLINE_OUTPUT_CHARS,
                  preview: true,
                }),
                tag: "history",
              }),
            ),
          );
        };

        const walk = (threadId: string, budget: number): TimelineRow[] => {
          const segmentLimit = THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT;
          const latest = build(threadId, budget, {
            kind: "latest",
            segmentLimit,
          });
          let rows = latest.rows;
          let cursor = latest.timelinePage.olderCursor;
          for (let pages = 0; cursor !== null; pages += 1) {
            if (pages > MAX_WALK_PAGES) {
              throw new Error("walk did not reach the start");
            }
            const page = build(threadId, budget, {
              kind: "older",
              beforeCursor: cursor,
              segmentLimit,
            });
            rows = prependOlderTimelineRows({
              loadedRows: rows,
              olderRows: page.rows,
            });
            cursor = page.timelinePage.olderCursor;
          }
          return rows;
        };

        const threadIds =
          THREAD_FILTER ??
          db
            .selectDistinct({ threadId: events.threadId })
            .from(events)
            .all()
            .map((row) => row.threadId);
        const mismatches: string[] = [];
        for (const threadId of threadIds) {
          const full = build(
            threadId,
            UNBOUNDED,
            { kind: "latest", segmentLimit: UNBOUNDED },
            UNBOUNDED,
          );
          for (const budget of BUDGETS) {
            let difference: string | null;
            try {
              difference = describeRowDifference(
                walk(threadId, budget),
                full.rows,
              );
            } catch (error) {
              difference = `walk failed: ${String(error)}`;
            }
            if (difference !== null) {
              mismatches.push(
                `${threadId} at budget ${budget}: ${difference.slice(0, 600)}`,
              );
            }
          }
        }
        expect(
          mismatches,
          `${mismatches.length} of ${threadIds.length * BUDGETS.length} walks differ from a full build`,
        ).toEqual([]);
      } finally {
        db.$client.close();
        await harness.cleanup();
        rmSync(directory, { recursive: true, force: true });
      }
    }, 7_200_000);
  },
);
