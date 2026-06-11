# Workflows convergence: provider-native `local_workflow` vs bb `bb_workflow`

**Status: decided (M7 of the bb-workflows plan). Decision: keep both paths.**

bb renders two kinds of "workflow" timeline rows from one shared rendering path
but two different execution loci:

- `local_workflow` — the **provider-native Claude dynamic-workflow path**: the
  Claude Code SDK's Workflow tool, enabled per-session by server policy,
  improvised by the model mid-turn, materialized as timeline items by the
  claude adapter, and gone when the turn dies.
- `bb_workflow` — **bb workflow runs**: deterministic file-authored
  (`*.workflow.js`) multi-agent runs owned end-to-end by the server workflow
  lifecycle, cross-provider, durable, resumable, with a run page.

The one-canonical-path rule forced a decision (plan open question 1): default
the provider-native path off once bb workflows are stable, or keep both with
distinct labels. This memo is the decision record.

**Decision: keep both.** The provider-native path stays enabled for
claude-code (`resolveWorkflowsEnabledPolicy` unchanged). The shared rendering
path is already the single canonical surface; the two task types are different
concepts, not parallel implementations of one concept; and defaulting
`workflowsEnabled` off would silently disable the public `ultracode` effort
level (see "The ultracode coupling"). Re-evaluation triggers and a staged
contingency deprecation sketch are recorded at the end.

---

## 1. Inventory: what each path does today

### 1a. Provider-native Claude dynamic workflows (`local_workflow`)

The producer chain, end to end:

1. **Server policy.** `resolveWorkflowsEnabledPolicy(providerId)` returns
   `providerId === "claude-code"`
   (`apps/server/src/services/threads/thread-default-policy.ts:30`). Filled
   once at the server boundary
   (`apps/server/src/services/threads/thread-commands.ts:209`). The SDK's own
   opt-in rules govern when the model actually uses the tool; host-level
   user/org disables still win inside the Claude CLI.
2. **Required contract field.** `workflowsEnabled: z.boolean()` is required on
   `runtimeThreadExecutionBaseOptionsSchema`
   (`packages/domain/src/shared-types.ts:152`, "filled explicitly at the
   server boundary, never defaulted downstream"), carried on
   `ProviderSessionOptions` (`packages/agent-runtime/src/provider-adapter.ts:113`),
   and participates in execution-options equality
   (`packages/agent-runtime/src/execution-options.ts:58`) — a changed value
   restarts the session.
3. **Claude bridge wire.** `thread/start` and `thread/resume` params carry it
   (`packages/agent-runtime/src/claude-code/bridge/commands.ts:67,88`; adapter
   call sites `adapter.ts:1094,1164`). `buildFlagSettings`
   (`packages/agent-runtime/src/claude-code/bridge/session-options.ts:66-76`)
   translates it to the SDK Settings flag tier:
   `{enableWorkflows: true, ultracode?: true}` — the only SDK Settings tier bb
   uses.
4. **Event materialization.** The SDK emits
   `task_started/task_progress/task_updated/task_notification`;
   `translateClaudeTaskMessage`
   (`packages/agent-runtime/src/claude-code/task-translation.ts:273`, called
   from `translate-message.ts:370`) filters to `LOCAL_WORKFLOW_TASK_TYPE`
   (`task-translation.ts:280`), folds records into an in-memory
   `ClaudeTaskMap`, and emits `item/started` +
   `item/backgroundTask/progress|completed` thread events (500ms progress
   throttle, `task-translation.ts:36`). Open tasks pin the thread's registry
   entry against LRU eviction (`adapter.ts:851`).
5. **Settlement.** Turn/session death settles open tasks as interrupted via
   `buildInterruptedClaudeTaskEvents` (`task-translation.ts:409`, called from
   `adapter.ts:1251,1290` on thread/resume restart and provider process exit).
   The daemon-crash case is reconciled server-side:
   `settleDanglingBackgroundTasks`
   (`apps/server/src/services/threads/background-task-reconciliation.ts:53`)
   settles `local_workflow` items and **skips** `BB_WORKFLOW_TASK_TYPE`
   (`:76-83` — bb anchor items are lifecycle-owned).
6. **No nesting.** bb workflow agent sessions set `workflowsEnabled: false`
   (`apps/host-daemon/src/workflow-agent-executor.ts:234`); fixtures mirror
   the policy (`packages/agent-fixtures/src/capture.ts:581`).

What a user sees: any claude-code thread can spontaneously run a dynamic
workflow rendered as an inline phase-grouped agent tree. No deep link, no
drill-in, no resume; the state is in-memory and the row settles as
interrupted/stopped when the turn, session, or daemon dies.

### 1b. bb workflow runs (`bb_workflow`)

Built M1-M7 of `plans/bb-workflows-omegacode-integration.md` (the plan file is
deleted when complete; summary here — M7 added governance: per-project policy
with the sandbox ceiling, env-tunable per-host caps, retention/run-dir
pruning, and the gated soak suite):

- **Authoring/launch:** deterministic `*.workflow.js` files (registry tiers
  `.bb/workflows` / `<dataDir>/workflows` / builtins), validated server-side
  without execution, launched via `POST /api/v1/workflow-runs`,
  `bb workflow run`, or the project Workflows tab.
- **Execution:** server-owned lifecycle (`apps/server/src/services/workflows/`)
  over durable `workflow.start`/`workflow.cancel` commands; daemon runner
  child + `workflow-agent-executor.ts` over `createAgentRuntime` —
  cross-provider (codex, claude-code, pi), worktree isolation, caps and budget
  from server policy (`workflow-run-policy.ts`).
- **Durability:** `workflow_runs`/`workflow_run_events` rows; the journal IS
  the resume source; interrupted-only resume replays the cached prefix;
  retention sweep archives old runs.
- **Surfaces:** run page `/workflows/runs/<id>` with per-agent timeline
  drill-in, thread-anchored timeline row (`taskType: bb_workflow`, itemId =
  `wfr_` run id), manager `[bb system]` paused/settled notifications, full CLI
  group.

### 1c. The shared rendering path (permanent, either way)

One canonical path renders both task types:

- `packages/thread-view/src/background-task-projection.ts` — taskType-agnostic
  fold of `item/backgroundTask/*` events into one workflow work row.
- `packages/thread-view/src/event-projection-message.ts:375` and
  `packages/server-contract/src/thread-timeline.ts`
  (`timelineWorkflowWorkRowSchema`) — `taskType` is a freeform string threaded
  through the contract (`packages/domain/src/provider-event.ts:238-259`).
- `packages/thread-view/src/timeline-row-title.ts:831-863`
  (`mapWorkflowTitle`) — the **only render divergence**: the deep-link gate
  `row.taskType === BB_WORKFLOW_TASK_TYPE` (`:848`). `bb_workflow` rows link
  to the run page; `local_workflow` rows stay plain.
- `apps/app/src/components/thread/timeline/WorkflowWorkRowBody.tsx` renders
  both via the shared `apps/app/src/components/workflow/WorkflowAgentTree.tsx`.

Historical `local_workflow` events are persisted thread events and must keep
rendering forever — the render path is permanent regardless of any producer
decision.

## 2. User-visible differences

| | `local_workflow` (provider-native) | `bb_workflow` (bb runs) |
|---|---|---|
| Trigger | model decides mid-turn (SDK opt-in rules; `ultracode` standing mode) | explicit launch (CLI, Run dialog, manager) |
| Authoring | none — model-improvised | deterministic `.workflow.js`, validated |
| Providers | claude-code sessions only | codex, claude-code, pi |
| Durability | in-memory, dies with the turn/session/daemon | server-owned run rows + authoritative journal |
| Resume | none — settles as stopped | interrupted-only, cached prefix replays free |
| Inspection | inline phase/agent tree only | run page, per-agent timeline drill-in, journal API |
| Deep link | none (plain title) | `/workflows/runs/<id>` via itemId |
| Caps/budget | provider-internal | server policy (concurrency, maxAgents, maxFanout, budget) + host admission caps |
| Notifications | none | manager `[bb system]` paused/settled messages |
| Cost profile | inside the running turn's session | per-agent ephemeral sessions, token-budgeted |

They overlap only in *appearance* (same row, same tree). In capability they
are disjoint: one is a provider feature for spontaneous in-turn fan-out, the
other is a product entity for bounded, durable, repeatable fan-out.

## 3. The ultracode coupling (the decisive constraint)

bb's `ultracode` reasoning level (`packages/domain/src/shared-types.ts:9-16`,
public union value, exposed in thread creation options and documented in the
M6 `bb-workflows` skill) is **not an SDK effort**: it decomposes into effort
`xhigh` plus the session-scoped `ultracode` Settings flag — *standing
dynamic-workflow orchestration*
(`session-options.ts:54-64`, `toSdkEffort`). `buildFlagSettings` emits the
`ultracode` flag **only when `workflowsEnabled` is true**
(`session-options.ts:66-76`).

Consequence: "default `workflowsEnabled` off" is not a low-risk policy flip.
It silently strips the defining behavior of a public effort level while the UI
continues to offer it — an accepted-but-ignored value, which the contract
rules forbid. Any deprecation of the provider-native path must first resolve
ultracode (redefine it, remove it, or narrow the policy to it — see the
contingency sketch).

## 4. What converging (deprecating provider-native) would touch

The deletable half (producer chain):

- `resolveWorkflowsEnabledPolicy` + its fill site (`thread-commands.ts:209`).
- The required `workflowsEnabled` field end-to-end — domain
  (`shared-types.ts:152`), runtime (`provider-adapter.ts:113`,
  `execution-options.ts:58,72`), bridge wire (`bridge/commands.ts:67,88`,
  `adapter.ts:1094,1164`, `session-options.ts`), executor
  (`workflow-agent-executor.ts:234`), fixtures (`capture.ts:581`), and every
  test that constructs execution options (~20 files). Leaving it
  accepted-but-ignored is forbidden; full removal is a claude bridge wire
  change.
- `task-translation.ts` (the whole module), its call in
  `translate-message.ts:370`, the adapter's task map + eviction pin +
  interrupted-settle call sites (`adapter.ts:851,1251,1290`).
- The `local_workflow` settle branch in `settleDanglingBackgroundTasks` (which
  would leave the backstop with no live consumer until another task type
  materializes).
- `ultracode`: `toSdkEffort`/`buildFlagSettings`, the `reasoningLevel` union
  (order is load-bearing for model-switch reconciliation), creation-options
  UI, and skill documentation.

The permanent half (kept under every option): the shared render path, the
`taskType` contract field, `LOCAL_WORKFLOW_TASK_TYPE` itself (historical
events reference it), stories and projection tests. Deleting the producer
saves roughly one stable, unit-tested ~430-line translation module plus a
boolean field — and costs a wire-shape change and a public-feature decision.

## 5. Options and risks

**A. Keep both (chosen).**
- Risks: two visually similar rows could confuse users (mitigated below —
  the affordances already differ: deep link vs plain); the task-translation
  module must track SDK `task_*` schema evolution (historically stable;
  unknown record states already degrade gracefully,
  `task-translation.ts:97-115`).
- The one-canonical-path rule is satisfied where it bites: there is exactly
  one rendering path per concept, with a single explicit `taskType` gate. The
  execution loci differ because the *concepts* differ — removing the provider
  path would not deduplicate a surface, it would delete a provider capability
  (and break claude-feature parity for claude-code threads).

**B. Deprecate by defaulting `workflowsEnabled` off.**
- Kills ultracode's defining flag silently (section 3) — so B is really
  "redefine/remove a public effort level" plus a policy flip.
- Leaves the entire producer chain in place but dead (a required field every
  caller sets to `false`, a translation module that can never fire) —
  dead-config by another name, creating immediate pressure to proceed to C.
- Users lose spontaneous in-turn fan-out on claude threads; bb workflows are
  not a substitute (explicit authoring + launch; no-nesting means a thread
  cannot get in-turn dynamic orchestration any other way).

**C. Full removal (timeline).**
- Everything in B plus the section-4 touch list: claude bridge wire change,
  domain union change, fixture re-capture. The render path still cannot be
  deleted (historical events), so the "one path" outcome is identical to A
  at the rendering layer — only capability is removed.

## 6. Decision and rationale

**Keep both, with the existing affordance divergence as the distinct label.**

1. The ultracode coupling makes "default off" a de-facto removal of a public
   product feature, not a config flip.
2. The rendering layer — where parallel surfaces actually cost us — is already
   canonical and shared; the divergence is one deliberate, documented gate.
3. The two task types are complements, not duplicates: bb deliberately ships
   three multi-agent paradigms (managers = open-ended durable delegation,
   bb workflows = bounded deterministic fan-out, provider-native = spontaneous
   in-turn orchestration). bb workflows cannot absorb the third without
   violating its own no-nesting and explicit-authoring stances.
4. The marginal cost of keeping the producer is small (stable, tested, no open
   bugs); the cost of removing it is a wire change plus a permanent capability
   loss, while the render half must stay either way.

Labeling: the deep-link presence (run-page link on `bb_workflow`, plain title
on `local_workflow`) is the load-bearing distinction and ships today.
Recommended non-blocking polish, if confusion is ever observed: branch the
title verb in `mapWorkflowTitle` (`timeline-row-title.ts:831`) to "Dynamic
workflow:" for `local_workflow` rows (touches the verb helper, stories, and
the `thread-timeline-rows` pins). Not implemented with this memo — no observed
confusion justifies it yet.

## 7. Re-evaluation triggers and contingency sketch

Revisit this decision if any of:

- the Claude SDK decouples `ultracode` from `enableWorkflows`, or retires the
  Workflow tool / `task_*` message family;
- SDK `task_*` schema churn starts breaking translation in practice;
- sustained user confusion between the two row types is reported;
- bb workflows gain in-turn dynamic launch parity such that the provider path
  is strictly dominated.

Staged contingency (in order, each stage shippable alone):

1. **Narrow, don't flip:** make the policy
   `providerId === "claude-code" && reasoningLevel === "ultracode"` — the
   spontaneous path survives only in the mode whose contract IS standing
   orchestration. No contract shape changes; ultracode keeps working;
   ordinary claude threads converge on bb workflows.
2. **Resolve ultracode:** remove or redefine the effort level (UI, domain
   union — mind the load-bearing `reasoningRank` order — skill docs), then
   default the policy off entirely.
3. **Delete the producer:** the section-4 touch list in one change (the field
   end-to-end, never accepted-but-ignored), bumping the claude bridge wire.
   The render path, `taskType` contract field, and `LOCAL_WORKFLOW_TASK_TYPE`
   constant remain forever for historical events.

## 8. Performance bar (M7 soak/perf pass)

The M7 exit criteria require the daemon-ingress p95 measurement and its
regression bar to be recorded here. Measured by the M7 soak/perf pass
(2026-06-07, Apple-silicon dev machine; fake provider, in-memory server
SQLite, loopback wire):

- **Soak round-trip p95** (90-agent fake fan-out; the harness `daemonFetchFn`
  wrap timing every `POST /internal/session/workflow-run-events` batch round
  trip — route + the single per-batch ingestion transaction; measured by
  `tests/integration/soak/ingress-p95.test.ts`):
  **p50 3.0–5.4ms, p95 5.3–7.5ms, max 10.4–12.0ms across recorded runs.
  Batch count is spool-timing-dependent and NOT a stable artifact — observed
  25–45 batches per run across runs on the same machine.**
- **Deterministic micro-bench** (`ingestWorkflowRunEventBatch` against
  in-memory SQLite; `apps/server/test/workflows/workflow-run-ingestion.bench.ts`
  via the turbo `bench` task):
  **90-agent progress batch (anchored run): mean 3.34ms, p99 4.95ms
  (150 samples). 30-completion journal batch with 1KB results: mean 1.79ms,
  p99 3.21ms (279 samples).**
- **Declared bar:** the soak round-trip **p95 ≤ 50ms** (scaled by
  `BB_TEST_TIMEOUT_SCALE` for slower CI hosts) gates regressions — it is
  asserted by the gated soak test on every `test:soak` run and sits ~7x above
  the measured baseline. Honest scope: the absolute bar catches algorithmic
  regressions that land in the tens of milliseconds at 90-agent scale
  (per-batch full-journal scans, per-event transactions) and anything worse;
  drift BELOW the bar is invisible to it — the micro-bench numbers are the
  wire-free reference baseline for that (vitest bench reports, no pass/fail).
  Re-measure both when touching the ingestion fold, the spool batching
  constants, or the anchor throttle. (The bar was tightened from the
  originally recorded 250ms — ~40x headroom only caught catastrophic
  regressions — after a verification pass confirmed p95 stability across
  machines/runs.)

## 9. Project closeout: open questions and open items (durable record)

The bb-workflows plan file (`plans/bb-workflows-omegacode-integration.md`) is
deleted on completion per planning conventions; this section is the durable
home for everything unresolved at M7 close. (OQ1 — this memo's own
keep-vs-converge decision — is resolved above.)

### Open questions carried forward (plan §11, verbatim intent)

2. **Dollar-cost accounting.** Token budgets are loose (usage arrives
   post-turn; overrun bound ≈ concurrency × per-agent output). Add pricing
   tables and a cost ledger? Where (domain vs config)?
3. **Workflow packs via app sources.** Apps shipping a `workflows/` dir as a
   fourth registry tier (reusing app-source sync/provenance) — post-v1
   distribution story. Does the app-source trust boundary suffice for
   executable workflow scripts, given the vm is hardening rather than
   isolation?
4. **Cross-host resume.** The server journal makes it possible, but worktree
   branches and preserved state are host-local. Allow resume on a different
   host with worktree agents degraded to re-run, or keep host-affinity for
   worktree-bearing runs only?
5. **SES-style intrinsic freezing.** omegacode's PARITY backlog item. Worth
   porting into `@bb/workflow-runtime` before workflow packs widen the author
   set?
6. **Per-step retry UI.** "Retry just this agent" would require key-pinned
   partial invalidation semantics beyond omegacode's model.
7. **Unanchored-run notifications.** Anchored runs notify their manager;
   where do unanchored (human-launched) runs notify — desktop notification,
   sidebar badge, or nothing beyond the run page?
8. **Codex per-conversation cwd.** Would collapse codex worktree fan-out onto
   one runtime per run. M7 soak pressure data: 90 worktree agents across 3
   concurrent runs saturated the 8-token gate (peak Σ 9 processes, ~90
   agents/40s gate-bound on a dev machine with fake providers); the gate —
   not provider spawn cost — was the binding constraint, and per-conversation
   cwd would also eliminate the per-agent git-provisioning churn. Still
   deferred: no real-workload pressure signal yet.

### Open items at close (M7 final review pass)

- **Manual QA Scenarios 11 and 12 have no recorded execution.**
  `qa/manual-manager-runbook.md` Scenarios 11 (manager-launched
  deep-research, link-first, no-polling wake) and 12 (anchored interrupt →
  paused message → resume → exactly-one settled message) are fully scripted
  but were never run against a dev instance — they are the only coverage for
  the criteria that cannot be automated under the fake-providers-only test
  rule (M6's manual validate line; the real-provider half of M2's exit
  criterion). Execute both on the next ship-branch QA pass with real
  providers and record the result here.
- **CLI run/wait/cancel/resume/show handlers are not integration-driven.**
  Only `bb workflow save` and `validate` run as the real commander handlers
  against the harness (`tests/integration/fake/workflows/cli-commands.test.ts`);
  the rest are apps/cli unit-tested only, because apps/host-daemon's ambient
  `ws` module stub (`apps/host-daemon/src/ws.d.ts`) conflicts with the real
  `@types/ws` when `@bb/sdk/node` enters the integration TS program. Fix
  shape: replace the stub with `@types/ws`, then extend cli-commands.test.ts
  to drive run/wait end to end the way save already does.
- **Reaper stdin-watchdog path is unit-tier only.** The orphan-reaper soak
  exercises crash-cycle convergence plus a real boot reap of a fabricated
  live orphan (the daemon SIGKILLs it, not the harness); the runner's
  parent-death stdin watchdog (self-termination when the daemon dies without
  killing children) cannot be exercised by an in-process harness and stays
  covered by unit tests (`workflow-run-manager.test.ts`).
- **Worktree provisioning race: fix landed at M7 close, soak-verified across
  three consecutive full `test:soak` runs (zero failed agents; the unfixed
  rate was ~1 in 90 provisions, reproduced in 3 of 6 pre-fix runs).**
  The M7-soak-diagnosed `.git/config.lock` race (teardown `branch -D`
  unlocked vs `recordBaseCommit`, compounded by non-realpath lock keys under
  macOS tmp symlinks; ~1 in 90 concurrent worktree provisions) is fixed in
  `packages/host-workspace` (teardown `branch -D` under the worktree metadata
  lock, `getGitCommonDir` realpath-canonicalized, `extensions.worktreeConfig`
  rewrite skipped when already set). If `test:soak` ever fails again with
  `could not lock config file .git/config: File exists`, treat it as a
  regression of this fix, not a known flake.
