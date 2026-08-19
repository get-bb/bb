import { describe, expect, it, vi } from "vitest";
import { createAsyncTtlMemo } from "../../src/services/lib/async-ttl-memo.js";

describe("createAsyncTtlMemo", () => {
  it("serves a settled value until it expires, then runs the task again", async () => {
    let currentTime = 1_000;
    const memo = createAsyncTtlMemo<string, number>({
      ttlMs: 100,
      now: () => currentTime,
    });
    const task = vi.fn(async () => currentTime);

    await expect(memo.run("k", task)).resolves.toBe(1_000);
    currentTime = 1_099;
    await expect(memo.run("k", task)).resolves.toBe(1_000);
    expect(task).toHaveBeenCalledTimes(1);

    currentTime = 1_100;
    await expect(memo.run("k", task)).resolves.toBe(1_100);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight task and never stores a rejection", async () => {
    const memo = createAsyncTtlMemo<string, string>({ ttlMs: 60_000 });
    let reject: (error: Error) => void = () => {};
    const task = vi.fn(
      () =>
        new Promise<string>((_resolve, rejectTask) => {
          reject = rejectTask;
        }),
    );

    const first = memo.run("k", task);
    const second = memo.run("k", task);
    expect(task).toHaveBeenCalledTimes(1);
    reject(new Error("probe failed"));
    await expect(first).rejects.toThrow("probe failed");
    await expect(second).rejects.toThrow("probe failed");

    const recovered = vi.fn(async () => "ok");
    await expect(memo.run("k", recovered)).resolves.toBe("ok");
    expect(recovered).toHaveBeenCalledTimes(1);
  });

  it("keys entries independently and clears them on demand", async () => {
    const memo = createAsyncTtlMemo<string, string>({ ttlMs: 60_000 });
    await expect(memo.run("a", async () => "A")).resolves.toBe("A");
    await expect(memo.run("b", async () => "B")).resolves.toBe("B");
    await expect(memo.run("a", async () => "A2")).resolves.toBe("A");
    memo.clear();
    await expect(memo.run("a", async () => "A2")).resolves.toBe("A2");
  });
});
