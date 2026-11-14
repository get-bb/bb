<!-- GENERATED FILE — do not edit by hand.
     Source: packages/domain/src/thread-lifecycle.ts and
     packages/domain/src/environment-lifecycle.ts.
     Regenerate: pnpm --filter @bb/domain exec vitest run test/lifecycle-diagram.test.ts -u -->

# Lifecycle state machines

Rendered from `THREAD_LIFECYCLE` and `ENVIRONMENT_LIFECYCLE`.

The thread table is the status projection of the persisted thread run
machine in `apps/server/src/services/threads/lifecycle/machine.ts`. That
machine also owns the turn requests awaiting a daemon answer, a turn
completion held for them, and an owed or acknowledged stop, and it is the
only writer of thread status. User requests, daemon command answers,
daemon events and reports, the turn-start deadline and server restart are
its inputs; each one picks the status moves below. The environment table
is consumed by `applyEnvironmentLifecycleEvent` in `@bb/db`.

How to read these: each edge groups all moves that transition between
the same two statuses. A label is `move ⟨supersession predicates⟩`; the
predicates are checked against the loaded row, and a failing predicate
leaves the status where it is. An **absent** edge means the move is not
available from that status.

## Thread

```mermaid
flowchart LR
    __start((start))
    pending["pending"]
    idle["idle"]
    starting["starting"]
    active["active"]
    stopping["stopping"]
    error["error"]
    __start --> starting
    pending -->|"run.preparing ⟨notArchived, notDeleted⟩"| starting
    idle -->|"run.preparing ⟨notArchived, notDeleted⟩"| starting
    idle -->|"run.started ⟨notArchived, notDeleted⟩"| active
    starting -->|"run.started ⟨notArchived, notDeleted⟩"| active
    starting -->|"run.succeeded"| idle
    starting -->|"run.failed ⟨notDeleted⟩"| error
    starting -->|"stop.requested"| stopping
    active -->|"run.succeeded<br/>stop.settled"| idle
    active -->|"run.failed ⟨notDeleted⟩"| error
    active -->|"stop.requested"| stopping
    stopping -->|"stop.settled<br/>run.succeeded"| idle
    stopping -->|"run.failed ⟨notDeleted⟩"| error
    error -->|"run.preparing ⟨notArchived, notDeleted⟩"| starting
    error -->|"run.started ⟨notArchived, notDeleted⟩"| active
```

## Environment

```mermaid
flowchart LR
    __start((start))
    creating["creating"]
    provisioning["provisioning"]
    ready["ready"]
    error["error"]
    destroyed["destroyed"]
    __start --> creating
    creating -->|"provision.requested"| provisioning
    creating -->|"provision.failed<br/>provision.cancelled"| error
    creating -->|"destroy.recorded"| destroyed
    provisioning -->|"provision.succeeded<br/>provision.cancelled (workspace on disk)"| ready
    provisioning -->|"provision.failed"| error
    provisioning -->|"provision.cancelled (no workspace)"| destroyed
    ready -->|"provision.requested"| provisioning
    ready -->|"destroy.recorded"| destroyed
    error -->|"provision.requested"| provisioning
    error -->|"destroy.recorded"| destroyed
```
