# Sidebar Navigation

## Drawing the sidebar navigation

`app.slots.experimental_sidebarNavigation` draws the sidebar's navigation.
It is exclusive. bb's own Rail (`navigation/rail`, the default) and Top list
(`navigation/top-list`) come from the bundled Navigation plugin
(`plugins/navigation` in the bb repository), which uses only this slot and the
hooks below, so it is a working example and a forkable starting point. Users
pick a provider under Settings → Appearance → Navigation; Automatic uses the
first provider from another plugin, or Rail when there is none.

Declare where you draw with `placement`, because bb lays out the sidebar
before your bundle loads:

- `rail` — a fixed-width column on the sidebar's left edge that stays when
  the sidebar collapses. bb draws Settings at the bottom of the column; draw
  Home with `actions.goHome()` and `isHomeActive`.
- `list` (the default) — the area above the thread list. bb adds Settings to
  the footer and a Back to app row to the Settings, Plugins, and Skills
  lists, and a collapse hides the whole sidebar. Draw a divider below your
  rows if your layout wants one.

Both placements keep the same macOS window frame and title-bar controls on
wide viewports. Placement does not change the position of Settings search.

Draw New thread yourself, in your component or in a `headerComponent`. The
Rail puts it in its header and leaves it out of Customize; Top list draws it
as a row that the user can reorder and hide like any other.

The component receives `isCompactViewport`, `placement`, and the deprecated
`experimental_Original`, which renders the Navigation plugin's provider for
your placement, or nothing when that plugin is disabled.

Read the items with `experimental_useSidebarNavigation()`. It returns
`{ items, activeItemId, isHomeActive, isShortcutModifierHeld, actions }`.
`items` holds New thread, Search threads, Plugins, Skills, and plugin panels
in the user's saved order, hidden ones included. Each item has an `id` (its
arrangement key, such as `__bb__/new-thread` or `<pluginId>/<panelId>`),
`label`, semantic `icon`, host `action`, `isDisabled`, `isVisible`,
`isLoading`, the contributing `pluginId` (null for bb's items), shortcut
metadata, and `badge` (a panel's `experimental_useBadge` value, or null; add
its `label` to the accessible name when you draw it). Draw hidden items in an
overflow menu so they stay reachable, and icons with
`experimental_SidebarNavigationIcon`. Show shortcut labels while
`isShortcutModifierHeld` is true.

```tsx
function NavButton({ item }: { item: ExperimentalSidebarNavigationItem }) {
  const { activeItemId, actions } = experimental_useSidebarNavigation();
  const split = experimental_useSidebarNavigationSplit(item.id);
  return (
    <button
      type="button"
      aria-label={item.badge ? `${item.label}, ${item.badge.label}` : item.label}
      aria-current={item.id === activeItemId ? "page" : undefined}
      disabled={item.isDisabled || item.isLoading}
      {...split.splitProps}
      onClick={(event) =>
        actions.activate(item.id, {
          openInSplit: event.metaKey || event.ctrlKey,
        })
      }
    >
      <experimental_SidebarNavigationIcon icon={item.icon} />
    </button>
  );
}
```

`actions` runs host behavior: `activate(id, { openInSplit })`, `goHome()`,
`setVisible(id, isVisible)`, `setOrder(ids)`, `openCustomize()`,
`openDetails(id)`, and `disablePlugin(id)`. Visibility and order persist to
`sidebar.visiblePluginPanels` and `sidebar.pluginPanelOrder`, so they carry
over when the user switches providers. `openCustomize()` opens bb's editor in
a popover beside your navigation once any open menu closes, and returns focus
to the control that opened it. Actions called after your component unmounts
do nothing.

`experimental_useSidebarNavigationSplit(id, options?)` works like
`experimental_useSidebarThreadSplit`: spread `splitProps` onto the item, gate
any "Open in split" affordance on `isAvailable`, and draw `layout` as a
mini-map if you want one. For a row inside a menu or popover, pass
`{ activation: "distance", onDragStart: closeMenu }`.

While plugins load, bb reserves the placement your provider last had. If the
picked provider is disabled or removed, bb falls back like Automatic; if it
crashes, bb draws its own provider for the same placement and shows one
toast. In tests, pass
`renderSlot(..., { sidebarNavigation: { items, activeItemId } })`; actions and
split drags are recorded in `inspection.sidebarNavigationCalls`.

## Sidebar header controls

A navigation can also pass `headerComponent`, rendered in the sidebar header
while that navigation is active. On wide macOS desktop windows, this row sits
below the window title bar. Elsewhere it sits between the sidebar toggle
and bb's back and forward buttons. The header belongs to the navigation, so
switching providers swaps both together; bb's Rail uses its header for New
thread. The component receives `width` (px available, updated on resize),
`controlSize` (bb's header button size, also `--bb-sidebar-control-size`;
use `--bb-sidebar-control-icon-size` for glyphs), and `isCompactViewport`.
Content is clipped to the row; on macOS empty space drags the window, while
buttons, links, and inputs do not. A crash replaces it with the header of
bb's provider for your placement. Plugins built before `headerComponent`
that call `experimental_sidebarHeader` still load: their header joins their
navigation.

```tsx
app.slots.experimental_sidebarNavigation({
  id: "icons",
  title: "Icon strip",
  component: IconRows,
  headerComponent: NewThreadHeader,
});
```

To turn your navigation on when your plugin is installed, set
`sidebar.navigationProvider` to `<plugin-id>/<slot-id>` from `bb.onInstall`
(see backend-ui-lifecycle.md); later choices in Settings → Appearance stick.
Users do the same with `bb settings ui set`.
