import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createChildChannel } from "../src/parcel-subprocess/fork-channel.js";

type SendCallback = (error: Error | null) => void;

/**
 * Minimal stand-in for a forked child, so the IPC failure paths can be driven
 * deterministically (a real EPIPE only shows up under a race).
 */
class FakeChild extends EventEmitter {
  connected = true;
  killedWith: string | null = null;
  sendCount = 0;
  send: (message: unknown, callback?: SendCallback) => boolean = () => true;

  kill(signal?: string): boolean {
    this.killedWith = signal ?? "SIGTERM";
    return true;
  }

  /** Fail every send synchronously, the way a torn-down channel does. */
  failSyncWith(error: NodeJS.ErrnoException): void {
    this.send = () => {
      this.sendCount += 1;
      throw error;
    };
  }

  /** Fail every send via the callback, the way an async write error does. */
  failAsyncWith(error: NodeJS.ErrnoException): void {
    this.send = (_message, callback) => {
      this.sendCount += 1;
      callback?.(error);
      return false;
    };
  }
}

function epipe(): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error("write EPIPE");
  error.code = "EPIPE";
  return error;
}

function setup(): {
  child: FakeChild;
  channel: ReturnType<typeof createChildChannel>;
  exits: number;
} {
  const child = new FakeChild();
  const channel = createChildChannel(child as unknown as ChildProcess);
  const state = { child, channel, exits: 0 };
  channel.onExit(() => {
    state.exits += 1;
  });
  return state;
}

describe("createChildChannel", () => {
  it("swallows a synchronous EPIPE and reports the child as exited", () => {
    // The regression: `connected` is still true while the pipe is tearing down,
    // so the proxy's ping throws. Escaping here kills the whole host daemon.
    const state = setup();
    state.child.failSyncWith(epipe());

    expect(() => state.channel.send({ kind: "ping", nonce: 1 })).not.toThrow();
    expect(state.exits).toBe(1);
    // The process may have survived its pipe: SIGKILL reclaims its inotify fds.
    expect(state.child.killedWith).toBe("SIGKILL");
  });

  it("treats an asynchronous send failure the same way", () => {
    const state = setup();
    state.child.failAsyncWith(epipe());

    expect(() => state.channel.send({ kind: "ping", nonce: 1 })).not.toThrow();
    expect(state.exits).toBe(1);
    expect(state.child.killedWith).toBe("SIGKILL");
  });

  it("handles a child 'error' event rather than leaving it unhandled", () => {
    const state = setup();

    // An unhandled 'error' on an EventEmitter is thrown — the same fatal
    // outcome the send guard exists to prevent.
    expect(() =>
      state.child.emit("error", new Error("spawn ENOENT")),
    ).not.toThrow();
    expect(state.exits).toBe(1);
  });

  it("reports exit exactly once and stops sending after a failure", () => {
    const state = setup();
    state.child.failSyncWith(epipe());

    state.channel.send({ kind: "ping", nonce: 1 });
    state.channel.send({ kind: "ping", nonce: 2 });
    // The real exit lands after the pipe broke; the proxy must not respawn twice.
    state.child.emit("exit", null, "SIGKILL");

    expect(state.exits).toBe(1);
    expect(state.child.sendCount).toBe(1);
  });

  it("delivers messages and exit normally while the child is healthy", () => {
    const state = setup();
    const received: unknown[] = [];
    state.channel.onMessage((message) => received.push(message));

    state.channel.send({ kind: "ping", nonce: 1 });
    state.child.emit("message", { kind: "pong", nonce: 1 });
    expect(received).toEqual([{ kind: "pong", nonce: 1 }]);
    expect(state.exits).toBe(0);

    state.child.emit("exit", 0, null);
    expect(state.exits).toBe(1);
  });
});
