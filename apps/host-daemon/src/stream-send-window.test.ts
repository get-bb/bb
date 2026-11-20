import { describe, expect, it } from "vitest";
import { StreamSendWindow } from "./stream-send-window.js";

const CHUNK = 64 * 1024;

function runRoundTrips(args: {
  window: StreamSendWindow;
  rounds: number;
  rttMs: (inFlightBytes: number) => number;
  startMs?: number;
}): number {
  let nowMs = args.startMs ?? 0;
  let seq = 0;
  for (let round = 0; round < args.rounds; round += 1) {
    const first = seq + 1;
    while (args.window.open) {
      seq += 1;
      args.window.recordWrite(seq, CHUNK, nowMs);
    }
    nowMs += args.rttMs(args.window.bytesInFlight);
    for (let acked = first; acked <= seq; acked += 1) {
      args.window.acknowledge(acked, nowMs);
    }
  }
  return nowMs;
}

describe("StreamSendWindow", () => {
  it("grows past its starting size while round trips stay at the base delay", () => {
    const window = new StreamSendWindow();
    const initial = window.window;
    runRoundTrips({ window, rounds: 12, rttMs: () => 120 });
    expect(window.window).toBeGreaterThan(2 * initial);
  });

  it("shrinks toward the path's capacity when its own bulk builds a queue", () => {
    const window = new StreamSendWindow();
    const bandwidthBytesPerMs = 3600;
    const baseRttMs = 45;
    runRoundTrips({
      window,
      rounds: 40,
      rttMs: (inFlight) =>
        Math.max(baseRttMs, inFlight / bandwidthBytesPerMs + 5),
    });
    const queuedMs = window.window / bandwidthBytesPerMs - baseRttMs;
    expect(queuedMs).toBeLessThan(60);
    expect(window.window).toBeGreaterThanOrEqual(
      baseRttMs * bandwidthBytesPerMs * 0.8,
    );
  });

  it("backs off to a small window when round trips jump far above the base delay", () => {
    const window = new StreamSendWindow();
    const nowMs = runRoundTrips({ window, rounds: 16, rttMs: () => 10 });
    expect(window.window).toBeGreaterThan(768 * 1024);
    runRoundTrips({ window, rounds: 40, rttMs: () => 200, startMs: nowMs });
    expect(window.window).toBeLessThanOrEqual(192 * 1024);
    expect(window.window).toBeGreaterThanOrEqual(64 * 1024);
  });

  it("ignores small frames, whose round trips skip the serialization a full frame pays", () => {
    const window = new StreamSendWindow();
    const initial = window.window;
    let nowMs = 0;
    let seq = 0;
    for (let round = 0; round < 12; round += 1) {
      seq += 1;
      window.recordWrite(seq, 200, nowMs);
      window.acknowledge(seq, nowMs + 120);
      const first = seq + 1;
      while (window.open) {
        seq += 1;
        window.recordWrite(seq, CHUNK, nowMs);
      }
      nowMs += 145;
      for (let acked = first; acked <= seq; acked += 1) {
        window.acknowledge(acked, nowMs);
      }
    }
    expect(window.window).toBeGreaterThan(2 * initial);
  });

  it("forgets bytes in flight on reset so a new session can send", () => {
    const window = new StreamSendWindow();
    let seq = 0;
    while (window.open) {
      seq += 1;
      window.recordWrite(seq, CHUNK, 0);
    }
    window.reset();
    expect(window.bytesInFlight).toBe(0);
    expect(window.open).toBe(true);
  });
});
