# WP-15 — Serializer framework & the server-owned-field exclusion list

**Lane:** L2 Sync · **Spec:** SPEC 01 §4 · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-01, WP-05 · **Blocks:** WP-16, WP-17
**Produces a FROZEN artifact:** no

## Files you own
`plugins/bb-plugin-finite-state/lanes/sync/serialize/canonical.ts`
`plugins/bb-plugin-finite-state/lanes/sync/serialize/exclusions.ts`
`plugins/bb-plugin-finite-state/lanes/sync/serialize/serializer.ts`
`plugins/bb-plugin-finite-state/lanes/sync/serialize/yaml.ts`
`plugins/bb-plugin-finite-state/lanes/sync/serialize/canonical.test.ts`
`plugins/bb-plugin-finite-state/lanes/sync/serialize/exclusions.test.ts`
`plugins/bb-plugin-finite-state/lanes/sync/serialize/serializer.test.ts`
`plugins/bb-plugin-finite-state/lanes/sync/serialize/yaml.test.ts`

## Files you must not touch
`server.ts`, `app.tsx`, `shared/contract.ts`, `lib/store/schema.ts`, `lib/sync/registry.ts`, `lib/remote/types.ts`, `test/mock-remote/fixtures/**`, `package.json`, `pnpm-lock.yaml`, any other lane's directory.

## Context
Every VERSIONED and OVERLAY entity round-trips YAML ↔ server payload through this framework, and the exclusion list decides whether diffs are *real*. If the list is wrong in one direction, `status` shows phantom changes on every pull (server-owned fields churn constantly); wrong in the other, `push` sends fields no endpoint accepts. AS's own `tara_snapshot_semantic_payload()` (RECON §2.8, migration `20260721100000_add_tara_version_control_foundation.sql:1533-1590`) is the ground truth — use its column list **verbatim**, not a hand-derived one.

## What to build
1. **`canonical.ts`** — `canonicalJson(value)`: deterministic JSON — keys sorted recursively, arrays preserved in order, `undefined` keys dropped, `null` kept, rejects `NaN`/`Infinity` with a typed error. `contentHash(value)`: SHA-256 hex of `canonicalJson` via `node:crypto`.
2. **`exclusions.ts`** — the server-owned-field list, exactly as RECON §2.8 states it (see interface contract). Export `serverOwnedFields(entityType)` returning the merged set for a given entity type.
3. **`serializer.ts`** — `semanticPayload(entityType, raw, idReplacements)`: strip the excluded fields, then apply id→slug replacements (the TS mirror of `p_id_replacements`). Define the `EntitySerializer` interface and a `createSerializer(entry)` factory driven by the frozen `ENTITIES` registry entry (`lib/sync/registry.ts`, WP-05): domain-shaped YAML, references by slug not UUID (SPEC 01 §4 rule 2), one file per independently-changing entity.
4. **`yaml.ts`** — deterministic YAML emit (stable key order matching the serializer's field order, 2-space indent, no anchors/aliases, block style) and parse that throws `SerializeError { file, line, message }` — never a bare library exception.
5. Round-trip guarantee: `fromYaml(toYaml(x))` is semantically equal to `x` (equal `canonicalJson`) for every entity payload in the mock fixture corpus.

The YAML library is whatever WP-01 declared in the dependency freeze (expected: `yaml`). If it is missing, file an amendment — do not `pnpm add`.

## Interface contract
```ts
// lanes/sync/serialize/exclusions.ts
// Source of truth: tara_snapshot_semantic_payload(), RECON §2.8. Verbatim — do not edit without re-reading RECON.
export const SERVER_OWNED_BASE = [
  "id", "project_id", "organization_id", "org_id", "updated_at", "embedding",
  "processing_started_at", "processing_by", "source_chat_run_id", "needs_reanalysis",
  "stale_reason", "last_synced_at", "synced_at", "sync_status", "sync_error",
  "sbom_component_count", "vulnerability_count", "critical_vuln_count",
  "has_exploit_intel", "severity_order",
] as const;

// "plus created_at (+ processing_status) for most types; attack_path also drops
//  route_signature; source_document drops only created_at" — RECON §2.8
export const SERVER_OWNED_DEFAULT_EXTRA = ["created_at", "processing_status"] as const;
export const SERVER_OWNED_EXTRA_BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  attack_path: ["created_at", "processing_status", "route_signature"],
  source_document: ["created_at"], // does NOT strip processing_status
};

export function serverOwnedFields(entityType: string): ReadonlySet<string>;

// lanes/sync/serialize/canonical.ts
export function canonicalJson(value: unknown): string;      // throws CanonicalizeError on NaN/Infinity
export function contentHash(value: unknown): string;        // sha256 hex of canonicalJson

// lanes/sync/serialize/serializer.ts
import type { EntityKind } from "../../../lib/sync/registry"; // FROZEN (WP-05); frozen file wins on divergence

export interface SerializeOptions {
  idToSlug(remoteId: string): string | null;                 // from id_map (WP-16); null = keep UUID + warn
}
export interface EntitySerializer<T = Record<string, unknown>> {
  entityKind: EntityKind;
  semanticPayload(raw: Record<string, unknown>): Record<string, unknown>; // strip + id replacement
  toYaml(payload: T, opts: SerializeOptions): string;        // deterministic
  fromYaml(text: string, file: string): T;                   // throws SerializeError{file,line}
  contentHash(payload: Record<string, unknown>): string;     // hash of semanticPayload's canonical JSON
}
export function createSerializer(kind: EntityKind): EntitySerializer;

// lanes/sync/serialize/yaml.ts
export class SerializeError extends Error { file: string; line: number | null; }
export function emitYaml(value: Record<string, unknown>): string;
export function parseYaml(text: string, file: string): Record<string, unknown>;
```
Shapes quoted from frozen files are the planning contract; if a frozen file disagrees, the frozen file wins — and if it cannot work, stop and file an amendment (AGENTS.md §2).

## Acceptance criteria
- [ ] `exclusions.ts` encodes RECON §2.8 exactly; a test asserts the 20-entry base list and both per-type overrides verbatim (string-for-string).
- [ ] `semanticPayload()` on a mock-fixture TARA entity payload equals the fixture's expected semantic payload byte-for-byte under `canonicalJson`.
- [ ] `toYaml` is deterministic: two serializations of the same payload are byte-identical; key order is stable across Node runs.
- [ ] Round-trip: every VERSIONED/OVERLAY entity payload in `test/mock-remote/fixtures/` round-trips with `contentHash` equality.
- [ ] `fromYaml` on malformed YAML throws `SerializeError` carrying file and line — never a raw library exception.
- [ ] An unknown field that is NOT on the exclusion list is preserved and participates in diffs (unknown = keep, never silently drop).
- [ ] No new dependency; `pnpm exec turbo run typecheck test lint build --filter=bb-plugin-finite-state` green.

## Test plan
- `exclusions.test.ts` — `base list matches RECON verbatim`, `attack_path adds route_signature`, `source_document keeps processing_status`, `unknown entity type gets default extras`.
- `canonical.test.ts` — `sorts keys recursively`, `rejects NaN with CanonicalizeError` (**error path**), `hash stable across runs`.
- `serializer.test.ts` — `strips server-owned fields from fixture payload`, `replaces ids with slugs`, `null slug keeps UUID and records warning`, `round-trips all fixture kinds`.
- `yaml.test.ts` — `deterministic emit`, `malformed YAML throws SerializeError with line` (**error path**), `no anchors emitted for repeated objects`.
- Mock fault injection: N/A — this WP has no Forge surface (AGENTS.md scopes fault-injection tests to WPs that touch Forge); the two error paths above stand in.

## Do not
- Derive the exclusion list by diffing observed payloads — RECON's column list is verbatim and authoritative.
- Strip any field not on the list; "unknown = keep and diff."
- Emit YAML anchors/aliases or flow style.
- Touch Forge, the mock server, or SQLite — this WP is pure functions.
- Put canvas/layout fields into entity YAML (layout separation is SPEC 01 §4 rule 3; the guard lands with L4's serializers, but don't preclude it).

## Open questions
1. RECON §2.8's phrase "source_document drops only created_at" is encoded as *extra = [created_at] on top of the base list*. If anyone has read access to the platform migration, verify against `tara_snapshot_semantic_payload()` directly; if the base list does not apply to `source_document`, file an amendment to fixtures + this module together.
2. Does the frozen registry (WP-05) export per-kind field ordering for YAML emit, or does this WP own the ordering? Assumed: this WP owns it (alphabetical within groups: identity, content, relations).
