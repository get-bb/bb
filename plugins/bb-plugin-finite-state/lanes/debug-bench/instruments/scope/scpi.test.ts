import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceClaim } from "../../registry/claims.js";
import type { CaptureArtifactSink } from "../driver.js";
import type { ProcessRequest } from "../transport.js";
import { runInstrumentProcess } from "../transport.js";
import {
  createScpiScopeDriver,
  parseSiglentWaveform,
  SIGLENT_SDS_PROFILE,
  type ScpiProfile,
} from "./scpi.js";

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
  const value = mkdtempSync(join(tmpdir(), "fs129-scpi-"));
  directories.push(value);
  return value;
}

function claim(): DeviceClaim {
  return {
    deviceId: "scope-scpi-1",
    holder: "thread-1",
    scope: "machine",
    expiresAt: "2026-08-14T12:15:00.000Z",
  };
}

function sink(path = directory()): CaptureArtifactSink {
  return { directory: path, record: vi.fn(async () => undefined) };
}

function requestObject(value: unknown): object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("request was not an object");
  }
  return value;
}

function captureResponse(request: ProcessRequest): string {
  const payload: unknown = JSON.parse(request.args.at(-1) ?? "null");
  if (typeof payload !== "object" || payload === null)
    throw new Error("bad request");
  const outputDirectory = Reflect.get(payload, "outputDirectory");
  const samples = Reflect.get(payload, "samples");
  if (typeof outputDirectory !== "string" || typeof samples !== "number")
    throw new Error("bad request");
  const path = join(outputDirectory, "scpi-C1.dat2");
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from(`C1:WF DAT2,#9${String(samples).padStart(9, "0")}`),
      Buffer.from(Array.from({ length: samples }, (_, index) => index % 25)),
      Buffer.from("\n\n"),
    ]),
  );
  return JSON.stringify({
    rawWaveforms: { C1: { path, vdivV: 1, offsetV: 0 } },
    durationMs: Reflect.get(payload, "durationMs"),
    channelConfigs: Reflect.get(payload, "channelConfigs"),
    trigger: Reflect.get(payload, "trigger"),
    sampleRateHz: Reflect.get(payload, "sampleRateHz"),
  });
}

describe("SCPI/LAN scope driver", () => {
  it("identifies a Siglent SDS through *IDN? and maps dialect capabilities", async () => {
    const runner = vi.fn(async (_request: ProcessRequest) => ({
      code: 0,
      stdout: JSON.stringify({
        idn: "Siglent Technologies,SDS2104X Plus,SDS2XABC,1.3.9",
      }),
      stderr: "",
    }));
    const driver = createScpiScopeDriver({ runner, verifyClaim: vi.fn() });
    await expect(
      driver.detect({ kind: "lan", host: "scope.local", port: 5_025 }),
    ).resolves.toMatchObject({
      kind: "scope",
      features: expect.arrayContaining(["dialect:siglent-sds"]),
    });
    expect(runner.mock.calls[0]![0].args).toEqual([
      "-c",
      expect.any(String),
      "identify",
      JSON.stringify({ resource: "TCPIP0::scope.local::5025::SOCKET" }),
    ]);
  });

  it("executes the Siglent conversation through a protocol-level PyVISA fake", async () => {
    const protocolDirectory = directory();
    const protocolLog = join(protocolDirectory, "pyvisa.jsonl");
    const bridgeEnv = {
      ...process.env,
      PYTHONPATH: pythonFixtures,
      FS_SCOPE_PROTOCOL_LOG: protocolLog,
      FS_SCOPE_SCPI_SAMPLE_RATE: "6.25E+07Sa/s",
    };
    const driver = createScpiScopeDriver({
      runner: runInstrumentProcess,
      bridgeEnv,
      verifyClaim: vi.fn(),
      resourceForDeviceId: () => "TCPIP0::192.0.2.8::5025::SOCKET",
    });
    const transport = { kind: "lan", host: "192.0.2.8", port: 5_025 } as const;
    await expect(driver.detect(transport)).resolves.toMatchObject({
      features: expect.arrayContaining(["dialect:siglent-sds"]),
    });
    const session = await driver.open(
      transport,
      claim(),
      new AbortController().signal,
    );
    const artifactSink = sink();
    const artifact = await session.capture(
      {
        durationMs: 1,
        sampleRateHz: 100_000_000,
        channels: [0],
        settings: {
          "channel.C1.rangeV": 8,
          "channel.C1.coupling": "dc",
          "channel.C1.attenuation": 10,
          "trigger.channel": "C1",
          "trigger.edge": "rising",
          "trigger.levelV": 2.5,
        },
        artifactSink,
      },
      new AbortController().signal,
    );
    expect(artifact).toMatchObject({ sampleRateHz: 62_500_000, samples: 3 });
    const calls = readFileSync(protocolLog, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { operation: string; value: unknown });
    expect(
      calls.map(({ operation, value }) => `${operation}:${String(value)}`),
    ).toEqual(
      expect.arrayContaining([
        "query:*IDN?",
        "write:CHDR OFF",
        "write:TDIV 100US",
        "write:C1:CPL D1M",
        "write:MSIZ 140K",
        "query:SARA?",
        "query:SAST?",
        "query:C1:VDIV?",
        "query:C1:OFST?",
        "write:C1:WF? DAT2",
        "read_bytes:[object Object]",
      ]),
    );
    expect(
      calls
        .filter(({ operation }) => operation === "read_bytes")
        .map(({ value }) =>
          typeof value === "object" && value !== null
            ? Reflect.get(value, "count")
            : null,
        ),
    ).toEqual([1, 1, 9, 3, 2]);
    const normalized = JSON.parse(readFileSync(artifact.path, "utf8")) as {
      sampleRateHz: number;
      channels: { C1: number[] };
    };
    expect(normalized.sampleRateHz).toBe(62_500_000);
    expect(normalized.channels.C1).toEqual([5, 15, -5]);
    expect(existsSync(join(protocolDirectory, "scpi-C1.dat2"))).toBe(false);
    expect(artifactSink.record).toHaveBeenCalledTimes(1);
    await session.close();
  });

  it("reports trigger timeout with instrument-read timing and sample count", async () => {
    const captureDirectory = directory();
    const driver = createScpiScopeDriver({
      runner: runInstrumentProcess,
      bridgeEnv: {
        ...process.env,
        PYTHONPATH: pythonFixtures,
        FS_SCOPE_SCPI_SAMPLE_RATE: "6.25E+07Sa/s",
        FS_SCOPE_SCPI_STATUS: "Arm",
      },
      verifyClaim: vi.fn(),
      resourceForDeviceId: () => "TCPIP0::192.0.2.8::5025::SOCKET",
    });
    const transport = { kind: "lan", host: "192.0.2.8", port: 5_025 } as const;
    const session = await driver.open(
      transport,
      claim(),
      new AbortController().signal,
    );
    await expect(
      session.capture(
        {
          durationMs: 1,
          sampleRateHz: 100_000_000,
          channels: [0],
          settings: {
            "trigger.channel": "C1",
            "trigger.timeoutMs": 20,
          },
          artifactSink: sink(captureDirectory),
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "TRIGGER_TIMEOUT",
      armedConfiguration: {
        sampleRateHz: 62_500_000,
        samples: 62_500,
      },
    });
    await session.close();
  });

  it("rejects an oversized PyVISA waveform before writing it to disk", async () => {
    const captureDirectory = directory();
    const driver = createScpiScopeDriver({
      runner: runInstrumentProcess,
      bridgeEnv: {
        ...process.env,
        PYTHONPATH: pythonFixtures,
        FS_SCOPE_SCPI_RAW_SIZE: "10000001",
      },
      verifyClaim: vi.fn(),
      resourceForDeviceId: () => "TCPIP0::192.0.2.8::5025::SOCKET",
    });
    const transport = { kind: "lan", host: "192.0.2.8", port: 5_025 } as const;
    const session = await driver.open(
      transport,
      claim(),
      new AbortController().signal,
    );
    await expect(
      session.capture(
        {
          durationMs: 1,
          sampleRateHz: 1_000,
          channels: [0],
          artifactSink: sink(captureDirectory),
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INSTRUMENT_PROTOCOL_ERROR" });
    expect(existsSync(join(captureDirectory, "scpi-C1.dat2"))).toBe(false);
    await session.close();
  });

  it("renders the documented Siglent command table for a capture request", async () => {
    const runner = vi.fn(async (request: ProcessRequest) =>
      request.args.at(-2) === "identify"
        ? {
            code: 0,
            stdout: JSON.stringify({ idn: "Siglent,SDS1104X-E,serial,fw" }),
            stderr: "",
          }
        : { code: 0, stdout: captureResponse(request), stderr: "" },
    );
    const driver = createScpiScopeDriver({
      runner,
      verifyClaim: vi.fn(),
      resourceForDeviceId: () => "TCPIP0::192.0.2.8::5025::SOCKET",
    });
    const transport = { kind: "lan", host: "192.0.2.8", port: 5_025 } as const;
    await driver.detect(transport);
    const session = await driver.open(
      transport,
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
            "channel.C1.rangeV": 8,
            "channel.C1.coupling": "dc",
            "channel.C1.attenuation": 10,
            "trigger.channel": "C1",
            "trigger.edge": "rising",
            "trigger.levelV": 2.5,
          },
          artifactSink,
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      channelConfigs: [
        { channel: "C1", rangeV: 8, coupling: "dc", attenuation: 10 },
      ],
      trigger: { channel: "C1", edge: "rising", levelV: 2.5 },
    });
    const captureCall = runner.mock.calls.find(
      ([request]) => request.args.at(-2) === "capture",
    )!;
    const request: unknown = JSON.parse(captureCall[0].args.at(-1)!);
    expect(request).toMatchObject({
      resource: "TCPIP0::192.0.2.8::5025::SOCKET",
      armCommand: "ARM",
      triggerStatusCommand: "SAST?",
      sampleRateQuery: "SARA?",
      waveformQueries: { C1: "C1:WF? DAT2" },
    });
    expect(Reflect.get(requestObject(request), "setupCommands")).toEqual(
      expect.arrayContaining([
        "STOP",
        "CHDR OFF",
        "TDIV 1MS",
        "C1:TRA ON",
        "C1:VDIV 1V",
        "C1:CPL D1M",
        "MSIZ 14K",
        "C1:TRSL POS",
        "C1:TRLV 2.5V",
      ]),
    );
    expect(artifactSink.record).toHaveBeenCalledTimes(1);
    await session.close();
  });

  it("adds a second vendor as profile data without changing driver code", async () => {
    const secondProfile: ScpiProfile = {
      vendor: "acme-scope",
      commands: {
        ...SIGLENT_SDS_PROFILE.commands,
        channelScale: "CHAN{channel}:SCALE {scaleV}",
        waveformQuery: "CHAN{channel}:CURVE?",
      },
      parseWaveform(raw) {
        if (raw[0] !== 65 || raw[1] !== 67 || raw[2] !== 77 || raw[3] !== 69)
          throw new Error("ACME waveform header is malformed");
        return {
          sampleRateHz: 0,
          channels: {
            divisions: Array.from(
              new Int8Array(raw.buffer, raw.byteOffset + 4, raw.byteLength - 4),
              (sample) => sample / 10,
            ),
          },
        };
      },
    };
    const runner = vi.fn(async (request: ProcessRequest) =>
      request.args.at(-2) === "identify"
        ? {
            code: 0,
            stdout: JSON.stringify({ idn: "ACME,Model 1,serial,fw" }),
            stderr: "",
          }
        : (() => {
            const payload = JSON.parse(request.args.at(-1)!) as {
              outputDirectory: string;
              channelConfigs: unknown;
              durationMs: number;
              sampleRateHz: number;
              trigger: unknown;
            };
            const path = join(payload.outputDirectory, "acme-C1.bin");
            writeFileSync(path, Buffer.from([65, 67, 77, 69, 0, 10, 246]));
            return {
              code: 0,
              stdout: JSON.stringify({
                rawWaveforms: { C1: { path, vdivV: 2, offsetV: 0 } },
                durationMs: payload.durationMs,
                channelConfigs: payload.channelConfigs,
                trigger: payload.trigger,
                sampleRateHz: payload.sampleRateHz,
              }),
              stderr: "",
            };
          })(),
    );
    const driver = createScpiScopeDriver({
      runner,
      verifyClaim: vi.fn(),
      profiles: [SIGLENT_SDS_PROFILE, secondProfile],
      resourceForDeviceId: () => "TCPIP0::acme.local::5025::SOCKET",
    });
    const transport = { kind: "lan", host: "acme.local", port: 5_025 } as const;
    await expect(driver.detect(transport)).resolves.toMatchObject({
      features: expect.arrayContaining(["dialect:acme-scope"]),
    });
    const session = await driver.open(
      transport,
      claim(),
      new AbortController().signal,
    );
    const artifact = await session.capture(
      {
        durationMs: 2,
        sampleRateHz: 1_000,
        channels: [0],
        artifactSink: sink(),
      },
      new AbortController().signal,
    );
    const captureCall = runner.mock.calls.find(
      ([request]) => request.args.at(-2) === "capture",
    )!;
    const request: unknown = JSON.parse(captureCall[0].args.at(-1)!);
    expect(Reflect.get(requestObject(request), "setupCommands")).toContain(
      "CHAN1:SCALE 0.625",
    );
    expect(Reflect.get(requestObject(request), "waveformQueries")).toEqual({
      C1: "CHAN1:CURVE?",
    });
    const normalized = JSON.parse(readFileSync(artifact.path, "utf8")) as {
      channels: { C1: number[] };
    };
    expect(normalized.channels.C1).toEqual([0, 2, -2]);
    await session.close();
  });

  it("refuses a stale claim before LAN parsing or VISA I/O", async () => {
    const runner = vi.fn(async (_request: ProcessRequest) => ({
      code: 0,
      stdout: "{}",
      stderr: "",
    }));
    const driver = createScpiScopeDriver({
      runner,
      verifyClaim() {
        throw new Error("DEVICE_NOT_HELD");
      },
    });
    await expect(
      driver.open(
        { kind: "bb-host", hostId: "rack", remotePath: "/scope" },
        claim(),
        new AbortController().signal,
      ),
    ).rejects.toThrow("DEVICE_NOT_HELD");
    expect(runner).not.toHaveBeenCalled();
  });

  it("cannot redirect a valid claim to a LAN resource absent from the registry", async () => {
    const runner = vi.fn(async (_request: ProcessRequest) => ({
      code: 0,
      stdout: JSON.stringify({ idn: "Siglent,SDS1104X-E,serial,fw" }),
      stderr: "",
    }));
    const driver = createScpiScopeDriver({
      runner,
      verifyClaim: vi.fn(),
      resourceForDeviceId: () => "TCPIP0::trusted.local::5025::SOCKET",
    });
    await expect(
      driver.open(
        { kind: "lan", host: "attacker.local", port: 5_025 },
        claim(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INSTRUMENT_NOT_FOUND" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("turns a VISA connection drop mid-capture into typed DEVICE_LOST", async () => {
    const runner = vi.fn(async (request: ProcessRequest) =>
      request.args.at(-2) === "identify"
        ? {
            code: 0,
            stdout: JSON.stringify({ idn: "Siglent,SDS1104X-E,serial,fw" }),
            stderr: "",
          }
        : { code: 1, stdout: "", stderr: "VisaIOError: VI_ERROR_CONN_LOST" },
    );
    const releaseClaim = vi.fn();
    const driver = createScpiScopeDriver({
      runner,
      verifyClaim: vi.fn(),
      releaseClaim,
      resourceForDeviceId: () => "TCPIP0::scope.local::5025::SOCKET",
    });
    const transport = {
      kind: "lan",
      host: "scope.local",
      port: 5_025,
    } as const;
    await driver.detect(transport);
    const session = await driver.open(
      transport,
      claim(),
      new AbortController().signal,
    );
    await expect(
      session.capture(
        {
          durationMs: 2,
          sampleRateHz: 1_000,
          channels: [0],
          artifactSink: sink(),
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "DEVICE_LOST" });
    expect(releaseClaim).toHaveBeenCalledTimes(1);
  });

  it("does not misclassify a VISA timeout as a lost device", async () => {
    const runner = vi.fn(async (request: ProcessRequest) =>
      request.args.at(-2) === "identify"
        ? {
            code: 0,
            stdout: JSON.stringify({ idn: "Siglent,SDS1104X-E,serial,fw" }),
            stderr: "",
          }
        : { code: 1, stdout: "", stderr: "VisaIOError: VI_ERROR_TMO" },
    );
    const driver = createScpiScopeDriver({
      runner,
      verifyClaim: vi.fn(),
      resourceForDeviceId: () => "TCPIP0::scope.local::5025::SOCKET",
    });
    const session = await driver.open(
      { kind: "lan", host: "scope.local", port: 5_025 },
      claim(),
      new AbortController().signal,
    );
    await expect(
      session.capture(
        {
          durationMs: 2,
          sampleRateHz: 1_000,
          channels: [0],
          artifactSink: sink(),
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INSTRUMENT_PROTOCOL_ERROR" });
  });

  it("re-identifies a different instrument later bound to the same address", async () => {
    const secondProfile: ScpiProfile = {
      vendor: "acme-scope",
      commands: SIGLENT_SDS_PROFILE.commands,
      parseWaveform: SIGLENT_SDS_PROFILE.parseWaveform,
    };
    let identification = 0;
    const runner = vi.fn(async () => {
      identification += 1;
      return {
        code: 0,
        stdout: JSON.stringify({
          idn:
            identification === 1
              ? "Siglent,SDS1104X-E,old,fw"
              : "ACME,Model 2,replacement,fw",
        }),
        stderr: "",
      };
    });
    const driver = createScpiScopeDriver({
      runner,
      verifyClaim: vi.fn(),
      profiles: [SIGLENT_SDS_PROFILE, secondProfile],
      resourceForDeviceId: () => "TCPIP0::scope.local::5025::SOCKET",
    });
    const transport = {
      kind: "lan",
      host: "scope.local",
      port: 5_025,
    } as const;
    await expect(driver.detect(transport)).resolves.toMatchObject({
      features: expect.arrayContaining(["dialect:siglent-sds"]),
    });
    const session = await driver.open(
      transport,
      claim(),
      new AbortController().signal,
    );
    expect(session.capabilities.features).toContain("dialect:acme-scope");
    expect(runner).toHaveBeenCalledTimes(2);
    await session.close();
  });

  it("releases a SCPI claim when exit 42 has no armed trigger", async () => {
    const runner = vi.fn(async (request: ProcessRequest) =>
      request.args.at(-2) === "identify"
        ? {
            code: 0,
            stdout: JSON.stringify({ idn: "Siglent,SDS1104X-E,serial,fw" }),
            stderr: "",
          }
        : {
            code: 42,
            stdout: JSON.stringify({ sampleRateHz: 1_000, samples: 2 }),
            stderr: "",
          },
    );
    const releaseClaim = vi.fn();
    const driver = createScpiScopeDriver({
      runner,
      verifyClaim: vi.fn(),
      releaseClaim,
      resourceForDeviceId: () => "TCPIP0::scope.local::5025::SOCKET",
    });
    const session = await driver.open(
      { kind: "lan", host: "scope.local", port: 5_025 },
      claim(),
      new AbortController().signal,
    );
    await expect(
      session.capture(
        {
          durationMs: 2,
          sampleRateHz: 1_000,
          channels: [0],
          artifactSink: sink(),
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INSTRUMENT_PROTOCOL_ERROR" });
    expect(releaseClaim).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed or truncated IEEE 488.2 waveform blocks", () => {
    expect(() => parseSiglentWaveform(new Uint8Array([1, 2, 3]))).toThrow(
      "IEEE 488.2 block",
    );
    expect(() =>
      parseSiglentWaveform(new TextEncoder().encode("C1:WF DAT2,#210abc")),
    ).toThrow("truncated");
    const parsed = parseSiglentWaveform(
      new Uint8Array([
        ...new TextEncoder().encode("C1:WF DAT2,#13"),
        0,
        25,
        231,
      ]),
    );
    expect(parsed.channels.divisions).toEqual([0, 1, -1]);
    expect(
      parseSiglentWaveform(
        new Uint8Array([...new TextEncoder().encode("#13"), 0, 25, 231]),
      ).channels.divisions,
    ).toEqual([0, 1, -1]);
  });

  it("reports PyVISA and its working backend as distinct confirmed-remediation prerequisites", () => {
    const driver = createScpiScopeDriver({
      verifyClaim: vi.fn(),
      prerequisiteReport: () => ({
        configured: false,
        needsConfiguration: [
          {
            key: "scope.pyvisa",
            configured: false,
            remediation: "confirm pyvisa",
          },
          {
            key: "scope.pyvisa-py-backend",
            configured: false,
            remediation: "confirm backend",
          },
        ],
      }),
    });
    expect(
      driver.prerequisites().needsConfiguration.map((item) => item.key),
    ).toEqual(["scope.pyvisa", "scope.pyvisa-py-backend"]);
  });

  it("runs the real bounded PyVISA prerequisite probes without installing", () => {
    const report = createScpiScopeDriver({
      verifyClaim: vi.fn(),
    }).prerequisites();
    expect(report.configured).toBe(report.needsConfiguration.length === 0);
    expect(
      report.needsConfiguration.every((item) =>
        ["scope.pyvisa", "scope.pyvisa-py-backend"].includes(item.key),
      ),
    ).toBe(true);
  });
});
