import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceClaim } from "../../registry/claims.js";
import { TransportError, type ProcessRequest } from "../transport.js";
import { createSaleaeDriver, SALEAE_BRIDGE } from "./saleae.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function outputDirectory(): string {
  const value = mkdtempSync(join(tmpdir(), "fs127-saleae-"));
  directories.push(value);
  return value;
}

const claim: DeviceClaim = {
  deviceId: "saleae-device",
  holder: "thread-1",
  scope: "machine",
  expiresAt: "2026-08-13T10:15:00.000Z",
};

describe("Saleae Logic 2 driver", () => {
  it("uses an argv-only Python bridge against the configured Logic 2 endpoint", async () => {
    const runner = vi.fn(async (_request: ProcessRequest) => ({
      code: 0,
      stdout: JSON.stringify({ found: true, serials: ["SERIAL-1"] }),
      stderr: "",
    }));
    const driver = createSaleaeDriver({ runner, verifyClaim: vi.fn() });
    await expect(driver.detect({ kind: "lan", host: "logic.local", port: 12_345 }))
      .resolves.toMatchObject({ channels: 16 });
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      command: "python3",
      args: expect.arrayContaining(["-c", SALEAE_BRIDGE, "detect"]),
      timeoutMs: 5_000,
    }), expect.any(AbortSignal));
    const payload = JSON.parse(runner.mock.calls[0]![0].args.at(-1)!);
    expect(payload).toEqual({ address: "logic.local", port: 12_345, serial: null });
  });

  it("reports unreachable Logic 2 distinctly from the missing Python package", () => {
    const driver = createSaleaeDriver({
      verifyClaim: vi.fn(),
      prerequisiteReport: () => ({
        configured: false,
        needsConfiguration: [{
          key: "saleae.logic2-app",
          configured: false,
          remediation: "Start Logic 2 and enable Automation API.",
        }],
      }),
    });
    expect(driver.prerequisites()).toEqual({
      configured: false,
      needsConfiguration: [expect.objectContaining({ key: "saleae.logic2-app" })],
    });
  });

  it("propagates capture cancellation through the supervised process and closes cleanly", async () => {
    const releaseClaim = vi.fn();
    const runner = vi.fn(async (_request, signal: AbortSignal) => await new Promise<never>((_resolve, reject) => {
      const abort = () => reject(new TransportError("PROCESS_ABORTED", "cancelled"));
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }));
    const driver = createSaleaeDriver({ runner, verifyClaim: vi.fn(), releaseClaim });
    const session = await driver.open(
      { kind: "usb", serial: "SERIAL-1", path: null },
      claim,
      new AbortController().signal,
    );
    const abort = new AbortController();
    const capture = session.capture({
      durationMs: 20_000,
      sampleRateHz: 1_000_000,
      channels: [0, 1],
      artifactSink: { directory: outputDirectory(), record: vi.fn() },
    }, abort.signal);
    abort.abort();
    await expect(capture).rejects.toMatchObject({ code: "PROCESS_ABORTED" });
    await expect(session.close()).resolves.toBeUndefined();
    expect(releaseClaim).toHaveBeenCalledOnce();
  });
});

describe.skipIf(process.env.FS_LIVE_SALEAE !== "1")("Saleae live capture", () => {
  it("is opt-in because CI has no Logic 2 or analyzer hardware", () => {
    expect(process.env.FS_LIVE_SALEAE).toBe("1");
  });
});
