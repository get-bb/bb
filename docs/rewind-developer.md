# Rewind: developer notes

This doc covers the implementation of native thread rewind end to end:
branch lineage, provider adapters, migrations, rollout metrics, and
troubleshooting. For the user-facing contract see
[rewind.md](rewind.md).

## Branch lineage

Rewinds never rewrite or delete stored thread events. Instead, BB keeps an
immutable branch lineage and a movable active pointer:

- `thread_branches` stores every conversation branch (creation reason, parent
  branch, cutoff sequence, lifecycle, provider session binding, cleanup
  status). Raw provider session/checkpoint identifiers never leave this
  table.
- `thread_active_branches` holds the single active pointer per thread.
- `thread_source_branches` records the source branch provenance for threads
  created by fork operations.
- `thread_rewind_checkpoints` maps a user message on a branch to the exact
  provider anchor needed to branch just before it (Codex turn id or Claude
  message UUID).
- Thread events carry a nullable `branch_id`; direct legacy writes remain
  unassigned, and every DB append path stamps the active branch.

Projections (timeline, output, search segments, goals, plans, token usage,
rate-limit recovery, execution settings) resolve from the active branch.
Existing forks and side chats stay valid against the historical branch they
came from.

### Lifecycles

- `staged`: the BB branch is reserved while the provider branch is being
  created. It never owns the active pointer.
- `active`: the current conversation branch.
- `available`: a completed branch that can be restored.
- `abandoned`: a branch that failed or was superseded. It is retained as a
  durable record; `cleanup_status` tracks provider session cleanup
  (`pending`, `completed`, `failed`, `not-needed`).

## Orchestration and failure contract

`commitThreadRewind` in `apps/server/src/services/threads/thread-rewind.ts`
is the rewind transaction:

1. **Reserve**: validate eligibility and thread idleness, then create the
   staged branch and a `provider-branch-pending` operation event.
2. **Provider branch**: create the provider session at the checkpoint.
   Failure before this point leaves the original branch untouched.
3. **Activate**: bind the provider session and switch BB's active lineage in
   one immediate transaction, then append the edited turn request.
4. **Submit**: hand the edited turn to the provider. A send failure settles
   the thread back to idle with the draft recoverable.

`previewThreadRewind` is a read-only eligibility query with an optimistic
revision echo that commits re-validate (`assertPreviewIsCurrent`).
`restoreThreadRewindBranch` switches the active pointer back to an existing
branch with a compare-and-swap guard (`expectedActiveBranchId`); it never
touches provider history or the filesystem.

`reconcileThreadRewindOperations` is a durable recovery seam safe to run from
a fresh server process: staged reservations whose thread is no longer
`starting` on the original branch are abandoned, and known provider sessions
are cleaned through the transport.

The provider transport is injectable (`ThreadRewindProviderTransport`), so
server invariants are tested without a daemon. The production transport uses
the settled `thread.start`/`turn.submit` transport with exact provider fork
fields.

## Experiment gate

Rewind ships behind the `rewind` experiment (Settings → Experiments; persisted
in `system_experiments.rewind`, default off):

- Server: `POST /threads/:id/rewind` returns `403 experiment_disabled` and
  records the `experiment_denied` counter when the experiment is off.
  Preview, branch history, and restore are intentionally left available so
  existing branch history is never hidden and recovery paths stay
  exercisable during the rollout.
- UI: the pencil action and the rewind keyboard path are wired only when
  `experiments.rewind` is true (`isRewindAvailable` in `ThreadDetailView`).
  The recovery banner stays visible either way.
- Migrations are not gated: the schema, backfills, and projections apply for
  every installation, so disabling the experiment never loses data.

## Rollout metrics

`rewind_rollout_metrics` holds aggregate integer counters only — no prompt
content, thread ids, or provider identifiers. `GET
/api/v1/system/rewind-rollout-metrics` returns them. Counter names:

| Counter                   | Meaning                                                |
| ------------------------- | ------------------------------------------------------ |
| `preview_denied`          | Preview returned ineligible for a target               |
| `provider_branch_failure` | Provider branch creation failed (provider-side)        |
| `activation_failure`      | BB failed to activate the staged branch (BB-side)      |
| `edited_turn_failure`     | Edited-turn submission failed after activation         |
| `restore`                 | A branch was restored to the active pointer            |
| `orphan_cleanup`          | A provider session for an abandoned branch was cleaned |
| `experiment_denied`       | A commit was rejected because the experiment is off    |

The provider/BB split is deliberate: `provider_branch_failure` points at the
provider adapter or CLI, while `activation_failure` and `edited_turn_failure`
point at BB orchestration.

## Migrations

Schema changes live in `packages/db/src/schema.ts`; generate migrations with
`pnpm --filter @bb/db db:generate`. Do not hand-edit Drizzle snapshots. The
0090 migration adds the `rewind` experiment column and the
`rewind_rollout_metrics` table.

## Troubleshooting

- **`experiment_disabled`**: the Rewind experiment is off. Enable it in
  Settings → Experiments.
- **`provider-branch-failed`**: the provider could not create the checkpoint
  branch. The original thread is untouched; check the host daemon log for the
  provider error.
- **`branch-commit-failed` with a `stale-preview` body**: the thread changed
  between preview and commit (a new turn, approval, or queued message). Reopen
  the rewind confirmation.
- **Staged branches accumulating**: run the reconciliation seam
  (`reconcileThreadRewindOperations`) or restart the server; orphaned staged
  branches are abandoned and their provider sessions cleaned. Watch
  `orphan_cleanup` and `activation_failure` counters.
- **Restore fails**: the thread must be idle, and `expectedActiveBranchId`
  must match the active pointer at request time. Abandoned branches cannot be
  restored.
