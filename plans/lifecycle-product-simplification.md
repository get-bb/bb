# Lifecycle product simplification: retiring environments

This plan supersedes the environment cleanup-intent portion of
`plans/lifecycle-target-state.md` if adopted. The goal is to remove the extra
`cleanupRequestedAt` dimension and make environment availability a single
product state machine.

## Problem

The current branch improves correctness, but the environment model still has two
dimensions:

- `status`: `provisioning | ready | error | destroying | destroyed`
- `cleanupRequestedAt`: separate durable intent to destroy later

That makes common questions require `status + cleanupRequestedAt + path`:

- Is this environment usable for work?
- Is it scheduled for cleanup?
- Can a follow-up cancel cleanup?
- Has a destroy RPC actually started?

The product should answer those with `status` alone wherever possible.

## Target Product Model

Add one environment status:

```ts
provisioning | ready | retiring | error | destroying | destroyed
```

Status meanings:

| status | product meaning | follow-up behavior |
| --- | --- | --- |
| `provisioning` | workspace is being created or recovered | queue/reject per existing policy |
| `ready` | workspace is usable | send directly |
| `retiring` | workspace is still present, but cleanup is scheduled and has not claimed destroy yet | atomically revive to `ready`, then send |
| `error` | environment is not usable | attempt recovery via `error -> provisioning` |
| `destroying` | destroy RPC is in flight | reject work |
| `destroyed` | terminal; workspace is gone | reject work |

Important invariant: a destroy RPC may only be in flight while
`status = "destroying"`. Therefore `retiring -> ready` does not need a separate
"no destroy dispatched" guard; the CAS on status is the guard.

## Product Rules

- Cleanup is no longer a stored request on an otherwise `ready` environment.
- A managed environment becomes `retiring` only when the lifecycle owner sees it
  is eligible to be cleaned up, e.g. no unarchived/non-deleted threads and no
  stopping/running shutdown work that should block destroy.
- `retiring` is a soft state. A user follow-up can cancel it by winning
  `retiring -> ready` before cleanup wins `retiring -> destroying`.
- `destroying` and `destroyed` remain hard unavailable states. A follow-up
  should return `thread_environment_unavailable`.
- `error` means "not usable." Whether a path exists is implementation detail for
  cleanup/recovery. A follow-up from `error` attempts `error -> provisioning`,
  not `error -> ready`.
- Error cleanup does not need a soft `retiring` grace state. If an errored
  managed environment has no live owners, cleanup claims `error -> destroying`;
  pathless cleanup then completes `destroying -> destroyed`.
- Provisioning cleanup remains current-phase-first: while provision is in
  flight, the status is `provisioning`; cancellation/settlement should trigger
  the same retirement eligibility check afterward.

## Lifecycle Table Shape

Keep the environment table small and product-semantic:

```ts
ready:
  retire.requested -> retiring

retiring:
  retire.cancelled -> ready
  destroy.started -> destroying

error:
  provision.requested -> provisioning
  destroy.started -> destroying

provisioning:
  provision.succeeded -> ready
  provision.failed -> error
  provision.cancelled -> ready | destroying // depends on whether a workspace exists

destroying:
  destroy.completed -> destroyed
  destroy.failed -> retiring
  destroy.lost -> error

destroyed:
  // terminal
```

Follow-up can use the same lifecycle writer:

- If env is `ready`, send.
- If env is `retiring`, CAS `retiring -> ready`; if applied, send.
- If CAS loses, re-read and route based on the new status.
- If env is `error`, request provisioning/recovery.
- If env is `destroying | destroyed`, reject.

## Event Vocabulary Simplification

After the product model is simplified, collapse producer-flavored lifecycle
events into fewer semantic events. The table should describe product state, not
every callback source.

Thread candidates:

- `run.preparing`
- `run.started`
- `run.succeeded`
- `run.failed`
- `stop.requested`
- `stop.settled`

Environment candidates:

- `provision.requested`
- `provision.succeeded`
- `provision.failed`
- `provision.cancelled`
- `retire.requested`
- `retire.cancelled`
- `destroy.started`
- `destroy.completed`
- `destroy.failed`
- `destroy.lost`

Producer-specific stale checks can stay at call sites when they depend on event
log facts the row cannot express.

## Implementation Steps

1. Document the availability matrix
   - Add `retiring` to the environment status domain contract.
   - Define the work-request behavior for every environment status in one
     server helper.
   - Decide whether unarchive itself revives `retiring -> ready`, or only an
     actual send/follow-up does. Recommended: only actual work revives.

2. Replace cleanup intent with `retiring`
   - Remove `cleanupRequestedAt` from domain schemas, public contract, DB schema,
     and app assumptions.
   - Add a migration that drops `environments.cleanup_requested_at`.
   - During migration, set `ready + cleanup_requested_at` rows to `retiring`
     only when they are already cleanup-eligible; otherwise keep `ready` and let
     future owner changes re-evaluate retirement.
   - Leave `destroying` rows as `destroying`; they already represent claimed
     cleanup.

3. Introduce retirement eligibility
   - Replace `recordEnvironmentCleanupRequest` with
     `maybeRetireEnvironment`.
   - Call it after archive, delete, stop-finalize, project deletion, provision
     cancellation/settlement, and any place that can remove the last live owner.
   - Keep the eligibility query targeted in SQL. Do not load all threads and
     filter in JS.

4. Rewrite cleanup advance
   - Cleanup sweep lists `status = "retiring"` rows.
   - Destroy claim is a CAS `retiring -> destroying` plus the existing
     cross-table "no live/stopping threads" predicates.
   - Pathless retiring rows still claim `destroying`, then complete
     `destroy.completed -> destroyed`.
   - Destroy failure returns to `retiring`; lost destroy results move to `error`
     because workspace existence is unknown.

5. Rewrite work dispatch against retiring
   - In the send/queued/parent/schedule paths, treat `retiring` as revivable.
   - The work path claims `retiring -> ready` in the same transaction used to
     prepare dispatch, or immediately before it with a re-read on CAS loss.
   - `destroying | destroyed` still return `thread_environment_unavailable`.

6. Simplify environment lifecycle events
   - Delete `cleanupRequested` supersession predicates.
   - Remove lifecycle events that only existed to model `cleanupRequestedAt`.
   - Keep `destroyAttemptId` only if it is still needed to reject stale destroy
     failure reports.

7. UI behavior
   - Add display copy for `retiring`, e.g. "Workspace scheduled for cleanup."
   - Do not show the hard "environment gone" read-only composer for `retiring`.
   - Keep the hard read-only banner for `destroying | destroyed`.
   - Ensure queued messages and manual follow-ups both use the same revive path.

8. Tests
   - Domain tests pin the smaller environment lifecycle table.
   - DB tests cover CAS races:
     - send wins `retiring -> ready`; cleanup claim loses.
     - cleanup wins `retiring -> destroying`; send rejects after re-read.
     - double destroy settlement no-ops correctly.
   - Server tests cover:
     - archive last thread retires the environment.
     - archive one of multiple live threads does not retire it.
     - unarchive without send does not necessarily revive, if that decision is
       accepted.
     - follow-up to `retiring` revives and dispatches.
     - follow-up to `destroying | destroyed` rejects.
     - follow-up to `error` requests provisioning, not `ready`.
   - Integration test replaces the current "destroyed env never reprovisions on
     unarchive" assertion with:
     - `retiring` can be revived before destroy starts.
     - `destroyed` remains terminal.

## Exit Criteria

- `cleanupRequestedAt` and `cleanup_requested_at` have zero runtime-source hits
  outside migrations, old Drizzle snapshots, and migration compatibility tests.
- `EnvironmentStatus` includes `retiring`.
- All work-request routing asks only `environment.status` for product
  availability.
- Environment cleanup sweep starts from `status = "retiring"`, not
  `cleanup_requested_at IS NOT NULL`.
- Destroy ownership starts only from `retiring -> destroying`, cancelled
  pathless provisioning to `destroying`, or the explicitly chosen errored
  cleanup path. A pathless destroy may complete without dispatching a host RPC.
- A follow-up to `retiring` is covered by an atomic race test against cleanup.
- `destroying` and `destroyed` remain terminal/unavailable from the work path.
- Lifecycle diagrams are regenerated and show no cleanup-intent side dimension.

## Validation

```bash
rg "cleanupRequestedAt|cleanup_requested_at" packages apps tests qa docs
rg '"retiring"|EnvironmentStatus' packages/domain packages/db apps/server apps/app
pnpm exec turbo run typecheck --filter=@bb/domain --filter=@bb/db --filter=@bb/server --filter=@bb/app > /tmp/lifecycle-simplify-typecheck.txt 2>&1
pnpm exec turbo run test --filter=@bb/domain --filter=@bb/db --filter=@bb/server > /tmp/lifecycle-simplify-tests.txt 2>&1
pnpm exec turbo run test --filter=@bb/integration-tests --force > /tmp/lifecycle-simplify-integration.txt 2>&1
```

Manual QA:

- Create a managed worktree thread, archive the last thread, confirm the
  environment becomes `retiring`.
- Send a follow-up before cleanup dispatch, confirm it revives to `ready` and
  runs.
- Archive again and let cleanup dispatch, confirm `destroying -> destroyed`.
- Unarchive after `destroyed`, confirm the send path rejects with the hard
  environment-unavailable surface.

## Non-goals

- A full "provision new environment for old destroyed thread" product flow.
- Reworking thread statuses beyond the event-vocabulary merge described above.
- Preserving the exact cleanup-request timestamp as product data. If audit
  timing is needed later, use lifecycle events or `updatedAt`, not another
  availability dimension.
