import { randomUUID } from "node:crypto";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { toStorageProjectVersionId } from "../../../lib/store/index.js";
import { parseKey, type EntityKind } from "../../../lib/sync/registry.js";
import type { JsonValue } from "../../../shared/contract.js";
import { planSchema } from "../../../shared/contract.js";
import {
  registeredAdapters,
  type EntityAdapter,
  type ServerEntity,
  type WorkingEntity,
} from "../engine/adapter.js";
import type { EngineDeps } from "../engine/pull.js";
import { syncMetadata } from "../engine/status.js";
import { contentHash, canonicalJson } from "../serialize/canonical.js";
import {
  loadPlanForDeps,
  type Conflict,
  type FieldDiff,
  type FieldValue,
  type Plan,
  type PlanItem,
  type PlanOp,
} from "../plan/index.js";
import { threeWayDiff } from "../plan/diff.js";
import { blastRadius } from "../plan/blast-radius.js";
import { orderPlanItems, planItemId, type ReferenceGraph } from "../plan/order.js";
import {
  validatePlanItems,
  type SourceLocation,
  type ValidateCtx,
} from "../plan/validate.js";
import { BaseSnapshotStore, type BaseRow } from "../store/base-snapshot.js";
import { IdMapStore } from "../store/id-map.js";
import { attributeConflicts } from "./attribution.js";
import { detectConflicts, type FieldConflict } from "./detect.js";
import {
  confinedWorkingFile,
  escapePointerSegment,
  materializeExistingWorking,
  sha256Text,
  writePointer,
  type SemanticNode,
  type WorkingMaterialization,
  type WorkingMaterializationInput,
} from "./merge.js";

export {
  materializeExistingWorking,
  type WorkingMaterialization,
  type WorkingMaterializationInput,
} from "./merge.js";

export type ConflictResolution =
  | { choice: "take-ours" }
  | { choice: "take-theirs" }
  | { choice: "edited"; value: unknown };

export interface ConflictDeps extends EngineDeps {
  worktreeRoot: string;
  /** Trusted actor identity supplied only by an authenticated non-RPC caller. */
  resolvedBy: string;
  attributionTimeoutMs?: number;
  /** Surface-owned writer for aggregate or create/delete document shapes. */
  materializeWorking?(input: WorkingMaterializationInput): Promise<WorkingMaterialization>;
}

export interface ResolveConflictInput {
  planId: string;
  expectedPlanSha256: string;
  kind: EntityKind;
  key: string;
  path: string;
  resolution: ConflictResolution;
}

export class ConflictResolutionError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConflictResolutionError";
  }
}

interface EntityState {
  adapter: EntityAdapter;
  baseRow: BaseRow | null;
  base: Record<string, unknown> | undefined;
  ours: Record<string, unknown> | undefined;
  theirs: Record<string, unknown> | undefined;
  working: WorkingEntity | null;
  fileSha256: string | null;
}

interface PersistedReplacement {
  rollback(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((entry) => jsonValue(entry));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, jsonValue(entry)]),
    );
  }
  throw new TypeError("Conflict resolution values must be finite JSON values");
}

function safeClone<T>(value: T): T {
  return structuredClone(value);
}

function planRoot(deps: ConflictDeps): string {
  return deps.worktreeRoot;
}

function planFile(deps: ConflictDeps, planId: string): string {
  return join(planRoot(deps), ".fs-sync", `plan-${planId}.json`);
}

function withoutPlanSha(plan: Plan): Omit<Plan, "planSha256"> {
  const { planSha256: _planSha256, ...unsigned } = plan;
  return unsigned;
}

function normalizePath(path: string): string {
  if (path === "#") return "";
  if (path === "" || path.startsWith("/")) return path;
  return `/${escapePointerSegment(path)}`;
}

function wirePath(path: string): string {
  return path === "" ? "#" : path;
}

function fieldValue(value: unknown): FieldValue {
  return value === undefined
    ? { present: false, value: null }
    : { present: true, value: jsonValue(safeClone(value)) };
}

function semanticNode(value: unknown): SemanticNode {
  return { present: value !== undefined, value };
}

function fieldConflictToPlan(conflict: FieldConflict): Conflict {
  const resolution = conflict.resolution === null
    ? null
    : conflict.resolution.choice === "edited"
      ? { choice: "edited" as const, value: jsonValue(safeClone(conflict.resolution.value)) }
      : { choice: conflict.resolution.choice };
  return {
    field: wirePath(conflict.path),
    base: fieldValue(conflict.base),
    ours: fieldValue(conflict.ours),
    theirs: fieldValue(conflict.theirs),
    attribution: conflict.attribution.available
      ? {
        actor: conflict.attribution.actor,
        at: conflict.attribution.at,
        source: conflict.attribution.source,
      }
      : null,
    suggestion: conflict.suggestion,
    resolution,
  };
}

function existingResolutions(item: PlanItem): ReadonlyMap<string, Conflict["resolution"]> {
  return new Map(item.conflicts
    .filter((conflict) => conflict.resolution !== null)
    .map((conflict) => [normalizePath(conflict.field), conflict.resolution]));
}

function withExistingResolutions(
  conflicts: readonly FieldConflict[],
  item: PlanItem,
  resolvedBy: string,
  resolvedAt: string,
): FieldConflict[] {
  const existing = existingResolutions(item);
  return conflicts.map((conflict) => {
    const resolution = existing.get(conflict.path);
    if (resolution === undefined || resolution === null) return conflict;
    return {
      ...conflict,
      resolution: resolution.choice === "edited"
        ? { ...resolution, resolvedBy, resolvedAt }
        : { choice: resolution.choice, resolvedBy, resolvedAt },
    };
  });
}

function assertUnresolvedConflictsRemainDetectable(
  item: PlanItem,
  detected: readonly FieldConflict[],
): void {
  const detectedPaths = new Set(detected.map((conflict) => conflict.path));
  const missing = item.conflicts.find((conflict) => (
    conflict.resolution === null && !detectedPaths.has(normalizePath(conflict.field))
  ));
  if (missing !== undefined) {
    throw new ConflictResolutionError(
      "CONFLICT_STATE_INVALID",
      `Unresolved conflict ${item.kind}/${item.key}${normalizePath(missing.field)} is no longer detectable`,
    );
  }
}

function conflictHistory(
  item: PlanItem,
  detected: readonly FieldConflict[],
  current: readonly FieldConflict[],
): Conflict[] {
  const currentByPath = new Map(current.map((conflict) => [conflict.path, conflict]));
  const projected = detected.map((conflict) => fieldConflictToPlan(currentByPath.get(conflict.path) ?? conflict));
  const projectedPaths = new Set(projected.map((conflict) => normalizePath(conflict.field)));
  const resolvedHistory = item.conflicts.filter((conflict) => (
    conflict.resolution !== null && !projectedPaths.has(normalizePath(conflict.field))
  ));
  const currentHistory = current
    .filter((conflict) => conflict.resolution !== null && !projectedPaths.has(conflict.path))
    .map(fieldConflictToPlan);
  return [...projected, ...resolvedHistory, ...currentHistory]
    .filter((conflict, index, all) => (
      all.findIndex((candidate) => normalizePath(candidate.field) === normalizePath(conflict.field)) === index
    ))
    .sort((left, right) => normalizePath(left.field).localeCompare(normalizePath(right.field)));
}

function adapterFor(deps: ConflictDeps, kind: EntityKind): EntityAdapter {
  const adapter = [...(deps.adapters ?? registeredAdapters())].find((candidate) => candidate.kind === kind);
  if (adapter === undefined) {
    throw new ConflictResolutionError("ADAPTER_NOT_REGISTERED", `No sync adapter is registered for ${kind}`);
  }
  return adapter;
}

function partialWorking(error: unknown): WorkingEntity[] | null {
  if (!isRecord(error) || !Array.isArray(error["partialWorking"])) return null;
  const values = error["partialWorking"];
  if (!values.every((value) => (
    isRecord(value)
    && typeof value["key"] === "string"
    && typeof value["file"] === "string"
    && isRecord(value["payload"])
  ))) return null;
  return values.map((value) => ({
    key: value["key"],
    file: value["file"],
    payload: value["payload"],
  }));
}

async function workingRows(adapter: EntityAdapter, root: string): Promise<WorkingEntity[]> {
  try {
    return await adapter.readWorking(root);
  } catch (error: unknown) {
    const partial = partialWorking(error);
    if (partial !== null) return partial;
    throw error;
  }
}

function sidePayload(
  base: Record<string, unknown> | undefined,
  fields: readonly FieldDiff[],
  side: "ours" | "theirs",
): Record<string, unknown> | undefined {
  const hasPresentValue = fields.some((field) => field[side].present);
  if (base === undefined && !hasPresentValue) return undefined;
  const result: Record<string, unknown> = base === undefined ? {} : safeClone(base);
  for (const field of fields) {
    const value = field[side];
    if (value.present) result[field.field] = safeClone(value.value);
    else delete result[field.field];
  }
  if (base !== undefined) {
    const baseKeys = Object.keys(base);
    const deletedEntity = baseKeys.length > 0
      && baseKeys.every((key) => fields.some((field) => field.field === key && !field[side].present))
      && !hasPresentValue;
    if (deletedEntity) return undefined;
  }
  return result;
}

async function loadEntityState(
  deps: ConflictDeps,
  plan: Plan,
  item: PlanItem,
): Promise<EntityState> {
  const adapter = adapterFor(deps, item.kind);
  const storageVersionId = toStorageProjectVersionId(plan.projectVersionId);
  const baseRow = new BaseSnapshotStore(deps.db).getAccepted(
    plan.projectId,
    storageVersionId,
    item.kind,
    item.key,
  );
  if ((baseRow?.contentHash ?? null) !== item.expectedBaseContentHash) {
    throw new ConflictResolutionError("BASE_STALE", `Accepted ${item.kind}/${item.key} moved after planning`);
  }
  const base = baseRow?.payload;
  const plannedOurs = sidePayload(base, item.fields, "ours");
  const theirs = sidePayload(base, item.fields, "theirs");
  const rows = await workingRows(adapter, deps.worktreeRoot);
  const working = rows.find((row) => row.key === item.key) ?? null;
  const ours = working?.payload;
  if ((ours === undefined) !== (plannedOurs === undefined)
    || (ours !== undefined && plannedOurs !== undefined && canonicalJson(ours) !== canonicalJson(plannedOurs))) {
    throw new ConflictResolutionError("WORKING_STALE", `Working ${item.kind}/${item.key} moved after planning`);
  }
  const fileSha256 = working === null
    ? null
    : sha256Text(await readFile(confinedWorkingFile(deps.worktreeRoot, working.file), "utf8"));
  return { adapter, baseRow, base, ours, theirs, working, fileSha256 };
}

function stableIdentity(key: string): string {
  try {
    const segments = parseKey(key);
    return segments.at(-1) ?? key;
  } catch {
    return key;
  }
}

function acceptedIdResolver(
  deps: ConflictDeps,
  plan: Plan,
): (remoteId: string) => string | null {
  const resolved = new Map<string, string>();
  const storageVersionId = toStorageProjectVersionId(plan.projectVersionId);
  for (const entry of new IdMapStore(deps.db).dumpAccepted(plan.projectId, storageVersionId)) {
    const identity = stableIdentity(entry.entityKey);
    const prior = resolved.get(entry.remoteId);
    if (prior !== undefined && prior !== identity) {
      throw new ConflictResolutionError(
        "REMOTE_ID_AMBIGUOUS",
        `Accepted id map assigns ${entry.remoteId} to multiple stable identities`,
      );
    }
    resolved.set(entry.remoteId, identity);
  }
  return (remoteId) => resolved.get(remoteId) ?? null;
}

function comparableRemotePayload(
  deps: ConflictDeps,
  adapter: EntityAdapter,
  plan: Plan,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const semantic = adapter.serializer.semanticPayload(payload);
  const yaml = adapter.serializer.toYaml(semantic, {
    idToSlug: acceptedIdResolver(deps, plan),
    onWarning: () => undefined,
  });
  return adapter.serializer.fromYaml(yaml, `<conflict:${adapter.kind}>`);
}

async function remoteEntity(
  deps: ConflictDeps,
  adapter: EntityAdapter,
  plan: Plan,
  key: string,
): Promise<ServerEntity | null> {
  let found: ServerEntity | null = null;
  for await (const page of adapter.fetchRemote({
    projectId: plan.projectId,
    projectVersionId: plan.projectVersionId,
  }, () => undefined)) {
    for (const row of page) {
      if (row.key !== key) continue;
      const semantic = comparableRemotePayload(deps, adapter, plan, row.payload);
      if (
        found !== null
        && (found.remoteId !== row.remoteId
          || canonicalJson(found.payload) !== canonicalJson(semantic))
      ) {
        throw new ConflictResolutionError("REMOTE_AMBIGUOUS", `${adapter.kind}/${key} has conflicting remote rows`);
      }
      found = { ...row, payload: semantic };
    }
  }
  return found;
}

function localOperation(
  base: Record<string, unknown> | undefined,
  ours: Record<string, unknown> | undefined,
): PlanOp {
  if (base === undefined && ours === undefined) return "noop";
  if (base === undefined) return "create";
  if (ours === undefined) return "delete";
  if (canonicalJson(base) === canonicalJson(ours)) return "noop";
  return "update";
}

function labelAliases(item: PlanItem, payload: Readonly<Record<string, unknown>>): string[] {
  const aliases = new Set([item.key, item.label]);
  for (const field of ["reqId", "slug", "code", "componentSlug", "routeSignature", "id", "cve", "name"]) {
    const value = payload[field];
    if (typeof value === "string") aliases.add(value);
  }
  return [...aliases].filter((value) => value.length > 0);
}

function collectStrings(value: unknown, output: Set<string>): void {
  if (typeof value === "string") {
    output.add(value);
  } else if (Array.isArray(value)) {
    for (const child of value) collectStrings(child, output);
  } else if (isRecord(value)) {
    for (const child of Object.values(value)) collectStrings(child, output);
  }
}

function referenceGraph(
  items: readonly PlanItem[],
  payloads: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): ReferenceGraph {
  const owners = new Map<string, Set<string>>();
  for (const item of items) {
    const id = planItemId(item);
    const payload = payloads.get(id);
    if (payload === undefined) continue;
    for (const alias of labelAliases(item, payload)) {
      const ids = owners.get(alias) ?? new Set<string>();
      ids.add(id);
      owners.set(alias, ids);
    }
  }
  const graph = new Map<string, readonly string[]>();
  for (const item of items) {
    const id = planItemId(item);
    const strings = new Set<string>();
    const dependencies = new Set<string>();
    const payload = payloads.get(id);
    if (payload !== undefined) collectStrings(payload, strings);
    for (const value of strings) {
      for (const owner of owners.get(value) ?? []) if (owner !== id) dependencies.add(owner);
    }
    graph.set(id, [...dependencies].sort((left, right) => left.localeCompare(right)));
  }
  return graph;
}

function summary(items: readonly PlanItem[]): Plan["summary"] {
  const count = (operation: PlanOp): number => items.filter((item) => item.operation === operation).length;
  return {
    creates: count("create"),
    updates: count("update"),
    deletes: count("delete"),
    noops: count("noop"),
    conflicts: count("conflict"),
    orphans: count("orphan"),
  };
}

function payloadForItem(
  deps: ConflictDeps,
  plan: Plan,
  item: PlanItem,
): Record<string, unknown> | undefined {
  const base = new BaseSnapshotStore(deps.db).getAccepted(
    plan.projectId,
    toStorageProjectVersionId(plan.projectVersionId),
    item.kind,
    item.key,
  )?.payload;
  return item.operation === "delete" ? base : sidePayload(base, item.fields, "ours") ?? base;
}

function validateAndSummarize(
  deps: ConflictDeps,
  plan: Plan,
  target: PlanItem,
  targetPayload: Record<string, unknown> | undefined,
  source: SourceLocation | null,
): Plan {
  const replaced = plan.items.map((item) => planItemId(item) === planItemId(target)
    ? { ...target, error: null, referrers: [] }
    : { ...item, error: null, referrers: [] });
  const payloads = new Map<string, Readonly<Record<string, unknown>>>();
  for (const item of replaced) {
    const payload = planItemId(item) === planItemId(target)
      ? targetPayload
      : payloadForItem(deps, plan, item);
    if (payload !== undefined) payloads.set(planItemId(item), payload);
  }
  const references = referenceGraph(replaced, payloads);
  const ordered = orderPlanItems(replaced, references);
  const sources = new Map<string, SourceLocation>();
  if (source !== null) sources.set(planItemId(target), source);
  const context: ValidateCtx = {
    scope: { projectId: plan.projectId, projectVersionId: plan.projectVersionId },
    items: new Map(ordered.map((item) => [planItemId(item), item])),
    payloads,
    references,
    sources,
  };
  const validated = validatePlanItems(ordered, context);
  return {
    ...plan,
    items: validated,
    summary: summary(validated),
    blastRadius: blastRadius(validated),
    validationErrors: validated.flatMap((item) => item.error === null ? [] : [item.error]),
    total: validated.length,
    next: null,
  };
}

function resolutionFor(
  input: ConflictResolution,
  resolvedBy: string,
  resolvedAt: string,
): NonNullable<FieldConflict["resolution"]> {
  return input.choice === "edited"
    ? { choice: "edited", value: safeClone(input.value), resolvedBy, resolvedAt }
    : { choice: input.choice, resolvedBy, resolvedAt };
}

function resolvedOurs(
  ours: Record<string, unknown> | undefined,
  conflict: FieldConflict,
  resolution: ConflictResolution,
): Record<string, unknown> | undefined {
  if (resolution.choice === "take-ours") return ours === undefined ? undefined : safeClone(ours);
  const selected = resolution.choice === "take-theirs"
    ? semanticNode(conflict.theirs)
    : { present: true, value: resolution.value };
  if (selected.present) canonicalJson(selected.value);
  const next = writePointer(ours, conflict.path, selected);
  if (next === undefined) return undefined;
  if (!isRecord(next)) {
    throw new ConflictResolutionError("EDITED_VALUE_INVALID", "A semantic entity must remain a JSON object");
  }
  return next;
}

function resolvedBase(
  base: Record<string, unknown> | undefined,
  conflict: FieldConflict,
  resolution: ConflictResolution,
): Record<string, unknown> | undefined {
  if (resolution.choice !== "take-theirs") return base === undefined ? undefined : safeClone(base);
  const next = writePointer(base, conflict.path, semanticNode(conflict.theirs));
  if (next === undefined) return undefined;
  if (!isRecord(next)) {
    throw new ConflictResolutionError("CONFLICT_STATE_INVALID", "An accepted semantic entity must remain a JSON object");
  }
  return next;
}

async function verifyWorking(
  deps: ConflictDeps,
  adapter: EntityAdapter,
  key: string,
  expected: Record<string, unknown> | undefined,
): Promise<void> {
  const actual = (await workingRows(adapter, deps.worktreeRoot)).find((row) => row.key === key)?.payload;
  if ((actual === undefined) !== (expected === undefined)
    || (actual !== undefined && expected !== undefined && canonicalJson(actual) !== canonicalJson(expected))) {
    throw new ConflictResolutionError("WORKING_VERIFY_FAILED", `Materialized ${adapter.kind}/${key} failed read-back`);
  }
}

function assertPlanBaseFence(deps: ConflictDeps, plan: Plan): void {
  const kinds = [...new Set(plan.items.map((item) => item.kind))];
  const metadata = syncMetadata(deps, {
    projectId: plan.projectId,
    projectVersionId: plan.projectVersionId,
  }, kinds);
  if (metadata.baseStateSha256 !== plan.baseStateSha256
    || canonicalJson(metadata.acceptedGenerationIds) !== canonicalJson(plan.baseGenerationIds)
    || canonicalJson(metadata.baseRevisions) !== canonicalJson(plan.baseRevisions)) {
    throw new ConflictResolutionError("BASE_STALE", "Accepted base generation or revision moved after planning");
  }
}

function advanceBaseToResolution(
  deps: ConflictDeps,
  plan: Plan,
  item: PlanItem,
  baseRow: BaseRow | null,
  nextBase: Record<string, unknown> | undefined,
  remote: ServerEntity | null,
): void {
  const generationId = plan.baseGenerationIds[item.kind];
  const baseRevision = plan.baseRevisions[item.kind];
  if (generationId === undefined || baseRevision === undefined) {
    throw new ConflictResolutionError("PLAN_FENCE_INVALID", `Plan has no ${item.kind} base fence`);
  }
  const store = new BaseSnapshotStore(deps.db);
  const storageVersionId = toStorageProjectVersionId(plan.projectVersionId);
  if (nextBase === undefined) {
    if (remote !== null) {
      throw new ConflictResolutionError("CONFLICT_STATE_INVALID", "A deleted accepted base requires a deleted remote entity");
    }
    if (baseRow === null) return;
    store.deleteAccepted(plan.projectId, storageVersionId, item.kind, item.key, {
      generationId,
      baseRevision,
      contentHash: baseRow.contentHash,
    });
    return;
  }
  if (remote === null) {
    throw new ConflictResolutionError("CONFLICT_STATE_INVALID", "A partial accepted base requires a remote entity identity");
  }
  store.advanceAccepted(plan.projectId, storageVersionId, item.kind, item.key, {
    generationId,
    baseRevision,
    contentHash: baseRow?.contentHash ?? null,
  }, {
    payload: nextBase,
    remoteId: remote.remoteId,
    pulledAt: (deps.now?.() ?? new Date()).toISOString(),
  });
}

function refreshBaseFences(deps: ConflictDeps, plan: Plan): Plan {
  const kinds = [...new Set(plan.items.map((item) => item.kind))];
  const metadata = syncMetadata(deps, {
    projectId: plan.projectId,
    projectVersionId: plan.projectVersionId,
  }, kinds);
  const storageVersionId = toStorageProjectVersionId(plan.projectVersionId);
  const items = plan.items.map((item) => ({
    ...item,
    expectedBaseContentHash: new BaseSnapshotStore(deps.db).getAccepted(
      plan.projectId,
      storageVersionId,
      item.kind,
      item.key,
    )?.contentHash ?? null,
  }));
  return {
    ...plan,
    items,
    baseGenerationIds: metadata.acceptedGenerationIds,
    baseRevisions: metadata.baseRevisions,
    baseStateSha256: metadata.baseStateSha256,
    cache: {
      ...plan.cache,
      acceptedGenerationId: new Set(Object.values(metadata.acceptedGenerationIds)).size === 1
        ? Object.values(metadata.acceptedGenerationIds)[0] ?? null
        : null,
      baseRevision: Math.max(0, ...Object.values(metadata.baseRevisions)),
    },
  };
}

async function replacePlanCas(
  deps: ConflictDeps,
  expectedPlanSha256: string,
  plan: Plan,
): Promise<PersistedReplacement> {
  const file = planFile(deps, plan.planId);
  const original = await readFile(file, "utf8");
  const current = loadPlanForDeps(deps, plan.planId);
  if (current === null || current.planSha256 !== expectedPlanSha256) {
    throw new ConflictResolutionError("PLAN_FENCE_MISMATCH", "Persisted plan digest does not match the request fence");
  }
  const metadata = await stat(file);
  const unsigned = { ...plan, planSha256: "" };
  const complete: Plan = { ...unsigned, planSha256: contentHash(withoutPlanSha(unsigned)) };
  planSchema.parse(complete);
  const contents = `${JSON.stringify(complete, null, 2)}\n`;
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { encoding: "utf8", mode: metadata.mode });
    const latest = loadPlanForDeps(deps, plan.planId);
    if (latest === null || latest.planSha256 !== expectedPlanSha256) {
      throw new ConflictResolutionError("PLAN_FENCE_MISMATCH", "Persisted plan changed during conflict resolution");
    }
    await rename(temporary, file);
  } catch (error: unknown) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  Object.assign(plan, complete);
  return {
    async rollback() {
      const latest = loadPlanForDeps(deps, plan.planId);
      if (latest === null || latest.planSha256 !== complete.planSha256) {
        throw new ConflictResolutionError("ROLLBACK_STALE", "Persisted plan changed before rollback");
      }
      const rollback = `${file}.${process.pid}.${randomUUID()}.rollback`;
      try {
        await writeFile(rollback, original, { encoding: "utf8", mode: metadata.mode });
        await rename(rollback, file);
      } catch (error: unknown) {
        await rm(rollback, { force: true }).catch(() => undefined);
        throw error;
      }
    },
  };
}

/** Resolves one explicit pointer conflict under plan, file, and base CAS fences. */
export async function resolveConflict(
  deps: ConflictDeps,
  input: ResolveConflictInput,
): Promise<Plan> {
  if (deps.resolvedBy.trim().length === 0) {
    throw new ConflictResolutionError("ACTOR_REQUIRED", "A trusted resolution actor is required");
  }
  const plan = loadPlanForDeps(deps, input.planId);
  if (plan === null) {
    throw new ConflictResolutionError("PLAN_NOT_FOUND", "Persisted plan is missing or failed integrity validation");
  }
  if (plan.planSha256 !== input.expectedPlanSha256) {
    throw new ConflictResolutionError("PLAN_FENCE_MISMATCH", "Persisted plan digest does not match the request fence");
  }
  assertPlanBaseFence(deps, plan);
  const item = plan.items.find((candidate) => candidate.kind === input.kind && candidate.key === input.key);
  if (item === undefined || item.operation !== "conflict") {
    throw new ConflictResolutionError("CONFLICT_NOT_FOUND", "The requested entity has no unresolved conflict");
  }

  const state = await loadEntityState(deps, plan, item);
  const resolvedAt = (deps.now?.() ?? new Date()).toISOString();
  const detected = detectConflicts({
    kind: item.kind,
    key: item.key,
    base: state.base,
    ours: state.ours,
    theirs: state.theirs,
  });
  const attributed = withExistingResolutions(
    await attributeConflicts(detected.conflicts, deps.attributionTimeoutMs),
    item,
    deps.resolvedBy,
    resolvedAt,
  );
  assertUnresolvedConflictsRemainDetectable(item, attributed);
  const path = normalizePath(input.path);
  const target = attributed.find((conflict) => conflict.path === path);
  if (target === undefined || target.resolution !== null) {
    throw new ConflictResolutionError("CONFLICT_NOT_FOUND", "The requested field conflict is absent or already resolved");
  }
  if (input.resolution.choice === "edited") canonicalJson(input.resolution.value);
  const nextOurs = resolvedOurs(state.ours, target, input.resolution);
  const nextBase = resolvedBase(state.base, target, input.resolution);
  const currentConflicts = attributed.map((conflict) => conflict === target
    ? { ...conflict, resolution: resolutionFor(input.resolution, deps.resolvedBy, resolvedAt) }
    : conflict);
  const redetected = await attributeConflicts(detectConflicts({
    kind: item.kind,
    key: item.key,
    base: nextBase,
    ours: nextOurs,
    theirs: state.theirs,
  }).conflicts, deps.attributionTimeoutMs);
  const currentByPath = new Map(currentConflicts.map((conflict) => [conflict.path, conflict]));
  const unresolved = redetected.some((conflict) => {
    const current = currentByPath.get(conflict.path);
    return current === undefined || current.resolution === null;
  });
  const operation = unresolved ? "conflict" : localOperation(nextBase, nextOurs);
  const fields = operation === "noop"
    ? []
    : operation === "conflict"
      ? threeWayDiff(nextBase, nextOurs, state.theirs)
      : threeWayDiff(nextBase, nextOurs, nextBase);
  const nextItem: PlanItem = {
    ...item,
    operation,
    fields,
    conflicts: conflictHistory(item, redetected, currentConflicts),
    error: null,
    referrers: [],
  };
  const source = state.working === null ? null : { file: state.working.file, line: 1 };
  let candidate = validateAndSummarize(deps, plan, nextItem, nextOurs, source);
  const candidateItem = candidate.items.find((value) => value.kind === item.kind && value.key === item.key);
  if (input.resolution.choice === "edited" && candidateItem?.error !== null && candidateItem?.error !== undefined) {
    throw new ConflictResolutionError("EDITED_VALUE_INVALID", candidateItem.error.message);
  }

  let workingRollback: WorkingMaterialization | null = null;
  let planRollback: PersistedReplacement | null = null;
  let transactionOpen = false;
  try {
    const writesWorking = input.resolution.choice !== "take-ours"
      && ((state.ours === undefined) !== (nextOurs === undefined)
        || (state.ours !== undefined && nextOurs !== undefined
          && canonicalJson(state.ours) !== canonicalJson(nextOurs)));
    if (input.resolution.choice === "take-theirs") {
      deps.db.exec("BEGIN IMMEDIATE");
      transactionOpen = true;
    }
    if (writesWorking) {
      const materialize = deps.materializeWorking ?? materializeExistingWorking;
      workingRollback = await materialize({
        adapter: state.adapter,
        worktreeRoot: deps.worktreeRoot,
        key: item.key,
        file: state.working?.file ?? null,
        expectedFileSha256: state.fileSha256,
        currentPayload: state.ours,
        nextPayload: nextOurs,
      });
      await verifyWorking(deps, state.adapter, item.key, nextOurs);
    }
    if (input.resolution.choice === "take-theirs") {
      const remote = await remoteEntity(deps, state.adapter, plan, item.key);
      if ((remote === null) !== (state.theirs === undefined)
        || (remote !== null && state.theirs !== undefined
          && canonicalJson(remote.payload) !== canonicalJson(state.theirs))) {
        throw new ConflictResolutionError("REMOTE_STALE", `Remote ${item.kind}/${item.key} moved after planning`);
      }
      advanceBaseToResolution(deps, plan, item, state.baseRow, nextBase, remote);
      candidate = refreshBaseFences(deps, candidate);
      const refreshedTarget = candidate.items.find((value) => value.kind === item.kind && value.key === item.key);
      if (refreshedTarget !== undefined) {
        candidate = validateAndSummarize(deps, candidate, refreshedTarget, nextOurs, source);
      }
    }
    planRollback = await replacePlanCas(deps, input.expectedPlanSha256, candidate);
    if (transactionOpen) {
      deps.db.exec("COMMIT");
      transactionOpen = false;
    }
    return candidate;
  } catch (error: unknown) {
    const rollbackErrors: unknown[] = [];
    if (transactionOpen) {
      try {
        deps.db.exec("ROLLBACK");
      } catch (rollbackError: unknown) {
        rollbackErrors.push(rollbackError);
      } finally {
        transactionOpen = false;
      }
    }
    if (planRollback !== null) {
      try {
        await planRollback.rollback();
      } catch (rollbackError: unknown) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (workingRollback !== null) {
      try {
        await workingRollback.rollback();
      } catch (rollbackError: unknown) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new ConflictResolutionError(
        "ROLLBACK_FAILED",
        "Conflict resolution failed and compensation could not restore every local artifact",
        { cause: new AggregateError([error, ...rollbackErrors]) },
      );
    }
    throw error;
  }
}
