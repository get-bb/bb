import { createHash } from "node:crypto";
import { jsonValueSchema, type JsonValue } from "../../../../shared/contract.js";
import { canonicalRequirement } from "../cards/adapter.js";
import { validateRequirementYaml } from "../cards/validator.js";
import type { ConversionDeps } from "./bundle.js";
import {
  buildConversionBundle,
  conversionSnapshotDigest,
  getStoredConversionBundle,
  type StoredConversionBundle,
} from "./bundle.js";
import { spawnConversionThread } from "./spawn.js";
import { validateConversion, type ConversionGateResult, type ValidationError } from "./validate.js";

const MAX_REPORT_ERRORS = 100;

interface ConversionDiffValue {
  present: boolean;
  value: JsonValue;
}

export interface ConversionDiffItem {
  key: string;
  label: string;
  operation: "update";
  fields: Array<{
    field: string;
    base: ConversionDiffValue;
    ours: ConversionDiffValue;
    theirs: ConversionDiffValue;
  }>;
}

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
  diff: ConversionDiffItem[];
  diffComplete: boolean;
}

const reports = new Map<string, ConversionReport>();

function sourceFields(source: StoredConversionBundle["sources"][number]): Record<string, JsonValue> {
  return {
    schema: "fs-requirement/v1",
    id: source.requirementId,
    req_type: source.reqType,
    priority: source.priority,
    status: source.status,
    source_description: source.sourceDescription,
    ...(source.rationale === null ? {} : { rationale: source.rationale }),
    mitigations: source.traces.mitigations,
    controls: source.traces.controls,
    standards: source.traces.standards,
    verification: source.checks.map((check) => ({
      check: check.slug,
      method: check.method,
      tier: check.tier,
      required: check.required,
      ...(check.coverage === null ? {} : { coverage: check.coverage }),
      suppressed: check.suppressed,
      pass_criteria: check.passCriteria,
      ...(check.failCriteria === null ? {} : { fail_criteria: check.failCriteria }),
    })),
  };
}

function fieldValue(fields: Readonly<Record<string, JsonValue>>, field: string): ConversionDiffValue {
  return Object.hasOwn(fields, field)
    ? { present: true, value: fields[field] ?? null }
    : { present: false, value: null };
}

function jsonRecord(value: unknown): Record<string, JsonValue> {
  const parsed = jsonValueSchema.parse(value);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Requirement diff payload must be a JSON object.");
  }
  return parsed;
}

async function currentProposalDiff(bundle: StoredConversionBundle): Promise<{
  items: ConversionDiffItem[];
  complete: boolean;
}> {
  const items: ConversionDiffItem[] = [];
  for (const source of bundle.sources) {
    const yaml = await bundle.deps.readLocalFile(source.targetPath);
    if (yaml === null) return { items, complete: false };
    const validated = validateRequirementYaml(yaml, source.targetPath);
    if (!validated.success) return { items, complete: false };
    const base = sourceFields(source);
    const ours = jsonRecord(canonicalRequirement(validated.data));
    const fields = [...new Set([...Object.keys(base), ...Object.keys(ours)])]
      .sort((left, right) => left.localeCompare(right))
      .flatMap((field) => {
        const baseValue = fieldValue(base, field);
        const oursValue = fieldValue(ours, field);
        return JSON.stringify(baseValue) === JSON.stringify(oursValue) ? [] : [{
          field,
          base: baseValue,
          ours: oursValue,
          theirs: baseValue,
        }];
      });
    if (fields.length === 0) return { items, complete: false };
    items.push({
      key: source.targetPath,
      label: source.requirementId,
      operation: "update",
      fields,
    });
  }
  return { items, complete: items.length === bundle.sources.length };
}

async function currentReviewDigest(bundle: StoredConversionBundle): Promise<string> {
  const currentSnapshot = await bundle.deps.loadPullSnapshot();
  const selectedIds = new Set(bundle.meta.requirementIds);
  const selectedSources = (currentSnapshot?.requirements ?? [])
    .filter((source) => selectedIds.has(source.requirementId));
  const proposals = await Promise.all(bundle.sources.map(async (source) => ({
    path: source.targetPath,
    content: await bundle.deps.readLocalFile(source.targetPath),
  })));
  return createHash("sha256").update(JSON.stringify({
    bundleId: bundle.meta.bundleId,
    currentSnapshotDigest: conversionSnapshotDigest(selectedSources),
    missingRequirementIds: bundle.meta.requirementIds.filter((id) =>
      !selectedSources.some((source) => source.requirementId === id)),
    proposals,
  })).digest("hex");
}

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
    diff: [],
    diffComplete: false,
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
  const gates = await validateConversion(
    bundle.sources.map((source) => source.targetPath),
    bundle.meta.bundleId,
  );
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
  const diff = ready ? await currentProposalDiff(bundle) : { items: [], complete: false };
  const next: ConversionReport = {
    ...report,
    snapshotSha256: await currentReviewDigest(bundle),
    state: ready ? "awaiting_human" : "failed",
    errors,
    gates,
    diff: diff.items,
    diffComplete: diff.complete,
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
