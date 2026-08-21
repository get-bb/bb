# Narrow-grammar revision of the Provider Bridge Protocol

Status: **cutover complete, live QA PASSED** (2026-08-18, branch
`narrow-grammar-prototype` @ `c0c9b2d8b`). All four bridges emit
`thread/delta`; the `thread/event` path is deleted; protocol version bumped
to 2; `docs/api_to_audit.md` item 1 for `@get-bb/plugin-sdk/provider-bridge`
is resolved as "the protocol owns its own timeline vocabulary".

## Live QA results (2026-08-18)

All four providers were exercised against a real dev instance
(`bb-worktrees-env_2vsqhpeg8u-bb-b304d5affc6b`) with real provider CLIs:
turn lifecycle, tool items, streaming, usage events, mid-turn steer,
interrupt, bridge-release resume (id-collision check), fork, provider
specialties, plus an archive→unarchive→resume round trip and a final
process sweep. Raw evidence: `/tmp/narrow-grammar-gate.md`.

| provider | turn/tools | steer | interrupt | resume (no id collisions) | fork | specialty | errors |
|---|---|---|---|---|---|---|---|
| codex | PASS | PASS | PASS | PASS (new epoch `daf7fe3e6c-`) | PASS | spawnAgent delegation PASS | 0 |
| claude-code | PASS | PASS | PASS | PASS (counters continue, no dupes) | PASS | backgroundTask/subagent PASS (blocking task settled before turn/completed) | 0 (+2 benign `provider/unhandled` background_tasks_changed) |
| pi | PASS | PASS | PASS | PASS | PASS | large-session /compact PASS; tiny-session /compact → finding 1 | 0 (+2 benign queue_update) |
| acp-cursor | PASS | PASS | PASS | PASS | finding 2 (cursor lacks fork; acp fork path verified on opencode) | accept-edits write PASS | 1 system/error (finding 2) |

Zero `provider/error` / `session/replaced` rows for the whole run; no
assembler errors or reconnect loops; the only orphan-snapshot warnings are
the known pre-existing codex pre-turn usage drops; process sweep clean.

Findings to track (neither is a cutover regression; both are byte-identical
to pre-cutover behavior):

1. FIXED (issue #1721, PR #1807 on main; ported to the delta translator):
   pi manual `/compact` on a too-small session used to yield
   `turn/completed{failed}` and an `error`-status thread. The pi delta
   translator now recognizes pi's known refusal messages on a manual,
   non-aborted `compaction_end` and emits a turn-scoped
   `provider.warning{category: "compaction-skipped"}` plus a completed turn
   boundary instead of a failed one.
2. acp-cursor is advertised with `supportsFork: true` but cursor-agent does
   not advertise ACP session/fork, so every fork attempt creates a thread
   that immediately errors ("does not advertise session/fork support",
   guard identical on `origin/main`). The roster capability should be
   corrected or made agent-derived.

### Post-rebase port QA (2026-08-18)

After the rebase, the five provider fixes ported from main into the delta
architecture (`5fc443ada..96ec52ac1`) were live-verified individually
against a fresh dev instance from this worktree (branch @ `61d967e34`);
the full gate was not re-run. Raw evidence: `/tmp/port-qa.md`.

| port | behavior | result |
|---|---|---|
| #1807 (pi compact refusal) | pi thread `thr_jcnpe5eqge`: `/compact` on a tiny session emitted `provider/warning{category: "compaction-skipped", details: "Compaction failed: Nothing to compact (session too small)"}` and `turn/completed{completed}`; thread stayed `idle`, follow-up tell worked | PASS |
| #1663 (pi string content) | same thread: ordinary multi-sentence turn completed with agentMessage text, `thread/tokenUsage/updated`, and `turn/completed{completed}` | PASS |
| #1804 (codex replay guard) | codex thread `thr_36mv73ysnc`: stop → resume produced zero orphan-snapshot / unknown-turn-id log lines for the thread (all existing orphan drops are older, other-thread pre-turn cases), and `thread/contextWindowUsage/updated` arrived thread-scoped before the resumed turn opened | PASS |
| #1623 (claude stop-drain) | claude thread `thr_4f3m3snstf`: mid-turn stop settled `system/thread/interrupted` + `turn/completed{interrupted}` exactly once; 0 `turn/started` from late drain over >13s; next tell opened a fresh turn that completed normally | PASS |
| #1803 (acp classifier glance) | acp-cursor thread `thr_r3xv94btf5` in accept-edits: the write was auto-accepted as a file-change approval (no pending interaction, no command/directory prompt) and the edit landed with the exact requested content | PASS |

QA threads deleted, dev instance stopped, no stray processes.

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

Out of scope for the prototype, designed-for: claude background tasks were
sketched as a named per-provider assembly extension; the claude conversion
resolved this WITHOUT one (generic `backgroundTask` grammar + central
progress throttling; the fold/generation/blocking machine stayed bridge-side
— see the claude results section). Codex's zero-work settlement stays
bridge-side (it is command-plane + timer and emits an ordinary
`turn.open`+`boundary` pair when it fires).

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

## Migration order (adopted; acp + codex + claude converted 2026-08-18)

acp ✓ → codex ✓ → claude ✓ (no task extension was needed — see the claude
results) → delete the kit's
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

## Codex conversion results (2026-08-18, stage 3 of the cutover)

Converted as assessed: the native turn/item notifications mapped ~1:1 onto
deltas carrying codex's own ids as vouched join keys. All 163 codex plugin
tests pass on the new path (the ported per-event + stateful-translator
equivalence suites, the calibration golden — unchanged event stream —,
zero-work, child-exit, archived-resume, session-signature, and the full
conformance run against real fake app-server children); agent-runtime
(incl. pi), acp, provider-bridge-protocol, plugin-sdk all green as a shared-
assembler regression check; @bb/server typecheck untouched-green.

### Line deltas

- Codex translation: `event-translation.ts` 1,094 → `delta-translation.ts`
  1,019 (−75; codex was already parsed-shape-oriented, so the win is the
  *deleted responsibilities*, not raw lines). `translator.ts` 1,476 → 1,494
  (+18): every stateful closure survives as dialect knowledge, now mapping
  over deltas; the raw-output recovery buffers `item.close` deltas instead
  of finished events.
- Codex bridge: `bridge/bridge.ts` 1,965 → 1,724 (−241): the entropy-prefix
  id-stamping layer (`toBridgeId`/`remapEvent`/`remapScope`/`remapItem`),
  the delta-first `item/started` synthesis, the settle/reopen dedup sets,
  and `remapApprovalPayload` are all deleted — they became assembler work.
- Grammar/schema/assembler growth for codex: `thread-delta.ts` 312 → 502,
  `delta-assembler.ts` 1,128 → 1,618 (keyed provider-turn space, the new
  item shapes, item-keyed text/output deltas, exact usage fan-out, thread
  metadata, dedup).

### Grammar additions (deltas added for the codex surface)

10. **Vouched provider-turn keys**: optional `providerTurnId` on turn.open/
    turn.boundary/input.accepted and every turn-scoped delta. The assembler
    holds both-way provider↔bb TURN maps (mirroring the item maps), mints on
    first sight without emitting `turn/started`, and keyed deltas bypass the
    current-turn machinery entirely — several provider turns can be open at
    once (codex multiplexes subagent child turns onto one thread) and a
    keyed `turn.boundary` settles only the named turn, clearing nothing.
    `turn.open` also carries `parentRef` (delegated child turns).
11. **`item.textDelta { key, channel: agentMessage|reasoningSummary|
    reasoningText|plan }`** and **`item.outputDelta { key, channel:
    command|fileChange }`** — item-keyed streaming, split into two kinds so
    codex's synthesis exception is structural: textDelta synthesizes the
    channel's empty `item/started` for an unknown id; outputDelta NEVER
    synthesizes (a commandExecution without its command would be worse than
    the anomaly) but still mints/maps the id so later opens correlate.
12. **Item shapes**: `agentMessage`, `reasoning`, `plan`, `webSearch`,
    `webFetch`, `imageView`; `tool` gains server/result(unknown)/error/
    durationMs; `command` gains aggregatedOutput/exitCode/durationMs (codex
    item payloads carry them wholesale — generic close fields win when both
    are present); fileChange changes gain `movePath` and a provider-built
    `diff` (preferred over old/new-text building).
13. **`item.close.approvalStatus: "denied"`** — codex's completed-declined
    verdict; started events never carry a verdict.
14. **`usage.exact { total, last, modelContextWindow }`** — the provider
    already accumulates; the assembler fans the snapshot out verbatim to
    BOTH usage events (context meter reads `last.totalTokens`), no central
    accumulation.
15. **`turn.plan.explanation`**, **`item.progress.message` now optional**
    (codex progress may carry none), **`turn.diff { diff }`** →
    `turn/diff/updated`.
16. **Thread metadata deltas**: `thread.started`, `thread.identity
    { providerThreadId }`, `thread.name`, `thread.goal`,
    `thread.goalCleared`; **`provider.rateLimits { rateLimits }`** carries
    the normalized `ProviderRateLimitState`.
17. **`provider.error` gains `errorInfo`, `providerTurnId`, `threadScoped`**
    — codex errors are scoped by their own turn id or pinned to thread
    scope; a turnless codex error must never be adopted by whatever turn
    happens to be open. `unhandled` gains `providerTurnId` for the same
    vouching.
18. **`session.reset {}`** — the provider id-space boundary: emitted by the
    bridge at every session construction (start/resume/fork/rebuild), it
    drops the thread's whole assembly state so reused codex-native ids mint
    fresh bb ids (cross-resume id uniqueness under central minting; the fake
    app-server restarts its counters per process, and the old bridge's
    per-session serial prefix did the same job).
19. **Generic settle/reopen dedup moved into the assembler**: a repeated
    `item.close` for a settled provider-identified key is dropped and an
    explicit `item.open` reopens the key under the SAME bb id (codex retries
    terminal notifications after approvals; deterministic prefix ids used to
    make the reopen id-stable, the map reuse does now). Channel-keyed items
    (acp fs-writes, compactions) are exempt — those families legitimately
    close one key repeatedly. Bounded 512 per thread, mirroring the bridge's
    old per-session sets.

### The command plane under central minting (reverse mapping)

- `turn/steer.expectedTurnId` and `thread/stop.activeTurnId` are translated
  bb→provider in `bridge-protocol-adapter.buildCommandPlan` via the
  assembler's reverse turn map; unmapped ids pass through unchanged, so
  thread/event bridges and delta bridges without native turn ids (pi, acp)
  see exactly what they saw before. The codex bridge uses the ids verbatim
  (zero id translation left bridge-side).
- **Fork checkpoints need no runtime mapping**: `turn.boundary` stamps the
  raw codex turn id as `providerCheckpointId` (completed turns only —
  failed/interrupted turns may be absent from the rollout), so persisted
  checkpoints are already provider-native. The bridge keeps a legacy prefix
  strip ONLY in the fork path for checkpoints persisted before the cutover.
- **Interactive/tool-call requests carry `providerNativeIds: true`**: the
  codex bridge forwards its provider-native turn id, approval-subject item
  id, and dynamic-tool call id untranslated, and the adapter's decode step
  maps them onto assembler-minted ids (the server materializes the approval
  row under `subject.itemId`, so it must be the timeline's own item id —
  today's merge behavior preserved). The flag's omission means the ids are
  already app-visible: acp keeps sending raw toolCallIds with `turnId: null`
  and its app-visible behavior is byte-identical (its approval ids never
  matched timeline ids, before or after the acp conversion — remapping them
  would have *changed* acp, so the flag is opt-in per bridge).

### What stayed bridge-side (and why)

- **Rate-limit snapshot merge** (sparse rolling updates inherit windows,
  sticky-while-active `rateLimitReachedType`): seeded from the per-child
  `account/rateLimits/read` post-initialize call the assembler never sees;
  the delta carries the already-normalized state. Less state than teaching
  the assembler a thread-independent hydration channel.
- **Zero-work settlement** (250 ms grace, claim() protocol): unchanged
  correctness, now emitting `turn.open` + `input.accepted` +
  `turn.boundary` on a synthetic `zero-work-N` provider turn key.
- **Native turn-start acceptance correlation**: the FIFO queue still drains
  on the provider's `turn/started` (queued before dispatch because codex
  answers `turn/start` after emitting it); the drained ack rides an
  `input.accepted { providerTurnId }` right behind the `turn.open`, and a
  `turn.boundary` still clears the thread's whole queue.
- **Delegation/subagents**: the whole FIFO/explicit-mapping machine survives
  verbatim, mapping over deltas (parentRef stamped onto turn.open and item
  keys); synthetic spawnAgent rows are ordinary item.open/close deltas on
  the parent's vouched turn. `thread/openWork` is unchanged.
- **Raw shell-output recovery**: buffers its own `item.close` delta until
  the raw record (or the turn boundary) reconciles it; the "empty" recovery
  deletes `aggregatedOutput` from the carried terminal shape.
- **Child-exit settlement rides keyed `turn.boundary` deltas**, not
  `session.ended {reason: exited}` as sketched: the bridge already owns the
  open-codex-turn set for the zero-work gate, and the generic session-ended
  settlement would have added item completions and a `provider/error` event
  codex never emitted on child death (exactness beats the sketch; recorded
  as the resolved deviation). Pre-identity buffering, userMessage echo
  suppression, stale-child suppression, and session rebuild +
  `session/replaced` are otherwise unchanged, with deltas in place of
  events.

## Claude conversion results (2026-08-18, stage 4 of the cutover)

Converted with **no per-provider assembler extension** — the decomposition
verdict on the "task extension" sketched in the prototype plan: the
background-task machine split cleanly into claude dialect (bridge) and
generic grammar/assembler behavior, so the named assembler plugin was never
built. All 259 claude plugin tests pass on the new path (the ported
event-translation base/tool-call/usage shards and the task suite driving the
same fixtures through deltas + a real assembler; the bridge suite; the
scripted-session calibration golden — **byte-identical event stream** —; and
the full conformance run). Regression: provider-bridge-protocol,
agent-runtime (incl. pi), acp, codex, plugin-sdk all green; @bb/server
typecheck untouched-green.

### The decomposition (bridge dialect vs. generic grammar/assembler)

- **Bridge-side (claude dialect, `delta-translation.ts` +
  `task-translation.ts`):** the per-index workflow snapshot fold across
  delta batches, opaque-task tracking, generation counting (a restarted
  settled task is a NEW provider item key `task:<taskId>#<generation>`), the
  completion-blocking decision (while blocking tasks are open the bridge
  WITHHOLDS `turn.boundary` when claude's `result` arrives; the boundary is
  emitted when the last blocking task settles because the reinvoked model's
  next result finds no blockers), interruption settlement (interrupt /
  session replacement / stream end drain the task map into explicit
  `item.close` deltas with last-known-finished-else-stopped statuses, after
  the `turn.boundary {interrupted}`), the armed hard rate-limit rejection,
  the compaction stale-turn guard, model-fallback dedup, the started-tool
  shape cache (USER-message tool results omit args; uniform close rule), the
  root-lineage checkpoint latch, and the model→context-window hint.
- **Grammar additions (generic, mirroring today's canonical output):** a
  `backgroundTask` item shape (the full snapshot re-embedded per event),
  `item.progress.snapshot` + `item.progress.flush`, `provider.modelFallback`
  (currentOrLast-else-thread scoping), `webFetch.prompt`, and
  webSearch/webFetch closes honoring the generic `resultText` close field.
- **Assembler additions (generic, every provider gets them):** central
  progress-event throttling — one emission per item key per policy interval
  (constructor option, 500ms default, exactly the cadence claude hand-rolled),
  seeded at `item.open`, `flush` bypasses and resets the window, `item.close`
  always emits and supersedes pending progress; background-task family
  events; thread-attached open items survive turn settlement AND
  `session.ended` settlement (their lifecycle is provider-owned — bridges
  drain them explicitly); and the LRU eviction guard now pins threads with
  open items or open turns (replacing the old `isEvictable` hook — the old
  opaque-task pinning protected bridge-side state that now lives in the
  bridge's own per-session translator, so nothing assembler-side needs it).

### The turn mirror (how per-turn dialect decisions survive without bb ids)

The old translator compared bb turn ids for the armed rejection, fallback
dedup, the compaction guard, the synthetic no-response rule, and
`resolveProviderTerminalTurn`. The bridge now keys those off a deterministic
MIRROR of the assembler's current-turn machine: since turn opening/closing is
decided ONLY by deltas the bridge itself emits (`turn.open`, `turn.boundary`,
`input.accepted`, settling errors — item/stream deltas never open turns), the
bridge replays those transitions locally (turnOpen / pendingInputs / a
segment counter standing in for the turn id). Old `ensureTurnStarted` call
sites became explicit `turn.open` deltas (idempotent in the assembler);
`resolveProviderTerminalTurn` became "emit nothing when the mirror says idle
with no pending input, else `turn.open` first" — reproducing the claim's
event order (turn/started, accepted, contextWindow, usage, error?, boundary)
exactly.

### Line deltas

- Claude translator: `event-translation.ts` 1,633 → `delta-translation.ts`
  1,496 (−137); `task-translation.ts` 480 → 467 (its throttle clock and
  event construction left; the fold stayed); `sdk-extraction.ts` 393 → 383
  (cumulative accumulation moved to the assembler; the bridge reports the
  per-segment usage on `usage.turn`).
- Claude bridge: `bridge/bridge.ts` 2,683 → 2,609 (−74): the per-session
  translator entropy, the thread-event emission layer, the accepted-message
  queue dance, and the hand-built interrupt/replacement settlement collapsed
  into delta emissions (`acceptInput`, `buildSessionSettlementDeltas`,
  `session.reset` at each construction).
- Grammar/schema/assembler growth for claude: `thread-delta.ts` 502 → 558,
  `delta-assembler.ts` 1,618 → 1,864 (throttle policy, backgroundTask
  construction/scoping, thread-attached retention, eviction guard).

### How the notable claude behaviors mapped

- **Multi-segment turns / cumulative usage:** claude's per-segment result
  usage rides `usage.turn`; the assembler's per-thread accumulation
  reproduces the old translator's cumulative totals exactly (both reset per
  provider session — the bridge emits `session.reset` at every construction,
  matching the old fresh-translator-per-session behavior).
- **Background-task scoping:** no `attach: "thread"` knob was added. The
  domain grammar already makes `item/backgroundTask/progress`/`completed`
  structurally thread-scoped and `item/started` turn-scoped, so the
  assembler derives the scope from the item family — today's exact scoping
  (spawning turn places the item; progress/terminal are thread-scoped and
  need no open turn) with no ignorable flag.
- **Interaction requests:** the bridge sends `turnId: null` +
  `providerNativeIds: true`; the runtime resolves the active turn (the ACP
  mechanism) and remaps the approval subject's claude tool-use id onto the
  assembler-minted timeline item id (the codex mechanism).
- **Session lifecycle:** interrupt/replacement/stream-end settle via an
  unkeyed `turn.boundary {interrupted}` + the explicit task drain — NOT
  `session.ended` — mirroring codex's recorded deviation: generic
  session-ended settlement would add item/completed events for open tool
  items that old claude deliberately left dangling on interrupt.

### Behavior deviations (claude)

- **Trailing-edge throttle flushes only on later thread traffic.** The
  assembler seam is synchronous (no timers), so a suppressed progress
  snapshot lands ahead of the thread's next delta batch once its window
  elapses; a newer progress or the close supersedes it. Old claude simply
  dropped suppressed snapshots (safe because they are cumulative and the
  terminal event carries final state) — the new behavior is a superset that
  can emit one late progress event old claude never emitted.
- **Unstreamed assistant completions no longer reuse claude's message id.**
  The old translator used the provider message id (`msg_…`) as the completed
  agentMessage item id when no stream had opened; ids are assembler-minted
  now (ids-by-shape, consistent with the other conversions).
- The old translator-level `buildErrorEvents` fabricated a failed turn even
  on an idle thread when given a thread id; the delta translator reproduces
  that (turn.open + settling error) and the bridge keeps gating it on an
  open mirror turn, so wire behavior is unchanged.

## Final results (2026-08-18, stage 5: single-dialect cutover)

The `thread/event` ingestion path is deleted end to end and exactly one
protocol dialect remains:

- **Protocol**: `BRIDGE_NOTIFICATION_METHODS.threadEvent`,
  `threadEventNotificationSchema`, and the adapter's thread/event branch are
  gone. `PROVIDER_BRIDGE_PROTOCOL_VERSION` 1 → 2; the runtime's required
  post-initialize handshake now rejects a mismatched version with a legible
  startup error (a v1 bridge would otherwise connect and show an empty
  timeline), and the conformance kit's handshake scenario fails a
  wrong-version answer. The conformance kit's grammar checks still run over
  canonical ThreadEvents, on a kit-internal lane
  (`conformance/assembledEvent`) fed by the shared
  `toConformanceMessages` transport helper (deltas through a real
  assembler); the four bridge conformance suites and the stub-bridge kit
  test all ride it.
- **Kit deletion**: turn-state (289 + 196 test), scoped-item-ids (97),
  accepted-user-messages (82), provider-terminal-turn (33),
  tool-item-translation (221 + 30 test), provider-unhandled-event
  (113 + 70 test), unstamped-thread-id (9; the branded constant moved into
  the assembler, its only consumer) — 1,140 lines out of the kit, none of
  it published anymore. Their invariants are pinned by the
  delta-assembler suite (queue/drain, claim-if-idle, uniform close,
  vouched-turn scoping, LRU pinning), so no kit tests needed porting.
- **SDK surface**: 192 exports at the branch base → 216 mid-branch (the
  delta grammar's schemas/types added) → **184** after the cutover
  deletions (the assembly machinery, the orphaned
  `buildEditDiff`/`withParentToolCallId`, and every `@bb/domain` re-export
  with zero bridge consumers: the ThreadEvent event vocabulary,
  `threadScope`/`turnScope` + scope helpers, `NONE_REASONING_EFFORT`,
  `createStandaloneBuiltinCompactCommandInput`). Audit item 1 resolved:
  the protocol owns its timeline vocabulary; what remains from `@bb/domain`
  is the command-plane/interaction surface the params are made of plus the
  enum/status types the delta shapes reference.
- **Per-bridge translator deltas across the branch** (from the stage
  sections above): pi 1,259 → 898 (−361, plus bridge −61); acp
  1,135 → 845 (−290, bridge −35); codex 1,094 → 1,019 (−75, bridge −241,
  translator +18); claude 1,633 → 1,496 (−137, task-translation −13,
  sdk-extraction −10, bridge −74). Every per-bridge turn-state /
  scoped-id / accepted-queue / accumulation copy is gone.
- **New shared code final sizes**: `thread-delta.ts` 555 (grammar schemas),
  `delta-assembler.ts` 1,875 + `delta-assembler.test.ts` 1,808 — one
  assembler bought four bridges' assembly layers plus the kit's published
  machinery.
- **Whole branch, excluding bundled d.ts and lockfile**: 74 files,
  +11,158 / −10,224 (net +934, and −2,752 with the generated d.ts). The
  raw net is dominated by the assembler's own new suite (+1,808) and the
  heavy doc comments on the grammar; the deletion landed where it was
  aimed — the published surface (kit −1,140 lines, SDK 216 → 184 exports)
  and the four per-bridge assembly copies.
- Board: provider-bridge-protocol, agent-runtime (incl. pi + conformance),
  plugin-sdk, acp, codex, claude plugin suites all green after each stage;
  see the repo history for the per-commit runs.

## Text-delta batching (2026-08-18, post-cutover; ENABLED at 100ms)

The central assembler seam made per-token event volume a one-knob policy:
the assembler now coalesces streamed-text events (assistant/reasoning/plan
deltas via `message.delta`/`item.textDelta`, and command/fileChange
`item.outputDelta` including the assembler's own snapshot-diff output) per
stream within a flush window. **Production default is ON at 100ms**
(`textDeltaFlushMs`, a `createDeltaAssembler` option threaded through
`AgentRuntimeOptions` → adapter factory → `bridge-protocol-adapter`; 0
disables, no per-provider config).

Design (same no-timer trailing-edge discipline as the progress throttle):

- Coalescing = concatenation per stream (event type + item id); the emitted
  event is the same event type carrying the joined text.
- The FIRST delta of a fresh stream emits immediately — perceived
  time-to-first-token is unchanged; only the steady-state cadence drops to
  ~one event per window.
- Buffers flush synchronously: on the thread's next traffic once the window
  elapsed, on stream close (`message.close` including the detach release,
  `item.close` even when deduped), and before ANY non-batchable event for
  the thread — the ordering barrier. Coalescing never reorders text
  relative to item opens/closes, turn events, errors, or other streams'
  flushes (a flush is itself a barrier: one due buffer carries every
  buffer out, in arrival order).
- An output-delta `reset` (snapshot restart) can never be absorbed: the
  pending buffer flushes first, then the reset emits unmodified.
- **`session.reset` FLUSHES buffered text rather than dropping it** —
  deliberately different from the progress throttle's drop. A suppressed
  progress snapshot is superseded by the terminal event, so dropping loses
  nothing; dropped text would be lost for good. The buffered events were
  fully assembled (scope, item id) when the old session's deltas arrived,
  so flushing them ahead of the reset can never attribute text to the new
  session. `session.ended` flushes before settlement for the same reason.
- The per-bridge equivalence/conformance/calibration suites pin translation
  fidelity per-delta: they construct assemblers with `textDeltaFlushMs: 0`
  (via the shared `bridge-delta-assembly` test helper and the direct
  harness constructions), so every golden stayed byte-exact. The dedicated
  batching suite in `delta-assembler.test.ts` covers the policy with an
  injected clock.

Measured on a representative chatty turn (40 reasoning tokens + 200
assistant tokens at 20ms cadence, 60 cumulative bash output snapshots at
50ms): 310 events at window 0 → 92 events at 100ms (−70%), with identical
final item text.

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
