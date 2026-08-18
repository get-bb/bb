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
  Most deltas also open a turn implicitly; this exists for signals that carry
  nothing else.
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

## Migration order (post-prototype, if adopted)

acp → codex → claude (task extension lands with it) → delete the kit's
turn-state/scoped-ids/accepted-messages/constructor surface from the SDK →
protocol version bump + conformance kit rewritten around delta
well-formedness. Sequenced before session-mode so the transport carries the
smaller protocol and the conformance kit churns once.

## Open questions for Michael

1. Batch framing: one `thread/delta` per delta vs arrays (prototype: arrays).
2. Does `item.close.item` (reclassification) pay for itself vs making ACP
   emit close+reopen? (Prototype keeps it; ACP's dual-complete needs it.)
3. Where the pi model→context-window catalog lives once usage assembly is
   central (prototype: carried on `usage.turn.modelContextWindow`).
