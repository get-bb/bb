# Claude Code Workflows + Ultracode in BB

Support Claude Code's Workflows feature end-to-end in BB: enable the feature for claude-code
threads, add the `ultracode` effort level, translate the SDK's task/workflow event family into
BB thread events, and render a live workflow progress tree in the thread timeline.

Research basis: SDK `@anthropic-ai/claude-agent-sdk` 0.3.159 typings + the CLI 2.1.160–162
binaries (minified JS reverse-engineered for the exact emitter shapes and UI semantics), then
adversarially verified against the BB codebase. Key findings are inlined so this plan is
self-contained.

---

## 1. Background: the contract we must handle

### 1.1 How a workflow run looks on the SDK wire

1. Assistant emits a `tool_use` for the `Workflow` tool (input: `script` | `scriptPath` | `name`,
   plus `args`, `resumeFromRunId`).
2. `system/task_started` — `{task_id, tool_use_id, description, task_type: "local_workflow",
   workflow_name, prompt (= script text), skip_transcript?}`.
3. The tool_result returns **immediately** with `WorkflowOutput {status: "async_launched", taskId,
   runId, scriptPath, transcriptDir, error?}`. The turn may end while the workflow keeps running.
4. Stream of:
   - `system/task_progress` — `{task_id, description, usage: {total_tokens, tool_uses,
     duration_ms}, last_tool_name?, summary?, workflow_progress?}`. `workflow_progress` is
     emitted by current CLIs (verified present in 2.1.160–162; exact introduction version
     unconfirmed) but is **untyped in SDK 0.3.x** — it carries the progress tree (§1.2).
     CLI-side batches flush every 16ms; BB must coalesce.
   - `system/task_updated` — `{task_id, patch: {status?: pending|running|completed|failed|killed|
     paused, description?, end_time?, total_paused_ms?, error?, is_backgrounded?}}`. Patch is a
     diff; clients merge.
5. Terminal `system/task_notification` — `{task_id, status: completed|failed|stopped, output_file,
   summary, usage?}`. `stopped` also results from the `stop_task` control request; `paused` (via
   TaskStop pause) is resumable with `Workflow({scriptPath, resumeFromRunId})`.
6. After completion the CLI injects a task-notification prompt that wakes the model — BB will see
   a **provider-initiated turn** with no `client/turn/requested` behind it. (Server side this is
   already handled: `applyEventEffects` transitions idle/error threads to active on a bare
   `turn/started`, `apps/server/src/internal/events.ts:351-366`.)

**The same four events also fire for non-workflow tasks — including ordinary foreground Task-tool
subagents** (that is why `task_started` etc. already appear as observed "noise" in
`visibility.ts` today, with workflows never enabled). Raw `task_type` discriminants: `local_bash`,
`local_agent`, `local_workflow`, `monitor_mcp`, `mcp_task`, `in_process_teammate`,
`remote_agent`, `dream`. Foreground subagents are already rendered by BB's delegation rows; see
D3's suppression rule. `skip_transcript: true` marks ambient/housekeeping tasks to hide from the
inline transcript.

Workflow-spawned subagents are **not** separate tasks — they emit no task events of their own.
Their entire state rides inside `workflow_progress`. Their permission prompts arrive through the
normal `canUseTool` path and already surface as BB pending interactions (no task linkage; fine).

### 1.2 `workflow_progress` is a **delta batch**, not a snapshot

Each `task_progress.workflow_progress` array contains only the records produced since the last
16ms CLI flush — one event may carry only agent #3's record while agents 1–2 are unchanged.
Each individual record is cumulative **for its `(type, index)` key**, and a later record for the
same key supersedes earlier ones *across events*. Consumers must fold every incoming array into
a per-task map keyed by `(type, index)`; treating one event's array as the full tree silently
drops agents. Record kinds:

- `workflow_agent`: `{type, index (1-based), label, phaseIndex?, phaseTitle?, agentId?,
  agentType?, isolation? ("worktree"|"remote"), model, state: "start"|"progress"|"done"|"error",
  queuedAt?, startedAt?, lastProgressAt, attempt?, lastAttemptReason? ("throttled"|"user-retry"|
  "stalled"), lastToolName?, lastToolSummary?, promptPreview?, resultPreview?, error?, skipped?,
  cached?, tokens?, toolCalls?, durationMs?, remoteSessionId?}`
- `workflow_phase`: `{type, index (1-based), title, kind? ("child" for nested `workflow()` runs)}`.
  `meta.phases` titles are seeded as phase records at VM start, so declared phases appear before
  any agent runs.
- `workflow_log` — **never reaches the SDK wire**: the CLI filters log records out of the
  emission path unconditionally. Narrator lines are interactive-CLI-only; BB must not design UI
  around them (verified in 2.1.160–162).

Derived per-agent display status (copy of the CLI's canonical mapping):

```
done                          -> "done"      ✔ success   "Completed"
error && skipped              -> "skipped"   ✘ muted     "Skipped"
error                         -> "failed"    ✘ error     "Failed"
workflow no longer running    -> "interrupted" ◌ muted   "Stopped"
queuedAt set && !startedAt    -> "queued"    ◌ muted     "Queued"
else                          -> "running"   (shimmer)   "Running"
```

Aggregates: `agentCount = max start index`, `totalTokens`/`toolCalls` = Σ over agent records.

### 1.3 Enablement + ultracode (SDK `Settings`)

Workflows are enabled iff **all** of (verified against the CLI binary):
1. Not disabled: env `CLAUDE_CODE_DISABLE_WORKFLOWS` unset **and** `settings.disableWorkflows !==
   true` in any merged tier (note: BB loads `settingSources: ["user","project","local"]`, so a
   host user's own settings can disable — that is acceptable/desired behavior, not a BB bug);
2. the `allow_workflows` org policy gate passes;
3. the remote flag `tengu_workflows_enabled` is on (default true when unfetched). **Env
   `CLAUDE_CODE_WORKFLOWS=1` does NOT force availability** — it only changes the default used
   when `enableWorkflows` is unset; since BB sets `enableWorkflows: true` explicitly, the env var
   is redundant and we omit it. The remote flag remains a residual external kill switch;
4. user opt-in: `settings.enableWorkflows ?? defaultOn`.

`ultracode?: boolean` — "xhigh effort plus standing dynamic-workflow orchestration.
Session-scoped — typically provided via --settings or the apply_flag_settings control request.
Requires workflows to be enabled and an xhigh-capable model." When set, the CLI forces effort to
xhigh. CLI effort resolution order: `Options.effort` → `settings.ultracode === true → "xhigh"` →
`settings.effortLevel`.

Delivery for an SDK consumer: `Options.settings: Settings` (the flag tier — highest-priority
user-controlled tier). BB currently passes **no** `Options.settings`, so the flag tier is free
for us to own. The SDK exports the `Settings` type, so this is typed with no casts.

### 1.4 What BB does with these messages today

The bridge forwards every `SDKMessage` verbatim. `translate-message.ts` drops all of them:
`task_started`/`task_updated`/`task_progress`/`task_notification`/`thinking_tokens` fall through
the `system` case to `return []` at `translate-message.ts:333` and are classified
`coverage: "noise"` (`packages/agent-runtime/src/claude-code/visibility.ts:441-446`) →
completely invisible. Top-level `tool_progress`/`tool_use_summary` fail
`claudeSdkMessageTypeSchema` → surface as opaque `provider/unhandled` debug rows.
`system/session_state_changed` hits the unknown-subtype default → `provider/unhandled`.
`status: null` (compaction end) is dropped, leaving `contextCompaction` items dangling
(`item/started` with no completion — confirmed: the adapter never emits `item/completed` for
compaction).

---

## 2. Design decisions

### D1. Ultracode is a new `ReasoningLevel` value, not a separate field

Add `"ultracode"` to `reasoningLevelValues` — **positioned between `"xhigh"` and `"max"`**.
Position is load-bearing: `reasoningRank` = array index drives `reconcileReasoningLevel`'s
distance-based reconciliation, and ultracode's real effort is xhigh — when a thread switches to
a model without ultracode support, reconciliation should land on `xhigh` (distance 1), not
silently escalate to `max`. The picker may still present Ultracode last/visually distinct;
label order is independent of rank.

Rationale for enum-not-field: Claude Code's own `/effort` presents ultracode as an effort level;
BB's entire selection/persistence/override chain (picker → contract → execution plan → thread
override column → turn-request event payload → daemon options) is keyed on `ReasoningLevel` and
extends to a new enum value with near-zero new plumbing. The claude-code adapter decomposes it at
the boundary: `effort: "xhigh"` + `Options.settings.ultracode: true`. (`session-options.ts:214`
currently passes `reasoningLevel` directly as SDK `effort`, so the new enum value is a compile
error there — the decomposition is compiler-forced.) Codex/pi reject it via their per-provider
validity lists, and codex's exhaustive `toCodexReasoningEffort` switch makes that a compile-time
decision too.

Per-thread changes ride the existing mechanism: `sameExecutionSettings` detects the change →
`reconfigureThreadIfNeeded` → `thread/resume` → the bridge **closes the session (killing the CLI
process) and starts a fresh `query()`** with new `Options.settings`. Consequence (see risk #5):
any mid-thread execution-settings change kills in-flight workflows. Acceptable for v1;
`apply_flag_settings` is the future optimization that would avoid the restart.

### D2. Workflows enablement is server-owned policy, passed explicitly

Per AGENTS.md, the server owns product policy and defaults are filled at the server boundary and
passed as explicit values. The server fills `workflowsEnabled: true` (constant policy for the
claude-code provider, decided in `thread-default-policy.ts`/execution-plan assembly) into the
execution options sent with `thread.start`/`thread.resume`/`turn.submit`. The daemon/adapter
translates it mechanically: `Options.settings = { enableWorkflows: true, ...(ultracode ? {
ultracode: true } : {}) }`. This costs nothing extra — M5 already bumps
`HOST_DAEMON_PROTOCOL_VERSION` — and gives a server-side kill switch for free (flip the policy
constant; managed `config.json` is the precedent if it ever needs to be host-configurable).

Availability ≠ spontaneous fan-outs: the Workflow tool's own opt-in rules (explicit user request /
ultracode) govern when the model actually uses it. Host-level user/org disables still win (§1.3),
which is correct: BB requests the feature, the host's policy stack decides.

### D3. One new item type `backgroundTask`; v1 materializes workflows only

Model the task as a first-class thread item (not a parsed-out `toolCall` like delegation),
because tasks outlive their tool call, carry their own status ladder, and progress by patch.
Workflow agents cannot reuse delegation `childRows`: workflow subagents emit no events of their
own (`parent_tool_use_id`-stamped child events physically don't exist for them).

**Suppression rule (prevents double rendering).** Foreground Task-tool subagents emit this same
event family and are already rendered by delegation rows. v1 materializes `backgroundTask` items
**only for `task_type === "local_workflow"`**. All other task types are parsed + classified
`"normalized"` (no item) — a follow-up can materialize backgrounded shells/agents
(`patch.is_backgrounded === true` or no corresponding foreground delegation rendering) once a
deliberate merge rule with delegation rows is designed. The M0 fixture corpus must include a
plain foreground subagent run to lock this in.

- **Item**: `backgroundTask` in `threadEventItemSchema` — `{id (= "task:" + task_id), taskType:
  string (required; adapter fills "unknown" when the SDK omits it), workflowName?, description,
  status (existing pending|completed|failed|interrupted), taskStatus, skipTranscript: boolean
  (required; adapter fills false — per AGENTS.md, no optionality to hide defaults),
  parentToolCallId? (= tool_use_id), workflow?: WorkflowProgressSnapshot, usage?: {totalTokens,
  toolUses, durationMs}, error?, summary?, outputFile?}`.
- **Status mapping** (`taskStatus` = provider-reported current state, preserved verbatim;
  `status` = the shared item-machinery derivation):

  | taskStatus | item status |
  |---|---|
  | pending, running, paused | pending |
  | completed | completed |
  | failed, killed | failed |
  | stopped | interrupted |

  `paused` stays `pending` (it is resumable); if a `thread/resume` later kills the session, the
  reconciliation below settles it as `interrupted` like any other non-terminal task.
  `is_backgrounded` is carried in the snapshot verbatim (workflows are always backgrounded;
  field matters for the future generic-task follow-up).
- **Events + scoping (pagination-safe by construction).** The naive choice — turn-scoping all
  lifecycle events to the spawning turn — breaks the server timeline: late turn-scoped rows
  interleave (by sequence) inside later turns' windows, making `buildTimelineTurnSummaryDetails`
  400 on lazy turn expansion, and older pages can never contain the late `item/completed`, so
  the row pins "pending" forever once it scrolls out of the latest window. Instead:
  - `item/started` — generic, **turn-scoped** to the spawning turn (emitted while that turn is
    open; preserves per-turn sequence contiguity and gives timeline placement + nesting under
    the Workflow tool call via `parentToolCallId`).
  - `item/backgroundTask/progress` — new event, **thread-scoped**, `{itemId, snapshot}`.
  - `item/backgroundTask/completed` — new dedicated event, **thread-scoped**, full final payload
    (we cannot reuse generic `item/completed`: its scope policy is per-event-type and must stay
    turn-scoped for every other item kind).
  - Timeline assembly backfill: for any in-window `backgroundTask` `item/started` without an
    in-window terminal event, fetch the latest progress/completed rows for those `itemId`s (one
    targeted indexed query, mirroring `ensureTimelineWindowTurnStartedRows`) and feed them to the
    projection. This is what keeps old pages truthful after the workflow settles pages later.
- **Snapshot semantics**: `item/backgroundTask/progress` carries the **full merged current
  state** (BB-typed `WorkflowProgressSnapshot`: phases[], agents[], usage, taskStatus — no logs,
  per §1.2). The adapter folds incoming `workflow_progress` delta batches by `(type, index)` into
  per-task state and emits superseding snapshots, so each progress event replaces the previous
  one and resolved rows are prunable.
- **Adapter-side state**: a **thread-lifetime** `tasksById` map. Explicitly *not* inside the
  transient turn state (`clearTransientTurnState` wipes `state.toolItemsByCallId` on every turn
  boundary, and `pruneInactiveEntries` evicts idle threads — exactly the state of a thread with
  a running workflow). Either a new adapter-state field excluded from the transient wipe with a
  prune guard treating open-task threads as active, or a separate per-thread map in the adapter
  closure with its own eviction rule. Emission cadence: throttle to ≥500ms between progress
  events per task, with immediate flush on `taskStatus` transitions.
- **Zod posture**: `workflow_progress` is undocumented — parse with permissive schemas
  (`.passthrough()`/`.catch()` on record fields, unknown record kinds ignored) so CLI additions
  never break translation. The adapter normalizes raw records into BB-typed snapshot objects at
  the boundary (no `unknown` escapes the adapter).

### D3b. Reconciliation (AGENTS.md async-lifecycle rule — every failure mode named)

A workflow dies with its CLI process; the lifecycle must never leave a row shimmering forever.

| Failure mode | Owner | Mechanism |
|---|---|---|
| `thread/resume` (settings change, reconnect re-resume) | adapter | `translateAcceptedCommand` hook: synthesize `item/backgroundTask/completed` `{status: interrupted}` for every non-terminal task in `tasksById` before the new session starts |
| Bridge/CLI process exit | runtime + daemon | the daemon's `buildUnexpectedProviderExitEvents` only covers *active* threads — an idle thread with a running workflow gets nothing today. Extend the runtime's `onProcessExit` pathway to consult open background tasks (runtime already receives it, `runtime.ts:205`) and emit the interrupted completions for affected threads |
| Daemon process crash (in-memory `tasksById` lost) | **server backstop** | on daemon session re-registration (the existing `reconcileDaemonReportedThreads` path) the server closes any open `backgroundTask` items belonging to sessions that no longer exist, appending the interrupted completion itself. The server is the durable lifecycle owner; the adapter paths above are fast paths |
| Late/unknown `task_id` events after restart | adapter | ignore + capture note; the server backstop already settled the item |
| Repeated `task_started` for a known id (resume) | adapter | reopen: emit a fresh `item/started` only if the prior item is terminal; otherwise treat as progress |
| Watchdog interplay | server | add `item/backgroundTask/progress` to `providerTurnWatchdogActivityEventTypeValues` so a turn legitimately waiting on a workflow isn't stopped at the 15-minute inactivity cutoff |

### D4. Timeline rendering: new `workflow` work row

`workKind: "workflow"` (`TimelineWorkflowWorkRow`): workflowName, description, taskStatus,
phases[{title, detail?, status, agents[]}], flat agents fallback (no phases → single group),
usage, error. No narrator/log line (§1.2 — logs never reach the wire). `skip_transcript` tasks
are persisted but not emitted as timeline rows. The generic `background-task` row is **deferred**
with the rest of non-workflow materialization (D3 suppression rule).

### D5. Event subtypes beyond the task family

| SDK message | Disposition |
|---|---|
| `system/status` value `null` | already `"normalized"` in visibility; the actual work: emit `item/completed` for the open `contextCompaction` item on compaction end (today it dangles) |
| `system/session_state_changed` | parse in schemas.ts, classify `"normalized"`, drop in v1. Note: its `state: "idle"` is the authoritative bg-agent turn-over signal — the candidate primitive if risk #1 validation shows we need explicit idle handling |
| `system/thinking_tokens` | parse + `"normalized"`, drop in v1; stretch: live token count in the working indicator |
| `tool_progress` (top-level) | add to `claudeSdkMessageTypeSchema`; map to existing `item/toolCall/progress` (heartbeat elapsed) keyed by `tool_use_id` |
| `tool_use_summary` (top-level) | add to schema; classify `"normalized"`, drop in v1 (no UI concept yet) |

---

## 3. Implementation milestones

### M0 — SDK bump + fixtures

- Bump `@anthropic-ai/claude-agent-sdk` to latest (≥0.3.162) in
  `packages/agent-runtime/package.json`; resolve any type fallout.
- Record a real capture corpus with `replay-capture`: (a) a claude-code session launching a small
  workflow — raw `sdk/message` lines for all four task subtypes including `workflow_progress`
  delta batches (a later `task_progress` must omit earlier agents, to encode delta semantics in
  tests); (b) a plain **foreground Task-tool subagent** run (locks in the D3 suppression rule).
  Store in `@bb/agent-fixtures`.
- Document the host CLI floor as "the version BB tests against" (workflow_progress verified in
  ≥2.1.160); surface via existing `provider-cli-health` version reporting. No hard gate — without
  the field BB still gets start/usage/terminal events and renders a degraded row.

**Exit criteria**: typecheck green across repo; fixture files exist covering both scenarios.

### M1 — Domain + DB + server plumbing for `backgroundTask`

1. `packages/domain/src/provider-event.ts` — `backgroundTask` variant in `threadEventItemSchema`;
   new `item/backgroundTask/progress` + `item/backgroundTask/completed` events in
   `unscopedProviderEventSchema`; BB-owned `WorkflowProgressSnapshot` types in domain.
2. `packages/domain/src/thread-event-scope.ts` — scope entries: progress + completed **thread**;
   (item/started stays generic/turn).
3. `packages/domain/src/provider-turn-watchdog.ts` — add `item/backgroundTask/progress` to the
   activity whitelist (D3b).
4. `packages/db/src/stored-event-item-fields.ts` — add both new event types to the `itemId`
   switch. (`item_kind` is plain TEXT — **no SQL migration**.)
5. `apps/server/src/internal/events.ts` (`resolveProviderIdentifiers`) — new cases (default throws).
6. Pruning: a **new** keep-latest-while-pending prune for `item/backgroundTask/progress`
   (precedent: the thread-scoped usage-event prune at `events.ts:1583-1624`), plus completed-
   gated cleanup. Note `pruneResolvedItemDeltas` keeps the *earliest* delta by design (it anchors
   `sourceSeqStart`) — mirror that: keep first + latest. Pruning runs on the existing throttled
   sweep cadence; the 500ms adapter throttle is what bounds growth between sweeps.

**Exit criteria**: `pnpm exec turbo run typecheck --filter=@bb/domain --filter=@bb/db` green;
unit test appending started→progress*→completed via in-memory SQLite
(`createConnection(":memory:")` + `migrate(db)`) shows `item_id` correlation and prune behavior
(first + latest progress rows survive while pending; superseded rows dropped after completion).

### M2 — claude-code adapter translation

1. `packages/agent-runtime/src/claude-code/schemas.ts` — zod schemas for the four task subtypes
   (permissive `workflow_progress`), `thinking_tokens`, `session_state_changed`, plus top-level
   `tool_progress` / `tool_use_summary` added to `claudeSdkMessageTypeSchema`.
2. `translate-message.ts` — new branches in the `system` case before the `return []` at :333;
   new top-level cases. Thread-lifetime `tasksById` (per D3), delta-fold by `(type, index)`,
   throttle + status-flush, `ensureTurnStarted` for the spawning turn, `parentToolCallId` from
   `tool_use_id`, suppression rule (materialize `local_workflow` only).
3. `visibility.ts` — flip handled subtypes from `"noise"` to `"normalized"`; extend
   `parseClaudeRawEvent` for the new top-level kinds + `session_state_changed`.
4. Reconciliation fast paths per D3b: `translateAcceptedCommand` on `thread/resume`; runtime
   `onProcessExit` pathway for bridge exit.
5. Codex/pi adapters: no translation (claude-only events by construction); confirm their
   visibility fallbacks unaffected.

**Exit criteria**: `adapter.test.ts` + `replay-translation.test.ts` cover: full lifecycle from
fixtures (delta-fold asserted: agents from earlier batches survive later partial batches); one
`item/started`, ≥1 throttled progress, one terminal completed with final usage; killed/stopped/
paused/interrupted mappings per the D3 table; foreground-subagent fixture produces **zero**
backgroundTask items; `skip_transcript` passthrough; `tool_progress` → `item/toolCall/progress`;
thread/resume reconciliation. Run via
`pnpm exec turbo run test --filter=@bb/agent-runtime --force > /tmp/test-out.txt 2>&1`.

### M2b — Server lifecycle backstop

- Extend the daemon-session re-registration reconciliation (`reconcileDaemonReportedThreads`
  path) to settle dangling open `backgroundTask` items as `interrupted` (D3b row 3).

**Exit criteria**: integration test — persist started+progress, simulate daemon session
re-registration without the thread, assert the server appended the interrupted completion and
the timeline row settles.

### M3 — Timeline projection + contract rows

1. `packages/server-contract/src/thread-timeline.ts` — `TimelineWorkflowWorkRow` (per D4) joined
   into `timelineWorkRowSchema`.
2. `packages/thread-view/` — lifecycle parsing for the new events (map
   `item/backgroundTask/completed` to the `end` phase of the exec-lifecycle machinery),
   projection upsert keyed by itemId (latest snapshot wins), wiring in
   `build-event-projection.ts` + `build-thread-timeline.ts`; exhaustive switches in
   `timeline-view.ts` and `event-decode.ts` enumerate the rest at compile time. Skip rows for
   `skipTranscript` tasks.
3. Window backfill in `apps/server/src/services/threads/timeline.ts`: latest progress/terminal
   rows fetched for in-window backgroundTask items (D3 scoping design).
4. Titles in `timeline-row-title.ts` (`mapWorkflowTitle`): running — `Running workflow` +
   em(name) + `(3/8 agents)` decoration + live duration (shimmer verb); terminal — `Ran workflow`
   / `(error)` / `(interrupted)` + `· 1.1m tok` usage decoration.

**Exit criteria**: thread-view unit tests project the fixture sequence into a single workflow row
whose phase/agent statuses match §1.2's table. **Pagination test (regression for the verified
failure mode)**: complete a workflow N user-messages after the spawning turn; assert (a) the
spawning turn's lazy detail expansion and a later turn's expansion both succeed (no 400), and
(b) the page containing the spawning turn renders the row terminal, not pending, via backfill.

### M4 — Frontend renderer

All in `apps/app/src/components/thread/timeline/`, composing existing primitives only:

1. `timeline-auto-expand.ts` — workflow rows expandable + auto-expand while running (delegation
   precedent).
2. Body: branch in `TimelineExpandableBody` → `WorkflowRowBody`: phase groups (collapsible header
   per phase with `done/total` + status), agent rows reusing the todo-checklist idiom
   (`TodoStatusIcon` styling) — glyph/color per §1.2 table, label, dim stats
   `agentType · model · 12.4k tok · 7 tools · 1m32s`, error text appended for failures;
   `TimelineDetailScroll` delegation tier; `NESTED_ROWS_GROUP_LINE_CLASS` guide line.
3. `timelineRowSignatures.ts` — signature branch covering taskStatus, per-agent states, usage
   (memo equality must break on every progress-mutated field).
4. Stories: `rows/Workflow.stories.tsx` — running (phases + queued/running/done/failed/skipped
   agents), completed, failed, interrupted, no-phases flat list, degraded (usage-only, no
   workflow_progress).
5. Tokens only — no `text-[Npx]`; statuses use sanctioned tones.

**Exit criteria**: stories render all states; live dev-run validation (§5) shows updates ticking
through the existing `events-appended` → invalidate → refetch loop with no new realtime plumbing.

### M5 — Ultracode effort level

1. `packages/domain` — insert `"ultracode"` between `"xhigh"` and `"max"` in
   `reasoningLevelValues` (rank rationale in D1); new `ULTRACODE_REASONING_EFFORT` constant in
   `reasoning-efforts.ts`; update `reconcileReasoningLevel` tests; `REASONING_LABELS` in
   `apps/app/src/hooks/useThreadCreationOptions.ts`.
2. Server policy — `thread-reasoning-policy.ts`: claude-code gains `ultracode`; codex/pi do not.
   `thread-default-policy.ts`: defaults unchanged; add the `workflowsEnabled` policy constant
   (D2) into execution-plan assembly.
3. Model gating — `agent-runtime/src/claude-code/model-list.ts`: `ultracode` in
   `supportedReasoningEfforts` only for xhigh-capable models. Custom models: decide explicitly —
   recommended: append `ULTRACODE_REASONING_EFFORT` to `ALL_REASONING_EFFORTS` (its only consumer
   is the claude-code custom-model ladder, consistent with the existing "broadest ladder"
   comment; the CLI downgrades gracefully on non-xhigh models).
4. Contract — `workflowsEnabled` on `hostDaemonExecutionOptionsSchema` /
   `runtimeThreadExecutionOptionsSchema` (explicit value, server-filled; D2). Add to
   `sameExecutionSettings`.
5. Adapter decomposition — `session-options.ts`: `reasoningLevel === "ultracode"` → `effort:
   "xhigh"`; `workflowsEnabled` → `Options.settings = { enableWorkflows: true, ...(ultracode ?
   { ultracode: true } : {}) }` (typed with the SDK's exported `Settings`; no env var — §1.3).
6. Codex — `toCodexReasoningEffort`: `case "ultracode"` → throw (mirrors `max`). Pi per its
   catalog (caps at xhigh).
7. Bump `HOST_DAEMON_PROTOCOL_VERSION` — old daemons fail-parse the new enum value/field, and the
   server already hard-rejects version-mismatched daemon sessions.

**Exit criteria**: picker shows Ultracode for xhigh-capable claude-code models only; selecting it
mid-thread triggers `thread/resume` and a session-options unit test asserts the resulting
`Options` contain `effort: "xhigh"` + `settings: {enableWorkflows: true, ultracode: true}`;
codex thread with ultracode is rejected at validation with a 4xx; switching an ultracode thread
to a non-ultracode model reconciles to `xhigh`.

### M6 — Adjacent cleanups (fold into M2 where natural)

- `status: null` → close the open `contextCompaction` item.
- `thinking_tokens`, `tool_use_summary`, `session_state_changed` → parsed + `"normalized"`.
- `tool_progress` mapped (M2.1).

**Exit criteria**: replaying the capture corpus (old + new) produces zero `provider/unhandled`
events for these subtypes.

---

## 4. Risks / open questions

1. **Provider-initiated wake turns.** Server-side idle→active on bare `turn/started` is already
   implemented (`apps/server/src/internal/events.ts:351-366`) and turn/completed effects are
   request-independent. Residual: exercise the path live (validation §5); the watchdog whitelist
   addition (M1.3) covers the turn-liveness half.
2. **Event volume.** 500ms adapter throttle + keep-first+latest pruning bounds DB growth; verify
   with fixture replay that a 3-minute workflow stays under ~400 progress rows pre-prune.
3. **Untyped `workflow_progress` + delta semantics.** Permissive parsing + fold-by-key at the
   adapter boundary; a CLI shape change degrades to the usage-only row rather than failing the
   thread.
4. **Token accounting.** Workflow subagent tokens are reported only via task usage, not the
   thread `result` usage. v1 displays usage on the workflow row; thread-level usage stays as-is
   (documented gap).
5. **Session restarts kill workflows.** Both explicit interrupts *and any mid-thread
   execution-settings change* (model, permission mode, effort, ultracode toggle) close the CLI
   session via `thread/resume` — in-flight workflows die and reconcile to `interrupted` (D3b).
   v1 accepts this; future: `apply_flag_settings` for restart-free settings changes, and/or
   defer reconfiguration while tasks are open.
6. **External kill switches.** Host user settings (`disableWorkflows`), org `allow_workflows`
   gate, and the `tengu_workflows_enabled` remote flag can each disable workflows regardless of
   BB's request (§1.3). The live validation must distinguish "BB bug" from "host has workflows
   disabled" — check `claude config`/settings on the host first.
7. **Stopping a workflow** without killing the thread (server route → daemon → bridge
   `query.stopTask(taskId)`) is a stretch goal — new bridge command; the lifecycle rules already
   handle the resulting `task_notification: stopped`.
8. **Remote workflows** (`remote_launched`) emit no local task events; the tool result's
   `sessionUrl` renders in the generic tool row (no special handling in v1).

Out of scope for v1: generic non-workflow background-task rows (D3 suppression rule documents the
follow-up shape), a global tasks panel, pause/resume UI, per-agent skip/retry controls,
`agentProgressSummaries`, surfacing `thinking_tokens` in the working indicator.

---

## 5. End-to-end validation

1. **Unit/integration suites** per milestone (commands inline above), all via Turbo, slow output
   piped to files.
2. **Replay**: feed the M0 capture corpus through `replayRawProviderEvents` and assert the
   projected timeline row sequence (golden test in thread-view), including the delta-fold and
   foreground-subagent-suppression assertions.
3. **Live**: `pnpm dev`; create a claude-code thread on an xhigh-capable model; set effort
   Ultracode; prompt: *"ultracode: survey this repo's packages and summarize each in one line"*.
   Verify:
   - timeline shows the Workflow tool call with a nested workflow row that live-updates
     (phases appear, agents tick queued→running→done, duration ticks);
   - `sqlite3 ~/.bb-dev/<instance>/bb.db "SELECT type, item_kind, count(*) FROM events WHERE
     thread_id='thr_x' GROUP BY 1,2;"` shows one started/completed pair + bounded progress rows;
   - after completion, the model wakes (provider-initiated turn), summarizes, and the thread
     returns to idle;
   - send several follow-up messages during a second run so the workflow completes turns later —
     confirm lazy turn expansion works on both the spawning and later turns, and the spawning
     page shows the terminal row (M3 pagination exit criteria, live);
   - interrupt a third run mid-flight → row shows `(interrupted)`.
4. **Cross-provider**: a codex thread neither offers nor accepts ultracode; existing reasoning
   levels unaffected.

Delete this file when the work lands.
