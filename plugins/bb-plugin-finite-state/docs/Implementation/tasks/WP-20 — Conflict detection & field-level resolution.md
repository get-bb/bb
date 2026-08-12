# WP-20 — Conflict detection & field-level resolution

**Lane:** L2 Sync · **Spec refs:** SPEC 01 §5–§6 · SPEC 02 §2.3, §8.5 · RECON §2.8 · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-18 · **Blocks:** WP-21
**Produces a FROZEN artifact:** no

## Files you own
`plugins/bb-plugin-finite-state/lanes/sync/conflicts/index.ts` *(replaces WP-17 stub)*
`plugins/bb-plugin-finite-state/lanes/sync/conflicts/detect.ts`
`plugins/bb-plugin-finite-state/lanes/sync/conflicts/merge.ts`
`plugins/bb-plugin-finite-state/lanes/sync/conflicts/resolve.ts`
`plugins/bb-plugin-finite-state/lanes/sync/conflicts/policy.ts`
`plugins/bb-plugin-finite-state/lanes/sync/conflicts/attribution.ts`
`plugins/bb-plugin-finite-state/lanes/sync/conflicts/*.test.ts`

## Files you must not touch
Composition roots; frozen interfaces; `lanes/sync/register.ts`, `rpc.ts`, `cli.ts`, adapter/plan/push modules; other lanes; fixtures; package/lock files. Consume WP-18 plan types and existing exported wiring.

## Context
Sync conflicts are semantic record conflicts, not Git text conflicts. Detection compares canonical base/ours/theirs at field paths. Resolution never inserts `<<<<<<<` into YAML. Different-field edits can merge; graph set additions/removals can merge when mathematically non-opposed; the same field changed differently never auto-merges.

VEX needs a cautious default suggestion: server edits attributed to a human suggest `take-theirs`, because the server cannot distinguish an intentional override from stale local intent. Recognizable auto-triage may eventually suggest ours, but the production actor identity is unconfirmed. Defaults are suggestions only—no conflict is resolved until the human explicitly confirms.

## What to build
1. Refine WP-18 conflict candidates into field-level conflicts using WP-15 semantic canonical values. Represent paths as RFC 6901 JSON pointers (or one verified documented equivalent) so nested fields and arrays are unambiguous.
2. Detect: same-field equal outcomes are converged, not conflict; delete-vs-update and create-vs-create differing payloads conflict at entity level; type changes conflict; missing versus explicit null remains distinct.
3. Auto-merge only disjoint field edits and registered set fields. Set merge works from base deltas: non-opposing additions/removals combine; add-vs-remove of the same normalized member conflicts. Arrays not registered as sets remain ordered values and same-field changes conflict.
4. Add a per-kind policy registry declaring set paths, forbidden auto-merge paths, and a default suggestion function. Unknown kinds use the most conservative policy: no set semantics and no suggested winner.
5. Fetch/cache audit attribution through a registered provider owned by each surface: actor, time, source/action. Failure to fetch attribution does not erase conflict; display `unavailable` and continue. Do not invent an audit endpoint in L2.
6. Implement explicit resolutions: `take-ours`, `take-theirs`, `edited`. `edited` must carry a schema-valid semantic value. A compare-and-swap on the persisted plan hash prevents two panels resolving stale copies.
7. Materialize resolution safely:
   - take ours: preserve working YAML, mark the plan field resolved;
   - take theirs: write the remote value to YAML with expected file SHA, then advance that entity base to the same remote semantic payload;
   - edited: write the edited value to YAML with expected SHA, retain the original base, and mark it as the new ours for push.
8. Re-run kind validators and referential checks after every resolution; regenerate plan summary/order/blast radius and persist atomically. A resolution can reveal another error and must not make Push eligible until green.
9. For VEX, suggestion is theirs only when attribution is positively human. Unknown/machine identity has no automatic winner until the actor vocabulary is verified. Never silently apply the suggestion.
10. Return updated plan/result through the frozen `sync.conflict.resolve` contract via WP-17's existing handler delegation; do not edit the contract or registration.

## Interface contract
```ts
export interface ConflictAttribution { actor: string | null; at: string | null; source: string | null; available: boolean; }
export interface FieldConflict {
  kind: EntityKind; key: string; path: string;
  base: unknown; ours: unknown; theirs: unknown;
  classification: "same-field" | "delete-update" | "create-create" | "set-opposed" | "type-change";
  attribution: ConflictAttribution;
  suggestion: "take-ours" | "take-theirs" | null;
  resolution: { choice: "take-ours" | "take-theirs" | "edited"; value?: unknown; resolvedBy: string; resolvedAt: string } | null;
}
export interface ConflictPolicy {
  kind: EntityKind; setPaths: readonly string[]; neverAutoMergePaths: readonly string[];
  suggest(conflict: FieldConflict): "take-ours" | "take-theirs" | null;
}
export type AttributionProvider = (kind: EntityKind, key: string, paths: readonly string[]) => Promise<ConflictAttribution>;
export function registerConflictPolicy(policy: ConflictPolicy): void;
export function registerAttributionProvider(kind: EntityKind, provider: AttributionProvider): void;
export function detectConflicts(input: { kind: EntityKind; key: string; base: unknown; ours: unknown; theirs: unknown }): { merged: unknown; conflicts: FieldConflict[] };
export function resolveConflict(deps: ConflictDeps, input: { planId: string; expectedPlanSha256: string; kind: EntityKind; key: string; path: string; resolution: { choice: "take-ours" | "take-theirs" | "edited"; value?: unknown } }): Promise<Plan>;
```

Do not expose server UUIDs as resolution identity. `kind+stable key+field path` is stable. Resolver writes use the serializer/file location from the registered adapter, not path construction duplicated here.

## Acceptance criteria
- [ ] Conflict output is field-level base/ours/theirs with attribution availability, not file-level markers.
- [ ] Disjoint field changes auto-merge; same-field different changes never do.
- [ ] Registered set paths merge safe non-opposing deltas; ordered arrays do not.
- [ ] Null versus absent, delete/update, create/create, and type-change cases are explicit.
- [ ] Every resolution is human-explicit, CAS-protected, atomic, and revalidated.
- [ ] Take-theirs rewrites YAML and advances base to identical remote semantic content; take-ours makes no YAML write; edited validates and becomes planned ours.
- [ ] VEX human attribution suggests theirs but remains unresolved; unknown attribution produces no silent policy decision.
- [ ] Audit failure leaves a usable conflict with “unavailable,” not an exception.
- [ ] No invalid YAML conflict markers are ever emitted; typecheck/test/lint/build is green.

## Test plan — `semantic-conflict-resolution`
- Exhaustive scalar matrix: unchanged/ours/theirs/both-same/both-different/null/missing/type change.
- `disjoint nested fields merge`, `same JSON pointer conflicts`.
- `graph set add/add and remove/remove merge; add/remove same member conflicts`; ordered-array edits conflict.
- `delete-vs-update and create-vs-create`.
- `audit provider success/failure/timeout` (**fault path**).
- `VEX human suggestion is not resolution`; unverified auto actor has no special policy.
- `take-theirs CAS write + base advance`; stale plan/file hash rejects with no partial write (**error path**).
- `edited invalid vocabulary/referential value rejects and plan remains unresolved` (**error path**).
- Property test: applying merged disjoint patches in either order yields canonical equality.

## Do not
- Do not write Git conflict markers or ask users to resolve semantic conflicts as raw YAML prose.
- Do not auto-merge same-field edits, unregistered arrays, delete/update, or create/create.
- Do not turn a default suggestion into an applied resolution.
- Do not key policy on an unverified auto-triage actor string.
- Do not call guessed audit routes from L2; use the provider seam.
- Do not mutate server state.

## Open questions
1. Confirm the audit actor identity for platform auto-triage before adding an ours-wins suggestion; until then it remains neutral.
2. Human review must approve the initial set-path registry for graph nodes/edges. Unknown arrays are ordered by default.
3. Decide whether take-theirs base advance should also append a local provenance note; it must not fabricate authorship.
