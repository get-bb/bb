import { describe, expect, it } from "vitest";

import { computeBundleWorkerCount } from "./build-bundled-dts-concurrency.mjs";

const GIBIBYTE = 1024 ** 3;

describe("computeBundleWorkerCount", () => {
  it("scales declaration bundling concurrency with system memory", () => {
    expect(computeBundleWorkerCount(15, 12, 24 * GIBIBYTE)).toBe(3);
    expect(computeBundleWorkerCount(15, 8, 16 * GIBIBYTE)).toBe(2);
  });

  it("does not exceed the available workers", () => {
    expect(computeBundleWorkerCount(15, 2, 64 * GIBIBYTE)).toBe(2);
  });
});
