import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { threadEventRowSchema, turnScope } from "@bb/domain";
import {
  COMPLETED_EVENT_OUTPUT_RETENTION_MS,
  events,
  migrateNextLegacyImageGenerationOutput,
} from "@bb/db";
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

function maybeFindNestedCommandRow(
  rows: readonly TimelineRow[],
  command: string,
): Extract<TimelineRow, { kind: "work"; workKind: "command" }> | null {
  for (const row of rows) {
    if (
      row.kind === "work" &&
      row.workKind === "command" &&
      row.command === command
    ) {
      return row;
    }
    const children =
      row.kind === "turn"
        ? row.children
        : row.kind === "work" && row.workKind === "delegation"
          ? row.childRows
          : null;
    if (children !== null) {
      const match = maybeFindNestedCommandRow(children, command);
      if (match !== null) {
        return match;
      }
    }
  }
  return null;
}

function findNestedCommandRow(
  rows: readonly TimelineRow[],
  command: string,
): Extract<TimelineRow, { kind: "work"; workKind: "command" }> {
  const row = maybeFindNestedCommandRow(rows, command);
  if (row === null) {
    throw new Error(`nested command row ${command} not found`);
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

  it("annotates and hydrates retained output nested in a completed delegated turn", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const providerThreadId = "provider-nested-retained";
      const turnId = "turn-nested-retained";
      const delegationCallId = "delegation-nested-retained";
      const commandCallId = "command-nested-retained";
      const command = "cat nested retained output";
      const output = "nested-" + "n".repeat(50_000);
      const scope = turnScope(turnId);

      seedEvent(harness.deps, {
        data: {},
        environmentId: environment.id,
        providerThreadId,
        scope,
        sequence: 1,
        threadId: thread.id,
        type: "turn/started",
      });
      seedEvent(harness.deps, {
        data: {
          item: {
            arguments: { prompt: "Inspect nested retained output." },
            id: delegationCallId,
            status: "pending",
            tool: "Agent",
            type: "toolCall",
          },
        },
        environmentId: environment.id,
        providerThreadId,
        scope,
        sequence: 2,
        threadId: thread.id,
        type: "item/started",
      });
      seedEvent(harness.deps, {
        data: {
          item: {
            approvalStatus: null,
            command,
            cwd: "/tmp",
            id: commandCallId,
            parentToolCallId: delegationCallId,
            status: "pending",
            type: "commandExecution",
          },
        },
        environmentId: environment.id,
        providerThreadId,
        scope,
        sequence: 3,
        threadId: thread.id,
        type: "item/started",
      });
      seedEvent(harness.deps, {
        data: {
          item: {
            aggregatedOutput: output,
            approvalStatus: null,
            command,
            cwd: "/tmp",
            exitCode: 0,
            id: commandCallId,
            parentToolCallId: delegationCallId,
            status: "completed",
            type: "commandExecution",
          },
        },
        environmentId: environment.id,
        providerThreadId,
        scope,
        sequence: 4,
        threadId: thread.id,
        type: "item/completed",
      });
      seedEvent(harness.deps, {
        data: {
          item: {
            arguments: { prompt: "Inspect nested retained output." },
            id: delegationCallId,
            result: "Done",
            status: "completed",
            tool: "Agent",
            type: "toolCall",
          },
        },
        environmentId: environment.id,
        providerThreadId,
        scope,
        sequence: 5,
        threadId: thread.id,
        type: "item/completed",
      });
      seedEvent(harness.deps, {
        data: { status: "completed" },
        environmentId: environment.id,
        providerThreadId,
        scope,
        sequence: 6,
        threadId: thread.id,
        type: "turn/completed",
      });

      const timeline = await getTimeline(
        harness,
        thread.id,
        "?includeNestedRows=true",
      );
      const turn = timeline.rows.find(
        (row) => row.kind === "turn" && row.turnId === turnId,
      );
      if (turn?.kind !== "turn" || turn.children === null) {
        throw new Error("Expected completed turn children");
      }
      const delegation = turn.children.find(
        (row) => row.kind === "work" && row.workKind === "delegation",
      );
      if (delegation?.kind !== "work" || delegation.workKind !== "delegation") {
        throw new Error("Expected nested delegation row");
      }
      const preview = findNestedCommandRow(delegation.childRows ?? [], command);
      expect(preview.output).not.toBe(output);
      expect(preview.outputPreview).toEqual({
        experimental_fullOutputAvailability: "available",
        totalChars: output.length,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline/turn-summary-details?turnId=${preview.turnId}&sourceSeqStart=${preview.sourceSeqStart}&sourceSeqEnd=${preview.sourceSeqEnd}&itemId=${preview.callId}`,
      );
      expect(response.status).toBe(200);
      const details = timelineTurnSummaryDetailsResponseSchema.parse(
        await readJson(response),
      );
      const hydrated = findNestedCommandRow(details.rows, command);
      expect(hydrated.output).toBe(output);
      expect(hydrated.outputPreview).toBeUndefined();
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
        `/api/v1/threads/${threadId}/timeline/turn-summary-details?turnId=${big.turnId}&sourceSeqStart=${big.sourceSeqStart}&sourceSeqEnd=${big.sourceSeqEnd}&itemId=${big.callId}`,
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
        `/api/v1/threads/${thread.id}/timeline/turn-summary-details?turnId=${row.turnId}&sourceSeqStart=${row.sourceSeqStart}&sourceSeqEnd=${row.sourceSeqEnd}&itemId=${row.callId}`,
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
  it("hydrates a migrated legacy image envelope in raw and detail responses", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const migratedAt = Date.now();
      const output = "legacy-image-result-" + "i".repeat(50_000);
      const providerThreadId = "provider-legacy-image";
      const turnId = "turn-legacy-image";
      seedEvent(harness.deps, {
        data: {},
        environmentId: environment.id,
        providerThreadId,
        scope: turnScope(turnId),
        sequence: 1,
        threadId: thread.id,
        type: "turn/started",
      });
      harness.db
        .insert(events)
        .values({
          createdAt: migratedAt - 1,
          data: JSON.stringify({
            providerId: "codex",
            rawEvent: {
              jsonrpc: "2.0",
              method: "item/completed",
              params: {
                item: {
                  failure: null,
                  id: "legacy-generated-image",
                  result: output,
                  revisedPrompt: "Draw a compact test image",
                  savedPath: "/tmp/generated.png",
                  status: "completed",
                  transparentBackground: false,
                  type: "imageGeneration",
                },
                threadId: providerThreadId,
                turnId,
              },
            },
            rawType: "item/completed",
          }),
          environmentId: environment.id,
          id: "evt_legacy_generated_image",
          itemId: null,
          itemKind: null,
          parentToolCallId: null,
          providerThreadId,
          scopeKind: "turn",
          sequence: 2,
          threadId: thread.id,
          turnId,
          type: "provider/unhandled",
        })
        .run();
      expect(
        migrateNextLegacyImageGenerationOutput(harness.db, {
          limit: 10,
          migratedAt,
        }),
      ).toMatchObject({ action: "migrated", retained: true });

      const rawResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/events?types=provider%2Funhandled`,
      );
      expect(rawResponse.status).toBe(200);
      const rawRows = threadEventRowSchema
        .array()
        .parse(await readJson(rawResponse));
      expect(rawRows).toHaveLength(1);
      expect(JSON.stringify(rawRows)).toContain(output);

      const detailResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline/turn-summary-details?turnId=${turnId}&sourceSeqStart=2&sourceSeqEnd=2`,
      );
      expect(detailResponse.status).toBe(200);
      const details = timelineTurnSummaryDetailsResponseSchema.parse(
        await readJson(detailResponse),
      );
      expect(details.rows).toContainEqual(
        expect.objectContaining({
          callId: "legacy-generated-image",
          kind: "work",
          workKind: "image-generation",
        }),
      );
    });
  });

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
        `/api/v1/threads/${thread.id}/timeline/turn-summary-details?turnId=turn-retained-details&sourceSeqStart=2&sourceSeqEnd=2&itemId=retained-details-command`,
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
        `/api/v1/threads/${thread.id}/timeline/turn-summary-details?turnId=turn-oversized-retained-details&sourceSeqStart=2&sourceSeqEnd=2&itemId=oversized-retained-details-command`,
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

describe("GET /threads/:id/timeline delegated rows", () => {
  it("defers settled row content when asked and loads each row by item", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });
      const turn = {
        environmentId: environment.id,
        providerThreadId: "provider-deferred",
        scope: turnScope("turn-deferred"),
        threadId: thread.id,
      } as const;
      const reasoning = `thinking ${"r".repeat(1_500)}`;
      const output = `output ${"o".repeat(2_000)}`;
      const diff = `@@ -1 +1 @@\n-old\n+${"d".repeat(1_500)}\n`;
      let sequence = 0;
      const seed = (type: "item/started" | "item/completed", item: object) => {
        sequence += 1;
        seedEvent(harness.deps, { ...turn, data: { item }, sequence, type });
      };
      sequence += 1;
      seedEvent(harness.deps, {
        ...turn,
        data: {},
        sequence,
        type: "turn/started",
      });
      seed("item/started", {
        type: "reasoning",
        id: "reasoning-1",
        summary: [],
        content: [],
      });
      seed("item/completed", {
        type: "reasoning",
        id: "reasoning-1",
        summary: [],
        content: [reasoning],
      });
      seed("item/completed", {
        aggregatedOutput: output,
        approvalStatus: null,
        command: "cat big",
        cwd: "/tmp",
        exitCode: 0,
        id: "command-1",
        status: "completed",
        type: "commandExecution",
      });
      const script = `python3 - <<'EOF'\n${"print(1)\n".repeat(150)}EOF`;
      seed("item/completed", {
        aggregatedOutput: "ok",
        approvalStatus: null,
        command: script,
        cwd: "/tmp",
        exitCode: 0,
        id: "command-2",
        status: "completed",
        type: "commandExecution",
      });
      seed("item/completed", {
        approvalStatus: null,
        changes: [{ path: "src/big.ts", kind: "update", diff }],
        id: "file-1",
        status: "completed",
        type: "fileChange",
      });

      const findRows = (rows: readonly TimelineRow[]) => {
        const reasoningRow = rows.find(
          (row) =>
            row.kind === "system" &&
            row.title.length > 0 &&
            "reasoningId" in row,
        );
        const commandRow = rows.find(
          (row) => row.kind === "work" && row.workKind === "command",
        );
        const fileRow = rows.find(
          (row) => row.kind === "work" && row.workKind === "file-change",
        );
        if (
          reasoningRow?.kind !== "system" ||
          commandRow?.kind !== "work" ||
          commandRow.workKind !== "command" ||
          fileRow?.kind !== "work" ||
          fileRow.workKind !== "file-change"
        ) {
          throw new Error("Expected reasoning, command and file-change rows");
        }
        return { commandRow, fileRow, reasoningRow };
      };

      const inline = findRows((await getTimeline(harness, thread.id)).rows);
      expect(inline.reasoningRow.detail).toContain(reasoning);
      expect(inline.commandRow.output).toBe(output);
      expect(inline.fileRow.change.diff).toBe(diff);
      expect(inline.commandRow).not.toHaveProperty("contentDeferred");

      const deferred = findRows(
        (await getTimeline(harness, thread.id, "?deferContent=true")).rows,
      );
      expect(deferred.reasoningRow).toMatchObject({
        contentDeferred: true,
        detail: null,
      });
      expect(deferred.commandRow).toMatchObject({
        contentDeferred: true,
        output: "",
      });
      expect(deferred.commandRow).not.toHaveProperty("outputPreview");
      const deferredScript = (
        await getTimeline(harness, thread.id, "?deferContent=true")
      ).rows.find(
        (row) =>
          row.kind === "work" &&
          row.workKind === "command" &&
          row.callId === "command-2",
      );
      expect(deferredScript).toMatchObject({
        command: script.slice(0, 300),
        contentDeferred: true,
      });
      if (deferredScript === undefined) {
        throw new Error("Expected the long command row");
      }
      expect(deferred.fileRow).toMatchObject({
        change: { diff: null, diffStats: inline.fileRow.change.diffStats },
        contentDeferred: true,
      });

      const loadItem = async (row: TimelineRow, itemId: string) => {
        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/timeline/turn-summary-details?turnId=${row.turnId}&sourceSeqStart=${row.sourceSeqStart}&sourceSeqEnd=${row.sourceSeqEnd}&itemId=${itemId}&deferContent=true`,
        );
        expect(response.status).toBe(200);
        return timelineTurnSummaryDetailsResponseSchema.parse(
          await readJson(response),
        ).rows;
      };
      expect(await loadItem(deferredScript, "command-2")).toEqual([
        expect.objectContaining({ command: script, output: "ok" }),
      ]);
      const [loadedReasoning] = await loadItem(
        deferred.reasoningRow,
        "reasoningId" in deferred.reasoningRow
          ? (deferred.reasoningRow.reasoningId ?? "")
          : "",
      );
      expect(loadedReasoning).toMatchObject({ id: deferred.reasoningRow.id });
      expect(loadedReasoning).not.toHaveProperty("contentDeferred");
      expect(
        loadedReasoning?.kind === "system" ? loadedReasoning.detail : null,
      ).toContain(reasoning);
      expect(await loadItem(deferred.commandRow, "command-1")).toEqual([
        expect.objectContaining({ id: deferred.commandRow.id, output }),
      ]);
      expect(await loadItem(deferred.fileRow, "file-1")).toEqual([
        expect.objectContaining({
          change: expect.objectContaining({ diff }),
          id: deferred.fileRow.id,
        }),
      ]);
    });
  });

  it("previews nested output inline while a delegation runs and loads its children by call once it settles", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });
      const scope = turnScope("turn-delegated");
      const turn = {
        environmentId: environment.id,
        providerThreadId: "provider-delegated",
        scope,
        threadId: thread.id,
      } as const;
      const delegationCallId = "delegation-call";
      const commandCallId = "nested-big-command";
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
            arguments: { prompt: "Inspect nested output." },
            id: delegationCallId,
            status: "pending",
            tool: "Agent",
            type: "toolCall",
          },
        },
        sequence: 2,
        type: "item/started",
      });
      seedEvent(harness.deps, {
        ...turn,
        data: {
          item: {
            aggregatedOutput: BIG_OUTPUT,
            approvalStatus: null,
            command: "nested big",
            cwd: "/tmp",
            exitCode: 0,
            id: commandCallId,
            parentToolCallId: delegationCallId,
            status: "completed",
            type: "commandExecution",
          },
        },
        sequence: 3,
        type: "item/completed",
      });

      const running = await getTimeline(harness, thread.id);
      const runningCommand = findNestedCommandRow(running.rows, "nested big");
      expect(runningCommand.output.length).toBeLessThan(
        TIMELINE_INLINE_OUTPUT_PREVIEW_THRESHOLD_CHARS,
      );
      expect(runningCommand.outputPreview).toEqual({
        experimental_fullOutputAvailability: "available",
        totalChars: BIG_OUTPUT.length,
      });

      seedEvent(harness.deps, {
        ...turn,
        data: {
          item: {
            arguments: { prompt: "Inspect nested output." },
            id: delegationCallId,
            result: "Done",
            status: "completed",
            tool: "Agent",
            type: "toolCall",
          },
        },
        sequence: 4,
        type: "item/completed",
      });

      const settled = await getTimeline(
        harness,
        thread.id,
        "?deferContent=true",
      );
      const inline = await getTimeline(harness, thread.id);
      expect(
        findNestedCommandRow(inline.rows, "nested big").outputPreview,
      ).toBeDefined();
      expect(maybeFindNestedCommandRow(settled.rows, "nested big")).toBeNull();
      const delegation = settled.rows.find(
        (row) => row.kind === "work" && row.workKind === "delegation",
      );
      if (delegation?.kind !== "work" || delegation.workKind !== "delegation") {
        throw new Error("Expected delegation row");
      }
      expect(delegation.childRows).toBeNull();

      const detailsUrl = (callId: string, sourceSeqStart = 2) =>
        `/api/v1/threads/${thread.id}/timeline/turn-summary-details?turnId=${delegation.turnId}&sourceSeqStart=${sourceSeqStart}&sourceSeqEnd=${delegation.sourceSeqEnd}&itemId=${callId}`;
      const childrenResponse = await harness.app.request(
        detailsUrl(delegationCallId),
      );
      expect(childrenResponse.status).toBe(200);
      const children = timelineTurnSummaryDetailsResponseSchema.parse(
        await readJson(childrenResponse),
      );
      const previewed = findNestedCommandRow(children.rows, "nested big");
      const fromLaterStart = await harness.app.request(
        detailsUrl(delegationCallId, 3),
      );
      expect(fromLaterStart.status).toBe(200);
      expect(
        timelineTurnSummaryDetailsResponseSchema.parse(
          await readJson(fromLaterStart),
        ).rows,
      ).toEqual(children.rows);
      expect(previewed.output.length).toBeLessThan(
        TIMELINE_INLINE_OUTPUT_PREVIEW_THRESHOLD_CHARS,
      );
      expect(previewed.outputPreview).toBeDefined();

      const fullResponse = await harness.app.request(detailsUrl(commandCallId));
      expect(fullResponse.status).toBe(200);
      const full = timelineTurnSummaryDetailsResponseSchema.parse(
        await readJson(fullResponse),
      );
      expect(full.rows).toEqual([
        expect.objectContaining({
          callId: commandCallId,
          output: BIG_OUTPUT,
        }),
      ]);
      expect(full.rows[0]).not.toHaveProperty("outputPreview");

      const missing = await harness.app.request(detailsUrl("unknown-call"));
      expect(missing.status).toBe(400);
    });
  });
});
