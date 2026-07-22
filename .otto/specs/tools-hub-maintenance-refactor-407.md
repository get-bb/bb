---
id: tools-hub-maintenance-refactor-407
name: Tools Hub Maintenance Refactor
status: approved
created_date: 2026-07-22
description: Behavior-preserving module split of the Tools Hub collection infra, Skills registry/backend, and Tools UI into narrow, parallelizable seams.
---

# Tools Hub Maintenance Refactor

Split the three oversized Tools Hub files into narrow, single-concern modules **without changing any behavior**. The refactor is pure reorganization: same rendered UI, same routes, same APIs/CLI, same wire protocol, same experiment gating. The only observable delta is smaller files and clearer module boundaries.

Frozen behavior contract: merged **PR #845** (`337641bd07c4016b024a4a1769429f29a4a86764`) and the approved product spec [`tools-hub-resource-system-407.md`](./tools-hub-resource-system-407.md). Nothing here relaxes, extends, or reinterprets that contract.

> [!IMPORTANT]
> This is a maintenance refactor, not a feature. If a proposed move would change a rendered pixel, a route, a payload, a CLI surface, or an experiment path, it is out of scope. When in doubt, preserve.

## Goals / Non-Goals

| | |
| --- | --- |
| **Goal** | Break `resource-list.tsx` (2231 lines), `SkillsView.tsx` (1621), and `ToolsView.tsx` (1101) into concern-scoped modules behind stable public import paths. |
| **Goal** | Extract the tangled Skills **registry data client** out of the `SkillsView` view file; split the 976-line server route into route + proxy + parse layers. |
| **Goal** | Define ownership/dependency rules and four disjoint work packages that run in **separate worktrees** with no shared file. |
| **Goal** | Every checkpoint stays green: typecheck, real tests, and real stories pass after each package. |
| **Non-Goal** | Any product, UX, a11y, pagination, or responsive change. Behavior is frozen by PR #845. |
| **Non-Goal** | Any wire-protocol change. `HOST_DAEMON_PROTOCOL_VERSION` stays at **63**. |
| **Non-Goal** | New public API names, renamed exports, dependency upgrades, or "while I'm here" cleanups beyond the moves defined here. |
| **Non-Goal** | Touching the `toolsHub` experiment gate logic, legacy Settings fallback, or install/provenance semantics. |

## What Must Be Preserved

Every item below is verified against source, not assumed. These are the invariants each work package protects.

| Invariant | Anchor in the frozen contract |
| --- | --- |
| `toolsHub` experiment gating | `ToolsExperimentGate.tsx`, `settings-nav.tsx`, `AppLayout.tsx` route the same way when the flag is on/off. |
| Legacy Settings compatibility | Skills/Plugins/Automations still reachable via Settings when the experiment is off. |
| Rendered UX | Overview modules, focused tabs, rows, detail shell, and states render identically. |
| APIs / routes | `GET /skills-registry`, `/entry`, `/detail`, `POST /skills-registry/install` (registered by `registerSkillsRegistryRoutes` at `apps/server/src/server.ts:457`) behave identically. |
| CLI / SDK | `packages/sdk/src/areas/skills.ts` public surface (host list/delete skills) and any `bb` skills commands are byte-identical in behavior. |
| Accessibility | Hover row actions stay keyboard-focus reachable; menu/focus semantics unchanged. |
| Pagination / responsive | `RESOURCE_GRID_PAGE_SIZE = 12` (`packages/shared-ui/src/components/ui/resource-pagination.tsx`) and grid/responsive breakpoints unchanged. |
| Install / provenance | `registry-skill-provenance.ts` file format and `registry-skill-install.ts` semantics unchanged. |
| Wire compatibility | No session payload, WS message, or host RPC command/result field changes. Protocol version unchanged. |

## Current Dependency And Coupling Map

Three files carry too many concerns; the server route is oversized but service-backed and cleanly separable into parse/proxy/route layers. Consumers reach the shared UI through import specifiers that this refactor keeps stable.

| File | Lines | Concerns tangled today | Public surface |
| --- | ---: | --- | --- |
| `packages/shared-ui/src/components/ui/resource-list.tsx` | 2231 | **69 exports**: atoms, toolbar/menus, rows, detail shell/sections/controls, collection/overview scaffolds | Imported by ≥10 app + plugin files via `@bb/shared-ui/resource-list` |
| `apps/app/src/views/SkillsView.tsx` | 1621 | Registry **data client** (fetch/parse/install/format) **+** provider-filter helpers **+** Skills tab UI **+** overview **+** rows **+** detail | **21 exports** (manifest below); `ToolsView` imports `SkillsLibrary` |
| `apps/app/src/views/ToolsView.tsx` | 1101 | Tools router **+** plugin capability rendering **+** plugin detail **+** automations tool view | **3 exports**: `ToolsScrollPage`, `PluginDetail`, `ToolsView` |
| `apps/server/src/routes/skills-registry.ts` | 976 | Route registration **+** HTML/JSON parsers **+** registry proxy/fetch/hydrate **+** id/url/pagination helpers | Registered via `registerSkillsRegistryRoutes` (imported at `server.ts:26`) |

Coupling directions today (all preserved):

```
app + plugin consumers ── import "@bb/shared-ui/resource-list" (barrel) ──► resource/* submodules

apps/app/src/views/ToolsView.tsx ── imports SkillsLibrary ──► apps/app/src/views/SkillsView.tsx
                                                                   │ (data client extracted, re-exported)
                                                                   ▼
                                              apps/app/src/lib/skills-registry.ts ── fetch() HTTP ─┐
                                                                                                   ▼
server.ts:457 registerSkillsRegistryRoutes ─► routes/skills-registry.ts ─► registry-proxy.ts ─► registry-parse.ts

packages/sdk/src/areas/skills.ts ── host list/delete skills (independent of the registry HTTP route)
```

> [!NOTE]
> The lone cross-view edge — `ToolsView.tsx` importing `SkillsLibrary` from `./SkillsView` — is the only coupling that spans two app work packages. The ownership rule below pins the full 21-name `SkillsView` surface as a frozen barrel so the two worktrees never touch the same file. The SDK skills area is **independent** of the registry HTTP route; it is fenced read-only, not part of the route split.

## Target Modules And Narrow APIs

The strategy is identical for each oversized file: **the original path becomes a thin re-export barrel** so every existing import specifier stays byte-identical, and concerns move into sibling submodules. Zero consumer churn is what makes the packages independently green and parallelizable.

### Seam A — Shared Collection Infrastructure

Convert `resource-list.tsx` into a barrel over a new `resource/` directory. Dependency layering is strictly one-way: **atoms ← toolbar ← detail-shell ← detail-sections/detail-controls ← collection**, with **row parallel to toolbar on atoms only**. `ResourcePropertyList` lives in the detail layer, not atoms.

Exhaustive 69-export manifest by target module:

| Target module | Depends on | Public exports it owns |
| --- | --- | --- |
| `resource/atoms.tsx` (~200) | — | `ResourceStatusTone`, `RESOURCE_ROUTE_LABEL_EVENT`, `useResourceRouteLabel`, `ResourceState`, `ResourceStatus`, `ResourceMeta`, `ResourceLocationMeta`, `ResourceCardStat` |
| `resource/toolbar.tsx` (~400) | atoms | `ResourceToolbar`, `ResourceTabDescription`, `ResourceOption`, `ResourceOptionMenu`, `ResourceMultiSelectMenu`, `ResourceSortMenu`, `ResourceToolbarAction`, `ResourceCreateTemplate`, `ResourceCreateMenuAction`, `ResourceCreateButton` |
| `resource/row.tsx` (~450) | atoms | `ResourceOverflowMenuItem`, `ResourceOverflowMenu`, `ResourceActionButton`, `ResourceRow`, `ResourceRowDetailChevron`, `ResourceListPanel`, `ResourceListState` |
| `resource/detail-shell.tsx` (~400) | toolbar, atoms | `ResourceDetailSurface`, `ResourceDetailPanel`, `ResourcePromptContextItem`, `ResourcePromptPreview`, `ResourceDetailList`, `ResourceDetailCollection`, `ResourceDetailListItem`, `ResourceDetailActionRow`, `ResourcePropertyList`, `ResourceProperty`, `ResourceDetailStack`, `ResourcePromptEditor`, `ResourceSection`, `ResourceSectionTitle`, `ResourceOverview` |
| `resource/detail-sections.tsx` (~250) | detail-shell | `ResourceDetailSectionKind`, `ResourceDetailSectionProps`, `ResourceDetailSection`, `ResourceDetailOverviewSection`, `ResourceDefinitionSection`, `ResourceDetailConfigurationSection`, `ResourceDetailReleaseSection`, `ResourceDetailIncludesSection`, `ResourceActivitySection`, `ResourceDetailPage` |
| `resource/detail-controls.tsx` (~250) | detail-shell, atoms | `ResourceDetailFacts`, `ResourceDetailFact`, `ResourceLifecycleStatus`, `ResourceInstallControl`, `ResourceInstalledControl` |
| `resource/collection.tsx` (~550, raised) | detail, toolbar, atoms | `ResourceCollectionMode`, `ResourceCollectionPage`, `ResourceCollectionViewport`, `ResourceOverviewSection`, `ResourceBrowseGrid`, `ResourceBrowseSectionItem`, `ResourceBrowseSection`, `ResourceOverviewPage`, `ResourceSourceShelf`, `ResourceShelfAction`, `ResourceShelfSeeAllAction`, `ResourceSourceItem`, `ResourceBrowseCard`, `ResourceTemplateBrowseCard` |
| `resource-list.tsx` (kept, ~15) | all submodules | **Barrel only**: `export * from "./resource/atoms"` … `./collection`. Nothing else. |

Count: 8 + 10 + 7 + 15 + 10 + 5 + 14 = **69**, matching the current surface exactly.

> [!WARNING]
> These internals are **not** in the 69-export surface and must **stay private**, colocated with their sole consumers — never newly exported: `targetsResourceAction` (with `ResourceRow` in `row.tsx`), `ResourceMenuTrigger` and `ResourceOptionContent` (with the menus in `toolbar.tsx`), `ResourceBrowseCardProps` (with `ResourceBrowseCard` in `collection.tsx`).

### Seam B — Skills Registry / Backend

Frontend data client pulled out of the view; server route split into three layers with a one-way **route → proxy → parse** dependency. No behavior crosses the server/daemon boundary.

| Target module | Owns | Notes |
| --- | --- | --- |
| `apps/app/src/lib/skills-registry.ts` (new) | `RegistrySkill*` types, `parseRegistrySkill(s)`, `fetchRegistrySkills`, `fetchRegistrySkillDetail`, `fetchRegistrySkillEntry`, `installRegistrySkill`, `normalizeSkillName`, `resolveInstalledRegistrySkill`, `formatRegistrySource`, `formatInstallCount`, and `REGISTRY_PAGE_SIZE` (= `RESOURCE_GRID_PAGE_SIZE`) | Pure data/format layer. **No React imports.** `SkillsView` re-exports every name from here. |
| `apps/app/src/lib/skills-filters.ts` (new) | `ResourceProviderFilter`, `ResourceSortMode`, `ResourceSortDirection`, `RESOURCE_PROVIDER_FILTERS`, `providerLabel`, `skillProviderFilterId`, `providerFilterLabel`, `compareNullableProvider`, `applySortDirection` | Pure `SkillSummary` sort/filter helpers, currently internal to `SkillsView`. **No React imports.** Consumed by the Skills tab UI. |
| `apps/server/src/routes/skills-registry.ts` (slimmed, ~120) | `registerSkillsRegistryRoutes` and its four handlers + request validation only | Calls into proxy. Route stays registered from `server.ts:457`. |
| `apps/server/src/services/skills/registry-proxy.ts` (new) | Fetch/hydrate: `registryFetch`, `fetchRegistryJson`, `fetchAuthenticatedRegistryDetail`, `fetchGithubSkillMarkdown`, `fetchPublicSkillMarkdown`, `fetchGithubSkillPaths`, `fetchRegistrySkillDetail`, `fetchPublicDirectorySkills`, `hydrateDetails`, `fetchGithubStars`, `hydrateGithubStars`, `mapWithConcurrency`, `filterSkillsWithLoadableDetails`, `listRegistrySkills`, `resolveRegistrySkillById` | Depends only on `registry-parse.ts`. Server-owned product policy stays server-side. |
| `apps/server/src/services/skills/registry-parse.ts` (new) | Pure parse/id/url: `isRecord`, `decodeHtml`, `stripTags`, `renderedSkillHtmlToMarkdown`, `extractFirstDivContentsAfter`, `parsePublicSkillMarkdown`, `parsePublicHomepageSkills`, `parsePublicDetail`, `parsePublicDetailSkill`, `isApiSkill`, `parseRegistryDetailFiles`, `hasLoadableSkillContent`, `githubRepoForSource`, `parseRegistrySkillId`, `packageRefForSource`, `registrySkillUrl`, `parsePageParameter`, `parsePerPageParameter` | No I/O; deterministic. Directly unit-testable. |
| `packages/sdk/src/areas/skills.ts` (untouched) | Existing SDK skills surface | **Frozen.** Independent of the registry route; listed only to fence WP4's boundary. |

> [!IMPORTANT]
> `registry-skill-provenance.ts`, `registry-skill-install.ts`, and `injected-skills.ts` semantics are frozen. WP4 relocates helpers into `registry-parse.ts`/`registry-proxy.ts` but must not change the provenance file format, install flow, or listing output.

### Seam C — Tools UI

Slim both view files to routers; move rendering clusters to concern modules under `components/tools/`. Both view files keep their **exact** public surface as barrels.

| Target module | Owns | Notes |
| --- | --- | --- |
| `apps/app/src/views/ToolsView.tsx` (slimmed) | `ToolsView` router, `ToolsScrollPage`, `PluginDetail` re-export, plus internal `ToolsSectionBody`, `PluginsToolView`, `PluginDetailToolView`, `AutomationsToolView` wiring | Keeps its **3 exports** exactly: `ToolsScrollPage`, `PluginDetail`, `ToolsView`. |
| `apps/app/src/components/tools/PluginCapabilities.tsx` (new) | `PluginCapabilityGroup`, `PluginIncludes`, `PluginActivity`, `PluginActivityState`, `capabilityDetail`, `namedSurface`, `pluginAppSurfaceItems` | Presentational plugin-detail internals (all currently private in `ToolsView`). |
| `apps/app/src/views/SkillsView.tsx` (slimmed barrel) | The router `SkillsView`, `SkillsLibrary`, `SkillsOverview`, and re-exports of the full 21-name surface | Data client → `lib/skills-registry.ts`; provider filters → `lib/skills-filters.ts`; browse UI → `SkillsBrowse.tsx`. |
| `apps/app/src/components/tools/SkillsBrowse.tsx` (new) | `RegistrySkillsBrowsePage`, `RegistrySkillDetailView`, and browse-specific internals (`RegistrySkillSocialProof`, `RegistrySkillSourceItem`, `SkillsShAttributionLink`) | Skills discovery UI, consuming the Seam B client. |

Exhaustive frozen 21-name `SkillsView` surface (re-exported from the barrel; no rename, no dropped name):

| # | Name | Kind | Defined in (after refactor) |
| ---: | --- | --- | --- |
| 1–5 | `RegistrySkill`, `RegistryPagination`, `RegistrySkillsPage`, `RegistrySkillFile`, `RegistrySkillDetail` | types | `lib/skills-registry.ts` |
| 6–9 | `fetchRegistrySkills`, `fetchRegistrySkillDetail`, `fetchRegistrySkillEntry`, `installRegistrySkill` | fns | `lib/skills-registry.ts` |
| 10–13 | `normalizeSkillName`, `resolveInstalledRegistrySkill`, `formatRegistrySource`, `formatInstallCount` | fns | `lib/skills-registry.ts` |
| 14 | `ProviderLogo` | component | `SkillsView.tsx` |
| 15 | `RegistrySkillsBrowsePage` | component | `components/tools/SkillsBrowse.tsx` |
| 16–17 | `SkillsOverviewProps`, `SkillsOverview` | type + component | `SkillsView.tsx` |
| 18–19 | `SkillDetailDialogViewProps`, `SkillDetailDialogView` | type + component | `SkillsView.tsx` |
| 20–21 | `SkillsLibrary`, `SkillsView` | components | `SkillsView.tsx` |

## Ownership And Dependency Rules

1. **Barrels are the only public entry.** Original paths (`resource-list.tsx`, `SkillsView.tsx`, `ToolsView.tsx`) keep their exact export surface — 69, 21, and 3 names respectively. Consumers never learn the new submodule paths.
2. **Dependency direction is one-way.** Seam A: atoms ← toolbar/row ← detail-shell ← detail-sections/controls ← collection. Seam B/C: shared-ui → app data client (`lib/skills-registry.ts`, `lib/skills-filters.ts`, no React) → Skills/Tools UI. Server layers: route → proxy → parse. Server/SDK are independent of app code.
3. **No new cross-package edges.** A submodule may only import from within its own package plus the same specifiers its origin file already used.
4. **Server owns product policy; daemon owns host primitives.** Seam B keeps that boundary exactly.
5. **One concern per module; private stays private.** The four internals named in Seam A are never exported. No new exported name appears outside a barrel.

## File-Size And Complexity Guardrails

Pragmatic, not dogmatic — single-concern modules matter more than a number, and caps are set to be **achievable** given the current cluster sizes.

| Guardrail | Target | Enforcement |
| --- | --- | --- |
| Module length | Per-module caps in the Seam A/B tables (detail split three ways; collection raised to ~550) | Reviewer check; no lint rule added. |
| Concerns per module | 1 cluster from the target tables | Review against this spec. |
| Barrel files | Re-exports only, no logic | `resource-list.tsx`, `SkillsView.tsx`, `ToolsView.tsx` diffs show only re-exports + kept router. |
| New public API | **None** — 69 / 21 / 3 surfaces are exact | Any new exported name outside a barrel is a defect. |
| Cyclomatic growth | None — moves only, no rewrites | Diff is relocation + import fixups. |

> [!WARNING]
> Do not "improve" moved code. Renaming a local, tightening a type, or reordering a prop is a behavior-risk and a merge-conflict source across worktrees. Move verbatim; land improvements in a separate follow-up PR.

## Behavior-Preserving Migration Sequence

Each step ends on a real green checkpoint. Steps within a work package are sequential; the four packages run in parallel worktrees.

| Step | Action | Green checkpoint |
| --- | --- | --- |
| 1 | Seam A: create `resource/` submodules per the 69-export manifest, move verbatim, reduce `resource-list.tsx` to a barrel. | `turbo run typecheck --filter=@bb/shared-ui` **and** `--filter=@bb/app` (all consumers); `ToolsResourceSystem.stories.tsx` + `ToolsStateGalleries.stories.tsx` still register and render. |
| 2 | Seam B backend: extract `registry-parse.ts`, then `registry-proxy.ts` (proxy → parse), slim route to ~120 lines. | `turbo run typecheck --filter=@bb/server`; new `registry-parse.test.ts` passes; existing `skill-listing`/`registry-skill-install` service tests still pass. |
| 3 | Seam B frontend: create `lib/skills-registry.ts` + `lib/skills-filters.ts`, repoint `SkillsView`. | `turbo run typecheck --filter=@bb/app`; new `skills-registry.test.ts` passes; `SkillsView.test.tsx` passes. |
| 4 | Seam C Skills: extract `SkillsBrowse.tsx`; reduce `SkillsView.tsx` to router + 21-name barrel. | App typecheck; Skills stories + `SkillsView.test.tsx` pass. |
| 5 | Seam C Tools: extract `PluginCapabilities.tsx`; reduce `ToolsView.tsx` to router + 3-name surface. | App typecheck; `ToolsView.plugin-detail.test.tsx` + `ToolsResourceSystem`/`ToolsStateGalleries` stories pass. |
| 6 | Integration: full `@bb/shared-ui` + `@bb/app` + `@bb/server` + `@bb/sdk` typecheck; lint; story-registry check. | All typechecks + lint green; **empty wire diff** (gate below). |

Wire-compatibility gate at step 6: `git diff` on `packages/host-daemon-contract/` and any session/WS/RPC payload type must be **empty**. If not, the change exceeded scope — stop and bump `HOST_DAEMON_PROTOCOL_VERSION` per repo policy, or revert the offending move.

## Test And Story Migration

Tests and stories move with the code they cover; assertions do not change. New tests are **required** where pure functions move into fresh modules — the existing service tests do **not** cover the registry route or the moved parsers.

| Coverage | Where | Rule |
| --- | --- | --- |
| `ToolsResourceSystem.stories.tsx`, `ToolsStateGalleries.stories.tsx` | Stay in `apps/app`; import shipped components via the `@bb/shared-ui/resource-list` barrel | Story registry must still list every current story; this is Seam A's render gate (there is no separate shared-ui resource test/story to lean on). |
| `SkillsView.test.tsx` | Stays; imports unchanged (21-name barrel preserved) | Same cases, same expectations. |
| `ToolsView.plugin-detail.test.tsx` | Stays; `PluginDetail` still exported from `ToolsView` | No change. |
| **New** `apps/app/src/lib/skills-registry.test.ts` | New | Pure tests for moved client functions: `parseRegistrySkill(s)`, `resolveInstalledRegistrySkill`, `normalizeSkillName`, `formatRegistrySource`, `formatInstallCount`, and `REGISTRY_PAGE_SIZE` wiring. |
| **New** `apps/server/test/skills/registry-parse.test.ts` | New | Pure tests for moved parse/id/url/pagination: `parseRegistrySkillId`, `registrySkillUrl`, `parsePageParameter`, `parsePerPageParameter`, `parsePublicHomepageSkills`/`parsePublicDetail` on representative fixtures. |
| Optional route HTTP test | `apps/server/test/skills/` | If a handler's request validation is non-trivially moved, add a focused HTTP test for `GET /skills-registry` + `POST /install`; do **not** claim `skill-listing`/`registry-skill-install` service tests cover the route. |
| `skill-listing.test.ts`, `registry-skill-install.test.ts`, `injected-skills.test.ts` | Stay; re-point imports where a helper moved into `registry-parse.ts` | These cover the listing/install **services**, not the registry route. |

## Parallel Work Packages

Four packages with **disjoint file ownership**, each suitable for its own worktree. The only inter-package contract is the frozen public surface — no two packages edit the same file.

| WP | Owns (exclusive files/dirs) | Depends on | Worktree-safe because |
| --- | --- | --- | --- |
| **WP1 — Shared collection infra** | `packages/shared-ui/src/components/ui/resource-list.tsx` + new `resource/` (7 submodules) | none | Only package's own file touched; public barrel path unchanged. |
| **WP2 — Skills registry client + Skills UI** | `apps/app/src/views/SkillsView.tsx`, new `lib/skills-registry.ts`, `lib/skills-filters.ts`, `components/tools/SkillsBrowse.tsx`, `SkillDetailView.tsx`, `SkillsView.test.tsx`, new `skills-registry.test.ts` | WP1 barrel (path stable) | Consumes WP1 via unchanged specifier; publishes the frozen 21-name surface for WP3. |
| **WP3 — Tools UI shell + plugins** | `apps/app/src/views/ToolsView.tsx`, `components/tools/PluginDetailView.tsx`, new `PluginCapabilities.tsx`, `ToolsView.plugin-detail.test.tsx`, Tools stories | WP1 barrel; WP2 21-name surface | Never edits `SkillsView.tsx`; imports only its frozen public exports. |
| **WP4 — Skills backend + SDK fence** | `apps/server/src/routes/skills-registry.ts`, new `services/skills/registry-proxy.ts`, `registry-parse.ts`, `apps/server/test/skills/*`, (`packages/sdk/src/areas/skills.ts` read-only) | none | No app or shared-ui files; server/daemon boundary untouched. |

> [!NOTE]
> WP2 and WP3 both live in `apps/app` but own **disjoint files**. Resolved sequencing: **WP2 lands before WP3** (or at minimum publishes the frozen 21-name surface first) so WP3's import of `SkillsLibrary` never breaks.

## Risks And Mitigations

| Risk | Severity | Mitigation |
| --- | :---: | --- |
| A "verbatim" move silently changes behavior (reordered effects, dropped memo) | 🔴 | Move whole functions unchanged; diff is relocation + import fixups only; existing tests/stories gate each step. |
| Accidental wire-payload change while slimming the server route | 🔴 | Step-6 gate: empty diff on host-daemon-contract and payload types; protocol version stays 63. |
| WP2/WP3 collide on `apps/app` files | 🟠 | Disjoint file ownership + frozen 21-name surface; WP2 publishes surface first. |
| Barrel re-export misses a name, breaking a consumer | 🟠 | `export *` from every submodule; typecheck all consumers (`@bb/app`) at step 1; 69/21/3 counts asserted. |
| Circular import between new submodules | 🟡 | One-way layering (atoms ← toolbar/row ← detail ← collection; route → proxy → parse). |
| Moved parsers lose coverage | 🟡 | Required new `registry-parse.test.ts` and `skills-registry.test.ts`; no reliance on service tests for the route. |

## Acceptance Criteria

- `resource-list.tsx`, `SkillsView.tsx`, and `ToolsView.tsx` are each reduced to a router/barrel; concerns move into the target modules named above.
- Public surfaces are **exact and unchanged**: 69 names from `@bb/shared-ui/resource-list`, the 21-name `SkillsView` surface, and the 3-name `ToolsView` surface (`ToolsScrollPage`, `PluginDetail`, `ToolsView`) all resolve identically.
- Seam A layering holds: atoms ← toolbar/row ← detail-shell ← detail-sections/detail-controls ← collection; `ResourcePropertyList` is in the detail layer; `targetsResourceAction`, `ResourceMenuTrigger`, `ResourceOptionContent`, and `ResourceBrowseCardProps` remain private with their consumers.
- The Skills registry data client lives in `lib/skills-registry.ts` (incl. `REGISTRY_PAGE_SIZE`) and provider-filter helpers in `lib/skills-filters.ts`, both with **no React imports**; `SkillsView` re-exports the client names.
- The server route is split into `registry-parse.ts` and `registry-proxy.ts` (proxy → parse) with the route file at ~120 lines, still registered from `server.ts:457`; no product policy crosses the server/daemon boundary.
- New pure tests exist and pass: `registry-parse.test.ts` (parser/id/url/pagination) and `skills-registry.test.ts` (client parse/format); no claim that `skill-listing`/`registry-skill-install` tests cover the route.
- `toolsHub` gating, legacy Settings fallback, rendered UX, routes, SDK/CLI surfaces, a11y focus behavior, `RESOURCE_GRID_PAGE_SIZE`, and responsive breakpoints are unchanged; install/provenance semantics are byte-for-behavior identical.
- Wire compatibility holds: no diff to host-daemon-contract or any session/WS/RPC payload; `HOST_DAEMON_PROTOCOL_VERSION` stays 63.
- Full `turbo run typecheck` passes for `@bb/shared-ui`, `@bb/app`, `@bb/server`, and `@bb/sdk`; lint is clean; `ToolsResourceSystem`/`ToolsStateGalleries` stories and all listed tests pass.
- Each work package is independently green at its checkpoint and buildable in an isolated worktree.
