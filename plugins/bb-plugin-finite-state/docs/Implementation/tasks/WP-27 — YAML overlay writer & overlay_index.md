# WP-27 — YAML overlay writer & `overlay_index`

**Lane:** L3 Findings & VEX triage · **Spec refs:** SPEC 02 §4.1–§4.4, §6.7, §8 · SPEC 01 serializer rules · **Effort:** 2.5 d · **Status:** unassigned
**Depends on:** WP-23, WP-15 · **Blocks:** WP-26, WP-28, WP-29, WP-30
**Produces a FROZEN artifact:** no — consume the frozen schema/registry and WP-15 serializer/CAS seams unchanged.

## Files you own
```
plugins/bb-plugin-finite-state/lanes/findings/overlay/index.ts  # replaces WP-22 stub
plugins/bb-plugin-finite-state/lanes/findings/overlay/{schema,writer,reader,indexer,watcher}.ts
plugins/bb-plugin-finite-state/lanes/findings/overlay/*.test.ts
```

## Files you must not touch
Frozen artifacts, sync serializer implementation, cache puller, UI, policy/bulk/drift modules, composition roots, package files, or fixtures.

## Context
YAML is the source of truth for authored VEX intent; `overlay_index` is a disposable SQLite projection for fast joins. Files contain stable business identity, never ephemeral finding UUIDs or pvIds. All writers—panel, agent tools, policy, importer—must converge on this one CAS-protected path. Stable resolution is purl → folded NVG → NG any-version, with `CODE_NOT_REACHABLE` exact-version pinned. The agent may write local intent but never push it.

## What to build
1. Define and validate `fs-triage/v1`: one file per component under `.fs/triage/<project>/<safe-component>.yaml`, deterministic key/order/quoting, nullable tuple fields, pin, provenance, and three-way `sync.base`.
2. Reject UUIDs/pvIds, unknown top-level fields, invalid VEX vocabulary, missing reason/evidence, `NOT_AFFECTED` without justification, and `CODE_NOT_REACHABLE` without exact-version pin.
3. Implement `setDecision` and `removeDecision` as read-validate-merge-serialize-CAS writes through WP-15. Preserve unrelated decisions/comments where the serializer supports them; never whole-file last-write-wins.
4. Sanitize file names while preserving component identity inside YAML. Prevent traversal, symlink escape, oversized documents, duplicate YAML keys, and alias expansion.
5. Rebuild/upsert `overlay_index` transactionally from parsed files. Store canonical stable key, tuple, pin, file, provenance, and computed state. YAML wins on every disagreement.
6. Watch `.fs/triage/**` for editor/agent changes, debounce/coalesce events, delete index rows for removed decisions/files, and publish `fs-triage-overlay-changed` as a tiny refetch hint.
7. Register the `vexDecision` adapter reader/serializer with the sync engine through existing seams. Do not edit L2 files.
8. Expose writer result details sufficient for UI/tools: file, stable key, old/new digest, field diff, state; malformed sibling files are reported but do not hide valid ones.

## Interface contract
```ts
export interface TriageOverlayV1 {
  schema: "fs-triage/v1";
  project: string;
  component: { purl: string | null; name: string; group?: string | null; version?: string | null };
  decisions: Record<string, {
    status: VexStatus;
    justification: VexJustification | null;
    response: VexResponse | null;
    reason: string;
    pin: "exact_version" | "any_version";
    provenance: { by: string; at: string; evidence: string };
    sync: { base: VexTuple | null; pushed_at: string | null };
  }>;
}
export interface OverlayWriteResult {
  file: string; stableKey: string; beforeSha256: string | null; afterSha256: string;
  changedFields: string[];
}
export function setDecision(root: string, input: DecisionInput, expectedSha256?: string): Promise<OverlayWriteResult>;
export function rebuildOverlayIndex(db: Db, root: string): Promise<{ indexed: number; errors: OverlayParseError[] }>;
```

## Acceptance criteria
- [ ] Deterministic round-trip preserves semantic content and produces byte-stable output.
- [ ] No authored overlay contains UUID or pvId; stable keys use WP-23's sole codec.
- [ ] Concurrent CAS writes never silently clobber; one wins and the other gets a recoverable conflict.
- [ ] Index rebuild from YAML is idempotent, transactional, and removes stale index rows.
- [ ] Deleting SQLite/index data and rebuilding loses no authored decision.
- [ ] Invalid sibling YAML is reported with file/line while valid files remain indexed.
- [ ] Watcher events coalesce and publish hints only.
- [ ] Sync adapter reads the same semantic payload written by the panel/tools.

## Test plan
`overlay-writer.test.ts`
- `create/update/remove deterministic bytes`, `two decisions in one component file merge`, `forced exact pin`, and `path traversal rejected`.
- **Error path:** two writers use the same initial SHA; second gets `OVERLAY_CAS_CONFLICT` and newer bytes remain intact.

`overlay-indexer.test.ts`
- `rebuild mirrors YAML`, `file deletion removes rows`, `malformed sibling isolated`, `duplicate YAML key rejected`, and `watch burst emits one refetch hint`.

## Do not
- Do not make SQLite authoritative or write an overlay row without writing YAML.
- Do not invent finding UUID persistence, fuzzy identities, or a parallel YAML format.
- Do not silently repair malformed user files.
- Do not contact Forge or expose a push tool.
- Do not edit the frozen migration to add convenience fields.

## Open questions
1. Comment preservation depends on WP-15's YAML AST strategy; if unsupported, document normalization clearly and preserve semantic fields exactly.
2. Define the maximum file size from platform/plugin limits; assume 5 MiB per component overlay until the frozen contract or security review specifies otherwise.

