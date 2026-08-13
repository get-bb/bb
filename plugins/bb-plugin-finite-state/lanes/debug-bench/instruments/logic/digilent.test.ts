import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceClaim } from "../../registry/claims.js";
import { DeviceLostError, InstrumentError } from "../driver.js";
import { createDigilentLogicDriver } from "./digilent.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function outputDirectory(): string {
  const value = mkdtempSync(join(tmpdir(), "fs127-digilent-"));
  directories.push(value);
  return value;
}

const claim: DeviceClaim = {
  deviceId: "digilent-device",
  holder: "thread-1",
  scope: "machine",
  expiresAt: "2026-08-13T10:15:00.000Z",
};

describe("Digilent WaveForms driver", () => {
  it("reconciles live enumeration by serial with WP-88 registry identities", async () => {
    const runner = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({ found: true, serials: ["SERIAL-A", "SERIAL-B"] }),
      stderr: "",
    }));
    const unmatched = createDigilentLogicDriver({
      runner,
      verifyClaim: vi.fn(),
      registeredSerials: () => ["SERIAL-C"],
    });
    await expect(unmatched.detect({ kind: "usb", serial: "SERIAL-A", path: null }))
      .resolves.toBeNull();
    const matched = createDigilentLogicDriver({
      runner,
      verifyClaim: vi.fn(),
      registeredSerials: () => ["SERIAL-B"],
    });
    await expect(matched.detect({ kind: "usb", serial: "SERIAL-B", path: null }))
      .resolves.toMatchObject({
        kind: "logic",
        features: ["capture:digital", "trigger:edge"],
      });
  });

  it("rejects a capture that exceeds the bounded sample budget before process I/O", async () => {
    const runner = vi.fn();
    const driver = createDigilentLogicDriver({ runner, verifyClaim: vi.fn() });
    const session = await driver.open(
      { kind: "usb", serial: "SERIAL-A", path: null },
      claim,
      new AbortController().signal,
    );
    await expect(session.capture({
      durationMs: 1_000,
      sampleRateHz: 6_000_000,
      channels: [0, 1],
      artifactSink: { directory: outputDirectory(), record: vi.fn() },
    }, new AbortController().signal)).rejects.toMatchObject({ code: "CAPTURE_CONFIG_INVALID" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("preserves and records a typed partial artifact when the device disappears", async () => {
    const runner = vi.fn(async () => ({
      code: 42,
      stdout: JSON.stringify({
        path: "partial-capture.json",
        format: "digilent-dwf-partial-v1",
        durationMs: 10,
        channels: 2,
        partial: true,
      }),
      stderr: "device disconnected",
    }));
    const record = vi.fn(async () => undefined);
    const driver = createDigilentLogicDriver({ runner, verifyClaim: vi.fn() });
    const session = await driver.open(
      { kind: "usb", serial: "SERIAL-A", path: null },
      claim,
      new AbortController().signal,
    );
    const capture = session.capture({
      durationMs: 10,
      sampleRateHz: 1_000_000,
      channels: [0, 1],
      artifactSink: { directory: outputDirectory(), record },
    }, new AbortController().signal);
    await expect(capture).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(InstrumentError);
      expect(error).toBeInstanceOf(DeviceLostError);
      expect(error).toMatchObject({
      code: "DEVICE_LOST",
      partialArtifact: expect.objectContaining({ format: "digilent-dwf-partial-v1" }),
      });
      return true;
    });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      path: expect.stringMatching(/partial-capture\.json$/u),
    }));
  });

  it("re-verifies the claim before every capture and performs zero I/O after expiry", async () => {
    let live = true;
    const verifyClaim = vi.fn(() => {
      if (!live) throw new Error("CLAIM_EXPIRED");
    });
    const runner = vi.fn();
    const driver = createDigilentLogicDriver({ runner, verifyClaim });
    const session = await driver.open(
      { kind: "usb", serial: "SERIAL-A", path: null },
      claim,
      new AbortController().signal,
    );
    live = false;
    await expect(session.capture({
      durationMs: 10,
      sampleRateHz: 1_000_000,
      channels: [0],
      artifactSink: { directory: outputDirectory(), record: vi.fn() },
    }, new AbortController().signal)).rejects.toThrow("CLAIM_EXPIRED");
    expect(verifyClaim).toHaveBeenCalledTimes(2);
    expect(runner).not.toHaveBeenCalled();
  });

  it("distinguishes missing dwfpy from a missing WaveForms runtime", () => {
    const driver = createDigilentLogicDriver({
      verifyClaim: vi.fn(),
      prerequisiteReport: () => ({
        configured: false,
        needsConfiguration: [
          { key: "digilent.dwfpy", configured: false, remediation: "Install dwfpy." },
          { key: "digilent.waveforms-runtime", configured: false, remediation: "Install WaveForms." },
        ],
      }),
    });
    expect(driver.prerequisites().needsConfiguration.map((item) => item.key))
      .toEqual(["digilent.dwfpy", "digilent.waveforms-runtime"]);
  });

  it("runs the real bounded prerequisite probe without throwing or installing", () => {
    const report = createDigilentLogicDriver({ verifyClaim: vi.fn() }).prerequisites();
    expect(report.configured).toBe(report.needsConfiguration.length === 0);
    expect(report.needsConfiguration.map((item) => item.key).every((key) =>
      key === "digilent.dwfpy" || key === "digilent.waveforms-runtime")).toBe(true);
    if (!report.configured) {
      const retried = createDigilentLogicDriver({ verifyClaim: vi.fn() }).prerequisites();
      expect(retried).not.toBe(report);
      expect(retried.configured).toBe(retried.needsConfiguration.length === 0);
    }
  });
});

describe.skipIf(process.env.FS_LIVE_DIGILENT !== "1")("Digilent live capture", () => {
  it("is opt-in because CI has no WaveForms runtime or analyzer hardware", () => {
    expect(process.env.FS_LIVE_DIGILENT).toBe("1");
  });
});
