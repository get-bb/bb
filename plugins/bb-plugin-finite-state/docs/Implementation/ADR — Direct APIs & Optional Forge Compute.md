# ADR — Direct APIs & Optional Forge Compute

**Status:** accepted · **Date:** 2026-08-12 · **Owner:** Matt Wyckhouse · **Affects:** SPECs 00–06 and WP-01/WP-06/WP-10–14 plus every remote-consuming lane

## Decision

The bb plugin backend calls the Finite State customer API and Assurance Studio REST API directly. Forge is not the mandatory application backend. It remains an optional compute runtime for capabilities that actually execute Forge-owned local machinery: QEMU verification, autonomous pen testing, evidence-bundle workflows, and their job telemetry.

```text
bb frontend
    │ typed bb.rpc / bb.http / realtime hints
    ▼
bb-plugin-finite-state backend
    ├── SQLite cache + tracked YAML/documents
    ├── PlatformClient ───────────────► Finite State customer REST API
    ├── AssuranceStudioClient ───────► Assurance Studio REST API
    └── ForgeComputeClient? ─────────► optional Forge MCP runtime
```

"Direct" always means server-side from the plugin backend. React panels, directives, mentions, and render paths never receive credentials and never call an external service.

## Why

Forge's `FiniteStateAPI` and `ASClient` are already ordinary authenticated HTTP clients. Most Forge tools required by the plugin are schema/response adapters over those clients. Routing routine product data through MCP would add a process/service dependency, a second serialization and error layer, agent-oriented file-path results, and a mandatory Forge health condition without adding authoritative domain behavior.

Full Forge also requires PostgreSQL at startup. Core product panels should not become unavailable because an optional compute orchestrator or its database is down.

Forge remains valuable where it owns execution rather than adaptation. `verify_dynamic` invokes Docker and the verifier, `pen_test_run` drives a local evidence workflow and companion binary, and Forge owns the associated job/event registry. Reimplementing those systems in TypeScript would create a second verifier and is explicitly out of scope.

## Frozen service boundary

```ts
export interface RemoteServices {
  platform: PlatformClient;
  assuranceStudio: AssuranceStudioClient;
  forgeCompute: ForgeComputeClient | null;
}
```

Downstream lanes receive the narrowest capability they need, not `RemoteServices` wholesale. Findings and BOM cannot import `ForgeComputeClient`. Bench may use all three through owner services. Agent tools never receive a generic remote client, arbitrary URL, HTTP method, or raw API path.

## Configuration and degradation

- `registerRemoteServices` calls `bb.settings.define(...)` exactly once and retains the returned native `{get,onChange}` handle for one plugin generation. No composition root, lane, client, or panel defines remote settings again.
- Platform origin and `X-Authorization` token are secret plugin settings. They enable projects, findings, VEX, SBOM, components, firmware, and STP relays.
- AS origin and `X-API-Key` are separate secret settings. They enable Architecture, Threat Model, Canvas, requirements, mitigations, and verification-model synchronization.
- Forge transport, URL/command, and bearer are optional settings. Their absence disables only Forge-compute actions.
- Settings changes recreate only the affected service's client, limiter, transport, and health slot; stable narrow delegates select the current slot at call time. Platform, AS, and Forge do not share a limiter or health generation.
- Missing required Platform configuration may put the plugin in `needs-configuration`; missing optional AS or Forge is `disabled`. A configured service that cannot connect is `unreachable`, not `needs-configuration`, and must not take unrelated surfaces down.
- `connections.status` is the secret-safe typed RPC view of the three independent states. It returns sanitized labels/messages only—never credentials, auth headers, URL userinfo/query, command arguments, local paths, or raw exceptions.
- One `bb.onDispose` hook aborts outstanding probes/retries and closes all limiters and MCP transports/processes. Settings are read through the handle, not from frontend state. Secrets never cross RPC, enter SQLite, appear in logs, or land in the worktree.

## Data and synchronization path

Remote data still does not render live:

```text
remote REST pull → normalization → SQLite/base snapshot → typed RPC → panel/card
tracked YAML edit → plan/conflict review → explicit human push → remote REST → read-back
```

The direct clients own transport concerns only: closed route maps, authentication headers, abort propagation, bounded concurrency, Retry-After/backoff, pagination, streaming, JSON/media validation, and normalized errors. Domain services own business protections such as stable keys, `human_edited` handling, review-status semantics, delete impact, TARA head/hash fences, partial-success reconciliation, and read-back.

## API contract policy

The vendored files under `api-reference/` are pinned implementation inputs. OpenAPI generation may produce types, fixtures, validators, and route inventory, but it must not generate an unrestricted caller. Production clients expose only reviewed methods in the frozen interfaces. The checksummed Forge compute-only manifest pins the reviewed `verify_dynamic`, `pen_test_run`, `get_job_status`, and `list_jobs` mappings at Forge commit `5083a9d7`; `watchJob` is plugin-derived polling. That commit has no firmware-root registration method, so `prepareFirmwareRoot` remains non-freezeable and remote-unsupported until separately proven.

Assurance Studio's snapshot is incomplete. Handler-backed additions listed in `assurance-studio-openapi-notes.md` and `assurance-studio-api-gaps.md` may be implemented only when their method, path, input, response, and concurrency behavior are verified. No public `asRawApi` or equivalent escape hatch is exposed to panels, CLI, or agents.

## Consequences

- Core onboarding no longer requires installing Forge or provisioning Forge PostgreSQL.
- Platform and AS failures are isolated from each other and from Forge compute.
- SBOM and firmware bytes stream directly into bb-owned HTTP/cache paths; no Forge-local `file_path` translation is needed.
- The plugin owns a small amount of retry, pagination, validation, and API-quirk code already present in Forge. Contract tests and vendored references control that duplication.
- Forge-specific jobs remain optional and retain their native job ids and `RUNNING|COMPLETED|FAILED|TIMEOUT` vocabulary.
- Offline mode and the local-first review model are unchanged.

## Rejected alternatives

1. **Forge MCP for every operation.** Rejected because routine REST data would inherit Forge installation, PostgreSQL, transport, artifact-path, and availability requirements.
2. **Reimplement Forge compute inside the plugin.** Rejected because Docker/verifier orchestration, evidence bundles, replay, and job telemetry are substantive Forge products.
3. **Call upstream APIs from React.** Rejected because it leaks credentials and couples render behavior to network availability.
4. **Expose a generic raw REST client.** Rejected because closed, reviewed capabilities are safer and more testable, and agents must not acquire arbitrary mutation reach.
