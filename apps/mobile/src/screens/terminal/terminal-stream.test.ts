import type {
  TerminalOutputResponse,
  TerminalServerMessage,
  TerminalSession,
} from "@bb/server-contract";
import { describe, expect, it, vi } from "vitest";
import {
  createTerminalStreamController,
  selectGapFillChunks,
  TERMINAL_GAP_NOTICE,
  type TerminalStreamSink,
} from "./terminal-stream";

function session(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: "term_1",
    threadId: "thr_1",
    environmentId: "env_1",
    hostId: "host_1",
    title: "zsh",
    initialCwd: "/work",
    cols: 80,
    rows: 24,
    status: "running",
    exitCode: null,
    closeReason: null,
    createdAt: 1,
    updatedAt: 1,
    lastUserInputAt: null,
    ...overrides,
  };
}

function output(seq: number): TerminalServerMessage {
  return { type: "output", chunk: { seq, dataBase64: `c${seq}` } };
}

function attached(
  replayStartSeq: number,
  nextSeq: number,
): TerminalServerMessage {
  return { type: "attached", session: session(), replayStartSeq, nextSeq };
}

type SinkEvent =
  | ["write", string, boolean]
  | ["status", string]
  | ["reset"]
  | ["session", string];

function harness(
  options: {
    fetchOutput?:
      | ((sinceSeq: number) => Promise<TerminalOutputResponse>)
      | null;
  } = {},
) {
  const events: SinkEvent[] = [];
  const sink: TerminalStreamSink = {
    write: (data, replay) => events.push(["write", data, replay]),
    writeStatus: (text) => events.push(["status", text]),
    reset: () => events.push(["reset"]),
    onSession: (next) => events.push(["session", next.status]),
  };
  const timers: Array<() => void> = [];
  const controller = createTerminalStreamController({
    sink,
    fetchOutput: options.fetchOutput ?? null,
    fillTimeoutMs: 1000,
    setTimeout: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout: (handle) => {
      timers[(handle as number) - 1] = () => undefined;
    },
  });
  return {
    controller,
    events,
    fireTimers: () => timers.splice(0).forEach((t) => t()),
  };
}

const flushMicrotasks = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("createTerminalStreamController", () => {
  it("marks output below attached.nextSeq as replay and the rest as live", () => {
    const { controller, events } = harness();
    controller.handleMessage(attached(0, 2));
    controller.handleMessage(output(0));
    controller.handleMessage(output(1));
    controller.handleMessage(output(2));
    expect(events).toEqual([
      ["session", "running"],
      ["write", "c0", true],
      ["write", "c1", true],
      ["write", "c2", false],
    ]);
  });

  it("prints exit / error notices and forwards session updates", () => {
    const { controller, events } = harness();
    controller.handleMessage({ type: "session-updated", session: session() });
    controller.handleMessage({
      type: "error",
      code: "host_disconnected",
      message: "Host is not connected",
    });
    controller.handleMessage({
      type: "exited",
      session: session({ status: "exited", exitCode: 130 }),
    });
    expect(events).toEqual([
      ["session", "running"],
      ["status", "Terminal error: Host is not connected"],
      ["session", "exited"],
      ["status", "Terminal exited with code 130"],
    ]);
  });

  it("fills a replay gap from the output route and holds socket output until then", async () => {
    const fetchOutput = vi.fn(
      async (sinceSeq: number): Promise<TerminalOutputResponse> => ({
        chunks: [
          { seq: sinceSeq, dataBase64: "h3" },
          { seq: sinceSeq + 1, dataBase64: "h4" },
          // The route also returns what the socket will replay; ignored.
          { seq: sinceSeq + 2, dataBase64: "dup5" },
        ],
        nextSeq: sinceSeq + 3,
        truncated: false,
      }),
    );
    const { controller, events } = harness({ fetchOutput });
    // Seen 0..2, then the reconnect replays from 5.
    controller.handleMessage(attached(0, 3));
    controller.handleMessage(output(0));
    controller.handleMessage(output(1));
    controller.handleMessage(output(2));
    events.length = 0;
    controller.handleSequenceGap(3, 5);
    controller.handleMessage(attached(5, 7));
    controller.handleMessage(output(5));
    controller.handleMessage(output(6));
    controller.handleMessage(output(7));
    expect(events).toEqual([]);
    expect(fetchOutput).toHaveBeenCalledWith(3);
    await flushMicrotasks();
    expect(events).toEqual([
      ["write", "h3", true],
      ["write", "h4", true],
      ["session", "running"],
      ["write", "c5", true],
      ["write", "c6", true],
      ["write", "c7", false],
    ]);
  });

  it("falls back to reset + notice when the scrollback no longer covers the gap", async () => {
    const fetchOutput = vi.fn(
      async (): Promise<TerminalOutputResponse> => ({
        chunks: [{ seq: 4, dataBase64: "h4" }],
        nextSeq: 6,
        truncated: true,
      }),
    );
    const { controller, events } = harness({ fetchOutput });
    controller.handleSequenceGap(3, 5);
    controller.handleMessage(output(5));
    await flushMicrotasks();
    expect(events).toEqual([
      ["reset"],
      ["status", TERMINAL_GAP_NOTICE],
      ["write", "c5", false],
    ]);
  });

  it("falls back when the fill request fails or times out", async () => {
    const failing = harness({
      fetchOutput: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    failing.controller.handleSequenceGap(3, 5);
    await flushMicrotasks();
    expect(failing.events).toEqual([
      ["reset"],
      ["status", TERMINAL_GAP_NOTICE],
    ]);

    const hanging = harness({
      fetchOutput: vi.fn(() => new Promise<TerminalOutputResponse>(() => {})),
    });
    hanging.controller.handleSequenceGap(3, 5);
    hanging.controller.handleMessage(output(5));
    hanging.fireTimers();
    expect(hanging.events).toEqual([
      ["reset"],
      ["status", TERMINAL_GAP_NOTICE],
      ["write", "c5", false],
    ]);
  });

  it("keeps the web behavior without a fallback, minus the notice on a first attach", () => {
    const { controller, events } = harness({ fetchOutput: null });
    // First attach to a trimmed scrollback: nothing to lose, nothing to say.
    controller.handleSequenceGap(0, 40);
    expect(events).toEqual([]);
    controller.handleSequenceGap(41, 50);
    expect(events).toEqual([["reset"], ["status", TERMINAL_GAP_NOTICE]]);
  });

  it("does not fetch for a first attach even with a fallback", () => {
    const fetchOutput = vi.fn();
    const { controller, events } = harness({ fetchOutput });
    controller.handleSequenceGap(0, 40);
    controller.handleMessage(output(40));
    expect(fetchOutput).not.toHaveBeenCalled();
    expect(events).toEqual([["write", "c40", false]]);
  });

  it("announces a lost connection once and the reconnect, but not a host suspend", () => {
    const { controller, events } = harness();
    controller.handleConnectionState("connecting");
    controller.handleConnectionState("open");
    controller.handleConnectionState("reconnecting");
    controller.handleConnectionState("reconnecting");
    controller.handleConnectionState("open");
    expect(events).toEqual([
      ["status", "Terminal connection lost; reconnecting..."],
      ["status", "Terminal reconnected"],
    ]);
    events.length = 0;
    controller.markSuspended();
    controller.handleConnectionState("closed");
    controller.handleConnectionState("reconnecting");
    controller.handleConnectionState("open");
    expect(events).toEqual([]);
    // After the silent resume, a real drop is announced again.
    controller.handleConnectionState("reconnecting");
    expect(events).toEqual([
      ["status", "Terminal connection lost; reconnecting..."],
    ]);
  });
});

describe("selectGapFillChunks", () => {
  it("requires every chunk of the gap in order", () => {
    const response: TerminalOutputResponse = {
      chunks: [
        { seq: 4, dataBase64: "b" },
        { seq: 3, dataBase64: "a" },
        { seq: 6, dataBase64: "d" },
      ],
      nextSeq: 7,
      truncated: false,
    };
    expect(selectGapFillChunks(response, 3, 5)).toEqual(["a", "b"]);
    expect(selectGapFillChunks(response, 3, 6)).toBeNull();
    expect(selectGapFillChunks(response, 2, 4)).toBeNull();
  });
});
