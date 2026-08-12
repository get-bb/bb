# WP-19 — `push` — chunking, base advance, resumability, read-back

**Lane:** L2 Sync · **Spec refs:** SPEC 01 §5 · SPEC 02 §2, §8.1 · SPEC 03 §8 · RECON §2.4, §2.6, §2.8 · **Effort:** 4 d · **Status:** unassigned
**Depends on:** WP-18 · **Blocks:** WP-29, WP-35, WP-40, WP-21 post-push flow
**Produces a FROZEN artifact:** no — consumes frozen interfaces and the change-controlled WP-17 adapter seam

## Files you own
`plugins/bb-plugin-finite-state/lanes/sync/push/index.ts` *(replaces WP-17 stub)*
`plugins/bb-plugin-finite-state/lanes/sync/push/types.ts`
`plugins/bb-plugin-finite-state/lanes/sync/push/pushers.ts`
`plugins/bb-plugin-finite-state/lanes/sync/push/log.ts`
`plugins/bb-plugin-finite-state/lanes/sync/push/resume.ts`
`plugins/bb-plugin-finite-state/lanes/sync/push/read-back.ts`
`plugins/bb-plugin-finite-state/lanes/sync/push/vex.ts`
`plugins/bb-plugin-finite-state/lanes/sync/push/progress.ts`
`plugins/bb-plugin-finite-state/lanes/sync/push/*.test.ts`

## Files you must not touch
Composition roots; all frozen interfaces; `lanes/sync/register.ts`, `rpc.ts`, `cli.ts`, `engine/adapter.ts`, plan/conflict modules; fixture corpus; other lanes; package/lock files. WP-17 already points to this module. If its `registerPusher(kind,p: unknown)` seam cannot carry the typed facade below, file an amendment rather than editing it.

## Context
Plan is the safety product; push is a deterministic, resumable executor of one persisted plan. Core AS entities have no bulk create/update, so they apply one row at a time through registered entity pushers. VEX is the exception: the Platform bulk-set route accepts up to 5000 heterogeneous decisions and returns per-item outcomes, while the plugin deliberately preserves 500-row resumable chunks above the client. Bulk clear returns successful 204/void, so the pusher verifies/reconciles cleared rows rather than inventing per-item response data. An identical re-PUT still changes timestamps/audit state, so noops are never sent.

The backend is last-write-wins for ordinary entities. TARA has only a head/content bracket; it does not make the per-row HTTP calls atomic. Findings have no precondition. A connection reset after a write is therefore ambiguous: read back first, never blindly repeat.

## What to build
1. Load the immutable `.fs-sync/plan-<planId>.json` from WP-18. Reject missing, validation-failed, unresolved-conflict, unconfirmed blast-radius, or stale plans before any server call. Staleness checks explicit project/version, every accepted generation id, every starting base revision, `baseStateSha256`, and every item's `expectedBaseContentHash`.
2. Define a typed `EntityPusher` facade in `push/types.ts` and a registry adapter around WP-17's existing seam. A pusher validates its kind, applies one item, optionally reads back, and can bracket a related group. Surface lanes register pushers without editing L2.
3. Initialize one scoped `push_log` row per non-noop plan item in a transaction and persist `.fs-sync/push-<runId>.json` with `planId`, ordered keys, explicit project/version, base generation/revision, expected base hash, confirmation, and cursor. Reusing a run id is idempotent only inside that project/version and does not duplicate rows.
4. Mark `noop` as skipped without calling any remote service. Mark validation/conflict/orphan items as non-applicable and refuse the run unless the plan contract explicitly permits the class.
5. Apply ordinary entities in WP-18's order. Each registered pusher closes over only its narrow client. `PushContext` carries run id, explicit project/version, and cancellation. Resolve/learn ids only in the accepted generation for that exact pair.
6. VEX: resolve every stable key to the precise cached `(projectId,projectVersionId,findingId)` rows; group by the explicit project/version pair; chunk at 500; prefix reason with `[bb:<runId>]` without losing the human rationale; consume every `results[]` item. A success advances only that decision's base; a failure stays dirty and is logged.
7. After every confirmed success, atomically update the scoped `push_log`, advance exactly that accepted entity base/id mapping, and increment only the matching project/version/kind `base_revision`. Check the item's expected prior content hash. A failed sibling remains dirty; another project/version is untouched.
8. Require read-back when the pusher declares `verification:"required"`, and for routes known not to apply `.strict()`. Compare the semantic payload through WP-15. HTTP 200 plus missing/different fields is `READ_BACK_MISMATCH`, not applied.
9. Handle ambiguous connection reset: inspect server state through `readBack`; if it equals intended semantic payload, record/advance as applied; if it equals base, leave pending for retry; otherwise fail as `AMBIGUOUS_WRITE` and require a new plan/conflict resolution.
10. TARA group hook: pusher reads current head/working hash before content calls, checks the plan fence, applies the short ordered group, then creates a version checkpoint with `expectedHeadVersionId` (and verified working hash field where the endpoint accepts it). Map the exact 409 `stale_tara_state` body. A checkpoint failure does not pretend earlier row calls rolled back; read back applied rows, mark the run warning/failed, and force pull/re-plan.
11. Review/standards actions use cached `review_version`; never `entity_version`. They are ACTION-ONLY and only execute if represented by an explicitly human-originated plan/action contract.
12. Resume from `push_log` plus the sidecar. Reconcile every `pending` item that could have been in flight before sending more. Retry only failed items marked retryable and still matching the same plan/base.
13. Publish tiny global-fanout hints on `fs-sync-push`: `{runId,phase,completed,total}` and final counts. Logs/results remain in SQLite/RPC. Update the already-wired sync RPC/CLI through exported functions only; do not edit their registration files.

## Interface contract
```ts
// lanes/sync/push/types.ts
export type PushVerification = "required" | "response-is-authoritative";
export interface PushContext {
  runId: string; scope: SyncScope; signal?: AbortSignal;
}
export interface ApplyResult {
  remoteId: string | null; serverPayload: Record<string, unknown> | null;
  verification: PushVerification;
}
export interface ReadBackResult { exists: boolean; remoteId: string | null; payload: Record<string, unknown> | null; }
export interface EntityPusher {
  readonly kind: EntityKind;
  readonly maxConcurrency: number;                    // ordinary AS pusher normally 1–8; never implies bulk
  beginGroup?(items: readonly PlanItem[], ctx: PushContext): Promise<unknown>; // TARA fence token
  apply(item: PlanItem, ctx: PushContext, groupToken?: unknown): Promise<ApplyResult>;
  readBack(item: PlanItem, ctx: PushContext): Promise<ReadBackResult>;
  commitGroup?(items: readonly PlanItem[], ctx: PushContext, groupToken: unknown): Promise<void>;
}
export function registerTypedPusher(pusher: EntityPusher): void; // delegates to WP-17 seam; duplicate kind throws

export interface PushOptions {
  scope: SyncScope; planId: string; expectedPlanSha256: string;
  expectedBaseStateSha256: string; confirmed: boolean; runId?: string; signal?: AbortSignal;
}
export interface PushItemResult {
  kind: EntityKind; key: string; status: "applied" | "failed" | "skipped";
  error: { code: string; message: string; retryable: boolean } | null;
}
export interface PushReport {
  runId: string; planId: string; status: "completed" | "partial" | "failed";
  summary: { total: number; applied: number; failed: number; skipped: number };
  results: PushItemResult[]; requiresPull: boolean;
}
export function push(deps: PushDeps, options: PushOptions): Promise<PushReport>;
export function resumePush(deps: PushDeps, runId: string, signal?: AbortSignal): Promise<PushReport>;
```

`push_log.status` remains exactly `pending|applied|failed|skipped`. Its keys and every lookup begin with storage-normalized `project_id,project_version_id`; it persists `base_generation_id`, `base_revision`, and `expected_base_content_hash`. Detailed error is validated JSON in the existing TEXT column.

## Acceptance criteria
- [ ] A plan with unresolved conflicts, validation errors, stale base, or unconfirmed blast radius performs zero server writes.
- [ ] Core entity calls are per-row, ordered, limiter-bound; VEX alone batches in groups of at most 500.
- [ ] Noop items cause zero server/audit writes and are logged skipped.
- [ ] Each successful item updates its log and base atomically before the next item can make the run incoherent.
- [ ] One successful item increments the exact project/version/kind revision, invalidates plans fenced to the prior revision, and cannot advance a sibling scope; remaining items recheck their expected base hashes.
- [ ] VEX partial HTTP-success advances successes only; failures remain dirty and resumable.
- [ ] Silent key-drop produces `READ_BACK_MISMATCH`; 200 alone is never treated as proof on required routes.
- [ ] Mid-push reset plus resume converges without duplicate writes or lost applied state.
- [ ] TARA is head-checked and checkpointed with `expectedHeadVersionId`; exact 409 is surfaced and never described as rollback.
- [ ] Creates learn ids before dependents; deletes remove base only after verified absence.
- [ ] Progress events are tiny hints; typecheck/test/lint/build is green.

## Test plan — `resumable-push`
- `six creates/three updates/one delete apply in plan order; ids learned`.
- `noop suppression leaves mock audit count unchanged`.
- `VEX 501 rows becomes 500+1 and partial result advances successes only` (**partial-failure path**).
- `silent strict key-drop → read-back mismatch, base unchanged` (**fault path**).
- `connection reset after N → reconcile, resume, no duplicate audit writes` (**fault path**).
- `stale plan and unresolved conflict write zero` (**error paths**).
- `TARA pre-head mismatch and checkpoint 409` (**fault paths**); assert already-applied rows are reconciled, not called rolled back.
- `review/standards token uses review_version`.
- `crash between server success and log/base update` — pending reconciliation recognizes intended remote payload and advances the exact scoped base/revision once.
- `same run/kind/key across two projects and versions` — journals and base/id advancement remain isolated; project-level sentinel never reaches a remote client.

## Do not
- Do not recompute or silently modify a plan during push.
- Do not bulk ordinary AS writes or resend noops.
- Do not retry ambiguous non-idempotent writes without read-back.
- Do not advance base for a failed/unverified write.
- Do not claim the TARA bracket is a transaction; `begin_tara_trial` remains an unexposed platform ask.
- Do not add `fs_sync_push` as an agent tool.
- Do not change the frozen schema or WP-17 seam without an amendment.

## Open questions
1. Verify TARA head/checkpoint routes against the vendored AS handler-backed evidence before freezing WP-06. If not verified, remove/withhold the operation and file an amendment; there is no guarded raw fallback.
2. Decide whether `[bb:<runId>]` must truncate an existing reason to a server limit; verify the limit first.
