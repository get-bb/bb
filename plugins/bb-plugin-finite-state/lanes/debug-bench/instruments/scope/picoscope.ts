import { spawnSync } from "node:child_process";
import { access, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
  CaptureConfig,
  InstrumentCapabilities,
  InstrumentDriver,
  InstrumentDriverDeps,
  PrerequisiteReport,
} from "../driver.js";
import { validateCaptureConfig } from "../driver.js";
import {
  InstrumentError,
  resolveInstrumentTransport,
  runInstrumentProcess,
  TransportError,
  type ProcessResult,
} from "../transport.js";
import type { DeviceClaim } from "../../registry/claims.js";
import type {
  ScopeCapture,
  ScopeChannelConfig,
  ScopeTrigger,
} from "./waveform.js";

const MAX_CAPTURE_MS = 60_000;
const MAX_CAPTURE_SAMPLES = 10_000_000;
const MAX_BRIDGE_OUTPUT_BYTES = 256 * 1024;

const CAPABILITIES: InstrumentCapabilities = {
  kind: "scope",
  channels: 4,
  maxSampleRateHz: 1_000_000_000,
  features: [
    "capture:block",
    "trigger:edge",
    "coupling:ac-dc",
    "probe-attenuation",
    "signal-generator:gated",
  ],
};

class ScopeTriggerTimeoutError extends Error {
  readonly code = "TRIGGER_TIMEOUT" as const;
  constructor(
    message: string,
    readonly armedConfiguration: {
      channelConfigs: ScopeChannelConfig[];
      trigger: ScopeTrigger;
      sampleRateHz: number;
      samples: number;
    },
  ) {
    super(`TRIGGER_TIMEOUT: ${message}`);
    this.name = "ScopeTriggerTimeoutError";
  }
}

class PicoScopeInstrumentError extends InstrumentError {
  constructor(
    code:
      | "CAPTURE_CONFIG_INVALID"
      | "DEVICE_LOST"
      | "INSTRUMENT_NOT_FOUND"
      | "INSTRUMENT_NOT_CONFIGURED"
      | "INSTRUMENT_PROTOCOL_ERROR"
      | "SESSION_CLOSED",
    message: string,
    options?: ErrorOptions,
  ) {
    super(code, message, options);
  }
}

// The generation is deliberately private to this backend. Adding psospa is an
// additive bridge variant and does not change InstrumentDriver.
export const PICOSCOPE_GENERATION = "ps2000a" as const;

export const PICOSCOPE_BRIDGE = String.raw`
import ctypes, json, os, sys, time
from picosdk.ps2000a import ps2000a as ps
from picosdk.functions import adc2mV, assert_pico_ok, mV2adc

action = sys.argv[1]
request = json.loads(sys.argv[2])

def serial_bytes(value):
    return value.encode("ascii") if value else None

if action == "detect":
    count = ctypes.c_int16()
    serials = ctypes.create_string_buffer(4096)
    length = ctypes.c_int16(len(serials))
    status = ps.ps2000aEnumerateUnits(ctypes.byref(count), serials, ctypes.byref(length))
    assert_pico_ok(status)
    found = [item for item in serials.value.decode("ascii").split(",") if item]
    print(json.dumps({"generation": "ps2000a", "serials": found}))
elif action == "capture":
    handle = ctypes.c_int16()
    status = ps.ps2000aOpenUnit(ctypes.byref(handle), serial_bytes(request.get("serial")))
    assert_pico_ok(status)
    try:
        ranges = {}
        coupling = {"dc": ps.PS2000A_COUPLING["PS2000A_DC"], "ac": ps.PS2000A_COUPLING["PS2000A_AC"]}
        range_table = {0.01: "PS2000A_10MV", 0.02: "PS2000A_20MV", 0.05: "PS2000A_50MV", 0.1: "PS2000A_100MV", 0.2: "PS2000A_200MV", 0.5: "PS2000A_500MV", 1: "PS2000A_1V", 2: "PS2000A_2V", 5: "PS2000A_5V", 10: "PS2000A_10V", 20: "PS2000A_20V"}
        for channel in request["channelConfigs"]:
            channel_id = ps.PS2000A_CHANNEL["PS2000A_CHANNEL_" + channel["channel"]]
            range_id = ps.PS2000A_RANGE[range_table[channel["rangeV"]]]
            ranges[channel["channel"]] = range_id
            assert_pico_ok(ps.ps2000aSetChannel(handle, channel_id, 1, coupling[channel["coupling"]], range_id, 0))
        signal_generator = request.get("signalGenerator")
        if signal_generator:
            assert_pico_ok(ps.ps2000aSetSigGenBuiltIn(
                handle,
                int(signal_generator["offsetV"] * 1000000),
                int(signal_generator["pkToPkV"] * 1000000),
                ps.PS2000A_WAVE_TYPE["PS2000A_SINE"],
                signal_generator["frequencyHz"],
                signal_generator["frequencyHz"],
                0, 0,
                ps.PS2000A_SWEEP_TYPE["PS2000A_UP"],
                ps.PS2000A_EXTRA_OPERATIONS["PS2000A_ES_OFF"],
                0, 0,
                ps.PS2000A_SIGGEN_TRIG_TYPE["PS2000A_SIGGEN_RISING"],
                ps.PS2000A_SIGGEN_TRIG_SOURCE["PS2000A_SIGGEN_NONE"],
                0,
            ))
        trigger = request.get("trigger")
        if trigger:
            source = ps.PS2000A_CHANNEL["PS2000A_CHANNEL_" + trigger["channel"]]
            direction = ps.PS2000A_THRESHOLD_DIRECTION["PS2000A_" + trigger["edge"].upper()]
            threshold = mV2adc(trigger["levelV"] * 1000, ranges[trigger["channel"]], ctypes.c_int16(32767))
            # The host deadline owns NO_TRIGGER. A non-zero auto-trigger value
            # would make the device fabricate an edge at the deadline.
            assert_pico_ok(ps.ps2000aSetSimpleTrigger(handle, 1, source, threshold, direction, 0, 0))
        target_interval_ns = 1000000000.0 / request["sampleRateHz"]
        if target_interval_ns <= 4:
            timebase = max(0, int(__import__("math").ceil(__import__("math").log(target_interval_ns, 2))))
        else:
            timebase = max(3, int(__import__("math").ceil(target_interval_ns / 8.0)) + 2)
        time_interval_ns = ctypes.c_float()
        max_samples = ctypes.c_int32()
        while True:
            status = ps.ps2000aGetTimebase2(handle, timebase, request["samples"], ctypes.byref(time_interval_ns), 0, ctypes.byref(max_samples), 0)
            if status == 0 and time_interval_ns.value >= target_interval_ns:
                break
            timebase += 1
            if timebase > 10000000:
                raise ValueError("no ps2000a timebase satisfies the requested rate")
        actual_sample_rate_hz = 1000000000.0 / time_interval_ns.value
        samples = min(int(__import__("math").ceil(actual_sample_rate_hz * request["durationMs"] / 1000.0)), max_samples.value)
        buffers = {}
        for channel in request["channelConfigs"]:
            buffer = (ctypes.c_int16 * samples)()
            buffers[channel["channel"]] = buffer
            channel_id = ps.PS2000A_CHANNEL["PS2000A_CHANNEL_" + channel["channel"]]
            assert_pico_ok(ps.ps2000aSetDataBuffer(handle, channel_id, buffer, samples, 0, 0))
        time_indisposed_ms = ctypes.c_int32()
        assert_pico_ok(ps.ps2000aRunBlock(handle, 0, samples, timebase, 0, ctypes.byref(time_indisposed_ms), 0, None, None))
        deadline = time.monotonic() + request["triggerTimeoutMs"] / 1000.0
        ready = ctypes.c_int16(0)
        while not ready.value and time.monotonic() < deadline:
            assert_pico_ok(ps.ps2000aIsReady(handle, ctypes.byref(ready)))
            time.sleep(0.005)
        if not ready.value:
            ps.ps2000aStop(handle)
            print(json.dumps({"armedConfiguration": request, "sampleRateHz": actual_sample_rate_hz, "samples": samples}), flush=True)
            sys.exit(42)
        count = ctypes.c_int32(samples)
        overflow = ctypes.c_int16()
        assert_pico_ok(ps.ps2000aGetValues(handle, 0, ctypes.byref(count), 1, 0, 0, ctypes.byref(overflow)))
        channels = {}
        max_adc = ctypes.c_int16(32767)
        for channel in request["channelConfigs"]:
            values = adc2mV(buffers[channel["channel"]], ranges[channel["channel"]], max_adc)
            channels[channel["channel"]] = [value / 1000.0 * channel["attenuation"] for value in values[:count.value]]
        os.makedirs(request["outputDirectory"], exist_ok=True)
        path = os.path.join(request["outputDirectory"], "picoscope-waveform.json")
        with open(path, "w", encoding="utf-8") as handle_out:
            json.dump({"schema": "finite-state-scope-v1", "sampleRateHz": actual_sample_rate_hz, "channels": channels}, handle_out)
        actual_duration_ms = count.value / actual_sample_rate_hz * 1000.0
        print(json.dumps({"path": path, "format": "finite-state-scope-json-v1", "durationMs": actual_duration_ms, "channels": len(channels), "channelConfigs": request["channelConfigs"], "trigger": trigger, "sampleRateHz": actual_sample_rate_hz, "samples": count.value}))
    finally:
        try: ps.ps2000aStop(handle)
        finally: ps.ps2000aCloseUnit(handle)
else:
    raise ValueError("unsupported action")
`;

export interface PicoScopeDriverDeps extends InstrumentDriverDeps {
  registeredSerials?: () => readonly string[];
  serialForDeviceId?: (deviceId: string) => string | null;
  authorizeSignalGenerator?: (claim: DeviceClaim) => void;
  bridgeEnv?: NodeJS.ProcessEnv;
}

let configuredPrerequisites: PrerequisiteReport | null = null;

function defaultPrerequisites(): PrerequisiteReport {
  if (configuredPrerequisites !== null) return configuredPrerequisites;
  const wrappers = spawnSync(
    "python3",
    ["-c", "from picosdk.ps2000a import ps2000a"],
    {
      shell: false,
      timeout: 3_000,
      stdio: "ignore",
    },
  );
  const libraries =
    wrappers.status === 0
      ? spawnSync(
          "python3",
          [
            "-c",
            "from picosdk.ps2000a import ps2000a as p; assert p.ps2000aOpenUnit",
          ],
          {
            shell: false,
            timeout: 3_000,
            stdio: "ignore",
          },
        )
      : null;
  const items = [
    {
      key: "scope.picosdk-python",
      configured: wrappers.status === 0,
      remediation:
        "Install the picosdk Python wrappers through the confirmed helper-install flow.",
    },
    {
      key: "scope.picosdk-ps2000a-library",
      configured: libraries?.status === 0,
      remediation:
        "Install the vendor PicoSDK ps2000a C library through the confirmed helper-install flow.",
    },
  ].filter((item) => !item.configured);
  const report = { configured: items.length === 0, needsConfiguration: items };
  if (report.configured) configuredPrerequisites = report;
  return report;
}

function objectResponse(stdout: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch (error) {
    throw new PicoScopeInstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "PicoScope bridge returned malformed JSON.",
      { cause: error },
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new PicoScopeInstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "PicoScope bridge returned a non-object response.",
    );
  }
  return Object.fromEntries(Object.entries(parsed));
}

function bridgeFailure(result: ProcessResult, action: string): never {
  const detail =
    result.stderr.trim().slice(0, 2_000) || `exit ${result.code ?? "unknown"}`;
  const code =
    /PICO_NOT_FOUND|PICO_USB3_0_DEVICE_NON_USB3_0_PORT|PICO_INVALID_HANDLE/iu.test(
      detail,
    )
      ? "INSTRUMENT_NOT_FOUND"
      : "INSTRUMENT_NOT_CONFIGURED";
  throw new PicoScopeInstrumentError(
    code,
    `PicoScope ${action} failed: ${detail}`,
  );
}

function numberSetting(
  config: CaptureConfig,
  key: string,
  fallback: number,
): number {
  const value = config.settings?.[key] ?? fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PicoScopeInstrumentError(
      "CAPTURE_CONFIG_INVALID",
      `${key} must be numeric.`,
    );
  }
  return value;
}

function stringSetting(
  config: CaptureConfig,
  key: string,
  fallback: string,
): string {
  const value = config.settings?.[key] ?? fallback;
  if (typeof value !== "string")
    throw new PicoScopeInstrumentError(
      "CAPTURE_CONFIG_INVALID",
      `${key} must be text.`,
    );
  return value;
}

function captureConfiguration(config: CaptureConfig): {
  channelConfigs: ScopeChannelConfig[];
  trigger: ScopeTrigger | null;
  triggerTimeoutMs: number;
  samples: number;
  signalGenerator: {
    frequencyHz: number;
    pkToPkV: number;
    offsetV: number;
  } | null;
} {
  const ranges = new Set([0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20]);
  const channelConfigs = config.channels.map((index): ScopeChannelConfig => {
    const channel = String.fromCharCode(65 + index);
    const rangeV = numberSetting(config, `channel.${channel}.rangeV`, 5);
    const coupling = stringSetting(config, `channel.${channel}.coupling`, "dc");
    const attenuation = numberSetting(
      config,
      `channel.${channel}.attenuation`,
      1,
    );
    if (
      !ranges.has(rangeV) ||
      (coupling !== "ac" && coupling !== "dc") ||
      attenuation <= 0
    ) {
      throw new PicoScopeInstrumentError(
        "CAPTURE_CONFIG_INVALID",
        `Channel ${channel} configuration is unsupported.`,
      );
    }
    return { channel, rangeV, coupling, attenuation };
  });
  const triggerChannelValue = config.settings?.["trigger.channel"];
  let trigger: ScopeTrigger | null = null;
  if (triggerChannelValue !== undefined && triggerChannelValue !== null) {
    const channel = String(triggerChannelValue);
    const edge = stringSetting(config, "trigger.edge", "rising");
    const levelV = numberSetting(config, "trigger.levelV", 0);
    if (
      !channelConfigs.some((item) => item.channel === channel) ||
      (edge !== "rising" && edge !== "falling")
    ) {
      throw new PicoScopeInstrumentError(
        "CAPTURE_CONFIG_INVALID",
        "PicoScope trigger configuration is invalid.",
      );
    }
    trigger = { channel, edge, levelV };
  }
  const triggerTimeoutMs = numberSetting(
    config,
    "trigger.timeoutMs",
    config.durationMs + 1_000,
  );
  const samples = Math.ceil((config.sampleRateHz * config.durationMs) / 1_000);
  if (
    !Number.isInteger(triggerTimeoutMs) ||
    triggerTimeoutMs < 1 ||
    samples > MAX_CAPTURE_SAMPLES
  ) {
    throw new PicoScopeInstrumentError(
      "CAPTURE_CONFIG_INVALID",
      "PicoScope capture exceeds timeout or sample bounds.",
    );
  }
  let signalGenerator: {
    frequencyHz: number;
    pkToPkV: number;
    offsetV: number;
  } | null = null;
  if (config.settings?.signalGeneratorEnabled === true) {
    const frequencyHz = numberSetting(
      config,
      "signalGenerator.frequencyHz",
      1_000,
    );
    const pkToPkV = numberSetting(config, "signalGenerator.pkToPkV", 1);
    const offsetV = numberSetting(config, "signalGenerator.offsetV", 0);
    if (
      frequencyHz <= 0 ||
      frequencyHz > 1_000_000 ||
      pkToPkV <= 0 ||
      pkToPkV > 4 ||
      Math.abs(offsetV) + pkToPkV / 2 > 2
    ) {
      throw new PicoScopeInstrumentError(
        "CAPTURE_CONFIG_INVALID",
        "PicoScope signal-generator settings exceed the ps2000a output bounds.",
      );
    }
    signalGenerator = { frequencyHz, pkToPkV, offsetV };
  }
  return {
    channelConfigs,
    trigger,
    triggerTimeoutMs,
    samples,
    signalGenerator,
  };
}

function parsedChannelConfigs(value: unknown): ScopeChannelConfig[] {
  if (!Array.isArray(value)) {
    throw new PicoScopeInstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "PicoScope channel metadata is malformed.",
    );
  }
  return value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new PicoScopeInstrumentError(
        "INSTRUMENT_PROTOCOL_ERROR",
        "PicoScope channel metadata is malformed.",
      );
    }
    const channel = Reflect.get(item, "channel");
    const rangeV = Reflect.get(item, "rangeV");
    const coupling = Reflect.get(item, "coupling");
    const attenuation = Reflect.get(item, "attenuation");
    if (
      typeof channel !== "string" ||
      typeof rangeV !== "number" ||
      (coupling !== "ac" && coupling !== "dc") ||
      typeof attenuation !== "number"
    ) {
      throw new PicoScopeInstrumentError(
        "INSTRUMENT_PROTOCOL_ERROR",
        "PicoScope channel metadata is malformed.",
      );
    }
    return { channel, rangeV, coupling, attenuation };
  });
}

function parsedTrigger(value: unknown): ScopeTrigger | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new PicoScopeInstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "PicoScope trigger metadata is malformed.",
    );
  }
  const channel = Reflect.get(value, "channel");
  const edge = Reflect.get(value, "edge");
  const levelV = Reflect.get(value, "levelV");
  if (
    typeof channel !== "string" ||
    (edge !== "rising" && edge !== "falling") ||
    typeof levelV !== "number"
  ) {
    throw new PicoScopeInstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "PicoScope trigger metadata is malformed.",
    );
  }
  return { channel, edge, levelV };
}

async function artifactFromResponse(
  response: Record<string, unknown>,
  outputDirectory: string,
): Promise<ScopeCapture> {
  const path = response.path;
  const format = response.format;
  const durationMs = response.durationMs;
  const channels = response.channels;
  const channelConfigs = response.channelConfigs;
  const trigger = response.trigger;
  const sampleRateHz = response.sampleRateHz;
  const samples = response.samples;
  if (
    typeof path !== "string" ||
    typeof format !== "string" ||
    typeof durationMs !== "number" ||
    typeof channels !== "number" ||
    typeof sampleRateHz !== "number" ||
    !Number.isFinite(sampleRateHz) ||
    sampleRateHz <= 0 ||
    typeof samples !== "number" ||
    !Number.isInteger(samples) ||
    samples < 1 ||
    samples > MAX_CAPTURE_SAMPLES
  ) {
    throw new PicoScopeInstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "PicoScope capture metadata is malformed.",
    );
  }
  const root = await realpath(outputDirectory);
  const artifactPath = await realpath(resolve(path));
  const confined = relative(root, artifactPath);
  if (
    confined === ".." ||
    confined.startsWith(`..${sep}`) ||
    isAbsolute(confined)
  ) {
    throw new PicoScopeInstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "PicoScope artifact escaped its capture directory.",
    );
  }
  await access(artifactPath);
  return {
    path: artifactPath,
    format,
    durationMs,
    channels,
    channelConfigs: parsedChannelConfigs(channelConfigs),
    trigger: parsedTrigger(trigger),
    sampleRateHz,
    samples,
  };
}

export function createPicoScopeDriver(
  deps: PicoScopeDriverDeps,
): InstrumentDriver {
  const runner = deps.runner ?? runInstrumentProcess;
  const prerequisites = deps.prerequisiteReport ?? defaultPrerequisites;
  return {
    id: "picoscope-ps2000a",
    async detect(transport) {
      const resolved = resolveInstrumentTransport(transport);
      if (resolved.kind === "lan")
        throw new TransportError(
          "TRANSPORT_NOT_IMPLEMENTED",
          "PicoScope v1 requires host-local USB.",
        );
      const serial = resolved.serial;
      if (
        serial === null ||
        !(deps.registeredSerials?.() ?? []).includes(serial)
      )
        return null;
      const result = await runner(
        {
          command: "python3",
          args: ["-c", PICOSCOPE_BRIDGE, "detect", "{}"],
          timeoutMs: 5_000,
          maxOutputBytes: MAX_BRIDGE_OUTPUT_BYTES,
          env: deps.bridgeEnv,
        },
        new AbortController().signal,
      );
      if (result.code !== 0) return null;
      const response = objectResponse(result.stdout);
      const serials = Array.isArray(response.serials)
        ? response.serials.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
      return response.generation === PICOSCOPE_GENERATION &&
        serials.includes(serial)
        ? CAPABILITIES
        : null;
    },
    async open(transport, claim, signal) {
      deps.verifyClaim(claim, claim.deviceId);
      signal.throwIfAborted();
      const resolved = resolveInstrumentTransport(transport);
      if (resolved.kind === "lan")
        throw new TransportError(
          "TRANSPORT_NOT_IMPLEMENTED",
          "PicoScope v1 requires host-local USB.",
        );
      const serial = deps.serialForDeviceId?.(claim.deviceId)?.trim() || null;
      if (serial === null || serial !== resolved.serial) {
        throw new PicoScopeInstrumentError(
          "INSTRUMENT_NOT_FOUND",
          "PicoScope claim is not bound by the registry to this USB serial.",
        );
      }
      let closed = false;
      let released = false;
      const release = () => {
        closed = true;
        if (!released) {
          released = true;
          deps.releaseClaim?.(claim);
        }
      };
      signal.addEventListener("abort", release, { once: true });
      return {
        deviceId: claim.deviceId,
        capabilities: CAPABILITIES,
        async capture(config, captureSignal) {
          if (closed)
            throw new PicoScopeInstrumentError(
              "SESSION_CLOSED",
              "PicoScope session is closed.",
            );
          validateCaptureConfig(config, CAPABILITIES, MAX_CAPTURE_MS);
          deps.verifyClaim(claim, claim.deviceId);
          const armed = captureConfiguration(config);
          if (config.settings?.signalGeneratorEnabled === true) {
            if (!deps.authorizeSignalGenerator) {
              throw new PicoScopeInstrumentError(
                "INSTRUMENT_NOT_CONFIGURED",
                "PicoScope signal-generator output requires the WP-90 authorization seam.",
              );
            }
            deps.authorizeSignalGenerator(claim);
          }
          captureSignal.throwIfAborted();
          await mkdir(config.artifactSink.directory, { recursive: true });
          let completed = false;
          let preserveAfterTriggerTimeout = false;
          try {
            const result = await runner(
              {
                command: "python3",
                args: [
                  "-c",
                  PICOSCOPE_BRIDGE,
                  "capture",
                  JSON.stringify({
                    serial,
                    outputDirectory: config.artifactSink.directory,
                    durationMs: config.durationMs,
                    sampleRateHz: config.sampleRateHz,
                    ...armed,
                  }),
                ],
                timeoutMs: armed.triggerTimeoutMs + 15_000,
                maxOutputBytes: MAX_BRIDGE_OUTPUT_BYTES,
                env: deps.bridgeEnv,
              },
              captureSignal,
            );
            if (result.code === 42 && armed.trigger !== null) {
              const timeout = objectResponse(result.stdout);
              const sampleRateHz =
                typeof timeout.sampleRateHz === "number"
                  ? timeout.sampleRateHz
                  : config.sampleRateHz;
              const samples =
                typeof timeout.samples === "number"
                  ? timeout.samples
                  : armed.samples;
              throw new ScopeTriggerTimeoutError(
                "The armed PicoScope edge did not occur before the deadline.",
                {
                  channelConfigs: armed.channelConfigs,
                  trigger: armed.trigger,
                  sampleRateHz,
                  samples,
                },
              );
            }
            if (result.code === 42) {
              throw new PicoScopeInstrumentError(
                "INSTRUMENT_PROTOCOL_ERROR",
                "PicoScope bridge reported NO_TRIGGER without an armed trigger.",
              );
            }
            if (result.code !== 0) bridgeFailure(result, "capture");
            const artifact = await artifactFromResponse(
              objectResponse(result.stdout),
              config.artifactSink.directory,
            );
            await config.artifactSink.record(artifact);
            completed = true;
            return artifact;
          } catch (error) {
            preserveAfterTriggerTimeout =
              error instanceof ScopeTriggerTimeoutError;
            throw error;
          } finally {
            if (
              captureSignal.aborted ||
              (!completed && !preserveAfterTriggerTimeout)
            )
              release();
          }
        },
        async close() {
          signal.removeEventListener("abort", release);
          release();
        },
      };
    },
    prerequisites,
  };
}
