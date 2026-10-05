---
name: thread-list
description: "Inspect or change the sidebar thread list's layout preferences: organization mode, sort, section order, hidden groups, collapsed groups, and thread row actions."
---

# Thread list preferences

The Thread list plugin owns the sidebar's layout state. Read it with
`bb thread-list prefs list --json`; keys are `showProviderIcons`, `threadLifecycles`, `organizationMode`,
`environmentGrouping`, `groupByReadStatus`, `chronologicalSort`, `sortDirection`, `sectionOrder`,
`manualSectionOrder`, `machineSectionOrder`, `hiddenGroups` (including the
built-in `threads` group), `rowActions`,
`collapsedSections`, `collapsedProjects`, `collapsedThreads`,
`collapsedEnvironments`, `collapsedThreadSections`, and `collapsedMachines`.

```sh
bb thread-list prefs list [--json]
bb thread-list prefs get <key> [--json]
bb thread-list prefs set <key> <value> [--json]
bb thread-list prefs reset <key> [--json]
```

`set` takes JSON; a bare word is read as a string, so
`bb thread-list prefs set organizationMode machine` and
`bb thread-list prefs set manualSectionOrder '["pinned","sections","threads"]'`
both work. A value the key's schema rejects fails with
`invalid_preference_value` and leaves the stored value alone. Every open
window applies a change immediately. Sections themselves and a thread's
section are bb core state: use `bb thread section` and `bb thread update`.

On first load the plugin copies any non-default `sidebar.*` values from
`bb settings ui` once; after that the two are independent.

`environmentGrouping` decides whether sibling threads sharing one worktree
collapse into a single row: `"auto"` (default) groups them in every
organization except chronological, `false` never groups, and `true` always
groups. `sortDirection` is `default` (each field's natural order: newest first
for dates, A–Z for titles), `ascending`, or `descending`.

`hiddenGroups` (default `[]`) moves groups into More, the same as a group
menu's Hide from list. Keys are `threads`, `project:<projectId>`,
`section:<sectionId>`, and `machine:<hostId>` (`machine:no-machine` for the
unassigned group); `threads` applies in every organization. Pinned cannot be
hidden, hiding keeps a group's threads, order, and collapse state, and IDs that
no longer exist stay saved without producing rows. `set` replaces the whole
list across organizations, so include existing keys to keep them hidden;
`reset` shows every group:

```sh
bb thread-list prefs set hiddenGroups '["threads","project:proj_example"]'
```

The header's Filter menu selects Active, Archived, or both; at least one must
remain selected. `bb thread-list prefs set threadLifecycles '["archived"]'`
shows archived threads, and `'["active","archived"]'` shows both. The default
is `'["active"]'`. Archived results load in pages; use Show more at the end
of the list. The same preference is available through `setPreference` RPC.

`rowActions` picks up to three quick-action buttons a thread row shows on
hover, left to right before its actions menu. Choose from `split`, `copyLink`, `read`,
`pin`, `move` (opens a section menu), `rename`, and `archive`; the default is `'["archive"]'` and `'[]'`
leaves only the menu. For example,
`bb thread-list prefs set rowActions '["pin","archive"]'`. In the app, a thread
row's actions menu has Customize row actions, which previews the row's three
action slots; each slot picks an action or Hide, and filled slots drag to reorder.

Organize → Rows → Provider icons toggles the icon before each thread title.
`showProviderIcons` defaults to `true`; use
`bb thread-list prefs set showProviderIcons false` to hide them. Unknown
provider ids have no icon.

Organize → Groups → By read status lists threads that show the unread dot above
the rest, keeping the selected sort within each group. `groupByReadStatus`
defaults to `false`; use `bb thread-list prefs set groupByReadStatus true` to
turn it on. Parents start collapsed while it is on, without changing
`collapsedThreads`, and `environmentGrouping` is ignored. The open thread keeps
its place until another thread is opened.

New threads inherit the sidebar group where creation was invoked. Pinned
creates pinned threads; custom sections supply their section; project, machine,
and general thread groups start unsectioned and unpinned. Environment rows
reuse their environment and the containing group's placement. In Pinned,
they retain the group's common underlying section for unpinning; mixed-section
groups use no underlying section.
