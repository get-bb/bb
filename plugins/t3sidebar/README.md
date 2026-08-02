# t3sidebar

An inbox-style replacement for bb's sidebar thread list, and the reference
example for `app.slots.experimental_threadList`.

Turn it on in **Settings → Appearance → Sidebar**. bb's own list stays the
default, and comes back the moment you switch away or disable this plugin.

The plugin replaces the scrolling list only. bb's New-thread button, search
field, plugin nav rows, and footer stay exactly where they are — this list
filters by the host's search and adds just one control of its own, a project
scope picker.

## The idea

The list never re-orders itself. Threads sort by creation time, newest first,
and hold that place until you park them. Status lives inside each card instead
of in its position, so the sidebar only moves when you act — no row slides
away under your cursor because an agent finished something.

Three shelves:

- **Inbox** — three-line cards: project, status and age on the first line;
  title on the second; then branch (or the machine, when a thread has no
  worktree), activity counts, the pull-request number, and the agent glyph.
  Pinned threads sit above.
- **Snoozed** — hidden until a wake time you chose. A snoozed thread comes
  back early if it starts working or asks you something.
- **Settled** — work you are done with, collapsed to one line each.

## What it demonstrates

| Plugin API | Used for |
| --- | --- |
| `experimental_threadList` | the sidebar's scrolling list (bb keeps the New-thread button, search, nav rows, and footer) |
| `experimental_useSidebarThreads` | live threads and projects, from the host's own cache |
| `experimental_useSidebarThreadActions` | open, open-in-split, new thread |
| `experimental_useSidebarThreadSplit` | dragging a card out to a split pane |
| `experimental_useSidebarThreadPullRequest` | the `#412` badge, coloured by bb's attention state |
| `@radix-ui/react-context-menu` (shimmed) | this plugin's own right-click menu, built on the action hook |
| `bb.storage.database()` + `bb.rpc` + `bb.realtime` | the settled/snoozed store |

The plugin API ships **no components**. Status glyphs and the right-click menu
are both this plugin's own: `indicator` arrives as data, and every menu item is
one call on `experimental_useSidebarThreadActions`. Choosing them is the point
of a replaced sidebar. Deletion still routes through `requestDelete`, so BB
shows its confirmation dialog rather than a plugin deleting a subtree silently.

## Where the lifecycle lives

Settled and snoozed state is in **this plugin's** SQLite database, never on
bb's thread. Putting it on the thread would mean a schema change, a wire
change, and a `HOST_DAEMON_PROTOCOL_VERSION` bump for a concept only this
sidebar understands. Uninstalling the plugin takes its state with it.

One rule matters more than the rest: **a thread that is working can never be
parked.** bb has more kinds of live work than a session status — workflows,
background agents, background commands, plan mode, goals — and every one of
them blocks parking and wakes a parked thread. Hiding running work is the one
failure this feature cannot afford. See `canPark` in `src/lifecycle.ts`.
