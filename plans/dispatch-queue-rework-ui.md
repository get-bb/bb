# Dispatch queue rework — visual prototyping brief

> **STATUS: COMPLETE / HISTORICAL.** The prototyping round-trip is done and
> its output is applied (see `DispatchQueueVisualVariants.stories.tsx` next
> to the component, and the as-shipped section of
> `plans/dispatch-queue-rework.md`). Two items below were superseded during
> implementation: there is NO never-started banner (queue rows + a derived
> delete-thread offer cover it), and the thread-list badge shipped as the
> single clock glyph on canonical `pending` (no micro-signal exploration).
> The timeline queue-state row shipped as described.

Standalone brief for free-form visual exploration. Work from **clean
`origin/main`** in your own worktree — this does NOT build against the
rework branch. Prototype in Storybook (apps/app has existing `*.stories.tsx`
precedent) with mock data; components/stories are the deliverable, handed
back for application to the rework branch. Nothing here needs the backend's
types — every state below is described in prose.

## What you are designing

bb is unifying all "pending work" into the message queue: every message that
cannot dispatch right now parks as a queued row that knows what it is
waiting on. One row family must express all of it, reading as siblings of
today's queued-message rows (`QueuedMessagesList` / `PromptStackCard` are
the existing design language to extend or deliberately evolve — evolving it
is in scope for this exploration).

## The state inventory (design all of these)

**Pending-region rows** (stack above the composer):
- Plain queued (today's look — the baseline).
- Scheduled: absolute time + live countdown ("Scheduled · 9:00 · in 3h").
- Waiting for workspace (environment provisioning).
- Waiting for reply (a pending user interaction blocks it).
- Plugin-held: attribution + reason ("Held by concurrency-limit · 4 of 4
  running"); variant with progress steps + ETA (a sandbox plugin reporting
  "Creating VM… / Enrolling host…"), and a stale variant (no update for N
  min — warning tint).
- Retry: references a failed turn ("Rate limited · retrying at 6:30 ·
  attempt 2"); not editable, no message text of its own.
- Delivery-mode signal: a row that will STEER into a running turn vs one
  that waits its turn — subtle but legible difference.
- Row states: at-rest, hover (actions reveal), editing inline, in-flight
  ("Sending…"), and the failed-dispatch state (error + reason).
- Actions: Send now (hidden/disabled when the wait is physical —
  provisioning/interaction/busy — visible for scheduled + plugin holds),
  Cancel, Edit. Compact/overflow treatment at narrow widths.

**Never-started thread banner** (a thread created but whose first message
is parked): reason + countdown + Send now/Cancel; on cancel, the
"nothing left to run — Delete thread / Keep" offer.

**Thread list**: badge treatment for threads whose work is all parked
(clock glyph today; explore whether scheduled vs held vs waiting deserve
distinct micro-signals or one badge).

**Timeline rows**: the queue-state system row — "parked → (updates) →
dispatched/cancelled" — with a quoted preview of the parked message, the
wait reason, and expandable progress transcript for plugin holds. Collapsed
and expanded states.

## Constraints

- Sanctioned typography tokens; theme colors derived from --canvas/--ink
  (no hardcoded oklch); no CSS @scope; the app must read coherently in
  light/dark and custom palettes.
- Mock data only; no server calls, no new routes, no contract types.
- Free-form beyond that: layout, density, iconography, and how far to push
  the existing queued-row language are all yours to explore.

## Handoff

When the direction is settled, share the story files/components; the rework
branch (`bb/plan-grilling-skill-usage-thr_d5ej4e2gtv`, see
`plans/dispatch-queue-rework.md` for the full model) takes them over and
wires them to real data.
