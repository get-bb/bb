import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { toStorageProjectVersionId } from "../../../../lib/store/index.js";

export type EventMarkSource = "serial" | "gdb" | "manual";

export interface EventMark {
  atMs: number;
  label: string;
  source: EventMarkSource;
}

export type MeasurementKind = "sleep_current" | "boot_energy" | "active_draw";
export type MeasurementUnit = "uA" | "mA" | "uJ" | "mJ";

export interface MeasurementSummary {
  kind: MeasurementKind;
  window: { fromMs: number; toMs: number };
  stats: { mean: number; median: number; p99: number; unit: MeasurementUnit };
  artifactPath: string;
  buildDigest: string | null;
  marks: EventMark[];
}

export interface BaselineDelta {
  baseline: MeasurementSummary;
  current: MeasurementSummary;
  deltaPct: number;
  diagnostic: true;
}

export type PowerCorrelationErrorCode =
  | "BASELINE_CONTEXT_MISMATCH"
  | "BASELINE_NOT_FOUND"
  | "BASELINE_ZERO"
  | "BUILD_RUN_NOT_FOUND"
  | "INCOMPLETE_WINDOW"
  | "INVALID_MARKS"
  | "UNIT_MISMATCH";

export class PowerCorrelationError extends Error {
  constructor(readonly code: PowerCorrelationErrorCode, message: string) {
    super(message.startsWith(`${code}:`) ? message : `${code}: ${message}`);
    this.name = "PowerCorrelationError";
  }
}

const MARK_SOURCES = new Set<EventMarkSource>(["serial", "gdb", "manual"]);
const KINDS = new Set<MeasurementKind>(["sleep_current", "boot_energy", "active_draw"]);
const UNITS = new Set<MeasurementUnit>(["uA", "mA", "uJ", "mJ"]);

export function validateEventMarks(marks: readonly EventMark[]): EventMark[] {
  let previous = -1;
  const labels = new Set<string>();
  return marks.map((mark) => {
    if (!Number.isFinite(mark.atMs) || mark.atMs < 0 || mark.atMs < previous ||
        mark.label.trim().length === 0 || labels.has(mark.label) ||
        !MARK_SOURCES.has(mark.source)) {
      throw new PowerCorrelationError(
        "INVALID_MARKS",
        "Event marks must have unique labels and finite, non-negative, ordered timestamps.",
      );
    }
    previous = mark.atMs;
    labels.add(mark.label);
    return { atMs: mark.atMs, label: mark.label, source: mark.source };
  });
}

export function windowBetweenMarks(
  marks: readonly EventMark[],
  fromLabel: string,
  toLabel: string,
): { fromMs: number; toMs: number } {
  const ordered = validateEventMarks(marks);
  const from = ordered.find((mark) => mark.label === fromLabel);
  const to = ordered.find((mark) => mark.label === toLabel);
  if (!from || !to || to.atMs <= from.atMs) {
    throw new PowerCorrelationError(
      "INCOMPLETE_WINDOW",
      `A complete ordered window from ${fromLabel} to ${toLabel} was not supplied.`,
    );
  }
  return { fromMs: from.atMs, toMs: to.atMs };
}

interface BuildDigestRow { digest: string | null }

export interface BuildRunReference {
  projectId: string;
  projectVersionId: string | null;
  runId: string;
}

export function buildDigestForRun(
  db: Database.Database,
  reference: BuildRunReference,
): string | null {
  const row = db.prepare<[string, string, string], BuildDigestRow>(
    `SELECT digest FROM build_run
      WHERE project_id = ? AND project_version_id = ? AND run_id = ?`,
  ).get(
    reference.projectId,
    toStorageProjectVersionId(reference.projectVersionId),
    reference.runId,
  );
  if (!row) {
    throw new PowerCorrelationError(
      "BUILD_RUN_NOT_FOUND",
      `Build run ${reference.runId} was not found.`,
    );
  }
  return row.digest;
}

export interface StoredPowerBaseline {
  id: string;
  deviceId: string;
  summary: MeasurementSummary;
}

export interface PowerBaselineStore {
  get(id: string): Promise<StoredPowerBaseline | null>;
  put(baseline: StoredPowerBaseline): Promise<void>;
}

export interface PowerDeps {
  deviceId: string;
  baselines: PowerBaselineStore;
}

function safeBaselineId(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(id) || id === "." || id === "..") {
    throw new PowerCorrelationError("BASELINE_NOT_FOUND", "Baseline id is not a safe name.");
  }
  return id;
}

function parseSummary(value: unknown): MeasurementSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PowerCorrelationError("BASELINE_NOT_FOUND", "Stored baseline is malformed.");
  }
  const kind = Reflect.get(value, "kind");
  const window = Reflect.get(value, "window");
  const stats = Reflect.get(value, "stats");
  const artifactPath = Reflect.get(value, "artifactPath");
  const buildDigest = Reflect.get(value, "buildDigest");
  const marks = Reflect.get(value, "marks");
  if (!KINDS.has(kind) || typeof window !== "object" || window === null ||
      typeof stats !== "object" || stats === null || typeof artifactPath !== "string" ||
      (buildDigest !== null && typeof buildDigest !== "string") || !Array.isArray(marks)) {
    throw new PowerCorrelationError("BASELINE_NOT_FOUND", "Stored baseline is malformed.");
  }
  const fromMs = Reflect.get(window, "fromMs");
  const toMs = Reflect.get(window, "toMs");
  const mean = Reflect.get(stats, "mean");
  const median = Reflect.get(stats, "median");
  const p99 = Reflect.get(stats, "p99");
  const unit = Reflect.get(stats, "unit");
  if (typeof fromMs !== "number" || typeof toMs !== "number" ||
      typeof mean !== "number" || typeof median !== "number" || typeof p99 !== "number" ||
      !UNITS.has(unit)) {
    throw new PowerCorrelationError("BASELINE_NOT_FOUND", "Stored baseline is malformed.");
  }
  const parsedMarks = marks.map((mark) => {
    if (typeof mark !== "object" || mark === null || Array.isArray(mark)) {
      throw new PowerCorrelationError("BASELINE_NOT_FOUND", "Stored baseline marks are malformed.");
    }
    const atMs = Reflect.get(mark, "atMs");
    const label = Reflect.get(mark, "label");
    const source = Reflect.get(mark, "source");
    if (typeof atMs !== "number" || typeof label !== "string" || !MARK_SOURCES.has(source)) {
      throw new PowerCorrelationError("BASELINE_NOT_FOUND", "Stored baseline marks are malformed.");
    }
    return { atMs, label, source };
  });
  return {
    kind,
    window: { fromMs, toMs },
    stats: { mean, median, p99, unit },
    artifactPath,
    buildDigest,
    marks: validateEventMarks(parsedMarks),
  };
}

export function createFilePowerBaselineStore(directory: string): PowerBaselineStore {
  return {
    async get(id) {
      const path = join(directory, `${safeBaselineId(id)}.json`);
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(path, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw new PowerCorrelationError("BASELINE_NOT_FOUND", "Stored baseline could not be read.");
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new PowerCorrelationError("BASELINE_NOT_FOUND", "Stored baseline is malformed.");
      }
      const storedId = Reflect.get(parsed, "id");
      const deviceId = Reflect.get(parsed, "deviceId");
      if (storedId !== id || typeof deviceId !== "string") {
        throw new PowerCorrelationError("BASELINE_NOT_FOUND", "Stored baseline identity is malformed.");
      }
      return { id: storedId, deviceId, summary: parseSummary(Reflect.get(parsed, "summary")) };
    },
    async put(baseline) {
      safeBaselineId(baseline.id);
      if (baseline.deviceId.length === 0) {
        throw new PowerCorrelationError("BASELINE_CONTEXT_MISMATCH", "Baseline device id is empty.");
      }
      await mkdir(directory, { recursive: true });
      const path = join(directory, `${baseline.id}.json`);
      const temporary = join(directory, `.${baseline.id}.${process.pid}.${Date.now()}.tmp`);
      await writeFile(temporary, `${JSON.stringify(baseline)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, path);
    },
  };
}

export async function storeBaseline(
  deps: PowerDeps,
  baselineId: string,
  summary: MeasurementSummary,
): Promise<void> {
  const id = safeBaselineId(baselineId);
  const existing = await deps.baselines.get(id);
  if (existing && (existing.deviceId !== deps.deviceId ||
      existing.summary.kind !== summary.kind ||
      existing.summary.buildDigest !== summary.buildDigest)) {
    throw new PowerCorrelationError(
      "BASELINE_CONTEXT_MISMATCH",
      "A named baseline cannot be reassigned to another device, kind, or build.",
    );
  }
  await deps.baselines.put({ id, deviceId: deps.deviceId, summary });
}

export async function compareToBaseline(
  deps: PowerDeps,
  baselineId: string,
  current: MeasurementSummary,
): Promise<BaselineDelta> {
  const stored = await deps.baselines.get(safeBaselineId(baselineId));
  if (!stored) {
    throw new PowerCorrelationError("BASELINE_NOT_FOUND", `Baseline ${baselineId} was not found.`);
  }
  if (stored.deviceId !== deps.deviceId || stored.summary.kind !== current.kind ||
      stored.summary.buildDigest !== current.buildDigest) {
    throw new PowerCorrelationError(
      "BASELINE_CONTEXT_MISMATCH",
      "Baseline comparison requires the same device, measurement kind, and build digest.",
    );
  }
  if (stored.summary.stats.unit !== current.stats.unit) {
    throw new PowerCorrelationError("UNIT_MISMATCH", "Baseline and current units differ.");
  }
  const base = stored.summary.stats.mean;
  if (base === 0 && current.stats.mean !== 0) {
    throw new PowerCorrelationError(
      "BASELINE_ZERO",
      "Percent change from a zero baseline is undefined.",
    );
  }
  const deltaPct = base === 0 ? 0 : ((current.stats.mean - base) / Math.abs(base)) * 100;
  return { baseline: stored.summary, current, deltaPct, diagnostic: true };
}
