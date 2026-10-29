# Content scripts and core slots

### Trusted frontend content scripts

`app.contentScripts.register({ id, mount })` runs ordinary
bundled JavaScript/TypeScript in the bb app shell without a React slot. It is
full-trust, same-origin page code — **not a security sandbox**. It can access
the app DOM and any authenticated client state available to ordinary page
code, so install only plugins you trust. bb does not use `eval`, `Function`,
or persisted source strings: the existing `bb.app` build emits a normal CSP-
compatible ESM bundle.

The host mounts scripts in registration order after the bundle loads and
`definePluginApp` setup validates. `mount` receives
`{ pluginId, generation, signal, experimental_setThreadRowStatus? }`:
`generation` is a monotonic per-window mount attempt number, and `signal`
aborts before cleanup starts. The optional experimental setter targets an
explicit thread row with `{ icon, label, tone? }` or clears it with `null`.
Use `tone: "running"` for the host's animated running treatment. The host
scopes statuses to the calling plugin and automatically clears them when that
frontend generation deactivates; feature-detect the setter for compatibility
with older bb clients.

A script may return nothing, a disposer, or a promise of either; async mount
setup is time-boxed to 10 seconds. Keep long-running work outside the returned
promise, observe `signal`, and catch failures in work the host does not await.

A replacement bundle and setup validate before lifecycle cutover. The host
then aborts and disposes the prior generation before mounting candidate scripts,
so listeners and observers never overlap. If a mount throws or rejects, the
host aborts that candidate, disposes already-mounted candidate scripts in
reverse registration order, and publishes none of its slots or CSS. Import or
setup failure also deactivates stale UI because the corresponding backend may
already have been replaced. Disable, stop, removal, and app-window teardown
follow the same abort-then-reverse-dispose path; every returned disposer is
called at most once. Each desktop window, browser tab, and remote client owns
an independent instance.

Synchronous and awaited asynchronous mount/dispose failures are contained and
logged; they cannot stop sibling plugins from activating. The current
window's last load/setup/mount/dispose failure appears on the plugin Settings
detail page. The host cannot catch a detached promise that plugin code creates
and never returns, so detached work must handle its own errors.

Prefer the existing imported `app.css` pipeline for static styles. Its lifetime
follows the plugin UI and content scripts that use it: the host keeps the
stylesheet active while a slot, panel header/accessory, or plugin portal is
rendered and throughout an active content-script generation, then releases it
after the final consumer. Imported `app.css` is therefore not an app-wide CSS
hook. Put app-wide selectable palette CSS in manifest `bb.themes` entries;
theme CSS has an independent app-theme lifetime.

Styling or decorating existing app-shell DOM belongs in a content script. A
content script may create DOM or `<style>` nodes when behavior genuinely
requires it, but its abort handler/disposer must remove every node, observer,
listener, timer, class, and style it owns. The context deliberately has no
route/project/thread snapshot yet; use stable SDK hooks inside React slots
rather than polling or installing global navigation observers. Complete
cleanup-safe example: `examples/plugins/content-script`.

Slot props contracts (versioned, additive-only):

- `homepageSection` → `{ projectId: string | null }` (project in view on
  the compose surface). Registration: `{ id, title, component }`.
- `settingsSection` → `{}` (deliberately no props in V1). Rendered on the
  plugin detail page below the host-rendered declarative settings
  form for running, needs-configuration, and degraded plugins. Registration:
  `{ id, title?, description?, component }`; `title` is an optional host-rendered
  section heading and `description` is optional supporting copy rendered with
  that heading. Use the existing hooks (`useRpc`, `useRealtime`,
  `useRealtimeConnectionState`, `useSettings`, `useBbNavigate`, `useBbContext`)
  for data. Enabled plugins appear in the
  settings sidebar when they declare settings descriptors OR register
  settings sections.
- `experimental_appOverlay` → `{}` (deliberately no props). An additive,
  app-wide React owner for floating plugin UI. Registration:
  `{ id, component }`. BB mounts every registration once per app window
  through `PluginSlotMount`, outside route-owned layout regions. The component
  can therefore call app-level SDK hooks, including the sidebar thread data and
  action hooks, and keep their React contexts through a portal. Hooks whose
  contract requires a particular surface, including `useComposer`, remain
  limited to that surface. BB supplies no chrome,
  positioning, visibility, focus, or responsive behavior; render fixed UI
  directly or use the vendored responsive overlay primitives. A crash hides
  only that overlay. Use a content script instead for DOM enhancement that does
  not need React context. Experimental: see `docs/api_to_audit.md`.
- `navPanel` → `{ subPath: string }` — owns the whole route at
  `/plugins/<pluginId>/<path>/*` and gets its own navigation rail destination. `subPath`
  is the route remainder after the panel root (`""` at the root) as it appears
  in the URL, with each segment still percent-encoded, so deep links like
  `/plugins/notes/notes/work/my%20ideas.md` land with
  `subPath: "work/my%20ideas.md"`; decode each segment with
  `decodeURIComponent`. Navigate within the panel via
  `useBbNavigate().toPluginPanel(path, { subPath, replace? })`, passing
  unencoded segments (bb encodes them) — browser back/forward then walks
  panel-internal history (prefer this over hash routing).
  Registration:
  `{ id, title, icon, path, component, experimental_useBadge?, experimental_usePageTitle?, headerContent?, experimental_sidebar? }`.
  The host renders your compact plugin icon + `title` into the shared app
  header (the same title bar as Settings pages) with your optional
  `headerContent` component as the header actions on the right — so do not
  repeat the title inside your component. The component owns the full-bleed
  body below with zero host padding; add your own padding and scrolling when
  the design needs them. For a classic page, use an outer scroll region with
  `p-4 md:p-5` and wrap its content in a `mx-auto w-full max-w-3xl space-y-4`
  div. `headerContent` is contained separately: a throw hides the header
  content without breaking the title bar or the panel body.

  BB wraps every plugin page in the same host-owned App panel used by New
  thread and thread pages, with Browser and Terminal tabs (a plugin page has
  no implicit project, so New tab offers no workspace file search). The page
  component must not mount a second panel layout or register Browser and
  Terminal itself. BB owns the desktop split, compact drawer, header/panel
  toggle, resizing, tab strip, persistence, and the shared `panel.toggle`,
  `panel.newTab`, `panel.reopenClosedTab`, and `terminal.open` keyboard
  commands.

  Add tabs through `experimental_tab` with
  `context: { kind: "nav-panel", panelId }`, `availability: "fixed"` or
  `"action"`, and `id`, `title`, `icon`, `component`, optional `tooltip`,
  `layout`, and `useVisible({ subPath })`. Fixed tabs are non-closable;
  action tabs receive persisted JSON `params` alongside `subPath`.
  BB owns their panel, split layout, selection and persistence.
  For targets and source migration, see [Tab API migration](frontend-registration.md#tab-api-migration).

  `experimental_useBadge` is a React hook that returns the panel's
  navigation badge, `{ count?, text?, tone?, label }`, or `null` for none.
  Set at most one of `count` and `text` (at most 8 characters, such as "NEW"
  or "73%"); `tone` is `neutral` (the default), `warning`, or `critical`, and
  bb picks the colors. BB calls it once
  in the plugin's scope for every registered panel, including ones hidden
  under More, so it can own an RPC query and realtime subscription. Every
  navigation provider receives the value as the item's `badge`. bb's Rail
  draws a count (shown as `9+` above 9) or otherwise a dot on the icon and
  does not draw `text`; its Top list draws the count (`99+`
  above 99), the text, or a dot at the end of the row; both put a dot on
  More, in the strongest hidden tone, while the panel is hidden there. `label` is short text such as
  "3 open tasks" that BB adds to the destination's tooltip and accessible
  name; the drawn badge is hidden from assistive technology. `count` must be a
  positive integer, `text` and `label` non-empty; a hook that throws or returns
  anything else is treated as a crashed slot and shows no badge. SDK 0.6.53
  replaced the component-based `experimental_sidebarAccessory`; a plugin that
  still passes it keeps loading, and BB ignores the field and logs a warning
  naming `experimental_useBadge`. Experimental: see `docs/api_to_audit.md`.

  `experimental_sidebar` is a component that receives the same `{ subPath }`
  as the page and replaces the thread list while the panel's route is active,
  for example a list of the panel's items. BB renders it in the same section
  sidebar as Settings, Plugins and Skills: it keeps the navigation rail, top
  chrome and resize handle, and in the Top list layout adds a "Back to app"
  row and the panel title. Back to app (Escape) returns to the last app page,
  so call `preventDefault()` on Escape your own UI handles. Navigate with
  `useBbNavigate()`; on compact screens BB closes the drawer when the sidebar
  navigates. Other routes keep their usual sidebar. A throw shows a crash
  notice in the sidebar until `subPath` or the plugin generation changes.
  Experimental: see `docs/api_to_audit.md`.

- `experimental_tab` → a tab in a declared thread or navigation-page context.
  Thread components receive `{ threadId }`; navigation-page components receive
  `{ subPath }`. `availability: "fixed"` pins one non-closable destination.
  `availability: "action"` adds a launcher; its component also receives persisted
  JSON `params`, and optional `run` receives context plus `experimental_panel`.
  Without `run`, selection opens with default params. Matching owner/id/params
  focuses an existing instance; different params open siblings. `useVisible`
  controls the fixed destination or action launcher, and never closes opened
  action instances. `tooltip` defaults to title; layout is padded or flush.
  Open tabs with the [panel controller](frontend-hooks-and-ui.md#panel-controller).
  See [Tab API migration](frontend-registration.md#tab-api-migration).
- `experimental_newThreadPanelAction` → the root New thread counterpart to
  thread action tabs. It appears in that screen's right-panel Actions list
  and never appears beside an existing thread. Registration has the same
  `{ id, title, icon?, component, layout?, run? }` shape, but activating it
  calls `run({ projectId, experimental_panel })` and its component receives
  `{ projectId: string | null, params: JsonValue | null }`; `projectId` is
  null in projectless compose. Panel opening, JSON params, layout, persistence,
  deduplication, the `boolean` return, and error containment otherwise match
  thread action tabs.
  Experimental: see `docs/api_to_audit.md`.
- `experimental_environmentProviderInputs` → `{ projectId, target, value,
onChange }` — the control the New Thread environment picker renders beside
  one of this plugin's environment providers while it is selected, for the
  provider's declared `inputs` (backend-events.md). Registration:
  `{ environmentProviderId, component }`. `projectId` is null in projectless
  compose; `target` is `{ kind: "existing-host", hostId }` or
  `{ kind: "new-host" }`; `value` is the inputs the selection will carry
  (null until `onChange` supplies one). Call
  `onChange({ status: "ready", value })` with a value the provider's schema
  accepts, or `onChange({ status: "blocked", reason })` to disable submit with
  that reason; the server parses the value with the schema at create time. A
  provider whose schema rejects `{}` cannot be submitted until its control
  reports ready inputs. Experimental: see `docs/api_to_audit.md`.
- `experimental_machineProviderInputs` → `{ value, onChange }` — the same
  contract for a machine provider's `inputs`, rendered by machine creation
  surfaces and as a compact chip before the environment provider's chip when
  a composition creates the machine. Registration:
  `{ machineProviderId, component }`. Report a ready default on mount and open
  richer configuration in the shared responsive drawer; a blocked or crashed
  control disables submit with its short reason. Machine inputs are persisted
  and readable by every plugin, so emit only non-secret configuration or
  references to credentials held in plugin settings. Experimental: see
  `docs/api_to_audit.md`.
- `pendingInteraction` → `{ interaction, submit, cancel }` — replaces the
  thread composer only while a matching plugin interaction is pending.
  Registration: `{ id, component }`; `id` must equal the backend request's
  `rendererId`. `interaction` contains metadata plus the JSON `payload`;
  `submit(value)` returns the JSON value to the waiting backend invocation,
  while `cancel()` settles it without a value. Keep sensitive field values in
  component state only.
- `experimental_sidebarFooter.register` → managed host-rendered icon items in
  the app sidebar footer. Both variants take `{ id, label, icon }`. An action
  adds `{ kind: "action", onActivate }`; its callback receives
  `openPluginDetails()`. A disclosure adds
  `{ kind: "disclosure", component }`; bb toggles that component above the
  row and passes it only `{ dismiss }`. A disclosure registration returns a
  controller that requests `open`, `close`, or `toggle`; an action registration
  returns nothing. BB keeps only one disclosure open across all plugins.
  The component owns everything inside, including tabs and navigation.
  Experimental: see `docs/api_to_audit.md`.
- `sidebarFooterAction` → compatibility API for a host-rendered footer action.
  Registration remains `{ id, title, icon, run }`, and `run` still receives
  `{ openSettings }`. New plugins should use
  `app.experimental_sidebarFooter.register({ kind: "action", ... })` so actions
  and disclosures share one surface.
- `experimental_sidebarNavigation` → `{ isCompactViewport, placement,
experimental_Original }` — draws the sidebar navigation. Registration:
  `{ id, title, description?, placement?, component, headerComponent? }`,
  where `placement` is `"rail"` or `"list"` (the default). The optional
  `headerComponent` receives `{ width, controlSize, isCompactViewport }` and
  renders in the sidebar header row beside the sidebar toggle while that
  navigation is active. Read items and host actions
  with `experimental_useSidebarNavigation()`. Exclusive; see
  frontend-sidebar-navigation.md. Experimental: see `docs/api_to_audit.md`.
- `experimental_threadList`, `experimental_threadRowMetadata`,
  `experimental_threadInfoRow`, `experimental_threadInfoSection`,
  `experimental_threadContextCardRow`, `experimental_threadContextCardSection`,
  `experimental_threadAction` (menu entries and header buttons), and
  `experimental_browserToolbarAction` are covered in frontend-registration.md.
- `fileOpener` → `{ path: string, source, experimental_lineRange?, Original }` — register as a viewer/editor
  for file extensions: `{ id, title, extensions: ["md"], component }`.
  Matching files use the first applicable opener in deterministic slot order
  by default. Users can pin BB's preview or a specific opener per extension
  under Settings → "File openers", and
  right-clicking a file link in rendered markdown offers a one-off
  "Open with …" choice; matching files opened in the right panel then
  render your component in a plugin tab instead of the built-in preview —
  this includes links clicked in rendered markdown, the file picker, and
  `bb thread open`. `source` is
  `{ kind: "workspace" | "host" | "thread-storage", threadId, environmentId,
projectId, experimental_hostId? }` (nullable fields). The optional host ID
  selects a project-backed workspace host and persists in opener-tab parameters.
  The `path` follows the source (workspace:
  worktree-relative; host: absolute; thread-storage: storage-relative).
  `experimental_lineRange` is a nullable, one-based inclusive
  `{ startLineNumber, endLineNumber }` target. Observe
  object identity: each targeted open supplies a new object, including an
  identical range in the active tab. Apply the latest target after loading
  and on subsequent requests without replacing the editor model; null means
  no requested navigation.
  `Original` is BB's preview bound to this file; render it to
  delegate conditionally without re-entering plugin replacement resolution.
  Applies only to live file content — git-ref snapshots and deleted files
  always use the built-in preview, and a removed/disabled opener degrades
  back to it. Pair with `bb.sdk.files` (rpc from your server) to load and
  CAS-save the content.

### The provider directory

`experimental_useProviders()` returns `{ status, providers }` — every
registered agent provider in picker order, as the same `ProviderInfo` the
host's composer reads (`id`, `pluginId`, `displayName`, `family`, `icon`,
`logoUrl`, `available`, `capabilities`, `maintenance`, `extensionKinds`,
`composerActions`, and the declared `strings`, `reasoningLevels`,
`serviceTiers`). It reads the host's own cached roster, so
it costs no extra request. Use it whenever a surface shows a thread's or
automation's provider: never vendor provider names or copy in a plugin.

```tsx
const { providers } = experimental_useProviders();
const name =
  providers.find((provider) => provider.id === thread.providerId)
    ?.displayName ?? thread.providerId;
```

`status` is `"loading"` until the roster arrives and `"error"` when the request
failed; `providers` is empty in both cases, so fall back to the id. The
backend counterpart is `bb.sdk.providers.list()`. Keep the hook in the plugin
entry (`app.tsx`) and pass names down as props, so view components stay pure
and testable outside the plugin runtime.

## Tab API migration

Use `app.slots.experimental_tab` for tabs on thread and plugin navigation pages.
Declare `context: { kind: "thread" }` for `{ threadId, environment }`, or
`context: { kind: "nav-panel", panelId: "board" }` for `{ subPath }`.
`environment` is `{ id }` taken straight from the thread, null only when the
thread has no environment; read anything else about it (status, path) yourself
and show the tab's own loading, failure and Retry.
Choose `availability: "fixed"` for one non-closable destination or `"action"`
for a launcher opening closable instances with persisted JSON `params`.
Only actions accept `run`, default `params`, and per-open `params`/`title`.
`useVisible` receives the context props and controls the fixed tab or launcher;
hiding a launcher leaves existing instances intact. Components and hooks run
inside plugin context and crash isolation. `tooltip` defaults to `title` and
`layout` is `"padded"` or `"flush"`.

For source using the retired `threadPanelAction` registration, replace it with:

```tsx
app.slots.experimental_tab({
  context: { kind: "thread" },
  availability: "action",
  id: "issue",
  title: "Issue",
  icon: "FileText",
  component: IssuePanel,
  run: ({ threadId, experimental_panel }) => {
    experimental_panel.openTab({
      tab: { id: "issue", context: { kind: "thread" }, availability: "action" },
      params: { threadId },
    });
  },
});
```

For source using the retired `navPanel.fixedTabs` field, remove that field and
register each tab separately, keeping the panel id and tab id unchanged:

```tsx
app.slots.experimental_tab({
  context: { kind: "nav-panel", panelId: "board" },
  availability: "fixed",
  id: "navigation",
  title: "Navigation",
  icon: "PanelRight",
  component: BoardNavigation,
  layout: "flush",
});
```

Open any registered tab with
`experimental_useAppPanel().openTab({ tab: { id, context, availability },
params?, title?, target? })`. Fixed tabs can declare
`experimental_target: { validate }` and read their session-only target with
`experimental_useFixedTabTarget(registration)`. Retired `openFixedTab`,
`experimental_openTab`, `openThreadPanel` and action `openPanel` calls still
work; see [Panel controller](frontend-hooks-and-ui.md#panel-controller).
Existing saved tab identities, orders, action params and split layouts survive;
no plugin data migration is needed when registration ids stay unchanged.

The old registration names are absent from SDK typings. Previously published
bundles and Git-source installs remain supported by runtime adapters. Builds
emit migration warnings rather than blocking install/update; bb records them
in the plugin log.
