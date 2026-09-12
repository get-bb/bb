import { describe, expect, it } from "vitest";
import { createDeferredPromise } from "@bb/test-helpers";
import { runInSerialLane } from "./serial-lane.js";

describe("runInSerialLane", () => {
  it("runs same-key work in order, continues after a rejection, and releases the key", async () => {
    const lanes = new Map<string, Promise<void>>();
    const releaseFirst = createDeferredPromise<void>();
    const order: string[] = [];

    const first = runInSerialLane(lanes, "key", async () => {
      order.push("first-start");
      await releaseFirst.promise;
      order.push("first-end");
      throw new Error("first failed");
    });
    const second = runInSerialLane(lanes, "key", () => {
      order.push("second");
      return "second-result";
    });
    const otherKey = runInSerialLane(lanes, "other", () => {
      order.push("other");
    });

    await otherKey;
    expect(order).toEqual(["first-start", "other"]);

    releaseFirst.resolve();
    await expect(first).rejects.toThrow("first failed");
    await expect(second).resolves.toBe("second-result");
    expect(order).toEqual(["first-start", "other", "first-end", "second"]);

    await Promise.all(lanes.values());
    expect(lanes.size).toBe(0);
  });
});
