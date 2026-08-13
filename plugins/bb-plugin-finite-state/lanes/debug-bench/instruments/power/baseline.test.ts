import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compareToBaseline,
  createFilePowerBaselineStore,
  storeBaseline,
  type MeasurementSummary,
  type PowerDeps,
} from "./correlate.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function deps(deviceId = "device-1"): PowerDeps {
  const directory = mkdtempSync(join(tmpdir(), "fs128-baseline-"));
  directories.push(directory);
  return { deviceId, baselines: createFilePowerBaselineStore(directory) };
}

function summary(overrides: Partial<MeasurementSummary> = {}): MeasurementSummary {
  return {
    kind: "sleep_current",
    window: { fromMs: 10, toMs: 20 },
    stats: { mean: 10, median: 10, p99: 10, unit: "uA" },
    artifactPath: "/ignored/raw.csv",
    buildDigest: "digest-1",
    marks: [{ atMs: 10, label: "manual", source: "manual" }],
    ...overrides,
  };
}

describe("power diagnostic baselines", () => {
  it("stores a named baseline and returns both summaries with a diagnostic-only delta", async () => {
    const powerDeps = deps();
    const baseline = summary();
    const current = summary({ stats: { mean: 12.5, median: 12, p99: 14, unit: "uA" } });
    await storeBaseline(powerDeps, "sleep-reference", baseline);
    await expect(compareToBaseline(powerDeps, "sleep-reference", current)).resolves.toEqual({
      baseline,
      current,
      deltaPct: 25,
      diagnostic: true,
    });
  });

  it("rejects unit mismatch without normalization", async () => {
    const powerDeps = deps();
    await storeBaseline(powerDeps, "sleep-reference", summary());
    await expect(compareToBaseline(powerDeps, "sleep-reference", summary({
      stats: { mean: 0.01, median: 0.01, p99: 0.01, unit: "mA" },
    }))).rejects.toMatchObject({ code: "UNIT_MISMATCH" });
  });

  it("refuses comparison across a different device or build", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fs128-baseline-shared-"));
    directories.push(directory);
    const store = createFilePowerBaselineStore(directory);
    const original = { deviceId: "device-1", baselines: store };
    await storeBaseline(original, "sleep-reference", summary());
    await expect(compareToBaseline(
      { deviceId: "device-2", baselines: store },
      "sleep-reference",
      summary(),
    )).rejects.toMatchObject({ code: "BASELINE_CONTEXT_MISMATCH" });
    await expect(compareToBaseline(
      original,
      "sleep-reference",
      summary({ buildDigest: "digest-2" }),
    )).rejects.toMatchObject({ code: "BASELINE_CONTEXT_MISMATCH" });
  });
});
