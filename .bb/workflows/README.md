# Finite State workflow factory

The four saved Finite State workflows are checked in as **dormant, validated
source** and are runtime-quarantined pending FS-95. Every script throws this
exact error as its first executable statement, before any `phase()` or
`agent()` path:

```text
FS-95: Finite State saved workflows are quarantined until native stage capabilities, machine-verified live Tasks readiness, and an environment editing mutex are available.
```

Do not run these workflows for autonomous work. Continue through Tasks and
separately provisioned implementation/review threads until FS-95 supplies the
native runtime controls described below.

## Dormant workflow source

| Workflow | Closed args | Intended shape after FS-95 |
|---|---|---|
| `fs-work-package` | `{ taskKey, profile, scope? }` | readiness preflight → implement → 3 independent reviewers → repair → verify → report; `profile` is exactly `fs-standard` or `fs-critical` |
| `fs-contract-freeze` | `{ target }` | 4 contract reviewers → adversarial refutation → decision brief |
| `fs-gate-review` | `{ gate, criteria? }` | execute G0–G6 checks → independent verification → pass/fail/inconclusive ruling |
| `fs-amendment-impact` | `{ amendment }` | artifact, consumer, collision, migration, and fixture analysis → draft |

The source remains intentionally complete so FS-95 can enable it after adding
the required primitives without losing the reconciled shapes, prompts, model
policy, or safety intent. Passing `bb workflows validate` proves syntax,
schemas, and literal catalog selections; it does not make the scripts safe to
execute past quarantine.

## Why runtime quarantine is required

The pinned bb workflows runtime cannot enforce the three guarantees FS-94
requires:

1. **Per-stage mutation capability.** `agent()` options have no permission or
   tool restriction. Workers inherit the origin permission and reuse its
   environment, so a prompt labelled read-only remains technically able to
   edit files or mutate Tasks/GitHub when the origin is write-capable.
2. **Machine-verified live Tasks readiness.** Workflow QuickJS has no native
   readiness primitive. A preflight agent can inspect Tasks and return a
   structured claim, but the workflow would still be trusting model-attested
   readiness rather than a machine decision over live dependency, cluster,
   sequence, preset, and lane state.
3. **An environment editing mutex.** The runtime limits active runs and
   per-run agent concurrency but does not serialize editing stages across
   different runs that reuse one environment. Two runs could therefore reach
   an editing stage in the same worktree concurrently.

Prompt prefixes, `EDITING_PHASES`, closed schemas, and per-script batching are
useful dormant design constraints, not executable security boundaries. FS-95
owns native stage capabilities, live readiness enforcement, and the
environment-scoped editing mutex. This repository does not patch the workflows
runtime as part of FS-94.

## Authoritative dormant model policy

The source of truth is
`plugins/bb-plugin-finite-state/docs/Implementation/scheduling/wp-coupling-manifest.json`:

| Preset | Literal tuple | Dormant use |
|---|---|---|
| `fs-review` | `claude-code` / `claude-opus-5[1m]` / `high` | Review and verifier paths |
| `fs-standard` | `codex` / `gpt-5.6-sol` / `medium` | Routine work-package paths |
| `fs-critical` | `codex` / `gpt-5.6-sol` / `xhigh` | Critical work-package and synthesis paths |

No dormant agent path inherits the workflow origin selection.
`fs-work-package` has a closed schema that rejects a missing profile and any
profile other than `fs-standard` or `fs-critical` before the script body.

## Current operating path

Autonomous Finite State work continues through the Tasks preset selected by
the FS-93 manifest. The active coordinator verifies live dependency-cluster
readiness, provisions an implementation thread in its own managed worktree,
and dispatches independent review as a separate thread/provider. Only the
coordinator sequences promotion and any separately authorized integration
merge. The saved workflows neither dispatch nor coordinate this path.

The current four-worktree cap remains a program scheduling rule. Future
six-lane promotion still requires the FS-93 promotion validator and verified
global workflow capacity, but changing capacity alone does not lift this
quarantine. FS-95 must land and the dormant factory must receive fresh
independent exact-head qualification before execution is enabled.

## Deterministic qualification

Validate dormant source and the runtime quarantine:

```sh
fnm exec --using=22.19.0 -- node .bb/workflows/validate-fs-workflows.mjs
bb workflows validate --name fs-work-package
bb workflows validate --name fs-contract-freeze
bb workflows validate --name fs-gate-review
bb workflows validate --name fs-amendment-impact
```

The deterministic check reads the FS-93 manifest directly; runtime workflow
loading does not import plugin code. It proves the exact unconditional FS-95
throw is the first executable statement in every script and occurs before all
`phase()`/`agent()` paths. It also preserves checks for dormant literal tuples,
closed args, declared phase shape, intended mutation phases, and batching.

Valid-input run attempts must fail with the exact FS-95 error and show zero
agent calls. The `fs-work-package` missing-profile and unknown-profile cases
must continue to fail at input validation before script execution.

## FS-94 repair and incident record

PR #13 was merged without independent GitHub or Task review evidence while the
PR #6 exact-base frozen audit was active. FS-94 repaired its stale model policy,
qualified the dormant source, and quarantined execution after independent
review found the pinned runtime could not enforce the claimed boundaries. No
further integration merge is authorized without fresh independent review,
green integration CI, and explicit sequencing by the active coordinator.

`fs-factory-coordinator` remains deliberately absent. A saved script must not
hold standing authority to promote tasks or dispatch worktrees.

## Conventions

Scripts are plain JavaScript, not TypeScript. Wall-clock and random-number
operations throw because they break resume. Validate source before any future
FS-95 enablement change and prefer `--name` over pasted source.
