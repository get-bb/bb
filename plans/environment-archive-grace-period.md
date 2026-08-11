# Environment archive grace period

Status: implemented 2026-06-17.

## Outcome

Archiving the last live thread in a managed environment now has a durable
five-minute grace window. The archive toast offers **Undo** for 10 seconds; the
thread's normal **Unarchive** action remains available for the rest of the grace
window. Unarchiving sends the existing `retire.cancelled` lifecycle event and
preserves the intact worktree, including uncommitted work.

Once cleanup has started, a destroyed environment remains terminal and its
thread remains archived and read-only. Uncommitted and untracked work cannot be
recovered after the old worktree has been removed.

There is deliberately no restore route, same-thread environment replacement,
daemon protocol change, or special existing-branch checkout path.

## Lifecycle

The existing environment state machine remains authoritative:

- `ready` → `retire.requested` → `retiring`
- `retiring` → `retire.cancelled` → `ready`
- `retiring` → `destroy.started` → `destroying`
- `destroying` → `destroy.completed` → `destroyed`

`destroyed` remains terminal.

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
   environment...**. Once destruction finishes, the banner shows **Environment
   archived**.
3. Unarchiving the thread remains a record operation, but cannot revive the
   terminal environment or restore its removed worktree.

## Boundaries and data model

- The grace period does not add a new public HTTP, SDK, CLI, or daemon contract.
  It changes the behavior behind the existing archive and unarchive operations.
- The host daemon continues to receive ordinary new-worktree provision commands.
- `HOST_DAEMON_PROTOCOL_VERSION` is unchanged.
- A nullable `retireRequestedAt` column is the durable lifecycle-owned grace
  clock; it is set on `retire.requested` and cleared when retirement ends.
- Destroyed environment rows are pruned after the existing seven-day retention
  period. The removed workspace path is cleared on destroy completion.
- The only new database query answers whether a retiring environment has a
  revivable archived thread; it is a targeted `WHERE` query.

## Verification

Tests cover:

- grace-window deferral, cancellation, expiry, restart recovery, and deletion;
- Undo toast behavior;
- archived-environment banner priority and copy;
- destroyed-environment pruning after the retention period.

The integration harness keeps `managedEnvironmentRetireGraceMs: 0` because it
has no periodic sweep or controlled clock; server-level lifecycle tests cover
the grace timing itself.
