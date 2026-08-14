# Finite State coordinator runbook

Use this runbook for every dispatch after FS-93. It preserves historical WP keys while ensuring one active member per decision-owner cluster.

## 0. Stop program and infrastructure growth without evidence

No new program/infrastructure task unless:

- (a) it names a product WP blocked without it; or
- (b) it states a measured cost it removes, with the measurement, and re-measures after landing.

A review-rule or acceptance-criteria change that binds more than a handful of WPs must state before landing the recurring cost it adds and what that cost buys.

This is the authoritative, versioned stopping rule. Versioned artifacts are authoritative; bb Memory is context, not the authority for this policy.

## 1. Read and validate the graph

From the repository root, using the pinned Node version:

```sh
fnm exec --using=22.19.0 -- node plugins/bb-plugin-finite-state/docs/Implementation/scheduling/validate-wp-coupling.mjs
fnm exec --using=22.19.0 -- node --test plugins/bb-plugin-finite-state/docs/Implementation/scheduling/validate-wp-coupling.test.mjs
```

Do not dispatch if either command fails. The validator rejects scope omissions and duplicates, a sequential member missing its predecessor edge, missing dependency targets, dependency cycles, incorrect L2 or canvas model tiers, or a changed independent-review profile.

## 2. Reconcile live Tasks state

Read the target Task and every effective dependency from [`wp-coupling-manifest.json`](./wp-coupling-manifest.json):

```sh
bb tasks show FS-93 --json
bb tasks list --limit 500 --json
```

For a candidate WP, require all of the following:

1. Every manifest dependency has reached `done`.
2. No member of its `clusterId` is `in_progress` or `in_review`.
3. The candidate is the lowest incomplete `sequence` in its cluster.
4. Its preset matches the manifest.
5. The program remains within the validated lane cap.

The manifest distinguishes permanent `prohibitedWorkPackages` from temporary
`stoppedWorkPackages`. Do not dispatch a stopped package until its recorded
`resumeCondition` is satisfied and the stop plus its reason are removed in the
same reviewed scheduling change. Reintroducing a stop likewise requires both
the list entry and its reason/resume-condition record; validation fails closed
when either half is missing.

WP documents list product prerequisites. The manifest may add a dispatch-only predecessor edge to serialize a coupled owner; the union is the effective dependency set.

There is no separate per-WP phase or gate label. Readiness is computed from these conditions directly, preserving the Master Plan's G0–G6 product-milestone meanings.

## 3. Machine-check a cap increase

Pass the live completed and active WP keys, the current cap, and observed disk headroom:

```sh
fnm exec --using=22.19.0 -- node plugins/bb-plugin-finite-state/docs/Implementation/scheduling/validate-wp-coupling.mjs \
  --mode promotion \
  --target-cap 6 \
  --completed WP01,WP03,WP04,WP05,WP06,WP07,WP10 \
  --current-cap 4 \
  --free-after-provision-gib 39 \
  --runtime-floor-gib 34
```

Do not raise the cap until the command exits zero with live state. Six lanes require at least six independent active-or-ready decision clusters, 35 GiB free after provisioning, and a 30 GiB runtime floor. Measure current managed-worktree size and free space for every promotion; historical ranges are context, not a substitute for the current observation.

**Lane count is not gated on the mock chain.** WP-10 through WP-13 gate the mock-_dependent_ work packages, and the dependency graph already enforces that per package. Gating the cap on them blocked lanes whose clusters have no mock dependency at all — on 2026-08-12 eleven clusters were dependency-ready while promotion evaluated ineligible.

There is also **no workflow-concurrency requirement**. The saved-workflow factory was removed on 2026-08-12 (`ADR — bb Is Not Modified.md`) and orchestration is manual, so such a requirement would be permanently unsatisfiable.

Promotion to nine is a second, explicit check:

```sh
fnm exec --using=22.19.0 -- node plugins/bb-plugin-finite-state/docs/Implementation/scheduling/validate-wp-coupling.mjs \
  --mode promotion \
  --target-cap 9 \
  --completed WP01,WP02,WP03,WP04,WP05,WP06,WP07,WP08,WP09,WP10,WP11,WP12,WP13 \
  --active WP14 \
  --current-cap 6 \
  --managed-worktree-pruning-complete true \
  --free-after-provision-gib 45 \
  --runtime-floor-gib 35
```

Replace the example values with current observations. Before evaluating nine lanes, archive completed threads, preserve recoverable branches, prune completed managed worktrees through bb's environment lifecycle, and remeasure free space. A zero exit requires that pruning/free-space recovery step to be explicitly complete, prior six-lane operation, nine independent active-or-ready clusters, 45 GiB free after provisioning, and a 35 GiB runtime floor. Record the current worktree-size and free-space measurements, cleanup evidence, command, and JSON result on the program-control Task before changing the cap.

## 4. Dispatch through the required preset

Use the manifest's preset and add instructions that name the cluster and sequence:

```sh
bb tasks dispatch FS-29 --preset fs-critical --instructions "C-SYNC-TRANSACTION sequence 1; do not begin any later cluster member."
bb tasks dispatch FS-38 --preset fs-standard --instructions "C-FINDING-UX sequence 1; do not begin any later cluster member."
```

All L2 sync work and the L4 canvas use `fs-critical`. Routine or mechanical work uses `fs-standard`. Never substitute a lower tier for those critical lanes.

**Merge notifications are dispatch triggers.** When a PR merges, run §2–§4 immediately for the next ready candidate instead of waiting for the watchdog cadence — the watchdog (§10) is a backstop, not the scheduler.

**Permission mode is `full` for every preset** (owner decision, 2026-08-12, after FS-91 branch protection went active). Unattended operation is the point: `accept-edits` and `auto` stall threads on approval interactions nobody is watching. The presets (`fs-critical`, `fs-standard`, `fs-review`) already carry `full`; because presets live outside version control, verify with `bb tasks preset list` and restore `--permission full` if a preset is ever re-created. This is safe only while its two preconditions hold — the `finite-state/integration` ruleset (require PR + green `Finite State guard gates` check, no bypass actors; see FS-91) and isolated worktree environments. If either lapses, revert presets to `auto` before the next dispatch.

## 5. Review and close

Implementation evidence must include **journey-smoke evidence** (owner ruling, 2026-08-14): 1–3 journey beats — the primary user story through the registered surface — run against a disposable dev instance with seeded mock data, output or screenshot attached to the task. Reviewers treat missing journey evidence like missing wired-in proof: an immediate cheap REQUEST_CHANGES, no further analysis needed. Fixes for sweep-found defects additionally add a harness beat reproducing the broken journey (or, until WP-65 lands, append the beat spec to [JOURNEY-BEAT-BACKLOG.md](../JOURNEY-BEAT-BACKLOG.md)) — sweeps thereafter explore only new surface, never re-cover harness-protected ground. Once the WP-65 harness runs nightly and post-merge, sweep cadence drops from 6h to 12h, reassessed on sweep yield.

After implementation evidence and a draft PR are attached, leave the WP `in_review` and dispatch an independent review:

```sh
bb tasks dispatch FS-93 --preset fs-review --instructions "Review only. Do not merge. Verify the linked draft PR against the Task acceptance criteria and report actionable evidence."
```

The review preset is Claude Opus 5 at high reasoning. The reviewer must not be the implementation thread. Only a separately authorized integrator changes a WP from `in_review` to `done` or merges its PR.

For any WP touching a panel, slot, or theme, review evidence must include a live-browser pass. From the repository root, select a disposable bb data directory with `BB_DATA_DIR`, then path-install the plugin directly (no build step):

```sh
export BB_DATA_DIR="$(mktemp -d)"
bb plugin install ./plugins/bb-plugin-finite-state
```

Open the affected surface with `agent-browser`, exercise the reviewed behavior, and attach both a screenshot and a one-line observed-behavior note to the review evidence. Component tests alone do not satisfy UI-surface review. Do not add Playwright or visual-regression infrastructure for this requirement.

Before posting the final verdict, stop your disposable dev instance: run `scripts/bb-dev-app stop` (and stop any mock remote you started). Orphaned dev stacks — server, vite, watchers — keep running from deleted inodes after the worktree is GC'd (~1 GiB each; three zombies fed the 2026-08-14 memory exhaustion). The resource watchdog auto-reaps sessions whose worktree is gone, but it is a 6-hour backstop, not the primary mechanism.

When a round-1 verdict lands, classify its blockers against [REVIEW-KILL-LIST.md](../REVIEW-KILL-LIST.md) and add or prune classes so the list tracks what round-1 reviews actually find.

The program-control task's oversight ticks track two QA metrics (owner ruling, 2026-08-14): **sweep yield per pass** (defects found per UX sweep — expected to decay toward zero as the harness accumulates beats) and **journey-smoke escape rate** (sweep- or harness-found defects in surfaces whose implementer had attached passing journey-smoke evidence). If sweep yield has not begun decaying within roughly a week of the WP-65 harness landing, the QA package is not working — escalate for reassessment.

Among the unstarted work packages, this recurring cost applies to 21 UI-owning WPs: WP-21, WP-24, WP-25, WP-26, WP-31, WP-32, WP-33, WP-34, WP-35, WP-36, WP-37, WP-38, WP-39, WP-40, WP-42, WP-45, WP-51, WP-54, WP-55, WP-56, and WP-61. The recurring cost is one live-browser evidence pass per UI WP review.

### Close-out: archive threads once work is merged and review disposed

When a task's PR is merged and its review verdict is disposed (approved and landed, or findings transferred to follow-up tasks), archive every thread attached to that task — implementer, reviewer, and any repair threads — through bb in the same close-out step that moves the task to `done`. Idle threads pin their managed worktrees, and each provisioned worktree holds multiple GiB of `node_modules` and build output that bb's environment lifecycle cannot reclaim until the thread is archived. Deleting `node_modules` by hand frees nothing: pnpm content is hardlinked into the global store, so the space returns only when the worktree is pruned and the store is pruned of orphans (see ledger entry `fact-disk-reclamation-playbook`, mem_xstfcrza7c0). Do not leave threads unarchived as informal history; task comments and PRs are the durable record.

## 6. Tasks limitations and audit trail

The Tasks surface cannot enforce dependency edges, sequence locks, or decision-owner mutual exclusion. Comments and labels are advisory mirrors. The deterministic validator and coordinator discipline provide enforcement. If a Task comment and manifest disagree, stop dispatch, correct the inconsistency, and rerun validation; do not silently choose one.

## 7. Shared lessons ledger (bb memory, project scope)

Cross-thread findings live in the bb Memory plugin at project scope. The memory index is injected into every thread's system prompt, so an admitted entry is visible to every worker without routing through the coordinator. This is the program's shared verified context: facts, failures, constraints, and patch summaries propagate as state, not as re-discovery.

Entry conventions (binding):

| Field       | Convention                                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--name`    | `<TYPE>-<scope>-<slug>`, TYPE one of `FACT`, `FAIL`, `CONSTRAINT`, `PATCH`                                                                                          |
| `--kind`    | fixed plugin vocabulary — map `FACT`/`FAIL` → `fact`, `CONSTRAINT` → `decision`, `PATCH` → `episode`                                                                |
| `--tag`     | at least one of `wp:WPxx`, `cluster:C-...`, or a file path; reviewers add `commit:<sha>`                                                                            |
| `--summary` | one claim, ~100 tokens max — this is what other threads see in their index                                                                                          |
| `--details` | **evidence required**: file:line, the command and its output, or a commit SHA. An entry without concrete evidence is not binding and must be rejected or superseded |
| `--reason`  | what happened that makes this durable                                                                                                                               |

Admission and hygiene:

- **Verify before relying.** Before treating a ledger entry as binding for a dispatch or merge decision, spot-check its evidence. Reject or supersede entries whose evidence does not hold.
- **Supersede, don't accumulate.** When a design is deleted or a fact is invalidated, `bb memory update`/`forget` with `--reason` immediately. Stale entries mislead every subsequent worker (e.g., any entry about the removed freeze-guard machinery or the removed workflow factory is now wrong).
- Never store secrets, transient status, guesses, or rules already guaranteed by `AGENTS.md`.

Worker duties are stated in `plugins/bb-plugin-finite-state/AGENTS.md` ("Shared lessons ledger"): search before starting, write on completion and on failure.

## 8. Retries inherit; they do not restart

On 2026-08-12, WP-09 was attempted by seven fresh threads and WP-08 by four; each retry re-discovered the prior attempt's failures in a cold worktree. Before re-dispatching a failed or stopped WP:

1. **Harvest the dead thread.** Read `bb thread log <failed-thread>` and admit `FAIL`/`FACT` ledger entries (with evidence) for whatever killed or blocked it.
2. **Inherit, don't reprovision.** Prefer `bb thread fork <failed-thread> --workspace reuse --prompt "..."` or `bb thread spawn --environment <same-env>` so the retry keeps the workspace and context. **A bare `bb thread fork` defaults to `--workspace isolated`, which provisions a fresh worktree — the cold restart this rule exists to prevent — so the `--workspace reuse` flag is mandatory.** Provision a fresh worktree only when the workspace itself is corrupted — and say so in the dispatch instructions.

## 9. Review findings are durable; head-move audits verify deltas

A moved head does not invalidate everything a reviewer verified. Serial full re-audits of the same artifact (FS-89 received five on 2026-08-12) are the slowest possible use of review capacity.

- Reviewers admit verified findings to the ledger tagged `commit:<sha>` plus the files covered.
- On a head move, keep the **same reviewer thread** and `bb thread tell` it the new head; it verifies the diff since its last verified commit against its admitted findings.
- A brand-new full audit is reserved for: a change of reviewer identity required by the independent-review profile (provider diversity), contested findings, or a frozen-artifact approval where the human gate requires it. A reviewer whose environment was lost (worktree prune) also forces a fresh reviewer thread — point it at the durable findings and scope it as a delta review, not a full re-audit.
- **Repair rounds 2+ are delta reviews by default.** The reviewer re-verifies only (i) the previously-failed findings and (ii) the incremental diff since the last reviewed head. Automated gates (typecheck/test/lint/build, tripwires) still run every round — they are cheap and catch regressions anywhere. Manual reproduction and live-browser evidence are re-required only when the diff touches the corresponding surface: UI evidence only if UI-owning files changed, gate reproduction only if the gated path changed. A full re-review is triggered only by frozen-file, scope, or merge-base changes, a reviewer-identity change, or contested findings. The incremental diff must still be reviewed adversarially — repairs introduce new defects (FS-122's repair shipped a ReDoS in a diff that was "just a guard").

## 10. Ready-queue watchdog (advisory automation)

The `fs-ready-queue-watchdog` script automation runs [`ready-queue-watchdog.mjs`](./ready-queue-watchdog.mjs) every 5 minutes. It computes dependency-ready, cluster-free, lowest-sequence candidates from the manifest plus live Tasks state and queues a nudge to the coordinator thread when undispatched candidates exist (re-nudging at most every 30 minutes for an unchanged set).

It is advisory only: it never dispatches, never selects presets, and never changes the lane cap — §2–§4 remain the coordinator's job. It requires no bb modification (per `ADR — bb Is Not Modified.md`; it is a stock automations-plugin script). If coordination moves to a different thread, update the automation's `BB_COORDINATOR_THREAD` env value.

Semantics worth knowing:

- **Omitted dependencies count as satisfied.** The manifest deliberately omits the completed L0 packages (WP01, WP03–WP07) while still naming them as dependencies; requiring board-`done` for them would permanently hide 24 of 64 remaining packages. `ready-queue-watchdog.test.mjs` pins this behavior.
- **Prohibited packages are excluded, durably.** The versioned rule is `dispatchPolicy.prohibitedWorkPackages` in the manifest (currently `["WP02"]`, per `ADR — bb Is Not Modified.md`; the sibling `prohibitedWorkPackageReasons` object records why). The automation additionally sets `FS_WATCHDOG_EXCLUDE=WP02` as belt-and-braces — but the repo artifact, not job configuration, is the mechanism of record.
- **Temporarily stopped packages are also excluded.** `dispatchPolicy.stoppedWorkPackages` is distinct from permanent prohibition and each entry has a versioned reason plus explicit resume condition in `stoppedWorkPackageReasons`. Removal or reintroduction changes both halves together under validator coverage.
- **Dedup state** lives in the automation's working directory (the automations plugin data dir) or `FS_WATCHDOG_STATE_DIR` when set; an unchanged ready set re-nudges at most every 30 minutes.
