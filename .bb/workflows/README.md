# Finite State workflow factory

Saved bb workflows for the `bb-plugin-finite-state` build. Each resolves by
name from this directory:

```sh
bb workflows validate --name fs-work-package
bb workflows run --name fs-work-package --args '{"taskKey":"FS-24"}'
bb workflows status <run-id>
```

These replace ad-hoc thread spawning for the repeated steps. The manual pattern
produced 23 threads for 7 pull requests, with 30–140 minute idle gaps between
each step because every transition waited on a coordinator dispatch.

| Workflow | Args | What it does |
|---|---|---|
| `fs-work-package` | `{ taskKey, scope? }` | implement → 3 independent reviewers → repair verified findings → verify → report and mark `in_review` |
| `fs-contract-freeze` | `{ target }` | read-only: 4 reviewers (RPC, schema, registry, remote) → adversarial refutation → one-page decision brief for the human gate |
| `fs-gate-review` | `{ gate, criteria? }` | run a G0–G6 gate, independently verify the evidence, rule pass/fail/inconclusive |
| `fs-amendment-impact` | `{ amendment }` | draft-only: artifact, consumers, in-flight collisions, migration effect, fixtures |

## Invariants these encode

- **Reviewers run on `claude-code`, implementers inherit the dispatching
  preset.** Provider diversity is structural, not a convention someone forgets.
  A reviewer that shares the implementer's model shares its blind spots.
- **One editing agent at a time in a worktree.** Implement and repair edit;
  review and verify are read-only.
- **No workflow merges anything, approves a frozen artifact, or promotes a
  gate.** `fs-gate-review` may move a gate to `in_review` and no further.
  `fs-amendment-impact` drafts only.
- **Verifiers re-run checks themselves** rather than trusting an earlier
  agent's claim, and report from observed exit status.
- **Reviewers are asked whether a defect originates in the work package
  document or the specs**, because several already have — a repair aimed only
  at code re-diverges on the next work package.
- **Self-checkable findings are counted and reported**, so checks that belong
  in the gate migrate there instead of recurring as review round trips.

## Deliberately not built

`fs-factory-coordinator` is specified in the bootstrap plan but is not here. It
would read the task DAG, promote dependency-complete tasks, and dispatch
worktrees — that is standing authority over what runs, and it belongs to the
coordinator thread and its owner, not to a script contributed alongside the
work it dispatches. Two prerequisites are also unmet: task dependency edges are
not yet machine-checkable, and the worktree cap interacts with disk headroom
that is not yet monitored. Build it after the coupling and dependency pass
lands.

## Conventions

Scripts are plain JavaScript, not TypeScript. Wall-clock and random-number
operations throw, because they would break resume. Validate before running, and
prefer `--name` over pasting source. A run can be resumed with
`--resume <run-id>`; the longest unchanged prefix of successful agent calls is
replayed from cache.
