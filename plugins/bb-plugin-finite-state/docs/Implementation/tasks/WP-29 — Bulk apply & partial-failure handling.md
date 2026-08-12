# WP-29 — Bulk apply & partial-failure handling

**Lane:** L3 Findings & VEX triage · **Spec refs:** SPEC 02 §2 Flow B, §6.8, §8.4–§8.6 · SPEC 01 push · RECON §2.6, §2.8 · **Effort:** 2.5 d · **Status:** unassigned
**Depends on:** WP-19, WP-27 · **Blocks:** WP-30
**Produces a FROZEN artifact:** no — implement the `vexDecision` pusher through the existing sync seam.

## Files you own
```
plugins/bb-plugin-finite-state/lanes/findings/bulk/index.ts  # replaces WP-22 stub
plugins/bb-plugin-finite-state/lanes/findings/bulk/{pusher,chunk,results,readback}.ts
plugins/bb-plugin-finite-state/lanes/findings/bulk/*.test.ts
```

## Files you must not touch
Sync push implementation/registration, frozen contracts, stable-key/overlay internals, UI, remote interfaces/mock fixtures, package files, or other lanes.

## Context
Only a human-approved persisted plan reaches this pusher. Agents may write YAML and inspect a plan, but there is **no agent push tool**. Before applying, stable keys resolve to current cached UUIDs; those UUIDs are ephemeral handles and every duplicate at the winning tier must be addressed. The plugin deliberately chunks direct Platform bulk VEX calls to at most 500 targets, and the set endpoint returns per-finding results; a top-level success never implies every row succeeded. Identical tuples are skipped because re-PUTs create audit noise.

## What to build
1. Register an `EntityPusher` for `vexDecision` through WP-17/WP-19's seam. Consume only validated, conflict-resolved plan items.
2. Resolve each stable key against the target pv at apply time using WP-23. Reject stale/orphaned decisions; force `CODE_NOT_REACHABLE` exact-version validation again.
3. Expand one plan item to every resolved duplicate UUID, then group by product version, operation (`set|clear`), and identical VEX tuple. Chunk set calls to at most 500 findings and use the frozen clear-bulk surface for clear operations; never emulate clear by writing null fields.
4. Diff against the freshest cached/remote tuple immediately before send and suppress noops. Stamp `[bb:<runId>]` into `vex_reason` without discarding the human reason or exceeding server limits.
5. Consume `{status,summary,results[]}` and map every UUID result back to its stable-key plan item. Treat missing/duplicate/unknown result entries as failures, not success.
6. Advance base per stable-key item only when **all** UUID rows for that item succeed and read-back/response proves the tuple. Leave failed/partial items dirty and append precise `push_log` records for resume.
7. Honor WP-19 rate limiting, retry 429 according to `Retry-After`, and do not automatically retry semantic 4xx errors. A retry resumes only failed/unattempted chunks.
8. Return bounded per-item results to the sync review UI with counts, failure codes, and retryability; realtime sends progress hints only.

## Interface contract
```ts
export interface VexBulkTarget {
  pvId: string; findingId: string; stableKey: string;
  action: "set" | "clear";
  tuple?: VexTuple; // required for set, forbidden for clear
}
export interface VexApplyResult {
  stableKey: string;
  targets: number;
  succeeded: number;
  failed: number;
  state: "applied" | "partial" | "failed" | "noop" | "stale" | "orphaned";
  errors: { findingId?: string; code: string; message: string; retryable: boolean }[];
}
export const VEX_PLATFORM_BATCH_LIMIT = 500;
export async function pushVexItems(ctx: PushContext, items: PlanItem[]): Promise<VexApplyResult[]>;
```

## Acceptance criteria
- [ ] No set call contains more than 500 targets and grouping never mixes pvIds, operations, or tuples; clear uses the dedicated frozen clear path.
- [ ] Every duplicate UUID at the resolved tier is included; UUIDs never persist back to YAML.
- [ ] Noop tuples produce no Platform write and no timestamp/audit churn.
- [ ] Base advances only after all rows represented by a stable decision succeed.
- [ ] Partial failures remain dirty, are recorded in `push_log`, and resume without repeating confirmed successes.
- [ ] Missing result entries and malformed success envelopes fail closed.
- [ ] `[bb:<runId>]` provenance preserves the authored reason.
- [ ] The pusher is reachable only through human push; no agent tool/action is registered.

## Test plan
`vex-bulk-pusher.test.ts`
- `501 targets split 500+1`, `duplicate business key fans out`, `set and clear never mix`, `clear advances to null base`, `noop skipped`, `mixed pv grouped`, and `successful base advances per item`.
- **Error path:** mock partial envelope fails one UUID; stable item remains dirty while unrelated items advance.
- **Fault path:** connection reset after first chunk resumes at second without replaying first.
- `429 honors Retry-After`; `unknown result id fails closed`; `orphan/stale never sent`.

## Do not
- Do not regard HTTP 200 or top-level `status` as proof of all item success.
- Do not advance the base for a partially successful stable decision.
- Do not invent a single-PUT fallback unless the frozen `PlatformClient` contract and vendored endpoint audit explicitly require it.
- Do not add a bulk size of 5,000; 500 is the plugin's resumable direct-Platform batch boundary even though the upstream contract permits a larger request.
- Do not create `fs_sync_push` or any agent-accessible push route.

## Open questions
1. If one duplicate succeeds and another fails, retrying the failed UUID is safe but base stays old; document this mixed server state in the review result.
2. Confirm the maximum reason length before appending provenance; truncation must preserve the human text and may put the tag first.
