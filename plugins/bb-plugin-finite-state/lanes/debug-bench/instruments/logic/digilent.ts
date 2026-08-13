import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  CaptureArtifact,
  CaptureConfig,
  InstrumentCapabilities,
  InstrumentDriver,
  InstrumentDriverDeps,
  PrerequisiteReport,
} from "../driver.js";
import {
  DeviceLostError,
  InstrumentError,
  resolveInstrumentTransport,
  runInstrumentProcess,
  type ProcessResult,
  TransportError,
} from "../transport.js";

const MAX_CAPTURE_MS = 60_000;
const MAX_CAPTURE_SAMPLES = 5_000_000;
const MAX_BRIDGE_OUTPUT_BYTES = 256 * 1024;

const CAPABILITIES: InstrumentCapabilities = {
  kind: "logic",
  channels: 32,
  maxSampleRateHz: 100_000_000,
  features: [
    "capture:digital",
    "trigger:edge",
  ],
};

class DigilentInstrumentError extends InstrumentError {
  constructor(
    readonly code: "CAPTURE_CONFIG_INVALID" | "DEVICE_LOST" | "INSTRUMENT_NOT_FOUND" |
      "INSTRUMENT_NOT_CONFIGURED" | "INSTRUMENT_PROTOCOL_ERROR" | "SESSION_CLOSED",
    message: string,
    options?: ErrorOptions,
  ) {
    super(code, message, options);
  }
}

function validateDigilentCapture(config: CaptureConfig): void {
  const invalidDuration = !Number.isInteger(config.durationMs) || config.durationMs < 1 ||
    config.durationMs > MAX_CAPTURE_MS;
  const invalidRate = !Number.isInteger(config.sampleRateHz) || config.sampleRateHz < 1 ||
    config.sampleRateHz > (CAPABILITIES.maxSampleRateHz ?? Number.MAX_SAFE_INTEGER);
  const channels = [...new Set(config.channels)];
  const invalidChannels = channels.length === 0 || channels.length !== config.channels.length ||
    channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel >= CAPABILITIES.channels);
  if (invalidDuration || invalidRate || invalidChannels) {
    throw new DigilentInstrumentError("CAPTURE_CONFIG_INVALID", "Digilent capture settings are outside capability bounds.");
  }
}

export const DIGILENT_BRIDGE = String.raw`
import json, os, signal, sys
import dwfpy as dwf

signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
action = sys.argv[1]
request = json.loads(sys.argv[2])

if action == "detect":
    devices = dwf.Device.enumerate()
    print(json.dumps({"found": len(devices) > 0, "serials": [d.serial_number for d in devices]}))
elif action == "capture":
    out = request["outputDirectory"]
    os.makedirs(out, exist_ok=True)
    samples = []
    try:
        with dwf.Device(serial_number=request.get("serial")) as device:
            recorder = device.digital_input.record(
                sample_rate=request["sampleRateHz"],
                sample_count=request["sampleCount"],
                configure=True,
                start=True,
            )
            samples = [int(value) for value in recorder.data_samples]
        raw_path = os.path.join(out, "digital-samples.json")
        with open(raw_path, "w", encoding="utf-8") as handle:
            json.dump(samples, handle)
        manifest_path = os.path.join(out, "capture.json")
        with open(manifest_path, "w", encoding="utf-8") as handle:
            json.dump({
                "schema": "finite-state-logic-v1",
                "vendor": "digilent",
                "sampleRateHz": request["sampleRateHz"],
                "rawSamples": raw_path,
                "decoderExports": {},
                "frames": {},
                "partial": False,
            }, handle)
        print(json.dumps({
            "path": manifest_path,
            "format": "digilent-dwf-manifest-v1",
            "durationMs": request["durationMs"],
            "channels": len(request["digitalChannels"]),
            "partial": False,
        }))
    except Exception as error:
        partial_path = os.path.join(out, "partial-capture.json")
        with open(partial_path, "w", encoding="utf-8") as handle:
            json.dump({
                "schema": "finite-state-logic-v1",
                "vendor": "digilent",
                "sampleRateHz": request["sampleRateHz"],
                "samples": samples,
                "frames": {},
                "partial": True,
                "error": str(error),
            }, handle)
        print(json.dumps({
            "path": partial_path,
            "format": "digilent-dwf-partial-v1",
            "durationMs": request["durationMs"],
            "channels": len(request["digitalChannels"]),
            "partial": True,
        }))
        sys.exit(42)
else:
    raise ValueError("unsupported action")
`;

export interface DigilentDriverDeps extends InstrumentDriverDeps {
  registeredSerials?: () => readonly string[];
}

let cachedPrerequisites: PrerequisiteReport | null = null;

function defaultPrerequisites(): PrerequisiteReport {
  if (cachedPrerequisites !== null) return cachedPrerequisites;
  const packageProbe = spawnSync("python3", [
    "-c",
    "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('dwfpy') else 1)",
  ], { shell: false, timeout: 3_000, stdio: "ignore" });
  const sdkConfigured = packageProbe.status === 0;
  let runtimeConfigured = false;
  if (sdkConfigured) {
    const runtimeProbe = spawnSync("python3", [
      "-c",
      "import dwfpy as dwf; dwf.Device.enumerate()",
    ], { shell: false, timeout: 3_000, stdio: "ignore" });
    runtimeConfigured = runtimeProbe.status === 0;
  }
  const needsConfiguration = [
    {
      key: "digilent.dwfpy",
      configured: sdkConfigured,
      remediation: "Install dwfpy through the confirmed helper-install flow.",
    },
    {
      key: "digilent.waveforms-runtime",
      configured: runtimeConfigured,
      remediation: "Install the Digilent WaveForms application/runtime from Digilent.",
    },
  ].filter((item) => !item.configured);
  const report = { configured: needsConfiguration.length === 0, needsConfiguration };
  // Runtime/package remediation must become visible without restarting bb.
  // Cache only a fully configured result; every negative result is retried.
  if (report.configured) cachedPrerequisites = report;
  return report;
}

function parseObject(stdout: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(stdout.trim()); } catch (error) {
    throw new DigilentInstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "Digilent bridge returned malformed JSON.",
      { cause: error },
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new DigilentInstrumentError("INSTRUMENT_PROTOCOL_ERROR", "Digilent bridge returned a non-object response.");
  }
  return Object.fromEntries(Object.entries(parsed));
}

function responseArtifact(
  response: Record<string, unknown>,
  directory: string,
): CaptureArtifact {
  if (typeof response.path !== "string" || typeof response.format !== "string" ||
      typeof response.durationMs !== "number" || typeof response.channels !== "number") {
    throw new DigilentInstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "Digilent bridge omitted capture artifact fields.",
    );
  }
  return {
    path: join(directory, response.path.split(/[\\/]/u).at(-1) ?? "capture.json"),
    format: response.format,
    durationMs: response.durationMs,
    channels: response.channels,
  };
}

function bridgeFailure(result: ProcessResult, action: string): never {
  const detail = result.stderr.trim().slice(0, 2_000) || `exit ${result.code ?? "unknown"}`;
  throw new DigilentInstrumentError(
    /DeviceNotFound|not found|disconnected/iu.test(detail)
      ? "INSTRUMENT_NOT_FOUND"
      : "INSTRUMENT_NOT_CONFIGURED",
    `Digilent ${action} failed: ${detail}`,
  );
}

export function createDigilentLogicDriver(deps: DigilentDriverDeps): InstrumentDriver {
  const runner = deps.runner ?? runInstrumentProcess;
  const prerequisites = deps.prerequisiteReport ?? defaultPrerequisites;
  return {
    id: "digilent-dwf",
    async detect(transport) {
      const resolved = resolveInstrumentTransport(transport);
      if (resolved.kind === "lan") {
        throw new TransportError(
          "TRANSPORT_NOT_IMPLEMENTED",
          "Digilent DWF network transport is not implemented in v1; use a host-local USB device.",
        );
      }
      if (resolved.serial === null) {
        throw new DigilentInstrumentError(
          "INSTRUMENT_NOT_FOUND",
          "Digilent USB capture requires the registry-reconciled serial number.",
        );
      }
      const result = await runner({
        command: "python3",
        args: ["-c", DIGILENT_BRIDGE, "detect", "{}"],
        timeoutMs: 5_000,
        maxOutputBytes: MAX_BRIDGE_OUTPUT_BYTES,
      }, new AbortController().signal);
      if (result.code !== 0) return null;
      const response = parseObject(result.stdout);
      const serials = Array.isArray(response.serials)
        ? response.serials.filter((serial): serial is string => typeof serial === "string")
        : [];
      const registered = deps.registeredSerials?.() ?? [];
      return serials.includes(resolved.serial) && registered.includes(resolved.serial)
        ? CAPABILITIES
        : null;
    },
    async open(transport, claim, signal) {
      deps.verifyClaim(claim, claim.deviceId);
      signal.throwIfAborted();
      const resolved = resolveInstrumentTransport(transport);
      if (resolved.kind === "lan") {
        throw new TransportError(
          "TRANSPORT_NOT_IMPLEMENTED",
          "Digilent DWF network transport is not implemented in v1; use a host-local USB device.",
        );
      }
      if (resolved.serial === null) {
        throw new DigilentInstrumentError(
          "INSTRUMENT_NOT_FOUND",
          "Digilent USB capture requires the registry-reconciled serial number.",
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
          if (closed) throw new DigilentInstrumentError("SESSION_CLOSED", "Digilent session is closed.");
          validateDigilentCapture(config);
          const sampleCount = Math.ceil(config.sampleRateHz * config.durationMs / 1_000);
          if (sampleCount > MAX_CAPTURE_SAMPLES) {
            throw new DigilentInstrumentError(
              "CAPTURE_CONFIG_INVALID",
              `Digilent capture exceeds the ${MAX_CAPTURE_SAMPLES}-sample bound.`,
            );
          }
          deps.verifyClaim(claim, claim.deviceId);
          captureSignal.throwIfAborted();
          await mkdir(config.artifactSink.directory, { recursive: true });
          const serial = resolved.serial;
          try {
            const result = await runner({
              command: "python3",
              args: ["-c", DIGILENT_BRIDGE, "capture", JSON.stringify({
                serial,
                durationMs: config.durationMs,
                sampleRateHz: config.sampleRateHz,
                sampleCount,
                digitalChannels: config.channels,
                outputDirectory: config.artifactSink.directory,
              })],
              timeoutMs: config.durationMs + 15_000,
              maxOutputBytes: MAX_BRIDGE_OUTPUT_BYTES,
            }, captureSignal);
            if (result.code === 42) {
              const partial = responseArtifact(parseObject(result.stdout), config.artifactSink.directory);
              await config.artifactSink.record(partial);
              release();
              throw new DeviceLostError(
                "Digilent device disappeared during capture; the partial artifact was preserved.",
                partial,
              );
            }
            if (result.code !== 0) bridgeFailure(result, "capture");
            const artifact = responseArtifact(parseObject(result.stdout), config.artifactSink.directory);
            await config.artifactSink.record(artifact);
            return artifact;
          } catch (error) {
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
