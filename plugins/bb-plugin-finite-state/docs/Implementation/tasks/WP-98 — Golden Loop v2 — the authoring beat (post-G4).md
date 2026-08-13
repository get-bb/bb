# WP-98 — Golden Loop v2 — the authoring beat (post-G4)

**Lane:** L8 Demo & E2E · **Spec refs:** SPEC 08 §4.3, §6, §9.4 · SPEC 06 §6 + "Amendments applied by later specs" · Master Plan G4 · WP-70 runbook discipline · **Effort:** 2 d · **Status:** unassigned
**Depends on:** WP-69, WP-95, WP-96 · **Blocks:** — (post-G4 demo material; gates nothing)
**Produces a FROZEN artifact:** no

## Files you own

    plugins/bb-plugin-finite-state/test/e2e/golden-loop/v2/authoring-beat.ts
    plugins/bb-plugin-finite-state/test/e2e/golden-loop/v2/fixtures.ts
    plugins/bb-plugin-finite-state/test/e2e/golden-loop/v2/degrade.ts
    plugins/bb-plugin-finite-state/test/e2e/golden-loop/v2/authoring-beat.e2e.test.ts
    plugins/bb-plugin-finite-state/docs/demo/GOLDEN-LOOP-V2-AUTHORING.md

L8 additions to `test/e2e/` and `docs/demo/` only. Production lanes, the WP-65 harness core, WP-66 seeds, WP-67–69 beat modules, and WP-70's runbook files are all owned elsewhere.

## Files you must not touch

Production source, composition roots, frozen interfaces/fixtures, `test/e2e/golden-loop/{harness,scenario,assertions,reporter}.ts`, `test/e2e/golden-loop/beats/**`, `test/e2e/golden-loop/offline/**`, WP-70's four demo docs, `test/mock-remote/fixtures/**`, package.json, pnpm-lock.yaml.

## Context

Golden Loop v1 hand-waves the source fix: the agent uses native Edit and the beat lands quietly. SPEC 08 makes that beat real — "implement the fix in firmware source" becomes a grounded, citation-gated, gate-pipelined authoring pass. This WP scripts and rehearses that v2 beat **post-G4**: G4's bar (fourteen v1 beats, offline, warm cache, twice, under fifteen minutes) is **unchanged**, and nothing here may alter it. The v2 beat is additive demo material with its own runbook section and failure-recovery notes, following WP-70's discipline — offline, warm cache, deterministic fixtures, no silent fallbacks.

The scripted arc: the EARS requirement from beat 8 (REQ-118) → `fs_ground_query` returns a **cited** plan → citation-gated code, with one constant left uncited **on purpose, once**, so the audience watches the quarantine fire → the citation is found and the value re-enters → the authoring gate pipeline (`.fs/workflows/authoring-gate.yaml`, WP-95) runs its gates → `fs_build` (WP-96) produces a digest-bound `build_run` → the existing downstream beats — bench run, verdict card, requirement flips, one commit — proceed unchanged. If the L10 surfaces are unavailable, the beat **degrades to the v1 stub** (native Edit), labeled, never silently.

## What to build

1. The authoring beat as an insertable variant of the v1 source-edit step, runnable standalone and inside a full v2 pass. Starting state is the post-beat-8 warm seed: REQ-118 exists with an empty tier strip; the KEV finding is `IN_TRIAGE`.
2. Grounded plan: `fs_ground_query` calls against a pinned local grounding fixture (a catalog slice plus one indexed datasheet fixture covering the constants the fix needs). Assert every plan value carries a clickable citation — doc/page/anchor for plane B, `source_file` for plane A — and that the plane label is present on each result.
3. The deliberate quarantine: the authored change includes one hardware-touching constant written without a citation. Assert it lands in `.fs/authoring/citations/<file>.yaml` with `status: quarantined` and a note, appears in the review queue and the gutter annotation, and that the value was **blocked, not silently written**.
4. On-script resolution: a follow-up `fs_ground_query` finds the source; the value re-enters cited; assert the citation file records the resolution and the queue empties.
5. Gate pipeline: run `.fs/workflows/authoring-gate.yaml` — citations (`no_quarantined_values`), static, secrets, build — and capture per-gate status. A negative fixture with a still-quarantined value must fail the citations gate and block the pipeline.
6. Build: `fs_build` yields a `build_run` row whose `digest` is the attestation subject the downstream beats verify — assert the join holds so "this requirement flipped because *this* build passed" is a database fact, not narration.
7. Downstream: drive the existing bench-dispatch, verdict, one-commit, trace, and attestation beats over the v2 working tree without editing their modules. The v2 one-commit assertion is this WP's own: the commit additionally contains the citation YAML (and the gate file if changed); do not weaken WP-69's exact-three v1 check.
8. Degradation: `detectAuthoringSurfaces` probes for the L10 registrations (grounding query, citation store, gate runner, `fs_build`). Unavailable → run the v1 stub beat, stamp the report `mode: "v1-stub-fallback"` with the missing surfaces named, and keep every downstream assertion green. No silent substitution in either direction.
9. Runbook section (`GOLDEN-LOOP-V2-AUTHORING.md`): operator prompts, expected screen states (citation gutter, quarantine queue, gate pipeline card, build result), timing marks, and failure-recovery notes keyed by symptom — grounding index cold, quarantine that will not resolve, gate failure mid-demo, toolchain missing (`needsConfiguration`), bench fallback — each with a safe resume and the v1-stub bailout labeled as such. Every fenced CLI command is executed in test mode by the doc checks.
10. Hard exclusions, asserted: no `fs_flash`, no serial send, no physical hardware, no external network anywhere in the beat. The build is the only subprocess and it runs against the deterministic toolchain fixture.

## Interface contract

    export const authoringBeatV2: GoldenLoopBeat;   // WP-65 beat shape; insertable variant of the v1 source-edit step

    export interface AuthoringBeatOutcome {
      mode: "v2-authoring" | "v1-stub-fallback";
      missingSurfaces: string[];                    // empty in v2 mode
      requirementId: "REQ-118";
      citedPlanValues: number;                      // all cited, counted
      quarantine: { symbol: string; queued: true; resolvedBy: "citation"; citationFile: string };
      gateReport: { pipeline: ".fs/workflows/authoring-gate.yaml";
                    gates: Array<{ id: string; status: "passed" | "failed" | "skipped" }> };
      buildRunId: string;
      buildDigest: string;                          // must equal the attestation subject downstream
    }

    export function detectAuthoringSurfaces(harness: GoldenLoopHarness):
      Promise<{ available: true } | { available: false; missing: string[] }>;
    export function runAuthoringBeat(harness: GoldenLoopHarness): Promise<AuthoringBeatOutcome>;

## Acceptance criteria

- [ ] The v1 fourteen-beat pass is byte-for-byte unaffected: G4 suites run green with this WP's files present and the v2 beat never invoked.
- [ ] Every value in the authored change is cited or quarantined; the scripted uncited constant is demonstrably blocked before resolution and cited after.
- [ ] The citations gate fails the pipeline while a quarantined value exists; no gate can be skipped by a fixture flag.
- [ ] `build_run.digest` equals the attestation subject verified downstream; the requirement flips only after ingested results cover it.
- [ ] The v2 commit spans source, model, decisions, and the citation YAML in one commit.
- [ ] With L10 surfaces absent, the beat completes in labeled v1-stub mode with the missing surfaces enumerated; nothing renders as v2.
- [ ] The full v2 pass runs offline from warm cache with zero external network, twice, deterministically.
- [ ] `fs_flash`, serial send, and physical-hardware paths are provably unreachable from the beat.
- [ ] Doc checks execute every runbook command and validate referenced paths, counts, and error codes.

## Test plan

`authoring-beat.e2e.test.ts`
- happy path: full v2 beat plus downstream beats from a fresh warm-seed copy, twice; compare semantic outcomes.
- `uncited constant is quarantined, queued, and blocked from the source write` (**gating error path**).
- `pipeline fails closed while quarantine is non-empty; passes after citation` (**gate error path**).
- `digest mismatch between build_run and attestation subject fails the beat` (**binding error path**).
- `missing grounding surface degrades to labeled v1 stub, not silent v2` (**degradation path**).
- `network guard reports zero external calls across the v2 pass` (**offline path**).
- `beat module imports reach no flash/serial/probe surface` (static import scan).

## Do not

- Do not modify v1 beats, the harness, seeds, or WP-70's docs — G4's bar is untouchable.
- Do not let a fixture flag bypass the citation gate, the pipeline, or digest derivation.
- Do not flash, send serial, claim instruments, or touch any physical device in a demo beat.
- Do not renumber the shipped v1 `BeatNumber` union or fork the beat-runner to accommodate v2.
- Do not conflate v2 and v1-stub provenance in any report, screen, or runbook claim.

## Open questions

1. Beat numbering is inconsistent upstream: SPEC 06's script places the source edit at beat 9, while SPEC 08 and the index call it "beat 11." Pick the presentation numbering with the demo owner; the harness's v1 `BeatNumber` stays untouched either way.
2. Whether the v2 one-commit story presents the citation YAML as a fourth product layer or as allowed metadata — align the narration with WP-69's owner before rehearsal so the two runbooks don't contradict.
3. WP-95's gate-runner invocation surface and WP-96's exact tool registration names are unmerged at authoring time; adapt fixture wiring at this boundary and record any drift rather than patching their lanes.
