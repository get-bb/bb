import { Writable } from "node:stream";
import {
  setImmediate as tick,
  setTimeout as delay,
} from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { createJsonLineWriter } from "./json-line-writer.js";

class ControlledWritable extends Writable {
  readonly chunks: Buffer[] = [];
  readonly callbacks: ((error?: Error | null) => void)[] = [];

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk);
    this.callbacks.push(callback);
  }

  complete(error?: Error): void {
    const callback = this.callbacks.shift();
    if (!callback) throw new Error("No pending write");
    callback(error);
  }
}

class DrainingWritable extends ControlledWritable {
  override write(
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean {
    if (typeof encodingOrCallback === "function")
      super.write(chunk, encodingOrCallback);
    else super.write(chunk, encodingOrCallback ?? "utf8", callback);
    return false;
  }
}

describe("JSON line writer", () => {
  it("waits for both drain and completion in either order", async () => {
    const stream = new DrainingWritable({ highWaterMark: 1024 * 1024 });
    const writer = createJsonLineWriter({ stream, onError: () => undefined });
    writer.write("x".repeat(3 * 64 * 1024));
    stream.complete();
    await tick();
    expect(stream.chunks).toHaveLength(1);
    stream.emit("drain");
    expect(stream.chunks).toHaveLength(2);
    stream.emit("drain");
    expect(stream.chunks).toHaveLength(2);
    stream.complete();
    await tick();
    expect(stream.chunks).toHaveLength(3);
    stream.complete();
    await tick();
    let flushed = false;
    const flush = writer.flush().then(() => {
      flushed = true;
    });
    await tick();
    expect(flushed).toBe(false);
    stream.emit("drain");
    await flush;
  });

  it("preserves large Unicode records and FIFO order with one bounded write pending", async () => {
    const stream = new ControlledWritable({ highWaterMark: 64 * 1024 });
    const errors: Error[] = [];
    const pressure: boolean[] = [];
    const writer = createJsonLineWriter({
      stream,
      onError: (error) => errors.push(error),
      onPressureChange: (paused) => pressure.push(paused),
    });
    const lines = [
      JSON.stringify({ id: 1, value: "x".repeat(9_418_764) + "🌈漢字" }) + "\n",
      JSON.stringify({ id: 2, value: "y".repeat(11_102_429) + "🦉é" }) + "\n",
      JSON.stringify({ id: 3, value: "done" }) + "\n",
    ];
    for (const line of lines) writer.write(line);
    const flushed = writer.flush();
    await delay(20);
    expect(stream.chunks).toHaveLength(1);
    expect(stream.writableLength).toBe(64 * 1024);
    expect(pressure).toEqual([true]);
    while (stream.callbacks.length > 0) {
      expect(stream.callbacks).toHaveLength(1);
      stream.complete();
      await tick();
    }
    await flushed;
    expect(Math.max(...stream.chunks.map((chunk) => chunk.length))).toBe(
      64 * 1024,
    );
    expect(Buffer.concat(stream.chunks).toString("utf8")).toBe(lines.join(""));
    expect(pressure).toEqual([true, false]);
    expect(errors).toEqual([]);
  });

  it("waits for callbacks even when write accepts more data", async () => {
    const stream = new ControlledWritable({ highWaterMark: 1024 * 1024 });
    const writer = createJsonLineWriter({ stream, onError: () => undefined });
    writer.write("x".repeat(128 * 1024));
    await tick();
    expect(stream.chunks).toHaveLength(1);
    stream.complete();
    await tick();
    expect(stream.chunks).toHaveLength(2);
    stream.complete();
    await writer.flush();
  });

  it("counts the retained full record until its last chunk completes", async () => {
    const stream = new ControlledWritable();
    const errors: Error[] = [];
    const writer = createJsonLineWriter({
      stream,
      maxQueuedBytes: 128 * 1024,
      onError: (error) => errors.push(error),
    });
    writer.write("x".repeat(96 * 1024));
    stream.complete();
    await tick();
    const flushed = writer.flush();
    writer.write("y".repeat(40 * 1024));
    await expect(flushed).rejects.toThrow("queue exceeded");
    expect(errors).toHaveLength(1);
    stream.complete();
    stream.emit("error", new Error("late error"));
    writer.write("ignored\n");
    await expect(writer.flush()).rejects.toBe(errors[0]);
    expect(stream.chunks).toHaveLength(2);
    expect(errors).toHaveLength(1);
  });

  it.each(["callback", "throw", "close"])(
    "settles %s failures once and handles late errors",
    async (mode) => {
      const failure = Object.assign(new Error("no buffer space"), {
        code: "ENOBUFS",
      });
      const errors: Error[] = [];
      const stream = new Writable({
        write(_chunk, _encoding, callback) {
          if (mode === "throw") throw failure;
          if (mode === "callback") callback(failure);
        },
      });
      const writer = createJsonLineWriter({
        stream,
        onError: (error) => errors.push(error),
      });
      writer.write("record\n");
      const flushed = writer.flush();
      if (mode === "close") stream.destroy();
      await expect(flushed).rejects.toThrow(
        mode === "close" ? "closed" : "no buffer space",
      );
      stream.emit("error", failure);
      expect(errors).toHaveLength(1);
      await expect(writer.flush()).rejects.toBe(errors[0]);
    },
  );

  it("fails a stalled write without allowing new records to renew the deadline", async () => {
    const stream = new ControlledWritable();
    const errors: Error[] = [];
    const writer = createJsonLineWriter({
      stream,
      stallTimeoutMs: 30,
      onError: (error) => errors.push(error),
    });
    writer.write("first\n");
    const failed = expect(writer.flush()).rejects.toThrow("stalled");
    await delay(20);
    writer.write("second\n");
    await delay(20);
    await failed;
    expect(errors).toHaveLength(1);
    stream.complete();
    await tick();
    expect(stream.chunks).toHaveLength(1);
  });

  it("allows slow consumers while writes keep completing", async () => {
    const stream = new ControlledWritable();
    const errors: Error[] = [];
    const writer = createJsonLineWriter({
      stream,
      stallTimeoutMs: 100,
      onError: (error) => errors.push(error),
    });
    writer.write("x".repeat(4 * 64 * 1024));
    while (stream.callbacks.length > 0) {
      await delay(40);
      stream.complete();
      await tick();
    }
    await writer.flush();
    expect(errors).toEqual([]);
  });
});
