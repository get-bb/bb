import { spawnSync } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  CaptureConfig,
  InstrumentCapabilities,
  InstrumentDriver,
  InstrumentDriverDeps,
  PrerequisiteReport,
} from "../driver.js";
import { DeviceLostError, InstrumentError, validateCaptureConfig } from "../driver.js";
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
  maxSampleRateHz: 2_000_000,
  features: [
    "measure:current",
    "measure:energy",
    "power:ampere-meter",
    "dynamic-range:9-decades",
    "sleep-floor:sub-microamp",
  ],
};

const JOULESCOPE_BRIDGE = String.raw`
import json, os, signal, sys
import joulescope

action = sys.argv[1]
request = json.loads(sys.argv[2])

def serial_of(device):
    path = str(device.device_path).rstrip("/")
    return path.split("/")[-1] if path else ""

devices = list(joulescope.scan(config="auto"))
if action == "detect":
    print(json.dumps({"serials": [serial_of(device) for device in devices if serial_of(device)]}))
    sys.exit(0)

serial = request["serial"]
device = next((item for item in devices if serial_of(item) == serial), None)
if device is None:
    raise RuntimeError("Joulescope device not found")

out = request["outputDirectory"]
os.makedirs(out, exist_ok=True)
trace_path = os.path.join(out, "joulescope-power.csv")
stopping = False
def stop(*_):
    global stopping
    stopping = True
signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)

partial = False
calibration = {"dynamicRange": "9-decades"}
class CaptureConfigurationError(Exception):
    pass
try:
    with open(trace_path, "w", encoding="utf-8", buffering=1) as trace:
        trace.write("at_ms,current_ua\n")
        with device:
            try:
                device.parameter_set("sampling_frequency", int(request["sampleRateHz"]))
            except Exception as error:
                raise CaptureConfigurationError() from error
            values = device.read(contiguous_duration=request["durationMs"] / 1000.0)
            actual_sample_rate = float(device.sampling_frequency)
        period_ms = 1000.0 / actual_sample_rate
        for index, row in enumerate(values):
            if stopping:
                partial = True
                break
            current_a = float(row[0] if hasattr(row, "__len__") else row)
            trace.write(f"{index * period_ms:.9f},{current_a * 1000000.0:.9f}\n")
except Exception as error:
    partial = True
    print(json.dumps({
        "path": trace_path,
        "format": "finite-state-power-csv-v1",
        "durationMs": request["durationMs"],
        "sampleRateHz": request["sampleRateHz"],
        "mode": "ampere",
        "calibration": calibration,
        "truncated": True,
    }))
    if isinstance(error, CaptureConfigurationError):
        print("capture configuration rejected", file=sys.stderr)
        sys.exit(44)
    print("device lost", file=sys.stderr)
    sys.exit(42)

print(json.dumps({
    "path": trace_path,
    "format": "finite-state-power-csv-v1",
    "durationMs": request["durationMs"],
    "sampleRateHz": actual_sample_rate,
    "mode": "ampere",
    "calibration": calibration,
    "truncated": partial,
}))
sys.exit(43 if partial else 0)
`;

class JoulescopeInstrumentError extends InstrumentError {
  constructor(
    readonly code: "CAPTURE_CONFIG_INVALID" | "DEVICE_LOST" | "INSTRUMENT_NOT_FOUND" |
      "INSTRUMENT_NOT_CONFIGURED" | "INSTRUMENT_PROTOCOL_ERROR" | "SESSION_CLOSED",
    message: string,
    options?: ErrorOptions,
  ) {
    super(code, message, options);
  }
}

export interface JoulescopeDriverDeps extends InstrumentDriverDeps {
  registeredSerials?: () => readonly string[];
  serialForDeviceId?: (deviceId: string) => string | null;
}

let cachedPrerequisites: PrerequisiteReport | null = null;

function defaultPrerequisites(): PrerequisiteReport {
  if (cachedPrerequisites !== null) return cachedPrerequisites;
  const probe = spawnSync("python3", [
    "-c",
    "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('joulescope') else 1)",
  ], { shell: false, timeout: 3_000, stdio: "ignore" });
  const configured = probe.status === 0;
  const report = {
    configured,
    needsConfiguration: configured ? [] : [{
      key: "power.joulescope",
      configured: false,
      remediation: "Install joulescope through the confirmed helper-install flow.",
    }],
  } satisfies PrerequisiteReport;
  if (configured) cachedPrerequisites = report;
  return report;
}

function responseObject(stdout: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(stdout.trim()); } catch (error) {
    throw new JoulescopeInstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "Joulescope bridge returned malformed JSON.",
      { cause: error },
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new JoulescopeInstrumentError("INSTRUMENT_PROTOCOL_ERROR", "Joulescope bridge returned a non-object response.");
  }
  return Object.fromEntries(Object.entries(parsed));
}

function calibrationObject(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      Object.values(value).some((entry) => typeof entry !== "string")) {
    throw new JoulescopeInstrumentError("INSTRUMENT_PROTOCOL_ERROR", "Joulescope calibration metadata is malformed.");
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, String(entry)]));
}

function artifactFromResponse(response: Record<string, unknown>, directory: string): PowerCapture {
  const path = response.path;
  const format = response.format;
  const durationMs = response.durationMs;
  const sampleRateHz = response.sampleRateHz;
  const truncated = response.truncated;
  if (typeof path !== "string" || typeof format !== "string" || typeof durationMs !== "number" ||
      typeof sampleRateHz !== "number" || typeof truncated !== "boolean") {
    throw new JoulescopeInstrumentError("INSTRUMENT_PROTOCOL_ERROR", "Joulescope bridge omitted capture metadata.");
  }
  return {
    path: join(directory, basename(path)),
    format,
    durationMs,
    channels: 1,
    sampleRateHz,
    mode: "ampere",
    calibration: calibrationObject(response.calibration),
    truncated,
  };
}

function scrubDiagnostic(value: string): string {
  return value.replace(/\b(authorization|password|serial|token)\s*[:=]\s*[^\r\n]*/giu, "$1=[scrubbed]");
}

function bridgeFailure(result: ProcessResult, action: string): never {
  const detail = scrubDiagnostic(result.stderr).trim().slice(0, 2_000) || `exit ${result.code ?? "unknown"}`;
  throw new JoulescopeInstrumentError(
    /not found|disconnected|device lost|no such device/iu.test(detail)
      ? "INSTRUMENT_NOT_FOUND"
      : "INSTRUMENT_NOT_CONFIGURED",
    `Joulescope ${action} failed: ${detail}`,
  );
}

async function knownPartial(config: CaptureConfig): Promise<PowerCapture | null> {
  const path = join(config.artifactSink.directory, "joulescope-power.csv");
  try { await access(path); } catch { return null; }
  return {
    path,
    format: "finite-state-power-csv-v1",
    durationMs: config.durationMs,
    channels: 1,
    sampleRateHz: config.sampleRateHz,
    mode: "ampere",
    calibration: { partial: "true" },
    truncated: true,
  };
}

function assertAmpereMode(config: CaptureConfig): void {
  if (config.settings?.mode !== "ampere") {
    throw new JoulescopeInstrumentError(
      "CAPTURE_CONFIG_INVALID",
      "Joulescope v1 captures in ampere-meter mode only.",
    );
  }
}

export function createJoulescopeDriver(deps: JoulescopeDriverDeps): InstrumentDriver {
  const runner = deps.runner ?? runInstrumentProcess;
  const prerequisites = deps.prerequisiteReport ?? defaultPrerequisites;
  return {
    id: "jetperch-joulescope",
    async detect(transport) {
      const resolved = resolveInstrumentTransport(transport);
      if (resolved.kind === "lan") {
        throw new TransportError("TRANSPORT_NOT_IMPLEMENTED", "Joulescope v1 requires host-local USB.");
      }
      const serial = resolved.serial;
      if (serial === null || !(deps.registeredSerials?.() ?? []).includes(serial)) return null;
      const result = await runner({
        command: "python3",
        args: ["-c", JOULESCOPE_BRIDGE, "detect", "{}"],
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
        throw new TransportError("TRANSPORT_NOT_IMPLEMENTED", "Joulescope v1 requires host-local USB.");
      }
      const serial = deps.serialForDeviceId?.(claim.deviceId) ?? resolved.serial;
      if (serial === null || resolved.serial !== serial) {
        throw new JoulescopeInstrumentError(
          "INSTRUMENT_NOT_FOUND",
          "Joulescope claim is not bound to this USB serial.",
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
          if (closed) throw new JoulescopeInstrumentError("SESSION_CLOSED", "Joulescope session is closed.");
          validateCaptureConfig(config, CAPABILITIES, MAX_CAPTURE_MS);
          assertAmpereMode(config);
          if (config.sampleRateHz * config.durationMs / 1_000 > MAX_CAPTURE_SAMPLES) {
            throw new JoulescopeInstrumentError(
              "CAPTURE_CONFIG_INVALID",
              "Joulescope capture exceeds the analysis sample bound.",
            );
          }
          deps.verifyClaim(claim, claim.deviceId);
          captureSignal.throwIfAborted();
          await mkdir(config.artifactSink.directory, { recursive: true });
          try {
            const result = await runner({
              command: "python3",
              args: ["-c", JOULESCOPE_BRIDGE, "capture", JSON.stringify({
                serial,
                outputDirectory: config.artifactSink.directory,
                durationMs: config.durationMs,
                sampleRateHz: config.sampleRateHz,
              })],
              timeoutMs: config.durationMs + 15_000,
              maxOutputBytes: MAX_BRIDGE_OUTPUT_BYTES,
            }, captureSignal);
            if (result.code === 42) {
              const partial = artifactFromResponse(responseObject(result.stdout), config.artifactSink.directory);
              await config.artifactSink.record(partial);
              release();
              throw new DeviceLostError(
                "Joulescope disappeared during capture; the partial artifact was preserved.",
                partial,
              );
            }
            if (result.code === 44) {
              throw new JoulescopeInstrumentError(
                "CAPTURE_CONFIG_INVALID",
                "Joulescope rejected the requested sampling configuration.",
              );
            }
            if (result.code !== 0 && result.code !== 43) bridgeFailure(result, "capture");
            const artifact = artifactFromResponse(responseObject(result.stdout), config.artifactSink.directory);
            await config.artifactSink.record(artifact);
            return artifact;
          } catch (error) {
            if (!(error instanceof DeviceLostError)) {
              const partial = await knownPartial(config);
              if (partial) await config.artifactSink.record(partial);
            }
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
