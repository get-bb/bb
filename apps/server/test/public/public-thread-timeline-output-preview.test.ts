import { describe, expect, it } from "vitest";
import { turnScope } from "@bb/domain";
import {
  threadTimelineResponseSchema,
  timelineTurnSummaryDetailsResponseSchema,
  type ThreadTimelineResponse,
  type TimelineRow,
} from "@bb/server-contract";
import {
  TIMELINE_INLINE_OUTPUT_PREVIEW_HEAD_CHARS,
  TIMELINE_INLINE_OUTPUT_PREVIEW_TAIL_CHARS,
  TIMELINE_INLINE_OUTPUT_PREVIEW_THRESHOLD_CHARS,
} from "../../src/services/threads/timeline-output-preview.js";
import { readJson } from "../helpers/json.js";
import { seedEvent, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";

const BIG_OUTPUT = `HEAD${"a".repeat(TIMELINE_INLINE_OUTPUT_PREVIEW_THRESHOLD_CHARS * 3)}TAIL`;
const SMALL_OUTPUT = "small output";

async function getTimeline(
  harness: TestAppHarness,
  threadId: string,
  query = "",
): Promise<ThreadTimelineResponse> {
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/timeline${query}`,
  );
  expect(response.status).toBe(200);
  return threadTimelineResponseSchema.parse(await readJson(response));
}

function findCommandRow(rows: readonly TimelineRow[], command: string) {
  const row = rows.find(
    (candidate) =>
      candidate.kind === "work" &&
      candidate.workKind === "command" &&
      candidate.command === command,
  );
  if (!row || row.kind !== "work" || row.workKind !== "command") {
    throw new Error(`command row ${command} not found`);
  }
  return row;
}

function seedRunningTurnWithCommands(harness: TestAppHarness): {
  threadId: string;
} {
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
  let sequence = 1;
  for (const [command, output] of [
    ["big", BIG_OUTPUT],
    ["small", SMALL_OUTPUT],
  ] as const) {
    sequence += 1;
    seedEvent(harness.deps, {
      ...turn,
      sequence,
      type: "item/started",
      data: {
        item: {
          type: "commandExecution",
          id: `cmd-${command}`,
          command,
          cwd: "/tmp",
          status: "pending",
          approvalStatus: null,
        },
      },
    });
    sequence += 1;
    seedEvent(harness.deps, {
      ...turn,
      sequence,
      type: "item/completed",
      data: {
        item: {
          type: "commandExecution",
          id: `cmd-${command}`,
          command,
          cwd: "/tmp",
          status: "completed",
          approvalStatus: null,
          exitCode: 0,
          aggregatedOutput: output,
        },
      },
    });
  }
  return { threadId: thread.id };
}

describe("GET /threads/:id/timeline inline output preview", () => {
  it("previews the running turn's large outputs and leaves small ones whole", async () => {
    await withTestHarness(async (harness) => {
      const { threadId } = seedRunningTurnWithCommands(harness);
      const timeline = await getTimeline(harness, threadId);

      const big = findCommandRow(timeline.rows, "big");
      expect(big.outputPreview).toEqual({ totalChars: BIG_OUTPUT.length });
      expect(big.output.length).toBeLessThan(
        TIMELINE_INLINE_OUTPUT_PREVIEW_THRESHOLD_CHARS,
      );
      expect(big.output.startsWith(BIG_OUTPUT.slice(0, 64))).toBe(true);
      expect(big.output.endsWith("TAIL")).toBe(true);
      expect(big.output).toContain(
        `${(
          BIG_OUTPUT.length -
          TIMELINE_INLINE_OUTPUT_PREVIEW_HEAD_CHARS -
          TIMELINE_INLINE_OUTPUT_PREVIEW_TAIL_CHARS
        ).toLocaleString("en-US")} characters omitted`,
      );

      const small = findCommandRow(timeline.rows, "small");
      expect(small.outputPreview).toBeUndefined();
      expect(small.output).toBe(SMALL_OUTPUT);
    });
  });

  it("nested-row consumers still receive the full inline output", async () => {
    await withTestHarness(async (harness) => {
      const { threadId } = seedRunningTurnWithCommands(harness);
      const timeline = await getTimeline(
        harness,
        threadId,
        "?includeNestedRows=true",
      );
      const big = findCommandRow(timeline.rows, "big");
      expect(big.outputPreview).toBeUndefined();
      expect(big.output).toBe(BIG_OUTPUT);
    });
  });

  it("turn-summary-details scoped to the previewed row returns its whole output", async () => {
    await withTestHarness(async (harness) => {
      const { threadId } = seedRunningTurnWithCommands(harness);
      const timeline = await getTimeline(harness, threadId);
      const big = findCommandRow(timeline.rows, "big");
      expect(big.turnId).toBe("turn-1");

      const response = await harness.app.request(
        `/api/v1/threads/${threadId}/timeline/turn-summary-details?turnId=${big.turnId}&sourceSeqStart=${big.sourceSeqStart}&sourceSeqEnd=${big.sourceSeqEnd}`,
      );
      expect(response.status).toBe(200);
      const details = timelineTurnSummaryDetailsResponseSchema.parse(
        await readJson(response),
      );
      const full = details.rows.find((row) => row.id === big.id);
      expect(full).toBeDefined();
      if (!full || full.kind !== "work" || full.workKind !== "command") {
        throw new Error("expected the previewed command row in details");
      }
      expect(full.outputPreview).toBeUndefined();
      expect(full.output).toBe(BIG_OUTPUT);
    });
  });

  it("row-scoped details still resolve after the turn completes (expand/complete race)", async () => {
    await withTestHarness(async (harness) => {
      const { threadId } = seedRunningTurnWithCommands(harness);
      const timeline = await getTimeline(harness, threadId);
      const big = findCommandRow(timeline.rows, "big");
      seedEvent(harness.deps, {
        threadId,
        providerThreadId: "p1",
        scope: turnScope("turn-1"),
        sequence: 6,
        type: "turn/completed",
        data: { status: "completed" },
      });

      const response = await harness.app.request(
        `/api/v1/threads/${threadId}/timeline/turn-summary-details?turnId=${big.turnId}&sourceSeqStart=${big.sourceSeqStart}&sourceSeqEnd=${big.sourceSeqEnd}`,
      );
      expect(response.status).toBe(200);
      const details = timelineTurnSummaryDetailsResponseSchema.parse(
        await readJson(response),
      );
      const full = details.rows.find((row) => row.id === big.id);
      if (!full || full.kind !== "work" || full.workKind !== "command") {
        throw new Error("expected the previewed command row in details");
      }
      expect(full.output).toBe(BIG_OUTPUT);
    });
  });
});
