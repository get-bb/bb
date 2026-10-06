# The bb Provider Bridge Protocol

The one JSON-RPC contract between the agent runtime and every provider
bridge process. Message schemas live in `@bb/provider-bridge-protocol`
(published to plugins as `@get-bb/plugin-sdk/provider-bridge`) and are the
source of truth for both sides; this document adds what schemas cannot
express — the division of labor and the grammar: **the bridge knows the
dialect, the runtime knows the timeline.** A bridge parses its provider's
traffic into a narrow grammar of semantic deltas (`thread/delta`); the
runtime's delta assembler owns every timeline invariant — id minting,
turn/item lifecycle, ordering — and constructs the canonical `ThreadEvent`s.
The conformance kit enforces the testable rules against every bridge in CI.

The provider declaration, handshake summary, vocabulary, and presentation
contract are in [provider-plugin-api.md](provider-plugin-api.md); building,
packaging, and testing a bridge is in the bb-plugin-authoring skill
(`plugins/bb-guide/skills/bb-plugin-authoring/references/providers.md`).

## Where a bridge lives

A bridge is the `experimental_providerBridge` export of its plugin's
**`bb.host` artifact** ([provider-plugin-api.md](provider-plugin-api.md) §2),
not a program. The daemon runs it through a bootstrap that owns everything
outside the protocol: argv, the plugin-scoped `dataDir`/`tempDir`, the
bounded stdin framing, and the signals. The bundle is self-contained (only
node builtins stay external) and compiles only against the published
`@get-bb/plugin-sdk/provider-bridge` (plus `/testing` for its tests).
First-party bridges use exactly this path —
`plugins/provider-codex/src/bridge/bridge.ts` is the largest worked example,
and `examples/plugins/echo-provider` the smallest.

## Transport

Line-delimited JSON-RPC 2.0 over the bridge process's stdin/stdout, in both
directions. Requests and responses are discriminated on the presence of
`method`, never on result shape. The two directions use independent id
spaces.

Hygiene rules:

- An undecodable or schema-invalid request is answered with
  `INVALID_PARAMS (-32602)` carrying the validation issues. Never silently
  dropped — a dropped request is an undebuggable 30-second timeout.
- An unrecognized method is answered with `METHOD_NOT_FOUND (-32601)`.
- Anything written to stdout that is not protocol traffic is ignored by the
  reader; bridges must guard stdout against stray writes.

## Versioning and capabilities

`initialize` exchanges `{protocolVersion, capabilities}` in both directions.
The current version is **2**; the runtime rejects a bridge answering another
version with a legible startup error. The version bumps only for breaking
changes; everything additive rides capability tolerance: unknown methods
answer `-32601`, unknown notifications are ignored, unknown capability fields
pass through. Bridges version with their plugin, not with the daemon.

Handshake capabilities are **session-behavior facts** (`sessionRestore`,
`threadArchive`, `threadRename`, `threadGoalClear`, `fork`,
`approvalEnforcedBy`, `grammarVersions`, `steerMode`, `skills`). They are
reported by the code that implements them, so they cannot drift from
behavior. The runtime never sends a capability-gated method to a bridge that
did not advertise it. A handshake fact may only _narrow_ what the provider's
declaration advertises (a declared fork affordance can turn out unavailable
for this agent), never widen it.

`grammarVersions` is the inclusive `[min, max]` range of the `thread/delta`
grammar the bridge speaks, which is how the vocabulary can change without a
protocol bump. The runtime states its assembler's range in the `initialize`
params and both sides use the highest common version. The assembler speaks
**v3 only** (`[3, 3]`), so a bridge reports `[3, 3]`; a range that misses 3 —
including the `[2, 2]` default of a bridge that omits the field — is refused
at spawn with a legible error.

`steerMode` declares how the bridge delivers `turn/steer` while a turn is live
(`inject` feeds it into the running model loop; `queue`, the default, holds it
for the next prompt boundary). It is recorded, but nothing in the runtime,
server, or clients acts on it yet: the runtime sends `turn/steer` either way,
and a steer whose turn is gone is dropped on the bridge's `staleTurn` recovery
hint whatever the mode.

The sessionless `provider/health`, `provider/usage`,
`provider/installation/status`, and `provider/installation/run` methods are
different: their support is declared by each provider through
`bb.providers.register` (`maintenance`), so the server can skip an
unsupported host probe and clients can omit providers that never expose usage
or installation management before a bridge has started. A shared bridge may
declare health or usage for every provider it owns and still return
`{ supported: false }` for one provider id; a successful usage result may
likewise contain an empty `windows` array.

Installation has a split execution boundary. The bridge owns
provider-specific discovery, version/source comparison, and the
install/update decision. `provider/installation/status` returns that state
plus a display-only command. A status request may include a typed operation
requirement such as `thread_rewind`; the bridge owns the minimum provider
version that operation needs and reports it through the ordinary status.
With `checkUpdates: false` (the daemon sends it for startup compatibility
gates) the bridge probes only the local executable and version, without
registry, global-package, or doctor discovery: `latestVersion` and
`npmGlobalPackageVersion` are `null`, and `versionUnsupported` still
identifies a known unsupported local version. Omitting `checkUpdates` means
full discovery, as Settings and install/update actions use. When the daemon
gates a thread start or rewind on that status, it remembers a passing answer
for a few minutes (until it runs an install or update itself, or the shell
environment changes). It never remembers `versionUnsupported: true`, nor
`installed: false` from a bridge that reports a `minimumSupportedVersion`.
When the user acts, `provider/installation/run` rechecks the state and
returns either `available: false` or a typed executable/argument plan with a
post-run verification rule. The host daemon—not the bridge, server, or
browser—chooses the environment and working directory, serializes
installations, supervises the process, streams output, and asks the bridge
for fresh status to verify success.

Every handshake capability gates a request method, which is why the set holds
no compaction fact: there is no compact request method. Compaction is a
standalone builtin `/compact` prompt travelling the normal turn pipeline,
which each bridge maps to its provider's compaction command, and the
affordance is gated solely by the declaration's `supportsManualCompaction`.

## The timeline lane: `thread/delta`

Everything timeline-bound rides one notification: `thread/delta
{ threadId, deltas }`. A delta is a parsed _semantic_ unit — `turn.open`,
`turn.boundary`, `input.accepted`, `item.open`/`item.close` with a full item
shape, streamed text (`item.textDelta`/`item.textClose`), `usage`,
`contextWindow`, errors/warnings, `unhandled` diagnostics, session lifecycle
(`session.reset`, `session.ended`) — never a raw provider event and never a
finished `ThreadEvent`. The schemas in
`@bb/provider-bridge-protocol/src/thread-delta.ts` are the source of truth
for the grammar.

The runtime's **delta assembler** (one per bridge adapter) consumes the
deltas and owns every timeline invariant:

- **Id minting.** Turn and item ids are assembler-minted (reset per
  `session.reset`). Deltas carry provider-native join keys (tool-call ids,
  stream keys, parent refs, optional provider turn ids) and the assembler
  holds the bidirectional provider↔bb maps — both for scoping incoming
  deltas and for reverse-mapping bb ids on the command plane
  (`turn/steer.expectedTurnId`, `thread/stop.activeTurnId`) and on
  provider-native interaction requests (`providerNativeIds: true`). An
  `interaction/request` carries an approval, a user question, or a
  plugin-defined request (`"<pluginId>/<name>"`); the resolution pairs with
  the payload kind ([provider-plugin-api.md](provider-plugin-api.md) §4).
- **Turn lifecycle.** Only `turn.open`, a claiming `turn.boundary`
  (`claimIfIdle`), and accepted-input lifecycle settlement ever open a
  turn; item/stream deltas never do. Accepted input queues until a turn
  opens and drains into it.
- **Item lifecycle.** Delta-first streams get a synthesized `item/started`;
  `item.close` always carries the full terminal item shape and is applied
  uniformly (paired close, reclassifying dual-settle, or bare
  close-without-open); repeated closes for a settled provider-identified
  key are deduped and an explicit reopen reuses the same bb id.
- **Accumulation.** Streamed text, cumulative output snapshots (diffed into
  deltas/resets), and progress-event throttling.
- **One streaming dialect.** Every text stream is an item keyed like every
  other item: by the provider's own item id when it names its message items
  (codex), or by a bridge-chosen `key.channel` (`assistant`, `thinking-2`)
  plus `key.parentRef` for anonymous streams (claude, pi, acp).
  `item.textDelta { key, channel: agentMessage | reasoningText |
reasoningSummary | plan, text }` synthesizes the channel's `item/started`
  on first sight and accumulates; `item.textClose { key, channel, text? }`
  settles with the provider-final `text` or, absent that, the accumulated
  stream (a whitespace-only stream completes nothing), and releases the
  key. A tool `item.open` releases the anonymous assistant stream in its
  scope so later text mints a fresh item; provider-named items keep their
  own lifecycle and may settle through `item.close` with the full terminal
  shape like any item. `session.ended` settles a streamed item with the
  text it received.
- **One usage dialect.** `usage { total, last, modelContextWindow }` is
  forwarded verbatim as `thread/tokenUsage/updated`: a provider with exact
  cumulative totals (codex) sends both as reported, and a provider that
  reports per turn (claude, pi) sums `last` into `total` itself
  (`addTokenUsage` in the bridge kit), resetting where it sends
  `session.reset`. The breakdown keeps each provider's own semantics:
  `inputTokens` excludes cache reads/writes for Claude and Pi and includes
  them for Codex; `cachedInputTokens` is read + write for Claude/Pi and the
  reported cached count for Codex; reasoning tokens are not an extra amount
  to add to output. `cacheReadInputTokens` and `cacheWriteInputTokens`
  carry finite nonnegative reported counts: omission means unreported,
  explicit zero means reported zero, and `addTokenUsage` sums each field
  independently, leaving it absent until first reported. Do not infer missing
  counts as zero or treat cached totals as billable cache reads; these counts
  change neither the context meter nor provider-reported usage windows.
- **Context meter.** The context meter is always the separate `contextWindow`
  delta, which may name a vouched `providerTurnId` (codex sends one beside
  each `usage`). It may carry an optional `snapshot` (`ContextSnapshot`,
  validated by `contextSnapshotSchema`): capture time, provider session/turn
  identity, model, token totals, compaction threshold, estimate status, and
  categories. Each `ContextCategory` has a provider-defined id and label,
  token counts, entries, and an accounting kind (`used`, `free`, `reserved`,
  or `deferred`); each `ContextEntry` has an id, label, and token count
  already included in its parent category, and entries may describe only
  part of the category total.
- **Streamed-text batching.** Coalescing is assembler policy, not bridge
  policy: within a per-stream flush window consecutive streamed-text events
  concatenate into one event, the first delta of a fresh stream emits
  immediately, and every non-batchable event is an ordering barrier, so
  coalescing never reorders text relative to item opens/closes, turn events,
  errors, or other streams. Bridges forward text as it arrives.
- **Settlement.** `session.ended` and settling errors close open turns and
  items with the right statuses.

### Grammar v3

The current grammar (`grammarVersions: [3, 3]`) includes:

- **Core item shapes** `fileRead`, `search` (`mode: content | path | list`),
  `imageGeneration` (`prompt`, `path`, optional retained `result`, `error`,
  and `transparentBackground`), `delegation` (`childRef`, `label`,
  `background`, `summary?`; one shape for codex `spawnAgent`/`wait`, the
  Claude `Agent` tool, and backgrounded agents), and `planSteps` (a
  structured plan snapshot as an item).
- **`presentation`** on `item.open` and `item.close`, the one place it
  travels (shape and glyph rules in
  [provider-plugin-api.md](provider-plugin-api.md) §3; `detail` ≤ 280
  chars). The assembler persists it on the canonical item (the close's value
  wins, the open's survives when the close carries none), so the row renders
  after the plugin is gone. Optional for core shapes, required when the shape
  is `extension`. Conformance rule `presentation/icon-namespaced-declared`
  checks the namespaced glyph form for bridges that opt in with an
  `icons: { pluginId, names }` fixture field; a `server: "bb"` tool row is
  exempt, its glyph being checked against the tool's own plugin.
- **bb-injected tools carry their presentation.** Every `dynamicTools[]`
  definition on `thread/start`, `thread/resume` and `thread/fork` may carry
  the `presentation` the server resolved for it (from the owning plugin's
  `presentation`, or a generic label and the plugin's glyph). A bridge stamps
  that presentation, beside `server: "bb"`, on the `item.open`/`item.close`
  of every call to the tool; a definition without one presents generically.
- **Extension kinds** `"<pluginId>/<name>"`: the `extension` item shape
  (opaque JSON `payload`; its lifecycle delta must carry a `presentation`)
  and the thread-scoped `extension.state` delta (latest snapshot wins per
  kind). Only the namespace is validated on the wire; the server validates
  payloads at ingest against the plugin's declared `extensionKinds` (64 KiB
  cap) and holds the kind to the emitter rule
  ([provider-plugin-api.md](provider-plugin-api.md) §3). A kind another
  plugin owns, an undeclared kind, or a schema miss is persisted as a
  `provider/unhandled` in the same batch slot, never dropped and never
  stored unvalidated.
- **`provider/recovery`** is a bridge → runtime _notification_ beside
  `session/replaced`, not a delta: `{ threadId?, kind: sessionArchived |
authRequired | restartRecommended | staleTurn | rateLimited, message,
retryable }`. The runtime acts on the kind and never matches error text.
  See "Recovery hints" below for the actions and the carrier.

The assembler builds every core kind: `fileRead`, `search`,
`imageGeneration` and `planSteps` open pending and settle from the terminal
shape like `command`; an image generation's terminal `result` is preserved
for retained-output storage while its prompt and path remain timeline
metadata; a foreground `delegation` settles through the turn-scoped
`item/completed`, and a `background: true` delegation is thread-attached like
a background task — its `item.progress` snapshots and its `item.close` ride
the thread-scoped `item/delegation/progress` and `item/delegation/completed`
events, need no open turn, and survive turn settlement and `session.ended`.
An `extension` shape becomes the canonical `extension` item (opaque payload,
the delta's presentation); `extension.state` becomes the thread-scoped
`thread/extensionState/updated` event.

### Injected skills

`skills/configure { roots: [{ id, path, skills: [{ name, description }] }] }`
is one shape for every provider: `path` is an absolute skills directory, one
subdirectory per listed skill (`<path>/<name>/SKILL.md`). The bridge maps it
to its provider's own layout. The runtime sends it **only to a bridge whose
handshake declares `skills: { configure: true }`**, once per process, before
the first thread command; a bridge that declares nothing never receives it
and runs without injected skills, so a bridge that answers unknown methods
with `METHOD_NOT_FOUND` still starts threads. The runtime never probes.
Conformance rule `skills/configure-declared` pins both directions: declared →
the request must succeed; undeclared → the request must be refused.

### Recovery hints

A hint says what went wrong in the provider's own terms and what the runtime
may do about it. The `provider/error` delta beside it still carries the
user-visible row; the hint carries the action. The runtime keys on `kind`
only and never consults the provider id:

| `kind`               | Runtime action                                                                                                                                                                                                                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionArchived`    | `thread/unarchive` the session, then retry the rejected request once (`retryable: true`).                                                                                                                                                                                                                                               |
| `authRequired`       | Reject the request with a typed `auth_required` error (no text match anywhere downstream) and forward the hint so the host can re-check provider health.                                                                                                                                                                                |
| `restartRecommended` | Stop the bridge process the thread runs on and resume the thread on a fresh one — right away when the thread is idle, otherwise before its next turn. The restart waits while another thread on the same process is mid-turn or holds open background work, and never re-resumes a sibling the host already resumed on the replacement. |
| `staleTurn`          | Drop the steer: the turn it targeted is gone, and the runtime reports the steer as stale instead of failing it.                                                                                                                                                                                                                         |
| `rateLimited`        | With `retryable: true` on a rejected request: retry on a short bounded ladder and surface the last failure. With `retryable: false` (a turn that already failed): forward only; the runtime never re-runs a user's turn on its own.                                                                                                     |

The action follows the hint whichever attempt it arrives on: a rung of the
rate-limit ladder or the retry after an unarchive that is rejected with
another kind gets that kind's action exactly as a first rejection would. The
one bound is the unarchive itself — a second `sessionArchived` on the retry is
reported, not unarchived again.

One payload, two carriers. **Rejecting a request? Put the hint in
`error.data.recovery`.** A hint that explains a rejected runtime request (a
resume against an archived session) rides that request's JSON-RPC error
response as `error.data.recovery { kind, message, retryable }`; the JSON-RPC
`id` is the correlation, and the payload names no thread because the request
already does. A handler throws `experimental_BridgeRecoveryError` and
`runBridgeRequest` writes the response, or it calls
`sendError(id, code, message, { recovery })` by hand; the ACP bridge answers
`model/list` and `thread/start` this way when the agent needs the user to sign
in (`kind: "authRequired"`). **No request to reject? Send
`provider/recovery`.** The notification is for unsolicited hints
only — a terminal 401 or 429 the provider raised mid-turn, an SDK auth
failure — and carries `threadId` for a session-scoped condition. That
`threadId` must name a thread the sending process hosts: a hint naming any
other thread is dropped (with a stderr line). Never send both for one event.
`data` is optional and additive; a response without it, or with a malformed
one, is a plain failure, and a request that times out or whose bridge exits
has no response and therefore no hint.

A launch that fails because the provider's own CLI is not installed is a
classification, not a recovery hint: the bridge rejects the request by passing
`MISSING_EXECUTABLE` (-32004) to `sendError` instead of the generic
`BRIDGE_ERROR`. The host daemon reports that rejection as `missing_executable`
without reading the message, so the picker can say the CLI is missing whatever
prose the bridge chose. A `BRIDGE_ERROR` is classified generically.

A bridge that can heal itself does not ask the runtime to (the codex and
claude bridges rebuild a thread's provider child before the next turn after a
terminal account error), but it still emits `authRequired`/`rateLimited` so
the failure is typed.

## Identifiers

Three identifier families, three owners:

| Identifier                              | Minted by                   | Notes                                                                                                                                                                                                |
| --------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `threadId`                              | bb server                   | Opaque to the provider; echoed verbatim.                                                                                                                                                             |
| `providerThreadId`                      | the provider                | Its session handle (rollout id, session id). Returned on the `thread/start`/`thread/resume`/`thread/fork` result (required) and echoed by `thread/identity`; never used to scope bb events directly. |
| turn ids and item ids on `ThreadEvent`s | **the runtime's assembler** | Never the provider, never the bridge.                                                                                                                                                                |

A `providerThreadId` is a durable handle: bb persists it and sends it to a new
bridge process to resume the session after a restart. It must name exactly one
provider session among all of that provider's sessions on the host, so never
mint it from a per-process counter. bb refuses to resume a handle that another
thread announced first, or announced in the same millisecond.

A provider can inject arbitrary identifiers on its own wire, but the ids that
reach bb's persistence are always minted by bb-owned assembler code. Bridges
forward provider-native ids as vouched join keys on deltas; the assembler
translates in both directions, so a bridge does zero id translation —
including for a provider that mints its own turn ids (codex).

## Turn lifecycle

State machine per thread, owned by the runtime's assembler, fed by the
bridge's deltas:

```
accepted → dispatched → started → (completed | failed | interrupted)
```

The assembler constructs the events; the bridge owes the deltas that drive
it:

1. Every accepted `turn/start` or `turn/steer` reaches exactly one terminal
   state. Acceptance rides `input.accepted { clientRequestId }` — mandatory,
   so correlation is explicit and the runtime never guesses which user
   message opened a turn; the assembler queues it until a turn opens (or
   emits into the already-open turn for steers) and constructs
   `turn/input/accepted` itself. A bridge may emit `turn.open` together with
   acceptance as soon as the provider takes the prompt, before model output,
   so follow-up input can steer into that turn; a prompt the provider never
   took must not open a turn, and stopping after it was taken must settle the
   turn even if no output arrived. Settlement rides `turn.boundary
{ status }`; a boundary with `claimIfIdle: true` owns a turn only when
   accepted input is pending, so a provider-terminal fallback signal on an
   idle thread settles nothing. A prompt the provider handles without doing
   work (claude `/clear`) still produces a `turn.open` + `turn.boundary`
   pair, or the thread hangs. Conformance rule
   `turn/settles-without-activity` checks this for bridges that opt in with a
   `zeroWorkPromptInput` fixture prompt.
2. Item and stream deltas never open a turn. A turn-requiring delta that
   arrives with no turn open surfaces its `noTurnFallback` payload as a
   thread-scoped `provider/unhandled`, or is dropped when the bridge
   attached none.
3. A turn the user did not initiate (provider-internal activity such as
   auto-compaction) either becomes an explicit bridge-emitted `turn.open`
   with its own deltas or rides `provider/raw` / `unhandled` diagnostics.
   Turn-scoping is vouched: only turn keys the bridge itself opened may
   scope a delta (`vouchedTurn`, keyed `providerTurnId`s) — a provider's
   own internal turn labels must never be forwarded as scoping.
4. The runtime backstops the bridge with a turn-start watchdog: an accepted
   turn with no `turn/started` within a bound becomes a visible
   `system/provider-turn-watchdog` event, not a silently hung thread.
5. `thread/stop` semantics follow its `intent`: `interrupt` settles the
   active turn as interrupted (the bridge emits the settling deltas —
   `turn.boundary { interrupted }` plus explicit closes for provider-owned
   open items); `release` detaches an idle session and must not fabricate an
   interruption. The bb turn ids these commands carry are reverse-mapped to
   the bridge's provider-native turn ids, so the bridge compares its own ids.
6. **After `thread/stop` the bridge holds nothing for the thread.** The
   runtime detaches the thread the moment the stop is answered, whichever
   the intent, so everything the bridge still owes for that thread — the
   interrupted turn's terminal boundary first of all — must be on the wire
   before the response, and any per-thread resource the bridge runs (a
   provider CLI child, an SDK session) is released before or with it. A
   provider that settles an interrupt asynchronously waits for it, bounded,
   and settles the turn itself on timeout; the session on disk stays
   resumable either way. Conformance rule
   `stop/interrupt-settles-before-result`. The runtime may send a
   best-effort `thread/stop { release }` for a session construction that
   timed out on its side, and sweeps a bridge's process group when the bridge
   dies unexpectedly.

## Item lifecycle

Assembler-owned invariants over the assembled timeline:

1. **Every item's first event is `item/started`.** The assembler synthesizes
   the opening event for delta-first text streams (`item.textDelta`), so a
   bridge streams without bookkeeping. Output deltas (`item.outputDelta`)
   never synthesize — a command item without its command would be worse than
   the anomaly — but still register the key so a later open correlates.
2. `item.close` always carries the full terminal item shape. The assembler
   settles uniformly: a same-shaped open item settles under its minted id
   with the carried shape winning; a different-shaped open item is settled
   first and the terminal shape follows under the same id (mid-flight
   reclassification); close-without-open builds the bare completed item.
3. Item ids are unique across the life of a thread, including resumes: the
   assembler's maps survive within a session and `session.reset` (mandatory
   at every provider session construction) starts a fresh provider id space
   so reused provider-native ids mint fresh bb ids.
4. Completion follows content from the bridge's perspective: if the provider
   emits completion before the content it refers to (codex `item.close`
   before the stdout record), the bridge holds the close delta and flushes
   in order. Output may be delayed, never lost.

## Host-side enforcement

The conformance kit only covers bridges someone ran it against, so the host
also applies the grammar live at its event intake: a streaming event for an
item no `item/started` opened, a second settlement of an item, a duplicate
`turn/started` or `turn/completed`, and a `turn/completed` for a turn that
never started are dropped before any runtime state changes, each with a
warning naming the rule. An item that settles without opening is kept rather
than dropped — it carries the whole item, so refusing it would lose real
content.

## Sessions

1. `thread/start`, `thread/resume`, and `thread/fork` return
   `{providerThreadId, sessionRestorable?}`. The per-session
   `sessionRestorable` refines the handshake default and is re-reported by a
   replacement session — a stale `true` lets the idle sweep release a
   session that cannot come back.
2. **Session replacement is never silent.** Whenever the bridge tears down
   and rebuilds a live provider session — an option it cannot apply in
   place, a resume fallback, internal recovery — it first emits any
   settlement deltas for in-flight work, then `session/replaced` with a
   human-readable reason and `contextLost` when provider-side context did
   not survive.
3. Execution options ride every command. The bridge reconciles them
   internally; the runtime never diffs. Instructions are frozen for the life
   of a session and apply at the next construction.
4. Fork: absent `sourceProviderCheckpointId` means fork at the tip. A
   `fork: "tip"` bridge rejects checkpoint forks with
   `FORK_CHECKPOINT_UNSUPPORTED` rather than cloning history the bb timeline
   does not show.
5. Open work is what the timeline says it is. A `backgroundTask` item and a
   `delegation` item that are still pending are live provider work, and the
   runtime will not reap the session while one is open. Model a native
   sub-agent as a `delegation` (codex does), re-open it when the agent works
   again, and settle it — as failed — when your provider child dies, or the
   runtime keeps refusing to reap a thread that no longer exists on your
   side. There is no side channel for this.

## Ordering guarantees

Producers guarantee:

- `thread/identity` for a session precedes any `thread/delta` for it.
- Within a turn, deltas are emitted in presentation order (the assembler
  preserves it in the assembled events); across turns, turn boundaries are
  strict.
- Settlement deltas precede the `session/replaced` that made them
  necessary.

Consumers must NOT assume:

- That a request's response arrives before notifications caused by the
  request (`turn/started` may precede the `turn/start` response).
- Anything about `provider/raw` — it is droppable at any pressure point and
  carries no ids the runtime treats as bb identifiers.

## Parsing discipline

Lenient at the edges, strict at the core. Wire schemas tolerate unknown
fields (forward skew between plugin and daemon versions is normal). One
malformed entry degrades to one missing entry — a bad model in `model/list`
drops that model, not the listing; a malformed notification is logged and
dropped without poisoning the stream. But a `thread/delta` payload must be
a valid delta: what it assembles into enters bb's persistence, so the core
stays strict.

## Child processes

Bridges may spawn provider processes underneath themselves (the codex bridge
supervises per-thread app-server children); process topology is
bridge-internal and invisible to the runtime. Bridges that spawn children
finalize on `close`, not `exit`, with a bounded grace, verify currency in
stream callbacks, and never let a descendant holding an inherited pipe inject
into a fresh session. The bridge's own environment is constructed by the
runtime from an allowlist; bridges construct their children's environments
the same way and must not leak their own inherited env downward.

## Record mode

Set `BB_PROVIDER_BRIDGE_RECORD_DIR` to a directory in the host daemon's
environment and every bridge process tees the lines that cross its two
boundaries into NDJSON files. The bootstrap records the runtime wire for
every bridge, first- or third-party. A bridge that spawns its provider child
records the provider wire by calling
`experimental_recordProviderChildIo(child, { threadId })` right after
`spawn()`; the call is a no-op when record mode is off. A bridge whose
provider pipe belongs to an SDK checks
`experimental_isProviderBridgeRecording()` and takes the spawn over (the
Claude bridge does this through the Agent SDK's `spawnClaudeCodeProcess`
seam). Extra provider channels may be recorded on the same two provider
lanes, each message wrapped as `{ "bbChannel": <message> }`, so a replay can
route it back (the pi bridge does this for its extension fds).

Layout: `<dir>/<providerId>/<threadId>/<direction>.ndjson`, with `_process`
in place of `<threadId>` for lines that belong to no thread (`initialize`,
`model/list`, provider health, and the children those spawn). The four
directions are `runtime→bridge`, `bridge→runtime`, `provider→bridge`, and
`bridge→provider`. One entry per line: `{ "ts", "run", "seq", "dir", "line" }`.
`seq` is one counter across every lane of the process and `run` identifies
the process, so the files of a thread merge back into their exact order even
across a bridge restart. Responses, which carry only an id, land in the scope
of the request they answer. Nothing buffers: each line is appended as it
crosses. Provider children never inherit the variable, so a recorded provider
never records itself.

Recordings are the input of the replay and parity kit published in
`@get-bb/plugin-sdk/provider-bridge/testing` (how a plugin uses it: the
authoring skill's providers.md, "Testing a bridge"). In this repository,
redacted first-party recordings live under
`packages/provider-bridge-protocol/recordings`, one `<provider>/<cell>`
directory per live-QA matrix cell with a `manifest.json`;
`scripts/provider-recordings/redact.mjs` and `package-cells.mjs` produce them
and raw recordings stay out of git. `recordings/row-counts.json` pins each
cell's event, row, `provider/unhandled`, and grammar-drop counts;
`parity.self.test.ts` checks the pins and replays every cell through the
current bridge on each commit, and `UPDATE_PARITY_ROW_COUNTS=1` rewrites the
pins deliberately. `pnpm parity` compares two checkouts
([debugging-and-qa.md](debugging-and-qa.md)); differences a migration PR
intends go in `recordings/parity-allowlist.json` with the PR and reason, and
an entry that masks nothing fails the run. A recording is never rewritten:
when a bridge change alters its output,
`pnpm --filter @bb/provider-parity rerecord [--plan-with <checkout>]` writes
`bridge→runtime.current.ndjson` beside the recorded lane, and the self-suite
compares against that file when it exists. `pnpm parity --dump-dir <dir>`
writes both legs' normalized event and row lists per cell.

The conformance kit runs the same recordings as its recorded-traffic
scenario set: `checkRecordedCellReplay` replays a bridge's cells and reports
`recorded/<cell>/{replays, events-schema-valid, grammar, turn-lifecycle,
not-empty}` per cell. The pi, Claude Code, and Codex plugins' tests use only
public dependencies, so `packages/provider-parity` replays their committed
cells instead.
