import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BRIDGE_JSON_RPC_ERRORS,
  type ThreadDelta,
} from "@get-bb/plugin-sdk/provider-bridge";
import {
  completedItems,
  createBenchBridgeHarness,
  deltaNotifications,
  turnStatuses,
  type BenchBridgeHarness,
  type BenchThread,
} from "./bridge-harness.js";
import { getFixture } from "./src/fixtures/index.js";
import { BENCH_STREAM_LOG_DIR_ENV } from "./src/vocabulary.js";

const SLOW_STREAM =
  "bench_stream doc=long-response chunk=24 interval=30 prelude=0";

let harness: BenchBridgeHarness;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-02T03:04:05.000Z"));
  harness = createBenchBridgeHarness();
});

afterEach(() => {
  harness.restore();
  vi.useRealTimers();
});

function startTurn(text: string): BenchThread {
  const thread = harness.startThread();
  harness.startTurn(thread, text);
  return thread;
}

function freshDeltas(threadId: string): ThreadDelta[][] {
  return deltaNotifications(harness.takeMessages(), threadId);
}

function agentTextDelta(delta: ThreadDelta | undefined): string {
  if (delta?.kind !== "item.textDelta" || delta.channel !== "agentMessage") {
    throw new Error(
      `expected an agentMessage textDelta, got ${JSON.stringify(delta)}`,
    );
  }
  return delta.text;
}

function streamedChunks(notifications: readonly ThreadDelta[][]): string[] {
  return notifications
    .filter((deltas) => deltas[0]?.kind === "item.textDelta")
    .map((deltas) => agentTextDelta(deltas[0]));
}

describe("bench_stream pacing", () => {
  it("emits one textDelta notification per interval whose chunks concatenate to the item.close text", () => {
    const { threadId } = startTurn(
      "bench_stream doc=incident-writeup chunk=500 interval=40",
    );

    const opening = freshDeltas(threadId).flat();
    expect(opening.slice(0, 2).map((delta) => delta.kind)).toEqual([
      "input.accepted",
      "turn.open",
    ]);
    expect(
      opening.filter((delta) => delta.kind === "item.close"),
    ).toMatchObject([
      { item: { type: "reasoning" } },
      {
        item: { type: "tool", server: "linear", tool: "get_issue" },
        resultText: expect.stringContaining("PLAT-412"),
      },
    ]);
    expect(opening.at(-1)).toMatchObject({
      kind: "item.open",
      item: { type: "agentMessage", text: "" },
    });

    vi.advanceTimersByTime(39);
    expect(freshDeltas(threadId)).toEqual([]);

    const expected = getFixture("incident-writeup");
    const tickCount = Math.ceil(expected.length / 500);
    const chunks: string[] = [];
    let closing: ThreadDelta[] = [];
    for (let tick = 0; tick < tickCount; tick += 1) {
      vi.advanceTimersByTime(tick === 0 ? 1 : 40);
      const notifications = freshDeltas(threadId);
      const last = tick === tickCount - 1;
      expect(notifications, `tick ${tick}`).toHaveLength(last ? 2 : 1);
      expect(notifications[0]).toHaveLength(1);
      chunks.push(agentTextDelta(notifications[0]?.[0]));
      if (last) {
        closing = notifications[1] ?? [];
      }
    }

    expect(chunks.join("")).toBe(expected);
    expect(chunks.slice(0, -1).every((chunk) => chunk.length === 500)).toBe(
      true,
    );
    expect(closing).toMatchObject([
      {
        kind: "item.close",
        status: "completed",
        item: { type: "agentMessage", text: expected },
      },
      { kind: "turn.boundary", status: "completed" },
    ]);
    expect(vi.getTimerCount()).toBe(0);

    const events = harness.events();
    expect(turnStatuses(events)).toEqual(["completed"]);
    expect(completedItems(events).at(-1)).toMatchObject({
      type: "agentMessage",
      text: expected,
    });
  });

  it("repeats the document with blank lines and lets the last chunk run short", () => {
    const { threadId } = startTurn(
      "bench_stream doc=pathological chunk=4096 interval=10 repeat=2 prelude=0",
    );
    expect(
      freshDeltas(threadId)
        .flat()
        .map((delta) => delta.kind),
    ).toEqual(["input.accepted", "turn.open", "item.open"]);

    const expected = [
      getFixture("pathological"),
      getFixture("pathological"),
    ].join("\n\n");
    vi.advanceTimersByTime(10 * Math.ceil(expected.length / 4096));
    const notifications = freshDeltas(threadId);
    const chunks = streamedChunks(notifications);
    expect(chunks.join("")).toBe(expected);
    expect(chunks.slice(0, -1).every((chunk) => chunk.length === 4096)).toBe(
      true,
    );
    expect(chunks.at(-1)?.length).toBe(expected.length % 4096);
    expect(notifications.at(-1)).toMatchObject([
      { kind: "item.close", item: { text: expected } },
      { kind: "turn.boundary", status: "completed" },
    ]);
  });
});

describe("bench_stream cancellation", () => {
  it.each([
    {
      method: "thread/stop",
      act: (thread: BenchThread) => harness.stopThread(thread, "interrupt"),
      trailing: [],
    },
    {
      method: "thread/resume",
      act: (thread: BenchThread) => harness.resumeThread(thread),
      trailing: [[{ kind: "session.reset" }]],
    },
  ])(
    "settles the stream and drops queued steers before answering $method, then stays silent",
    ({ act, trailing }) => {
      const thread = startTurn(SLOW_STREAM);
      harness.steerTurn(thread, "faster");
      vi.advanceTimersByTime(90);
      harness.takeMessages();

      act(thread);
      const messages = harness.takeMessages();
      const responseIndex = messages.findIndex(
        (message) => message.id !== undefined,
      );
      expect(
        deltaNotifications(messages.slice(0, responseIndex), thread.threadId),
      ).toMatchObject([
        [
          {
            kind: "item.close",
            status: "interrupted",
            item: {
              type: "agentMessage",
              text: getFixture("long-response").slice(0, 72),
            },
          },
          { kind: "turn.boundary", status: "interrupted" },
        ],
        ...trailing,
      ]);
      expect(vi.getTimerCount()).toBe(0);

      vi.advanceTimersByTime(60_000);
      expect(harness.takeMessages()).toEqual([]);
      expect(turnStatuses(harness.events())).toEqual(["interrupted"]);
    },
  );

  it("cancels pacing on a release stop without fabricating an interruption", () => {
    const thread = startTurn(SLOW_STREAM);
    vi.advanceTimersByTime(30);
    harness.takeMessages();

    harness.stopThread(thread, "release");
    expect(freshDeltas(thread.threadId)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(harness.takeMessages()).toEqual([]);
  });

  it("settles a running stream as interrupted before the next turn starts", () => {
    const thread = startTurn(SLOW_STREAM);
    vi.advanceTimersByTime(60);
    harness.startTurn(thread, "say hello");
    expect(vi.getTimerCount()).toBe(0);

    const events = harness.events();
    expect(turnStatuses(events)).toEqual(["interrupted", "completed"]);
    expect(completedItems(events).at(-1)).toMatchObject({
      type: "agentMessage",
      text: "Response to: say hello",
    });
  });
});

describe("bench_stream steering", () => {
  it("refuses a steer when no stream is running", () => {
    const thread = startTurn("say hello");
    expect(harness.steerTurn(thread, "faster").error?.code).toBe(
      BRIDGE_JSON_RPC_ERRORS.NO_ACTIVE_TURN,
    );
  });

  it("accepts a steer into the running stream and answers it after the document completes", () => {
    const thread = startTurn(
      "bench_stream doc=incident-writeup chunk=4096 interval=30 prelude=0",
    );
    vi.advanceTimersByTime(30);
    harness.takeMessages();

    expect(
      harness.steerTurn(thread, "also list the owners").error,
    ).toBeUndefined();
    expect(freshDeltas(thread.threadId)).toMatchObject([
      [{ kind: "input.accepted" }],
    ]);

    const expected = getFixture("incident-writeup");
    vi.advanceTimersByTime(30 * Math.ceil(expected.length / 4096));
    const notifications = freshDeltas(thread.threadId);
    expect(streamedChunks(notifications).join("")).toBe(expected.slice(4096));
    expect(notifications.at(-1)).toMatchObject([
      {
        kind: "item.close",
        status: "completed",
        item: { type: "agentMessage", text: expected },
      },
      { kind: "item.open", item: { type: "agentMessage", text: "" } },
      { kind: "item.textDelta", text: "Response to: also list the owners" },
      {
        kind: "item.close",
        status: "completed",
        item: { text: "Response to: also list the owners" },
      },
      { kind: "turn.boundary", status: "completed" },
    ]);
    expect(vi.getTimerCount()).toBe(0);

    const events = harness.events();
    expect(turnStatuses(events)).toEqual(["completed"]);
    expect(
      events.filter((event) => event.type === "turn/input/accepted"),
    ).toHaveLength(2);
    expect(
      completedItems(events).map((item) =>
        item.type === "agentMessage" ? item.text : item.type,
      ),
    ).toEqual([expected, "Response to: also list the owners"]);
  });
});

describe("prompt directives", () => {
  it.each([
    ["bench_stream doc=missing chunk=24 interval=30", "doc"],
    ["bench_stream doc=long-response chunk=0 interval=30", "chunk"],
    ["bench_stream doc=long-response chunk=24 interval=30 speed=2", "speed"],
    ["bench_stream doc=long-response chunk=24", "interval"],
    ["bench_stream doc=long-response chunk=24 interval=30 repeat=0", "repeat"],
    ["bench_history seed=1 tools=7", "tools"],
    ["bench_history seed=-1 tools=2", "seed"],
    ["bench_history seed=1 seed=2 tools=2", "duplicate"],
    ["bench_noop now", "no tokens"],
  ])("settles %j as a failed turn naming %j", (prompt, problem) => {
    const { threadId } = startTurn(prompt);
    const error = freshDeltas(threadId)
      .flat()
      .find((delta) => delta.kind === "provider.error");
    expect(error).toMatchObject({
      kind: "provider.error",
      message: "Invalid bench directive",
      detail: expect.stringContaining(problem),
      settlesTurn: true,
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(turnStatuses(harness.events())).toEqual(["failed"]);
  });

  it("settles bench_noop without opening a turn or emitting items", () => {
    const { threadId } = startTurn("bench_noop");
    expect(freshDeltas(threadId)).toMatchObject([
      [
        { kind: "input.accepted" },
        { kind: "turn.boundary", status: "completed", claimIfIdle: true },
      ],
    ]);
    const events = harness.events();
    expect(turnStatuses(events)).toEqual(["completed"]);
    expect(completedItems(events)).toEqual([]);
  });

  it("answers any other prompt with a single completed message", () => {
    const prompt =
      "what is bench_stream?\nbench_stream doc=long-response chunk=24 interval=30";
    startTurn(prompt);
    const events = harness.events();
    expect(turnStatuses(events)).toEqual(["completed"]);
    expect(completedItems(events)).toMatchObject([
      { type: "agentMessage", text: `Response to: ${prompt}` },
    ]);
  });
});

describe("emission log", () => {
  let logRoot: string;

  beforeEach(() => {
    logRoot = mkdtempSync(join(tmpdir(), "bb-bench-stream-log-"));
    vi.stubEnv(BENCH_STREAM_LOG_DIR_ENV, join(logRoot, "nested"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(logRoot, { recursive: true, force: true });
  });

  it("appends start, one delta line per tick, and complete to <dir>/<threadId>.jsonl", () => {
    const startedAt = Date.now();
    const { threadId } = startTurn(
      "bench_stream doc=data-analysis chunk=3000 interval=25 prelude=0",
    );
    vi.advanceTimersByTime(100);

    const docChars = getFixture("data-analysis").length;
    const lines = readFileSync(
      join(logRoot, "nested", `${threadId}.jsonl`),
      "utf8",
    )
      .trimEnd()
      .split("\n")
      .map((line): unknown => JSON.parse(line));
    expect(lines).toEqual([
      {
        event: "start",
        t: startedAt,
        doc: "data-analysis",
        docChars,
        chunk: 3000,
        interval: 25,
      },
      { event: "delta", t: startedAt + 25, chars: 3000 },
      { event: "delta", t: startedAt + 50, chars: 6000 },
      { event: "delta", t: startedAt + 75, chars: 9000 },
      { event: "delta", t: startedAt + 100, chars: docChars },
      { event: "complete", t: startedAt + 100 },
    ]);
  });
});
