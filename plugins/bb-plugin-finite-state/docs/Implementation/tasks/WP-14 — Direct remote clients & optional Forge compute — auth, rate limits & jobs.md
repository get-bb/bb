# WP-14 — Direct remote clients & optional Forge compute — auth, rate limits & jobs

**Lane:** L1 Remote services & mock · **Spec refs:** SPEC 00 §4–§6, §10 · ADR Direct APIs · vendored API references · **Effort:** 5 d · **Status:** unassigned
**Depends on:** WP-03, WP-06 · **Blocks:** G0, G5 and live integration for L2–L6
**Produces a FROZEN artifact:** no — implements the frozen remote-service contracts

## Files you own
`plugins/bb-plugin-finite-state/lib/remote/index.ts` *(replaces WP-01 stub)*
`plugins/bb-plugin-finite-state/lib/remote/config.ts`
`plugins/bb-plugin-finite-state/lib/remote/platform/client.ts`
`plugins/bb-plugin-finite-state/lib/remote/platform/routes.ts`
`plugins/bb-plugin-finite-state/lib/remote/assurance-studio/client.ts`
`plugins/bb-plugin-finite-state/lib/remote/assurance-studio/routes.ts`
`plugins/bb-plugin-finite-state/lib/remote/forge-compute/client.ts`
`plugins/bb-plugin-finite-state/lib/remote/forge-compute/mcp-transport.ts`
`plugins/bb-plugin-finite-state/lib/remote/rate-limit.ts`
`plugins/bb-plugin-finite-state/lib/remote/artifact.ts`
`plugins/bb-plugin-finite-state/lib/remote/errors.ts`
`plugins/bb-plugin-finite-state/lanes/remote/register.ts`
`plugins/bb-plugin-finite-state/lib/remote/**/*.test.ts`
`plugins/bb-plugin-finite-state/test/contract/remote-clients.contract.test.ts`
`plugins/bb-plugin-finite-state/test/contract/remote-clients.live.test.ts`

## Files you must not touch
Composition roots; all five frozen interfaces; mock implementation/fixtures; other lanes; package/lock files; vendored API references.

## Context
This is the production integration point, split by actual service ownership. The bb plugin backend calls the Finite State customer API and Assurance Studio directly with server-side `fetch`. Forge MCP is optional and contains compute actions only. The frontend never calls an upstream service.

The direct path removes Forge installation/PostgreSQL from core onboarding and avoids translating agent-oriented `file_path` results for ordinary JSON and byte APIs. It does not move render paths online: lanes still pull into SQLite/base snapshots and serve bounded RPC. The implementation is closed over the methods frozen in WP-06 and the vendored route contracts.

## What to build
1. Call `bb.settings.define(REMOTE_SETTING_DESCRIPTORS)` exactly once, inside `registerRemoteServices(bb,ctx)`, and keep the returned `{get,onChange}` handle for that factory generation. Descriptors cover Platform origin + raw `X-Authorization` token; AS origin + `X-API-Key`; optional Forge compute transport/url-or-command + bearer; and a separate bounded concurrency setting for each service. Never define settings in a composition root, lane, or client, and never expose secret values to the frontend or logs.
2. Await `settings.get()` once for initial configuration, then register one `settings.onChange((next,prev) => ...)` listener. A settings diff recreates only the affected service's client, limiter, health probe, and transport slot; unchanged services retain their instances and in-flight work. Stable narrow delegates read the current slot at call time so downstream lanes do not retain a stale client. Platform, AS, and Forge health generations are independent.
3. Missing required Platform origin/token may call `bb.status.needsConfiguration("Connect your Finite State account to load projects")`. Missing AS or Forge configuration is a scoped `disabled` connection state. Any configured service that fails DNS/TLS/auth/health is `unreachable`, not `needs-configuration`, and the plugin remains loaded with cached/local behavior. One failed service must not disable another.
4. Implement `PlatformClient` directly from the v0.3.0 OpenAPI and endpoint audit. Use the exact `/public/v0` method/path/query/media contracts, raw `X-Authorization`, abort propagation, RSQL validation, offset pagination, direct JSON, and byte streaming.
5. Implement `AssuranceStudioClient` directly from the AS snapshot plus handler-backed gap notes. Apply `X-API-Key`; normalize inconsistent envelopes/pagination; recursively strip embeddings; preserve `human_edited`, review versions, two-step review-status outcomes, dataflow create/update field asymmetry, delete `mode`/409 impact, and TARA fences in domain-facing results.
6. Keep both direct route maps closed and reviewable. OpenAPI may generate compile-time types, route inventory, mock fixtures, and contract assertions, but production code may call only named routes in the frozen interfaces. There is no `asRawApi`, generic request, or automatic exposure of newly discovered operations.
7. Implement independent bounded concurrency limiters, default 8 per service. Honor downstream 429 `Retry-After`, exponential backoff capped at 64 seconds, maximum six attempts for safe/idempotent operations, abort signals, and fairness. Inject scheduler/randomness for deterministic tests.
8. Do not blindly retry non-idempotent POST/PATCH/DELETE after an ambiguous connection reset. Surface an indeterminate write result; the sync engine reconciles through plan state, read-back, stable identity, and `push_log`.
9. Stream SBOM/firmware responses into `RemoteArtifact` directly from upstream. Validate content type and size/hash when available. No temporary path from another process crosses the boundary; partial local writes use `.part` plus atomic rename and cleanup.
10. Implement `ForgeComputeClient` through the already-declared MCP SDK only when configured. Map only the operations and envelopes in `forge-compute-manifest-5083a9d7.json`. Do not invent a `prepareFirmwareRoot` MCP call: the pinned source has none, so that member remains non-freezeable and remote mode returns unsupported until WP-50 proves a same-host lifecycle adapter or a later reviewed method.
11. Wrap Forge polling as `watchJob`: yield until `COMPLETED|FAILED|TIMEOUT`; publish tiny `fs-forge-job` hints `{jobId,status,eventCount}`. Never broadcast logs/results. Missing compute configuration returns a typed unavailable result; raw `CANCELLED` normalizes to `FAILED/FORGE_JOB_CANCELLED`.
12. Register the secret-safe `connections.status` RPC from WP-03 against the controller's three independent health slots. Endpoint labels are sanitized origins/transport labels only—no userinfo, query, command arguments, paths, headers, keys, tokens, or raw exception strings.
13. Register `bb.onDispose` once for the controller. Abort probes/retries, close all three limiters, close any live MCP transport/process, and make late `onChange`/async completions harmless. Disposal is idempotent and does not retain the stale `bb` handle.
14. Run the same normalized contract suite against mocks and live read-only endpoints. Live tests are explicit/nightly, require a designated tenant, skip with precise reasons, and never mutate production model data.

## Interface contract
```ts
// lib/remote/index.ts
import type { PluginContext } from "../context";
import type { RemoteServices } from "./types"; // FROZEN
export interface RemoteServiceController {
  readonly services: RemoteServices; // stable narrow delegates over replaceable per-service slots
  reconfigure(next: RemoteSettingValues, prev: RemoteSettingValues): Promise<void>;
  dispose(): Promise<void>;
}
export function createRemoteServiceController(ctx: PluginContext, initial: RemoteSettingValues): RemoteServiceController;

// lib/remote/rate-limit.ts
export interface Scheduler { now(): number; sleep(ms: number, signal?: AbortSignal): Promise<void>; }
export interface LimitOptions { concurrency: number; maxAttempts: number; maxBackoffMs: number; scheduler: Scheduler; random(): number; }
export class RemoteLimiter {
  constructor(options: LimitOptions);
  run<T>(operation: (attempt: number) => Promise<T>, signal?: AbortSignal): Promise<T>;
  close(): void;
}

// lib/remote/config.ts
export interface RemoteConfig {
  platformBaseUrl: string | null; platformToken: string | null;
  asBaseUrl: string | null; asApiKey: string | null;
  forgeTransport: "streamable-http" | "sse" | "stdio" | "disabled";
  forgeUrl: string | null; forgeCommand: string | null; forgeAuthToken: string | null;
  platformConcurrency: number; asConcurrency: number; forgeConcurrency: number;
}
export const REMOTE_SETTING_DESCRIPTORS = {
  platformBaseUrl: { type: "string", label: "Platform URL", default: "" },
  platformToken: { type: "string", label: "Platform token", secret: true },
  platformConcurrency: { type: "select", label: "Platform concurrency", options: ["1", "2", "4", "8", "16"], default: "8" },
  asBaseUrl: { type: "string", label: "Assurance Studio URL", default: "" },
  asApiKey: { type: "string", label: "Assurance Studio API key", secret: true },
  asConcurrency: { type: "select", label: "Assurance Studio concurrency", options: ["1", "2", "4", "8", "16"], default: "8" },
  forgeTransport: { type: "select", label: "Forge Compute transport", options: ["disabled", "stdio", "streamable-http", "sse"], default: "disabled" },
  forgeUrl: { type: "string", label: "Forge Compute URL", default: "" },
  forgeCommand: { type: "string", label: "Forge Compute command", default: "" },
  forgeAuthToken: { type: "string", label: "Forge Compute bearer", secret: true },
  forgeConcurrency: { type: "select", label: "Forge Compute concurrency", options: ["1", "2", "4", "8"], default: "4" },
} as const;
export interface RemoteSettingValues {
  platformBaseUrl: string; platformToken: string | undefined; platformConcurrency: string;
  asBaseUrl: string; asApiKey: string | undefined; asConcurrency: string;
  forgeTransport: string; forgeUrl: string; forgeCommand: string;
  forgeAuthToken: string | undefined; forgeConcurrency: string;
}
export function readRemoteConfig(values: RemoteSettingValues): RemoteConfig;
```

`registerRemoteServices` owns the one native settings handle and the controller lifecycle:

```ts
const settings = bb.settings.define(REMOTE_SETTING_DESCRIPTORS); // exactly once
const initial = await settings.get();
const controller = createRemoteServiceController(ctx, initial);
settings.onChange((next, prev) => { void controller.reconfigure(next, prev); });
bb.onDispose(() => controller.dispose());
```

The Platform and AS route maps are closed dictionaries keyed by frozen client method and verified operation id/path. They include the expected request/response media type and retry class. No arbitrary path is representable.

## Acceptance criteria
- [ ] `createRemoteServiceController().services` satisfies the frozen aggregate without casts; Platform and AS are always present as configured-or-unavailable stable delegates and Forge compute is nullable.
- [ ] One native settings definition yields the sole `get/onChange` handle; changing one service's settings recreates only that client/limiter/health slot, while disposal closes every live generation exactly once.
- [ ] Core Platform reads/writes and AS entity synchronization work with Forge stopped and no `FORGE_DB_URL` anywhere in the test environment.
- [ ] Platform sends only `X-Authorization`; AS sends only `X-API-Key`; Forge remote sends only its bearer. No credential appears in errors, RPC, SQLite, or logs.
- [ ] A missing AS key disables Product Security remote sync but leaves cached/local Product Security and all Platform-backed surfaces usable; missing Forge disables only Forge-compute actions.
- [ ] Missing required Platform configuration is distinguishable from configured-but-unreachable. The latter stays loaded, reports `unreachable` through `connections.status`, and never calls `needsConfiguration`.
- [ ] Limiter never exceeds configured concurrency, honors Retry-After/backoff caps, and aborts queued/in-flight retry promptly.
- [ ] Non-idempotent ambiguous failures are not automatically replayed; read-back can reconcile an already-applied mutation.
- [ ] SBOM and firmware bytes stream directly and no caller sees a Forge/upstream-local path.
- [ ] AS handler quirks and incomplete OpenAPI coverage have named contract tests citing the vendored note/audit source.
- [ ] Forge jobs yield ordered snapshots, end on exactly three terminal states, and realtime carries hints only.
- [ ] Production exports contain no raw API, arbitrary URL/method/path, generic MCP invocation, or generic fetch function.
- [ ] Typecheck/test/lint/build is green.

## Test plan — `direct-remote-and-compute-contract`
- `Platform operation mapping for every frozen method` against the generated mock and operation-id inventory.
- `AS mapping for every frozen method plus handler-only manifest citations`.
- `core panels configure and pull while Forge is absent and PostgreSQL is unreachable` (**architecture path**).
- `three-service auth-header isolation and secret redaction` (**security path**).
- `native settings handle reconfigures one service at a time and dispose closes all generations` (**lifecycle path**).
- `missing Platform sets needs-configuration; configured-but-unreachable stays loaded; AS/compute unavailable remain scoped` (**error paths**).
- `connections.status RPC is secret-safe and independent without WP-64 CLI` (**G0/security path**).
- `concurrency=8 under 40 calls; 429 N-then-success; exhaustion after six` (**fault paths**).
- `abort queued/in-flight retry; ambiguous POST/PATCH/DELETE runs once` (**fault paths**).
- `partial VEX remains per-item`, `strict AS key rejection remains visible`, `delete 409 preserves impact`.
- `artifact stream valid/wrong-media/midstream-reset/hash-mismatch/oversize JSON` (**security/error paths**).
- `Forge compute completed/failed/timeout and connection-reset recovery`; no Platform/AS MCP calls appear.
- Nightly `same normalized read-only assertions against designated Platform/AS/Forge environments`.

## Do not
- Do not call any upstream service from React, a render path, mention search, or cached RPC pagination.
- Do not proxy ordinary Platform or AS methods through Forge, even as a fallback.
- Do not expose secret settings, MCP SDK objects, HTTP `Response`, filesystem paths, raw route callers, or arbitrary operations through RPC/tools/CLI.
- Do not retry non-idempotent writes blindly after an ambiguous failure.
- Do not generate an unrestricted production client from OpenAPI.
- Do not keep `bb` in module state or add dependencies.

## Open questions
1. Verify exact AS TARA checkpoint and verification routes against the target handler commit before WP-06 freezes; remove any unverified method instead of mapping a raw route.
2. Decide the product authentication path beyond v1 static secret settings. OAuth/PKCE may later replace tokens, but it must preserve service isolation and must not make full Forge mandatory.
3. Confirm whether remote Forge can prepare a bb-host-local firmware root. Until a safe byte/root contract exists, `prepareFirmwareRoot` is supported only for plugin-owned same-host stdio and returns an explicit unsupported result remotely.
