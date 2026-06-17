# Thread-lifecycle alignment: fork/seed onto main's new state machine

Align this PR's fork + side-chat thread lifecycle to `origin/main`'s redesigned
status model so the branch merges cleanly. The native-fork *wiring* (provider
`thread/fork`, daemon `fork` field, session clone) is done and stays — see
[`native-session-fork-refactor.md`](./native-session-fork-refactor.md). This plan
covers only the **status lifecycle**: removing `created`/`provisioning`,
`tryTransition`, and `stop_requested_at`, and re-expressing "fork established idle
with an empty timeline" using main's events.

## The decision (read this first)

main's lifecycle has **no `starting → idle` cell** and no create-as-idle path —
the only routes to `idle` are `run.succeeded`/`stop.settled` from `active`/
`stopping`, both driven by a real `turn/completed`. But a native fork is
*established idle with an empty timeline* (no turn runs). So the one genuine
semantic addition this feature needs is a single table cell:

```ts
// packages/domain/src/thread-lifecycle.ts — THREAD_LIFECYCLE.starting
starting: {
  "run.started": "active",
  "run.succeeded": "idle",   // ← ADD: start established the session; the zero-input run completed
  "run.failed": "error",
  "stop.requested": "stopping",
},
```

**Why `run.succeeded` and not a new event (recommended: Option A).** HEAD already
lands the eager fork idle via a *real* daemon `turn/completed` (status
`completed`) for the empty-input establish; main maps `completed → run.succeeded`
(`internal/turn-completed-events.ts`). Reusing it means **zero new events, zero
daemon payload changes**, and it rides main's existing turn-completed path. It is
also race-safe both orderings:

| Settle/turn-completed order | Without the cell | With the cell |
|---|---|---|
| start settles first → `run.started` (active), then `turn/completed` → `run.succeeded` | active → idle ✅ | active → idle ✅ |
| `turn/completed` first → `run.succeeded` while still `starting` | no-op → **stuck `starting`** ❌ | **starting → idle** ✅ |

`run.succeeded` carries no supersession predicate on main
(`THREAD_LIFECYCLE_EVENT_PREDICATES["run.succeeded"] = {}`), so the cell is clean.
For a normal thread, `run.succeeded` can only fire while `starting` if its turn
genuinely completed before the start-settle applied — landing idle is correct
there too, so the cell also closes a latent race.

> **Alternative — Option B (more explicit, not recommended):** add a distinct
> `run.skipped` event with `starting → idle`, and a `turn/completed` payload flag
> so the handler fires `run.skipped` instead of `run.succeeded` for an
> establish-without-turn. Honest naming, but it touches the domain event union
> (every exhaustive switch), the daemon/turn-completed payload, and the
> turn-completed handler. Choose this only if the team wants "no turn ran" named
> distinctly from "a turn succeeded." **This plan implements Option A.**

## Strategy

The work is a **merge of `origin/main` plus a small set of fork-specific ports.**
main's lifecycle redesign already rewrote the shared files; merging *takes main*
for them, which deletes most `created`/`provisioning`/`tryTransition`/
`stopRequestedAt` usage for free. The hand-work is confined to the fork/seed
additions this PR layered on top, plus the one table cell above.

```
take main (shared lifecycle)  +  re-apply fork specifics  +  add 1 table cell
```

Three buckets of change:

1. **Adopt main's status model** — mostly "take main" during merge.
2. **Re-express the fork seed** — port HEAD's two seed paths and the
   `tryTransition`/`stopRequestedAt`/`isPreStartThreadStatus` fork call sites onto
   main's events.
3. **Migration + tests + smoke.**

## Mapping: HEAD construct → main equivalent

| HEAD (this branch) | main / target | Action |
|---|---|---|
| statuses `created`, `provisioning` | gone; born `starting` | take main: `domain/thread-status.ts`, `db/schema.ts:284`, `db/data/threads.ts` |
| `ALLOWED_TRANSITIONS` (db/data/threads.ts:42) | `THREAD_LIFECYCLE` + `applyThreadLifecycleEventRecord` | take main; delete the graph |
| `createThread` default `"created"` (threads.ts:79); `createThreadRecord` `status?: "created"\|"provisioning"` default `"created"` | default `"starting"`; param typed `"starting"` | take main; keep `childOrigin` pass-through |
| `createProvisioningThread` sets `status:"provisioning"` (thread-create.ts:293) | `status:"starting"` | take main; keep fork descriptor + `seedWithoutRun` |
| `thread-transitions.ts` `tryTransition`/`tryTransitionInTransaction` | deleted | delete module; port the **fork-specific** call sites (below) |
| `isPreStartThreadStatus` = `created\|\|provisioning` (server/thread-status.ts) | survives, narrows to `=== "starting"` | take main; callers compile unchanged |
| `thread.stopRequestedAt !== null` checks (lifecycle, turn-completed, provisioning) | column dropped; intent **is** `status === "stopping"` | rewrite every fork-touched `stopRequestedAt` read → `status === "stopping"` |
| provisioning guards `thread.status !== "provisioning"` (thread-provisioning*.ts) | `!== "starting"` | take main; update the fork-eager block by hand |
| `applyTurnCompletedEvent` computes `nextStatus` + `tryTransition` (turn-completed-events.ts) | `lifecycleEventForTurnCompletion` fires `run.succeeded/failed`, `stop.settled` | take main; **the new cell makes the eager-fork idle landing work** |
| seed path **(a)** lazy `tryTransition(provisioning→idle)` (thread-provisioning.ts:184) | no `tryTransition`; fire a lifecycle event to idle | replace with `applyLoggedThreadLifecycleEventInTransaction(run.succeeded)` guarded on `status === "starting"` |
| seed path **(b)** eager `requestThreadStart(fork, empty input)` (thread-provisioning.ts:206) | unchanged dispatch; idle lands via `turn/completed → run.succeeded` + new cell | keep; update the `seedWithoutRun && fork === null` guard wording to `starting` |
| daemon `thread.start.fork` + no-input-no-turn `superRefine` (host-daemon-contract) | **net-new, additive** (main has no `fork` field) | keep as-is; no conflict |
| `child_origin` column + `childOrigin` field | net-new, additive | keep; included in the renumbered migration |

## Files to change

**Take main wholesale (merge resolves; verify after):**
`packages/domain/src/thread-status.ts`, `packages/db/src/schema.ts` (keep
`child_origin`), `packages/db/src/data/threads.ts` (keep `childOrigin` input +
column write), `packages/db/src/data/maintenance.ts`,
`packages/db/src/data/automations.ts`,
`apps/server/src/services/threads/thread-status.ts`,
`apps/server/src/services/threads/thread-create-helpers.ts` (keep `childOrigin`),
`apps/server/src/services/threads/thread-runtime-display.ts`,
`apps/server/src/services/lib/lifecycle-api-errors.ts`, and the `thread-view`
pre-start display branches. Delete
`apps/server/src/services/threads/thread-transitions.ts`.

**Hand-port the lifecycle cell + fork seed:**

- `packages/domain/src/thread-lifecycle.ts` — add the `starting: run.succeeded → idle` cell (the decision above). Update any exhaustive test/`satisfies` over the table.
- `apps/server/src/services/threads/thread-provisioning.ts` — `startThreadIfEnvironmentReady`: rewrite path (a) off `tryTransition(idle)` onto `applyLoggedThreadLifecycleEventInTransaction({type:"run.succeeded"})`; switch all `status !== "provisioning"` guards (lines ~110, 336) to `"starting"`.
- `apps/server/src/services/threads/thread-provisioning-environment.ts` — guards `status !== "provisioning"` → `"starting"`.
- `apps/server/src/services/threads/thread-create.ts` — rebase fork additions (`resolveForkDescriptor`, the 400 unforkable-empty-input guard, `seedWithoutRun`, `childOrigin`) onto main's `createProvisioningThread` (`starting`).
- `apps/server/src/internal/turn-completed-events.ts` — take main's `lifecycleEventForTurnCompletion`; keep fork/side-chat child-notification (`isAgentDelegatedChildThread`); confirm the establish `turn/completed` flows to `run.succeeded`.

**Stop-model rewrite (`stopRequestedAt` → `stopping`):** grep the fork-touched
server files for `stopRequestedAt` and convert each read to `status === "stopping"`
per main. Confirm none of the *fork* code persists `stopRequestedAt` (the column is
gone).

## DB migration

- **Renumber:** regen the child-origin migration after main's `0033–0035` →
  `0036_thread_child_origin.sql` (`ALTER TABLE threads ADD child_origin text;`) via
  `pnpm --filter @bb/db db:generate`. Drop the old `0033_thread_child_origin`.
- **Status normalization:** the status enum is TS-level (the column is `text`),
  so removing `created`/`provisioning` needs a data migration for any persisted
  rows: `UPDATE threads SET status='starting' WHERE status IN ('created','provisioning')`.
  Confirm whether main's startup sweep (`db/data/maintenance.ts`) already covers
  `provisioning`; add the `created` case if not. Normalize the dev/test DB too.
- Run `packages/db/test/migrate.test.ts` green.

## Tests

- Add a `thread-lifecycle.ts` unit test asserting the new cell: `starting`
  + `run.succeeded` → `idle` (and that it stays a no-op for events with no cell).
- Server lifecycle/provisioning tests (in-memory SQLite, never mock our code):
  - native fork → **establishes `idle` with an empty timeline** (no
    `run.started`/no turn), via both race orderings of start-settle vs
    `turn/completed`.
  - lazy seed (`seedWithoutRun && fork === null`) → lands `idle`.
  - side chat (non-empty input) → runs its first turn → `active` → `idle`.
  - a normal thread is unaffected (born `starting` → `active` → `idle`).
- Update/port any PR tests asserting `created`/`provisioning`/`tryTransition`/
  `stopRequestedAt`.

## Phases

1. **Merge `origin/main`** into the branch; resolve conflicts by *taking main* for
   the shared lifecycle files and *keeping* the fork additions (per the mapping).
   Delete `thread-transitions.ts`. Regen the migration.
2. **Add the table cell** + the two fork-seed ports + the `stopRequestedAt →
   stopping` rewrite.
3. **Migration normalization** + `migrate.test.ts`.
4. **Typecheck/build/test** green (below).
5. **Live smoke** on the dev instance.

## Exit criteria

- `pnpm exec turbo run typecheck build` clean for `@bb/domain`, `@bb/db`,
  `@bb/host-daemon-contract`, `@bb/host-daemon`, `@bb/server`, `@bb/app`.
- Lifecycle + provisioning + migrate tests green (output piped to a file, then read).
- `git grep` proves **zero** remaining thread-status uses of `"created"`/
  `"provisioning"`, and zero references to `tryTransition`, `thread-transitions`,
  `ALLOWED_TRANSITIONS`, or thread `stopRequestedAt`.
- Live smoke on the dev app: spawn a **fork** → idle, empty timeline, distinct
  `providerThreadId`; **steer it** → first turn runs → active → idle. Spawn a
  **side chat** → first turn runs immediately. Spawn a **normal thread** →
  unaffected. (`eval "$(scripts/bb-dev-app env)"`; `pnpm bb:dev thread spawn ...`.)

## Open questions to confirm in Phase 0

1. **Establish `turn/completed` source.** Confirm the daemon emits a real
   `turn/completed` (status `completed`) for an empty-input fork establish (the
   logic requires it — otherwise canActivate would flip the thread `active`). If
   instead it's synthesized server-side, fire `run.succeeded` at that synthesis
   point rather than relying on the handler. *(High confidence it's a real daemon
   event; verify in the runtime no-input-no-turn path.)*
2. **main's stop/cleanup field replacements.** main dropped `stop_requested_at`
   and `cleanup_mode`; enumerate every fork-touched read of those fields and the
   exact `stopping`-status (or context) replacement before editing.
3. **Migration sweep coverage.** Whether main's startup maintenance already
   normalizes legacy `provisioning` rows, or the data migration must own both
   `created` and `provisioning`.
