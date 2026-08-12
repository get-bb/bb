# WP-58 — Read tools

**Lane:** L7 Agentic surfaces · **Spec:** SPEC 01 §8 · SPEC 02 §6.2 · SPEC 03 §6.2 · SPEC 04 §5.2 · SPEC 05 X14.1 · SPEC 06 §2.1, §4 · **Effort:** 2.5 d · **Status:** unassigned
**Depends on:** WP-57 and the owning surface WPs (WP-18, WP-22–30, WP-36–40, WP-41–46, WP-52–56) · **Blocks:** WP-63, WP-65
**Produces a FROZEN artifact:** no

## Files you own
```
plugins/bb-plugin-finite-state/lanes/agentic/tools/read.ts
plugins/bb-plugin-finite-state/lanes/agentic/tools/read-schemas.ts
plugins/bb-plugin-finite-state/lanes/agentic/tools/read.test.ts
plugins/bb-plugin-finite-state/lanes/agentic/tools/read.integration.test.ts
```

## Files you must not touch
Composition roots, frozen interfaces, surface stores/query implementations, action/write modules, skills, CLI, manifest, dependencies, or mock fixtures.

## Context
Nine canonical read tools cover cache/YAML retrieval, including `fs_sync_plan`, which may perform a read-only upstream refresh and must degrade to the last base snapshot offline. They are retrieval interfaces for an agent, not alternate bulk APIs. Authored YAML does not get a redundant read tool; native file tools already reach it. Every response returns compact summaries and directive-ready ids.

## What to build
1. Register `fs_sync_status`, `fs_sync_plan`, `fs_findings_query`, `fs_tara_query`, `fs_ears_convert`, `fs_sbom_query`, `fs_hbom_review`, `fs_bench_status`, and `fs_doc_search` from the canonical registry. `fs_sync_plan` is classed read despite the optional network refresh; it never mutates upstream.
2. Define strict Zod parameter schemas. Unknown keys fail; enums come from the owning surface contracts; `limit` defaults 50 and caps 200; cursors are opaque.
3. Delegate to owning lane services through `ctx.service(...)`. Do not query another lane's tables directly when a domain query service exists.
4. Shape results as summaries: stable ids/slugs, decision/status fields, scores, counts, and source refs. Exclude raw payload columns, log bodies, document text, and binary bytes.
5. Make `fs_sync_plan` refresh upstream conflict tuples when online; on timeout/offline, use last-pulled base, set `stale:true`, include `basePulledAt`, and explain that push-time state may differ.
6. Keep `fs_ears_convert bundle` cache-served. `validate` performs gates 1–2 only and never writes.
7. For query kinds requiring YAML⋈cache joins, return freshness for both sides and surface unresolved links instead of dropping them.
8. Pair each response with the registry directive id in its tool description and returned summary where applicable.
9. Apply budget enforcement after domain shaping. If 50 summaries exceed the soft target, return fewer complete rows plus a cursor; do not slice JSON strings.

## Interface contract
```ts
export function registerReadTools(bb: BbPluginApi, ctx: PluginContext): void;

type Page<T> = {
  items: T[];
  total: number;
  cursor: string | null;
  freshness: { cachePulledAt: string | null; stale: boolean; source: "cache" | "base-snapshot" };
};

type FindingSummary = {
  id: string;                 // stable key, never finding UUID
  cve: string | null;
  component: { name: string; version: string | null; purl: string | null };
  severity: string | null;
  epss: number | null;
  kev: boolean;
  reachability: string | null;
  serverDecision: string | null;
  localDecision: string | null;
};

type ReadServices = {
  sync: { status(input: unknown): unknown; plan(input: unknown): Promise<unknown> };
  findings: { query(input: unknown): Page<FindingSummary> };
  tara: { query(input: unknown): Page<unknown>; earsBundle(input: unknown): unknown; earsValidate(input: unknown): unknown };
  bom: { querySbom(input: unknown): Page<unknown>; reviewHbom(input: unknown): Page<unknown> };
  bench: { status(input: unknown): Page<unknown> };
  documents: { search(input: unknown): Page<unknown> };
};
```
Import the real frozen/domain types when available; if their shape disagrees, adapt at this boundary rather than editing the owner.

## Acceptance criteria
- [ ] All nine read registrations match the canonical names, classes, schemas, and descriptions.
- [ ] Findings return stable keys and never expose ephemeral finding UUIDs as identity.
- [ ] Every list is cursor-paged with total and freshness; no call returns raw table rows.
- [ ] `fs_sync_plan` performs no upstream mutation and degrades explicitly, not silently, when refresh fails.
- [ ] EARS bundle is cache-only; validation performs no write.
- [ ] HBOM review is read-only and exposes no accept/reject capability.
- [ ] Bench results and document matches include evidence/source ids but not log/document bodies.
- [ ] Seed-corpus response telemetry meets the budget policy or paginates earlier.
- [ ] Integration tests execute through `harness.callAgentTool`.

## Test plan
`read.test.ts`
- one schema/shape test per tool, including unknown-key rejection.
- `findings query uses stable identity and omits raw payload`.
- `tara trace reports unresolved link rather than omitting it`.
- `ears bundle performs zero Forge calls`.
- `hbom review has no mutation callback`.

`read.integration.test.ts`
- `query → returned id → paired directive lookup succeeds` for one item per surface.
- `sync plan refresh timeout returns stale base and recovery hint` (**fault path**).
- `cursor resumes without duplicate or skipped ids`.
- `oversized seed page is shortened at row boundaries`.

## Do not
- Do not add reads for authored YAML merely to avoid native file tools.
- Do not return full findings, SBOMs, logs, documents, attestations, or firmware bytes.
- Do not resolve HBOM proposals, model conflicts, or sync conflicts.
- Do not call a model-mutating Forge/AS route.
- Do not hide stale, partial, or unresolved data.

## Open questions
1. Confirm the exact cursor encodings exported by each lane; this boundary treats them as opaque strings.
2. If two surface services expose materially different freshness shapes, normalize them here without discarding either timestamp.
