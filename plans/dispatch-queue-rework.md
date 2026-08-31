# Dispatch queue rework: one queue, one checkpoint

Rework of the dispatch-holds prototype (`plans/plugin-interception-hooks.md`,
all three phases shipped on this branch). Replaces four parallel queueing
mechanisms — `dispatch_holds`, `deferred_thread_messages`, the
reprovision-queued turn, and the drain-only queue — with ONE: the queue.
Single integrated rework on this branch; no phased landing.

## The model

**A send is always a dispatch attempt.** If nothing blocks it, it dispatches
directly — no queue row ever exists; today's happy path is byte-for-byte
unchanged and allocates nothing. If something blocks it, the message **queues**
as a queued row carrying a typed `waitingOn`, and the drain re-attempts when
conditions change. The queue is where blocked messages wait — not a stage every
message passes through.

**Plugins get one checkpoint: the dispatch attempt.** It runs identically
whether the attempt is inline (fresh send) or from the drain (a queued
message becoming eligible). Thread creation itself is unhooked — it is a cheap
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
queues the message with its typed waiting-on; (2) the single `message.dispatch`
hook pass — `wait(reason)` queues with `plugin(<id>)` attribution, `reject` fails,
`proceed` may amend (provider/environment only on `firstDispatch`); (3) on a
clear, a `pending` thread flips to `starting` (which absorbs provisioning +
session start exactly as today, the message riding along) and a live thread
dispatches per the message's delivery mode. The drain is nothing but
re-calling the attempt when a wait could have cleared (sendAt due, thread
idle, workspace ready, interaction settled, plugin `clearsWait`).

- Scheduled send: queues at step 1 ("Scheduled · 9:00"); the 9am attempt runs
  the full pass fresh.
- Limiter: `wait("4 of 4 running")` at step 2; thread stays `pending` and
  unprovisioned; a freed slot → `clearsWait` → full pass re-runs.
- Sandbox provisioning: `wait("Provisioning sandbox…")`, background VM
  create + host enroll, `clearsWait` with an environment amendment; other
  hook handlers still apply on the re-attempt.
- Steer during provisioning: pure core wait (`provisioning` + steer mode);
  the workspace-ready drain does everything.
- Retry: the `turn.failed` event, and a listener calling
  `sdk.threads.retry({ sendAt })`, which queues a by-reference row with
  `time(sendAt)`; the re-attempt runs the hook too, so retries respect the
  limiter.

Plugins learn one verdict (`wait`) and one release (`clearWait`); every
feature is a different author of the same queued row. The happy path runs
1→2→3 with nothing blocking and never creates a row.

**Steers are hooked too — every dispatch attempt runs the checkpoint,
uniformly.** (This deliberately reverses the earlier live-steer exemption:
steers already queue on core waits — interaction, provisioning, scheduled
time — so exempting them from the hook pass alone was a carve-out, not a
rule.) The context carries the attempt kind: `start-turn` (first message,
plain send, steer-mode message finding an idle or pending thread) vs
`join-turn` (injection into a running turn). Verdict powers are identical;
the amendment surface narrows on `join-turn`: execution amendments
(provider/model/reasoning) are invalid — the turn is running — while `input`
amendment stays legal, which enables content-policy/DLP plugins for steers.
A well-behaved limiter proceeds on `join-turn` (the thread already holds its
slot). A plugin that queues a steer owns the staleness of its later delivery.

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
| Carrier | `queued_thread_messages` absorbs everything: scheduled sends, held/limited first messages, plugin deferrals, retry-by-reference rows, `deferred_thread_messages` (awaiting interaction), and the reprovision-queued turn. `dispatch_holds` and `deferred_thread_messages` are deleted |
| Happy path | Direct dispatch, zero queue involvement, byte-for-byte today's behavior |
| Waiting-on | Explicit and typed on each row: `time(sendAt)` \| `thread-busy` \| `provisioning` \| `interaction` \| `plugin(<id>, reason)`. Rendered on the card, shown in `bb thread queue`, updated by the drain as conditions change |
| Delivery mode | Per-message, as today's send modes: a due message either waits for idle or steers the live turn, by its own preference. Steer-during-provisioning = queued row with immediate eligibility + steer mode; the drain firing at workspace-ready is the whole mechanism |
| Scheduling | `sendAt` on queue rows (nullable = eligible now / when turn ends). Scheduled follow-up = queued row with `sendAt`. Scheduled spawn = `pending` thread + queued first message with `sendAt`; nothing provisions until due |
| Thread status | New canonical status **`pending`**: created, no message has ever cleared an attempt. Leaves it the moment the first attempt clears → `starting` (which keeps its current meaning). Archival/deletion legal from `pending`. This deliberately reverses the earlier no-new-status decision |
| Provider/env at create | **Nullable provider is deferred**: rows keep a resolved provider at insert (defaults ladder), amendable at the first cleared attempt (the shipped pre-session amendment machinery relocates there). `environmentId` stays null until provisioning, as it already does |
| Plugin checkpoint | One hook — `message.dispatch`, the dispatch attempt — replacing `thread.create` + `turn.submit`. Context carries `firstDispatch` (provider/environment amendments allowed only there), the same provenance/pluginInputs/typed context as today. Verdicts: `proceed` (with amendments) \| `wait` (queue with reason — replaces `hold`) \| `reject`. Turn failure stays a separate concern; a retry creates a by-reference queue row |
| Concurrency limiting | A `wait` verdict at the attempt; the row shows `plugin:concurrency-limit · "4 of 4 running"`. Same tally, release = the plugin marking its wait cleared (drain re-attempts; the hook re-runs, so a stale release safely re-queues) |
| Send now | **Bypasses every plugin check** (and `sendAt`). `provisioning` and `interaction` waits are not overridable — they guard invariants; `thread-busy` clears via a join-turn steer, so send-now works on ordinary queued rows. Loosens the previous skip-owner-only rule by explicit choice |
| Fail-closed | Unchanged: a hook handler that throws/times out (10s) fails the attempt naming the plugin; an inline attempt surfaces the error to the sender, a drain attempt marks the row errored-visible. Orphan rule transfers: a `plugin` wait whose plugin is not running is cleared by the sweep |
| Exactly-once | The release/claim CAS semantics transfer to row state transitions (queued → dispatching → consumed); double-drain safe as today's claim tokens already are |

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
  row pattern (`parked`/`updated`/`dispatched`/`cancelled`, with the message preview
  and reason; report/progress API transfers for long plugin waits).
- The held-card/banner UI split — everything renders as queued rows with
  waiting-on badges (the in-flight card/queue styling unification lands first).
- The `thread.create` checkpoint; `PluginDispatchCreateAmendments` merges into
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

## Deferred / queued (explicitly out of this rework)

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
  `interaction` waits re-queue on every attempt and hide the button.
- **Never-started threads render as queue rows, not a banner**: the queued
  message list is status-independent, so a pending thread's queued first
  message is just a row with reason/countdown/Send-now/Delete. A pending
  thread whose queue empties is left alone — no delete-thread offer, no empty
  shell banner. It sits there like any other thread and the user archives or
  deletes it through the normal affordances.
- **Cancel is exactly delete, as on main**: removing a queued row deletes it
  and nothing else. The text is not restored into the composer draft, and
  there is no undo — up-arrow prompt-history recall is the way back to it.
  This rework's only queue-behavior delta is the typed waits.
- **Scheduled spawns survive restarts via `threads.pending_start_context`**
  (the relocated cold-start record); Wave 2 also added
  `queued_thread_messages.system_notice` so queued parent-system notices
  keep their taxonomy.
- **Host-offline is its own wait kind** carrying the host name ("Waiting
  for <host> to reconnect", send-now hidden): the visual port revealed Wave 2
  never actually queued offline-host attempts — the drain threw and left rows
  on stale waits. Drain failures now record a `failureReason` on the row
  (outside `waitingOn`, so a re-queue cannot erase it), rendered as the failed
  state. The reprovision-queued turn
  keeps its deferred-event replay (sequencing invariant); only its tracking
  row moved to the queue.
- **`SendMessageResponse` is now `sent | queued`** — the old four-way enum
  named which queueing mechanism, and there is only one.
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
  appears). Daemon protocol ends at a single bump to 175 — see "The three
  legacy decode-only event types are purged" below for why the branch's
  stacked intermediate bumps were flattened away.

- **Auto provider routing was removed afterwards.** The `model-router` plugin,
  the `app.slots.experimental_executionPickerEntry` slot and its
  `{ kind: "plugin-entry" }` picker value arm, the CLI
  `--provider auto:<pluginId>[:<entryId>]` grammar, and `providerId` as a hook
  amendment (with `threadProviderAmendmentRefusal` and the db `setThreadProvider`
  write) are all deleted. The picker is providers-only again and a thread's
  provider is fixed at creation. The generic amendment surface
  (model/reasoningLevel/serviceTier/permissionMode/environment/input) and the
  `pluginInputs` side channel are unaffected — everything above about them
  still holds; only the provider-routing half is gone.

- **Concurrency limiting became a fact lookup, not plugin bookkeeping.** The
  settled-decisions row above ("Same tally, release = the plugin marking its
  wait cleared") is retired. Three changes replaced it:

  - **`sdk.threads.listRunning()`** (`GET /threads/running`, no query) returns
    the threads occupying capacity — canonical status `starting` or `active`,
    archived/deleted excluded, hidden *included* because a hidden thread burns
    a real slot — as rows of `{ id, hostId }`. `threads.count` answers one pool
    per request and cannot reconcile a global limit with a per-host one from
    separate counts; the rows answer both from one read. The row shipped as
    `{ id, hostId, projectId, parentThreadId, originPluginId }` and was slimmed
    when the exemption below was removed: those three fields had exactly one
    consumer, the exemption filter, and no surface outlives its only consumer.
    Ids are the composition primitive — a caller that needs more than "which
    ids, on which hosts" fetches the threads it named.
  - **Flip-before-unlock.** A cleared first dispatch now commits its
    `pending → starting` transition INSIDE the hook evaluation lock
    (`MessageDispatchHookPassRequest.commitAdmission`), so attempt N+1 reads a
    database that already contains attempt N's admission. That is what makes
    `listRunning` **exact inside a `message.dispatch` hook and a snapshot
    everywhere else**, and it is what killed the in-flight-`proceed` tally. Honest
    boundary: a warm follow-up's `idle → active` flip lives in the send
    transaction (it needs a prepared host command) and lands just after the
    lock, so bursts of follow-ups to distinct idle threads can momentarily
    under-report. First-dispatch exactness is the one the five-quick-creates
    race needs; both orderings are pinned by tests.
  - **Idle-drain extension.** When a thread leaves the occupying set (idle,
    error, archived, deleted) core re-attempts EVERY plugin-queued row in queue
    order, globally — a limit can be expressed over any grouping and core does
    not know which one. Rows still blocked re-queue, and the existing
    `DISPATCH_REQUEUE_MIN_INTERVAL_MS` pacing bounds the churn. Plugins no
    longer release their own waits when capacity frees; `clearWait` is now for
    "my own condition resolved" only. The orphan sweep is unchanged. (The
    *trigger* for this walk later moved back to the plugin — see
    "`recheck`" below. The walk itself is exactly as described here.)

  The limiter plugin collapsed to settings-parse + `listRunning` + compare:
  `tally.ts`, `scope.ts`, `parked-rows.ts`, their tests, the
  `thread.*`/`queue.*` subscriptions, the `clearWait` call and the reconciler
  background service are all deleted. Reason strings, the `needsConfiguration`
  posture and the join-turn proceed rule are unchanged.

- **Limits are uniform; the child/plugin-spawned exemption is gone.** The
  limiter briefly did not count threads with a `parentThreadId` or an
  `originPluginId`, and let their own dispatches through a full pool. Removed
  in both directions: every running thread counts, every `start-turn` dispatch
  runs the hook. The join-turn (and already-`starting`/`active`) proceed rule stays,
  because a thread that already holds its slot is not asking for a new one —
  that is correctness, not exemption.

  The honest cost, now written into the plugin's description, both settings
  descriptions and the authoring skill rather than engineered around: under a
  tight limit, an orchestration pattern where a running parent waits on threads
  it spawned (the `workflows` plugin) can wedge — the parent holds a slot while
  the children it awaits sit queued behind the same limit — until other slots
  free or the user sends a child now from its queue. The exemption bought that
  pattern liveness by silently overrunning the number the user set, on every
  host, for as long as the pattern ran; a limit that means what it says is
  worth the wedge.

## Build notes

- One integrated wave on this branch; every existing suite green at the end;
  exit criteria transfer from the prior plan (restart survival, exactly-once,
  orphan release, no-wait paths byte-identical, faithful retries).
- The scheduled-send plugin, limiter, and router migrate to the new contract
  in the same wave (their behaviors are unchanged; their verdict/carrier
  vocabulary changes).
- SDK/CLI/guide/skill surfaces updated in the same wave per repo rules;
  plugin SDK bump; api_to_audit rewritten for the single-hook contract.

- **The plugin checkpoint was cut back to a pure decision.** Consumer-less
  surface built during the rework and never used by any shipped plugin is
  gone; the designs stay recoverable from git history.

  - **Amendments.** `PluginDispatchAmendments`, the `proceed { amend }` arm and
    everything behind it — the `.strict()` amendment schema, the start-turn /
    join-turn narrowing, the `firstDispatch` + `environmentAmendable`
    environment window, the permission-mode clamp, `DispatchAmendmentResult`
    with its `amendedBy`/`originalInput` audit trail, the `amendedByPluginId` /
    `originalInput` turn-event fields, the `turnRequest.amendment` projection
    and the "Chosen by <plugin>" chip. A `message.dispatch` hook now answers
    `proceed | wait | reject` and cannot rewrite the dispatch it is deciding
    about. Because nothing a handler returns changes what the next handler
    sees, one context is built per pass instead of one per handler. `"plugin"`
    left `callerExecutionInputSourceValues` (the amendment-application path was
    its only writer), and `shouldRememberProjectExecutionDefaults` lost the
    `pluginAmended` guard that was already always false.
  - **`firstDispatch` left the plugin context too.** Its only stated purpose
    was the environment-amendment window; with that gone, nothing read it —
    only two plugin test fixtures set it because the type demanded it. Core
    keeps the same fact as a local in `attemptDispatch`.
  - **`clearWait` and `report()`.** `queue-wait-owner.ts`, both contract
    members, their runtime/server wiring, the fake-host seams, the
    `QueuedMessageReport*` domain schemas and `reportQueuedMessageProgress`
    are deleted. `report()` was the only writer of the queue-state event's
    `entries` transcript, so the field, its projection, its merge and its
    expandable rendering went with it — a queued row's body is now its
    schedule and the queued message, and `detail` is always null. A wait
    clears only via `sendAt`, the requested drain (then core's freed-capacity
    signal, now `recheck` — see the last entry in this document),
    Send-now and the orphan sweep; the authoring skill says exactly that.
  - **`pluginInputs`.** The side channel is gone end to end: the domain
    schema and 8KB cap, the create/send/queued-message request fields, the
    `plugin_inputs` column, `ctx.pluginInput`, `--plugin-input`,
    `useComposer().experimental_setPluginInput` and its composer store, the
    guide/skill passages and the api_to_audit entry.
  - **The dispatch-hook settings panel** and its plugin-order app setting are
    deleted, along with the plugin-list response's list of which dispatch
    hooks a plugin answers (the panel was its only consumer) and the SDK's
    `.default([])` tolerance for it. Hook order is plugin install order, full stop; the
    deterministic chain and the multi-waiter first-owns rule are unchanged.
    The retired settings key is simply ignored on read — `getAppSettings`
    selects only live keys — so no migration is needed.

  Stored-data tolerance: every thread-event payload schema is a plain
  non-strict `z.object`, so removing `amendedByPluginId`, `originalInput` and
  `entries` strips them from stored events rather than failing the decode.
  Nothing was kept for decode's sake, and this step narrowed no daemon-protocol
  acceptance on its own — the daemon contract never references these event
  schemas, and a non-strict object accepts strictly more after a field leaves
  it. (The later purge of the three legacy event types *does* narrow
  `threadEventSchema`; that is what the branch's single bump to 175 records.) The branch's
  migration was re-squashed onto main's 0109 as a single
  `0110_white_hulk.sql` with no `plugin_inputs` column.

- **Queueing is narrated once, and not on the timeline.** The
  `system/queue-state` event is no longer emitted: the queue rows above the
  composer read the queued row's own live columns, so a second copy in the
  transcript could only ever go stale (a re-queue, an edit or a Send-now rewrote
  the row and left the timeline saying something else). Emission, the
  `queuedMessageInputPreview` extraction it was the only consumer of, the
  thread-view projection/merge/title arms, the `queue-state` timeline row shape
  in `@bb/server-contract`, the renderer body and its auto-expand rule are all
  deleted. The event type itself was subsequently purged too — see "The three
  legacy decode-only event types are purged" below.

- **The sidebar clock is queue-driven, not status-driven.** The waiting glyph
  stopped keying on canonical `pending` — which described only the narrowest
  case, a thread whose FIRST message queued — and keys on a new thread-list
  fact, `queuedWork: "none" | "waiting" | "failed"`, so an idle thread holding a
  scheduled send or a plugin-queued follow-up says so too. It is one grouped
  count over live queued rows per list build (batched over the SQLite variable
  limit, alongside the existing count the single-thread DTO already used), with
  `failed` set when any live row carries a `failureReason`. The not-running
  half is the renderer's: the arm sits below every working arm in
  `resolveThreadListIndicator`, so a running thread with a queued follow-up
  still shows what it is doing. `failed` shares the canonical-`error` glyph arm
  outright (`CircleX` + `text-destructive`) rather than growing a warning
  variant — one error vocabulary, differing only in label. `pending` keeps its
  sorting, filtering and status copy and drives no glyph at all. `queue-changed`
  now dirties the thread lists on web and mobile, which it did not before.

- **Provider retry never intercepts a send, so a stock install answers no
  hooks.** The plugin briefly also answered `message.dispatch`: once one thread
  proved an account exhausted it queued every other dispatch into that account
  until the window it remembered had passed, saving them each a failure. That is
  deleted, along with the in-memory blocked-scope map and every structure
  feeding it. A rate-limit record is a stale cache of provider state; a user who
  fixed the limit out of band — raised the plan, had the window reset early,
  swapped the credentials behind the provider — would be refused without an
  attempt, on a plugin's memory of a failure that no longer applied, with no way
  to tell whose refusal it was. **The only authoritative check is trying.** The
  accepted cost is stated rather than engineered around: N threads on one
  exhausted account each fail once instead of the first failing and the rest
  queueing; the reset jitter, now the only thing spreading retries out, keeps
  them from waking together. The plugin is exactly one `turn.failed` listener
  that decides — buffer, jitter, maximum wait, attempt cap — and then asks for
  the attempt with `sdk.threads.retry`, plus its queue-reading RPC/CLI.

  That deletion has a structural consequence worth naming: **`message.dispatch`
  is now an unanswered hook on a fresh install.** `concurrency-limit` is the only
  bundled plugin that answers it and it ships `defaultEnabled: false`, and a
  disabled plugin never loads, so `listHooks("message.dispatch")` is empty. The
  `hasMessageDispatchHooks` guard's promise — "with no handlers the dispatch path
  is byte-for-byte what it was before hooks existed" — therefore describes the
  default machine rather than a hypothetical one: a user pays for the evaluation
  lock and context assembly only by asking for admission control. Both halves
  are pinned in `builtin-plugins.test.ts`.

- **`bb.experimental_threads.appendNote` is deleted; `system/plugin-note` is
  decode-only.** Retry narration was the API's only caller, and it was a second
  copy of what the queued row already says — with the row's live columns as the
  correct source, the timeline copy could only go stale when the row was
  cancelled, re-queued or sent now. Removing it left the API with zero consumers
  in any plugin or doc, so it went the way the rework cut every other
  consumer-less surface: the `PluginThreads`/`PluginThreadNote` contract types
  and the `BbPluginApi` member, the `plugin-notes.ts` service with its
  6-per-thread-per-minute sliding-window rate limiter, the runtime/server wiring
  and the fake-host seam, the `plugin-note` timeline row shape in
  `@bb/server-contract`, the projection metadata, the timeline row builder, the
  title mapper with its attribution segment, and the app's icon/warning-tint
  arms — plus the api_to_audit entry and the authoring-skill section. The event
  type itself was subsequently purged too — see "The three legacy decode-only
  event types are purged" below.
  `message.queued`/`message.dispatched` stay: they are event-bus members like
  `thread.created`, which no bundled plugin subscribes to either, and cutting
  only the queue pair would be a carve-out rather than a rule.

- **The three legacy decode-only event types are purged, and the protocol is
  flattened to one bump.** `system/dispatch-hold`, `system/queue-state` and
  `system/plugin-note` were each kept "registered and decodable" after their
  emission, projection and renderers went, on the reasoning that narrowing
  `threadEventSchema` would churn the daemon protocol and strand stored rows.
  That reasoning does not survive the fact that all three were only ever
  emitted on this branch: no released build wrote one, so production databases
  cannot contain them and the only rows that exist are in the author's own dev
  databases, which are being wiped. Keeping three schemas, a status enum spelled
  the retired way (`"parked"`), two preview-length constants and three
  renders-as-nothing tolerance tests alive to serve zero real rows is pure
  carrying cost, so all of it is deleted: the `systemEventTypeValues` arms, the
  payload schemas and their inferred types, the `provider-event.ts` union arms,
  the `thread-event-scope.ts` policy entries, and the case arms in the two
  `assertNever` switches (`packages/thread-view/src/event-decode.ts` and
  `apps/server/src/internal/events.ts`), which shrink accordingly.

  **Dev-database consequence, accepted deliberately:** a thread whose history
  contains one of these three stored events no longer decodes. `threadEventSchema`
  rejects the unknown type, so reading that thread 500s until the dev database is
  wiped. Threads without such rows are unaffected, and no released build can have
  written one.

  **Protocol flattened.** The branch had stacked four bumps (172, 173, 174, 175)
  narrating dispatch-hold's `inputPreview`, the `system/queue-state` event plus
  the `pending` status, dispatch-hold's `holder` loosening, and the `host-offline`
  wait arm. Three of those describe event types that no longer exist, and the
  numbers had drifted into main's own 172-174, which mean unrelated things. They
  collapse into a single bump to **175 = main's 174 + 1**, narrating everything
  a daemon can actually observe across the whole branch: `threadEventSchema`
  narrowed by three event types; `host.inspect_git_source` replaced by
  `host.list_branches` with a different payload and a five-field-wider result
  (the load-bearing half — it breaks in both directions, so the bump is what
  moves an enrolled machine); and `environment.destroy` dropping a required
  field from a strict command while emptying its result. The queue surface
  needs no narration: with `system/queue-state` gone, the `waitingOn` union
  (`host-offline` arm included) is server-to-client only, and `pending` never
  crossed this wire. The pin in `contract.test.ts` moves to 175 — it had been
  left at 174 against a constant of 175, so that test was failing before this
  change.

- **The queued row is the only narration surface: provider-retry's composer
  banner is gone.** The plugin shipped a `composer.customize` banner that said
  "<provider> usage limit reached. Retrying <time>." with a Cancel button,
  served by a `providerRetryStatus`/`providerRetryCancel` RPC pair polling for
  a view assembled from the same queued row. Once a rate-limited retry became
  an ordinary queued row with a typed wait, that banner was the row's own
  sentence printed a second time, in a second widget, immediately below the
  card that already carried the reason, the countdown and a Cancel — two
  surfaces to keep in sync and two places for the user to look. The banner,
  its view component and stories, the RPC contract and its handlers, and the
  `retryViewForThread` assembly are deleted; with nothing else in it, the
  plugin's `app` entry goes too (`bb.app` is optional in the manifest, and
  `bb.server` is what a plugin actually needs). Nothing was repointed: the CLI
  never went through that RPC — `bb provider-retry status/cancel/retry` reads
  and acts on public queue surfaces (`threads.queue.list` filtered by wait
  holder, `threads.queuedMessages.delete/send`), so it is unchanged and its
  tests now cover the cancel path the RPC test used to.

- **Core owns the re-draining and the clock; plugins own every other wait
  condition and tell core when to re-ask —
  `bb.experimental_hooks.recheck()`.** The freed-capacity signal is
  deleted: `freed-capacity-signal.ts`, its four call sites in the thread
  lifecycle fanout (archive, delete, idle, error) and the `createApp`
  registration. Core no longer derives "a slot freed" at all, because a slot is
  not a core fact — the limit that makes it matter is a plugin's.

  The WALK survives unchanged and becomes what the new member invokes:
  `runFreedCapacityQueueDrain` → `runRequestedQueueDrain`,
  `requestFreedCapacityQueueDrain` → `requestQueueDrain`. Same queue order,
  same claim-CAS exactly-once, same `DISPATCH_REQUEUE_MIN_INTERVAL_MS` pacing
  on re-queue, same burst coalescing, same plugin-waits-only scope. Core's
  remaining self-driven wakes are untouched and are all queue mechanics or core
  waits: the `sendAt` due sweep, the thread-idle drain (thread-busy is a core
  wait on the thread's *own* turn — deliberately NOT part of the capacity path
  that was deleted), workspace-ready, interaction-settled, send-now and the
  orphan sweep.

  `recheck()` lives in the hooks namespace because it pairs with `on`:
  `on` answers core's question, `recheck` asks core to ask it again. It
  names no row, takes no arguments and resolves when the walk is SCHEDULED, not
  when it finishes — the walk has no caller to report to (a failed re-attempt
  lands on its row, as the due sweep's does), and resolving on completion would
  mean awaiting a full hook pass from inside whatever asked, which for a
  handler holding the evaluation lock could never complete.

  `concurrency-limit` gained the four lines this costs: it subscribes to
  `thread.idle`/`thread.failed`/`thread.archived`/`thread.deleted` — exactly
  the set the deleted fanout covered — and calls `recheck()`. Its hook is
  unchanged, and it still keeps no tally and no registry of the rows it queued,
  because the wake is still a re-ask and not a release: an unwarranted wake
  re-queues. The `sendAt`/time half of the proposal that produced this
  amendment is deliberately rejected — scheduling stays exactly as it was,
  core's clock and core's due sweep.

  **The walk's "queue order" was a lie, and is now true.** Writing the test
  for it found that `listQueuedThreadMessagesWithPluginWait` ordered by
  `asc(id)`, and queued-message ids are `qmsg_<random nanoid>` — so the drain
  re-offered rows to the hook in arbitrary order, and under a full pool the
  row that went was whichever id sorted first. Both cross-thread wait queries
  (that one and `listQueuedThreadMessagesByWaitHolder`, which also backs
  `bb provider-retry status`) now order by `createdAt`, then `sortKey`, then
  `id`. `sortKey` cannot carry this alone — its fractional keys are seeded per
  thread, so they order a thread's own rows and mean nothing between threads —
  but it correctly breaks a same-millisecond tie within one thread, with `id`
  making the sort total. No new index: the predicate already selects a small
  set through the partial wait index, and the sort is over what that returns.

  This also retires the future `clearWait` need for external-event waits
  (`plans/plugin-api-scaling-exercise.md`, previously "needs addition #2"): a
  plugin does not release a row it owns, it wakes core and every handler
  re-decides, so ownership-as-authorization and the row-correlation problem
  both stop existing. The sandbox case still needs the other half,
  `amend.environment`, which remains hypothetical.
