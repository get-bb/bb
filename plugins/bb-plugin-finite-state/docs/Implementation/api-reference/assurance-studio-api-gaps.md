# Assurance Studio API Gaps Identified from forge Integration

This document catalogs limitations, inefficiencies, and ambiguities in the Assurance Studio REST API (finite-state-platform, app at apps/web) that create friction, workarounds, or broken workflows in finite-state-forge — particularly the Tier-2 CRUD tools (`as_list_projects`, `as_create_threat`, etc.) and Phase 4 cross-product System surface.

This is a living document. Add entries as testing surfaces new gaps. Group by endpoint; don't try to make the doc complete in one pass.

Repo references in this doc point into `finite-state-platform` (the AS backend lives at `apps/web`) and `finite-state-forge` (the consumer).

---

## 1. `GET /api/projects` ships every column of the projects table

**Impact: HIGH — blows past MCP response-size limits, makes list tools effectively unusable**

A single page of 20 projects on `rolandl.finitestate.io` weighs in at **~505 KB** — large enough that forge's MCP transport spills the result to a side file and tells the agent to read it back in chunks instead of returning it inline. The full 36-project dataset would be near 900 KB. For a "show me the list of projects" call.

**Root cause** (`finite-state-platform/apps/web/src/app/api/projects/route.ts:23-26`):

```ts
let query = supabase
  .from('projects')
  .select('*', { count: 'exact' })   // every column
```

The `projects` table carries three JSON-string columns that are not list-view data:

| Column | Bytes (typical) | What it is |
|---|---|---|
| `evidence_assessment_summary` | ~3–50 KB | Per-requirement scores and recommendations |
| `compliance_coverage_report` | ~700 | Coverage metrics breakdown |
| `compliance_control_map` | ~100 | Control/clause/standard maps |
| `workflow_status` + `extended_workflow_status` | ~440 | Per-stage status |

Identity fields (name, ids, manufacturer, lifecycle_stage, all `*_count` numbers, timestamps) total ~300 bytes per row. So the response is ~50–250× larger than the list view actually needs, and the worst-offender projects (`台湾工研院Demo`, `OpenWRT`, `Omnitracs EU RED Compliance`) carry dozens of `requirements_needing_work` entries that have no business shipping on a list call.

**What forge has to do today:**

Nothing yet — the tool currently passes items through verbatim (`src/finite_state_forge/tools/as_projects.py:as_list_projects`). The MCP transport's auto-spill-to-file behavior masks the problem from short demos but breaks token budgets and makes the list tool unusable for any agent flow that wants to scan, filter, or aggregate across projects without a separate per-item read.

**Requested change** (any of these would resolve it; pick the cheapest):

- **(a) Explicit projection on the default list.** Replace `select('*')` with the identity + counts + timestamps + workflow status columns. Heavy compliance/evidence fields stay on the detail endpoint (`GET /api/projects/[id]`).
- **(b) `?summary=true` query param.** Flip between the trim and the full payload at request time. Backward-compatible default could go either way, but new clients should always get the trim.
- **(c) 1:1 detail table.** Split `evidence_assessment_summary`, `compliance_coverage_report`, `compliance_control_map` onto a sibling table joined only by the detail endpoint. This also fixes the same bloat on any future `select('*')` on `projects`.

Option (a) is the smallest patch and matches what the UI list view almost certainly needs.

**Cross-cutting concern:** every other list endpoint built on `select('*')` likely has the same shape. Audit `/api/projects/[projectId]/threats`, `/api/projects/[projectId]/risks`, `/api/projects/[projectId]/mitigations` for the same issue while you're in there.

---

## 2. AS OpenAPI generator emits a materially incomplete spec

**Impact: HIGH — third-party reviewers using the OpenAPI spec as ground truth will reject correct Forge designs.**

The OpenAPI spec served at `GET /api/openapi` (and pinned in `docs/as-reference/as-openapi-2026-05-12.json`) is generated from the Zod schemas in `finite-state-platform/apps/web/src/lib/openapi/schemas/`. The generator misses three categories of content:

**(a) Missing item-level routes for architecture entities.** Verified at `finite-state-platform@031f2ab9 (apps/web)` (2026-05-12):

| Entity | Route handler on disk | OpenAPI documents |
|---|---|---|
| Asset item (`/api/projects/{projectId}/assets/{assetId}`) | GET, PATCH, DELETE | not present |
| Asset sub-route (`/api/projects/{projectId}/assets/{assetId}/threats`) | GET, POST | not present |
| AttackPath collection (`/api/projects/{projectId}/attack-paths`) | GET, POST (stub) | not present |
| AttackPath item (`/api/projects/{projectId}/attack-paths/{pathId}`) | GET, PATCH, DELETE | not present |
| Zone item (`/api/projects/{projectId}/zones/{zoneId}`) | GET, PATCH, DELETE | not present |
| DataFlow item (`/api/projects/{projectId}/data-flows/{dataFlowId}`) | GET, PATCH, DELETE | not present |

**(b) Missing methods on documented routes.**

| Path | Route handler exports | OpenAPI documents |
|---|---|---|
| `/api/projects/{projectId}/components/{componentId}` | GET, PATCH, DELETE | GET only |
| `/api/projects/{projectId}/requirements/{requirementId}` | GET, PATCH, DELETE | GET, PATCH only |

**(c) List-endpoint filter set in OpenAPI disagrees with route handlers.**

- **`verification_status` is fictitious.** OpenAPI's GET `/api/projects/{projectId}/requirements` advertises a `verification_status` query param; the route handler (`apps/web/src/app/api/projects/[projectId]/requirements/route.ts:122-132`) reads `searchParams.get('status')` (and `searchParams.get('review_status')` for a separate filter). Consumers following OpenAPI silently filter on a key the route ignores.
- **Filter surface is under-documented.** OpenAPI advertises 5 filters (`q`, `type`, `priority`, `verification_status`, `reviewed`) on requirements. The route handler reads 11 (`q`, `type` with `category` alias, `priority`, `status`, `reviewed`, `review_status`, `source`, `chat_run_id`, `mitigation_id`, `standard`, `review_finding_id`). Six useful filters are invisible to OpenAPI consumers.
- **Component list filters are equally under-documented.** Route handler reads `page`, `limit` only — no domain filters today, but if OpenAPI grows to advertise `zone_id`/`type`/`is_entry_point` (as third-party reviewers expected based on the schema files), those would also be fictitious until the handler implements them.

These mismatches matter to Forge because forge tools that expose filter parameters to agents must surface the parameters that work, not the parameters OpenAPI advertises.

**Cross-cutting consequence:** the snapshot is **not** authoritative for "what AS accepts on endpoint X." Forge's Phase 4.5 spec is grounded in a route-handler audit at `finite-state-platform@031f2ab9 (apps/web)` performed 2026-05-12; the audit found surface that the snapshot does not advertise. Three independent reviewers reading the snapshot in isolation rejected the spec as over-claiming — the snapshot fooled them.

**Root cause (likely):** the OpenAPI generator in `src/lib/openapi/generator.ts` enumerates registered schemas, not handler files. Routes whose Zod schemas are inline in the handler (rather than imported from `src/lib/openapi/schemas/*.ts`) are skipped. The deletion-policy contract (`mode=cascade|detach` query param, 409 + `DeletionImpact` body) is implemented in `src/lib/deletion/delete-policy.ts` and applied uniformly across entity DELETE handlers; the generator doesn't see it.

**What Forge has to do today:**

- Treat AS route handlers (`finite-state-platform/apps/web/src/app/api/`) as canonical when they disagree with the OpenAPI spec.
- Annotate the snapshot README to direct readers to route handlers as source of truth.
- Pin route-handler audits by AS commit SHA, the way Phase 4.5 does (`finite-state-platform@031f2ab9 (apps/web)`).

**Requested change** (any one, ordered by reach):

1. **(largest reach)** Drive OpenAPI generation off the handler files directly (Next.js route discovery + per-handler schema introspection), not off a registry of schema modules.
2. **(medium)** Move every inline Zod schema into `src/lib/openapi/schemas/` and register it explicitly. Audit existing handlers for unregistered schemas; the architecture entities (Asset/Zone/DataFlow/AttackPath) are the biggest current offenders.
3. **(smallest)** Document the deletion-policy contract as a reusable schema fragment included on every entity DELETE response. Same fix for shared list-query params.
4. **(orthogonal but cheap)** Populate `.servers[]` in the generated spec so Swagger UI's "Try it out" works without manual base-URL config.

---

## 3. DataFlow PATCH schema renames every POST schema field

**Impact: MEDIUM — agents and clients constructing bodies must use different field names for CREATE vs UPDATE on the same entity**

The DataFlow entity's CREATE (`POST /api/projects/{projectId}/data-flows`) and UPDATE (`PATCH /api/projects/{projectId}/data-flows/{dataFlowId}`) Zod schemas use different names for the same underlying database columns. Verified at `finite-state-platform@031f2ab9` against `apps/web/src/app/api/projects/[projectId]/data-flows/route.ts` and `apps/web/src/app/api/projects/[projectId]/data-flows/[dataFlowId]/route.ts`:

| Concept | CREATE (POST) | UPDATE (PATCH) | DB column |
|---|---|---|---|
| Source component | `source_component_id` | `from_component` | `from_component` |
| Target component | `target_component_id` | `to_component` | `to_component` |
| Encrypted flag | `is_encrypted` | `encrypted` | `encrypted` |
| Authenticated flag | `is_authenticated` | `authenticated` | `authenticated` |
| Bidirectional flag | `is_bidirectional` | `bidirectional` | `bidirectional` |

The POST handler translates the `*_id`/`is_*` schema names into the DB column names at insert time (`route.ts:141-156`). The PATCH handler accepts the DB column names directly. No other AS entity has this asymmetry — Asset/Zone/Component/Requirement use one set of names for both verbs.

**What Forge has to do today:**

`tools/as_data_flows.py` mirrors the AS schema as-is. `as_create_data_flow` takes the POST names; `as_update_data_flow` takes the PATCH names. Module + tool docstrings cross-reference each other so agents don't mix them. **Phase 5b.1.a's `as_scaffold_dataflows`** is also affected: its PATCH path on idempotent re-runs must translate the POST-shape body (`source_component_id`/`target_component_id`/`is_encrypted`/`is_authenticated`/`is_bidirectional`) into the PATCH-shape (`from_component`/`to_component`/`encrypted`/`authenticated`/`bidirectional`). Tracked as a follow-up correctness fix on top of the Phase 4.5 merge.

**Requested change:**

Pick one set of names and use it for both schemas. The PATCH names (`from_component`, `to_component`, `encrypted`, `authenticated`, `bidirectional`) match the database columns and are shorter; converging the POST schema onto them would be source-compatible (the handler already converts on insert) and let Forge collapse two parameter sets into one. If that breaks existing UI callers, add the PATCH names as aliases on the POST schema first, then deprecate the `*_id`/`is_*` forms.

---

## 4. No BFF route for `tara_p4_hybrid_search` RPC (Phase 5a blocker)

**Impact: HIGH — blocks the `as_search_entities` forge tool, which Phase 5b's Tier-3 read paths are explicitly designed around**

The `tara_p4_hybrid_search` Postgres function exists in AS — it provides semantic search across Asset/Zone/DataFlow/Threat by name + embedding (per `docs/specs/2026-05-07-forge-assurance-studio-design.md` Appendix A). But no Next.js BFF route in `apps/web/src/app/api/projects/[projectId]/` calls it today. `grep -r tara_p4_hybrid_search apps/web/src` returns no matches.

**Why this matters for forge:** Phase 5 design [explicitly biases](../specs/2026-05-07-forge-assurance-studio-design.md) Tier-3 read paths toward `as_search_entities` over `list-then-filter`, because the latter hits the same `select('*')` payload bloat documented in §1. Without a BFF route to wrap, forge can't ship `as_search_entities`, and Tier-3 tools (`as_propose_mitigations`, `as_score_risks`) fall back to bloated list reads.

**Requested change:** add a Next.js BFF route. Proposed shape:

```
POST /api/projects/{projectId}/search
Body: { query: string, kinds?: ("asset"|"zone"|"data_flow"|"threat")[] }
Response: { success: true, data: { results: [...], total: number } }
```

`kinds` is optional and narrows the search to a subset of entity types. Authentication via the standard project-scoped middleware (same pattern as `[projectId]/threats/route.ts`). Returns ranked results — exact ranking semantics are the RPC's, not forge's concern.

---

## 5. No BFF route for `match_sbom_packages` RPC (Phase 5a blocker)

**Impact: MEDIUM — blocks the `as_match_sbom_packages` forge tool**

The `match_sbom_packages` Postgres function exists in AS for resolving SBOM packages by pattern, but — like §4 — no Next.js BFF route invokes it. Forge needs it to wrap as `as_match_sbom_packages` for cross-product workflows that bridge component names from external sources (advisories, news stories) into AS's SBOM linkage data.

**Why this matters for forge:** the existing `GET /api/projects/{id}/sbom` route exposes a `search` query param, but it's a substring `ilike` match on `name` / `purl` — not what `match_sbom_packages` does. Glob/fuzzy patterns and the RPC's match-strategy semantics need their own route.

**Requested change:** add a Next.js BFF route. Proposed shape:

```
GET /api/projects/{projectId}/sbom/match?pattern=<str>&strategy=fuzzy|exact&limit=<int>
Response: { success: true, data: { matches: [...], total: number } }
```

Same auth middleware as the existing `/sbom/route.ts`. `strategy` mirrors whatever the RPC accepts (or AS picks a server-side default and rejects unknown values).

---

## 6. `GET /api/projects/{id}/sbom` doesn't expose `component_id` filter (Phase 5a partial blocker)

**Impact: MEDIUM — forces forge to client-side filter, which violates the Phase 5 design bias against list-and-filter**

The existing `GET /api/projects/{id}/sbom` route accepts query params for `is_linked`, `search`, `severity`, `fs_link_id`, `package_type`, `license`, `has_vulns`, `has_exploit_intel`, pagination, sort, and an `ids` bypass mode — but **not `component_id`**. The underlying `list_project_sbom_packages` RPC is described in the design doc (Appendix A) as accepting `(project_id, component_id?, is_linked?)` — i.e., the RPC supports component scoping but the BFF route doesn't surface it.

**Why this matters for forge:** Phase 5b Tier-3 tools that need "SBOM packages linked to this component" must either (a) fetch the full per-project page and filter client-side, or (b) wait for this filter to land server-side. Option (a) re-creates the list-and-filter anti-pattern the design doc explicitly avoids.

**Root cause** (`finite-state-platform/apps/web/src/app/api/projects/[projectId]/sbom/route.ts:31-44`): the `querySchema` zod schema doesn't include `component_id`; the RPC call at line 201-209 doesn't pass `p_component_id` either.

**Requested change:** add `component_id` to the query schema and pass it through to the RPC. Should be a few-line patch:

```ts
const querySchema = z.object({
  // ...existing fields...
  component_id: z.string().uuid().optional(),
});

// In the .rpc() call:
.rpc("list_project_sbom_packages", {
  p_project_id: projectId,
  ...(isLinkedBool !== undefined && { p_is_linked: isLinkedBool }),
  ...(component_id && { p_component_id: component_id }),
}, ...)
```

(Or whatever the RPC's actual parameter name is — `p_component_id` is the convention based on `p_project_id` / `p_is_linked` in the existing call.)

---

## 7. `review_status` PATCH schema rejects the field on projects, risks, and mitigations

**Impact: MEDIUM — Tier-3 `approve=True` semantics are inconsistent across AS entity types**

The Tier-3 contract in forge says `approve=True` writes at `review_status='human_approved'` via a follow-up PATCH after the initial POST. This works for **threats** — the AS threats PATCH schema accepts `review_status`. It does **not** work for **projects**, **risks**, or **mitigations** — those PATCH schemas reject the field, so forge writes them at AS server default `review_status` regardless of `approve=True`.

**Why this matters for forge:** Phase 5b creates mitigations, risks, dataflows, and (potentially) requirements via Tier-3 tools. Without `review_status` PATCH support on those entities, `approve=True` becomes a journaled forge-side intent with no AS-side effect — a partial guarantee that's easy to misread.

**What forge does today:** Tier-2 `as_create_threat` uses 2-step POST+PATCH and lands at `human_approved`. Tier-2 `as_create_project`, `as_create_risk`, `as_create_mitigation` skip the PATCH because the schema rejects `review_status`. Phase 5b tools will follow the same pattern — POST + (conditionally PATCH if the entity type accepts it) — and surface `review_status_set: false` on the per-entity result for callers that need to distinguish "wrote at human_approved" from "wrote at server default."

**Requested change:** extend the projects/risks/mitigations PATCH schemas to accept `review_status` as an optional enum (`pending | ai_approved | ai_flagged | human_approved | human_rejected`). Threats schema already does this — same pattern. Alternative: a dedicated `POST /api/.../{entity}/{id}/review-status` endpoint per entity type, which mirrors the threats path more cleanly but is more code.

The corresponding tracker entry is in CLAUDE.md: *"projects/risks/mitigations land at AS server default review_status (PATCH schemas don't accept review_status for those resources — tracked as a follow-up)."*

---

## N. _placeholder for next finding_

Add new gaps below this line. Suggested entry structure:

```
## N. <One-line title>

**Impact: LOW | MEDIUM | HIGH — short consequence statement**

What we observed (with evidence — sizes, status codes, paste output).

Root cause (link to the AS code, or "unknown" if not yet investigated).

What forge has to do today (workaround in src/, if any).

Requested change (what we'd want upstream).
```
