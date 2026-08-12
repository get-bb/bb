# WP-69 — Golden Loop beats 11–14

**Lane:** L8 Demo & E2E · **Spec:** SPEC 06 §6 beats 11–14 · **Effort:** 2 d · **Status:** unassigned
**Depends on:** WP-68 plus WP-39, WP-40, WP-52–55, WP-61 · **Blocks:** WP-70
**Produces a FROZEN artifact:** no

## Files you own
```
plugins/bb-plugin-finite-state/test/e2e/golden-loop/beats/beat-11-verdict.ts
plugins/bb-plugin-finite-state/test/e2e/golden-loop/beats/beat-12-one-commit.ts
plugins/bb-plugin-finite-state/test/e2e/golden-loop/beats/beat-13-trace.ts
plugins/bb-plugin-finite-state/test/e2e/golden-loop/beats/beat-14-attestation.ts
plugins/bb-plugin-finite-state/test/e2e/golden-loop/beats/beats-11-14.test.ts
```

## Files you must not touch
Production code, seed/harness core, previous beat files, frozen fixtures/interfaces, composition roots, or dependencies.

## Context
The last act proves the product's strongest claim: verification is derived from digest-bound evidence; source, security model, and decisions share one commit; the trace is clickable; and the exported attestation is independently inspectable. Offline CI validates a clearly labeled test attestation with bundled verification material. It must not claim a public Rekor entry or production signer that was not actually contacted.

## What to build
1. **Beat 11 — Evidence, not assertion.** Advance the seeded run through real owner-service ingestion to terminal success. Assert requirement results, artifacts, and attestation bind to the exact v2.4 digest. Render `fs-verdict`; deterministic rule yields green only when every mandatory gate is satisfied and no stale/gap rule blocks it.
2. Validate DSSE/in-toto structure and signature with bundled test verification material offline. Connected mode may additionally verify public transparency metadata; report the two modes distinctly.
3. **Beat 12 — One commit.** Assert the working diff includes `src/httpd/session.c`, `product-security/requirements/req-118.yaml`, and the stable-key triage YAML. Commit once in the disposable repo. Query the matrix and requirement card; status becomes Verified only because ingested results cover the contract and digest.
4. **Beat 13 — End-to-end trace.** Resolve and navigate `THREAT-22 → REQ-118 → clause → commit → check run → attestation`. Every hop must use a stable id and open the right local/domain view from warm cache within the performance budget.
5. **Beat 14 — Export attestation.** Download/export the exact DSSE envelope through the owner HTTP/binary path. Recompute payload/subject digest, enumerate requirement/check ids and verdict, and produce a verification receipt. Export bytes must equal the verified stored artifact.
6. Capture verdict, combined commit, trace rail, and attestation receipt as the closing artifact bundle.
7. Add negative runs for stale digest, missing mandatory evidence, failed check, and invalid signature; none may render green/Verified.

## Interface contract
```ts
export const beats11to14: readonly GoldenLoopBeat[] = [
  { number: 11, name: "signed evidence verdict", run: runBeat11 },
  { number: 12, name: "one commit spans three layers", run: runBeat12 },
  { number: 13, name: "end-to-end trace", run: runBeat13 },
  { number: 14, name: "export verifiable attestation", run: runBeat14 },
];

type GoldenLoopOutcome = ActTwoState & {
  verdict: "green";
  resultDigest: string;
  attestationId: string;
  finalCommit: string;
  traceIds: ["THREAT-22", "REQ-118", string, string, string, string];
  exportPath: string;
};
```

## Acceptance criteria
- [ ] Green/Verified derive from required results and exact firmware digest, never a button/test flag.
- [ ] Offline attestation validation is cryptographic/structural and labeled test evidence; no false public-log claim.
- [ ] One git commit contains source, model, and decision files.
- [ ] All six trace segments resolve and navigate from warm cache.
- [ ] Exported envelope bytes equal the artifact that was verified and shown.
- [ ] Stale/missing/failed/invalid evidence produces amber/red/stale and never Verified.
- [ ] No agent prose is treated as verdict evidence.
- [ ] Act completes without external network in offline mode.

## Test plan
`beats-11-14.test.ts`
- happy path for each beat and sequential act.
- `subject digest mismatch blocks green and marks requirement stale` (**binding error path**).
- `missing mandatory tier/check yields amber gap, not pass`.
- `invalid DSSE signature fails export receipt verification` (**integrity path**).
- `commit tree contains exactly the expected three product layers plus allowed metadata`.
- `trace hop with missing clause remains visible as broken, not silently omitted`.
- `export hash equals stored/verified artifact hash`.

## Do not
- Do not set `verification_status` directly or let a fixture truth flag bypass derivation.
- Do not claim public Rekor/OIDC provenance in offline fixture mode.
- Do not turn absent/manual evidence into a pass.
- Do not split the source/model/decision close into separate commits.
- Do not export a regenerated envelope that differs from the verified bytes.

## Open questions
1. Select the exact offline signature fixture format after WP-52 freezes its attestation adapter; preserve subject binding regardless of format.
2. Connected public-log verification is optional for G4 and must be separately timed/reported.

