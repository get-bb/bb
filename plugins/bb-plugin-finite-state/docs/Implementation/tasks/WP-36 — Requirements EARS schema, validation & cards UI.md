# WP-36 — Requirements EARS schema, validation & cards UI

**Lane:** L4 Product Security · **Spec refs:** SPEC 03 §3.1–§3.3, §5.1–§5.2, §5.5 · SPEC 01 validation · **Effort:** 4 d · **Status:** unassigned
**Depends on:** WP-05, WP-07 · **Blocks:** WP-37–WP-40
**Produces a FROZEN artifact:** no — replace the WP-31 requirements-card stub and register through existing sync seams.

## Files you own
```
plugins/bb-plugin-finite-state/lanes/product-security/requirements/cards/index.tsx  # replaces stub
plugins/bb-plugin-finite-state/lanes/product-security/requirements/cards/{schema,render-ears,validator,adapter,query}.ts
plugins/bb-plugin-finite-state/lanes/product-security/requirements/cards/{RequirementCard,RequirementList,RequirementEditor,StatusPill,TierStrip}.tsx
plugins/bb-plugin-finite-state/lanes/product-security/requirements/cards/*.test.tsx
```

## Files you must not touch
Registration/composition, frozen artifacts, verification run/result writers, traceability/conversion/matrix modules, theme/dependencies, or another lane.

## Context
Requirements are VERSIONED, one canonical YAML file per stable `req_id` slug under `product-security/requirements/`. A requirement is a card because it combines EARS structure, verification contract, evidence rollup, and trace links. The six patterns are ubiquitous, event-driven, state-driven, unwanted-behavior, optional-feature, and complex. The critical trust rule is structural: **verification status is evidence-derived and never authored**. There is no "mark verified" button; the only path to change displayed truth is a verification result produced by a run/attestation. Lists are virtualized and UI uses shared-ui, Hugeicons, theme tokens, and four states.

## What to build
1. Define strict `fs-requirement/v1` YAML validation for id, type, priority, writable workflow status, `ears`, rationale, original `source_description`, trace slug arrays, and inline verification contracts.
2. Implement the six EARS patterns and canonical renderer. Validate required/forbidden parts per pattern and whitespace-normalized round-trip between `ears.text` and rendered parts.
3. Preserve `req_id` verbatim and never reuse it. Resolve non-null requirement/check/mitigation/control/standard slugs through `id_map`/cached vocab at plan time; server UUIDs stay out of YAML.
4. Register a requirement serializer/validator through the existing seams. Strip the recon semantic exclusion list and hard-reject `verification_status`, verification summaries/evidence ids, review fields, timestamps, AI metadata, or other derived/server-owned data.
5. Decompose the inline `verification` block into requirement/check mapping plan operations with ordering and set semantics. `check:null` becomes a blocking `NEEDS_CHECK_CREATION` item, never an invented id.
6. Build collapsed/expanded self-fetching cards with emphasized EARS keywords, type/priority/pattern chips, evidence-derived status pill, tier strip, local/stale chips, and bounded trace preview.
7. Build a virtualized card list suitable for 5,000 requirements. Reads come from local YAML/cache RPC; no Forge in render paths.
8. Compute only the stale overlay locally from semantic hash/firmware version versus newest result. Base status comes from cached server rollup using worst-wins evidence; stale composes with it.
9. Provide loading skeleton, no-requirements CTA, stale/error banner while retaining cached cards, and unconfigured state.

## Interface contract
```ts
export type EarsPattern = "ubiquitous" | "event_driven" | "state_driven" | "unwanted_behavior" | "optional_feature" | "complex";
export interface RequirementYamlV1 {
  schema: "fs-requirement/v1";
  id: string;
  req_type: "security" | "privacy" | "safety" | "regulatory" | "operational";
  priority: string;
  status: "draft" | "approved" | "implemented" | "verified"; // workflow field, not verification_status
  ears: { pattern: EarsPattern; text: string; parts: { trigger?: string | null; precondition?: string | null; state?: string | null; feature?: string | null; system: string; response: string } };
  rationale?: string;
  source_description: string;
  mitigations: string[]; controls: string[]; standards: string[];
  verification: VerificationContract[];
}
export type RequirementEvidenceState = "verified" | "partial" | "failed" | "not_run";
export interface RequirementCardModel { requirement: RequirementYamlV1; evidenceState: RequirementEvidenceState; stale: boolean; local: boolean; tiers: TierSummary[]; }
export function validateRequirement(value: unknown): ValidationResult<RequirementYamlV1>;
export function renderEars(parts: RequirementYamlV1["ears"]): string;
```

## Acceptance criteria
- [ ] All six patterns accept valid fixtures and reject mismatched populated parts/text.
- [ ] YAML round-trips deterministically and contains no UUID/derived/review fields.
- [ ] Any `verification_status` field is rejected at parse/plan time.
- [ ] `check:null` yields `NEEDS_CHECK_CREATION`; no id is invented.
- [ ] Displayed Verified/Partial/Failed/Not run comes only from cached evidence rollup; stale is a separate overlay.
- [ ] There is no mark-verified control or direct result/status mutation.
- [ ] 5,000-card fixture uses bounded DOM and filter/paging hooks.
- [ ] Loading, empty, stale/error, unconfigured and UI import/token rules pass.

## Test plan
`ears-schema.test.ts`
- matrix for all six patterns, whitespace-normalized round-trip, excluded fields, slug resolution, and `check:null`.
- **Error path:** YAML asserts `verification_status: verified`; validator returns `DERIVED_FIELD` with file/line and plan contains no write.

`requirement-cards.test.tsx`
- evidence pill mapping, stale overlay composition, EARS keyword typography, virtualizer bound, and four states.
- **Trust path:** workflow `status: verified` is visually distinguished from evidence-derived verification and cannot masquerade as proof.

## Do not
- Do not serialize/cache status as user-authored truth or offer "mark verified".
- Do not invent checks, ids, criteria, or trace links.
- Do not render 5,000 cards without virtualization.
- Do not write directly to AS or expose agent push.
- Do not use UUIDs, Lucide, or custom colors.

## Open questions
1. The writable workflow enum includes `verified` in existing data; copy must explicitly call it workflow state to prevent confusion with evidence status.
2. Confirm whether `complex` text has one canonical renderer; if combinations cannot round-trip uniquely, require explicit ordered clauses in the schema rather than weakening validation.

