# Replacing the sidebar thread list

`app.slots.experimental_threadList` is exclusive (see exclusive-slots.md): only
one list fills the sidebar's scroll area. bb ships its own list as the bundled
`thread-list` plugin; there is no separate built-in list.

Your component gets the scrolling list and nothing else. The New-thread button,
the navigation, and the footer stay host-rendered —
other plugins live in two of those, so a replaced list must not remove them.
Put your own controls at the top of your scroll area instead.

If no thread list plugin is enabled, bb shows a placeholder that links to
Plugins. If the active component throws, bb shows the bundled list with a
toast whose action is Reload; the pick does not change. If the bundled list
itself throws, bb shows a "stopped working" placeholder with a Reload button.
Nothing else in the sidebar is affected.

The component receives:

```ts
interface PluginThreadListProps {
  activeThreadId: string | null;
  activeProjectId: string | null;
  isCompactViewport: boolean;
  /** Closes the mobile drawer. Always call it after opening a thread. */
  onNavigate: () => void;
  /** The sidebar element that scrolls your list. */
  experimental_scrollElement: HTMLElement;
}
```

**Windowing and autoscroll.** Window rows, root an `IntersectionObserver`,
and drag-autoscroll against `experimental_scrollElement` instead of walking
up the DOM for an `overflow: auto` ancestor or querying bb's markup. bb
mounts your list only after the element exists, so it is set on the first
render; it changes only when your list remounts. bb's own list windows against it; with
`@tanstack/react-virtual`:

```tsx
function List({ experimental_scrollElement }: PluginThreadListProps) {
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => experimental_scrollElement,
    estimateSize: () => 30,
  });
}
```

**Reading and acting on threads.** One hook reads the list; writes go through
the plugin SDK and navigation:

```tsx
const { status, threads, projects, sections } =
  experimental_useSidebarThreads();
const navigate = useBbNavigate();
navigate.toThread(thread.id, { split: true });
navigate.toCompose({ projectId, placement: { sectionId, pinned: false } });
const archiveEnvironmentThreads = experimental_useArchiveEnvironmentThreads();

// sections: PluginSidebarSection[] — { id, name, createdAt, updatedAt } in
// server order. A thread's `sectionId` names one of these or is null for the
// loose "Threads" bucket. Create, rename, and delete sections and move
// threads between them through the public API client; the sidebar refreshes
// over realtime:
const sdk = useSdk();
await sdk.threadSections.create({ name: "Later" });
await sdk.threads.update({ threadId: thread.id, sectionId });

// threads: PluginSidebarThread[] — id, projectId, href (put it on the row's
// anchor; the host routes clicks in place), title, titleFallback,
// displayTitle, parentThreadId, parentNotifications ("auto" | "stuck" | "off"),
// lifecycleOwnerThreadId, sourceThreadId, sectionId,
// originKind, originPluginId, providerId, status (execution status; busy
// threads sort first in bb's list), runtimeStatus (status refined by host
// readiness), queuedWork ("none" | "waiting" | "failed"), hasPendingInteraction,
// activity, isUnread/isPinned/pinnedAt/isArchived/archivedAt, pinSortKey
// (manual pin order),
// isHidden (bb's list filters these out; the array keeps them),
// environment { id, name, branchName, path, isWorktree, providerId,
// workspaceDisplayKind }, where workspaceDisplayKind is deprecated
// compatibility data; host { id, name }, createdAt, updatedAt, lastReadAt,
// latestAttentionAt, and `indicator` (bb's resolved status kind) +
// `indicatorLabel` (its a11y string). Draw it with `experimental_ThreadStatusGlyph`
// or your own glyph. Treat an unknown indicator, status, or runtimeStatus
// value as its documented fallback — bb adds kinds over time.

// Three more per-row facts are client-local, so they are hooks rather than
// fields on the thread: an unsent composer draft (bb paints a pencil, or a
// "working-draft" glyph when the thread is busy), a row status another
// plugin's app-wide script set (bb draws it in place of the draft glyph), and
// the jump shortcut bb assigns while the app command modifier is held (bb
// shows a key pill). Compose them with `indicator` yourself:
const { hasUnsubmittedDraft } = useSidebarThreadDraft(thread.id);
const rowStatus = useSidebarThreadRowStatus(thread.id); // { icon, label, tone? } | null
const shortcut = useSidebarThreadShortcut(thread.id); // { label, ariaKeyshortcuts } | null
const draftIds = useSidebarThreadDraftIds(); // ReadonlySet<string>, for group rollups
const rowStatuses = useSidebarThreadRowStatuses(); // ReadonlyMap, for group rollups
const splitLayout = useSidebarSplitLayout(); // { panes: [{ paneId, rect, threadId, isFocused }] } | null
const one = experimental_useThread(thread.id); // { status: loading | ready | notFound | error, thread }
// projects: PluginSidebarProject[] — { id, name, isPersonal, href, settingsHref }

// Titles can contain @project:, @section:, and @thread: mentions. `displayTitle`
// is the resolved plain text (sort on it, use it for aria-label); <ThreadTitle>
// renders the same text with bb's mention chips:
<span className="truncate">
  <ThreadTitle threadId={thread.id} />
</span>;

// `environment.providerId` names an entry in bb's environment provider
// catalog; resolve it for a display name, and draw it with a capitalized
// `experimental_ProviderIcon` alias (`providerKind="environment"`, `provider={entry}`):
const { providers: environmentProviders } = useEnvironmentProviders();

// Pull requests: read the GitHub PR Status plugin by thread.environment?.id
// (references/frontend-pull-requests.md).

navigate.toThread(id, { split: true }); // bb's split placement rules
navigate.toCompose({ projectId, focusPrompt: true });
navigate.toCompose({ projectId, placement: { sectionId, pinned: false } }); // file it under a section
navigate.toCompose({ projectId, environmentId }); // reuse an environment
navigate.toCompose({ projectId, focusPrompt: true, split: true }); // beside the open panes
await sdk.threads.pin({ threadId: id }); // optimistic in bb's surfaces
await sdk.threads.markUnread({ threadId: id });
await sdk.threads.update({ threadId: id, title: "New title" }); // silent; for inline editing
```

Archive and delete go through bb's thread menu (below), which owns the
confirmations: archiving a thread with children asks first and counts them,
and deletion always asks.

Unit-test a list with `renderSlot(...)` from `@get-bb/plugin-sdk/testing/app`:
seed rows with the `sidebarThreads` option (plus `sidebarDraftThreadIds`,
`sidebarRowStatuses`, and `sidebarShortcuts` for the per-row hooks) and assert against
`inspection.navigateCalls` and `inspection.sdkCalls`.

**Pull requests on a row.** Read them from the bundled GitHub PR Status
plugin; see references/frontend-pull-requests.md.

**Splits.** Rows can drag out to the split area:

```tsx
const { splitProps, isAvailable, layout } =
  experimental_useSidebarThreadSplit(thread.id);

<a {...splitProps} onClick={openThread}>
  {title}
  {/* layout is data: draw a mini-map, a tint, or nothing */}
</a>;
```

The host owns the gesture rules, including the one that matters if your list
has its own drag-to-reorder: a split drag engages only once the pointer leaves
the sidebar.

**bb's menu on your row.** Render `experimental_ThreadActionsMenu` and
`experimental_ThreadActionsContextMenu` around your row for bb's own thread
menu (archive and delete confirmation included) plus every plugin's thread
actions; see "An action in every thread menu" in frontend-registration.md.
For multi-row selections (`experimental_bulkItem`), see frontend-sidebar-navigation.md.
`experimental_useThreadRequests()` archives or deletes any threads with bb's confirmation and Undo.
`experimental_useArchiveEnvironmentThreads()` archives a whole environment group (every live thread the server finds there, without a confirmation) with bb's pane cleanup and Undo toast.

**bb's status glyph on your row.** Pass the row's thread, its hidden children,
its draft, and `useSidebarThreadRowStatus(threadId)` to
`experimental_resolveThreadStatus` (bb's lists use the same function), then
render `experimental_ThreadStatusGlyph` with the result's `indicator` and
`rowStatus`; `label` and `isWorking` cover anything else you draw.

**Keyboard support is a DOM contract.** bb's thread shortcuts find rows by
query selector, not by React state. Put both attributes on each row's anchor or
the surface-specific numbered shortcuts, `thread.next`, and `thread.previous`
silently stop working:

```tsx
<a data-sidebar-thread-shortcut-target="" data-sidebar-thread-id={thread.id}>
  {thread.displayTitle}
</a>
```
