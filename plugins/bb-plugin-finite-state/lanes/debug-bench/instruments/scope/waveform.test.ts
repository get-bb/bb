import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../../../../lib/store/schema.js";
import { finishProbeRun } from "../../probes/runs.js";
import type { DeviceClaim } from "../../registry/claims.js";
import type { CaptureArtifact, CaptureArtifactSink } from "../driver.js";
import {
  createReplayScopeDriver,
  createScopeProbeRunArtifactSink,
  downsampleForPreview,
  measureWaveform,
  scopeDrivers,
  type ScopeCapture,
} from "./waveform.js";

const directories: string[] = [];
const databases: Database.Database[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function directory(): string {
  const value = mkdtempSync(join(tmpdir(), "fs129-scope-"));
  directories.push(value);
  return value;
}

function worktreeDirectory(): string {
  const value = directory();
  execFileSync("git", ["init", "--quiet", value]);
  writeFileSync(join(value, ".gitignore"), ".fs-bench/\n", "utf8");
  return value;
}

function fixturePath(): string {
  return fileURLToPath(
    new URL("./fixtures/analog-integrity.json", import.meta.url),
  );
}

function claim(): DeviceClaim {
  return {
    deviceId: "scope-replay",
    holder: "thread-1",
    scope: "machine",
    expiresAt: "2026-08-14T12:15:00.000Z",
  };
}

function sink(path = directory()): CaptureArtifactSink {
  return { directory: path, record: vi.fn(async () => undefined) };
}

function isScopeCapture(artifact: CaptureArtifact): artifact is ScopeCapture {
  return (
    typeof Reflect.get(artifact, "sampleRateHz") === "number" &&
    typeof Reflect.get(artifact, "samples") === "number" &&
    Array.isArray(Reflect.get(artifact, "channelConfigs")) &&
    (Reflect.get(artifact, "trigger") === null ||
      typeof Reflect.get(artifact, "trigger") === "object")
  );
}

async function replayCapture(artifactSink = sink()): Promise<ScopeCapture> {
  const driver = createReplayScopeDriver({
    fixturePath: fixturePath(),
    verifyClaim: vi.fn(),
  });
  const session = await driver.open(
    { kind: "usb", serial: "REPLAY", path: null },
    claim(),
    new AbortController().signal,
  );
  const artifact = await session.capture(
    {
      durationMs: 40,
      sampleRateHz: 1_000,
      channels: [0, 1],
      artifactSink,
    },
    new AbortController().signal,
  );
  if (!isScopeCapture(artifact)) {
    throw new Error("replay driver did not return scope metadata");
  }
  const capture: ScopeCapture = artifact;
  await session.close();
  return capture;
}

describe("scope waveform analysis", () => {
  it("exports the vendor-independent scope driver order", () => {
    expect(scopeDrivers.map((driver) => driver.id)).toEqual([
      "picoscope-ps2000a",
      "scpi-lan-scope",
      "replay-scope-fixture",
    ]);
  });

  it("keeps every exported production driver claim-safe until the registry wires it", async () => {
    const transports = [
      { kind: "usb", serial: "PICO", path: null },
      { kind: "lan", host: "scope.local", port: 5_025 },
      { kind: "usb", serial: "REPLAY", path: null },
    ] as const;
    for (let index = 0; index < scopeDrivers.length; index += 1) {
      await expect(
        scopeDrivers[index]!.open(
          transports[index]!,
          claim(),
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: "CLAIM_VERIFIER_NOT_CONFIGURED" });
    }
  });

  it("runs the replay session, writes the full-resolution artifact, and measures a golden edge", async () => {
    const artifactSink = sink();
    const capture = await replayCapture(artifactSink);
    expect(JSON.parse(readFileSync(capture.path, "utf8"))).toMatchObject({
      schema: "finite-state-scope-v1",
      sampleRateHz: 1_000,
      channels: { A: expect.any(Array), B: expect.any(Array) },
    });
    expect(artifactSink.record).toHaveBeenCalledWith(capture);
    const measured = await measureWaveform(capture, {
      channels: ["A"],
      kinds: ["rise_time", "overshoot", "undershoot", "stats"],
      thresholds: { lowPct: 10, highPct: 90 },
    });
    expect(measured[0]).toMatchObject({
      kind: "rise_time",
      value: 8_000,
      unit: "us",
    });
    expect(measured[1]).toMatchObject({
      kind: "overshoot",
      value: expect.closeTo(10, 8),
      unit: "pct",
    });
    expect(measured[2]).toMatchObject({
      kind: "undershoot",
      value: 0,
      unit: "pct",
    });
    expect(measured.filter((item) => item.kind === "stats")).toHaveLength(4);
    expect(measured.every((item) => item.artifactPath === capture.path)).toBe(
      true,
    );
  });

  it("computes bounded ripple and event-mark-correlated rail droop", async () => {
    const capture = await replayCapture();
    const ripple = await measureWaveform(capture, {
      channels: ["B"],
      kinds: ["vpp_ripple"],
      window: { fromMs: 0, toMs: 19 },
    });
    expect(ripple[0]).toMatchObject({
      kind: "vpp_ripple",
      value: expect.closeTo(2, 8),
      unit: "mV",
    });
    const droop = await measureWaveform(capture, {
      channels: ["B"],
      kinds: ["rail_droop"],
      marks: [
        { atMs: 0, label: "baseline_start", source: "manual" },
        { atMs: 19, label: "baseline_end", source: "serial" },
        { atMs: 20, label: "load_on", source: "gdb" },
        { atMs: 29, label: "load_off", source: "serial" },
      ],
      baselineMarks: { from: "baseline_start", to: "baseline_end" },
      loadedMarks: { from: "load_on", to: "load_off" },
    });
    expect(droop[0]).toMatchObject({
      kind: "rail_droop",
      value: expect.closeTo(100, 8),
      unit: "mV",
      window: { fromMs: 20, toMs: 29 },
    });
  });

  it("rejects degenerate thresholds and an edge that does not occur", async () => {
    const capture = await replayCapture();
    await expect(
      measureWaveform(capture, {
        channels: ["A"],
        kinds: ["rise_time"],
        thresholds: { lowPct: 90, highPct: 10 },
      }),
    ).rejects.toMatchObject({ code: "CAPTURE_CONFIG_INVALID" });
    await expect(
      measureWaveform(capture, {
        channels: ["A"],
        kinds: ["fall_time"],
        window: { fromMs: 20, toMs: 39 },
      }),
    ).rejects.toMatchObject({ code: "CAPTURE_CONFIG_INVALID" });
  });

  it("measures the configured fall thresholds on a synthetic golden waveform", async () => {
    const path = join(directory(), "falling.json");
    writeFileSync(
      path,
      JSON.stringify({
        schema: "finite-state-scope-v1",
        sampleRateHz: 1_000_000_000,
        channels: {
          A: [
            1, 1, 1, 1, 1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0, 0, 0,
            0, 0, 0,
          ],
        },
      }),
      "utf8",
    );
    const capture: ScopeCapture = {
      path,
      format: "finite-state-scope-json-v1",
      durationMs: 0.02,
      channels: 1,
      channelConfigs: [
        { channel: "A", rangeV: 2, coupling: "dc", attenuation: 1 },
      ],
      trigger: null,
      sampleRateHz: 1_000_000_000,
      samples: 20,
    };
    const result = await measureWaveform(capture, {
      channels: ["A"],
      kinds: ["fall_time"],
      thresholds: { lowPct: 20, highPct: 80 },
    });
    expect(result[0]).toMatchObject({
      kind: "fall_time",
      value: 6,
      unit: "ns",
    });
  });

  it("downsamples with a min/max envelope so narrow extremes survive", async () => {
    const capture = await replayCapture();
    const preview = await downsampleForPreview(capture, 4);
    expect(preview).toMatchObject({ total: 4, cursor: null });
    expect(preview.items).toHaveLength(4);
    expect(
      preview.items
        .filter((item) => item.channel === "A")
        .some((item) => item.maxV === 1.1),
    ).toBe(true);
    expect(
      preview.items
        .filter((item) => item.channel === "B")
        .some((item) => item.minV === 3.199),
    ).toBe(true);
    expect(Object.keys(preview)).not.toContain("channels");
  });

  it("refuses a preview bound that would silently omit a channel", async () => {
    const capture = await replayCapture();
    await expect(downsampleForPreview(capture, 1)).rejects.toMatchObject({
      code: "CAPTURE_CONFIG_INVALID",
    });
  });

  it("rejects malformed full-resolution artifacts without returning partial data", async () => {
    const path = join(directory(), "malformed.json");
    writeFileSync(
      path,
      JSON.stringify({
        schema: "finite-state-scope-v1",
        sampleRateHz: 1_000,
        channels: { A: [0, 1], B: [0] },
      }),
      "utf8",
    );
    const capture: ScopeCapture = {
      path,
      format: "finite-state-scope-json-v1",
      durationMs: 2,
      channels: 2,
      channelConfigs: [],
      trigger: null,
      sampleRateHz: 1_000,
      samples: 2,
    };
    await expect(downsampleForPreview(capture, 10)).rejects.toMatchObject({
      code: "INSTRUMENT_PROTOCOL_ERROR",
    });
  });

  it("attaches only the waveform path to a diagnostic probe_run and emits a refetch hint", async () => {
    const db = new Database(":memory:");
    databases.push(db);
    db.transaction(() => {
      for (const statement of MIGRATIONS) db.exec(statement);
    })();
    db.prepare(
      `INSERT INTO probe_run (
        project_id, project_version_id, run_id, script_path, devices,
        hypothesis, outcome, artifacts, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL)`,
    ).run(
      "project-1",
      "version-1",
      "run-scope-1",
      ".fs/bench/probes/scope.py",
      "[]",
      "rail droops under load",
      "2026-08-14T12:00:00.000Z",
    );
    const publishChanged = vi.fn();
    const artifactSink = await createScopeProbeRunArtifactSink({
      db,
      worktreeRoot: worktreeDirectory(),
      projectId: "project-1",
      projectVersionId: "version-1",
      runId: "run-scope-1",
      publishChanged,
    });
    const capture = await replayCapture(artifactSink);
    const finished = finishProbeRun(
      db,
      { projectId: "project-1", projectVersionId: "version-1" },
      "run-scope-1",
      "confirmed",
      [".fs-bench/probe-runs/run-scope-1/runtime.csv"],
      "2026-08-14T12:01:00.000Z",
    );
    expect(finished.artifacts).toEqual([
      ".fs-bench/probe-runs/run-scope-1/scope/scope-capture.json",
      ".fs-bench/probe-runs/run-scope-1/runtime.csv",
    ]);
    expect(publishChanged).toHaveBeenCalledWith("probe:changed", {
      projectId: "project-1",
      projectVersionId: "version-1",
      runId: "run-scope-1",
    });
    expect(
      db.prepare("SELECT count(*) AS count FROM verification_results").get(),
    ).toEqual({ count: 0 });
    expect(
      db.prepare("SELECT count(*) AS count FROM attestations").get(),
    ).toEqual({ count: 0 });
    expect(capture.path).toContain("/scope/");
  });
});
