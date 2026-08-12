# WP-18 — `plan` — diff, validation, ordering, blast radius

**Lane:** L2 Sync · **Spec:** SPEC 01 §5 (`plan`) · **Effort:** 4 d · **Status:** unassigned
**Depends on:** WP-17 · **Blocks:** WP-19, WP-20, WP-21
**Produces a FROZEN artifact:** no

## Files you own
`plugins/bb-plugin-finite-state/lanes/sync/plan/index.ts` *(replaces WP-17 stub in place)*
`plugins/bb-plugin-finite-state/lanes/sync/plan/diff.ts`
`plugins/bb-plugin-finite-state/lanes/sync/plan/validate.ts`
`plugins/bb-plugin-finite-state/lanes/sync/plan/order.ts`
`plugins/bb-plugin-finite-state/lanes/sync/plan/blast-radius.ts`
`plugins/bb-plugin-finite-state/lanes/sync/plan/render-cli.ts`
`plugins/bb-plugin-finite-state/lanes/sync/plan/plan.test.ts`
`plugins/bb-plugin-finite-state/lanes/sync/plan/validate.test.ts`
`plugins/bb-plugin-finite-state/lanes/sync/plan/order.test.ts`
`plugins/bb-plugin-finite-state/lanes/sync/plan/render-cli.test.ts`

## Files you must not touch
`server.ts`, `app.tsx`, `shared/contract.ts`, `lib/store/schema.ts`, `lib/sync/registry.ts`, `lib/remote/types.ts`, `test/mock-remote/fixtures/**`, `lanes/sync/register.ts` (wiring already points here), `package.json`, `pnpm-lock.yaml`, any other lane's directory.

## Context
"The plan is the product; the push is mechanical" (SPEC 01 §5). Plan is the safety mechanism: it computes the ordered changeset, validates it, and detects conflicts before anything is written. If plan is wrong, push destroys data politely. Note the backend fact this rests on: **there is no optimistic concurrency for findings** (RECON §2.8 has tokens only for TARA/review/standards) — so conflict *detection* happens here, at plan time, by three-way comparison against a fresh remote read.

## What to build
1. **`diff.ts`** — field-level three-way diff on semantic payloads (WP-15 canonical form): `diff(base, working)` → ours; `diff(base, remote)` → theirs; classify each key into `create | update | delete | noop`. Conflict *candidates* (both sides changed) are handed to `conflicts/` (WP-20 detects/resolves; until it lands, candidates surface as `conflict` items with `resolution: "unresolved"`).
2. **Remote refresh** — plan performs a **read-only** refresh of upstream tuples through the adapters' `fetchRemote` (never a mutation, never a base rewrite — base only advances on pull/push). Offline or on repeated 429 exhaustion, degrade to the last-pulled base with `staleness: {asOf, degraded: true}` on the plan (SPEC 01 §8).
3. **`validate.ts`** — the five validation families of SPEC 01 §5, plus a `registerValidator(kind, fn)` seam so surface lanes add their own (L4's EARS well-formedness, methodology vocab):
   - **Referential integrity** — deleting an entity that is referenced fails with the referrer list (`⚠ referenced by THREAT-14, THREAT-31`).
   - **Ordering** — handled in `order.ts`: creates before dependents; deletes in reverse dependency order.
   - **Derived-field guards** — reject writes to server-derived fields; encode the table: `requirements.verification_status`, `risk_value_numeric`, `severity_level_source`, exploitability outputs (extensible per kind).
   - **Schema/vocabulary** — VEX enums verbatim from frozen contract (status/response/justification, RECON §2.6); `NOT_AFFECTED ⇒ justification` required; incomplete decisions (`needs_completion`) are rejected with file/line (SPEC 02 §8.8).
   - **Blast radius** — `blast-radius.ts`: any delete, or > 20 entities changed ⇒ `requiresConfirmation: true` with a summary.
4. **`order.ts`** — topological order from payload references (slug refs, WP-15); cycles reported as validation errors, never silently broken.
5. **Plan persistence** — serialize the computed plan to `.fs-sync/plan-<planId>.json` (gitignored machinery; no new SQLite table). Persist explicit `projectId,projectVersionId`, accepted generation ids, base revisions, `baseStateSha256`, and each item's `expectedBaseContentHash`. `push` rejects a moved generation/revision or changed exact base row with `PLAN_STALE`.
6. **`render-cli.ts`** — exactly the SPEC 01 §5 format: summary line, `+ create` / `~ update` / `- delete` rows with slug + one-line description, `⚠ conflict` blocks with base/ours/theirs, orphan count trailer.
7. Replace the `sync.plan` RPC NOT_IMPLEMENTED stub: `sync.plan` now computes and returns the plan (paged if large); CLI `bb finite-state plan [surface]` renders it.

## Interface contract
```ts
// lanes/sync/plan/index.ts
import type { EntityKind } from "../../../lib/sync/registry";  // FROZEN

export type PlanOp = "create" | "update" | "delete" | "noop" | "conflict" | "orphan";
export interface FieldDiff { field: string; base: unknown; ours: unknown; theirs?: unknown; }
export interface PlanItem {
  kind: EntityKind; key: string; op: PlanOp;
  expectedBaseContentHash: string | null;      // null only for create/no prior base
  fields: FieldDiff[];                        // empty for create/delete/noop
  referrers?: string[];                       // populated on blocked deletes
  conflict?: { resolution: "unresolved" | "take-ours" | "take-theirs" | "edited";
               attribution?: { actor: string; at: string; source: string } }; // filled by WP-20
  error?: { code: string; message: string; file?: string; line?: number };    // validation failure
}
export interface Plan {
  planId: string;                             // ULID
  scope: { projectId: string; projectVersionId: string | null };
  baseGenerationIds: Record<string, string>;
  baseRevisions: Record<string, number>;
  baseStateSha256: string;
  createdAt: string;
  staleness: { asOf: string; degraded: boolean };
  items: PlanItem[];                          // in apply order (order.ts)
  summary: { creates: number; updates: number; deletes: number; noops: number;
             conflicts: number; orphans: number };
  requiresConfirmation: boolean;              // blast radius
  validationErrors: PlanItem[];               // subset of items with error set
}
export function computePlan(deps: EngineDeps, scope: SyncScope, kinds?: EntityKind[]): Promise<Plan>;
export function loadPlan(worktreeRoot: string, planId: string): Plan | null;

// lanes/sync/plan/validate.ts
export type Validator = (item: PlanItem, ctx: ValidateCtx) => PlanItem;      // returns item, possibly with error
export function registerValidator(kind: EntityKind, v: Validator): void;    // seam for L3/L4

// lanes/sync/plan/render-cli.ts
export function renderPlanCli(plan: Plan): string;   // SPEC 01 §5 format, byte-tested
```

## Acceptance criteria
- [ ] Fixture with 6 creates / 3 updates / 1 referenced delete / 2 both-sides edits yields the SPEC 01 §5 summary line verbatim: `Plan: 6 to create, 3 to update, 1 to delete, 2 conflicts` (delete carried as a blocked item with referrer list).
- [ ] Noop suppression: an entity identical on all three sides never appears as a write (op `noop`), because an identical re-PUT bumps timestamps server-side (SPEC 01 §5).
- [ ] Derived-field guard: a working-tree edit to `requirements.verification_status` produces a per-item validation error, not a push item.
- [ ] Ordering: create-with-dependency fixture applies parent before child; delete fixture reverses; a reference cycle is a validation error naming the cycle.
- [ ] Blast radius: 21 changed entities ⇒ `requiresConfirmation: true`; 20 ⇒ false; any delete ⇒ true.
- [ ] `NOT_AFFECTED` with null justification is rejected with the file/line of the offending YAML block.
- [ ] Plan never writes: `base_snapshot`, YAML, and the mock server's state are byte-identical before/after `computePlan` (asserted in test).
- [ ] The same entity keys in two projects/versions produce isolated plans. Null project-level scope maps through the reserved sentinel only inside storage and `"@project"` input is rejected.
- [ ] A sibling push that advances one base row increments only its kind revision and invalidates a plan with the old `baseStateSha256`; every unchanged item still carries and checks its own expected base hash.
- [ ] Offline degradation: with the mock unreachable, plan returns `staleness.degraded: true` and still renders.
- [ ] Green: typecheck/test/lint/build.

## Test plan
- `plan.test.ts` — `three-way classification matrix`, `plan is read-only`, `project/version isolation`, `generation+revision fence and per-item content hashes`, **`remote refresh under 429 exhaustion degrades to accepted stale base`**, **`connection reset leaves accepted base unchanged`**, `plan persists/reloads byte-identically`.
- `validate.test.ts` — `referential integrity lists referrers`, `derived-field guard per kind`, `VEX vocabulary enforced verbatim`, `needs_completion rejected with file/line` (**error path**), `registerValidator seam invoked for foreign kind`.
- `order.test.ts` — `creates topologically sorted`, `deletes reversed`, `cycle → validation error`.
- `render-cli.test.ts` — `SPEC 01 §5 fixture renders byte-identically`, incl. the conflict block with base/ours/theirs.

## Do not
- Write anything during plan — no base advance, no YAML rewrite, no server mutation. Read-only, always.
- Invent server preconditions for findings — there are none (RECON §2.8); detection is three-way comparison, period.
- Auto-resolve conflicts — WP-20 owns resolution; plan carries them unresolved.
- Add a plan table to SQLite — the schema is frozen; `.fs-sync/plan-<id>.json` is the persistence.
- Paraphrase the VEX enums — consume them from the frozen contract; values are RECON §2.6 verbatim.

## Open questions
1. The derived-field guard table is seeded from SPEC 01 §5's four examples. L4 will extend it via `registerValidator` — confirm with tech lead whether the seed list should also carry exploitability output field names once L4's entities land.
2. Plan paging over RPC for very large plans (>5k items): assumed `{items, total, cursor}` per the contract's paging convention; verify the frozen `sync.plan` signature supports a cursor.
