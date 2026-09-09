import { createDeferredPromise } from "@bb/test-helpers";
import { describe, expect, it } from "vitest";
import { createLifecycleDedupers } from "../../src/lifecycle-dedupers.js";
import { createAsyncRerunner } from "../../src/services/lib/async-deduper.js";

describe("createAsyncRerunner", () => {
  it("runs the latest task requested while the key is in flight", async () => {
    const runner = createLifecycleDedupers().threadProvisionAdvance;
    const firstStarted = createDeferredPromise<void>();
    const releaseFirst = createDeferredPromise<void>();
    const calls: string[] = [];

    const first = runner.run("thread", async () => {
      calls.push("first");
      firstStarted.resolve();
      await releaseFirst.promise;
    });
    await firstStarted.promise;
    const superseded = runner.run("thread", async () => {
      calls.push("superseded");
    });
    const latest = runner.run("thread", async () => {
      calls.push("latest");
    });

    expect(calls).toEqual(["first"]);
    releaseFirst.resolve();
    await Promise.all([first, superseded, latest]);
    expect(calls).toEqual(["first", "latest"]);
  });

  it("runs a pending task after the in-flight task rejects", async () => {
    const runner = createAsyncRerunner<string>();
    const firstStarted = createDeferredPromise<void>();
    const releaseFirst = createDeferredPromise<void>();
    const calls: string[] = [];

    const first = runner.run("thread", async () => {
      calls.push("first");
      firstStarted.resolve();
      await releaseFirst.promise;
      throw new Error("first failed");
    });
    await firstStarted.promise;
    const pending = runner.run("thread", async () => {
      calls.push("pending");
    });
    releaseFirst.resolve();

    await Promise.all([
      expect(first).rejects.toThrow("first failed"),
      expect(pending).rejects.toThrow("first failed"),
    ]);
    expect(calls).toEqual(["first", "pending"]);
  });
});
