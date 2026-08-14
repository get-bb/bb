# WP-13 — Remote mocks — fault injection & live-drift quirks — GATE

**Lane:** L1 Remote services & mocks · **Spec refs:** Master Plan §7–§8 · Direct APIs ADR · API reference audits · **Effort:** 2 d · **Status:** unassigned
**Depends on:** WP-11, WP-12 · **Blocks:** WP-17 and every remote-touching lane
**Produces a FROZEN artifact:** no — scenario ids become test-facing compatibility names

## Files you own

`plugins/bb-plugin-finite-state/test/mock-remote/faults/controller.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/faults/scenarios.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/faults/middleware.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/faults/*.test.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/quirks/live-drift.test.ts`

## Files you must not touch

WP-10–12 implementations, fixture corpus, frozen interfaces, production clients/lanes, package/lock files. Consume registration/state seams; the fixture exclusion is ownership, not the retired WP-08 freeze.

## Context

This gate proves normalization and failure isolation at the true service boundaries. Faults are deterministic, service-scoped, request-scoped or explicitly sequenced, resettable, and observable. An AS or Forge failure must not contaminate Platform state; optional compute absence is normal configuration, not plugin failure.

## What to build

1. Select named scenarios per authenticated request (`X-FS-Mock-Scenario`) or per isolated mock instance. Scenario specs name the service and route ids; unknown service/field/route fails installation.
2. AS stale TARA: exact 409 before mutation.
3. Platform firmware byte denial: 403 on range/full while metadata/tree remains readable.
4. Service-specific 429 with `Retry-After`, including fail-N-then-succeed and exhaustion using an injected scheduler.
5. Platform partial VEX success: normal HTTP success, mixed item results, only successful mutations.
6. AS successful-but-stripped unknown key: read-back omits it, proving why push verifies. Strict endpoints may instead reject; scenario binds only to the reviewed route that strips.
7. Mid-push transport reset after N applied items, preserving prior successes.
8. Forge compute unavailable and root-digest mismatch without affecting Platform/AS.
9. Preserve raw verified quirks at their owner boundary: CVE dict, severity wrapper, CSV trailer, AS list casing/page base. Normalization belongs in the clients, not mocks.
10. Log scenario/service/request/route/attempt/effect only through the in-process controller; reset clears logs/counters/state.

## Interface contract

```ts
export const MOCK_SCENARIOS = [
  "as-stale-tara-state",
  "platform-firmware-bytes-forbidden",
  "rate-limit-then-success",
  "rate-limit-exhausted",
  "platform-vex-partial-failure",
  "as-key-strip",
  "mid-push-reset",
  "forge-compute-unavailable",
  "forge-root-digest-mismatch",
] as const;
export interface ScenarioSpec {
  name: (typeof MOCK_SCENARIOS)[number];
  service: "platform" | "assurance-studio" | "forge-compute";
  routeIds?: string[];
  times?: number;
  afterApplied?: number;
  findingIds?: string[];
  unknownKeys?: string[];
  retryAfterSeconds?: number;
}
export interface FaultController {
  install(spec: ScenarioSpec): void;
  clear(service?: ScenarioSpec["service"]): void;
  log(): readonly {
    scenario: string;
    service: string;
    requestId: string;
    routeId: string;
    attempt: number;
    effect: string;
  }[];
}
```

## Acceptance criteria — gate

- [ ] Exact AS TARA 409 is asserted before mutation.
- [ ] Platform firmware 403 affects bytes only.
- [ ] 429 retry/exhaustion is deterministic and independently scoped per service.
- [ ] Partial VEX mutates successes only and reports exact counts.
- [ ] Key-strip/read-back proves a 200 is not proof of persistence.
- [ ] Mid-push reset leaves first N writes applied and retry converges.
- [ ] Forge absent/digest mismatch leaves Platform and AS healthy.
- [ ] All owner-bound raw quirks are byte/shape tested.
- [ ] Parallel mock instances/services never share counters or state.
- [ ] Downstream smoke suite needs no live service, Forge, or PostgreSQL.

## Test plan — `remote-mock-honesty-gate`

- One public-boundary state-before/state-after test per scenario.
- `malformed/negative Retry-After normalizes to typed error` (**error path**).
- `unknown scenario/service/route/field fails install` (**error path**).
- `mid-push socket and in-process reset are semantically equivalent`.
- `raw quirk regression suite stays at owning service boundary`.
- `interleaved Platform/AS/Forge scenarios remain isolated` (**fault isolation**).

## Do not

- Do not make faults random, time-dependent, process-global, or production-enabled.
- Do not return 5xx for per-item VEX failure.
- Do not mutate before TARA 409 or firmware 403.
- Do not move a Platform/AS fault into Forge for convenience.
- Do not normalize raw quirks in the mock; clients own normalization.

## Open questions

1. Copy the exact current Platform 403 and AS 409 envelope bytes into the test fixture at implementation time; status/semantics are frozen here, unknown fields are not guessed.
2. Node in-process fetch cannot literally reset a socket; document semantic equivalence with WP-14 transport-reset tests.
