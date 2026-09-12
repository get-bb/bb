import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ThreadDelta,
  threadDeltaNotificationParamsSchema,
} from "@get-bb/plugin-sdk/provider-bridge";
import {
  CWD,
  completedItems,
  createBenchBridgeHarness,
  turnStatuses,
  type BenchBridgeHarness,
} from "./bridge-harness.js";
import { HISTORY_LIMITS, buildHistoryTurn } from "./src/turn-content.js";

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

beforeEach(() => {
  harness = createBenchBridgeHarness();
});

afterEach(() => {
  harness.restore();
});

function lineCount(text: string): number {
  return text.endsWith("\n")
    ? text.split("\n").length - 1
    : text.split("\n").length;
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

function checkHistoryTurn(seed: number, tools: number): string[] {
  const label = `seed=${seed} tools=${tools}`;
  const within = (value: number, limits: { min: number; max: number }) => {
    expect(value, label).toBeGreaterThanOrEqual(limits.min);
    expect(value, label).toBeLessThanOrEqual(limits.max);
  };
  const batches = buildHistoryTurn({ seed, tools, cwd: CWD, idPrefix: "p" });
  for (const deltas of batches) {
    threadDeltaNotificationParamsSchema.parse({ threadId: "thr", deltas });
  }
  const deltas = batches.flat();
  const closes = deltas.filter(
    (delta): delta is ItemClose => delta.kind === "item.close",
  );
  const activities = closes.slice(1, -1);
  expect(activities, label).toHaveLength(tools);
  const shapes = activities.map(activityShape);
  if (tools >= 3) {
    expect(shapes, label).toContain("command");
    expect(shapes, label).toContain("fileChange:diff");
  }
  for (const close of activities) {
    expect(close.status, label).toBe("completed");
    const resultBytes = Buffer.byteLength(close.resultText ?? "");
    switch (close.item.type) {
      case "tool":
        expect(CLAUDE_CLASSIFIED_TOOL_NAMES, label).not.toContain(
          close.item.tool,
        );
        within(resultBytes, HISTORY_LIMITS.toolResultBytes);
        break;
      case "webSearch":
        within(resultBytes, HISTORY_LIMITS.toolResultBytes);
        break;
      case "fileRead":
      case "search":
        expect(close.resultText, label).toBeUndefined();
        break;
      case "command":
        within(
          lineCount(close.aggregatedOutput ?? ""),
          HISTORY_LIMITS.commandLines,
        );
        break;
      case "fileChange": {
        const change = close.item.changes[0];
        if (change?.diff === undefined) {
          expect(change, label).toMatchObject({
            oldText: expect.any(String),
            newText: expect.any(String),
          });
          within(resultBytes, HISTORY_LIMITS.toolResultBytes);
        } else {
          within(
            change.diff.split("\n").filter((line) => line.startsWith("@@ "))
              .length,
            HISTORY_LIMITS.diffHunks,
          );
          expect(change.diff, label).toMatch(/^-(?!--)/mu);
          expect(change.diff, label).toMatch(/^\+(?!\+\+)/mu);
          expect(close.resultText, label).toBeUndefined();
        }
        break;
      }
      default:
        throw new Error(`${label}: unexpected ${close.item.type} item`);
    }
  }

  within(
    deltas.filter(
      (delta) =>
        delta.kind === "item.textDelta" && delta.channel === "reasoningText",
    ).length,
    HISTORY_LIMITS.reasoningDeltas,
  );
  const reasoning = closes[0]?.item;
  within(
    reasoning?.type === "reasoning" ? reasoning.content.join("").length : 0,
    HISTORY_LIMITS.reasoningChars,
  );

  const messageBatches = batches.filter((batch) =>
    batch.some(
      (delta) =>
        delta.kind === "item.textDelta" && delta.channel === "agentMessage",
    ),
  );
  within(messageBatches.length, HISTORY_LIMITS.messageNotifications);
  const messageDeltas = messageBatches
    .flat()
    .flatMap((delta) =>
      delta.kind === "item.textDelta" && delta.channel === "agentMessage"
        ? [delta.text]
        : [],
    );
  within(messageDeltas.length, HISTORY_LIMITS.messageDeltas);
  const message = closes.at(-1)?.item;
  const messageText = message?.type === "agentMessage" ? message.text : "";
  expect(messageDeltas.join(""), label).toBe(messageText);
  within(messageText.length, HISTORY_LIMITS.messageChars);
  expect(Buffer.byteLength(messageText), label).toBeLessThanOrEqual(16_384);
  return shapes;
}

describe("bench_history", () => {
  it.each([
    [
      5,
      [
        "commandExecution",
        "fileChange",
        "fileRead",
        "toolCall:TaskUpdate",
        "toolCall:linear",
        "webSearch",
      ],
    ],
    [
      11,
      [
        "commandExecution",
        "fileChange",
        "fileRead",
        "fileRead",
        "search",
        "toolCall:linear",
      ],
    ],
  ])(
    "projects seed=%i through the SDK assembler as completed rows",
    (seed, activityTypes) => {
      const thread = harness.startThread();
      harness.startTurn(thread, `bench_history seed=${seed} tools=6`);
      const events = harness.events(harness.takeMessages());
      expect(
        events.filter((event) => event.type === "turn/started"),
      ).toHaveLength(1);
      expect(turnStatuses(events)).toEqual(["completed"]);

      const [reasoning, ...activities] = completedItems(events);
      const message = activities.pop();
      expect(reasoning?.type).toBe("reasoning");
      expect(
        activities
          .map((item) =>
            item.type === "toolCall"
              ? `toolCall:${item.server ?? item.tool}`
              : item.type,
          )
          .sort(),
      ).toEqual(activityTypes);

      for (const item of activities) {
        expect(item).toMatchObject({
          presentation: {
            label: {
              pending: expect.any(String),
              completed: expect.any(String),
            },
            icon: { glyph: expect.any(String) },
          },
        });
        switch (item.type) {
          case "fileRead":
            expect(item.path.startsWith(`${CWD}/`)).toBe(true);
            break;
          case "search":
            expect(item.path?.startsWith(CWD)).toBe(true);
            break;
          case "fileChange":
            expect(item.changes[0]?.path.startsWith(`${CWD}/`)).toBe(true);
            break;
          case "webSearch":
            expect(item.queries).toHaveLength(1);
            break;
          case "toolCall":
            expect(item.arguments).toBeDefined();
            expect(item.presentation?.suppress).toBe(
              item.tool === "TaskUpdate" ? true : undefined,
            );
            break;
          case "commandExecution":
            expect(item).toMatchObject({ exitCode: 0, cwd: CWD });
            expect(
              events.some(
                (event) =>
                  event.type === "item/commandExecution/outputDelta" &&
                  event.itemId === item.id,
              ),
            ).toBe(true);
            break;
        }
      }

      expect(message?.type).toBe("agentMessage");
      const messageDeltas = events.flatMap((event) =>
        event.type === "item/agentMessage/delta" && event.itemId === message?.id
          ? [event.delta]
          : [],
      );
      expect(message).toMatchObject({ text: messageDeltas.join("") });
    },
  );

  it("is deterministic per seed and varies across seeds", () => {
    const turn = (seed: number) =>
      buildHistoryTurn({ seed, tools: 4, cwd: CWD, idPrefix: "bench" });
    expect(turn(42)).toEqual(turn(42));
    expect(turn(43)).not.toEqual(turn(42));
  });

  it("keeps every generated turn inside the directive's limits and shapes", () => {
    const shapes = new Set<string>();
    for (let seed = 0; seed < 120; seed += 1) {
      for (let tools = 0; tools <= 6; tools += 1) {
        for (const shape of checkHistoryTurn(seed, tools)) {
          shapes.add(shape);
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
  });
});
