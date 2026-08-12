# WP-03 — `shared/contract.ts` — every RPC contract

**Lane:** L0 Foundation · **Spec refs:** SPEC 00 §5, §10–§12 · SPEC 01 §5–§8 · SPECs 02–06 UI/data contracts · RECON §1.2, §1.11 · **Effort:** 2 d · **Status:** unassigned
**Depends on:** WP-01 · **Blocks:** WP-05, WP-17, WP-21, and every panel/directive RPC consumer
**Produces a FROZEN artifact:** **yes** — `shared/contract.ts` and `CONTRACT_VERSION` freeze on merge

## Files you own
`plugins/bb-plugin-finite-state/shared/contract.ts` *(FROZEN)*
`plugins/bb-plugin-finite-state/shared/contract.test.ts`
`plugins/bb-plugin-finite-state/shared/contract.type-test.ts`

## Files you must not touch
`server.ts`, `app.tsx`, `lib/context.ts`, `lib/app-context.ts`, `lib/store/schema.ts`, `lib/sync/registry.ts`, `lib/remote/types.ts`, `test/mock-remote/fixtures/**`, `package.json`, `pnpm-lock.yaml`, or any lane.

## Context
All backend lanes and all React surfaces compile independently against this one Standard Schema contract. Product documentation uses stable dotted logical method names, but pinned bb RPC keys cannot contain dots. The exported `RPC_WIRE_METHODS` map is the one bijection to lower-camel wire keys used at `POST /api/v1/plugins/finite-state/rpc/<wireMethod>`; no lane derives or aliases names. bb validates input and output and owns the outer `{ok,result|error}` envelope. This contract therefore describes successful result values only. RPC is strict JSON; binary uploads/downloads, XLSX/SBOM exports, and large log/file streams are deliberately absent and use `bb.http`.

Pinned bb RPC supplies parsed input but no authenticated human actor or request submitter. The contract reserves `humanApprovalCapability` on human-only mutations, but v1 has no capability mint path. Those contract methods are intentionally authorization-unavailable and must not be registered as executable mutation handlers until bb supplies verifiable actor/capability proof. A caller-provided boolean, plugin token, `requestInput` metadata, Origin/Host check, or CLI flag is never human authorization.

The frozen contract must be broad enough for every planned surface without embedding unstable server payloads. Put stable identity, paging, state, provenance, and summaries in typed schemas; carry entity-specific display payloads in a bounded `fields: z.record(z.string(), jsonValueSchema)` seam. Never use `z.any()`.

## What to build
1. Export `CONTRACT_VERSION = 1`, JSON-value schemas, stable-key schemas, the D-1 scope pair, opaque continuation paging, provenance, staleness, field-diff, validation error, and job state schemas. Every object is `.strict()`; recursive JSON values are the only open payload. Every project-data request carries `projectId` plus `projectVersionId`; null is project-level and literal `"@project"` is rejected because only the backend storage boundary may map it to `PROJECT_LEVEL_VERSION_ID`.
2. Export `RPC_WIRE_METHODS`, a literal bijection from every dotted logical name below to one lower-camel wire key, and define `rpcContract` only with those wire keys. The complete v1 logical method inventory is:
   - foundation: `connections.status`, `workspace.summary`;
   - sync: `sync.pull`, `sync.status`, `sync.plan`, `sync.conflict.resolve`, `sync.push`, `sync.push.retry`;
   - findings and local triage: `findings.list`, `findings.get`, `findings.facets`, `triage.run.get`, `triage.decision.write`, `triage.decision.bulkWrite`, `triage.decision.undo`, `triage.policy.preview`, `triage.policy.apply`, `triage.vendorVex.preview`, `triage.vendorVex.apply`, `triage.orphans.prune`;
   - product security: `tara.list`, `tara.get`, `tara.command.apply`, `tara.deleteImpact`, `requirements.list`, `requirements.get`, `requirements.write`, `ears.conversion.start`, `ears.conversion.get`, `ears.conversion.review`, `verifications.matrix`, `verifications.run.get`, `verifications.run.start`, `verifications.manualAttestation.record`, `review.transition`;
   - BOM: `bom.software.list`, `bom.component.get`, `hbom.review.list`, `hbom.review.resolve`, `hbom.extraction.apply`;
   - firmware: `firmware.mounts.list`, `firmware.mount.get`, `firmware.tree.list`, `firmware.file.get`, `firmware.diff`, `firmware.materialize.start`, `firmware.materialize.cancel`, `firmware.file.hydrate`;
   - bench: `bench.runs.list`, `bench.run.get`, `bench.logs.list`, `bench.verdict.get`, `bench.run.start`, `bench.hosts.list`, `bench.hosts.joinCode`;
   - documents: `documents.list`, `documents.get`, `documents.search`, `documents.metadata.update`, `documents.extractions.list`.
3. Give every list method `{items,total,next}` output and `{pageSize,continuation}` input. Bound `pageSize` to `1..200`; `continuation` and `next` are opaque strings. Never expose offset, page-number, or cursor aliases through the shared contract.
4. Model sync plan/push types fully enough for WP-18–21: operations, base/ours/theirs field diffs, conflicts, audit attribution, blast radius, validation errors, per-item push results, resumable run id, and plan staleness.
5. Model four UI states as data. `connections.status` reports Platform, Assurance Studio, and optional Forge Compute independently, with no secrets or raw endpoint values. A missing required Platform configuration is `needs-configuration`; an intentionally absent optional service is `disabled`; a configured service that fails its probe is `unreachable`, never `needs-configuration`. Cache-bearing reads include `cache: {state:"fresh"|"stale"|"empty",asOf,message}`. Do not encode loading; loading is client request state.
6. Separate mutation families in names, schemas, and documentation: **local authored writes** (`triage.*`, `tara.command.apply`, `requirements.write`, HBOM extraction/review) mutate CAS-protected worktree files only; **human sync writes** (`sync.push*`) apply a reviewed plan from the review panel; **human passthrough comments** (`findings.comments.*`) mutate only the selected version-specific server comment and explicitly do not carry forward; **ACTION-ONLY invocations** (`verifications.*`, `firmware.materialize*`, `firmware.file.hydrate`, `bench.run.start`, host enrollment) start work/evidence but never author model state. Agent tool authorization is separate and cannot infer access from this contract. `sync.conflict.resolve`, `sync.push*`, comment create/update/delete, HBOM resolve/extraction decisions, `review.transition`, and manual attestation inputs reserve `humanApprovalCapability`; because v1 cannot mint or verify one, handlers return authorization-unavailable before side effects and are not registered as executable mutations. The CLI only opens the relevant panel; the existence of a schema never permits an `fs_sync_push` tool or agent-readable executable push path.
7. Add runtime schema tests and compile-time handler/client inference tests using `defineRpcContract` and the SDK test types. Verify the exact export names (`defineRpcContract`, client hook inference) against the checked-out fork before freezing; RECON leaves no license to invent renamed SDK symbols.

## Interface contract
```ts
// shared/contract.ts — FROZEN. Amendment + CONTRACT_VERSION bump required after merge.
import { defineRpcContract } from "@bb/plugin-sdk";
import { z } from "zod";

export const CONTRACT_VERSION = 1 as const;
export const RPC_WIRE_METHODS = {
  "connections.status": "connectionsStatus",
  "workspace.summary": "workspaceSummary",
  "sync.pull": "syncPull",
  "sync.status": "syncStatus",
  "sync.plan": "syncPlan",
  "sync.conflict.resolve": "syncConflictResolve",
  "sync.push": "syncPush",
  "sync.push.retry": "syncPushRetry",
  "findings.list": "findingsList",
  "findings.get": "findingsGet",
  "findings.activity.list": "findingsActivityList",
  "findings.comments.list": "findingsCommentsList",
  "findings.comments.create": "findingsCommentsCreate",
  "findings.comments.update": "findingsCommentsUpdate",
  "findings.comments.delete": "findingsCommentsDelete",
  "findings.facets": "findingsFacets",
  "triage.run.get": "triageRunGet",
  "triage.decision.write": "triageDecisionWrite",
  "triage.decision.bulkWrite": "triageDecisionBulkWrite",
  "triage.decision.undo": "triageDecisionUndo",
  "triage.policy.preview": "triagePolicyPreview",
  "triage.policy.apply": "triagePolicyApply",
  "triage.vendorVex.preview": "triageVendorVexPreview",
  "triage.vendorVex.apply": "triageVendorVexApply",
  "triage.orphans.prune": "triageOrphansPrune",
  "tara.list": "taraList",
  "tara.get": "taraGet",
  "tara.command.apply": "taraCommandApply",
  "tara.deleteImpact": "taraDeleteImpact",
  "requirements.list": "requirementsList",
  "requirements.get": "requirementsGet",
  "requirements.write": "requirementsWrite",
  "ears.conversion.start": "earsConversionStart",
  "ears.conversion.get": "earsConversionGet",
  "ears.conversion.review": "earsConversionReview",
  "verifications.matrix": "verificationsMatrix",
  "verifications.run.get": "verificationsRunGet",
  "verifications.run.start": "verificationsRunStart",
  "verifications.manualAttestation.record": "verificationsManualAttestationRecord",
  "review.transition": "reviewTransition",
  "bom.software.list": "bomSoftwareList",
  "bom.component.get": "bomComponentGet",
  "hbom.review.list": "hbomReviewList",
  "hbom.review.resolve": "hbomReviewResolve",
  "hbom.extraction.apply": "hbomExtractionApply",
  "firmware.mounts.list": "firmwareMountsList",
  "firmware.mount.get": "firmwareMountGet",
  "firmware.tree.list": "firmwareTreeList",
  "firmware.file.get": "firmwareFileGet",
  "firmware.diff": "firmwareDiff",
  "firmware.materialize.start": "firmwareMaterializeStart",
  "firmware.materialize.cancel": "firmwareMaterializeCancel",
  "firmware.file.hydrate": "firmwareFileHydrate",
  "bench.runs.list": "benchRunsList",
  "bench.run.get": "benchRunGet",
  "bench.logs.list": "benchLogsList",
  "bench.verdict.get": "benchVerdictGet",
  "bench.run.start": "benchRunStart",
  "bench.hosts.list": "benchHostsList",
  "bench.hosts.joinCode": "benchHostsJoinCode",
  "documents.list": "documentsList",
  "documents.get": "documentsGet",
  "documents.search": "documentsSearch",
  "documents.metadata.update": "documentsMetadataUpdate",
  "documents.extractions.list": "documentsExtractionsList",
} as const;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(),
  z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema),
]));

export const scopeSchema = z.object({
  projectId: z.string().min(1),
  projectVersionId: z.string().min(1).refine((value) => value !== "@project").nullable(),
}).strict();
export const pageFields = {
  pageSize: z.number().int().min(1).max(200).default(50),
  continuation: z.string().min(1).nullable().default(null),
} as const;
export const scopedPageSchema = scopeSchema.extend(pageFields).strict();
export const humanApprovalCapabilitySchema = z.string().min(1).brand<"HumanApprovalCapability">();
export type HumanApprovalCapability = z.infer<typeof humanApprovalCapabilitySchema>;
export const cacheStateSchema = z.object({
  state: z.enum(["fresh", "stale", "empty"]),
  asOf: z.string().datetime().nullable(),
  message: z.string().nullable(),
  acceptedGenerationId: z.string().min(1).nullable(),
  baseRevision: z.number().int().nonnegative(),
}).strict();
export const entityRefSchema = z.object({
  kind: z.string().min(1), key: z.string().min(1), label: z.string().min(1),
}).strict();
export const documentLocatorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pdf"), page: z.number().int().positive(),
    bbox: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]).optional(),
  }).strict(),
  z.object({ kind: z.literal("sheet"), sheet: z.string().min(1).max(200), cell: z.string().min(1).max(64) }).strict(),
  z.object({ kind: z.literal("text"), lineStart: z.number().int().positive(), lineEnd: z.number().int().positive() }).strict(),
]);
export const documentSourceRefSchema = z.object({
  documentSha256: z.string().regex(/^[a-f0-9]{64}$/u), locator: documentLocatorSchema,
}).strict().superRefine((value, ctx) => {
  if (value.locator.kind === "text" && value.locator.lineEnd < value.locator.lineStart) {
    ctx.addIssue({ code: "custom", message: "lineEnd must be >= lineStart" });
  }
});
export type DocumentLocator = z.infer<typeof documentLocatorSchema>;
export type DocumentSourceRef = z.infer<typeof documentSourceRefSchema>;
export const entitySummarySchema = entityRefSchema.extend({
  fields: z.record(z.string(), jsonValueSchema),
}).strict();
export const pageResultSchema = <T extends z.ZodTypeAny>(item: T) => z.object({
  items: z.array(item), total: z.number().int().nonnegative(), next: z.string().nullable(),
  cache: cacheStateSchema,
}).strict();

export const planOpSchema = z.enum(["create", "update", "delete", "noop", "conflict", "orphan"]);
export const fieldDiffSchema = z.object({
  field: z.string(), base: jsonValueSchema, ours: jsonValueSchema,
  theirs: jsonValueSchema.optional(),
}).strict();
export const conflictResolutionSchema = z.discriminatedUnion("choice", [
  z.object({ choice: z.literal("take-ours") }).strict(),
  z.object({ choice: z.literal("take-theirs") }).strict(),
  z.object({ choice: z.literal("edited"), value: jsonValueSchema }).strict(),
]);
export const attributionSchema = z.object({
  actor: z.string().nullable(), at: z.string().datetime().nullable(), source: z.string().nullable(),
}).strict();
export const conflictSchema = z.object({
  field: z.string(), base: jsonValueSchema, ours: jsonValueSchema, theirs: jsonValueSchema,
  attribution: attributionSchema.nullable(), suggestion: z.enum(["take-ours", "take-theirs"]).nullable(),
  resolution: conflictResolutionSchema.nullable(),
}).strict();
export const validationErrorSchema = z.object({
  code: z.string(), message: z.string(), file: z.string().nullable(), line: z.number().int().positive().nullable(),
}).strict();
export const planItemSchema = z.object({
  kind: z.string(), key: z.string(), label: z.string(), op: planOpSchema,
  expectedBaseContentHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  fields: z.array(fieldDiffSchema), conflicts: z.array(conflictSchema),
  referrers: z.array(entityRefSchema), error: validationErrorSchema.nullable(),
}).strict();
export const planSummarySchema = z.object({
  creates: z.number().int().nonnegative(), updates: z.number().int().nonnegative(),
  deletes: z.number().int().nonnegative(), noops: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(), orphans: z.number().int().nonnegative(),
}).strict();
export const planSchema = z.object({
  planId: z.string(), planSha256: z.string(), scope: scopeSchema, createdAt: z.string().datetime(),
  baseGenerationIds: z.record(z.string(), z.string().min(1)),
  baseRevisions: z.record(z.string(), z.number().int().nonnegative()),
  baseStateSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  staleness: z.object({ asOf: z.string().datetime(), degraded: z.boolean() }).strict(),
  items: z.array(planItemSchema), summary: planSummarySchema,
  blastRadius: z.object({ requiresConfirmation: z.boolean(), changed: z.number().int().nonnegative(), deletes: z.number().int().nonnegative(), apiCalls: z.number().int().nonnegative(), surfaces: z.array(z.string()) }).strict(),
  validationErrors: z.array(validationErrorSchema),
}).strict();
export const statusChangeSchema = z.object({
  kind: z.string(), key: z.string(), fields: z.array(z.string()), file: z.string().nullable(),
}).strict();
export const pushSummarySchema = z.object({
  total: z.number().int().nonnegative(), applied: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(),
}).strict();
export const pushItemResultSchema = z.object({
  kind: z.string(), key: z.string(), status: z.enum(["applied", "failed", "skipped"]),
  error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).strict().nullable(),
}).strict();
export const pushReportSchema = z.object({
  runId: z.string(), status: z.enum(["completed", "partial", "failed"]), summary: pushSummarySchema,
  results: z.array(pushItemResultSchema), total: z.number().int().nonnegative(),
  next: z.string().nullable(), requiresPull: z.boolean(),
}).strict();
export const entityDetailSchema = entitySummarySchema.extend({
  links: z.array(entityRefSchema), cache: cacheStateSchema,
}).strict();
export const filtersSchema = z.record(z.string(), jsonValueSchema).default({});

const serviceConnectionSchema = z.object({
  state: z.enum(["needs-configuration", "disabled", "configured", "connected", "unreachable"]),
  endpointLabel: z.string().nullable(), message: z.string().nullable(),
}).strict();
const connectionsStatusSchema = z.object({
  platform: serviceConnectionSchema,
  assuranceStudio: serviceConnectionSchema,
  forgeCompute: serviceConnectionSchema,
}).strict();
const workspaceSummarySchema = z.object({
  scope: scopeSchema,
  surfaces: z.array(z.object({ id: z.string(), pending: z.number().int().nonnegative(), conflicts: z.number().int().nonnegative(), cache: cacheStateSchema }).strict()),
}).strict();
const pullReportSchema = z.object({
  generationId: z.string().min(1), acceptedAt: z.string().datetime(),
  kinds: z.record(z.string(), z.object({ fetched: z.number().int().nonnegative(), baseRows: z.number().int().nonnegative() }).strict()),
  workingFastForwarded: z.boolean(), divergence: z.array(z.string()),
}).strict();
const statusReportSchema = z.object({
  acceptedGenerationIds: z.record(z.string(), z.string().min(1)),
  stagingGenerationIds: z.record(z.string(), z.string().min(1)),
  baseRevisions: z.record(z.string(), z.number().int().nonnegative()),
  local: z.array(statusChangeSchema), upstream: z.array(statusChangeSchema),
  conflicts: z.array(statusChangeSchema), orphans: z.array(statusChangeSchema),
}).strict();
const facetsSchema = z.object({
  severity: z.record(z.string(), z.number().int().nonnegative()),
  triage: z.record(z.string(), z.number().int().nonnegative()),
  total: z.number().int().nonnegative(), cache: cacheStateSchema,
}).strict();
const triageRunSchema = z.object({
  id: z.string(), written: z.number().int().nonnegative(), held: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(), findingIds: z.array(z.string()), cache: cacheStateSchema,
}).strict();
const vexStatusSchema = z.enum(["EXPLOITABLE", "IN_TRIAGE", "NOT_AFFECTED", "FALSE_POSITIVE", "RESOLVED", "RESOLVED_WITH_PEDIGREE"]);
const vexResponseSchema = z.enum(["CAN_NOT_FIX", "WILL_NOT_FIX", "UPDATE", "ROLLBACK", "WORKAROUND_AVAILABLE"]);
const vexJustificationSchema = z.enum(["CODE_NOT_PRESENT", "CODE_NOT_REACHABLE", "REQUIRES_CONFIGURATION", "REQUIRES_DEPENDENCY", "REQUIRES_ENVIRONMENT", "PROTECTED_BY_COMPILER", "PROTECTED_AT_RUNTIME", "PROTECTED_AT_PERIMETER", "PROTECTED_BY_MITIGATING_CONTROL"]);
const triageDecisionSchema = z.object({
  stableKey: z.string(), status: vexStatusSchema, response: vexResponseSchema.nullable(),
  justification: vexJustificationSchema.nullable(), reason: z.string(), evidence: z.string(),
  pin: z.enum(["exact_version", "any_version"]), expectedSha256: z.string().nullable(),
}).strict();
const localWriteResultSchema = z.object({
  path: z.string(), beforeSha256: z.string().nullable(), afterSha256: z.string(),
  changedFields: z.array(z.string()), diffSummary: z.string(),
}).strict();
const localBatchResultSchema = z.object({
  runId: z.string(), total: z.number().int().nonnegative(), applied: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(), results: z.array(z.object({ stableKey: z.string(), success: z.boolean(), error: validationErrorSchema.nullable() }).strict()),
}).strict();
const policyReportSchema = z.object({
  runId: z.string(), dryRun: z.boolean(), written: z.number().int().nonnegative(),
  held: z.number().int().nonnegative(), skippedExisting: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(), samples: z.array(entityRefSchema), next: z.string().nullable(),
}).strict();
const vendorVexReportSchema = z.object({
  importId: z.string(), format: z.enum(["cyclonedx", "csaf", "openvex"]), digest: z.string(),
  matched: z.number().int().nonnegative(), unmatched: z.number().int().nonnegative(),
  needsCompletion: z.number().int().nonnegative(), keptLocal: z.number().int().nonnegative(),
  written: z.number().int().nonnegative(), errors: z.number().int().nonnegative(),
  next: z.string().nullable(),
}).strict();
const taraCommandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create"), kind: z.enum(["component", "zone", "asset", "dataflow", "threat"]), entity: jsonValueSchema, expectedSha256: z.null() }).strict(),
  z.object({ operation: z.literal("update"), kind: z.enum(["component", "zone", "asset", "dataflow", "threat"]), slug: z.string(), patch: z.record(z.string(), jsonValueSchema), expectedSha256: z.string() }).strict(),
  z.object({ operation: z.literal("delete"), kind: z.enum(["component", "zone", "asset", "dataflow", "threat"]), slug: z.string(), mode: z.enum(["cascade", "detach"]), expectedSha256: z.string() }).strict(),
]);
const deleteImpactSchema = z.object({
  slug: z.string(), referrers: z.array(z.object({ kind: z.string(), slug: z.string(), effect: z.string() }).strict()),
  allowedActions: z.array(z.enum(["cascade", "detach"])), restorable: z.boolean(),
}).strict();
const conversionSchema = z.object({
  id: z.string(), threadId: z.string().nullable(), snapshotDigest: z.string(),
  state: z.enum(["preparing", "running", "validating", "awaiting_human", "reviewed", "discarded", "failed"]),
  requirementIds: z.array(z.string()), errors: z.array(validationErrorSchema), cache: cacheStateSchema,
}).strict();
const actionJobSchema = z.object({
  id: z.string(), state: z.enum(["QUEUED", "RUNNING", "COMPLETED", "FAILED", "TIMEOUT"]),
  progress: z.number().min(0).max(1).nullable(), message: z.string().nullable(),
}).strict();
const attestationRecordSchema = z.object({
  id: z.string(), runId: z.string(), firmwareDigest: z.string(), evidenceDigest: z.string(),
  verification: z.enum(["valid", "invalid", "unverified"]),
}).strict();
const hbomResolveSchema = z.object({
  outcome: z.enum(["written", "conflict"]), sha256: z.string().nullable(), currentSha256: z.string().nullable(),
  accepted: z.number().int().nonnegative(), rejected: z.number().int().nonnegative(),
}).strict();
const hbomExtractionSchema = z.object({
  path: z.literal("product-security/hbom/hbom.yaml"), hbomSha256: z.string(),
  merged: z.number().int().nonnegative(), queued: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(), candidatesAdded: z.number().int().nonnegative(),
  rejected: z.array(z.object({ index: z.number().int().nonnegative(), code: z.string(), message: z.string() }).strict()),
  diffSummary: z.string(),
}).strict();
const firmwareStatusSchema = z.object({
  projectId: z.string(), projectVersionId: z.string(), source: z.enum(["standalone_unpack", "api"]).nullable(),
  state: z.enum(["not_materialized", "hashing", "unpacking", "validating", "ingesting", "ready", "ready_with_gaps", "metadata_only", "stale", "error"]),
  files: z.number().int().nonnegative(), materializedFiles: z.number().int().nonnegative(), errors: z.number().int().nonnegative(),
  inputSha256: z.string().nullable(), artifactHash: z.string().nullable(), message: z.string().nullable(), cache: cacheStateSchema,
}).strict();
const firmwareFileSchema = z.object({
  projectId: z.string(), projectVersionId: z.string(), path: z.string(), fileHash: z.string(), size: z.number().int().nonnegative().nullable(),
  mimeType: z.string().nullable(), fields: z.record(z.string(), jsonValueSchema),
  previewHex: z.string().max(512).nullable(), previewBytes: z.number().int().min(0).max(256),
  materialized: z.boolean(), cache: cacheStateSchema,
}).strict();
const hostSchema = z.object({
  id: z.string(), name: z.string(), status: z.string(), capabilities: z.array(z.string()), lastSeenAt: z.string().datetime().nullable(),
}).strict();
const benchRunStartedSchema = z.object({
  runId: z.string(), threadId: z.string(), jobIds: z.array(z.string()), firmwareDigest: z.string(),
  status: z.enum(["queued", "running"]),
}).strict();
const documentSearchHitSchema = z.object({
  documentSha256: z.string(), documentName: z.string(), field: z.string(), value: z.string(),
  confidence: z.number().min(0).max(1).nullable(), sourceRef: z.string(), snippet: z.string().nullable(),
  target: entityRefSchema.nullable(),
}).strict();
const findingCommentSchema = z.object({
  id: z.string(), findingId: z.string(), actor: z.string().nullable(), text: z.string(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime().nullable(),
}).strict();
const benchLogsSchema = z.object({
  items: z.array(z.object({ seq: z.number().int().nonnegative(), at: z.string().datetime(), level: z.string(), text: z.string() }).strict()),
  nextSeq: z.number().int().nonnegative().nullable(), cache: cacheStateSchema,
}).strict();
const verdictSchema = z.object({
  id: z.string(), verdict: z.enum(["green", "amber", "red"]), firmwareSha256: z.string(),
  required: z.number().int().nonnegative(), proven: z.number().int().nonnegative(),
  evidenceIds: z.array(z.string()), reasons: z.array(z.string()), cache: cacheStateSchema,
}).strict();

export const rpcContract = defineRpcContract({
  connectionsStatus: { input: z.null(), output: connectionsStatusSchema },
  workspaceSummary: { input: scopeSchema, output: workspaceSummarySchema },
  syncPull: { input: scopeSchema.extend({ kinds: z.array(z.string()).optional() }).strict(), output: pullReportSchema },
  syncStatus: { input: scopeSchema.extend({ kinds: z.array(z.string()).optional() }).strict(), output: statusReportSchema },
  syncPlan: { input: scopeSchema.extend({ kinds: z.array(z.string()).optional() }).strict(), output: planSchema },
  syncConflictResolve: { input: z.object({ scope: scopeSchema, planId: z.string(), expectedPlanSha256: z.string(), expectedBaseStateSha256: z.string(), kind: z.string(), key: z.string(), field: z.string(), resolution: conflictResolutionSchema, humanApprovalCapability: humanApprovalCapabilitySchema }).strict(), output: planSchema },
  syncPush: { input: z.object({ scope: scopeSchema, planId: z.string(), expectedPlanSha256: z.string(), expectedBaseStateSha256: z.string(), humanApprovalCapability: humanApprovalCapabilitySchema, pageSize: pageFields.pageSize, continuation: pageFields.continuation }).strict(), output: pushReportSchema },
  syncPushRetry: { input: z.object({ scope: scopeSchema, runId: z.string(), expectedPlanSha256: z.string(), expectedBaseStateSha256: z.string(), humanApprovalCapability: humanApprovalCapabilitySchema, keys: z.array(z.string()).max(500).optional(), pageSize: pageFields.pageSize, continuation: pageFields.continuation }).strict(), output: pushReportSchema },

  findingsList: { input: scopedPageSchema.extend({ filters: filtersSchema }).strict(), output: pageResultSchema(entitySummarySchema) },
  findingsGet: { input: z.object({ scope: scopeSchema, id: z.string().min(1) }).strict(), output: entityDetailSchema },
  findingsActivityList: { input: z.object({ scope: scopeSchema, findingId: z.string(), ...pageFields }).strict(), output: pageResultSchema(entitySummarySchema) },
  findingsCommentsList: { input: z.object({ scope: scopeSchema, findingId: z.string(), ...pageFields }).strict(), output: pageResultSchema(findingCommentSchema) },
  findingsCommentsCreate: { input: z.object({ scope: scopeSchema, findingId: z.string(), text: z.string().trim().min(1).max(10000), humanApprovalCapability: humanApprovalCapabilitySchema }).strict(), output: findingCommentSchema },
  findingsCommentsUpdate: { input: z.object({ scope: scopeSchema, findingId: z.string(), commentId: z.string(), text: z.string().trim().min(1).max(10000), humanApprovalCapability: humanApprovalCapabilitySchema }).strict(), output: findingCommentSchema },
  findingsCommentsDelete: { input: z.object({ scope: scopeSchema, findingId: z.string(), commentId: z.string(), humanApprovalCapability: humanApprovalCapabilitySchema }).strict(), output: z.object({ success: z.literal(true) }).strict() },
  findingsFacets: { input: scopeSchema, output: facetsSchema },
  triageRunGet: { input: z.object({ scope: scopeSchema, id: z.string() }).strict(), output: triageRunSchema },
  triageDecisionWrite: { input: z.object({ scope: scopeSchema, decision: triageDecisionSchema }).strict(), output: localWriteResultSchema },
  triageDecisionBulkWrite: { input: z.object({ scope: scopeSchema, decisions: z.array(triageDecisionSchema).min(1).max(500), confirmed: z.boolean() }).strict(), output: localBatchResultSchema },
  triageDecisionUndo: { input: z.object({ scope: scopeSchema, stableKey: z.string(), beforeSha256: z.string(), afterSha256: z.string(), prior: jsonValueSchema }).strict(), output: localWriteResultSchema },
  triagePolicyPreview: { input: scopeSchema.extend({ pageSize: pageFields.pageSize, continuation: pageFields.continuation }).strict(), output: policyReportSchema },
  triagePolicyApply: { input: z.object({ scope: scopeSchema, runId: z.string(), expectedPolicySha256: z.string(), confirmed: z.boolean(), pageSize: pageFields.pageSize, continuation: pageFields.continuation }).strict(), output: policyReportSchema },
  triageVendorVexPreview: { input: z.object({ scope: scopeSchema, documentSha256: z.string(), vendor: z.string(), pageSize: pageFields.pageSize, continuation: pageFields.continuation }).strict(), output: vendorVexReportSchema },
  triageVendorVexApply: { input: z.object({ scope: scopeSchema, importId: z.string(), expectedDocumentSha256: z.string(), overwrite: z.boolean(), confirmed: z.boolean(), pageSize: pageFields.pageSize, continuation: pageFields.continuation }).strict(), output: vendorVexReportSchema },
  triageOrphansPrune: { input: z.object({ scope: scopeSchema, stableKeys: z.array(z.string()).min(1).max(500), dryRun: z.boolean(), confirmed: z.boolean() }).strict(), output: localBatchResultSchema },

  taraList: { input: scopedPageSchema.extend({ kind: z.string(), filters: filtersSchema }).strict(), output: pageResultSchema(entitySummarySchema) },
  taraGet: { input: z.object({ scope: scopeSchema, kind: z.string(), id: z.string() }).strict(), output: entityDetailSchema },
  taraCommandApply: { input: z.object({ scope: scopeSchema, command: taraCommandSchema }).strict(), output: localWriteResultSchema },
  taraDeleteImpact: { input: z.object({ scope: scopeSchema, kind: z.enum(["component", "zone", "asset", "dataflow", "threat"]), slug: z.string() }).strict(), output: deleteImpactSchema },
  requirementsList: { input: scopedPageSchema.extend({ filters: filtersSchema }).strict(), output: pageResultSchema(entitySummarySchema) },
  requirementsGet: { input: z.object({ scope: scopeSchema, id: z.string() }).strict(), output: entityDetailSchema },
  requirementsWrite: { input: z.object({ scope: scopeSchema, requirementId: z.string(), value: jsonValueSchema, expectedSha256: z.string().nullable() }).strict(), output: localWriteResultSchema },
  earsConversionStart: { input: z.object({ scope: scopeSchema, requirementIds: z.array(z.string()).max(500).optional() }).strict(), output: conversionSchema },
  earsConversionGet: { input: z.object({ scope: scopeSchema, id: z.string() }).strict(), output: conversionSchema },
  earsConversionReview: { input: z.object({ scope: scopeSchema, id: z.string(), decision: z.enum(["reviewed", "discarded"]), expectedSnapshotDigest: z.string() }).strict(), output: conversionSchema },
  verificationsMatrix: { input: scopedPageSchema.extend({ filters: filtersSchema }).strict(), output: pageResultSchema(entitySummarySchema) },
  verificationsRunGet: { input: z.object({ scope: scopeSchema, id: z.string() }).strict(), output: entityDetailSchema },
  verificationsRunStart: { input: z.object({ scope: scopeSchema, requirementId: z.string(), tier: z.string().optional(), checkId: z.string().optional(), confirmed: z.boolean() }).strict(), output: actionJobSchema },
  verificationsManualAttestationRecord: { input: z.object({ scope: scopeSchema, runId: z.string(), evidenceNote: z.string().min(1), evidenceDigest: z.string(), firmwareDigest: z.string(), humanApprovalCapability: humanApprovalCapabilitySchema }).strict(), output: attestationRecordSchema },
  reviewTransition: { input: z.object({ scope: scopeSchema, entityKind: z.string(), entityId: z.string(), operationId: z.string(), expectedReviewVersion: z.string().regex(/^\d+$/u), action: z.enum(["approve", "reject"]), humanApprovalCapability: humanApprovalCapabilitySchema }).strict(), output: z.object({ entityId: z.string(), reviewVersion: z.string(), state: z.string() }).strict() },

  bomSoftwareList: { input: scopedPageSchema.extend({ filters: filtersSchema }).strict(), output: pageResultSchema(entitySummarySchema) },
  bomComponentGet: { input: z.object({ scope: scopeSchema, id: z.string(), mode: z.enum(["software", "hardware"]) }).strict(), output: entityDetailSchema },
  hbomReviewList: { input: scopedPageSchema.extend({ filters: filtersSchema }).strict(), output: pageResultSchema(entitySummarySchema) },
  hbomReviewResolve: { input: z.object({ scope: scopeSchema, expectedSha256: z.string(), humanApprovalCapability: humanApprovalCapabilitySchema, decisions: z.array(z.discriminatedUnion("action", [z.object({ id: z.string(), action: z.literal("accept"), candidateIndex: z.number().int().nonnegative().optional() }).strict(), z.object({ id: z.string(), action: z.literal("reject"), candidateIndex: z.number().int().nonnegative().optional() }).strict(), z.object({ id: z.string(), action: z.literal("edit"), value: jsonValueSchema, note: z.string().optional() }).strict()])).min(1).max(500) }).strict(), output: hbomResolveSchema },
  hbomExtractionApply: { input: z.object({ scope: scopeSchema, documentSha256: z.string(), expectedHbomSha256: z.string(), humanApprovalCapability: humanApprovalCapabilitySchema, proposals: z.array(z.object({ part: jsonValueSchema, field: z.string(), value: jsonValueSchema, sourceRef: z.string(), confidence: z.number().min(0).max(1) }).strict()).min(1).max(500), createMissingParts: z.boolean() }).strict(), output: hbomExtractionSchema },

  firmwareMountsList: { input: scopedPageSchema, output: pageResultSchema(entitySummarySchema) },
  firmwareMountGet: { input: z.object({ scope: scopeSchema }).strict(), output: entityDetailSchema },
  firmwareTreeList: { input: z.object({ scope: scopeSchema, path: z.string(), ...pageFields }).strict(), output: pageResultSchema(entitySummarySchema) },
  firmwareFileGet: { input: z.object({ scope: scopeSchema, path: z.string(), includePreview: z.boolean().default(false) }).strict(), output: firmwareFileSchema },
  firmwareDiff: { input: z.object({ scope: scopeSchema, fromProjectVersionId: z.string(), toProjectVersionId: z.string(), ...pageFields }).strict(), output: pageResultSchema(entitySummarySchema) },
  firmwareMaterializeStart: { input: z.discriminatedUnion("source", [z.object({ scope: scopeSchema, source: z.literal("standalone_unpack"), inputId: z.string(), maxDepth: z.number().int().min(1).max(12).default(12) }).strict(), z.object({ scope: scopeSchema, source: z.literal("api"), scanId: z.string().optional(), mode: z.enum(["metadata", "files"]), paths: z.array(z.string()).max(100).optional() }).strict()]), output: actionJobSchema },
  firmwareMaterializeCancel: { input: z.object({ scope: scopeSchema, id: z.string() }).strict(), output: actionJobSchema },
  firmwareFileHydrate: { input: z.object({ scope: scopeSchema, path: z.string(), confirmed: z.boolean() }).strict(), output: actionJobSchema },

  benchRunsList: { input: scopedPageSchema, output: pageResultSchema(entitySummarySchema) },
  benchRunGet: { input: z.object({ scope: scopeSchema, id: z.string() }).strict(), output: entityDetailSchema },
  benchLogsList: { input: z.object({ scope: scopeSchema, runId: z.string(), afterSeq: z.number().int().nonnegative().nullable(), pageSize: z.number().int().min(1).max(200) }).strict(), output: benchLogsSchema },
  benchVerdictGet: { input: z.object({ scope: scopeSchema, id: z.string() }).strict(), output: verdictSchema },
  benchRunStart: { input: z.object({ scope: scopeSchema, tier: z.enum(["tier0", "tier1"]), hostId: z.string(), requirementId: z.string().optional(), target: z.string().optional(), deploymentContext: z.object({ productType: z.string(), networkExposure: z.string(), regulatory: z.string(), deploymentNotes: z.string(), rootComponentName: z.string(), rootComponentType: z.string() }).strict().optional(), confirmed: z.boolean() }).strict(), output: benchRunStartedSchema },
  benchHostsList: { input: z.object({ ...pageFields }).strict(), output: pageResultSchema(hostSchema) },
  benchHostsJoinCode: { input: z.object({ confirmed: z.literal(true) }).strict(), output: z.object({ joinCode: z.string(), hostId: z.string(), expiresAt: z.string().datetime() }).strict() },

  documentsList: { input: scopedPageSchema.extend({ filters: filtersSchema }).strict(), output: pageResultSchema(entitySummarySchema) },
  documentsGet: { input: z.object({ scope: scopeSchema, id: z.string() }).strict(), output: entityDetailSchema },
  documentsSearch: { input: scopedPageSchema.extend({ query: z.string().min(1), kinds: z.array(z.string()).optional() }).strict(), output: pageResultSchema(documentSearchHitSchema) },
  documentsMetadataUpdate: { input: z.object({ scope: scopeSchema, id: z.string(), expectedSha256: z.string(), kind: z.enum(["datasheet", "bom", "schematic", "spec", "regulatory", "register_map", "other"]), withdrawn: z.boolean(), displayName: z.string().min(1) }).strict(), output: entityDetailSchema },
  documentsExtractionsList: { input: z.object({ scope: scopeSchema, documentId: z.string(), ...pageFields }).strict(), output: pageResultSchema(entitySummarySchema) },
} as const);

export type RpcContract = typeof rpcContract;
```

The implementation may refine a field name only before freeze and with all 65 contract tests updated. It must not remove a method from the inventory without a documented product-spec contradiction and human review. `RPC_WIRE_METHODS` is the sole name translation and both its keys and values must be unique. Every project-data input either is `scopeSchema`, extends it, or contains `scope: scopeSchema`; id-only project lookups are forbidden. `baseStateSha256` hashes the sorted kind → `{acceptedGenerationId,baseRevision}` fence for the explicit project/version pair. `planSha256` remains the whole immutable-plan digest, and each item carries `expectedBaseContentHash` so a successful sibling push stales a prior plan even inside the same accepted generation. `firmware.materialize.start.inputId` is an opaque identifier issued by the verified host-safe file selection flow, never a raw browser-supplied absolute path. Vendor VEX bytes and document uploads arrive through local-authenticated `bb.http`; their RPC methods accept only a registered content digest/import id. Local HTTP origin checks protect against cross-site requests but do not prove a human actor.

## Acceptance criteria
- [ ] All 65 logical names map bijectively through `RPC_WIRE_METHODS` to 65 unique lower-camel, dot-free wire keys, which exist exactly once in `rpcContract` and use Standard Schema/Zod through `defineRpcContract`.
- [ ] Every object schema is strict; no `z.any()`, unbounded `z.unknown()`, binary value, filesystem path, secret, or raw Forge response crosses the boundary.
- [ ] `connections.status` reports three independent service states; configured-but-unreachable is distinct from missing configuration, optional disabled services do not degrade the others, and serialized output contains no token, key, authorization header, URL credentials/query, command argument, or raw exception.
- [ ] Every list result is `{items,total,next,cache}` and accepts an opaque `continuation` with `pageSize <= 200`.
- [ ] Every project-data input carries `projectId` and `projectVersionId`; null round-trips as project-level, literal `"@project"` and unknown scope keys fail strict parsing, and there is no workspace/scope-id field.
- [ ] Pull/status/cache/plan contracts expose accepted/staging generation ids and base revisions; push/conflict/retry require both expected plan and base-state hashes, and every plan item carries its expected base content hash.
- [ ] Sync plan/conflict/push schemas carry field diffs, audit attribution, validation errors, blast radius, staleness, and per-item partial results.
- [ ] The contract covers downstream human flows: triage/CAS/undo, policy preview/apply, vendor VEX/prune, canvas and requirement local writes, EARS conversion/review, verification/manual evidence, HBOM edit/extraction, firmware materialize/hydrate, bench run/host enrollment, and document search/metadata.
- [ ] Finding audit/comments reads are paged; comment create/update/delete uses a transient finding handle, is never an agent tool, and states that comments do not carry across versions.
- [ ] The contract cannot request agent push. Human-only mutation schemas reserve `humanApprovalCapability`, but no v1 mint path exists and handlers remain authorization-unavailable before side effects. `confirmed`, plugin tokens, `requestInput`, local HTTP auth, and CLI flags are explicitly not accepted as actor proof. The v1 CLI only hands off to panels; ACTION-ONLY RPCs cannot author YAML/model fields.
- [ ] The one shared document-source-reference schema round-trips PDF page/bbox, sheet/cell, and text-line locators and is reused by Documents and HBOM rather than redefined.
- [ ] Runtime tests reject unknown object keys, invalid page sizes/continuations, non-JSON numbers, and invalid enum values.
- [ ] A compile-time test proves a backend handler and `useRpc<typeof rpcContract>()` infer the same input/output types without casts.
- [ ] `CONTRACT_VERSION` is exported and the file header states the amendment protocol.
- [ ] Typecheck/test/lint/build is green before freeze.

## Test plan — `rpc-contract-freeze`
- `all 65 planned methods are present` — compare sorted logical names and sorted wire keys to literal expected lists; assert a dot-free lower-camel bijection and exact `rpcContract` key parity.
- `human-only mutations are unavailable without minted actor proof` — reserved capability parses only as its explicit field, but every v1 handler registration/dispatch attempt fails authorization-unavailable before any store or remote call; booleans/tokens/request metadata cannot substitute (**authorization/error path**).
- `all list endpoints page consistently` — parse minimum and maximum limits and reject 0/201 (**error path**).
- `strict input rejects an injected key` (**error path**) — exercise sync and one domain method.
- `strict output rejects undefined/NaN/filesystem payloads` (**error path**).
- `connections status is independent and secret-safe` — exercise missing Platform, disabled optional services, AS-only outage, Forge-only outage, and configured-but-unreachable without exposing credential material (**security/error paths**).
- `document locator rejects inverted lines, page zero, malformed digest, and unknown keys` (**error path**).
- `handler and client inference compile` — `expectTypeOf` or a no-emit type test with no `as any`.
- `binary routes are absent` — assert no method named upload/export/download/stream.

## Do not
- Do not put the bb outer RPC envelope in output schemas; bb owns it.
- Do not encode Forge file paths or stream large/binary payloads through RPC.
- Do not solve uncertainty with `z.any()` or an unconstrained top-level record.
- Do not edit this file after merge without `AMENDMENTS.md`, a human merge, a version bump, and a lane broadcast.

## Open questions
1. Confirm the current fork exports `defineRpcContract` from `@bb/plugin-sdk` and the frontend consumes the same value type without importing backend-only modules. Adjust imports before freeze if the verified identifier differs.
2. The product specs do not pin every display field for all 65 methods. The intended stability seam is `entitySummary.fields`; a human reviewer must approve that tradeoff before freeze.
3. Confirm whether dot characters are accepted in RPC method keys by the current contract/router. If not, choose one deterministic camelCase mapping for all methods before freeze and record it in the file header; do not mix styles.
