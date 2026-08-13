# WP-45 — HBOM UI, confidence display & review queue

**Lane:** L5 Bill of Materials · **Spec refs:** SPEC 04 §3.1, §5.1, §6.1–6.5, §7.2 · SPEC 00 §7–8, §10 · **Effort:** 4 d · **Status:** unassigned
**Depends on:** WP-44, WP-07 · **Blocks:** WP-61, WP-67
**Produces a FROZEN artifact:** no — consumes the frozen RPC contract and WP-44's versioned HBOM schema

> **SPEC 07 intake note (2026-08-12).** `kicad_bom` cells (WP-78) render as
> design-asserted facts, not proposals — hover reveals the schematic sheet and
> reference designator as the source. Where a `kicad_bom` value disagrees with
> an existing human cell, the disagreement surfaces in this review queue
> rather than silently winning. Do not hardcode the provenance list.

## Files you own

    plugins/bb-plugin-finite-state/lanes/bom/app/hbom/hbom-grid.tsx
    plugins/bb-plugin-finite-state/lanes/bom/app/hbom/hbom-routes.tsx  # replaces WP-42 placeholder
    plugins/bb-plugin-finite-state/lanes/bom/app/hbom/hbom-cell.tsx
    plugins/bb-plugin-finite-state/lanes/bom/app/hbom/part-detail.tsx
    plugins/bb-plugin-finite-state/lanes/bom/app/hbom/review-queue.tsx
    plugins/bb-plugin-finite-state/lanes/bom/app/hbom/provenance-popover.tsx
    plugins/bb-plugin-finite-state/lanes/bom/app/hbom/hbom-summary-card.tsx
    plugins/bb-plugin-finite-state/lanes/bom/hbom/review.ts
    plugins/bb-plugin-finite-state/lanes/bom/app/hbom/**/*.test.tsx
    plugins/bb-plugin-finite-state/lanes/bom/hbom/review.test.ts

Replace only hbom-routes.tsx and the HBOM placeholders intentionally created by WP-42. Keep BOM registration, BomPanel, and software routes intact.

## Files you must not touch

app.tsx, server.ts, shared/contract.ts, any frozen file, lanes/bom/register.ts, lanes/bom/register.app.tsx except the WP-42 placeholder import target, package.json, pnpm-lock.yaml, or another lane.

## Context

The HBOM UI is a trust interface. A complete-looking grid is dangerous if its values are unreviewed guesses. Every cell must expose how it was learned, the exact source location, confidence, competing claims, and whether a human accepted it. Confidence ranks proposals; only an authenticated human action accepts or rejects them.

The authoritative write is a CAS-protected YAML edit through WP-44. The UI reads paged projections over RPC. It must remain clear when the projection is stale or the YAML is invalid.

## What to build

1. Implement hardware, hardware/p/<partId>, hardware/review, and hardware/ingest routes inside the existing BOM panel.
2. Build a virtualized HBOM grid with collapsible Identity, Placement, Supply, and Compliance/security column groups. Include review/conflict state, AS linkage, completeness, human-verified ratio, and queue depth.
3. Render cells by trust state. Human or accepted values are solid and labeled Verified. Unaccepted proposals always carry a Proposal label; medium confidence adds dashed/muted treatment and low confidence adds ghosted treatment. Conflict has a text label and competing-claims indicator. Never communicate state with color alone.
4. Preserve unknown versus not-applicable: bare null is an em dash with Unknown label; human null is n/a with Human-confirmed label.
5. Implement a provenance popover that answers value, document, page/region or sheet/cell, confidence number, extractor, timestamp, acceptance, and competing claims. Open source navigates to WP-56 at the exact locator.
6. Implement part detail with all cells, candidates, AS component, firmware/SBOM link, and external references. HbomSummaryCard accepts an ID/project key only and self-fetches counts for directive reuse.
7. Build the review queue as one cell decision per row. Show incumbent and candidates side-by-side with source excerpts. Reasons are proposal, low confidence, conflict, incomplete source, or withdrawn source.
8. Support keyboard controls: j/k navigate, Enter opens source, a accepts the selected claim, digits choose a candidate, e creates a human edit, and r rejects. Disable shortcuts while focus is in a form control.
9. Support filter and predicate selection by document, field, provenance, confidence, and reason. Bulk accept/reject requires a confirmation summary that states count, source document, and minimum confidence.
10. Human review RPC schemas reserve an opaque actor-bound `humanApprovalCapability`, but pinned bb exposes no authenticated actor context and v1 has no mint path. Review mutations therefore remain authorization-unavailable before CAS/YAML side effects. `confirmed`, plugin tokens, `requestInput`, Origin/Host checks, and CLI flags cannot substitute. Once bb supplies verifiable proof, the server derives actor/time from it; the client never submits provenance human, acceptance actor, or acceptance time.
11. Agent tool registration must not expose accept/reject. CLI review commands are human-facing command paths, not agent capabilities.
12. Implement loading, actionable empty, stale/error with retry, and unconfigured states for grid, queue, popover, and summary card.

## Interface contract

    export type ReviewDecision =
      | { action: "accept"; partId: string; field: string; candidateIndex?: number }
      | { action: "reject"; partId: string; field: string; candidateIndex?: number }
      | { action: "edit"; partId: string; field: string; value: unknown; note?: string };

    export interface ReviewRequest {
      projectId: string;
      projectVersionId: string | null;
      humanApprovalCapability: HumanApprovalCapability;
      expectedHbomSha256: string;
      decisions: ReviewDecision[];
    }

    export interface ReviewResult {
      hbomSha256: string;
      applied: number;
      rejected: Array<{ index: number; code: string; message: string }>;
    }

    export interface HbomCellView {
      partId: string;
      field: string;
      value: unknown;
      state: "verified" | "proposal" | "conflict" | "unknown" | "not_applicable";
      confidence: number | null;
      sourceRef: DocumentSourceRef | null;
      acceptedBy: string | null;
      acceptedAt: string | null;
      candidateCount: number;
    }

    export function applyHumanReview(
      deps: ReviewDeps,
      actor: AuthenticatedActor,
      request: ReviewRequest,
    ): Promise<ReviewResult>;

Actor and timestamps are server-derived. No public or agent-callable interface accepts them as caller-controlled strings.

## Acceptance criteria

- [ ] Every displayed value has an explicit trust state and non-color label.
- [ ] All unaccepted agent-extracted values remain visibly proposals at any confidence.
- [ ] Source links open the exact document page/region or spreadsheet cell.
- [ ] Unknown and human not-applicable are visually and semantically distinct.
- [ ] Review accepts, rejects, candidate selection, and human edit create deterministic YAML diffs through CAS.
- [ ] Human identity/time are server-derived and cannot be forged by the frontend.
- [ ] Predicate bulk actions show blast radius and handle item-level rejection.
- [ ] HbomSummaryCard self-fetches from an ID/project key and leads with verified ratio and queue depth.
- [ ] Four UI states and full keyboard operation are tested.
- [ ] No agent-exposed acceptance path exists.

## Test plan

- hbom-cell.test.tsx — verified/proposal/medium/low/conflict/unknown/n-a render matrix and accessible labels.
- provenance-popover.test.tsx — page/bbox and sheet/cell links, competing sources, withdrawn source, and missing document renders a recovery message.
- review-queue.test.tsx — keyboard actions, focus guard, filters, predicate selection, blast-radius confirm, and partial rejection.
- review.test.ts — server actor stamping, accept candidate, reject/revert, edit to human, immutable audit trail, and stale expected SHA returns HBOM_STALE without a write.
- Fault path — another writer changes hbom.yaml while the review dialog is open; the UI preserves draft input and requires reload/reapply rather than retrying blindly.

## Do not

- Do not auto-accept high-confidence extractions.
- Do not let the client or an agent claim provenance human or provide the acceptance identity.
- Do not show a naked confidence color without a label and provenance story.
- Do not resolve conflicts by highest confidence.
- Do not bypass CAS, write SQLite as the source of truth, or mutate the server.
- Do not use Lucide, emoji, literal colors, or non-shared UI primitives.

## Open questions

1. Bulk acceptance is human-only, but bb CLI commands are discoverable to agents through plugin-commands. Confirm whether review mutation commands should be omitted from generated metadata or explicitly state that they require interactive human execution.
2. Confidence calibration remains empirical. Preserve numeric values and project thresholds so defaults can change without rewriting evidence.
3. The source excerpt API depends on WP-56's viewer support. Until then, show a locator and open-source link rather than extracting an uncited snippet in the browser.
