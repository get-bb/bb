import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BRIDGE_JSON_RPC_ERRORS,
  type ThreadDelta,
} from "@get-bb/plugin-sdk/provider-bridge";
import type { ThreadEvent } from "@get-bb/plugin-sdk/provider-bridge/testing";
import {
  createBenchBridgeHarness,
  deltaNotifications,
  type BenchBridgeHarness,
} from "./bridge-harness.js";
import { getFixture, streamDocumentText } from "./src/fixtures/index.js";
import { nextChunkEnd } from "./src/provider-bridge.js";
import { BENCH_STREAM_LOG_DIR_ENV } from "./src/vocabulary.js";

const CWD = "/workspace/bench";

let harness: BenchBridgeHarness;
let threadCounter = 0;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-02T03:04:05.000Z"));
  harness = createBenchBridgeHarness();
  harness.initialize();
});

afterEach(() => {
  harness.restore();
  vi.useRealTimers();
});

function startThread(): { threadId: string; providerThreadId: string } {
  threadCounter += 1;
  const threadId = `thr_bench_stream_${threadCounter}`;
  const providerThreadId = harness.startThread(threadId, CWD);
  harness.takeMessages();
  return { threadId, providerThreadId };
}

function freshDeltas(threadId: string): ThreadDelta[][] {
  return deltaNotifications(harness.takeMessages(), threadId).map(
    (notification) => notification.deltas,
  );
}

function agentTextDelta(delta: ThreadDelta | undefined): string {
  if (delta?.kind !== "item.textDelta" || delta.channel !== "agentMessage") {
    throw new Error(
      `expected an agentMessage textDelta, got ${JSON.stringify(delta)}`,
    );
  }
  return delta.text;
}

function completedItems(events: readonly ThreadEvent[]) {
  return events.flatMap((event) =>
    event.type === "item/completed" ? [event.item] : [],
  );
}

function turnStatuses(events: readonly ThreadEvent[]): string[] {
  return events.flatMap((event) =>
    event.type === "turn/completed" ? [event.status] : [],
  );
}

describe("bench_stream pacing", () => {
  it("emits one textDelta notification per interval whose chunks concatenate to the item.close text", () => {
    const { threadId, providerThreadId } = startThread();
    harness.startTurn({
      threadId,
      providerThreadId,
      text: "bench_stream doc=incident-writeup chunk=500 interval=40",
    });

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

    const events = harness.assemble(harness.allMessages());
    expect(turnStatuses(events)).toEqual(["completed"]);
    expect(completedItems(events).at(-1)).toMatchObject({
      type: "agentMessage",
      text: expected,
    });
  });

  it("repeats the document with blank lines and lets the last chunk run short", () => {
    const { threadId, providerThreadId } = startThread();
    harness.startTurn({
      threadId,
      providerThreadId,
      text: "bench_stream doc=pathological chunk=4096 interval=10 repeat=2 prelude=0",
    });
    expect(
      freshDeltas(threadId)
        .flat()
        .map((delta) => delta.kind),
    ).toEqual(["input.accepted", "turn.open", "item.open"]);

    const expected = streamDocumentText("pathological", 2);
    expect(expected).toBe(
      `${getFixture("pathological")}\n\n${getFixture("pathological")}`,
    );
    vi.advanceTimersByTime(10 * Math.ceil(expected.length / 4096));
    const notifications = freshDeltas(threadId);
    const chunks = notifications
      .filter((deltas) => deltas[0]?.kind === "item.textDelta")
      .map((deltas) => agentTextDelta(deltas[0]));
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

  it("never splits a surrogate pair across chunks", () => {
    const text = "ab\u{1F600}cd";
    expect(nextChunkEnd(text, 0, 2)).toBe(2);
    expect(nextChunkEnd(text, 0, 3)).toBe(4);
    expect(nextChunkEnd(text, 4, 10)).toBe(text.length);
  });
});

describe("bench_stream cancellation", () => {
  it("settles an interrupted stream before answering thread/stop and emits nothing afterwards", () => {
    const { threadId, providerThreadId } = startThread();
    harness.startTurn({
      threadId,
      providerThreadId,
      text: "bench_stream doc=long-response chunk=24 interval=30 prelude=0",
    });
    vi.advanceTimersByTime(90);
    const streamed = freshDeltas(threadId).slice(1);
    expect(streamed).toHaveLength(3);

    harness.stopThread({ threadId, providerThreadId, intent: "interrupt" });
    const stopMessages = harness.takeMessages();
    const responseIndex = stopMessages.findIndex(
      (message) => message.id !== undefined,
    );
    const settling = deltaNotifications(
      stopMessages.slice(0, responseIndex),
      threadId,
    );
    expect(settling.map((notification) => notification.deltas)).toMatchObject([
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
    ]);
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(60_000);
    expect(harness.takeMessages()).toEqual([]);
    expect(turnStatuses(harness.assemble(harness.allMessages()))).toEqual([
      "interrupted",
    ]);
  });

  it("cancels pacing on a release stop without fabricating an interruption", () => {
    const { threadId, providerThreadId } = startThread();
    harness.startTurn({
      threadId,
      providerThreadId,
      text: "bench_stream doc=long-response chunk=24 interval=30 prelude=0",
    });
    vi.advanceTimersByTime(30);
    harness.takeMessages();

    harness.stopThread({ threadId, providerThreadId, intent: "release" });
    expect(freshDeltas(threadId)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(harness.takeMessages()).toEqual([]);
  });

  it("settles a running stream as interrupted before the next turn starts", () => {
    const { threadId, providerThreadId } = startThread();
    harness.startTurn({
      threadId,
      providerThreadId,
      text: "bench_stream doc=long-response chunk=24 interval=30 prelude=0",
    });
    vi.advanceTimersByTime(60);
    harness.startTurn({ threadId, providerThreadId, text: "say hello" });
    expect(vi.getTimerCount()).toBe(0);

    const events = harness.assemble(harness.allMessages());
    expect(turnStatuses(events)).toEqual(["interrupted", "completed"]);
    expect(completedItems(events).at(-1)).toMatchObject({
      type: "agentMessage",
      text: "Response to: say hello",
    });
  });

  it("settles a running stream as interrupted before a resume resets the session", () => {
    const { threadId, providerThreadId } = startThread();
    harness.startTurn({
      threadId,
      providerThreadId,
      text: "bench_stream doc=long-response chunk=24 interval=30 prelude=0",
    });
    vi.advanceTimersByTime(60);
    harness.takeMessages();

    harness.resumeThread({ threadId, providerThreadId, cwd: CWD });
    const resumeMessages = harness.takeMessages();
    const responseIndex = resumeMessages.findIndex(
      (message) => message.id !== undefined,
    );
    expect(
      deltaNotifications(resumeMessages.slice(0, responseIndex), threadId).map(
        (notification) => notification.deltas,
      ),
    ).toMatchObject([
      [
        {
          kind: "item.close",
          status: "interrupted",
          item: {
            type: "agentMessage",
            text: getFixture("long-response").slice(0, 48),
          },
        },
        { kind: "turn.boundary", status: "interrupted" },
      ],
      [{ kind: "session.reset" }],
    ]);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(harness.takeMessages()).toEqual([]);
    expect(turnStatuses(harness.assemble(harness.allMessages()))).toEqual([
      "interrupted",
    ]);
  });
});

describe("bench_stream steering", () => {
  it("refuses a steer when no stream is running", () => {
    const { threadId, providerThreadId } = startThread();
    harness.startTurn({ threadId, providerThreadId, text: "say hello" });
    const idle = harness.steerTurn({
      threadId,
      providerThreadId,
      text: "faster",
    });
    expect(idle.error?.code).toBe(BRIDGE_JSON_RPC_ERRORS.NO_ACTIVE_TURN);
  });

  it("accepts a steer into the running stream and answers it after the document completes", () => {
    const { threadId, providerThreadId } = startThread();
    harness.startTurn({
      threadId,
      providerThreadId,
      text: "bench_stream doc=incident-writeup chunk=4096 interval=30 prelude=0",
    });
    vi.advanceTimersByTime(30);
    harness.takeMessages();

    const steer = harness.steerTurn({
      threadId,
      providerThreadId,
      text: "also list the owners",
    });
    expect(steer.error).toBeUndefined();
    expect(freshDeltas(threadId)).toMatchObject([[{ kind: "input.accepted" }]]);

    const expected = getFixture("incident-writeup");
    vi.advanceTimersByTime(30 * Math.ceil(expected.length / 4096));
    const notifications = freshDeltas(threadId);
    const chunks = notifications
      .filter((deltas) => deltas[0]?.kind === "item.textDelta")
      .map((deltas) => agentTextDelta(deltas[0]));
    expect(chunks.join("")).toBe(expected.slice(4096));
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

    const events = harness.assemble(harness.allMessages());
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

  it("drops queued steers when the stream is interrupted", () => {
    const { threadId, providerThreadId } = startThread();
    harness.startTurn({
      threadId,
      providerThreadId,
      text: "bench_stream doc=long-response chunk=24 interval=30 prelude=0",
    });
    harness.steerTurn({ threadId, providerThreadId, text: "faster" });
    harness.takeMessages();
    harness.stopThread({ threadId, providerThreadId, intent: "interrupt" });
    expect(freshDeltas(threadId)).toMatchObject([
      [
        { kind: "item.close", status: "interrupted" },
        { kind: "turn.boundary", status: "interrupted" },
      ],
    ]);
  });
});

describe("prompt directives", () => {
  it.each([
    ["bench_stream doc=missing chunk=24 interval=30", "doc"],
    ["bench_stream doc=long-response chunk=0 interval=30", "chunk"],
    ["bench_stream doc=long-response chunk=24 interval=30 speed=2", "speed"],
    ["bench_stream doc=long-response chunk=24", "interval"],
    ["bench_history seed=1 tools=7", "tools"],
    ["bench_history seed=-1 tools=2", "seed"],
    ["bench_history seed=1 seed=2 tools=2", "duplicate"],
    ["bench_noop now", "no tokens"],
  ])("settles %j as a failed turn naming %j", (prompt, problem) => {
    const { threadId, providerThreadId } = startThread();
    harness.startTurn({ threadId, providerThreadId, text: prompt });
    const deltas = freshDeltas(threadId).flat();
    const error = deltas.find((delta) => delta.kind === "provider.error");
    expect(error).toMatchObject({
      kind: "provider.error",
      message: "Invalid bench directive",
      settlesTurn: true,
    });
    expect(error?.kind === "provider.error" ? error.detail : "").toContain(
      problem,
    );
    expect(vi.getTimerCount()).toBe(0);
    expect(turnStatuses(harness.assemble(harness.allMessages()))).toEqual([
      "failed",
    ]);
  });

  it("settles bench_noop without opening a turn or emitting items", () => {
    const { threadId, providerThreadId } = startThread();
    harness.startTurn({ threadId, providerThreadId, text: "bench_noop" });
    expect(freshDeltas(threadId)).toMatchObject([
      [
        { kind: "input.accepted" },
        { kind: "turn.boundary", status: "completed", claimIfIdle: true },
      ],
    ]);
    const events = harness.assemble(harness.allMessages());
    expect(turnStatuses(events)).toEqual(["completed"]);
    expect(completedItems(events)).toEqual([]);
  });

  it("answers any other prompt with a single completed message", () => {
    const { threadId, providerThreadId } = startThread();
    harness.startTurn({
      threadId,
      providerThreadId,
      text: "what is bench_stream?\nbench_stream doc=long-response chunk=24 interval=30",
    });
    const events = harness.assemble(harness.allMessages());
    expect(turnStatuses(events)).toEqual(["completed"]);
    expect(completedItems(events)).toMatchObject([
      {
        type: "agentMessage",
        text: "Response to: what is bench_stream?\nbench_stream doc=long-response chunk=24 interval=30",
      },
    ]);
  });
});

describe("emission log", () => {
  let logRoot: string;
  let savedLogDir: string | undefined;

  beforeEach(() => {
    logRoot = mkdtempSync(join(tmpdir(), "bb-bench-stream-log-"));
    savedLogDir = process.env[BENCH_STREAM_LOG_DIR_ENV];
    process.env[BENCH_STREAM_LOG_DIR_ENV] = join(logRoot, "nested");
  });

  afterEach(() => {
    if (savedLogDir === undefined) {
      delete process.env[BENCH_STREAM_LOG_DIR_ENV];
    } else {
      process.env[BENCH_STREAM_LOG_DIR_ENV] = savedLogDir;
    }
    rmSync(logRoot, { recursive: true, force: true });
  });

  it("appends start, one delta line per tick, and complete to <dir>/<threadId>.jsonl", () => {
    const { threadId, providerThreadId } = startThread();
    const startedAt = Date.now();
    harness.startTurn({
      threadId,
      providerThreadId,
      text: "bench_stream doc=data-analysis chunk=3000 interval=25 prelude=0",
    });
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
