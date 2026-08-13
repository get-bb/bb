# APIs To Audit

Every public plugin API member ships with an `experimental_` prefix and an
entry here (see [AGENTS.md](../AGENTS.md), "Plugin API"). Dropping the prefix
is the deliberate stabilization step: audit the entry, rename project-wide,
and delete the entry in the same change.

## `PluginNavPanelRegistration.experimental_sidebarAccessory`

**What it does.** Lets a nav panel register a no-props, presentational React
component at the trailing edge of its host-rendered sidebar row. The component
can own an RPC query and realtime subscription, so a live count updates within
that subtree instead of lifting plugin state into the whole sidebar. The host
does not mount it on compact viewports. On wider viewports its layout box is
limited to one line at 4rem wide by 1.25rem high; overflow is clipped and
ordinary long text is ellipsized. It shares the trailing action column and
fades out for the host options button on row hover or keyboard focus without
unmounting. A crash hides only the accessory.

**Audit before stabilizing.**

1. **Component versus value.** Confirm real consumers need component-owned
   live state, rather than a narrower string/number/badge value plus a separate
   host update primitive. Installed plugins are trusted, but a component can
   still render controls or markup that is inappropriate for row chrome.
2. **Budget.** Revisit the 4rem by 1.25rem cap against counts, short statuses,
   localization, browser zoom, and multiple plugin rows. Decide whether the
   host should expose a fixed badge treatment instead of accepting plugin
   styling.
3. **Compact behavior.** The component is not mounted below the compact
   breakpoint, so it performs no hidden queries there and loses local state
   when the viewport crosses the breakpoint. Confirm that is preferable to a
   mounted-but-CSS-hidden subtree.
4. **Overflow and portals.** The wrapper clips ordinary descendants but cannot
   constrain content portalled elsewhere in the document. Confirm the
   presentational-only contract is sufficient, or enforce a non-component
   value before stabilization.
5. **Accessibility.** Accessory text is exposed beside the navigation button
   without changing that button's stable accessible name. Confirm that reading
   order and the focus-triggered accessory/options swap work for counts and
   short statuses, and decide whether a dedicated label prop or host-rendered
   status semantics are needed.

## `PluginContentScriptContext.experimental_setThreadRowStatus`

Lets a plugin-lifetime content script set or clear one of its own status
indicators on an explicit thread row. The status survives route changes and is
cleared automatically when that frontend generation deactivates.

Before stabilization, audit:

- whether explicit thread targeting belongs on content-script context or a
  dedicated app-level controller;
- multiple simultaneous runs owned by one plugin on one thread;
- arbitration across plugins, frontend generations, and native thread
  statuses;
- persistence expectations across full app reloads and multiple windows;
- validation, accessibility labels, reduced motion, and cleanup on plugin
  reload/disable/removal.

## `bb.agents.registerTool({ experimental_statusLabels })`

**What it does.** Lets a native plugin tool supply one short label while it is
pending and one after successful completion. BB snapshots the labels into the
tool-call event and renders them in its own timeline; a tool without the field
keeps the ordinary `Running tool …` / `Ran tool …` title. Approval, error, and
interruption states deliberately keep their standard titles so the raw tool
identity and failure state remain clear.

Each label is capped at 80 characters and rendered as a truncating segment.

**Audit before stabilizing.**

1. **Presentation scope.** Confirm two static labels cover enough real tool
   types, or introduce a deliberately bounded parameter interpolation API
   without letting plugin strings become arbitrary timeline markup.
2. **Lifecycle semantics.** Revisit whether failed or interrupted calls need
   a third explicit label, rather than reusing the generic fallback.
3. **Persistence and source identity.** Labels are snapshotted by the server
   only for non-MCP native plugin tools. Confirm that distinction stays sound
   as provider adapters and dynamic-tool provenance evolve.

## `experimental_NewThreadComposer` (`@get-bb/plugin-sdk/app`)

**What it does.** The host-owned new-thread compose surface, the create-side
counterpart to `ThreadChat`. It renders bb's full control set — prompt editor
with @-mentions and expand, `+` attachments, provider/model/reasoning picker,
voice, submit, and the row beneath with project, environment, "Branch from:",
and permission mode — and calls `onSubmit` with a `NewThreadRequest`
carrying every resolved selection.

The composer deliberately does **not** create the thread. The plugin does,
through `bb.sdk.threads.spawn`, which auto-fills `origin: "plugin"` and
`originPluginId`. If the component created the thread it would go through the
host's `useCreateThread` and the thread would look host-originated. So the
rule is: the composer owns user selections; the plugin owns filing
(`sectionId`, `parentThreadId`, `title`, `visibility`) and attribution.

Implementation: the shared workflow is
`apps/app/src/components/promptbox/NewThreadComposer.tsx`; the SDK adapter is
`apps/app/src/components/plugin/PluginNewThreadComposer.tsx`, bound in
`apps/app/src/lib/plugin-sdk-app-impl.tsx`.

**Audit before stabilizing.**

1. **`NewThreadRequest` vs. what `threads.spawn` accepts.** The type mirrors
   the subset of `CreateThreadRequest` a composer can resolve. Confirm every
   field still round-trips through `bb.sdk.threads.spawn` unchanged, that
   `executionInputSources` still means the same thing to the server, and that
   no newly required create-thread field is silently missing. Note the
   composer runs `useThreadCreationOptions` with `scope: "component-local"`,
   which never reports a `providerId` provenance source even though the
   composer always sends an explicit `providerId`; decide whether that is
   correct before freezing the shape.

2. **Page-level behavior the adapter skips.** Fork seeds,
   quick-create-project, the guided machine-setup dialog, welcome/empty
   states, and codex-version submit blocking are all deliberately absent.
   Confirm none of them has become load-bearing for correctness (rather than
   convenience) on a plugin surface — codex-version blocking in particular
   means a plugin can submit to a machine whose CLI the primary surface would
   have refused.

3. **Draft and selection scoping.** Drafts persist under a
   `plugin-new-thread` scope keyed by `draftKey ?? pluginId`, and execution
   selections are component-local so a plugin panel never rewrites the user's
   persisted root-composer defaults. Confirm that is still the behavior
   plugin authors expect, and that `draftKey` is the right knob (versus, say,
   a per-instance ephemeral draft).

4. **No plugin composer host binding.** The instance passes no
   `pluginComposerHost`, so plugin composer customizations, banners, and
   `useComposer()` writes do not reach it. Decide whether composers rendered
   by a plugin should participate in that surface before stabilizing.

5. **Seeding props and the round-trip guarantee.** The `default*` props
   (`defaultProviderId`, `defaultModel`, `defaultReasoningLevel`,
   `defaultServiceTier`, `defaultPermissionMode`, `defaultEnvironment`) seed
   the composer from a stored `NewThreadRequest` so a plugin can re-open a
   saved configuration without silently resetting it to project defaults.
   They are seeds (uncontrolled), take precedence over project defaults, and
   re-seed on any value change — including user-touched selections — via the
   creation-options resetKey. `defaultEnvironment` maps args back to picker
   selections in
   `apps/app/src/components/plugin/new-thread-environment-seed.ts`; its
   unrepresentable variants (`project-default`, `personal` without a
   `hostId`, an `unmanaged` `path`) are documented on the prop. Before
   stabilizing, confirm the mapping still inverts
   `resolveRootComposeThreadEnvironment` (the round-trip tests in
   `new-thread-environment-seed.test.ts` and
   `PluginNewThreadComposer.test.tsx` guard this) and re-decide whether the
   re-seed-on-change rule should instead be an explicit reset nonce.

## `app.slots.experimental_newThreadPanelAction` (`@get-bb/plugin-sdk/app`)

**What it does.** Adds a plugin row to the root New thread screen's
right-panel Actions list. Activating it can open a closable panel tab whose
component receives `{ projectId: string | null, params: JsonValue | null }`.
It deliberately does not reuse `threadPanelAction`: that existing contract
requires `threadId: string`, and the in-repo and external consumers built
against it may assume a thread exists. The two slots are surface-specific and
never cross-render.

Before stabilization, audit:

1. **Surface naming.** Confirm "New thread" remains the product name and the
   slot should stay panel-specific rather than becoming a broader root-compose
   action surface.
2. **Context breadth.** Confirm the selected `projectId` is sufficient. A
   plugin can use the composer hooks for the live draft, but the slot does not
   expose the root composer's selected host, environment, provider, or model.
3. **Project changes.** An open tab receives the current project on every
   render, while `run` receives the project selected when the row was
   activated. Confirm that distinction is intuitive and whether changing
   projects should close or re-key open tabs.
4. **Persistence.** Tabs and JSON params persist in the root panel's fixed
   state. Confirm restoring a plugin tab before registrations load, after a
   plugin is removed, and in projectless compose has the right fallback.
5. **Relationship to `threadPanelAction`.** Confirm separate opt-in remains
   preferable to a unified discriminated context after external plugins have
   had time to adopt the root surface deliberately.

## `app.slots.experimental_threadList` (`@get-bb/plugin-sdk/app`)

**What it does.** Replaces the sidebar's scrolling thread list with a plugin
component. Unlike every other `app.slots.*` member this slot is **exclusive**:
one list at a time fills the scroll area. The built-in list stays the default;
the user picks a provider in Settings → Appearance → Sidebar, stored per client
in `localStorage` under `bb.sidebar.threadListProvider`.

Three fallbacks keep the sidebar usable: a preference naming an unregistered
provider resolves to the built-in list without clearing the stored value; a
crashing component renders the built-in list (not the usual "plugin crashed"
chip, which in place of a whole sidebar would strand the user) plus one toast;
and a disabled or uninstalled plugin gets its list back when it returns.

**Audit before stabilizing.**

1. **Arbitration.** Confirm a client-local single choice is right, versus a
   per-project or per-workspace choice, and what a synced setting would mean
   across devices where the plugin is not installed.
2. **Fallback discoverability.** Confirm one toast is the right signal when a
   crash silently swaps the user's sidebar back, and whether the preference
   should self-clear after repeated crashes.
3. **Region boundary.** The plugin gets the scrolling list and nothing else:
   the New-thread button, search field, plugin nav rows, and footer stay
   host-rendered, because they are shared surfaces (other plugins live in two
   of them) and a replaced list must not remove them. Confirm no real sidebar
   needs to claim more, and that passing those regions down as props — letting
   a plugin place them, at the risk of dropping them — stays the wrong trade.
4. **Search ownership.** The host owns the search field and passes
   `searchQuery` down. Confirm a plugin list never needs its own field.
5. **Accessibility.** Confirm the host can still guarantee list semantics,
   focus order, and the mobile close behavior when a plugin owns the markup —
   `onNavigate` is currently the plugin's responsibility to call.

## `experimental_useSidebarThreads` / `experimental_useSidebarThreadActions` (`@get-bb/plugin-sdk/app`)

**What it does.** Gives a plugin component the sidebar's live thread view and
the actions that mutate it. The read hook wraps the host's own
`useSidebarNavigation` query — the same cache and realtime subscriptions the
built-in sidebar uses — so a plugin list costs no extra request and updates on
exactly the same events. The action hook routes to the host's own mutations, so
optimistic updates, toasts, and cache invalidation are identical.

`PluginSidebarThread` is a deliberate copy of the fields a sidebar needs, not a
re-export of the internal `ThreadListEntry`. `indicator` is
`resolveThreadListIndicator` already run by the host, so plugins inherit bb's
precedence (attention before work; plan and goal before the spinner) instead of
reimplementing it, and `indicatorLabel` carries the matching accessible string.

**Audit before stabilizing.**

1. **DTO scope.** Confirm every field earns its place and that the copy stays
   worth its maintenance over `ThreadListEntry`. `hasUnsubmittedDraft` is
   deliberately absent (client-local composer state); confirm plugins do not
   need it. `host` is resolved host-side to `{ id, name }` because a plugin
   cannot turn a host id into a machine name — confirm resolution belongs here
   rather than in a separate hosts hook, and that falling back to the id for an
   unknown host is the right failure.
2. **Indicator coupling.** `indicator` freezes bb's precedence into the
   contract. Confirm new kinds can ship without breaking plugins, and that the
   documented "treat unknown as none" rule is enough.
3. **Unread semantics.** `isUnread` is plain read state, so it is true for
   child threads and running threads that `isUnreadDoneThread` excludes by
   design. Confirm that is the more useful primitive for a replaced list.
4. **Scale.** Confirm one array of every thread is right at ten thousand
   threads, versus a paged or windowed read.
5. **Draft indicators.** `indicator` never reports "draft" or "working-draft",
   because an unsubmitted draft is per-composer client state the host reads per
   row. An idle unread thread holding a draft therefore reads as
   "unread-success" where the built-in row paints "draft". Decide whether to
   close that gap (a per-thread draft hook) or keep it documented.
6. **Action surface.** Destructive and dialog-bearing actions route through
   `useThreadActions()`, so `archive` closes panes and repairs the route, and
   `requestDelete` opens bb's confirmation rather than deleting silently.
   Confirm that split (silent `rename`, host-confirmed delete) is the right
   line, and decide whether bulk actions and undo belong here.
7. **Permission.** Decide whether `archive` and `requestDelete` need any plugin
   permission gate beyond installation trust.
8. **`experimental_useSidebarThreadPullRequest`.** Per-row and opt-in, because
   a PR lookup hits the git host and therefore cannot sit on the payload every
   sidebar loads. It reuses the host's environment-keyed query, so threads
   sharing a worktree share one lookup and the host keeps its own staleness and
   refetch rules. Before stabilizing, confirm: the narrowed DTO (number, title,
   url, state, attention) is enough without leaking checks/review/mergeability;
   a sidebar of many distinct worktrees does not stampede the git host; and
   returning `null` for "lookup failed" (rather than an error) is the right
   failure for a row that should simply show nothing.
9. **`experimental_useSidebarThreadSplit`.** Gives a custom row the built-in
   drag-to-split gesture: spread `splitProps` onto the row, gate any affordance
   on `isAvailable`, and read `layout` to paint where the thread already sits.
   The host owns every rule — the drag engages only after the pointer leaves the
   sidebar, an edge drop splits, a center drop replaces, an open thread focuses
   its pane, and the pane cap turns a split into a replace — so a plugin cannot
   reach a layout the built-in sidebar cannot. Before stabilizing, confirm: a
   list with its own pointer-drag (reorder, swipe) still composes with the
   host's engage threshold; `splitProps` staying an open object is the right
   forward-compatible shape, or it should narrow to a named handler; and
   exposing the full `panes` array does not leak more layout state than a row
   needs.

## `app.slots.experimental_threadHeaderAction` (`@get-bb/plugin-sdk/app`)

**What it does.** Renders a plugin component in the thread header's action row.
The frontend sibling of the backend `bb.ui.registerThreadAction`, which renders
a host-owned button and runs server-side: use that one for "do a thing", and
this one when the control must draw live state (a count, a cluster, a status).

The host places it at the left end of the row, before the workspace button, git
actions, the panel toggle, maximize, and close — the same slot the backend
actions already use. It mounts once per pane, each with that pane's `threadId`.
A crash removes just that control and leaves the rest of the header working.

**Audit before stabilizing.**

1. **Two APIs, one region.** `bb.ui.registerThreadAction` and this slot now
   share a row. Confirm the ordering rule between them, and whether the two
   should merge behind one registration.
2. **Budget.** The row is short and already holds five host controls. Decide a
   cap, or an overflow behavior, before three plugins each add one.
3. **Compact viewport.** `isCompactViewport` asks every plugin to collapse
   itself. Confirm that beats a host-owned overflow menu.
4. **Per-pane mounting.** Confirm plugins handle mounting once per pane, and
   that a popover opened in one pane cannot leak into another.
5. **Height discipline.** The host clamps the control's layout box
   (`max-h-7 max-w-64`) so it cannot grow the chrome row, but deliberately does
   NOT clip overflow — clipping also hides a popover anchored to the control,
   which is the normal way to show anything taller. A plugin can therefore
   still paint outside the row. Decide whether that trade is right, or whether
   the host should require a portal.
6. **Other headers.** Decide whether the compose screen, plugin panels, and the
   workspace header need the same slot, or stay host-only.

### Note on `experimental_threadHeaderAction` crash isolation

`PluginSlotMount` takes an optional `instanceId` that participates in the
crashed-instance key, so one pane's crashed header control does not disable the
other pane's copy (or release its owned state). The thread-list slot omits it
deliberately: it mounts once, and a crash there should disable it everywhere.
Confirm that split before stabilizing, and decide whether other multi-mount
slots need the same treatment.
