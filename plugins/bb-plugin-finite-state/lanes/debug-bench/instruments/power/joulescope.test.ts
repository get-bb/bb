import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceClaim } from "../../registry/claims.js";
import type { CaptureArtifactSink } from "../driver.js";
import type { ProcessRequest } from "../transport.js";
import { createJoulescopeDriver } from "./joulescope.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function outputDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "fs128-joulescope-"));
  directories.push(directory);
  return directory;
}

function claim(): DeviceClaim {
  return {
    deviceId: "power-2",
    holder: "thread-1",
    scope: "machine",
    expiresAt: "2026-08-13T20:15:00.000Z",
  };
}

function sink(directory = outputDirectory()): CaptureArtifactSink {
  return { directory, record: vi.fn(async () => undefined) };
}

function captureResponse(request: ProcessRequest, truncated: boolean): string {
  const payload: unknown = JSON.parse(request.args.at(-1) ?? "null");
  if (typeof payload !== "object" || payload === null) throw new Error("bad request");
  const directory = Reflect.get(payload, "outputDirectory");
  if (typeof directory !== "string") throw new Error("bad directory");
  writeFileSync(
    join(directory, "joulescope-power.csv"),
    "at_ms,current_ua\n0,0.05\n1,0.06\n",
    "utf8",
  );
  return JSON.stringify({
    path: join(directory, "joulescope-power.csv"),
    format: "finite-state-power-csv-v1",
    durationMs: Reflect.get(payload, "durationMs"),
    sampleRateHz: Reflect.get(payload, "sampleRateHz"),
    mode: "ampere",
    calibration: { dynamicRange: "9-decades" },
    truncated,
  });
}

describe("Jetperch Joulescope power driver", () => {
  it("advertises sub-microamp dynamic range only for a reconciled physical serial", async () => {
    const runner = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({ serials: ["JS220-001"] }),
      stderr: "",
    }));
    const driver = createJoulescopeDriver({
      runner,
      verifyClaim: vi.fn(),
      registeredSerials: () => ["JS220-001"],
    });
    await expect(driver.detect({ kind: "usb", serial: "JS220-001", path: null }))
      .resolves.toMatchObject({
        kind: "power",
        features: expect.arrayContaining(["dynamic-range:9-decades", "sleep-floor:sub-microamp"]),
      });
    await expect(driver.detect({ kind: "usb", serial: "PHANTOM", path: null })).resolves.toBeNull();
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("frames capture requests as argv JSON and returns bounded metadata", async () => {
    const runner = vi.fn(async (request: ProcessRequest) => ({
      code: 0,
      stdout: captureResponse(request, false),
      stderr: "",
    }));
    const driver = createJoulescopeDriver({
      runner,
      verifyClaim: vi.fn(),
      serialForDeviceId: () => "JS220-001",
    });
    const session = await driver.open(
      { kind: "usb", serial: "JS220-001", path: null },
      claim(),
      new AbortController().signal,
    );
    await expect(session.capture({
      durationMs: 2,
      sampleRateHz: 1_000,
      channels: [0],
      settings: { mode: "ampere" },
      artifactSink: sink(),
    }, new AbortController().signal)).resolves.toMatchObject({
      format: "finite-state-power-csv-v1",
      calibration: { dynamicRange: "9-decades" },
    });
    expect(runner.mock.calls[0]![0]).toMatchObject({ command: "python3" });
    expect(runner.mock.calls[0]![0].args[0]).toBe("-c");
    await session.close();
  });

  it("turns a device loss into typed DEVICE_LOST while preserving the partial trace", async () => {
    const runner = vi.fn(async (request: ProcessRequest) => ({
      code: 42,
      stdout: captureResponse(request, true),
      stderr: "device lost",
    }));
    const driver = createJoulescopeDriver({
      runner,
      verifyClaim: vi.fn(),
      serialForDeviceId: () => "JS220-001",
    });
    const session = await driver.open(
      { kind: "usb", serial: "JS220-001", path: null },
      claim(),
      new AbortController().signal,
    );
    const artifactSink = sink();
    await expect(session.capture({
      durationMs: 2,
      sampleRateHz: 1_000,
      channels: [0],
      settings: { mode: "ampere" },
      artifactSink,
    }, new AbortController().signal)).rejects.toMatchObject({
      code: "DEVICE_LOST",
      partialArtifact: expect.objectContaining({ truncated: true }),
    });
    expect(artifactSink.record).toHaveBeenCalledTimes(1);
  });

  it("uses a distinct needsConfiguration key and performs no installation", () => {
    const driver = createJoulescopeDriver({
      verifyClaim: vi.fn(),
      prerequisiteReport: () => ({
        configured: false,
        needsConfiguration: [{
          key: "power.joulescope",
          configured: false,
          remediation: "confirm install",
        }],
      }),
    });
    expect(driver.prerequisites().needsConfiguration).toEqual([
      expect.objectContaining({ key: "power.joulescope" }),
    ]);
  });
});
