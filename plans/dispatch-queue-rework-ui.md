# Dispatch queue rework — UI workstream

Self-contained brief for the UI thread. The model and all settled decisions
live in `plans/dispatch-queue-rework.md` (read it once); this doc is the UI
scope and the contract you build against. Backend work happens in a parallel
thread on this same branch — the boundary is `packages/server-contract`.

## What is changing under you

Today pending work renders from two sources: queued messages and dispatch
holds (recently unified visually into one row family — that work is landed
and is the starting point). The backend is collapsing the *data* the same
way: `dispatch_holds` and `deferred_thread_messages` disappear; every parked
message becomes a `queued_thread_messages` row carrying a typed `waitingOn`.
Threads gain a canonical `pending` status (created, first message never
dispatched). The happy path (plain send on an idle ready thread) creates no
row at all.

## The contract (provisional until the backend's first commit lands it)

Queue row response gains:
- `sendAt: number | null` — scheduled eligibility time.
- `waitingOn`: `{ kind: "time" } | { kind: "thread-busy" } |
  { kind: "provisioning" } | { kind: "interaction" } |
  { kind: "plugin"; pluginId: string; reason: string }` — always present on a
  parked row, updated by the drain as conditions change.
- `payloadKind: "inline" | "retry"` — retry rows reference a prior turn and
  are not editable.
- Delivery mode (queue vs steer) — already present.
Thread response: `status` union gains `"pending"`.
Actions: send-now (bypasses every plugin wait and `sendAt`; core waits are
not overridable — the button is hidden/disabled for `thread-busy`,
`provisioning`, `interaction` kinds), cancel (restore-to-draft semantics
carry over from held cards), edit inline input (not for retry rows).
Timeline: the `system/dispatch-hold` event is replaced by a queue-state event
(parked / updated / dispatched / cancelled, with message preview and reason)
on the same collapsed-row pattern; old events must still render.

Negotiate contract changes by editing THIS section (both threads watch it),
not unilaterally.

## Surfaces

1. **Pending region** (the unified row family): render `waitingOn` as the
   row's badge/label — "Scheduled · 9:00" (+countdown), "Waiting for
   workspace", "Waiting for reply" (interaction), "Held by
   concurrency-limit · 4 of 4 running" (plugin kind shows attribution), plus
   the existing thread-busy/queued look. Send now / Cancel / Edit per the
   action rules above. Stale tint survives for plugin waits with report data.
2. **Thread list**: `pending` threads get the clock-badge treatment held
   threads have today (badge only, no reason — settled); sorts/filters as
   not-running.
3. **Thread view banner**: a `pending` thread with parked first message keeps
   the simple banner (reason + countdown + Send now/Cancel + delete-thread
   offer on cancel) — this is a re-skin of the existing held banner logic
   onto queue rows.
4. **Timeline**: queue-state rows (reason line, quoted message preview,
   transcript entries for plugin progress reports) — port of the existing
   dispatch-hold row.
5. **Mobile**: mechanical arms + the existing view/act scope (badge, reason,
   send-now/cancel) ported to the new shapes.
6. Composer scheduling UX (scheduled-send plugin) is unchanged — it already
   submits through the composer pipeline; only the resulting row's rendering
   moves.

## Boundaries

- UI thread owns: `apps/app`, `packages/thread-view`, `packages/client-core`
  display logic, `apps/mobile` arms.
- Backend thread owns: `packages/domain`, `packages/db`,
  `packages/server-contract` (UI proposes, backend lands), `apps/server`,
  `plugins/*`, `packages/sdk`, `apps/cli`, `packages/plugin-sdk`.
- Repo rules apply as everywhere: sanctioned tokens, no `@scope`,
  react-compiler lint green, test only logic that can break.
