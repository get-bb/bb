# Finite State workflow factory

Saved bb workflows for the `bb-plugin-finite-state` build. Each resolves by
name from this directory:

```sh
bb workflows validate --name fs-work-package
bb workflows run --name fs-work-package --args '{"taskKey":"FS-24","profile":"fs-standard"}'
bb workflows status <run-id>
```

These replace ad-hoc thread spawning for the repeated steps. The manual pattern
produced 23 threads for 7 pull requests, with 30–140 minute idle gaps between
each step because every transition waited on a coordinator dispatch.

| Workflow | Args | What it does |
|---|---|---|
| `fs-work-package` | `{ taskKey, profile, scope? }` | FS-93 readiness preflight → implement → 3 independent reviewers → repair verified findings → verify → report and mark `in_review`; `profile` is exactly `fs-standard` or `fs-critical` |
| `fs-contract-freeze` | `{ target }` | read-only: 4 reviewers (RPC, schema, registry, remote) → adversarial refutation → one-page decision brief for the human gate |
| `fs-gate-review` | `{ gate, criteria? }` | run a G0–G6 gate, independently verify the evidence, rule pass/fail/inconclusive |
| `fs-amendment-impact` | `{ amendment }` | draft-only: artifact, consumers, in-flight collisions, migration effect, fixtures |

## Authoritative model policy

The source of truth is
`plugins/bb-plugin-finite-state/docs/Implementation/scheduling/wp-coupling-manifest.json`:

| Preset | Workflow tuple | Use |
|---|---|---|
| `fs-review` | `claude-code` / `claude-opus-5[1m]` / `high` | Every review and verifier |
| `fs-standard` | `codex` / `gpt-5.6-sol` / `medium` | Routine work-package preflight, implement, repair, and report |
| `fs-critical` | `codex` / `gpt-5.6-sol` / `xhigh` | Critical work-package stages and non-review frozen/gate synthesis |

`fs-work-package` rejects a missing or unknown profile and its read-only
preflight rejects a profile that differs from the target WP's FS-93 manifest
preset. No agent inherits the workflow origin's model selection.

## Invariants these encode

- **Reviewers and verifiers use Opus 5 [1m] at high; work agents use the closed
  Sol profile.** Provider diversity and the medium/xhigh spend boundary are
  explicit workflow literals.
- **One editing agent at a time in a worktree.** Implement and repair edit;
  preflight, review, and verify are read-only. Draft, brief, execute, rule, and
  report agents may perform only the operations their prompts name and cannot
  edit repository files.
- **No workflow merges anything, approves a frozen artifact, or promotes a
  gate.** `fs-gate-review` may move a gate to `in_review` and no further.
  `fs-amendment-impact` drafts only, and human approver/reviewer identities
  remain blank. A workflow cannot mint human authorization.
- **FS-93 readiness is fail-closed.** Before `fs-work-package` edits, preflight
  runs the checked-in graph validator and proves completed dependencies,
  decision-cluster idleness and sequence, preset agreement, and lane-cap
  compliance from live Tasks state.
- **Verifiers re-run checks themselves** rather than trusting an earlier
  agent's claim, and report from observed exit status.
- **Reviewers are asked whether a defect originates in the work package
  document or the specs**, because several already have — a repair aimed only
  at code re-diverges on the next work package.
- **Self-checkable findings are counted and reported**, so checks that belong
  in the gate migrate there instead of recurring as review round trips.

## Deliberately not built

`fs-factory-coordinator` is specified in the bootstrap plan but is not here. It
would promote tasks and dispatch worktrees. That is standing authority over
what runs, and it belongs to the active coordinator and its owner, not to a
script contributed alongside the work it dispatches. These workflows only
check FS-93 readiness; they never dispatch the next WP.

## Concurrency and worktrees

Workflow workers reuse the origin environment (`environment: { type: "reuse" }
in the workflows service), so five analysis dimensions do not provision five
worktrees. The program's lane cap counts independently provisioned WP
worktrees; per-run agent concurrency counts threads sharing one worktree.

Even so, every parallel section batches through `MAX_CONCURRENT_AGENTS = 4`,
matching FS-93's current lane cap and ensuring only read-only agents overlap.
The workflows plugin's global active-run limit is a separate ceiling. Before
promotion to six lanes, the coordinator must run the FS-93 promotion validator
with live state and confirm both global workflow capacity and per-run agent
capacity are at least six. After the manifest's `currentLaneCap` is advanced to
six, update the checked-in workflow cap in the same reviewed change; the
deterministic validator will reject either side advancing alone.

## Deterministic qualification

Run the local policy/shape check and validate every saved workflow against the
live provider catalog:

```sh
fnm exec --using=22.19.0 -- node .bb/workflows/validate-fs-workflows.mjs
bb workflows validate --name fs-work-package
bb workflows validate --name fs-contract-freeze
bb workflows validate --name fs-gate-review
bb workflows validate --name fs-amendment-impact
```

The deterministic check reads the FS-93 manifest directly; runtime workflow
loading does not import plugin code. It checks every literal tuple, closed input
and phase shape, the mutation boundary, the readiness guard, and concurrency.

## FS-94 repair record

PR #13 was merged without independent GitHub or Task review evidence while the
PR #6 exact-base frozen audit was active. FS-94 repairs its model and safety
policy. No further integration merge is authorized without independent review,
green integration CI, and explicit sequencing by the active coordinator. No
workflow in this directory can merge or approve that integration step.

## Conventions

Scripts are plain JavaScript, not TypeScript. Wall-clock and random-number
operations throw, because they would break resume. Validate before running, and
prefer `--name` over pasting source. A run can be resumed with
`--resume <run-id>`; the longest unchanged prefix of successful agent calls is
replayed from cache.
