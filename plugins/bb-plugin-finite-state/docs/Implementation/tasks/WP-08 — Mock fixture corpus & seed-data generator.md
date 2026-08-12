# WP-08 — Mock fixture corpus & seed-data generator

**Lane:** L0 Foundation · **Spec refs:** SPEC 00 §10–§12 · SPECs 02–05 fixture expectations · Master Plan §7 · RECON §2.9 · **Effort:** 2 d · **Status:** unassigned
**Depends on:** WP-04, WP-06 · **Blocks:** WP-11, WP-12, WP-13, WP-17, all offline E2E work
**Produces a FROZEN artifact:** **yes** — `test/mock-remote/fixtures/**` freezes on merge; the generator remains editable only when an approved amendment regenerates the corpus

## Files you own
`plugins/bb-plugin-finite-state/test/mock-remote/generate-seed.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/seed-schema.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/generate-seed.test.ts`
`plugins/bb-plugin-finite-state/test/mock-remote/fixtures/**` *(FROZEN generated corpus)*
`plugins/bb-plugin-finite-state/test/mock-remote/fixtures/README.md`

## Files you must not touch
Composition roots; `shared/contract.ts`; `lib/store/schema.ts`; `lib/sync/registry.ts`; `lib/remote/types.ts`; lane code; package/lock files. After merge, never hand-edit a fixture.

## Context
Every lane develops against one deterministic, awkward corpus rather than inventing private fixtures. It represents one coherent product/project/version graph and is large enough to exercise real UI/cache behavior: about 4,000 findings, 180 components, 900 SBOM entries, a 12-node TARA model, 40 requirements, 6,000 firmware paths, six documents, and representative runs/evidence. The committed files are generated artifacts so a review can reproduce and diff them exactly.

## What to build
1. Implement a dependency-free seeded PRNG and stable clock. One input seed plus `FIXTURE_SCHEMA_VERSION` produces byte-identical UTF-8 JSON/JSONL/CSV and small binary samples on every machine.
2. Generate a coherent identity graph: one org, project, product version, prior version, scan ids, component purls/fallback identities, findings, AS entities, requirement/check mappings, firmware hashes/paths, docs/source refs, bench runs, and attestations. Every foreign reference must resolve.
3. Meet minimum counts: 4,000 findings, 180 vulnerable components within a 900-entry SBOM, 12 architecture nodes with zones/dataflows/assets, threats/mitigations/attack paths, 40 requirements, 6,000 firmware paths, six docs, and at least one run in each terminal state.
4. Deliberately include awkward cases, labeled in `cases.json`: duplicate finding rows; component without purl; version-changed component; soft-delete then reconfirm; requirement with no verification; same-field TARA drift; `.strict()` unknown key; partial VEX failures; non-ASCII names; zero-byte and binary firmware files; symlink; unpack error; withdrawn document; conflicting HBOM claims.
5. Write service-oriented fixtures matching WP-06 normalized types and raw quirks: direct Platform pages/byte streams, CVE-keyed dict, severity `{bySeverity,total}`, AS `{success,data:{items,total,page,pageSize,hasMore}}`, bulk VEX partial results, CSV trailer, and separate optional Forge-compute job snapshots. Do not preserve legacy Forge file-path envelopes as a production contract.
6. Keep bulk data reviewable: JSONL for large row collections, stable key ordering, LF line endings, no timestamps outside the fixed clock, no secrets or absolute paths. Do not commit 6,000 materialized payload files; commit a manifest plus a small byte corpus and let tests materialize trees in temp directories.
7. Add a manifest with per-file SHA-256 and logical counts. `--check` regenerates into a temp dir and fails on byte/count/hash drift without overwriting.

## Interface contract
```ts
// test/mock-remote/seed-schema.ts
export const FIXTURE_SCHEMA_VERSION = 1 as const;
export const DEFAULT_FIXTURE_SEED = "finite-state-eagle-v1" as const;
export interface FixtureManifest {
  schemaVersion: number; seed: string; fixedNow: string;
  counts: { findings: number; components: number; sbomComponents: number; taraNodes: number; requirements: number; firmwarePaths: number; documents: number };
  files: { path: string; sha256: string; bytes: number; rows?: number }[];
  cases: Record<string, { description: string; refs: string[] }>;
}
export interface GenerateOptions { seed: string; outDir: string; check: boolean; }
export function generateFixtureCorpus(options: GenerateOptions): Promise<FixtureManifest>;
```

CLI contract:

```text
tsx test/mock-remote/generate-seed.ts [--seed <text>] [--out <dir>] [--check]
--check: generate to an isolated temp directory, compare manifest and every byte, write nothing
```

Expected top-level fixture groups: `platform/`, `assurance-studio/`, `forge-compute/`, `firmware/`, `documents/`, `faults/`, `expected/`, plus `manifest.json` and `cases.json`. WP-10–13 consume these paths; renaming after freeze is an amendment.

## Acceptance criteria
- [ ] Default generation is byte-identical across two clean runs and `--check` passes against committed fixtures.
- [ ] Manifest minimum counts meet or exceed every target above.
- [ ] A referential-integrity test resolves every purl/key/slug/id/file/document/evidence link.
- [ ] Every awkward case is present and addressable by a stable case id.
- [ ] Raw fixtures reproduce verified Platform/AS drift quirks and VEX bulk envelopes; optional compute fixtures are independently removable.
- [ ] No secret-like token, home directory, host-specific path, or current timestamp appears.
- [ ] Fixture corpus stays reviewable and reasonably sized by representing the 6,000-file tree as metadata plus a bounded byte corpus.
- [ ] Typecheck/test/lint/build is green before fixture freeze.

## Test plan — `deterministic-seed-corpus`
- `two generations have identical manifest and bytes`.
- `all references resolve` — report source fixture and missing target on failure.
- `required awkward cases exist once`.
- `different seed changes hashes but preserves schema/count invariants`.
- `--check detects one-byte drift and does not overwrite it` (**error path**).
- `invalid output path/seed fails with a typed message and leaves no partial corpus` (**fault path**).

## Do not
- Do not hand-author generated fixture files after freeze.
- Do not copy tenant/customer data, keys, or real proprietary documents.
- Do not make tests depend on wall clock, random UUID APIs, object iteration accident, or OS path separators.
- Do not put scenario behavior in the corpus generator; WP-13 owns fault state machines.
- Do not edit a frozen interface to fit generated data.

## Open questions
1. The index says “~4,000 findings” while SPEC 02 also calls for a 39k performance fixture. This WP supplies the shared 4k corpus; WP-24 may generate a non-frozen 39k benchmark expansion from the same seed unless human review requests it here.
2. Confirm fixture size budget before merge; if compressed assets are desired, preserve deterministic decompression and reviewability.
