import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceClaim } from "../../registry/claims.js";
import type { CaptureArtifactSink } from "../driver.js";
import type { ProcessRequest } from "../transport.js";
import { runInstrumentProcess } from "../transport.js";
import { createPicoScopeDriver } from "./picoscope.js";

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
  const value = mkdtempSync(join(tmpdir(), "fs129-trigger-"));
  directories.push(value);
  return value;
}

function claim(): DeviceClaim {
  return {
    deviceId: "scope-pico-1",
    holder: "thread-trigger",
    scope: "machine",
    expiresAt: "2026-08-14T12:15:00.000Z",
  };
}

function sink(path = directory()): CaptureArtifactSink {
  return { directory: path, record: vi.fn(async () => undefined) };
}

function success(request: ProcessRequest): string {
  const payload: unknown = JSON.parse(request.args.at(-1) ?? "null");
  if (typeof payload !== "object" || payload === null)
    throw new Error("bad request");
  const outputDirectory = Reflect.get(payload, "outputDirectory");
  const samples = Reflect.get(payload, "samples");
  if (typeof outputDirectory !== "string" || typeof samples !== "number")
    throw new Error("bad request");
  const path = join(outputDirectory, "triggered.json");
  writeFileSync(
    path,
    JSON.stringify({
      schema: "finite-state-scope-v1",
      sampleRateHz: Reflect.get(payload, "sampleRateHz"),
      channels: { A: Array.from({ length: samples }, () => 1) },
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

function captureConfig(artifactSink: CaptureArtifactSink) {
  return {
    durationMs: 5,
    sampleRateHz: 1_000,
    channels: [0],
    settings: {
      "trigger.channel": "A",
      "trigger.edge": "rising",
      "trigger.levelV": 0.8,
      "trigger.timeoutMs": 50,
    },
    artifactSink,
  } as const;
}

describe("scope trigger semantics", () => {
  it("returns the triggered capture normally", async () => {
    const runner = vi.fn(async (request: ProcessRequest) => ({
      code: 0,
      stdout: success(request),
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
    await expect(
      session.capture(captureConfig(sink()), new AbortController().signal),
    ).resolves.toMatchObject({
      trigger: { channel: "A", edge: "rising", levelV: 0.8 },
    });
    await session.close();
  });

  it("distinguishes TRIGGER_TIMEOUT from transport failure and echoes the armed configuration", async () => {
    const runner = vi.fn(async () => ({ code: 42, stdout: "{}", stderr: "" }));
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
      session.capture(captureConfig(sink()), new AbortController().signal),
    ).rejects.toMatchObject({
      code: "TRIGGER_TIMEOUT",
      armedConfiguration: {
        channelConfigs: [
          { channel: "A", rangeV: 5, coupling: "dc", attenuation: 1 },
        ],
        trigger: { channel: "A", edge: "rising", levelV: 0.8 },
        sampleRateHz: 1_000,
        samples: 5,
      },
    });
    await session.close();
  });

  it("lets the host deadline report NO_TRIGGER instead of allowing a device auto-trigger", async () => {
    const protocolDirectory = directory();
    const protocolLog = join(protocolDirectory, "no-trigger.jsonl");
    const driver = createPicoScopeDriver({
      runner: runInstrumentProcess,
      bridgeEnv: {
        ...process.env,
        PYTHONPATH: pythonFixtures,
        FS_SCOPE_PROTOCOL_LOG: protocolLog,
        FS_SCOPE_PICO_NO_TRIGGER: "1",
      },
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
          ...captureConfig(sink()),
          sampleRateHz: 125_000_000,
          settings: {
            ...captureConfig(sink()).settings,
            "trigger.timeoutMs": 15,
          },
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "TRIGGER_TIMEOUT",
      armedConfiguration: { sampleRateHz: 125_000_000 },
    });
    const calls = readFileSync(protocolLog, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { call: string; args: number[] });
    expect(
      calls.find(({ call }) => call === "ps2000aSetSimpleTrigger")?.args.at(-1),
    ).toBe(0);
    expect(
      calls.filter(({ call }) => call === "ps2000aIsReady").length,
    ).toBeGreaterThan(1);
    await session.close();
  });

  it("releases a PicoScope claim when exit 42 has no armed trigger", async () => {
    const releaseClaim = vi.fn();
    const driver = createPicoScopeDriver({
      runner: vi.fn(async () => ({
        code: 42,
        stdout: JSON.stringify({ sampleRateHz: 1_000, samples: 5 }),
        stderr: "",
      })),
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
          durationMs: 5,
          sampleRateHz: 1_000,
          channels: [0],
          artifactSink: sink(),
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INSTRUMENT_PROTOCOL_ERROR" });
    expect(releaseClaim).toHaveBeenCalledTimes(1);
  });

  it("can re-arm the same claimed session after an honest trigger timeout", async () => {
    let attempt = 0;
    const runner = vi.fn(async (request: ProcessRequest) => {
      attempt += 1;
      return attempt === 1
        ? { code: 42, stdout: "{}", stderr: "" }
        : { code: 0, stdout: success(request), stderr: "" };
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
      session.capture(captureConfig(sink()), new AbortController().signal),
    ).rejects.toMatchObject({ code: "TRIGGER_TIMEOUT" });
    expect(releaseClaim).not.toHaveBeenCalled();
    await expect(
      session.capture(captureConfig(sink()), new AbortController().signal),
    ).resolves.toMatchObject({ samples: 5 });
    await session.close();
    expect(releaseClaim).toHaveBeenCalledTimes(1);
  });
});
