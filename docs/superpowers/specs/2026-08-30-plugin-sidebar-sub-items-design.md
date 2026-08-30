# Plugin Sidebar Sub-Items

## Goal

Let a plugin group related destinations beneath one existing `navPanel` row. A
plugin such as Lens can expose Issues and Reviews as indented child rows without
injecting DOM or replacing bb's sidebar.

Existing `navPanel` registrations remain unchanged when they omit the new field.

## Public contract

`PluginNavPanelRegistration` gains one optional experimental field:

```ts
experimental_sidebarSubItems?: readonly {
  id: string;
  title: string;
  icon?: string;
  subPath: string;
  experimental_sidebarAccessory?: ComponentType;
}[];
```

Example:

```tsx
app.slots.navPanel({
  id: "lens",
  title: "Lens",
  icon: "Scan",
  path: "lens",
  component: Lens,
  experimental_sidebarSubItems: [
    {
      id: "issues",
      title: "Issues",
      icon: "CircleDot",
      subPath: "issues",
      experimental_sidebarAccessory: IssueCount,
    },
    {
      id: "reviews",
      title: "Reviews",
      icon: "GitPullRequest",
      subPath: "reviews",
    },
  ],
});
```

The field stays on `navPanel` rather than becoming a separate slot. This keeps
ownership explicit, preserves declaration order, and avoids cross-registration
references. The item contract remains inline so the change adds no unnecessary
top-level SDK export.

The collector validates the field at the plugin boundary:

- When present, it is a non-empty array.
- Each `id` follows the existing slot-id grammar and is unique within the panel.
- Each `title` is non-empty.
- An optional `icon` is a non-empty BB icon-name hint.
- Each `subPath` is a non-empty relative route remainder with no leading or
  trailing slash, empty segment, query, fragment, or `.`/`..` traversal segment.
- Each `subPath` is unique within the panel so active-child resolution is
  unambiguous.
- An optional `experimental_sidebarAccessory` is a React component function.
- Unknown experimental fields continue to fail rather than being ignored.

The collector returns a normalized copy instead of retaining the caller's
mutable array.

Because this is a new public Plugin SDK contract, implementation bumps the SDK
patch version with `node scripts/bump-plugin-sdk.mjs --patch`. It adds an entry
to `docs/api_to_audit.md` and updates the Plugin Guide and plugin API map in the
same change. It does not change the server/daemon protocol.

## Sidebar behavior

A panel with sub-items renders a separate disclosure button before its normal
plugin icon. The disclosure button expands or collapses the indented rows; the
parent title remains a normal navigation target for the panel root. This avoids
nested interactive controls and keeps both actions keyboard-accessible.

Expansion state is stored per client and keyed by plugin and panel id. A panel
is shown expanded when either its stored state is expanded or the current route
matches one of its children. Navigating away restores the stored state. A route
matches a child when its subpath equals the declared `subPath` or begins with
that subpath followed by `/`, so `issues/123` keeps Issues active without making
`issues-old` a match.

Child rows:

- Use the declared icon when present and preserve label alignment when absent.
- Render an optional accessory through the same isolated, bounded,
  desktop-only host treatment as the parent accessory.
- Navigate to `/plugins/<pluginId>/<panelPath>/<subPath>` through the existing
  route builder.
- Support the existing modifier-click and pointer-drag split behavior with the
  child `subPath` included in the split content.
- Receive `aria-current="page"` when active and expose their full title and
  accessory semantics to assistive technology.
- Have no independent options menu, hiding, or reordering controls.

The parent remains the sortable and hideable unit. Moving or hiding it moves or
hides its children. Collapsed-icon sidebar mode continues to hide the plugin
navigation section; the full compact drawer renders the disclosure and child
rows normally. Plugins without `experimental_sidebarSubItems` retain the exact
current row structure, spacing, options, navigation, and drag behavior.

## Boot and failure behavior

Serializable child metadata (`id`, `title`, `icon`, and `subPath`) joins the
last-known plugin navigation chrome cache under a new cache version. This keeps
the sidebar stable while plugin frontend bundles load. React accessory
components are live-only and are never persisted.

If a child accessory throws, only that accessory disappears. Reloading the
plugin retries it through the existing slot generation lifecycle. If the plugin
is disabled, removed, or fails to load, its existing nav-panel fallback behavior
removes the group; no stale child route remains rendered after frontend boot
settles.

## Implementation boundaries

The change should extend the existing flow rather than introduce a second
navigation system:

- `packages/plugin-sdk/src/app-contract.ts` owns the public field.
- `packages/plugin-sdk/src/internal/plugin-app-collector.ts` validates and
  normalizes it for both production and the public test harness.
- `apps/app/src/lib/plugin-nav-panel-chrome.ts` carries serializable child
  chrome through boot.
- `apps/app/src/components/plugin/PluginNavSidebarItems.tsx` owns disclosure,
  active-route matching, child navigation, split behavior, and accessory
  mounting.
- The existing sidebar ordering atoms continue to apply only to top-level
  panels; one small per-client atom stores expanded panel keys.

No content script, DOM observer, arbitrary nested React region, server route,
database table, or daemon message is added.

## Verification

Tests cover the behavior where regressions are plausible:

1. Collector and public app-harness tests accept valid children, preserve order,
   normalize copied data, and reject malformed arrays, duplicate ids/subpaths,
   invalid routes, invalid icons, and invalid accessories.
2. Sidebar tests prove that registrations without children retain current DOM
   behavior; disclosure is accessible; expansion persists; active deep routes
   reveal and highlight the correct child; parent hide/reorder treats the group
   atomically; child navigation and split content include `subPath`; compact
   behavior is correct; and a crashing child accessory is isolated and retried
   after reload.
3. Chrome-cache tests prove child metadata survives pre-boot rendering while
   accessory components do not enter storage.
4. API synchronization tests prove the SDK declaration, Plugin Guide, API audit,
   and plugin API map describe the new field.
5. Turbo runs the affected Plugin SDK, app, template, server-doc, and API-map
   test/typecheck/build tasks.
6. A representative plugin registration is exercised in the running app on
   desktop and compact layouts, including expand/collapse, direct deep-link
   startup, accessory display, keyboard navigation, and opening a child in a
   split.
