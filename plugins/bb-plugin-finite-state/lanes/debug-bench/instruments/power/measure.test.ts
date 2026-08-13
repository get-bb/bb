import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../../../../lib/store/schema.js";
import { finishProbeRun } from "../../probes/runs.js";
import type { DeviceClaim } from "../../registry/claims.js";
import type { CaptureArtifactSink, InstrumentSession } from "../driver.js";
import {
  createPowerProbeRunArtifactSink,
  createReplayPowerDriver,
  measureActiveDraw,
  measureBootEnergy,
  measureSleepCurrent,
  powerDrivers,
} from "./measure.js";

const directories: string[] = [];
const databases: Database.Database[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function directory(): string {
  const value = mkdtempSync(join(tmpdir(), "fs128-measure-"));
  directories.push(value);
  return value;
}

function worktreeDirectory(): string {
  const value = directory();
  execFileSync("git", ["init", "--quiet", value]);
  writeFileSync(join(value, ".gitignore"), ".fs-bench/\n", "utf8");
  return value;
}

function claim(): DeviceClaim {
  return {
    deviceId: "replay-power",
    holder: "thread-1",
    scope: "machine",
    expiresAt: "2026-08-13T20:15:00.000Z",
  };
}

function sink(): CaptureArtifactSink {
  return { directory: directory(), record: vi.fn(async () => undefined) };
}

async function replaySession(): Promise<InstrumentSession> {
  const fixturePath = fileURLToPath(new URL("./fixtures/known-trace.csv", import.meta.url));
  const driver = createReplayPowerDriver({ fixturePath, verifyClaim: vi.fn() });
  return await driver.open(
    { kind: "usb", serial: "REPLAY", path: null },
    claim(),
    new AbortController().signal,
  );
}

describe("power measurement operations", () => {
  it("exports the frozen vendor-independent driver order", () => {
    expect(powerDrivers.map((driver) => driver.id)).toEqual([
      "nordic-ppk2",
      "jetperch-joulescope",
      "replay-power-fixture",
    ]);
  });

  it("excludes the settle interval and computes golden sleep-current statistics", async () => {
    const session = await replaySession();
    const summary = await measureSleepCurrent(session, {
      settleMs: 20,
      measureMs: 40,
      sampleRateHz: 100,
      mode: "ampere",
      unit: "uA",
      artifactSink: sink(),
      buildDigest: "sha256:measured-image",
      marks: [],
    }, new AbortController().signal);
    expect(summary).toMatchObject({
      kind: "sleep_current",
      window: { fromMs: 20, toMs: 60 },
      stats: { mean: 30, median: 30, p99: 50, unit: "uA" },
      buildDigest: "sha256:measured-image",
      marks: [],
    });
    expect(Object.keys(summary)).not.toContain("samples");
    await session.close();
  });

  it("handles current units and never fabricates a missing build digest", async () => {
    const session = await replaySession();
    const summary = await measureSleepCurrent(session, {
      settleMs: 20,
      measureMs: 40,
      sampleRateHz: 100,
      mode: "ampere",
      unit: "mA",
      artifactSink: sink(),
      buildDigest: null,
      marks: [],
    }, new AbortController().signal);
    expect(summary.stats.mean).toBeCloseTo(0.03);
    expect(summary.stats).toMatchObject({ median: 0.03, p99: 0.05, unit: "mA" });
    expect(summary.buildDigest).toBeNull();
    await session.close();
  });

  it("integrates boot energy only between power-on and boot-complete marks", async () => {
    const session = await replaySession();
    const summary = await measureBootEnergy(session, {
      durationMs: 100,
      sampleRateHz: 100,
      mode: "ampere",
      artifactSink: sink(),
      buildDigest: "digest-1",
      marks: [
        { atMs: 0, label: "power_on", source: "manual" },
        { atMs: 20, label: "boot_done", source: "serial" },
        { atMs: 70, label: "radio_on", source: "gdb" },
      ],
      fromMarkLabel: "power_on",
      bootCompleteMarkLabel: "boot_done",
      voltageMv: 3_300,
      unit: "uJ",
    }, new AbortController().signal);
    expect(summary.window).toEqual({ fromMs: 0, toMs: 20 });
    expect(summary.stats).toEqual({ mean: 5.115, median: 5.115, p99: 5.115, unit: "uJ" });
    expect(summary.marks.map((mark) => mark.source)).toEqual(["manual", "serial", "gdb"]);
    await session.close();
  });

  it("returns INCOMPLETE_WINDOW instead of measuring when boot-complete is missing", async () => {
    const session = await replaySession();
    const artifactSink = sink();
    await expect(measureBootEnergy(session, {
      durationMs: 100,
      sampleRateHz: 100,
      mode: "ampere",
      artifactSink,
      buildDigest: null,
      marks: [{ atMs: 0, label: "power_on", source: "manual" }],
      fromMarkLabel: "power_on",
      bootCompleteMarkLabel: "boot_done",
      voltageMv: 3_300,
      unit: "uJ",
    }, new AbortController().signal)).rejects.toMatchObject({ code: "INCOMPLETE_WINDOW" });
    expect(artifactSink.record).not.toHaveBeenCalled();
    await session.close();
  });

  it("selects an active-draw window between correlated event marks", async () => {
    const session = await replaySession();
    const summary = await measureActiveDraw(session, {
      durationMs: 100,
      sampleRateHz: 100,
      mode: "ampere",
      artifactSink: sink(),
      buildDigest: "digest-1",
      marks: [
        { atMs: 70, label: "radio_on", source: "gdb" },
        { atMs: 100, label: "radio_off", source: "serial" },
      ],
      window: { kind: "marks", fromMarkLabel: "radio_on", toMarkLabel: "radio_off" },
      unit: "mA",
    }, new AbortController().signal);
    expect(summary).toMatchObject({
      kind: "active_draw",
      window: { fromMs: 70, toMs: 100 },
      stats: { mean: 2.5, median: 2.5, p99: 4, unit: "mA" },
    });
    await session.close();
  });

  it("attaches a correlated raw trace and preserves it when the probe run finishes", async () => {
    const db = new Database(":memory:");
    databases.push(db);
    db.transaction(() => { for (const statement of MIGRATIONS) db.exec(statement); })();
    db.prepare(
      `INSERT INTO probe_run (
        project_id, project_version_id, run_id, script_path, devices,
        hypothesis, outcome, artifacts, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL)`,
    ).run(
      "project-1",
      "version-1",
      "run-power-1",
      ".fs/bench/probes/power.py",
      "[]",
      "radio draw aligns with firmware marks",
      "2026-08-13T10:00:00.000Z",
    );
    const publishChanged = vi.fn();
    const artifactSink = await createPowerProbeRunArtifactSink({
      db,
      worktreeRoot: worktreeDirectory(),
      projectId: "project-1",
      projectVersionId: "version-1",
      runId: "run-power-1",
      publishChanged,
    });
    const session = await replaySession();
    const summary = await measureActiveDraw(session, {
      durationMs: 100,
      sampleRateHz: 100,
      mode: "ampere",
      artifactSink,
      buildDigest: "sha256:simulated-image",
      marks: [
        { atMs: 70, label: "radio_on", source: "gdb" },
        { atMs: 100, label: "radio_off", source: "serial" },
      ],
      window: { kind: "marks", fromMarkLabel: "radio_on", toMarkLabel: "radio_off" },
      unit: "mA",
    }, new AbortController().signal);
    const finished = finishProbeRun(
      db,
      { projectId: "project-1", projectVersionId: "version-1" },
      "run-power-1",
      "confirmed",
      [".fs-bench/probe-runs/run-power-1/runtime.csv"],
      "2026-08-13T10:01:00.000Z",
    );

    expect(summary).toMatchObject({
      buildDigest: "sha256:simulated-image",
      window: { fromMs: 70, toMs: 100 },
      stats: { mean: 2.5, unit: "mA" },
    });
    expect(finished.artifacts).toEqual([
      ".fs-bench/probe-runs/run-power-1/power/power-trace.csv",
      ".fs-bench/probe-runs/run-power-1/runtime.csv",
    ]);
    expect(publishChanged).toHaveBeenCalledTimes(1);
    expect(publishChanged).toHaveBeenCalledWith("probe:changed", {
      projectId: "project-1",
      projectVersionId: "version-1",
      runId: "run-power-1",
    });
    expect(db.prepare("SELECT count(*) AS count FROM verification_results").get())
      .toEqual({ count: 0 });
    expect(db.prepare("SELECT count(*) AS count FROM attestations").get())
      .toEqual({ count: 0 });
    await session.close();
  });
});
