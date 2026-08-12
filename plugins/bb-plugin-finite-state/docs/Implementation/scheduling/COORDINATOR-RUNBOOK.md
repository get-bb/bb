# Finite State coordinator runbook

Use this runbook for every dispatch after FS-93. It preserves historical WP keys while ensuring one active member per decision-owner cluster.

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

Do not raise the cap until the command exits zero with live state. Six lanes require at least six independent active-or-ready decision clusters, 35 GiB free after provisioning, and a 30 GiB runtime floor. The floor uses the measured 3.4–4.9 GiB managed-worktree range rather than the lower early estimate.

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

Replace the example values with current observations. Before evaluating nine lanes, archive completed threads, preserve recoverable branches, prune completed managed worktrees through bb's environment lifecycle, and remeasure free space. A zero exit requires that pruning/free-space recovery step to be explicitly complete, prior six-lane operation, nine independent active-or-ready clusters, 45 GiB free after provisioning, and a 35 GiB runtime floor. Managed worktrees measured 3.4–4.9 GiB, so use current measurements rather than a fixed marginal estimate. Record the cleanup evidence, command, and JSON result on the program-control Task before changing the cap.

## 4. Dispatch through the required preset

Use the manifest's preset and add instructions that name the cluster and sequence:

```sh
bb tasks dispatch FS-29 --preset fs-critical --instructions "C-SYNC-TRANSACTION sequence 1; do not begin any later cluster member."
bb tasks dispatch FS-38 --preset fs-standard --instructions "C-FINDING-UX sequence 1; do not begin any later cluster member."
```

All L2 sync work and the L4 canvas use `fs-critical`. Routine or mechanical work uses `fs-standard`. Never substitute a lower tier for those critical lanes.

## 5. Review and close

After implementation evidence and a draft PR are attached, leave the WP `in_review` and dispatch an independent review:

```sh
bb tasks dispatch FS-93 --preset fs-review --instructions "Review only. Do not merge. Verify the linked draft PR against the Task acceptance criteria and report actionable evidence."
```

The review preset is Claude Opus 5 at high reasoning. The reviewer must not be the implementation thread. Only a separately authorized integrator changes a WP from `in_review` to `done` or merges its PR.

## 6. Tasks limitations and audit trail

The Tasks surface cannot enforce dependency edges, sequence locks, or decision-owner mutual exclusion. Comments and labels are advisory mirrors. The deterministic validator and coordinator discipline provide enforcement. If a Task comment and manifest disagree, stop dispatch, correct the inconsistency, and rerun validation; do not silently choose one.
