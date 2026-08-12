# WP-25 — Finding detail view & cross-surface links

**Lane:** L3 Findings & VEX triage · **Spec refs:** SPEC 02 §2 Flow A, §3.3, §6.4 · SPEC 05 firmware UX · **Effort:** 2.5 d · **Status:** unassigned
**Depends on:** WP-24 · **Blocks:** WP-26
**Produces a FROZEN artifact:** no — replace only the WP-24 detail stub.

## Files you own
```
plugins/bb-plugin-finite-state/lanes/findings/ui/detail/{index,FindingDetail,FindingCard,DecisionHistory,FindingComments,ReachabilityEvidence,CrossLinks}.tsx
plugins/bb-plugin-finite-state/lanes/findings/ui/detail/{useFindingDetail,links}.ts
plugins/bb-plugin-finite-state/lanes/findings/ui/detail/*.test.tsx
```

## Files you must not touch
`register.app.tsx`, frozen files, cache/overlay modules, firmware/SBOM/product-security lanes, theme/formatters, dependencies, and lockfiles.

## Context
Detail keeps the list visible and turns a finding into evidence: identity, effective intelligence, reachability factors, current server/local VEX, history, and links to the same component elsewhere in the workspace. Stable routes use the canonical stable key; server UUIDs remain ephemeral and never enter authored URLs. Components self-fetch by id so `<FindingCard>` can later render inside a directive. Use shared-ui, Hugeicons, theme tokens, and all four UI states.

## What to build
1. Replace the detail stub with a right split pane at `f/<encodedStableKey>`. Decode/validate the key, fetch by stable identity, and keep table navigation mounted.
2. Render identity and remediation; component purl/name/group/version; CVSS, EPSS, KEV/VC-KEV and exploit maturity; location; warning/violation counts; current server and local VEX tuples.
3. Render reachability factors as evidence rows, not a single score. Unknown/missing evidence is explicit and never interpreted as unreachable.
4. Show all duplicate cached rows behind the stable key and explain that UUIDs are per-version ephemeral. Default to a combined decision view while exposing row-specific source locations.
5. Render cached audit history as a virtualized/paged timeline when unbounded. Attribute actor, timestamp, source, and old/new tuple; offer an online Refresh that hydrates through the owner RPC. Failures leave prior history and the rest of detail usable.
6. Render version-specific comments with paged history plus human create/edit/delete controls. Resolve the selected transient finding row explicitly when a stable key has duplicates. State beside the composer that comments do not carry to another product version and durable reasoning belongs in overlay reason/evidence. Never expose comment mutation through an agent tool.
7. Add readiness-aware links: location → firmware file tree/opener; component → SBOM; CVE → related verification/results; component → TARA node/requirements. Missing downstream data renders a disabled explanation or Pull CTA, never a dead link.
8. Export `<FindingCard stableKey>` as a self-fetching read-only domain component using the same data hook. Treat directive/route attributes as untrusted strings; compact/directive mode never renders the comment composer.
9. Implement loading skeleton, key-not-found empty state, stale/error banner, and unconfigured state. Back/forward and Escape close the detail while restoring table focus.

## Interface contract
```ts
export interface FindingDetailModel {
  stableKey: string;
  resolution: { tier: 1 | 2 | 3; duplicateCount: number };
  rows: CachedFinding[];
  effective: { severity: string; cvss?: number; epss?: number; kev: boolean; vcKev: boolean };
  reachability: { verdict: "reachable" | "unreachable" | "unknown"; factors: EvidenceFactor[] };
  vex: { server: VexTuple | null; local: VexTuple | null; state: string };
  comments: { items: FindingCommentSummary[]; total: number; cursor: string | null; versionSpecific: true };
  links: { kind: "firmware" | "sbom" | "tara" | "requirement" | "verification"; target: string; ready: boolean; reason?: string }[];
  cache: { pulledAt: string; stale: boolean };
}
export function FindingCard(props: { stableKey: string; compact?: boolean }): JSX.Element;
```

## Acceptance criteria
- [ ] A stable-key route survives changed finding UUIDs and displays all duplicate rows.
- [ ] Reachability verdict cites its factors; missing factors render `unknown`.
- [ ] Local/server tuples and conflict state are visually and textually distinguishable.
- [ ] Cross-links navigate through bb helpers and degrade correctly when target surfaces are not ready.
- [ ] History is paged/virtualized and one failed history request does not blank the detail.
- [ ] Comments are paged and version-specific; duplicate identities require a selected transient row, mutation failures preserve draft/cached content, and the carry-forward warning is visible.
- [ ] `<FindingCard>` self-fetches by validated id and renders the same domain content in compact form.
- [ ] Loading, empty/not-found, stale/error, and unconfigured states pass.
- [ ] Only Hugeicons, shared-ui components, and theme tokens are used.

## Test plan
`finding-detail.test.tsx`
- `deep link resolves stable identity after UUID change`, `duplicate rows are disclosed`, `factor evidence renders`, `Escape restores table cursor`, and each available cross-link calls the correct navigation target.
- **Error path:** invalid encoded stable key renders a safe not-found card and performs no SQL/Forge call.
- **Fault path:** audit-history RPC failure preserves identity and decision sections with a scoped retry.
- **Fault path:** ambiguous comment create is not auto-retried; the draft and cached list remain visible with refresh-before-retry guidance.

## Do not
- Do not place UUIDs in routes/YAML or collapse duplicates silently.
- Do not label negative/missing evidence as proof without factors.
- Do not import or query another lane's SQLite internals directly; consume its public readiness/link contract.
- Do not add triage mutation or push behavior; WP-26/27 own local decisions and humans own push.
- Do not put comments into YAML, imply that they carry forward, or expose comment CRUD from an agent tool/directive card.

## Open questions
1. The verification cross-link may be CVE-level or requirement-level depending on WP-39's frozen RPC; ship it behind readiness and use the public link resolver.
2. Decide whether duplicate row source locations expand inline or in a secondary sheet after usability testing.
