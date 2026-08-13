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
  InstrumentError,
  resolveInstrumentTransport,
  runInstrumentProcess,
  type ProcessResult,
  type ResolvedInstrumentTransport,
} from "../transport.js";

const MAX_CAPTURE_MS = 60_000;
const MAX_BRIDGE_OUTPUT_BYTES = 256 * 1024;
const DEFAULT_LOGIC2_PORT = 10_430;

const CAPABILITIES: InstrumentCapabilities = {
  kind: "logic",
  channels: 16,
  maxSampleRateHz: 500_000_000,
  features: [
    "capture:digital",
    "decode:spi",
    "decode:i2c",
    "decode:uart",
    "decode:can",
    "trigger:edge",
  ],
};

class SaleaeInstrumentError extends InstrumentError {
  constructor(
    readonly code: "CAPTURE_CONFIG_INVALID" | "INSTRUMENT_NOT_FOUND" |
      "INSTRUMENT_NOT_CONFIGURED" | "INSTRUMENT_PROTOCOL_ERROR" | "SESSION_CLOSED",
    message: string,
    options?: ErrorOptions,
  ) {
    super(code, message, options);
  }
}

function validateSaleaeCapture(config: CaptureConfig): void {
  const invalidDuration = !Number.isInteger(config.durationMs) || config.durationMs < 1 ||
    config.durationMs > MAX_CAPTURE_MS;
  const invalidRate = !Number.isInteger(config.sampleRateHz) || config.sampleRateHz < 1 ||
    config.sampleRateHz > (CAPABILITIES.maxSampleRateHz ?? Number.MAX_SAFE_INTEGER);
  const channels = [...new Set(config.channels)];
  const invalidChannels = channels.length === 0 || channels.length !== config.channels.length ||
    channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel >= CAPABILITIES.channels);
  if (invalidDuration || invalidRate || invalidChannels) {
    throw new SaleaeInstrumentError("CAPTURE_CONFIG_INVALID", "Saleae capture settings are outside capability bounds.");
  }
}

// Logic 2 remains user-owned. This bridge only connects to an already-running
// automation server; it never launches or installs the desktop application.
export const SALEAE_BRIDGE = String.raw`
import json, os, signal, sys
from saleae import automation

signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
action = sys.argv[1]
request = json.loads(sys.argv[2])
address = request["address"]
port = request["port"]

with automation.Manager.connect(address=address, port=port, connect_timeout_seconds=3.0) as manager:
    if action == "detect":
        devices = manager.get_devices(include_simulation_devices=False)
        print(json.dumps({"found": len(devices) > 0, "serials": [d.device_id for d in devices]}))
    elif action == "capture":
        out = request["outputDirectory"]
        os.makedirs(out, exist_ok=True)
        device_config = automation.LogicDeviceConfiguration(
            enabled_digital_channels=request["digitalChannels"],
            digital_sample_rate=request["sampleRateHz"],
        )
        capture_config = automation.CaptureConfiguration(
            capture_mode=automation.TimedCaptureMode(duration_seconds=request["durationMs"] / 1000.0)
        )
        with manager.start_capture(
            device_id=request.get("serial"),
            device_configuration=device_config,
            capture_configuration=capture_config,
        ) as capture:
            capture.wait()
            raw_dir = os.path.join(out, "raw")
            os.makedirs(raw_dir, exist_ok=True)
            capture.export_raw_data_csv(directory=raw_dir, digital_channels=request["digitalChannels"])
            saved_capture = os.path.join(out, "capture.sal")
            capture.save_capture(filepath=saved_capture)
            exports = {}
            analyzer_names = {"spi": "SPI", "i2c": "I2C", "uart": "Async Serial", "can": "CAN"}
            for decoder in request.get("decoders", []):
                protocol = decoder["protocol"]
                analyzer = capture.add_analyzer(
                    analyzer_names[protocol],
                    label="finite-state-" + protocol,
                    settings=decoder.get("settings", {}),
                )
                export_path = os.path.join(out, protocol + ".csv")
                capture.export_data_table(filepath=export_path, analyzers=[analyzer])
                exports[protocol] = export_path
            manifest_path = os.path.join(out, "capture.json")
            with open(manifest_path, "w", encoding="utf-8") as handle:
                json.dump({
                    "schema": "finite-state-logic-v1",
                    "vendor": "saleae",
                    "rawCapture": saved_capture,
                    "rawDigitalCsv": os.path.join(raw_dir, "digital.csv"),
                    "decoderExports": exports,
                    "frames": {},
                }, handle)
            print(json.dumps({
                "path": manifest_path,
                "format": "saleae-logic2-manifest-v1",
                "durationMs": request["durationMs"],
                "channels": len(request["digitalChannels"]),
            }))
    else:
        raise ValueError("unsupported action")
`;

export interface SaleaeDecoderConfig {
  protocol: "spi" | "i2c" | "uart" | "can";
  settings: Readonly<Record<string, string | number | boolean>>;
}

export interface SaleaeDriverDeps extends InstrumentDriverDeps {
  decoders?: readonly SaleaeDecoderConfig[];
  registeredSerials?: () => readonly string[];
  serialForDeviceId?: (deviceId: string) => string | null;
}

let cachedPrerequisites: PrerequisiteReport | null = null;

function defaultPrerequisites(): PrerequisiteReport {
  if (cachedPrerequisites !== null) return cachedPrerequisites;
  const sdk = spawnSync("python3", ["-c", "from saleae import automation"], {
    shell: false,
    timeout: 3_000,
    stdio: "ignore",
  });
  const sdkConfigured = sdk.status === 0;
  let appConfigured = false;
  if (sdkConfigured) {
    const app = spawnSync("python3", [
      "-c",
      "from saleae import automation; m=automation.Manager.connect(port=10430, connect_timeout_seconds=1); m.get_app_info(); m.close()",
    ], { shell: false, timeout: 3_000, stdio: "ignore" });
    appConfigured = app.status === 0;
  }
  const needsConfiguration = [
    {
      key: "saleae.logic2-automation",
      configured: sdkConfigured,
      remediation: "Install logic2-automation through the confirmed helper-install flow.",
    },
    {
      key: "saleae.logic2-app",
      configured: appConfigured,
      remediation: "Start Logic 2 and enable its Automation API server (default port 10430).",
    },
  ].filter((item) => !item.configured);
  cachedPrerequisites = { configured: needsConfiguration.length === 0, needsConfiguration };
  return cachedPrerequisites;
}

function endpoint(
  transport: ResolvedInstrumentTransport,
  serial: string | null,
): { address: string; port: number; serial: string } {
  if (serial === null) {
    throw new SaleaeInstrumentError(
      "INSTRUMENT_NOT_FOUND",
      "Saleae capture requires a registry-reconciled serial number; paths and network endpoints are not device identities.",
    );
  }
  return transport.kind === "lan"
    ? { address: transport.host, port: transport.port, serial }
    : { address: "127.0.0.1", port: DEFAULT_LOGIC2_PORT, serial };
}

function detectSerials(
  transport: ResolvedInstrumentTransport,
  deps: SaleaeDriverDeps,
): readonly string[] {
  const serials = transport.kind === "usb"
    ? [endpoint(transport, transport.serial).serial]
    : [...new Set(deps.registeredSerials?.().map((value) => value.trim()).filter(Boolean) ?? [])];
  if (serials.length === 0) endpoint(transport, null);
  return serials;
}

function claimedSerial(
  transport: ResolvedInstrumentTransport,
  claimDeviceId: string,
  deps: SaleaeDriverDeps,
): string {
  const serial = transport.kind === "usb"
    ? transport.serial
    : deps.serialForDeviceId?.(claimDeviceId)?.trim() || null;
  return endpoint(transport, serial).serial;
}

function parseObject(stdout: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(stdout.trim()); } catch (error) {
    throw new SaleaeInstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "Saleae bridge returned malformed JSON.",
      { cause: error },
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SaleaeInstrumentError("INSTRUMENT_PROTOCOL_ERROR", "Saleae bridge returned a non-object response.");
  }
  return Object.fromEntries(Object.entries(parsed));
}

function bridgeFailure(result: ProcessResult, action: string): never {
  const detail = result.stderr.trim().slice(0, 2_000) || `exit ${result.code ?? "unknown"}`;
  const code = /MissingDeviceError|not currently attached/iu.test(detail)
    ? "INSTRUMENT_NOT_FOUND"
    : "INSTRUMENT_NOT_CONFIGURED";
  throw new SaleaeInstrumentError(code, `Saleae ${action} failed: ${detail}`);
}

export function createSaleaeDriver(deps: SaleaeDriverDeps): InstrumentDriver {
  const runner = deps.runner ?? runInstrumentProcess;
  const prerequisites = deps.prerequisiteReport ?? defaultPrerequisites;
  return {
    id: "saleae-logic2",
    async detect(transport) {
      const resolved = resolveInstrumentTransport(transport);
      const serialsToReconcile = detectSerials(resolved, deps);
      const result = await runner({
        command: "python3",
        args: ["-c", SALEAE_BRIDGE, "detect", JSON.stringify(endpoint(resolved, serialsToReconcile[0]!))],
        timeoutMs: 5_000,
        maxOutputBytes: MAX_BRIDGE_OUTPUT_BYTES,
      }, new AbortController().signal);
      if (result.code !== 0) return null;
      const response = parseObject(result.stdout);
      const serials = Array.isArray(response.serials)
        ? response.serials.filter((serial): serial is string => typeof serial === "string")
        : [];
      return response.found === true && serialsToReconcile.some((serial) => serials.includes(serial))
        ? CAPABILITIES
        : null;
    },
    async open(transport, claim, signal) {
      deps.verifyClaim(claim, claim.deviceId);
      signal.throwIfAborted();
      const resolved = resolveInstrumentTransport(transport);
      const serial = claimedSerial(resolved, claim.deviceId, deps);
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
          if (closed) throw new SaleaeInstrumentError("SESSION_CLOSED", "Saleae session is closed.");
          validateSaleaeCapture(config);
          deps.verifyClaim(claim, claim.deviceId);
          captureSignal.throwIfAborted();
          await mkdir(config.artifactSink.directory, { recursive: true });
          const request = {
            ...endpoint(resolved, serial),
            durationMs: config.durationMs,
            sampleRateHz: config.sampleRateHz,
            digitalChannels: config.channels,
            outputDirectory: config.artifactSink.directory,
            decoders: deps.decoders ?? [],
          };
          try {
            const result = await runner({
              command: "python3",
              args: ["-c", SALEAE_BRIDGE, "capture", JSON.stringify(request)],
              timeoutMs: config.durationMs + 15_000,
              maxOutputBytes: MAX_BRIDGE_OUTPUT_BYTES,
            }, captureSignal);
            if (result.code !== 0) bridgeFailure(result, "capture");
            const response = parseObject(result.stdout);
            if (typeof response.path !== "string" || typeof response.format !== "string" ||
                typeof response.durationMs !== "number" || typeof response.channels !== "number") {
              throw new SaleaeInstrumentError(
                "INSTRUMENT_PROTOCOL_ERROR",
                "Saleae bridge omitted capture artifact fields.",
              );
            }
            const artifact = {
              path: join(config.artifactSink.directory, response.path.split(/[\\/]/u).at(-1) ?? "capture.json"),
              format: response.format,
              durationMs: response.durationMs,
              channels: response.channels,
            } satisfies CaptureArtifact;
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
