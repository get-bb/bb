# WP-21 — The review panel UI

**Lane:** L2 Sync · **Spec refs:** SPEC 01 §7 · SPEC 00 §7, §10 · RECON §1.3, §1.6, §1.11–§1.12 · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-18, WP-20, WP-07 · **Blocks:** human-approved Golden Loop push and G3
**Produces a FROZEN artifact:** no

## Files you own
`plugins/bb-plugin-finite-state/lanes/sync/register.app.tsx` *(replaces WP-01 stub; root already calls it)*
`plugins/bb-plugin-finite-state/lanes/sync/ui/SyncReviewPanel.tsx`
`plugins/bb-plugin-finite-state/lanes/sync/ui/PlanGroup.tsx`
`plugins/bb-plugin-finite-state/lanes/sync/ui/PlanRow.tsx`
`plugins/bb-plugin-finite-state/lanes/sync/ui/FieldDiff.tsx`
`plugins/bb-plugin-finite-state/lanes/sync/ui/ConflictResolution.tsx`
`plugins/bb-plugin-finite-state/lanes/sync/ui/BlastRadiusFooter.tsx`
`plugins/bb-plugin-finite-state/lanes/sync/ui/PushResults.tsx`
`plugins/bb-plugin-finite-state/lanes/sync/ui/PendingChangesChip.tsx`
`plugins/bb-plugin-finite-state/lanes/sync/ui/domain-renderers.tsx`
`plugins/bb-plugin-finite-state/lanes/sync/ui/*.test.tsx`

## Files you must not touch
`app.tsx`, `server.ts`, frozen interfaces, backend sync modules, other lanes/panel headers, fixtures, package/lock files. Export `PendingChangesChip` for other panel WPs; do not edit their headers from this WP.

## Context
This panel is the human gate and a core demo moment: the agent proposed changes, the human sees the exact semantic diff, resolves conflicts, and explicitly pushes. It lives at the existing `sync` nav route and is deep-linked from a shared pending-count chip. The panel reads/writes only through frozen RPC; frontend code cannot use `bb.sdk` or Forge.

Rows must show the domain object, not dump YAML. To avoid L2 importing every future lane directly, a frontend renderer registry lets each lane register an id-driven component from its existing `register.app.tsx`. A threat diff can therefore render `<ThreatCard id="THREAT-22"/>`; the fallback is a typed identity/field presentation, never raw YAML.

## What to build
1. Replace the sync frontend stub with one `navPanel` registration at path/id verified against WP-01 conventions. Render `SyncReviewPanel` for `/plugins/finite-state/sync/*`; support `plan/<id>`, optional surface filter, and run result subpaths via `subPath`.
2. Fetch current status/plan through `useRpc<typeof rpcContract>()`. All directive/attribute/subPath strings are untrusted: validate ids and filters before calls. Never accept plan payload from the URL.
3. Render collapsible groups in stable order: create, update, delete, conflict, orphan, noop (noop collapsed/hidden by default). Group headings carry count; large groups virtualize with TanStack Virtual.
4. A row shows operation, domain label/stable key, validation state, and concise change summary. Expanded content shows per-field base/ours/theirs and an id-driven registered domain component. Monospace identifiers, right-aligned numeric changes, semantic labels with color—not color alone.
5. Conflict rows render attribution, base/ours/theirs, suggested choice visibly labeled as a suggestion, and controls for take ours/take theirs/edit. Submit exact plan hash/version so stale actions fail cleanly; refetch after success.
6. Footer shows counts, affected surfaces, deletes/dependents, API-call estimate, TARA fence warning where relevant, and confirmation affordance. Single Push button is disabled if loading, stale, offline/unconfigured, conflicts unresolved, validation errors exist, or confirmation is required but unchecked.
7. Push calls human RPC only. Show progress from `fs-sync-push` as a refetch hint; final results list applied/failed/skipped per item and Retry sends only eligible failures through `sync.push.retry`. Never infer whole-run success from HTTP status.
8. Export `PendingChangesChip({scope,surface?})`. It fetches status summary, displays local/conflict count, and navigates with `useBbNavigate().toPluginPanel("sync",{subPath})`. Every surface WP imports this component into its header; demonstrate the contract in a test harness rather than editing other lanes.
9. Provide a domain renderer registry keyed by `EntityKind`; duplicate registration fails in development/test. Renderer props are `{id:string}` plus display mode only and self-fetch their data. Register a safe generic fallback.
10. Design all four states: skeleton loading, actionable empty (“No local changes”), recoverable error with retry, and unconfigured with connection guidance. Offline stale plans remain viewable with banner but cannot push until requirements from WP-19 are satisfied.
11. Use `@bb/shared-ui`, Hugeicons, bb/FSDS token classes, `usePortalScopeProps()` for portaled primitives, keyboard/focus semantics, and accessible announcements for progress/results. Lazy-load large domain/canvas renderers.

## Interface contract
```tsx
// lanes/sync/ui/domain-renderers.tsx
export interface DomainDiffRendererProps { id: string; mode: "compact" | "diff"; }
export type DomainDiffRenderer = React.ComponentType<DomainDiffRendererProps>;
export function registerDomainDiffRenderer(kind: EntityKind, renderer: DomainDiffRenderer): void;
export function DomainDiff({ kind, id }: { kind: EntityKind; id: string }): JSX.Element;

// lanes/sync/ui/PendingChangesChip.tsx
export interface PendingChangesChipProps {
  scope: { projectId: string; pvId: string | null };
  surface?: EntityKind | "all";
}
export function PendingChangesChip(props: PendingChangesChipProps): JSX.Element;
```

Renderer registration happens inside each lane's existing `registerXxxApp(app,ctx)` call; it does not amend `app.tsx`. If React Compiler/reload semantics make a module registry unsafe, use the current plugin-app context/composition pattern verified in the tasks plugin and file an amendment if context shape must change—do not keep host `app`/`bb` objects in module state.

## Acceptance criteria
- [ ] `/plugins/finite-state/sync` renders the plan grouped in the required stable order; 5k-item fixture remains responsive through virtualization.
- [ ] Expanded threat/requirement/VEX fixtures render registered domain components and semantic field diffs, never raw YAML.
- [ ] Every conflict shows base/ours/theirs, audit attribution/unavailable, suggestion label, and explicit resolution controls.
- [ ] Push is disabled for every unsafe state and enabled only for a green, current, confirmed plan.
- [ ] Post-push UI renders per-item partial results and retries failures only.
- [ ] Realtime payload is treated as a hint; panel refetches authoritative RPC state.
- [ ] Pending chip shows local/conflict count and navigates to the correct scoped review route.
- [ ] Loading, empty, error, unconfigured, stale/offline states are screenshot/component tested.
- [ ] No frontend import of `bb.sdk`, backend code, secrets, Forge, Lucide, emoji, or raw colors.
- [ ] Typecheck/test/lint/build is green.

## Test plan — `sync-review-human-gate`
- `group order/count/collapse and 5k virtualization`.
- `domain renderer receives id only`; unknown kind renders typed fallback; duplicate registration fails (**error path**).
- `conflict resolution suggestion is not pre-applied`; stale plan hash returns recoverable refetch state (**fault path**).
- Push-disable matrix: unresolved conflict, validation error, stale plan, unconfigured, confirmation unchecked, in-flight.
- `partial push renders applied/failed/skipped and retry sends failed ids only` (**partial-failure path**).
- `realtime hint triggers one debounced refetch, payload data ignored`.
- `pending chip deep link and accessible label`.
- Four-state snapshots and keyboard traversal/focus return for dialogs.

## Do not
- Do not put Push in an agent tool or make suggestion equal approval.
- Do not render YAML text or untrusted route/directive strings as content.
- Do not call any remote service, use `bb.sdk`, or carry large results over realtime.
- Do not edit all other panel headers; export the shared chip and make their WPs consume it.
- Do not import Lucide/use emoji/hard-code colors.
- Do not claim TARA push is atomic; show the honest bracket warning where applicable.

## Open questions
1. Confirm current `navPanel` registration property names and route composition from the fork before replacing the stub.
2. If domain lanes land after WP-21, decide whether their renderer-registration acceptance belongs to their WPs or a G3 integration checklist; L2 supplies and tests the seam.
3. Product copy for “API-call estimate” and the TARA residual-race warning needs design/legal review but must remain technically honest.
