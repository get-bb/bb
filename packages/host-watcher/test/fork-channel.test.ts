import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createChildChannel } from "../src/parcel-subprocess/fork-channel.js";
import type { ParentToChildMessage } from "../src/parcel-subprocess/messages.js";

type SendCallback = (error: Error | null) => void;

class FakeChild extends EventEmitter {
  stdin: ChildProcess["stdin"] = null;
  stdout: ChildProcess["stdout"] = null;
  stderr: ChildProcess["stderr"] = null;
  stdio: ChildProcess["stdio"] = [null, null, null, null, null];
  killed = false;
  connected = true;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  pid: number | undefined = undefined;
  spawnargs: string[] = [];
  spawnfile = "";
  killedWith: string | null = null;
  sendCount = 0;
  send: (message: ParentToChildMessage, callback?: SendCallback) => boolean =
    () => true;

  kill(signal?: string): boolean {
    this.killed = true;
    this.killedWith = signal ?? "SIGTERM";
    return true;
  }

  disconnect(): void {}

  unref(): void {}

  ref(): void {}

  [Symbol.dispose](): void {}

  failSyncWith(error: NodeJS.ErrnoException): void {
    this.send = () => {
      this.sendCount += 1;
      throw error;
    };
  }

  failAsyncWith(error: NodeJS.ErrnoException): void {
    this.send = (_message: ParentToChildMessage, callback?: SendCallback) => {
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

function setup() {
  const child = new FakeChild();
  // SAFETY: FakeChild implements the child process members that this channel uses.
  const channel = createChildChannel(child as ChildProcess);
  const state = { child, channel, exits: 0 };
  channel.onExit(() => {
    state.exits += 1;
  });
  return state;
}

describe("createChildChannel", () => {
  it("swallows a synchronous EPIPE and reports the child as exited", () => {
    const state = setup();
    state.child.failSyncWith(epipe());

    expect(() => state.channel.send({ kind: "ping", nonce: 1 })).not.toThrow();
    expect(state.exits).toBe(1);
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
