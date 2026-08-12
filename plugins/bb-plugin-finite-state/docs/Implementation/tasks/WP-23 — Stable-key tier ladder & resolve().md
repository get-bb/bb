# WP-23 — Stable-key tier ladder & `resolve()`

**Lane:** L3 Findings & VEX triage · **Spec refs:** SPEC 02 §4.2–§4.4, §8.3 · Local Model Architecture v2 §3–§4 · RECON §2.6 · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-05, WP-22 · **Blocks:** WP-27, WP-30; critical input to WP-29
**Produces a FROZEN artifact:** no — register the resolver through WP-17's seam; never edit the frozen entity registry.

## Files you own
```
plugins/bb-plugin-finite-state/lanes/findings/stable-key/index.ts  # replaces WP-22 stub
plugins/bb-plugin-finite-state/lanes/findings/stable-key/{resolve,fold}.ts
plugins/bb-plugin-finite-state/lanes/findings/stable-key/*.test.ts
```

## Files you must not touch
All composition roots and frozen artifacts, the findings schema/cache puller, mock fixtures, other findings modules, dependencies, and lockfiles.

## Context
This is the highest-risk identity code in the product. Legacy data intentionally permits duplicate findings, and each scan/version creates new UUIDs. UUIDs are therefore **ephemeral handles**, never business keys. Overlay identity is `(project, component identity, CVE)`, resolved with the same ordered ladder used by platform VEX carry-forward: **purl → case-folded name/group/version (NVG) → case-folded name/group (NG) any-version**. Tier 3 is allowed only for promotable decisions. `CODE_NOT_REACHABLE` is build-specific and must remain exact-version pinned.

## What to build
1. Consume WP-05's frozen `FindingIdentity`, `FindingKeyTier`, `findingStableKey`, and `parseFindingStableKey` contract as the sole codec. Add exhaustive route/round-trip vectors here, but do not reimplement or shadow it.
2. Implement only the resolver-side Unicode-aware, locale-independent comparison folding needed to query cached identity columns. Treat null and empty group consistently; keep version comparison exact and purl comparison canonical but not lossy. The results must agree byte-for-byte with WP-05's frozen key vectors.
3. Resolve in strict order: exact purl+CVE; then folded NVG+CVE; then folded NG+CVE only when `pin === "any_version"`. Never skip ahead after a higher tier finds rows.
4. Return **all** matching cached rows at the winning tier so a push can cover legitimate duplicates. Return tier, match reason, and version-change facts; never choose an arbitrary UUID.
5. Enforce pin semantics centrally: default `exact_version`; force it for `CODE_NOT_REACHABLE`; reject an attempted any-version override for that justification.
6. Classify an exact-version key with only a different-version tier-3 candidate as `stale`, not `orphaned`; classify no candidate at any tier as `orphaned`. Resolution itself performs no writes.
7. Register `resolve()` for `vexDecision` through the sync resolver seam. Keep the codec usable by URLs, YAML, RPC, the overlay index, and CLI without parallel encodings.
8. Build the exhaustive matrix: purl present/missing/changed; name/group case changes; version same/changed/null; duplicate rows; CVE mismatch; exact/any pin; `CODE_NOT_REACHABLE`; deleted rows; ambiguous candidates.

## Interface contract
```ts
export interface StableFindingKey {
  schema: "fs-finding-key/v1";
  project: string;
  purl: string | null;
  name: string;
  group: string | null;
  version: string | null;
  cve: string;
}
export type Pin = "exact_version" | "any_version";
export type FindingResolution =
  | { state: "resolved"; tier: 1 | 2 | 3; rows: CachedFinding[]; versionChanged: boolean }
  | { state: "stale"; reason: "exact_version_changed"; candidates: CachedFinding[] }
  | { state: "orphaned"; reason: "no_component_cve_match" };

export function enforcePin(input: { pin?: Pin; justification?: string | null }): Pin;
export function resolveFinding(
  db: Db,
  key: StableFindingKey,
  pvId: string,
  pin: Pin,
): FindingResolution;
```
`FindingIdentity`, `FindingKeyTier`, `findingStableKey`, and `parseFindingStableKey` are imported from frozen `lib/sync/registry.ts`; the illustrative `StableFindingKey` above is the decoded domain view, not a second serialized format.

## Acceptance criteria
- [ ] A key round-trips byte-identically through codec and supports separator/non-ASCII fixtures.
- [ ] UUID and pvId are absent from encoded keys and authored overlay fixtures.
- [ ] Resolution order is exactly purl, folded NVG, folded NG-any-version.
- [ ] NG is never attempted for `exact_version`; a different-version candidate is reported stale.
- [ ] `CODE_NOT_REACHABLE` always produces `exact_version` and an attempted any-version pin fails validation.
- [ ] All duplicates at the winning tier are returned in deterministic UUID order.
- [ ] Soft-delete/re-confirm fixtures reattach through stable identity even though UUID changes.
- [ ] The resolver is read-only and registered without changing `lib/sync/registry.ts`.

## Test plan
`stable-key-matrix.test.ts`
- Table-driven tests cover every ladder/pin combination and ambiguity.
- `purl wins over a conflicting NVG match`.
- `folded names/groups match; versions remain exact`.
- `soft-delete then re-confirm resolves new UUID`.
- **Error path:** malformed/oversized encoded route key is rejected as `INVALID_STABLE_KEY`, never interpolated into SQL.
- **Safety path:** `CODE_NOT_REACHABLE + any_version` is rejected before resolution.

## Do not
- Do not deduplicate, select the first row, or invent a UUID-based fallback.
- Do not apply fuzzy, substring, or similarity matching.
- Do not let tier 3 promote an exact-version decision.
- Do not mutate cache, YAML, base snapshots, or server state.
- Do not implement another key codec here, in the UI, or in an importer.

## Open questions
1. When multiple versions match an any-version NG key, v1 returns all rows; confirm whether the UI should display an ambiguity warning even though bulk application is deterministic.
