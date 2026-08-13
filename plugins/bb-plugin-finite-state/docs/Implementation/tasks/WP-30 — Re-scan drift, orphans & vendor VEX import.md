# WP-30 — Re-scan drift, orphans & vendor VEX import

**Lane:** L3 Findings & VEX triage · **Spec refs:** SPEC 02 §2 Flows D–E, §4.3–§4.4, §8.1–§8.2 · RECON §2.6 · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-23, WP-29 · **Blocks:** L3 completion and Golden Loop re-scan demo
**Produces a FROZEN artifact:** no — replace the WP-22 drift stub; use the canonical resolver/writer/pusher seams.

## Files you own
```
plugins/bb-plugin-finite-state/lanes/findings/drift/index.ts  # replaces WP-22 stub
plugins/bb-plugin-finite-state/lanes/findings/drift/{classify,report,orphans}.ts
plugins/bb-plugin-finite-state/lanes/findings/drift/vendor/{parse,map,import}.ts
plugins/bb-plugin-finite-state/lanes/findings/drift/*.test.ts
plugins/bb-plugin-finite-state/lanes/findings/drift/vendor/*.test.ts
```

## Files you must not touch
Frozen/composition files, cache puller, stable-key/overlay/bulk internals, UI registration, dependencies, mock fixtures, or other lanes.

## Context
New versions produce new finding UUIDs, and platform carry-forward is best effort. The local overlay is durable triage memory. After pull, every decision is classified by the canonical ladder: purl → folded NVG → NG any-version. `CODE_NOT_REACHABLE` and all exact-version decisions become stale when the component version changes; they are reported and never auto-pushed. Unresolved decisions are orphans retained in YAML. Supplier VEX is untrusted proposal data and must never fabricate omitted rationale.

## What to build
1. Compare overlay decisions against the newly pulled pv using WP-23 and the current server VEX tuple. Classify exactly: `reattached_noop`, `reapply`, `stale`, `orphaned`, `conflict`, or `needs_completion`.
2. `reattached_noop` means server tuple already equals ours. `reapply` means identity resolves and carry-forward missed/differs without a three-way human conflict. Neither classification writes or pushes.
3. Mark exact-version version changes stale, including forced `CODE_NOT_REACHABLE`; keep old evidence visible and provide re-evaluation context. Orphans remain in YAML/index/status until explicit prune.
4. Generate a bounded/paged drift report with totals and stable-key samples. Publish one pull-complete hint so UI/CLI refetch the report.
5. Implement local import adapters for CycloneDX VEX, CSAF, and OpenVEX using already available parsers/readers; do not add a dependency. Normalize only documented status mappings and retain source document identity/digest.
6. Map statements through WP-23. Existing local decisions win unless explicit human CLI/UI `--overwrite`; unmatched statements remain local proposals marked `match:none` for future pulls.
7. Never invent omitted justification, response, reason, scope, or evidence. A NOT_AFFECTED statement without justification becomes `needs_completion` and is plan-blocked.
8. Write proposals through WP-27 with provenance `{by:"vendor:<name>", evidence:"<file>#<statement>"}` and CAS. Import performs no server calls.
9. Implement orphan prune as an explicit local file edit with dry-run and confirmation; default list/status never deletes.

## Interface contract
```ts
export type DriftState = "reattached_noop" | "reapply" | "stale" | "orphaned" | "conflict" | "needs_completion";
export interface DriftItem { stableKey: string; state: DriftState; tier?: 1 | 2 | 3; reason: string; previousVersion?: string; currentVersion?: string; }
export interface DriftReport {
  pvId: string; runId: string; createdAt: string; unclassifiedCount: number;
  totals: Record<DriftState, number>; items: DriftItem[]; nextCursor: string | null;
}
export interface VendorImportResult {
  source: { format: "cyclonedx" | "csaf" | "openvex"; digest: string; vendor: string };
  matched: number; unmatched: number; needsCompletion: number; keptLocal: number; written: number;
  proposals: { stableKey?: string; state: string; sourceRef: string }[];
  errors: { sourceRef?: string; code: string; message: string }[];
}
export function classifyDrift(deps: DriftDeps, pvId: string): DriftReport; // explicit refresh + persist
export function readDriftReport(deps: DriftReportDeps, pvId: string): DriftReport; // read-only keyset page
export function importVendorVex(deps: ImportDeps, file: string, options: { vendor: string; overwrite: boolean; dryRun: boolean }): Promise<VendorImportResult>;
```

## Acceptance criteria
- [ ] UUID changes alone do not detach decisions; canonical identity reattaches them.
- [ ] Noop/reapply/stale/orphan/conflict/needs-completion fixtures land in exactly one bucket each.
- [ ] Exact-version and `CODE_NOT_REACHABLE` version changes never enter pushable reapply output.
- [ ] Orphans remain in YAML and status until explicit confirmed prune.
- [ ] All three vendor formats map their documented statuses and retain source digest/reference.
- [ ] Missing vendor rationale remains null/incomplete; no default `CODE_NOT_PRESENT` or `WILL_NOT_FIX` is fabricated.
- [ ] Existing local decisions win by default and all imports are local-only CAS writes.
- [ ] Reports are paged/bounded for large versions.

## Test plan
`drift-classify.test.ts`
- `new UUID same purl is noop/reapply`, `folded NVG fallback`, `any-version NG promotion`, `exact-version change stale`, `soft-delete/re-confirm recovery`, and `removed component orphan`.

`vendor-vex-import.test.ts`
- one fixture per format; mapping counts, provenance, collisions, unmatched retention, and idempotent repeated import.
- **Error path:** malformed/oversized/unrecognized document reports a parse error and writes nothing.
- **Trust path:** NOT_AFFECTED with omitted justification is written incomplete and plan-blocked, never filled with defaults.

## Do not
- Do not delete orphans during pull or silently rewrite stale decisions.
- Do not fuzzy-match vendor statements or prefer vendor data over existing local decisions by default.
- Do not fabricate rationale missing from a supplier document.
- Do not call a remote importer or expose agent push; parsing and overlay creation are local.
- Do not reimplement stable-key matching.

## Open questions
1. Confirm which VEX parsers are already in the frozen dependency graph; if none are importable in TypeScript, implement narrowly against the published JSON shapes without adding packages.
2. `--overwrite` remains a human CLI/panel affordance; agent tools must not expose it.
