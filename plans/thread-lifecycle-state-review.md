# Thread And Environment Lifecycle State Review

Working alignment doc for simplifying the lifecycle model. The goal is to keep
the product state machines small enough to review, and to move callback-ordering
tolerance, readiness checks, and retry policy out of the state table where they
do not belong.

## Shared Principles

| Principle | Meaning |
|---|---|
| Status describes the resource's current lifecycle phase. | It should answer "what is this thing doing now?", not "what request did we make?" or "which callback arrived?" |
| Quiescent does not mean ready. | A thread can be idle after cancelled starting; an environment can have a path that is no longer trustworthy. Readiness must be checked by the start/command path. |
| Terminal callbacks belong to the active operation. | `succeeded`/`failed` events should not clear unrelated settled states unless the caller proves they belong to the current operation. |
| Next-run intent is not current-run state. | A follow-up submitted while stopping should be queued/persisted, then started after stop settlement. |
| Environment readiness is separate from thread run status. | Thread state should not decide whether a workspace/session can accept work. |

## Thread Target

Thread status should model the current run phase. It should not encode
environment readiness or provider/session readiness.

### Target Model

Use one durable `status` field. Do not add a separate `lastOutcome` field.
If the UI needs to distinguish "last run stopped" from "last run succeeded",
derive that from the event timeline, not from another lifecycle dimension.

| Status | Meaning |
|---|---|
| `idle` | Quiescent: no work, preparation, or stop is in progress. Does not imply runtime/session readiness. |
| `starting` | The thread is preparing new work before an agent turn can run. This may include a short accepted-but-not-yet-running window. |
| `active` | Agent work is in progress for the current run. |
| `stopping` | A stop was requested and the current run or start attempt is winding down. |
| `error` | Quiescent failed state. Does not say whether retry can start directly or must prepare first. |

Remove `created` from the durable state machine. A persisted runnable thread is
already in the start/preparation lifecycle, so new thread creation should insert
`starting` directly.

Creation should not expose a generic "pick the initial lifecycle status"
parameter. Generic thread creation should create runnable threads as
`starting`; follow-up starts from existing quiescent rows should transition
through the lifecycle table.

`starting` means "the thread is not runnable yet because start/setup is being
prepared or attempted." It does not imply environment provisioning has started;
environment `provisioning` owns that meaning.

### Target Edges

| From | Input | To | Description |
|---|---|---|---|
| `idle` | `run.preparing` | `starting` | New work needs preparation before it can run. |
| `idle` | `run.started` | `active` | New work can start immediately. |
| `error` | `run.preparing` | `starting` | Retry/follow-up needs preparation before it can run. |
| `error` | `run.started` | `active` | Retry/follow-up can start immediately. |
| `starting` | `run.started` | `active` | Preparation finished and the run is in progress. |
| `starting` | `run.failed` | `error` | Preparation/start failed. |
| `starting` | `stop.requested` | `stopping` | User cancels before the run becomes active. |
| `active` | `run.succeeded` | `idle` | Current run completed successfully. |
| `active` | `run.failed` | `error` | Current run failed. |
| `active` | `stop.requested` | `stopping` | User asks to stop live work. |
| `stopping` | `stop.settled` | `idle` | Stop completed. |
| `stopping` | `run.succeeded` | `idle` | Work finished while stop was pending; the requested stop is satisfied. |
| `stopping` | `run.failed` | `error` | Work failed while stopping. |

### Follow-Up While Stopping

Do not add `stopping -> active`.

| Step | State effect |
|---|---|
| User submits follow-up while `stopping` | Persist/append the follow-up as pending input; keep status `stopping`. |
| Current run stop settles | `stopping -> idle` or `stopping -> error`. |
| Pending follow-up drains | Start path chooses `idle/error -> active` or `idle/error -> starting -> active`. |

### Thread Edges To Remove Or Guard

| Edge | Reason |
|---|---|
| any `created` edge | `created` is removed from the durable state machine. |
| `run.succeeded` from `starting`, `idle`, or `error` | Completion should belong to an active run. Callback-ordering tolerance should live at event ingress. |
| `stop.settled` from anything except `stopping` | A stop cannot settle unless a stop was requested first. |
| `stopping -> active` | A follow-up while stopping is next-run intent, not current-run state. |
| generic `runtime.lost` | Host/session recovery is not a product state-machine input. Reconciliation should translate it to `stop.settled` when a stop is satisfied, or `run.failed` when the current run was lost. |
| generic `workspace.lost` | Environment lifecycle is not thread run status. Translate to `run.failed` only when workspace loss invalidates the current run; otherwise the thread status should not change. |
| `run.failed` from `idle` | A late failure while no run is active should be rejected as stale unless the caller proves it belongs to a current lifecycle operation. |

## Environment Target

Environment status should model the workspace lifecycle. It should not model
thread run state, queued user intent, or branch cleanup details.

### Current State Definitions

| Status | Meaning |
|---|---|
| `provisioning` | Workspace setup/reprovision is actively happening. The workspace is not yet usable. |
| `ready` | Workspace exists and is usable for new work. |
| `retiring` | Cleanup is pending, but destroy has not started. This is reversible before destroy starts. |
| `destroying` | Cleanup has started destroying the environment. It removes a workspace if one exists, or proves there is no workspace to remove. The environment should not be revived as ready. |
| `destroyed` | Terminal. The workspace is gone or no workspace needs to exist for this record. |
| `error` | Provisioning/recovery failed or workspace state is not usable without recovery. |

Separate row facts still matter:

| Field | Meaning |
|---|---|
| `managed` | Whether BB owns cleanup for this workspace. Unmanaged environments should not enter cleanup-only states. |
| `path` | Last known workspace path. Presence is not proof the workspace is currently usable. |
| `destroyAttemptId` | Current destroy operation attempt, if `destroying`. Used to match settlement from async destroy work. |

### Target Edges

| From | Input | To | Description |
|---|---|---|---|
| `provisioning` | `provision.succeeded` | `ready` | Workspace setup completed and is usable. |
| `provisioning` | `provision.failed` | `error` | Workspace setup failed. |
| `provisioning` | `provision.cancelled` with workspace | `ready` | Setup was abandoned after a usable workspace already existed. |
| `provisioning` | `provision.cancelled` without workspace | `destroying` | Managed setup was cancelled before any workspace existed; cleanup still passes through destroy before terminal settlement. |
| `ready` | `provision.requested` | `provisioning` | Reprovision/checkout starts for an existing environment. |
| `ready` | `retire.requested` | `retiring` | Managed environment became cleanup-eligible. |
| `retiring` | `retire.cancelled` | `ready` | New work revived the environment before destroy started. |
| `retiring` | `destroy.started` | `destroying` | Cleanup started destroy. |
| `error` | `provision.requested` | `provisioning` | Recovery/retry starts. |
| `error` | `destroy.started` | `destroying` | Cleanup starts destroy for a managed errored environment. |
| `destroying` | `destroy.completed` | `destroyed` | Destroy operation completed; the workspace is gone or no workspace existed. |
| `destroying` | `destroy.failed` | `retiring` | Destroy did not complete; keep cleanup intent for retry. |
| `destroying` | `destroy.lost` | `error` | Destroy result was lost, so workspace existence is unknown. Do not allow blind revive. |

Every terminal destroy path must pass through `destroying`. No-path cleanup is
not a separate event; it is a destroy operation that completes without a
workspace to remove.

| Source state | Required proof |
|---|---|
| `retiring` / `error` / cancelled no-workspace provisioning + `destroy.started` | The lifecycle owner started destroy for this environment. |
| `destroying` + `destroy.completed` | Current destroy operation completed; with a path this means the workspace was removed, without a path this means there was no workspace to remove. |

### Environment Edges To Remove Or Guard

| Edge | Reason |
|---|---|
| `destroyed -> *` | Destroyed must remain terminal. New work gets a fresh environment. |
| `retiring/error -> destroyed` | All terminal destroy paths must pass through `destroying`, even when there is no workspace path. |
| `destroying -> ready` | Destroy has started; follow-up cannot safely revive the same row. |
| `destroy.lost -> retiring -> ready` | A lost destroy result means the workspace may already be gone. Move to `error` instead of a revivable cleanup state. |
| `retire.cancelled` after destroy started | Revival is safe only before destroy has started. |
| `provision.*` from `destroying` or `destroyed` | Provision settlement/retry should not collide with destroy. |
| `retire.requested` on unmanaged environments | Cleanup ownership belongs only to managed environments. |

### Environment Naming Cleanup

| Current name | Concern | Candidate |
|---|---|---|
| `retire.completed` | Encodes the no-path shortcut that should not exist as a direct terminal edge. | Remove it; use `destroy.started -> destroy.completed`. |
| `destroy.succeeded` | Names a lower-level success result, but as a lifecycle event this means the destroy operation completed. | Rename to `destroy.completed`. |
| `destroy.lost -> retiring` | Makes the row look revivable even though workspace existence is unknown. | `destroy.lost -> error` |
| `provision.cancelled -> error` without path | A user-cancelled setup with no workspace is not an environment error. | Route into `destroying`, then `destroy.completed`. |

## Implementation-Detail Leak Audit

These are not target product transitions. They should either disappear from the
lifecycle tables or be translated before an event reaches the table.

| Current shape | Why it is wrong | Target |
|---|---|---|
| `runtime.lost` as a thread transition | Host/session reconciliation detail leaked into thread status. | Reconciliation emits `stop.settled` or `run.failed` based on the current operation. |
| `workspace.lost` as a generic thread transition | Environment lifecycle leaked into thread status. | Environment loss becomes `run.failed` only when it invalidates the current run. |
| terminal run/stop events from `created`, `starting`, `idle`, or `error` | Callback-order tolerance encoded as product lifecycle. | Reject stale events or require current-operation proof at ingress. |
| thread `provisioning` status | Environment setup wording leaked into the thread lifecycle. | Use thread `starting`; environment keeps `provisioning`. |
| `retire.completed` / direct no-path cleanup to `destroyed` | Path-absence shortcut skipped the destroy lifecycle. | Always enter `destroying`, then complete `destroying -> destroyed`. |
| `destroy.succeeded` in the product table | Lower-level operation result leaked into lifecycle naming. | Use `destroy.completed`. |
| `destroy.lost -> retiring` | Recovery uncertainty made the environment look revivable. | `destroy.lost -> error`. |
| guard predicates rendered inline on diagram edges | Storage guard predicates made the diagram look like the product state machine has many more edges. | Render product edges first; document guards separately. |

### Closed Implementation Gaps

The generated diagram now renders the product-shaped tables. The implementation
changed these formerly confusing shapes:

| Area | Implemented change |
|---|---|
| Thread statuses | Removed `created`; new runnable threads start as `starting`; environment `provisioning` remains environment-only vocabulary. |
| Thread loss events | Removed `runtime.lost` and `workspace.lost` from the thread lifecycle table; ingress/reconciliation translates them to `stop.settled` or `run.failed`. |
| Thread stale terminal events | Removed pre-run and quiescent terminal edges; ingress applies same-batch `turn/started` before `turn/completed` instead of allowing `starting + run.succeeded`. |
| Thread idle failure | Removed `idle + run.failed`; late failures must be tied to an active operation before reaching the table. |
| Environment no-path cleanup | Removed direct `retiring/error -> destroyed`; no-path cleanup now applies `destroy.started -> destroying -> destroy.completed -> destroyed`. |
| Environment pathless provisioning cancel | `provision.cancelled` without workspace now routes to `destroying`, then completes to `destroyed`. |
| Environment destroy naming | Replaced `destroy.succeeded` with `destroy.completed`. |
| Environment lost destroy | `destroy.lost` now moves to `error`, not a revivable cleanup state. |

## Implementation Checklist

| Area | Change |
|---|---|
| Thread status | Done: removed `created`; new runnable threads start as `starting`. |
| Thread creation API | Done: generic creation inserts `starting`; later starts use lifecycle events. |
| Thread events | Done: thread table uses `run.preparing`, `run.started`, `run.succeeded`, `run.failed`, `stop.requested`, `stop.settled`. |
| Thread ingress | Done: stale/callback-order cases are handled before the lifecycle table. |
| Thread runtime/workspace loss | Done: loss handling translates to `stop.settled` or `run.failed` before applying thread status events. |
| Thread follow-up | Done: input while `stopping` remains next-run intent; no `stopping -> active`. |
| Environment lost destroy | Done: `destroy.lost` moves to `error`. |
| Environment no-path cleanup | Done: no-path cleanup routes through `destroying -> destroyed`; direct no-path terminal edges are removed. |
| Environment events | Done: removed `retire.completed`; replaced `destroy.succeeded` with `destroy.completed`. |
| Diagrams | Done: regenerated from the simplified source tables. |
| Stale plans | Still open: older lifecycle drafts should not be used as implementation guidance without this doc. |

## Exit Criteria

- Every edge in both diagrams has a product explanation that does not rely on
  daemon callback ordering.
- Callback-ordering tolerance lives at event ingress or source-specific call
  sites.
- Thread status never implies environment/runtime readiness.
- Runtime/session/workspace loss does not appear as a generic thread
  state-machine input.
- Environment status never implies thread run state.
- Destroyed environments are never revived.
- All destroyed environments pass through `destroying`.
- Lost destroy results move to `error`, not to a revivable cleanup state.
- Domain, db, server, and relevant integration tests pass after code changes.

## Validation

After implementation, these searches should either return no hits or only hits
in migration compatibility notes/tests that intentionally reference old names:

```bash
rg "runtime\\.lost|workspace\\.lost" packages/domain/src/thread-lifecycle.ts apps/server packages/db
rg "retire\\.completed|destroy\\.succeeded" packages/domain/src/environment-lifecycle.ts apps/server packages/db
rg '"created"|"provisioning"' packages/domain/src/thread-lifecycle.ts packages/domain/src/thread-status.ts
rg "retiring.*destroyed|error.*destroyed|workspacePathAbsent" packages/domain/src/environment-lifecycle.ts packages/db apps/server docs
```

Run targeted validation through Turbo:

```bash
pnpm exec turbo run typecheck --filter=@bb/domain --filter=@bb/db --filter=@bb/server --filter=@bb/app
pnpm exec turbo run test --filter=@bb/domain --filter=@bb/db --filter=@bb/server
pnpm exec turbo run test --filter=@bb/integration-tests --force > /tmp/lifecycle-simplification-integration.txt 2>&1
```
