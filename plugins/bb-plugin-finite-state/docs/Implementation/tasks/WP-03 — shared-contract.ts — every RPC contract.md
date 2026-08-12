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
   - findings and local triage: `findings.list`, `findings.get`, `findings.activity.list`, `findings.comments.list`, `findings.comments.create`, `findings.comments.update`, `findings.comments.delete`, `findings.facets`, `triage.run.get`, `triage.decision.write`, `triage.decision.bulkWrite`, `triage.decision.undo`, `triage.policy.preview`, `triage.policy.apply`, `triage.vendorVex.preview`, `triage.vendorVex.apply`, `triage.orphans.prune`;
   - product security: `tara.list`, `tara.get`, `tara.command.apply`, `tara.deleteImpact`, `requirements.list`, `requirements.get`, `requirements.write`, `ears.conversion.start`, `ears.conversion.get`, `ears.conversion.review`, `verifications.matrix`, `verifications.run.get`, `verifications.run.start`, `verifications.manualAttestation.record`, `review.transition`;
   - BOM: `bom.software.list`, `bom.component.get`, `hbom.review.list`, `hbom.review.resolve`, `hbom.extraction.apply`;
   - firmware: `firmware.mounts.list`, `firmware.mount.get`, `firmware.tree.list`, `firmware.file.get`, `firmware.diff`, `firmware.materialize.start`, `firmware.materialize.cancel`, `firmware.file.hydrate`;
   - bench: `bench.runs.list`, `bench.run.get`, `bench.logs.list`, `bench.verdict.get`, `bench.run.start`, `bench.hosts.list`, `bench.hosts.joinCode`;
   - documents: `documents.list`, `documents.get`, `documents.search`, `documents.metadata.update`, `documents.extractions.list`.
3. Give every list method `{items,total,next}` output and `{pageSize,continuation}` input. Bound `pageSize` to `1..200`; `continuation` and `next` are opaque strings. Never expose offset, page-number, or cursor aliases through the shared contract.
4. Model sync plan/push types fully enough for WP-18–21: operations, base/ours/theirs field diffs, conflicts, audit attribution, blast radius, validation errors, per-item push results, resumable run id, and plan staleness.
5. Model four UI states as data. `connections.status` reports Platform, Assurance Studio, and optional Forge Compute independently, with no secrets or raw endpoint values. A missing required Platform configuration is `needs-configuration`; an intentionally absent optional service is `disabled`; a configured service that fails its probe is `unreachable`, never `needs-configuration`. Cache-bearing reads include `cache: {state:"fresh"|"stale"|"empty",asOf,message}`. Do not encode loading; loading is client request state.
6. Separate mutation families in names, schemas, and documentation: **local authored writes** (`triage.*`, `tara.command.apply`, `requirements.write`) mutate CAS-protected worktree files only; **human HBOM decisions** (`hbom.review.resolve`, `hbom.extraction.apply`) mutate the same tracked HBOM artifact only after actor authorization exists; **human sync writes** (`sync.push*`) apply a reviewed plan from the review panel; the fixed inventory's **human passthrough comment schemas** (`findings.comments.create|update|delete`) are reserved for selected version-specific server comments that would not carry forward, but are both route-blocked and authorization-blocked/non-executable in v1 because WP-06 has no reviewed upstream mutation route and bb has no capability mint path; **ACTION-ONLY invocations** (`verifications.*`, `firmware.materialize*`, `firmware.file.hydrate`, `bench.run.start`, host enrollment) start work/evidence but never author model state. `findings.comments.list` reads the bounded cached comment data; no comment composer, mutation handler, or invented `PlatformClient` method exists. Agent tool authorization is separate and cannot infer access from this contract. `sync.conflict.resolve`, `sync.push*`, comment create/update/delete, HBOM resolve/extraction decisions, `review.transition`, and manual attestation inputs reserve `humanApprovalCapability`; because v1 cannot mint or verify one, authorization-gated handlers return authorization-unavailable before side effects, while the route-blocked comment mutations remain unregistered regardless. The CLI only opens the relevant panel; the existence of a schema never permits an `fs_sync_push` tool or agent-readable executable push path.
7. Add runtime schema tests and compile-time handler/client inference tests using `defineRpcContract` and the SDK test types. Verify the exact export names (`defineRpcContract`, client hook inference) against the checked-out fork before freezing; RECON leaves no license to invent renamed SDK symbols.

## Interface contract

The complete field-by-field Standard Schema contract is the frozen executable artifact in `shared/contract.ts`; this section freezes the cross-lane names and shapes that downstream WPs consume. The block below is a **normative schematic excerpt**, not a second pasteable implementation: every shown name, literal, bound, and shape is mandatory, while comments explicitly identify field-level bodies owned only by the executable artifact. Tests mechanically assert the exact 65-entry logical/wire inventory, the exact method classifications, and every executable schema key. Abbreviated or alternate scope/fence objects are forbidden.

```ts
// shared/contract.ts — FROZEN. Amendment + CONTRACT_VERSION bump required after merge.
import { z } from "zod";

export const CONTRACT_VERSION = 1 as const;
const identifierSchema = z.string().trim().min(1).max(512);
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
export type JsonValue =
  | null | boolean | number | string | JsonValue[]
  | { [key: string]: JsonValue };
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(), z.boolean(), z.number().finite(), z.string(),
    z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema),
  ]),
);

// Exact 65-entry dotted logical name -> unique lowerCamelCase bb.rpc wire name.
// There is no derived alias or second public translation.
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
  "verifications.manualAttestation.record":
    "verificationsManualAttestationRecord",
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

export const projectVersionIdSchema = identifierSchema
  .refine((value) => value !== "@project");
export const projectScopeFields = {
  projectId: identifierSchema,
  projectVersionId: projectVersionIdSchema.nullable(),
} as const;
export const projectScopeSchema = z.object(projectScopeFields).strict();

export const pageRequestFields = {
  pageSize: z.number().int().min(1).max(200).default(50),
  continuation: z.string().min(1).max(4096).nullable().default(null),
} as const;
export const scopedPageRequestSchema =
  z.object({ ...projectScopeFields, ...pageRequestFields }).strict();

export const humanApprovalCapabilitySchema =
  z.string().min(32).max(4096).brand<"HumanApprovalCapability">();
export type HumanApprovalCapability =
  z.infer<typeof humanApprovalCapabilitySchema>;

export const HUMAN_APPROVAL_CAPABILITY_POLICY = {
  minting: "unavailable",
  mintSurfaces: [],
  requiredIssuer: "actor-authenticated-server",
  handlerDisposition: "authorization-unavailable",
  singleUse: true,
  bindings: [
    "actor", "action", "projectId", "projectVersionId", "planOrSnapshotDigest",
  ],
  rejectedEvidence: [
    "caller-boolean", "cli-yes", "plugin-token", "request-input",
  ],
} as const;

export const cacheStateSchema = z.object({
  state: z.enum(["fresh", "stale", "empty"]),
  asOf: z.string().datetime({ offset: true }).nullable(),
  message: z.string().max(500).nullable(),
  acceptedGenerationId: identifierSchema.nullable(),
  baseRevision: z.number().int().nonnegative(),
}).strict();

export const baseGenerationIdsSchema =
  z.record(identifierSchema, identifierSchema);
export const baseRevisionsSchema =
  z.record(identifierSchema, z.number().int().nonnegative());

export const syncPlanFenceSchema = z.object({
  planId: identifierSchema,
  planSha256: sha256Schema,
  baseGenerationIds: baseGenerationIdsSchema,
  baseRevisions: baseRevisionsSchema,
  baseStateSha256: sha256Schema,
}).strict();

export const planItemSchema = z.object({
  ...projectScopeFields,
  kind: identifierSchema,
  key: identifierSchema,
  operation: z.enum(["create", "update", "delete", "noop", "conflict", "orphan"]),
  expectedBaseContentHash: sha256Schema.nullable(),
  // exact diff/conflict/referrer/error fields are defined in shared/contract.ts
}).strict();

const planFenceInputFields = {
  planId: identifierSchema,
  expectedPlanSha256: sha256Schema,
  expectedBaseStateSha256: sha256Schema,
} as const;

export const AGENT_ACTION_RPC_METHODS = [
  "verificationsRunStart",
  "firmwareMaterializeStart",
  "benchRunStart",
] as const;
export const HUMAN_ONLY_RPC_METHODS = [
  "syncConflictResolve", "syncPush", "syncPushRetry",
  "findingsCommentsCreate", "findingsCommentsUpdate", "findingsCommentsDelete",
  "verificationsManualAttestationRecord", "reviewTransition",
  "hbomReviewResolve", "hbomExtractionApply",
] as const;

// Every scoped input and output spreads projectScopeFields at its top level.
// A nested `scope`, workspace/scope id, codec, page/offset alias, or external
// "@project" value is invalid. List RPCs use pageSize/continuation and return
// { items, total, next, cache }. sync plan/status expose the generation-id and
// revision maps above; push/conflict/retry take the expected hashes and each
// plan/push item carries the exact expectedBaseContentHash CAS. The executable
// rpcContract contains exactly Object.values(RPC_WIRE_METHODS); its 65 strict
// input/output schemas are mechanically compared with this map in contract.test.ts.
```

`baseStateSha256` hashes the explicit project/version pair plus the sorted kind → `{acceptedGenerationId,baseRevision}` map. `planSha256` remains the whole immutable-plan digest. Apply inputs use `expectedPlanSha256` and `expectedBaseStateSha256`; each plan and push item uses `expectedBaseContentHash`, so a successful sibling push stales a prior plan even while the accepted generation id is unchanged. `firmware.materialize.start.inputId` is an opaque identifier issued by the verified host-safe file selection flow, never a raw browser-supplied absolute path. Vendor VEX bytes and document uploads arrive through local-authenticated `bb.http`; their RPC methods accept only a registered content digest/import id. Local HTTP origin checks protect against cross-site requests but do not prove a human actor.

## Acceptance criteria
- [ ] All 65 logical names map bijectively through `RPC_WIRE_METHODS` to 65 unique lower-camel, dot-free wire keys, which exist exactly once in `rpcContract` and use Standard Schema/Zod through `defineRpcContract`.
- [ ] Every object schema is strict; no `z.any()`, unbounded `z.unknown()`, binary value, filesystem path, secret, or raw Forge response crosses the boundary.
- [ ] `connections.status` reports three independent service states; configured-but-unreachable is distinct from missing configuration, optional disabled services do not degrade the others, and serialized output contains no token, key, authorization header, URL credentials/query, command argument, or raw exception.
- [ ] Every list result is `{items,total,next,cache}` and accepts an opaque `continuation` with `pageSize <= 200`.
- [ ] Every project-data input carries `projectId` and `projectVersionId`; null round-trips as project-level, literal `"@project"` and unknown scope keys fail strict parsing, and there is no workspace/scope-id field.
- [ ] Pull/status/cache/plan contracts expose `generationId`, `acceptedAt`, `acceptedGenerationIds`, `stagingGenerationIds`, `baseGenerationIds`, and `baseRevisions` as applicable; push/conflict/retry require `expectedPlanSha256` and `expectedBaseStateSha256`, and every plan/push item carries `expectedBaseContentHash`.
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
