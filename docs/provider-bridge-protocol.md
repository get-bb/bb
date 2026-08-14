# The bb Provider Bridge Protocol

The one JSON-RPC contract between the agent runtime and every provider
bridge process. Message schemas live in `@bb/provider-bridge-protocol` and
are the source of truth for both sides; this document adds what schemas
cannot express — the **event grammar**: which sequences are legal, who mints
which identifiers, and which orderings each side may rely on. The
conformance kit enforces the testable rules against every bridge in CI.

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
The version bumps only for breaking changes; everything additive rides
capability tolerance: unknown methods answer `-32601`, unknown notifications
are ignored, unknown capability fields pass through. Bridges version with
their plugin, not with the daemon — that decoupling is the protocol's reason
to exist.

Handshake capabilities are **session-behavior facts** (`sessionRestore`,
`archiveSync`, `nameSync`, `goalState`, `manualCompaction`, `fork`,
`approvalRequestPolicy`). They are reported by the code that implements
them, so they cannot drift from behavior. The runtime never sends a
capability-gated method to a bridge that did not advertise it. A handshake
fact may only *narrow* what the provider's declaration advertises (a
declared fork affordance can turn out unavailable for this agent), never
widen it.

## Identifiers

Three identifier families, three owners:

| Identifier | Minted by | Notes |
| --- | --- | --- |
| `threadId` | bb server | Opaque to the provider; echoed verbatim. |
| `providerThreadId` | the provider | Its session handle (rollout id, session id). Exchanged via `thread/identity`; never used to scope bb events directly. |
| turn ids and item ids on `ThreadEvent`s | **the bridge** | Never the provider. |

The bridge-minting rule is the #1320 lesson made structural: a provider can
inject arbitrary identifiers on its own wire, but the ids that reach bb's
persistence are always minted by bb-authored bridge code. A bridge wrapping
a provider that mints its own turn ids (codex) keeps a private
provider-id → bridge-id map and translates at the boundary.

Id construction rules (conformance-enforced; the #1224 lesson):

- Turn ids embed per-bridge-instance entropy (a nonce generated at bridge
  startup), so ids never collide across process restarts or session resumes.
- Item ids are scoped by their turn id. A per-session counter alone is a
  latent cross-resume collision.

## Turn lifecycle

State machine per thread, owned by the runtime, fed by the bridge:

```
accepted → dispatched → started → (completed | failed | interrupted)
```

Grammar rules:

1. Every accepted `turn/start` or `turn/steer` reaches exactly one terminal
   state. A prompt the provider handles without doing work (claude `/clear`)
   still produces a started+completed pair. Zero-event acceptance is the
   #1431 hung-thread class.
2. `turn/started` carries the `clientRequestId` of the request that
   initiated it, so correlation is explicit — the runtime never guesses
   which user message opened a turn.
3. A turn the user did not initiate (provider-internal activity such as
   auto-compaction) either becomes a bridge-minted turn with its own events
   or is emitted as `provider/raw` diagnostics. It must never reference a
   turn id bb has not seen.
4. The runtime backstops the bridge with a turn-start watchdog: an accepted
   turn with no `turn/started` within a bound becomes a visible
   `system/provider-turn-watchdog` event, not a silently hung thread.
5. `thread/stop` semantics follow its `intent`: `interrupt` settles the
   active turn as interrupted; `release` detaches an idle session and must
   not fabricate an interruption (#1584).

## Item lifecycle

1. **Every item's first event is `item/started`.** A bridge whose SDK
   streams delta-first (assistant text arriving as bare deltas) synthesizes
   the opening event. Delta-only openings are non-conformant — they forced
   the timeline's window-cut backfill special case, which broke.
2. Completion follows content from the bridge's perspective: if the provider
   emits completion before the content it refers to (codex `item/completed`
   before the stdout record), the bridge holds the completion and flushes in
   order. Output may be delayed, never lost (#1400).
3. Item ids are unique across the life of a thread, including resumes.

## Sessions

1. `thread/start`, `thread/resume`, and `thread/fork` return
   `{providerThreadId, sessionRestorable?}`. The per-session
   `sessionRestorable` refines the handshake default and is re-reported by a
   replacement session — a stale `true` lets the idle sweep release a
   session that cannot come back.
2. **Session replacement is never silent.** Whenever the bridge tears down
   and rebuilds a live provider session — an option it cannot apply in
   place, a resume fallback, internal recovery — it first emits any
   settlement events for in-flight work, then `session/replaced` with a
   human-readable reason and `contextLost` when provider-side context did
   not survive. Invisible replacement is the #1268 incident.
3. Execution options ride every command. The bridge reconciles them
   internally; the runtime never diffs. Instructions are frozen for the life
   of a session and apply at the next construction.
4. Fork: absent `sourceProviderCheckpointId` means fork at the tip. A
   `fork: "tip"` bridge rejects checkpoint forks with
   `FORK_CHECKPOINT_UNSUPPORTED` rather than cloning history the bb timeline
   does not show.

## Ordering guarantees

Producers guarantee:

- `thread/identity` for a session precedes any `thread/event` for it.
- Within a turn, events are emitted in presentation order (grammar rules
  above); across turns, turn boundaries are strict.
- Settlement events precede the `session/replaced` that made them necessary.

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
dropped without poisoning the stream. But a `thread/event` payload must be a
valid `ThreadEvent`: events enter bb's persistence, so the core stays
strict.

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
