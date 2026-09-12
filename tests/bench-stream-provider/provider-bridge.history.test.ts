import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ThreadDelta,
  threadDeltaNotificationParamsSchema,
} from "@get-bb/plugin-sdk/provider-bridge";
import type { ThreadEvent } from "@get-bb/plugin-sdk/provider-bridge/testing";
import {
  createBenchBridgeHarness,
  type BenchBridgeHarness,
} from "./bridge-harness.js";
import { HISTORY_LIMITS, buildHistoryTurn } from "./src/turn-content.js";

const CWD = "/workspace/bench";

const CLAUDE_CLASSIFIED_TOOL_NAMES = [
  "Read",
  "Grep",
  "Glob",
  "WebSearch",
  "WebFetch",
  "Edit",
  "Write",
  "Bash",
];

type ItemClose = Extract<ThreadDelta, { kind: "item.close" }>;

let harness: BenchBridgeHarness;
let threadCounter = 0;

beforeEach(() => {
  harness = createBenchBridgeHarness();
  harness.initialize();
});

afterEach(() => {
  harness.restore();
});

function runHistoryTurn(prompt: string): ThreadEvent[] {
  threadCounter += 1;
  const threadId = `thr_bench_history_${threadCounter}`;
  const providerThreadId = harness.startThread(threadId, CWD);
  harness.takeMessages();
  harness.startTurn({ threadId, providerThreadId, text: prompt });
  return harness.assemble(harness.takeMessages());
}

function completedItems(events: readonly ThreadEvent[]) {
  return events.flatMap((event) =>
    event.type === "item/completed" ? [event.item] : [],
  );
}

function within(value: number, limits: { min: number; max: number }): boolean {
  return value >= limits.min && value <= limits.max;
}

function lineCount(text: string): number {
  return text.endsWith("\n")
    ? text.split("\n").length - 1
    : text.split("\n").length;
}

function hunkCount(diff: string): number {
  return diff.split("\n").filter((line) => line.startsWith("@@ ")).length;
}

function withoutIds(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, nested: unknown) =>
      key === "id" ? undefined : nested,
    ),
  );
}

function activityShape(close: ItemClose): string {
  const { item } = close;
  switch (item.type) {
    case "search":
      return `search:${item.mode}`;
    case "fileChange":
      return item.changes[0]?.diff === undefined
        ? "fileChange:text"
        : "fileChange:diff";
    case "tool":
      return item.server === undefined
        ? `tool:${item.tool}`
        : `tool:${item.server}`;
    default:
      return item.type;
  }
}

function activityCloses(seed: number, tools: number): ItemClose[] {
  const closes = buildHistoryTurn({
    seed,
    tools,
    cwd: CWD,
    idPrefix: `seed-${seed}`,
  })
    .flat()
    .filter((delta): delta is ItemClose => delta.kind === "item.close");
  return closes.slice(1, -1);
}

describe("bench_history", () => {
  it("projects reasoning, work items and the message as completed items", () => {
    const events = runHistoryTurn("bench_history seed=11 tools=6");
    expect(
      events.filter((event) => event.type === "turn/started"),
    ).toHaveLength(1);
    expect(
      events.flatMap((event) =>
        event.type === "turn/completed" ? [event.status] : [],
      ),
    ).toEqual(["completed"]);

    const items = completedItems(events);
    expect(items).toHaveLength(8);
    const [reasoning, ...rest] = items;
    const message = rest.pop();
    const activities = rest;

    expect(reasoning?.type).toBe("reasoning");
    const reasoningText =
      reasoning?.type === "reasoning" ? (reasoning.content[0] ?? "") : "";
    expect(within(reasoningText.length, HISTORY_LIMITS.reasoningChars)).toBe(
      true,
    );
    const reasoningDeltas = events.filter(
      (event) =>
        event.type === "item/reasoning/textDelta" &&
        event.itemId === reasoning?.id,
    );
    expect(within(reasoningDeltas.length, HISTORY_LIMITS.reasoningDeltas)).toBe(
      true,
    );

    expect(activities.map((item) => item.type).sort()).toEqual([
      "commandExecution",
      "fileChange",
      "fileRead",
      "fileRead",
      "search",
      "toolCall",
    ]);
    for (const item of activities) {
      expect(item).toMatchObject({
        status: "completed",
        presentation: {
          label: { pending: expect.any(String), completed: expect.any(String) },
          icon: { glyph: expect.any(String) },
        },
      });
      if (item.type === "fileRead") {
        expect(item.path.startsWith(`${CWD}/`)).toBe(true);
      }
      if (item.type === "search") {
        expect(item.query.length).toBeGreaterThan(0);
        expect(item.path?.startsWith(CWD)).toBe(true);
      }
      if (item.type === "toolCall") {
        expect(item.server).toBe("linear");
        expect(item.arguments).toBeDefined();
        expect(
          within(
            Buffer.byteLength(String(item.result)),
            HISTORY_LIMITS.toolResultBytes,
          ),
        ).toBe(true);
      }
      if (item.type === "commandExecution") {
        expect(item.exitCode).toBe(0);
        expect(item.cwd).toBe(CWD);
        expect(
          within(
            lineCount(item.aggregatedOutput ?? ""),
            HISTORY_LIMITS.commandLines,
          ),
        ).toBe(true);
        expect(
          events.some(
            (event) =>
              event.type === "item/commandExecution/outputDelta" &&
              event.itemId === item.id,
          ),
        ).toBe(true);
      }
      if (item.type === "fileChange") {
        expect(item.changes).toHaveLength(1);
        expect(item.changes[0]?.path.startsWith(`${CWD}/`)).toBe(true);
        expect(
          within(
            hunkCount(item.changes[0]?.diff ?? ""),
            HISTORY_LIMITS.diffHunks,
          ),
        ).toBe(true);
      }
    }

    expect(message?.type).toBe("agentMessage");
    const messageText = message?.type === "agentMessage" ? message.text : "";
    expect(within(messageText.length, HISTORY_LIMITS.messageChars)).toBe(true);
    const messageDeltas = events.flatMap((event) =>
      event.type === "item/agentMessage/delta" && event.itemId === message?.id
        ? [event.delta]
        : [],
    );
    expect(within(messageDeltas.length, HISTORY_LIMITS.messageDeltas)).toBe(
      true,
    );
    expect(messageDeltas.join("")).toBe(messageText);
  });

  it("emits generic tool calls in the item shapes the Claude Code bridge classifies them into", () => {
    const shapes = new Set<string>();
    for (let seed = 0; seed < 60; seed += 1) {
      for (const close of activityCloses(seed, 6)) {
        shapes.add(activityShape(close));
        if (close.item.type === "tool") {
          expect(CLAUDE_CLASSIFIED_TOOL_NAMES).not.toContain(close.item.tool);
        }
      }
    }
    expect([...shapes].sort()).toEqual([
      "command",
      "fileChange:diff",
      "fileChange:text",
      "fileRead",
      "search:content",
      "search:path",
      "tool:TaskUpdate",
      "tool:github",
      "tool:linear",
      "webSearch",
    ]);

    const events = runHistoryTurn("bench_history seed=5 tools=6");
    const projected = completedItems(events).map((item) =>
      item.type === "toolCall"
        ? `${item.type}:${item.server ?? item.tool}`
        : item.type,
    );
    expect(projected.slice(1, -1).sort()).toEqual([
      "commandExecution",
      "fileChange",
      "fileRead",
      "toolCall:TaskUpdate",
      "toolCall:linear",
      "webSearch",
    ]);

    const editEvents = runHistoryTurn("bench_history seed=18 tools=6");
    const edits = completedItems(editEvents).flatMap((item) =>
      item.type === "fileChange" ? [item.changes[0]?.diff ?? ""] : [],
    );
    expect(edits).toHaveLength(2);
    for (const diff of edits) {
      const lines = diff.split("\n");
      expect(
        lines.some((line) => line.startsWith("+") && !line.startsWith("+++")),
      ).toBe(true);
      expect(
        lines.some((line) => line.startsWith("-") && !line.startsWith("---")),
      ).toBe(true);
    }

    for (const item of completedItems(events)) {
      if (item.type === "toolCall") {
        expect(typeof item.result).toBe("string");
        expect(
          within(
            Buffer.byteLength(String(item.result)),
            HISTORY_LIMITS.toolResultBytes,
          ),
        ).toBe(true);
        expect(item.presentation?.suppress).toBe(
          item.tool === "TaskUpdate" ? true : undefined,
        );
      }
      if (item.type === "webSearch") {
        expect(item.queries).toHaveLength(1);
        expect(
          within(
            Buffer.byteLength(item.resultText ?? ""),
            HISTORY_LIMITS.toolResultBytes,
          ),
        ).toBe(true);
      }
    }
  });

  it("is deterministic per seed and varies across seeds", () => {
    const first = withoutIds(
      completedItems(runHistoryTurn("bench_history seed=42 tools=4")),
    );
    const again = withoutIds(
      completedItems(runHistoryTurn("bench_history seed=42 tools=4")),
    );
    const other = withoutIds(
      completedItems(runHistoryTurn("bench_history seed=43 tools=4")),
    );
    expect(again).toEqual(first);
    expect(other).not.toEqual(first);
  });

  it("keeps every generated turn inside the directive's limits", () => {
    for (let seed = 0; seed < 120; seed += 1) {
      for (let tools = 0; tools <= 6; tools += 1) {
        const batches = buildHistoryTurn({
          seed,
          tools,
          cwd: CWD,
          idPrefix: `seed-${seed}`,
        });
        const label = `seed=${seed} tools=${tools}`;
        for (const deltas of batches) {
          threadDeltaNotificationParamsSchema.parse({
            threadId: "thr_limits",
            deltas,
          });
        }
        const deltas = batches.flat();
        const closes = deltas.filter(
          (delta): delta is ItemClose => delta.kind === "item.close",
        );
        const activities = closes.slice(1, -1);
        expect(activities, label).toHaveLength(tools);
        if (tools >= 3) {
          const shapes = new Set(activities.map(activityShape));
          expect(
            shapes.has("command") && shapes.has("fileChange:diff"),
            label,
          ).toBe(true);
        }
        for (const close of activities) {
          const resultBytes =
            close.resultText === undefined
              ? null
              : Buffer.byteLength(close.resultText);
          switch (close.item.type) {
            case "tool":
            case "webSearch":
              expect(
                resultBytes !== null &&
                  within(resultBytes, HISTORY_LIMITS.toolResultBytes),
                label,
              ).toBe(true);
              break;
            case "fileRead":
            case "search":
              expect(resultBytes, label).toBeNull();
              break;
            case "command":
              expect(
                within(
                  lineCount(close.aggregatedOutput ?? ""),
                  HISTORY_LIMITS.commandLines,
                ),
                label,
              ).toBe(true);
              break;
            case "fileChange": {
              const change = close.item.changes[0];
              if (change?.diff === undefined) {
                expect(change?.oldText, label).toBeDefined();
                expect(change?.newText, label).toBeDefined();
                expect(
                  resultBytes !== null &&
                    within(resultBytes, HISTORY_LIMITS.toolResultBytes),
                  label,
                ).toBe(true);
              } else {
                expect(
                  within(hunkCount(change.diff), HISTORY_LIMITS.diffHunks),
                  label,
                ).toBe(true);
                expect(resultBytes, label).toBeNull();
              }
              break;
            }
            default:
              throw new Error(`${label}: unexpected ${close.item.type} item`);
          }
        }

        const reasoningDeltas = deltas.filter(
          (delta) =>
            delta.kind === "item.textDelta" &&
            delta.channel === "reasoningText",
        );
        expect(
          within(reasoningDeltas.length, HISTORY_LIMITS.reasoningDeltas),
          label,
        ).toBe(true);
        const reasoningClose = closes[0];
        const reasoningText =
          reasoningClose?.item.type === "reasoning"
            ? reasoningClose.item.content.join("")
            : "";
        expect(
          within(reasoningText.length, HISTORY_LIMITS.reasoningChars),
          label,
        ).toBe(true);

        const messageBatches = batches.filter((batch) =>
          batch.some(
            (delta) =>
              delta.kind === "item.textDelta" &&
              delta.channel === "agentMessage",
          ),
        );
        expect(
          within(messageBatches.length, HISTORY_LIMITS.messageNotifications),
          label,
        ).toBe(true);
        const messageDeltas = messageBatches
          .flat()
          .flatMap((delta) =>
            delta.kind === "item.textDelta" && delta.channel === "agentMessage"
              ? [delta.text]
              : [],
          );
        expect(
          within(messageDeltas.length, HISTORY_LIMITS.messageDeltas),
          label,
        ).toBe(true);
        const messageClose = closes.at(-1);
        const messageText =
          messageClose?.item.type === "agentMessage"
            ? messageClose.item.text
            : "";
        expect(messageDeltas.join(""), label).toBe(messageText);
        expect(
          within(messageText.length, HISTORY_LIMITS.messageChars),
          label,
        ).toBe(true);
        expect(Buffer.byteLength(messageText), label).toBeLessThanOrEqual(
          16_384,
        );
      }
    }
  });
});
