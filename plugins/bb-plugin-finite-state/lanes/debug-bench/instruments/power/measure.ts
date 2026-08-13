import { createReadStream } from "node:fs";
import { access, copyFile, mkdir, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import type Database from "better-sqlite3";
import {
  attachProbeRunArtifact,
  PROBE_CHANGED_CHANNEL,
  type ProbeChangedHint,
} from "../../probes/runs.js";
import {
  ensureProbeRunArtifactDirectory,
  ProbeStoreError,
  type ProbeRunArtifactDirectory,
} from "../../probes/store.js";
import type {
  CaptureArtifact,
  CaptureArtifactSink,
  InstrumentCapabilities,
  InstrumentDriver,
  InstrumentDriverDeps,
  InstrumentSession,
} from "../driver.js";
import { InstrumentError, validateCaptureConfig } from "../driver.js";
import { runInstrumentProcess } from "../transport.js";
import { createJoulescopeDriver } from "./joulescope.js";
import { createPpk2Driver } from "./ppk2.js";
import {
  PowerCorrelationError,
  type EventMark,
  type MeasurementSummary,
  validateEventMarks,
  windowBetweenMarks,
} from "./correlate.js";

export interface PowerCapture extends CaptureArtifact {
  sampleRateHz: number;
  mode: "source" | "ampere";
  calibration: Record<string, string>;
  truncated: boolean;
}

interface BaseMeasureConfig {
  sampleRateHz: number;
  mode: "source" | "ampere";
  artifactSink: CaptureArtifactSink;
  buildDigest: string | null;
  marks: readonly EventMark[];
}

export interface SleepMeasureConfig extends BaseMeasureConfig {
  settleMs: number;
  measureMs: number;
  unit: "uA" | "mA";
}

export interface BootEnergyConfig extends BaseMeasureConfig {
  durationMs: number;
  fromMarkLabel: string;
  bootCompleteMarkLabel: string;
  voltageMv: number;
  unit: "uJ" | "mJ";
}

export type ActiveDrawWindow =
  | { kind: "time"; fromMs: number; toMs: number }
  | { kind: "marks"; fromMarkLabel: string; toMarkLabel: string };

export interface ActiveDrawConfig extends BaseMeasureConfig {
  durationMs: number;
  window: ActiveDrawWindow;
  unit: "uA" | "mA";
}

interface CurrentSample {
  atMs: number;
  currentUa: number;
}

const MAX_MEASUREMENT_SAMPLES = 5_000_000;

export interface PowerProbeRunArtifactSinkOptions {
  db: Database.Database;
  worktreeRoot: string;
  projectId: string;
  projectVersionId: string | null;
  runId: string;
  publishChanged?: (
    channel: typeof PROBE_CHANGED_CHANNEL,
    hint: ProbeChangedHint,
  ) => void;
}

export async function createPowerProbeRunArtifactSink(
  options: PowerProbeRunArtifactSinkOptions,
): Promise<CaptureArtifactSink> {
  let layout: ProbeRunArtifactDirectory;
  try {
    layout = await ensureProbeRunArtifactDirectory(options.worktreeRoot, options.runId, "power");
  } catch (error) {
    if (error instanceof ProbeStoreError) {
      throw new InstrumentError(
        error.code === "BENCH_ARTIFACT_ROOT_NOT_IGNORED"
          ? "INSTRUMENT_NOT_CONFIGURED"
          : "CAPTURE_CONFIG_INVALID",
        error.message,
        { cause: error },
      );
    }
    throw error;
  }
  const { worktreeRoot, directory } = layout;
  const prefix = `${directory}${sep}`;

  return {
    directory,
    async record(artifact) {
      const artifactPath = await realpath(resolve(artifact.path));
      if (!artifactPath.startsWith(prefix)) {
        throw new InstrumentError(
          "INSTRUMENT_PROTOCOL_ERROR",
          "Power artifact escaped its probe-run directory.",
        );
      }
      await access(artifactPath);
      const relativePath = relative(worktreeRoot, artifactPath).split(sep).join("/");
      let changed: boolean;
      try {
        changed = attachProbeRunArtifact(options.db, options, options.runId, relativePath);
      } catch (error) {
        throw new InstrumentError(
          "INSTRUMENT_PROTOCOL_ERROR",
          `Could not attach power artifact to probe run ${options.runId}.`,
          { cause: error },
        );
      }
      if (changed) {
        options.publishChanged?.(PROBE_CHANGED_CHANNEL, {
          projectId: options.projectId,
          projectVersionId: options.projectVersionId,
          runId: options.runId,
        });
      }
    },
  };
}

function isPowerCapture(artifact: CaptureArtifact): artifact is PowerCapture {
  const value: object = artifact;
  const sampleRateHz = Reflect.get(value, "sampleRateHz");
  const mode = Reflect.get(value, "mode");
  const calibration = Reflect.get(value, "calibration");
  const truncated = Reflect.get(value, "truncated");
  return typeof sampleRateHz === "number" && (mode === "source" || mode === "ampere") &&
    typeof calibration === "object" && calibration !== null && !Array.isArray(calibration) &&
    typeof truncated === "boolean";
}

async function readCurrentSamples(path: string, signal: AbortSignal): Promise<CurrentSample[]> {
  signal.throwIfAborted();
  const input = createReadStream(path, { encoding: "utf8" });
  const onAbort = () => input.destroy(signal.reason instanceof Error ? signal.reason : undefined);
  signal.addEventListener("abort", onAbort, { once: true });
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  const samples: CurrentSample[] = [];
  let header = true;
  try {
    for await (const line of lines) {
      signal.throwIfAborted();
      if (header) {
        header = false;
        if (line.trim() !== "at_ms,current_ua") {
          throw new InstrumentError(
            "INSTRUMENT_PROTOCOL_ERROR",
            "Power trace must begin with at_ms,current_ua.",
          );
        }
        continue;
      }
      if (line.trim().length === 0) continue;
      const fields = line.split(",");
      const atMs = Number(fields[0]);
      const currentUa = Number(fields[1]);
      if (fields.length !== 2 || !Number.isFinite(atMs) || atMs < 0 ||
          !Number.isFinite(currentUa) || (samples.at(-1)?.atMs ?? -1) >= atMs) {
        throw new InstrumentError(
          "INSTRUMENT_PROTOCOL_ERROR",
          "Power trace samples must be finite and strictly time ordered.",
        );
      }
      samples.push({ atMs, currentUa });
      if (samples.length > MAX_MEASUREMENT_SAMPLES) {
        throw new InstrumentError(
          "INSTRUMENT_PROTOCOL_ERROR",
          `Power trace exceeds the ${MAX_MEASUREMENT_SAMPLES}-sample analysis bound.`,
        );
      }
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    lines.close();
    input.destroy();
  }
  if (header || samples.length === 0) {
    throw new InstrumentError("INSTRUMENT_PROTOCOL_ERROR", "Power trace contains no samples.");
  }
  return samples;
}

function selectedSamples(
  samples: readonly CurrentSample[],
  window: { fromMs: number; toMs: number },
): CurrentSample[] {
  if (!Number.isFinite(window.fromMs) || !Number.isFinite(window.toMs) ||
      window.fromMs < 0 || window.toMs <= window.fromMs) {
    throw new PowerCorrelationError("INCOMPLETE_WINDOW", "Measurement window is invalid.");
  }
  const selected = samples.filter((sample) =>
    sample.atMs >= window.fromMs && sample.atMs <= window.toMs);
  if (selected.length === 0) {
    throw new PowerCorrelationError("INCOMPLETE_WINDOW", "Measurement window contains no samples.");
  }
  return selected;
}

function percentile(sorted: readonly number[], percentileValue: number): number {
  const rank = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[Math.min(rank, sorted.length - 1)]!;
}

function currentStatistics(
  samples: readonly CurrentSample[],
  unit: "uA" | "mA",
): MeasurementSummary["stats"] {
  const divisor = unit === "uA" ? 1 : 1_000;
  const values = samples.map((sample) => sample.currentUa / divisor).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 === 0
    ? (values[middle - 1]! + values[middle]!) / 2
    : values[middle]!;
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median,
    p99: percentile(values, 0.99),
    unit,
  };
}

async function capturePower(
  session: InstrumentSession,
  config: BaseMeasureConfig,
  durationMs: number,
  signal: AbortSignal,
  extraSettings: Readonly<Record<string, string | number | boolean | null>> = {},
): Promise<{ capture: PowerCapture; samples: CurrentSample[]; marks: EventMark[] }> {
  const marks = validateEventMarks(config.marks);
  const artifact = await session.capture({
    durationMs,
    sampleRateHz: config.sampleRateHz,
    channels: [0],
    settings: { mode: config.mode, ...extraSettings },
    artifactSink: config.artifactSink,
  }, signal);
  if (!isPowerCapture(artifact)) {
    throw new InstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "Power driver returned an artifact without power capture metadata.",
    );
  }
  if (artifact.truncated) {
    throw new PowerCorrelationError("INCOMPLETE_WINDOW", "Power capture was truncated.");
  }
  return { capture: artifact, samples: await readCurrentSamples(artifact.path, signal), marks };
}

export async function measureSleepCurrent(
  session: InstrumentSession,
  config: SleepMeasureConfig,
  signal: AbortSignal,
): Promise<MeasurementSummary> {
  if (!Number.isInteger(config.settleMs) || config.settleMs < 0 ||
      !Number.isInteger(config.measureMs) || config.measureMs < 1) {
    throw new PowerCorrelationError("INCOMPLETE_WINDOW", "Sleep settle and measurement durations are invalid.");
  }
  const window = { fromMs: config.settleMs, toMs: config.settleMs + config.measureMs };
  const result = await capturePower(session, config, window.toMs, signal);
  return {
    kind: "sleep_current",
    window,
    stats: currentStatistics(selectedSamples(result.samples, window), config.unit),
    artifactPath: result.capture.path,
    buildDigest: config.buildDigest,
    marks: result.marks,
  };
}

function integrateEnergyUj(samples: readonly CurrentSample[], voltageMv: number): number {
  if (!Number.isFinite(voltageMv) || voltageMv <= 0) {
    throw new PowerCorrelationError("INCOMPLETE_WINDOW", "Boot energy voltage must be positive.");
  }
  if (samples.length < 2) {
    throw new PowerCorrelationError("INCOMPLETE_WINDOW", "Boot energy needs at least two samples.");
  }
  let microJoules = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1]!;
    const current = samples[index]!;
    const averageUa = (previous.currentUa + current.currentUa) / 2;
    microJoules += averageUa * voltageMv * (current.atMs - previous.atMs) / 1_000_000;
  }
  return microJoules;
}

export async function measureBootEnergy(
  session: InstrumentSession,
  config: BootEnergyConfig,
  signal: AbortSignal,
): Promise<MeasurementSummary> {
  const marks = validateEventMarks(config.marks);
  const window = windowBetweenMarks(marks, config.fromMarkLabel, config.bootCompleteMarkLabel);
  if (window.toMs > config.durationMs) {
    throw new PowerCorrelationError("INCOMPLETE_WINDOW", "Boot-complete mark is outside capture duration.");
  }
  const result = await capturePower(session, { ...config, marks }, config.durationMs, signal, {
    voltageMv: config.voltageMv,
  });
  const energyUj = integrateEnergyUj(selectedSamples(result.samples, window), config.voltageMv);
  const energy = config.unit === "uJ" ? energyUj : energyUj / 1_000;
  return {
    kind: "boot_energy",
    window,
    stats: { mean: energy, median: energy, p99: energy, unit: config.unit },
    artifactPath: result.capture.path,
    buildDigest: config.buildDigest,
    marks: result.marks,
  };
}

export async function measureActiveDraw(
  session: InstrumentSession,
  config: ActiveDrawConfig,
  signal: AbortSignal,
): Promise<MeasurementSummary> {
  const marks = validateEventMarks(config.marks);
  const window = config.window.kind === "time"
    ? { fromMs: config.window.fromMs, toMs: config.window.toMs }
    : windowBetweenMarks(marks, config.window.fromMarkLabel, config.window.toMarkLabel);
  if (window.toMs > config.durationMs) {
    throw new PowerCorrelationError("INCOMPLETE_WINDOW", "Active window is outside capture duration.");
  }
  const result = await capturePower(session, { ...config, marks }, config.durationMs, signal);
  return {
    kind: "active_draw",
    window,
    stats: currentStatistics(selectedSamples(result.samples, window), config.unit),
    artifactPath: result.capture.path,
    buildDigest: config.buildDigest,
    marks: result.marks,
  };
}

export interface ReplayPowerDriverOptions extends InstrumentDriverDeps {
  fixturePath: string;
  id?: string;
}

const REPLAY_POWER_CAPABILITIES: InstrumentCapabilities = {
  kind: "power",
  channels: 1,
  maxSampleRateHz: 100_000,
  features: ["capture:replay", "measure:current", "measure:energy"],
};

function captureMode(settings: Readonly<Record<string, string | number | boolean | null>> | undefined): "source" | "ampere" {
  const mode = settings?.mode;
  if (mode !== "source" && mode !== "ampere") {
    throw new InstrumentError("CAPTURE_CONFIG_INVALID", "Power capture mode must be source or ampere.");
  }
  return mode;
}

export function createReplayPowerDriver(options: ReplayPowerDriverOptions): InstrumentDriver {
  return {
    id: options.id ?? "replay-power-fixture",
    async detect(transport) {
      return transport.kind === "bb-host" ? null : REPLAY_POWER_CAPABILITIES;
    },
    async open(_transport, claim, signal) {
      options.verifyClaim(claim, claim.deviceId);
      signal.throwIfAborted();
      let closed = false;
      let released = false;
      const release = () => {
        closed = true;
        if (!released) {
          released = true;
          options.releaseClaim?.(claim);
        }
      };
      signal.addEventListener("abort", release, { once: true });
      return {
        deviceId: claim.deviceId,
        capabilities: REPLAY_POWER_CAPABILITIES,
        async capture(config, captureSignal) {
          if (closed) throw new InstrumentError("SESSION_CLOSED", "Power replay session is closed.");
          validateCaptureConfig(config, REPLAY_POWER_CAPABILITIES, 60_000);
          const mode = captureMode(config.settings);
          options.verifyClaim(claim, claim.deviceId);
          captureSignal.throwIfAborted();
          await mkdir(config.artifactSink.directory, { recursive: true });
          const path = join(config.artifactSink.directory, "power-trace.csv");
          try {
            await copyFile(options.fixturePath, path);
            captureSignal.throwIfAborted();
            const artifact = {
              path,
              format: "finite-state-power-csv-v1",
              durationMs: config.durationMs,
              channels: 1,
              sampleRateHz: config.sampleRateHz,
              mode,
              calibration: { fixture: "original" },
              truncated: false,
            } satisfies PowerCapture;
            await config.artifactSink.record(artifact);
            return artifact;
          } catch (error) {
            release();
            throw error;
          }
        },
        async close() {
          signal.removeEventListener("abort", release);
          release();
        },
      };
    },
    prerequisites() { return { configured: true, needsConfiguration: [] }; },
  };
}

const refuseUnwiredClaim = (): never => {
  throw new InstrumentError(
    "CLAIM_VERIFIER_NOT_CONFIGURED",
    "The power driver must be constructed with the registry claim verifier.",
  );
};

const defaultReplayFixture = fileURLToPath(new URL("./fixtures/known-trace.csv", import.meta.url));

export const powerDrivers: readonly InstrumentDriver[] = Object.freeze([
  createPpk2Driver({ verifyClaim: refuseUnwiredClaim }),
  createJoulescopeDriver({ verifyClaim: refuseUnwiredClaim }),
  createReplayPowerDriver({
    verifyClaim: refuseUnwiredClaim,
    runner: runInstrumentProcess,
    fixturePath: defaultReplayFixture,
  }),
]);

export type { BaselineDelta, MeasurementSummary, PowerDeps } from "./correlate.js";
export { compareToBaseline } from "./correlate.js";
