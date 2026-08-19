# The bb Provider Bridge Protocol

The one JSON-RPC contract between the agent runtime and every provider
bridge process. Message schemas live in `@bb/provider-bridge-protocol` and
are the source of truth for both sides; this document adds what schemas
cannot express — the division of labor and the grammar: **the bridge knows
the dialect, the runtime knows the timeline.** A bridge parses its
provider's traffic into a narrow grammar of semantic deltas
(`thread/delta`); the runtime's delta assembler owns every timeline
invariant — id minting, turn/item lifecycle, ordering — and constructs the
canonical `ThreadEvent`s. The conformance kit enforces the testable rules
against every bridge in CI.

## Where a bridge lives

A bridge ships inside its plugin's **`bb.host` artifact** — the same artifact
a host RPC entry ships in, and one plugin may carry both. It is an *export*,
not a program:

```ts
export const experimental_providerBridge = experimental_defineProviderBridge({
  handleLine,
  start({ pluginId, dataDir, tempDir }) {},
  onClose() {},
});
```

`bb plugin build` bundles the artifact to `dist/host.js`; the server records
it content-addressed and hands hosts `{pluginId, digest}`; the daemon
downloads, verifies, caches and runs it — through a bootstrap that owns
everything outside the protocol: argv, the plugin-scoped `dataDir`/`tempDir`
above, the bounded stdin framing, and the signals. A bridge that started
itself could not be imported by a test, and could not share an artifact with a
host RPC entry. First-party bridges use exactly this path —
`plugins/provider-codex/src/bridge/bridge.ts` is the largest worked example,
and `examples/plugins/echo-provider` the smallest.

The bundle is self-contained (only node builtins stay external) and may not
import bb's private `@bb/*` workspace packages at all — an installed plugin
cannot resolve them. Everything a bridge compiles against is published at
**`@get-bb/plugin-sdk/provider-bridge`**: the protocol schemas (including
the `thread/delta` grammar), the bridge kit (JSON-RPC plumbing, tool-call
and interaction codecs, visibility, dialect-parsing helpers), and the domain
vocabulary the params reference. In-repo, those are implemented by
`@bb/provider-bridge-protocol` and `@bb/domain`; test infrastructure stays
private in `@bb/provider-bridge-protocol/testing`.

## Transport

Line-delimited JSON-RPC 2.0 over the bridge process's stdin/stdout, in both
directions. Requests and responses are discriminated on the presence of
`method`, never on result shape. The two directions use independent id
spaces.

Hygiene rules (each traces to incident #853):

- An undecodable or schema-invalid request is answered with
  `INVALID_PARAMS (-32602)` carrying the validation issues. Never silently
  dropped — a dropped request is an undebuggable 30-second timeout.
- An unrecognized method is answered with `METHOD_NOT_FOUND (-32601)`.
- Anything written to stdout that is not protocol traffic is ignored by the
  reader; bridges must guard stdout against stray writes.

## Versioning and capabilities

`initialize` exchanges `{protocolVersion, capabilities}` in both directions.
The current version is **2** (the narrow-grammar cutover: `thread/delta`
replaced `thread/event`); the runtime rejects a bridge answering another
version with a legible startup error, since a version-1 bridge would
otherwise connect and produce a silently empty timeline. The version bumps
only for breaking changes; everything additive rides capability tolerance:
unknown methods answer `-32601`, unknown notifications are ignored, unknown
capability fields pass through. Bridges version with their plugin, not with
the daemon — that decoupling is the protocol's reason to exist.

Handshake capabilities are **session-behavior facts** (`sessionRestore`,
`threadArchive`, `threadRename`, `threadGoalClear`, `fork`,
`approvalEnforcedBy`). They are reported by the code that implements
them, so they cannot drift from behavior. The runtime never sends a
capability-gated method to a bridge that did not advertise it. A handshake
fact may only _narrow_ what the provider's declaration advertises (a
declared fork affordance can turn out unavailable for this agent), never
widen it.

Every capability listed there gates a request method, which is why the set
holds no compaction fact. Compaction is triggered by a standalone builtin
`/compact` prompt travelling the normal turn pipeline, which each bridge maps
to its provider's compaction command; there is no compact request method, so
there is nothing to withhold and nothing for a handshake fact to gate. The
`/compact` affordance is gated solely by the provider declaration's
`supportsManualCompaction`, which the ACP bridge needs per agent because the
agents it serves differ on it — a process-level handshake, which runs before
any session exists, cannot answer that question at all. A structured
compaction request is future work — reintroduce it only with a sender, and
only then does it earn a handshake capability.

## The timeline lane: `thread/delta`

Everything timeline-bound rides one notification: `thread/delta
{ threadId, deltas }`. A delta is a parsed *semantic* unit — `turn.open`,
`turn.boundary`, `input.accepted`, `item.open`/`item.close` with a full item
shape, streamed text (`message.delta`, `item.textDelta`), usage,
context-window, errors/warnings, `unhandled` diagnostics, session lifecycle
(`session.reset`, `session.ended`) — never a raw provider event and never a
finished `ThreadEvent`. The schemas in
`@bb/provider-bridge-protocol/src/thread-delta.ts` are the source of truth
for the grammar.

The runtime's **delta assembler** (`@bb/agent-runtime`, one per bridge
adapter) consumes the deltas and owns every timeline invariant:

- **Id minting.** Turn and item ids are assembler-minted
  (entropy + serial, the #1224 discipline held centrally, reset per
  `session.reset`). Deltas carry provider-native join keys (tool-call ids,
  stream keys, parent refs, optional provider turn ids) and the assembler
  holds the bidirectional provider↔bb maps — both for scoping incoming
  deltas and for reverse-mapping bb ids on the command plane
  (`turn/steer.expectedTurnId`, `thread/stop.activeTurnId`) and on
  provider-native interaction requests (`providerNativeIds: true`).
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
  deltas/resets), token usage totals, and progress-event throttling.
- **Streamed-text batching.** Coalescing is assembler policy, not bridge
  policy: within a per-stream flush window (`textDeltaFlushMs`, 100ms
  default, 0 disables) consecutive streamed-text events — assistant/
  reasoning/plan deltas and command/fileChange output deltas, including the
  ones the assembler's own snapshot diffing produces — concatenate into a
  single event of the same type, so chatty providers stop producing one
  timeline event per token. The first delta of a fresh stream emits
  immediately (time-to-first-token unchanged); buffers flush trailing-edge
  with no timers (the thread's next traffic once the window elapses, stream
  close, session boundaries); and every non-batchable event is an ordering
  barrier — coalescing never reorders text relative to item opens/closes,
  turn events, errors, or other streams' flushes. An output `reset` is never
  absorbed into a concatenation; `session.reset` flushes buffered text
  (assembled against the old session's still-valid ids) before dropping the
  thread's state.
- **Settlement.** `session.ended` and settling errors close open turns and
  items with the right statuses.

## Identifiers

Three identifier families, three owners:

| Identifier                              | Minted by                    | Notes                                                                                                                 |
| --------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `threadId`                              | bb server                    | Opaque to the provider; echoed verbatim.                                                                              |
| `providerThreadId`                      | the provider                 | Its session handle (rollout id, session id). Exchanged via `thread/identity`; never used to scope bb events directly. |
| turn ids and item ids on `ThreadEvent`s | **the runtime's assembler**  | Never the provider, never the bridge.                                                                                 |

The central-minting rule is the #1320 lesson made structural: a provider can
inject arbitrary identifiers on its own wire, but the ids that reach bb's
persistence are always minted by bb-owned assembler code. Bridges forward
provider-native ids as vouched join keys on deltas; the assembler translates
in both directions, so a bridge does zero id translation — including for a
provider that mints its own turn ids (codex).

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
   `turn/input/accepted` itself. Settlement rides `turn.boundary
   { status }`; a boundary with `claimIfIdle: true` owns a turn only when
   accepted input is pending, so a provider-terminal fallback signal on an
   idle thread settles nothing. A prompt the provider handles without doing
   work (claude `/clear`) still produces a `turn.open` + `turn.boundary`
   pair — zero-delta acceptance is the #1431 hung-thread class. Conformance
   rule `turn/settles-without-activity` checks this for bridges that opt in
   with a `zeroWorkPromptInput` fixture prompt.
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
   interruption (#1584). The bb turn ids these commands carry are
   reverse-mapped to the bridge's provider-native turn ids by the adapter,
   so the bridge compares its own ids.

## Item lifecycle

Assembler-owned invariants over the assembled timeline:

1. **Every item's first event is `item/started`.** The assembler synthesizes
   the opening event for delta-first text streams (`message.delta`,
   `item.textDelta`), so a bridge streams without bookkeeping. Output
   deltas (`item.outputDelta`) never synthesize — a command item without
   its command would be worse than the anomaly — but still register the key
   so a later open correlates.
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
   in order. Output may be delayed, never lost (#1400).

## Host-side enforcement

The conformance kit only covers bridges someone ran it against, and a bridge
now ships as a plugin artifact that may be third-party. So the host also
applies the grammar live, at its event intake (`ThreadEventGrammar`, over
the assembler's output): a
streaming event for an item no `item/started` opened, a second settlement of
an item, a duplicate `turn/started` or `turn/completed`, and a
`turn/completed` for a turn that never started are dropped before any runtime
state changes, each with a warning naming the rule. An item that settles
without opening is the one non-conformance kept rather than dropped — it
carries the whole item, so refusing it would lose real content.

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
   not survive. Invisible replacement is the #1268 incident.
3. Execution options ride every command. The bridge reconciles them
   internally; the runtime never diffs. Instructions are frozen for the life
   of a session and apply at the next construction.
4. Fork: absent `sourceProviderCheckpointId` means fork at the tip. A
   `fork: "tip"` bridge rejects checkpoint forks with
   `FORK_CHECKPOINT_UNSUPPORTED` rather than cloning history the bb timeline
   does not show.
5. `thread/openWork` reports whether a thread still owns provider work that
   outlives its turn and that bb cannot see. Work reported as
   `backgroundTask` items is already tracked by the runtime; this is for
   work the provider models as something else (codex reports native
   subagents as tool calls). It is level-triggered — send the current value,
   the runtime keeps the last one heard — and a bridge that never sends it
   reads as no open work. Retract it (`open: false`) when the session is
   released, or the runtime will refuse to reap a thread that no longer
   exists on your side. Missing this is how an idle-looking thread gets its
   parent process stopped out from under a running child agent.

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
own the exit-race lessons the runtime learned (#1402): finalize on `close`
not `exit` with a bounded grace, verify currency in stream callbacks, and
never let a descendant holding an inherited pipe inject into a fresh
session. The bridge's own environment is constructed by the runtime from an
allowlist; bridges construct their children's environments the same way and
must not leak their own inherited env downward (#1366, #1545).
