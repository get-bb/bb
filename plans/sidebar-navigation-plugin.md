# Sidebar navigation as a first-party plugin

## Goal

Move bb's built-in sidebar navigation (New thread, Search threads, Plugins,
Skills, and plugin panel rows, plus their order, visibility, More menu, row
menus, accessories, and split affordances) out of `apps/app` and into a
bundled first-party plugin that registers
`app.slots.experimental_sidebarNavigation`. Afterward the host renders no
navigation of its own, the same as the thread list after #4041.

Design check: [Compact Nav](https://github.com/SawyerHood/sawyer-plugins/tree/main/plugins/compact-nav)
(v0.1.5) must be rewritable against the public API with no host DOM
selectors, no content script, and no measuring of host elements, and must
work unchanged whether the host nav is built in or a plugin.

## What Compact Nav works around today

Compact Nav renders `experimental_Original` (bb's navigation) and restyles it,
because the slot props cannot express most of what bb's navigation does.

| Hack in compact-nav | Why it exists | Replacement in this plan |
|---|---|---|
| Renders `experimental_Original` and restyles it with `[data-testid="plugin-nav-sidebar-items"]`, `[data-sidebar-navigation-item] > button`, `[data-testid="sidebar-navigation-more-row"]` | `items` carries no saved order, hidden state, More menu, row menu, loading state, accessory, or split mini-map, so a plugin that renders its own buttons loses all of them | Items arrive in saved order with `isVisible`, `isLoading`, `pluginId`, and `experimental_Accessory`; an actions object covers hide/show, reorder, customize, details, disable; a split hook covers the mini-map (2a-2d) |
| `useLayoutEffect` measuring `[data-sidebar="trigger"]`, `app-sidebar-top-reserve-row`, and the history arrows, then negative margins, floats, `pointer-events`, and `app-region: no-drag` | No way to place content beside the sidebar toggle | A separate `experimental_sidebarHeader` slot for the space between the toggle and the history arrows. Compact Nav renders its icons there and returns `null` from the navigation slot (2e) |
| sr-only CSS on host `span`s, `svg` resizing, `aria-current` background override | Icon-only rendering of host rows | The plugin renders its own buttons with `experimental_SidebarNavigationIcon` (2f) and the sizing tokens (2g) |
| Content script adding `title` to host buttons | Hover labels on host rows it does not own | Not needed once the plugin owns its buttons |
| `[data-testid="sidebar-navigation-region"] + [data-testid="app-sidebar-navigation-divider"] { display: none }` | The divider under the nav is host-rendered | The divider moves into the navigation provider (3c) |
| `:not(:has([data-sidebar-navigation-customize-mode]))` on every rule | The inline customize editor renders inside the replaced region | The host renders the customize editor in place of the provider while it is open (3b) |
| Media queries duplicating bb's 28/36/40px control sizes | No sizing contract | `--bb-sidebar-control-size` and `--bb-sidebar-control-icon-size` (2g) |

## Status (2026-09-22)

Implemented as five stacked layers:

1. Navigation model API (2a-2d, 2f): `experimental_useSidebarNavigation`,
   `experimental_useSidebarNavigationSplit`,
   `experimental_SidebarNavigationIcon`, host customize editor. SDK 0.5.11.
2. Header slot (2e, 2g, 3e): `experimental_sidebarHeader`,
   `sidebar.headerProvider` (default `__builtin__`), sizing tokens. SDK
   0.5.12.
3. Bundled `plugins/navigation`, disabled by default; adds
   `isShortcutModifierHeld` to the navigation state. SDK 0.5.13.
4. Switch-over: Navigation enabled and the default provider, built-in
   navigation deleted, placeholder with remembered height, a picked provider
   that is disabled or removed falls back to Navigation, `experimental_Original`
   renders the bundled plugin. SDK 0.5.14.
5. Install hook: `bb.onInstall` runs once after a fresh install,
   so a plugin such as Compact Nav can pick its own header and navigation.
   SDK 0.5.15.

Differences from the plan: the header default is `__builtin__` (reusing the
replacement picker) rather than `__none__`; the plugin lives at
`plugins/navigation`; overflow items in the plugin's More menu open in a split
from their menu rather than by dragging. Compact Nav 0.1.5 keeps working on
layer 4 through `experimental_Original`, except that the bundled plugin's
divider shows below its icons.

## Decisions this plan assumes (confirm before Phase 1)

1. **The host keeps arrangement state.** Order and visibility stay in
   `sidebar.pluginPanelOrder` and `sidebar.visiblePluginPanels`, unlike the
   thread-list preferences that moved to plugin KV. Arrangement must survive
   switching navigation providers (Compact Nav's README promises "your
   existing order and hidden items carry over"), and `bb settings` already
   exposes both keys. The host resolves seeding (Skills after Plugins, Search
   hidden by default, new leading keys) and hands providers the result.
2. **The host owns the customize editor.** `SidebarVisibilityCustomize` stays
   in `apps/app` and takes over the navigation region (and the whole sidebar
   body on compact viewports, as `compactCustomizeMode` does today) when any
   provider calls `openCustomize()`. The alternative, where every provider
   builds its own editor, gives Compact Nav a reason to delegate back to bb
   again.
3. **Automatic goes away for navigation too**, matching #4051:
   `sidebar.navigationProvider` defaults to the bundled plugin, legacy
   `__automatic__` and `__builtin__` normalize to it on read and write, and
   explicit plugin choices are preserved. Installing Compact Nav no longer
   silently takes over; the user picks it in Settings → Appearance. Update
   Compact Nav's README line about Automatic.
4. **`experimental_` prefix plus `docs/api_to_audit.md` entries** for every
   new member, per AGENTS.md. The thread-list batch waived the prefix; say so
   if the same waiver applies here.
5. **The header is its own exclusive slot with its own picker.**
   `sidebar.headerProvider` defaults to None, and no bundled plugin
   registers one, so the header looks the same as it does today. The user
   picks a header provider under Settings → Appearance, directly below
   Navigation. Compact Nav's "Place icons beside sidebar toggle" setting is
   replaced by that picker. The cost is two choices to get Compact Nav's
   header layout, so Compact Nav picks both itself the first time it loads. The
   navigation component protects against half-picked or crashed headers by
   rendering its own row unless its own header component is mounted.

## Phase 0: placeholder and cold start

Mirror `ThreadListPlaceholder` with a host-owned
`SidebarNavigationPlaceholder` inside `SidebarNavigationRegion`:

- **loading**: bundles are still loading (`usePluginFrontendsSettled` is
  false). Render skeleton rows at the last height the active provider
  rendered, remembered per provider key in a `createLastKnownCache`
  (`bb.sidebar-navigation.height`), so neither bb's rows nor Compact Nav's
  single icon row shift the thread list when the plugin lands.
- **missing**: settled with no provider. One row: "Navigation is disabled"
  with a Plugins link.
- **crashed**: "Navigation stopped working" with Reload, one toast, as the
  thread-list crash path does.

A provider may render `null` (Compact Nav does when its header is active).
The region then has zero height: the host adds no padding or divider of its
own, and the remembered height is 0, so the loading skeleton reserves
nothing either.

New thread (`thread.new`), search (`thread.search`), and Settings stay
reachable without navigation: the shortcuts are app commands and Settings is
in the footer.

Optional, separate PR: load the pinned providers of the two exclusive
sidebar slots first in `plugin-frontend.ts` (both keys are known from UI
preferences before the plugin list resolves), ahead of smallest-first
ordering.

## Phase 1: fix the item model

`apps/app/src/components/sidebar/sidebarNavigationItems.ts` today:

- Skills reports `icon: { kind: "host", name: "extensions" }` and
  `action: { kind: "open-extensions" }`, so a provider cannot tell Skills
  from Plugins. Add `name: "skills"` and `{ kind: "open-skills" }`.
- Item ids (`new-thread`, `plugin-panel:<enc>/<enc>`) differ from the
  arrangement keys (`__bb__/new-thread`, `<pluginId>/<panelId>`, and
  `__bb__/automations` for the automations panel). Make `id` the
  arrangement key so the provider, the preferences, and `bb settings` share
  one identifier.
- Items include remembered nav-panel chrome from `usePluginNavPanelChrome()`
  so rows exist before plugin bundles register, marked `isLoading`.

## Phase 2: plugin API additions

All in `packages/plugin-sdk/src/app-contract.ts`, with fakes in
`packages/plugin-sdk/src/testing/app.tsx`, rows in
`packages/plugin-api-map/src/surfaces.ts`, Plugin Guide text in
`frontend-core-slots.md` and `frontend-registration.md`, and audit entries.
One SDK minor bump for the batch; the item-id and `experimental_splitProps`
changes break existing experimental consumers (see Phase 5 for Compact Nav).

### 2a. Item shape

```ts
export type ExperimentalSidebarNavigationAction =
  | { kind: "new-thread" }
  | { kind: "search-threads" }
  | { kind: "open-extensions" }
  | { kind: "open-skills" }
  | { kind: "open-plugin-panel"; pluginId: string; panelId: string };

export type ExperimentalSidebarNavigationIcon =
  | { kind: "host"; name: "new-thread" | "search" | "extensions" | "skills" }
  | { kind: "plugin"; pluginId: string; icon: string | null };

export interface ExperimentalSidebarNavigationItem {
  /** Arrangement key: `__bb__/new-thread`, `<pluginId>/<panelId>`. Stable across reloads. */
  id: string;
  label: string;
  icon: ExperimentalSidebarNavigationIcon;
  action: ExperimentalSidebarNavigationAction;
  isDisabled: boolean;
  /** False when the user hid the item; draw it in an overflow menu, not the main row. */
  isVisible: boolean;
  /** Remembered plugin panel whose bundle has not registered yet. Activating it is a no-op until it loads. */
  isLoading: boolean;
  /** Plugin that contributed the panel; null for bb's own items. Gates details and disable. */
  pluginId: string | null;
  shortcut: ExperimentalSidebarNavigationShortcut | null;
  /** The panel's `experimental_sidebarAccessory`, wrapped by the host in its crash boundary and size budget. Null on compact viewports and for bb's items. */
  experimental_Accessory: ComponentType | null;
}
```

`items` is every item in the user's saved order, visible and hidden.
`experimental_splitProps` moves off the item into 2d.

### 2b. `experimental_useSidebarNavigation()`

The navigation model is a hook, not slot props, because two slots read it:
the navigation slot and the header slot (2e). Any plugin component can call
it.

```ts
export interface ExperimentalSidebarNavigationState {
  /** Every item in the user's saved order, visible and hidden. */
  items: readonly ExperimentalSidebarNavigationItem[];
  activeItemId: string | null;
  actions: ExperimentalSidebarNavigationActions;
}
```

It reads the same host state `SidebarNavigationRegion` builds, so the
navigation and header slots never disagree. Item objects keep their identity
while unchanged, as `experimental_useSidebarThreads` does.

The slot props become:

```ts
export interface ExperimentalSidebarNavigationProps {
  isCompactViewport: boolean;
  /** @deprecated Removed in the release after the flip; see Phase 5. */
  experimental_Original: ComponentType;
}
```

`items`, `activeItemId`, and `experimental_activate` leave the props for the
hook. Returning `null` is a supported outcome: the region collapses to zero
height (Phase 0).

### 2c. Actions

```ts
export interface ExperimentalSidebarNavigationActions {
  /** Runs the item's host behavior and closes the mobile drawer. openInSplit is ignored where splits are unavailable. */
  activate(itemId: string, options: { openInSplit: boolean }): void;
  /** Hide or show one item. Persists to `sidebar.visiblePluginPanels`. */
  setVisible(itemId: string, isVisible: boolean): void;
  /** Full new order of item ids. Unknown ids are dropped, missing ids keep their relative order at the end. */
  setOrder(itemIds: readonly string[]): void;
  /** Show the host's customize editor in the navigation region (3b). */
  openCustomize(): void;
  /** Open the owning plugin's details. No-op when `pluginId` is null. */
  openDetails(itemId: string): void;
  /** Disable the owning plugin, leave its route if open, and toast. Rejects on failure after the host toast. */
  disablePlugin(itemId: string): Promise<void>;
}
```

These are exactly what `PluginNavSidebarItems` does today in
`handleActivate`, `setPanelVisible`, `handleDragEnd`/`handleCustomizeDragEnd`
(via `reorderStoredOrder`), `openCustomize`, `openPluginDetailsInWorkspace`,
and `handleDisable`. The hook binds actions to the calling plugin's frontend
generation through the plugin boundary context, the way `useRpc` and
`useSdk` read `usePluginId()`, so a reloaded plugin's stale closures do
nothing. This replaces the `replacementIdentity` check in
`SidebarNavigationRegion`.

### 2d. `experimental_useSidebarNavigationSplit(itemId)`

Same shape as `PluginSidebarThreadSplit`: `{ splitProps, isAvailable, layout }`.
The host owns the drag rules (`usePaneContentSplitDrag`), the pane cap, and
the compact/disabled checks; `layout` feeds a mini-map the way
`usePaneContentSplitIndicator` does for bb's rows. `isAvailable` is false for
Search, Plugins, and Skills, which cannot open in a pane.

### 2e. `app.slots.experimental_sidebarHeader`

A second exclusive replacement slot, for the space in the sidebar header row
between the sidebar toggle (and macOS traffic lights) and the back/forward
controls. That space is empty today, so the host's default is to render
nothing, and no bundled plugin registers one.

```ts
export interface ExperimentalSidebarHeaderRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /** Label shown in Settings → Appearance and capability details. */
  title: string;
  description?: string;
  component: ComponentType<ExperimentalSidebarHeaderProps>;
}

export interface ExperimentalSidebarHeaderProps {
  /** Width in px of the header space, updated on sidebar resize and window chrome changes. */
  width: number;
  /** Height and width in px of the header's own controls; equals `--bb-sidebar-control-size`. */
  controlSize: number;
  isCompactViewport: boolean;
}
```

Selection works like the other two sidebar slots:
`sidebar.headerProvider` (`__none__` by default, or a
`<pluginId>/<registrationId>` key), a `SidebarHeaderSetting` picker next to
`SidebarNavigationSetting`, the value also reachable through `bb settings`,
and the same automatic-free normalization as 3d.

Host side, in `SidebarTopReserveRow`: the row becomes
`[toggle reserve][header slot, flex-1 min-w-0][history controls]`. The host
already knows each reserve (`MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS`,
`BROWSER_SIDEBAR_TRIGGER_INSET_CLASS`, trigger size per pointer and
viewport), so the slot is sized in CSS and one `ResizeObserver` on the slot
element supplies `width`. The slot owns no height: content is clipped to the
row, so a provider cannot push the history controls or the thread list
around. On macOS the slot stays part of the window drag region and the host
marks interactive descendants (`button`, `a`, `input`, `[role]`) no-drag, so
empty space between icons still drags the window.

Lifecycle:

- **loading, missing**: render nothing. The row height is fixed, so nothing
  shifts when the provider lands.
- **crashed**: render nothing and toast once. The toggle and history
  controls are host-owned and keep working.
- **customize open** (3b): the slot stays mounted but `hidden`, so a
  provider that moved navigation into the header does not show stale items
  above the editor.
- **no room** (`width < controlSize`): still mounted; the provider decides
  what to show, usually only its More button.

Tab order follows DOM order: header slot, then the history controls, then
the navigation region. Document that in the guide next to the slot.

### 2f. `experimental_SidebarNavigationIcon`

`ComponentType<{ icon: ExperimentalSidebarNavigationIcon; className?: string }>`
on `PluginSdkApp`. Renders bb's glyphs for host icons and `PluginIcon`
(compact branding mask, then declared icon, then Zap) for plugin icons, so
providers match bb's artwork without learning host icon names or branding
URLs.

### 2g. Sizing tokens

Define on the sidebar root, and document with the theme tokens:

| Token | Desktop | Coarse pointer | Compact coarse |
|---|---|---|---|
| `--bb-sidebar-control-size` | 28px | 40px | 36px |
| `--bb-sidebar-control-icon-size` | 16px | 16px | 20px |

The sidebar toggle and history controls read the same tokens, so the two
cannot drift.

## Phase 3: host changes

### 3a. `SidebarNavigationRegion`

Builds the navigation model into a context that
`experimental_useSidebarNavigation()` reads (mounted in `AppSidebar` above
both the header row and the region, so both slots see one model); resolves
the provider; renders the provider or the placeholder. Everything else in
`BuiltInSidebarNavigation.tsx` and the row half of `PluginNavSidebarItems.tsx`
moves to the plugin. Arrangement math (`arrangePluginNavPanelPreferences`,
`seedSkillsNavigationPreference`, `togglePluginNavPanelVisibility`,
`reorderStoredOrder`) stays in the host behind `setVisible`/`setOrder`.

### 3b. Customize editor

While open, the region renders `SidebarVisibilityCustomize` and keeps the
provider mounted but `hidden`, so provider state survives. On compact
viewports it keeps today's takeover of the sidebar body
(`compactCustomizeMode` in `AppSidebar.tsx`). Focus returns to the element
that called `openCustomize()`.

### 3c. Divider

Delete `app-sidebar-navigation-divider` from `AppSidebar.tsx`. The
first-party plugin draws it at the bottom of its own region.

### 3d. Provider choice

`sidebar.navigationProvider` loses `__automatic__` and `__builtin__` as in
#4051 (`packages/domain/src/ui-preferences.ts`,
`apps/server/test/public/public-ui-preferences.test.ts`,
`SidebarNavigationSetting.tsx` drops `builtInDescription`). Add
`sidebar.headerProvider` beside it with `__none__` as the default and a
`SidebarHeaderSetting` picker that lists None plus each header registration.
Update `docs/configuration.md`, `app-settings.md`, and
`bb-guide-customization.md` for both keys.

### 3e. Header slot

`SidebarTopReserveRow` gains the slot described in 2e, resolved through a
`useSidebarHeaderReplacement()` beside `useSidebarNavigationReplacement()`
and mounted with `PluginReplacementSlot` (render-nothing original, toast on
crash). A plugin that draws navigation in the header tracks whether its
header is mounted with a module-level flag and returns null from its
navigation component while it is; no host prop is involved, so a crashed
or unpicked header brings the navigation row back. A plugin that wants both
picked sets them once from its backend on first load.

## Phase 4: first-party plugin

`plugins/navigation/` (package `bb-plugin-navigation`; the example at
`examples/plugins/sidebar-navigation` already owns `bb-plugin-sidebar-navigation`),
following `plugins/thread-list/`. Name "Navigation", added to
`plugins/bb-official.json`. Contents, ported from the
host:

- Rows: `SidebarNavRowChrome` with the accessory, mini-map (2d), hover
  options button, and context menu (Open in split, View details, Hide,
  Disable, Customize), all through 2c.
- Drag reorder with `useSidebarReorderDnd`/`useSidebarSortable`, committing
  through `setOrder`.
- More overflow with Add to sidebar and Open in split.
- The divider.

`SidebarVisibilityControls` would then exist in three places (host,
thread-list's vendored copy, this plugin). Extract it into a bundled
workspace package the two plugins and the host share, in the same PR.

Tests move with the code; `SidebarNavigationRegion.test.tsx` keeps the host
contract (arbitration, placeholder states, generation-bound actions, a
provider that returns null collapsing to zero height, customize takeover),
and a new `SidebarTopReserveRow.test.tsx` covers the header slot (width
updates, crash leaves the history controls, hidden during customize).

## Phase 5: compatibility for installed Compact Nav

Compact Nav 0.1.5 renders `experimental_Original` and targets host
attributes. For one release after the flip:

- `experimental_Original` renders the bundled navigation plugin's
  registration with the same props (the placeholder if it is disabled), and
  never the calling provider, so it cannot recurse.
- The first-party plugin keeps `data-testid="plugin-nav-sidebar-items"`,
  `data-sidebar-navigation-item`, `data-testid="sidebar-navigation-more-row"`,
  and `data-sidebar-navigation-customize-mode` on its markup.

Then ship Compact Nav 0.2 on the new API and remove `experimental_Original`
in a deliberate SDK bump, as `PluginThreadListProps` lost `Original` in 0.5.7.

## Compact Nav on the new API

This sketch checks that the API is enough for the layout in the screenshot
(toggle, New thread, Notes, More, then back/forward, and nothing between the
header and Pinned). It uses no DOM queries, content script, or host
selectors. Compact Nav registers two slots. The header renders what fits
beside the toggle and puts the rest in More. The navigation slot returns
`null` while that header is active and falls back to a full icon row when it
is not.

```tsx
import {
  definePluginApp,
  experimental_SidebarNavigationIcon as NavIcon,
  experimental_useSidebarNavigation,
  experimental_useSidebarNavigationSplit,
  type ExperimentalSidebarHeaderProps,
  type ExperimentalSidebarNavigationItem,
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import "./app.css";

const GAP = 4;

function IconButton({ item }: { item: ExperimentalSidebarNavigationItem }) {
  const { activeItemId, actions } = experimental_useSidebarNavigation();
  const split = experimental_useSidebarNavigationSplit(item.id);
  return (
    <button
      type="button"
      className="compact-nav-button"
      title={item.label}
      aria-label={item.label}
      aria-current={item.id === activeItemId ? "page" : undefined}
      aria-keyshortcuts={item.shortcut?.ariaKeyShortcuts}
      disabled={item.isDisabled || item.isLoading}
      {...split.splitProps}
      onClick={(event) =>
        actions.activate(item.id, { openInSplit: event.metaKey || event.ctrlKey })
      }
    >
      <NavIcon icon={item.icon} />
    </button>
  );
}

function IconRow({ capacity }: { capacity: number }) {
  const { items } = experimental_useSidebarNavigation();
  const visible = items.filter((item) => item.isVisible);
  const hidden = items.filter((item) => !item.isVisible);
  const needsMore = hidden.length > 0 || visible.length > capacity;
  const shown = needsMore ? visible.slice(0, Math.max(0, capacity - 1)) : visible;
  return (
    <div className="compact-nav-row">
      {shown.map((item) => <IconButton key={item.id} item={item} />)}
      {needsMore ? <MoreMenu overflow={visible.slice(shown.length)} hidden={hidden} /> : null}
    </div>
  );
}

function CompactHeader({ width, controlSize }: ExperimentalSidebarHeaderProps) {
  useLayoutEffect(() => headerFlag.mount(), []);
  return <IconRow capacity={Math.floor((width + GAP) / (controlSize + GAP))} />;
}

function CompactNavigation() {
  const inHeader = useSyncExternalStore(headerFlag.subscribe, headerFlag.get);
  return inHeader ? null : <IconRow capacity={Number.POSITIVE_INFINITY} />;
}

export default definePluginApp((app) => {
  app.slots.experimental_sidebarHeader({
    id: "icons",
    title: "Compact Nav",
    description: "Navigation icons beside the sidebar toggle.",
    component: CompactHeader,
  });
  app.slots.experimental_sidebarNavigation({
    id: "icons",
    title: "Compact Nav",
    description: "Compact icons with bb's saved order, visibility, and customization.",
    component: CompactNavigation,
  });
});
```

```css
.compact-nav-row { display: flex; align-items: center; gap: 4px; }
.compact-nav-button {
  width: var(--bb-sidebar-control-size);
  height: var(--bb-sidebar-control-size);
  display: grid; place-items: center; border-radius: 8px;
}
.compact-nav-button > * { width: var(--bb-sidebar-control-icon-size); height: var(--bb-sidebar-control-icon-size); }
.compact-nav-button[aria-current="page"] { color: var(--primary); background: var(--sidebar-accent); }
```

`MoreMenu` lists overflowed visible items with `activate` and hidden items
with `activate` and `setVisible(id, true)`, and ends with `openCustomize()`.
The right-click menu on a button calls `setVisible(id, false)` and
`openCustomize()`. The `inlineHeader` setting and `server.ts` go away: the
Appearance header picker replaces them.

What this drops compared with 0.1.5: icons no longer wrap onto a second row
below the header; they overflow into More. If wrapping is wanted back, the
header can publish its capacity to a module-level store the navigation
component reads (both slots belong to one plugin bundle), and the navigation
component renders the remainder instead of returning `null`.

## Order and size

1. Phase 1 (item model fixes), one PR.
2. Phase 2: 2a-2c together (they break the same consumers), then 2d, then
   2e with 3e (the header slot, its preference, and its picker), then 2f+2g,
   one PR each, each shipping its testing fake and guide text. The header
   slot does not depend on the flip and can land first.
3. Phase 4 plugin behind the pinned provider, while bb's navigation stays
   the default.
4. Phase 0 + 3 + 5: flip the default, delete the host navigation, add the
   placeholder and the `Original` compatibility path.
5. Compact Nav 0.2 in sawyer-plugins, then remove `experimental_Original`.

## Verification

- `pnpm exec turbo run typecheck test --filter=@get-bb/plugin-sdk --filter=@bb/app --filter=bb-plugin-navigation`
- `apps/server/test/services/plugins/plugin-authoring-docs.test.ts` for
  guide parity.
- Both SDK guards (surface check and npm version guard) against the merge
  base.
- Manual pass in the dev app: macOS desktop chrome (traffic lights, window
  drag between header icons), browser, iOS Simulator Safari drawer; Compact
  Nav as navigation only, as header only, and as both; hide,
  reorder, and customize under both bb's navigation and Compact Nav 0.1.5
  (compat path) and 0.2 (new API); disable the navigation plugin and confirm
  the missing placeholder; crash it and confirm Reload.
