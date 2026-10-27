# Frontend registration and major surfaces

## Frontend (`bb.app` entry)

`app.tsx` default-exports `definePluginApp` from `@get-bb/plugin-sdk/app`.
React and the SDK are **never bundled** — `bb plugin build` shims them to
the host's shared runtime, so the bundle only works inside bb.

```tsx
import {
  definePluginApp,
  useRpc,
  useRealtime,
  useRealtimeConnectionState,
  useSettings,
  useBbContext,
  useBbNavigate,
  experimental_FileLink as FileLink,
  UrlLink as UrlLink,
  useComposer,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner"; // shimmed to the host toaster
import { Button } from "@/components/ui/button"; // vendored source YOU own
import { Dialog, DialogContent } from "@/components/ui/dialog";

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "editor-enhancement",
    mount({ pluginId, generation, signal }) {
      const onKeyDown = (event: KeyboardEvent) => {
        // Ordinary trusted, same-origin DOM behavior.
      };
      document.addEventListener("keydown", onKeyDown, { signal });
      return () => document.removeEventListener("keydown", onKeyDown);
    },
  });
  app.slots.homepageSection({
    id: "issues",
    title: "Open issues",
    component: IssuesSection,
  });
  app.slots.settingsSection({
    id: "settings",
    title: "Connection",
    description: "Configure the remote service used by this plugin.",
    component: SettingsSection,
  });
  app.slots.experimental_appOverlay({
    id: "floating-status",
    component: FloatingStatus,
  });
  app.slots.navPanel({
    id: "board",
    title: "Board",
    icon: "Columns",
    path: "board",
    component: Board,
    experimental_useBadge: useOpenIssueBadge,
  });
  app.slots.experimental_tab({
    context: { kind: "nav-panel", panelId: "board" },
    availability: "fixed",
    id: "navigation",
    title: "Navigation",
    icon: "PanelRight",
    component: BoardNavigation,
    layout: "flush",
  });
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "action",
    icon: "FileText",
    id: "issue",
    title: "Open issue",
    component: IssuePanel,
    run: async ({ threadId, experimental_panel }) => {
      experimental_panel.openTab({
        tab: { id: "issue", context: { kind: "thread" }, availability: "action" },
        title: `Issue for ${threadId}`,
      });
    },
  });
  app.slots.experimental_newThreadPanelAction({
    id: "template",
    title: "Apply template",
    component: TemplatePanel,
  });
  app.composer.customize({
    id: "prompt-tools",
    actions: [{ id: "improve", component: ImprovePromptAction }],
    plusMenu: [
      {
        id: "append-checklist",
        label: "Append checklist",
        run: ({ composer }) =>
          composer.insert("- Verify behavior\n- Run checks", {
            at: "end",
            block: true,
          }),
      },
    ],
    banners: [{ id: "workflow", component: WorkflowBanner }],
    richText: {
      effects: [
        {
          id: "todo",
          className: "plugin-todo-highlight",
          match: (text) =>
            Array.from(text.matchAll(/\bTODO\b/g), (match) => ({
              from: match.index,
              to: match.index + match[0].length,
            })),
        },
      ],
    },
  });
  app.slots.pendingInteraction({
    id: "credentials",
    component: CredentialForm,
  });
  app.experimental_sidebarFooter.register({
    kind: "action",
    id: "remote",
    label: "Remote access",
    icon: "Smartphone",
    onActivate: ({ openPluginDetails }) => openPluginDetails(),
  });
  app.slots.messageDirective({ id: "inline-vis", component: InlineVis });
  app.slots.experimental_codeFenceRenderer({
    id: "ui-blocks",
    languages: ["ui"],
    component: UiBlock,
  });
  app.slots.experimental_threadList({
    id: "inbox",
    title: "Inbox",
    description: "One flat list, newest thread on top.",
    component: InboxList,
  });
  app.slots.experimental_sidebarNavigation({
    id: "compact",
    title: "Compact navigation",
    placement: "list",
    component: CompactSidebarNavigation,
  });
});
```

### A button in the thread header

A thread action with `placement: "header"` is a button in the open thread's
header instead of a menu entry. It shows after the workspace's Open button
with its `label` (several share one split button). On phones and in narrow
split panes it folds into the header's thread menu, as a row at the top. It
never appears in other menus, the quick-action picker, or
`experimental_useThreadActions`. Its `useData` receives only the threads
whose header is on screen. Return null from `item` whenever the button does
not apply. Header buttons do not show `choices`. bb's Git plugin registers
Commit this way.

```tsx
app.slots.experimental_threadAction({ id: "deploy", title: "Deploy", icon: "Rocket", group: "deploy", placement: "header",
  useData: ({ threadIds }) => useDeployable(threadIds),
  item: ({ thread, data }) => data.has(thread.id) ? { label: "Deploy", icon: "Rocket", run: () => openDeploy(thread.id) } : null });
```

`app.slots.experimental_threadHeaderAction` is retired: existing callers keep
rendering and `bb plugin build` warns. Use a header thread action instead.

### Rows and sections in the thread Info tab

`app.slots.experimental_threadInfoRow` adds a row to the Info tab's details
block; `app.slots.experimental_threadInfoSection` adds a section below it. bb's
own rows and sections are registrations of the same `{ id, group, order?,
component }` shape, drawn with the SDK's Info components (frontend-components.md).

```tsx
app.slots.experimental_threadInfoSection({ id: "automations", group: SECTION_GROUPS.related, order: 0, component: Automations });
function Automations({ threadId }: ExperimentalThreadInfoProps) {
  const items = useItems(threadId);
  if (items.length === 0) return null;
  return (
    <InfoSection label="Automations" count={items.length}>
      <InfoList items={items} getKey={(item) => item.id} limit={3}
        renderItem={(item) => <InfoListRow leading={<Glyph />} name={item.name} onSelect={...} />} />
    </InfoSection>
  );
}
```

Components receive `{ threadId, projectId, environment }` and mount once per
visible thread; `environment` is `{ id }` taken from the thread, null only when
the thread has no environment; read its state yourself. Return
null to show nothing. A row renders `experimental_DetailRow`.
Entries sort by `group`, then `order` within it (unset last), then registration
order, bb's first on a tie, as thread actions do. Join one of bb's groups from
`experimental_THREAD_INFO_ROW_GROUPS` or `experimental_THREAD_INFO_SECTION_GROUPS`
(bb's entries use orders 10, 20, 30 within a group), or name your own group to
sort it where its string falls. Inside a section slot `experimental_InfoSection` collapses and bb
remembers it per registration. A crash removes only that row or section.

### Context beside a thread's composer

`app.slots.experimental_threadContextSegment({ id, title, group, order?, summary, action?, details?, useVisible? })`
adds a segment to the context row above an open thread's composer; bb's parent
thread and changed files use it too. `group`/`order` sort as for Info rows; bb's
groups are `experimental_THREAD_CONTEXT_SEGMENT_GROUPS`, and any other string
sorts in place (GitHub PR Status uses `"2_pullRequest"`). Each component mounts
in its own crash boundary: `summary` in the row, `action` at its end, `details`
below it. Props carry `threadId`, `projectId`, `environment` (null without a
usable environment or when "Show Git changes" is off), the visible `segments`
as `{ key, pluginId }` in row order (`key` is `<pluginId>/<id>`; bb's own use
`bb--core`), and `isExpanded`/`onToggle` (one segment is expanded at a time).
`useVisible(input)` false leaves it out.

### An action in every thread menu

`app.slots.experimental_threadAction` adds an entry to the thread header's
actions menu, the sidebar row's menu, its right-click menu, the compact
long-press drawer, and, when the user picks it in Customize actions, a
sidebar row's quick-action buttons. bb's own actions are registrations of the
same shape.

`useData` is a hook the host runs once for the whole app, never per row: read
your preferences or a realtime channel there. It receives `{ threadIds }`, the
sorted ids of every thread on screen or in an open menu; for per-thread state,
keep an id-keyed cache and fetch only the ids not in it, in one batch (for
example `useSdk().threads.experimental_listPluginMetadata({ threadIds })`).
`item` is pure: it gets `{ thread, data, sdk, navigate }` (your bound
`useSdk()` and `useBbNavigate()`) and returns the action for that thread, or
null to hide it. Menus and the quick-action picker sort registrations by
their static `group`, a separator between groups, then by `order`. Join one
of bb's groups through `experimental_THREAD_ACTION_GROUPS` (`open`, `state`,
`organize`, `settings`, `lifecycle`) or name your own. Within a group, give an
action with `choices` a higher `order` than plain actions so items that open a
submenu sit last. `choices` renders as a submenu, a drawer step with Back, or
a popover; the picked id reaches `run` as `value`. Set `detail` to the
current value: it shows on a muted line under the label, except on rows with
`choices`, where only tooltips and screen readers include it. Set
`choices.hint` for a footnote below the choices.

```tsx
app.slots.experimental_threadAction({
  id: "notifications",
  title: "Notifications",
  icon: "Notification",
  group: experimental_THREAD_ACTION_GROUPS.state,
  useData: ({ threadIds }) => useNotificationLevels(threadIds),
  item: ({ thread, data, sdk }) => ({
    label: "Notifications",
    detail: data.get(thread.id) === "muted" ? "Muted" : "All activity",
    icon: "Notification",
    choices: {
      items: [
        {
          id: "all",
          label: "All activity",
          selected: data.get(thread.id) === "all",
        },
        {
          id: "muted",
          label: "Muted",
          selected: data.get(thread.id) === "muted",
        },
      ],
    },
    run: ({ value }) => saveLevel(sdk, thread.id, value),
  }),
});
```

A replacement thread list renders bb's menus with
`experimental_ThreadActionsMenu` and `experimental_ThreadActionsContextMenu`,
passing its own rename editor as `requestRename` and list-only entries as
`inline` (`{ key, group, action }`). `trigger` is a function: spread the props
and ref it receives onto your button, or the menu never opens. `experimental_useThreadActions(thread, { keys })` returns bound
actions for quick-action buttons, and
`experimental_useThreadActionRegistrations()` lists every action's static
title and icon for a picker. Keys are `bb--core/<id>` and `<pluginId>/<id>`.

### A control in the Browser toolbar

`app.slots.experimental_browserToolbarAction` renders a component beside the
address bar of every built-in Browser tab. The component receives the owning
`threadId`, current `tabId`, top-level `url`, and `isCompactViewport` state.
Use these host-provided values to scope actions to the visible tab; do not infer
the active Browser from global state.

```tsx
app.slots.experimental_browserToolbarAction({
  id: "annotate",
  title: "Annotate page",
  component: ({ threadId, tabId, url, isCompactViewport }) => { ... },
});
```

Render a compact toolbar control and move larger UI into a host-owned panel or
portalled popover. `title` names the host wrapper; icon-only controls still need
their own accessible name. A component instance belongs to one Browser tab and
must release tab-scoped resources when it unmounts.

`experimental_page` scripts the tab's top-level document in the desktop app and
is `null` elsewhere. It does not take a CDP control lease, so no control banner
appears and agent automation can keep its debugger.

```tsx
component: ({ experimental_page: page }) => {
  useEffect(() => page?.onMessage((data) => console.log(data)), [page]);
  const pick = () =>
    page?.evaluate(
      "(document.addEventListener('click', (e) => bb.postMessage(e.target.tagName), { once: true }), true)",
    );
  ...
}
```

`evaluate(expression, { world })` awaits the expression and resolves its
JSON-cloned value. The default `isolated` world shares the DOM but not page
globals and binds `bb.postMessage(data)`; `onMessage` receives those values for
this plugin and tab. `world: "main"` runs beside page scripts (for example to
read framework state on DOM nodes) and binds `bb` to `null`. Anything installed
is lost when the document navigates; check again when `url` changes.

### Sidebar navigation and header

Drawing the sidebar navigation (`experimental_sidebarNavigation`) and its
controls beside the sidebar toggle (`headerComponent`) are covered in
frontend-sidebar-navigation.md.

### Replacing the sidebar thread list

`app.slots.experimental_threadList` is the one **exclusive** slot: only one
list fills the sidebar's scroll area. Registering activates the replacement
while the plugin is enabled. If multiple plugins register one, the first in
deterministic slot order is active by default; removing it reveals the next.
The user can pin a specific provider under **Settings → Appearance →
Sidebar**. The choice is per client. bb ships its own list as the bundled
`thread-list` plugin; there is no separate built-in list.

Your component gets the scrolling list and nothing else. The New-thread button,
the navigation, and the footer stay host-rendered —
other plugins live in two of those, so a replaced list must not remove them.
Put your own controls at the top of your scroll area instead.

If no thread list plugin is enabled, bb shows a placeholder that links to
Plugins. If the active component throws, bb shows a "stopped working"
placeholder with a Reload button plus one toast; nothing else in the sidebar
is affected.

The component receives:

```ts
interface PluginThreadListProps {
  activeThreadId: string | null;
  activeProjectId: string | null;
  isCompactViewport: boolean;
  /** Closes the mobile drawer. Always call it after opening a thread. */
  onNavigate: () => void;
  /** Deprecated compatibility value for the removed sidebar search field.
      The host always supplies "". */
  searchQuery: string;
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
await sdk.threads.update({ id: thread.id, sectionId });

// threads: PluginSidebarThread[] — id, projectId, href (put it on the row's
// anchor; the host routes clicks in place), title, titleFallback,
// displayTitle, parentThreadId, lifecycleOwnerThreadId, sourceThreadId, sectionId,
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
// `indicatorLabel` (its a11y string). Draw your own glyph for `indicator`;
// the SDK ships no status component. Treat an unknown indicator, status, or
// runtimeStatus value as its documented fallback — bb adds kinds over time.

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
// projects: PluginSidebarProject[] — { id, name, isPersonal, href, settingsHref }

// Titles can contain @project:, @section:, and @thread: mentions. `displayTitle`
// is the resolved plain text (sort on it, use it for aria-label); <ThreadTitle>
// renders the same text with bb's mention chips:
<span className="truncate">
  <ThreadTitle threadId={thread.id} />
</span>;

// `environment.providerId` names an entry in bb's environment provider
// catalog; resolve it for a display name, and draw it with
// <experimental_ProviderIcon providerKind="environment" provider={entry} />:
const { providers: environmentProviders } = useEnvironmentProviders();

// Pull requests: read the GitHub PR Status plugin by thread.environment?.id
// (references/frontend-pull-requests.md).

const navigate = useBbNavigate();
const sdk = useSdk();
navigate.toThread(id, { split: true }); // bb's split placement rules
navigate.toCompose({ projectId, focusPrompt: true });
navigate.toCompose({ projectId, placement: { sectionId, pinned: false } }); // file it under a section
navigate.toCompose({ projectId, environmentId }); // reuse an environment
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

<a {...splitProps} onClick={...}>
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
actions; see "An action in every thread menu".
For multi-row selections (`experimental_bulkItem`), see frontend-sidebar-navigation.md.
`experimental_useArchiveEnvironmentThreads()` archives a whole environment
group with bb's pane cleanup and Undo toast.

**bb's status glyph on your row.** Render `experimental_ThreadStatusGlyph`
with the row's `indicator` (start from the thread's own, then fold in what
your row knows, such as collapsed children or `useSidebarThreadDraft`) and
`useSidebarThreadRowStatus(threadId)` as `rowStatus`; bb draws the same icon,
color, and accessible label its own lists use.

**Keyboard support is a DOM contract.** bb's thread shortcuts find rows by
query selector, not by React state. Put both attributes on each row's anchor or
the surface-specific numbered shortcuts, `thread.next`, and `thread.previous`
silently stop working:

```tsx
<a data-sidebar-thread-shortcut-target="" data-sidebar-thread-id={thread.id}>
```

## Tab API migration

See [the unified tab contract and migration examples](frontend-core-slots.md#tab-api-migration)
for replacing legacy registrations while preserving published bundles and saved tabs.
