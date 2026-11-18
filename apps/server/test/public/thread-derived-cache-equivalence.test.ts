import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  deleteThreadEventSuffixInTransaction,
  updateThread,
  type DbConnection,
} from "@bb/db";
import {
  expectCachedReadsMatchUncachedBuilds,
  fillHistoryGaps,
  REWIND_CUTOFF_SEQUENCE,
  setThreadStatus,
  LATEST_WINDOW,
  listThreadDataGetRoutes,
  NEXT_SEQUENCE,
  OUTLINE,
  BASE_PROVIDER_DECLARATION,
  readSurface,
  registerGoalsProvider,
  RETENTION_DEADLINE,
  seedOpenSecondTurn,
  seedThreadHistory,
  seedUserMessage,
  cloneDb,
  serverOver,
  THREAD_DATA_ROUTE_SURFACES,
  TURN_DETAILS,
  warmServer,
  type InvalidatingChange,
  type Server,
} from "../helpers/thread-derived-cache-table.js";
import { withTestHarness } from "../helpers/test-app.js";

const LARGEST_CACHE_ENTRY_LIMIT = 512;

const HISTORY_AND_RUNTIME_CHANGES: readonly InvalidatingChange[] = [
  {
    name: "an appended event",
    change: ({ harness, fixture }) =>
      seedUserMessage(harness, fixture, NEXT_SEQUENCE, "Third question"),
  },
  {
    name: "events filled in below the head",
    change: ({ harness, fixture }) => fillHistoryGaps(harness, fixture),
  },
  {
    name: "the clock passing a retained-output deadline",
    change: () => {
      vi.spyOn(Date, "now").mockReturnValue(RETENTION_DEADLINE);
    },
  },
  {
    name: "a server restart after a rewind that reuses sequences",
    change: async ({ harness, fixture, readWarm, restart }) => {
      setThreadStatus(harness, fixture.threadId, "idle");
      await readWarm();
      harness.db.transaction((tx) => {
        deleteThreadEventSuffixInTransaction(tx, {
          threadId: fixture.threadId,
          cutoffSequence: REWIND_CUTOFF_SEQUENCE,
          oldMaxSequence: NEXT_SEQUENCE - 1,
        });
      });
      seedOpenSecondTurn(harness, fixture, "Edited question");
      restart();
    },
  },
  {
    name: "a server restart after events filled in below the head",
    change: async ({ harness, fixture, readWarm, restart }) => {
      setThreadStatus(harness, fixture.threadId, "idle");
      await readWarm();
      fillHistoryGaps(harness, fixture);
      restart();
    },
  },
];

describe("thread-derived caches serve what an uncached build would", () => {
  it.each(HISTORY_AND_RUNTIME_CHANGES)("after $name", ({ change }) =>
    expectCachedReadsMatchUncachedBuilds(change, { changesOutput: true }),
  );

  it("covers every thread-data GET route", async () => {
    await withTestHarness(async (harness) => {
      expect(listThreadDataGetRoutes(harness)).toEqual(
        Object.keys(THREAD_DATA_ROUTE_SURFACES).sort(),
      );
    });
  });
});

async function countStatements(server: Server, path: string): Promise<number> {
  const prepare = vi.spyOn(server.db.$client, "prepare");
  try {
    await readSurface(server, path);
    return prepare.mock.calls.length;
  } finally {
    prepare.mockRestore();
  }
}

const RETAINED_SURFACES = [
  { surface: LATEST_WINDOW, churn: "rename" },
  { surface: TURN_DETAILS, churn: "append" },
  { surface: OUTLINE, churn: "rename" },
] as const;

const NO_OLDER_CURSOR = { anchorId: "", anchorSeq: 0 };

describe("thread-derived caches keep entries that are still current", () => {
  it.each(RETAINED_SURFACES)(
    "keeps an idle thread's $surface.name while another thread streams",
    async ({ churn, surface }) => {
      await withTestHarness(async (harness) => {
        registerGoalsProvider(harness, BASE_PROVIDER_DECLARATION);
        const idle = seedThreadHistory(harness);
        const streaming = seedThreadHistory(harness);
        const warm = warmServer(harness);
        const idlePath = surface.path({
          olderCursor: NO_OLDER_CURSOR,
          threadId: idle.threadId,
        });
        const missStatements = await countStatements(warm, idlePath);
        const hitStatements = await countStatements(warm, idlePath);
        expect(hitStatements).toBeLessThan(missStatements);
        for (
          let sequence = NEXT_SEQUENCE;
          sequence < NEXT_SEQUENCE + LARGEST_CACHE_ENTRY_LIMIT + 8;
          sequence += 1
        ) {
          if (churn === "append") {
            seedUserMessage(
              harness,
              streaming,
              sequence,
              `Message ${sequence}`,
            );
          } else {
            updateThread(harness.db, harness.hub, streaming.threadId, {
              title: `Title ${sequence}`,
            });
          }
          await readSurface(
            warm,
            surface.path({
              olderCursor: NO_OLDER_CURSOR,
              threadId: streaming.threadId,
            }),
          );
        }
        expect(await countStatements(warm, idlePath)).toBe(hitStatements);
      });
    },
  );

  it("keeps an older timeline page across appends", async () => {
    await withTestHarness(async (harness) => {
      registerGoalsProvider(harness, BASE_PROVIDER_DECLARATION);
      const fixture = seedThreadHistory(harness);
      const warm = warmServer(harness);
      const latest = z
        .object({
          timelinePage: z.object({
            olderCursor: z.object({
              anchorSeq: z.number(),
              anchorId: z.string(),
            }),
          }),
        })
        .parse(
          (
            await readSurface(
              warm,
              `/threads/${fixture.threadId}/timeline?segmentLimit=1`,
            )
          ).body,
        );
      const { anchorSeq, anchorId } = latest.timelinePage.olderCursor;
      const olderPath = `/threads/${fixture.threadId}/timeline?segmentLimit=1&beforeAnchorSeq=${anchorSeq}&beforeAnchorId=${encodeURIComponent(anchorId)}`;
      const missStatements = await countStatements(warm, olderPath);
      const hitStatements = await countStatements(warm, olderPath);
      expect(hitStatements).toBeLessThan(missStatements);
      seedUserMessage(harness, fixture, NEXT_SEQUENCE, "Third question");
      expect(await countStatements(warm, olderPath)).toBe(hitStatements);
      const uncached: DbConnection = cloneDb(harness.db);
      try {
        expect(await readSurface(warm, olderPath)).toEqual(
          await readSurface(serverOver(harness, uncached), olderPath),
        );
      } finally {
        uncached.$client.close();
      }
    });
  });
});
