import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../../../lib/store/schema.js";
import type { DeviceClaim } from "../registry/claims.js";
import {
  createProbeRunArtifactSink,
  createReplayLogicDriver,
  logicDrivers,
  type CaptureArtifactSink,
  type InstrumentDriver,
} from "./driver.js";
import { createSaleaeDriver } from "./logic/saleae.js";

const directories: string[] = [];
const databases: Database.Database[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function directory(): string {
  const value = mkdtempSync(join(tmpdir(), "fs127-instrument-"));
  directories.push(value);
  return value;
}

function claim(deviceId = "saleae-device"): DeviceClaim {
  return {
    deviceId,
    holder: "thread-1",
    scope: "machine",
    expiresAt: "2026-08-13T10:15:00.000Z",
  };
}

function sink(path = directory()): CaptureArtifactSink {
  return { directory: path, record: vi.fn(async () => undefined) };
}

describe("shared instrument driver contract", () => {
  it("exports the vendor-independent logic driver set", () => {
    expect(logicDrivers.map((driver) => driver.id)).toEqual([
      "saleae-logic2",
      "digilent-dwf",
      "replay-fixture",
    ]);
  });

  it("is category-agnostic for a non-debug-bench test double", async () => {
    const laboratoryThermometer: InstrumentDriver = {
      id: "laboratory-thermometer",
      async detect() {
        return { kind: "temperature", channels: 1, maxSampleRateHz: 10, features: [] };
      },
      async open(_transport, deviceClaim) {
        return {
          deviceId: deviceClaim.deviceId,
          capabilities: { kind: "temperature", channels: 1, maxSampleRateHz: 10, features: [] },
          async capture() {
            return { path: "/tmp/temperature.json", format: "temperature-json", durationMs: 1, channels: 1 };
          },
          async close() { /* no-op test double */ },
        };
      },
      prerequisites() { return { configured: true, needsConfiguration: [] }; },
    };
    await expect(laboratoryThermometer.detect({ kind: "lan", host: "lab", port: 9000 }))
      .resolves.toMatchObject({ kind: "temperature" });
  });

  it("refuses an invalid claim before transport resolution or process I/O", async () => {
    const runner = vi.fn(async () => ({ code: 0, stdout: "{}", stderr: "" }));
    const driver = createSaleaeDriver({
      runner,
      verifyClaim() { throw new Error("DEVICE_NOT_HELD"); },
    });
    await expect(driver.open(
      { kind: "bb-host", hostId: "rack-1", remotePath: "/logic" },
      claim(),
      new AbortController().signal,
    )).rejects.toThrow("DEVICE_NOT_HELD");
    expect(runner).not.toHaveBeenCalled();
  });

  it("runs USB and LAN captures and refuses the represented bb-host transport", async () => {
    const runner = vi.fn(async (request: { args: readonly string[] }) => {
      const action = request.args.at(-2);
      return action === "capture"
        ? { code: 0, stdout: JSON.stringify({ path: "capture.json", format: "saleae-logic2-manifest-v1", durationMs: 5, channels: 2 }), stderr: "" }
        : { code: 0, stdout: JSON.stringify({ found: true, serials: ["SERIAL-1"] }), stderr: "" };
    });
    const driver = createSaleaeDriver({ runner, verifyClaim: vi.fn() });
    const captureSink = sink();
    for (const transport of [
      { kind: "usb", serial: "SERIAL-1", path: null },
      { kind: "lan", host: "logic-rack.local", port: 10_430 },
    ] as const) {
      await expect(driver.detect(transport)).resolves.toMatchObject({ kind: "logic" });
      const session = await driver.open(transport, claim(), new AbortController().signal);
      await expect(session.capture({
        durationMs: 5,
        sampleRateHz: 1_000_000,
        channels: [0, 1],
        artifactSink: captureSink,
      }, new AbortController().signal)).resolves.toMatchObject({ channels: 2 });
      await session.close();
    }
    await expect(driver.open(
      { kind: "bb-host", hostId: "rack-1", remotePath: "/logic" },
      claim(),
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "TRANSPORT_NOT_IMPLEMENTED" });
    expect(runner.mock.calls.every(([request]) => request.args[0] === "-c")).toBe(true);
  });

  it("runs capture and artifact writing through the replay backend without Python", async () => {
    const fixturePath = fileURLToPath(new URL("./logic/fixtures/session.json", import.meta.url));
    const driver = createReplayLogicDriver({ fixturePath, verifyClaim: vi.fn() });
    const output = directory();
    const artifactSink = sink(output);
    const session = await driver.open(
      { kind: "usb", serial: "REPLAY", path: null },
      claim("replay-device"),
      new AbortController().signal,
    );
    const artifact = await session.capture({
      durationMs: 10,
      sampleRateHz: 1_000_000,
      channels: [0, 1],
      artifactSink,
    }, new AbortController().signal);
    expect(JSON.parse(readFileSync(artifact.path, "utf8"))).toMatchObject({
      schema: "finite-state-logic-v1",
      vendor: "replay",
    });
    expect(artifactSink.record).toHaveBeenCalledWith(artifact);
  });
});

describe("probe-run artifact plumbing", () => {
  it("records only a gitignored capture path and publishes a tiny refetch hint", async () => {
    const db = new Database(":memory:");
    databases.push(db);
    db.transaction(() => { for (const statement of MIGRATIONS) db.exec(statement); })();
    db.prepare(
      `INSERT INTO probe_run (
        project_id, project_version_id, run_id, script_path, devices,
        hypothesis, outcome, artifacts, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL)`,
    ).run("project-1", "version-1", "run-1", ".fs/bench/probes/test.py", "[]", "bus traffic", "2026-08-13T10:00:00.000Z");
    const worktreeRoot = directory();
    const publishChanged = vi.fn();
    const artifactSink = await createProbeRunArtifactSink({
      db,
      worktreeRoot,
      projectId: "project-1",
      projectVersionId: "version-1",
      runId: "run-1",
      publishChanged,
      isIgnored: async (_root, relativePath) => relativePath.startsWith(".fs-bench/"),
    });
    const path = join(artifactSink.directory, "capture.json");
    writeFileSync(path, "{}", "utf8");
    await artifactSink.record({ path, format: "test", durationMs: 1, channels: 1 });
    const row = db.prepare<[string], { artifacts: string }>(
      "SELECT artifacts FROM probe_run WHERE run_id = ?",
    ).get("run-1");
    expect(row).toBeDefined();
    expect(JSON.parse(row!.artifacts)).toEqual([".fs-bench/probe-runs/run-1/logic/capture.json"]);
    expect(publishChanged).toHaveBeenCalledWith("probe:changed", {
      projectId: "project-1",
      projectVersionId: "version-1",
      runId: "run-1",
    });
    expect(db.prepare("SELECT count(*) AS count FROM verification_results").get())
      .toEqual({ count: 0 });
    expect(db.prepare("SELECT count(*) AS count FROM attestations").get())
      .toEqual({ count: 0 });
  });
});
