# WP-97 — RE-corpus grounding

**Lane:** L10 Firmware Authoring & Bench Loop · **Spec refs:** SPEC 08 §4.2, §5, §8 (8n) · decision 9.1 (proceed, managed carefully) · AMD-0010 (`ground_source` licensing columns) · **Effort:** 5 d · **Status:** unassigned
**Depends on:** WP-82, corpus-access decision 9.1 (resolved: proceed) · **Blocks:** — (nothing depends on it; longest lead time — start as soon as access mechanics are settled)
**Produces a FROZEN artifact:** no — extends the WP-82 grounding plane with a corpus source kind and exports the corpus query surface WP-91's D0 and `fs_ground_query` consume

## Files you own

    plugins/bb-plugin-finite-state/lanes/grounding/corpus/ingest.ts
    plugins/bb-plugin-finite-state/lanes/grounding/corpus/observations.ts
    plugins/bb-plugin-finite-state/lanes/grounding/corpus/provenance.ts
    plugins/bb-plugin-finite-state/lanes/grounding/corpus/scope-filter.ts
    plugins/bb-plugin-finite-state/lanes/grounding/corpus/audit.ts
    plugins/bb-plugin-finite-state/lanes/grounding/corpus/fixtures/**
    plugins/bb-plugin-finite-state/lanes/grounding/corpus/**/*.test.ts

## Files you must not touch

server.ts, app.tsx, the five frozen artifacts and composition roots (WP-71 owns those changes under approved AMDs), lanes/grounding/register.ts and the index/retrieval core (WP-82), the catalog build (WP-83), lanes/authoring/** (WP-85's citation store is consumed via its exports), package.json, pnpm-lock.yaml, test/mock-remote/fixtures/**, or another lane.

## Context

This is the moat. Embedder grounds in what the vendor *says*; the RE corpus grounds in what shipped firmware *does*: undocumented registers, init sequences that actually work, vendor SDK bugs, real driver structure. It is the difference between a datasheet-faithful driver and one that works, and it is the largest such corpus outside the silicon vendors. Nothing else depends on this WP — WP-91's D0 comparison and `fs_ground_query` both degrade without it — so it carries no schedule pressure except its own long lead time.

Decision 9.1 is *proceed, managed carefully*, and "managed carefully" is three controls, not a policy note. Verbatim: **per-source licensing and permission recorded in `ground_source`** (§4.2.1's `license`/`redistributable` columns, plus the permission basis for corpus material); **provenance stamped on every corpus-derived value** (`re_corpus`, confidence 0.85) so a generated constant can always be traced to what it was learned from; and **a scope filter** so corpus grounding can be restricted per deployment — the question "was my firmware used to help a competitor" must be computable rather than reassuring. All three are code in this WP, with tests, not prose.

Scope discipline: this WP defines the **ingestion contract and the controls, not the corpus infrastructure.** Where the corpus lives, how it is indexed at volume, and what the extraction pipeline that produces observations looks like are open questions owned elsewhere; this WP consumes a declared observation format at a boundary, validates it there, and stores typed values internally. Fixtures stand in for the real corpus everywhere, so the WP is buildable and testable before access mechanics land. Corpus-derived grounding is grounding, not evidence — it feeds citations and D0 comparisons, never `verification_results` or attestations.

## What to build

1. The ingestion boundary in `ingest.ts`: a versioned, zod-validated observation-batch format (the contract the future corpus pipeline must produce), registering each corpus source as a `ground_source` row with `kind: "re_corpus"` and **refusing ingestion when licensing/permission fields are absent** — absence is not permission. Ingestion is chunked, resumable, and idempotent per source content hash.
2. Permission recording: each corpus source carries `license` (SPDX where possible), `redistributable`, and a permission record (basis, scope of allowed use, recorded-by, date). These are queryable, and the answer to "which grounding data can ship in an air-gapped deployment" is a query, not a memory.
3. The observation store in `observations.ts`: typed corpus observations — `init_sequence` (ordered register writes with values), `register_use` (undocumented or datasheet-divergent usage), `sdk_bug` (a known-bad vendor pattern and its fix), `driver_structure` — keyed by silicon family/part, each linked to its source and to the firmware artifact digest it was observed in. Paged queries by part/peripheral for WP-91's D0 comparison.
4. Provenance stamping in `provenance.ts`: every corpus-derived value handed to the citation path carries `provenance: "re_corpus"`, `confidence: 0.85`, and a corpus reference (source id + observation id) — composed with WP-85's citation shapes so a `.fs/authoring/citations/*.yaml` entry citing the corpus is clickable back to the observation. A corpus value with a missing or dangling reference is unusable by construction.
5. The scope filter in `scope-filter.ts`: a per-deployment policy (allow/deny by corpus source, vendor, silicon family, or origin customer) evaluated inside every corpus query — not in callers — so a restricted deployment provably cannot retrieve excluded observations. Default posture is deny-unlisted for customer-derived sources.
6. The audit surface in `audit.ts`: given a corpus source, enumerate every citation and generated value derived from it across the workspace (join through the provenance stamps and WP-85's citation files); given a deployment scope, report what the filter excluded. This is the computable answer to the competitor question.
7. Wire the corpus plane into WP-82's federated retrieval through its exported extension seam so `fs_ground_query` results from this plane are labeled (`plane: "re_corpus"`, confidence 0.85) — never blended into catalog or document confidence tiers. Publish `grounding:changed` refetch hints only; real SQLite in tests, never mocked.

## Interface contract

    export interface CorpusSourceRegistration {
      sourceId: string;                       // content hash of the source manifest
      title: string;
      origin: string;                         // corpus collection identifier, never a customer secret
      license: string | null;                 // SPDX id where possible
      redistributable: boolean;
      permission: {
        basis: string;                        // the recorded legal/contractual basis
        allowedUse: "internal" | "all_deployments" | "listed_deployments";
        recordedBy: string;
        recordedAt: string;
      };
    }

    export interface CorpusObservation {
      observationId: string;
      sourceId: string;
      kind: "init_sequence" | "register_use" | "sdk_bug" | "driver_structure";
      siliconFamily: string;                  // e.g. "stm32h7", "nrf52"
      part: string | null;
      peripheral: string | null;
      body: unknown;                          // kind-specific, zod-validated at the boundary
      observedInDigest: string;               // the shipped-firmware artifact it came from
    }

    export interface CorpusProvenance {
      provenance: "re_corpus";
      confidence: 0.85;
      ref: { sourceId: string; observationId: string };
    }

    export interface DeploymentScope {
      deploymentId: string;
      rules: ReadonlyArray<{ effect: "allow" | "deny"; match: Partial<Pick<CorpusSourceRegistration, "sourceId" | "origin">> & { siliconFamily?: string } }>;
      unlistedCustomerSources: "deny";
    }

    export function ingestCorpusBatch(deps: CorpusDeps, source: CorpusSourceRegistration, batch: unknown, signal: AbortSignal): Promise<IngestReport>;
    export function queryObservations(deps: CorpusDeps, q: { siliconFamily: string; peripheral?: string; kind?: CorpusObservation["kind"] }, scope: DeploymentScope, cursor?: string): Promise<Paged<CorpusObservation>>;
    export function stampProvenance(obs: CorpusObservation): CorpusProvenance;
    export function auditSourceUsage(deps: CorpusDeps, sourceId: string, cursor?: string): Promise<Paged<DerivedValueRef>>;
    export function auditScopeExclusions(deps: CorpusDeps, scope: DeploymentScope): Promise<ScopeExclusionReport>;

The batch format version is part of the contract; a future pipeline emitting v2 fails loudly at the boundary rather than half-ingesting.

## Acceptance criteria

- [ ] Ingestion refuses a source without license and permission fields; the refusal names the missing control.
- [ ] Every corpus-derived value reaching the citation path carries `re_corpus`/0.85 provenance with a resolvable observation reference; a dangling reference cannot be constructed through the public API.
- [ ] The scope filter is enforced inside the query path: a denied source's observations are unreachable through every exported query, proven by tests that call each one.
- [ ] `auditSourceUsage` traces a fixture-generated constant back to its source and observation end to end through a real WP-85 citation file.
- [ ] `auditScopeExclusions` reports exactly what a restricted deployment cannot see; the competitor question is answerable from these two audits alone.
- [ ] Corpus results in federated retrieval are plane-labeled and never inflate to catalog/document confidence tiers.
- [ ] Ingestion is idempotent, chunked, resumable, and paged; a malformed or version-mismatched batch fails loudly with nothing half-written.
- [ ] Nothing in this lane writes `verification_results`, attestations, or any server-side state; agent-visible writes remain local.
- [ ] The suite runs entirely on fixtures — no corpus access, network, or hardware in CI; real SQLite throughout; no new npm dependency.

## Test plan

- ingest.test.ts — valid batch, missing-permission refusal (safety error path), version mismatch, mid-batch failure leaves prior state coherent and resumable, and content-hash idempotence.
- observations.test.ts — per-kind body validation, paged part/peripheral queries, and an `init_sequence` round-trip consumed by a WP-91-shaped comparison fixture.
- provenance.test.ts — stamp shape, composition into a WP-85 citation entry, and dangling-reference construction rejected (error path).
- scope-filter.test.ts — allow/deny rule evaluation, deny-unlisted default for customer sources, filter enforced under every exported query including audit paths (safety error path), and rule-order determinism.
- audit.test.ts — source→derived-values trace across fixture citations, exclusion report accuracy, and pagination on large fixture sets.

## Do not

- Do not build corpus infrastructure — storage, extraction pipelines, or volume indexing; validate at the boundary and store typed observations.
- Do not ingest anything whose permission basis is unrecorded, or default a missing `redistributable` to true.
- Do not let corpus values enter citations without the provenance stamp, or present 0.85 material at a declared-vendor tier.
- Do not put customer-identifying corpus content into fixtures, logs, error messages, or this repository.
- Do not implement scope filtering in callers, tools, or UI — it lives inside the query path once.
- Do not register agent tools, CLI, panels, or a second retrieval engine; extend WP-82 through its seam.

## Open questions

1. Corpus access mechanics — where the corpus lives, how observations are extracted from it, and at what volume — are the real long lead and are owned by the corpus-access workstream, not this WP. The ingestion contract here is the interface that work must target; review it with that owner before freezing the batch format.
2. Granularity of the permission record: per collection, per source firmware image, or per originating customer. The scope filter's deny-unlisted default assumes origin is recorded per source; confirm the corpus can actually supply that.
3. Whether `sdk_bug` observations should also surface into the findings plane (a known-bad vendor pattern is arguably a finding) — tempting, but it crosses into SPEC 02 ownership; file the cross-surface proposal separately rather than widening this WP.
