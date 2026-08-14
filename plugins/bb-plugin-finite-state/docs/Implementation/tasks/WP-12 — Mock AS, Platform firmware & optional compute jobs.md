# WP-12 — Mock AS, Platform firmware & optional compute jobs

**Lane:** L1 Remote services & mocks · **Spec refs:** SPEC 03 · SPEC 05 · Direct APIs ADR · AS/Platform API references · **Effort:** 2.5 d · **Status:** unassigned
**Depends on:** WP-10, WP-08 · **Blocks:** WP-13, WP-17, WP-31, WP-40, WP-49, WP-53
**Produces a FROZEN artifact:** no — consumes fixture-fidelity-governed fixtures and frozen interfaces

## Files you own

`plugins/bb-plugin-finite-state/test/mock-remote/assurance-studio/{state,register,crud,verification}.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/platform/{firmware,security-assessment}.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/forge-compute/{state,register,jobs}.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/assurance-studio/*.test.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/platform/firmware*.test.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/forge-compute/*.test.ts`

## Files you must not touch

WP-10 framework/generated files, WP-11 files, fixture corpus, frozen interfaces, production clients/lanes, package/lock files.

## Context

L4 and L6 need three distinct owners: AS owns TARA/requirements/verification data, Platform owns firmware bytes and STP-backed assessment data, and Forge optionally owns QEMU/pen-test compute jobs. The mock must prove those boundaries and independent failure behavior. There is no raw AS request and no generic Forge tool adapter.

## What to build

1. Load coherent TARA/requirements/checks, firmware, and compute-job fixtures into three resettable states. Preserve `review_version`, TARA head/hash, audit attribution, references, firmware digests, and ordered job events.
2. Register handler-backed AS list/get/create/update/delete operations by route id. Attack-path create remains absent. Preserve `{success,entity,review_status_set}` semantics and exact AS list envelope.
3. Implement delete `cascade|detach`, 409 `DeletionImpact`, `human_edited`, review version, and TARA head/hash checkpoint behavior only where handler evidence is vendored.
4. Implement AS verification check/result/run operations frozen in WP-06. Unknown/unverified creation/write paths return unavailable; never route them through a generic function.
5. Implement direct Platform firmware tree/overview and meta/range/full. Tree never returns bytes; range caps at 131072; full streams a `RemoteArtifact`; byte modes enforce the mock admin permission. No `save_to` crosses the WP-06 boundary.
6. Implement the ten enumerated Platform security-assessment relays by closed `SecurityAssessmentTool` value. No arbitrary STP function name.
7. Implement nullable Forge compute from the checksummed manifest: `verifyDynamic`, `penTestRun`, and job status/list/watch with normalized `RUNNING→COMPLETED|FAILED|TIMEOUT`. Keep the reserved root-preparation member explicitly unsupported until WP-50 proves its non-MCP same-host lifecycle; do not mock a successful method that the pinned Forge source does not expose. No Platform/AS CRUD method exists in this service.
8. Use an injected clock/controller; no sleeps, Docker, QEMU, PostgreSQL, or verifier binary.

## Interface contract

```ts
export interface MockAssuranceStudioState {
  head: { versionId: string; workingHash: string };
  list(kind: AsEntityKind): AsEntity[];
  audit(kind: AsEntityKind, id: string): AuditEntry[];
  snapshot(): unknown;
  reset(): void;
}
export interface MockForgeComputeController {
  configured: boolean;
  prepare(input: {
    projectVersionId: string;
    rootPath: string;
    expectedDigest: string;
  }): { prepared: false; reason: "UNSUPPORTED_UNVERIFIED_MAPPING" };
  create(
    tool: "verifyDynamic" | "penTestRun",
    input: unknown,
  ): { jobId: string };
  advance(jobId: string, next: "COMPLETED" | "FAILED" | "TIMEOUT"): void;
  get(jobId: string, tailLines: number): ForgeJobSnapshot;
  reset(): void;
}
```

## Acceptance criteria

- [ ] AS kinds list/get/update/delete through handler-backed routes; create exists only where verified.
- [ ] Attack-path creation and every raw/generic request are absent.
- [ ] AS casing/page base, review status/version, delete impact, and TARA checkpoint semantics are exact.
- [ ] Verification methods exist only when frozen and evidenced.
- [ ] Platform firmware tree is byte-free; range/full enforce cap/admin and normalized streams.
- [ ] All ten assessment relay values return deterministic Platform fixtures; an eleventh cannot compile.
- [ ] Forge compute is nullable and contains only compute/root/job methods.
- [ ] Job transitions use exactly four states with deterministic event order.
- [ ] Core Platform/AS tests pass with Forge compute not configured.
- [ ] Typecheck/test/lint/build is green.

## Test plan — `mock-service-ownership`

- `AS CRUD matrix, paging, review outcome, and checkpoint`.
- `attack-path create and raw request are impossible` (**compile/security paths**).
- `referenced delete → 409; detach/cascade differ` (**error paths**).
- `firmware depth and missing scan; unauthorized bytes 403` (**fault paths**).
- `range 131072 succeeds, 131073 rejects; full hash matches` (**boundary/error path**).
- `unknown assessment tool cannot compile` (**security path**).
- `compute absent leaves AS/Platform healthy` (**degradation path**).
- `unverified root preparation stays unsupported; jobs reach every terminal state` (**error/fault paths**).

## Do not

- Do not implement `as_raw_api`, generic fetch/path, or generic MCP invocation.
- Do not place firmware data methods on Forge compute.
- Do not make attack-path POST work while handler evidence says it is a stub.
- Do not require live infrastructure or wall-clock sleeps.
- Do not edit route generation or fixtures to fit handlers.

## Open questions

1. Remove any WP-06 AS verification method that cannot be tied to the target handler commit before freeze; absence is safer than a guessed path.
2. Decide whether local-appliance root preparation belongs in the compute adapter or process supervisor; remote mode remains explicitly unsupported until secure.
