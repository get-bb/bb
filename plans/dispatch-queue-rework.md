# Dispatch queue rework: one parking lot, one checkpoint

Rework of the dispatch-holds prototype (`plans/plugin-interception-hooks.md`,
all three phases shipped on this branch). Replaces four parallel parking
mechanisms — `dispatch_holds`, `deferred_thread_messages`, the
reprovision-parked turn, and the drain-only queue — with ONE: the queue.
Single integrated rework on this branch; no phased landing.

## The model

**A send is always a dispatch attempt.** If nothing blocks it, it dispatches
directly — no queue row ever exists; today's happy path is byte-for-byte
unchanged and allocates nothing. If something blocks it, the message **parks**
as a queued row carrying a typed `waitingOn`, and the drain re-attempts when
conditions change. The queue is the parking lot, not the pipeline.

**Plugins get one checkpoint: the dispatch attempt.** It runs identically
whether the attempt is inline (fresh send) or from the drain (a parked
message becoming eligible). Thread creation itself is ungated — it is a cheap
row; admission happens at the first message's attempt.

**The first message never waits on provisioning.** A cleared first attempt
moves the thread `pending → starting`, and `starting` absorbs environment
finalization + provisioning + session start exactly as today, the message
riding the cold-start command. `waitingOn: provisioning` exists only for
follow-ups/steers sent while a thread is mid-(re)provisioning.

## Worked examples

One entry point, `attemptDispatch(msg, thread)`, called identically inline
and from the drain: (1) core waits checked first (sendAt future, thread-busy
unless steer-mode, provisioning for follow-ups, pending interaction) — each
parks the message with its typed waiting-on; (2) the single plugin gate pass —
`wait(reason)` parks with `plugin(<id>)` attribution, `reject` fails,
`proceed` may amend (provider/environment only on `firstDispatch`); (3) on a
clear, a `pending` thread flips to `starting` (which absorbs provisioning +
session start exactly as today, the message riding along) and a live thread
dispatches per the message's delivery mode. The drain is nothing but
re-calling the attempt when a wait could have cleared (sendAt due, thread
idle, workspace ready, interaction settled, plugin `clearsWait`).

- Scheduled send: parks at step 1 ("Scheduled · 9:00"); the 9am attempt runs
  the full pass fresh.
- Limiter: `wait("4 of 4 running")` at step 2; thread stays `pending` and
  unprovisioned; a freed slot → `clearsWait` → full pass re-runs.
- Sandbox provisioning: `wait("Provisioning sandbox…")`, background VM
  create + host enroll, `clearsWait` with an environment amendment; other
  gates still apply on the re-attempt.
- Steer during provisioning: pure core wait (`provisioning` + steer mode);
  the workspace-ready drain does everything.
- Retry: `turn.failed` (unchanged) parks a by-reference row with
  `time(resetAt)`; the re-attempt runs gates too, so retries respect the
  limiter.

Plugins learn one verdict (`wait`) and one release (`clearWait`); every
feature is a different author of the same parked row. The happy path runs
1→2→3 with nothing blocking and never creates a row.

**Steers are gated too — every dispatch attempt runs the checkpoint,
uniformly.** (This deliberately reverses the earlier live-steer exemption:
steers already park on core waits — interaction, provisioning, scheduled
time — so exempting them from the gate pass alone was a carve-out, not a
rule.) The context carries the attempt kind: `start-turn` (first message,
plain send, steer-mode message finding an idle or pending thread) vs
`join-turn` (injection into a running turn). Verdict powers are identical;
the amendment surface narrows on `join-turn`: execution amendments
(provider/model/reasoning) are invalid — the turn is running — while `input`
amendment stays legal, which enables content-policy/DLP plugins for steers.
A well-behaved limiter proceeds on `join-turn` (the thread already holds its
slot). A plugin that parks a steer owns the staleness of its later delivery.

## Workstream split

Everything in this document — domain/db/server/plugins/SDK/CLI *and*
applying the final UI — happens on this branch. The separate UI thread does
**standalone visual prototyping only**: Storybook exploration from clean
`origin/main` with mock data (`plans/dispatch-queue-rework-ui.md` is its
self-contained brief, including the full state inventory). Its output is
story files/components handed back to this branch for wiring. No shared
contract, no coordination protocol — the backend does not wait for it, and
interim backend UI can stay functional-but-plain until the visuals arrive.

## Settled decisions

| Decision | Choice |
|---|---|
| Carrier | `queued_thread_messages` absorbs everything: scheduled sends, held/limited first messages, plugin deferrals, retry-by-reference rows, `deferred_thread_messages` (awaiting interaction), and the reprovision-parked turn. `dispatch_holds` and `deferred_thread_messages` are deleted |
| Happy path | Direct dispatch, zero queue involvement, byte-for-byte today's behavior |
| Waiting-on | Explicit and typed on each row: `time(sendAt)` \| `thread-busy` \| `provisioning` \| `interaction` \| `plugin(<id>, reason)`. Rendered on the card, shown in `bb thread queue`, updated by the drain as conditions change |
| Delivery mode | Per-message, as today's send modes: a due message either waits for idle or steers the live turn, by its own preference. Steer-during-provisioning = parked row with immediate eligibility + steer mode; the drain firing at workspace-ready is the whole mechanism |
| Scheduling | `sendAt` on queue rows (nullable = eligible now / when turn ends). Scheduled follow-up = parked row with `sendAt`. Scheduled spawn = `pending` thread + parked first message with `sendAt`; nothing provisions until due |
| Thread status | New canonical status **`pending`**: created, no message has ever cleared an attempt. Leaves it the moment the first attempt clears → `starting` (which keeps its current meaning). Archival/deletion legal from `pending`. This deliberately reverses the earlier no-new-status decision |
| Provider/env at create | **Nullable provider is deferred**: rows keep a resolved provider at insert (defaults ladder), amendable at the first cleared attempt (the shipped pre-session amendment machinery relocates there). `environmentId` stays null until provisioning, as it already does |
| Plugin checkpoint | One gate stage — the dispatch attempt — replacing `thread.create` + `turn.submit`. Context carries `firstDispatch` (provider/environment amendments allowed only there), the same provenance/pluginInputs/typed context as today. Verdicts: `proceed` (with amendments) \| `wait` (park with reason — replaces `hold`) \| `reject`. `turn.failed` unchanged; retry verdicts create by-reference queue rows |
| Concurrency limiting | A `wait` verdict at the attempt; the row shows `plugin:concurrency-limit · "4 of 4 running"`. Same tally, release = the plugin marking its wait cleared (drain re-attempts; gates re-run, so a stale release safely re-parks) |
| Send now | **Bypasses every plugin check** (and `sendAt`). `provisioning` and `interaction` waits are not overridable — they guard invariants; `thread-busy` clears via a join-turn steer, so send-now works on ordinary queued rows. Loosens the previous skip-owner-only rule by explicit choice |
| Fail-closed | Unchanged: a gate that throws/times out (10s) fails the attempt naming the plugin; an inline attempt surfaces the error to the sender, a drain attempt marks the row errored-visible. Orphan rule transfers: a `plugin` wait whose plugin is not running is cleared by the sweep |
| Exactly-once | The release/claim CAS semantics transfer to row state transitions (parked → dispatching → consumed); double-drain safe as today's claim tokens already are |

## What this dissolves

- `dispatch_holds` table, hold service/routes, `threads.holds` SDK area,
  `bb thread holds`/`release`/`cancel-hold` (queue surfaces take over:
  `bb thread queue` gains waiting-on/sendAt columns and a send-now/cancel;
  SDK `threads.queue` equivalents).
- `deferred_thread_messages` + its sweeps (rows become `waitingOn: interaction`).
- `core:reprovision`/`core:host-offline` hold mirroring (rows become
  `waitingOn: provisioning` / a host-offline wait kind — decide during build
  whether host-offline is its own typed wait or folds into provisioning).
- The `system/dispatch-hold` event → a queue-state event on the same timeline
  row pattern (parked/updated/dispatched/cancelled, with the message preview
  and reason; report/progress API transfers for long plugin waits).
- The held-card/banner UI split — everything renders as queued rows with
  waiting-on badges (the in-flight card/queue styling unification lands first).
- `thread.create` gate stage; `PluginDispatchCreateAmendments` merges into
  the single attempt context.

## Schema

`queued_thread_messages` gains: `sendAt` (nullable ms), `waitingOn` (typed),
`waitReason` (nullable, ≤200), `waitHolder` (nullable, `plugin:<id>` — for
attribution/orphan sweep), `payloadKind` (`inline` \| `retry` +
`retryOfTurnRequestId`, retry rows not editable), delivery mode (exists),
`pluginInputs` (exists). `pending` joins `threadStatusValues` with legal
transitions (`pending → starting`, `pending → archived/deleted`). Drop
`dispatch_holds`, `deferred_thread_messages`. Branch is unmerged: regenerate
this branch's migrations (0110) into the new shape rather than stacking.

## Deferred / parked (explicitly out of this rework)

- Nullable `provider_id` (the honest state machine's second half).
- Virtual providers as registry citizens (the Auto-in-settings discussion) —
  the single-checkpoint model is compatible either way.
- Auto per-send in the thread composer UI.
- Host CPU/RAM, sandboxes, everything already deferred by the prior plan.

## As shipped (implementation deltas)

All waves are implemented on this branch. Deliberate deltas from the text
above:

- **Send-now and `thread-busy`**: ordinary queued rows ARE `thread-busy`
  waits, and send-now dispatches as a join-turn attempt that legitimately
  clears by steering — so send-now is available there (hiding it would have
  stripped it from every plain queued row). Only `provisioning` and
  `interaction` waits re-park on every attempt and hide the button.
- **Never-started threads render as queue rows, not a banner**: the queued
  message list is status-independent, so a pending thread's parked first
  message is just a row with reason/countdown/Send-now/Cancel; a pending
  thread whose queue empties gets the delete-thread offer, derived from that
  condition rather than tracked as a flag.
- **Scheduled spawns survive restarts via `threads.pending_start_context`**
  (the relocated cold-start record); Wave 2 also added
  `queued_thread_messages.system_notice` so parked parent-system notices
  keep their taxonomy.
- **Host-offline is its own wait kind** carrying the host name ("Waiting
  for <host> to reconnect", send-now hidden): the visual port revealed Wave 2
  never actually parked offline-host attempts — the drain threw and left rows
  on stale waits. Drain failures now record a `failureReason` on the row
  (outside `waitingOn`, so a re-park cannot erase it), rendered as the failed
  state. The reprovision-parked turn
  keeps its deferred-event replay (sequencing invariant); only its tracking
  row moved to the queue.
- **`SendMessageResponse` is now `sent | parked`** — the old four-way enum
  named which parking mechanism, and there is only one.
- **Environment amendments are refused on drain re-attempts** even though
  they report firstDispatch (re-resolving an intent needs creation on the
  stack) — same boundary the hold contract had.
- **Plugin progress/staleness variants are design-ahead-of-contract**: the
  prototype's "Creating sandbox · about 2m" and "no update for 12m" rows need
  a report marker + staleness timestamp the queued-message DTO does not carry
  (deriving from updatedAt would false-alarm non-reporting limiters); all
  plugin waits render "Held by … · reason" until those fields exist.
- **Delivery-mode signal is not renderable yet**: the queued-message
  response carries no deliveryMode field; the visual-prototyping brief's
  row for it is design-ahead-of-contract.
- **Mobile needs no native work**: it is a WebView shell around the PWA;
  the responsive app surfaces are the mobile queue UI.
- **The branch's migrations are squashed** into one
  `0110_wild_warlock.sql` on main's 0109 (preserving the real
  `deferred_thread_messages` drop; `dispatch_holds` nets out and never
  appears). Daemon protocol ended at 174 across the rework's acceptance
  widenings.

- **Auto provider routing was removed afterwards.** The `model-router` plugin,
  the `app.slots.experimental_executionPickerEntry` slot and its
  `{ kind: "plugin-entry" }` picker value arm, the CLI
  `--provider auto:<pluginId>[:<entryId>]` grammar, and `providerId` as a gate
  amendment (with `threadProviderAmendmentRefusal` and the db `setThreadProvider`
  write) are all deleted. The picker is providers-only again and a thread's
  provider is fixed at creation. The generic amendment surface
  (model/reasoningLevel/serviceTier/permissionMode/environment/input) and the
  `pluginInputs` side channel are unaffected — everything above about them
  still holds; only the provider-routing half is gone.

## Build notes

- One integrated wave on this branch; every existing suite green at the end;
  exit criteria transfer from the prior plan (restart survival, exactly-once,
  orphan release, un-parked paths byte-identical, faithful retries).
- The scheduled-send plugin, limiter, and router migrate to the new contract
  in the same wave (their behaviors are unchanged; their verdict/carrier
  vocabulary changes).
- SDK/CLI/guide/skill surfaces updated in the same wave per repo rules;
  plugin SDK bump; api_to_audit rewritten for the single-stage contract.
