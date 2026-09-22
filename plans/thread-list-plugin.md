# Sidebar thread list as a first-party plugin

## Goal

Move bb's built-in sidebar thread list out of `apps/app` and into a bundled
first-party plugin that registers `app.slots.experimental_threadList`. The
plugin must reproduce the current list feature for feature: Pinned and Threads
sections, named collapsible sections, nested child threads, environment and
machine grouping, drag-and-drop, inline rename, the organize/sort menu,
hide-from-list, windowing, keyboard shortcuts, and mobile behavior.

Every capability the built-in list needs that a third-party list could not
reach today becomes public plugin API, so a third party could build the same
list. The plugin uses only `@get-bb/plugin-sdk/app`, `@bb/shared-ui`, and
bundled workspace packages, never `@/` app internals.

## Decisions taken (2026-09-21)

- Sections get first-class read API: the section list rides on the sidebar
  threads state. Section CRUD and thread moves are bb SDK calls (they already
  have routes, CLI commands, and realtime fan-out), made from the plugin
  frontend through the per-plugin client from `useSdk()` (1g) rather than
  wrapped one by
  one as host actions.
- Organization state (organization mode, sort, section orders, hidden groups,
  collapsed ids) moves off the closed `sidebar.*` UI preference enum and onto
  the plugin's own KV storage, reached from the frontend through the plugin's
  RPC and kept live across clients with `bb.realtime`. No new preference API.
- The `PluginSidebarThread` DTO stays a curated copy of `ThreadListEntry`, and
  the missing columns are added rather than exposing the internal row type.
- Data layer stays on React Query (decision 2026-09-21 after evaluating
  TanStack DB). The plugin hooks wrap the existing sidebar navigation query.
  A store move, if it ever happens, lands underneath the same hook contract.
- Performance gate: the plugin list must match the built-in list. Each Phase 3
  slice that touches rendering carries the benchmark described in Phase 5,
  and the flip in Phase 4 requires parity within noise.

## Current state

- Slot, arbitration, crash fallback, and the Settings → Appearance picker
  exist: `apps/app/src/components/sidebar/PluginThreadList.tsx`,
  `threadListProvider.ts`, `apps/app/src/lib/plugin-replacement-preference.ts`,
  `apps/app/src/components/settings/SidebarThreadListSetting.tsx`.
- Contract: `packages/plugin-sdk/src/app-contract.ts` (`PluginThreadListProps`
  at 185, `PluginSidebarThread` at 889, `PluginSidebarThreadActions` at 1065,
  the four sidebar hooks at 2723-2751). Host implementations in
  `apps/app/src/lib/plugin-sidebar-hooks.ts`, `plugin-sidebar-threads.ts`,
  `plugin-sidebar-split.ts`.
- Only registrants are the `examples/plugins/replacement-lab-*` fixtures.
- The built-in list is ~25k lines under `apps/app/src/components/sidebar/`
  with the grouping engine already in `packages/client-core/src/sidebar/` and
  `packages/client-core/src/thread/thread-activity.ts`.
- Sections already have server routes (`POST/PATCH/DELETE /thread-sections`),
  an SDK area (`packages/sdk/src/areas/thread-sections.ts`), and mutations
  (`apps/app/src/hooks/mutations/thread-section-mutations.ts`).
- Bundled plugins cannot be marked non-disableable today; nothing in
  `apps/server/src/services/plugins/` protects a plugin from disable or
  uninstall.

## Phase 0: no fallback list, a loading state

Owner decision (2026-09-21): the built-in list is deleted outright. There is
no second list kept around for crashes or a disabled plugin.

`PluginReplacementSlot` currently renders `original` (bb's list) when no
provider is registered, when the pinned provider is unavailable, and when a
plugin crashes. For the thread-list slot `original` becomes a host-owned
`ThreadListPlaceholder` with three states:

- **loading**: plugin frontends are still being fetched and no thread-list
  provider has registered yet. Renders the same row skeleton the built-in
  list shows today while `useUiPreferencesReady()` is false.
- **missing**: loading finished and no provider exists (plugin disabled or
  uninstalled). Renders a short message and a button that opens
  Settings → Plugins.
- **crashed**: the active provider threw. Renders the message, a "Reload"
  action that re-mounts the slot, and the existing toast stays.

The placeholder is not a list: no rows, no actions. This deletes the
`Original` delegation feature for third-party lists in its current meaning;
`Original` resolves to the bundled first-party list when it is present and
to the placeholder otherwise, and the guide says so.

Because the list is now a plugin, cold-start timing matters more than before.
Plugin bundles load after boot (`apps/app/src/lib/plugin-frontend.ts`: the
plugins list request, then dynamic imports with concurrency 3, smallest
first), so every cold load shows the placeholder until the bundle lands.
Decided 2026-09-21: the app does not compile the plugin into itself. A
compiled-in path was built and then dropped because it duplicated the
loader for one plugin; the placeholder is the mitigation. The existing
`usePluginFrontendsSettled` hook in `plugin-frontend-boot-state.ts` (light,
no runtime imports) tells the placeholder "still loading" from "no thread
list plugin is enabled" once the deferred boot settles. Nothing in the
sidebar may import `lib/plugin-frontend.ts` statically: it carries the
plugin runtime shims and would pull the on-demand vendors into boot.

## Phase 1: plugin API additions

Owner decision (2026-09-21): these members ship without the `experimental_`
prefix, as stable API. AGENTS.md normally requires the prefix plus a
`docs/api_to_audit.md` entry for every new public plugin API member; that
rule is waived for this batch, so instead of audit entries each member gets
its Plugin Guide documentation on arrival (`frontend-registration.md`,
`frontend-hooks-and-ui.md`) and a row in
`packages/plugin-api-map/src/surfaces.ts` under the `thread-list` surface.
The existing `experimental_threadList` slot and the four existing sidebar
hooks keep their prefixes until their own audits close. Each new member
ships with a fake in `packages/plugin-sdk/src/testing/app.tsx` so
`renderSlot` covers it.

### 1a. DTO columns (`PluginSidebarThread`)

Add to the contract and to `toPluginSidebarThread` in
`apps/app/src/lib/plugin-sidebar-threads.ts`:

| Field | Source on `ThreadListEntry` | Why the list needs it |
|---|---|---|
| `status` | `status` | active-first ordering in `compareStandardThreads` |
| `runtimeStatus` | `runtime.displayStatus` | provisioning, host-reconnecting, waiting-for-host glyphs |
| `isHidden` | `visibility === "hidden"` | `isSidebarProjectThread` filtering |
| `pinSortKey` | `pinSortKey` | manual pinned order |
| `queuedWork` | `queuedWork` | queued-waiting and queued-failed indicators; stop mapping them to `none` |
| `environment.isWorktree` | `environmentIsWorktree` | by-environment grouping |
| `environment.path` | `environmentPath` | environment header tooltip and display name |
| `lifecycleOwnerThreadId` | `lifecycleOwnerThreadId` | tree edge cases |
| `sourceThreadId` | `sourceThreadId` | fork provenance |

Add `"queued-waiting"` and `"queued-failed"` to
`PluginSidebarThreadIndicator` and stop coercing them in the mapper. Update
the mapper test and the DTO scope item in the audit entry.

### 1b. Sections on the threads state

`PluginSidebarThreadsState.sections: readonly PluginSidebarSection[]` where
`PluginSidebarSection = { id, name, createdAt, updatedAt }`. Source is
`data.sections` from the same `useSidebarNavigation()` query, so no extra
request. Memoize per section object like threads.

### 1c. Mutations go through the bb SDK, not new host actions

Every mutation the list performs is already a public API call with a CLI
command and realtime fan-out, so the host does not need to wrap it:

| Operation | SDK call | CLI |
|---|---|---|
| create, rename, delete section | `threadSections.create/update/delete` | `bb thread section create/update/delete` |
| move to section, nest, detach | `threads.update({ sectionId, parentThreadId })` | `bb thread update` |
| pin, unpin, reorder pinned | `threads.pin/unpin/reorderPinned` | `bb thread pin ...` |
| unarchive | `threads.unarchive` | `bb thread unarchive` |
| rename environment, archive its threads | `environments.update/archiveThreads` | `bb environment ...` |

`apps/server/src/routes/thread-sections.ts` passes the realtime hub into every
section mutation, and thread updates fan out on the thread list channel, so
the host's `useSidebarNavigation` query refreshes on its own. A section made
from the CLI already appears live in the sidebar today.

Plugin frontends can already make those calls. Plugin bundles run on the app
origin, so a plain `fetch("/api/v1/...")` carries the user's session;
`plugins/plugin-api-docs/app.tsx` and `plugins/inline-vis/app.tsx` do this
today. The app-surface header is optional: `apps/server/src/request-context.ts`
defaults a missing header to the `api` surface, which only affects telemetry.

What is missing is a typed client. `@bb/sdk/browser` (`createBrowserBbSdk`,
used by `apps/app/src/lib/sdk.ts`) is workspace-private and not in the runtime
shims, so third parties would hand-roll fetch calls, and the guide currently
steers plugins toward a server-side RPC proxy into `bb.sdk`.

`@bb/sdk` is not published to npm and does not need to be. The backend
already hands third parties `bb.sdk` by injecting the host's instance and
inlining the `BbSdk` declarations into the published bundled types
(`packages/plugin-sdk/scripts/build-bundled-dts.mjs`). The frontend uses the
same mechanism; see 1g. The first-party plugin uses 1g rather than bundling
`@bb/sdk`, so it exercises the public path.

What stays on `PluginSidebarThreadActions`, because it touches client-only
state:

- `open` (route, split placement, and the secondary-panel
  `setConversationCollapsed(false)` side effect from `ThreadRow.tsx:281-283`,
  which moves into it)
- `openNewThread`, extended with `sectionId` and `environmentId`, since today
  those ride on router state from `ProjectList.tsx:1492-1519`
- `archive` (closes panes and repairs the route)
- `requestDelete` (host confirmation dialog)

`setPinned`, `setRead`, `rename`, and `archive` stay on the actions object
and remain optimistic through the host cache owners. If measurement shows the
SDK path is visibly slower for moves, add `moveToSection`, `setParent`, and
`reorderPinned` beside them rather than reimplementing optimism in the
plugin.

Optimistic updates change shape. The built-in mutations in
`apps/app/src/hooks/mutations/thread-state-mutations.ts` patch the query cache
before the request returns; an SDK call from the plugin relies on the
realtime roundtrip instead. `useSectionThreadDnd` already gates its drop
highlight on the cache reflecting the move (`hasDropDecisionLanded`), so drag
and drop tolerates that. Rename and collapse are plugin-local state and stay
instant. Measure the pin and move latency on the local QA launcher before
accepting; if it is visible, the plugin can keep a short-lived local override
per thread id that clears when the DTO catches up.

### 1d. Per-row hooks

| Hook | Returns | Host source |
|---|---|---|
| `useSidebarThreadDraft(threadId)` | `{ hasUnsubmittedDraft: boolean }` | `usePromptDraftHasInput` in `apps/app/src/hooks/usePromptDraftStorage.ts` |
| `useSidebarThreadDraftIds()` | `ReadonlySet<string>` of thread ids with drafts | `usePromptDraftInputThreadIds`, for collapsed-section rollups |
| `useSidebarThreadRowStatus(threadId)` | `PluginComposerThreadRowStatus \| null` | `usePluginThreadRowStatus` in `apps/app/src/lib/plugin-thread-row-status.ts` |
| `useSidebarThreadShortcut(threadId)` | `{ key: string \| null; isModifierHeld: boolean }` | `useSidebarThreadShortcut` plus `SidebarThreadShortcutKeysContext` in `AppSidebar.tsx` |

The host cannot fold draft and row-status into `indicator`, because both are
per-client state read per row. The plugin composes them itself: the DTO's
`indicator` plus the two row hooks, run through `resolveThreadListIndicator`
from `@bb/client-core`. Document that composition in the guide.

### 1e. Title rendering

Titles carry `@project:`, `@section:`, and `@thread:` mentions rendered by
`apps/app/src/components/thread/ThreadTitleMentions.tsx`. Two changes:

- `PluginSidebarThread.displayTitle: string` resolved through
  `resolveThreadTitleDisplayText`, for sorting and accessible names.
- `ThreadTitle: ComponentType<{ threadId: string }>` on
  `PluginSdkApp`, rendering `ThreadTitleMentions` with the host's resources, so
  the plugin does not reimplement mention chips.

### 1f. Small reads

- `useEnvironmentProviders()` returning the same catalog as
  `useSystemEnvironmentProviders`, because the DTO already points plugins at
  `GET /system/environment-providers` with no hook to reach it.
- `experimental_useHostPathExistence(hostId, path)` is deliberately not added.
  The invalid-path warning on project rows moves to the host-rendered project
  header if it survives, or is dropped. Decide during Phase 3.

### 1g. `useSdk()`

Add `useSdk(): PluginBrowserBbSdk` to `PluginSdkApp` and export it from
`@get-bb/plugin-sdk/app` beside `useRpc`. The host implementation in
`apps/app/src/lib/plugin-sdk-hooks.ts` reads `usePluginId()` from the plugin
boundary context exactly as `useRpc` does, and memoizes one client per plugin
id: the app's `sdk` instance from `apps/app/src/lib/sdk.ts` (session plus
app-surface header) with the same narrowing the backend `PluginBbSdk`
applies, so `threads.spawn` stamps `origin: "plugin"` and `originPluginId`,
and the plugin-metadata calls default `pluginId`. No collector change and no
module-scope variable; callbacks created inside components and hooks
(including the dnd-kit handlers) capture the instance the normal way.

```tsx
function ThreadList(props: PluginThreadListProps) {
  const sdk = useSdk();
  const createSection = (name: string) => sdk.threadSections.create({ name });
  ...
}
```

The bundled-types build inlines the `@bb/sdk/browser` declarations into
`bb-plugin-sdk-app.d.ts` exactly as it does for the backend `bb.sdk`, so no
npm publish of `@bb/sdk` is needed. The testing harness in
`packages/plugin-sdk/src/testing/app.tsx` provides a recording fake per
`renderSlot` mount, matching how the other hooks are faked, so tests assert
calls through `inspection`. This is the one member that unblocks every
mutation in 1c.

## Phase 2: plugin scaffolding and state

Create `plugins/thread-list/` following `plugins/drafts/` (manifest in
`package.json` under `bb`, `server.ts`, `app.tsx`, `vitest.config.ts`,
`prepare:bundled`). Add it to `plugins/bb-official.json`.

Dependencies: `@bb/shared-ui` and `@bb/client-core` as bundled workspace
packages (not `@bb/sdk`; the plugin reaches the API through 1g), `@dnd-kit/*` for drag-and-drop, `react`, `sonner`,
`@radix-ui/react-*` menu packages (shimmed at runtime per
`packages/plugin-build/src/runtime-shims.mjs`).

### Organization state

`server.ts` stores one JSON document per preference in `bb.storage.kv` with
keys matching today's names minus the prefix (`organizationMode`,
`chronologicalSort`, `sortDirection`, `sectionOrder`, `manualSectionOrder`,
`machineSectionOrder`, `hiddenGroups`, `collapsedSections`,
`collapsedProjects`, `collapsedThreads`, `collapsedEnvironments`,
`collapsedThreadSections`, `collapsedMachines`). Validate each with the zod
schemas that already exist in `packages/domain/src/ui-preferences.ts`.

RPC: `preferences.list()` and `preferences.set({ key, value })`. Every write
publishes `{ key, value }` on a `preferences` realtime channel. The frontend
keeps a jotai-free local store: `useSyncExternalStore` over a module map,
hydrated from `preferences.list()`, patched by `useRealtime("preferences")`,
mirrored to `localStorage` under `bb.thread-list.preferences` for first paint,
and written back through a debounced scheduler so a collapse toggle burst is
one RPC call.

Migration: on first server start with no KV rows, the plugin copies the
current values from the `sidebar.*` UI preferences through
`bb.sdk.system.uiPreferences` and marks migration done. Leave the `sidebar.*`
keys in place for one release, then remove the thirteen list-specific keys
from `UI_PREFERENCE_KEYS`, keeping `sidebar.threadListProvider`,
`sidebar.navigationProvider`, `sidebar.pluginPanelOrder`, and the footer keys.

CLI: register `bb thread-list prefs list` and `bb thread-list prefs set <key>
<value>` through `bb.cli` so the settings remain scriptable. Update
`apps/cli/src/commands/settings.ts` help text and
`docs/cli-guide-and-skill.md` once the `sidebar.*` keys are removed.

## Phase 3: port the list

Work in vertical slices, each landing with its tests moved from
`apps/app/src/components/sidebar/*.test.tsx` to `plugins/thread-list/`.

1. Flat rows: `ThreadRow` with indicator glyph, split mini-map via
   `experimental_useSidebarThreadSplit`, cmd-click split, draft and row-status
   hooks, shortcut pill, hover actions, context and dropdown menus through
   vendored `@bb/shared-ui` menus, copy link, mark read, pin, rename, archive,
   delete. The DOM contract (`data-sidebar-thread-shortcut-target`,
   `data-sidebar-thread-id`, `data-sidebar-windowed-nav`) stays.
2. Trees: child nesting with `SidebarChildToggleChevron`, guide lines, sticky
   parent tiers, cross-project glyph, collapsed-child activity rollups from
   `getCollapsedChildActivity`.
3. Grouping: pinned, threads, named sections, project mode, machine mode,
   by-environment groups, all from `@bb/client-core` builders. Hidden groups
   and the More popover. Empty and loading states, the `Threads unavailable`
   state, progressive disclosure behind the experiment flag (read through
   `useRpc` from `bb.sdk.system.config`, or drop the experiment).
4. Header menu: New project, New section, Organize submenu, Sort submenu,
   section rename and delete, hide and customize. Compact viewport paged
   drawer behavior.
5. Inline rename: port `SidebarInlineRename` and `SidebarRenameEditor`
   including the menu-to-focus handshake.
6. Drag-and-drop: port `useSectionThreadDnd`, `useNestDropPreview`,
   `sidebarNestPreviewPlacement`, `useSidebarReorderDnd` with the touch sensor,
   `useNeighborReorderSortable`, the section drop overlay from #4010, and the
   pinned reorder. All commits are SDK calls per Phase 1c.
7. Windowing: port `SidebarWindowedItems` as-is; the scroll root becomes
   `element.closest('[data-sidebar="content"]')`.
8. Auto-reveal: port `useSidebarThreadReveal`, driven by `useBbContext()` for
   the routed thread and by `isUnread` transitions in the threads state.
9. Mobile: `onNavigate` after every open, drawer menus, coarse-pointer sizing,
   split disabled on compact.

Stories: move `SidebarOverview`, `SectionGrouping`, and `ThreadRow` stories to
`plugins/thread-list/app.stories.tsx` using the Ladle plugin harness in
`apps/app/.ladle/plugin-sdk-app.ts`.

## Phase 4: switch the host

- `AppSidebar.tsx` renders the Phase 0 placeholder as `original`;
  `ProjectList` and the rest of the built-in list are deleted from
  `apps/app`.
- `resolvePreferredReplacement` keeps automatic-first; the bundled plugin is
  first in slot order because plugin ids sort and it is enabled by default.
  Add a test that a fresh install resolves to the plugin.
- `SidebarThreadListSetting`: the `__builtin__` choice is removed; options
  are automatic and each registered provider.
- Keep `useSidebarThreadShortcut`, `SidebarThreadShortcutKeysContext`,
  `usePaneContentSplitDrag`, and the nav region in the host; they are shared
  with the navigation slot.
- `sidebar-bootstrap-cache.ts` stays: `useSidebarThreads` reads the sidebar
  navigation query, whose placeholder data comes from that cache, so the
  plugin gets last-known threads on first paint.

## Phase 5: docs and verification

- `docs/api_to_audit.md`: entries for each 1a-1f member; update the
  `experimental_threadList` entry's "no shipped consumer" line and the
  useSidebarThreads entry's items 1, 5.
- `packages/plugin-api-map/src/surfaces.ts` and the anatomy manifest.
- Plugin Guide references under
  `plugins/bb-guide/skills/bb-plugin-authoring/references/frontend-registration.md`;
  `apps/server/test/services/plugins/plugin-authoring-docs.test.ts` enforces
  parity.
- `docs/plugin-sidebar-thread-list.md`: fix the stale `archive` and `delete`
  shapes, add the new actions, point at the first-party plugin as the reference
  consumer.
- `docs/cli-guide-and-skill.md` for the CLI changes.

Performance benchmark: `apps/app/src/components/sidebar/sidebar.bench.test.tsx`
(gated Vitest test, jsdom) mounts the list with a generated bootstrap payload
of 3,000 threads across 40 projects and 8 sections, simulates an 800px
viewport so windowing engages, then measures initial mount, one status patch
through `updateCachedThreadListStatusState`, one membership refetch that
changes 50 rows, and one pin (median of 5). Run with:

```
cd apps/app && BB_SIDEBAR_BENCH=1 pnpm exec vitest run src/components/sidebar/sidebar.bench.test.tsx
```

Baseline for the built-in list (2026-09-21, bee, jsdom): mount 694 ms with
81 realized rows of 2,688 windowed items, status patch 183 ms, membership
refetch 247 ms, pin 181 ms. Phase 3 adds the plugin list to the same harness
(mounted through `PluginThreadList` with its registration, preference RPC
stubbed) and each rendering PR pastes both rows. jsdom measures JavaScript
time only; a manual pass in the desktop app with the React profiler covers
layout.

Verification per phase:

```
pnpm exec turbo run typecheck --filter=@get-bb/plugin-sdk --filter=@bb/app --filter=bb-plugin-thread-list
pnpm exec turbo run test --filter=@bb/app --filter=bb-plugin-thread-list --filter=@get-bb/plugin-sdk
```

Manual pass on the running app for each Phase 3 slice: chronological mode
with two named sections, nesting by drag, pin reorder, cmd-click split, rename
from menu and double click, mobile drawer in iOS Simulator Safari, disable the
plugin and confirm the missing state renders, re-enable and confirm state
survived.

## Phase 6: first-party plugins adopt `useSdk()`

The new member should not ship with one consumer. These first-party
frontends reach the public API today by raw fetch or by a server RPC that is
a pure pass-through to `bb.sdk`; each becomes a direct call.

| Plugin | Today | After |
|---|---|---|
| `plugins/plugin-api-docs/app.tsx:61` | `fetch("/api/v1/plugins")` and `fetch("/api/v1/plugin-catalog/search?q=")` with hand-parsed bodies | `sdk.plugins.list()` and `sdk.plugins.catalog.search({ q: "" })` |
| `plugins/side-chat/server.ts:126` `sendToMain` | RPC wrapping `bb.sdk.threads.queuedMessages.create` | frontend calls `sdk.threads.queuedMessages.create` directly; `createSideChat` stays server-side (fork plus KV bookkeeping) |
| `plugins/theme-preview/server.ts:622` `themeCatalog`, `setTheme` | RPC wrapping `bb.sdk.theme.catalog` and `bb.sdk.theme.set` | frontend calls `sdk.theme.*`; check what `catalogLoader` adds beyond caching before removing it |
| Plugin Guide `experimental_NewThreadComposer` example (`frontend-components.md:276-310`) | forward the request to an RPC that calls `bb.sdk.threads.spawn` | `sdk.threads.spawn(request)` from `onSubmit`; the bound client stamps the plugin origin |

Stay server-side, because the RPC does real work the browser must not or
cannot: `monaco-editor` (path confinement in `resolveTarget`), `docs`,
`github` (git remotes, token, link records), `provider-usage`
(aggregation over other plugins' RPCs), `inline-vis` (preview preparation),
`concurrency-limit`, `keep-awake`, `browser-automation`, and the
environment providers.

Each migration is its own small PR after 1g lands, and each deletes the
RPC method it replaces along with its contract entry and tests. Update
`frontend-hooks-and-ui.md` to name `useSdk()` as the first choice for
reading and mutating bb state from a frontend, with the server RPC reserved
for work that needs secrets or host files.

## Open questions

1. Resolved 2026-09-21: no compiled-in mechanism; the placeholder covers cold start.
2. Whether `sidebarProgressiveDisclosure` survives the move or is dropped.
3. Whether the invalid-project-path warning survives (needs a host path
   existence hook) or is dropped.
4. Whether to keep the deprecated `searchQuery` prop through this change or
   remove it now that the only consumer is first-party.

## Order and size

Phase 1 is one PR per subsection (1a through 1f), each small and independently
reviewable. Phase 2 is one PR. Phase 3 is six to nine PRs behind the pinned
provider setting, so the plugin can ship incomplete while the built-in list
remains the automatic default. Phase 4 flips the default and deletes. Phase 5
rides along with each PR.
