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
new thread's newly named branch. Its comparison target remains the original
environment's merge base, so inherited commits stay visible as ahead-of-base
work instead of being treated as the new baseline. Uncommitted and untracked
work cannot be recovered after the old worktree has been removed.

There is deliberately no restore route, same-thread environment replacement,
daemon protocol change, or special existing-branch checkout path.

## Lifecycle

The existing environment state machine remains authoritative:

- `ready` → `retire.requested` → `retiring`
- `retiring` → `retire.cancelled` → `ready`
- `retiring` → `destroy.started` → `destroying`
- `destroying` → `destroy.completed` → `destroyed`

`destroyed` remains terminal. A new thread gets a new environment row.

The server's `managedEnvironmentRetireGraceMs` defaults to five minutes. Cleanup
uses the retiring environment row's lifecycle-owned `retireRequestedAt` value
instead of `updatedAt` or an in-memory timer, so metadata writes cannot extend
the clock and restart does not bypass the window. Grace applies only to a
path-bearing retiring environment with a non-deleted archived thread that could
still be revived. Deleted/tombstoned-only environments are reclaimed without
waiting.

The periodic sweep evaluates retiring managed environments every tick. The
cleanup advance owns the grace decision, keeping the policy in one place.
Orphaned `destroying` recovery remains the slower backstop. Startup honors the
same orphan timeout instead of immediately failing an in-flight daemon command.
Destroy completion is correlated to its attempt id, so a matching late success
can still converge `error` to terminal `destroyed` while a stale attempt cannot.

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
   selects the old branch as the new worktree's base while preserving the
   original environment's merge base as the comparison target.
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

- The ordinary create-thread HTTP/SDK contract accepts an optional managed
  worktree `mergeBaseBranch`; `bb thread spawn --merge-base-branch` exposes the
  same capability for agents. Recovery is still composed from normal creation
  rather than a dedicated route or command.
- The host daemon continues to receive ordinary new-worktree provision commands.
- `HOST_DAEMON_PROTOCOL_VERSION` is unchanged.
- A nullable `retireRequestedAt` column is the durable lifecycle-owned grace
  clock; it is set on `retire.requested` and cleared when retirement ends.
- Destroyed environment rows older than seven days are retained while a
  non-deleted thread still references them, preserving the host/branch handoff
  target. The removed workspace path is cleared on destroy completion. Rows
  become pruneable once their threads are deleted.
- The only new database query answers whether a retiring environment has a
  revivable archived thread; it is a targeted `WHERE` query.
- The app-only handoff navigation seed is a discriminated environment target:
  project default, environment reuse, fresh managed worktree from a host/base
  branch/original merge base, or fresh personal workspace on a host.

## Verification

Tests cover:

- grace-window deferral, cancellation, expiry, restart recovery, and deletion;
- Undo toast behavior;
- destroyed-environment banner priority and handoff affordance;
- handoff seed validation and rich thread mention construction;
- normal new-thread provisioning from the destroyed environment's branch,
  proving committed work is present and compared with the original merge base
  while the source thread/environment remain archived/destroyed.

The integration harness keeps `managedEnvironmentRetireGraceMs: 0` because it
has no periodic sweep or controlled clock; server-level lifecycle tests cover
the grace timing itself.
