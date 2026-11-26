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
    run: async ({ threadId, panel }) => {
      panel.openTab({
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

### Loading a surface's code when it first renders

bb loads every enabled plugin's `app.js` at startup. Keep the entry small:
register surfaces there and load any surface that is not on screen at startup
(a settings section, a panel, a dialog, a tab) with `experimental_lazy`. It
takes the same loader as `React.lazy` and returns a component to pass straight
to the slot:

```tsx
import { definePluginApp, experimental_lazy } from "@get-bb/plugin-sdk/app";

const AccountSettings = experimental_lazy(() =>
  import("./ui/AccountSettings.js").then((module) => ({
    default: module.AccountSettings,
  })),
);

export default definePluginApp((app) => {
  app.slots.settingsSection({ id: "accounts", component: AccountSettings });
});
```

- Call it once at module scope. Keep hooks the host calls outside render
  (`useVisible`, `experimental_usePageTitle`) and their imports out of the
  lazy module, or they pull it back into the entry.
- bb downloads and evaluates lazy chunks once startup settles, so a surface
  opened afterwards renders in its first frame.
- Hosts that stack entries (Info rows and sections, context card rows, the
  rail, settings sections) show an entry only once the entries above it are
  ready, holding them at most 3 seconds behind a slow one, which then appears
  in its place when it loads. Lazy parts on the screen bb restores
  (your panel or settings page, the open right-panel tab, Info sections when
  Info is open) start loading as soon as your plugin registers, and your
  panel or settings page shows once the parts on it load.
- A chunk that fails to load crashes only its slot, which reaches `onCrash`.
- Wrapping the lazy component in your own function hides it from hosts; pass
  it directly. Plain `React.lazy` still works but suspends after the host has
  shown its neighbours.

### A button in the thread header

A thread action with `placement: "header"` is a button in the open thread's
header after the workspace's Open button: `icon` and `label`, `detail` as its
tooltip, red for `variant: "destructive"`; several share a split button. On
phones and narrow split panes it folds into the thread menu, at the top. It
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
        renderItem={(item) => <InfoListRow leading={<Glyph />} name={item.name} onSelect={() => openAutomation(item.id)} />} />
    </InfoSection>
  );
}
```

Components receive `{ threadId, projectId, environment }` and mount once per
visible thread; `environment` is `{ id }` taken from the thread, null only when
the thread has no environment. Read state the way bb's rows do:
`experimental_useThread(threadId)`, `experimental_useEnvironment(environment.id)`
(the environment plus bb's `label` and its machine `host`) and
`experimental_useThreadStorageFiles(threadId, { enabled })` (`enabled: false`
pauses it while hidden); all three share bb's caches and
return `{ status, ... }` with `loading`/`ready`/`notFound` or `error`. Return
null to show nothing; the tab says "No thread details available." only when
no row or section rendered. A row renders `experimental_DetailRow`.
Entries sort by `group`, then `order` within it (unset last), then registration
order, bb's first on a tie, as thread actions do. Join one of bb's groups from
`experimental_THREAD_INFO_ROW_GROUPS` or `experimental_THREAD_INFO_SECTION_GROUPS`
(bb's entries use orders 10, 20, 30 within a group), or name your own group to
sort it where its string falls. Inside a section slot `experimental_InfoSection` collapses and bb
remembers it per registration. A crash removes only that row or section.
`experimental_ThreadInfo` is the whole Info body (bb's tab registers it as its
component); register it in a thread tab of your own to show the same rows.

### Context beside a thread's composer

`app.slots.experimental_threadContextSegment({ id, title, group, order?, summary, action?, details?, useVisible? })`
adds a segment to the context row above an open thread's composer; bb's parent
thread and the Git plugin's changed files use it too. `group`/`order` sort as for Info rows; bb's
groups are `experimental_THREAD_CONTEXT_SEGMENT_GROUPS`, and any other string
sorts in place (GitHub PR Status uses `"2_pullRequest"`). Each component mounts
in its own crash boundary: `summary` in the row, `action` at its end, `details`
below it. Props carry `threadId`, `projectId`, `environment` (null without a
usable environment), the visible `segments` as `{ key, pluginId }` in row
order (`key` is `<pluginId>/<id>`; bb's own use `bb--core`), `isExpanded`/
`onToggle` (one segment is expanded at a time) and `toggleRef`/`collapseRef`
(bb moves focus between them). `useVisible(input)` false leaves it out. Focus
handoff, related-thread data, and hiding while the pane shows the context card
(`experimental_useThreadContextKind()`): frontend-thread-context-card.md.

### An action in every thread menu

`app.slots.experimental_threadAction` adds an entry to the thread header's
actions menu, the sidebar row's menu, its right-click menu, the compact
long-press drawer, and, when the user picks it in Customize actions, a
sidebar row's quick-action buttons. bb's own actions are registrations of the
same shape.

`useData` is a hook the host runs once for the whole app, never per row: read
your preferences or a realtime channel there. It receives `{ threadIds,
experimental_threads }`: the sorted ids of every thread on screen or in an
open menu, and the targets `item` gets for them. Read thread fields such as
`environment` (its `id`, checkout `path`, setup `status`, and machine
`hostLifecycle`) from `experimental_threads`; never fetch each thread. For other
per-thread state, keep an id-keyed cache and fetch only the ids not in it, in
one batch (for example
`useSdk().threads.experimental_listPluginMetadata({ threadIds })`).
`item` is pure: it gets `{ thread, data }` plus the [callback context](frontend-hooks-and-ui.md#callback-context)
`{ sdk, navigate, panel }`, and returns the action for that thread, or
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
`inline` (`{ key, group, action }`). Pass the thread you hold (a
`PluginSidebarThread`) as `thread`: bb reads only its `id` and builds the
target its actions see itself, the same as in its own menus, so never map
threads to targets yourself. `trigger` is a function: spread the props
and ref it receives onto your button, or the menu never opens. `experimental_useThreadActions(thread, { keys })` returns bound
actions for quick-action buttons, and
`experimental_useThreadActionRegistrations()` lists every action's static
title and icon for a picker. Keys are `bb--core/<id>` and `<pluginId>/<id>`.

### A control in the Browser toolbar

`app.slots.experimental_browserToolbarAction` renders a component beside the
address bar of every built-in Browser tab. The component receives the tab's
owner as `threadId`, current `tabId`, top-level `url`, and `isCompactViewport`
state. `threadId` is a thread id only in a thread's side panel; on the New
thread screen and plugin pages it is an opaque panel key. Pass it with `tabId`
to `sdk.experimental_desktopBrowsers` calls; do not treat it as a thread.
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

Replacing the sidebar thread list (`experimental_threadList`), reading live
threads, and windowing rows against the sidebar scroller are covered in
frontend-thread-list.md.

## Tab API migration

See [the unified tab contract and migration examples](frontend-core-slots.md#tab-api-migration)
for replacing legacy registrations while preserving published bundles and saved tabs.
