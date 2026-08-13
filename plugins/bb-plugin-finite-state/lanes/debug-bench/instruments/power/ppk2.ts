import { spawnSync } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { DeviceClaim } from "../../registry/claims.js";
import type {
  CaptureConfig,
  InstrumentCapabilities,
  InstrumentDriver,
  InstrumentDriverDeps,
  PrerequisiteReport,
} from "../driver.js";
import { InstrumentError, validateCaptureConfig } from "../driver.js";
import {
  resolveInstrumentTransport,
  runInstrumentProcess,
  type ProcessResult,
  TransportError,
} from "../transport.js";
import type { PowerCapture } from "./measure.js";

const MAX_CAPTURE_MS = 60_000;
const MAX_CAPTURE_SAMPLES = 5_000_000;
const MAX_BRIDGE_OUTPUT_BYTES = 256 * 1024;

const CAPABILITIES: InstrumentCapabilities = {
  kind: "power",
  channels: 1,
  maxSampleRateHz: 100_000,
  features: [
    "measure:current",
    "measure:energy",
    "power:source-meter",
    "power:ampere-meter",
  ],
};

const PPK2_BRIDGE = String.raw`
import json, os, signal, sys, time
from ppk2_api.ppk2_api import PPK2_API

action = sys.argv[1]
request = json.loads(sys.argv[2])

def devices():
    return [
        {"path": path, "serial": serial}
        for path, serial in PPK2_API.list_devices()
        if serial
    ]

if action == "detect":
    present = devices()
    print(json.dumps({"serials": [item["serial"] for item in present]}))
    sys.exit(0)

serial = request["serial"]
path = request.get("path")
if not path:
    path = next((item["path"] for item in devices() if item["serial"] == serial), None)
if not path:
    raise RuntimeError("PPK2 device not found")

out = request["outputDirectory"]
os.makedirs(out, exist_ok=True)
trace_path = os.path.join(out, "ppk2-power.csv")
stopping = False
def stop(*_):
    global stopping
    stopping = True
signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)

ppk = PPK2_API(path, timeout=1)
ppk.get_modifiers()
calibration = ppk.modifiers or {}
mode = request["mode"]
ppk.set_source_voltage(int(request["voltageMv"]))
if mode == "source":
    ppk.use_source_meter()
    ppk.toggle_DUT_power("ON")
else:
    ppk.use_ampere_meter()

started = time.monotonic()
sample_period_ms = 1000.0 / request["sampleRateHz"]
sample_index = 0
raw_sample_index = 0
decimation = 100000 // request["sampleRateHz"]
partial = False
try:
    with open(trace_path, "w", encoding="utf-8", buffering=1) as trace:
        trace.write("at_ms,current_ua\n")
        ppk.start_measuring()
        while (time.monotonic() - started) * 1000.0 < request["durationMs"]:
            if stopping:
                partial = True
                break
            data = ppk.get_data()
            if not data:
                time.sleep(0.001)
                continue
            samples, _ = ppk.get_samples(data)
            for value in samples:
                include = raw_sample_index % decimation == 0
                raw_sample_index += 1
                if not include:
                    continue
                at_ms = sample_index * sample_period_ms
                if at_ms > request["durationMs"]:
                    break
                trace.write(f"{at_ms:.9f},{float(value):.9f}\n")
                sample_index += 1
finally:
    try:
        ppk.stop_measuring()
    finally:
        if mode == "source":
            ppk.toggle_DUT_power("OFF")

print(json.dumps({
    "path": trace_path,
    "format": "finite-state-power-csv-v1",
    "durationMs": request["durationMs"],
    "sampleRateHz": request["sampleRateHz"],
    "mode": mode,
    "calibration": {str(key): str(value) for key, value in calibration.items()},
    "truncated": partial,
}))
sys.exit(43 if partial else 0)
`;

class Ppk2InstrumentError extends InstrumentError {
  constructor(
    readonly code: "CAPTURE_CONFIG_INVALID" | "DEVICE_LOST" | "INSTRUMENT_NOT_FOUND" |
      "INSTRUMENT_NOT_CONFIGURED" | "INSTRUMENT_PROTOCOL_ERROR" | "SESSION_CLOSED",
    message: string,
    options?: ErrorOptions,
  ) {
    super(code, message, options);
  }
}

export interface Ppk2DriverDeps extends InstrumentDriverDeps {
  registeredSerials?: () => readonly string[];
  serialForDeviceId?: (deviceId: string) => string | null;
  authorizeSourcePower?: (claim: DeviceClaim) => void;
}

let cachedPrerequisites: PrerequisiteReport | null = null;

function defaultPrerequisites(): PrerequisiteReport {
  if (cachedPrerequisites !== null) return cachedPrerequisites;
  const probe = spawnSync("python3", [
    "-c",
    "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('ppk2_api') else 1)",
  ], { shell: false, timeout: 3_000, stdio: "ignore" });
  const configured = probe.status === 0;
  const report = {
    configured,
    needsConfiguration: configured ? [] : [{
      key: "power.ppk2-api",
      configured: false,
      remediation: "Install ppk2-api through the confirmed helper-install flow.",
    }],
  } satisfies PrerequisiteReport;
  if (configured) cachedPrerequisites = report;
  return report;
}

function responseObject(stdout: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(stdout.trim()); } catch (error) {
    throw new Ppk2InstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "PPK2 bridge returned malformed JSON.",
      { cause: error },
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Ppk2InstrumentError("INSTRUMENT_PROTOCOL_ERROR", "PPK2 bridge returned a non-object response.");
  }
  return Object.fromEntries(Object.entries(parsed));
}

function calibrationObject(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      Object.values(value).some((entry) => typeof entry !== "string")) {
    throw new Ppk2InstrumentError("INSTRUMENT_PROTOCOL_ERROR", "PPK2 calibration metadata is malformed.");
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, String(entry)]));
}

function artifactFromResponse(response: Record<string, unknown>, directory: string): PowerCapture {
  const path = response.path;
  const format = response.format;
  const durationMs = response.durationMs;
  const sampleRateHz = response.sampleRateHz;
  const mode = response.mode;
  const truncated = response.truncated;
  if (typeof path !== "string" || typeof format !== "string" || typeof durationMs !== "number" ||
      typeof sampleRateHz !== "number" || (mode !== "source" && mode !== "ampere") ||
      typeof truncated !== "boolean") {
    throw new Ppk2InstrumentError("INSTRUMENT_PROTOCOL_ERROR", "PPK2 bridge omitted capture metadata.");
  }
  return {
    path: join(directory, basename(path)),
    format,
    durationMs,
    channels: 1,
    sampleRateHz,
    mode,
    calibration: calibrationObject(response.calibration),
    truncated,
  };
}

function scrubDiagnostic(value: string): string {
  return value.replace(/\b(authorization|password|serial|token)\s*[:=]\s*[^\r\n]*/giu, "$1=[scrubbed]");
}

function bridgeFailure(result: ProcessResult, action: string): never {
  const detail = scrubDiagnostic(result.stderr).trim().slice(0, 2_000) || `exit ${result.code ?? "unknown"}`;
  throw new Ppk2InstrumentError(
    /not found|disconnected|no such device/iu.test(detail)
      ? "INSTRUMENT_NOT_FOUND"
      : "INSTRUMENT_NOT_CONFIGURED",
    `PPK2 ${action} failed: ${detail}`,
  );
}

function captureSettings(config: CaptureConfig): { mode: "source" | "ampere"; voltageMv: number } {
  const mode = config.settings?.mode;
  const voltageMv = config.settings?.voltageMv ?? 3_300;
  if ((mode !== "source" && mode !== "ampere") || typeof voltageMv !== "number" ||
      !Number.isInteger(voltageMv) || voltageMv < 800 || voltageMv > 5_000) {
    throw new Ppk2InstrumentError(
      "CAPTURE_CONFIG_INVALID",
      "PPK2 mode must be source or ampere and voltage must be 800-5000 mV.",
    );
  }
  return { mode, voltageMv };
}

async function partialArtifact(
  config: CaptureConfig,
  settings: { mode: "source" | "ampere" },
): Promise<PowerCapture | null> {
  const path = join(config.artifactSink.directory, "ppk2-power.csv");
  try { await access(path); } catch { return null; }
  return {
    path,
    format: "finite-state-power-csv-v1",
    durationMs: config.durationMs,
    channels: 1,
    sampleRateHz: config.sampleRateHz,
    mode: settings.mode,
    calibration: { partial: "true" },
    truncated: true,
  };
}

export function createPpk2Driver(deps: Ppk2DriverDeps): InstrumentDriver {
  const runner = deps.runner ?? runInstrumentProcess;
  const prerequisites = deps.prerequisiteReport ?? defaultPrerequisites;
  return {
    id: "nordic-ppk2",
    async detect(transport) {
      const resolved = resolveInstrumentTransport(transport);
      if (resolved.kind === "lan") {
        throw new TransportError("TRANSPORT_NOT_IMPLEMENTED", "PPK2 v1 requires host-local USB.");
      }
      const serial = resolved.serial;
      if (serial === null || !(deps.registeredSerials?.() ?? []).includes(serial)) return null;
      const result = await runner({
        command: "python3",
        args: ["-c", PPK2_BRIDGE, "detect", "{}"],
        timeoutMs: 5_000,
        maxOutputBytes: MAX_BRIDGE_OUTPUT_BYTES,
      }, new AbortController().signal);
      if (result.code !== 0) return null;
      const response = responseObject(result.stdout);
      const serials = Array.isArray(response.serials)
        ? response.serials.filter((value): value is string => typeof value === "string")
        : [];
      return serials.includes(serial) ? CAPABILITIES : null;
    },
    async open(transport, claim, signal) {
      deps.verifyClaim(claim, claim.deviceId);
      signal.throwIfAborted();
      const resolved = resolveInstrumentTransport(transport);
      if (resolved.kind === "lan") {
        throw new TransportError("TRANSPORT_NOT_IMPLEMENTED", "PPK2 v1 requires host-local USB.");
      }
      const serial = deps.serialForDeviceId?.(claim.deviceId) ?? resolved.serial;
      if (serial === null || resolved.serial !== serial) {
        throw new Ppk2InstrumentError("INSTRUMENT_NOT_FOUND", "PPK2 claim is not bound to this USB serial.");
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
          if (closed) throw new Ppk2InstrumentError("SESSION_CLOSED", "PPK2 session is closed.");
          validateCaptureConfig(config, CAPABILITIES, MAX_CAPTURE_MS);
          if (100_000 % config.sampleRateHz !== 0) {
            throw new Ppk2InstrumentError(
              "CAPTURE_CONFIG_INVALID",
              "PPK2 sample rate must be an integer divisor of its 100000 Hz hardware stream.",
            );
          }
          if (config.sampleRateHz * config.durationMs / 1_000 > MAX_CAPTURE_SAMPLES) {
            throw new Ppk2InstrumentError("CAPTURE_CONFIG_INVALID", "PPK2 capture exceeds the sample bound.");
          }
          const settings = captureSettings(config);
          deps.verifyClaim(claim, claim.deviceId);
          if (settings.mode === "source") {
            if (!deps.authorizeSourcePower) {
              throw new Ppk2InstrumentError(
                "INSTRUMENT_NOT_CONFIGURED",
                "PPK2 source power requires the debug-mode authorization seam.",
              );
            }
            deps.authorizeSourcePower(claim);
          }
          captureSignal.throwIfAborted();
          await mkdir(config.artifactSink.directory, { recursive: true });
          try {
            const result = await runner({
              command: "python3",
              args: ["-c", PPK2_BRIDGE, "capture", JSON.stringify({
                serial,
                path: resolved.path,
                outputDirectory: config.artifactSink.directory,
                durationMs: config.durationMs,
                sampleRateHz: config.sampleRateHz,
                mode: settings.mode,
                voltageMv: settings.voltageMv,
              })],
              timeoutMs: config.durationMs + 15_000,
              maxOutputBytes: MAX_BRIDGE_OUTPUT_BYTES,
            }, captureSignal);
            if (result.code !== 0 && result.code !== 43) bridgeFailure(result, "capture");
            const artifact = artifactFromResponse(responseObject(result.stdout), config.artifactSink.directory);
            await config.artifactSink.record(artifact);
            return artifact;
          } catch (error) {
            const partial = await partialArtifact(config, settings);
            if (partial) await config.artifactSink.record(partial);
            release();
            throw error;
          } finally {
            if (captureSignal.aborted) release();
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
