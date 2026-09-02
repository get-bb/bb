import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { threadEventRowSchema, turnScope } from "@bb/domain";
import { COMPLETED_EVENT_OUTPUT_RETENTION_MS, events } from "@bb/db";
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
import { runPeriodicSweeps } from "../../src/services/system/periodic-sweeps.js";
import { readJson } from "../helpers/json.js";
import { seedEvent, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";

const BIG_OUTPUT = `HEAD${"a".repeat(TIMELINE_INLINE_OUTPUT_PREVIEW_THRESHOLD_CHARS * 3)}TAIL`;
const SMALL_OUTPUT = "small output";

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

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
      expect(big.outputPreview).toEqual({
        experimental_fullOutputAvailability: "available",
        totalChars: BIG_OUTPUT.length,
      });
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

  it("keeps both timeline preview boundaries on complete Unicode characters", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const turn = {
        environmentId: environment.id,
        providerThreadId: "provider-unicode-preview",
        scope: turnScope("turn-unicode-preview"),
        threadId: thread.id,
      } as const;
      seedEvent(harness.deps, {
        ...turn,
        data: {},
        sequence: 1,
        type: "turn/started",
      });
      const outputs = [
        "h".repeat(TIMELINE_INLINE_OUTPUT_PREVIEW_HEAD_CHARS - 1) +
          "😀" +
          "m".repeat(TIMELINE_INLINE_OUTPUT_PREVIEW_THRESHOLD_CHARS),
        "m".repeat(TIMELINE_INLINE_OUTPUT_PREVIEW_THRESHOLD_CHARS) +
          "😀" +
          "t".repeat(TIMELINE_INLINE_OUTPUT_PREVIEW_TAIL_CHARS - 1),
      ];
      for (const [index, output] of outputs.entries()) {
        seedEvent(harness.deps, {
          ...turn,
          data: {
            item: {
              aggregatedOutput: output,
              approvalStatus: null,
              command: `unicode preview ${index}`,
              cwd: "/tmp",
              exitCode: 0,
              id: `unicode-preview-${index}`,
              status: "completed",
              type: "commandExecution",
            },
          },
          sequence: index + 2,
          type: "item/completed",
        });
      }

      const timeline = await getTimeline(harness, thread.id);
      for (const index of [0, 1]) {
        const row = findCommandRow(timeline.rows, `unicode preview ${index}`);
        expect(hasUnpairedSurrogate(row.output)).toBe(false);
        expect(Buffer.from(row.output).toString()).not.toContain("�");
      }
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

  it("invalidates a cached timeline when legacy output storage is rewritten", async () => {
    await withTestHarness(async (harness) => {
      const now = Date.now();
      const { environment, thread } = seedThreadFixture(harness);
      const turn = {
        environmentId: environment.id,
        providerThreadId: "provider-legacy-cache",
        scope: turnScope("turn-legacy-cache"),
        threadId: thread.id,
      } as const;
      seedEvent(harness.deps, {
        ...turn,
        createdAt: now - COMPLETED_EVENT_OUTPUT_RETENTION_MS - 2,
        data: {},
        sequence: 1,
        type: "turn/started",
      });
      const output = "cache-" + "k".repeat(40_000);
      harness.db
        .insert(events)
        .values({
          createdAt: now - COMPLETED_EVENT_OUTPUT_RETENTION_MS - 1,
          data: JSON.stringify({
            item: {
              aggregatedOutput: output,
              approvalStatus: null,
              command: "legacy cached command",
              cwd: "/tmp",
              exitCode: 0,
              id: "legacy-cache-command",
              status: "completed",
              type: "commandExecution",
            },
          }),
          environmentId: environment.id,
          id: "evt_legacy_cache_command",
          itemId: "legacy-cache-command",
          itemKind: "commandExecution",
          parentToolCallId: null,
          providerThreadId: "provider-legacy-cache",
          scopeKind: "turn",
          sequence: 2,
          threadId: thread.id,
          turnId: "turn-legacy-cache",
          type: "item/completed",
        })
        .run();

      const before = findCommandRow(
        (await getTimeline(harness, thread.id, "?includeNestedRows=true")).rows,
        "legacy cached command",
      );
      expect(before.output.length).toBeGreaterThan(10_000);

      await runPeriodicSweeps({
        ...harness.deps,
        pluginSchedules: harness.pluginService,
        plugins: harness.pluginService,
      });

      const after = findCommandRow(
        (await getTimeline(harness, thread.id, "?includeNestedRows=true")).rows,
        "legacy cached command",
      );
      expect(after.output.length).toBeLessThan(10_000);
      expect(after.output).toContain("output truncated by retention policy");
    });
  });
});

describe("GET /threads/:id/timeline inline output preview (tool rows)", () => {
  it("previews a large tool result and row-scoped details return it whole", async () => {
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
            id: "tool-big",
            tool: "read_many",
            arguments: { paths: ["a"] },
            status: "completed",
            result: BIG_OUTPUT,
          },
        },
      });

      const timeline = await getTimeline(harness, thread.id);
      const row = timeline.rows.find(
        (candidate) =>
          candidate.kind === "work" && candidate.workKind === "tool",
      );
      if (!row || row.kind !== "work" || row.workKind !== "tool") {
        throw new Error("tool row not found");
      }
      expect(row.outputPreview).toBeDefined();
      expect(row.output.length).toBeLessThan(
        TIMELINE_INLINE_OUTPUT_PREVIEW_THRESHOLD_CHARS,
      );

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline/turn-summary-details?turnId=${row.turnId}&sourceSeqStart=${row.sourceSeqStart}&sourceSeqEnd=${row.sourceSeqEnd}`,
      );
      expect(response.status).toBe(200);
      const details = timelineTurnSummaryDetailsResponseSchema.parse(
        await readJson(response),
      );
      const full = details.rows.find((candidate) => candidate.id === row.id);
      if (!full || full.kind !== "work" || full.workKind !== "tool") {
        throw new Error("expected the previewed tool row in details");
      }
      expect(full.outputPreview).toBeUndefined();
      expect(full.output.length).toBeGreaterThan(
        TIMELINE_INLINE_OUTPUT_PREVIEW_THRESHOLD_CHARS,
      );
      expect(full.output).toContain(BIG_OUTPUT.slice(0, 64));
    });
  });
});

describe("GET /threads/:id/events retained output", () => {
  it("hydrates a retained output in the raw event response", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const output = "raw-" + "r".repeat(50_000);
      seedEvent(harness.deps, {
        data: {
          item: {
            aggregatedOutput: output,
            approvalStatus: null,
            command: "cat retained",
            cwd: "/tmp",
            exitCode: 0,
            id: "retained-raw-command",
            status: "completed",
            type: "commandExecution",
          },
        },
        environmentId: environment.id,
        providerThreadId: "provider-retained",
        scope: turnScope("turn-retained"),
        sequence: 1,
        threadId: thread.id,
        type: "item/completed",
      });
      const stored = harness.db
        .select({ data: events.data })
        .from(events)
        .where(eq(events.threadId, thread.id))
        .get();
      expect(stored?.data).not.toContain(output);

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/events?types=item%2Fcompleted`,
      );
      expect(response.status).toBe(200);
      const rows = threadEventRowSchema.array().parse(await readJson(response));
      const [row] = rows;
      if (
        row?.type !== "item/completed" ||
        row.data.item.type !== "commandExecution"
      ) {
        throw new Error("Expected completed command event");
      }
      expect(row.data.item.aggregatedOutput).toBe(output);
      expect(row.data.item.truncation).toBeUndefined();
    });
  });

  it("rejects a retained-output page above the raw response byte limit", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const output = "r".repeat(1024 * 1024);
      for (let sequence = 1; sequence <= 9; sequence += 1) {
        seedEvent(harness.deps, {
          data: {
            item: {
              aggregatedOutput: output,
              approvalStatus: null,
              command: "cat retained",
              cwd: "/tmp",
              exitCode: 0,
              id: `retained-raw-command-${sequence}`,
              status: "completed",
              type: "commandExecution",
            },
          },
          environmentId: environment.id,
          providerThreadId: "provider-retained",
          scope: turnScope("turn-retained"),
          sequence,
          threadId: thread.id,
          type: "item/completed",
        });
      }

      const oversized = await harness.app.request(
        `/api/v1/threads/${thread.id}/events?types=item%2Fcompleted`,
      );
      expect(oversized.status).toBe(413);
      await expect(readJson(oversized)).resolves.toEqual({
        code: "event_data_too_large",
        message: "Event response exceeds the 8 MiB limit",
      });

      const page = await harness.app.request(
        `/api/v1/threads/${thread.id}/events?types=item%2Fcompleted&limit=1`,
      );
      expect(page.status).toBe(200);
      const [row] = threadEventRowSchema.array().parse(await readJson(page));
      if (
        row?.type !== "item/completed" ||
        row.data.item.type !== "commandExecution"
      ) {
        throw new Error("Expected completed command event");
      }
      expect(row.data.item.aggregatedOutput).toBe(output);
      expect(row.data.item.truncation).toBeUndefined();
    });
  });
});

describe("GET /threads/:id/timeline retained output details", () => {
  it("hydrates a retained output in row-scoped details", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const turn = {
        environmentId: environment.id,
        providerThreadId: "provider-retained-details",
        scope: turnScope("turn-retained-details"),
        threadId: thread.id,
      } as const;
      const output = "details-" + "d".repeat(50_000);
      seedEvent(harness.deps, {
        ...turn,
        data: {},
        sequence: 1,
        type: "turn/started",
      });
      seedEvent(harness.deps, {
        ...turn,
        data: {
          item: {
            aggregatedOutput: output,
            approvalStatus: null,
            command: "cat retained details",
            cwd: "/tmp",
            exitCode: 0,
            id: "retained-details-command",
            status: "completed",
            type: "commandExecution",
          },
        },
        sequence: 2,
        type: "item/completed",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline/turn-summary-details?turnId=turn-retained-details&sourceSeqStart=2&sourceSeqEnd=2`,
      );
      expect(response.status).toBe(200);
      const details = timelineTurnSummaryDetailsResponseSchema.parse(
        await readJson(response),
      );
      const row = details.rows.find(
        (candidate) =>
          candidate.kind === "work" && candidate.workKind === "command",
      );
      if (row?.kind !== "work" || row.workKind !== "command") {
        throw new Error("Expected retained details command row");
      }
      expect(row.output).toBe(output);
      expect(row.outputPreview).toBeUndefined();
    });
  });

  it("keeps an oversized retained output as a preview in details", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const turn = {
        environmentId: environment.id,
        providerThreadId: "provider-oversized-retained-details",
        scope: turnScope("turn-oversized-retained-details"),
        threadId: thread.id,
      } as const;
      const output = "oversized-" + "o".repeat(5 * 1024 * 1024);
      seedEvent(harness.deps, {
        ...turn,
        data: {},
        sequence: 1,
        type: "turn/started",
      });
      seedEvent(harness.deps, {
        ...turn,
        data: {
          item: {
            aggregatedOutput: output,
            approvalStatus: null,
            command: "cat oversized retained details",
            cwd: "/tmp",
            exitCode: 0,
            id: "oversized-retained-details-command",
            status: "completed",
            type: "commandExecution",
          },
        },
        sequence: 2,
        type: "item/completed",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline/turn-summary-details?turnId=turn-oversized-retained-details&sourceSeqStart=2&sourceSeqEnd=2`,
      );
      expect(response.status).toBe(200);
      const details = timelineTurnSummaryDetailsResponseSchema.parse(
        await readJson(response),
      );
      const row = details.rows.find(
        (candidate) =>
          candidate.kind === "work" && candidate.workKind === "command",
      );
      if (row?.kind !== "work" || row.workKind !== "command") {
        throw new Error("Expected oversized retained details command row");
      }
      expect(row.output).not.toBe(output);
      expect(row.output.startsWith(output.slice(0, 2_048))).toBe(true);
      expect(row.output.endsWith(output.slice(-2_048))).toBe(true);
      expect(row.output).toContain("output truncated by retention policy");
      expect(row.outputPreview).toEqual({
        experimental_fullOutputAvailability: "detail-limit",
        totalChars: output.length,
      });
    });
  });

  it("marks a retained output unavailable after its retention expires", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const createdAt = Date.now() - COMPLETED_EVENT_OUTPUT_RETENTION_MS - 1;
      const turn = {
        environmentId: environment.id,
        providerThreadId: "provider-expired-retained-details",
        scope: turnScope("turn-expired-retained-details"),
        threadId: thread.id,
      } as const;
      const output = "expired-" + "e".repeat(50_000);
      seedEvent(harness.deps, {
        ...turn,
        createdAt,
        data: {},
        sequence: 1,
        type: "turn/started",
      });
      seedEvent(harness.deps, {
        ...turn,
        createdAt,
        data: {
          item: {
            aggregatedOutput: output,
            approvalStatus: null,
            command: "cat expired retained details",
            cwd: "/tmp",
            exitCode: 0,
            id: "expired-retained-details-command",
            status: "completed",
            type: "commandExecution",
          },
        },
        sequence: 2,
        type: "item/completed",
      });

      const timelineRow = findCommandRow(
        (await getTimeline(harness, thread.id)).rows,
        "cat expired retained details",
      );
      expect(timelineRow.outputPreview).toEqual({
        experimental_fullOutputAvailability: "retention-expired",
        totalChars: output.length,
      });
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline/turn-summary-details?turnId=turn-expired-retained-details&sourceSeqStart=2&sourceSeqEnd=2`,
      );
      expect(response.status).toBe(200);
      const details = timelineTurnSummaryDetailsResponseSchema.parse(
        await readJson(response),
      );
      const detailRow = findCommandRow(
        details.rows,
        "cat expired retained details",
      );
      expect(detailRow.outputPreview).toEqual({
        experimental_fullOutputAvailability: "retention-expired",
        totalChars: output.length,
      });
    });
  });
});
