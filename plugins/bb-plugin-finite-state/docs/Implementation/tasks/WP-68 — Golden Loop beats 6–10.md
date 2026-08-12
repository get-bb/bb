# WP-68 — Golden Loop beats 6–10

**Lane:** L8 Demo & E2E · **Spec:** SPEC 06 §6 beats 6–10 · **Effort:** 2 d · **Status:** unassigned
**Depends on:** WP-67 plus WP-19–21, WP-32–40, WP-50, WP-52–54, WP-59–62 · **Blocks:** WP-69
**Produces a FROZEN artifact:** no

## Files you own
```
plugins/bb-plugin-finite-state/test/e2e/golden-loop/beats/beat-06-plan-push.ts
plugins/bb-plugin-finite-state/test/e2e/golden-loop/beats/beat-07-threat-model.ts
plugins/bb-plugin-finite-state/test/e2e/golden-loop/beats/beat-08-requirement.ts
plugins/bb-plugin-finite-state/test/e2e/golden-loop/beats/beat-09-source-fix.ts
plugins/bb-plugin-finite-state/test/e2e/golden-loop/beats/beat-10-bench-dispatch.ts
plugins/bb-plugin-finite-state/test/e2e/golden-loop/beats/beats-06-10.test.ts
```

## Files you must not touch
Production code, seed/harness core, earlier/later beat files, frozen fixtures/interfaces, composition roots, or dependencies.

## Context
The second act moves reviewed intent through the human sync gate, traces the held KEV finding into the threat model, creates a validated EARS requirement, changes source, and dispatches evidence work. RECON corrects the old demo wording: bb exposes no plugin-configurable per-tool approval. Beat 10 may display a generic host approval if the running bb policy provides one, but the testable safety claim is the compile-time action allowlist, audit record, and absence of model mutation—not invented approval metadata.

## What to build
1. **Beat 6 — Plan/conflict/push.** Seed one upstream human edit among the 304 reviewed decisions. Render the plan with 303 directly pushable updates and one field conflict, show base/ours/theirs plus attribution, have `human.resolveConflict` choose theirs, then `human.push`. Assert 303 applied, the take-theirs item resolved locally with no redundant server write, no failed rows, provenance stamp, per-entity base advance, and no agent push call.
2. **Beat 7 — Finding meets model.** Query the held KEV and TARA links. Render read-only `fs-canvas` focused on `COMP-httpd` with `THREAT-22`/attack path highlighted. Assert the threat exists and no requirement currently covers the missing session-binding mitigation.
3. **Beat 8 — Draft EARS requirement.** Attempt one deliberately invalid event-driven `REQ-118`, assert structured gate failure and zero-byte write, correct it, then persist valid YAML linked to THREAT-22 and the seeded CRA clause/check contract. Render `fs-req` showing Not run.
4. **Beat 9 — Fix source.** Use harness-native file edit in the disposable repo to update `src/httpd/session.c`, cite `REQ-118`, and update the held decision to `IN_TRIAGE` referencing the requirement. Assert source, model, and decision changes remain uncommitted together for Beat 12.
5. **Beat 10 — Dispatch bench.** Call the canonical action after asserting v2.4 full materialization and digest equality. Record audit entry, run/thread ids, and realtime hints. In offline mode dispatch to deterministic local host/job fixtures; connected mode uses an enrolled `host-daemon` target.
6. Explicitly test that an incomplete/digest-mismatched mount blocks dispatch before Forge/host invocation.
7. Capture plan/domain diff, canvas, requirement error+corrected card, combined working diff, and live bench thread/timeline artifacts.

## Interface contract
```ts
export const beats06to10: readonly GoldenLoopBeat[] = [
  { number: 6, name: "plan conflict and human push", run: runBeat06 },
  { number: 7, name: "finding meets threat model", run: runBeat07 },
  { number: 8, name: "draft validated requirement", run: runBeat08 },
  { number: 9, name: "fix firmware source", run: runBeat09 },
  { number: 10, name: "dispatch bench evidence run", run: runBeat10 },
];

type ActTwoState = ActOneState & {
  pushRunId: string;
  requirementId: "REQ-118";
  sourcePath: "src/httpd/session.c";
  benchRunId: string;
  benchThreadId: string;
  firmwareDigest: string;
};
```

## Acceptance criteria
- [ ] Beat 6 uses an explicit human harness action for conflict resolution and push; no agent tool can perform either.
- [ ] Partial-base/provenance/audit state after push is verifiable from durable records.
- [ ] Beat 7 renders the actual canvas/query result and proves the missing requirement link.
- [ ] Invalid EARS input writes nothing; corrected REQ-118 round-trips and starts Not run.
- [ ] Beat 9 leaves source+requirement+decision together in the same worktree.
- [ ] Bench dispatch is bound to the exact fully materialized firmware digest.
- [ ] Action audit does not assert a configurable per-tool approval contract.
- [ ] Offline mode uses the deterministic host/job fixture with no external network.

## Test plan
`beats-06-10.test.ts`
- one state/evidence contract per beat and sequential act test.
- `same-field conflict cannot auto-merge; human takes theirs` (**conflict path**).
- `invalid EARS first attempt leaves no REQ-118 file` (**validation path**).
- `canvas highlight ids resolve across stable slugs`.
- `digest mismatch and incomplete mount each prevent dispatch` (**evidence safety path**).
- `bench ambiguous response produces one run and status-query recovery, not duplicate dispatch`.
- `agent registry has no path to human push service`.

## Do not
- Do not auto-resolve the conflict or call push from an agent tool.
- Do not claim a generic bb approval UI is configurable per action tool.
- Do not write `verification_status`; it remains derived.
- Do not dispatch against placeholders, partial bytes, or an unpinned digest.
- Do not fabricate CRA text or check criteria; use seeded source material verbatim.

## Open questions
1. Choose whether connected rehearsal shows bb's generic approval UI; if shown, label it platform policy, not a plugin security guarantee.
2. Confirm the exact thread-spawn API and environment binding after WP-53; offline assertions consume the owner service contract.
