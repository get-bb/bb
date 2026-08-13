# WP-79 — Cross-surface links & `links/hardware.yaml`

**Lane:** L9 Hardware Design Plane · **Spec refs:** SPEC 07 §6, §9, §12.1, §12.6 · SPEC 01 §2–4 · SPEC 02 §8.4 drift idiom · AMD-0012 · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-71, WP-73, WP-25, WP-34 · **Blocks:** WP-81
**Produces a FROZEN artifact:** no — implements the AMD-0012 `hardwareLink` entity behavior; the registry entry itself is WP-71's

## Files you own

    plugins/bb-plugin-finite-state/lanes/hardware/links/schema.ts
    plugins/bb-plugin-finite-state/lanes/hardware/links/yaml.ts
    plugins/bb-plugin-finite-state/lanes/hardware/links/resolver.ts
    plugins/bb-plugin-finite-state/lanes/hardware/links/drift.ts
    plugins/bb-plugin-finite-state/lanes/hardware/links/**/*.test.ts

Replace WP-72's compiling NOT_IMPLEMENTED placeholders at these exact paths in place.

## Files you must not touch

server.ts, app.tsx, shared/contract.ts, lib/store/schema.ts, lib/sync/registry.ts, lib/remote/types.ts, lib/agentic/registry.ts, lanes/findings/**, lanes/product-security/**, lanes/bom/**, lanes/hardware/register.ts, test/mock-remote/fixtures/**, package.json, pnpm-lock.yaml, or another lane.

## Context

The reference designator is the join key, and this file is where the joins live. `product-security/links/hardware.yaml` is the explicit, reviewable mapping — the AMD-0012 `hardwareLink` entity: OVERLAY, server `none`, `localOnly`, keyed by reference designator, never pushed. Links are **never inferred silently at read time**; inference that guesses wrong is worse than a gap, so an absent mapping resolves as `not_mapped` with a propose-link CTA, exactly the WP-25/WP-34 readiness idiom (ready / `not_pulled` / `not_mapped` / `unavailable`, never a dead link).

**OWNER DECISION required before this WP dispatches:** the MPN→SBOM mapping (SPEC 07 §12.1). An STM32 part number does not mechanically imply `pkg:generic/stm32-hal`. The options — curated vendor table, agent proposal with human acceptance, explicit manual linking, or all three tiered by confidence — change the schema's `basis` vocabulary and the resolver's trust display. Record the ruling in the coordination thread and this file's header before any code lands.

Refdes renumbering between revisions breaks links silently. Detect it by comparing symbol sets across `sch_hash` values and **report it as drift**, mirroring SPEC 02's re-scan handling: re-attached, stale, orphaned — reported, never auto-fixed.

## What to build

1. `fs-hardware-links/v1` strict schema: one entry per `(project, reference)`; purl syntax validation on `sbom_components`; `threat_node` must be a `COMP-` slug; `hbom_part` must match the L5 part-id shape; `firmware_paths` are workspace-relative and segment-safe; `confidence` numeric 0–1; `by: human | agent`. An optional `project` field disambiguates when two KiCad projects define the same reference; required exactly then.
2. Agent proposals: entries with `by: agent` carry no `accepted` record until a human accepts in the review panel; they resolve and render as labeled proposals, never as facts. Acceptance writes `accepted: {by, at}` and is human-only — no agent or CLI path.
3. Record the mapping's `basis` per SBOM component (`manual | curated | agent`), pending the §12.1 owner ruling; the schema carries the field so the tiering decision changes policy, not shape.
4. Deterministic YAML read/write with CAS: mutations supply the SHA-256 they read; a mismatch returns `HW_LINKS_STALE` and the caller reloads. Malformed external edits keep the previous valid in-memory index and surface a recoverable validation error.
5. Serializer/status hooks that make the WP-71-registered entity visible to `status` and drift handling and excluded from every plan/push — assert the exclusion, don't assume it.
6. A resolver that, for one reference, returns the SPEC 07 §6 link families — HBOM part cells, SBOM components with open-CVE rollup (findings cache), threat node, mitigating requirements (EARS traceability), firmware paths, and verification runs — each with readiness, reason, and provenance, consuming public lane contracts via `ctx.service(...)`, never another lane's tables or components.
7. Drift detection: compare `hw_symbol` sets between two hashes; match candidates by `(value, footprint, sheet, position within tolerance)` whose reference changed; report `{added, removed, renumbered, brokenLinks}` and propose (never apply) link rewrites. Publish a `hardware-links:changed` refetch hint; payloads carry keys only.
8. Watch `product-security/links/**` through the lane registration seam; debounce, validate, and rebuild the resolver index on external edits.

## Interface contract

    # product-security/links/hardware.yaml   (OVERLAY — hardwareLink, localOnly, never pushed)
    schema: fs-hardware-links/v1
    project: acme-router
    links:
      - reference: U3
        mpn: STM32H753ZIT6
        hbom_part: HBOM-0014
        sbom_components:
          - purl: pkg:generic/stm32-hal@1.11.0
            basis: curated
        threat_node: COMP-mcu
        firmware_paths: [src/drivers/stm32/]
        confidence: 1.0
        by: human               # agent entries are proposals until accepted
      - reference: U7
        by: agent
        confidence: 0.8
        sbom_components: [{ purl: "pkg:generic/esp-idf@5.2.0", basis: agent }]
        # no accepted record — resolves as a labeled proposal

    export interface HardwareLink {
      reference: string;
      project?: string;                    // required when the refdes is ambiguous
      mpn?: string;
      hbomPart?: string;
      sbomComponents?: Array<{ purl: string; basis: "manual" | "curated" | "agent" }>;
      threatNode?: string;
      firmwarePaths?: string[];
      confidence: number;
      by: "human" | "agent";
      accepted?: { by: string; at: string };
      note?: string;
    }

    export type LinkReadiness = { ready: true } | { ready: false; reason: "not_pulled" | "not_mapped" | "unavailable" };
    export interface ResolvedPartLinks {
      reference: string;
      hbom: LinkReadiness & { partId?: string };
      sbom: LinkReadiness & { components?: Array<{ purl: string; openCves: number; proposal: boolean }> };
      threat: LinkReadiness & { slug?: string };
      requirements: LinkReadiness & { ids?: string[] };
      firmware: LinkReadiness & { paths?: string[] };
      verification: LinkReadiness & { runIds?: string[] };
    }

    export interface RefdesDrift {
      fromHash: string; toHash: string;
      added: string[]; removed: string[];
      renumbered: Array<{ from: string; to: string; evidence: string }>;
      brokenLinks: string[];               // references in hardware.yaml no longer present
    }

    export function readHardwareLinks(root: string): Promise<{ doc: HardwareLinksDoc; sha256: string }>;
    export function writeHardwareLinksCas(root: string, expectedSha256: string, next: HardwareLinksDoc): Promise<string>;
    export function resolvePartLinks(ctx: PluginContext, projectKey: string, reference: string): Promise<ResolvedPartLinks>;
    export function detectRefdesDrift(db: Database.Database, projectKey: string, fromHash: string, toHash: string): RefdesDrift;

## Acceptance criteria

- [ ] The §12.1 MPN→SBOM owner ruling is recorded before implementation and reflected in the `basis` policy.
- [ ] Absent mappings resolve as explicit gaps with reasons; no link is ever inferred at read time.
- [ ] Agent entries without an acceptance record resolve and render as proposals everywhere; acceptance has no agent/CLI path.
- [ ] CAS prevents concurrent panel/agent clobbering; stale SHA returns `HW_LINKS_STALE` without changing the file.
- [ ] `hardwareLink` is excluded from every sync plan/push test and visible in `status`.
- [ ] Renumbering between two fixture hashes is reported as drift with broken links enumerated; nothing is auto-rewritten.
- [ ] Malformed external YAML preserves the prior valid index and surfaces a recoverable error.
- [ ] All resolution goes through public lane contracts; real SQLite in tests.

## Test plan

- schema.test.ts — every field, purl/slug/path validation, duplicate reference rejection, ambiguous-refdes `project` requirement, agent-without-accepted parses as proposal.
- yaml.test.ts — deterministic bytes, round-trip, CAS success, and `stale SHA leaves the file untouched` (**concurrency error path**).
- resolver.test.ts — all six families ready; `SBOM service unavailable degrades that family only while others resolve` (**fault path**); proposal labeling; not_pulled vs not_mapped distinction.
- drift.test.ts — pure renumber (R12→R13), value-collision guard (two identical resistors swapping positions do not report a rename), removed symbol with a live link lands in `brokenLinks`.

## Do not

- Do not infer, auto-create, or auto-repair links at read time or during drift handling.
- Do not give the agent, a tool, or the CLI any path to `accepted`.
- Do not push `hardware.yaml`, register a second entity for it, or edit `lib/sync/registry.ts`.
- Do not import another lane's tables, components, or SQLite internals.
- Do not edit KiCad files for any reason, including "fixing" a renumber.

## Open questions

1. The §12.1 owner ruling (curated table / agent proposal / manual / tiered) — blocking; see Context.
2. SPEC 07's example uses `hbom_part: PART-014`; WP-44's part ids are `HBOM-0001`. This WP validates against the L5 shape — confirm `HBOM-` is final before the schema freezes its regex.
3. Position tolerance for renumber matching is a heuristic; calibrate against the `test/fixtures/kicad/` sample projects and record the chosen tolerance here rather than tuning silently.
