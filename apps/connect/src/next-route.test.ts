import { afterEach, describe, expect, it, vi } from "vitest";
import {
  labelBucket,
  nextRouteAllows,
  parseNextRouteFlag,
  readNextRouteFlag,
  resetNextRouteFlagCache,
} from "./next-route.js";

afterEach(() => {
  resetNextRouteFlagCache();
});

describe("parseNextRouteFlag", () => {
  it("accepts percent and labels, each defaulting to none", () => {
    expect(parseNextRouteFlag('{"percent":25,"labels":["Sawyer"]}')).toEqual({
      percent: 25,
      labels: new Set(["sawyer"]),
    });
    expect(parseNextRouteFlag('{"labels":["a"]}')?.percent).toBe(0);
    expect(parseNextRouteFlag('{"percent":5}')?.labels.size).toBe(0);
  });

  it.each([
    null,
    "",
    "on",
    "[]",
    "null",
    '{"percent":-1}',
    '{"percent":101}',
    '{"percent":"50"}',
    '{"labels":"sawyer"}',
    '{"labels":[1]}',
  ])("turns %s off", (value) => {
    expect(parseNextRouteFlag(value)).toBeNull();
  });
});

describe("nextRouteAllows", () => {
  it("always allows listed labels and buckets the rest under the percent", () => {
    const bucket = labelBucket("sawyer");
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThan(100);
    expect(nextRouteAllows(null, "sawyer")).toBe(false);
    expect(
      nextRouteAllows({ percent: 0, labels: new Set(["sawyer"]) }, "SAWYER"),
    ).toBe(true);
    expect(
      nextRouteAllows({ percent: bucket, labels: new Set() }, "sawyer"),
    ).toBe(false);
    expect(
      nextRouteAllows({ percent: bucket + 1, labels: new Set() }, "sawyer"),
    ).toBe(true);
    expect(nextRouteAllows({ percent: 100, labels: new Set() }, "x")).toBe(
      true,
    );
  });

  it("spreads labels roughly evenly across buckets", () => {
    const counts = new Array<number>(10).fill(0);
    for (let index = 0; index < 10_000; index += 1) {
      const bucket = labelBucket(`label-${index}`);
      counts[Math.floor(bucket / 10)] =
        (counts[Math.floor(bucket / 10)] ?? 0) + 1;
    }
    for (const count of counts) {
      expect(count).toBeGreaterThan(800);
      expect(count).toBeLessThan(1200);
    }
  });
});

describe("readNextRouteFlag", () => {
  it("is off without a store and caches a read for 30 seconds", async () => {
    expect(await readNextRouteFlag(undefined, 0)).toBeNull();
    const store = { get: vi.fn(async () => '{"percent":10}') };
    expect((await readNextRouteFlag(store, 1_000))?.percent).toBe(10);
    store.get.mockResolvedValue('{"percent":20}');
    expect((await readNextRouteFlag(store, 30_999))?.percent).toBe(10);
    expect((await readNextRouteFlag(store, 31_000))?.percent).toBe(20);
    expect(store.get).toHaveBeenCalledTimes(2);
  });

  it("keeps the last flag when KV fails and stays off when there was none", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = { get: vi.fn(async () => '{"percent":10}') };
    await readNextRouteFlag(store, 0);
    store.get.mockRejectedValue(new Error("kv down"));
    expect((await readNextRouteFlag(store, 40_000))?.percent).toBe(10);
    resetNextRouteFlagCache();
    expect(await readNextRouteFlag(store, 80_000)).toBeNull();
    errors.mockRestore();
  });
});
