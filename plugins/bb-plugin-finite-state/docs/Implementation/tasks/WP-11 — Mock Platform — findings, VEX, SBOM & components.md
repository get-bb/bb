# WP-11 — Mock Platform — findings, VEX, SBOM & components

**Lane:** L1 Remote services & mocks · **Spec refs:** SPEC 02 · SPEC 04 §2 · Direct APIs ADR · Platform API references · **Effort:** 2 d · **Status:** unassigned
**Depends on:** WP-10, WP-08 · **Blocks:** WP-13, WP-17, WP-22, WP-41
**Produces a FROZEN artifact:** no — consumes fixture-fidelity-governed fixtures and frozen interfaces

## Files you own

`plugins/bb-plugin-finite-state/test/mock-remote/platform/state.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/platform/register.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/platform/projects.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/platform/findings.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/platform/vex.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/platform/bom.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/platform/*.test.ts`

## Files you must not touch

WP-10 framework/generated files, WP-12 AS/compute files, fixture corpus, frozen interfaces, production clients/lanes, package/lock files.

## Context

L3/L5 call the Finite State Platform directly. This mock represents raw Platform HTTP behavior plus resettable server state; the production/mock `PlatformClient` adapters normalize it to WP-06. It does not reproduce Forge's tool envelopes or server-local `file_path` returns.

## What to build

1. Load projects, versions, findings, comments/activity, components, and SBOM from fixture-fidelity-governed fixtures into resettable cloned state. Preserve duplicate finding UUIDs and awkward identities.
2. Register only reviewed named Platform routes needed by WP-06: project/version pages, findings/detail/activity/comments/summary, VEX set/bulk/clear, SBOM byte download, components list/search.
3. Implement direct offset/cursor paging without preview/file-path envelopes. Pages must neither omit nor duplicate UUIDs; raw headers/envelopes follow the vendored Platform evidence.
4. Validate the frozen six VEX statuses, five responses, and nine justifications. Single and dry-run behavior must match reviewed upstream semantics.
5. Bulk VEX accepts the verified upstream ceiling, preserves per-item partial results inside HTTP success, and mutates only successful rows. The plugin's production planner still chunks at 500.
6. Preserve exact clear, finding-activity, and comment membership behavior. Comments never carry to successor versions.
7. Stream deterministic SBOM bytes with correct media type/hash. Component queries cover purl/no-purl identities and filters used by L3/L5.
8. Expose state inspection only through an in-process test controller. No unauthenticated admin route.

## Interface contract

```ts
export interface MockPlatformState {
  readonly projects: Map<string, Record<string, unknown>>;
  readonly versions: Map<string, Record<string, unknown>>;
  readonly findings: Map<string, Record<string, unknown>>;
  readonly findingActivity: Map<string, Record<string, unknown>[]>;
  readonly findingComments: Map<string, Map<string, Record<string, unknown>>>;
  readonly components: Map<string, Record<string, unknown>>;
  vexTuple(
    pvId: string,
    findingId: string,
  ): {
    status: string | null;
    response: string | null;
    justification: string | null;
    reason: string | null;
  } | null;
  snapshot(): unknown;
  reset(): void;
}
export function registerPlatformHandlers(
  registry: MockHandlerRegistry,
  state: MockPlatformState,
): void;
```

## Acceptance criteria

- [ ] All required Platform capability families work through `PlatformClient` against fixture-fidelity-governed fixtures.
- [ ] ~4,000 findings traverse without duplicate/omitted UUIDs and without Forge file-path envelopes.
- [ ] VEX vocabulary and dry-run behavior are exact and non-mutating where required.
- [ ] Upstream bulk ceiling and plugin 500-item planning chunk are separately tested/documented.
- [ ] HTTP success never hides per-item VEX failures.
- [ ] Duplicate/no-purl/version-change/soft-delete cases survive reads and reset.
- [ ] Activity/comment membership and reset semantics match reviewed behavior.
- [ ] SBOM streaming and component identity integrity cover all 900 entries.
- [ ] Typecheck/test/lint/build is green.

## Test plan — `mock-direct-platform-data`

- `projects, versions, and findings page deterministically`.
- `missing/corrupt fixture yields typed failure without partial rows` (**error path**).
- `VEX valid/invalid vocabulary and dry-run` (**error paths**).
- `bulk mixed result mutates successes only` (**partial-failure path**).
- `activity and comments reject foreign ids` (**security/error path**).
- `SBOM stream hash and component purl/no-purl search`.
- `reset restores byte-equivalent logical state`.

## Do not

- Do not deduplicate findings by business identity.
- Do not emulate Forge tool names, previews, file paths, or job envelopes.
- Do not treat HTTP 200 as all-items-success.
- Do not put AS project-SBOM routes in the Platform mock.
- Do not hand-edit generated fixtures or frozen types; fixture changes use the deterministic generator and the fixture-fidelity rule, without an amendment.

## Open questions

1. Freeze the exact upstream bulk maximum from the vendored operation; v1 client chunks remain 500 even if the server accepts 5000.
2. Where the OpenAPI and endpoint audit differ on paging/header names, the audit wins and the divergence gets a named contract test.
