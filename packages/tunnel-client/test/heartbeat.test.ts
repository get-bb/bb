import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket as NodeWebSocket } from "ws";
import { HEARTBEAT_REQUEST, HEARTBEAT_RESPONSE } from "@bb/tunnel-contract";
import { TunnelSession } from "../src/session.js";

class FakeTunnel extends EventEmitter {
  readonly readyState = 1;
  readonly sent: unknown[] = [];
  readonly terminate = vi.fn(() => {
    this.emit("close");
  });

  send(data: unknown): void {
    this.sent.push(data);
  }

  heartbeatsSent(): number {
    return this.sent.filter((data) => data === HEARTBEAT_REQUEST).length;
  }

  answerHeartbeat(): void {
    this.emit("message", Buffer.from(HEARTBEAT_RESPONSE), false);
  }
}

function startSession() {
  const tunnel = new FakeTunnel();
  const warnings: string[] = [];
  let monotonicMs = 0;
  const session = new TunnelSession({
    tunnel: tunnel as unknown as NodeWebSocket,
    log: { warn: (message) => warnings.push(message) },
    resolveOrigin: () => ({ kind: "unregistered" }),
    monotonicNow: () => monotonicMs,
  });
  session.start();
  const tick = (ms = 20_000) => {
    monotonicMs += ms;
    vi.advanceTimersByTime(ms);
  };
  const stallEventLoop = (ms: number) => {
    monotonicMs += ms;
    vi.setSystemTime(Date.now() + ms);
  };
  const sleepMachine = (ms: number) => {
    vi.setSystemTime(Date.now() + ms);
  };
  return { tunnel, session, warnings, tick, stallEventLoop, sleepMachine };
}

describe("tunnel heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a tunnel whose heartbeats are answered", () => {
    const { tunnel, session, tick } = startSession();
    for (let beat = 0; beat < 10; beat += 1) {
      tick();
      tunnel.answerHeartbeat();
    }
    expect(tunnel.terminate).not.toHaveBeenCalled();
    session.dispose();
  });

  it("terminates a tunnel whose heartbeats go unanswered for a minute", () => {
    const { tunnel, session, warnings, tick } = startSession();
    for (let beat = 0; beat < 4; beat += 1) tick();
    expect(tunnel.terminate).toHaveBeenCalledTimes(1);
    expect(warnings).toContain("tunnel heartbeat missed; reconnecting");
    session.dispose();
  });

  it("does not terminate a healthy tunnel after the event loop stalls past the deadline", () => {
    const { tunnel, session, warnings, tick, stallEventLoop } = startSession();
    tick();
    tunnel.answerHeartbeat();

    stallEventLoop(90_000);
    tick();

    expect(tunnel.terminate).not.toHaveBeenCalled();
    expect(tunnel.heartbeatsSent()).toBe(2);
    expect(warnings.some((message) => message.includes("stalled"))).toBe(true);
    tunnel.answerHeartbeat();
    tick();
    tick();
    expect(tunnel.terminate).not.toHaveBeenCalled();
    session.dispose();
  });

  it("still terminates a dead tunnel once the deadline after a stall passes", () => {
    const { tunnel, session, tick, stallEventLoop } = startSession();
    stallEventLoop(90_000);
    tick();
    expect(tunnel.terminate).not.toHaveBeenCalled();

    for (let beat = 0; beat < 4; beat += 1) tick();
    expect(tunnel.terminate).toHaveBeenCalledTimes(1);
    session.dispose();
  });

  it("terminates a dead tunnel at the first beat after the machine wakes from sleep", () => {
    const { tunnel, session, warnings, tick, sleepMachine } = startSession();
    tick();
    tunnel.answerHeartbeat();

    sleepMachine(10 * 60_000);
    tick();

    expect(tunnel.terminate).toHaveBeenCalledTimes(1);
    expect(warnings.some((message) => message.includes("stalled"))).toBe(false);
    session.dispose();
  });

  it("still terminates a dead tunnel when every beat runs late", () => {
    const { tunnel, session, tick, stallEventLoop } = startSession();
    for (let beat = 0; beat < 6; beat += 1) {
      stallEventLoop(6_000);
      tick();
    }
    expect(tunnel.terminate).toHaveBeenCalledTimes(1);
    session.dispose();
  });
});
