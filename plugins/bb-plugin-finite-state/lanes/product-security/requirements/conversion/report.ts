import type { ConversionDeps } from "./bundle.js";
import { buildConversionBundle, getStoredConversionBundle } from "./bundle.js";
import { spawnConversionThread } from "./spawn.js";
import { validateConversion, type ConversionGateResult, type ValidationError } from "./validate.js";

const MAX_REPORT_ERRORS = 100;

export type ConversionState =
  | "preparing"
  | "running"
  | "validating"
  | "awaiting_human"
  | "reviewed"
  | "discarded"
  | "failed";

export interface ConversionReport {
  projectId: string;
  projectVersionId: string | null;
  id: string;
  threadId: string | null;
  snapshotSha256: string;
  state: ConversionState;
  requirementIds: string[];
  errors: ValidationError[];
  pulledAt: string;
  gates: ConversionGateResult[];
}

const reports = new Map<string, ConversionReport>();

export async function startConversion(
  deps: ConversionDeps,
  requirementIds?: string[],
): Promise<ConversionReport> {
  const meta = await buildConversionBundle(deps, requirementIds);
  const initial: ConversionReport = {
    projectId: deps.projectId,
    projectVersionId: deps.projectVersionId,
    id: meta.bundleId,
    threadId: null,
    snapshotSha256: meta.snapshotDigest,
    state: "preparing",
    requirementIds: meta.requirementIds,
    errors: [],
    pulledAt: meta.pulledAt,
    gates: meta.requirementIds.map((requirementId) => ({
      requirementId,
      schema: { ok: false, errors: [] },
      roundTrip: { ok: false, unresolved: [], staleSource: false },
      humanReview: "pending",
    })),
  };
  reports.set(meta.bundleId, initial);
  if (meta.requirementIds.length === 0) {
    const empty = {
      ...initial,
      state: "failed" as const,
      errors: [{
        code: "NOTHING_TO_CONVERT",
        message: "The accepted pull snapshot has no requirements in this selection.",
        path: "",
        artifactId: null,
        line: null,
      }],
    };
    reports.set(meta.bundleId, empty);
    return empty;
  }
  try {
    const spawned = await spawnConversionThread(meta.bundleId);
    const running = { ...initial, threadId: spawned.threadId, state: "running" as const };
    reports.set(meta.bundleId, running);
    return running;
  } catch (error) {
    const failed = {
      ...initial,
      state: "failed" as const,
      errors: [{
        code: "THREAD_SPAWN_FAILED",
        message: error instanceof Error ? error.message : "The conversion thread could not be started.",
        path: "",
        artifactId: null,
        line: null,
      }],
    };
    reports.set(meta.bundleId, failed);
    return failed;
  }
}

export function getConversionReport(id: string): ConversionReport {
  const report = reports.get(id);
  if (!report) throw new Error("Conversion was not found or has expired.");
  return report;
}

export async function refreshConversion(id: string): Promise<ConversionReport> {
  const report = getConversionReport(id);
  if (report.state === "reviewed" || report.state === "discarded") return report;
  const bundle = getStoredConversionBundle(id);
  const gates = await validateConversion(bundle.sources.map((source) => source.targetPath));
  const pathByRequirement = new Map(bundle.sources.map((source) => [source.requirementId, source.targetPath]));
  const errors = gates.flatMap((gate): ValidationError[] => [
    ...gate.schema.errors,
    ...gate.roundTrip.unresolved.map((unresolved) => ({
      code: "UNRESOLVED_SLUG",
      message: `${unresolved} does not resolve in the current accepted pull snapshot.`,
      path: "",
      artifactId: pathByRequirement.get(gate.requirementId) ?? null,
      line: null,
    })),
    ...(gate.roundTrip.staleSource ? [{
      code: "STALE_SOURCE",
      message: "The pulled requirement or check contract changed after this bundle was created.",
      path: "",
      artifactId: pathByRequirement.get(gate.requirementId) ?? null,
      line: null,
    }] : []),
  ]).slice(0, MAX_REPORT_ERRORS);
  const ready = gates.length > 0 && gates.every((gate) => gate.schema.ok && gate.roundTrip.ok);
  const next: ConversionReport = {
    ...report,
    state: ready ? "awaiting_human" : "failed",
    errors,
    gates,
  };
  reports.set(id, next);
  return next;
}

export function recordHumanReview(
  id: string,
  decision: "reviewed" | "discarded",
  expectedSnapshotSha256: string,
): ConversionReport {
  const report = getConversionReport(id);
  if (report.snapshotSha256 !== expectedSnapshotSha256) {
    throw new Error("The conversion changed after this diff was opened; reload before reviewing.");
  }
  if (decision === "reviewed" && report.state !== "awaiting_human") {
    throw new Error("Human review is unavailable until schema and round-trip gates pass.");
  }
  const gates = report.gates.map((gate) => ({ ...gate, humanReview: decision }));
  const next: ConversionReport = { ...report, state: decision, gates };
  reports.set(id, next);
  return next;
}

export function clearConversionReportsForTests(): void {
  reports.clear();
}
