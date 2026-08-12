# WP-38 — EARS conversion flow (agent + three gates)

**Lane:** L4 Product Security · **Spec refs:** SPEC 03 §3.5, §6.2, §8.6 · SPEC 06 human gate · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-36 · **Blocks:** Legacy requirement migration workflow
**Produces a FROZEN artifact:** no — replace the WP-31 conversion stub; final agent-tool registration is WP-58/59.

## Files you own
```
plugins/bb-plugin-finite-state/lanes/product-security/requirements/conversion/index.tsx  # replaces stub
plugins/bb-plugin-finite-state/lanes/product-security/requirements/conversion/{bundle,validate,spawn,drift,report}.ts
plugins/bb-plugin-finite-state/lanes/product-security/requirements/conversion/{ConversionDialog,ConversionStatus,GateReport}.tsx
plugins/bb-plugin-finite-state/lanes/product-security/requirements/conversion/*.test.tsx
```

## Files you must not touch
Agent tool registry/skills, requirement schema/writer internals, sync push/review panel, frozen files, registration, dependencies, or other lanes.

## Context
Free-text-to-EARS conversion is reasoning, not a deterministic formatter. A bb thread receives grounded source and writes local requirement YAML. Three gates must all pass: (1) schema/pattern/text agreement, (2) round-trip resolution to real requirement/check slugs, and (3) human review as a diff. Preserving the original description and exact pass/fail criteria is mandatory. The agent may propose files but can never push them.

## What to build
1. Build a bounded conversion bundle from last-pulled local cache: selected requirements, mapped checks, results/evidence summaries, ids/slugs, source descriptions, and cache timestamp. No live AS call; stale ids are caught by gate 2.
2. Spawn an origin-plugin bb thread with selection, bundle reference, six-pattern guidance, exact YAML target paths, and prohibitions. Never paste an unbounded bundle into the prompt; use ids/paged tool access.
3. Require the agent to preserve `req_id`, copy original text into `source_description`, copy check pass/fail criteria verbatim, reference existing checks by slug, use `check:null` when absent, and never invent ids/evidence/status.
4. Gate 1 calls WP-36 validation: strict schema, enum, pattern/parts agreement, text round-trip, and derived-field exclusion.
5. Gate 2 resolves every requirement/check/trace slug against the pull snapshot and `id_map`, detects stale bundle inputs, orphans, duplicates, and invented links.
6. Gate 3 is explicitly human: present the ordinary git/sync domain diff, with approve/edit/discard navigation. Conversion completion means "valid local proposal," never pushed/applied.
7. Track a conversion snapshot digest. On pull, mark converted files stale only when upstream source/check contract changed; a rerun scopes to drifted ids and instructs preservation of human edits unless source changed.
8. Report per-requirement gate status and bounded errors. Provide loading, nothing-to-convert, scoped error, and unconfigured states using shared UI/tokens/Hugeicons.

## Interface contract
```ts
export interface EarsConversionBundleMeta {
  bundleId: string; projectId: string; pulledAt: string; snapshotDigest: string;
  requirementIds: string[];
}
export interface ConversionGateResult {
  requirementId: string;
  schema: { ok: boolean; errors: ValidationError[] };
  roundTrip: { ok: boolean; unresolved: string[]; staleSource: boolean };
  humanReview: "pending" | "reviewed" | "discarded";
}
export function buildConversionBundle(deps: ConversionDeps, reqIds?: string[]): Promise<EarsConversionBundleMeta>;
export function getConversionBundlePage(bundleId: string, cursor?: string): Promise<{ items: ConversionSource[]; nextCursor: string | null }>;
export function validateConversion(paths: string[]): Promise<ConversionGateResult[]>;
```

## Acceptance criteria
- [ ] Bundle is cache-served, paged/bounded, timestamped, and contains every source field needed for grounded conversion.
- [ ] Thread instructions cover all six patterns and the preservation/no-invention rules.
- [ ] Gate 1 catches malformed EARS and derived status; Gate 2 catches unknown/stale ids; neither writes server state.
- [ ] Gate 3 cannot be satisfied by the agent; it remains pending until an explicit human review action.
- [ ] Converted files preserve req_id/source description and exact check criteria.
- [ ] Drift rerun scopes only changed inputs and preserves human-edited EARS when source did not change.
- [ ] No agent tool or thread can invoke push.
- [ ] The panel requests thread spawn through backend RPC; frontend code never imports or calls `bb.sdk`.
- [ ] Four UI states and UI rules pass.

## Test plan
`ears-conversion.test.tsx`
- `bundle pages grounded source`, `spawn context is bounded`, `three valid requirements pass gates 1–2 and await human`, `drift scoping`, and `discard leaves source unchanged`.
- **Error path:** agent invents check slug and writes `verification_status`; gates 1/2 fail with file/line and review/push remains disabled.
- **Staleness path:** upstream changes after bundle creation; gate 2 flags stale source and requires rebuild.

## Do not
- Do not implement EARS conversion as string templates or silently rewrite prose.
- Do not let an agent mark gate 3 reviewed, push, or claim server application.
- Do not paraphrase pass/fail criteria or fabricate ids/checks/evidence.
- Do not call live Forge to assemble the bundle.
- Do not create a second requirement file layout or EARS id namespace.

## Open questions
1. WP-58/59 own final tool names; this module should expose bundle/validate services without registering duplicate tools.
2. Define how human review is observed (sync review action versus git diff acknowledgement) against the frozen contract; default to sync review state.
