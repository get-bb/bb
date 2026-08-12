# WP-10 — Remote-service mock skeleton — vendored API generation & route tables

**Lane:** L1 Remote services & mocks · **Spec refs:** SPEC 00 §6 · Direct APIs ADR · API reference index · Master Plan §7 · **Effort:** 2 d · **Status:** unassigned
**Depends on:** WP-06 · **Blocks:** WP-11, WP-12
**Produces a FROZEN artifact:** no — generated route metadata is reproducible; WP-06 remains the frozen callable surface

## Files you own
`plugins/bb-plugin-finite-state/test/mock-remote/server.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/router.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/types.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/handlers.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/generate-routes.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/generated/platform-routes.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/generated/assurance-studio-routes.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/generated/source-manifest.json`
`plugins/bb-plugin-finite-state/test/mock-remote/as-route-patches.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/*.test.ts`

## Files you must not touch
Frozen fixtures/interfaces, composition roots, production clients/lanes, vendored API references, package/lock files, or a sibling Forge checkout.

## Context
The plugin calls Platform and Assurance Studio directly. Forge is independently optional compute, so the test topology must preserve three failure domains instead of pretending there is one gateway. API inputs are the checked-in, checksummed files under `docs/Implementation/api-reference/`; test/code generation never depends on `@finite-state-forge` being present. The AS snapshot is incomplete: handler-backed evidence named by the vendored notes/gap audit wins over OpenAPI. Unknown operations remain absent.

## What to build
1. Verify source filenames and SHA-256 against the API-reference index before generation. Record vendored source name/hash, path/operation counts, generator version, and deterministic output hashes in `source-manifest.json`; exclude wall-clock time.
2. Generate normalized Platform and AS route records: service, method, path template, operation id, auth kind, media types, response statuses, and evidence source. Sort by service/path/method.
3. Apply only AS patches documented in the vendored handler-backed audit. Each patch records evidence file/section and `source:"handler-audit"`. Reject a patch with no evidence.
4. Intersect generated routes with the named operations frozen in WP-06. The raw mock may model supporting routes for contract evidence, but no production-callable operation appears automatically because OpenAPI gained a path.
5. Implement independent Node HTTP routers using existing dependencies/Node built-ins. Platform requires `X-Authorization`; AS requires `X-API-Key`. Each service can listen/fail/reset independently.
6. Export handler registries so WP-11/12 bind by generated route id without editing this WP. Reject duplicate/unknown registrations at startup.
7. Known-unimplemented routes return 501 `MOCK_HANDLER_MISSING`; unknown routes 404; invalid JSON/media 400/415. Redact auth values from every error/log.
8. Support in-process `fetch`, ephemeral-port `listen`, independent `close`, and a combined harness. `close` is idempotent and releases sockets.
9. `generate-routes --check` regenerates in isolation and fails on reference/hash/generated drift without writing.

## Interface contract
```ts
export type MockService = "platform" | "assurance-studio";
export interface MockRoute {
  routeId: string; service: MockService;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  pathTemplate: string; operationId: string | null;
  auth: "X-Authorization" | "X-API-Key";
  requestMediaTypes: readonly string[]; responseStatuses: readonly number[];
  source: "openapi" | "handler-audit"; evidence?: string;
}
export interface MockRemoteOptions {
  platformToken: string; assuranceStudioKey: string; fixtureRoot: string;
  register?: (service: MockService, registry: MockHandlerRegistry) => void;
}
export interface MockRemoteHarness {
  platform: MockServiceServer; assuranceStudio: MockServiceServer;
  listen(): Promise<{ platformBaseUrl: string; assuranceStudioBaseUrl: string }>;
  reset(service?: MockService): Promise<void>; close(): Promise<void>;
}
export function createMockRemote(options: MockRemoteOptions): MockRemoteHarness;
```

## Acceptance criteria
- [ ] Generation consumes only vendored, checksum-verified references and is byte-deterministic.
- [ ] Platform and AS route/auth inventories are separate and independently startable.
- [ ] Every AS patch cites handler-backed evidence; an evidence-free patch fails generation.
- [ ] Route growth does not expand the frozen callable interface automatically.
- [ ] WP-11/12 register handlers without editing WP-10 files.
- [ ] Wrong/missing auth returns deterministic 401 without leaking expected values.
- [ ] Unknown/unimplemented/media/JSON failures are distinct and structured.
- [ ] One service can be closed or faulted while the other remains usable.
- [ ] Typecheck/test/lint/build is green.

## Test plan — `remote-mock-routing-gate`
- `vendored checksums and generated output are stable`.
- `platform and AS auth are service-specific` (**security/error path**).
- `handler-audit patch without evidence fails generation` (**error path**).
- `duplicate and unknown route registration fail startup` (**error path**).
- `501 known versus 404 unknown versus 415 media` (**error paths**).
- `closing AS leaves Platform healthy; closing Platform leaves AS healthy` (**fault isolation**).
- `check mode detects one-byte reference/output drift and writes nothing` (**fault path**).

## Do not
- Do not read a sibling Forge repo at build/test time.
- Do not generate a public generic request client or expose arbitrary paths.
- Do not infer AS routes from names or Forge wrappers without handler evidence.
- Do not merge Platform and AS auth, state, health, or lifecycle.
- Do not add parser/runtime dependencies without an amendment.

## Open questions
1. If the existing declared YAML parser cannot parse the 462-KB Platform reference deterministically, batch the smallest parser addition through the dependency amendment; do not write a partial YAML parser.
2. Path/operation counts are recorded from the vendored files and may differ from historical recon. The vendored hash/count pair is the gate, not old prose numbers.
