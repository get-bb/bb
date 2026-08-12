# WP-70 — Offline mode, demo runbook & failure recovery

**Lane:** L8 Demo & E2E · **Spec:** SPEC 00 §10–12 · SPEC 06 §7–9 · Master Plan G4 · **Effort:** 2 d · **Status:** unassigned
**Depends on:** WP-69, WP-64 and all Golden Loop production dependencies · **Blocks:** G4 release/demo gate
**Produces a FROZEN artifact:** no

## Files you own
```
plugins/bb-plugin-finite-state/test/e2e/golden-loop/offline/network-guard.ts
plugins/bb-plugin-finite-state/test/e2e/golden-loop/offline/failures.ts
plugins/bb-plugin-finite-state/test/e2e/golden-loop/offline/offline.e2e.test.ts
plugins/bb-plugin-finite-state/test/e2e/golden-loop/offline/recovery.e2e.test.ts
plugins/bb-plugin-finite-state/docs/demo/GOLDEN-LOOP-RUNBOOK.md
plugins/bb-plugin-finite-state/docs/demo/FAILURE-RECOVERY.md
plugins/bb-plugin-finite-state/docs/demo/PREFLIGHT-CHECKLIST.md
plugins/bb-plugin-finite-state/docs/demo/CONNECTED-REHEARSAL.md
```

## Files you must not touch
Production behavior to make the demo pass, seed/frozen fixtures, composition roots, frozen interfaces, dependencies, or live tenant data.

## Context
G4 requires the Golden Loop to run unattended and offline from a warm cache, twice, under fifteen minutes. “Offline” means no undeclared external network; local mock transports and the in-process deterministic bench/Forge fixture stand in for remote dependencies while exercising the same public adapters. The human demo runbook is a separate connected rehearsal mode with explicit preflight and fallbacks. Failure recovery is part of the product story: gaps remain visible and every interrupted write leaves reviewable state.

## What to build
1. Harden the network guard across fetch/HTTP/MCP/socket paths used by the plugin. Log and fail the originating beat on any undeclared external destination.
2. Run all fourteen beats twice from independently copied warm seeds. Assert semantic reports/commits/evidence match and total duration stays below fifteen minutes per run on the documented reference machine.
3. Define and inject six named failure scenarios with deterministic trigger points and recovery assertions:
   - stale upstream tuple / same-field conflict before push;
   - partial VEX bulk failure plus mid-push disconnect with resumable base advance;
   - interrupted policy/CAS writer mid-batch;
   - firmware unpack gap or API admin-byte denial;
   - bench host unavailable/job timeout or ambiguous dispatch;
   - attestation/signature/firmware-digest mismatch.
4. For each scenario, assert the UI/status/plan names the gap, no unsupported success is shown, and the documented recovery reaches a coherent state without deleting evidence.
5. Write a stage runbook with exact preflight, cache warm/verify commands, expected counts, operator prompts/actions, screen transitions, timing marks, and four “oh moment” checkpoints. Keep connected-only steps visibly labeled.
6. Write a recovery guide keyed by symptom and error code, including artifact locations and safe resume/retry rules. Non-idempotent actions say “query status first.”
7. Write a preflight checker using existing CLI commands: plugin configuration, seed/cache hashes, git cleanliness of the disposable demo worktree, firmware digest/full materialization, host enrollment/daemon in connected mode, dev tenant reset, and evidence fixture validation.
8. Rehearse via a second operator: two consecutive offline automation passes and two human runbook passes. Record duration and deviations as artifacts; do not weaken assertions to fit staging.
9. Ensure no fallback is silent: offline fixture, connected dev tenant, canned run, and public-log availability each display their provenance.

## Interface contract
```ts
export type FailureScenario =
  | "sync-conflict"
  | "partial-push-disconnect"
  | "writer-interrupted"
  | "firmware-gap-or-admin-denied"
  | "bench-unavailable-or-ambiguous"
  | "attestation-binding-invalid";

export interface RecoveryProof {
  scenario: FailureScenario;
  visibleStatus: string;
  unsupportedSuccessShown: false;
  durableArtifacts: string[];
  recoverySteps: string[];
  finalState: "resumable" | "recovered" | "honestly-blocked";
}

export function injectFailure(name: FailureScenario, at: string): void;
export function assertRecovery(name: FailureScenario): Promise<RecoveryProof>;
```

Required runbook commands use the shipped CLI only; examples must be verified by `harness.runCli` during doc tests.

## Acceptance criteria
- [ ] Full Golden Loop runs twice offline from fresh warm-seed copies, with zero external requests and <15 minutes each.
- [ ] All six failures produce honest visible state and a tested recovery/resume path.
- [ ] Partial push advances base only for successes and resumes without re-sending noops.
- [ ] Interrupted local writes leave valid YAML and convergent rerun behavior.
- [ ] Firmware/bench/evidence gaps can never produce green safe-to-OTA or Verified.
- [ ] Runbook commands, expected counts, paths, and screenshots/cards match the shipped product.
- [ ] A second person can execute the human runbook twice without builder intervention.
- [ ] Offline, connected, canned, and public evidence provenance are never conflated.
- [ ] Four-command plugin gate plus all E2E/recovery suites are green.

## Test plan
`offline.e2e.test.ts`
- two complete runs; compare semantic report, final git tree, plan results, verdict, and attestation hash.
- `unexpected HTTPS/DNS/socket call fails immediately` (**offline error path**).
- enforce reference timing budget and report slowest beat.

`recovery.e2e.test.ts`
- one test per six named scenarios.
- `mid-push reset resumes only failed/pending rows`.
- `killed writer leaves parseable YAML and incomplete run marker`.
- `admin denial renders metadata-only state and standalone-unpack recovery`.
- `ambiguous bench dispatch queries existing run before retry`.
- `digest/signature mismatch blocks verdict`.

Documentation checks:
- execute every fenced CLI command in dry-run/test mode.
- validate all referenced files/error codes/expected seed counts exist.

## Do not
- Do not disable networking without proving every attempted request is caught.
- Do not alter production rules, evidence, or counts only for the demo.
- Do not call an unchanged external state a successful offline result.
- Do not retry non-idempotent dispatch before checking status.
- Do not hide failures, unpack gaps, stale evidence, connected skips, or canned provenance.
- Do not run destructive reset commands against a real tenant or the developer's checkout.

## Open questions
1. Record the reference machine/profile for the fifteen-minute gate and separate product regressions from slow shared CI workers.
2. The connected runbook needs an approved dev-tenant reset command; omit automated reset rather than infer destructive authority.
