# WP-40 — Verification run detail, attestations & TARA concurrency

**Lane:** L4 Product Security · **Spec refs:** SPEC 03 §4.2–§4.3, §7–§8 · SPEC 01 push · RECON §2.3, §2.8 · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-39, WP-19 · **Blocks:** L4 completion, verification ACTION-ONLY tool in WP-60
**Produces a FROZEN artifact:** no — replace the WP-31 run-detail stub and register product-security push hooks through existing seams.

## Files you own
```
plugins/bb-plugin-finite-state/lanes/product-security/verifications/run-detail/index.tsx  # replaces stub; exports lane registration hooks
plugins/bb-plugin-finite-state/lanes/product-security/verifications/run-detail/{RunDetail,ResultHistory,LogViewer,ArtifactList,AttestationCard,RunActions}.tsx
plugins/bb-plugin-finite-state/lanes/product-security/verifications/run-detail/{query,actions,attestation,logs}.ts
plugins/bb-plugin-finite-state/lanes/product-security/sync/{pusher,checkpoint,review}.ts
plugins/bb-plugin-finite-state/lanes/product-security/verifications/run-detail/*.test.tsx
plugins/bb-plugin-finite-state/lanes/product-security/sync/*.test.ts
```

## Files you must not touch
WP-31 registration files, frozen contract/schema/registry/remote types, generic sync push, bench implementation, agent tool registry/allowlist, package files, or composition roots.

## Context
Run detail exposes check contract, result history, logs, artifacts, and signed evidence bound to the firmware digest. A run is ACTION-ONLY: it invokes platform analysis and creates evidence; it does not edit YAML/model, and status changes only because the server rollup observes results. This WP exposes a service for WP-60 but registers no new agent tool. bb has no configurable per-tool approval gate, so architectural allowlisting remains WP-60's job.

TARA write semantics must match RECON. Per-row entity routes are last-write-wins. The plugin can bracket a push with current TARA head and working content hash/checkpoint, using `expectedHeadVersionId` and handling exact `stale_tara_state`. `begin_tara_trial` provides true fenced three-way apply but is **agents-API-only** today; do not call or emulate it. Review and standards transitions use cached **`review_version`**, not `entity_version`.

## What to build
1. Build the detail sheet for `verifications/<reqId>/<tier>`: check contract/mapping flags, newest-first `is_latest/superseded_by` history, failure/remediation, firmware version, confidence, and evidence summary.
2. Page/virtualize unbounded history and logs. Small JSON reads use RPC; large/streaming logs and artifact bytes use authenticated `bb.http` routes with range/content-disposition/path confinement.
3. Render signed attestations with subject firmware digest, artifact/evidence digest, signer/identity, signature/verification state, timestamp, and source run. A valid signature bound to a different digest is visibly invalid for this run.
4. Implement human UI actions to run a verification and record a manual attestation through the documented platform action endpoints. Require evidence note for manual; never insert result rows directly and never write status.
5. Poll `job_id` until `COMPLETED|FAILED|TIMEOUT`, emit tiny realtime hints, then refresh cached results/rollups. Cancel/unmount does not claim cancellation unless the backend confirms it.
6. Export a typed ACTION-ONLY `runVerification` service for WP-60. Do not register an agent tool here and do not rely on per-tool approval.
7. Implement the Product Security entity pusher hook: ordered per-row writes, per-entity base advancement, read-back on non-strict routes, and resumability through generic WP-19 machinery.
8. Before apply, call the frozen `AssuranceStudioClient.getTaraState` to read the current TARA head and, when that narrow client can verify it, the working content hash; compare them to the pulled base. Abort/replan on mismatch. After row applies, create a checkpoint with `expectedHeadVersionId` through `AssuranceStudioClient.createTaraCheckpoint`.
9. Handle 409 `stale_tara_state` exactly: keep already successful items base-advanced/coherent, stop remaining work, refresh/replan. State the honest residual race for uncheckpointed concurrent row writes.
10. For review/standards lifecycle actions, send cached `review_version`; 409 means refresh-and-retry, never merge or substitute `entity_version`.
11. Cover loading, no runs/evidence empty, scoped run/log/artifact error with retained data, and unconfigured states. Use Hugeicons/shared-ui/theme tokens.

## Interface contract
```ts
export interface VerificationRunRequest { requirementId: string; tier?: VerificationTier; checkId?: string; }
export interface VerificationJob { jobId: string; state: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "TIMEOUT"; progress?: number; }
export interface AttestationView {
  id: string; runId: string; firmwareDigest: string; evidenceDigest: string;
  signer: string; signature: string; signedAt: string;
  verification: "valid" | "invalid" | "unverified"; boundToCurrentFirmware: boolean;
}
export function runVerification(deps: ActionDeps, request: VerificationRunRequest): AsyncIterable<VerificationJob>;

export interface TaraFence { headVersionId: string; workingContentHash?: string; }
export async function pushProductSecurity(ctx: PushContext, plan: Plan, fence: TaraFence): Promise<PushReport>;
export interface ReviewTransitionInput {
  entityId: string; operationId: string;
  expectedReviewVersion: string; // decimal bigint encoded safely across JSON/RPC
  action: "approve" | "reject";
}
```

## Acceptance criteria
- [ ] Run detail shows contract, latest/superseded history, artifacts, logs, and attestation digest binding.
- [ ] Wrong-firmware or invalid-signature attestation cannot render as valid evidence.
- [ ] Verification/manual actions produce results through platform actions and never write `verification_status` or direct result rows.
- [ ] Polling terminates on `COMPLETED`, `FAILED`, or `TIMEOUT`; truth is refreshed from cache afterward.
- [ ] Product Security push head-checks before rows and checkpoints with `expectedHeadVersionId` after rows.
- [ ] Exact 409 `stale_tara_state` stops remaining writes, preserves successful per-entity base advances, and requests re-pull/re-plan.
- [ ] Code/tests make no call to `begin_tara_trial`; documentation states it is agents-API-only.
- [ ] Review and standards transitions use `review_version`, never `entity_version`.
- [ ] No agent tool is registered here; WP-60's three-action allowlist remains the only agent exposure.
- [ ] Unbounded logs/history are virtualized/paged and four UI states pass.

## Test plan
`verification-run-detail.test.tsx`
- `history chain`, `large log HTTP paging`, `artifact auth proxy`, `valid digest-bound attestation`, `wrong digest invalid`, and `job terminal states`.
- **Error path:** job reaches TIMEOUT or log stream drops; status remains evidence-derived from last confirmed cache and UI offers retry without claiming success.

`product-security-concurrency.test.ts`
- `head mismatch aborts before writes`, `ordered rows then checkpoint`, `non-strict route read-back`, and `per-row base advance`.
- **Fault path:** checkpoint returns exact `stale_tara_state` after two successes; those bases advance, later items stay dirty, report requires replan.
- `review/standards 409 refreshes using review_version`; static guard rejects `entity_version` and `begin_tara_trial` usage.

## Do not
- Do not add a mark-verified button, author status, or insert verification results directly.
- Do not claim bb per-tool approval exists or register a fourth server-touching agent tool.
- Do not call/emulate `begin_tara_trial` while it is agents-API-only.
- Do not roll back already confirmed per-row writes by rewriting their old values.
- Do not treat HTTP 200/signature presence as proof without read-back/cryptographic digest binding.
- Do not stream large logs/artifacts through JSON RPC.

## Open questions
1. If the frozen `AssuranceStudioClient` lacks working content-hash reads, use the verified head checkpoint bracket only and preserve the limitation in UI copy; request an amendment rather than fabricating a hash or using a raw route.
2. Check creation remains unresolved; `check:null` stays blocked and the run action cannot invent a check.
