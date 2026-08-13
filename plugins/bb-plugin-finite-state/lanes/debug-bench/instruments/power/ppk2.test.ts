import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceClaim } from "../../registry/claims.js";
import type { CaptureArtifactSink } from "../driver.js";
import { TransportError, type ProcessRequest } from "../transport.js";
import { createPpk2Driver } from "./ppk2.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function outputDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "fs128-ppk2-"));
  directories.push(directory);
  return directory;
}

function claim(): DeviceClaim {
  return {
    deviceId: "power-1",
    holder: "thread-1",
    scope: "machine",
    expiresAt: "2026-08-13T20:15:00.000Z",
  };
}

function sink(directory = outputDirectory()): CaptureArtifactSink {
  return { directory, record: vi.fn(async () => undefined) };
}

function captureResponse(request: ProcessRequest, truncated = false): string {
  const payload: unknown = JSON.parse(request.args.at(-1) ?? "null");
  if (typeof payload !== "object" || payload === null) throw new Error("bad request");
  const directory = Reflect.get(payload, "outputDirectory");
  const mode = Reflect.get(payload, "mode");
  const durationMs = Reflect.get(payload, "durationMs");
  const sampleRateHz = Reflect.get(payload, "sampleRateHz");
  if (typeof directory !== "string") throw new Error("bad directory");
  writeFileSync(join(directory, "ppk2-power.csv"), "at_ms,current_ua\n0,10\n1,20\n", "utf8");
  return JSON.stringify({
    path: join(directory, "ppk2-power.csv"),
    format: "finite-state-power-csv-v1",
    durationMs,
    sampleRateHz,
    mode,
    calibration: { gain: "1.0" },
    truncated,
  });
}

describe("Nordic PPK2 power driver", () => {
  it("uses an argv-only bridge, reconciles the registered serial, and selects source mode", async () => {
    const runner = vi.fn(async (request: ProcessRequest) => request.args.at(-2) === "detect"
      ? { code: 0, stdout: JSON.stringify({ serials: ["PPK2-001"] }), stderr: "" }
      : { code: 0, stdout: captureResponse(request), stderr: "" });
    const authorizeSourcePower = vi.fn();
    const driver = createPpk2Driver({
      runner,
      verifyClaim: vi.fn(),
      registeredSerials: () => ["PPK2-001"],
      serialForDeviceId: () => "PPK2-001",
      authorizeSourcePower,
    });
    await expect(driver.detect({ kind: "usb", serial: "PPK2-001", path: "/dev/ttyACM0" }))
      .resolves.toMatchObject({ kind: "power" });
    const session = await driver.open(
      { kind: "usb", serial: "PPK2-001", path: "/dev/ttyACM0" },
      claim(),
      new AbortController().signal,
    );
    const artifactSink = sink();
    await expect(session.capture({
      durationMs: 10,
      sampleRateHz: 1_000,
      channels: [0],
      settings: { mode: "source", voltageMv: 3_000 },
      artifactSink,
    }, new AbortController().signal)).resolves.toMatchObject({
      mode: "source",
      sampleRateHz: 1_000,
      truncated: false,
    });
    expect(authorizeSourcePower).toHaveBeenCalledWith(claim());
    expect(runner.mock.calls.every(([request]) =>
      request.command === "python3" && request.args[0] === "-c")).toBe(true);
    const request: unknown = JSON.parse(runner.mock.calls.at(-1)![0].args.at(-1)!);
    expect(request).toMatchObject({ mode: "source", voltageMv: 3_000, serial: "PPK2-001" });
    await session.close();
  });

  it("refuses a non-live claim before transport parsing or device I/O", async () => {
    const runner = vi.fn(async () => ({ code: 0, stdout: "{}", stderr: "" }));
    const driver = createPpk2Driver({
      runner,
      verifyClaim() { throw new Error("CLAIM_EXPIRED"); },
    });
    await expect(driver.open(
      { kind: "bb-host", hostId: "rack", remotePath: "/ppk2" },
      claim(),
      new AbortController().signal,
    )).rejects.toThrow("CLAIM_EXPIRED");
    expect(runner).not.toHaveBeenCalled();
  });

  it("fails closed when source power has no debug-mode authorization seam", async () => {
    const runner = vi.fn(async () => ({ code: 0, stdout: "{}", stderr: "" }));
    const driver = createPpk2Driver({
      runner,
      verifyClaim: vi.fn(),
      serialForDeviceId: () => "PPK2-001",
    });
    const session = await driver.open(
      { kind: "usb", serial: "PPK2-001", path: "/dev/ttyACM0" },
      claim(),
      new AbortController().signal,
    );
    await expect(session.capture({
      durationMs: 10,
      sampleRateHz: 1_000,
      channels: [0],
      settings: { mode: "source", voltageMv: 3_300 },
      artifactSink: sink(),
    }, new AbortController().signal)).rejects.toMatchObject({ code: "INSTRUMENT_NOT_CONFIGURED" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("reports its distinct missing Python prerequisite without installing anything", () => {
    const driver = createPpk2Driver({
      verifyClaim: vi.fn(),
      prerequisiteReport: () => ({
        configured: false,
        needsConfiguration: [{
          key: "power.ppk2-api",
          configured: false,
          remediation: "confirm install",
        }],
      }),
    });
    expect(driver.prerequisites()).toEqual({
      configured: false,
      needsConfiguration: [expect.objectContaining({ key: "power.ppk2-api" })],
    });
  });

  it("records a marked partial artifact when capture is aborted", async () => {
    const runner = vi.fn(async (request: ProcessRequest) => {
      captureResponse(request, true);
      throw new TransportError("PROCESS_ABORTED", "test abort");
    });
    const driver = createPpk2Driver({
      runner,
      verifyClaim: vi.fn(),
      serialForDeviceId: () => "PPK2-001",
    });
    const session = await driver.open(
      { kind: "usb", serial: "PPK2-001", path: "/dev/ttyACM0" },
      claim(),
      new AbortController().signal,
    );
    const artifactSink = sink();
    await expect(session.capture({
      durationMs: 10,
      sampleRateHz: 1_000,
      channels: [0],
      settings: { mode: "ampere" },
      artifactSink,
    }, new AbortController().signal)).rejects.toMatchObject({ code: "PROCESS_ABORTED" });
    expect(artifactSink.record).toHaveBeenCalledWith(expect.objectContaining({
      truncated: true,
      calibration: { partial: "true" },
    }));
  });
});
