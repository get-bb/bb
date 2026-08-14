# WP-67 — Golden Loop beats 1–5

**Lane:** L8 Demo & E2E · **Spec:** SPEC 06 §6 beats 1–5 · **Effort:** 2 d · **Status:** unassigned
**Depends on:** WP-61, WP-62, WP-63, WP-64, WP-65, WP-66 and all L2/L3 prerequisites · **Blocks:** WP-68
**Produces a FROZEN artifact:** no

## Files you own

```
plugins/bb-plugin-finite-state/test/e2e/golden-loop/beats/beat-01-workspace.ts
plugins/bb-plugin-finite-state/test/e2e/golden-loop/beats/beat-02-current.ts
plugins/bb-plugin-finite-state/test/e2e/golden-loop/beats/beat-03-size-work.ts
plugins/bb-plugin-finite-state/test/e2e/golden-loop/beats/beat-04-policy.ts
plugins/bb-plugin-finite-state/test/e2e/golden-loop/beats/beat-05-review-diff.ts
plugins/bb-plugin-finite-state/test/e2e/golden-loop/beats/beats-01-05.test.ts
```

## Files you must not touch

Production code, seed generator/corpus, harness core, later beat files, fixture corpus, frozen interfaces, composition roots, or dependencies. The fixture exclusion is ownership, not the retired WP-08 freeze.

## Context

The first act establishes the product: one worktree, recovered decision memory, focused agent retrieval, routine policy automation, and a human-readable diff. Beat 5 is the first “oh moment.” Tests must prove the agent wrote local intent only and that a human can edit/reject it before any server push.

## What to build

1. **Beat 1 — One workspace.** Open/render the tree and assert source, `product-security/`, `.fs/triage/`, and `.fs-firmware/<pv>/rootfs` coexist. Validate file count from the mount manifest, not DOM text alone.
2. **Beat 2 — Bring current.** Run manifest/pull/status via public surfaces. Assert v2.4 diff facts and drift buckets: 14 reattached/recovered, 9 stale, 2 orphaned. Manifest operation downloads zero bytes in the seeded warm path.
3. **Beat 3 — Size work.** Call `fs_findings_query` for v2.4 untriaged. Assert 412 total, 306 policy matches, one reachable KEV held item, and compact directive-ready stable id. Render `fs-finding` warm-cache card.
4. **Beat 4 — Apply routine policy.** Dry-run first, then write. Assert 305 decisions, one KEV hold, no overwrite of existing decisions, live overlay invalidation, and no remote write. Render `fs-triage-summary` from durable run state.
5. **Beat 5 — Human reviews diff.** Through `human.reviewDiff`, inspect tracked YAML diff, edit one weak reason, delete one proposed block, and stage/commit in the disposable git repo. Assert provenance remains honest and final reviewed count is 304.
6. Capture artifact bundles for tree, drift status, finding card, policy summary, and reviewed diff/commit. Scrub absolute temp paths from golden reports.
7. Add one interruption point during policy application; state must remain valid/reviewable and a rerun converge.

## Interface contract

```ts
export const beats01to05: readonly GoldenLoopBeat[] = [
  { number: 1, name: "one workspace", run: runBeat01 },
  { number: 2, name: "bring current", run: runBeat02 },
  { number: 3, name: "size new work", run: runBeat03 },
  { number: 4, name: "policy does routine work", run: runBeat04 },
  { number: 5, name: "agent work is a diff", run: runBeat05 },
];
```

Beat outputs passed forward:

```ts
type ActOneState = {
  pvId: string;
  firmwareDigest: string;
  heldStableKey: string;
  policyRunId: string;
  reviewedDecisionCount: 304;
  reviewCommit: string;
};
```

## Acceptance criteria

- [ ] Beats run in order and independently from documented prerequisites.
- [ ] Counts come from cache/YAML/plan state and match the seed manifest.
- [ ] Finding identity is stable-key based; ephemeral UUID is never passed between beats.
- [ ] Policy cannot override KEV holdback or an existing human decision.
- [ ] Beat 5 produces a real git diff and commit in the disposable worktree.
- [ ] No upstream mutation occurs in beats 1–5.
- [ ] Interrupted policy execution leaves valid YAML; rerun reaches the same semantic state.
- [ ] All directive assertions pass from warm cache with network disabled.

## Test plan

`beats-01-05.test.ts`

- one happy-path contract per beat and sequential act test.
- `mount count and digest agree across file tree/cache/seed manifest`.
- `query response stays bounded while total remains 412`.
- `KEV item remains held even when broad policy matches it` (**safety path**).
- `kill after N writes; status explains partial run; rerun converges` (**interruption path**).
- `human deletion reduces proposed plan without hidden cache residue`.

## Do not

- Do not hard-code pass flags independent of durable state.
- Do not use finding UUIDs as identity or fabricate a policy reason.
- Do not push in this act.
- Do not treat a cold cache as zero findings.
- Do not commit to the developer's repository.

## Open questions

1. Finalize the stage-visible file count with WP-66; assertions read the manifest so copy stays truthful.
2. Choose the exact edited/deleted decision fixtures for the strongest readable diff while keeping expected count 304.
