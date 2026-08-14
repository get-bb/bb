import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceClaim } from "../../registry/claims.js";
import type { CaptureArtifactSink } from "../driver.js";
import {
  runInstrumentProcess,
  TransportError,
  type ProcessRequest,
} from "../transport.js";
import { createPicoScopeDriver, PICOSCOPE_GENERATION } from "./picoscope.js";

const directories: string[] = [];
const pythonFixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "python",
);

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function directory(): string {
  const value = mkdtempSync(join(tmpdir(), "fs129-pico-"));
  directories.push(value);
  return value;
}

function claim(): DeviceClaim {
  return {
    deviceId: "scope-pico-1",
    holder: "thread-1",
    scope: "machine",
    expiresAt: "2026-08-14T12:15:00.000Z",
  };
}

function sink(path = directory()): CaptureArtifactSink {
  return { directory: path, record: vi.fn(async () => undefined) };
}

function captureResponse(request: ProcessRequest): string {
  const payload: unknown = JSON.parse(request.args.at(-1) ?? "null");
  if (typeof payload !== "object" || payload === null)
    throw new Error("bad request");
  const outputDirectory = Reflect.get(payload, "outputDirectory");
  const samples = Reflect.get(payload, "samples");
  if (typeof outputDirectory !== "string" || typeof samples !== "number")
    throw new Error("bad request");
  const path = join(outputDirectory, "picoscope-waveform.json");
  writeFileSync(
    path,
    JSON.stringify({
      schema: "finite-state-scope-v1",
      sampleRateHz: Reflect.get(payload, "sampleRateHz"),
      channels: {
        A: Array.from({ length: samples }, (_, index) => index / samples),
      },
    }),
    "utf8",
  );
  return JSON.stringify({
    path,
    format: "finite-state-scope-json-v1",
    durationMs: Reflect.get(payload, "durationMs"),
    channels: 1,
    channelConfigs: Reflect.get(payload, "channelConfigs"),
    trigger: Reflect.get(payload, "trigger"),
    sampleRateHz: Reflect.get(payload, "sampleRateHz"),
    samples,
  });
}

describe("PicoScope USB driver", () => {
  it("detects only a registry-owned ps2000a serial and uses an argv-only bridge", async () => {
    const runner = vi.fn(async (_request: ProcessRequest) => ({
      code: 0,
      stdout: JSON.stringify({
        generation: PICOSCOPE_GENERATION,
        serials: ["PICO-001"],
      }),
      stderr: "",
    }));
    const driver = createPicoScopeDriver({
      runner,
      verifyClaim: vi.fn(),
      registeredSerials: () => ["PICO-001"],
    });
    await expect(
      driver.detect({ kind: "usb", serial: "PICO-001", path: null }),
    ).resolves.toMatchObject({ kind: "scope", channels: 4 });
    await expect(
      driver.detect({ kind: "usb", serial: "UNREGISTERED", path: null }),
    ).resolves.toBeNull();
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]![0]).toMatchObject({ command: "python3" });
    expect(runner.mock.calls[0]![0].args[0]).toBe("-c");
  });

  it("refuses a stale claim before transport parsing or device I/O", async () => {
    const runner = vi.fn(async (_request: ProcessRequest) => ({
      code: 0,
      stdout: "{}",
      stderr: "",
    }));
    const driver = createPicoScopeDriver({
      runner,
      verifyClaim() {
        throw new Error("CLAIM_EXPIRED");
      },
    });
    await expect(
      driver.open(
        { kind: "bb-host", hostId: "rack", remotePath: "/pico" },
        claim(),
        new AbortController().signal,
      ),
    ).rejects.toThrow("CLAIM_EXPIRED");
    expect(runner).not.toHaveBeenCalled();
  });

  it("cannot redirect a valid claim to an unbound USB serial", async () => {
    const runner = vi.fn(async (_request: ProcessRequest) => ({
      code: 0,
      stdout: "{}",
      stderr: "",
    }));
    const driver = createPicoScopeDriver({
      runner,
      verifyClaim: vi.fn(),
      serialForDeviceId: () => "TRUSTED-PICO",
    });
    await expect(
      driver.open(
        { kind: "usb", serial: "ATTACKER-PICO", path: null },
        claim(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INSTRUMENT_NOT_FOUND" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("echoes channel, attenuation, and trigger configuration into the capture artifact", async () => {
    const runner = vi.fn(async (request: ProcessRequest) => ({
      code: 0,
      stdout: captureResponse(request),
      stderr: "",
    }));
    const driver = createPicoScopeDriver({
      runner,
      verifyClaim: vi.fn(),
      serialForDeviceId: () => "PICO-001",
    });
    const session = await driver.open(
      { kind: "usb", serial: "PICO-001", path: null },
      claim(),
      new AbortController().signal,
    );
    const artifactSink = sink();
    await expect(
      session.capture(
        {
          durationMs: 10,
          sampleRateHz: 1_000,
          channels: [0],
          settings: {
            "channel.A.rangeV": 2,
            "channel.A.coupling": "ac",
            "channel.A.attenuation": 10,
            "trigger.channel": "A",
            "trigger.edge": "falling",
            "trigger.levelV": 1.2,
          },
          artifactSink,
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      channelConfigs: [
        { channel: "A", rangeV: 2, coupling: "ac", attenuation: 10 },
      ],
      trigger: { channel: "A", edge: "falling", levelV: 1.2 },
      sampleRateHz: 1_000,
      samples: 10,
    });
    const request: unknown = JSON.parse(runner.mock.calls[0]![0].args.at(-1)!);
    expect(request).toMatchObject({
      serial: "PICO-001",
    });
    expect(artifactSink.record).toHaveBeenCalledTimes(1);
    await session.close();
  });

  it("executes ps2000a FFI calls with host-owned trigger timeout and read-back timing", async () => {
    const protocolDirectory = directory();
    const protocolLog = join(protocolDirectory, "picosdk.jsonl");
    const driver = createPicoScopeDriver({
      runner: runInstrumentProcess,
      bridgeEnv: {
        ...process.env,
        PYTHONPATH: pythonFixtures,
        FS_SCOPE_PROTOCOL_LOG: protocolLog,
      },
      verifyClaim: vi.fn(),
      registeredSerials: () => ["PICO-001"],
      serialForDeviceId: () => "PICO-001",
    });
    await expect(
      driver.detect({ kind: "usb", serial: "PICO-001", path: null }),
    ).resolves.toMatchObject({ kind: "scope", channels: 4 });
    const session = await driver.open(
      { kind: "usb", serial: "PICO-001", path: null },
      claim(),
      new AbortController().signal,
    );
    const artifact = await session.capture(
      {
        durationMs: 1,
        sampleRateHz: 100_000_000,
        channels: [0],
        settings: {
          "channel.A.rangeV": 2,
          "channel.A.coupling": "dc",
          "trigger.channel": "A",
          "trigger.edge": "rising",
          "trigger.levelV": 0.5,
          "trigger.timeoutMs": 50,
        },
        artifactSink: sink(),
      },
      new AbortController().signal,
    );
    expect(artifact).toMatchObject({
      sampleRateHz: 62_500_000,
      samples: 62_500,
      durationMs: 1,
    });
    const calls = readFileSync(protocolLog, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { call: string; args: number[] });
    expect(calls.map(({ call }) => call)).toEqual([
      "ps2000aEnumerateUnits",
      "ps2000aOpenUnit",
      "ps2000aSetChannel",
      "ps2000aSetSimpleTrigger",
      "ps2000aGetTimebase2",
      "ps2000aSetDataBuffer",
      "ps2000aRunBlock",
      "ps2000aIsReady",
      "ps2000aGetValues",
      "ps2000aStop",
      "ps2000aCloseUnit",
    ]);
    const triggerCall = calls.find(
      ({ call }) => call === "ps2000aSetSimpleTrigger",
    );
    expect(triggerCall?.args.at(-1)).toBe(0);
    const timebaseCall = calls.find(
      ({ call }) => call === "ps2000aGetTimebase2",
    );
    expect(timebaseCall?.args).toEqual([7, 4, 100_000, 16, 0, 10_000_000, 0]);
    await session.close();
  });

  it("fails closed before device I/O when signal-generator output lacks the WP-90 seam", async () => {
    const runner = vi.fn(async () => ({ code: 0, stdout: "{}", stderr: "" }));
    const driver = createPicoScopeDriver({
      runner,
      verifyClaim: vi.fn(),
      serialForDeviceId: () => "PICO-001",
    });
    const session = await driver.open(
      { kind: "usb", serial: "PICO-001", path: null },
      claim(),
      new AbortController().signal,
    );
    await expect(
      session.capture(
        {
          durationMs: 10,
          sampleRateHz: 1_000,
          channels: [0],
          settings: { signalGeneratorEnabled: true },
          artifactSink: sink(),
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INSTRUMENT_NOT_CONFIGURED" });
    expect(runner).not.toHaveBeenCalled();
    await session.close();
  });

  it("authorizes target-affecting output only through the injected gate", async () => {
    const runner = vi.fn(async (request: ProcessRequest) => ({
      code: 0,
      stdout: captureResponse(request),
      stderr: "",
    }));
    const authorizeSignalGenerator = vi.fn();
    const driver = createPicoScopeDriver({
      runner,
      verifyClaim: vi.fn(),
      serialForDeviceId: () => "PICO-001",
      authorizeSignalGenerator,
    });
    const session = await driver.open(
      { kind: "usb", serial: "PICO-001", path: null },
      claim(),
      new AbortController().signal,
    );
    await session.capture(
      {
        durationMs: 10,
        sampleRateHz: 1_000,
        channels: [0],
        settings: {
          signalGeneratorEnabled: true,
          "signalGenerator.frequencyHz": 2_000,
          "signalGenerator.pkToPkV": 1.5,
          "signalGenerator.offsetV": 0.1,
        },
        artifactSink: sink(),
      },
      new AbortController().signal,
    );
    expect(authorizeSignalGenerator).toHaveBeenCalledWith(claim());
    const request: unknown = JSON.parse(runner.mock.calls[0]![0].args.at(-1)!);
    expect(request).toMatchObject({
      signalGenerator: { frequencyHz: 2_000, pkToPkV: 1.5, offsetV: 0.1 },
    });
    await session.close();
  });

  it("cannot bypass a rejecting WP-90 signal-generator authorization", async () => {
    const runner = vi.fn(async (request: ProcessRequest) => ({
      code: 0,
      stdout: captureResponse(request),
      stderr: "",
    }));
    const driver = createPicoScopeDriver({
      runner,
      verifyClaim: vi.fn(),
      serialForDeviceId: () => "PICO-001",
      authorizeSignalGenerator() {
        throw new Error("DESTRUCTIVE_CONFIRMATION_REQUIRED");
      },
    });
    const session = await driver.open(
      { kind: "usb", serial: "PICO-001", path: null },
      claim(),
      new AbortController().signal,
    );
    await expect(
      session.capture(
        {
          durationMs: 10,
          sampleRateHz: 1_000,
          channels: [0],
          settings: { signalGeneratorEnabled: true },
          artifactSink: sink(),
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("DESTRUCTIVE_CONFIRMATION_REQUIRED");
    expect(runner).not.toHaveBeenCalled();
    await session.close();
  });

  it("releases the claim and preserves the abort error when block capture is canceled", async () => {
    const runner = vi.fn(async () => {
      throw new TransportError("PROCESS_ABORTED", "test abort");
    });
    const releaseClaim = vi.fn();
    const driver = createPicoScopeDriver({
      runner,
      verifyClaim: vi.fn(),
      releaseClaim,
      serialForDeviceId: () => "PICO-001",
    });
    const session = await driver.open(
      { kind: "usb", serial: "PICO-001", path: null },
      claim(),
      new AbortController().signal,
    );
    await expect(
      session.capture(
        {
          durationMs: 10,
          sampleRateHz: 1_000,
          channels: [0],
          artifactSink: sink(),
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "PROCESS_ABORTED" });
    expect(releaseClaim).toHaveBeenCalledTimes(1);
  });

  it("reports distinct wrapper and C-library prerequisites without installing either", () => {
    const driver = createPicoScopeDriver({
      verifyClaim: vi.fn(),
      prerequisiteReport: () => ({
        configured: false,
        needsConfiguration: [
          {
            key: "scope.picosdk-python",
            configured: false,
            remediation: "confirm wrappers",
          },
          {
            key: "scope.picosdk-ps2000a-library",
            configured: false,
            remediation: "confirm SDK",
          },
        ],
      }),
    });
    expect(
      driver.prerequisites().needsConfiguration.map((item) => item.key),
    ).toEqual(["scope.picosdk-python", "scope.picosdk-ps2000a-library"]);
  });

  it("runs the real bounded PicoSDK prerequisite probes without installing", () => {
    const report = createPicoScopeDriver({
      verifyClaim: vi.fn(),
    }).prerequisites();
    expect(report.configured).toBe(report.needsConfiguration.length === 0);
    expect(
      report.needsConfiguration.every((item) =>
        ["scope.picosdk-python", "scope.picosdk-ps2000a-library"].includes(
          item.key,
        ),
      ),
    ).toBe(true);
  });
});
