# Build plan: the t3sidebar plugin

This plan builds a bb plugin that makes the sidebar behave like t3code's
sidebar v2. It uses the API in
[plugin-sidebar-thread-list.md](plugin-sidebar-thread-list.md).

The tone here is deliberately simple. Each stage says what you build, why it
comes in that order, and how you know it works.

---

## The big picture in one paragraph

Today bb's sidebar is a tree of projects with one line of text per thread.
t3code's sidebar is an inbox. Every thread is a small card with three lines.
The list never re-orders itself. When you finish with a thread, you park it,
and it shrinks to one line at the bottom. We want that behavior in bb, but as
a plugin, so bb keeps its own sidebar and users choose.

Think of it as two shelves. The top shelf holds work that still needs you.
The bottom shelf holds work you are done with. The plugin's whole job is to
decide which shelf a thread belongs on, and to draw a nice card for it.

---

## Two halves of the work

**Half A is host work.** bb has no way to hand its sidebar to a plugin yet.
You build two slots, three hooks, and one component first. This is a change to
bb itself.

**Half B is plugin work.** With the slot in place, the plugin is an ordinary
bb plugin in `plugins/t3sidebar/`. It never touches bb's schema.

Do Half A completely before you start Half B. A half-built slot makes plugin
bugs impossible to tell apart from host bugs.

---

# Half A — teach bb's sidebar to step aside

## Stage A1: the slot, with a dumb plugin

**What you build.** The `experimental_threadList` slot end to end:

1. Add `PluginThreadListRegistration` and `PluginThreadListProps` to
   `packages/plugin-sdk/src/app-contract.ts`, and the method on
   `PluginAppSlots`.
2. Add `threadLists` to `PluginRegistrationSet` and `PluginSlotSnapshot` in
   `apps/app/src/lib/plugin-slots.ts`, next to the existing arrays.
3. Add a `bb.sidebar.threadListProvider` atom in
   `apps/app/src/components/sidebar/`, in the style of
   `pluginNavSidebarAtoms.ts`.
4. In `AppSidebar.tsx`, choose between `<ProjectList>` and the chosen plugin
   component inside `<SidebarContent>`.
5. Add the picker to Settings → Appearance.

**Why first.** Everything else depends on it, and it is the only part that
needs review from the bb side.

**How you know it works.** Write a two-line test plugin that renders the word
"hello" in the sidebar. Pick it in Settings. The sidebar says hello. Disable
the plugin. bb's own list comes back with no error.

**Watch out for.** The fallback path. Make the plugin throw on purpose. You
must see bb's list plus one toast — never an empty sidebar, and never the
small "plugin crashed" chip that other slots use.

## Stage A2: the data hooks

**What you build.** `experimental_useSidebarThreads` and
`experimental_useSidebarThreadActions`. The read hook wraps
`useSidebarNavigation`, which already owns the realtime subscriptions. Map
`ThreadListEntry` to the frozen `PluginSidebarThread` shape in one place, and
call `resolveThreadListIndicator` there so `indicator` is filled in.

**Why here.** The slot without data can only draw static text.

**How you know it works.** Change your test plugin to list thread titles.
Start an agent in another thread. The row's `indicator` changes to `runtime`
without a reload.

**Watch out for.** One mapper, one test file. If the mapping happens in two
places it will disagree with itself within a month.

## Stage A3: splits and the context menu

**What you build.** Two things, both extracted from `ThreadRow.tsx` rather
than copied:

1. `experimental_useSidebarThreadSplit(threadId)`. It wraps
   `useThreadRowSplitDrag` and `usePaneContentSplitIndicator`, and returns a
   spreadable `splitProps` bag plus the pane layout as plain data.
2. `experimental_ThreadContextMenu`. It wraps `ThreadActionsContextMenu`.

**Why no status component.** Status is data — `indicator`, `indicatorLabel`,
and `activity`. Each plugin draws its own icons. A sidebar that cannot choose
its own icons is not really a replaced sidebar.

**Why the menu is different.** The context menu carries items contributed by
*other* plugins. A plugin that draws its own menu silently deletes them.

**How you know it works.** Drag a row from the test plugin onto the right
edge of the main area. The pane splits. Drag it onto a pane center. The pane
is replaced. Right-click a row. bb's full menu opens.

**Watch out for.** The drag must not engage while the pointer stays inside
the sidebar. That rule is what lets a plugin bring its own drag-to-reorder
later without a fight.

## Stage A4: the thread header slot

**What you build.** `app.slots.experimental_threadHeaderAction`. It renders a
plugin component in the thread header's action row.

The wiring is short, because the region already exists.
`ThreadDetailHeader.tsx` takes a `pluginActions` prop and renders it first in
the action row. Today that prop carries host-rendered buttons registered from
a plugin backend with `bb.ui.registerThreadAction`. You add the component
variant beside it.

**Why the plugin needs it.** A flat inbox has nowhere to nest child threads.
The plugin hides them from the list, so they need a home. The thread header is
the natural one, because a child belongs to its parent, not to the list.

**Why not a content script.** A content script could find the header in the
DOM and inject a node. It is same-origin, full-trust code, so it would work.
It would also break quietly on the next header refactor, and it would fight
React over a node React owns. A real slot costs about thirty lines and is
useful to every other plugin.

**How you know it works.** Register a component that renders the word
"here". Open a thread. It appears left of the panel toggle. Split the pane.
It appears in both headers, each with its own `threadId`.

**Watch out for.** The row is 48px tall with 28px controls. Anything larger
must be a portalled popover, or it will stretch the app's chrome row.

## Stage A5: write the docs

**What you build.** Three documentation updates, in the same change:

1. `docs/api_to_audit.md` — the four entries drafted at the end of the API
   spec.
2. The plugin authoring skill,
   `apps/server/src/services/skills/builtin-skills/bb-plugin-authoring/SKILL.md`
   — a `threadList` example in the frontend section, the two data hooks, the
   split hook, and a `threadHeaderAction` example.
3. The keyboard contract. Say plainly that a row needs
   `data-sidebar-thread-shortcut-target` and `data-sidebar-thread-id`, or nine
   shortcuts stop working.

**Why it is a stage and not an afterthought.** [AGENTS.md](../AGENTS.md)
requires the `experimental_` prefix and an audit entry for every new public
plugin API member. A missing entry blocks the change.

---

# Half B — the t3sidebar plugin

Create `plugins/t3sidebar/` in the shape of `plugins/automations/`:
a `package.json` with a `bb` block, `src/server.ts`, and `app.tsx`.

## Stage B1: cards, and nothing else

**What you build.** One flat list. Sort by `createdAt`, newest first, and
never re-sort. Draw the three-line card: project and status on line one,
title on line two, branch and glyphs on line three. Register with
`chrome: "list-and-actions"` so you own the header row, with a project scope
menu and your own search field.

Draw the status icons yourself from `thread.indicator`. The plugin owns its
look, so it can use bb's glyph set, or t3code's, or its own. Handle an
unknown `indicator` value by drawing nothing — bb can add kinds later.

Spread `splitProps` on each card and each slim row, and add the two shortcut
data attributes. Both are one line each, and both are easy to forget until a
user reports that drag or `Mod+3` stopped working.

**Why first.** This is the whole visual change. It needs no backend, no
database, and no new bb data. If it does not feel right, you have lost a day,
not a week.

**How you know it works.** Your sidebar looks like the mockup, live-updates
while an agent runs, and `Mod+1` still opens the first thread.

**Watch out for.** The static sort is the point, not a shortcut. Activity
must never move a row. If a row moves while the user reads it, the plugin has
failed at the one thing it exists to do.

## Stage B2: settle, in the plugin's own database

**What you build.** A tiny backend:

```ts
// plugins/t3sidebar/src/server.ts
export default function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS thread_state (
       thread_id   TEXT PRIMARY KEY,
       settled_at  INTEGER,
       settled_by  TEXT,          -- 'user' | 'auto'
       snoozed_until INTEGER,
       snoozed_at  INTEGER
     )`,
  ]);

  bb.rpc.method("listState", async () => readAll(db));
  bb.rpc.method("settle", async ({ threadId }) => {
    write(db, threadId, { settledAt: Date.now(), settledBy: "user" });
    bb.realtime.publish("state", { threadId });
  });
  // unsettle, snooze, unsnooze follow the same shape.
}
```

The frontend reads it with `useRpc`, and re-reads on `useRealtime("state")`.

**Why the plugin's own database.** t3code put `settledAt` and `snoozedUntil`
on the thread itself. That is a schema change, a wire change, and a
`HOST_DAEMON_PROTOCOL_VERSION` bump. A plugin needs none of it. The state
lives beside bb, not inside it, and uninstalling the plugin removes it
cleanly.

**How you know it works.** Click Settle. The card shrinks to a slim row under
a "Settled (n)" header. Reload the app. It is still there.

**Watch out for.** Do not let a blocked thread settle. Port t3code's
`canSettle` rules: no pending interaction, and no live session.

## Stage B3: snooze

**What you build.** The four presets — in an hour, this evening, tomorrow,
next week — a "Snoozed (n)" shelf, and the wake timer. Port
`resolveSnoozePresets` and `snoozeWakeLabel` from t3code's
`threadSettled.ts`. They are pure functions and they move over unchanged.

Copy one subtle rule with them: a snoozed thread **raises its hand** and comes
back early when it needs you. Otherwise snooze hides the exact thing you
needed to see.

**How you know it works.** Snooze a thread for one hour. It moves to the
shelf. Make it ask a question. It comes straight back.

**Watch out for.** `setTimeout` delays are signed 32-bit. A far-future wake
overflows and fires immediately, which spins. Clamp it, exactly as t3code
does.

## Stage B4: the automatic rules

**What you build.** Two rules that settle a thread without a click:

1. The thread's pull request merged or closed.
2. The thread was quiet for N days, and it has no open pull request.

Pull-request state is not in the sidebar data. The plugin's backend fetches it
through `bb.sdk.environments.pullRequest`, caches it in the same database, and
refreshes it on a `bb.background.schedule`. The frontend just reads the cache.

**How you know it works.** Merge a pull request for an open thread. Within one
refresh the card drops to the settled shelf on its own.

**Watch out for — this is the important one.** t3code's blocker list checks
approvals, user input, session status, and queued turns. bb has more kinds of
work: workflows, background agents, background commands, plan mode, and goals.
If you port the list as written, a thread with a running workflow will
auto-settle and vanish while it is still working. Your blocker check must
also require every count in `thread.activity` to be zero.

## Stage B5: children move to the header

**What you build.** Two small changes that work together:

1. The list hides children. Filter out every thread with a
   `parentThreadId` that points at another visible thread. The inbox shows
   parents only.
2. A `threadHeaderAction` component shows those children. It draws a chip
   with an overlapped disc cluster and a short count. Clicking it opens a
   popover that lists the children. Clicking a child navigates to it.

**Why they are one stage.** Hiding children without the chip loses work.
Adding the chip without hiding them shows the same thread twice.

**Where the data comes from.** The same `experimental_useSidebarThreads()`
hook. Filter by `parentThreadId === threadId`. There is no second data
source and no backend call.

**How you know it works.** Fork a thread. The fork leaves the inbox. The
parent's header grows a chip that counts it. Click through and back.

**Watch out for.** Two traps.

- **Orphans.** A child whose parent is archived, deleted, or filtered out by
  the project scope must reappear in the list. Otherwise it is invisible
  everywhere. Only hide a child when its parent is actually on screen.
- **Naming.** bb's in-turn subagents are activity on the parent thread, and
  they are counted in `activity.backgroundAgents`. They are not child
  threads. The chip lists child threads: forks, side chats, and plugin-
  spawned threads. Pick the label with that difference in mind.

## Stage B6: polish

**What you build.** The remaining behavior, in rough value order:

1. Unread. Bright title for unread, faded row for read, using the host's
   `isUnread`.
2. The settled shelf pages ten at a time.
3. Search filters the flat list and keeps lifecycle order.
4. Hover actions on the card, and the host context menu on right-click.
5. Empty states, and the "no projects yet" case.

**How you know it works.** Use it for a full day as your only sidebar. The
bugs you find in that day are the ones that matter.

---

## The order, and why

| Stage | Gives you | Depends on |
| --- | --- | --- |
| A1 slot | a plugin can draw the sidebar | — |
| A2 hooks | it can draw real threads | A1 |
| A3 splits + menu | rows drag to panes, right-click works | A2 |
| A4 header slot | children have a home | A1 |
| A5 docs | the API is landable | A1–A4 |
| B1 cards | the whole look | A1–A3 |
| B2 settle | the bottom shelf | B1 |
| B3 snooze | the middle shelf | B2 |
| B4 auto rules | it parks work for you | B2, B3 |
| B5 children | the inbox stays flat | A4, B1 |
| B6 polish | daily driver | all |

You can stop after B1 and still have shipped the thing people asked for. B2
onward is what makes the list stay short.

---

## Things that will bite

**bb threads have parents.** bb has parent and child threads, sections, and
pinned threads. A flat list hides all three. Decide before B1: either flatten
everything and keep only Pinned, or nest children under their parent card.
The mockup keeps Pinned and flattens the rest.

**Two sidebars means two code paths.** Every sidebar feature bb adds after
this either gets added twice or works in only one. Keep the plugin's feature
list deliberately small.

**Client-local state does not sync.** Settle state lives in the plugin's
database on one server, so it follows the server, not the device. Snooze
times are absolute, which is right. Unread is bb's own, which is also right.

**The diff numbers in the mockup.** `+312 −48` is not in the sidebar data.
It needs the same backend treatment as pull-request state in B4. If B4 slips,
drop the diff from the card rather than blocking on it.

---

## Definition of done

- Settings → Appearance → Sidebar lists "bb (built-in)" and "t3sidebar".
- Picking t3sidebar changes the sidebar without a reload.
- Disabling the plugin restores bb's sidebar with no error.
- `Mod+1`…`Mod+9`, `thread.next`, and `thread.previous` work in both.
- Dragging a card out to a pane edge splits, and to a pane center replaces.
- Cmd-click and the context menu open a thread in a split.
- A thread with a running workflow never auto-settles.
- Child threads do not appear in the list, and every one of them is reachable
  from its parent's header chip.
- A child whose parent is hidden still appears in the list.
- `docs/api_to_audit.md` has both entries, and the plugin authoring skill
  documents the slot with an example.
