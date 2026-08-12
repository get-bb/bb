# Assurance Studio reference snapshots

Pinned references for Forge specs that design against the AS REST API. Two sources of truth — and they disagree — so this directory keeps both.

## ⚠️ Read this before trusting the OpenAPI snapshot

The pinned `as-openapi-*.json` files are useful but **incomplete**. The OpenAPI generator in `finite-state-platform/apps/web/src/lib/openapi/generator.ts` emits documentation for the subset of routes whose Zod schemas are registered in `src/lib/openapi/schemas/`. Routes whose schemas live inline in the handler are silently skipped, and shared cross-cutting contracts (the deletion policy's `?mode=cascade|detach` query param, the universal 409 + `DeletionImpact` response on entity deletes, list-endpoint filter params not declared as named Zod inputs) are not surfaced.

Concrete examples from the 2026-05-12 snapshot — all confirmed present in the AS route handlers at `finite-state-platform@031f2ab9 (apps/web)` but absent from OpenAPI:

- Item-level CRUD for Assets, AttackPaths, Zones, DataFlows
- `DELETE` on Components and Requirements (only `GET`/`PATCH` documented)
- The shared `?mode=cascade|detach` delete contract
- Requirement list filter set disagrees with handler — OpenAPI's `verification_status` is fictitious (handler reads `status`); OpenAPI advertises 5 filters where the handler reads 11

See `docs/as-api-gaps-for-forge.md` entry #2 for the full breakdown and the upstream fix request.

**Practical rule:** when the snapshot disagrees with a route handler in `finite-state-platform/apps/web/src/app/api/`, the handler wins. Use the snapshot for routes that *are* covered (auth, projects collection, threats/risks/mitigations, etc.); fall through to the handler files for the architecture entities.

## Files

| File | Captured from | AS commit | Date | Use for |
|---|---|---|---|---|
| `as-openapi-2026-05-12.json` | `GET https://fs-alpha.finitestate.io/api/openapi` | `finite-state-platform@031f2ab9 (apps/web)` | 2026-05-12 | Phase 4.5 spec review. OpenAPI 3.0.3, 80 paths, 125 schemas. **Incomplete** — see caveat above. |

## How to use these for review

For routes the snapshot *does* document, load it in any OpenAPI viewer:

- Swagger UI / Redoc / Stoplight Elements (paste the file)
- VS Code: install "OpenAPI (Swagger) Editor" extension, open the JSON
- Terminal: `jq '.paths."/api/projects/{projectId}/threats".post' as-openapi-2026-05-12.json` to inspect a specific endpoint

For routes the snapshot *doesn't* document — or for verifying any non-trivial design claim — read the route handler in `finite-state-platform/apps/web/src/app/api/<path>/route.ts` directly. Forge specs that depend on these routes (notably Phase 4.5) pin a specific AS commit SHA so the audit is reproducible.

## How to refresh

The OpenAPI endpoint is public and unauthenticated by design (`finite-state-platform/apps/web/src/app/api/openapi/route.ts`). Refresh from the same AS instance you're designing against and record the AS commit SHA for the audit log:

```bash
curl -sf https://<as-host>/api/openapi | jq . > docs/as-reference/as-openapi-<YYYY-MM-DD>.json
# in finite-state-platform/:
git rev-parse --short HEAD  # record this SHA in the table above
```

The spec is generated on each request from registered Zod schemas — what you snapshot is what AS will surface to OpenAPI consumers on the next deploy. The incompleteness gap persists across refreshes until the upstream gap (`docs/as-api-gaps-for-forge.md` entry #2) is resolved.

## Known generator issues

- **Empty `.servers[]` array.** Swagger UI's "Try it out" won't have a baseURL until you set it manually. Likely a one-line fix in `lib/openapi/generator.ts`.
- **Incomplete route coverage.** See caveat above. The gap will close when AS adopts handler-discovery generation or registers all inline Zod schemas.
