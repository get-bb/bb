import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import { RemoteError } from "../../../lib/remote/types.js";
import { toStorageProjectVersionId } from "../../../lib/store/index.js";
import { ENTITIES, parseKey, type EntityKind } from "../../../lib/sync/registry.js";
import type { JsonValue } from "../../../shared/contract.js";
import { planSchema } from "../../../shared/contract.js";
import {
  registeredAdapters,
  registeredResolver,
  type EntityAdapter,
  type ServerEntity,
  type SyncScope,
  type WorkingEntity,
} from "../engine/adapter.js";
import type { EngineDeps } from "../engine/pull.js";
import { syncMetadata } from "../engine/status.js";
import { refinePlanCandidate } from "../conflicts/attribution.js";
import { canonicalJson, contentHash } from "../serialize/canonical.js";
import { BaseSnapshotStore, type BaseRow } from "../store/base-snapshot.js";
import { IdMapStore } from "../store/id-map.js";
import { blastRadius } from "./blast-radius.js";
import {
  classifyThreeWay,
  sameEntity,
  threeWayDiff,
} from "./diff.js";
import { orderPlanItems, planItemId, type ReferenceGraph } from "./order.js";
import {
  validatePlanItems,
  type SourceLocation,
  type ValidateCtx,
} from "./validate.js";

export type PlanOp = "create" | "update" | "delete" | "noop" | "conflict" | "orphan";

export interface FieldValue {
  present: boolean;
  value: JsonValue | null;
}

export interface FieldDiff {
  field: string;
  base: FieldValue;
  ours: FieldValue;
  theirs: FieldValue;
}

export interface Conflict {
  field: string;
  base: FieldValue;
  ours: FieldValue;
  theirs: FieldValue;
  attribution: { actor: string | null; at: string | null; source: string | null } | null;
  suggestion: "take-ours" | "take-theirs" | null;
  resolution:
    | { choice: "take-ours" }
    | { choice: "take-theirs" }
    | { choice: "edited"; value: JsonValue }
    | null;
}

export interface ValidationError {
  code: string;
  message: string;
  artifactId: string | null;
  line: number | null;
}

export interface EntityRef {
  projectId: string;
  projectVersionId: string | null;
  kind: EntityKind;
  key: string;
  label: string;
}

export interface PlanItem {
  projectId: string;
  projectVersionId: string | null;
  kind: EntityKind;
  key: string;
  label: string;
  operation: PlanOp;
  expectedBaseContentHash: string | null;
  fields: FieldDiff[];
  conflicts: Conflict[];
  referrers: EntityRef[];
  error: ValidationError | null;
}

export interface Plan {
  projectId: string;
  projectVersionId: string | null;
  planId: string;
  planSha256: string;
  baseGenerationIds: Record<string, string>;
  baseRevisions: Record<string, number>;
  baseStateSha256: string;
  createdAt: string;
  staleness: { asOf: string; degraded: boolean };
  items: PlanItem[];
  summary: {
    creates: number;
    updates: number;
    deletes: number;
    noops: number;
    conflicts: number;
    orphans: number;
  };
  blastRadius: {
    requiresHumanReview: boolean;
    changed: number;
    deletes: number;
    remoteCalls: number;
    surfaces: string[];
  };
  validationErrors: ValidationError[];
  total: number | null;
  next: string | null;
  cache: {
    state: "fresh" | "stale" | "empty";
    asOf: string | null;
    message: string | null;
    acceptedGenerationId: string | null;
    baseRevision: number;
  };
}

export interface PlanRequest extends SyncScope {
  kinds?: EntityKind[];
  pageSize?: number;
  continuation?: string | null;
}

interface AdapterState {
  adapter: EntityAdapter;
  baseRows: BaseRow[];
  base: Map<string, Record<string, unknown>>;
  workingRows: WorkingEntity[];
  working: Map<string, Record<string, unknown>>;
  workingAvailable: boolean;
  issues: WorkingIssue[];
}

interface WorkingIssue {
  file: string;
  line: number | null;
  message: string;
}

class PlanRemoteDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanRemoteDataError";
  }
}

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const PLAN_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/u;
const PLAN_PAGE = /^fsp1:([0-9A-HJKMNP-TV-Z]{26}):([0-9]+)$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isWorkingEntity(value: unknown): value is WorkingEntity {
  return isRecord(value)
    && typeof value["key"] === "string"
    && isRecord(value["payload"])
    && typeof value["file"] === "string";
}

function issueFromUnknown(value: unknown): WorkingIssue | null {
  if (!isRecord(value) || typeof value["file"] !== "string") return null;
  const line = value["line"];
  return {
    file: value["file"],
    line: typeof line === "number" && Number.isInteger(line) && line > 0 ? line : null,
    message: value instanceof Error ? value.message : "Working artifact could not be parsed",
  };
}

function partialWorkingRead(error: unknown): { rows: WorkingEntity[]; issues: WorkingIssue[] } | null {
  if (!isRecord(error)) return null;
  const working = error["partialWorking"];
  const issues = error["issues"];
  if (
    !Array.isArray(working)
    || !working.every(isWorkingEntity)
    || !Array.isArray(issues)
  ) {
    return null;
  }
  const parsedIssues = issues.map(issueFromUnknown);
  if (parsedIssues.some((issue) => issue === null)) return null;
  return {
    rows: working,
    issues: parsedIssues.filter((issue): issue is WorkingIssue => issue !== null),
  };
}

function encodeBase32(value: bigint, length: number): string {
  let remaining = value;
  let encoded = "";
  for (let index = 0; index < length; index += 1) {
    encoded = `${ULID_ALPHABET[Number(remaining & 31n)]}${encoded}`;
    remaining >>= 5n;
  }
  return encoded;
}

function createUlid(date: Date): string {
  const timestamp = BigInt(date.getTime());
  if (timestamp < 0n || timestamp > 281_474_976_710_655n) {
    throw new RangeError("Plan timestamp is outside the ULID range");
  }
  const entropy = randomBytes(10).reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);
  return `${encodeBase32(timestamp, 10)}${encodeBase32(entropy, 16)}`;
}

function selectedAdapters(deps: EngineDeps, kinds: readonly EntityKind[] | undefined): EntityAdapter[] {
  const requested = kinds === undefined ? null : new Set(kinds);
  const adapters = [...(deps.adapters ?? registeredAdapters())]
    .filter((adapter) => requested === null || requested.has(adapter.kind))
    .sort((left, right) => left.kind.localeCompare(right.kind));
  if (kinds !== undefined) {
    const available = new Set(adapters.map((adapter) => adapter.kind));
    const missing = kinds.find((kind) => !available.has(kind));
    if (missing !== undefined) throw new Error(`No plan adapter is registered for ${missing}`);
  }
  if (adapters.length === 0) throw new Error("No sync adapters are registered");
  return adapters;
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
  deps: EngineDeps,
  scope: SyncScope,
  storageVersionId: string,
): (remoteId: string) => string | null {
  const resolved = new Map<string, string>();
  for (const entry of new IdMapStore(deps.db).dumpAccepted(scope.projectId, storageVersionId)) {
    const identity = stableIdentity(entry.entityKey);
    const prior = resolved.get(entry.remoteId);
    if (prior !== undefined && prior !== identity) {
      throw new Error(`Accepted id map contains ambiguous remote id ${entry.remoteId}`);
    }
    resolved.set(entry.remoteId, identity);
  }
  return (remoteId) => resolved.get(remoteId) ?? null;
}

function comparablePayload(
  adapter: EntityAdapter,
  payload: Record<string, unknown>,
  remoteEnvelope: boolean,
  idToSlug: (remoteId: string) => string | null,
): Record<string, unknown> {
  const normalized = remoteEnvelope ? adapter.serializer.semanticPayload(payload) : payload;
  const yaml = adapter.serializer.toYaml(normalized, {
    idToSlug,
    onWarning: () => undefined,
  });
  return adapter.serializer.fromYaml(yaml, `<plan:${adapter.kind}>`);
}

function mapComparable<T extends { key: string; payload: Record<string, unknown> }>(
  values: readonly T[],
  normalize: (value: T) => Record<string, unknown>,
  kind: EntityKind,
): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  for (const value of values) {
    const normalized = normalize(value);
    const prior = result.get(value.key);
    if (prior !== undefined && canonicalJson(prior) !== canonicalJson(normalized)) {
      throw new PlanRemoteDataError(`${kind}/${value.key} has conflicting duplicate entities`);
    }
    result.set(value.key, normalized);
  }
  return result;
}

async function readAdapterState(
  deps: EngineDeps,
  scope: SyncScope,
  storageVersionId: string,
  adapter: EntityAdapter,
): Promise<AdapterState> {
  const baseRows = new BaseSnapshotStore(deps.db).listAccepted(
    scope.projectId,
    storageVersionId,
    adapter.kind,
  );
  const idToSlug = acceptedIdResolver(deps, scope, storageVersionId);
  const base = mapComparable(
    baseRows.map((row) => ({ key: row.entityKey, payload: row.payload })),
    (row) => comparablePayload(adapter, row.payload, false, idToSlug),
    adapter.kind,
  );
  const worktreeRoot = deps.worktreeRoot;
  if (worktreeRoot === undefined || worktreeRoot === null) {
    return {
      adapter,
      baseRows,
      base,
      workingRows: [],
      working: new Map(base),
      workingAvailable: false,
      issues: [],
    };
  }

  let workingRows: WorkingEntity[];
  let issues: WorkingIssue[] = [];
  try {
    workingRows = await adapter.readWorking(worktreeRoot, scope);
  } catch (error: unknown) {
    const partial = partialWorkingRead(error);
    if (partial === null) throw error;
    workingRows = partial.rows;
    issues = partial.issues;
  }
  return {
    adapter,
    baseRows,
    base,
    workingRows,
    working: mapComparable(
      workingRows,
      (row) => comparablePayload(adapter, row.payload, false, idToSlug),
      adapter.kind,
    ),
    workingAvailable: true,
    issues,
  };
}

async function fetchRemoteState(
  scope: SyncScope,
  states: readonly AdapterState[],
  deps: EngineDeps,
  storageVersionId: string,
): Promise<Map<EntityKind, Map<string, Record<string, unknown>>>> {
  const result = new Map<EntityKind, Map<string, Record<string, unknown>>>();
  for (const state of states) {
    const rows: ServerEntity[] = [];
    for await (const page of state.adapter.fetchRemote(scope, () => undefined)) rows.push(...page);
    const idToSlug = acceptedIdResolver(deps, scope, storageVersionId);
    try {
      result.set(state.adapter.kind, mapComparable(
        rows,
        (row) => comparablePayload(state.adapter, row.payload, true, idToSlug),
        state.adapter.kind,
      ));
    } catch (error: unknown) {
      if (error instanceof PlanRemoteDataError) throw error;
      throw new PlanRemoteDataError(
        `${state.adapter.kind} remote payload could not be normalized: ${error instanceof Error ? error.message : "invalid data"}`,
      );
    }
  }
  return result;
}

function degradedRemote(states: readonly AdapterState[]): Map<EntityKind, Map<string, Record<string, unknown>>> {
  return new Map(states.map((state) => [state.adapter.kind, new Map(state.base)]));
}

function labelFor(key: string, payload: Readonly<Record<string, unknown>> | undefined): string {
  for (const field of ["reqId", "slug", "code", "componentSlug", "routeSignature", "id", "cve", "name"]) {
    const value = payload?.[field];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  try {
    const segments = parseKey(key);
    if (segments[0] === "finding" && segments[2] !== undefined) {
      const component = segments.at(-1);
      return component === undefined ? segments[2] : `${component} / ${segments[2]}`;
    }
    return segments.at(-1) ?? key;
  } catch {
    return key;
  }
}

function candidateKeys(state: AdapterState, remote: ReadonlyMap<string, Record<string, unknown>>): string[] {
  if (state.adapter.klass === "OVERLAY" && state.workingAvailable) {
    return [...state.working.keys()].sort((left, right) => left.localeCompare(right));
  }
  return [...new Set([...state.base.keys(), ...state.working.keys(), ...remote.keys()])]
    .sort((left, right) => left.localeCompare(right));
}

async function resolveOrphans(
  scope: SyncScope,
  states: readonly AdapterState[],
  remote: ReadonlyMap<EntityKind, ReadonlyMap<string, Record<string, unknown>>>,
  degraded: boolean,
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (degraded) return result;
  const registered = new Set(registeredAdapters());
  for (const state of states) {
    if (state.adapter.klass !== "OVERLAY" || !state.workingAvailable) continue;
    const resolver = registered.has(state.adapter) ? registeredResolver(state.adapter.kind) : undefined;
    for (const row of state.workingRows) {
      const resolved = resolver === undefined
        ? (remote.get(state.adapter.kind)?.has(row.key) === true || state.base.has(row.key))
        : (await resolver(row.key, scope)).resolved;
      result.set(`${state.adapter.kind}\0${row.key}`, !resolved);
    }
  }
  return result;
}

async function itemFromEntity(
  scope: SyncScope,
  state: AdapterState,
  remote: ReadonlyMap<string, Record<string, unknown>>,
  key: string,
  orphan: boolean,
): Promise<PlanItem> {
  const base = state.base.get(key);
  const working = state.working.get(key);
  const theirs = remote.get(key);
  const semanticFields = orphan ? [] : threeWayDiff(base, working, theirs);
  let operation: PlanOp = orphan
    ? "orphan" as const
    : !state.workingAvailable && !sameEntity(base, theirs)
      // Without authored state, start conservatively; semantic refinement
      // below can still prove a zero-conflict payload for the planned apply.
      ? "conflict" as const
      : classifyThreeWay(base, working, theirs, state.adapter.klass !== "OVERLAY");
  let fields = operation === "noop" ? [] : semanticFields;
  let conflicts: Conflict[] = [];
  if (operation === "conflict") {
    const refinement = await refinePlanCandidate({
      kind: state.adapter.kind,
      key,
      base,
      ours: working,
      theirs,
    });
    conflicts = refinement.conflicts;
    if (
      conflicts.length === 0
      && isRecord(refinement.merged)
    ) {
      const merged = structuredClone(refinement.merged);
      // Invariant: worktree-blind planned-ours is display-only. Such plans stay
      // degraded and push rejects them with PLAN_STALE; this reclassification
      // avoids a zero-conflict deadlock without granting apply authority.
      state.working.set(key, merged);
      operation = "update";
      fields = threeWayDiff(base, merged, theirs);
    }
  }
  const baseRow = state.baseRows.find((row) => row.entityKey === key);
  const payload = state.working.get(key) ?? base ?? theirs;
  return {
    ...scope,
    kind: state.adapter.kind,
    key,
    label: labelFor(key, payload),
    operation,
    expectedBaseContentHash: baseRow?.contentHash ?? null,
    fields,
    conflicts,
    referrers: [],
    error: null,
  };
}

function invalidWorkingItems(scope: SyncScope, state: AdapterState): PlanItem[] {
  return state.issues.map((issue, index) => ({
    ...scope,
    kind: state.adapter.kind,
    key: `invalid:${index + 1}:${contentHash(issue.file).slice(0, 16)}`,
    label: issue.file,
    operation: "noop",
    expectedBaseContentHash: null,
    fields: [],
    conflicts: [],
    referrers: [],
    error: {
      code: "WORKING_PARSE",
      message: issue.message,
      artifactId: issue.file,
      line: issue.line,
    },
  }));
}

function effectivePayload(
  item: PlanItem,
  state: AdapterState,
  remote: ReadonlyMap<string, Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined {
  if (item.operation === "delete") return state.base.get(item.key);
  if (!state.workingAvailable && !sameEntity(state.base.get(item.key), remote.get(item.key))) {
    return remote.get(item.key) ?? state.base.get(item.key);
  }
  if (item.operation === "noop") {
    const base = state.base.get(item.key);
    const theirs = remote.get(item.key);
    if (!sameEntity(base, theirs)) return theirs;
  }
  return state.working.get(item.key) ?? state.base.get(item.key) ?? remote.get(item.key);
}

function aliases(item: PlanItem, payload: Readonly<Record<string, unknown>>): string[] {
  const values = new Set([item.key, item.label]);
  try {
    const segments = parseKey(item.key);
    const tail = segments.at(-1);
    if (tail !== undefined) values.add(tail);
    if (segments[0] === "finding" && segments[2] !== undefined) values.add(segments[2]);
  } catch {
    // A typed working-file error item may intentionally use a diagnostic key.
  }
  for (const field of ["reqId", "slug", "code", "componentSlug", "routeSignature", "id", "cve", "name"]) {
    const value = payload[field];
    if (typeof value === "string") values.add(value);
  }
  return [...values].filter((value) => value.length > 0);
}

function collectStrings(value: unknown, output: Set<string>): void {
  if (typeof value === "string") {
    output.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, output);
    return;
  }
  if (isRecord(value)) {
    for (const entry of Object.values(value)) collectStrings(entry, output);
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
    for (const alias of aliases(item, payload)) {
      const values = owners.get(alias) ?? new Set<string>();
      values.add(id);
      owners.set(alias, values);
    }
  }

  const result = new Map<string, readonly string[]>();
  for (const item of items) {
    const id = planItemId(item);
    const payload = payloads.get(id);
    const references = new Set<string>();
    if (payload !== undefined) {
      const strings = new Set<string>();
      collectStrings(payload, strings);
      for (const value of strings) {
        for (const owner of owners.get(value) ?? []) {
          if (owner !== id) references.add(owner);
        }
      }
    }
    result.set(id, [...references].sort((left, right) => left.localeCompare(right)));
  }
  return result;
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

function acceptedGenerationId(values: Readonly<Record<string, string>>): string | null {
  const generations = new Set(Object.values(values));
  return generations.size === 1 ? generations.values().next().value ?? null : null;
}

function cacheState(
  metadata: ReturnType<typeof syncMetadata>,
  remoteDegraded: boolean,
  workingUnavailable: boolean,
): Plan["cache"] {
  const revisions = Object.values(metadata.baseRevisions);
  const degraded = remoteDegraded || workingUnavailable;
  const message = remoteDegraded && workingUnavailable
    ? "Working tree and upstream refresh unavailable; plan uses the accepted base only"
    : remoteDegraded
      ? "Upstream refresh unavailable; plan uses the accepted base"
      : workingUnavailable
        ? "Working tree unavailable; plan includes upstream changes only"
        : null;
  return {
    state: degraded ? (metadata.lastPull === null ? "empty" : "stale") : "fresh",
    asOf: metadata.lastPull,
    message,
    acceptedGenerationId: acceptedGenerationId(metadata.acceptedGenerationIds),
    baseRevision: revisions.length === 0 ? 0 : Math.max(...revisions),
  };
}

function withoutPlanSha(plan: Plan): Omit<Plan, "planSha256"> {
  const {
    planSha256: _planSha256,
    ...unsigned
  } = plan;
  return unsigned;
}

function fullPlanSha256(plan: Plan): string {
  return contentHash(withoutPlanSha(plan));
}

async function persistPlan(worktreeRoot: string, planValue: Plan): Promise<void> {
  const directory = join(worktreeRoot, ".fs-sync");
  const destination = join(directory, `plan-${planValue.planId}.json`);
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(planValue, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, destination);
  } catch (error: unknown) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function persistenceRoot(deps: EngineDeps): string | null {
  if (deps.worktreeRoot !== undefined && deps.worktreeRoot !== null) {
    return deps.worktreeRoot;
  }
  if (deps.db.memory || deps.db.name.length === 0) return null;
  return dirname(resolve(deps.db.name));
}

function regexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function sourceBlockLine(kind: EntityKind, key: string, text: string): number {
  const lines = text.split("\n");
  if (kind === "vexDecision") {
    try {
      const segments = parseKey(key);
      const cve = segments[0] === "finding" ? segments[2] : undefined;
      if (cve !== undefined) {
        const aggregate = new RegExp(`^\\s+${regexLiteral(cve)}:\\s*(?:#.*)?$`, "u");
        const aggregateLine = lines.findIndex((line) => aggregate.test(line));
        if (aggregateLine >= 0) return aggregateLine + 1;
      }
    } catch {
      // Fall through to the first authored decision field.
    }
    const decisionLine = lines.findIndex((line) => /^(?:status|justification|needs_completion|drift_state):/u.test(line));
    if (decisionLine >= 0) return decisionLine + 1;
  }
  return 1;
}

async function sourceLocationFor(
  worktreeRoot: string,
  kind: EntityKind,
  row: WorkingEntity,
): Promise<SourceLocation> {
  const root = resolve(worktreeRoot);
  const absolute = resolve(root, ...row.file.split("/"));
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) {
    return { file: row.file, line: 1 };
  }
  try {
    return {
      file: row.file,
      line: sourceBlockLine(kind, row.key, await readFile(absolute, "utf8")),
    };
  } catch {
    return { file: row.file, line: 1 };
  }
}

function parsePersistedPlan(value: unknown): Plan | null {
  const parsed = planSchema.safeParse(value);
  if (!parsed.success) return null;
  for (const item of parsed.data.items) {
    if (!Object.hasOwn(ENTITIES, item.kind)) return null;
    if (item.referrers.some((referrer) => !Object.hasOwn(ENTITIES, referrer.kind))) return null;
  }
  // planSchema is the external boundary; the registry checks above narrow its
  // free-form identifier fields to the frozen EntityKind union used internally.
  return parsed.data as Plan;
}

/** Computes, validates, orders, fences, and persists one read-only semantic plan. */
export async function computePlan(
  deps: EngineDeps,
  scope: SyncScope,
  kinds?: EntityKind[],
): Promise<Plan> {
  if (scope.projectId.trim().length === 0) throw new Error("projectId must not be empty");
  const adapters = selectedAdapters(deps, kinds);
  const selectedKinds = adapters.map((adapter) => adapter.kind);
  const storageVersionId = toStorageProjectVersionId(scope.projectVersionId);
  const before = syncMetadata(deps, scope, selectedKinds);
  const states = await Promise.all(adapters.map((adapter) => (
    readAdapterState(deps, scope, storageVersionId, adapter)
  )));

  let remoteDegraded = false;
  let remote: Map<EntityKind, Map<string, Record<string, unknown>>>;
  try {
    remote = await fetchRemoteState(scope, states, deps, storageVersionId);
  } catch (error: unknown) {
    if (error instanceof PlanRemoteDataError) throw error;
    if (error instanceof RemoteError && error.code === "REMOTE_ABORTED") throw error;
    remoteDegraded = true;
    remote = degradedRemote(states);
  }

  let orphans = new Map<string, boolean>();
  if (!remoteDegraded) {
    try {
      orphans = await resolveOrphans(scope, states, remote, false);
    } catch (error: unknown) {
      if (error instanceof RemoteError && error.code === "REMOTE_ABORTED") throw error;
      remoteDegraded = true;
      remote = degradedRemote(states);
      orphans = new Map();
    }
  }

  const items: PlanItem[] = [];
  const payloads = new Map<string, Readonly<Record<string, unknown>>>();
  const sources = new Map<string, SourceLocation>();
  for (const state of states) {
    const remoteRows = remote.get(state.adapter.kind) ?? new Map();
    for (const key of candidateKeys(state, remoteRows)) {
      const item = await itemFromEntity(
        scope,
        state,
        remoteRows,
        key,
        orphans.get(`${state.adapter.kind}\0${key}`) === true,
      );
      items.push(item);
      const payload = effectivePayload(item, state, remoteRows);
      if (payload !== undefined) payloads.set(planItemId(item), payload);
      const working = state.workingRows.find((row) => row.key === key);
      if (working !== undefined && deps.worktreeRoot !== undefined && deps.worktreeRoot !== null) {
        sources.set(
          planItemId(item),
          await sourceLocationFor(deps.worktreeRoot, state.adapter.kind, working),
        );
      }
    }
    items.push(...invalidWorkingItems(scope, state));
  }

  const references = referenceGraph(items, payloads);
  const ordered = orderPlanItems(items, references);
  const orderedById = new Map(ordered.map((item) => [planItemId(item), item]));
  const validationContext: ValidateCtx = {
    scope,
    items: orderedById,
    payloads,
    references,
    sources,
  };
  const validated = validatePlanItems(ordered, validationContext);
  const after = syncMetadata(deps, scope, selectedKinds);
  if (before.baseStateSha256 !== after.baseStateSha256) {
    throw new Error("PLAN_BASE_MOVED_DURING_COMPUTE: accepted base changed while planning");
  }

  const createdAt = (deps.now?.() ?? new Date()).toISOString();
  const workingUnavailable = states.some((state) => !state.workingAvailable);
  const degraded = remoteDegraded || workingUnavailable;
  const asOf = remoteDegraded ? before.lastPull ?? createdAt : createdAt;
  const unsignedPlan: Plan = {
    ...scope,
    planId: createUlid(new Date(createdAt)),
    planSha256: "",
    baseGenerationIds: before.acceptedGenerationIds,
    baseRevisions: before.baseRevisions,
    baseStateSha256: before.baseStateSha256,
    createdAt,
    staleness: { asOf, degraded },
    items: validated,
    summary: summary(validated),
    blastRadius: blastRadius(validated),
    validationErrors: validated.flatMap((item) => item.error === null ? [] : [item.error]),
    total: validated.length,
    next: null,
    cache: cacheState(before, remoteDegraded, workingUnavailable),
  };
  const computed: Plan = { ...unsignedPlan, planSha256: contentHash(withoutPlanSha(unsignedPlan)) };
  planSchema.parse(computed);
  const root = persistenceRoot(deps);
  if (root !== null) await persistPlan(root, computed);
  return computed;
}

/** Loads and integrity-checks one immutable persisted plan by ULID. */
export function loadPlan(worktreeRoot: string, planId: string): Plan | null {
  if (!PLAN_ID.test(planId)) return null;
  try {
    const planValue = parsePersistedPlan(JSON.parse(
      readFileSync(join(worktreeRoot, ".fs-sync", `plan-${planId}.json`), "utf8"),
    ));
    if (planValue === null || planValue.planId !== planId) return null;
    return fullPlanSha256(planValue) === planValue.planSha256 ? planValue : null;
  } catch {
    return null;
  }
}

/** Loads a plan from the worktree sidecar or the server-local RPC sidecar. */
export function loadPlanForDeps(deps: EngineDeps, planId: string): Plan | null {
  const root = persistenceRoot(deps);
  return root === null ? null : loadPlan(root, planId);
}

function pageCursor(continuation: string): { planId: string; offset: number } {
  const matched = PLAN_PAGE.exec(continuation);
  if (matched === null) throw new Error("PLAN_CONTINUATION_INVALID: malformed plan continuation token");
  const planId = matched[1];
  const offset = Number(matched[2]);
  if (planId === undefined || !PLAN_ID.test(planId) || !Number.isSafeInteger(offset)) {
    throw new Error("PLAN_CONTINUATION_INVALID: malformed plan continuation token");
  }
  return { planId, offset };
}

function sameScope(planValue: Plan, input: PlanRequest): boolean {
  return planValue.projectId === input.projectId
    && planValue.projectVersionId === input.projectVersionId;
}

/** Frozen-RPC facade: computes and persists once, then pages that exact plan by id. */
export async function plan(deps: EngineDeps, input: PlanRequest): Promise<Plan> {
  const pageSize = input.pageSize ?? 50;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
    throw new Error("Invalid plan page request");
  }
  let computed: Plan;
  let offset = 0;
  if (input.continuation === null || input.continuation === undefined) {
    computed = await computePlan(deps, {
      projectId: input.projectId,
      projectVersionId: input.projectVersionId,
    }, input.kinds);
    if (persistenceRoot(deps) === null) {
      throw new Error("PLAN_PERSISTENCE_UNAVAILABLE: plan paging requires a durable sidecar root");
    }
  } else {
    if (input.kinds !== undefined) {
      throw new Error("PLAN_CONTINUATION_INVALID: kinds are bound by the persisted plan token");
    }
    const cursor = pageCursor(input.continuation);
    offset = cursor.offset;
    const loaded = loadPlanForDeps(deps, cursor.planId);
    if (loaded === null) {
      throw new Error("PLAN_CONTINUATION_STALE: persisted plan is missing or failed integrity validation");
    }
    if (!sameScope(loaded, input)) {
      throw new Error("PLAN_CONTINUATION_SCOPE_MISMATCH: persisted plan belongs to another scope");
    }
    computed = loaded;
  }
  if (
    offset > computed.items.length
    || (input.continuation !== null
      && input.continuation !== undefined
      && offset === computed.items.length)
  ) {
    throw new Error("Invalid plan page request");
  }
  const items = computed.items.slice(offset, offset + pageSize);
  const nextOffset = offset + items.length;
  return {
    ...computed,
    items,
    validationErrors: items.flatMap((item) => item.error === null ? [] : [item.error]),
    total: computed.items.length,
    next: nextOffset < computed.items.length ? `fsp1:${computed.planId}:${nextOffset}` : null,
  };
}
