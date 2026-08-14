import { access, copyFile, mkdir, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
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
} from "../driver.js";
import { InstrumentError, validateCaptureConfig } from "../driver.js";
import type { EventMark } from "../power/correlate.js";
import { validateEventMarks, windowBetweenMarks } from "../power/correlate.js";
import { createPicoScopeDriver } from "./picoscope.js";
import { createScpiScopeDriver } from "./scpi.js";

export interface ScopeChannelConfig {
  channel: string;
  rangeV: number;
  coupling: "ac" | "dc";
  attenuation: number;
}

export interface ScopeTrigger {
  channel: string;
  edge: "rising" | "falling";
  levelV: number;
}

export interface ScopeCapture extends CaptureArtifact {
  channelConfigs: ScopeChannelConfig[];
  trigger: ScopeTrigger | null;
  sampleRateHz: number;
  samples: number;
}

export interface WaveformData {
  readonly sampleRateHz: number;
  readonly channels: Readonly<Record<string, readonly number[]>>;
}

export type WaveformMeasurementKind =
  | "rise_time"
  | "fall_time"
  | "overshoot"
  | "undershoot"
  | "vpp_ripple"
  | "rail_droop"
  | "stats";

export interface WaveformMeasurement {
  kind: WaveformMeasurementKind;
  channel: string;
  value: number;
  unit: "ns" | "us" | "mV" | "V" | "pct";
  window: { fromMs: number; toMs: number } | null;
  artifactPath: string;
}

export interface MeasurementRequest {
  channels: readonly string[];
  kinds: readonly WaveformMeasurementKind[];
  thresholds?: { lowPct: number; highPct: number };
  window?: { fromMs: number; toMs: number };
  marks?: readonly EventMark[];
  baselineMarks?: { from: string; to: string };
  loadedMarks?: { from: string; to: string };
}

export interface PreviewPoint {
  channel: string;
  fromSample: number;
  toSample: number;
  minV: number;
  maxV: number;
}

export interface PreviewSeries {
  items: PreviewPoint[];
  total: number;
  cursor: null;
}

interface StoredWaveform {
  schema: "finite-state-scope-v1";
  sampleRateHz: number;
  channels: Record<string, number[]>;
}

const MAX_ANALYSIS_SAMPLES = 10_000_000;
const REPLAY_CAPABILITIES: InstrumentCapabilities = {
  kind: "scope",
  channels: 4,
  maxSampleRateHz: 1_000_000_000,
  features: ["capture:replay", "trigger:edge", "measure:analog-integrity"],
};

export interface ScopeProbeRunArtifactSinkOptions {
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

export async function createScopeProbeRunArtifactSink(
  options: ScopeProbeRunArtifactSinkOptions,
): Promise<CaptureArtifactSink> {
  let layout: ProbeRunArtifactDirectory;
  try {
    layout = await ensureProbeRunArtifactDirectory(
      options.worktreeRoot,
      options.runId,
      "scope",
    );
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
        throw protocolError("Scope artifact escaped its probe-run directory.");
      }
      await access(artifactPath);
      const relativePath = relative(worktreeRoot, artifactPath)
        .split(sep)
        .join("/");
      let changed: boolean;
      try {
        changed = attachProbeRunArtifact(
          options.db,
          options,
          options.runId,
          relativePath,
        );
      } catch (error) {
        throw protocolError(
          `Could not attach scope artifact to probe run ${options.runId}.`,
          error,
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

function protocolError(message: string, cause?: unknown): InstrumentError {
  return new InstrumentError(
    "INSTRUMENT_PROTOCOL_ERROR",
    message,
    cause === undefined ? undefined : { cause },
  );
}

function parseWaveform(value: unknown): StoredWaveform {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Reflect.get(value, "schema") !== "finite-state-scope-v1"
  ) {
    throw protocolError("Scope artifact has an unsupported schema.");
  }
  const sampleRateHz = Reflect.get(value, "sampleRateHz");
  const rawChannels = Reflect.get(value, "channels");
  if (
    !Number.isFinite(sampleRateHz) ||
    sampleRateHz <= 0 ||
    typeof rawChannels !== "object" ||
    rawChannels === null ||
    Array.isArray(rawChannels)
  ) {
    throw protocolError("Scope artifact metadata is malformed.");
  }
  const channels: Record<string, number[]> = {};
  let samples: number | null = null;
  for (const [channel, rawValues] of Object.entries(rawChannels)) {
    if (
      !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/u.test(channel) ||
      !Array.isArray(rawValues) ||
      rawValues.length === 0 ||
      rawValues.length > MAX_ANALYSIS_SAMPLES ||
      rawValues.some(
        (sample) => typeof sample !== "number" || !Number.isFinite(sample),
      )
    ) {
      throw protocolError(
        "Scope artifact channel data is malformed or exceeds the analysis bound.",
      );
    }
    if (samples !== null && samples !== rawValues.length) {
      throw protocolError(
        "Scope artifact channels have inconsistent sample counts.",
      );
    }
    samples = rawValues.length;
    channels[channel] = [...rawValues];
  }
  if (Object.keys(channels).length === 0)
    throw protocolError("Scope artifact contains no channels.");
  return { schema: "finite-state-scope-v1", sampleRateHz, channels };
}

export async function readWaveformData(path: string): Promise<WaveformData> {
  if (!isAbsolute(path))
    throw protocolError("Scope artifact path must be absolute.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw protocolError("Scope artifact is not valid JSON.", error);
  }
  return parseWaveform(parsed);
}

function validateCapture(capture: ScopeCapture, data: WaveformData): void {
  const lengths = Object.values(data.channels).map((values) => values.length);
  if (
    capture.sampleRateHz !== data.sampleRateHz ||
    lengths.some((length) => length !== capture.samples) ||
    capture.channels !== Object.keys(data.channels).length ||
    capture.channelConfigs.some((config) => !(config.channel in data.channels))
  ) {
    throw protocolError("Scope capture metadata does not match its artifact.");
  }
}

function indicesForWindow(
  data: WaveformData,
  window: { fromMs: number; toMs: number } | undefined,
): {
  from: number;
  to: number;
  window: { fromMs: number; toMs: number } | null;
} {
  const samples = Object.values(data.channels)[0]!.length;
  if (window === undefined) return { from: 0, to: samples, window: null };
  if (
    !Number.isFinite(window.fromMs) ||
    !Number.isFinite(window.toMs) ||
    window.fromMs < 0 ||
    window.toMs <= window.fromMs
  ) {
    throw new InstrumentError(
      "CAPTURE_CONFIG_INVALID",
      "Waveform measurement window is invalid.",
    );
  }
  const from = Math.max(
    0,
    Math.ceil((window.fromMs * data.sampleRateHz) / 1_000),
  );
  const to = Math.min(
    samples,
    Math.floor((window.toMs * data.sampleRateHz) / 1_000) + 1,
  );
  if (from >= to)
    throw new InstrumentError(
      "CAPTURE_CONFIG_INVALID",
      "Waveform measurement window contains no samples.",
    );
  return { from, to, window: { ...window } };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function moments(values: readonly number[]): {
  minimum: number;
  maximum: number;
  mean: number;
  rms: number;
} {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let squareSum = 0;
  for (const value of values) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
    sum += value;
    squareSum += value * value;
  }
  return {
    minimum,
    maximum,
    mean: sum / values.length,
    rms: Math.sqrt(squareSum / values.length),
  };
}

function endpointLevels(values: readonly number[]): {
  low: number;
  high: number;
  rising: boolean;
} {
  const width = Math.max(1, Math.floor(values.length / 10));
  const start = mean(values.slice(0, width));
  const end = mean(values.slice(-width));
  return start <= end
    ? { low: start, high: end, rising: true }
    : { low: end, high: start, rising: false };
}

function crossingIndex(
  values: readonly number[],
  level: number,
  rising: boolean,
): number | null {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1]!;
    const current = values[index]!;
    const crossed = rising
      ? previous < level && current >= level
      : previous > level && current <= level;
    if (!crossed) continue;
    if (current === previous) return index;
    return index - 1 + (level - previous) / (current - previous);
  }
  return null;
}

function edgeTime(
  values: readonly number[],
  sampleRateHz: number,
  lowPct: number,
  highPct: number,
  rising: boolean,
): { value: number; unit: "ns" | "us" } {
  const levels = endpointLevels(values);
  const span = levels.high - levels.low;
  if (!(span > 0))
    throw new InstrumentError(
      "CAPTURE_CONFIG_INVALID",
      "Waveform has no measurable edge span.",
    );
  const firstLevel = levels.low + (span * (rising ? lowPct : highPct)) / 100;
  const secondLevel = levels.low + (span * (rising ? highPct : lowPct)) / 100;
  const first = crossingIndex(values, firstLevel, rising);
  const second = crossingIndex(values, secondLevel, rising);
  if (first === null || second === null || second <= first) {
    throw new InstrumentError(
      "CAPTURE_CONFIG_INVALID",
      `Waveform contains no measurable ${rising ? "rising" : "falling"} edge.`,
    );
  }
  const nanoseconds = ((second - first) / sampleRateHz) * 1_000_000_000;
  return nanoseconds >= 1_000
    ? { value: nanoseconds / 1_000, unit: "us" }
    : { value: nanoseconds, unit: "ns" };
}

function measurement(
  capture: ScopeCapture,
  kind: WaveformMeasurementKind,
  channel: string,
  value: number,
  unit: WaveformMeasurement["unit"],
  window: WaveformMeasurement["window"],
): WaveformMeasurement {
  return { kind, channel, value, unit, window, artifactPath: capture.path };
}

function measureRailDroop(
  capture: ScopeCapture,
  channel: string,
  values: readonly number[],
  data: WaveformData,
  request: MeasurementRequest,
): WaveformMeasurement {
  const marks = validateEventMarks(request.marks ?? []);
  if (!request.baselineMarks || !request.loadedMarks) {
    throw new InstrumentError(
      "CAPTURE_CONFIG_INVALID",
      "Rail droop requires baseline and loaded event-mark windows.",
    );
  }
  const baselineWindow = windowBetweenMarks(
    marks,
    request.baselineMarks.from,
    request.baselineMarks.to,
  );
  const loadedWindow = windowBetweenMarks(
    marks,
    request.loadedMarks.from,
    request.loadedMarks.to,
  );
  const baseline = indicesForWindow(data, baselineWindow);
  const loaded = indicesForWindow(data, loadedWindow);
  const droopV =
    mean(values.slice(baseline.from, baseline.to)) -
    mean(values.slice(loaded.from, loaded.to));
  return measurement(
    capture,
    "rail_droop",
    channel,
    droopV * 1_000,
    "mV",
    loadedWindow,
  );
}

export async function measureWaveform(
  capture: ScopeCapture,
  request: MeasurementRequest,
): Promise<WaveformMeasurement[]> {
  const data = await readWaveformData(capture.path);
  validateCapture(capture, data);
  const channels = [...new Set(request.channels)];
  const kinds = [...new Set(request.kinds)];
  if (
    channels.length === 0 ||
    channels.length !== request.channels.length ||
    kinds.length === 0 ||
    kinds.length !== request.kinds.length
  ) {
    throw new InstrumentError(
      "CAPTURE_CONFIG_INVALID",
      "Measurement channels and kinds must be non-empty and unique.",
    );
  }
  const thresholds = request.thresholds ?? { lowPct: 10, highPct: 90 };
  if (
    !Number.isFinite(thresholds.lowPct) ||
    !Number.isFinite(thresholds.highPct) ||
    thresholds.lowPct < 0 ||
    thresholds.highPct > 100 ||
    thresholds.lowPct >= thresholds.highPct
  ) {
    throw new InstrumentError(
      "CAPTURE_CONFIG_INVALID",
      "Edge thresholds must be ordered percentages from 0 to 100.",
    );
  }
  const selected = indicesForWindow(data, request.window);
  const results: WaveformMeasurement[] = [];
  for (const channel of channels) {
    const allValues = data.channels[channel];
    if (!allValues)
      throw new InstrumentError(
        "CAPTURE_CONFIG_INVALID",
        `Scope channel ${channel} is absent from the artifact.`,
      );
    const values = allValues.slice(selected.from, selected.to);
    const levels = endpointLevels(values);
    const span = levels.high - levels.low;
    const statistics = moments(values);
    for (const kind of kinds) {
      if (kind === "rise_time" || kind === "fall_time") {
        const edge = edgeTime(
          values,
          data.sampleRateHz,
          thresholds.lowPct,
          thresholds.highPct,
          kind === "rise_time",
        );
        results.push(
          measurement(
            capture,
            kind,
            channel,
            edge.value,
            edge.unit,
            selected.window,
          ),
        );
      } else if (kind === "overshoot") {
        const value =
          span > 0
            ? Math.max(0, ((statistics.maximum - levels.high) / span) * 100)
            : 0;
        results.push(
          measurement(capture, kind, channel, value, "pct", selected.window),
        );
      } else if (kind === "undershoot") {
        const value =
          span > 0
            ? Math.max(0, ((levels.low - statistics.minimum) / span) * 100)
            : 0;
        results.push(
          measurement(capture, kind, channel, value, "pct", selected.window),
        );
      } else if (kind === "vpp_ripple") {
        results.push(
          measurement(
            capture,
            kind,
            channel,
            (statistics.maximum - statistics.minimum) * 1_000,
            "mV",
            selected.window,
          ),
        );
      } else if (kind === "rail_droop") {
        results.push(
          measureRailDroop(capture, channel, allValues, data, request),
        );
      } else {
        for (const value of [
          statistics.minimum,
          statistics.maximum,
          statistics.mean,
          statistics.rms,
        ]) {
          results.push(
            measurement(capture, "stats", channel, value, "V", selected.window),
          );
        }
      }
    }
  }
  return results;
}

export async function downsampleForPreview(
  capture: ScopeCapture,
  maxPoints: number,
): Promise<PreviewSeries> {
  if (!Number.isInteger(maxPoints) || maxPoints < 1 || maxPoints > 20_000) {
    throw new InstrumentError(
      "CAPTURE_CONFIG_INVALID",
      "Preview point bound must be between 1 and 20000.",
    );
  }
  const data = await readWaveformData(capture.path);
  validateCapture(capture, data);
  const channelNames = Object.keys(data.channels);
  if (maxPoints < channelNames.length) {
    throw new InstrumentError(
      "CAPTURE_CONFIG_INVALID",
      "Preview bound must permit at least one envelope bucket per channel.",
    );
  }
  const bucketsPerChannel = Math.max(
    1,
    Math.floor(maxPoints / channelNames.length),
  );
  const items: PreviewPoint[] = [];
  for (const channel of channelNames) {
    const values = data.channels[channel]!;
    const bucketSize = Math.max(
      1,
      Math.ceil(values.length / bucketsPerChannel),
    );
    for (let from = 0; from < values.length; from += bucketSize) {
      const to = Math.min(values.length, from + bucketSize);
      const bucket = values.slice(from, to);
      const statistics = moments(bucket);
      items.push({
        channel,
        fromSample: from,
        toSample: to - 1,
        minV: statistics.minimum,
        maxV: statistics.maximum,
      });
    }
  }
  return {
    items: items.slice(0, maxPoints),
    total: items.length,
    cursor: null,
  };
}

export interface ReplayScopeDriverOptions extends InstrumentDriverDeps {
  fixturePath: string;
  id?: string;
}

function replayChannelConfigs(config: {
  channels: readonly number[];
}): ScopeChannelConfig[] {
  return config.channels.map((channel) => ({
    channel: String.fromCharCode(65 + channel),
    rangeV: 5,
    coupling: "dc",
    attenuation: 1,
  }));
}

export function createReplayScopeDriver(
  options: ReplayScopeDriverOptions,
): InstrumentDriver {
  return {
    id: options.id ?? "replay-scope-fixture",
    async detect(transport) {
      return transport.kind === "bb-host" ? null : REPLAY_CAPABILITIES;
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
        capabilities: REPLAY_CAPABILITIES,
        async capture(config, captureSignal) {
          if (closed)
            throw new InstrumentError(
              "SESSION_CLOSED",
              "Scope replay session is closed.",
            );
          validateCaptureConfig(config, REPLAY_CAPABILITIES, 60_000);
          options.verifyClaim(claim, claim.deviceId);
          captureSignal.throwIfAborted();
          const data = await readWaveformData(options.fixturePath);
          const samples = Object.values(data.channels)[0]!.length;
          const path = join(
            config.artifactSink.directory,
            "scope-capture.json",
          );
          await mkdir(dirname(path), { recursive: true });
          try {
            await copyFile(options.fixturePath, path);
            captureSignal.throwIfAborted();
            const artifact = {
              path,
              format: "finite-state-scope-json-v1",
              durationMs: config.durationMs,
              channels: Object.keys(data.channels).length,
              channelConfigs: replayChannelConfigs(config),
              trigger: null,
              sampleRateHz: data.sampleRateHz,
              samples,
            } satisfies ScopeCapture;
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
    prerequisites() {
      return { configured: true, needsConfiguration: [] };
    },
  };
}

const refuseUnwiredClaim = (): never => {
  throw new InstrumentError(
    "CLAIM_VERIFIER_NOT_CONFIGURED",
    "The scope driver must be constructed with the registry claim verifier.",
  );
};

const defaultReplayFixture = fileURLToPath(
  new URL("./fixtures/analog-integrity.json", import.meta.url),
);

export const scopeDrivers: readonly InstrumentDriver[] = Object.freeze([
  createPicoScopeDriver({ verifyClaim: refuseUnwiredClaim }),
  createScpiScopeDriver({ verifyClaim: refuseUnwiredClaim }),
  createReplayScopeDriver({
    fixturePath: defaultReplayFixture,
    verifyClaim: refuseUnwiredClaim,
  }),
]);
