import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeHeifAttachment } from "./heic-conversion.js";

const state = vi.hoisted(() => ({
  workers: [] as {
    emit: (event: string, value?: unknown) => boolean;
    terminate: ReturnType<typeof vi.fn>;
  }[],
  failStart: false,
}));

vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    Worker: class extends EventEmitter {
      terminate = vi.fn(async () => 0);
      constructor() {
        super();
        if (state.failStart) throw new Error("Worker could not start");
        state.workers.push(this);
      }
    },
  };
});

const heic = () => new File(["heic"], "photo.heic", { type: "image/heic" });

beforeEach(() => {
  state.workers = [];
  state.failStart = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("HEIC conversion workers", () => {
  it.each(["error", "exit", "message"])(
    "terminates a failed worker (%s) and releases the next conversion",
    async (event) => {
      const failed = normalizeHeifAttachment(heic());
      const rejected = expect(failed).rejects.toMatchObject({ status: 400 });
      const next = normalizeHeifAttachment(heic());
      await vi.waitFor(() => expect(state.workers).toHaveLength(1));
      state.workers[0]!.emit(event, null);
      await rejected;
      expect(state.workers[0]!.terminate).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(state.workers).toHaveLength(2));
      state.workers[1]!.emit("message", new Uint8Array([1, 2, 3]));
      await expect(next).resolves.toMatchObject({ name: "photo.png" });
      expect(state.workers[1]!.terminate).toHaveBeenCalledOnce();
    },
  );

  it("terminates a timed-out worker", async () => {
    vi.useFakeTimers();
    const result = normalizeHeifAttachment(heic());
    const rejected = expect(result).rejects.toMatchObject({
      status: 400,
      message: "HEIC/HEIF conversion timed out",
    });
    await vi.waitFor(() => expect(state.workers).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(state.workers[0]!.terminate).toHaveBeenCalledOnce();
  });

  it("bounds the queue and runs one conversion at a time", async () => {
    const results = Promise.allSettled(
      Array.from({ length: 5 }, () => normalizeHeifAttachment(heic())),
    );
    for (let index = 0; index < 4; index += 1) {
      await vi.waitFor(() => expect(state.workers).toHaveLength(index + 1));
      state.workers[index]!.emit("message", new Uint8Array([1]));
    }
    const settled = await results;
    expect(
      settled.slice(0, 4).every((item) => item.status === "fulfilled"),
    ).toBe(true);
    expect(settled[4]).toMatchObject({
      status: "rejected",
      reason: { status: 429, body: { retryable: true } },
    });
    for (const worker of state.workers) {
      expect(worker.terminate).toHaveBeenCalledOnce();
    }
  });

  it("releases the queue if a worker cannot start", async () => {
    state.failStart = true;
    await expect(normalizeHeifAttachment(heic())).rejects.toThrow();
    state.failStart = false;
    const next = normalizeHeifAttachment(heic());
    await vi.waitFor(() => expect(state.workers).toHaveLength(1));
    state.workers[0]!.emit("message", new Uint8Array([1]));
    await expect(next).resolves.toMatchObject({ type: "image/png" });
  });
});
