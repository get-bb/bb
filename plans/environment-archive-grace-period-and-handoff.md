# Archive grace period and destroyed-environment handoff

Status: implemented 2026-06-17; simplified 2026-08-07.

## Outcome

Archiving the last live thread in a managed environment now has a durable
five-minute grace window. The archive toast offers **Undo** for 10 seconds; the
thread's normal **Unarchive** action remains available for the rest of the grace
window. Unarchiving sends the existing `retire.cancelled` lifecycle event and
preserves the intact worktree, including uncommitted work.

Once cleanup has started, a destroyed environment remains terminal and its
thread remains archived and read-only. The recovery action is **Continue in new
thread**. It uses the ordinary new-thread flow, seeds a rich mention of the old
thread, and creates a fresh managed worktree whose base is the destroyed
environment's surviving branch. Committed work is therefore available on the
new thread's newly named branch. Uncommitted and untracked work cannot be
recovered after the old worktree has been removed.

There is deliberately no restore route, SDK/CLI method, same-thread environment
replacement, daemon protocol change, or special existing-branch checkout path.

## Lifecycle

The existing environment state machine remains authoritative:

- `ready` → `retire.requested` → `retiring`
- `retiring` → `retire.cancelled` → `ready`
- `retiring` → `destroy.started` → `destroying`
- `destroying` → `destroy.completed` → `destroyed`

`destroyed` remains terminal. A new thread gets a new environment row.

The server's `managedEnvironmentRetireGraceMs` defaults to five minutes. Cleanup
uses the retiring environment row's durable `updatedAt` value instead of an
in-memory timer, so restart does not bypass the window. Grace applies only to a
path-bearing retiring environment with a non-deleted archived thread that could
still be revived. Deleted/tombstoned-only environments are reclaimed without
waiting.

The periodic sweep evaluates retiring managed environments every tick. The
cleanup advance owns the grace decision, keeping the policy in one place.
Orphaned `destroying` recovery remains the slower backstop.

## User flows

### Accidental archive, still inside grace

1. Archiving the last live thread moves the environment to `retiring`.
2. The toast remains visible for 10 seconds and offers **Undo**.
3. Toast Undo or the archived thread's **Unarchive** action unarchives the
   thread and emits `retire.cancelled` during the five-minute grace window.
4. The same environment and intact worktree return to `ready`.

### Cleanup already finished

1. The source thread stays archived and its old environment stays `destroyed`.
2. While destruction is in progress, its context banner shows **Archiving
   environment...** and the **Continue in new thread** action is disabled. Once
   destruction finishes, the banner shows **Environment archived** and enables
   the action.
3. Handoff opens new-thread compose in the source project, inserts `Continue
from @thread:<id>`, selects the original host in managed-worktree mode, and
   selects the old branch as the new worktree's base.
4. Normal create-thread provisioning derives a new unique branch and worktree.

The recovery seed is validated when read from navigation state. Compose stays
pinned to the original host while the seed is active and fails closed if the
host, project source, or branch is unavailable. Submission is blocked with an
explanation instead of silently falling back to the primary host or default
branch. Changing project, environment, or branch explicitly exits recovery mode.

Personal environments hand off to a fresh personal thread on the same host.
Unmanaged environments and managed rows without a recorded branch do not expose
the recovery action because there is no safe fresh-environment target to infer.

## Boundaries and data model

- No public HTTP, SDK, CLI, or daemon contract is added for recovery.
- The host daemon continues to receive ordinary new-worktree provision commands.
- `HOST_DAEMON_PROTOCOL_VERSION` is unchanged.
- No schema or migration is added. `updatedAt` is the durable grace clock.
- The only new database query answers whether a retiring environment has a
  revivable archived thread; it is a targeted `WHERE` query.
- The app-only handoff navigation seed is a discriminated environment target:
  project default, environment reuse, fresh managed worktree from a host/branch,
  or fresh personal workspace on a host.

## Verification

Tests cover:

- grace-window deferral, cancellation, expiry, restart recovery, and deletion;
- Undo toast behavior;
- destroyed-environment banner priority and handoff affordance;
- handoff seed validation and rich thread mention construction;
- normal new-thread provisioning from the destroyed environment's branch,
  proving committed work is present while the source thread/environment remain
  archived/destroyed.

The integration harness keeps `managedEnvironmentRetireGraceMs: 0` because it
has no periodic sweep or controlled clock; server-level lifecycle tests cover
the grace timing itself.
