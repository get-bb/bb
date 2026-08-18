# Narrow-grammar revision of the Provider Bridge Protocol

Status: investigation + prototype (branch `narrow-grammar-prototype`). Decides
`docs/api_to_audit.md` item 1 for `@get-bb/plugin-sdk/provider-bridge` (whether
the SDK keeps re-exporting `@bb/domain`'s event vocabulary).

## The revision in one paragraph

Today a bridge owes the runtime finished canonical `ThreadEvent`s: it opens
turns, mints and scopes item ids, queues accepted input, settles items, and
constructs `@bb/domain` shapes — which is why the bridge kit carries the
turn-state registry, scoped-item-ids, accepted-user-messages, and item
constructors (~1,000 published lines), and why the SDK must re-export the
domain event vocabulary. The revision splits the job along the line the
de-overfit audit kept rediscovering: **the bridge knows the dialect, the
runtime knows the timeline.** Bridges emit a small grammar of parsed *semantic
deltas* (`thread/delta` notifications); the runtime's generic adapter owns one
assembler that mints ids, correlates accepted input, pairs and settles items,
accumulates usage, and constructs every `ThreadEvent`.

## What the survey established (2026-08-18, both agents' full inventories in
the session transcript)

- **Codex is an existence proof.** Its app-server natively emits
  turn/item/delta events with provider ids; codex's `event-translation.ts`
  output essentially *is* the target vocabulary. ACP invented its own internal
  envelope layer (`acp/turn/started`, `acp/update`, …) and assembles above it;
  pi's SDK ships text/thinking as deltas already. The per-bridge assembly on
  top of these layers is the duplicated part.
- **The grammar must include command-plane/lifecycle deltas.** Turn acceptance
  is correlated with `turn/start`/steer handling (claude queues, codex FIFO
  against native turn/started); settlement is fabricated from interrupts,
  session replacement, and child death; pi stamps a checkpoint pulled from the
  live SDK at `agent_end`. None of that is parseable from provider events.
- **Provider heuristics stay bridge-side.** Claude's background-task machine
  (which *changes the bb turn boundary*: completion-blocking tasks suppress
  the provider's terminal signal), codex's delegation parent-linking FIFO, and
  ACP's tool-call reclassification all remain provider code — they conclude,
  and stamp conclusions onto deltas (`parentRef`, withheld `turn.boundary`,
  re-typed `item.close`). The assembler never guesses provider semantics.
- **Central id minting must be bidirectional.** Steer (`expectedTurnId`),
  interrupt, fork checkpoints, and approval payloads translate bb ids back to
  provider keys. Deltas therefore carry provider-native join keys
  (toolCallId, contentIndex, provider turn id) and the assembler owns the
  bb↔provider id maps both ways. Bridges' entropy-prefix discipline (#1224)
  moves into the assembler (which restarts too, so it keeps the
  entropy+serial trick — centrally, once).
- **The assembler answers turn-id questions the bridge can no longer ask.**
  ACP tags permission `interaction/request`s with `currentTurnId`; under the
  revision the runtime stamps interactions itself, since it owns turn ids.

## The delta grammar (prototype cut — pi-sufficient, shaped by all four)

`thread/delta` notification: `{ threadId, delta }`, batched arrays allowed.

- `input.accepted { clientRequestId? }` — the bridge confirms the provider
  consumed an input (immediate or steered). The assembler owns the
  queue-until-turn-opens behavior and the terminal-turn invariant.
- `turn.open {}` — an explicit provider signal opened work (pi `agent_start`).
  Only `turn.open`, a claiming `turn.boundary`, and accepted-input lifecycle
  settlement open turns; item/stream deltas never do (they carry an optional
  `noTurnFallback` instead — see the grammar gaps).
- `turn.boundary { status: completed|failed|interrupted, error?,
  providerCheckpointId?, claimIfIdle? }` — the bridge's conclusion that the
  turn settled. `claimIfIdle: true` marks fallback closers (pi
  `prompt/settled`) that own a turn only if accepted input is pending —
  today's `resolveProviderTerminalTurn` rule, applied centrally.
- `item.open { key, item }` where `item` is one of the parsed shapes:
  `command {command, cwd}`, `fileChange {path, oldText?, newText?}`,
  `tool {tool, args}`, `compaction {}` — and `key` is
  `{ providerItemId?, channel?, parentRef? }` (provider-native join key).
- `item.close { key, status, resultText?, exitCode?, aggregatedOutput?,
  item? }` — `item` present when the terminal shape differs from the opened
  one (ACP reclassification). Close-without-open is legal (assembler builds
  the bare completed item, as `buildToolResultItem`'s fallback does today).
- `message.delta { channel: assistant|reasoning, streamKey, text }` /
  `message.close { channel, streamKey?, text? }` — streamed text; the
  assembler synthesizes `item/started` on delta-first opens, accumulates when
  the provider gives no final text (ACP), and prefers provider-final text when
  given (pi, claude).
- `command.outputSnapshot { key, text }` — cumulative output (pi bash); the
  assembler diffs into `outputDelta`/`reset` (absorbs `diff-cumulative-text`).
- `usage.turn { tokens…, modelContextWindow? }` — last-turn usage; the
  assembler accumulates the running thread totals.
- `contextWindow { used, size?, estimated, attach: open|currentOrLast }` —
  `currentOrLast` legalizes pi's post-turn attachment (auto-compaction and
  usage scoped to the turn that just closed).
- `context.compacted {}`, `context.cleared {}`.
- `provider.error { message, willRetry?, category?, settlesTurn? }`,
  `provider.warning { … }`.
- `unhandled { raw, vouchedTurn }` — the visibility-classification outcome;
  `vouchedTurn` is today's only-caller-vouched-turn-ids rule.
- `session.ended { reason: interrupted|replaced|exited, error? }` — lifecycle
  settlement: the assembler closes the open turn and open items with the
  right statuses (what interrupt/replacement/child-exit handlers fabricate by
  hand today).

Out of scope for the prototype, designed-for: claude background tasks ride a
named per-provider assembly extension (the task fold/throttle/generation
machine becomes an assembler plugin claude's bridge configures — not grammar);
codex's zero-work settlement stays bridge-side (it is command-plane + timer
and emits an ordinary `turn.open`+`boundary` pair when it fires).

## Ownership map after the revision

- Bridge: dialect parsing, delta emission, provider heuristics
  (task-blocking, delegation linking, reclassification), command plane.
- Runtime assembler (new, in `@bb/agent-runtime`, behind the
  `translateEvent` seam at `bridge-protocol-adapter.ts:488`): turn/item id
  minting (entropy+serial, both-way provider maps), accepted-input queue +
  terminal-turn invariant, delta-first synthesis + settle/reopen dedup,
  pairing caches + close-echo of started-item fields, text accumulation,
  snapshot diffing, usage accumulation, ordering buffers (identity-first),
  event construction.
- Published SDK: the delta schemas + entry shape. The domain event vocabulary
  leaves the SDK — audit item 1 resolves as "the protocol owns a narrow
  vocabulary of its own."

## Prototype plan (this branch)

1. Delta schemas + `thread/delta` method in `@bb/provider-bridge-protocol`
   (additive; protocol version untouched — dual-path).
2. Assembler in `@bb/agent-runtime` (`delta-assembler.ts`), unit-tested
   against the invariants named above; wired into `translateEvent` so
   `thread/delta` and `thread/event` coexist.
3. Convert **pi** (in-repo, no SDK publish loop; carries the terminal-turn
   triangle, compaction last-turn scoping, snapshot diffing, checkpoint
   stamping, entropy ids). Pi's translator shrinks to dialect parsing +
   delta emission; its turn-state registry / scoped-id / accumulation code is
   deleted. Byte-equivalence: a replay test drives recorded pi fixtures
   through old and new paths and diffs the emitted `ThreadEvent`s.
4. Report: line deltas (pi bridge, kit usage), the grammar gaps found while
   converting, and the assessed cost of converting acp (expected easiest:
   its internal envelopes map ~1:1), claude (task extension design), codex
   (mostly renaming its native passthrough).

## Migration order (adopted; acp converted 2026-08-18)

acp ✓ → codex → claude (task extension lands with it) → delete the kit's
turn-state/scoped-ids/accepted-messages/constructor surface from the SDK →
protocol version bump + conformance kit rewritten around delta
well-formedness. Sequenced before session-mode so the transport carries the
smaller protocol and the conformance kit churns once.

## Prototype results (2026-08-18, this branch)

Built as planned: schemas (`provider-bridge-protocol/src/thread-delta.ts`),
assembler (`agent-runtime/src/delta-assembler.ts` behind `translateEvent`),
pi converted, equivalence suite ported. All of
`@bb/provider-bridge-protocol` + `@bb/agent-runtime` typecheck/test green
(incl. pi's canonical conformance suite, run through a real assembler shim);
`@bb/server` typecheck untouched-green. Real-API integration tests were not
run (no provider credentials in the prototype environment).

### Line deltas

- Pi translator: `event-translation.ts` 1,259 → `delta-translation.ts` 898
  (−361), and it is now **stateless** — the turn-state registry, scoped-item
  ids, accepted-input queue, snapshot diffing, and token accumulation are
  gone from the bridge side entirely (pi now imports zero kit assembly
  machinery; only parsing/classification helpers remain). *(Amended with the
  ACP conversion: the uniform terminal-shape close rule gave pi back one
  piece of dialect memory, the started-tool shape cache — see open
  question 2.)*
- Pi bridge lifecycle: `bridge/bridge.ts` 1,155 → 1,094 (−61): entropy
  minting, per-session translator serials, and the hand-built interrupt
  `turn/completed` all collapsed into one-line delta emissions.
- Pi-local `diff-cumulative-text` (46 + 42 test) absorbed into the assembler.
- New shared code: `thread-delta.ts` 257 (schemas), `delta-assembler.ts`
  1,001 (includes the absorbed diff, heavy doc comments, and the session
  settlement no bridge had centrally before) + ~20 adapter wiring lines.
- Kit surface pi no longer uses but other bridges still do (deletable from
  the SDK after acp/codex/claude convert): turn-state 290, scoped-item-ids
  98, accepted-user-messages 83, provider-terminal-turn 33,
  tool-item-translation 222 — ≈726 published lines, plus the SDK's domain
  event re-export.

### Grammar gaps found while converting (deltas added beyond the plan cut)

1. **`item.progress { key, message }`** — pi's non-bash
   `tool_execution_update` → `item/toolCall/progress` had no delta.
2. **`item.open.attach: "currentOrLast"`** — pi threshold compaction opens a
   compaction item *in the turn that just closed* without reopening one;
   plain `item.open` would fabricate a turn.
3. **`message.close` needed a three-way settle semantic**: `text` present →
   provider-final text; absent → accumulated text (ACP); absent +
   `detach: true` → silent release (pi drops the assistant stream when a
   tool starts so post-tool text mints a fresh item, with no completed
   event for the pre-tool stream).
4. **`message.delta`/`message.close` carry `parentRef`** — pi scopes
   assistant/reasoning streams per parent tool call (subagents).
5. **`provider.error` grew `detail`**, and its turn resolution follows the
   claim-if-idle rule; a settling error on an idle thread stays a
   thread-scoped diagnostic instead of fabricating a failed turn.
6. **`unhandled` carries `rawType`** — the visibility classification's kind
   string is bridge knowledge the assembler cannot recompute.
7. `input.accepted.clientRequestId` is required, not optional — the
   canonical `turn/input/accepted` event cannot be built without it.
8. **`noTurnFallback { raw, rawType }` on turn-requiring deltas** — restores
   the old bridges' "no active turn → provider/unhandled" guard without
   implicit turn opening: when an item/stream delta (or `context.compacted`)
   has no turn to attach to, the assembler surfaces the fallback payload as
   a thread-scoped `provider/unhandled`, or drops the delta when the bridge
   attached none (pi attaches it to tool/compaction deltas and leaves
   message deltas bare, matching old pi's coverage-filtered silence).
9. *(ACP conversion)* **`unhandled.onlyIfNoTurn`**, **`turn.plan`**,
   **`provider.warning.vouchedTurn`**, and the **`fileChange.changes` list**
   (multi-entry, explicit `add|update|delete` kinds) — see the ACP results
   section below.

### Behavior deviations (old translator behavior the grammar cannot express)

- **Resolved: behavior-neutral (2026-08-18).** The bridge-side *no-turn
  guards* are restored — item/stream deltas never open turns (only
  `turn.open`, a claiming `turn.boundary`, and accepted-input lifecycle
  settlement do) and turnless turn-requiring deltas surface their
  `noTurnFallback` payload as `provider/unhandled` exactly as the old
  translator did, including turnless `compaction_end`. The deviation
  markers are gone from the ported suite; whether any implicit turn opening
  should return is deferred to the ACP conversion (open question 4).
- **Resolved: uniform terminal-shape close (Michael, 2026-08-18, implemented
  with the ACP conversion).** `item.close.item` is REQUIRED and always
  carries the full terminal item shape; the assembler treats close
  uniformly: the completed item is built from the carried shape (an open
  item under the key contributes only its minted id and parent fallback), a
  different-shaped open item is settled first and the terminal shape follows
  under the same id (ACP's dual-complete preserved), and close-without-open
  builds the bare item. Pi was updated to pass its terminal shape too: its
  `tool_execution_end` omits args, so the translator remembers the shape it
  classified at `tool_execution_start` in a per-call cache
  (`agent-runtime/src/pi/delta-translation.ts:401`, dropped when the turn
  settles) — pi's translator is therefore no longer strictly stateless,
  holding the same kind of dialect memory as ACP's merge cache.
- `session.ended` now settles open *items* too (plan-mandated;
  old pi interrupt left them dangling) — a strict improvement, but it means
  interrupt timelines gain item/completed events they did not have.

## ACP conversion results (2026-08-18, stage 2 of the cutover)

Converted as assessed: the envelope layer mapped ~1:1 onto deltas and the
translator's assembly half is deleted. All acp plugin suites (144 tests,
incl. the canonical conformance run and the ported equivalence suite) pass
through the new path; provider-bridge-protocol, agent-runtime, plugin-sdk
green; @bb/server typecheck untouched-green.

### Line deltas

- ACP translator: `event-translation.ts` 1,135 → `delta-translation.ts` 845
  (−290). Its only remaining state is the tool-call **merge cache** (updates
  inherit absent fields — dialect knowledge); turn/item ids, accumulation,
  scoped-id factories, accepted-input queueing, and the per-thread turn
  registry are gone from the bridge side.
- ACP bridge lifecycle: `bridge/bridge.ts` 2,500 → 2,465 (−35): the
  per-session id-entropy translator factory, the translator-queue accepted
  input dance, and translator-state reads all collapsed into one-line delta
  emissions.
- Grammar/schema/assembler growth for ACP: `thread-delta.ts` 281 → 312,
  `delta-assembler.ts` 1,081 → 1,128 (uniform close, fileChange changes
  list, turn.plan, warning scoping, stream-release + trim suppression).

### How the ACP behaviors mapped

- **Interaction turn ids are runtime-stamped.** The wire contract already
  had the mechanism: `turnId: null` in `interaction/request` means
  "unresolved", and `runtime-provider-requests.ts` resolves it from the
  runtime's active-turn state (fed by the assembled `turn/started`). The
  bridge simply stopped sending a turn id — no sentinel wart was needed.
- **Turn-end settlement stays a bridge-emitted `item.close` drain**
  (`provider-acp/src/delta-translation.ts:426`), not generic assembler
  settlement: the terminal shapes and close fields (aggregated output,
  results) come from the merge cache's raw ACP data, which the assembler
  cannot reconstruct, and the dual-settle of mid-flight reclassified calls
  needs the merged classification. The assembler's generic settlement
  (`session.ended`) remains for lifecycle death; ACP's stream flushes ride
  explicit `message.close` deltas at the provider's trigger points
  (message chunk closes thought; tool call closes both; turn end closes
  both before draining tools), preserving today's event order exactly.
- **Turnless known updates** map to `noTurnFallback` on the primary delta;
  known updates that translate to *nothing* even mid-turn (non-terminal
  update without progress text, non-text chunks, malformed known payloads)
  carry a new `unhandled { onlyIfNoTurn: true }` delta so the old
  "known event, no active turn → provider/unhandled" guard survives without
  emitting anything when a turn is open (grammar gap 9).
- **Idle bridge errors stay gated bridge-side**
  (`provider-acp/src/bridge/bridge.ts:288`): `activePromptKind` mirrors the
  turn the bridge opened, so an agent death on an idle thread emits only the
  runtime error notification, exactly as before (the delta path would have
  added a thread-scoped provider/error the old translator never emitted).
- **fs/write envelopes carry `oldText`/`content`** instead of a pre-built
  diff string; the assembler builds the identical diff (same `buildEditDiff`)
  centrally.
- `usage_update` → `contextWindow { attach: "open" }` (turn-scoped when
  open, thread-scoped otherwise — old scoping exactly); `plan` →
  new `turn.plan { steps }`; `acp/warning` → `provider.warning` with new
  `vouchedTurn` turn scoping.

### Behavior deviations (ACP)

- A `tool_call` that arrives *pending with output content already attached*
  used to surface that output on the `item/started` event
  (`aggregatedOutput`/`result` at start). Delta item shapes deliberately
  exclude output fields (`provider-acp/src/delta-translation.ts:183`), so
  the output now first appears on the completed item. No agent in the test
  corpus does this; the close carries it in full.
- A whitespace-only accumulated stream still completes no item, but the
  suppression now lives in the assembler (release + empty-after-trim),
  shared with every accumulating bridge.

### Assessed conversion cost (remaining)
- **codex — low-to-medium.** Its native turn/item events are ~the target
  vocabulary; conversion is mostly renaming plus carrying provider ids as
  join keys. Zero-work settlement stays bridge-side as an ordinary
  `turn.open`+`turn.boundary` pair (grammar-supported). One new need:
  codex trusts provider-minted turn ids today; under central minting its
  steer `expectedTurnId` reverse lookup must go through the assembler maps.
- **claude — highest.** The background-task machine (fold/throttle/
  generation, completion-blocking tasks that *withhold* the turn boundary)
  is real design work: the grammar has no `backgroundTask` item shape and
  the planned per-provider assembler extension does not exist yet. Everything
  else (queued acceptance, provider-final text, usage) maps directly.

## Open questions for Michael

1. Batch framing: one `thread/delta` per delta vs arrays (prototype: arrays).
2. Resolved (Michael, 2026-08-18): `item.close` ALWAYS carries the full
   terminal item shape, required for tool-family items, and the assembler
   treats close uniformly — different-shaped open item: close the opened
   shape and emit the terminal shape (dual-complete preserved); nothing
   open: build the completed item from the carried shape; same-shaped open
   item: the carried terminal shape wins under the opened id. Pi's emission
   was updated to pass its terminal shape (started-shape cache). Implemented
   with the ACP conversion; see the results sections.
3. Where the pi model→context-window catalog lives once usage assembly is
   central (prototype: carried on `usage.turn.modelContextWindow`).
4. Resolved: implicit turn opening is removed entirely — item/stream deltas
   require an open turn and fall back to their `noTurnFallback`
   `provider/unhandled` payload (grammar gap 8), which is behavior-neutral
   against the old translators. The ACP conversion confirmed no delta needs
   implicit turn opening (its `onlyIfNoTurn` unhandled covers the last
   guard case, grammar gap 9).
5. `message.close.detach` (silent stream release) vs making
   tool-`item.open` auto-detach the only mechanism — the prototype
   implements both (pi relies on the auto-detach; `detach` exists for
   explicit closes). One of the two should probably win.
