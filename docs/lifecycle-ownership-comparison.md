# Lifecycle ownership alternative

This branch implements explicit thread lifetime ownership with normal environment
retention. It does not implement `retainsEnvironment`.

## Review coordinates and dependencies

- Branch: `bb/implement-lifecycle-thread-ownership-alternative-thr_dpzkbp4itd`.
- Worktree: `/Users/michael/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_dpzkbp4itd-1/bb`.
- Base: `6084f89430` (the isolated checkout's origin/main base).
- Parent coordination: `thr_wfh9hyeszi`.
- Workflow dependency: upstream `0f024ffb74762760c12308bd023a1279ae45253c`, cherry-picked as `7c0319edc8`.
- Side-chat dependency: upstream `a439b736826a9b2042a3cbff09dcfe072eecb534`, cherry-picked as `c11eec8a5b`.

The workflow dependency retains durable all-attempt tracking, terminal/replaced
worker archival, notification abandonment and retry/recovery. Core ownership does
not replace those policies while an origin remains live. The side-chat dependency
contributes asynchronous source revalidation and archived-runtime reconnect
recovery. Its inferred hidden-source archive-on-delete policy is deliberately
replaced: explicit lifecycle dependents are deleted, including retained history.
The new regression suite replaces tests asserting the superseded archive behavior.

## Behavior and public surfaces

`lifecycleOwnerThreadId` is a nullable persisted thread relationship, independent
of `parentThreadId`, `sourceThreadId`, visibility, and plugin attribution. It is
optional on spawn/fork requests and required nullable in thread responses. CLI
spawn/fork accept `--lifecycle-owner-thread <id>`; SDK callers pass
`lifecycleOwnerThreadId`. Omission means independent. There is no ownership update
API: existing relationships cannot be reassigned or detached.

Owners must exist and be unarchived and undeleted when the dependent is inserted.
Projects, environments and hosts may differ. Existing server access boundaries
still apply; no new project restriction or authorization bypass is introduced.
Only creation to an existing owner is allowed, so cycles and self-ownership cannot
be admitted. The insertion transaction validates live state, and database triggers
reject invalid insertion or later ownership mutation. Server validation produces
an API error after asynchronous setup if the owner has become unavailable.

| Action                     | Result                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Archive owner              | Recursively archive dependents and stop execution. Retain history under existing archive retention.                     |
| Delete owner               | Recursively mark dependents deleted, stop execution and remove storage, then physically remove rows from leaves upward. |
| Unarchive owner            | Restore only the owner. Archived/completed workers stay archived.                                                       |
| Unarchive dependent        | Require its immediate owner to be live first; no automatic upward restoration.                                          |
| Archive/delete dependent   | Apply downward only; never archive/delete its owner.                                                                    |
| Delete owner's project     | Include dependents in other projects and clean up on their own hosts/environments.                                      |
| Delete dependent's project | Delete that project's threads and their dependents; preserve external owners and other unrelated projects.              |
| Explicit user Stop         | Existing turn/runtime policy; no ownership cascade added.                                                               |

Side-chat forks explicitly use their source as owner. Every workflow worker spawn,
including replacement attempts, uses its run origin. Ordinary visible forks and
sidebar children retain their existing behavior unless ownership is assigned.
Environment-wide archival also applies ownership effects across environment/host
boundaries. Existing refusal to archive a pointerless starting/stopping root is
preserved, before any mutation; such a dependent cannot prevent its valid owner's
archive cascade.

## Durability and migration

Migration 0121 adds an indexed self-reference with `ON DELETE RESTRICT`; the
Drizzle snapshot and journal were generated with Turbo. It does not use `SET NULL`
or physical cascading deletion. Recursive CTE updates record archive/delete intent
before cleanup side effects. Physical deletion refuses an owner with remaining
dependents. The ownership link remains on each dependent until its own row is
removed after confirmed storage cleanup.

The existing `thread.storage.delete` daemon command stops the runtime before
removing storage. Failures leave tombstones intact. Periodic lifecycle sweeps and
daemon reconnect reconciliation retry from database state, without requiring the
original HTTP request or an in-memory ownership registry. Terminal closure is
retried too. A failed asynchronous thread creation now uses durable deletion rather
than removing its row directly. An unavailable dependent host can delay physical
owner/project deletion; durable logical deletion is already visible to clients.
No daemon payload changed, so no protocol version bump is required.

Backfill is intentionally narrower than new admission: only explicitly attributed
hidden side-chat forks and structured workflow worker metadata are eligible. The
historical owner must exist in the same project and have a strictly earlier
creation timestamp. This extra historical filter is evidence conservatism, not a
cross-project ownership policy. Existing archived/deleted owner state is propagated.
Equal timestamps, missing owners, unattributed hidden forks, title matches and
older workers without structured metadata remain unowned. The plugin's separate
`workflow_workers` database is not joined by a core migration. Original
`client/turn/requested` prompts can support a separately reviewed historical
investigation; no automatic prompt parsing or production recovery runs here.

## Comparison with retainsEnvironment

| Case                                                                       | Ownership with normal retention                                                            | Separate retention flag                                                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Owned side chat/worker outlives archived/deleted origin                    | Reliable cascading releases it, while deletion also removes dependent history.             | A borrower need not retain its workspace, but the flag alone does not express dependent deletion.                         |
| Terminal/replaced worker while origin stays live                           | Workflow plugin must promptly archive it; durable all-attempt cleanup remains necessary.   | Borrower retention can avoid keeping the workspace, but terminal worker/history policy still needs cleanup.               |
| Hidden independent background thread                                       | Continues normal retention until its own lifecycle ends.                                   | Can explicitly choose retention independently of visibility.                                                              |
| Old orphan with no trustworthy ownership evidence                          | Remains independent; no safe owner can be inferred.                                        | A separate conservative retention migration may change lifetime responsibility, without recovering the lost relationship. |
| Dependent in another environment/project                                   | Retains its environment while live, then follows its owner's archive/delete.               | Can express a live borrower that does not retain its own environment.                                                     |
| Owner remains live but user wants workspace retired underneath a dependent | Ownership alone does not express this.                                                     | Explicit non-retention plus safe execution drain addresses this distinct policy.                                          |
| Stop/cleanup failure or disconnected daemon                                | Retry and retain durable cleanup state; existing runtime/environment safety still applies. | Non-retention still requires reliable execution drain before teardown.                                                    |

Ownership solves the known owned-worker leak without changing the meaning of
ordinary thread retention. It does not make all hidden threads non-retaining,
repair ambiguous historical orphans, or replace provider retirement grace/drain
policies. The two models can coexist, but their fields answer different questions.
Integrating both would require regenerating the next migration/snapshot, combining
spawn/fork DTO and CLI changes, and selecting retention defaults for owned workers.
Do not transplant this branch's numbered migration over another branch's 0121.

## Verification and limits

All builds, typechecks and tests used Turbo. Successful checks:

- Typechecks: app, server, host daemon, CLI, DB, domain, contracts, SDK, Plugin SDK,
  Plugin API map, side-chat and workflows (17 tasks including generated dependencies).
- Server: 155 tests covering lifecycle policy, ownership/project deletion,
  asynchronous fork races, late start handoff, creation, pruned environments,
  environment/machine orchestration. A subsequent focused fork run adds explicit
  owned/unowned response coverage (28 fork tests; 156 distinct server cases total).
- DB: 79 lifecycle/migration tests, including restrictive FK deletion, immutable
  ownership, cross-project cascading, unarchive ordering and conservative backfill.
- CLI: 48 spawn/fork tests. Side-chat: 25 tests. Workflows: 233 tests, including
  retry/recovery/all-attempt cleanup; worker spawn assertions require the origin owner.
- Fresh isolated `pnpm dev` server and connected daemon, with the built source CLI:
  cross-project nested spawn, recursive archive, rejected dependent-first unarchive,
  non-cascading owner unarchive, independent dependent deletion preserving owner.
- Actual SDK against that server: cross-project spawn responses and owner-project
  deletion removed nested dependents while preserving the dependent project.

Live verification used scheduled prompts and did not start paid provider turns.
Active-runtime/storage failure and cross-host reconnect cases were exercised through
the isolated migrated server harness with controlled daemon RPC responses. A real
multi-machine disconnect/crash, provider turn, browser UI or iOS test was not run.
No new UI controls were added. The existing verification inventory preflight reports
unrelated baseline drift (`Unmapped CLI family: browser`); affected lifecycle and
side-chat recipes were updated without accepting an unrelated inventory baseline.

Evidence: `/tmp/bb-lifecycle-ownership-W3FF5e/` (CLI/SDK results, preflight, listener
ownership and cleanup). The dev instance was stopped, all three ports verified
unused, and only its marked data directory and synthetic workspaces removed.
Production records were not migrated or cleaned. No push, merge or deployment.

## Changed areas

- DB schema/generated migration, data-layer cascade/FK safeguards, migration rewind
  fixtures and lifecycle regression tests.
- Domain/request/response contracts and fixture defaults; SDK inherits existing
  spawn/fork argument types. No new `BbPluginApi` property, app export or slot method
  was added, so there is no new unprefixed public API member; the argument-field
  audit is recorded in `docs/api_to_audit.md`.
- Thread creation/fork/archive/delete/unarchive, project deletion, periodic recovery,
  CLI spawn/fork flags and forwarding tests.
- Side-chat creation, workflow worker spawning, their tests and integrated durable
  workflow cleanup dependency.
- Plugin Guide SDK card, CLI guide/skill, system overview and verification recipes.

The parent handoff includes the exact implementation commit and full changed-file
list for review.
