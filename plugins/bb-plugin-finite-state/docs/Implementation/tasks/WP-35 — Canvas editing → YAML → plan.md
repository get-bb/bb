# WP-35 — Canvas editing → YAML → plan

**Lane:** L4 Product Security · **Spec refs:** SPEC 03 §2.5–§2.7, §5.3–§5.5, §7–§8 · SPEC 01 plan/conflict model · RECON §2.8 · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-34, WP-18 · **Blocks:** Editable Product Security milestone
**Produces a FROZEN artifact:** no — replace the WP-31 editing stub; consume sync adapter/validator seams.

## Files you own
```
plugins/bb-plugin-finite-state/lanes/product-security/canvas/editing/index.tsx  # replaces stub
plugins/bb-plugin-finite-state/lanes/product-security/canvas/editing/{commands,history,forms,delete-impact}.tsx
plugins/bb-plugin-finite-state/lanes/product-security/canvas/editing/{schema,writer,adapters,validators}.ts
plugins/bb-plugin-finite-state/lanes/product-security/canvas/editing/*.test.tsx
```

## Files you must not touch
Registration, frozen registry/contract/schema/Forge types, sync plan/push code, canvas foundation/nodes/links/layout, other lanes, dependencies, or roots.

## Context
Canvas edits are authored semantic changes and therefore become deterministic YAML, then an ordinary read-only plan. They do not autosave to AS and agents cannot push. Layout changes remain in the separate never-pushed file from WP-34. Server UUIDs are ephemeral mapping handles; YAML references stable slugs. TARA writes are last-write-wins per row; the push layer later brackets them using recon-verified head/content semantics, while `begin_tara_trial` remains agents-API-only and unavailable to this plugin unless explicitly exposed.

## What to build
1. Implement create/edit/delete commands for components, zones, assets, dataflows, and threats using domain schemas and stable non-reused slugs. All semantic changes write their owned YAML via WP-15 CAS.
2. Separate position/collapse commands to WP-34's layout store. A drag never modifies architecture YAML or creates a plan item.
3. Implement local undo/redo as inverse CAS commands with bounded session history. External changes invalidate affected commands and require reload/compare.
4. Register VERSIONED entity adapters and validators through WP-17/WP-18 seams. Parse canonical YAML, strip the recon `tara_snapshot_semantic_payload` exclusion list, resolve slug references through `id_map`, and map per-verb API fields (especially dataflow and asset POST/PATCH mismatches).
5. Plan creates before dependencies and deletes in reverse. Reject unresolved references, invalid methodology vocabulary, derived/review fields, and edits to `verification_status`.
6. For delete, fetch/compute `DeletionImpact`, require `cascade|detach`, list affected refs, and add blast-radius/typed confirmation for non-restorable entity types. No server deletion occurs here.
7. Surface local changes immediately through watcher/realtime hints and route the user to the sync review panel for domain-rendered diff. Nothing in this package pushes.
8. Treat upstream conflict as base/ours/theirs field data; never put conflict markers into YAML or auto-merge same-field edits.
9. Support loading edit state, empty/new-model state, recoverable validation/CAS error, and unconfigured mode; use shared-ui/Hugeicons/theme tokens.

## Interface contract
```ts
export type CanvasEditCommand =
  | { kind: "create"; entity: ArchitectureYamlEntity }
  | { kind: "update"; entityKind: ArchitectureKind | "threat"; slug: string; patch: Record<string, unknown> }
  | { kind: "delete"; entityKind: ArchitectureKind | "threat"; slug: string; mode: "cascade" | "detach" };
export interface EditResult { file: string; operation: "create" | "update" | "delete"; slug: string; changedFields: string[]; beforeSha256: string | null; afterSha256: string | null; }
export interface DeletionImpact { slug: string; referrers: { kind: string; slug: string; effect: string }[]; allowedActions: ("cascade" | "detach")[]; restorable: boolean; }
export function applyCanvasCommand(deps: EditDeps, command: CanvasEditCommand, expectedSha256?: string): Promise<EditResult>;
```

## Acceptance criteria
- [ ] Component/zone/asset/dataflow/threat edits produce canonical YAML and plan items without server calls.
- [ ] Slug references resolve through `id_map`; UUIDs never appear in authored files.
- [ ] Dragging changes only `canvas.json` and produces zero semantic plan items.
- [ ] Derived/review fields, including `verification_status`, are plan-blocked.
- [ ] Dataflow/asset adapters map POST/PATCH field mismatches and have round-trip tests.
- [ ] Delete impact and allowed modes are shown before a plan; non-restorable deletes require typed confirmation later.
- [ ] Same-field conflicts remain unresolved and YAML remains valid.
- [ ] No agent or UI path bypasses plan/human push.

## Test plan
`canvas-editing.test.tsx`
- `create/edit YAML`, `slug reference plan`, `drag excluded`, `undo/redo`, `dataflow create→patch projection`, and `delete impact`.
- **Error path:** concurrent file edit causes CAS conflict, preserves external bytes, and invalidates undo for that entity.
- **Validation path:** attempted `verification_status`/review field and unresolved slug are rejected before plan.
- **Concurrency contract test:** generated push metadata carries the pulled TARA head/hash inputs; this WP does not call `begin_tara_trial` or checkpoint APIs.

## Do not
- Do not autosave to Forge/AS, call push, or add an agent push tool.
- Do not mix layout into semantic YAML or plan.
- Do not serialize UUIDs/server-owned/derived fields.
- Do not implement a client-side substitute for `begin_tara_trial`.
- Do not insert textual conflict markers into YAML.

## Open questions
1. Attack-path viability editing remains its own overlay and is not a canvas architecture command unless frozen registry/adapters already expose it.
2. True fenced trial apply requires platform exposure of `begin_tara_trial`; until then WP-40's head/hash checkpoint bracket is the honest limit.
