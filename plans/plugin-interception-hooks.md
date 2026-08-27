# Dispatch gates and holds: plugins that intercept thread creation and follow-ups

Merged plan. Supersedes the earlier draft in this file and
`plans/dispatch-gates.md` from thread `thr_qxp4sch469` (whose mechanics this
adopts where they were stronger; conflicts resolved by explicit decision).

Motivating use cases: concurrency limiting (global / per host / per provider /
by host CPU-RAM), prompt-based auto provider/model selection, cloud-sandbox
provisioning, scheduled sends, and rate-limit retries that re-dispatch the
original turn.

## Settled decisions

| Decision | Choice |
|---|---|
| Primitives | Two general primitives — **gates** (plugin decisions at named dispatch stages) and **holds** (durable deferred dispatches). No special-purpose concurrency/scheduling/telemetry APIs, no ownership APIs |
| Gate stages | `thread.create`, `turn.submit`, `turn.failed` — all one shape: decisions about turns dispatching. Environment provisioning is **not intercepted**: environments exist only as a side effect of thread creation, so a held thread never provisions and admission control is already complete at thread-create |
| Verdicts | `proceed` (with amendments), `hold` (reason, optional `resumeAt`), `reject` (user-visible message). `turn.failed` returns `none | retry(resumeAt)`. **No `fulfill`** and no ownership verdicts — gates are pure decisions |
| Amendment power | Plugins can rewrite everything: provider (create only), model, reasoning level, permission mode (still clamped to the host ceiling), target environment (create/release only), and message content. Per-field provenance (`explicit | client-preference | plugin`) is visible to gates and recorded; a plugin amendment is never remembered as a project default |
| Failure model | **Fail-closed**: a gate that throws or exceeds the 10s decision box fails the operation with the plugin named (`deriveProviderOptions` precedent). Gates must decide in milliseconds; slow work means `hold` and finish in a background service |
| Composition | Deterministic chain in install order (reorderable in settings); amendments accumulate; `reject` short-circuits; holds are collected across a **full pass** (so provider/model resolution is complete before a held thread row is inserted). The operation proceeds only when a pass yields zero holds. Evaluation is serialized under a single async lock so count-based gates never race |
| Hold model | Holds are leases in a durable `dispatch_holds` table with a generic `holder` (`plugin:<id>`, `user`, `core:<mechanism>`). No new canonical thread status — held-before-start is derived display state |
| Release semantics | Release (owner, timer at `resumeAt`, or user) re-runs the gate pipeline — a 9am scheduled send still respects the limiter at 9am — then dispatches normally (queueing if the thread is busy). User "Release now" skips only the gate that produced the hold; other gates run once. Everything re-decidable at release except provider (locked at row insert). Amended environment accepted at release of a never-started thread's first-turn hold |
| Orphaning | A hold whose owner plugin is not running is released as `orphaned` by the sweep — uninstalling a plugin can never strand work. `core:` holds are exempt and not user-releasable |
| Send-path coverage | Gates run at the dispatch choke point: inline sends and the queue drain both pass through. The queue itself is untouched (no hold column, no new states); a held dispatch at drain consumes the queued message and converts it to a hold. Steers into a live turn are exempt |
| Scheduled sends | No gate involved: holds are ordinary data. `--hold-until` / "Send later…" create user-owned holds day one, released by core's timer |
| Provisioning | Stays entirely core, exactly as today — no gate stage, no provisioner registry, no extraction. The one provisioning-shaped power gates have is `amend.environment` at create/release, which is all the sandbox story needs. The registry + worktree-provisioner extraction return only when external demand (a real third-party provisioner, custom env kinds, warm pools) appears |
| Model policy | Default provider/model resolution **stays in core** (`thread-default-policy.ts`); gates amend after defaults resolve. No planned extraction — it is fine if this never becomes a plugin |
| Cloud sandboxes | No new host type, environment kind, or daemon change: a sandbox plugin holds `thread.create`, provisions the VM in its background service, enrolls it as a normal host via the existing join-code SDK, and releases with an amended environment targeting it. Deferred as a reference example, not a v1 deliverable |
| Extraction boundary | Removing a plugin may break a *decision*, never an *invariant*. Policy (retry timing, routing, admission) can be plugins; sequencing mechanisms (transaction pairing, stale-steer, reprovision dispatch) stay core but converge onto the hold substrate with core as holder |
| Built-ins | Ordinary plugins, fully removable; recovery is the clear fail-closed error plus `bb plugin enable` |
| User-facing | One combined pending region (queued + held cards, distinct styles); simple banner, detail on the timeline row; badge-only list treatment; cancel restores to draft; "Dispatch gates" settings panel; mobile views + release/cancel; plugin timeline notes; `pluginInputs` side-channel; plugin "Auto" picker entry. Full CLI/SDK parity |
| Out of core forever | CPU/RAM telemetry (a plugin samples via its own `bb.host` worker); daemon protocol changes (`HOST_DAEMON_PROTOCOL_VERSION` untouched in every phase) |

## Current state (verified in-repo)

- No veto/intercept surface exists. `bb.events.on` is observe-only,
  fire-and-forget, thread-lifecycle only (`packages/plugin-sdk/src/backend-contract.ts:154`).
  Critical-path precedents: `deriveProviderOptions` (throw fails the command,
  `backend-contract.ts:880`), mention `resolve` (blocks the send, 10s box,
  `plugin-service.ts:485`), pending interactions (defer message delivery).
- Create: `POST /threads` → `createThreadFromRequest`
  (`apps/server/src/services/threads/thread-create.ts:569`); defaults via
  `thread-default-policy.ts:171`; row inserted with `providerId NOT NULL`
  (immutable); provisioning advanced via `thread-provisioning.ts` stages.
- Sends: `acceptThreadSendRequest` (`thread-send-request.ts:64`) →
  `sendThreadMessage` (`thread-send.ts:391`); queued messages
  (`queued_thread_messages`, drained on idle, `queued-messages.ts:618`);
  deferred messages during interactions (`deferred_thread_messages`); both
  swept under `durable-intent-retry` (`periodic-sweeps.ts`).
- The hold-in-embryo: `dispatchTurnDuringReprovision`
  (`thread-turn-dispatch.ts:92`) parks a turn while the workspace rebuilds —
  durable but single-purpose, hardwired wake, no user affordance.
- Provisioning: `resolveEnvironmentCreationPlan`
  (`thread-provisioning-environment.ts:873`) branches on
  `WorkspaceProvisionType` (`unmanaged | managed-worktree | personal`,
  `packages/domain/src/environment.ts:13`); planning is server-side, execution
  is the existing `environment.provision` daemon RPC
  (`packages/host-daemon-contract/src/commands.ts:993`).
- Derived display statuses already exist (`thread-runtime-display.ts:180`:
  `host-reconnecting`, `waiting-for-host`) — the pattern for `held`.
- `plugins/provider-retry` fakes retries today: re-reads the event log on
  lifecycle events (~450 lines of reconstruction) and re-dispatches via a
  synthetic "Please continue." message. `plugins/workflows` duplicates a
  smaller retry policy.
- No concurrency limits exist (only serialization lanes and dedupers). No
  host load telemetry reaches the server; a plugin can sample it via its own
  `bb.host` worker + `bb.hosts.experimental_client`.
- Host enrollment join codes exist in the SDK (`packages/sdk/src/areas/hosts.ts:80`)
  — the sandbox story needs nothing new. Providers are already plugins behind
  one registry (amendment validation has one place to check).

## Architecture

### The hold record

New table `dispatch_holds`. A hold is self-contained: releasing it needs
nothing but this row.

| column | meaning |
|---|---|
| `id` | `hold_…` |
| `kind` | `turn` (sole kind; an `environment-provision` kind was cut with the env gate and could return additively) |
| `threadId` | owning thread |
| `payload` | input blocks + frozen execution tuple + `pluginInputs`, or `{ retryOfTurnRequestId }` referencing a failed turn's original request |
| `holder` | `plugin:<id>` \| `user` \| `core:<mechanism>` (`core:reprovision`, `core:host-offline`) |
| `userReleasable` | false when there is nothing to release into yet; Cancel always works |
| `reason` | user-visible, ≤200 chars |
| `resumeAt` | nullable; core's sweep auto-releases when reached |
| `amend` | nullable amendments applied on release |
| `originalRequest` / `effectiveRequest` | audit record for amendments (plugins can rewrite everything; this is how a silent rewriter stays debuggable) |
| `expectedReleaseAt`, `staleAfterMs`, `lastReportAt` | progress/ETA/stall fields |
| `createdAt`, `releasedAt`, `releaseKind` | `owner \| timer \| user \| orphaned \| cancelled` |

Invariants: several live holds per thread are normal (two scheduled
sends). A held `turn` with inline input is editable (a draft
that has not run); a retry reference is not. Re-hold pacing is core's (a
buggy owner cannot hot-loop release→re-hold).

### Where gates run

At the moment a dispatch would actually advance — never at enqueue, where
the answer would be stale:

- **`thread.create`** — inside `createThreadFromRequest`, after defaults
  resolve, before the insert. `proceed` amendments land in the inserted row;
  `reject` is a synchronous 409, nothing persists. On hold (full pass
  complete, so provider/model are final): the thread inserts as `idle` with
  no turn, the first turn becomes a held `turn` dispatch, provisioning parks
  at `metadata-pending` — no worktree, no setup script, no host resources.
  Release schedules provisioning and dispatches through the normal cold-start
  path. Forks, side-chats, and plugin-origin spawns all pass this stage
  (`origin`/`parentThreadId` let policies exempt them); `/threads/fork` is
  wired explicitly. With no gates installed, creation runs byte-for-byte as
  today and no hold row exists.
- **`turn.submit`** — at `sendThreadMessage`, reached by inline sends (reject
  = synchronous 409, draft kept) and by the queue drain (hold consumes the
  queued message into a held dispatch; reject surfaces like any async send
  failure; the rest of the queue keeps draining). Live-turn steers bypass.
- **`turn.failed`** — called from the `run.failed` outcome with structured
  context: the failed `client/turn/requested` payload, `ProviderErrorInfo`,
  latest rate-limit windows, attempt number. `retry` creates a hold
  referencing the failed turn; release re-submits the *original* request —
  no duplicated user message, identical provider context, a retry marker on
  the new attempt. This deletes provider-retry's log-replay wholesale.

Runner rules: install order (reorderable per stage in settings); amendments
accumulate and each gate sees its predecessors'; `reject` short-circuits;
holds collect across the full pass; fail-closed on throw/timeout (10s)
naming the plugin; single async evaluation lock; idempotency across passes is
part of the contract (passes re-run on restart, reload, expiry, release).

### Provisioning is untouched

Environment provisioning, deprovisioning, and their logs all run exactly as
today — planning in core, execution and the `system/thread-provisioning`
transcript from the daemon, archive-triggered cleanup in core. Gates touch
provisioning only indirectly: a hold at `thread.create` parks the thread
*before* provisioning begins (no worktree, no setup script, no host
resources), and `amend.environment` redirects where a thread will run. The
provisioner registry and worktree-provisioner extraction were evaluated and
cut (see Deferred): their only consumer was each other.

### Core-owned holds

Core adopts its own primitive where it defers a dispatch for a user-visible
reason: reprovision-parked turns become `core:reprovision` holds (banner,
timeline row, Cancel; release on workspace-ready re-enters the pipeline, so
the turn still respects a limiter); background releases that hit
`host_unavailable` re-park as `core:host-offline`, released on reconnect
(interactive sends to an offline host keep today's loud failure). Migrating
`deferred_thread_messages` (awaiting-interaction) onto `core:` holds is a
follow-up; the generic `holder` column means no schema change later.

### Amendments, provenance, plugin input

Amendments are validated against the provider registry and the host
permission ceiling; an invalid amendment fails the decision (fail-closed,
plugin named). `plugin` joins `callerExecutionInputSourceValues` so
`shouldRememberProjectExecutionDefaults` never promotes a plugin's choice;
the amending plugin id lands on `client/turn/requested` for the "chosen by
<plugin>" chip. Message-content amendments are recorded via
`originalRequest`/`effectiveRequest`.

`createThreadRequestSchema` / `sendMessageRequestSchema` gain
`pluginInputs?: Record<pluginId, JsonValue>` (≤8KB), delivered only to that
plugin's gates, persisted on holds and queued rows — how a composer control
("Sandbox: large", "Skip routing") reaches a gate without a side channel.

### Feedback: progress and notes

Each hold owns one `system/dispatch-hold` timeline event reusing the
provisioning-transcript entry shape. Owners report via
`bb.experimental_dispatch.report(holdId, { reason?, step?, output?,
expectedReleaseAt?, staleAfterMs? })`; core persists, coalesces output writes,
caps the transcript, broadcasts on the thread change stream (app, mobile,
`bb thread wait` all see it, no plugin bundle). Stall detection is core's: no
report within `staleAfterMs` flips the banner to "No update for N min";
nothing auto-releases. Cancelling a live hold emits `dispatch.cancelled` to
the owner with a 30s teardown grace window.

For one-line annotations outside a hold, `system/plugin-note` events via
`sdk.threads.notes.append` (display-only, rate-limited, never included in
provider context — agent-directed content goes through an attributed
agent-only message instead). This is the plugin timeline-contribution surface.

### Counts are the plugin's bookkeeping

No core counts/load snapshot on gate context. The SDK gains
`threads.count({ status?, hostId?, providerId?, projectId?, parentThreadId?,
groupBy? })` over a real grouped `SELECT count(*)` route (excludes
archived/deleted by default; `threads.list` would load-and-filter *and*
miscount). Serial evaluation means a limiter counts its own `proceed`s as
in-flight until the matching `thread.created` event. Gate docs carry the
deadlock caution: `workflows` parents sit active waiting on hidden children —
limiters must exempt child threads (`parentThreadId`, `originPluginId`) or
give them their own pool; the bundled limiter does.

### "Auto" in the picker

`app.slots.experimental_executionPickerEntry({ id, label, description,
iconName, pluginInput })` renders alongside providers and participates in
`providerOrder` sorting. The picker value union gains
`{ kind: "plugin-entry", pluginId, entryId }`; submission maps it to omitted
`providerId` + `pluginInputs[pluginId]`. Remembered as a client preference
only; if the plugin is disabled the entry disappears and the request resolves
to the project default. CLI: `--provider auto:<pluginId>[:<entryId>]`.
Routing resolves inline in the gate (rules over prompt text + settings);
model-call classification is deliberately deferred (needs a
placeholder-provider state).

## Plugin API surface

All members ship `experimental_`-prefixed with `docs/api_to_audit.md`
entries; `scripts/bump-plugin-sdk.mjs --patch` on every SDK-surface change.

```ts
bb.experimental_dispatch.gate(stage, handler)      // proceed | hold | reject; turn.failed: none | retry
bb.experimental_dispatch.release(holdId, { amend? })
bb.experimental_dispatch.report(holdId, update)
sdk.threads.notes.append(threadId, note)
// events: dispatch.held | dispatch.released | dispatch.cancelled (carry the hold record)
```

Gate context: typed domain values — `thread` (null at create), `project`,
`environment`/`host` (null when unchosen), `input` (prompt text),
`requestedExecution` + `sources`, `origin`/`originPluginId`/
`startedOnBehalfOf`/`parentThreadId`, `pluginInput`, failure details at
`turn.failed`.

Core surfaces usable with no plugin installed:

```bash
bb thread holds [--thread <id>] [--owner <id>]
bb thread release <holdId>
bb thread count [--status active] [--by host|provider|project]
bb thread send <id> --hold-until <iso|duration> [--reason "…"]
bb thread spawn … --hold-until <iso|duration>
bb thread spawn/send … --plugin-input <pluginId>=<json>
```

SDK: `threads.holds.list/get/release/update`, `threads.count`, `holdUntil` +
`pluginInputs` on spawn/send. Routes: `GET /threads/:id/holds`, `GET /holds`,
`POST /holds/:id/release`, `PATCH /holds/:id`. Update the surfaces in
`docs/cli-guide-and-skill.md` and the `bb-plugin-authoring` skill.

## What users see

- **Thread list**: badge only — a clock glyph (warning-tinted when stale);
  the reason lives in the thread view, not the row. Held-before-start sorts
  with idle and counts as not-running in filters.
- **Held creation**: same navigation as any create — the user lands in the
  thread view, which explains itself: a **simple banner** (reason +
  countdown/ETA, Release now, Cancel) and their message as the held
  first-turn card. No toasts, no dialogs.
- **Pending region**: one combined stack above the composer, ordered by
  expected dispatch. Queued messages keep their current look; held
  dispatches get a visibly distinct card labelled by what they wait for
  ("Scheduled · 9:00", "Held by concurrency-limit · 4 of 4 running",
  "Rate limited · retrying 6:30") with Release now (when `userReleasable`),
  Cancel, and inline edit of inline input.
- **Cancel is always safe**: cancelling a held turn restores its inline
  input to the composer as a draft — no confirmation needed. On a
  never-started thread the banner additionally offers "Delete thread"
  (cancelling the only turn leaves an empty shell). Retry-reference holds
  (no inline input) cancel with a timeline note.
- **Detail lives in the timeline, not the banner**: the
  `system/dispatch-hold` row sits where the turn will land and is where
  `dispatch.report` steps/log tails render (exactly like
  `system/thread-provisioning` today) — e.g. a `core:reprovision` hold's
  provisioning progress, or a future sandbox plugin's VM steps. Stall
  detection tints the row and banner. Plugin notes are their own timeline
  rows.
- **Rejections**: inline sends keep the draft and show the plugin's message
  (mention-resolve precedent); drain-time rejects surface like any async
  send failure.
- **Amendments**: the model/provider chip shows "chosen by <plugin>" on
  hover. Queued messages: unchanged.
- **Gate order**: Settings → Plugins gains a "Dispatch gates" panel — each
  stage lists its gates as a drag-sortable list (`providerOrder` pattern)
  with a status dot surfacing last failure/timeout. This doubles as the
  debugging view for the whole pipeline.
- **Mobile (v1)**: view + act — held badge and reason, read-only pending
  cards with Release now and Cancel, plugin notes render. No scheduling
  composer, no held-input editing, no gate reordering. All plain data on
  existing responses; no plugin bundle.

## Use-case coverage

| Case | Mechanism |
|---|---|
| Max running threads (global/host/provider) | `thread.create`/`turn.submit` gate; own tally (`threads.count` + events + in-flight proceeds); hold, release on `thread.idle/failed/archived`; child threads exempt |
| Max by CPU/RAM | Same gate; plugin's own `bb.host` worker samples load, cached, never awaited in the gate |
| Auto provider/model | Picker plugin-entry + `pluginInputs`; rules-based gate amends inline; provenance chip |
| Cloud sandbox (deferred example) | `thread.create` hold → provision VM → join-code enroll → release with amended environment; progress via `report`; teardown on archive/cancel |
| Scheduled sends | No gate: user-owned hold via `--hold-until` / "Send later…"; timer release re-runs the pipeline |
| Rate-limit retries | `turn.failed` gate returns `retry`; hold references the original turn; release re-submits it faithfully |

Shape tests served with zero new core work: budget caps, quiet hours,
approval gates on high permission modes, prompt policy/DLP (reject or amend
permission down), dependency ordering, org-wide pause, generic
transient-error backoff (replacing `workflows`' private retry).

## Phases

Each independently shippable; no phase touches the daemon protocol.

1. **Holds in core.** `dispatch_holds` + data module; `system/dispatch-hold`
   event; `holdUntil` on create/send (owner `user`); held-creation path;
   release service (re-runs pipeline — trivially empty until phase 2);
   timer/stale/orphan sweeps; derived held state on `ThreadResponse`; hold
   routes/SDK/CLI; combined pending region with held-dispatch cards,
   thread-row badge, simple banner, cancel-to-draft (+ delete-thread offer),
   `system/dispatch-hold` timeline rendering;
   mobile view+release/cancel; core adoption (`core:reprovision`,
   `core:host-offline`); small `scheduled-send` plugin ("Send later…"
   plus-menu → `holdUntil`, no gate). Exit: `--hold-until 10m` works
   end-to-end and survives restart; un-held paths byte-for-byte unchanged;
   two scheduled sends coexist; reprovision follow-ups appear as visible
   holds; orphan release on plugin disable.
2. **Gates for `thread.create` + `turn.submit`.** Registry, runner
   (order, lock, 10s box, fail-closed, amendment validation, provenance),
   wired into create/send/drain; `pluginInputs`; `threads.count` + route +
   CLI; picker entry + value arm; "chosen by" chip; reject surfaces;
   reference plugins `concurrency-limit` (with optional CPU/RAM via own host
   worker; child exemption) and `model-router` (Auto entry, rules-based).
   Exit: limit-2 spawn-5 holds 3 with visible reasons and releases one per
   completion; Auto routes inline and is never remembered as a default; a
   throwing gate fails the dispatch naming the plugin within the box.
3. **`turn.failed` + provider-retry rewrite + notes.** Structured failure
   context from `run.failed`; retry holds by reference; faithful re-submit
   with retry marker; `system/plugin-note` + `sdk.threads.notes.append`;
   provider-retry loses `recovery.ts` and the synthetic continue;
   `workflows` drops its private retry. Exit: retried turn has no duplicated
   message and survives restart; provider-retry net line count drops.

Validation per phase: `pnpm exec turbo run test` on `@bb/db`, `@bb/server`,
touched plugins, and `@bb/integration-tests` (output piped to a file);
`turbo run typecheck` and `lint` on touched packages; in-memory SQLite via
`createConnection(":memory:")` + `migrate`, no DB mocks.

## Deferred

- Cloud-sandbox reference plugin (`examples/`) — works on shipped primitives
  (hold + enroll-as-host + release-amend); build when wanted.
- **`environment.provision` gate + provisioner registry + worktree-provisioner
  extraction** (cut from v1): no in-scope consumer — environments exist only
  via thread creation, so the limiter's admission completes at thread-create;
  the sandbox uses hold + enroll-as-host + `amend.environment`; and the
  registry's only consumer was the extraction it existed to justify. Warm
  worktree pools or a real third-party provisioner need would be the first
  genuine consumer and should drive the design then. Both are purely
  additive later (a new gate stage; a new hold kind).
- Model-call (classifier) routing — needs a placeholder-provider state; only
  if rules-based routing proves insufficient.
- Further core wait-path convergence (`core:awaiting-interaction`). (Model
  policy is not on this list — it stays core with no planned extraction.)
- An `environment.destroy` gate (evaluated: no v1 use case needs to
  intercept teardown — the sandbox plugin owns its host and tears down off
  `thread.archived`/`dispatch.cancelled`; warm worktree pools would motivate
  this later, and adding a stage to the cleanup flow is purely additive).
- New provision types / ephemeral host type (core-owned sandbox teardown).
- Released-hold GC (rows kept for v1; timeline preserves history regardless).

## As shipped (implementation deltas)

All three phases are implemented. Deliberate deviations from the text above,
each chosen during implementation and worth knowing when reading the code:

- **No `--reason` flag.** An optional reason would mean "use the default
  label", which the optional-fields rule forbids; every `holdUntil` hold gets
  the fixed reason "Scheduled".
- **Held creation parks nothing in the provisioning machinery.** The
  in-memory provisioning context cannot survive a restart, so the hold row
  itself carries the cold-start context (`original_request`) and release
  re-enters `requestThreadProvision` fresh. `--hold-until` survives restarts
  because of this.
- **`amend.environment` is accepted at create only**, refused at release of a
  cold-start hold (re-resolving an environment intent at release means
  re-running most of create; recorded as an audit item).
- **Multiple holds in one pass produce one row** owned by the first holder,
  with the other holders' reasons appended to the reason string.
- **Release-re-hold pacing**: only a release that re-held starts a 1s
  per-thread window; releases that dispatch are never delayed.
- **`turn.failed` inverts fail-closed** deliberately: it is a post-hoc stage,
  so a throwing/timed-out plugin has its verdict discarded (plugin named) and
  the failure stands — a broken retry plugin cannot make failures
  unrecoverable.
- **Faithful retries** re-issue the original `client/turn/requested` as a
  system-initiated, agent-only continuation — the projection rule that
  already hides system continuations means no duplicate user message;
  `retryOfRequestId`/`retryAttempt` on the new event are the durable attempt
  counter. `resumeAt` is required, so non-resettable limits (credit
  exhaustion) no longer get an untimed manual-release hold.
- **`plugins/workflows` kept its retry ladder**: it re-spawns a hidden child
  thread on transient infrastructure failures — a different mechanism a
  turn.failed gate cannot express. Only provider-retry was rewritten
  (1427 → 733 lines).
- **No native mobile hold surfaces.** The native mobile UI (`apps/mobile/src/screens`)
  was replaced upstream by a WebView shell around the PWA (#2515), so the
  dedicated mobile commit — held badge, read-only hold cards, action-sheet
  cancel confirmation — was dropped when this work rebased onto that change.
  Mobile is served by the responsive app UI, which already ships every hold
  surface; the "Mobile (v1)" row above is satisfied by the app rather than by
  separate native views. The action-sheet cancel confirmation is moot: the app
  has a draft to restore into, so cancel stays confirmation-free everywhere.
- **Plugin notes are in-process only** (`bb.experimental_threads.appendNote`),
  no public route.
- **The plugin-facing `ExperimentalProviderModelPickerValue` deliberately
  excludes the plugin-entry arm** — that value is forwarded verbatim to
  spawn, so every arm must name a real provider; Auto entries render only in
  bb's own composers.
- **model-router clamps reasoning effort** to the chosen model's supported
  ladder, because an unhonourable amendment is a fail-closed dispatch
  failure, not a silent no-op.

## Risks

- **Fail-closed blast radius** (chosen deliberately): one broken gate plugin
  blocks its stage until disabled. Mitigations: plugin named in every error,
  10s box, Release-now, removable built-ins, and the un-held/no-gates path
  never allocating a hold row.
- **Hot-path latency**: gates run on every send; in-process, common verdict
  `proceed`, serialized under one lock — a hung gate delays other dispatches
  up to the box. Acceptable v1; scope the lock per project/host if it bites.
- **Limiter bookkeeping bursts**: serial evaluation + count-own-proceeds is
  documented; a core-computed count on context is a purely additive later fix.
- **Provider staleness on long holds**: provider locks at insert; a hold
  released past a provider outage fails as today's `provider_unavailable`.
