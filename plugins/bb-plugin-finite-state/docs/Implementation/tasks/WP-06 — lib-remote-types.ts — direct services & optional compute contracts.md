# WP-06 — `lib/remote/types.ts` — direct services & optional compute contracts

**Lane:** L0 Foundation · **Spec refs:** SPEC 00 §4–§6 · ADR Direct APIs · API reference index · **Effort:** 1.5 d · **Status:** unassigned
**Depends on:** WP-01 · **Blocks:** WP-08, WP-10, WP-14, WP-17
**Produces a FROZEN artifact:** **yes** — `lib/remote/types.ts` freezes on merge

## Files you own
`plugins/bb-plugin-finite-state/lib/remote/types.ts` *(FROZEN)*
`plugins/bb-plugin-finite-state/lib/remote/types.test.ts`
`plugins/bb-plugin-finite-state/lib/remote/types.type-test.ts`

## Files you must not touch
Composition roots, the other four frozen interfaces, mock fixtures, lane implementations, `package.json`, and `pnpm-lock.yaml`.

## Context
The product data plane is direct REST from the bb plugin backend. Platform and Assurance Studio are independently configured, independently mockable services. Forge is an optional compute plane only for QEMU verification, autonomous pen testing, and Forge-owned jobs. The mock and production implementations must satisfy the same frozen interfaces while every lane codes against the narrow client it needs.

This boundary normalizes transport quirks without hiding service ownership: callers receive parsed JSON or byte streams, never `Response`, auth headers, MCP SDK values, or upstream-local paths. The authoritative reference set is `docs/Implementation/api-reference/`; the pinned compute-only manifest is authoritative for the reviewed Forge subset, while other Forge wrappers remain behavioral examples rather than a transport contract.

FS-89 applies D-1 without inventing transport fields: plugin RPC/domain/storage records carry explicit `projectId` + `projectVersionId`; direct AS project routes carry `projectId`, direct Platform/Forge version routes carry `projectVersionId`, and methods with both reviewed parameters require both. No workspace binding, serialized scope, or caller-derived scope codec exists.

## What to build
1. Define JSON-safe primitives, `RemoteError`, operation context, streaming artifacts, service health, and production-used normalization helpers for paging, abort, no-content responses, artifacts, VEX input, and Forge job status. Preserve upstream error code, HTTP status, retryability, and `Retry-After`; never retain secrets or raw headers.
2. Define `PlatformClient` for projects/versions; findings/detail/activity and comments embedded in verified reads; summary; VEX single/bulk/clear; SBOM/components; firmware tree/file; and the ten public security-assessment/STP relays.
3. Define `AssuranceStudioClient` for project-scoped Tier-2 entity reads/writes, project SBOM packages, and verified check/history/run operations. Every method carries `projectId`; there is no ambient project. Preserve TARA head/hash fence value types, but omit callable checkpoint methods until a public route is handler-verified.
4. Split AS kinds so `attack-path` can be read/updated/deleted but cannot be passed to `createEntity`. The collection POST is an instructional stub, not a create route.
5. Preserve AS concurrency without inventing ETags: TARA head id/working hash and decimal `reviewVersion`. `human_edited`, review-state, delete-impact, and two-step review-status behavior remain explicit results for domain services to adjudicate.
6. Define `ForgeComputeClient` only for dynamic verification, pen-test dispatch, and Forge job status/list/watch. Map `verify_dynamic`, `pen_test_run`, `get_job_status`, and `list_jobs` exactly through the pinned compute-only manifest; `watchJob` is derived polling, not another MCP method. Those four names are the closed invocation allowlist, while job `tool` values and list filtering are open registry metadata strings. Normalized job terminal states are exactly `COMPLETED|FAILED|TIMEOUT`; `RUNNING` is the only nonterminal state. The raw registry's unadvertised `CANCELLED` value normalizes to `FAILED` with code `FORGE_JOB_CANCELLED`, never to success. The non-freezeable firmware-root member is removed per A-000.
7. Define `RemoteServices { platform, assuranceStudio, forgeCompute }`, where `forgeCompute` is nullable. Downstream owner services accept a narrow client, never the aggregate.
8. Use `RemotePageRequest { continuation?, pageSize? }` for every paged input and async iterables yielding `RemotePage { items, total, next }`. `next` is an opaque adapter-owned continuation that binds page size; consumers never know Platform offset, AS page, or Forge registry transport details. Abort behavior is identical across adapters.
9. Keep the route surface closed. Do not expose `asRawApi`, arbitrary URL/method/path calls, generic `fetch`, or MCP tool invocation through the frozen contract.
10. Structurally parse every vendored authority in tests and exercise production-used normalization helpers. When the AS snapshot is incomplete, parse/cite the handler-backed audit entry in the method test; unresolved operations stay absent rather than guessed.

## Interface contract
```ts
// lib/remote/types.ts — FROZEN after WP-06.
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface RemoteCallContext { signal?: AbortSignal; requestId?: string; }
export interface RemotePage<T> { items: T[]; total: number | null; next: string | null; }
export interface RemotePageRequest { continuation?: string; pageSize?: number; }
export interface RemoteHealth { configured: boolean; reachable: boolean; detail: string | null; }
export class RemoteError extends Error {
  readonly service: "platform" | "assurance-studio" | "forge-compute";
  readonly code: string; readonly status: number | null; readonly retryable: boolean;
  readonly retryAfterMs: number | null; readonly details: Json | null;
}
export interface RemoteArtifact {
  readonly mediaType: string; readonly size: number | null; readonly sha256: string | null;
  stream(): AsyncIterable<Uint8Array>;
  readJson<T extends Json>(maxBytes: number): Promise<T>;
}

export const VEX_STATUSES = ["EXPLOITABLE", "IN_TRIAGE", "NOT_AFFECTED", "FALSE_POSITIVE", "RESOLVED", "RESOLVED_WITH_PEDIGREE"] as const;
export const VEX_RESPONSES = ["CAN_NOT_FIX", "WILL_NOT_FIX", "UPDATE", "ROLLBACK", "WORKAROUND_AVAILABLE"] as const;
export const VEX_JUSTIFICATIONS = ["CODE_NOT_PRESENT", "CODE_NOT_REACHABLE", "REQUIRES_CONFIGURATION", "REQUIRES_DEPENDENCY", "REQUIRES_ENVIRONMENT", "PROTECTED_BY_COMPILER", "PROTECTED_AT_RUNTIME", "PROTECTED_AT_PERIMETER", "PROTECTED_BY_MITIGATING_CONTROL"] as const;
export type VexStatus = typeof VEX_STATUSES[number];
export type VexResponse = typeof VEX_RESPONSES[number];
export type VexJustification = typeof VEX_JUSTIFICATIONS[number];
export interface VexDecisionInput { findingId: string; status: VexStatus; response?: VexResponse; justification?: VexJustification; reason?: string; }
export interface VexInput extends VexDecisionInput { projectVersionId: string; }
export interface VexBulkSetResult {
  status: "success" | "partial_success" | "failure";
  summary: { total: number; succeeded: number; failed: number };
  results: { findingId: string; success: boolean; status: VexStatus | null; error: string | null }[];
}

export interface PlatformClient {
  health(ctx?: RemoteCallContext): Promise<RemoteHealth>;
  listProjects(page?: RemotePageRequest, ctx?: RemoteCallContext): AsyncIterable<RemotePage<Record<string, Json>>>;
  listVersions(projectId: string, page?: RemotePageRequest, ctx?: RemoteCallContext): AsyncIterable<RemotePage<Record<string, Json>>>;
  getFindings(input: { projectVersionId: string; page?: RemotePageRequest }, ctx?: RemoteCallContext): AsyncIterable<RemotePage<Record<string, Json>>>;
  getFindingDetail(input: { projectVersionId: string; findingId: string }, ctx?: RemoteCallContext): Promise<Record<string, Json>>;
  getFindingActivity(input: { projectId: string; projectVersionId: string; cve: string; page?: RemotePageRequest }, ctx?: RemoteCallContext): AsyncIterable<RemotePage<Record<string, Json>>>;
  listFindingComments(input: { projectVersionId: string; findingId: string; page?: RemotePageRequest }, ctx?: RemoteCallContext): AsyncIterable<RemotePage<Record<string, Json>>>;
  getFindingsSummary(projectVersionId: string, ctx?: RemoteCallContext): Promise<Record<string, Json>>;
  setVexStatus(input: VexInput, ctx?: RemoteCallContext): Promise<void>;
  batchSetVexStatus(input: { projectVersionId: string; findings: VexDecisionInput[] }, ctx?: RemoteCallContext): Promise<VexBulkSetResult>;
  clearVexStatus(input: { projectVersionId: string; findingIds: string[] }, ctx?: RemoteCallContext): Promise<void>;
  downloadSbom(input: { projectVersionId: string; format: "cyclonedx" | "spdx"; includeVex: boolean }, ctx?: RemoteCallContext): Promise<RemoteArtifact>;
  listComponents(input: Record<string, Json>, ctx?: RemoteCallContext): AsyncIterable<RemotePage<Record<string, Json>>>;
  searchComponents(input: Record<string, Json>, ctx?: RemoteCallContext): AsyncIterable<RemotePage<Record<string, Json>>>;
  browseFirmwareFilesystem(input: { projectVersionId: string; path?: string; depth?: number; fileHash?: string; scanId?: string }, ctx?: RemoteCallContext): Promise<Record<string, Json>>;
  getFirmwareFile(input: FirmwareFileRequest, ctx?: RemoteCallContext): Promise<Record<string, Json> | RemoteArtifact>;
  securityAssessment(input: SecurityAssessmentRequest, ctx?: RemoteCallContext): Promise<Json>;
}

export interface FirmwareTreeNode { path: string; hash: string | null; kind: "file" | "directory" | "symlink"; size: number | null; fields: Record<string, Json>; }
export type FirmwareFileRequest =
  | { projectVersionId: string; scanId?: string; fileHash: string; mode: "meta" }
  | { projectVersionId: string; scanId?: string; fileHash: string; mode: "range"; offset: number; maxBytes: number }
  | { projectVersionId: string; scanId?: string; fileHash: string; mode: "full" }
  | { fromScanId: string; fileHash: string; mode: "full" };
export type SecurityAssessmentTool = "stp_callgraph" | "stp_find_binaries_with_symbols" | "stp_elf_dependency_graph" | "stp_binary_details" | "stp_kernel_config" | "get_scan_quality" | "stp_architecture" | "stp_configs" | "stp_services" | "stp_crypto";
export interface SecurityAssessmentRequest { tool: SecurityAssessmentTool; projectVersionId: string; scanId?: string; params?: Record<string, Json>; }

export type AsEntityKind = "threat" | "risk" | "mitigation" | "asset" | "zone" | "dataflow" | "component" | "requirement" | "attack-path";
export type AsCreatableEntityKind = Exclude<AsEntityKind, "attack-path">;
export type AsReviewStatus = "pending" | "ai_approved" | "ai_flagged" | "human_approved" | "human_rejected";
export interface AsEntity { id: string; projectId: string; kind: AsEntityKind; reviewVersion: string | null; reviewStatus: AsReviewStatus | null; humanEdited: boolean | null; fields: Record<string, Json>; }
export interface AsWriteResult { success: true; entity: AsEntity; reviewStatusSet: boolean; reviewStatusReason: string | null; }
export interface AsDeleteImpact { allowedActions: ("cascade" | "detach")[]; recommendedAction: "cascade" | "detach" | null; references: Json[]; }
export interface TaraFence { expectedHeadVersionId: string; expectedWorkingHash?: string; }
export interface TaraState { headVersionId: string; workingHash: string | null; }

export interface AssuranceStudioClient {
  health(ctx?: RemoteCallContext): Promise<RemoteHealth>;
  listEntities(kind: AsEntityKind, input: { projectId: string; page?: RemotePageRequest; filters?: Record<string, Json> }, ctx?: RemoteCallContext): AsyncIterable<RemotePage<AsEntity>>;
  getEntity(kind: AsEntityKind, input: { projectId: string; id: string }, ctx?: RemoteCallContext): Promise<AsEntity>;
  createEntity(kind: AsCreatableEntityKind, input: { projectId: string; fields: Record<string, Json> }, ctx?: RemoteCallContext): Promise<AsWriteResult>;
  updateEntity(kind: AsEntityKind, input: { projectId: string; id: string; fields: Record<string, Json>; force?: boolean }, ctx?: RemoteCallContext): Promise<AsWriteResult>;
  deleteEntity(kind: AsEntityKind, input: { projectId: string; id: string; mode?: "cascade" | "detach"; force?: boolean }, ctx?: RemoteCallContext): Promise<{ success: true } | { success: false; impact: AsDeleteImpact }>;
  listProjectSbomPackages(input: { projectId: string; page?: RemotePageRequest; filters?: Record<string, Json> }, ctx?: RemoteCallContext): AsyncIterable<RemotePage<Record<string, Json>>>;
  listVerificationChecks(input: { projectId: string; status?: string; type?: string; requirementId?: string; page?: RemotePageRequest }, ctx?: RemoteCallContext): AsyncIterable<RemotePage<Record<string, Json>>>;
  getVerificationCheck(input: { projectId: string; checkId: string }, ctx?: RemoteCallContext): Promise<Record<string, Json>>;
  runVerificationChecks(input: { projectId: string; checkIds?: string[]; rerunPassed?: boolean }, ctx?: RemoteCallContext): Promise<{ runId: string; checksQueued: number; status: string }>;
}

export type ForgeJobStatus = "RUNNING" | "COMPLETED" | "FAILED" | "TIMEOUT";
export interface ForgeJobSnapshot {
  jobId: string; status: ForgeJobStatus; tool: string; recipe: string | null;
  scope: Json; environment: Json; runId: string | null; elapsedSeconds: number;
  logTail: string[]; events: Json[]; eventCount: number; result: Json | null;
}
export interface ForgeComputeClient {
  health(ctx?: RemoteCallContext): Promise<RemoteHealth>;
  verifyDynamic(input: { projectVersionId: string; verdictIds: string[]; budgetSecPerVerdict?: number }, ctx?: RemoteCallContext): Promise<Json>;
  penTestRun(input: Record<string, Json>, ctx?: RemoteCallContext): Promise<{ jobId: string }>;
  getJobStatus(jobId: string, tailLines?: number, ctx?: RemoteCallContext): Promise<ForgeJobSnapshot>;
  listJobs(input?: { status?: ForgeJobStatus; tool?: string; page?: RemotePageRequest }, ctx?: RemoteCallContext): AsyncIterable<RemotePage<ForgeJobSnapshot>>;
  watchJob(jobId: string, ctx?: RemoteCallContext): AsyncIterable<ForgeJobSnapshot>;
}

export interface RemoteServices {
  platform: PlatformClient;
  assuranceStudio: AssuranceStudioClient;
  forgeCompute: ForgeComputeClient | null;
}
```

## Acceptance criteria
- [ ] Mock and production implementations satisfy their frozen interface without casts or transport-specific fields escaping.
- [ ] `RemoteServices.forgeCompute` is nullable and no Platform/AS method exists on `ForgeComputeClient`.
- [ ] VEX has exactly six statuses, five responses, nine justifications, and implementation tests bound plugin chunks to 500 while documenting the platform's 5000 ceiling.
- [ ] Single VEX and bulk clear accept only their verified 204/empty success and return void; `dryRun` is absent, decimal-string ids are validated, and empty optional verdict fields normalize to omission before transport.
- [ ] Bulk VEX set has one path-scoped `projectVersionId`, heterogeneous decisions in `findings[]`, and the documented ordered per-item response; bulk clear has one path-scoped `projectVersionId`, string `findingIds[]`, and resolves only after HTTP 204 with no invented result body. Resumability and 500-row chunking remain above the client.
- [ ] Firmware range requests are implementation-bounded to 131072 bytes; full reads return `RemoteArtifact`, never `file_path`, `save_to`, or `saved_to`.
- [ ] AS methods always carry project scope; attack-path create fails at compile time; write results preserve review-status outcome and review version.
- [ ] TARA concurrency models head id/working hash and review version, not invented ETags.
- [ ] Jobs expose exactly four normalized statuses and are confined to optional Forge compute; a raw `CANCELLED` job becomes typed `FAILED/FORGE_JOB_CANCELLED`.
- [ ] Every paged method uses `RemotePageRequest` and opaque `RemotePage.next`; offset-backed Platform, page-backed AS, and Forge-backed loaders have identical continuation and abort behavior.
- [ ] Forge invocation names are the four reviewed manifest operations, while job `tool` metadata/filtering accepts and preserves unknown registry strings.
- [ ] Every freezeable Forge member has an exact entry in the checksummed compute manifest. `prepareFirmwareRoot` blocks final interface freeze until its same-host implementation is proven or the member is removed; it cannot be mapped to a nonexistent MCP tool.
- [ ] No interface can represent arbitrary URLs, methods, raw paths, auth headers, `fetch`, or MCP tool names outside the enumerated compute operations.
- [ ] Typecheck/test/lint/build is green before freeze.

## Test plan — `remote-service-contract-freeze`
- `minimal fakes satisfy all three clients and nullable aggregate` — compile-only completeness test.
- `platform and AS clients cannot be substituted for Forge compute` (**error path**, `@ts-expect-error`).
- `attack-path is not creatable` (**error path**, `@ts-expect-error`).
- `VEX vocabularies match vendored v0.3.0 reference verbatim` — literal snapshot.
- `VEX wire shapes match v0.3.0` — numeric-string ids, empty-field omission, heterogeneous bulk decisions in request order, and single/clear accept 204/empty only while rejecting invented JSON success envelopes (**contract/error path**).
- `offset-, page-, and Forge-backed loaders share opaque continuation and abort behavior` (**contract/fault path**).
- `job terminal type excludes cancelled/succeeded aliases` (**error path**, `@ts-expect-error`).
- `raw cancelled job normalizes to failed while unknown job tool metadata survives` — preserves `FORGE_JOB_CANCELLED` detail and never reports completed (**fault path**).
- `artifact is bytes not a path` — production artifact helper enforces stream size/hash and oversize JSON boundaries (**fault path**).
- `AS project scope and review concurrency are explicit`; missing scope and lossy numeric review versions fail compilation (**error path**).
- `no raw escape hatch` — exported-key snapshot rejects generic request/method/path members (**security path**).

## Do not
- Do not expose MCP SDK types, HTTP `Response`, local paths, auth headers, raw secrets, or arbitrary request functions.
- Do not put Platform or AS data methods on `ForgeComputeClient`.
- Do not add an AS method from OpenAPI alone when the vendored notes say handler coverage is incomplete or contradictory.
- Do not model a global optimistic-concurrency token that the upstream systems do not have.
- Do not edit this interface after freeze without an amendment and `CONTRACT_VERSION` broadcast.

## Open questions
1. Verify the exact public AS routes for TARA head/hash checkpointing and verification checks/results against the target platform handler commit before freeze. If a route remains unavailable, remove the method rather than map it through a raw escape hatch.
2. `prepareFirmwareRoot` was removed before freeze per A-000 because Forge commit `5083a9d7` exposes no such MCP tool. WP-50 may later introduce a plugin-owned same-host lifecycle behind a separate reviewed contract; remote Forge cannot map a nonexistent method.
3. Decide whether Platform bulk VEX should expose the upstream 5000 maximum directly later; v1 intentionally preserves 500-sized resumable plan chunks.
